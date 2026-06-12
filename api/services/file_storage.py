import os
import json
import re
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime
from style_loader import read_styles_md

class FileStorageService:
    def __init__(self, base_dir: str = "."):
        self.base_dir = Path(base_dir)
        self.settings_path = self.base_dir / "settings.json"
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
            "reasoning_model": True,
            "prepend_thinking_preamble": False,  # Off by default!
            "dialogue_density": 0.5,
            "additional_context": "",
            "tone_preset": "general",
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
            "show_outline": True,
            "planner_include_outline": False,
            "folder_strategies": {"styles": "guideline", "characters": "context_block", "chapters": "context_block"},
            "default_folder_strategy": "context_block"
        }
        if self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        settings[k] = v
            except Exception:
                pass
        return settings

    def update_settings(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get_settings()
        merged = {**current, **updates}
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
        manifest_path = self.workspace_dir / manifest_rel_path
        if not manifest_path.exists():
            return {}
        try:
            content = manifest_path.read_text(encoding="utf-8")
        except Exception:
            return {}
        mapping = {}
        for line in content.splitlines():
            m = re.match(r"^\s*-\s+(\S+)\s*[—–-]\s*(.+)", line)
            if m:
                mapping[m.group(1)] = m.group(2).strip()
        return mapping

    def _get_style_descriptions(self) -> Dict[str, str]:
        style_map = read_styles_md(path=self.workspace_dir / "styles" / "STYLES.md")
        return {f"{k}.md": v for k, v in style_map.items()}

    def _add_to_manifest(self, folder: str, name: str, content: str) -> None:
        folder_clean = folder.strip("/")
        manifest_rel_path = self._get_manifest_rel_path(folder_clean)
        
        manifest_path = self.workspace_dir / manifest_rel_path
        # Create parent directory if it doesn't exist
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Determine initial template content if manifest doesn't exist
        if not manifest_path.exists():
            if folder_clean == "styles":
                manifest_content = "# Available Styles\n\nUse these style tags when annotating scene_events.\n\n"
            else:
                manifest_content = f"# Available {folder_clean.capitalize()}\n\n"
        else:
            try:
                manifest_content = manifest_path.read_text(encoding="utf-8")
            except Exception:
                manifest_content = ""
        
        stem = Path(name).stem
        
        if folder_clean == "styles":
            pattern = rf"^\s*-\s+\*\*{re.escape(stem)}\*\*(.*)"
            new_line = f"- **{stem}** — "
        else:
            pattern = rf"^\s*-\s+{re.escape(name)}(.*)"
            new_line = f"- {name} — "
            
        lines = manifest_content.splitlines()
        found_idx = -1
        for idx, line in enumerate(lines):
            if re.match(pattern, line):
                found_idx = idx
                break
                
        if found_idx != -1:
            lines[found_idx] = new_line
        else:
            # clean trailing empty lines first
            while lines and not lines[-1].strip():
                lines.pop()
            lines.append(new_line)
            
        manifest_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _remove_from_manifest(self, folder: str, name: str) -> None:
        folder_clean = folder.strip("/")
        manifest_rel_path = self._get_manifest_rel_path(folder_clean)
        
        manifest_path = self.workspace_dir / manifest_rel_path
        if not manifest_path.exists():
            return
            
        try:
            manifest_content = manifest_path.read_text(encoding="utf-8")
        except Exception:
            return
            
        stem = Path(name).stem
        if folder_clean == "styles":
            pattern = rf"^\s*-\s+\*\*{re.escape(stem)}\*\*(.*)"
        else:
            pattern = rf"^\s*-\s+{re.escape(name)}(.*)"
            
        lines = manifest_content.splitlines()
        new_lines = [line for line in lines if not re.match(pattern, line)]
        
        manifest_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    def _rename_in_manifest(self, folder: str, old_name: str, new_name: str) -> None:
        folder_clean = folder.strip("/")
        manifest_rel_path = self._get_manifest_rel_path(folder_clean)
        
        manifest_path = self.workspace_dir / manifest_rel_path
        if not manifest_path.exists():
            # If manifest doesn't exist, just add the new file to a new manifest
            self._add_to_manifest(folder, new_name, "")
            return
            
        try:
            manifest_content = manifest_path.read_text(encoding="utf-8")
        except Exception:
            return
            
        old_stem = Path(old_name).stem
        new_stem = Path(new_name).stem
        
        lines = manifest_content.splitlines()
        found = False
        for idx, line in enumerate(lines):
            if folder_clean == "styles":
                m = re.match(rf"^(\s*-\s+\*\*){re.escape(old_stem)}(\*\*)(.*)", line)
                if m:
                    prefix = m.group(1)
                    suffix = m.group(3)
                    lines[idx] = f"{prefix}{new_stem}**{suffix}"
                    found = True
                    break
            else:
                m = re.match(rf"^(\s*-\s+){re.escape(old_name)}(.*)", line)
                if m:
                    prefix = m.group(1)
                    suffix = m.group(2)
                    lines[idx] = f"{prefix}{new_name}{suffix}"
                    found = True
                    break
                    
        if found:
            manifest_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        else:
            # Self-healing fallback: add the new file name if the old was not found
            self._add_to_manifest(folder, new_name, "")

    def list_input_files(self) -> List[Dict[str, str]]:
        # Find all valid directories under self.workspace_dir (excluding outputs and hidden folders)
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
        
        style_desc = self._get_style_descriptions()
        files = []
        for folder in folders:
            folder_path = self.workspace_dir / folder
            for f in folder_path.rglob("*.md"):
                rel_path = str(f.relative_to(self.workspace_dir))
                desc = ""
                if rel_path.startswith("styles/"):
                    desc = style_desc.get(f.name, "")
                else:
                    for prefix, manifest in manifests.items():
                        if rel_path.startswith(prefix):
                            desc = manifest.get(f.name, "")
                            break
                files.append({"name": f.name, "path": rel_path, "description": desc})
        files.sort(key=lambda f: f["path"])
        return files

    def read_input_file(self, path: str) -> str:
        full_path = (self.workspace_dir / path).resolve()
        workspace_root = self.workspace_dir.resolve()
        if not str(full_path).startswith(str(workspace_root)) or str(full_path).startswith(str(workspace_root / "outputs")) or any(part.startswith(".") for part in full_path.parts):
            raise ValueError("Access denied")
        if not full_path.exists() or not full_path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        return full_path.read_text(encoding="utf-8")

    def create_input_file(self, folder: str, name: str, content: str = "") -> Dict[str, str]:
        folder = folder.strip("/")
        if not folder or folder == "outputs" or folder.startswith(".") or "/" in folder or "\\" in folder:
            raise ValueError("Invalid folder name")

        name = (name or "").strip()
        if not name:
            raise ValueError("File name is required")
        if not name.lower().endswith(".md"):
            name = f"{name}.md"
        if "/" in name or "\\" in name or name.startswith("."):
            raise ValueError("Invalid file name")

        target_dir = self.workspace_dir / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / name
        if target_path.exists():
            raise FileExistsError(f"File already exists: {folder}/{name}")

        target_path.write_text(content or "", encoding="utf-8")
        rel_path = f"{folder}/{name}"

        # Update manifest
        try:
            self._add_to_manifest(folder, name, content or "")
        except Exception as e:
            print(f"Failed to sync manifest for created file {folder}/{name}: {e}")

        return {"name": name, "path": rel_path, "content": content or ""}

    def update_input_file(self, path: str, content: str) -> bool:
        target_path = self.workspace_dir / path
        if not target_path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        target_path.write_text(content or "", encoding="utf-8")
        return True
    def delete_input_file(self, path: str) -> bool:
        full_path = (self.workspace_dir / path).resolve()
        workspace_root = self.workspace_dir.resolve()
        if not str(full_path).startswith(str(workspace_root)) or str(full_path).startswith(str(workspace_root / "outputs")) or any(part.startswith(".") for part in full_path.parts):
            raise ValueError("Invalid path")
        if not full_path.exists() or not full_path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        if full_path.suffix.lower() != ".md":
            raise ValueError("Only markdown files can be deleted via this endpoint")
        full_path.unlink()

        # Update manifest
        rel_path = str(full_path.relative_to(workspace_root))
        parts = rel_path.split("/")
        if len(parts) >= 2:
            folder = parts[0]
            name = parts[-1]
            try:
                self._remove_from_manifest(folder, name)
            except Exception as e:
                print(f"Failed to sync manifest for deleted file {path}: {e}")

        return True

    def rename_input_file(self, path: str, new_name: str) -> Dict[str, str]:
        old_path = (self.workspace_dir / path).resolve()
        workspace_root = self.workspace_dir.resolve()
        if not str(old_path).startswith(str(workspace_root)) or str(old_path).startswith(str(workspace_root / "outputs")) or any(part.startswith(".") for part in old_path.parts):
            raise ValueError("Invalid path")
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
            return {"name": old_path.name, "path": str(old_path.relative_to(workspace_root))}

        new_path = old_path.with_name(new_name)
        if new_path.exists():
            raise FileExistsError(f"File already exists: {new_path.relative_to(workspace_root)}")
        old_path.rename(new_path)
        new_rel = str(new_path.relative_to(workspace_root))

        # Update manifest
        rel_old = str(old_path.relative_to(workspace_root))
        old_parts = rel_old.split("/")
        if len(old_parts) >= 2:
            folder = old_parts[0]
            old_name = old_parts[-1]
            try:
                self._rename_in_manifest(folder, old_name, new_name)
            except Exception as e:
                print(f"Failed to sync manifest for renamed file {path} to {new_name}: {e}")

        return {"name": new_path.name, "path": new_rel}

    def get_simple_ai_logs(self) -> list:
        logs_path = self.workspace_dir / "outputs/simple_ai_logs.json"
        if not logs_path.exists():
            return []
        try:
            with open(logs_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def save_simple_ai_log(self, log_entry: dict) -> None:
        logs_path = self.outputs_dir / "simple_ai_logs.json"
        logs = []
        if logs_path.exists():
            try:
                with open(logs_path, "r", encoding="utf-8") as f:
                    logs = json.load(f)
            except Exception:
                logs = []
        logs.append(log_entry)
        logs = logs[-100:]  # Keep last 100 simple assist logs for debugging
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(logs_path, "w", encoding="utf-8") as f:
                json.dump(logs, f, indent=2)
        except Exception:
            pass

    def clear_simple_ai_logs(self) -> None:
        logs_path = self.outputs_dir / "simple_ai_logs.json"
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(logs_path, "w", encoding="utf-8") as f:
                json.dump([], f)
        except Exception:
            pass

    def delete_simple_ai_logs_by_session(self, session_id: str) -> None:
        logs_path = self.outputs_dir / "simple_ai_logs.json"
        if not logs_path.exists():
            return
        try:
            with open(logs_path, "r", encoding="utf-8") as f:
                logs = json.load(f)
                filtered = [log for log in logs if log.get("session_id") != session_id]
                with open(logs_path, "w", encoding="utf-8") as f:
                    json.dump(filtered, f, indent=2)
        except Exception:
            pass

# Global singleton
storage = FileStorageService()
