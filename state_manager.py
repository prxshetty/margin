"""
State Manager — handles character profiles, story state, and updates after approved acts.
"""

import yaml
import re
from pathlib import Path
from typing import Dict, List, Optional, Any


class StateManager:
    """Manages character profiles, story state, and updates."""

    def __init__(
        self,
        characters_dir: str = "inputs/characters",
        story_state_path: str = "inputs/story_state.yaml",
    ):
        self.characters_dir = Path(characters_dir)
        self.story_state_path = Path(story_state_path)

    def get_character_context(
        self,
        character_names: List[str],
        story_state: Optional[Dict] = None,
    ) -> Dict[str, Dict]:
        """Load character profiles and current states for specified characters."""
        context = {}

        for name in character_names:
            profile = self.get_character_profile(name)
            if profile:
                state = self.get_character_state(name, story_state)
                context[name] = {
                    "profile": profile,
                    "current_state": state or "",
                }

        return context

    def get_character_profile(self, character_name: str) -> Optional[Dict]:
        """Read a single character YAML file."""
        yaml_path = self.characters_dir / f"{character_name.lower()}.yaml"
        if yaml_path.exists():
            with open(yaml_path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f)

        for fpath in self.characters_dir.glob("*.yaml"):
            if fpath.stem == "character_template":
                continue
            stem = fpath.stem.lower()
            if character_name.lower().startswith(stem) or stem.startswith(character_name.lower()):
                with open(fpath, "r", encoding="utf-8") as f:
                    return yaml.safe_load(f)

        return None

        with open(yaml_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)

    def get_character_state(
        self,
        character_name: str,
        story_state: Optional[Dict] = None,
    ) -> str:
        """Get current state for a character from story_state.yaml."""
        if story_state is None:
            story_state = self.read_story_state()

        characters = story_state.get("characters") or {}
        char_data = characters.get(character_name.lower()) or {}
        return char_data.get("current_state") or self._get_default_state_from_profile(character_name)

    def _get_default_state_from_profile(self, character_name: str) -> str:
        """Get current_state from character profile if story_state doesn't have it."""
        profile = self.get_character_profile(character_name)
        if profile:
            return profile.get("current_state") or ""
        return ""

    def read_story_state(self) -> Dict:
        """Read the story_state.yaml file."""
        if not self.story_state_path.exists():
            return {"characters": {}}

        try:
            with open(self.story_state_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError:
            return {"characters": {}}

        if data is None or data.get("characters") is None:
            return {"characters": {}}

        return data

    def write_story_state(self, state: Dict) -> None:
        """Write the story_state.yaml file safely."""
        clean_state = self._sanitize_state(state)

        with open(self.story_state_path, "w", encoding="utf-8") as f:
            yaml.dump(clean_state, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    def _sanitize_state(self, state: Dict) -> Dict:
        """Remove None/empty values and ensure clean YAML."""
        result = {"characters": {}}
        characters = state.get("characters") or {}

        for name, char_data in characters.items():
            if char_data is None:
                result["characters"][name] = {"current_state": ""}
            elif isinstance(char_data, dict):
                result["characters"][name] = {
                    "current_state": str(char_data.get("current_state") or "")
                }
            else:
                result["characters"][name] = {"current_state": ""}

        return result

    def initialize_story_state(self, character_names: List[str]) -> None:
        """Initialize story_state.yaml from character profiles."""
        state = {"characters": {}}

        for name in character_names:
            profile = self.get_character_profile(name)
            if profile:
                state["characters"][name.lower()] = {
                    "current_state": profile.get("current_state") or ""
                }

        self.write_story_state(state)

    def update_after_act_approval(
        self,
        act_number: int,
        scenes: List[Any],
        generated_content: str,
        characters_in_act: List[str],
    ) -> None:
        """Update character states and story_state.yaml after an approved act."""
        character_summaries = self._summarize_character_changes(
            generated_content, characters_in_act
        )

        story_state = self.read_story_state()

        for name, summary in character_summaries.items():
            if not summary:
                continue

            char_lower = name.lower()
            if char_lower not in story_state["characters"]:
                story_state["characters"][char_lower] = {}

            current = story_state["characters"][char_lower].get("current_state") or ""
            if current:
                story_state["characters"][char_lower]["current_state"] = f"{current}; {summary}"
            else:
                story_state["characters"][char_lower]["current_state"] = summary

        self.write_story_state(story_state)

    def _summarize_character_changes(
        self,
        generated_content: str,
        characters: List[str],
    ) -> Dict[str, str]:
        """Extract what happened to each character from the generated content."""
        summaries = {}

        for char in characters:
            char_lower = char.lower()
            sentences = generated_content.split(".")
            char_sentences = [s.strip() for s in sentences if char_lower in s.lower()]

            if char_sentences:
                last_mention = char_sentences[-1][:200]
                clean_summary = "".join(c for c in last_mention if c.isprintable()).strip()
                if clean_summary:
                    summaries[char] = clean_summary

        return summaries

    def append_to_results(
        self,
        chapter_title: str,
        act_number: int,
        act_content: str,
        results_dir: str = "outputs/results",
    ) -> Path:
        """Append generated act content to a chapter results file."""
        results_path = Path(results_dir)
        results_path.mkdir(parents=True, exist_ok=True)

        safe_title = re.sub(r"[^a-z0-9_]", "_", chapter_title.lower())
        safe_title = re.sub(r"_+", "_", safe_title).strip("_")

        results_file = results_path / f"{safe_title}.md"

        with open(results_file, "a", encoding="utf-8") as f:
            f.write(f"\n\n---\n\n")
            f.write(f"## Act {act_number}\n\n")
            f.write(act_content)

        return results_file


def find_latest_chapter(chapters_dir: str = "inputs/chapters") -> Optional[Path]:
    """Find the most recently modified chapter markdown file."""
    chapters_path = Path(chapters_dir)
    if not chapters_path.exists():
        return None

    md_files = list(chapters_path.glob("*.md"))
    if not md_files:
        return None

    return max(md_files, key=lambda f: f.stat().st_mtime)


def parse_chapter_file(file_path: Path) -> Dict[str, Any]:
    """Parse a chapter markdown file."""
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    title_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else "Untitled Chapter"

    outline_section = re.search(
        r"##\s+Chapter Outline\s*\n(.*?)(?:\n##|\Z)", content, re.DOTALL | re.IGNORECASE
    )
    outline = outline_section.group(1).strip() if outline_section else content

    return {
        "title": title,
        "characters": [],
        "background": "",
        "outline": outline,
        "genre": "",
        "tone_guidelines": "",
        "writing_focus": "",
        "file_path": str(file_path),
    }