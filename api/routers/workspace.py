from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from typing import List, Dict, Any
from pydantic import BaseModel
import os
import tempfile
from pathlib import Path
import urllib.parse
import urllib.request
import sys
import subprocess
import shutil
from api.services.file_storage import (
    storage,
    is_git_available,
    _SENSITIVE_PATH_PREFIXES,
    ALLOWED_IMAGE_EXTS,
)

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


class CreateFileRequest(BaseModel):
    folder: str
    name: str
    content: str = ""


class CreateWorkspaceRequest(BaseModel):
    path: str
    init_git: bool = False
    set_as_active: bool = True
    force: bool = False


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

# Interactive folder picker timeout (seconds). A picker is deliberately
# interactive — a user may legitimately spend minutes browsing — so this is
# intentionally long. Contrast with short backend timeouts (e.g. git
# rev-parse timeout=5, git init/add/commit timeout=10). On timeout/expiry the
# picker must degrade gracefully to the next picker (ultimately Tk), never
# fail outright.
PICKER_TIMEOUT = 120


def _open_folder_picker() -> str | None:
    """Open a native folder-picker dialog in an isolated subprocess.

    On Windows, uses the modern native IFileOpenDialog (with FOS_PICKFOLDERS)
    via ctypes in an isolated child process. This opens the modern Windows
    File Explorer folder picker (with 'Select Folder' button, toolbar 'New folder',
    navigation bar, and full shell context menu support) without freezing.
    """
    try:
        # Windows: modern native Explorer folder picker (IFileOpenDialog with FOS_PICKFOLDERS)
        if sys.platform == "win32":
            win_code = (
                "import ctypes\n"
                "from ctypes import wintypes\n"
                "class GUID(ctypes.Structure):\n"
                "    _fields_ = [('Data1', ctypes.c_uint32), ('Data2', ctypes.c_uint16), ('Data3', ctypes.c_uint16), ('Data4', ctypes.c_uint8 * 8)]\n"
                "ole32 = ctypes.windll.ole32\n"
                "ole32.OleInitialize(None)\n"
                "def g(s):\n"
                "    res = GUID()\n"
                "    ole32.IIDFromString(ctypes.c_wchar_p(s), ctypes.byref(res))\n"
                "    return res\n"
                "clsid = g('{DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7}')\n"
                "iid_open = g('{d57c7288-d4ad-4768-be02-9d969532d960}')\n"
                "pDialog = ctypes.c_void_p()\n"
                "hr = ole32.CoCreateInstance(ctypes.byref(clsid), None, 1, ctypes.byref(iid_open), ctypes.byref(pDialog))\n"
                "if hr == 0 and pDialog.value:\n"
                "    try:\n"
                "        vt = ctypes.cast(pDialog, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents\n"
                "        Show = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.HWND)(vt[3])\n"
                "        SetOptions = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.DWORD)(vt[9])\n"
                "        SetTitle = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.LPCWSTR)(vt[17])\n"
                "        SetOkButtonLabel = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.LPCWSTR)(vt[18])\n"
                "        GetResult = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))(vt[20])\n"
                "        Release = ctypes.WINFUNCTYPE(wintypes.ULONG, ctypes.c_void_p)(vt[2])\n"
                "        SetOptions(pDialog, 0x00000020 | 0x00000040 | 0x00000800)\n"
                "        SetTitle(pDialog, 'Select Workspace Folder')\n"
                "        SetOkButtonLabel(pDialog, 'Select Folder')\n"
                "        if Show(pDialog, None) == 0:\n"
                "            pItem = ctypes.c_void_p()\n"
                "            if GetResult(pDialog, ctypes.byref(pItem)) == 0 and pItem.value:\n"
                "                item_vt = ctypes.cast(pItem, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents\n"
                "                GetDisplayName = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.LPWSTR))(item_vt[5])\n"
                "                ReleaseItem = ctypes.WINFUNCTYPE(wintypes.ULONG, ctypes.c_void_p)(item_vt[2])\n"
                "                psz = wintypes.LPWSTR()\n"
                "                if GetDisplayName(pItem, 0x80058000, ctypes.byref(psz)) == 0 and psz.value:\n"
                "                    print(psz.value)\n"
                "                    ole32.CoTaskMemFree(psz)\n"
                "                ReleaseItem(pItem)\n"
                "        Release(pDialog)\n"
                "    finally:\n"
                "        ole32.OleUninitialize()\n"
            )
            try:
                res = subprocess.run(
                    [sys.executable, "-c", win_code],
                    capture_output=True,
                    text=True,
                    timeout=PICKER_TIMEOUT,
                )
                if res.returncode == 0 and res.stdout.strip():
                    return res.stdout.strip()
                # Native failure -> fall through to Tk fallback below.
            except subprocess.TimeoutExpired:
                # Interactive timeout -> degrade gracefully to Tk fallback.
                pass

        # macOS: native Cocoa dialog via osascript
        elif sys.platform == "darwin":
            try:
                res = subprocess.run(
                    [
                        "osascript",
                        "-e",
                        'POSIX path of (choose folder with prompt "Select Workspace Folder")',
                    ],
                    capture_output=True,
                    text=True,
                    timeout=PICKER_TIMEOUT,
                )
                if res.returncode == 0 and res.stdout.strip():
                    return res.stdout.strip()
                # Native failure -> fall through to Tk fallback below.
            except subprocess.TimeoutExpired:
                # Interactive timeout -> degrade gracefully to Tk fallback.
                pass

        # Linux / BSD: native desktop dialogs if installed
        elif sys.platform.startswith("linux") or sys.platform.startswith("freebsd"):
            if shutil.which("zenity"):
                try:
                    res = subprocess.run(
                        ["zenity", "--file-selection", "--directory", "--title=Select Workspace Folder"],
                        capture_output=True,
                        text=True,
                        timeout=PICKER_TIMEOUT,
                    )
                    if res.returncode == 0 and res.stdout.strip():
                        return res.stdout.strip()
                except subprocess.TimeoutExpired:
                    # Interactive timeout -> try next picker, ultimately Tk.
                    pass
            if shutil.which("kdialog"):
                try:
                    res = subprocess.run(
                        ["kdialog", "--getexistingdirectory", ".", "--title", "Select Workspace Folder"],
                        capture_output=True,
                        text=True,
                        timeout=PICKER_TIMEOUT,
                    )
                    if res.returncode == 0 and res.stdout.strip():
                        return res.stdout.strip()
                except subprocess.TimeoutExpired:
                    # Interactive timeout -> try next picker, ultimately Tk.
                    pass
            if shutil.which("yad"):
                try:
                    res = subprocess.run(
                        ["yad", "--file", "--directory", "--title=Select Workspace Folder"],
                        capture_output=True,
                        text=True,
                        timeout=PICKER_TIMEOUT,
                    )
                    if res.returncode == 0 and res.stdout.strip():
                        return res.stdout.strip()
                except subprocess.TimeoutExpired:
                    # Interactive timeout -> try next picker, ultimately Tk.
                    pass
            # All native options failed/missing -> fall through to Tk fallback below.

        # Universal fallback: isolated Python Tkinter subprocess
        py_code = (
            "import tkinter as tk\n"
            "from tkinter import filedialog\n"
            "root = tk.Tk()\n"
            "root.withdraw()\n"
            "root.attributes('-topmost', True)\n"
            "root.focus_force()\n"
            "p = filedialog.askdirectory(parent=root, title='Select Workspace Folder')\n"
            "root.destroy()\n"
            "if p: print(p)\n"
        )
        try:
            res = subprocess.run(
                [sys.executable, "-c", py_code],
                capture_output=True,
                text=True,
                timeout=PICKER_TIMEOUT,
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except subprocess.TimeoutExpired:
            return None

    except Exception:
        return None

    return None


def _is_subpath(target: Path, base: Path) -> bool:
    """Check if target is the same as or a descendant of base, case-insensitively on Windows & macOS."""
    try:
        t_res = target.resolve()
        b_res = base.resolve()
        if sys.platform in ("win32", "darwin"):
            t_res = Path(str(t_res).lower())
            b_res = Path(str(b_res).lower())
        return t_res == b_res or b_res in t_res.parents
    except Exception:
        return False


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
    return is_git_available()


@router.get("/pick-folder")
def pick_folder():
    """Open a native folder-picker dialog."""
    path = _open_folder_picker()
    return {"path": path}


@router.post("/create")
def create_workspace_endpoint(req: CreateWorkspaceRequest):
    raw = (req.path or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Workspace path is required.")

    raw_path = Path(raw).expanduser()
    if not raw_path.is_absolute():
        raise HTTPException(status_code=400, detail="Workspace path must be absolute.")

    try:
        resolved = raw_path.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid workspace path.")

    # Block sensitive system / dot directories
    if any(part.startswith(".") for part in resolved.parts):
        raise HTTPException(
            status_code=400,
            detail="The selected path is not allowed as a workspace location."
        )

    for blocked in _SENSITIVE_PATH_PREFIXES:
        try:
            blocked_resolved = blocked.expanduser().resolve()
            if _is_subpath(resolved, blocked_resolved):
                raise HTTPException(
                    status_code=400,
                    detail="The selected path is not allowed as a workspace location."
                )
        except HTTPException:
            raise
        except Exception:
            pass

    # Reject non-empty directories unless force=True
    if resolved.exists() and resolved.is_dir() and not req.force:
        try:
            if any(resolved.iterdir()):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "The selected directory is not empty. "
                        "Pass force=true to scaffold into an existing directory."
                    )
                )
        except HTTPException:
            raise
        except Exception:
            pass

    try:
        res = storage.create_workspace(
            target_path=str(resolved),
            init_git=req.init_git,
        )
        # Link the workspace AFTER scaffold succeeds — a git failure won't leave
        # the app pointing at a half-built directory.
        if req.set_as_active:
            storage.update_settings({"linked_workspace_dir": res["path"]})
            res["set_as_active"] = True
        return res
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to create workspace.")



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
