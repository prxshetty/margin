"""
Style Loader — loads style markdown files from inputs/styles/.
"""

import yaml
import re
import json
from pathlib import Path
from typing import Dict, Optional, Any, Union


OUTPUT_SIZE_MAP = {
    "concise": 250,
    "balanced": 500,
    "expansive": 1000,
}


def resolve_output_size(value: Union[str, int, None]) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    return OUTPUT_SIZE_MAP.get(str(value).lower())


def get_styles_dir() -> Path:
    base_dir = Path(__file__).parent
    settings_path = base_dir / "settings.json"
    if settings_path.exists():
        try:
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
                custom_workspace = settings.get("linked_workspace_dir")
                if custom_workspace:
                    p = Path(custom_workspace)
                    if p.exists() and p.is_dir():
                        return p / "styles"
        except Exception:
            pass
    return base_dir / "sample-workspace" / "styles"


def get_styles_md_path() -> Path:
    return get_styles_dir() / "STYLES.md"


def load_style(name: str) -> Optional[Dict[str, Any]]:
    """Load a style by name from inputs/styles/."""
    styles_dir = get_styles_dir()
    path = styles_dir / f"{name}.md"
    if path.exists():
        return _parse_style_file(path)
    return None


def load_all_styles() -> Dict[str, Dict[str, Any]]:
    """Load all styles by scanning inputs/styles/ directly."""
    styles_dir = get_styles_dir()
    styles = {}
    if styles_dir.exists():
        for fpath in styles_dir.glob("*.md"):
            if fpath.stem.lower() in ("styles", "styles.md"):
                continue
            name = fpath.stem.lower()
            style = load_style(name)
            if style:
                styles[name] = style
    return styles


def generate_styles_md(path: Optional[Path] = None) -> str:
    """Generate STYLES.md from style files on disk.

    Skips if file already exists (user-owned). Delete STYLES.md or
    pass force=True via the caller to regenerate.
    """
    target = path or get_styles_md_path()
    if target.exists():
        return target.read_text(encoding="utf-8")

    # Scan disk directly (no validation — STYLES.md doesn't exist yet)
    style_files = {}
    styles_dir = get_styles_dir()
    if styles_dir.exists():
        for fpath in styles_dir.glob("*.md"):
            if fpath.stem.lower() == "styles":
                continue
            style_files[fpath.stem.lower()] = _parse_style_file(fpath)

    lines = [
        "# Available Styles",
        "",
        "Use these style tags when annotating scene_events.",
        "",
    ]
    for name in sorted(style_files):
        desc = style_files[name].get("description", "")
        lines.append(f"- **{name}** — {desc}")
    lines.append("")

    content = "\n".join(lines)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return content


def read_styles_md(path: Optional[Path] = None) -> Dict[str, str]:
    """Read STYLES.md and return {name: description}.

    Returns empty dict if file doesn't exist.
    """
    target = path or get_styles_md_path()
    if not target.exists():
        return {}

    content = target.read_text(encoding="utf-8")
    styles = {}
    for line in content.splitlines():
        m = re.match(r"^-\s+\*\*([^*]+)\*\*\s*—\s*(.+)", line)
        if m:
            styles[m.group(1).strip()] = m.group(2).strip()
    return styles


def get_min_dialogues(path: Optional[Path] = None) -> int:
    """Parse STYLES.md for 'Minimum Dialogues: X' preference. Defaults to 2."""
    target = path or get_styles_md_path()
    if not target.exists():
        return 2

    content = target.read_text(encoding="utf-8")
    for line in content.splitlines():
        m = re.search(r"(?i)minimum\s+dialogues?:\s*(\d+)", line)
        if m:
            return int(m.group(1))
    return 2


def _parse_style_file(path: Path) -> Dict[str, Any]:
    """Parse a style markdown file with YAML frontmatter + ## sections."""
    content = path.read_text(encoding="utf-8")

    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    frontmatter = yaml.safe_load(fm_match.group(1)) if fm_match else {}
    body = content[fm_match.end():] if fm_match else content

    sections = re.findall(
        r"##\s+(\w+)\s+Guidelines\s*\n(.*?)(?=\n##|\Z)", body, re.DOTALL
    )
    agent_sections = {name.lower(): text.strip() for name, text in sections}

    raw_output_size = frontmatter.get("output_size")

    return {
        "description": frontmatter.get("description", ""),
        "output_size": resolve_output_size(raw_output_size),
        "agent_sections": agent_sections,
    }
