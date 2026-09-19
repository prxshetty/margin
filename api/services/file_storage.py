import os
import sys
import json
import re
import shutil
import tempfile
import time
import subprocess
import warnings
from pathlib import Path, PurePosixPath
from typing import List, Optional, Dict, Any, Tuple

def is_git_available() -> Dict[str, Any]:
    git_bin = shutil.which("git")
    if not git_bin:
        return {"available": False, "version": None}
    try:
        res = subprocess.run([git_bin, "--version"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            return {"available": True, "version": res.stdout.strip()}
    except Exception:
        pass
    return {"available": False, "version": None}


def get_sensitive_path_prefixes() -> List[Path]:
    home = Path.home()
    prefixes: List[Path] = [
        home / ".ssh",
        home / ".gnupg",
        home / ".aws",
        home / ".config",
        home / ".local",
    ]
    if sys.platform == "win32":
        for var in ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "windir"):
            val = os.environ.get(var)
            if val:
                prefixes.append(Path(val))
        for fallback in ("C:/Windows", "C:/Program Files", "C:/Program Files (x86)", "C:/ProgramData"):
            prefixes.append(Path(fallback))
    elif sys.platform == "darwin":
        prefixes.extend([
            Path("/System"),
            Path("/Library"),
            Path("/usr"),
            Path("/etc"),
            Path("/bin"),
            Path("/sbin"),
            Path("/private/etc"),
            Path("/var/log"),
            Path("/var/lib"),
            Path("/var/root"),
            Path("/var/db"),
            Path("/var/run"),
            Path("/private/var/log"),
            Path("/private/var/lib"),
            Path("/private/var/root"),
            Path("/private/var/db"),
        ])
    else:  # Linux / Unix
        prefixes.extend([
            Path("/etc"),
            Path("/usr"),
            Path("/bin"),
            Path("/sbin"),
            Path("/boot"),
            Path("/root"),
            Path("/sys"),
            Path("/proc"),
            Path("/dev"),
            Path("/var/log"),
            Path("/var/lib"),
            Path("/var/root"),
            Path("/var/db"),
            Path("/var/run"),
        ])
    return prefixes


_SENSITIVE_PATH_PREFIXES = get_sensitive_path_prefixes()


try:
    from platformdirs import user_config_dir
    _CONFIG_DIR = Path(user_config_dir("slm-writing-engine", appauthor=False))
    _PLATFORMDIRS_AVAILABLE = True
except ImportError:
    warnings.warn(
        "platformdirs is not installed — settings.json will be stored in the project "
        "directory instead of a platform-appropriate config folder. "
        "Run:  pip install platformdirs>=4.0.0",
        RuntimeWarning,
        stacklevel=2,
    )
    _CONFIG_DIR = Path(".")
    _PLATFORMDIRS_AVAILABLE = False


def _posix_rel(path: Path, base: Path) -> str:
    """Return a forward-slash relative path string, safe on all platforms."""
    return path.relative_to(base).as_posix()


# Image assets live alongside documents as first-class workspace resources:
# Markdown stores `![alt](assets/<file> "caption")`, bytes live on disk.
ALLOWED_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp", "gif"}
EXT_TO_MIME = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
}

# Magic-byte signatures (first bytes of the file). WEBP is RIFF....WEBP.
_IMAGE_MAGIC = (
    (b"\x89PNG", {"png"}),
    (b"\xff\xd8\xff", {"jpg", "jpeg"}),
    (b"GIF87a", {"gif"}),
    (b"GIF89a", {"gif"}),
)


def _sniff_image_ext(head: bytes) -> Optional[str]:
    for sig, exts in _IMAGE_MAGIC:
        if head.startswith(sig):
            return sorted(exts)[0]
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "webp"
    return None


def _slugify_media_name(name: str) -> str:
    base = (name or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    base = base.rsplit(".", 1)[0] if "." in base else base
    slug = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")
    return slug[:60] or "image"


class FileStorageService:
    def __init__(self, base_dir: str = "."):
        self.base_dir = Path(base_dir)
        # Settings live in a platform-appropriate config directory
        _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self.settings_path = _CONFIG_DIR / "settings.json"
        self.workspace_dir = self.base_dir / "sample-workspace"
        self.outputs_dir = self.workspace_dir / "outputs"
        self.load_settings()

    def load_settings(self):
        # Default back to sample-workspace first
        self.workspace_dir = self.base_dir / "sample-workspace"
        self.outputs_dir = self.workspace_dir / "outputs"

        if self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    custom_workspace = settings.get("linked_workspace_dir")
                    if custom_workspace:
                        p = Path(custom_workspace)
                        if p.exists() and p.is_dir():
                            self.workspace_dir = p
                            self.outputs_dir = p / "outputs"
            except Exception as e:
                print(f"Error loading settings: {e}")

        # Ensure directories exist
        (self.workspace_dir / "chapters").mkdir(parents=True, exist_ok=True)
        (self.workspace_dir / "characters").mkdir(parents=True, exist_ok=True)
        (self.workspace_dir / "styles").mkdir(parents=True, exist_ok=True)
        (self.workspace_dir / "assets").mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def get_settings(self) -> Dict[str, Any]:
        settings = {
            "linked_workspace_dir": None,
            "is_thinking": True,
            "prepend_thinking_preamble": False,
            "dialogue_density": 0.5,
            "default_mode": "edit",
            "default_verbosity": "balanced",
            "show_thinking_by_default": False,
            "pinned_ref_files": [],
            "ignored_ref_files": [],
            "endpoints": {},
            "active_endpoint": None,
            "default_harness": "none",
            "harnesses": {},
            "theme": "light",
            "theme_family": "sand",
            "text_style": "system",
            "editor_stats": "both",
            "planner_include_outline": False,
            "history_turns": 5,
            "image_provider": "openai-compatible",
            "image_base_url": "",
            "image_api_key": "",
            "image_model": "",
            "image_default_style": None,
            "image_custom_styles": [],
            "image_deleted_styles": [],
            "image_style_overrides": {},
            "image_comfy_text_workflow": None,
            "image_comfy_text_prompt_map": None,
            "image_comfy_text_seed_map": None,
            "image_comfy_edit_workflow": None,
            "image_comfy_edit_prompt_map": None,
            "image_comfy_edit_image_map": None,
            "image_comfy_edit_seed_map": None,
            # Reserved for a future negative-prompt mapping; v1 ignores it.
            "image_comfy_negative_map": None,
        }

        if self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        if k not in ("context_mode", "context_threshold_pct"):
                            settings[k] = v
            except Exception:
                pass
        return settings

    def update_settings(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get_settings()
        merged = {**current, **updates}
        merged.pop("context_mode", None)
        merged.pop("context_threshold_pct", None)

        try:
            with open(self.settings_path, "w", encoding="utf-8") as f:
                json.dump(merged, f, indent=2)
            self.load_settings()
        except Exception as e:
            print(f"Failed to save settings: {e}")
        return merged

    def _get_manifest_rel_path(self, folder: str) -> str:
        folder_clean = folder.strip("/")
        return f"{folder_clean}/{folder_clean.upper()}.md"

    def _load_manifest(self, manifest_rel_path: str) -> Dict[str, str]:
        # Accept both forward and OS-native slashes
        manifest_path = self.workspace_dir / Path(manifest_rel_path)
        if not manifest_path.exists():
            return {}
        try:
            content = manifest_path.read_text(encoding="utf-8")
        except Exception:
            return {}
        mapping = {}
        for line in content.splitlines():
            m = re.match(r"^\s*-\s+(?:\*\*|)?([a-zA-Z0-9_\.\-]+)(?:\*\*|)?\s*(?:[—–:\-]+)\s*(.+)", line)
            if m:
                name = m.group(1).strip()
                desc = m.group(2).strip()
                mapping[name] = desc
                # Map keys both with and without .md extension
                if name.lower().endswith(".md"):
                    mapping[name[:-3]] = desc
                else:
                    mapping[f"{name}.md"] = desc
        return mapping

    def list_input_files(self) -> List[Dict[str, str]]:
        folders = []
        if self.workspace_dir.exists():
            for item in self.workspace_dir.iterdir():
                if item.is_dir() and not item.name.startswith(".") and item.name != "outputs":
                    folders.append(item.name)

        manifests = {}
        for folder in folders:
            folder_path = self.workspace_dir / folder
            manifest_file = folder_path / f"{folder.upper()}.md"
            if manifest_file.exists():
                manifests[f"{folder}/"] = self._load_manifest(f"{folder}/{manifest_file.name}")

        files = []
        for folder in folders:
            folder_path = self.workspace_dir / folder
            for f in folder_path.rglob("*.md"):
                # Always use forward-slash paths — safe on all platforms
                rel_path = _posix_rel(f, self.workspace_dir)
                desc = ""
                for prefix, manifest in manifests.items():
                    if rel_path.startswith(prefix):
                        desc = manifest.get(f.name, "")
                        break
                files.append({"name": f.name, "path": rel_path, "description": desc})
        files.sort(key=lambda f: f["path"])
        return files

    def _safe_resolve(self, path: str) -> Path:
        """Resolve a posix-style relative path to an absolute Path safely."""
        # Path() on Windows handles forward slashes fine
        full_path = (self.workspace_dir / Path(path)).resolve()
        workspace_root = self.workspace_dir.resolve()

        # Case-insensitive check on Windows
        try:
            full_path.relative_to(workspace_root)
        except ValueError:
            raise ValueError("Access denied")

        outputs_root = workspace_root / "outputs"
        try:
            full_path.relative_to(outputs_root)
            raise ValueError("Access denied")  # inside outputs — blocked
        except ValueError as e:
            if "Access denied" in str(e):
                raise

        if any(part.startswith(".") for part in full_path.parts):
            raise ValueError("Access denied")

        return full_path

    def read_input_file(self, path: str) -> str:
        full_path = self._safe_resolve(path)
        if not full_path.exists() or not full_path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        return full_path.read_text(encoding="utf-8")

    def create_input_file(self, folder: str, name: str, content: str = "") -> Dict[str, str]:
        folder = folder.strip("/")
        if not folder or folder.startswith(".") or ".." in folder or folder.split("/")[0] == "outputs":
            raise ValueError("Invalid folder name")

        name = (name or "").strip()
        if not name:
            raise ValueError("File name is required")
        if not name.lower().endswith(".md"):
            name = f"{name}.md"
        if "/" in name or "\\" in name or name.startswith(".") or ".." in name:
            raise ValueError("Invalid file name")

        target_dir = (self.workspace_dir / folder).resolve()
        try:
            target_dir.relative_to(self.workspace_dir.resolve())
        except ValueError:
            raise ValueError("Access denied")

        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / name
        if target_path.exists():
            raise FileExistsError(f"File already exists: {folder}/{name}")

        target_path.write_text(content or "", encoding="utf-8")
        rel_path = f"{folder}/{name}"  # always posix-style

        return {"name": name, "path": rel_path, "content": content or ""}

    def update_input_file(self, path: str, content: str) -> bool:
        target_path = self._safe_resolve(path)
        if not target_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        target_path.write_text(content or "", encoding="utf-8")
        return True

    def delete_input_file(self, path: str) -> bool:
        full_path = self._safe_resolve(path)
        if not full_path.exists() or not full_path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        if full_path.suffix.lower() != ".md":
            raise ValueError("Only markdown files can be deleted via this endpoint")
        full_path.unlink()
        return True

    def rename_input_file(self, path: str, new_name: str) -> Dict[str, str]:
        old_path = self._safe_resolve(path)
        if not old_path.exists() or not old_path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        if old_path.suffix.lower() != ".md":
            raise ValueError("Only markdown files can be renamed via this endpoint")

        new_name = (new_name or "").strip()
        if not new_name:
            raise ValueError("New file name is required")
        if not new_name.lower().endswith(".md"):
            new_name = f"{new_name}.md"
        if "/" in new_name or "\\" in new_name or new_name.startswith("."):
            raise ValueError("Invalid file name")
        if new_name == old_path.name:
            return {
                "name": old_path.name,
                "path": _posix_rel(old_path, self.workspace_dir.resolve()),
            }

        new_path = old_path.with_name(new_name)
        if new_path.exists():
            raise FileExistsError(f"File already exists: {_posix_rel(new_path, self.workspace_dir.resolve())}")
        old_path.rename(new_path)

        return {
            "name": new_path.name,
            "path": _posix_rel(new_path, self.workspace_dir.resolve()),
        }

    def _media_dir(self) -> Path:
        d = self.workspace_dir / "assets"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def generated_dir(self) -> Path:
        """Workspace assets/generated/ folder (created on demand)."""
        d = self._media_dir() / "generated"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _media_resolve(self, rel_path: str) -> Path:
        """Strictly resolve a path inside workspace/assets/ (no traversal)."""
        cleaned = (rel_path or "").replace("\\", "/").strip()
        if cleaned.startswith("assets/"):
            cleaned = cleaned[len("assets/"):]
        if not cleaned or cleaned.startswith((".", "/")) or ".." in cleaned.split("/"):
            raise ValueError("Access denied")
        full = (self._media_dir() / Path(cleaned)).resolve()
        try:
            full.relative_to(self._media_dir().resolve())
        except ValueError:
            raise ValueError("Access denied")
        return full

    def save_media_bytes(self, data: bytes, original_name: str = "",
                           content_type: str = "") -> Dict[str, str]:
        """Validate + persist image bytes. Returns {"name","path"} (posix rel)."""
        if not data:
            raise ValueError("Empty file")
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".margin-upload")
        try:
            tmp.write(data)
            tmp.close()
            return self.save_media_file(tmp.name, original_name, content_type)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    def save_media_file(self, path: str, original_name: str = "",
                        content_type: str = "") -> Dict[str, str]:
        """Validate + persist an image staged at `path`. Takes ownership:
        moves it into assets/ on success, removes it on validation failure.
        Lets callers stream arbitrarily large uploads to disk (bounded
        memory) with no user-facing size cap — local-first, user's own disk.
        """
        src = Path(path)
        try:
            if not src.exists() or src.stat().st_size == 0:
                raise ValueError("Empty file")
            with open(src, "rb") as f:
                head = f.read(12)
            sniffed = _sniff_image_ext(head)
            if sniffed is None:
                raise ValueError("Not a supported image (png, jpg, webp, gif)")
            # Trust magic bytes over the claimed name/type; normalize jpeg->jpg.
            ext = "jpg" if sniffed in ("jpg", "jpeg") else sniffed
            if content_type:
                main = content_type.split(";")[0].strip().lower()
                if main.startswith("image/") and main != EXT_TO_MIME[ext]:
                    # Claimed type disagrees with bytes — bytes win, still fine.
                    pass
            fname = f"{_slugify_media_name(original_name)}-{int(time.time())}.{ext}"
            target = self._media_dir() / fname
            shutil.move(str(src), str(target))
            return {"name": fname, "path": f"assets/{fname}"}
        except Exception:
            try:
                src.unlink()
            except OSError:
                pass
            raise

    def read_media(self, rel_path: str) -> Tuple[Path, str]:
        full = self._media_resolve(rel_path)
        if not full.exists() or not full.is_file():
            raise FileNotFoundError(f"Media not found: {rel_path}")
        ext = full.suffix.lower().lstrip(".")
        return full, EXT_TO_MIME.get(ext, "application/octet-stream")

    def save_generated_bytes(self, data: bytes,
                             content_type: str = "") -> Dict[str, str]:
        """Persist provider-generated image bytes to assets/generated/.

        Separate from the upload path on purpose: uploads slugify the
        user's filename into assets/, while generations use opaque ids
        (prompts are long, unicode, often duplicated — never filesystem
        metadata). Never overwrites: uuid4 collision retries.
        Validates magic bytes the same way uploads do.
        """
        import uuid

        if not data:
            raise ValueError("Empty file")
        sniffed = _sniff_image_ext(data[:12])
        if sniffed is None:
            raise ValueError("Not a supported image (png, jpg, webp, gif)")
        ext = "jpg" if sniffed in ("jpg", "jpeg") else sniffed
        if content_type:
            main = content_type.split(";")[0].strip().lower()
            if main.startswith("image/") and main != EXT_TO_MIME[ext]:
                pass  # bytes win, same as uploads
        gen_dir = self.generated_dir()
        for _ in range(5):
            fname = f"{uuid.uuid4().hex}.{ext}"
            target = gen_dir / fname
            if not target.exists():
                target.write_bytes(data)
                return {"name": fname, "path": f"assets/generated/{fname}"}
        raise ValueError("Could not allocate a generated asset name")

    def get_simple_ai_logs(self) -> list:
        logs_dir = self.outputs_dir / "ai_logs"
        all_logs = []
        if logs_dir.exists():
            for session_file in logs_dir.glob("*.json"):
                try:
                    with open(session_file, "r", encoding="utf-8") as f:
                        session_logs = json.load(f)
                        all_logs.extend(session_logs)
                except Exception:
                    pass
        all_logs.sort(key=lambda x: x.get("timestamp", ""))
        return all_logs

    def save_simple_ai_log(self, log_entry: dict) -> None:
        session_id = log_entry.get("session_id", "default")
        logs_dir = self.outputs_dir / "ai_logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        logs_path = logs_dir / f"{session_id}.json"

        logs = []
        if logs_path.exists():
            try:
                with open(logs_path, "r", encoding="utf-8") as f:
                    logs = json.load(f)
            except Exception:
                logs = []

        logs.append(log_entry)
        logs = logs[-100:]

        try:
            with open(logs_path, "w", encoding="utf-8") as f:
                json.dump(logs, f, indent=2)
        except Exception:
            pass

    def clear_simple_ai_logs(self) -> None:
        logs_dir = self.outputs_dir / "ai_logs"
        if logs_dir.exists():
            try:
                shutil.rmtree(logs_dir)
            except Exception:
                pass

    def delete_simple_ai_logs_by_session(self, session_id: str) -> None:
        logs_path = self.outputs_dir / f"ai_logs/{session_id}.json"
        if logs_path.exists():
            try:
                logs_path.unlink()
            except Exception:
                pass
        # A deleted Margin session must not resume a stale harness
        # conversation: drop the mapping too.
        self.clear_harness_session(session_id)

    def _image_logs_path(self):
        return self.outputs_dir / "image_logs" / "images.json"

    def get_image_logs(self) -> list:
        """Per-workspace image generation history (prompt, seed, asset).
        Separate from chat ai_logs — different shape, different consumer."""
        path = self._image_logs_path()
        if not path.exists():
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                logs = data if isinstance(data, list) else []
        except Exception:
            return []
        logs.sort(key=lambda x: x.get("timestamp", ""))
        return logs

    def save_image_log(self, log_entry: dict) -> None:
        import uuid

        path = self._image_logs_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        logs = self.get_image_logs()
        entry = dict(log_entry)
        entry.setdefault("id", uuid.uuid4().hex)
        logs.append(entry)
        logs = logs[-100:]
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(logs, f, indent=2)
        except Exception:
            pass

    def delete_image_log(self, log_id: str) -> bool:
        """Delete one image log entry by id."""
        path = self._image_logs_path()
        logs = self.get_image_logs()
        kept = [e for e in logs
                if not (isinstance(e, dict) and e.get("id") == log_id)]
        if len(kept) == len(logs):
            return False
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(kept, f, indent=2)
        except Exception:
            pass
        return True

    def _harness_sessions_path(self):
        return self.outputs_dir / "harness_sessions.json"

    def _load_harness_sessions(self) -> dict:
        path = self._harness_sessions_path()
        if not path.exists():
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def get_harness_session(self, session_id: str, harness_id: str) -> Optional[str]:
        """Harness-side conversation id for a Margin session, if resuming."""
        if not session_id:
            return None
        entry = self._load_harness_sessions().get(session_id) or {}
        val = entry.get(harness_id)
        return str(val) if val else None

    def set_harness_session(self, session_id: str, harness_id: str, harness_session_id: str) -> None:
        """Remember which harness conversation continues this Margin session."""
        if not session_id or not harness_session_id:
            return
        try:
            self.outputs_dir.mkdir(parents=True, exist_ok=True)
            data = self._load_harness_sessions()
            entry = data.get(session_id) or {}
            entry[harness_id] = harness_session_id
            data[session_id] = entry
            with open(self._harness_sessions_path(), "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Failed to save harness session mapping: {e}")

    def clear_harness_session(self, session_id: str, harness_id: Optional[str] = None) -> None:
        """Drop the resume mapping: next run starts a fresh conversation.

        Used when a resumed run fails (stale harness session) and when the
        Margin session is deleted.
        """
        if not session_id:
            return
        try:
            data = self._load_harness_sessions()
            if session_id not in data:
                return
            if harness_id:
                data[session_id].pop(harness_id, None)
                if not data[session_id]:
                    data.pop(session_id, None)
            else:
                data.pop(session_id, None)
            with open(self._harness_sessions_path(), "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Failed to clear harness session mapping: {e}")

    def create_workspace(
        self,
        target_path: str,
        init_git: bool = False,
    ) -> Dict[str, Any]:
        """Scaffold a new workspace directory.

        update_settings() is intentionally NOT called here — the caller
        (router) links the workspace after confirming success, so a git
        failure cannot leave the app pointed at a half-built workspace.
        """
        path_obj = Path(target_path).expanduser().resolve()
        if any(part.startswith(".") for part in path_obj.parts):
            raise ValueError("The selected path is not allowed as a workspace location.")

        # Create root workspace directory if it doesn't exist
        path_obj.mkdir(parents=True, exist_ok=True)

        # Subdirectories
        chapters_dir = path_obj / "chapters"
        characters_dir = path_obj / "characters"
        styles_dir = path_obj / "styles"
        prompts_dir = path_obj / "prompts"
        outputs_dir = path_obj / "outputs"
        assets_dir = path_obj / "assets"

        chapters_dir.mkdir(parents=True, exist_ok=True)
        characters_dir.mkdir(parents=True, exist_ok=True)
        styles_dir.mkdir(parents=True, exist_ok=True)
        prompts_dir.mkdir(parents=True, exist_ok=True)
        outputs_dir.mkdir(parents=True, exist_ok=True)
        assets_dir.mkdir(parents=True, exist_ok=True)

        # 1. Chapters
        chapters_manifest = chapters_dir / "CHAPTERS.md"
        if not chapters_manifest.exists():
            chapters_manifest.write_text(
                "- chapter-1.md — Chapter 1: Introduction. Opening scene.\n",
                encoding="utf-8"
            )
        chapter_1 = chapters_dir / "chapter-1.md"
        if not chapter_1.exists():
            chapter_1.write_text(
                "# Chapter 1\n\nBegin drafting your opening chapter here.\n",
                encoding="utf-8"
            )

        # 2. Characters
        characters_manifest = characters_dir / "CHARACTERS.md"
        if not characters_manifest.exists():
            characters_manifest.write_text(
                "- protagonist.md — Protagonist: Main character overview and motivations.\n",
                encoding="utf-8"
            )
        protagonist = characters_dir / "protagonist.md"
        if not protagonist.exists():
            protagonist.write_text(
                "# Protagonist\n\n## Overview\nMain character description, background, and motivation.\n\n## Key Traits\n- **Goal:** Core driving objective.\n- **Conflict:** Internal and external obstacles.\n",
                encoding="utf-8"
            )

        # 3. Styles
        styles_manifest = styles_dir / "STYLES.md"
        if not styles_manifest.exists():
            styles_manifest.write_text(
                "- general — General-purpose scene writing with balanced narration and action\n"
                "- cinematic — Full cinematic scene — narration sets the atmosphere, dialogue drives the conflict\n"
                "- superman — Heroic, inspirational tone — characters rising to meet impossible odds with dramatic, cinematic prose\n",
                encoding="utf-8"
            )

        sample_styles_dir = self.base_dir / "sample-workspace" / "styles"
        default_styles = {
            "general.md": (
                "## Writer Guidelines\n\n"
                "- Write clear, engaging prose\n"
                "- Balance narration, action, and character reaction\n"
                "- Maintain consistent voice and pacing\n"
                "- Use natural paragraph breaks for scene shifts\n\n"
                "## Narration Guidelines\n\n"
                "- Ground the scene physically before any emotional interiority\n"
                "- Use concrete, sensory detail — what characters see, hear, and feel\n"
                "- Keep action beats tight; one action per sentence for tension\n"
                "- Use character interiority sparingly: one key internal reaction per beat\n\n"
                "## Dialogue Guidelines\n\n"
                "- Characters speak in declarations, not questions\n"
                "- Dialogue builds toward a rallying cry or turning point\n"
                "- Use callbacks to earlier self-doubt for emotional payoff\n"
                "- One character inspires; the other resists before yielding\n"
                "- Short exchanges for tension, longer speeches for catharsis\n"
            ),
            "cinematic.md": (
                "## Narration Guidelines\n\n"
                "- Paint the environment with sensory detail — sight, sound, smell, texture\n"
                "- Use weather and light to mirror emotional subtext\n"
                "- Keep narration tight during dialogue, expansive during action beats\n"
                "- Camera moves like a film: wide shot → close-up on detail → reaction\n\n"
                "## Dialogue Guidelines\n\n"
                "- Characters speak in distinct rhythms — no two voices sound the same\n"
                "- Subtext over exposition; what they don't say matters more\n"
                "- Interruptions and pauses for realism\n"
                "- Power shifts mid-conversation (one character starts strong, ends defensive)\n\n"
                "## Writer Guidelines\n\n"
                "- Weave narration and dialogue into a seamless rhythm\n"
                "- Use paragraph breaks to control pacing — short paragraphs for tension\n"
                "- End each beat on a hook, image, or unresolved question\n"
                "- Match prose density to emotional intensity\n"
            ),
            "superman.md": (
                "## Tone & Atmosphere\n\n"
                "- Mythic, larger-than-life, soaring and earnest\n"
                "- Unapologetic heroism and moral clarity under extreme pressure\n"
                "- Contrast intimate human vulnerability against epic stakes\n\n"
                "## Narration Guidelines\n\n"
                "- Kinetic, sensory-rich descriptions of scale and momentum\n"
                "- Focus on sensory impact: sound of wind, blinding light, physical resonance\n"
                "- Ground extraordinary feats in physical toll and resolve\n\n"
                "## Dialogue Guidelines\n\n"
                "- Resonant, direct, and principled\n"
                "- Speech inspires hope and resolve in others\n"
                "- Quiet convictions delivered with calm certainty\n"
            )
        }
        for style_name, style_content in default_styles.items():
            style_file = styles_dir / style_name
            if not style_file.exists():
                src_file = sample_styles_dir / style_name
                if src_file.exists():
                    try:
                        shutil.copy2(src_file, style_file)
                    except Exception:
                        style_file.write_text(style_content, encoding="utf-8")
                else:
                    style_file.write_text(style_content, encoding="utf-8")

        # 4. Prompts
        sample_prompts_dir = self.base_dir / "prompts"
        if sample_prompts_dir.exists():
            for p_file in sample_prompts_dir.glob("*.md"):
                dest = prompts_dir / p_file.name
                if not dest.exists():
                    try:
                        shutil.copy2(p_file, dest)
                    except Exception:
                        pass

        # 5. Story State
        story_state_file = path_obj / "story_state.yaml"
        if not story_state_file.exists():
            story_state_file.write_text(
                "# Story State & Continuity Tracking\n"
                "current_chapter: \"chapter-1.md\"\n"
                "timeline: []\n"
                "key_items: []\n"
                "notes: \"Project workspace initialized.\"\n",
                encoding="utf-8"
            )

        # 6. Git initialization
        git_info: Dict[str, Any] = {
            "initialized": False,
            "committed": False,
            "already_tracked": False,
            "git_parent": None,
            "error": None,
        }
        if init_git:
            git_check = is_git_available()
            if not git_check["available"]:
                git_info["error"] = "Git is not installed or not available in PATH."
            else:
                git_bin = shutil.which("git") or "git"
                # Detect if target is already inside a git work tree to avoid embedded repos
                try:
                    res_toplevel = subprocess.run(
                        [git_bin, "rev-parse", "--show-toplevel"],
                        cwd=str(path_obj),
                        capture_output=True,
                        text=True,
                        timeout=5,
                    )
                    if res_toplevel.returncode == 0:
                        # Already inside a git work tree — skip init entirely
                        git_info["already_tracked"] = True
                        git_info["git_parent"] = res_toplevel.stdout.strip()
                        return {
                            "success": True,
                            "path": str(path_obj),
                            "git": git_info,
                        }
                except Exception:
                    # rev-parse failed → fresh directory, safe to init
                    pass

                # Always write/overwrite .gitignore before init
                gitignore_file = path_obj / ".gitignore"
                gitignore_file.write_text(
                    "outputs/\n"
                    ".DS_Store\n"
                    "Thumbs.db\n"
                    "*.tmp\n"
                    "*.log\n",
                    encoding="utf-8"
                )
                try:
                    subprocess.run(
                        [git_bin, "init"],
                        cwd=str(path_obj),
                        capture_output=True,
                        text=True,
                        timeout=10,
                        check=True,
                    )
                    git_info["initialized"] = True
                except Exception as e:
                    git_info["error"] = "git init failed."

                if git_info["initialized"]:
                    # git add + initial commit — non-fatal (missing user.name/email is common)
                    try:
                        subprocess.run(
                            [git_bin, "add", "."],
                            cwd=str(path_obj),
                            capture_output=True,
                            text=True,
                            timeout=10,
                            check=True,
                        )
                        res_commit = subprocess.run(
                            [git_bin, "commit", "-m", "Initial workspace scaffold"],
                            cwd=str(path_obj),
                            capture_output=True,
                            text=True,
                            timeout=10,
                        )
                        if res_commit.returncode == 0:
                            git_info["committed"] = True
                        else:
                            git_info["committed"] = False
                            stderr = res_commit.stderr.strip()
                            git_info["error"] = (
                                "Initial commit failed — Git user identity not configured. "
                                "Run: git config --global user.name / user.email"
                            ) if "user" in stderr.lower() else "Initial commit failed."
                    except Exception:
                        git_info["committed"] = False
                        git_info["error"] = "git add/commit failed."

        return {
            "success": True,
            "path": str(path_obj),
            "git": git_info,
        }



# Global singleton
storage = FileStorageService()
