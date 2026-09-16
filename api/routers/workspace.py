from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from typing import List, Dict, Any
from pydantic import BaseModel
import os
import tempfile
import urllib.parse
import urllib.request
import sys
import subprocess
from api.services.file_storage import storage, ALLOWED_IMAGE_EXTS

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


class CreateFileRequest(BaseModel):
    folder: str
    name: str
    content: str = ""


class RenameFileRequest(BaseModel):
    name: str


class UpdateFileRequest(BaseModel):
    content: str


class MediaFromUrlRequest(BaseModel):
    url: str
    name: str = ""


# ---------------------------------------------------------------------------
# Cross-platform folder picker
# ---------------------------------------------------------------------------

def _pick_folder_tkinter() -> str | None:
    """Universal fallback using tkinter (ships with CPython on all platforms)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()          # hide the empty root window
        root.wm_attributes("-topmost", True)
        path = filedialog.askdirectory(title="Select Workspace Folder")
        root.destroy()
        return path or None
    except Exception:
        return None


def _pick_folder_native() -> str | None:
    """Try the best native picker for the current OS; return None on failure."""
    try:
        if sys.platform == "darwin":
            result = subprocess.run(
                ["osascript", "-e",
                 'POSIX path of (choose folder with prompt "Select Workspace Folder")'],
                capture_output=True, text=True, timeout=60,
            )
            if result.returncode == 0:
                return result.stdout.strip() or None

        elif sys.platform == "win32":
            # PowerShell one-liner — works on Win 10/11 without extra deps
            ps_cmd = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$f.Description = 'Select Workspace Folder'; "
                "$f.ShowNewFolderButton = $true; "
                "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"
            )
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_cmd],
                capture_output=True, text=True, timeout=60,
            )
            if result.returncode == 0:
                return result.stdout.strip() or None

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


@router.get("/pick-folder")
def pick_folder():
    """Open a native folder-picker dialog.

    Strategy:
      1. Try the best native dialog for the running OS.
      2. Fall back to tkinter (cross-platform, ships with CPython).
      3. Return {"path": null} if nothing worked — the UI should then let
         the user type a path manually.
    """
    path = _pick_folder_native() or _pick_folder_tkinter()
    return {"path": path}


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


# ---------------------------------------------------------------------------
# Image assets (workspace/assets/) — first-class resources, not LLM payloads
# ---------------------------------------------------------------------------

def _media_error(e: Exception) -> HTTPException:
    msg = str(e)
    if isinstance(e, FileNotFoundError) or "not found" in msg.lower():
        return HTTPException(status_code=404, detail=msg)
    if "Access denied" in msg:
        return HTTPException(status_code=403, detail=msg)
    return HTTPException(status_code=400, detail=msg)


@router.post("/media")
async def upload_media(file: UploadFile = File(...)):
    """Persist an uploaded image to workspace/assets/. Streams to a temp
    file (bounded memory, no app-level size cap — local-first)."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".margin-upload")
    try:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            tmp.write(chunk)
        tmp.close()
        return storage.save_media_file(
            tmp.name, file.filename or "", file.content_type or "")
    except Exception as e:
        raise _media_error(e)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@router.post("/media/from-url")
def upload_media_from_url(req: MediaFromUrlRequest):
    """Fetch a remote image and store it locally so documents never depend
    on external hosts. Streams to a temp file; on failure: 400, and the
    editor inserts nothing."""
    url = (req.url or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must be http(s)")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".margin-upload")
    try:
        request = urllib.request.Request(
            url, headers={"User-Agent": "margin-writing-app/1.0"})
        with urllib.request.urlopen(request, timeout=20) as resp:  # noqa: S310
            content_type = resp.headers.get("Content-Type", "")
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
        tmp.close()
        # Derive a display name from the URL path for slug purposes only.
        path_part = urllib.parse.urlparse(url).path.rsplit("/", 1)[-1]
        return storage.save_media_file(tmp.name, req.name or path_part, content_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch image: {e}")
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@router.get("/media/{path:path}")
def read_media(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        full, media_type = storage.read_media(decoded_path)
        return FileResponse(str(full), media_type=media_type)
    except Exception as e:
        raise _media_error(e)
