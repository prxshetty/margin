"""
Writer Agent — merges sub-agent drafts into a single polished beat.
Three modes: opening (first beat), continuation (middle beats), closing (final beat).
The system prompt (writer.txt) defines the role; mode instructions are
injected inline into the user prompt per beat.
"""

from typing import Optional, Dict
import llm
import config
from models import StoryContext


MODE_INTROS = {
    "opening_with_setting": (
        "This is the opening beat of a scene in a new or significantly changed location.\n\n"
        "SETTING:\n{setting_draft}\n\n"
        "Establish the environment vividly using the sensory details above."
    ),
    "opening_without_setting": (
        "This is the opening beat of a new scene, but it occurs in the same location as the previous scene.\n\n"
        "Ground the scene lightly with a few brief sensory details, but do NOT provide a bulky setting description. Focus on the characters and immediate action."
    ),
    "continuation": (
        "This is a middle beat of the scene.\n\n"
        "PREVIOUS BEAT ENDED WITH:\n{prev_tail}"
    ),
    "closing": (
        "This is the final beat of the scene. Close the scene.\n\n"
        "PREVIOUS BEAT ENDED WITH:\n{prev_tail}"
    ),
}

MODE_CLOSING_NOTES = {
    "opening_with_setting": "Do NOT conclude or summarize — the scene continues after this beat.",
    "opening_without_setting": "Do NOT conclude or summarize — the scene continues after this beat.",
    "continuation": "Do NOT conclude or summarize — the scene continues after this beat.",
    "closing": "Write this beat and close the scene naturally. Do not leave loose threads — end with a sense of completion or a pointed transition to whatever comes next.",
}

PROSE_DIRECTIVES = {
    "light": (
        "PROSE DIRECTIVE: This is an action-forward beat. Keep narration functional and minimal — "
        "describe only what is necessary to ground the action. Compress atmosphere. "
        "Preserve all dialogue exchanges in full; do not trim spoken lines."
    ),
    "balanced": (
        "PROSE DIRECTIVE: This beat calls for a natural mix of action and atmosphere. "
        "Apply light seam-fixing between narration and dialogue. Preserve all dialogue exchanges from the DIALOGUE DRAFT in full; "
        "do not trim spoken lines. No aggressive compression or expansion."
    ),
    "heavy": (
        "PROSE DIRECTIVE: This is an atmosphere-forward beat. Expand sensory and environmental detail — "
        "let the world breathe before and after action. Preserve all dialogue exchanges from the DIALOGUE DRAFT in full; "
        "do not trim spoken lines. Prioritize mood and texture."
    ),
}


class WriterAgent:
    """Merges sub-agent drafts into a single polished beat."""

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt = config.SYSTEM_PROMPTS["writer"]
        self.temperature = config.AGENT_CONFIG["writer"]["temperature"]

    def generate_beat(
        self,
        context: StoryContext,
        beat: dict,
        beat_index: int,
        total_beats: int,
        prev_tail: str,
        setting_draft: str,
        drafts: Dict[str, str],
        writer_guidelines: str,
        mode: str,
        feedback: str = "",
        token_limit: Optional[int] = None,
    ) -> str:
        """Merge sub-agent drafts into a single polished beat."""
        beat_desc = beat.get("beat", "") if isinstance(beat, dict) else str(beat)
        beat_style = beat.get("style", "general") if isinstance(beat, dict) else "general"
        prose_weight = beat.get("prose_weight", "balanced") if isinstance(beat, dict) else "balanced"

        self.last_token_limit = token_limit or config.TOKEN_LIMITS["writer"]
        intro = MODE_INTROS[mode].format(setting_draft=setting_draft, prev_tail=prev_tail)
        closing_note = MODE_CLOSING_NOTES[mode]
        prose_directive = PROSE_DIRECTIVES.get(prose_weight, PROSE_DIRECTIVES["balanced"])

        drafts_block = ""
        if drafts:
            drafts_lines = []
            for agent_name, draft_text in drafts.items():
                if draft_text.strip():
                    drafts_lines.append(f"--- {agent_name.upper()} DRAFT ---\n{draft_text.strip()}")
            if drafts_lines:
                drafts_block = "\n\n".join(drafts_lines)

        self.last_user_prompt = (
            f"{intro}\n\n"
            f"{prose_directive}\n\n"
            f"BEAT DESCRIPTION:\n{beat_desc}\n\n"
            f"STYLE: {beat_style}\n"
            f"STYLE GUIDELINES:\n{writer_guidelines}\n"
        )

        if drafts_block:
            self.last_user_prompt += f"\nSUB-AGENT DRAFTS TO MERGE:\n{drafts_block}\n"

        self.last_user_prompt += f"\n{closing_note}\n"
        self.last_user_prompt += "Output polished prose only, no headers or meta commentary."

        if feedback:
            self.last_user_prompt += f"\n\nUSER FEEDBACK:\n{feedback}\n\nIncorporate this feedback into the beat."

        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=self.last_user_prompt,
            temperature=self.temperature,
            max_tokens=self.last_token_limit,
        )
