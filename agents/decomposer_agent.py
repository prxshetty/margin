"""
Decomposer Agent — breaks a scene description into structured dramatic beats.
Called once per scene to generate scene_events with style tags.
"""

import re
from typing import Optional, Dict, Union
import llm
import config


class DecomposerAgent:
    """Decomposes a scene description into dramatic beats."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["decomposer"]
        self.token_limit = config.TOKEN_LIMITS["decomposer"]
        self.temperature = config.AGENT_CONFIG["decomposer"]["temperature"]

    def generate(
        self,
        scene_description: str,
        style_descriptions: Optional[Dict[str, str]] = None,
        min_dialogues: Union[int, Dict[str, int]] = 2,
        characters_context: Optional[Dict[str, str]] = None,
    ) -> list:
        """Generate scene_events with style tags for a single scene."""
        styles_block = "\n".join(
            f"- {name}: {desc}" for name, desc in sorted(style_descriptions.items())
        ) if style_descriptions else "- general"

        if isinstance(min_dialogues, dict):
            min_dialogues_block = "\n".join(
                f"- {style}: {count}+" for style, count in sorted(min_dialogues.items())
            )
            min_prompt = f"MINIMUM DIALOGUES PER STYLE:\n{min_dialogues_block}"
        else:
            min_prompt = f"MINIMUM DIALOGUES FOR DIALOGUE-HEAVY BEATS: {min_dialogues}+"

        if characters_context:
            chars_block = "\n\n".join(
                f"### {name}\n{profile.strip()}" for name, profile in characters_context.items()
            )
            characters_section = f"CHARACTERS IN THIS SCENE:\n{chars_block}\n\n"
        else:
            characters_section = ""

        user_prompt = (
            f"{characters_section}"
            f"SCENE DESCRIPTION:\n{scene_description}\n\n"
            f"AVAILABLE STYLE TAGS:\n{styles_block}\n\n"
            f"{min_prompt}"
        )

        response = self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

        events = self._parse_response(response)
        if events:
            return events

        return [{"beat": scene_description, "style": "general"}]

    def _parse_response(self, response: str) -> list:
        """Robustly parse and validate scene_events JSON array from LLM response."""
        import json as json_mod
        from api.models.domain import SceneEvent

        raw_list = None

        # Strategy 1: direct parse
        try:
            parsed = json_mod.loads(response.strip())
            if isinstance(parsed, list):
                raw_list = parsed
        except json_mod.JSONDecodeError:
            pass

        # Strategy 2: find [ ] bounds (handles markdown fences, leading/trailing text)
        if not raw_list:
            try:
                start = response.find("[")
                end = response.rfind("]") + 1
                if start >= 0 and end > start:
                    parsed = json_mod.loads(response[start:end])
                    if isinstance(parsed, list):
                        raw_list = parsed
            except (json_mod.JSONDecodeError, ValueError):
                pass

        # Strategy 3: strip ```json / ``` fences and try again
        if not raw_list:
            try:
                cleaned = response.strip()
                if cleaned.startswith("```"):
                    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
                    cleaned = re.sub(r"\n?```\s*$", "", cleaned)
                    parsed = json_mod.loads(cleaned.strip())
                    if isinstance(parsed, list):
                        raw_list = parsed
            except (json_mod.JSONDecodeError, ValueError):
                pass

        if not raw_list:
            return []

        # Validate, normalize, and default each event against the SceneEvent schema
        validated_events = []
        for item in raw_list:
            if isinstance(item, str):
                validated_events.append(SceneEvent(beat=item).model_dump())
            elif isinstance(item, dict):
                try:
                    # Leverage Pydantic to validate keys and fill defaults (exchanges, flow)
                    validated_events.append(SceneEvent(**item).model_dump())
                except Exception:
                    # Resilient fallback if item fails standard pydantic validation
                    validated_events.append({
                        "beat": str(item.get("beat", item)),
                        "style": str(item.get("style", "general")),
                        "expected_exchanges": str(item.get("expected_exchanges", "0")),
                        "conversation_flow": list(item.get("conversation_flow", []))
                    })
            else:
                validated_events.append(SceneEvent(beat=str(item)).model_dump())

        return validated_events
