"""
Rewrite Agent — rewrites a specific selection of text based on user feedback.
"""

from pathlib import Path
import json

import llm
import config


def _load_simple_prompt(filename: str) -> str:
    prompts_dir = Path(__file__).parent.parent / "prompts" / "simple"
    path = prompts_dir / filename
    try:
        return path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""
    except Exception as e:
        print(f"Error reading prompt file {path}: {e}")
        return ""


def _maybe_prepend_thinking_preamble(prompt: str) -> str:
    reasoning_model = True
    prepend_thinking_preamble = False

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
        return config.THINKING_PREAMBLE + prompt
    return prompt


class RewriteAgent:
    """Rewrites text based on feedback."""

    def __init__(self, system_prompt: str | None = None):
        self.client = llm.LLMClient()
        base = system_prompt or _load_simple_prompt("simple-replace.md")
        self.system_prompt = _maybe_prepend_thinking_preamble(base)
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
        system_prompt: str | None = None,
        context_text: str = "",
    ) -> str:
        base = system_prompt or _load_simple_prompt("simple-insert.md")
        sp = _maybe_prepend_thinking_preamble(base)

        instruction = feedback.strip() if feedback.strip() else (
            "Continue the story naturally from this point."
        )

        user_prompt = f"INSTRUCTION: {instruction}\n\n"
        user_prompt += f"BLOCK TYPE AT CURSOR: {block_type}\n\n"
        if context_text:
            user_prompt += f"ADDITIONAL REFERENCE CONTEXT:\n{context_text}\n\n"
        if text_before:
            user_prompt += f"CONTEXT BEFORE INSERTION:\n{text_before[-500:]}\n\n"
        if text_after:
            user_prompt += f"CONTEXT AFTER INSERTION:\n{text_after[:300]}\n\n"
        user_prompt += "Generate the new content to insert:"

        return self.client.generate_to_completion(
            system_prompt=sp,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=self.token_limit,
        )
