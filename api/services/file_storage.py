import os
import sys
import json
import re
import shutil
import tempfile
import time
import subprocess
import warnings
from datetime import datetime, timezone, timedelta
from pathlib import Path, PurePosixPath
from typing import List, Optional, Dict, Any, Tuple

LEGACY_IMAGE_KEYS = ("image_provider", "image_base_url", "image_api_key", "image_model")


def _migrate_image_endpoints(data: Dict[str, Any]) -> None:
    """One-time migration: legacy singleton image keys -> image_endpoints.

    Mutates the loaded settings dict in place. There is no runtime fallback:
    the resolver only reads image_endpoints/active_image_endpoint.
    Pristine defaults migrate to an empty list; a configured singleton
    becomes a single entry named after its provider type.
    """
    if "image_endpoints" in data or "active_image_endpoint" in data:
        for k in LEGACY_IMAGE_KEYS:
            data.pop(k, None)
        return
    provider = str(data.get("image_provider") or "openai-compatible").strip().lower() or "openai-compatible"
    base_url = str(data.get("image_base_url") or "").strip()
    api_key = str(data.get("image_api_key") or "")
    model = str(data.get("image_model") or "").strip()
    if provider == "openai-compatible" and not base_url and not api_key and not model:
        data["image_endpoints"] = {}
        data["active_image_endpoint"] = None
    else:
        entry_id = provider.replace("-", "_") or "openai_compatible"
        data["image_endpoints"] = {
            entry_id: {"provider": provider, "base_url": base_url, "api_key": api_key, "model": model}
        }
        data["active_image_endpoint"] = entry_id
    for k in LEGACY_IMAGE_KEYS:
        data.pop(k, None)


from api.services import git_service
from api.services.git_service import is_git_available, _init_git_repo


def _is_subpath(target: Path, base: Path) -> bool:
    try:
        t_res = target.resolve()
        b_res = base.resolve()
        if sys.platform in ("win32", "darwin"):
            t_res = Path(str(t_res).lower())
            b_res = Path(str(b_res).lower())
        return t_res == b_res or b_res in t_res.parents
    except Exception:
        return False


def _validate_workspace_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("Workspace name is required.")
    if cleaned in (".", "..") or "/" in cleaned or "\\" in cleaned or cleaned.startswith("."):
        raise ValueError("Workspace name must be a single folder name without path separators.")
    return cleaned


def _resolve_workspace_create_target(parent_path: str, name: str) -> Path:
    raw_parent = (parent_path or "").strip()
    if not raw_parent:
        raise ValueError("Parent workspace path is required.")

    parent_input = Path(raw_parent).expanduser()
    if not parent_input.is_absolute():
        raise ValueError("Parent workspace path must be absolute.")
    try:
        parent_resolved = parent_input.resolve()
    except Exception:
        raise ValueError("Invalid parent workspace path.")

    target = (parent_resolved / _validate_workspace_name(name)).resolve()
    if any(part.startswith(".") for part in target.parts):
        raise ValueError("The selected path is not allowed as a workspace location.")

    for blocked in _SENSITIVE_PATH_PREFIXES:
        try:
            blocked_resolved = blocked.expanduser().resolve()
        except Exception:
            continue
        if _is_subpath(target, blocked_resolved):
            raise ValueError("The selected path is not allowed as a workspace location.")

    if target == target.parent or target == Path.home().resolve():
        raise ValueError("Root directories and home directory root cannot be used as a workspace.")

    if not parent_resolved.exists() or not parent_resolved.is_dir():
        raise ValueError("The selected parent directory does not exist.")

    if target.exists():
        if not target.is_dir():
            raise ValueError("Workspace path must be a directory.")
        try:
            if any(target.iterdir()):
                raise ValueError("The selected directory is not empty. Please select an empty directory or specify a new folder name.")
        except OSError:
            raise ValueError("Cannot inspect the selected directory.")
    return target


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


def _parse_log_time(value: Any) -> Optional[datetime]:
    """Normalize a log timestamp to UTC; None when missing or unparsable."""
    try:
        parsed = datetime.fromisoformat(str(value or ""))
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_manifest_file(path: str) -> bool:
    """True for scaffold manifests like chapters/CHAPTERS.md.

    A manifest is an .md file whose stem matches its parent folder name
    (case-insensitive). Root-level files never count as manifests.
    """
    parts = Path(path)
    return (
        parts.suffix.lower() == ".md"
        and parts.parent.name != ""
        and parts.stem.upper() == parts.parent.name.upper()
    )


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


def _normalize_markdown_content(text: str) -> str:
    """Normalize markdown content for comparison across editors and platforms.

    Normalizes:
    - Line endings (\r\n -> \n)
    - Heading spacing (ensures blank line between heading and following content block)
    - Consecutive empty lines
    - Trailing whitespace on lines and trailing newlines at EOF
    """
    if not text:
        return ""
    text = text.replace("\r\n", "\n")
    # Normalize heading followed immediately by content (ensure blank line between blocks)
    text = re.sub(r"(^|\n)(#{1,6}\s+[^\n]+)\n([^\n])", r"\1\2\n\n\3", text)
    # Collapse 3+ newlines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Strip trailing whitespace on each line and strip overall trailing newlines
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def _write_text_lf(path: Path, content: str) -> None:
    """Write text file with explicit LF (\n) line endings and trailing EOF newline across all platforms."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = (content or "").replace("\r\n", "\n")
    if text and not text.endswith("\n"):
        text += "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)



MANIFEST_ENTRY_REGEX = re.compile(
    r"^\s*[-*]\s+(?:\*\*|)?([a-zA-Z0-9_\.\-]+)(?:\*\*|)?\s*(?:[—–:\-]+)\s*(.+)$"
)


def is_manifest_path(rel_path: str) -> bool:
    """Check if a path corresponds to a section manifest file (<folder>/<FOLDER>.md)."""
    cleaned = (rel_path or "").replace("\\", "/").strip("/")
    parts = cleaned.split("/")
    if len(parts) != 2:
        return False
    folder, filename = parts
    return filename.upper() == f"{folder.upper()}.MD"


def validate_manifest_content(content: str, max_reported: int = 5) -> Dict[str, Any]:
    """Validate a manifest file's contents for adherence to the expected format.

    Valid lines are:
    - Blank or whitespace only
    - An entry matching: - filename.md — Description (or style_identifier — Description)

    Returns:
      {
        "is_valid": bool,
        "invalid_lines": List[int],  # 1-indexed line numbers up to max_reported
        "total_count": int,
        "has_more": bool,
      }
    """
    if not content or not content.strip():
        return {
            "is_valid": True,
            "invalid_lines": [],
            "total_count": 0,
            "has_more": False,
        }

    invalid_lines: List[int] = []
    total_count = 0

    lines = content.splitlines()
    for idx, line in enumerate(lines, start=1):
        line_str = line.strip()
        if not line_str:
            continue
        if not MANIFEST_ENTRY_REGEX.match(line):
            total_count += 1
            if len(invalid_lines) < max_reported:
                invalid_lines.append(idx)

    return {
        "is_valid": total_count == 0,
        "invalid_lines": invalid_lines,
        "total_count": total_count,
        "has_more": total_count > len(invalid_lines),
    }


def _parse_manifest_entries(content: str) -> Dict[str, str]:
    mapping = {}
    for line in (content or "").splitlines():
        m = MANIFEST_ENTRY_REGEX.match(line)
        if m:
            name = m.group(1).strip().lower()
            desc = m.group(2).strip()
            stem = name[:-3] if name.endswith(".md") else name
            mapping[stem] = desc
    return mapping


def _match_manifest_line_name(line: str, target_name: str) -> Optional[Dict[str, Any]]:
    m = re.match(r"^(\s*[-*]\s+)(\*\*)?([a-zA-Z0-9_\.\-]+)(\*\*)?(\s*[—–:\-]\s*)(.*)$", line)
    if not m:
        return None
    prefix, b1, name, b2, sep, desc = m.groups()
    if not target_name:
        return {
            "prefix": prefix,
            "bold_start": b1 or "",
            "name": name,
            "bold_end": b2 or "",
            "separator": sep,
            "description": desc,
            "full_line": line,
        }
    t_clean = target_name.strip()
    t_stem = t_clean[:-3] if t_clean.lower().endswith(".md") else t_clean
    n_clean = name.strip()
    n_stem = n_clean[:-3] if n_clean.lower().endswith(".md") else n_clean
    if n_clean.lower() == t_clean.lower() or n_stem.lower() == t_stem.lower():
        return {
            "prefix": prefix,
            "bold_start": b1 or "",
            "name": name,
            "bold_end": b2 or "",
            "separator": sep,
            "description": desc,
            "full_line": line,
        }
    return None


def _manifest_update_name(manifest_path: Path, old_name: str, new_name: str, baseline_content: str = "") -> bool:
    if not manifest_path.exists():
        return False
    try:
        content = manifest_path.read_text(encoding="utf-8")
    except Exception:
        return False

    lines = content.splitlines()
    updated = False
    new_lines = []

    new_name_safe = " ".join(new_name.splitlines())[:1000]
    new_stem = new_name_safe[:-3] if new_name_safe.lower().endswith(".md") else new_name_safe

    for line in lines:
        matched = _match_manifest_line_name(line, old_name)
        if matched:
            if matched["name"].lower().endswith(".md"):
                replaced_name = f"{new_stem}.md" if not new_name_safe.lower().endswith(".md") else new_name_safe
            else:
                replaced_name = new_stem

            new_line = (
                f"{matched['prefix']}{matched['bold_start']}{replaced_name}"
                f"{matched['bold_end']}{matched['separator']}{matched['description']}"
            )
            new_lines.append(new_line)
            updated = True
        else:
            new_lines.append(line)

    if updated:
        if baseline_content and _parse_manifest_entries("\n".join(new_lines)) == _parse_manifest_entries(baseline_content):
            _write_text_lf(manifest_path, baseline_content)
        else:
            _write_text_lf(manifest_path, "\n".join(new_lines))
    return updated


def _manifest_remove_entry(manifest_path: Path, filename: str, baseline_content: str = "") -> bool:
    if not manifest_path.exists():
        return False
    try:
        content = manifest_path.read_text(encoding="utf-8")
    except Exception:
        return False

    lines = content.splitlines()
    new_lines = []
    removed = False
    for line in lines:
        if _match_manifest_line_name(line, filename):
            removed = True
        else:
            new_lines.append(line)

    if removed:
        if baseline_content and _parse_manifest_entries("\n".join(new_lines)) == _parse_manifest_entries(baseline_content):
            _write_text_lf(manifest_path, baseline_content)
        else:
            _write_text_lf(manifest_path, "\n".join(new_lines))
    return removed


def _manifest_restore_entry(manifest_path: Path, baseline_content: str, filename: str) -> bool:
    if not baseline_content:
        return False

    baseline_lines = baseline_content.splitlines()
    target_line = None
    target_b_idx = -1
    for idx, line in enumerate(baseline_lines):
        if _match_manifest_line_name(line, filename):
            target_line = line
            target_b_idx = idx
            break

    if not target_line:
        return False

    curr_content = ""
    if manifest_path.exists():
        try:
            curr_content = manifest_path.read_text(encoding="utf-8")
        except Exception:
            curr_content = ""

    lines = curr_content.splitlines() if curr_content else []

    # If all entries match baseline after restoring, restore full baseline content directly
    temp_lines = [l for l in lines if not _match_manifest_line_name(l, filename)]
    temp_lines.append(target_line)
    if _parse_manifest_entries("\n".join(temp_lines)) == _parse_manifest_entries(baseline_content):
        _write_text_lf(manifest_path, baseline_content)
        return True

    found_idx = -1
    for idx, line in enumerate(lines):
        if _match_manifest_line_name(line, filename):
            found_idx = idx
            break

    if found_idx != -1:
        lines[found_idx] = target_line
    else:
        # Find best insertion index based on baseline order
        insert_idx = len(lines)
        for b_idx in range(target_b_idx + 1, len(baseline_lines)):
            b_name = baseline_lines[b_idx]
            for c_idx, c_line in enumerate(lines):
                m_match = _match_manifest_line_name(c_line, "")
                if m_match and _match_manifest_line_name(b_name, m_match["name"]):
                    insert_idx = c_idx
                    break
            if insert_idx != len(lines):
                break
        lines.insert(insert_idx, target_line)

    _write_text_lf(manifest_path, "\n".join(lines))
    return True



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
            "workspace_profiles": [],
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
            "image_endpoints": {},
            "active_image_endpoint": None,
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
            "show_file_action_labels": False,
        }

        if self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    _migrate_image_endpoints(data)
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
        # Legacy singleton image keys were migrated to image_endpoints;
        # never persist them again.
        for k in LEGACY_IMAGE_KEYS:
            merged.pop(k, None)

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
            try:
                shadow_rel = Path(".margin-shadow") / manifest_rel_path
                manifest_path = self._safe_resolve(shadow_rel.as_posix())
            except (ValueError, OSError):
                return {}
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

    def list_input_files(self) -> List[Dict[str, Any]]:
        folders = []
        if self.workspace_dir.exists():
            for item in self.workspace_dir.iterdir():
                if item.is_dir() and not item.name.startswith(".") and item.name != "outputs":
                    folders.append(item.name)
            shadow_dir = self.workspace_dir / ".margin-shadow"
            if shadow_dir.exists() and shadow_dir.is_dir():
                for item in shadow_dir.iterdir():
                    if item.is_dir() and not item.name.startswith(".") and item.name != "outputs" and item.name not in folders:
                        folders.append(item.name)

        manifests = {}
        for folder in folders:
            folder_path = self.workspace_dir / folder
            manifest_file = folder_path / f"{folder.upper()}.md"
            if manifest_file.exists():
                manifests[f"{folder}/"] = self._load_manifest(f"{folder}/{manifest_file.name}")
            elif (self.workspace_dir / ".margin-shadow" / folder / f"{folder.upper()}.md").exists():
                manifests[f"{folder}/"] = self._load_manifest(f"{folder}/{folder.upper()}.md")

        is_git = self.workspace_dir.exists() and self.is_git_repo()
        tracked_files = git_service.get_git_tracked_files(self.workspace_dir) if is_git else set()

        files = []
        seen_paths = set()
        for folder in folders:
            folder_path = self.workspace_dir / folder
            for f in folder_path.rglob("*.md"):
                # Always use forward-slash paths — safe on all platforms
                rel_path = _posix_rel(f, self.workspace_dir)
                seen_paths.add(rel_path)
                desc = ""
                for prefix, manifest in manifests.items():
                    if rel_path.startswith(prefix):
                        desc = manifest.get(f.name, "")
                        break

                manifest_issues = None
                if is_manifest_path(rel_path):
                    try:
                        content = f.read_text(encoding="utf-8") if f.exists() else ""
                        manifest_issues = validate_manifest_content(content)
                    except Exception:
                        manifest_issues = None

                file_dict: Dict[str, Any] = {
                    "name": f.name,
                    "path": rel_path,
                    "description": desc,
                    "deleted": False,
                    "tracked": (rel_path in tracked_files) if is_git else (self.workspace_dir / ".margin-shadow" / Path(rel_path)).exists(),
                }
                if manifest_issues and not manifest_issues["is_valid"]:
                    file_dict["manifest_issues"] = manifest_issues

                files.append(file_dict)

        # Root-level markdown files (workspace root is a valid location).
        if self.workspace_dir.exists():
            for item in self.workspace_dir.iterdir():
                if (
                    item.is_file()
                    and item.suffix.lower() == ".md"
                    and not item.name.startswith(".")
                    and item.name not in seen_paths
                ):
                    rel_path = item.name
                    seen_paths.add(rel_path)
                    manifest_issues = None
                    if is_manifest_path(rel_path):
                        try:
                            content = item.read_text(encoding="utf-8") if item.exists() else ""
                            manifest_issues = validate_manifest_content(content)
                        except Exception:
                            manifest_issues = None

                    file_dict = {
                        "name": item.name,
                        "path": rel_path,
                        "description": "",
                        "deleted": False,
                        "tracked": (rel_path in tracked_files) if is_git else (self.workspace_dir / ".margin-shadow" / Path(rel_path)).exists(),
                    }
                    if manifest_issues and not manifest_issues["is_valid"]:
                        file_dict["manifest_issues"] = manifest_issues

                    files.append(file_dict)

        # In a git workspace, check for tracked markdown files that have been deleted in git
        if is_git:
            for deleted_rel in git_service.get_git_deleted_files(self.workspace_dir):
                if deleted_rel.endswith(".md") and deleted_rel not in seen_paths:
                    top_folder = deleted_rel.split("/")[0] if "/" in deleted_rel else ""
                    if top_folder in folders or "/" not in deleted_rel:
                        seen_paths.add(deleted_rel)
                        desc = ""
                        for prefix, manifest in manifests.items():
                            if deleted_rel.startswith(prefix):
                                desc = manifest.get(Path(deleted_rel).name, "")
                                break
                        files.append({
                            "name": Path(deleted_rel).name,
                            "path": deleted_rel,
                            "description": desc,
                            "deleted": True,
                            "tracked": True,
                        })
        else:
            # In a non-git workspace, check for shadow files that have been deleted from working directory
            shadow_dir = self.workspace_dir / ".margin-shadow"
            if shadow_dir.exists():
                for sf in shadow_dir.rglob("*.md"):
                    rel_path = _posix_rel(sf, shadow_dir)
                    if rel_path not in seen_paths:
                        top_folder = rel_path.split("/")[0] if "/" in rel_path else ""
                        if top_folder in folders or "/" not in rel_path:
                            seen_paths.add(rel_path)
                            desc = ""
                            for prefix, manifest in manifests.items():
                                if rel_path.startswith(prefix):
                                    desc = manifest.get(sf.name, "")
                                    break
                            files.append({
                                "name": sf.name,
                                "path": rel_path,
                                "description": desc,
                                "deleted": True,
                                "tracked": True,
                            })
        files.sort(key=lambda f: f["path"])
        return files

    def _safe_resolve(self, path: str) -> Path:
        """Resolve a posix-style relative path to an absolute Path safely."""
        full_path = (self.workspace_dir / Path(path)).resolve()
        workspace_root = self.workspace_dir.resolve()

        # Case-insensitive check on Windows
        try:
            full_path.relative_to(workspace_root)
        except ValueError:
            if sys.platform == "win32":
                full_str = str(full_path).lower()
                ws_str = str(workspace_root).rstrip("/\\").lower() + os.sep
                if not (full_str == ws_str.rstrip(os.sep) or full_str.startswith(ws_str)):
                    raise ValueError("Access denied")
            else:
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
            # If deleted on disk, attempt to load baseline version from git or shadow
            base_info = self.get_diff_base(path)
            if base_info.get("has_base") and base_info.get("base_content") is not None:
                return base_info["base_content"]
            raise FileNotFoundError(f"File not found: {path}")
        return full_path.read_text(encoding="utf-8")

    def create_input_file(self, folder: str, name: str, content: str = "") -> Dict[str, str]:
        folder = (folder or "").strip("/")
        # Empty folder == workspace root, which is a valid location.
        if folder.startswith(".") or ".." in folder or folder.split("/")[0] == "outputs":
            raise ValueError("Invalid folder name")

        name = (name or "").strip()
        if not name or not name.endswith(".md"):
            raise ValueError("File name must end with .md")
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
            raise FileExistsError(f"File already exists: {folder + '/' if folder else ''}{name}")

        target_path.write_text(content or "", encoding="utf-8")
        rel_path = f"{folder}/{name}" if folder else name  # always posix-style

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

        workspace_root = self.workspace_dir.resolve()
        rel_path = _posix_rel(full_path, workspace_root)

        deleted_via_git = False
        if self.is_git_repo():
            if git_service.is_git_tracked(self.workspace_dir, rel_path):
                git_service.delete_git_file(workspace_root, rel_path)
                deleted_via_git = True

        if not deleted_via_git and full_path.exists():
            full_path.unlink()

        # Update manifest file if applicable
        if "/" in rel_path:
            folder = rel_path.split("/")[0]
            manifest_rel = f"{folder}/{folder.upper()}.md"
            manifest_path = workspace_root / Path(manifest_rel)
            if full_path.name.upper() != f"{folder.upper()}.MD":
                if _manifest_remove_entry(manifest_path, full_path.name):
                    if self.is_git_repo():
                        git_service.stage_git_file(workspace_root, manifest_rel)

        return True

    def finalize_deletions(self) -> Dict[str, Any]:
        """In a non-git workspace, permanently remove shadow copies of deleted files so they no longer appear."""
        if self.is_git_repo():
            return {
                "success": False,
                "is_git": True,
                "finalized_count": 0,
                "finalized_files": [],
                "message": "Finalize deletions is only applicable to non-git workspaces.",
            }

        workspace_root = self.workspace_dir.resolve()
        shadow_dir = workspace_root / ".margin-shadow"
        if not shadow_dir.exists():
            return {
                "success": True,
                "is_git": False,
                "finalized_count": 0,
                "finalized_files": [],
            }

        finalized = []
        # Find all files in .margin-shadow that no longer exist in workspace_root
        for sf in list(shadow_dir.rglob("*.md")):
            try:
                rel_path = _posix_rel(sf, shadow_dir)
                working_file = workspace_root / Path(rel_path)
                if not working_file.exists():
                    sf.unlink()
                    finalized.append(rel_path)
                    if "/" in rel_path:
                        folder = rel_path.split("/")[0]
                        manifest_rel = f"{folder}/{folder.upper()}.md"
                        shadow_manifest = shadow_dir / Path(manifest_rel)
                        working_manifest = workspace_root / Path(manifest_rel)
                        if sf.name.upper() != f"{folder.upper()}.MD":
                            _manifest_remove_entry(shadow_manifest, sf.name)
                            if working_manifest.exists() and shadow_manifest.exists():
                                try:
                                    w_text = working_manifest.read_text(encoding="utf-8")
                                    s_text = shadow_manifest.read_text(encoding="utf-8")
                                    if _parse_manifest_entries(w_text) == _parse_manifest_entries(s_text):
                                        _write_text_lf(shadow_manifest, w_text)
                                except (ValueError, OSError):
                                    pass
            except OSError as e:
                print(f"Error finalizing deletion for shadow file {sf}: {e}")

        # Clean up any empty folders inside shadow_dir
        try:
            for d in sorted(shadow_dir.rglob("*"), reverse=True):
                if d.is_dir() and not any(d.iterdir()):
                    d.rmdir()
        except OSError:
            pass

        return {
            "success": True,
            "is_git": False,
            "finalized_count": len(finalized),
            "finalized_files": finalized,
        }

    def rename_input_file(self, path: str, new_name: str) -> Dict[str, Any]:
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
                "tracked": True,
            }

        new_path = old_path.with_name(new_name)
        workspace_root = self.workspace_dir.resolve()
        old_rel = _posix_rel(old_path, workspace_root)
        new_rel = _posix_rel(new_path, workspace_root)

        if new_path.exists():
            raise FileExistsError(f"File already exists: {new_rel}")

        renamed_via_git = False
        is_tracked = False
        if self.is_git_repo():
            is_tracked = git_service.is_git_tracked(self.workspace_dir, old_rel)
            if is_tracked:
                git_service.rename_git_file(workspace_root, old_rel, new_rel)
                renamed_via_git = True

        if not renamed_via_git:
            old_path.rename(new_path)
            if self.is_git_repo():
                git_service.stage_git_file(workspace_root, old_rel)
                git_service.stage_git_file(workspace_root, new_rel)

        # If shadow file exists, rename it too
        shadow_old = workspace_root / ".margin-shadow" / Path(old_rel)
        if shadow_old.exists():
            shadow_new = workspace_root / ".margin-shadow" / Path(new_rel)
            shadow_new.parent.mkdir(parents=True, exist_ok=True)
            try:
                shadow_old.rename(shadow_new)
            except Exception:
                pass

        # Update manifest file if applicable
        if "/" in old_rel:
            folder = old_rel.split("/")[0]
            manifest_rel = f"{folder}/{folder.upper()}.md"
            manifest_path = workspace_root / Path(manifest_rel)
            if old_path.name.upper() != f"{folder.upper()}.MD":
                if _manifest_update_name(manifest_path, old_path.name, new_name):
                    if not self.is_git_repo():
                        shadow_manifest = workspace_root / ".margin-shadow" / Path(manifest_rel)
                        if shadow_manifest.exists():
                            _manifest_update_name(shadow_manifest, old_path.name, new_name)
                    else:
                        git_service.stage_git_file(workspace_root, manifest_rel)

        return {
            "name": new_path.name,
            "path": new_rel,
            "tracked": is_tracked,
        }

    def rename_folder(self, path: str, new_name: str) -> Dict[str, str]:
        """Rename a workspace folder (contents move with it)."""
        old_path = self._safe_resolve(path)
        if not old_path.exists() or not old_path.is_dir():
            raise FileNotFoundError(f"Folder not found: {path}")

        new_name = (new_name or "").strip().lower().replace(" ", "_")
        if not new_name:
            raise ValueError("New folder name is required")
        if "/" in new_name or "\\" in new_name or new_name.startswith(".") or ".." in new_name:
            raise ValueError("Invalid folder name")
        if not re.fullmatch(r"[a-z0-9_-]+", new_name):
            raise ValueError("Invalid folder name")
        if new_name == old_path.name:
            return {
                "name": old_path.name,
                "path": _posix_rel(old_path, self.workspace_dir.resolve()),
            }

        new_path = old_path.with_name(new_name)
        if new_path.exists():
            raise FileExistsError(f"Folder already exists: {_posix_rel(new_path, self.workspace_dir.resolve())}")
        old_path.rename(new_path)

        return {
            "name": new_path.name,
            "path": _posix_rel(new_path, self.workspace_dir.resolve()),
        }

    def delete_folder(self, path: str) -> bool:
        """Recursively delete a workspace folder and everything inside it."""
        full_path = self._safe_resolve(path)
        if not full_path.exists() or not full_path.is_dir():
            raise FileNotFoundError(f"Folder not found: {path}")
        shutil.rmtree(full_path)
        return True

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

    def get_workspace_stats(self) -> Dict[str, Any]:
        """Aggregate stats for the active workspace.

        Token totals come from each ai_logs entry exactly once
        (prompt_tokens + completion_tokens per entry — total_tokens is
        never mixed in, so nothing is double-counted).
        """
        files = []
        try:
            files = self.list_input_files()
        except Exception:
            files = []
        content_files = [
            f for f in files
            if isinstance(f, dict)
            and not str(f.get("path", "")).startswith("styles/")
            and not _is_manifest_file(str(f.get("path", "")))
        ]
        markdown_files = len(content_files)

        prompt_tokens = 0
        completion_tokens = 0
        chat_sessions = 0
        chat_days: Dict[str, int] = {}
        image_days: Dict[str, int] = {}
        latest: Optional[datetime] = None
        logs_dir = self.outputs_dir / "ai_logs"
        if logs_dir.exists():
            for session_file in logs_dir.glob("*.json"):
                try:
                    with open(session_file, "r", encoding="utf-8") as fh:
                        session_logs = json.load(fh)
                except Exception:
                    continue
                if not isinstance(session_logs, list):
                    continue
                # One session file == one chat session by design.
                chat_sessions += 1
                for entry in session_logs:
                    if not isinstance(entry, dict):
                        continue
                    try:
                        prompt_tokens += int(entry.get("prompt_tokens") or 0)
                        completion_tokens += int(entry.get("completion_tokens") or 0)
                    except Exception:
                        continue
                    stamped = _parse_log_time(entry.get("timestamp"))
                    if stamped is not None:
                        day = stamped.date().isoformat()
                        chat_days[day] = chat_days.get(day, 0) + 1
                        if latest is None or stamped > latest:
                            latest = stamped

        image_logs = self.get_image_logs()
        for entry in image_logs:
            stamped = _parse_log_time(entry.get("timestamp")) if isinstance(entry, dict) else None
            if stamped is not None:
                day = stamped.date().isoformat()
                image_days[day] = image_days.get(day, 0) + 1
                if latest is None or stamped > latest:
                    latest = stamped

        for f in content_files:
            try:
                mtime = datetime.fromtimestamp(
                    (self.workspace_dir / str(f.get("path", ""))).stat().st_mtime,
                    tz=timezone.utc,
                )
            except Exception:
                continue
            if latest is None or mtime > latest:
                latest = mtime

        today = datetime.now(timezone.utc).date()
        activity = []
        for back in range(13, -1, -1):
            day = (today - timedelta(days=back)).isoformat()
            activity.append({
                "date": day,
                "chats": chat_days.get(day, 0),
                "images": image_days.get(day, 0),
            })

        return {
            "markdown_files": markdown_files,
            "chat_sessions": chat_sessions,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "images_generated": len(image_logs),
            "last_activity": latest.isoformat() if latest is not None else None,
            "activity": activity,
        }

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

    def is_git_repo(self) -> bool:
        """Check if the current workspace directory is inside a git work tree."""
        return git_service.is_git_repo(self.workspace_dir)

    def get_diff_base(self, path: str) -> Dict[str, Any]:
        """Resolve the diff base content for a document."""
        full_path = self._safe_resolve(path)
        workspace_root = self.workspace_dir.resolve()
        rel_path = _posix_rel(full_path, workspace_root)
        is_git = self.is_git_repo()

        if is_git:
            return git_service.get_git_diff_base(workspace_root, rel_path)
        else:
            # Non-git workspace: shadow file copy in .margin-shadow/
            shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)
            if not shadow_path.exists():
                return {
                    "is_git": False,
                    "base_content": None,
                    "has_base": False,
                    "is_new": True,
                    "tracked": False,
                    "has_committed_version": False,
                }

            try:
                shadow_content = shadow_path.read_text(encoding="utf-8")
                return {
                    "is_git": False,
                    "base_content": shadow_content,
                    "has_base": True,
                    "is_new": False,
                    "tracked": True,
                    "has_committed_version": True,
                }
            except OSError:
                return {
                    "is_git": False,
                    "base_content": None,
                    "has_base": False,
                    "is_new": True,
                    "tracked": False,
                    "has_committed_version": False,
                }

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

        statuses = (
            git_service.get_git_workspace_status(workspace_root)
            if is_git
            else self._get_non_git_workspace_status(workspace_root)
        )

        return {
            "is_git": is_git,
            "statuses": statuses,
        }

    def _get_non_git_workspace_status(self, workspace_root: Path) -> Dict[str, str]:
        statuses: Dict[str, str] = {}
        try:
            files = self.list_input_files()
            for file_info in files:
                rel_path = file_info["path"]
                full_path = workspace_root / Path(rel_path)
                shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)

                if not full_path.exists() and shadow_path.exists():
                    statuses[rel_path] = "unstaged_deleted"
                elif not shadow_path.exists():
                    if full_path.exists() and (full_path.stat().st_size == 0 or not full_path.read_text(encoding="utf-8", errors="replace").strip()):
                        statuses[rel_path] = "clean"
                    else:
                        statuses[rel_path] = "unstaged_modified"
                else:
                    try:
                        current_text = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
                        shadow_text = shadow_path.read_text(encoding="utf-8")
                        if _normalize_markdown_content(current_text) == _normalize_markdown_content(shadow_text):
                            statuses[rel_path] = "clean"
                        else:
                            statuses[rel_path] = "unstaged_modified"
                    except OSError:
                        statuses[rel_path] = "unstaged_modified"
        except (OSError, ValueError) as e:
            print(f"Failed to get non-git shadow status: {e}")

        return statuses

    def stage_file(self, path: str, content: Optional[str] = None) -> Dict[str, Any]:
        """Stage the document in git or update the shadow copy in non-git."""
        full_path = self._safe_resolve(path)
        if full_path.suffix.lower() != ".md":
            raise ValueError("Only markdown files can be staged via this endpoint")
        workspace_root = self.workspace_dir.resolve()
        rel_path = _posix_rel(full_path, workspace_root)

        is_git = self.is_git_repo()
        if is_git:
            return git_service.stage_git_file(workspace_root, rel_path, content=content)
        else:
            if content is not None:
                _write_text_lf(full_path, content)
            else:
                content = full_path.read_text(encoding="utf-8") if full_path.exists() else ""
            shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)
            shadow_path.parent.mkdir(parents=True, exist_ok=True)
            _write_text_lf(shadow_path, content or "")
            return {"success": True, "is_git": False, "base_content": content, "has_committed_version": True}

    def get_restore_info(self, path: str) -> Dict[str, Any]:
        """Get restore capabilities, options validity, and git rename context for a file."""
        full_path = self._safe_resolve(path)
        if full_path.suffix.lower() != ".md":
            raise ValueError("Only markdown files are supported")
        workspace_root = self.workspace_dir.resolve()
        rel_path = _posix_rel(full_path, workspace_root)
        is_git = self.is_git_repo()

        if not is_git:
            shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)
            has_snapshot = shadow_path.exists()
            return {
                "is_git": False,
                "path": rel_path,
                "fileName": full_path.name,
                "is_renamed": False,
                "renamed_from": None,
                "is_deleted": not full_path.exists() and has_snapshot,
                "has_snapshot": has_snapshot,
                "can_restore_worktree_only": False,
                "can_restore_staged_and_unstage": False,
                "can_restore_committed": has_snapshot,
            }

        return git_service.get_git_restore_info(workspace_root, rel_path)

    def restore_file(self, path: str, mode: str = "committed") -> Dict[str, Any]:
        """Restore a file according to selected mode:
        - 'worktree_only': restore staged version to worktree only (e.g. git restore)
        - 'staged_and_unstage': restore staged version and unstage it (i.e. git restore + git restore --staged)
        - 'committed': restore to committed version while unstaging it (i.e. git restore --staged --worktree)
        """
        full_path = self._safe_resolve(path)
        if full_path.suffix.lower() != ".md":
            raise ValueError("Only markdown files can be restored via this endpoint")
        workspace_root = self.workspace_dir.resolve()
        rel_path = _posix_rel(full_path, workspace_root)
        is_git = self.is_git_repo()

        if is_git:
            return git_service.restore_git_file(
                workspace_root,
                rel_path,
                mode=mode,
                manifest_restore_fn=_manifest_restore_entry,
                manifest_remove_fn=_manifest_remove_entry,
            )
        else:
            shadow_path = workspace_root / ".margin-shadow" / Path(rel_path)
            if not shadow_path.exists():
                raise FileNotFoundError(f"No shadow snapshot available for: {rel_path}")
            shadow_content = shadow_path.read_text(encoding="utf-8")
            _write_text_lf(full_path, shadow_content)

            # Restore manifest entry if applicable
            if "/" in rel_path:
                folder = rel_path.split("/")[0]
                manifest_rel = f"{folder}/{folder.upper()}.md"
                manifest_path = workspace_root / Path(manifest_rel)
                if full_path.name.upper() != f"{folder.upper()}.MD":
                    shadow_manifest = workspace_root / ".margin-shadow" / Path(manifest_rel)
                    if shadow_manifest.exists():
                        try:
                            baseline_manifest = shadow_manifest.read_text(encoding="utf-8")
                            _manifest_restore_entry(manifest_path, baseline_manifest, full_path.name)
                        except Exception:
                            pass

            return {"success": True, "is_git": False, "mode": "committed", "restored_content": shadow_content, "base_content": shadow_content}

    def _scaffold_shadow_baselines(self, path_obj: Path):
        shadow_root = path_obj / ".margin-shadow"
        for folder_name in ["chapters", "characters", "styles", "prompts"]:
            folder_dir = path_obj / folder_name
            if folder_dir.exists():
                for f in folder_dir.rglob("*.md"):
                    if f.is_file() and not f.name.startswith("."):
                        rel = _posix_rel(f, path_obj)
                        shadow_dest = shadow_root / Path(rel)
                        shadow_dest.parent.mkdir(parents=True, exist_ok=True)
                        if not shadow_dest.exists():
                            try:
                                shutil.copy2(f, shadow_dest)
                            except OSError:
                                pass

    def create_workspace(
        self,
        parent_path: str,
        name: str,
        init_git: bool = False,
    ) -> Dict[str, Any]:
        """Scaffold a new workspace directory.

        update_settings() is intentionally NOT called here — the caller
        (router) links the workspace after confirming success, so a git
        failure cannot leave the app pointed at a half-built workspace.
        """
        path_obj = _resolve_workspace_create_target(parent_path, name)

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

        # 6. Git initialization (intent flag only — runs here at creation time)
        if init_git:
            git_info = _init_git_repo(path_obj)
        else:
            git_info = {
                "initialized": False,
                "committed": False,
                "staged": False,
                "already_tracked": False,
                "git_parent": None,
                "git_unavailable": False,
                "init_failed": False,
                "error": None,
            }

        if not git_info["initialized"]:
            self._scaffold_shadow_baselines(path_obj)

        return {
            "success": True,
            "path": str(path_obj),
            "git": git_info,
        }



# Global singleton
storage = FileStorageService()
