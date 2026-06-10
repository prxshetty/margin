"""
Configuration for LMStudio and the story framework.
"""

from pathlib import Path
import os
import json

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

LMSTUDIO = {
    "base_url": os.getenv("LM_STUDIO_BASE_URL", "http://localhost:1234/v1"),
    "model": os.getenv("LM_STUDIO_MODEL", ""),
    "temperature": 0.8,
    "max_tokens": 500,
    "stream": True,
}

REASONING_MODEL = os.getenv("REASONING_MODEL", "").lower() in ("true", "1", "yes")
DISABLE_TOKEN_LIMITS = os.getenv("DISABLE_TOKEN_LIMITS", "").lower() in ("true", "1", "yes")

THINKING_PREAMBLE = (
    "Before every response, you MUST think through the problem internally "
    "using this exact format:\n"
    "<|channel|>thought\n"
    "[your reasoning here]\n"
    "<channel|>\n\n"
    "Then provide your final answer after the closing tag.\n"
    "This format is REQUIRED for every response, including JSON outputs.\n\n"
)
