"""
Story Orchestrator — coordinates all agents to generate chapters.
"""

import uuid
import re
import config
from typing import Optional, Dict, List, Callable, Tuple, Any
from models import (
    StoryContext,
    Scene,
    Act,
    Chapter,
    ChapterBlueprint,
    ActBlueprint,
    SceneBlueprint,
)
from agents.blueprint_agent import BlueprintAgent
from agents.scene_agent import SceneAgent
from agents.dialogue_agent import DialogueAgent
from agents.narration_agent import NarrationAgent
from agents.transition_agent import TransitionAgent
from agents.writer_agent import WriterAgent


def _extract_tail(text: str, n_sentences: int = 2) -> str:
    """Extract the last ~n sentences from text for compiler context."""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    return ' '.join(sentences[-n_sentences:]) if len(sentences) >= n_sentences else text


def _normalize_events(events: list) -> list:
    """Normalize scene_events to list of dicts with 'beat' and 'style' keys."""
    if not events:
        return []
    if isinstance(events[0], str):
        return [{"beat": e, "style": "general"} for e in events]
    return events


class StoryOrchestrator:
    """Coordinates all agents for story generation."""

    def __init__(self, state_manager=None):
        self.blueprint_agent = BlueprintAgent()
        self.scene_agent = SceneAgent()
        self.dialogue_agent = DialogueAgent()
        self.narration_agent = NarrationAgent()
        self.transition_agent = TransitionAgent()
        self.writer_agent = WriterAgent()
        self.state_manager = state_manager

    def generate_act(
        self,
        blueprint: ChapterBlueprint,
        act_index: int,
        characters: list[str],
        story_state: Optional[Dict] = None,
        writing_style: Optional[Dict[str, str]] = None,
    ) -> Act:
        """Generate a single act from blueprint."""
        if act_index >= len(blueprint.acts):
            raise ValueError(f"Act index {act_index} out of range")

        act_blueprint = blueprint.acts[act_index]
        return self._generate_act(act_blueprint, characters, [], story_state, writing_style=writing_style)

    def regenerate_act_with_feedback(
        self,
        blueprint: ChapterBlueprint,
        act_index: int,
        characters: list[str],
        feedback: str,
        story_state: Optional[Dict] = None,
        writing_style: Optional[Dict[str, str]] = None,
    ) -> Act:
        """Regenerate a specific act with user feedback."""
        if act_index >= len(blueprint.acts):
            raise ValueError(f"Act index {act_index} out of range")

        act_blueprint = blueprint.acts[act_index]

        revised_act_blueprint = self.blueprint_agent.regenerate_act(
            act_blueprint, characters, feedback, story_state
        )

        if revised_act_blueprint and revised_act_blueprint.scenes:
            blueprint.acts[act_index] = revised_act_blueprint
            return self._generate_act(revised_act_blueprint, characters, [], story_state, writing_style=writing_style)

        return self._generate_act(act_blueprint, characters, [], story_state, writing_style=writing_style)

    def _generate_act(
        self,
        act_blueprint: ActBlueprint,
        characters: list[str],
        previous_acts: list[Act],
        story_state: Optional[Dict] = None,
        prev_act_blueprint: Optional[ActBlueprint] = None,
        writing_style: Optional[Dict[str, str]] = None,
    ) -> Act:
        act = Act(id=str(uuid.uuid4()), act_number=act_blueprint.act_number)
        prev_act_bridge = self._build_act_bridge(prev_act_blueprint)

        for scene_index, scene_blueprint in enumerate(act_blueprint.scenes):
            scene, _ = self.generate_scene_with_writing(
                scene_blueprint=scene_blueprint,
                act_number=act_blueprint.act_number,
                scene_index=scene_index,
                characters=characters,
                act_blueprint=act_blueprint,
                prev_act_bridge=prev_act_bridge,
                story_state=story_state,
                writing_style=writing_style,
            )
            act.scenes.append(scene)

        if len(act.scenes) > 1:
            act.act_transition = self.transition_agent.generate_act_transition(
                current_act_summary=act_blueprint.act_transition_hint if act_blueprint.act_transition_hint else (
                    act.scenes[-1].full_content[:200] if act.scenes[-1].full_content else ""
                ),
                next_act_arc="continuation",
                is_cliffhanger=True,
            )

        return act

    def generate_scene_with_writing(
        self,
        scene_blueprint: SceneBlueprint,
        act_number: int,
        scene_index: int,
        characters: list[str],
        act_blueprint: ActBlueprint,
        prev_act_bridge: Optional[str] = None,
        genre: str = "",
        tone_guidelines: str = "",
        writing_focus: str = "",
        chapter_background: str = "",
        story_state: Optional[Dict] = None,
        writing_style: Optional[Dict[str, str]] = None,
        loaded_styles: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Scene, dict]:
        agent_logs = {"per_beat": []}

        # -- Shared context --
        char_profiles = {}
        char_states = {}
        if self.state_manager:
            chars_in_scene = scene_blueprint.characters or characters
            char_context = self.state_manager.get_character_context(chars_in_scene, story_state)
            for name, ctx in char_context.items():
                char_profiles[name] = ctx["profile"]
                char_states[name] = ctx["current_state"]

        prior = [s.scene_description for s in act_blueprint.scenes[:scene_index]]
        if scene_index == 0 and prev_act_bridge:
            prior = [prev_act_bridge] + prior

        scene_context = StoryContext(
            chapter_title="",
            act_number=act_number,
            scene_number=scene_blueprint.scene_number,
            background=scene_blueprint.scene_setting,
            chapter_background=chapter_background,
            characters=scene_blueprint.characters or characters,
            setting=scene_blueprint.scene_setting,
            genre=genre,
            tone_guidelines=tone_guidelines,
            writing_focus=writing_focus,
            prior_scenes_context=prior,
            character_profiles=char_profiles,
            character_states=char_states,
            scene_description=scene_blueprint.scene_description or "",
            extra=scene_blueprint.extra,
        )

        # -- Scene Agent (setting) --
        print("  Generating setting...")
        setting_input = self.scene_agent._build_prompt(scene_context)
        setting_draft = self.scene_agent.generate(scene_context)
        agent_logs["scene_context"] = {
            "chapter_title": scene_context.chapter_title,
            "act_number": scene_context.act_number,
            "scene_number": scene_context.scene_number,
            "background": scene_context.background,
            "chapter_background": scene_context.chapter_background,
            "characters": scene_context.characters,
            "setting": scene_context.setting,
            "genre": scene_context.genre,
            "tone_guidelines": scene_context.tone_guidelines,
            "writing_focus": scene_context.writing_focus,
            "prior_scenes_context": scene_context.prior_scenes_context,
            "character_profiles": scene_context.character_profiles,
            "character_states": scene_context.character_states,
            "scene_description": scene_context.scene_description,
            "extra": scene_context.extra,
        }
        agent_logs["scene_agent"] = {
            "system_prompt": self.scene_agent.system_prompt,
            "input": setting_input,
            "output": setting_draft,
        }

        # -- Parse events --
        events = _normalize_events(scene_blueprint.extra.get("scene_events", []))
        if not events:
            events = [{"beat": scene_blueprint.scene_description, "style": "general"}]
        agent_logs["decomposer_events"] = events

        # -- Determine opening mode (with or without setting) --
        is_new_location = True
        if scene_index > 0:
            prev_scene_setting = act_blueprint.scenes[scene_index - 1].scene_setting
            if scene_blueprint.scene_setting == prev_scene_setting:
                is_new_location = False

        # -- Per-beat generation --
        beat_outputs = []
        prev_tail = setting_draft
        narration_per_beat_logs = []
        dialogue_per_beat_logs = []
        writer_per_beat_logs = []

        for i, event in enumerate(events):
            beat_style = event.get("style", "general") if isinstance(event, dict) else "general"
            style_data = (loaded_styles or {}).get(beat_style, {})
            agent_sections = style_data.get("agent_sections", {})
            writer_guidelines = agent_sections.get("writer", "")
            beat_token_limit = None if config.DISABLE_TOKEN_LIMITS else style_data.get("output_size")

            if i == 0:
                mode = "opening_with_setting" if is_new_location else "opening_without_setting"
            elif i == len(events) - 1:
                mode = "closing"
            else:
                mode = "continuation"

            beat_desc = event.get("beat", str(event)) if isinstance(event, dict) else str(event)
            print(f"  Beat {i+1}/{len(events)} ({beat_style}, {mode})...")

            # Run sub-agents sequentially based on style's ## sections
            drafts = {}
            
            # 1. Run Narration Agent first if specified
            narration_draft = ""
            if "narration" in agent_sections:
                guidelines = agent_sections["narration"]
                n_input = self.narration_agent._build_prompt(
                    scene_context, beat_desc, guidelines
                )
                narration_draft = self.narration_agent.generate(
                    scene_context, beat_desc, guidelines
                )
                drafts["narration"] = narration_draft
                narration_per_beat_logs.append({
                    "beat": i, "style": beat_style,
                    "input": n_input, "output": narration_draft,
                })
                print(f"    narration draft ({len(narration_draft)} chars)")

            # 2. Run Dialogue Agent second, passing the narration draft if both exist
            if "dialogue" in agent_sections:
                guidelines = agent_sections["dialogue"]
                d_input = self.dialogue_agent._build_prompt(
                    scene_context, event, guidelines, narration_draft=narration_draft
                )
                draft = self.dialogue_agent.generate(
                    scene_context, event, guidelines, narration_draft=narration_draft
                )
                drafts["dialogue"] = draft
                dialogue_per_beat_logs.append({
                    "beat": i, "style": beat_style,
                    "input": d_input, "output": draft,
                })
                print(f"    dialogue draft ({len(draft)} chars)")

            # Writer merges all drafts
            beat_text = self.writer_agent.generate_beat(
                context=scene_context,
                beat=event,
                beat_index=i,
                total_beats=len(events),
                prev_tail=prev_tail,
                setting_draft=setting_draft if (i == 0 and mode == "opening_with_setting") else "",
                drafts=drafts,
                writer_guidelines=writer_guidelines,
                mode=mode,
                token_limit=beat_token_limit,
            )
            beat_outputs.append(beat_text)
            writer_per_beat_logs.append({
                "beat": i, "mode": mode, "style": beat_style,
                "drafts": drafts,
                "output": beat_text,
                "system_prompt": self.writer_agent.system_prompt,
                "user_prompt": getattr(self.writer_agent, "last_user_prompt", ""),
                "token_limit": getattr(self.writer_agent, "last_token_limit", 0),
            })

            prev_tail = _extract_tail(beat_text, 2)

        # -- Assemble beat outputs --
        full_content = '\n\n'.join(beat_outputs) if beat_outputs else ""

        agent_logs["narration_agent"] = {
            "system_prompt": self.narration_agent.system_prompt,
            "per_beat": narration_per_beat_logs,
        }
        agent_logs["dialogue_agent"] = {
            "system_prompt": self.dialogue_agent.system_prompt,
            "per_beat": dialogue_per_beat_logs,
        }
        agent_logs["writer_agent"] = {
            "per_beat": writer_per_beat_logs,
        }

        scene = Scene(
            id=str(uuid.uuid4()),
            act_number=act_number,
            scene_number=scene_blueprint.scene_number,
            setting=setting_draft,
            dialogue="",
            characters_present=scene_blueprint.characters or characters,
            full_content=full_content,
        )

        return scene, agent_logs

    def regenerate_scene_with_feedback(
        self,
        scene_blueprint: SceneBlueprint,
        act_number: int,
        scene_index: int,
        characters: list[str],
        act_blueprint: ActBlueprint,
        prev_act_bridge: Optional[str] = None,
        genre: str = "",
        tone_guidelines: str = "",
        writing_focus: str = "",
        chapter_background: str = "",
        feedback: str = "",
        story_state: Optional[Dict] = None,
        setting_draft: str = None,
        dialogue_draft: str = None,
        writing_style: Optional[Dict[str, str]] = None,
        loaded_styles: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Scene, dict]:
        agent_logs = {"per_beat": []}

        # -- Shared context --
        char_profiles = {}
        char_states = {}
        if self.state_manager:
            chars_in_scene = scene_blueprint.characters or characters
            char_context = self.state_manager.get_character_context(chars_in_scene, story_state)
            for name, ctx in char_context.items():
                char_profiles[name] = ctx["profile"]
                char_states[name] = ctx["current_state"]

        prior = [s.scene_description for s in act_blueprint.scenes[:scene_index]]
        if scene_index == 0 and prev_act_bridge:
            prior = [prev_act_bridge] + prior

        scene_context = StoryContext(
            chapter_title="",
            act_number=act_number,
            scene_number=scene_blueprint.scene_number,
            background=scene_blueprint.scene_setting,
            chapter_background=chapter_background,
            characters=scene_blueprint.characters or characters,
            setting=scene_blueprint.scene_setting,
            genre=genre,
            tone_guidelines=tone_guidelines,
            writing_focus=writing_focus,
            prior_scenes_context=prior,
            character_profiles=char_profiles,
            character_states=char_states,
            scene_description=scene_blueprint.scene_description or "",
            extra=scene_blueprint.extra,
        )

        # -- Scene Agent (reuse or regenerate) --
        if not setting_draft:
            print("  Regenerating setting...")
            setting_input = self.scene_agent._build_prompt(scene_context)
            setting_draft = self.scene_agent.generate(scene_context)
        else:
            setting_input = "(reused from previous)"

        agent_logs["scene_context"] = {
            "chapter_title": scene_context.chapter_title,
            "act_number": scene_context.act_number,
            "scene_number": scene_context.scene_number,
            "background": scene_context.background,
            "chapter_background": scene_context.chapter_background,
            "characters": scene_context.characters,
            "setting": scene_context.setting,
            "genre": scene_context.genre,
            "tone_guidelines": scene_context.tone_guidelines,
            "writing_focus": scene_context.writing_focus,
            "prior_scenes_context": scene_context.prior_scenes_context,
            "character_profiles": scene_context.character_profiles,
            "character_states": scene_context.character_states,
            "scene_description": scene_context.scene_description,
            "extra": scene_context.extra,
        }
        agent_logs["scene_agent"] = {
            "system_prompt": self.scene_agent.system_prompt,
            "input": setting_input,
            "output": setting_draft,
        }

        # -- Parse events --
        events = _normalize_events(scene_blueprint.extra.get("scene_events", []))
        if not events:
            events = [{"beat": scene_blueprint.scene_description, "style": "general"}]
        agent_logs["decomposer_events"] = events

        # -- Determine opening mode (with or without setting) --
        is_new_location = True
        if scene_index > 0:
            prev_scene_setting = act_blueprint.scenes[scene_index - 1].scene_setting
            if scene_blueprint.scene_setting == prev_scene_setting:
                is_new_location = False

        # -- Per-beat generation with feedback --
        beat_outputs = []
        prev_tail = setting_draft
        narration_per_beat_logs = []
        dialogue_per_beat_logs = []
        writer_per_beat_logs = []

        for i, event in enumerate(events):
            beat_style = event.get("style", "general") if isinstance(event, dict) else "general"
            style_data = (loaded_styles or {}).get(beat_style, {})
            agent_sections = style_data.get("agent_sections", {})
            writer_guidelines = agent_sections.get("writer", "")
            beat_token_limit = None if config.DISABLE_TOKEN_LIMITS else style_data.get("output_size")

            if i == 0:
                mode = "opening_with_setting" if is_new_location else "opening_without_setting"
            elif i == len(events) - 1:
                mode = "closing"
            else:
                mode = "continuation"

            beat_desc = event.get("beat", str(event)) if isinstance(event, dict) else str(event)
            print(f"  Beat {i+1}/{len(events)} ({beat_style}, {mode})...")

            # Run sub-agents sequentially based on style's ## sections
            drafts = {}
            
            # 1. Run Narration Agent first if specified
            narration_draft = ""
            if "narration" in agent_sections:
                guidelines = agent_sections["narration"]
                n_input = self.narration_agent._build_prompt(
                    scene_context, beat_desc, guidelines
                )
                narration_draft = self.narration_agent.generate(
                    scene_context, beat_desc, guidelines
                )
                drafts["narration"] = narration_draft
                narration_per_beat_logs.append({
                    "beat": i, "style": beat_style,
                    "input": n_input, "output": narration_draft,
                })
                print(f"    narration draft ({len(narration_draft)} chars)")

            # 2. Run Dialogue Agent second, passing the narration draft if both exist
            if "dialogue" in agent_sections:
                guidelines = agent_sections["dialogue"]
                d_input = self.dialogue_agent._build_prompt(
                    scene_context, event, guidelines, narration_draft=narration_draft
                )
                draft = self.dialogue_agent.generate(
                    scene_context, event, guidelines, narration_draft=narration_draft
                )
                drafts["dialogue"] = draft
                dialogue_per_beat_logs.append({
                    "beat": i, "style": beat_style,
                    "input": d_input, "output": draft,
                })
                print(f"    dialogue draft ({len(draft)} chars)")

            beat_text = self.writer_agent.generate_beat(
                context=scene_context,
                beat=event,
                beat_index=i,
                total_beats=len(events),
                prev_tail=prev_tail,
                setting_draft=setting_draft if (i == 0 and mode == "opening_with_setting") else "",
                drafts=drafts,
                writer_guidelines=writer_guidelines,
                mode=mode,
                feedback=feedback,
                token_limit=beat_token_limit,
            )
            beat_outputs.append(beat_text)
            writer_per_beat_logs.append({
                "beat": i, "mode": mode, "style": beat_style,
                "drafts": drafts,
                "output": beat_text,
                "system_prompt": self.writer_agent.system_prompt,
                "user_prompt": getattr(self.writer_agent, "last_user_prompt", ""),
                "token_limit": getattr(self.writer_agent, "last_token_limit", 0),
            })

            prev_tail = _extract_tail(beat_text, 2)

        # -- Assemble beat outputs --
        full_content = '\n\n'.join(beat_outputs) if beat_outputs else ""

        agent_logs["narration_agent"] = {
            "system_prompt": self.narration_agent.system_prompt,
            "per_beat": narration_per_beat_logs,
        }
        agent_logs["dialogue_agent"] = {
            "system_prompt": self.dialogue_agent.system_prompt,
            "per_beat": dialogue_per_beat_logs,
        }
        agent_logs["writer_agent"] = {
            "per_beat": writer_per_beat_logs,
        }

        scene = Scene(
            id=str(uuid.uuid4()),
            act_number=act_number,
            scene_number=scene_blueprint.scene_number,
            setting=setting_draft,
            dialogue="",
            characters_present=scene_blueprint.characters or characters,
            full_content=full_content,

        )

        return scene, agent_logs

    def build_scene_walkthrough(self, blueprint: ChapterBlueprint) -> str:
        """Build a detailed scene walkthrough for user overview."""
        return self.blueprint_agent.print_scene_walkthrough(blueprint)

    def print_act(self, act: Act) -> None:
        """Pretty print a generated act."""
        print(f"\n{'='*60}")
        print(f"ACT {act.act_number}")
        print(f"{'='*60}")

        for scene in act.scenes:
            print(f"\n[Scene {scene.scene_number}]")
            print(f"Setting: {scene.setting[:80] if scene.setting else 'N/A'}...")
            print("-" * 40)
            print(scene.full_content)
            print()

        if act.act_transition:
            print(f"\nAct Transition: {act.act_transition}")

        print(f"\n{'─'*60}")

    def _build_act_bridge(self, prev_act_blueprint: Optional[ActBlueprint]) -> Optional[str]:
        if prev_act_blueprint and prev_act_blueprint.scenes:
            last = prev_act_blueprint.scenes[-1]
            bridge = last.scene_description
            return bridge
        return None
