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
    "blueprint": {"max_tokens": int(os.getenv("TOKENS_BLUEPRINT", 2000)), "temperature": 0.9},
    "scene": {"max_tokens": int(os.getenv("TOKENS_SCENE", 600)), "temperature": 0.8},
    "dialogue": {"max_tokens": int(os.getenv("TOKENS_DIALOGUE", 800)), "temperature": 0.85},
    "transition": {"max_tokens": int(os.getenv("TOKENS_TRANSITION", 400)), "temperature": 0.7},
    "writer": {"max_tokens": int(os.getenv("TOKENS_WRITER", 500)), "temperature": 0.85},
    "compiler": {"max_tokens": int(os.getenv("TOKENS_COMPILER", 300)), "temperature": 0.35},
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
    return base_prompt.replace("{SCHEMA_SECTION}", schema_section)


def _build_agent_prompts() -> dict:
    """Build agent prompts."""
    return {
        "scene": _load_prompt("scene.txt"),
        "dialogue": _load_prompt("dialogue.txt"),
        "transition": _load_prompt("transition.txt"),
        "writer": _load_prompt("writer.txt"),
        "compiler": _load_prompt("compiler.txt"),
    }


SYSTEM_PROMPTS = {
    "blueprint": _build_blueprint_prompt(),
}

agent_prompts = _build_agent_prompts()
for key, prompt in agent_prompts.items():
    SYSTEM_PROMPTS[key] = prompt
