from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import urllib.parse
import sys
import subprocess
import json
import re
import asyncio
import time
from pathlib import Path
from api.services.file_storage import storage

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


class CreateFileRequest(BaseModel):
    folder: str
    name: str
    content: str = ""


class CreateWorkspaceRequest(BaseModel):
    path: str
    init_git: bool = False
    set_as_active: bool = True


class RenameFileRequest(BaseModel):
    name: str


class UpdateFileRequest(BaseModel):
    content: str


class GenerateManifestSummaryRequest(BaseModel):
    path: str
    content: Optional[str] = None


class UpdateManifestSummaryRequest(BaseModel):
    path: str
    summary: str
    stage: bool = False


# ---------------------------------------------------------------------------
# Cross-platform folder picker
# ---------------------------------------------------------------------------

def _open_folder_picker() -> str | None:
    """Open a single native folder-picker dialog.

    Uses Tkinter as the primary cross-platform picker (which opens the full
    native Explorer format dialog on Windows and native Cocoa dialog on macOS).
    If cancelled or closed, returns None immediately without popping up any secondary dialog.
    """
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()          # hide the empty root window
        root.attributes("-topmost", True)
        root.focus_force()
        root.lift()
        path = filedialog.askdirectory(parent=root, title="Select Workspace Folder")
        root.destroy()
        return path or None
    except Exception as e:
        print(f"Tkinter folder picker error/not available: {e}")

    # Fallback to CLI tools if Tkinter is not available (e.g. headless Linux)
    try:
        if sys.platform == "darwin":
            result = subprocess.run(
                ["osascript", "-e",
                 'POSIX path of (choose folder with prompt "Select Workspace Folder")'],
                capture_output=True, text=True, timeout=60,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()

        elif sys.platform.startswith("linux"):
            # Try zenity (GTK / GNOME), then kdialog (KDE), then yad
            for cmd in [
                ["zenity", "--file-selection", "--directory",
                 "--title=Select Workspace Folder"],
                ["kdialog", "--getexistingdirectory", "."],
                ["yad", "--file", "--directory"],
            ]:
                try:
                    result = subprocess.run(
                        cmd, capture_output=True, text=True, timeout=60,
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        return result.stdout.strip()
                except FileNotFoundError:
                    continue   # binary not installed — try next

    except Exception as e:
        print(f"Native folder picker error: {e}")

    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/files")
def get_input_files():
    try:
        return storage.list_input_files()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/{path:path}")
def read_input_file(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        content = storage.read_input_file(decoded_path)
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/git-status")
def get_git_status():
    from api.services.file_storage import is_git_available
    return is_git_available()


@router.get("/pick-folder")
def pick_folder():
    """Open a native folder-picker dialog."""
    path = _open_folder_picker()
    return {"path": path}


@router.post("/create")
def create_workspace(req: CreateWorkspaceRequest):
    if not req.path or not req.path.strip():
        raise HTTPException(status_code=400, detail="Workspace path is required")
    try:
        res = storage.create_workspace(
            target_path=req.path.strip(),
            init_git=req.init_git,
            set_as_active=req.set_as_active
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/files")
def create_input_file(req: CreateFileRequest):
    try:
        return storage.create_input_file(req.folder, req.name, req.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/files/{path:path}")
def delete_input_file(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        storage.delete_input_file(decoded_path)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/files/{path:path}")
def update_input_file(path: str, req: UpdateFileRequest):
    try:
        decoded_path = urllib.parse.unquote(path)
        storage.update_input_file(decoded_path, req.content)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/files/{path:path}")
def rename_input_file(path: str, req: RenameFileRequest):
    try:
        decoded_path = urllib.parse.unquote(path)
        return storage.rename_input_file(decoded_path, req.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/styles")
def get_styles():
    try:
        manifest = storage._load_manifest("styles/STYLES.md")
        styles = []
        for name, desc in manifest.items():
            if not name.lower().endswith(".md"):
                styles.append({
                    "name": name.lower(),
                    "description": desc or ""
                })
        return styles
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class StageFileRequest(BaseModel):
    path: str
    content: str | None = None


@router.get("/status")
def get_workspace_status():
    try:
        return storage.get_workspace_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/diff-base")
def get_diff_base(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        return storage.get_diff_base(decoded_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/stage-file")
def stage_file(req: StageFileRequest):
    try:
        decoded_path = urllib.parse.unquote(req.path)
        return storage.stage_file(decoded_path, req.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class RestoreFileRequest(BaseModel):
    path: str


class CommitRequest(BaseModel):
    path: str | None = None
    title: str
    comment: str | None = None


class GenerateCommitMessageRequest(BaseModel):
    path: str
    base_content: str | None = None
    current_content: str | None = None
    harness: str | None = None


@router.post("/restore-file")
def restore_file(req: RestoreFileRequest):
    try:
        decoded_path = urllib.parse.unquote(req.path)
        return storage.restore_file(decoded_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/commit")
def commit(req: CommitRequest):
    try:
        decoded_path = urllib.parse.unquote(req.path) if req.path else None
        return storage.commit_changes(decoded_path, req.title, req.comment)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/generate-commit-message")
async def generate_commit_message(req: GenerateCommitMessageRequest):
    try:
        t0 = time.perf_counter()
        decoded_path = urllib.parse.unquote(req.path)
        base_content = req.base_content
        if base_content is None:
            base_info = storage.get_diff_base(decoded_path)
            base_content = base_info.get("base_content") or ""

        current_content = req.current_content
        if current_content is None:
            current_content = storage.read_input_file(decoded_path)

        from api.routers.assist import _resolve_simple_assist_client
        from api.services.assist_helpers import _load_simple_prompt
        client = _resolve_simple_assist_client()

        loaded_prompt = _load_simple_prompt("commit-message.md")
        system_prompt = loaded_prompt or (
            "You are a helpful assistant for a writer creating Git commit messages for chapter drafts and notes.\n"
            "Generate a concise Git commit title and an optional brief commit comment describing the changes.\n"
            "Rules:\n"
            "- Title: Conventional commit format (e.g., feat(ch01): ..., edit(lore): ..., fix(dialogue): ...), under 72 chars.\n"
            "- Comment: 1-3 sentences or bullet points summarizing key narrative, structural, character, or word changes.\n"
            "- Return JSON ONLY in this exact schema with no extra text: {\"title\": \"...\", \"comment\": \"...\"}"
        )

        # Check if git has cached/staged diff
        staged_diff = ""
        if storage.is_git_repo():
            try:
                res_diff = subprocess.run(
                    ["git", "diff", "--cached"],
                    cwd=str(storage.workspace_dir.resolve()),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=5,
                )
                if res_diff.returncode == 0 and res_diff.stdout.strip():
                    staged_diff = res_diff.stdout.strip()
            except Exception:
                pass

        if staged_diff:
            user_prompt = (
                f"STAGED CHANGES TO COMMIT:\n\n{staged_diff[:8000]}\n\n"
                "Generate commit title and comment in JSON format:"
            )
        else:
            user_prompt = (
                f"FILE: {decoded_path}\n\n"
                f"ORIGINAL / STAGED CONTENT:\n{base_content[:8000]}\n\n"
                f"CURRENT UPDATED CONTENT:\n{current_content[:8000]}\n\n"
                "Generate commit title and comment in JSON format:"
            )

        loop = asyncio.get_running_loop()
        raw_output = await loop.run_in_executor(
            None,
            lambda: client.generate(system_prompt, user_prompt, stream=False, temperature=0.3, max_tokens=1500)
        )

        title, comment = _parse_commit_message_output(raw_output, decoded_path)
        duration_s = round(time.perf_counter() - t0, 2)
        model_used = getattr(client, "last_model_used", client.model)
        telemetry = {
            "model": model_used,
            "usage": client.last_usage,
            "duration_s": duration_s,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "raw_output": raw_output,
        }
        return {"title": title, "comment": comment, "telemetry": telemetry}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


def _parse_commit_message_output(raw_output: str, fallback_path: str = "chapter.md") -> tuple[str, str]:
    if not raw_output or not raw_output.strip():
        fallback_file = fallback_path.split('/')[-1] if fallback_path else 'chapter.md'
        return f"edit({fallback_file}): update content", ""

    text = raw_output.strip()

    # Strip reasoning tags like <think>...</think>
    text = re.sub(r'<think>[\s\S]*?</think>', '', text).strip()

    # Strip code block fences (```json ... ``` or ``` ...)
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s*```$', '', text).strip()

    title = ""
    comment = ""

    # 1. Try direct json.loads
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            title = str(data.get("title") or data.get("commit_title") or data.get("subject") or data.get("header") or data.get("summary") or "").strip()
            comment = str(data.get("comment") or data.get("description") or data.get("commit_comment") or data.get("body") or data.get("details") or data.get("notes") or data.get("message") or "").strip()
    except Exception:
        pass

    # 2. Try extracting outermost { ... }
    if not title:
        m = re.search(r'\{[\s\S]*\}', text)
        if m:
            try:
                data = json.loads(m.group(0))
                if isinstance(data, dict):
                    title = str(data.get("title") or data.get("commit_title") or data.get("subject") or data.get("header") or data.get("summary") or "").strip()
                    comment = str(data.get("comment") or data.get("description") or data.get("commit_comment") or data.get("body") or data.get("details") or data.get("notes") or data.get("message") or "").strip()
            except Exception:
                pass

    # 3. Regex field extraction (handles unescaped newlines in JSON strings, trailing commas, single quotes)
    if not title:
        t_match = re.search(
            r'["\'](?:title|commit_title|subject|header|summary)["\']\s*:\s*["\']([\s\S]*?)(?:["\']\s*(?:,|\})|["\']\s*$)',
            text,
            re.IGNORECASE,
        )
        if t_match:
            title = t_match.group(1).strip()

        c_match = re.search(
            r'["\'](?:comment|description|commit_comment|body|details|notes|message)["\']\s*:\s*["\']([\s\S]*?)(?:["\']\s*(?:,|\})|["\']\s*$)',
            text,
            re.IGNORECASE,
        )
        if c_match:
            comment = c_match.group(1).strip()

    # 4. Labeled text fallback (Title: ... / Comment: ...)
    if not title:
        t_label = re.search(r'^(?:Title|Commit Title|Subject):\s*(.+)$', text, re.MULTILINE | re.IGNORECASE)
        if t_label:
            title = t_label.group(1).strip()
            c_label = re.search(r'^(?:Comment|Description|Body|Details|Notes):\s*([\s\S]+)$', text, re.MULTILINE | re.IGNORECASE)
            if c_label:
                comment = c_label.group(1).strip()

    # 5. Raw lines fallback
    if not title:
        lines = [l.strip() for l in text.splitlines() if l.strip() and not l.strip().startswith('```')]
        if lines:
            first = lines[0]
            # Strip JSON braces/quotes if line looks like raw JSON
            first = re.sub(r'^[{\["\']+|[}\]\,"\']+$', '', first).strip()
            first = re.sub(r'^["\']?title["\']?\s*:\s*["\']?', '', first, flags=re.IGNORECASE).strip()
            first = re.sub(r'["\']\s*,\s*["\']?(?:comment|description)[\"\']?\s*:.*$', '', first, flags=re.IGNORECASE).strip()
            title = first.strip(' "\'{}')
            if len(lines) > 1:
                comment = "\n".join(lines[1:]).strip(' "\'{}')

    # Post-clean title if it still has residual json markup
    if title:
        title = re.sub(r'^[{\["\']+|[}\]\,"\']+$', '', title).strip()
        title = re.sub(r'^["\']?title["\']?\s*:\s*["\']?', '', title, flags=re.IGNORECASE).strip()
        title = re.sub(r'["\']\s*,\s*["\']?(?:comment|description)[\"\']?\s*:.*$', '', title, flags=re.IGNORECASE).strip()
        title = title.strip(' "\'{}')

    if not title:
        fallback_file = fallback_path.split('/')[-1] if fallback_path else 'chapter.md'
        title = f"edit({fallback_file}): update chapter content"

    # Unescape escaped newlines/quotes in comment
    if comment:
        comment = comment.replace('\\n', '\n').replace('\\"', '"').replace("\\'", "'")
        comment = re.sub(r'["\']?\s*\}\s*$', '', comment).strip()

    return title, comment


@router.get("/manifest-summary")
async def get_manifest_summary(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        info = storage.get_manifest_info_for_file(decoded_path)
        return info
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/generate-manifest-summary")
async def generate_manifest_summary(req: GenerateManifestSummaryRequest):
    try:
        t0 = time.perf_counter()
        decoded_path = urllib.parse.unquote(req.path)
        content = req.content
        if content is None:
            content = storage.read_input_file(decoded_path)

        from api.routers.assist import _resolve_simple_assist_client
        from api.services.assist_helpers import _load_simple_prompt
        client = _resolve_simple_assist_client()

        loaded_prompt = _load_simple_prompt("manifest-summary.md")
        system_prompt = loaded_prompt or (
            "You are an expert editorial assistant for writers and narrative planners.\n"
            "Generate a concise, single-paragraph summary of the document for its folder manifest index.\n"
            "Rules:\n"
            "- Exactly ONE cohesive paragraph (2-4 sentences, approximately 40-70 words).\n"
            "- Capture key character actions, narrative beats, dramatic stakes, or essential document facts.\n"
            "- Plain text only: do NOT include markdown headings, bullet points, quotes, JSON, or conversational remarks."
        )

        user_prompt = (
            f"FILE: {decoded_path}\n\n"
            f"DOCUMENT CONTENT:\n{content[:10000]}\n\n"
            "Write the single-paragraph manifest summary:"
        )

        loop = asyncio.get_running_loop()
        raw_output = await loop.run_in_executor(
            None,
            lambda: client.generate(system_prompt, user_prompt, stream=False, temperature=0.3, max_tokens=1500)
        )

        text = raw_output.strip()
        text = re.sub(r'<think>[\s\S]*?</think>', '', text).strip()
        text = re.sub(r'^```(?:markdown)?\s*', '', text, flags=re.IGNORECASE)
        text = re.sub(r'\s*```$', '', text).strip()
        text = text.strip(' "“\'”')

        duration_s = round(time.perf_counter() - t0, 2)
        model_used = getattr(client, "last_model_used", client.model)

        # Extract title from first heading in document content, or derive from filename
        title = ""
        for line in (content or "").splitlines():
            line_clean = line.strip()
            if line_clean.startswith("#"):
                title = re.sub(r"^#+\s*", "", line_clean).strip()
                break

        if not title:
            base_stem = Path(decoded_path).stem
            title = base_stem.replace("_", " ").replace("-", " ").title()

        # Prepend title if not already present at the start of the summary
        if title:
            title_norm = title.rstrip(". :—–-")
            if not text.lower().startswith(title_norm.lower()):
                text = f"{title_norm}. {text}"

        telemetry = {
            "model": model_used,
            "usage": client.last_usage,
            "duration_s": duration_s,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "raw_output": raw_output,
        }
        return {"summary": text, "telemetry": telemetry}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/update-manifest-summary")
async def update_manifest_summary(req: UpdateManifestSummaryRequest):
    try:
        decoded_path = urllib.parse.unquote(req.path)
        result = storage.update_manifest_summary(decoded_path, req.summary)
        if req.stage and storage.is_git_repo():
            manifest_rel_path = result.get("manifest_path")
            if manifest_rel_path:
                storage.stage_file(manifest_rel_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))



