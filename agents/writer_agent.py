"""
Writer Agent — weaves setting and dialogue into a cohesive scene.
"""

import llm
import config
from models import StoryContext


class WriterAgent:
    """Combines sub-agent outputs into a final, polished scene."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["writer"]
        self.token_limit = config.TOKEN_LIMITS.get("writer", 1500)
        self.temperature = config.AGENT_CONFIG.get("writer", {"temperature": 0.8})["temperature"]

    def generate(
        self,
        context: StoryContext,
        setting_draft: str,
        dialogue_draft: str,
    ) -> str:
        user_prompt = self._build_prompt(context, setting_draft, dialogue_draft)
        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

    def regenerate_with_feedback(
        self,
        context: StoryContext,
        feedback: str,
        setting_draft: str,
        dialogue_draft: str,
    ) -> str:
        user_prompt = self._build_prompt(context, setting_draft, dialogue_draft)
        user_prompt += f"\n\n---\n\nUSER FEEDBACK:\n{feedback}\n\nPlease rewrite the scene incorporating this feedback while keeping the same arc and context."
        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

    def _build_prompt(
        self,
        context: StoryContext,
        setting_draft: str,
        dialogue_draft: str,
    ) -> str:
        parts = [
            f"SCENE NUMBER: {context.scene_number}",
            f"\nSCENE DESCRIPTION:\n{context.scene_description}",
        ]

        if context.prior_scenes_context:
            parts.append("\nPRIOR SCENES IN THIS ACT:")
            for i, desc in enumerate(context.prior_scenes_context, 1):
                parts.append(f" {i}. {desc}")

        parts.append(f"\n--- SETTING (from SceneAgent) ---\n{setting_draft}")

        parts.append(f"\n--- DIALOGUE (from DialogueAgent) ---\n{dialogue_draft}")

        if context.character_profiles:
            parts.append("\n--- CHARACTER PROFILES ---")
            for name, profile in context.character_profiles.items():
                parts.append(f"\n{name}:")
                parts.append(f"  Traits: {profile.get('traits', 'unknown')}")
                parts.append(f"  Goals: {profile.get('goals', 'unknown')}")
                parts.append(f"  Flaws: {profile.get('flaws', 'unknown')}")

        return "\n".join(parts)