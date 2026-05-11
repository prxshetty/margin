"""
Transition Agent — generates scene and act bridges.
"""

import llm
import config


class TransitionAgent:
    """Generates transitions between scenes and acts."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["transition"]
        self.token_limit = config.TOKEN_LIMITS["transition"]
        self.temperature = config.AGENT_CONFIG["transition"]["temperature"]

    def generate_scene_transition(
        self,
        current_arc: str,
        next_arc: str,
        tone: str = "neutral",
    ) -> str:
        user_prompt = f"""Type: Scene transition (bridge between two scenes)
Current scene arc: {current_arc}
Next scene arc: {next_arc}
Tone: {tone}

Write a 1-3 sentence bridge."""
        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

    def generate_act_transition(
        self,
        current_act_summary: str,
        next_act_arc: str,
        is_cliffhanger: bool = True,
    ) -> str:
        user_prompt = f"""Type: Act transition (end of an act)
Current act summary: {current_act_summary}
Next act begins with: {next_act_arc}
Cliffhanger needed: {is_cliffhanger}

Write a 2-4 sentence transition that {'creates a hook or cliffhanger' if is_cliffhanger else 'provides smooth continuity'}."""
        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )