"""
State Manager — handles character profiles, story state, and AI-assisted updates after approved acts.
"""

import yaml
import re
import json
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import llm


class StateManager:
    """Manages character profiles, story state, and dynamic dynamic updates."""

    def __init__(
        self,
        characters_dir: str = "inputs/characters",
        story_state_path: str = "inputs/story_state.yaml",
    ):
        self.characters_dir = Path(characters_dir)
        self.story_state_path = Path(story_state_path)
        self._build_name_index()

    @staticmethod
    def _strip_frontmatter(content: str) -> str:
        match = re.match(r"^---\s*\n.*?\n---\s*\n", content, re.DOTALL)
        if match:
            return content[match.end():]
        return content

    def _build_name_index(self) -> None:
        """Index character markdown files by name derived from filename."""
        self._name_to_file = {}
        for fpath in self.characters_dir.glob("*.md"):
            name_lower = fpath.stem.replace("_", " ").lower()
            self._name_to_file[name_lower] = fpath

    def get_character_context(
        self,
        character_names: List[str],
        story_state: Optional[Dict] = None,
    ) -> Dict[str, Dict]:
        """Load character profiles and compiled structured postures for active scene partners."""
        context = {}
        if story_state is None:
            story_state = self.read_story_state()

        active_scene_chars = [name.lower() for name in character_names]

        for name in character_names:
            profile = self.get_character_profile(name)
            if profile:
                char_lower = name.lower()
                char_data = story_state.get("characters", {}).get(char_lower, {})
                postures = char_data.get("postures", {})

                # Fallback for old flat states
                if not isinstance(postures, dict):
                    postures = {"self": {"emotional": str(postures), "recent_events": []}}

                structured_state = {}

                # 1. Grab Self (Internal) Posture
                self_posture = postures.get("self") or {}
                if not isinstance(self_posture, dict):
                    self_posture = {"emotional": str(self_posture), "recent_events": []}
                
                self_emotional = self_posture.get("emotional") or profile.get("current_state") or ""
                self_events = self_posture.get("recent_events") or []
                if not isinstance(self_events, list):
                    self_events = [str(self_events)]

                structured_state["self"] = {
                    "emotional": self_emotional,
                    "recent_events": self_events
                }

                # 2. Grab relationship postures toward other physically present characters
                for other_char in active_scene_chars:
                    if other_char != char_lower and other_char in postures:
                        rel_posture = postures[other_char]
                        if not isinstance(rel_posture, dict):
                            rel_posture = {"emotional": str(rel_posture), "recent_events": []}
                        
                        rel_emotional = rel_posture.get("emotional") or ""
                        rel_events = rel_posture.get("recent_events") or []
                        if not isinstance(rel_events, list):
                            rel_events = [str(rel_events)]

                        structured_state[other_char] = {
                            "emotional": rel_emotional,
                            "recent_events": rel_events
                        }

                context[name] = {
                    "profile": profile,
                    "current_state": structured_state,
                }

        return context

    def get_character_profile(self, character_name: str) -> Optional[Dict]:
        """Read a character markdown profile and return name + description."""
        path = self._name_to_file.get(character_name.lower())
        if path and path.exists():
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            body = self._strip_frontmatter(content)
            name = path.stem.replace("_", " ").title()
            return {"name": name, "description": body.strip()}
        return None

    def get_character_state(
        self,
        character_name: str,
        story_state: Optional[Dict] = None,
    ) -> Any:
        """Get the dynamic posture dictionary for a character from story_state.yaml."""
        if story_state is None:
            story_state = self.read_story_state()

        characters = story_state.get("characters") or {}
        char_data = characters.get(character_name.lower()) or {}
        postures = char_data.get("postures") or {}

        if not postures:
            # Fallback to profile
            profile = self.get_character_profile(character_name)
            default_state = profile.get("current_state") or "" if profile else ""
            return {"self": {"emotional": default_state, "recent_events": []}}

        return postures

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
        """Remove None/empty values and ensure clean structured YAML."""
        result = {"characters": {}}
        characters = state.get("characters") or {}

        for name, char_data in characters.items():
            if char_data is None:
                result["characters"][name] = {"postures": {}}
            elif isinstance(char_data, dict):
                postures = char_data.get("postures") or {}
                clean_postures = {}
                for target, posture_data in postures.items():
                    if isinstance(posture_data, dict):
                        clean_postures[target] = {
                            "emotional": str(posture_data.get("emotional") or ""),
                            "recent_events": list(posture_data.get("recent_events") or [])
                        }
                    else:
                        clean_postures[target] = {
                            "emotional": str(posture_data or ""),
                            "recent_events": []
                        }
                result["characters"][name] = {"postures": clean_postures}
            else:
                result["characters"][name] = {"postures": {}}

        return result

    def initialize_story_state(self, character_names: List[str]) -> None:
        """Initialize story_state.yaml with nested dynamic emotional postures."""
        state = {"characters": {}}

        for name in character_names:
            profile = self.get_character_profile(name)
            if profile:
                state["characters"][name.lower()] = {
                    "postures": {
                        "self": {
                            "emotional": profile.get("current_state") or "",
                            "recent_events": []
                        }
                    }
                }

        self.write_story_state(state)

    def update_after_scene_approval(
        self,
        scene_number: int,
        generated_content: str,
        characters_in_scene: List[str],
    ) -> None:
        """Update emotional postures and relationship history lists after an approved scene via LLM."""
        story_state = self.read_story_state()

        # Build current context of the present characters
        prev_context_block = {}
        for char in characters_in_scene:
            char_lower = char.lower()
            char_data = story_state["characters"].get(char_lower, {})
            prev_context_block[char_lower] = char_data.get("postures", {})

        # Load dynamic updater prompt
        prompt_path = Path("prompts/state_updater.txt")
        if not prompt_path.exists():
            print("  Warning: state_updater.txt not found. Dynamic state update skipped.")
            return

        with open(prompt_path, "r", encoding="utf-8") as f:
            system_prompt = f.read()

        user_prompt = (
            f"PREVIOUS CHARACTER POSTURES:\n"
            f"{yaml.dump(prev_context_block, default_flow_style=False)}\n"
            f"APPROVED SCENE CONTENT:\n"
            f"{generated_content}\n"
        )

        print("  Running AI-Assisted character state update...")
        try:
            client = llm.LLMClient()
            response = client.generate(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                stream=False,
            )

            # Strip markdown if present
            clean_json = response.strip()
            if clean_json.startswith("```"):
                clean_json = re.sub(r"^```(?:json)?\n", "", clean_json)
                clean_json = re.sub(r"\n```$", "", clean_json)

            updates = json.loads(clean_json)

            for char_name, postures in updates.items():
                char_lower = char_name.lower()
                if char_lower not in story_state["characters"]:
                    story_state["characters"][char_lower] = {"postures": {}}
                
                if "postures" not in story_state["characters"][char_lower]:
                    story_state["characters"][char_lower]["postures"] = {}

                for target, posture_update in postures.items():
                    target_lower = target.lower()
                    
                    new_emotional = posture_update.get("emotional") or ""
                    new_event = posture_update.get("new_event") or posture_update.get("recent_events") or ""

                    # Load existing postures and history list
                    existing_posture = story_state["characters"][char_lower]["postures"].get(target_lower) or {}
                    if not isinstance(existing_posture, dict):
                        existing_posture = {"emotional": str(existing_posture), "recent_events": []}

                    history = existing_posture.get("recent_events") or []
                    if not isinstance(history, list):
                        history = [str(history)]

                    # Append new event and queue-limit to a rolling 3-event list
                    if new_event:
                        if isinstance(new_event, list):
                            for ev in new_event:
                                if ev and ev not in history:
                                    history.append(ev)
                        else:
                            if new_event not in history:
                                history.append(str(new_event))
                        history = history[-3:]

                    story_state["characters"][char_lower]["postures"][target_lower] = {
                        "emotional": new_emotional,
                        "recent_events": history
                    }

            self.write_story_state(story_state)
            print("  AI-Assisted state update completed successfully.")

        except Exception as e:
            print(f"  Warning: AI state update failed: {e}")

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