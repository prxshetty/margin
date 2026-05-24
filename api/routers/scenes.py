"""
Scene Router — all scene endpoints including the real multi-agent SSE generation pipeline.
"""

import asyncio
import json
import re
import uuid
from typing import Optional, Dict, List

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from api.services.file_storage import storage
from api.models.domain import Scene, AgentLog, SceneEvent

# Core agents
from agents.decomposer_agent import DecomposerAgent
from agents.scene_agent import SceneAgent
from agents.narration_agent import NarrationAgent
from agents.dialogue_agent import DialogueAgent
from agents.writer_agent import WriterAgent
from agents.rewrite_agent import RewriteAgent

# Data models & state
from models import StoryContext
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


def _load_styles() -> Dict[str, Dict]:
    """Load styles from file storage."""
    styles = storage.get_styles()
    loaded = {}
    for s in styles:
        loaded[s.name] = {
            "description": s.description,
            "agent_sections": s.agent_sections,
            "output_size": None,  # respect DISABLE_TOKEN_LIMITS setting from config
        }
    return loaded


def _build_story_context(scene: Scene) -> StoryContext:
    """Reconstruct a full StoryContext from files for a given scene."""
    # Extract IDs from scene.id: {chapter_slug}_act-{act_num}_scene-{scene_num}
    parts = scene.id.split("_")
    chapter_slug = parts[0]
    act_num = int(parts[1].split("-")[1])
    
    chapter = storage.get_chapter(chapter_slug)
    
    # Prior scenes in the same act
    prior_scenes = storage.get_prior_scenes_for_context(chapter_slug, act_num, scene.scene_number)
    prior_scenes_context = [s.scene_description for s in prior_scenes]

    # Load character profiles + dynamic postures from YAML workspace
    state_manager = StateManager(
        characters_dir=str(storage.inputs_dir / "characters"),
        story_state_path=str(storage.inputs_dir / "story_state.yaml")
    )
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
        act_number=act_num,
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
                    scene: Scene) -> str:
    """Determine the WriterAgent mode string for a beat."""
    if beat_index == total_beats - 1:
        return "closing"
    if beat_index > 0:
        return "continuation"

    # First beat — check if location changed from the previous scene in same act
    parts = scene.id.split("_")
    chapter_slug = parts[0]
    act_num = int(parts[1].split("-")[1])
    
    prior_scenes = storage.get_prior_scenes_for_context(chapter_slug, act_num, scene.scene_number)
    if prior_scenes:
        prev_scene = prior_scenes[-1]
        if prev_scene.scene_setting == scene.scene_setting:
            return "opening_without_setting"

    return "opening_with_setting"


# ---------------------------------------------------------------------------
# Main SSE stream generator — real multi-agent pipeline
# ---------------------------------------------------------------------------

async def stream_generator(scene_id: str):
    # 0. Load scene
    scene = storage.get_scene(scene_id)
    if not scene:
        yield {"data": json.dumps({"error": "Scene not found"})}
        return

    # 1. Load styles
    loaded_styles = _load_styles()
    style_descriptions = {name: data["description"] for name, data in loaded_styles.items()}

    # 2. Decompose scene into beats if not already done
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
        storage.save_scene(scene)

        # Log decomposer run
        storage.save_agent_log(AgentLog(
            id=str(uuid.uuid4()),
            scene_id=scene.id,
            beat_number=0,
            agent_name="DecomposerAgent",
            system_prompt=config.SYSTEM_PROMPTS.get("decomposer", ""),
            user_prompt=scene.scene_description,
            output=json.dumps(decomposed_events, indent=2),
        ))

    events = _normalize_events(scene.scene_events)

    # Send beats list to frontend
    yield {"data": json.dumps({"beats": events})}
    await asyncio.sleep(0)

    # 3. Build StoryContext
    yield {"data": json.dumps({"status": "Building scene context..."})}
    await asyncio.sleep(0)

    context = _build_story_context(scene)

    # 4. Generate atmospheric setting draft via SceneAgent
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
        storage.save_scene(scene)

        # Log SceneAgent
        storage.save_agent_log(AgentLog(
            id=str(uuid.uuid4()),
            scene_id=scene.id,
            beat_number=0,
            agent_name="SceneAgent",
            system_prompt=scene_agent.system_prompt,
            user_prompt=scene_agent._build_prompt(context),
            output=setting_draft,
        ))

    # 5. Clear any existing writer-level logs for a clean regeneration
    storage.clear_writer_logs(scene.id)

    # 6. Per-beat generation — NarrationAgent → DialogueAgent → WriterAgent
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
            scene=scene
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

            storage.save_agent_log(AgentLog(
                id=str(uuid.uuid4()),
                scene_id=scene.id,
                beat_number=beat_num,
                agent_name="NarrationAgent",
                system_prompt=narration_agent.system_prompt,
                user_prompt=narration_agent._build_prompt(context, beat_desc, guidelines),
                output=narration_draft,
            ))

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

            storage.save_agent_log(AgentLog(
                id=str(uuid.uuid4()),
                scene_id=scene.id,
                beat_number=beat_num,
                agent_name="DialogueAgent",
                system_prompt=dialogue_agent.system_prompt,
                user_prompt=dialogue_agent._build_prompt(context, event, guidelines, narration_draft),
                output=dialogue_draft,
            ))

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

        storage.save_agent_log(AgentLog(
            id=str(uuid.uuid4()),
            scene_id=scene.id,
            beat_number=beat_num,
            agent_name="WriterAgent",
            system_prompt=writer_agent.system_prompt,
            user_prompt=getattr(writer_agent, "last_user_prompt", ""),
            output=beat_text,
        ))

        beat_outputs.append(beat_text)
        prev_tail = _extract_tail(beat_text, 2)

        full_content_so_far = "\n\n---\n\n".join(beat_outputs)
        yield {"data": json.dumps({"content": full_content_so_far})}
        await asyncio.sleep(0)

    # 7. Persist final assembled content
    full_content = "\n\n---\n\n".join(beat_outputs)
    scene.generated_content = full_content
    storage.save_scene(scene)

    yield {"data": json.dumps({"done": True})}


# ---------------------------------------------------------------------------
# Pydantic payloads
# ---------------------------------------------------------------------------

class ContentUpdate(BaseModel):
    content: str

class BeatsUpdate(BaseModel):
    beats: List[SceneEvent]

class SceneUpdate(BaseModel):
    scene_description: Optional[str] = None
    scene_setting: Optional[str] = None
    characters: Optional[list] = None

class RewriteSelectionRequest(BaseModel):
    selected_text: str
    feedback: str
    context: Optional[str] = ""


# ---------------------------------------------------------------------------
# Endpoints (specific routes first, generic catch-all last)
# ---------------------------------------------------------------------------

@router.post("/{scene_id:path}/decompose")
def decompose_scene(scene_id: str):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    loaded_styles = _load_styles()
    style_descriptions = {name: data["description"] for name, data in loaded_styles.items()}

    decomposer = DecomposerAgent()
    decomposed_events = decomposer.generate(
        scene_description=scene.scene_description,
        style_descriptions=style_descriptions,
    )

    scene.scene_events = decomposed_events
    scene.generated_content = None
    scene.setting_draft = None
    storage.save_scene(scene)

    storage.save_agent_log(AgentLog(
        id=str(uuid.uuid4()),
        scene_id=scene.id,
        beat_number=0,
        agent_name="DecomposerAgent",
        system_prompt=config.SYSTEM_PROMPTS.get("decomposer", ""),
        user_prompt=scene.scene_description,
        output=json.dumps(decomposed_events, indent=2),
    ))
    return scene


@router.get("/{scene_id:path}/generate")
def generate_scene(scene_id: str):
    return EventSourceResponse(stream_generator(scene_id))


@router.patch("/{scene_id:path}/content")
def update_scene_content(scene_id: str, payload: ContentUpdate):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    scene.generated_content = payload.content
    storage.save_scene(scene)
    return {"status": "success"}


@router.patch("/{scene_id:path}/beats")
def update_scene_beats(scene_id: str, payload: BeatsUpdate):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    scene.scene_events = payload.beats
    storage.save_scene(scene)
    return scene


@router.get("/{scene_id:path}/logs")
def get_scene_logs(scene_id: str):
    return storage.get_agent_logs(scene_id)


@router.post("/{scene_id:path}/approve")
def approve_scene(scene_id: str):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    from datetime import datetime
    scene.approved = not scene.approved
    scene.approved_at = datetime.utcnow() if scene.approved else None
    storage.save_scene(scene)
    return {"status": "success", "approved": scene.approved}


@router.post("/{scene_id:path}/regenerate")
def regenerate_scene(scene_id: str, request: Request):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    scene.generated_content = None
    scene.setting_draft = None
    storage.save_scene(scene)

    return EventSourceResponse(stream_generator(scene_id))


@router.post("/{scene_id:path}/rewrite_selection")
def rewrite_selection(scene_id: str, payload: RewriteSelectionRequest):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    agent = RewriteAgent()
    context = payload.context or scene.generated_content or ""

    rewritten_text = agent.generate(
        selected_text=payload.selected_text,
        feedback=payload.feedback,
        context_text=context
    )

    return {"rewritten_text": rewritten_text}


@router.get("/{scene_id:path}/beats/{beat_num}")
def get_beat(scene_id: str, beat_num: int):
    beat = storage.get_beat(scene_id, beat_num)
    if beat is None:
        raise HTTPException(status_code=404, detail="Beat not found")
    return beat


class BeatContentUpdate(BaseModel):
    beat: str

@router.patch("/{scene_id:path}/beats/{beat_num}")
def update_beat(scene_id: str, beat_num: int, payload: BeatContentUpdate):
    updated = storage.update_beat(scene_id, beat_num, payload.beat)
    if updated is None:
        raise HTTPException(status_code=404, detail="Beat not found")
    return updated


# Generic catch-all routes (must be last)
@router.patch("/{scene_id:path}")
def update_scene(scene_id: str, payload: SceneUpdate):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    if payload.scene_description is not None:
        scene.scene_description = payload.scene_description
        scene.scene_events = []
        scene.generated_content = None
        scene.setting_draft = None
    if payload.scene_setting is not None:
        scene.scene_setting = payload.scene_setting
    if payload.characters is not None:
        scene.characters = payload.characters

    storage.save_scene(scene)
    return scene


@router.get("/{scene_id:path}")
def get_scene(scene_id: str):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    return scene
