"""
Scene Router — all scene endpoints including the real multi-agent SSE generation pipeline.

Generation pipeline per scene:
  1. Load style data from SQLite (agent_sections: narration / dialogue / writer).
  2. Build StoryContext from DB hierarchy (chapter → blueprint → act → scene).
  3. Load character profiles + dynamic postures via StateManager (YAML).
  4. Run SceneAgent to establish atmospheric setting draft (once per scene).
  5. For each beat in scene_events:
       a. NarrationAgent   — if style has 'narration' section
       b. DialogueAgent    — if style has 'dialogue' section
       c. WriterAgent      — always (merges drafts into polished paragraph)
     Log every agent run to the AgentLog table with real prompts + output.
  6. Assemble full content, persist to DB, and yield a single done event.
"""

import asyncio
import json
import re
import uuid
from typing import Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from sqlmodel import Session, select

from api.database import get_session
from api.models.db import Scene, Style, AgentLog, Act, Blueprint, Chapter

# Core agents
from agents.decomposer_agent import DecomposerAgent
from agents.scene_agent import SceneAgent
from agents.narration_agent import NarrationAgent
from agents.dialogue_agent import DialogueAgent
from agents.writer_agent import WriterAgent
from agents.rewrite_agent import RewriteAgent

# Data models & state
from models import StoryContext, SceneBlueprint, ActBlueprint
from state_manager import StateManager
import config

router = APIRouter(prefix="/scenes", tags=["scenes"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_tail(text: str, n_sentences: int = 2) -> str:
    """Extract the last ~n sentences from text for writer context chaining."""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    return ' '.join(sentences[-n_sentences:]) if len(sentences) >= n_sentences else text


def _normalize_events(events: list) -> list:
    """Normalise scene_events to list of dicts with 'beat' and 'style' keys."""
    if not events:
        return []
    if isinstance(events[0], str):
        return [{"beat": e, "style": "general"} for e in events]
    return events


def _load_styles_from_db(session: Session) -> Dict[str, Dict]:
    """
    Load all styles from the SQLite Style table and convert them into the same
    format as style_loader.load_all_styles() so the rest of the pipeline is
    identical to the CLI.
    
    Returns: { style_name: { "agent_sections": {...}, "output_size": int|None } }
    """
    styles = session.exec(select(Style)).all()
    loaded = {}
    for s in styles:
        # agent_sections is stored as JSON in the DB: {"writer": "...", "narration": "...", ...}
        agent_sections = s.agent_sections if isinstance(s.agent_sections, dict) else {}
        loaded[s.name] = {
            "description": s.description,
            "agent_sections": agent_sections,
            "output_size": None,  # respect DISABLE_TOKEN_LIMITS setting from config
        }
    return loaded


def _build_story_context(scene: Scene, session: Session) -> StoryContext:
    """
    Reconstruct a full StoryContext from the DB hierarchy for a given scene row.
    Mirrors exactly what cli.py + orchestrator.py build before generation.
    """
    # Walk up: scene → act → blueprint → chapter
    act = session.get(Act, scene.act_id)
    blueprint = session.get(Blueprint, act.blueprint_id) if act else None
    chapter = session.get(Chapter, blueprint.chapter_id) if blueprint else None

    # Prior scenes in the same act (ordered by scene_number, excluding current)
    prior_scenes_context: list[str] = []
    if act:
        prior_scenes = session.exec(
            select(Scene)
            .where(Scene.act_id == act.id)
            .where(Scene.scene_number < scene.scene_number)
            .order_by(Scene.scene_number)
        ).all()
        prior_scenes_context = [s.scene_description for s in prior_scenes]

    # Load character profiles + dynamic postures from YAML workspace
    state_manager = StateManager()
    story_state = state_manager.read_story_state()
    char_profiles: Dict = {}
    char_states: Dict = {}

    if scene.characters:
        char_context = state_manager.get_character_context(scene.characters, story_state)
        for name, ctx in char_context.items():
            char_profiles[name] = ctx["profile"]
            char_states[name] = ctx["current_state"]

    return StoryContext(
        chapter_title=chapter.title if chapter else "",
        act_number=act.act_number if act else 1,
        scene_number=scene.scene_number,
        background=scene.scene_setting,
        chapter_background="",
        characters=scene.characters or [],
        setting=scene.scene_setting,
        genre="",
        tone_guidelines="",
        writing_focus="",
        prior_scenes_context=prior_scenes_context,
        character_profiles=char_profiles,
        character_states=char_states,
        scene_description=scene.scene_description,
        extra={"scene_events": scene.scene_events or []},
    )


def _determine_mode(scene_index: int, beat_index: int, total_beats: int,
                    scene: Scene, session: Session) -> str:
    """
    Determine the WriterAgent mode string for a beat, mirroring cli.py logic.
    First beat of a scene that uses a new location → opening_with_setting.
    First beat same location as prior scene → opening_without_setting.
    Last beat → closing.
    Middle beats → continuation.
    """
    if beat_index == total_beats - 1:
        return "closing"
    if beat_index > 0:
        return "continuation"

    # First beat — check if location changed from the previous scene in same act
    act = session.get(Act, scene.act_id)
    if act:
        prev_scene = session.exec(
            select(Scene)
            .where(Scene.act_id == act.id)
            .where(Scene.scene_number == scene.scene_number - 1)
        ).first()
        if prev_scene and prev_scene.scene_setting == scene.scene_setting:
            return "opening_without_setting"

    return "opening_with_setting"


# ---------------------------------------------------------------------------
# Main SSE stream generator — real multi-agent pipeline
# ---------------------------------------------------------------------------

async def stream_generator(scene_id: str, session: Session):
    """
    Real LLM-backed scene generation stream.
    
    Protocol (each yield is a JSON-encoded SSE data event):
      { "status": "..." }          — progress update
      { "beats": [...] }           — decomposed beat list (sent once at start)
      { "content": "..." }         — full beat paragraph appended to output
      { "done": true }             — final event; full content saved to DB
      { "error": "..." }           — fatal error
    """

    # -----------------------------------------------------------------------
    # 0. Load scene from DB
    # -----------------------------------------------------------------------
    scene = session.get(Scene, scene_id)
    if not scene:
        yield {"data": json.dumps({"error": "Scene not found"})}
        return

    # -----------------------------------------------------------------------
    # 1. Load styles from SQLite DB (same structure as CLI's style_loader)
    # -----------------------------------------------------------------------
    loaded_styles = _load_styles_from_db(session)
    style_descriptions = {name: data["description"] for name, data in loaded_styles.items()}

    # -----------------------------------------------------------------------
    # 2. Decompose scene into beats if not already done
    # -----------------------------------------------------------------------
    if not scene.scene_events:
        yield {"data": json.dumps({"status": "Decomposing scene into beats..."})}
        await asyncio.sleep(0)

        decomposer = DecomposerAgent()
        decomposed_events = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: decomposer.generate(
                scene_description=scene.scene_description,
                style_descriptions=style_descriptions,
            )
        )

        scene.scene_events = decomposed_events
        session.add(scene)
        session.commit()
        session.refresh(scene)

        # Log decomposer run
        session.add(AgentLog(
            id=str(uuid.uuid4()),
            scene_id=scene.id,
            beat_number=0,
            agent_name="DecomposerAgent",
            system_prompt=config.SYSTEM_PROMPTS.get("decomposer", ""),
            user_prompt=scene.scene_description,
            output=json.dumps(decomposed_events, indent=2),
        ))
        session.commit()

    events = _normalize_events(scene.scene_events)

    # Send beats list to frontend
    yield {"data": json.dumps({"beats": events})}
    await asyncio.sleep(0)

    # -----------------------------------------------------------------------
    # 3. Build StoryContext from DB hierarchy + YAML workspace
    # -----------------------------------------------------------------------
    yield {"data": json.dumps({"status": "Building scene context..."})}
    await asyncio.sleep(0)

    context = _build_story_context(scene, session)

    # -----------------------------------------------------------------------
    # 4. Generate atmospheric setting draft via SceneAgent (once per scene)
    # -----------------------------------------------------------------------
    setting_draft = scene.setting_draft or ""
    if not setting_draft:
        yield {"data": json.dumps({"status": "Generating scene setting..."})}
        await asyncio.sleep(0)

        scene_agent = SceneAgent()
        setting_draft = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: scene_agent.generate(context)
        )

        scene.setting_draft = setting_draft
        session.add(scene)
        session.commit()

        # Log SceneAgent
        session.add(AgentLog(
            id=str(uuid.uuid4()),
            scene_id=scene.id,
            beat_number=0,
            agent_name="SceneAgent",
            system_prompt=scene_agent.system_prompt,
            user_prompt=scene_agent._build_prompt(context),
            output=setting_draft,
        ))
        session.commit()

    # -----------------------------------------------------------------------
    # 5. Clear any existing writer-level logs for a clean regeneration
    # -----------------------------------------------------------------------
    existing_logs = session.exec(
        select(AgentLog)
        .where(AgentLog.scene_id == scene.id)
        .where(AgentLog.beat_number > 0)
    ).all()
    for log in existing_logs:
        session.delete(log)
    session.commit()

    # -----------------------------------------------------------------------
    # 6. Per-beat generation — NarrationAgent → DialogueAgent → WriterAgent
    # -----------------------------------------------------------------------
    narration_agent = NarrationAgent()
    dialogue_agent = DialogueAgent()
    writer_agent = WriterAgent()

    total_beats = len(events)
    beat_outputs: list[str] = []
    prev_tail = setting_draft  # chain context between beats

    for idx, event in enumerate(events):
        beat_desc = event.get("beat", str(event)) if isinstance(event, dict) else str(event)
        beat_style = event.get("style", "general") if isinstance(event, dict) else "general"

        style_data = loaded_styles.get(beat_style, {})
        agent_sections = style_data.get("agent_sections", {})
        writer_guidelines = agent_sections.get("writer", "")
        beat_token_limit = None if config.DISABLE_TOKEN_LIMITS else style_data.get("output_size")

        mode = _determine_mode(
            scene_index=context.scene_number - 1,
            beat_index=idx,
            total_beats=total_beats,
            scene=scene,
            session=session,
        )

        beat_num = idx + 1
        yield {"data": json.dumps({
            "status": f"Beat {beat_num}/{total_beats} [{beat_style} / {mode}]: {beat_desc[:60]}..."
        })}
        await asyncio.sleep(0)

        drafts: Dict[str, str] = {}

        # ---- NarrationAgent ------------------------------------------------
        narration_draft = ""
        if "narration" in agent_sections:
            guidelines = agent_sections["narration"]
            yield {"data": json.dumps({"status": f"  Beat {beat_num}: Running NarrationAgent..."})}
            await asyncio.sleep(0)

            narration_draft = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda g=guidelines: narration_agent.generate(context, beat_desc, g)
            )
            drafts["narration"] = narration_draft

            session.add(AgentLog(
                id=str(uuid.uuid4()),
                scene_id=scene.id,
                beat_number=beat_num,
                agent_name="NarrationAgent",
                system_prompt=narration_agent.system_prompt,
                user_prompt=narration_agent._build_prompt(context, beat_desc, guidelines),
                output=narration_draft,
            ))
            session.commit()

        # ---- DialogueAgent -------------------------------------------------
        if "dialogue" in agent_sections:
            guidelines = agent_sections["dialogue"]
            yield {"data": json.dumps({"status": f"  Beat {beat_num}: Running DialogueAgent..."})}
            await asyncio.sleep(0)

            dialogue_draft = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda g=guidelines: dialogue_agent.generate(context, event, g, narration_draft)
            )
            drafts["dialogue"] = dialogue_draft

            session.add(AgentLog(
                id=str(uuid.uuid4()),
                scene_id=scene.id,
                beat_number=beat_num,
                agent_name="DialogueAgent",
                system_prompt=dialogue_agent.system_prompt,
                user_prompt=dialogue_agent._build_prompt(context, event, guidelines, narration_draft),
                output=dialogue_draft,
            ))
            session.commit()

        # ---- WriterAgent ---------------------------------------------------
        yield {"data": json.dumps({"status": f"  Beat {beat_num}: Running WriterAgent..."})}
        await asyncio.sleep(0)

        # Only pass the setting_draft to the WriterAgent on the very first beat
        beat_setting_draft = setting_draft if (idx == 0 and mode == "opening_with_setting") else ""

        beat_text = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda bsd=beat_setting_draft: writer_agent.generate_beat(
                context=context,
                beat=event,
                beat_index=idx,
                total_beats=total_beats,
                prev_tail=prev_tail,
                setting_draft=bsd,
                drafts=drafts,
                writer_guidelines=writer_guidelines,
                mode=mode,
                token_limit=beat_token_limit,
            )
        )

        session.add(AgentLog(
            id=str(uuid.uuid4()),
            scene_id=scene.id,
            beat_number=beat_num,
            agent_name="WriterAgent",
            system_prompt=writer_agent.system_prompt,
            user_prompt=getattr(writer_agent, "last_user_prompt", ""),
            output=beat_text,
        ))
        session.commit()
        # Format the draft with a clean visual divider block (horizontal rule) for subsequent beats
        if idx == 0:
            formatted_beat = beat_text
        else:
            formatted_beat = f"\n\n---\n{beat_text}"
        beat_outputs.append(formatted_beat)
        prev_tail = _extract_tail(beat_text, 2)

        # Yield the accumulated content so far to keep the editor state fully in sync
        full_content_so_far = "\n\n".join(beat_outputs)
        yield {"data": json.dumps({"content": full_content_so_far})}
        await asyncio.sleep(0)

    # -----------------------------------------------------------------------
    # 7. Persist final assembled content
    # -----------------------------------------------------------------------
    full_content = "\n\n".join(beat_outputs)
    scene.generated_content = full_content
    session.add(scene)
    session.commit()

    yield {"data": json.dumps({"done": True})}


# ---------------------------------------------------------------------------
# Pydantic payloads
# ---------------------------------------------------------------------------

class ContentUpdate(BaseModel):
    content: str

class BeatsUpdate(BaseModel):
    beats: list

class SceneUpdate(BaseModel):
    scene_description: Optional[str] = None
    scene_setting: Optional[str] = None
    characters: Optional[list] = None

class RewriteSelectionRequest(BaseModel):
    selected_text: str
    feedback: str
    context: Optional[str] = ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.patch("/{scene_id}")
def update_scene(scene_id: str, payload: SceneUpdate, session: Session = Depends(get_session)):
    scene = session.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    if payload.scene_description is not None:
        scene.scene_description = payload.scene_description
        # Reset beats + content when description changes so they get regenerated
        scene.scene_events = []
        scene.generated_content = None
        scene.setting_draft = None
    if payload.scene_setting is not None:
        scene.scene_setting = payload.scene_setting
    if payload.characters is not None:
        scene.characters = payload.characters

    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


@router.get("/{scene_id}")
def get_scene(scene_id: str, session: Session = Depends(get_session)):
    scene = session.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    return scene


@router.post("/{scene_id}/decompose")
def decompose_scene(scene_id: str, session: Session = Depends(get_session)):
    scene = session.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    loaded_styles = _load_styles_from_db(session)
    style_descriptions = {name: data["description"] for name, data in loaded_styles.items()}

    decomposer = DecomposerAgent()
    decomposed_events = decomposer.generate(
        scene_description=scene.scene_description,
        style_descriptions=style_descriptions,
    )

    scene.scene_events = decomposed_events
    scene.generated_content = None
    scene.setting_draft = None
    session.add(scene)

    session.add(AgentLog(
        id=str(uuid.uuid4()),
        scene_id=scene.id,
        beat_number=0,
        agent_name="DecomposerAgent",
        system_prompt=config.SYSTEM_PROMPTS.get("decomposer", ""),
        user_prompt=scene.scene_description,
        output=json.dumps(decomposed_events, indent=2),
    ))
    session.commit()
    session.refresh(scene)
    return scene


@router.get("/{scene_id}/generate")
def generate_scene(scene_id: str, session: Session = Depends(get_session)):
    return EventSourceResponse(stream_generator(scene_id, session))


@router.patch("/{scene_id}/content")
def update_scene_content(scene_id: str, payload: ContentUpdate, session: Session = Depends(get_session)):
    scene = session.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    scene.generated_content = payload.content
    session.add(scene)
    session.commit()
    return {"status": "success"}


@router.patch("/{scene_id}/beats")
def update_scene_beats(scene_id: str, payload: BeatsUpdate, session: Session = Depends(get_session)):
    scene = session.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    scene.scene_events = payload.beats
    session.add(scene)
    session.commit()
    session.refresh(scene)
    return scene


@router.get("/{scene_id}/logs")
def get_scene_logs(scene_id: str, session: Session = Depends(get_session)):
    logs = session.exec(
        select(AgentLog)
        .where(AgentLog.scene_id == scene_id)
        .order_by(AgentLog.beat_number)
    ).all()
    return logs


@router.post("/{scene_id}/approve")
def approve_scene(scene_id: str, session: Session = Depends(get_session)):
    scene = session.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    from datetime import datetime
    scene.approved = not scene.approved
    scene.approved_at = datetime.utcnow() if scene.approved else None
    session.add(scene)
    session.commit()
    return {"status": "success", "approved": scene.approved}


@router.post("/{scene_id}/regenerate")
def regenerate_scene(scene_id: str, request: Request, session: Session = Depends(get_session)):
    scene = session.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    # Reset so a full fresh pipeline runs
    scene.generated_content = None
    scene.setting_draft = None
    session.add(scene)
    session.commit()

    return EventSourceResponse(stream_generator(scene_id, session))

@router.post("/{scene_id}/rewrite_selection")
def rewrite_selection(scene_id: str, payload: RewriteSelectionRequest, session: Session = Depends(get_session)):
    scene = session.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    agent = RewriteAgent()
    # Use the scene.generated_content as context if available
    context = payload.context or scene.generated_content or ""
    
    rewritten_text = agent.generate(
        selected_text=payload.selected_text,
        feedback=payload.feedback,
        context_text=context
    )
    
    return {"rewritten_text": rewritten_text}

