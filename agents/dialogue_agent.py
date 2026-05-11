"""
Dialogue Agent — generates character conversations.
"""

import llm
import config
from models import StoryContext


class DialogueAgent:
    """Generates character dialogue for scenes."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["dialogue"]
        self.token_limit = config.TOKEN_LIMITS["dialogue"]
        self.temperature = config.AGENT_CONFIG["dialogue"]["temperature"]

    def generate(self, context: StoryContext) -> str:
        user_prompt = self._build_prompt(context)
        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

    def _build_prompt(self, context: StoryContext) -> str:
        parts = [
            f"SCENE DESCRIPTION:\n{context.scene_description}",
            f"\nSUGGESTED SETTING:\n{context.setting}",
        ]

        if context.character_profiles:
            parts.append("\nCHARACTER PROFILES:")
            for name, profile in context.character_profiles.items():
                traits = profile.get("traits") or []
                goals = profile.get("goals") or []
                flaws = profile.get("flaws") or []
                current_state = context.character_states.get(name) or ""

                parts.append(f"  - {name}:")
                if profile.get("description"):
                    parts.append(f"    Description: {profile['description']}")
                if traits:
                    parts.append(f"    Traits: {', '.join(traits)}")
                if goals:
                    parts.append(f"    Goals: {', '.join(goals)}")
                if flaws:
                    parts.append(f"    Flaws: {', '.join(flaws)}")
                if current_state:
                    parts.append(f"    Current state: {current_state}")

        if context.previous_scene_summary:
            parts.append(f"\nPREVIOUS SCENE:\n{context.previous_scene_summary}")

        return "\n".join(parts)