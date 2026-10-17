from fastapi import APIRouter, HTTPException
from typing import Dict, Any, Optional
from pydantic import BaseModel
from pathlib import Path
import urllib.parse
import shutil

from api.services.file_storage import storage
from api.services.git_service import is_git_available, _init_git_repo

router = APIRouter(prefix="/api/workspace", tags=["git"])


class GitInitRequest(BaseModel):
    path: str


class RestoreDiffBaseRequest(BaseModel):
    path: str
    mode: Optional[str] = "committed"


class StageFileRequest(BaseModel):
    path: str
    content: Optional[str] = None


def _resolve_existing_dir(raw: str | None) -> Path:
    """Validate a workspace path argument: absolute, resolvable, an existing
    directory. Shared by the git endpoints so their 400s stay identical."""
    raw = (raw or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Workspace path is required.")

    raw_path = Path(raw).expanduser()
    if not raw_path.is_absolute():
        raise HTTPException(status_code=400, detail="Workspace path must be absolute.")

    try:
        resolved = raw_path.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid workspace path.")

    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=400, detail="The selected directory does not exist.")
    return resolved


def _own_git_dir(resolved: Path) -> Path | None:
    """<resolved>/.git when it exists as a directory, else None.

    Only a directory is ever removed — gitlink files (submodules, linked
    worktrees) are deliberately out of scope for the undo path."""
    candidate = resolved / ".git"
    return candidate if candidate.is_dir() else None


@router.get("/git-status")
def get_git_status():
    return is_git_available()


@router.post("/git-init")
def git_init_endpoint(req: GitInitRequest):
    """Initialize a Git repository in an existing directory.

    Used at Link time when the user toggles versioning on for an existing
    workspace. Never raises for expected Git outcomes — they are reported in
    `git` so the caller can surface partial success (linked, but Git failed).
    """
    resolved = _resolve_existing_dir(req.path)
    git_info = _init_git_repo(resolved)
    return {"success": True, "path": str(resolved), "git": git_info}


@router.get("/git-tracked")
def git_tracked(path: str = ""):
    """Whether `path` has its own `.git` directory (the edit-dialog toggle's
    initial state). 'Not a repo' is a normal answer, never an error."""
    resolved = _resolve_existing_dir(path)
    git_dir = _own_git_dir(resolved)
    return {"tracked": git_dir is not None}


@router.delete("/git")
def git_remove_endpoint(path: str = ""):
    """Undo a git init: delete <path>/.git (history lost, files kept).

    Only ever removes the folder's own `.git` directory — never walks up to a
    parent repo, never touches gitlink files. The UI gates this behind an
    explicit destructive confirm."""
    resolved = _resolve_existing_dir(path)
    git_dir = _own_git_dir(resolved)
    if git_dir is None:
        raise HTTPException(status_code=400, detail="No Git repository in this folder.")
    try:
        shutil.rmtree(git_dir)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove .git folder: {e}")


@router.get("/status")
def get_workspace_status():
    try:
        return storage.get_workspace_status()
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to get workspace status.")


@router.get("/diff-base")
def get_diff_base(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        return storage.get_diff_base(decoded_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found.")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")


@router.get("/restore-info")
def get_restore_info(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        return storage.get_restore_info(decoded_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found.")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")


@router.post("/restore-diff-base")
def restore_diff_base(req: RestoreDiffBaseRequest):
    try:
        res = storage.restore_file(req.path, mode=req.mode or "committed")
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to restore file"))
        return res
    except HTTPException:
        raise
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e) or "File not found.")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e) if "Only markdown" in str(e) else "Invalid file path.")
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")


@router.post("/stage")
def stage_file(req: StageFileRequest):
    try:
        res = storage.stage_file(req.path, req.content)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to stage file."))
        return res
    except HTTPException:
        raise
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found.")
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e) if "Only markdown" in str(e) else "Invalid file path.")
    except Exception:
        raise HTTPException(status_code=500, detail="An internal error occurred.")
