import os
import json
import re
import yaml
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime

class FileStorageService:
    def __init__(self, base_dir: str = "."):
        self.base_dir = Path(base_dir)
        self.settings_path = self.base_dir / "settings.json"
        self.inputs_dir = self.base_dir / "inputs"
        self.outputs_dir = self.base_dir / "outputs"
        self.load_settings()

    def load_settings(self):
        if self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    custom_inputs = settings.get("linked_inputs_dir")
                    if custom_inputs:
                        p = Path(custom_inputs)
                        if p.exists() and p.is_dir():
                            self.inputs_dir = p
                            custom_outputs = settings.get("linked_outputs_dir")
                            if custom_outputs:
                                self.outputs_dir = Path(custom_outputs)
                            else:
                                self.outputs_dir = p.parent / "outputs"
            except Exception as e:
                print(f"Error loading settings: {e}")
        
        # Ensure directories exist
        (self.inputs_dir / "chapters").mkdir(parents=True, exist_ok=True)
        (self.inputs_dir / "characters").mkdir(parents=True, exist_ok=True)
        (self.inputs_dir / "styles").mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def get_settings(self) -> Dict[str, Any]:
        settings = {
            "linked_inputs_dir": None,
            "linked_outputs_dir": None,
            "reasoning_model": True,
            "prepend_thinking_preamble": False,  # Off by default!
            "dialogue_density": 0.5,
            "additional_context": "",
            "tone_preset": "general",
            "default_mode": "edit",
            "default_verbosity": "balanced",
            "show_thinking_by_default": False,
            "pinned_ref_files": [],
            "endpoints": {},
            "active_endpoint": None,
            "theme": "light",
            "theme_family": "sand",
            "text_style": "system"
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
        except Exception as e:
            print(f"Failed to save settings: {e}")
        return merged

    def _read_frontmatter_description(self, full_path: Path) -> str:
        try:
            content = full_path.read_text(encoding="utf-8")
            m = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
            if m:
                fm = yaml.safe_load(m.group(1))
                return fm.get("description", "") if isinstance(fm, dict) else ""
        except Exception:
            pass
        return ""

    def list_input_files(self) -> List[Dict[str, str]]:
        files = []
        for f in self.inputs_dir.rglob("*.md"):
            rel_path = str(f.relative_to(self.inputs_dir))
            desc = self._read_frontmatter_description(f)
            files.append({"name": f.name, "path": rel_path, "description": desc})
        files.sort(key=lambda f: f["path"])
        return files

    def read_input_file(self, path: str) -> str:
        full_path = self.inputs_dir / path
        if not full_path.exists() or not full_path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        return full_path.read_text(encoding="utf-8")

    _ALLOWED_INPUT_SUBDIRS = {"chapters", "characters", "styles"}

    def create_input_file(self, folder: str, name: str, content: str = "") -> Dict[str, str]:
        if folder not in self._ALLOWED_INPUT_SUBDIRS:
            raise ValueError(f"Invalid folder '{folder}'. Must be one of: {sorted(self._ALLOWED_INPUT_SUBDIRS)}")

        name = (name or "").strip()
        if not name:
            raise ValueError("File name is required")
        if not name.lower().endswith(".md"):
            name = f"{name}.md"
        if "/" in name or "\\" in name or name.startswith("."):
            raise ValueError("Invalid file name")

        target_dir = self.inputs_dir / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / name
        if target_path.exists():
            raise FileExistsError(f"File already exists: {folder}/{name}")

        target_path.write_text(content or "", encoding="utf-8")
        rel_path = f"{folder}/{name}"
        return {"name": name, "path": rel_path, "content": content or ""}

    def delete_input_file(self, path: str) -> bool:
        full_path = (self.inputs_dir / path).resolve()
        inputs_root = self.inputs_dir.resolve()
        if not str(full_path).startswith(str(inputs_root)):
            raise ValueError("Invalid path")
        if not full_path.exists() or not full_path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        if full_path.suffix.lower() != ".md":
            raise ValueError("Only markdown files can be deleted via this endpoint")
        full_path.unlink()
        return True

    def rename_input_file(self, path: str, new_name: str) -> Dict[str, str]:
        old_path = (self.inputs_dir / path).resolve()
        inputs_root = self.inputs_dir.resolve()
        if not str(old_path).startswith(str(inputs_root)):
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
            return {"name": old_path.name, "path": str(old_path.relative_to(inputs_root))}

        new_path = old_path.with_name(new_name)
        if new_path.exists():
            raise FileExistsError(f"File already exists: {new_path.relative_to(inputs_root)}")
        old_path.rename(new_path)
        new_rel = str(new_path.relative_to(inputs_root))
        return {"name": new_path.name, "path": new_rel}

    def get_simple_ai_logs(self) -> list:
        logs_path = self.outputs_dir / "simple_ai_logs.json"
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
