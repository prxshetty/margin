"""
Dialogue Agent — generates character dialogue for a single beat.
Called per-beat when the beat's style requires dialogue.
Output: Character: "line" exchange format only.
"""

import llm
import config
from models import StoryContext


class DialogueAgent:
    """Generates character dialogue exchange for a specific beat."""

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
        if isinstance(event, dict):
            beat_description = event.get("beat", "") or str(event)
            expected_exchanges = event.get("expected_exchanges", "1")
        else:
            beat_description = str(event)
            expected_exchanges = "1"

        parts = [
            f"BEAT DESCRIPTION:\n{beat_description}",
            f"\nEXPECTED EXCHANGES: {expected_exchanges}",
        ]

        if narration_draft:
            parts.append(f"\nPHYSICAL ACTION / NARRATION DRAFT (ground dialogue in these movements and environment):\n{narration_draft}")

        parts.append("\nCHARACTERS IN THIS SCENE — write dialogue ONLY for these characters:")

        if context.character_profiles:
            for name, profile in context.character_profiles.items():
                current_state = (context.character_states or {}).get(name) or ""
                parts.append(f"  - {name}:")
                if profile.get("description"):
                    parts.append(f"    Description: {profile['description']}")
                if current_state:
                    if isinstance(current_state, dict):
                        parts.append("    Emotional State:")
                        self_state = current_state.get("self", {})
                        if self_state:
                            parts.append(f"      - Internal: {self_state.get('emotional', '')}")
                            for ev in (self_state.get('recent_events') or []):
                                parts.append(f"        · {ev}")
                        for key, rel_state in current_state.items():
                            if key != "self" and isinstance(rel_state, dict):
                                parts.append(f"      - Toward {key.title()}: {rel_state.get('emotional', '')}")
                                for ev in (rel_state.get('recent_events') or []):
                                    parts.append(f"        · {ev}")
                    else:
                        parts.append(f"    Current state: {current_state}")

        if dialogue_guidelines:
            parts.append(f"\nDIALOGUE GUIDELINES:\n{dialogue_guidelines}")

        if context.prior_scenes_context:
            parts.append("\nPRIOR SCENES IN THIS ACT:")
            for i, desc in enumerate(context.prior_scenes_context, 1):
                parts.append(f" {i}. {desc}")

        return "\n".join(parts)

