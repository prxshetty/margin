"""
Configuration for LMStudio and the story framework.
"""

from pathlib import Path
from schema_loader import SchemaLoader

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import os

LMSTUDIO = {
    "base_url": os.getenv("LM_STUDIO_BASE_URL", "http://localhost:1234/v1"),
    "model": os.getenv("LM_STUDIO_MODEL", ""),
    "temperature": 0.8,
    "max_tokens": 500,
    "stream": True,
}

AGENT_CONFIG = {
    "blueprint": {"max_tokens": 2000, "temperature": 0.9},
    "scene": {"max_tokens": 600, "temperature": 0.8},
    "dialogue": {"max_tokens": 1000, "temperature": 0.85},
    "transition": {"max_tokens": 400, "temperature": 0.7},
    "writer": {"max_tokens": 1500, "temperature": 0.85},
}

TOKEN_LIMITS = {key: cfg["max_tokens"] for key, cfg in AGENT_CONFIG.items()}

SCHEMA = SchemaLoader()


def _load_prompt(filename: str) -> str:
    prompts_dir = Path(__file__).parent / "prompts"
    file_path = prompts_dir / filename
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""
    except Exception as e:
        print(f"Error reading prompt file {file_path}: {e}")
        return ""


def _build_blueprint_prompt() -> str:
    """Build the blueprint agent prompt from schema + template."""
    base_prompt = _load_prompt("blueprint_base.txt")
    schema_section = SCHEMA.generate_blueprint_schema_section()

    rules = """
Rules:
- Group related beats into scenes (typically 2-4 scenes per act)
- 2-4 acts per chapter is optimal
- Each scene should have one clear arc/beat
- scene_description: MUST be included for every scene - describe what happens, the narrative purpose, events, emotional arc, and key moments in 2-4 concise sentences. This drives both dialogue and narration.
- creative_element: MUST be included for every scene - describe the single most important physical action or intimate interaction that defines this scene (be explicit and highly descriptive, or use "N/A" if not applicable)

Respond ONLY with valid JSON, no extra text."""

    return f"{base_prompt}\n\n{schema_section}\n\n{rules}"


def _build_agent_prompts() -> dict:
    """Build agent prompts that reference schema fields."""
    prompts = {}

    prompts["scene"] = _load_prompt("scene.txt")

    dialogue_base = _load_prompt("dialogue.txt")
    field_list = SCHEMA.generate_field_list_for_agent("dialogue_agent")
    prompts["dialogue"] = f"{dialogue_base}\n\nRelevant fields from schema:\n{field_list}"

    transition_base = _load_prompt("transition.txt")
    field_list = SCHEMA.generate_field_list_for_agent("transition_agent")
    prompts["transition"] = f"{transition_base}\n\nRelevant fields from schema:\n{field_list}"

    writer_base = _load_prompt("writer.txt")
    field_list = SCHEMA.generate_field_list_for_agent("writer_agent")
    prompts["writer"] = f"{writer_base}\n\nRelevant fields from schema:\n{field_list}"

    return prompts


SYSTEM_PROMPTS = {
    "blueprint": _build_blueprint_prompt(),
}

agent_prompts = _build_agent_prompts()
for key, prompt in agent_prompts.items():
    SYSTEM_PROMPTS[key] = prompt