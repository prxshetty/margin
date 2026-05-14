"""
Decomposer Agent — breaks a scene description into structured dramatic beats.
Called once per scene to generate scene_events with style tags.
"""

import re
from typing import Optional, Dict
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
    ) -> list:
        """Generate scene_events with style tags for a single scene."""
        styles_block = "\n".join(
            f"- {name}: {desc}" for name, desc in sorted(style_descriptions.items())
        ) if style_descriptions else "- general"

        user_prompt = (
            f"SCENE DESCRIPTION:\n{scene_description}\n\n"
            f"AVAILABLE STYLE TAGS:\n{styles_block}"
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
        """Robustly parse scene_events JSON array from LLM response."""
        import json as json_mod

        # Strategy 1: direct parse
        try:
            data = json_mod.loads(response.strip())
            if isinstance(data, list):
                return data
        except json_mod.JSONDecodeError:
            pass

        # Strategy 2: find [ ] bounds (handles markdown fences, leading/trailing text)
        try:
            start = response.find("[")
            end = response.rfind("]") + 1
            if start >= 0 and end > start:
                data = json_mod.loads(response[start:end])
                if isinstance(data, list):
                    return data
        except (json_mod.JSONDecodeError, ValueError):
            pass

        # Strategy 3: strip ```json / ``` fences and try again
        try:
            cleaned = response.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
                cleaned = re.sub(r"\n?```\s*$", "", cleaned)
                data = json_mod.loads(cleaned.strip())
                if isinstance(data, list):
                    return data
        except (json_mod.JSONDecodeError, ValueError):
            pass

        return []
