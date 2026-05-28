"""
Scene Router — all scene endpoints including the real multi-agent SSE generation pipeline.
"""

import asyncio
import json
import re
import uuid
from typing import Optional, Dict, List
from datetime import datetime

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
from agents.document_edit_agent import DocumentEditAgent
from schema_loader import get_schema

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


def _global_dialogue_density() -> float:
    settings = storage.get_settings()
    value = settings.get("dialogue_density", 0.5)
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.5


def _effective_dialogue_density(event: dict) -> float:
    value = event.get("dialogue_density") if isinstance(event, dict) else None
    if value is None:
        return _global_dialogue_density()
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return _global_dialogue_density()


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


def _load_character_context(scene: Scene) -> Dict[str, str]:
    """Load character profile content for each character listed in the scene."""
    characters_context = {}
    for char_name in scene.characters:
        # Convert "Elara Vance" -> "elara_vance" to find the file
        slug = char_name.lower().replace(" ", "_")
        content = storage.get_character_content(slug)
        if content:
            characters_context[char_name] = content
    return characters_context


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
        yield {"data": json.dumps({"error": "Scene must be decomposed into beats before generation."})}
        return

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
            prose_weight = event.get("prose_weight", "balanced") if isinstance(event, dict) else "balanced"
            yield {"data": json.dumps({"status": f"  Beat {beat_num}: Running NarrationAgent..."})}
            await asyncio.sleep(0)

            narration_draft = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda g=guidelines, pw=prose_weight: narration_agent.generate(
                    context, beat_desc, g, prose_weight=pw
                )
            )
            drafts["narration"] = narration_draft
            storage.save_beat_draft(scene.id, beat_num, "narration", narration_draft)

            storage.save_agent_log(AgentLog(
                id=str(uuid.uuid4()),
                scene_id=scene.id,
                beat_number=beat_num,
                agent_name="NarrationAgent",
                system_prompt=narration_agent.system_prompt,
                user_prompt=narration_agent._build_prompt(
                    context, beat_desc, guidelines,
                    prose_weight=prose_weight
                ),
                output=narration_draft,
            ))

        # ---- DialogueAgent -------------------------------------------------
        # Skip in the auto pipeline when expected_exchanges is "0".
        # The individual /draft/dialogue endpoint remains open for user-triggered overrides.
        expected_exchanges_for_dialogue = event.get("expected_exchanges", "0") if isinstance(event, dict) else "0"
        if "dialogue" in agent_sections and expected_exchanges_for_dialogue != "0":
            guidelines = agent_sections["dialogue"]
            yield {"data": json.dumps({"status": f"  Beat {beat_num}: Running DialogueAgent..."})}
            await asyncio.sleep(0)

            dialogue_draft = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda g=guidelines: dialogue_agent.generate(context, event, g, narration_draft=narration_draft)
            )
            drafts["dialogue"] = dialogue_draft
            storage.save_beat_draft(scene.id, beat_num, "dialogue", dialogue_draft)

            storage.save_agent_log(AgentLog(
                id=str(uuid.uuid4()),
                scene_id=scene.id,
                beat_number=beat_num,
                agent_name="DialogueAgent",
                system_prompt=dialogue_agent.system_prompt,
                user_prompt=dialogue_agent._build_prompt(context, event, guidelines, narration_draft=narration_draft),
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
                dialogue_density=_effective_dialogue_density(event),
            )
        )

        storage.save_beat_draft(scene.id, beat_num, "prose", beat_text)

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
# Draft-only SSE generator — narration + dialogue for ALL beats, no writer merge
# ---------------------------------------------------------------------------

async def generate_all_drafts_generator(scene_id: str):
    """SSE generator that runs NarrationAgent + DialogueAgent for every beat.
    Unlike stream_generator, this does NOT run WriterAgent or assemble scene prose.
    """
    scene = storage.get_scene(scene_id)
    if not scene:
        yield {"data": json.dumps({"error": "Scene not found"})}
        return

    loaded_styles = _load_styles()

    if not scene.scene_events:
        yield {"data": json.dumps({"error": "Scene must be decomposed into beats first."})}
        return

    events = _normalize_events(scene.scene_events)
    total_beats = len(events)

    yield {"data": json.dumps({"beats": events})}
    await asyncio.sleep(0)

    yield {"data": json.dumps({"status": "Building scene context..."})}
    await asyncio.sleep(0)

    context = _build_story_context(scene)

    narration_agent = NarrationAgent()
    dialogue_agent = DialogueAgent()

    for idx, event in enumerate(events):
        beat_desc = event.get("beat", str(event)) if isinstance(event, dict) else str(event)
        beat_style = event.get("style", "general") if isinstance(event, dict) else "general"
        style_data = loaded_styles.get(beat_style, {})
        agent_sections = style_data.get("agent_sections", {})
        beat_num = idx + 1
        narration_draft = ""

        # ---- NarrationAgent ------------------------------------------------
        if "narration" in agent_sections:
            guidelines = agent_sections["narration"]
            prose_weight = event.get("prose_weight", "balanced") if isinstance(event, dict) else "balanced"
            yield {"data": json.dumps({"status": f"Beat {beat_num}/{total_beats}: Generating narration..."})}
            await asyncio.sleep(0)

            narration_draft = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda g=guidelines, pw=prose_weight, bd=beat_desc: narration_agent.generate(
                    context, bd, g, prose_weight=pw
                )
            )
            storage.save_beat_draft(scene.id, beat_num, "narration", narration_draft)

            storage.save_agent_log(AgentLog(
                id=str(uuid.uuid4()),
                scene_id=scene.id,
                beat_number=beat_num,
                agent_name="NarrationAgent",
                system_prompt=narration_agent.system_prompt,
                user_prompt=narration_agent._build_prompt(
                    context, beat_desc, guidelines, prose_weight=prose_weight
                ),
                output=narration_draft,
            ))

        # ---- DialogueAgent -------------------------------------------------
        expected_exchanges = event.get("expected_exchanges", "0") if isinstance(event, dict) else "0"
        if "dialogue" in agent_sections and expected_exchanges != "0":
            guidelines = agent_sections["dialogue"]
            yield {"data": json.dumps({"status": f"Beat {beat_num}/{total_beats}: Generating dialogue..."})}
            await asyncio.sleep(0)

            dialogue_draft = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda g=guidelines, ev=event, nd=narration_draft: dialogue_agent.generate(context, ev, g, narration_draft=nd)
            )
            storage.save_beat_draft(scene.id, beat_num, "dialogue", dialogue_draft)

            storage.save_agent_log(AgentLog(
                id=str(uuid.uuid4()),
                scene_id=scene.id,
                beat_number=beat_num,
                agent_name="DialogueAgent",
                system_prompt=dialogue_agent.system_prompt,
                user_prompt=dialogue_agent._build_prompt(context, event, guidelines, narration_draft=narration_draft),
                output=dialogue_draft,
            ))

        yield {"data": json.dumps({"status": f"Beat {beat_num}/{total_beats}: Complete"})}
        await asyncio.sleep(0)

    yield {"data": json.dumps({"done": True})}


# ---------------------------------------------------------------------------
# Merge-all SSE generator — runs WriterAgent for every beat, then assembles
# ---------------------------------------------------------------------------

async def merge_all_beats_generator(scene_id: str):
    """SSE generator that runs WriterAgent for every beat to merge saved
    narration + dialogue drafts into final prose, then assembles the scene.
    """
    scene = storage.get_scene(scene_id)
    if not scene:
        yield {"data": json.dumps({"error": "Scene not found"})}
        return

    if not scene.scene_events:
        yield {"data": json.dumps({"error": "Scene must be decomposed into beats first."})}
        return

    events = _normalize_events(scene.scene_events)
    total_beats = len(events)

    yield {"data": json.dumps({"beats": events})}
    await asyncio.sleep(0)

    yield {"data": json.dumps({"status": "Building scene context..."})}
    await asyncio.sleep(0)

    context = _build_story_context(scene)
    loaded_styles = _load_styles()
    writer_agent = WriterAgent()

    prev_tail = scene.setting_draft or ""
    beat_outputs: list[str] = []

    for idx, event in enumerate(events):
        beat_style = event.get("style", "general") if isinstance(event, dict) else "general"
        style_data = loaded_styles.get(beat_style, {})
        agent_sections = style_data.get("agent_sections", {})
        writer_guidelines = agent_sections.get("writer", "")
        beat_token_limit = None if config.DISABLE_TOKEN_LIMITS else style_data.get("output_size")
        beat_num = idx + 1

        # Determine mode
        mode = _determine_mode(
            scene_index=context.scene_number - 1,
            beat_index=idx,
            total_beats=total_beats,
            scene=scene,
        )

        yield {"data": json.dumps({"status": f"Beat {beat_num}/{total_beats}: Merging drafts... ({mode})"})}
        await asyncio.sleep(0)

        # Load saved drafts
        drafts: Dict[str, str] = {}
        narration_draft = storage.get_beat_draft(scene_id, beat_num, "narration")
        if narration_draft:
            drafts["narration"] = narration_draft
        dialogue_draft = storage.get_beat_draft(scene_id, beat_num, "dialogue")
        if dialogue_draft:
            drafts["dialogue"] = dialogue_draft

        if not drafts:
            yield {"data": json.dumps({"status": f"Beat {beat_num}/{total_beats}: Skipping — no drafts found"})}
            await asyncio.sleep(0)
            # Still append empty to keep beat count consistent
            beat_outputs.append("")
            continue

        beat_setting_draft = scene.setting_draft if (idx == 0 and mode == "opening_with_setting") else ""

        beat_text = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda ev=event, bsd=beat_setting_draft, pt=prev_tail, g=writer_guidelines, tl=beat_token_limit: writer_agent.generate_beat(
                context=context,
                beat=ev,
                beat_index=idx,
                total_beats=total_beats,
                prev_tail=pt,
                setting_draft=bsd,
                drafts=drafts,
                writer_guidelines=g,
                mode=mode,
                token_limit=tl,
                dialogue_density=_effective_dialogue_density(ev),
            )
        )

        storage.save_beat_draft(scene_id, beat_num, "prose", beat_text)

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

        yield {"data": json.dumps({"status": f"Beat {beat_num}/{total_beats}: Complete"})}
        await asyncio.sleep(0)

    # Assemble final scene prose
    full_content = "\n\n---\n\n".join(beat_outputs)
    scene.generated_content = full_content
    storage.save_scene(scene)

    yield {"data": json.dumps({"status": "Scene assembled"})}
    await asyncio.sleep(0)

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

class InsertAfterRequest(BaseModel):
    text_before: str
    text_after: str
    block_type: str
    feedback: str
    context: Optional[str] = ""


class DraftsUpdatePayload(BaseModel):
    narration_draft: Optional[str] = None
    dialogue_draft: Optional[str] = None
    beat_prose: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints (specific routes first, generic catch-all last)
# ---------------------------------------------------------------------------

@router.get("/{scene_id:path}/beats/{beat_num}/drafts")
def get_beat_drafts(scene_id: str, beat_num: int):
    narration = storage.get_beat_draft(scene_id, beat_num, "narration") or ""
    dialogue = storage.get_beat_draft(scene_id, beat_num, "dialogue") or ""
    prose = storage.get_beat_draft(scene_id, beat_num, "prose") or ""
    return {
        "narration_draft": narration,
        "dialogue_draft": dialogue,
        "beat_prose": prose
    }

@router.patch("/{scene_id:path}/beats/{beat_num}/drafts")
def update_beat_drafts(scene_id: str, beat_num: int, payload: DraftsUpdatePayload):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    if payload.narration_draft is not None:
        storage.save_beat_draft(scene_id, beat_num, "narration", payload.narration_draft)
    if payload.dialogue_draft is not None:
        storage.save_beat_draft(scene_id, beat_num, "dialogue", payload.dialogue_draft)
    if payload.beat_prose is not None:
        storage.save_beat_draft(scene_id, beat_num, "prose", payload.beat_prose)
        
        # Auto-compile scene prose
        compiled_prose = storage.assemble_scene_prose(scene_id)
        if compiled_prose:
            scene.generated_content = compiled_prose
            storage.save_scene(scene)
            
    return {"status": "success"}

@router.post("/{scene_id:path}/beats/{beat_num}/draft/narration")
async def generate_narration_draft(scene_id: str, beat_num: int):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    events = _normalize_events(scene.scene_events)
    idx = beat_num - 1
    if idx < 0 or idx >= len(events):
        raise HTTPException(status_code=404, detail="Beat index out of bounds")
        
    event = events[idx]
    beat_desc = event.get("beat", "")
    beat_style = event.get("style", "general")
    
    context = _build_story_context(scene)
    loaded_styles = _load_styles()
    style_data = loaded_styles.get(beat_style, {})
    agent_sections = style_data.get("agent_sections", {})
    
    narration_agent = NarrationAgent()
    
    guidelines = agent_sections.get("narration", "")
    prose_weight = event.get("prose_weight", "balanced") if isinstance(event, dict) else "balanced"
    narration_draft = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: narration_agent.generate(
            context, beat_desc, guidelines,
            prose_weight=prose_weight
        )
    )
    storage.save_beat_draft(scene_id, beat_num, "narration", narration_draft)

    storage.save_agent_log(AgentLog(
        id=str(uuid.uuid4()),
        scene_id=scene.id,
        beat_number=beat_num,
        agent_name="NarrationAgent",
        system_prompt=narration_agent.system_prompt,
        user_prompt=narration_agent._build_prompt(
            context, beat_desc, guidelines,
            prose_weight=prose_weight
        ),
        output=narration_draft,
    ))

    return {"narration_draft": narration_draft}

@router.post("/{scene_id:path}/beats/{beat_num}/draft/dialogue")
async def generate_dialogue_draft(scene_id: str, beat_num: int):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    events = _normalize_events(scene.scene_events)
    idx = beat_num - 1
    if idx < 0 or idx >= len(events):
        raise HTTPException(status_code=404, detail="Beat index out of bounds")
        
    event = events[idx]
    beat_style = event.get("style", "general")
    
    context = _build_story_context(scene)
    loaded_styles = _load_styles()
    style_data = loaded_styles.get(beat_style, {})
    agent_sections = style_data.get("agent_sections", {})
    
    # Load the narration draft currently saved on disk (includes any manual edits)
    narration_draft = storage.get_beat_draft(scene_id, beat_num, "narration") or ""
    
    dialogue_agent = DialogueAgent()

    guidelines = agent_sections.get("dialogue", "")
    dialogue_draft = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: dialogue_agent.generate(context, event, guidelines, narration_draft=narration_draft)
    )
    storage.save_beat_draft(scene_id, beat_num, "dialogue", dialogue_draft)

    storage.save_agent_log(AgentLog(
        id=str(uuid.uuid4()),
        scene_id=scene.id,
        beat_number=beat_num,
        agent_name="DialogueAgent",
        system_prompt=dialogue_agent.system_prompt,
        user_prompt=dialogue_agent._build_prompt(context, event, guidelines, narration_draft=narration_draft),
        output=dialogue_draft,
    ))

    return {"dialogue_draft": dialogue_draft}

@router.post("/{scene_id:path}/beats/{beat_num}/merge")
async def merge_beat_drafts(scene_id: str, beat_num: int):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    events = _normalize_events(scene.scene_events)
    idx = beat_num - 1
    if idx < 0 or idx >= len(events):
        raise HTTPException(status_code=404, detail="Beat index out of bounds")
        
    event = events[idx]
    beat_style = event.get("style", "general")
    total_beats = len(events)
    
    context = _build_story_context(scene)
    loaded_styles = _load_styles()
    style_data = loaded_styles.get(beat_style, {})
    agent_sections = style_data.get("agent_sections", {})
    writer_guidelines = agent_sections.get("writer", "")
    beat_token_limit = None if config.DISABLE_TOKEN_LIMITS else style_data.get("output_size")
    
    # Determine mode
    mode = _determine_mode(
        scene_index=context.scene_number - 1,
        beat_index=idx,
        total_beats=total_beats,
        scene=scene
    )
    
    # Resolve prev_tail
    prev_tail = ""
    if beat_num > 1:
        prev_prose = storage.get_beat_draft(scene_id, beat_num - 1, "prose")
        if prev_prose:
            prev_tail = _extract_tail(prev_prose, 2)
    else:
        prev_tail = scene.setting_draft or ""
        
    # Load saved drafts
    drafts = {}
    narration_draft = storage.get_beat_draft(scene_id, beat_num, "narration")
    if narration_draft:
        drafts["narration"] = narration_draft
    dialogue_draft = storage.get_beat_draft(scene_id, beat_num, "dialogue")
    if dialogue_draft:
        drafts["dialogue"] = dialogue_draft
        
    # Run WriterAgent
    writer_agent = WriterAgent()
    beat_setting_draft = scene.setting_draft if (idx == 0 and mode == "opening_with_setting") else ""
    
    beat_text = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: writer_agent.generate_beat(
            context=context,
            beat=event,
            beat_index=idx,
            total_beats=total_beats,
            prev_tail=prev_tail,
            setting_draft=beat_setting_draft,
            drafts=drafts,
            writer_guidelines=writer_guidelines,
            mode=mode,
            token_limit=beat_token_limit,
            dialogue_density=_effective_dialogue_density(event),
        )
    )
    
    # Save final prose sidecar for this beat
    storage.save_beat_draft(scene_id, beat_num, "prose", beat_text)
    
    storage.save_agent_log(AgentLog(
        id=str(uuid.uuid4()),
        scene_id=scene.id,
        beat_number=beat_num,
        agent_name="WriterAgent",
        system_prompt=writer_agent.system_prompt,
        user_prompt=getattr(writer_agent, "last_user_prompt", ""),
        output=beat_text,
    ))
    
    # Attempt to auto-compile scene prose if all beats are done
    compiled_prose = storage.assemble_scene_prose(scene_id)
    if compiled_prose:
        scene.generated_content = compiled_prose
        storage.save_scene(scene)
        
    return {
        "beat_prose": beat_text,
        "scene_compiled": compiled_prose is not None
    }

@router.post("/{scene_id:path}/compile")
def compile_scene_prose(scene_id: str):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    compiled_prose = storage.assemble_scene_prose(scene_id)
    if not compiled_prose:
        raise HTTPException(status_code=400, detail="Some beats are missing generated prose. Please generate all beats first.")
        
    scene.generated_content = compiled_prose
    storage.save_scene(scene)
    return {"status": "success", "content": compiled_prose}

@router.post("/{scene_id:path}/decompose")
def decompose_scene(scene_id: str):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    loaded_styles = _load_styles()
    style_descriptions = {name: data["description"] for name, data in loaded_styles.items()}

    decomposer = DecomposerAgent()
    characters_context = _load_character_context(scene)
    decomposed_events = decomposer.generate(
        scene_description=scene.scene_description,
        style_descriptions=style_descriptions,
        characters_context=characters_context or None,
        dialogue_density=_global_dialogue_density(),
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


@router.post("/{scene_id:path}/beats/generate-all-drafts")
def generate_all_drafts(scene_id: str):
    return EventSourceResponse(generate_all_drafts_generator(scene_id))


@router.post("/{scene_id:path}/beats/merge-all")
def merge_all_beats(scene_id: str):
    return EventSourceResponse(merge_all_beats_generator(scene_id))


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

    scene.scene_events = [beat.model_dump() for beat in payload.beats]
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

    storage.save_ai_editor_log(scene_id, {
        "id": str(uuid.uuid4()),
        "operation": "rewrite",
        "feedback": payload.feedback or "(one-click rewrite)",
        "selected_text_preview": payload.selected_text[:120],
        "output": rewritten_text,
        "timestamp": datetime.utcnow().isoformat()
    })

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
@router.post("/{scene_id:path}/insert_after")
async def insert_after(scene_id: str, request: InsertAfterRequest):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    async def insert_generator():
        agent = RewriteAgent()
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: agent.generate_insert(
                text_before=request.text_before,
                text_after=request.text_after,
                block_type=request.block_type,
                feedback=request.feedback,
            )
        )
        operation = "expand" if not request.feedback.strip() else "insert"
        storage.save_ai_editor_log(scene_id, {
            "id": str(uuid.uuid4()),
            "operation": operation,
            "feedback": request.feedback or "(one-click expand)",
            "block_type": request.block_type,
            "output": result,
            "timestamp": datetime.utcnow().isoformat()
        })
        yield {"data": json.dumps({"generated_text": result, "done": True})}

    return EventSourceResponse(insert_generator())

@router.get("/{scene_id:path}/ai_editor_logs")
def get_ai_editor_logs(scene_id: str):
    return storage.get_ai_editor_logs(scene_id)

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


class SceneAssistRequest(BaseModel):
    message: str
    history: list = []
    current_beat_index: Optional[int] = None
    document_content: Optional[str] = None


@router.post("/{scene_id:path}/assist")
def scene_assist(scene_id: str, payload: SceneAssistRequest):
    scene = storage.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    # Parse act/scene numbers from scene_id (e.g. chapter-1_act-1_scene-3)
    parts = scene_id.split("_")
    act_num = parts[1].replace("act-", "") if len(parts) > 1 else "?"
    scene_num = parts[2].replace("scene-", "") if len(parts) > 2 else "?"

    loader = get_schema()
    schema_dict = loader.get_schema_for_document_type("beat")

    focused_beat_str = (
        f"FOCUSED BEAT: index {payload.current_beat_index} (Beat {payload.current_beat_index + 1}).\n"
        if payload.current_beat_index is not None else ""
    )
    doc_content_str = (
        f"CURRENT BEAT CONTENT (as the user sees it):\n{payload.document_content}\n"
        if payload.document_content else ""
    )

    agent = DocumentEditAgent()
    operation = agent.generate_operation(
        document_type="beat",
        current_data=scene.scene_events or [],
        schema_dict=schema_dict,
        user_message=payload.message,
        history=payload.history,
        context_str=(
            f"You are editing Act {act_num}, Scene {scene_num}.\n"
            f"Scene Setting: {scene.scene_setting}\n"
            f"Scene Description: {scene.scene_description}\n"
            f"Characters: {', '.join(scene.characters or [])}\n"
            f"{focused_beat_str}"
            f"{doc_content_str}"
            f"Note: The focused beat's TipTap markdown shows its current text. The paragraph text is the 'beat' description field. Lines starting with '*' or '-' are the beat's sub-bullets, which correspond to the 'conversation_flow' list field. In your 'conversation_flow' list updates, you must store these as clean strings WITHOUT the '*' or '-' prefix. Do NOT move or copy the existing 'beat' description field content into the 'conversation_flow' list. If the user request is a normal prose addition (without requesting a bullet), append it directly to the 'beat' description field string instead.\n"
            f"CRITICAL RULE: When a beat is FOCUSED (e.g., FOCUSED BEAT: index {payload.current_beat_index}), any instruction to 'add here', 'add to this', 'insert here', or 'edit this' must be interpreted as modifying that focused beat (an UPDATE operation on index [{payload.current_beat_index}], path='scene_events[{payload.current_beat_index}]' or '[{payload.current_beat_index}]'). You can modify the 'beat' description or 'conversation_flow' list fields as appropriate. Do NOT create a new beat unless the user explicitly requests a 'new beat' or to 'add a beat after/before'.\n"
            f"For 'create', use parent_path='scene_events' or leave it empty. "
            f"For 'update'/'delete', use path='[N]' (0-indexed) referencing the beat index directly."
        )
    )

    op_type = operation.get("op")
    if op_type == "clarify":
        return {
            "type": "clarification_needed",
            "question": operation.get("question", "Could you clarify your request?"),
            "options": operation.get("options", [])
        }

    try:
        updated_data = storage.apply_scene_operation(scene_id, operation)
        msg = f"Successfully applied '{op_type}' to scene beat."

        storage.save_ai_editor_log(scene_id, {
            "id": str(uuid.uuid4()),
            "operation": op_type,
            "feedback": payload.message,
            "output": msg,
            "timestamp": datetime.utcnow().isoformat(),
            "isAI": True
        })

        return {
            "type": "applied",
            "message": msg,
            "data": updated_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
