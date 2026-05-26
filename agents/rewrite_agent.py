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
            "selection of text based on the user's feedback. "
            "CRITICAL RULES:\n"
            "1. Maintain the EXACT same formatting structure as the original. If the original "
            "uses bullet points (lines starting with '-' or '*'), your output MUST also use "
            "bullet points. If the original is plain prose, output plain prose.\n"
            "2. Maintain the original tone and context unless the feedback explicitly asks to change it.\n"
            "3. Output ONLY the rewritten text, with no introductory remarks, explanations, "
            "or commentary. Do not prefix or suffix your response.\n"
            "4. Match the number of bullet points unless the feedback explicitly asks to add or remove them.\n"
            "5. If the feedback asks to add an action, emotion, or detail (e.g., 'add a gasp here'), "
            "creatively weave it into the prose. Do NOT literally append the instruction in parentheses "
            "(e.g., do not output '... (with a gasp added here)'). Write it organically."
        )
        # Apply thinking preamble if reasoning model and prepend are enabled in settings
        reasoning_model = True
        prepend_thinking_preamble = False
        
        from pathlib import Path
        import json
        settings_path = Path(__file__).parent.parent / "settings.json"
        if settings_path.exists():
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    reasoning_model = settings.get("reasoning_model", True)
                    prepend_thinking_preamble = settings.get("prepend_thinking_preamble", False)
            except Exception:
                pass
                
        if reasoning_model and prepend_thinking_preamble:
            self.system_prompt = config.THINKING_PREAMBLE + self.system_prompt
            
        self.token_limit = config.AGENT_CONFIG.get("writer", {}).get("max_tokens", 500)
        self.temperature = config.AGENT_CONFIG.get("writer", {}).get("temperature", 0.8)

    def generate(self, selected_text: str, feedback: str, context_text: str = "") -> str:
        effective_feedback = feedback.strip() if feedback.strip() else (
            "Rewrite and improve this passage. Preserve the existing tone, "
            "character voice, and formatting structure. Improve clarity and flow."
        )
        user_prompt = "REWRITE INSTRUCTIONS:\n"
        user_prompt += f"Feedback: {effective_feedback}\n\n"
        
        if context_text:
            user_prompt += f"FULL SCENE CONTEXT (for reference):\n{context_text}\n\n"
            
        user_prompt += f"TEXT TO REWRITE:\n{selected_text}\n"

        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

    def generate_insert(
        self,
        text_before: str,
        text_after: str,
        block_type: str,
        feedback: str = "",
    ) -> str:
        insert_system_prompt = (
            "You are an expert fiction writer. Generate NEW content to be inserted "
            "at a specific position in a document.\n"
            "CRITICAL RULES:\n"
            "1. Output ONLY the new content. No explanations, no introductions.\n"
            "2. Match the formatting of the surrounding content exactly. "
            "If block_type is 'bulletList', output markdown bullet points. "
            "If 'paragraph', output prose.\n"
            "3. Flow naturally FROM what comes BEFORE and INTO what comes AFTER.\n"
            "4. Do NOT repeat or reference the existing text — only generate what is missing.\n"
            "5. If an author instruction is provided, honor it creatively. If asked to add an action or detail, weave it naturally into the prose. Do NOT literally append the instruction in parentheses."
        )
        # Apply thinking preamble if reasoning model and prepend are enabled in settings
        reasoning_model = True
        prepend_thinking_preamble = False
        
        from pathlib import Path
        import json
        settings_path = Path(__file__).parent.parent / "settings.json"
        if settings_path.exists():
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    reasoning_model = settings.get("reasoning_model", True)
                    prepend_thinking_preamble = settings.get("prepend_thinking_preamble", False)
            except Exception:
                pass
                
        if reasoning_model and prepend_thinking_preamble:
            insert_system_prompt = config.THINKING_PREAMBLE + insert_system_prompt

        instruction = feedback.strip() if feedback.strip() else (
            "Continue the story naturally from this point."
        )

        user_prompt = f"INSTRUCTION: {instruction}\n\n"
        user_prompt += f"BLOCK TYPE AT CURSOR: {block_type}\n\n"
        if text_before:
            user_prompt += f"CONTEXT BEFORE INSERTION:\n{text_before[-500:]}\n\n"
        if text_after:
            user_prompt += f"CONTEXT AFTER INSERTION:\n{text_after[:300]}\n\n"
        user_prompt += "Generate the new content to insert:"

        return self.client.generate_to_completion(
            system_prompt=insert_system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )

