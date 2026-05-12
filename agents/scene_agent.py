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
        return "\n".join(parts)