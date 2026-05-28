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
        min_dialogues: int = 2,
        characters_context: Optional[Dict[str, str]] = None,
        dialogue_density: float = 0.5,
    ) -> list:
        """Generate scene_events with style tags for a single scene."""
        styles_block = "\n".join(
            f"- {name}: {desc}" for name, desc in sorted(style_descriptions.items())
        ) if style_descriptions else "- general"

        min_prompt = f"MINIMUM DIALOGUES: {min_dialogues}+"

        if characters_context:
            chars_block = "\n\n".join(
                f"### {name}\n{profile.strip()}" for name, profile in characters_context.items()
            )
            characters_section = f"CHARACTERS IN THIS SCENE:\n{chars_block}\n\n"
        else:
            characters_section = ""

        density_percent = max(0, min(100, round(float(dialogue_density) * 100)))
        balance_prompt = (
            f"DIALOGUE/NARRATION BALANCE PREFERENCE: {density_percent}% dialogue / {100 - density_percent}% narration.\n"
            "Use this as an author preference, not a rigid quota. Higher dialogue preference should produce beats where "
            "decisions, persuasion, conflict, reveals, and emotional turns are more likely to happen through conversation, "
            "with higher expected_exchanges and lighter prose_weight when appropriate. Lower dialogue preference should "
            "allow narration, atmosphere, and action summary to carry more of the scene. Always respect the natural demands "
            "of the scene; do not force dialogue into beats that should stay physical or atmospheric."
        )

        user_prompt = (
            f"{characters_section}"
            f"SCENE DESCRIPTION:\n{scene_description}\n\n"
            f"{balance_prompt}\n\n"
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
                        "prose_weight": str(item.get("prose_weight", "balanced")),
                        "dialogue_density": item.get("dialogue_density"),
                    })
            else:
                validated_events.append(SceneEvent(beat=str(item)).model_dump())

        return validated_events
