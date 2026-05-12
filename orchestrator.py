"""
Story Orchestrator — coordinates all agents to generate chapters.
"""

import uuid
from typing import Optional, Dict, List, Callable, Tuple
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
from agents.transition_agent import TransitionAgent
from agents.writer_agent import WriterAgent


class StoryOrchestrator:
    """Coordinates all agents for story generation."""

    def __init__(self, state_manager=None):
        self.blueprint_agent = BlueprintAgent()
        self.scene_agent = SceneAgent()
        self.dialogue_agent = DialogueAgent()
        self.transition_agent = TransitionAgent()
        self.writer_agent = WriterAgent()
        self.state_manager = state_manager

    def generate_act(
        self,
        blueprint: ChapterBlueprint,
        act_index: int,
        characters: list[str],
        story_state: Optional[Dict] = None,
    ) -> Act:
        """Generate a single act from blueprint."""
        if act_index >= len(blueprint.acts):
            raise ValueError(f"Act index {act_index} out of range")

        act_blueprint = blueprint.acts[act_index]
        return self._generate_act(act_blueprint, characters, [], story_state)

    def regenerate_act_with_feedback(
        self,
        blueprint: ChapterBlueprint,
        act_index: int,
        characters: list[str],
        feedback: str,
        story_state: Optional[Dict] = None,
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
            return self._generate_act(revised_act_blueprint, characters, [], story_state)

        return self._generate_act(act_blueprint, characters, [], story_state)

    def _generate_act(
        self,
        act_blueprint: ActBlueprint,
        characters: list[str],
        previous_acts: list[Act],
        story_state: Optional[Dict] = None,
        prev_act_blueprint: Optional[ActBlueprint] = None,
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
    ) -> Tuple[Scene, dict]:
        char_profiles = {}
        char_states = {}

        if self.state_manager:
            chars_in_scene = scene_blueprint.characters or characters
            char_context = self.state_manager.get_character_context(
                chars_in_scene, story_state
            )
            for name, ctx in char_context.items():
                char_profiles[name] = ctx["profile"]
                char_states[name] = ctx["current_state"]

        prior = [
            f"{s.scene_description}{' [' + s.creative_element + ']' if s.creative_element and s.creative_element.strip() and s.creative_element != 'N/A' else ''}"
            for s in act_blueprint.scenes[:scene_index]
        ]
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
            creative_element=scene_blueprint.creative_element,
            prior_scenes_context=prior,
            character_profiles=char_profiles,
            character_states=char_states,
            scene_description=scene_blueprint.scene_description or "",
            extra=scene_blueprint.extra,
        )

        print("  Generating setting...")
        setting_input = self.scene_agent._build_prompt(scene_context)
        setting_draft = self.scene_agent.generate(scene_context)

        print("  Generating dialogue...")
        dialogue_input = self.dialogue_agent._build_prompt(scene_context)
        dialogue_draft = self.dialogue_agent.generate(scene_context)

        print("  Writing final scene...")
        writer_input = self.writer_agent._build_prompt(
            scene_context, setting_draft, dialogue_draft
        )
        full_content = self.writer_agent.generate(
            scene_context,
            setting_draft=setting_draft,
            dialogue_draft=dialogue_draft,
        )

        agent_logs = {
            "scene_context": {
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
                "creative_element": scene_context.creative_element,
                "prior_scenes_context": scene_context.prior_scenes_context,
                "character_profiles": scene_context.character_profiles,
                "character_states": scene_context.character_states,
                "scene_description": scene_context.scene_description,
                "extra": scene_context.extra,
            },
            "scene_agent": {"system_prompt": self.scene_agent.system_prompt, "input": setting_input, "output": setting_draft},
            "dialogue_agent": {"system_prompt": self.dialogue_agent.system_prompt, "input": dialogue_input, "output": dialogue_draft},
            "writer_agent": {"system_prompt": self.writer_agent.system_prompt, "input": writer_input, "output": full_content},
        }

        scene = Scene(
            id=str(uuid.uuid4()),
            act_number=act_number,
            scene_number=scene_blueprint.scene_number,
            setting=setting_draft,
            dialogue=dialogue_draft,
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
    ) -> Tuple[Scene, dict]:
        char_profiles = {}
        char_states = {}

        if self.state_manager:
            chars_in_scene = scene_blueprint.characters or characters
            char_context = self.state_manager.get_character_context(
                chars_in_scene, story_state
            )
            for name, ctx in char_context.items():
                char_profiles[name] = ctx["profile"]
                char_states[name] = ctx["current_state"]

        prior = [
            f"{s.scene_description}{' [' + s.creative_element + ']' if s.creative_element and s.creative_element.strip() and s.creative_element != 'N/A' else ''}"
            for s in act_blueprint.scenes[:scene_index]
        ]
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
            creative_element=scene_blueprint.creative_element,
            prior_scenes_context=prior,
            character_profiles=char_profiles,
            character_states=char_states,
            scene_description=scene_blueprint.scene_description or "",
            extra=scene_blueprint.extra,
        )

        if not setting_draft:
            print("  Regenerating setting...")
            setting_input = self.scene_agent._build_prompt(scene_context)
            setting_draft = self.scene_agent.generate(scene_context)
        else:
            setting_input = "(reused from previous)"

        if not dialogue_draft:
            print("  Regenerating dialogue...")
            dialogue_input = self.dialogue_agent._build_prompt(scene_context)
            dialogue_draft = self.dialogue_agent.generate(scene_context)
        else:
            dialogue_input = "(reused from previous)"

        print("  Regenerating final scene with feedback...")
        writer_input = self.writer_agent._build_prompt(
            scene_context, setting_draft, dialogue_draft
        )
        writer_input += f"\n\n---\n\nUSER FEEDBACK:\n{feedback}\n\nPlease rewrite the scene incorporating this feedback while keeping the same arc and context."
        full_content = self.writer_agent.regenerate_with_feedback(
            scene_context,
            feedback=feedback,
            setting_draft=setting_draft,
            dialogue_draft=dialogue_draft,
        )

        agent_logs = {
            "scene_context": {
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
                "creative_element": scene_context.creative_element,
                "prior_scenes_context": scene_context.prior_scenes_context,
                "character_profiles": scene_context.character_profiles,
                "character_states": scene_context.character_states,
                "scene_description": scene_context.scene_description,
                "extra": scene_context.extra,
            },
            "scene_agent": {"system_prompt": self.scene_agent.system_prompt, "input": setting_input, "output": setting_draft},
            "dialogue_agent": {"system_prompt": self.dialogue_agent.system_prompt, "input": dialogue_input, "output": dialogue_draft},
            "writer_agent": {"system_prompt": self.writer_agent.system_prompt, "input": writer_input, "output": full_content},
        }

        scene = Scene(
            id=str(uuid.uuid4()),
            act_number=act_number,
            scene_number=scene_blueprint.scene_number,
            setting=setting_draft,
            dialogue=dialogue_draft,
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
            if last.creative_element and last.creative_element.strip() and last.creative_element != "N/A":
                bridge += f" [{last.creative_element}]"
            return bridge
        return None