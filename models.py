"""
Story data models — dataclasses for the entire framework.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
import uuid


@dataclass
class StoryContext:
    """Context passed between agents during generation."""
    chapter_title: str
    act_number: int
    scene_number: int
    background: str = ""
    chapter_background: str = ""
    characters: List[str] = field(default_factory=list)
    setting: str = ""
    genre: str = ""
    tone_guidelines: str = ""
    writing_focus: str = ""
    creative_element: str = ""
    prior_scenes_context: List[str] = field(default_factory=list)
    generated_content: Dict[str, str] = field(default_factory=dict)
    character_profiles: Dict[str, Dict] = field(default_factory=dict)
    character_states: Dict[str, str] = field(default_factory=dict)
    scene_description: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SceneBlueprint:
    """A single scene's structural blueprint.

    Core fields are defined directly. Additional schema fields are stored
    in `extra` dict for flexibility.
    """
    scene_number: int
    scene_setting: str
    characters: List[str] = field(default_factory=list)
    scene_description: str = ""
    creative_element: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        if hasattr(self, key):
            return getattr(self, key)
        return self.extra.get(key, default)

    def set(self, key: str, value: Any):
        if hasattr(self, key):
            setattr(self, key, value)
        else:
            self.extra[key] = value

    def to_dict(self) -> dict:
        result = {
            "scene_number": self.scene_number,
            "scene_setting": self.scene_setting,
            "characters": self.characters,
            "scene_description": self.scene_description,
            "creative_element": self.creative_element,
        }
        result.update(self.extra)
        return result

    @classmethod
    def from_dict(cls, data: dict) -> "SceneBlueprint":
        known_fields = {
            "scene_number",             "scene_setting", "characters",
            "scene_description", "creative_element"
        }
        kwargs = {}
        extra = {}

        for key, value in data.items():
            if key in known_fields:
                kwargs[key] = value
            else:
                extra[key] = value

        kwargs["extra"] = extra
        return cls(**kwargs)


@dataclass
class ActBlueprint:
    """An act's structural blueprint."""
    act_number: int
    act_theme: str
    scenes: List[SceneBlueprint] = field(default_factory=list)
    act_transition_hint: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        if hasattr(self, key):
            return getattr(self, key)
        return self.extra.get(key, default)

    def set(self, key: str, value: Any):
        if hasattr(self, key):
            setattr(self, key, value)
        else:
            self.extra[key] = value

    def to_dict(self) -> dict:
        result = {
            "act_number": self.act_number,
            "act_theme": self.act_theme,
            "act_transition_hint": self.act_transition_hint,
            "scenes": [s.to_dict() for s in self.scenes],
        }
        result.update(self.extra)
        return result

    @classmethod
    def from_dict(cls, data: dict) -> "ActBlueprint":
        known_fields = {"act_number", "act_theme", "scenes", "act_transition_hint"}
        kwargs = {}
        extra = {}

        for key, value in data.items():
            if key in known_fields:
                if key == "scenes":
                    kwargs[key] = [SceneBlueprint.from_dict(s) for s in value]
                else:
                    kwargs[key] = value
            else:
                extra[key] = value

        kwargs["extra"] = extra
        return cls(**kwargs)


@dataclass
class ChapterBlueprint:
    """High-level structure for a chapter (before generation)."""
    chapter_title: str
    acts: List[ActBlueprint] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "chapter_title": self.chapter_title,
            "acts": [a.to_dict() for a in self.acts],
        }


@dataclass
class Scene:
    """A fully generated scene."""
    id: str
    act_number: int
    scene_number: int
    setting: str = ""
    characters_present: List[str] = field(default_factory=list)
    dialogue: str = ""
    narration: str = ""
    transition: str = ""
    full_content: str = ""


@dataclass
class Act:
    """A fully generated act."""
    id: str
    act_number: int
    scenes: List[Scene] = field(default_factory=list)
    act_transition: str = ""

    @property
    def full_content(self) -> str:
        parts = []
        for scene in self.scenes:
            parts.append(scene.full_content)
            if scene.transition:
                parts.append(f"\n[Transition: {scene.transition}]\n")
        if self.act_transition:
            parts.append(f"\n[Act Transition: {self.act_transition}]\n")
        return "\n\n".join(parts)


@dataclass
class Chapter:
    """A fully generated chapter."""
    id: str
    title: str
    acts: List[Act] = field(default_factory=list)
    blueprint: Optional[ChapterBlueprint] = None