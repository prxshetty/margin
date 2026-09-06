"""Central registry of supported agent-harness CLIs.

Both `api/routers/assist.py` (execution) and `api/routers/harnesses.py`
(discovery) import from here — descriptors live in exactly one place.
"""

from typing import Dict, List, Optional, TypedDict


class HarnessDescriptor(TypedDict, total=False):
    name: str
    command: str
    version_args: List[str]
    models_args: List[str]
    static_models: List[str]
    subcommand: str
    workspace_flag: str
    prompt_flag: str
    model_flag: str
    cwd_flag: str
    agent_flag: str
    mode_agents: dict
    extra_args: List[str]
    # Stream format: which line parser normalizes this CLI's stdout into
    # queue items (chunk/thinking/tool/usage/error_text). "text" = raw
    # human output, no structured events. format_args enables the stream.
    stream: str
    format_args: List[str]


HARNESS_DESCRIPTORS: Dict[str, HarnessDescriptor] = {
    "opencode": {
        "name": "OpenCode",
        "command": "opencode",
        "version_args": ["--version"],
        "models_args": ["models"],
        "subcommand": "run",
        # --dir pins the project root: `run` otherwise resolves it
        # itself (and created files outside the workspace).
        "workspace_flag": "--dir",
        "model_flag": "-m",
        # Margin chat → plan (read-only), Margin edit → build (edits files).
        "agent_flag": "--agent",
        "mode_agents": {"chat": "plan", "edit": "build"},
        # Structured stdout: `run --format json` emits raw JSON events
        # (text/reasoning/tool_use/step_finish).
        "stream": "opencode",
        "format_args": ["--format", "json"],
        # Non-interactive `run` auto-rejects every permission.asked event
        # (bash/edit) unless --auto is passed — stdin is DEVNULL so nothing
        # can ever be approved. Explicit deny rules still hold.
        "extra_args": ["--auto"],
    },
    "claude-code": {
        "name": "Claude Code",
        "command": "claude",
        "version_args": ["--version"],
        "models_args": [],
        "static_models": [
            "claude-fable-5-1",
            "claude-opus-5",
            "claude-sonnet-5",
            "claude-haiku-4-5-20251001",
        ],
        "prompt_flag": "-p",
        "model_flag": "--model",
        # JSONL events: assistant frames carry text/thinking/tool_use blocks,
        # the result frame carries final usage. stream-json with -p requires
        # --verbose or the CLI refuses. Verified against 2.1.236.
        "stream": "claude",
        "format_args": ["--output-format", "stream-json", "--verbose"],
        # Headless default permission mode denies Edit/Write outright;
        # acceptEdits auto-approves file edits under the run cwd.
        "extra_args": ["--permission-mode", "acceptEdits"],
    },
    "codex": {
        "name": "Codex",
        "command": "codex",
        "version_args": ["--version"],
        "models_args": [],
        # Codex offers no list-models command: built-in list, updated
        # with Margin releases. Custom IDs always typeable in Settings.
        "static_models": [
            "gpt-6-astra",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
        ],
        "subcommand": "exec",
        "workspace_flag": "-C",
        "model_flag": "-m",
        # JSONL ThreadEvents: agent_message/reasoning items,
        # turn.completed usage, error/turn.failed messages.
        "stream": "codex",
        "format_args": ["--json"],
        # exec's default sandbox is read-only; workspace-write is the
        # documented non-interactive mode that allows file edits.
        "extra_args": ["-s", "workspace-write"],
    },
    "agy": {
        "name": "Antigravity",
        "command": "agy",
        "version_args": ["--version"],
        "models_args": ["models"],
        "workspace_flag": "--add-dir",
        "prompt_flag": "--print",
        "model_flag": "--model",
        # Headless print mode auto-denies permission prompts; accept-edits
        # alone is NOT enough — write_file is still denied and edits either
        # fail or get parked in ~/.gemini/antigravity-cli/scratch. Verified:
        # skip-permissions + an ABSOLUTE --add-dir is what makes agy edit the
        # workspace in place (the router resolves the workspace to absolute).
        "extra_args": ["--mode", "accept-edits", "--dangerously-skip-permissions"],
        # stream-json: step_update frames stream text deltas and tool steps;
        # the result frame carries usage. NOTE: --print takes a value, so all
        # flags must precede it (the argv builder does; a flag after --print
        # is silently eaten as the prompt).
        "stream": "agy",
        "format_args": ["--output-format", "stream-json"],
    },
}


def get_descriptor(harness_id: str) -> Optional[HarnessDescriptor]:
    return HARNESS_DESCRIPTORS.get(harness_id)
