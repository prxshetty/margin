"""
Writer Agent — writes one beat of a scene at a time.
Three modes: opening (first beat), continuation (middle beats), closing (final beat).
The system prompt (writer.txt) defines the role; mode instructions are
injected inline into the user prompt per beat.
"""

from typing import Optional
import llm
import config
from models import StoryContext


MODE_INTROS = {
    "opening": (
        "This is the opening beat of the scene.\n\n"
        "SETTING:\n{setting_draft}"
    ),
    "continuation": (
        "This is a middle beat of the scene. Continue from the previous paragraph.\n\n"
        "LAST TWO SENTENCES OF PREVIOUS PARAGRAPH:\n{prev_tail}"
    ),
    "closing": (
        "This is the final beat of the scene. Close the scene.\n\n"
        "LAST TWO SENTENCES OF PREVIOUS PARAGRAPH:\n{prev_tail}"
    ),
}

MODE_CLOSING_NOTES = {
    "opening": "Do NOT conclude or summarize — the scene continues after this beat.",
    "continuation": "Do NOT conclude or summarize — the scene continues after this beat.",
    "closing": "Write this beat and close the scene naturally. Do not leave loose threads — end with a sense of completion or a pointed transition to whatever comes next.",
}


class WriterAgent:
    """Writes a single beat of a scene in three modes."""

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
        dialogue_for_beat: str,
        writer_guidelines: str,
        mode: str,
        feedback: str = "",
        token_limit: Optional[int] = None,
    ) -> str:
        """Generate a single beat of the scene."""
        beat_desc = beat.get("beat", "") if isinstance(beat, dict) else str(beat)
        beat_style = beat.get("style", "general") if isinstance(beat, dict) else "general"

        token_limit = token_limit or config.TOKEN_LIMITS["writer"]
        intro = MODE_INTROS[mode].format(setting_draft=setting_draft, prev_tail=prev_tail)
        closing_note = MODE_CLOSING_NOTES[mode]

        user_prompt = (
            f"{intro}\n\n"
            f"BEAT DESCRIPTION:\n{beat_desc}\n\n"
            f"STYLE: {beat_style}\n"
            f"STYLE GUIDELINES:\n{writer_guidelines}\n\n"
            f"DIALOGUE FOR THIS BEAT:\n{dialogue_for_beat}\n\n"
            f"{closing_note}\n"
            f"Output polished prose only, no headers or meta commentary."
        )

        if feedback:
            user_prompt += f"\n\nUSER FEEDBACK:\n{feedback}\n\nIncorporate this feedback into the beat."

        return self.client.generate_to_completion(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=self.temperature,
            max_tokens=token_limit,
        )
