import os
import json
import re
import shutil
import warnings
from pathlib import Path, PurePosixPath
from typing import List, Optional, Dict, Any
from datetime import datetime

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
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def get_settings(self) -> Dict[str, Any]:
        settings = {
            "linked_workspace_dir": None,
            "is_thinking": True,
            "prepend_thinking_preamble": False,
            "dialogue_density": 0.5,
            "additional_context": "",
            "default_mode": "edit",
            "default_verbosity": "balanced",
            "show_thinking_by_default": False,
            "pinned_ref_files": [],
            "ignored_ref_files": [],
            "endpoints": {},
            "active_endpoint": None,
            "theme": "light",
            "theme_family": "sand",
            "text_style": "system",
            "editor_stats": "both",
            "planner_include_outline": False,
            "history_turns": 5
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


# Global singleton
storage = FileStorageService()
