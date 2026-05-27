"""
Narration Agent — generates pure action/atmosphere prose for a single beat.
Called per-beat when the beat's style has ## Narration Guidelines.
Produces NO dialogue, NO placeholders — only physical world description.
"""

import llm
import config
from models import StoryContext


class NarrationAgent:
    """Generates narration prose for a specific beat."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["narration"]
        self.token_limit = config.TOKEN_LIMITS["narration"]
        self.temperature = config.AGENT_CONFIG["narration"]["temperature"]

    def generate(self, context: StoryContext, beat_description: str, narration_guidelines: str,
                  prose_weight: str = "balanced") -> str:
        user_prompt = self._build_prompt(context, beat_description, narration_guidelines, prose_weight)
        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

    def _build_prompt(self, context: StoryContext, beat_description: str, narration_guidelines: str,
                      prose_weight: str = "balanced") -> str:
        parts = [
            f"PROSE WEIGHT: {prose_weight}",
            f"\nTHIS BEAT:\n{beat_description}",
        ]

        if narration_guidelines:
            parts.append(f"\nNARRATION GUIDELINES:\n{narration_guidelines}")

        if context.character_profiles:
            parts.append("\nCHARACTER PROFILES (for physical description and action grounding):")
            for name, profile in context.character_profiles.items():
                current_state = context.character_states.get(name) or ""
                parts.append(f"  - {name}:")
                if profile.get("description"):
                    parts.append(f"    Description: {profile['description']}")
                if current_state:
                    if isinstance(current_state, dict):
                        parts.append("    Dynamic Emotional State:")
                        # 1. Format self posture
                        self_state = current_state.get("self", {})
                        if self_state:
                            parts.append("      - Internal (Self):")
                            parts.append(f"        * Emotional: {self_state.get('emotional', '')}")
                            events = self_state.get('recent_events', [])
                            if events:
                                parts.append("        * Recent History:")
                                for ev in events:
                                    parts.append(f"          · {ev}")
                        # 2. Format relationships
                        for key, rel_state in current_state.items():
                            if key != "self" and isinstance(rel_state, dict):
                                parts.append(f"      - Toward {key.title()}:")
                                parts.append(f"        * Emotional: {rel_state.get('emotional', '')}")
                                events = rel_state.get('recent_events', [])
                                if events:
                                    parts.append("        * Recent History:")
                                    for ev in events:
                                        parts.append(f"          · {ev}")
                    else:
                        parts.append(f"    Current state: {current_state}")

        if context.prior_scenes_context:
            parts.append("\nPRIOR SCENES IN THIS ACT:")
            for i, desc in enumerate(context.prior_scenes_context, 1):
                parts.append(f" {i}. {desc}")

        return "\n".join(parts)
