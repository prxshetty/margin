"""
Dialogue Agent — generates character dialogue for a single beat.
Called per-beat when the beat's style requires dialogue.
"""

import llm
import config
from models import StoryContext


class DialogueAgent:
    """Generates character dialogue for a specific beat."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["dialogue"]
        self.token_limit = config.TOKEN_LIMITS["dialogue"]
        self.temperature = config.AGENT_CONFIG["dialogue"]["temperature"]

    def generate(self, context: StoryContext, event: dict, dialogue_guidelines: str, narration_draft: str = "") -> str:
        user_prompt = self._build_prompt(context, event, dialogue_guidelines, narration_draft)
        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

    def _build_prompt(self, context: StoryContext, event: dict, dialogue_guidelines: str, narration_draft: str = "") -> str:
        beat_description = event.get("beat", str(event))
        parts = [
            f"THIS BEAT:\n{beat_description}",
        ]

        if narration_draft:
            parts.append(f"\nNARRATION PROSE WITH PLACEHOLDERS:\n{narration_draft}")

        conversation_flow = event.get("conversation_flow")
        if conversation_flow:
            flow_lines = "\n".join(f"  {i+1}. {step}" for i, step in enumerate(conversation_flow))
            parts.append(f"\nCONVERSATION FLOW:\n{flow_lines}")

        expected_exchanges = event.get("expected_exchanges")
        if expected_exchanges:
            if expected_exchanges == "0":
                parts.append("\nEXPECTED EXCHANGES: 0 — internal thoughts / self-talk only, no spoken dialogue")
            else:
                parts.append(f"\nEXPECTED EXCHANGES: {expected_exchanges}")

        if dialogue_guidelines:
            parts.append(f"\nDIALOGUE GUIDELINES:\n{dialogue_guidelines}")

        if context.character_profiles:
            parts.append("\nCHARACTER PROFILES:")
            for name, profile in context.character_profiles.items():
                current_state = context.character_states.get(name) or ""
                parts.append(f"  - {name}:")
                if profile.get("description"):
                    parts.append(f"    Description: {profile['description']}")
                if current_state:
                    parts.append(f"    Current state: {current_state}")

        if context.prior_scenes_context:
            parts.append("\nPRIOR SCENES IN THIS ACT:")
            for i, desc in enumerate(context.prior_scenes_context, 1):
                parts.append(f" {i}. {desc}")

        return "\n".join(parts)
