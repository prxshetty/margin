import os
import json
import re
import shutil
import subprocess
import warnings
from pathlib import Path, PurePosixPath
from typing import List, Optional, Dict, Any
from datetime import datetime

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
            "show_additions": True,
            "show_deletions": True,
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

    def get_manifest_info_for_file(self, rel_path: str) -> Dict[str, Any]:
        parts = rel_path.replace("\\", "/").strip("/").split("/")
        if len(parts) <= 1:
            manifest_rel_path = "MANIFEST.md"
            manifest_file = self.workspace_dir / "MANIFEST.md"
        else:
            folder = parts[0]
            manifest_rel_path = self._get_manifest_rel_path(folder)
            manifest_file = self.workspace_dir / Path(manifest_rel_path)

        if not manifest_file.exists():
            return {
                "manifest_exists": False,
                "manifest_path": manifest_rel_path,
                "current_summary": "",
                "filename": parts[-1] if parts else rel_path,
            }

        manifest = self._load_manifest(manifest_rel_path)
        filename = parts[-1]
        summary = manifest.get(filename, "")
        if not summary and filename.lower().endswith(".md"):
            summary = manifest.get(filename[:-3], "")

        return {
            "manifest_exists": True,
            "manifest_path": manifest_rel_path,
            "current_summary": summary,
            "filename": filename,
        }

    def update_manifest_summary(self, rel_path: str, new_summary: str) -> Dict[str, Any]:
        info = self.get_manifest_info_for_file(rel_path)
        if not info["manifest_exists"]:
            raise ValueError(f"Manifest file does not exist for {rel_path}")

        manifest_rel_path = info["manifest_path"]
        manifest_path = self.workspace_dir / Path(manifest_rel_path)
        filename = info["filename"]
        target_name_no_ext = filename[:-3] if filename.lower().endswith(".md") else filename

        try:
            content = manifest_path.read_text(encoding="utf-8")
        except Exception as e:
            raise ValueError(f"Failed to read manifest file: {e}")

        lines = content.splitlines()
        found = False
        new_lines = []

        for line in lines:
            m = re.match(r"^\s*-\s+(?:\*\*|)?([a-zA-Z0-9_\.\-]+)(?:\*\*|)?\s*(?:[—–:\-]+)\s*(.+)", line)
            if m:
                item_name = m.group(1).strip()
                item_name_no_ext = item_name[:-3] if item_name.lower().endswith(".md") else item_name
                if item_name == filename or item_name_no_ext == target_name_no_ext:
                    new_lines.append(f"- {filename} — {new_summary.strip()}")
                    found = True
                    continue
            new_lines.append(line)

        if not found:
            if new_lines and not new_lines[-1].strip():
                new_lines.insert(len(new_lines) - 1, f"- {filename} — {new_summary.strip()}")
            else:
                new_lines.append(f"- {filename} — {new_summary.strip()}")

        updated_content = "\n".join(new_lines)
        if not updated_content.endswith("\n"):
            updated_content += "\n"

        manifest_path.write_text(updated_content, encoding="utf-8")

        return {
            "success": True,
            "manifest_path": manifest_rel_path,
            "filename": filename,
            "summary": new_summary.strip(),
        }

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
        # A deleted Margin session must not resume a stale harness
        # conversation: drop the mapping too.
        self.clear_harness_session(session_id)

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

    def is_git_repo(self) -> bool:
        """Check if the current workspace directory is inside a git work tree."""
        if not self.workspace_dir.exists() or not self.workspace_dir.is_dir():
            return False
        if (self.workspace_dir / ".git").exists():
            return True
        try:
            res = subprocess.run(
                ["git", "rev-parse", "--is-inside-work-tree"],
                cwd=str(self.workspace_dir),
                capture_output=True,
                text=True,
                timeout=5
            )
            return res.returncode == 0 and res.stdout.strip() == "true"
        except Exception:
            return False

    def get_diff_base(self, path: str) -> Dict[str, Any]:
        """Resolve the diff base content for a document."""
        full_path = self._safe_resolve(path)
        workspace_root = self.workspace_dir.resolve()
        rel_path = _posix_rel(full_path, workspace_root)
        current_content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
        is_git = self.is_git_repo()

        if is_git:
            # 1. Try staged index version: git show :./path or git show :path
            for spec in [f":./{rel_path}", f":{rel_path}"]:
                try:
                    res = subprocess.run(
                        ["git", "show", spec],
                        cwd=str(workspace_root),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=5
                    )
                    if res.returncode == 0:
                        return {"is_git": True, "base_content": res.stdout, "has_base": True, "is_new": False}
                except Exception:
                    pass

            # 2. Try committed HEAD version: git show HEAD:./path or git show HEAD:path
            for spec in [f"HEAD:./{rel_path}", f"HEAD:{rel_path}"]:
                try:
                    res = subprocess.run(
                        ["git", "show", spec],
                        cwd=str(workspace_root),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=5
                    )
                    if res.returncode == 0:
                        return {"is_git": True, "base_content": res.stdout, "has_base": True, "is_new": False}
                except Exception:
                    pass

            # Untracked in git — new file has no staged/committed baseline yet
            return {"is_git": True, "base_content": None, "has_base": False, "is_new": True}

        else:
            # Non-git workspace: shadow file copy in .margin-shadow/
            shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)
            if not shadow_path.exists():
                return {"is_git": False, "base_content": None, "has_base": False, "is_new": True}
            
            try:
                shadow_content = shadow_path.read_text(encoding="utf-8")
                return {"is_git": False, "base_content": shadow_content, "has_base": True, "is_new": False}
            except Exception:
                return {"is_git": False, "base_content": None, "has_base": False, "is_new": True}

    def get_workspace_status(self) -> Dict[str, Any]:
        """Get git/modification status for all files in the workspace.
        
        Returns:
            {
                "is_git": bool,
                "statuses": {
                    "chapters/chapter-1.md": "unstaged_modified" | "staged" | "staged_modified" | "clean",
                    ...
                }
            }
        """
        if not self.workspace_dir.exists() or not self.workspace_dir.is_dir():
            return {"is_git": False, "statuses": {}}

        workspace_root = self.workspace_dir.resolve()
        is_git = self.is_git_repo()
        statuses: Dict[str, str] = {}

        if is_git:
            try:
                # Fast path: check if workspace root has .git directly
                if (workspace_root / ".git").exists():
                    git_root = workspace_root
                else:
                    # Find git root to properly resolve porcelain paths
                    res_top = subprocess.run(
                        ["git", "rev-parse", "--show-toplevel"],
                        cwd=str(workspace_root),
                        capture_output=True,
                        text=True,
                        timeout=5,
                    )
                    git_root = Path(res_top.stdout.strip()).resolve() if res_top.returncode == 0 else workspace_root

                res = subprocess.run(
                    ["git", "status", "--porcelain=v1", "-uall", "-z", "."],
                    cwd=str(workspace_root),
                    capture_output=True,
                    timeout=5,
                )
                if res.returncode == 0:
                    raw = res.stdout
                    i = 0
                    n = len(raw)
                    while i < n:
                        if i + 3 > n:
                            break
                        x = chr(raw[i])
                        y = chr(raw[i + 1])
                        path_end = raw.find(b"\0", i + 3)
                        if path_end == -1:
                            path_bytes = raw[i + 3:]
                            i = n
                        else:
                            path_bytes = raw[i + 3:path_end]
                            i = path_end + 1

                        git_rel_path = path_bytes.decode("utf-8", errors="replace").replace("\\", "/")
                        if x == "R":
                            second_end = raw.find(b"\0", i)
                            if second_end != -1:
                                git_rel_path = raw[i:second_end].decode("utf-8", errors="replace").replace("\\", "/")
                                i = second_end + 1

                        full_path = (git_root / Path(git_rel_path)).resolve()
                        try:
                            w_rel = _posix_rel(full_path, workspace_root)
                            if x in ("M", "A", "R", "C") and y in ("M", "D"):
                                st = "staged_modified"
                            elif x in ("M", "A", "R", "C") and y == " ":
                                st = "staged"
                            elif (x == " " and y in ("M", "D")) or (x == "?" and y == "?"):
                                st = "unstaged_modified"
                            else:
                                st = "unstaged_modified" if (y != " " or x != " ") else "clean"

                            statuses[w_rel] = st
                        except ValueError:
                            pass
            except Exception as e:
                print(f"Failed to get git status: {e}")

        else:
            # Non-git workspace: compare files with .margin-shadow/
            try:
                files = self.list_input_files()
                for file_info in files:
                    rel_path = file_info["path"]
                    full_path = workspace_root / Path(rel_path)
                    shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)

                    if not shadow_path.exists():
                        statuses[rel_path] = "unstaged_modified"
                    else:
                        try:
                            current_text = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
                            shadow_text = shadow_path.read_text(encoding="utf-8")
                            if current_text == shadow_text:
                                statuses[rel_path] = "clean"
                            else:
                                statuses[rel_path] = "unstaged_modified"
                        except Exception:
                            statuses[rel_path] = "unstaged_modified"
            except Exception as e:
                print(f"Failed to get non-git shadow status: {e}")

        return {
            "is_git": is_git,
            "statuses": statuses,
        }

    def stage_file(self, path: str, content: Optional[str] = None) -> Dict[str, Any]:
        """Stage the document in git or update the shadow copy in non-git."""
        full_path = self._safe_resolve(path)
        workspace_root = self.workspace_dir.resolve()
        rel_path = _posix_rel(full_path, workspace_root)

        if content is not None:
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content, encoding="utf-8")
        else:
            content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""

        is_git = self.is_git_repo()
        if is_git:
            try:
                res = subprocess.run(
                    ["git", "add", f"./{rel_path}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=10
                )
                if res.returncode != 0:
                    # Fallback to direct rel_path
                    res = subprocess.run(
                        ["git", "add", rel_path],
                        cwd=str(workspace_root),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=10
                    )
                if res.returncode != 0:
                    raise RuntimeError(f"git add failed: {res.stderr}")
                
                # Fetch staged content
                staged_content = content
                for spec in [f":./{rel_path}", f":{rel_path}"]:
                    res_show = subprocess.run(
                        ["git", "show", spec],
                        cwd=str(workspace_root),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=5
                    )
                    if res_show.returncode == 0:
                        staged_content = res_show.stdout
                        break
                return {"success": True, "is_git": True, "base_content": staged_content}
            except Exception as e:
                print(f"Git stage error: {e}")
                return {"success": True, "is_git": True, "base_content": content}

        else:
            shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)
            shadow_path.parent.mkdir(parents=True, exist_ok=True)
            shadow_path.write_text(content, encoding="utf-8")
            return {"success": True, "is_git": False, "base_content": content}

    def restore_file(self, path: str) -> Dict[str, Any]:
        """Restore a file to its staged/snapshot baseline version."""
        full_path = self._safe_resolve(path)
        workspace_root = self.workspace_dir.resolve()
        rel_path = _posix_rel(full_path, workspace_root)
        is_git = self.is_git_repo()

        if is_git:
            # 1. Try checking out from git index (staged)
            res = subprocess.run(
                ["git", "checkout", "--", f"./{rel_path}"],
                cwd=str(workspace_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
            )
            if res.returncode != 0:
                # 2. Try checking out from HEAD
                res = subprocess.run(
                    ["git", "checkout", "HEAD", "--", f"./{rel_path}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=10,
                )
            if res.returncode != 0:
                # 3. Fallback: try git restore
                res = subprocess.run(
                    ["git", "restore", f"./{rel_path}"],
                    cwd=str(workspace_root),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=10,
                )

            restored_content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
            return {"success": True, "is_git": True, "restored_content": restored_content, "base_content": restored_content}

        else:
            shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)
            if shadow_path.exists():
                shadow_content = shadow_path.read_text(encoding="utf-8")
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text(shadow_content, encoding="utf-8")
                return {"success": True, "is_git": False, "restored_content": shadow_content, "base_content": shadow_content}
            else:
                restored_content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
                return {"success": True, "is_git": False, "restored_content": restored_content, "base_content": restored_content}

    def commit_changes(self, path: Optional[str], title: str, comment: Optional[str] = None) -> Dict[str, Any]:
        """Commit changes in the git repository."""
        if not self.is_git_repo():
            raise ValueError("Not a git repository")

        workspace_root = self.workspace_dir.resolve()
        title = (title or "").strip()
        if not title:
            raise ValueError("Commit title is required")

        cmd = [
            "git",
            "-c", "user.name=Margin User",
            "-c", "user.email=margin@local",
            "commit",
            "-m", title,
        ]
        if comment and comment.strip():
            cmd.extend(["-m", comment.strip()])

        res = subprocess.run(
            cmd,
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
        )
        if res.returncode != 0:
            err = res.stderr or res.stdout
            if "nothing to commit" not in err.lower():
                raise RuntimeError(f"Git commit failed: {err}")

        # Get commit hash
        res_hash = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(workspace_root),
            capture_output=True,
            text=True,
            timeout=5,
        )
        commit_hash = res_hash.stdout.strip() if res_hash.returncode == 0 else ""

        # Get updated base content for the file
        new_base = None
        if path:
            full_path = self._safe_resolve(path)
            new_base = full_path.read_text(encoding="utf-8") if full_path.exists() else ""

        return {
            "success": True,
            "commit_hash": commit_hash,
            "base_content": new_base,
        }

    def create_workspace(
        self,
        target_path: str,
        init_git: bool = False,
        set_as_active: bool = True
    ) -> Dict[str, Any]:
        path_obj = Path(target_path).expanduser().resolve()

        # Create root workspace directory if it doesn't exist
        path_obj.mkdir(parents=True, exist_ok=True)

        # Subdirectories
        chapters_dir = path_obj / "chapters"
        characters_dir = path_obj / "characters"
        styles_dir = path_obj / "styles"
        prompts_dir = path_obj / "prompts"
        outputs_dir = path_obj / "outputs"

        chapters_dir.mkdir(parents=True, exist_ok=True)
        characters_dir.mkdir(parents=True, exist_ok=True)
        styles_dir.mkdir(parents=True, exist_ok=True)
        prompts_dir.mkdir(parents=True, exist_ok=True)
        outputs_dir.mkdir(parents=True, exist_ok=True)

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
        git_info = {"initialized": False, "committed": False, "error": None}
        if init_git:
            git_check = is_git_available()
            if not git_check["available"]:
                git_info["error"] = "Git is not installed or not available in PATH."
            else:
                gitignore_file = path_obj / ".gitignore"
                if not gitignore_file.exists():
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
                        ["git", "init"],
                        cwd=str(path_obj),
                        capture_output=True,
                        text=True,
                        check=True
                    )
                    git_info["initialized"] = True
                except Exception as e:
                    git_info["error"] = str(e)

        # 7. If not a git repo, populate .margin-shadow/ snapshots so auto-created files start clean
        if not git_info["initialized"]:
            shadow_root = path_obj / ".margin-shadow"
            for folder_name in ["chapters", "characters", "styles", "prompts"]:
                folder_dir = path_obj / folder_name
                if folder_dir.exists():
                    for f in folder_dir.rglob("*.md"):
                        if f.is_file() and not f.name.startswith("."):
                            rel = _posix_rel(f, path_obj)
                            shadow_dest = shadow_root / Path(rel)
                            shadow_dest.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(f, shadow_dest)

        # 8. Set as active workspace if requested
        if set_as_active:
            self.update_settings({"linked_workspace_dir": str(path_obj)})

        return {
            "success": True,
            "path": str(path_obj),
            "git": git_info,
            "set_as_active": set_as_active
        }


# Global singleton
storage = FileStorageService()
