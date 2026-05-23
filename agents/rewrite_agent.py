"""
Rewrite Agent — rewrites a specific selection of text based on user feedback.
"""

import llm
import config

class RewriteAgent:
    """Rewrites text based on feedback."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = (
            "You are an expert editor and writer. Your task is to rewrite a specific "
            "selection of text based on the user's feedback. Maintain the original tone "
            "and context unless the feedback explicitly asks to change it. Output ONLY "
            "the rewritten text, without any introductory or concluding remarks, markdown "
            "formatting (unless present in the original), or explanations."
        )
        # Apply thinking preamble if reasoning model is enabled
        if config.REASONING_MODEL:
            self.system_prompt = config.THINKING_PREAMBLE + self.system_prompt
            
        self.token_limit = config.AGENT_CONFIG.get("writer", {}).get("max_tokens", 500)
        self.temperature = config.AGENT_CONFIG.get("writer", {}).get("temperature", 0.8)

    def generate(self, selected_text: str, feedback: str, context_text: str = "") -> str:
        user_prompt = "REWRITE INSTRUCTIONS:\n"
        user_prompt += f"Feedback: {feedback}\n\n"
        
        if context_text:
            user_prompt += f"FULL SCENE CONTEXT (for reference):\n{context_text}\n\n"
            
        user_prompt += f"TEXT TO REWRITE:\n{selected_text}\n"

        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )
