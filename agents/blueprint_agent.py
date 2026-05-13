"""
Blueprint Agent — generates chapter structure from user's narrative description.
"""

import json
import re
import llm
import config
from typing import Dict, List, Optional, Union
from models import ChapterBlueprint, ActBlueprint, SceneBlueprint
from schema_loader import SchemaLoader


class BlueprintAgent:
    """Generates chapter structure from free-form input."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["blueprint"]
        self.token_limit = config.TOKEN_LIMITS["blueprint"]
        self.temperature = config.AGENT_CONFIG["blueprint"]["temperature"]
        self.schema = config.SCHEMA

    def generate(
        self,
        chapter_title: str,
        user_outline: str,
        characters: list[str],
        background: str = "",
        user_answers: str = "",
        writing_focus: str = "",
        writing_style_descriptions: Optional[Dict[str, str]] = None,
    ) -> Union[ChapterBlueprint, List[str]]:
        """Generate chapter blueprint from user input, or return clarifying questions."""
        user_prompt = self._build_prompt(
            chapter_title=chapter_title,
            user_outline=user_outline,
            characters=characters,
            background=background,
            user_answers=user_answers,
            writing_focus=writing_focus,
            writing_style_descriptions=writing_style_descriptions,
        )

        response = self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

        questions = self._extract_questions(response)
        if questions:
            return questions

        return self._parse_response(response)

    def regenerate(
        self,
        current_blueprint: ChapterBlueprint,
        feedback: str,
        characters: list[str],
    ) -> ChapterBlueprint:
        """Regenerate blueprint based on user feedback."""
        user_prompt = f"""Current blueprint:
{json.dumps(current_blueprint.to_dict(), indent=2)}

User feedback: {feedback}

Please revise the blueprint based on this feedback. Output ONLY valid JSON."""

        response = self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature - 0.05,
            max_tokens=self.token_limit,
        )

        blueprint = self._parse_response(response)
        return blueprint

    def regenerate_act(
        self,
        act_blueprint: ActBlueprint,
        characters: list[str],
        feedback: str,
        story_state: dict = None,
    ) -> ActBlueprint:
        """Regenerate a specific act based on user feedback."""
        user_prompt = f"""Current act structure:
{json.dumps(act_blueprint.to_dict(), indent=2)}

User feedback: {feedback}

Please revise only this act's scenes based on the feedback. Output ONLY valid JSON with the same structure."""

        response = self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature - 0.05,
            max_tokens=self.token_limit,
        )

        return self._parse_act_response(response, act_blueprint.act_number)

    def _build_prompt(
        self,
        chapter_title: str,
        user_outline: str,
        characters: list[str],
        background: str,
        user_answers: str = "",
        writing_focus: str = "",
        writing_style_descriptions: Optional[Dict[str, str]] = None,
    ) -> str:
        char_line = ", ".join(characters) if characters else "(infer from chapter description)"
        parts = [
            f"Chapter Title: {chapter_title}",
            f"Characters: {char_line}",
        ]
        if background:
            parts.append(f"Background: {background}")
        parts.append(f"\nUser's Chapter Description:\n{user_outline}")
        if user_answers:
            parts.append(f"\nAdditional context from user:\n{user_answers}")
        if writing_style_descriptions:
            parts.append("\n# Available Styles\n")
            parts.append("Use these style tags when annotating scene_events.\n")
            for name in sorted(writing_style_descriptions):
                desc = writing_style_descriptions[name]
                parts.append(f"- **{name}** — {desc}")
        parts.append("\nGenerate the chapter structure (acts and scenes) based on this description.")
        return "\n".join(parts)

    def _parse_response(self, response: str) -> ChapterBlueprint:
        normalized = self.schema.parse_blueprint_response(response)

        chapter_title = normalized.get("chapter_title", "Untitled Chapter")
        acts = []

        for act_data in normalized.get("acts", []):
            act = self._parse_act_data(act_data)
            if act:
                acts.append(act)

        return ChapterBlueprint(chapter_title=chapter_title, acts=acts)

    def _parse_act_data(self, act_data: dict) -> ActBlueprint:
        scenes = []
        for scene_data in act_data.get("scenes", []):
            scene = SceneBlueprint.from_dict(scene_data)
            scenes.append(scene)

        if not scenes:
            return None

        return ActBlueprint(
            act_number=act_data.get("act_number", 1),
            act_theme=act_data.get("act_theme", ""),
            scenes=scenes,
            act_transition_hint=act_data.get("act_transition_hint", ""),
        )

    def _parse_act_response(self, response: str, act_number: int) -> ActBlueprint:
        normalized = self.schema.parse_blueprint_response(response)

        for act_data in normalized.get("acts", []):
            act_data["act_number"] = act_number
            act = self._parse_act_data(act_data)
            if act:
                return act

        return ActBlueprint(act_number=act_number, act_theme="", scenes=[])

    def _extract_questions(self, response: str) -> Optional[List[str]]:
        """If the LLM returned clarifying questions instead of JSON, extract them."""
        stripped = response.strip()
        if not stripped:
            return None
        try:
            json.loads(stripped)
            return None
        except (json.JSONDecodeError, ValueError):
            pass
        lines = stripped.strip().split("\n")
        questions = []
        for line in lines:
            line = line.strip()
            line = re.sub(r"^(?:\d+[\.\)]\s*|[-*]\s*)", "", line).strip()
            if line and "?" in line:
                questions.append(line)
        return questions if questions else None

    def structural_check(
        self, blueprint: ChapterBlueprint, characters: list[str]
    ) -> List[str]:
        """Run objective structural checks on the blueprint."""
        warnings = []
        total_scenes = sum(len(act.scenes) for act in blueprint.acts)
        if total_scenes == 0:
            warnings.append("Blueprint has no scenes.")
        for char in characters:
            found = False
            for act in blueprint.acts:
                for scene in act.scenes:
                    if scene.characters and char.lower() in [c.lower() for c in scene.characters]:
                        found = True
                        break
                if found:
                    break
            if not found:
                warnings.append(f"Character '{char}' does not appear in any scene.")
        for act in blueprint.acts:
            if len(act.scenes) == 0:
                warnings.append(f"Act {act.act_number} has no scenes.")
        return warnings

    def print_blueprint(self, blueprint: ChapterBlueprint) -> None:
        """Pretty print a blueprint for user approval."""
        print(f"\n{'='*60}")
        print(f"CHAPTER: {blueprint.chapter_title}")
        print(f"{'='*60}")

        for act in blueprint.acts:
            print(f"\n{'─'*40}")
            print(f"ACT {act.act_number}: {act.act_theme}")
            if act.act_transition_hint:
                print(f"  Transition: {act.act_transition_hint}")
            print(f"{'─'*40}")
            for scene in act.scenes:
                print(f"  Scene {scene.scene_number}: {scene.scene_description}")
                print(f"    Setting: {scene.scene_setting}")
                chars = scene.characters if scene.characters else "All"
                print(f"    Characters: {', '.join(chars)}")
                extra = scene.extra
                if extra:
                    for key, value in extra.items():
                        print(f"    {key}: {value}")
        print(f"\n{'='*60}")

    def print_scene_walkthrough(self, blueprint: ChapterBlueprint) -> str:
        """Build a detailed scene walkthrough string for the user."""
        lines = [
            f"\n{'='*60}",
            f"SCENE WALKTHROUGH — {blueprint.chapter_title}",
            f"{'='*60}",
        ]

        for act in blueprint.acts:
            lines.append(f"\n{'─'*60}")
            lines.append(f"ACT {act.act_number}: {act.act_theme}")
            lines.append(f"{'─'*60}")

            for scene in act.scenes:
                chars = scene.characters if scene.characters else "All characters"
                chars_str = ', '.join(chars) if isinstance(chars, list) else str(chars)

                lines.append(f"\n  Scene {scene.scene_number}: {scene.scene_description}")
                lines.append(f"    Setting: {scene.scene_setting}")
                lines.append(f"    Characters: {chars_str}")

                extra = scene.extra
                if extra:
                    for key, value in extra.items():
                        lines.append(f"    {key}: {value}")

            if act.act_transition_hint:
                lines.append(f"\n  Act transition: {act.act_transition_hint}")

            extra = act.extra
            if extra:
                for key, value in extra.items():
                    lines.append(f"  {key}: {value}")

        lines.append(f"\n{'='*60}")
        return "\n".join(lines)