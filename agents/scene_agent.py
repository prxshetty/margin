"""
Scene Agent — generates setting and atmosphere.
"""

import llm
import config
from models import StoryContext


class SceneAgent:
    """Generates visual and atmospheric scene descriptions."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["scene"]
        self.token_limit = config.TOKEN_LIMITS["scene"]
        self.temperature = config.AGENT_CONFIG["scene"]["temperature"]

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
            f"\nSUGGESTED SETTING:\n{context.setting or context.background}",
        ]

        if context.character_profiles:
            parts.append("\nCHARACTER PROFILES:")
            for name, profile in context.character_profiles.items():
                traits = profile.get("traits") or []
                goals = profile.get("goals") or []
                current_state = context.character_states.get(name, "")
                parts.append(f"  - {name}:")
                if traits:
                    parts.append(f"    Traits: {', '.join(traits)}")
                if goals:
                    parts.append(f"    Goals: {', '.join(goals)}")
                if current_state:
                    parts.append(f"    State: {current_state}")

        return "\n".join(parts)