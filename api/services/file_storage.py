import os
import yaml
import json
import re
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid

from api.models.domain import Chapter, Blueprint, Act, Scene, AgentLog, Character, Style

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

    def link_directories(self, inputs_path: str) -> Dict[str, Any]:
        p = Path(inputs_path.strip()).resolve()
        
        # If it's a file or has a file extension (even if it doesn't exist on disk yet), resolve to its parent
        if (p.exists() and p.is_file()) or p.suffix:
            p = p.parent
            
        # If the path points to acts/scenes/beats/styles/characters/chapters inside inputs, move up to inputs/
        if p.name.lower() in ("chapters", "characters", "styles", "acts", "scenes", "beats") and p.parent.name.lower() == "inputs":
            p = p.parent
            
        # If the folder selected contains an "inputs" directory, use that inputs/ folder
        if not p.name.lower() == "inputs" and (p / "inputs").exists() and (p / "inputs").is_dir():
            p = p / "inputs"
            
        if not p.exists() or not p.is_dir():
            raise ValueError(f"Resolved path '{p}' is not a valid directory.")
            
        settings = {}
        if self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
            except Exception:
                pass
                
        warning = None
        
        # Verify inputs and outputs are writable and initialize subfolders
        try:
            # 1. Ensure inputs directory is writable by trying to create directories and a test file
            (p / "chapters").mkdir(parents=True, exist_ok=True)
            (p / "characters").mkdir(parents=True, exist_ok=True)
            (p / "styles").mkdir(parents=True, exist_ok=True)
            
            test_in = p / ".test_write"
            test_in.write_text("test")
            test_in.unlink()
            
            settings["linked_inputs_dir"] = str(p)
            self.inputs_dir = p
            
            # 2. Try to configure dynamic outputs sibling
            o = p.parent / "outputs"
            try:
                o.mkdir(parents=True, exist_ok=True)
                test_out = o / ".test_write"
                test_out.write_text("test")
                test_out.unlink()
                
                settings["linked_outputs_dir"] = str(o)
                self.outputs_dir = o
            except (OSError, PermissionError) as e:
                # Sibling outputs failed: fallback outputs to local, but keep custom inputs linked!
                o = self.base_dir / "outputs"
                o.mkdir(parents=True, exist_ok=True)
                settings["linked_outputs_dir"] = str(o)
                self.outputs_dir = o
                warning = f"Inputs directory is linked successfully, but sibling outputs directory '{p.parent / 'outputs'}' is not writable due to permission restrictions. Outputs fell back to project-local folder: '{o}'"
                
        except (OSError, PermissionError) as e:
            # Entire custom input path is not writable: fallback EVERYTHING to local default project paths!
            p = self.base_dir / "inputs"
            o = self.base_dir / "outputs"
            
            (p / "chapters").mkdir(parents=True, exist_ok=True)
            (p / "characters").mkdir(parents=True, exist_ok=True)
            (p / "styles").mkdir(parents=True, exist_ok=True)
            o.mkdir(parents=True, exist_ok=True)
            
            self.inputs_dir = p
            self.outputs_dir = o
            
            settings.pop("linked_inputs_dir", None)
            settings.pop("linked_outputs_dir", None)
            
            warning = f"Operation not permitted or directory not writable at '{inputs_path}'. Reverted to default local workspace folders."
            
        if warning:
            settings["warning"] = warning
        else:
            settings.pop("warning", None)
            
        with open(self.settings_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2)
            
        return self.get_directory_status()

    def unlink_directories(self) -> Dict[str, Any]:
        if self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                settings.pop("linked_inputs_dir", None)
                settings.pop("linked_outputs_dir", None)
                settings.pop("warning", None)
                with open(self.settings_path, "w", encoding="utf-8") as f:
                    json.dump(settings, f, indent=2)
            except Exception:
                pass
                
        self.inputs_dir = self.base_dir / "inputs"
        self.outputs_dir = self.base_dir / "outputs"
        
        # Ensure default directories exist
        (self.inputs_dir / "chapters").mkdir(parents=True, exist_ok=True)
        (self.inputs_dir / "characters").mkdir(parents=True, exist_ok=True)
        (self.inputs_dir / "styles").mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        
        return self.get_directory_status()

    def get_settings(self) -> Dict[str, Any]:
        settings = {
            "linked_inputs_dir": None,
            "linked_outputs_dir": None,
            "reasoning_model": True,
            "prepend_thinking_preamble": False,  # Off by default!
            "dialogue_density": 0.5,
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

    def update_settings(self, new_settings: Dict[str, Any]) -> Dict[str, Any]:
        settings = self.get_settings()
        for k, v in new_settings.items():
            if k in ("linked_inputs_dir", "linked_outputs_dir", "reasoning_model", "prepend_thinking_preamble", "dialogue_density"):
                if k == "dialogue_density":
                    try:
                        v = max(0.0, min(1.0, float(v)))
                    except (TypeError, ValueError):
                        continue
                settings[k] = v
        
        try:
            with open(self.settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
        except Exception as e:
            print(f"Error saving settings: {e}")
            
        return settings

    def list_input_files(self) -> List[Dict[str, str]]:
        files = []
        for f in self.inputs_dir.rglob("*.md"):
            rel_path = str(f.relative_to(self.inputs_dir))
            files.append({"name": f.name, "path": rel_path})
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

    def get_directory_status(self) -> Dict[str, Any]:
        is_linked = self.inputs_dir != (self.base_dir / "inputs")
        
        warning = None
        if self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    warning = settings.get("warning")
            except Exception:
                pass
                
        # Count chapters
        chapters_count = 0
        chap_dir = self.inputs_dir / "chapters"
        if chap_dir.exists() and chap_dir.is_dir():
            chapters_count = len(list(chap_dir.glob("*.md")))
            
        # Count characters
        characters_count = 0
        char_dir = self.inputs_dir / "characters"
        if char_dir.exists() and char_dir.is_dir():
            characters_count = len(list(char_dir.glob("*.md")))
            
        # Count styles
        styles_count = 0
        styles_dir = self.inputs_dir / "styles"
        if styles_dir.exists() and styles_dir.is_dir():
            styles_count = len([f for f in styles_dir.glob("*.md") if f.stem.lower() != "styles"])
            
        # Count blueprints
        blueprints_count = 0
        if self.outputs_dir.exists() and self.outputs_dir.is_dir():
            for p in self.outputs_dir.iterdir():
                if p.is_dir() and (p / "blueprint.json").exists():
                    blueprints_count += 1
                    
        return {
            "is_linked": is_linked,
            "inputs_dir": str(self.inputs_dir.resolve()),
            "outputs_dir": str(self.outputs_dir.resolve()),
            "default_inputs_dir": str((self.base_dir / "inputs").resolve()),
            "default_outputs_dir": str((self.base_dir / "outputs").resolve()),
            "warning": warning,
            "stats": {
                "chapters": chapters_count,
                "characters": characters_count,
                "styles": styles_count,
                "blueprints": blueprints_count
            }
        }


    @staticmethod
    def _parse_frontmatter(content: str) -> Optional[Dict]:
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
        if match:
            return yaml.safe_load(match.group(1))
        return None

    @staticmethod
    def _make_frontmatter(fm: Dict) -> str:
        return "---\n" + yaml.dump(fm, default_flow_style=False, sort_keys=False).strip() + "\n---\n\n"

    @staticmethod
    def _strip_frontmatter(content: str) -> str:
        match = re.match(r"^---\s*\n.*?\n---\s*\n", content, re.DOTALL)
        if match:
            return content[match.end():]
        return content

    # --- Characters ---
    def _name_from_slug(self, slug: str) -> str:
        return slug.replace("_", " ").title()

    def get_characters(self) -> List[Character]:
        characters = []
        char_dir = self.inputs_dir / "characters"
        for fpath in char_dir.glob("*.md"):
            slug = fpath.stem
            name = self._name_from_slug(slug)
            characters.append(Character(id=slug, name=name, slug=slug, data={}))
        return characters

    def get_character(self, slug: str) -> Optional[Character]:
        fpath = self.inputs_dir / "characters" / f"{slug}.md"
        if fpath.exists():
            name = self._name_from_slug(slug)
            return Character(id=slug, name=name, slug=slug, data={})
        return None

    def get_character_content(self, slug: str) -> Optional[str]:
        fpath = self.inputs_dir / "characters" / f"{slug}.md"
        if fpath.exists():
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
            match = re.match(r"^---\s*\n.*?\n---\s*\n", content, re.DOTALL)
            if match:
                return content[match.end():].strip()
            return content
        return None

    def save_character_content(self, slug: str, body: str) -> None:
        fpath = self.inputs_dir / "characters" / f"{slug}.md"
        fpath.write_text(body.strip() + "\n", encoding="utf-8")

    def save_character(self, char: Character) -> Character:
        fpath = self.inputs_dir / "characters" / f"{char.slug}.md"
        if not fpath.exists():
            fpath.write_text("", encoding="utf-8")
        char.name = self._name_from_slug(char.slug)
        return char

    def rename_character(self, slug: str, new_slug: str) -> Optional[Character]:
        old_path = self.inputs_dir / "characters" / f"{slug}.md"
        new_path = self.inputs_dir / "characters" / f"{new_slug}.md"
        if not old_path.exists() or new_path.exists():
            return None
        old_path.rename(new_path)
        return self.get_character(new_slug)

    # --- Styles ---
    def get_styles(self) -> List[Style]:
        import sys
        sys.path.append(str(self.base_dir))
        from style_loader import _parse_style_file
        styles = []
        style_dir = self.inputs_dir / "styles"
        for fpath in style_dir.glob("*.md"):
            if fpath.stem.lower() == "styles": continue
            try:
                parsed = _parse_style_file(fpath)
                slug = fpath.stem
                styles.append(Style(
                    id=slug,
                    name=slug,
                    description=parsed.get("description", ""),
                    output_size=str(parsed.get("output_size", "balanced")),
                    agent_sections=parsed.get("agent_sections", {}),
                    is_system=True
                ))
            except Exception:
                pass
        return styles

    def get_style(self, id: str) -> Optional[Style]:
        import sys
        sys.path.append(str(self.base_dir))
        from style_loader import _parse_style_file
        fpath = self.inputs_dir / "styles" / f"{id}.md"
        if fpath.exists():
            try:
                parsed = _parse_style_file(fpath)
                return Style(
                    id=id,
                    name=id,
                    description=parsed.get("description", ""),
                    output_size=str(parsed.get("output_size", "balanced")),
                    agent_sections=parsed.get("agent_sections", {}),
                    is_system=True
                )
            except Exception:
                return None
        return None

    def save_style(self, style: Style) -> Style:
        fpath = self.inputs_dir / "styles" / f"{style.id}.md"

        existing_body = ""
        if fpath.exists():
            raw = fpath.read_text(encoding="utf-8")
            match = re.match(r"^---\s*\n.*?\n---\s*\n", raw, re.DOTALL)
            if match:
                existing_body = raw[match.end():].strip()

        content = "---\n"
        content += f"description: {style.description}\n"
        content += f"output_size: {style.output_size}\n"
        content += "---\n\n"

        if existing_body:
            content += existing_body + "\n"
        else:
            for agent, guidelines in style.agent_sections.items():
                content += f"## {agent.capitalize()} Guidelines\n"
                content += f"{guidelines}\n\n"

        fpath.write_text(content, encoding="utf-8")
        return style

    def rename_style(self, id: str, new_id: str) -> Optional[Style]:
        old_path = self.inputs_dir / "styles" / f"{id}.md"
        new_path = self.inputs_dir / "styles" / f"{new_id}.md"
        if not old_path.exists() or new_path.exists():
            return None
        old_path.rename(new_path)
        return self.get_style(new_id)

    def delete_style(self, id: str) -> bool:
        fpath = self.inputs_dir / "styles" / f"{id}.md"
        if fpath.exists():
            fpath.unlink()
            return True
        return False

    # --- Chapters ---
    def _next_chapter_id(self) -> str:
        max_num = 0
        chap_dir = self.inputs_dir / "chapters"
        for fpath in chap_dir.glob("*.md"):
            match = re.match(r"chapter-(\d+)$", fpath.stem)
            if match:
                num = int(match.group(1))
                max_num = max(max_num, num)
        return f"chapter-{max_num + 1}"

    def _parse_chapter_file(self, fpath: Path) -> Optional[dict]:
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception:
            return None

        fm = self._parse_frontmatter(content)
        if fm:
            title = fm.get("title", "Untitled Chapter")
        else:
            title_match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
            title = title_match.group(1).strip() if title_match else "Untitled Chapter"

        body = self._strip_frontmatter(content)
        title_match = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
        outline = body[title_match.end():].strip() if title_match else body.strip()

        return {"title": title, "outline": outline, "stem": fpath.stem}

    def get_chapters(self) -> List[Chapter]:
        chapters = []
        chap_dir = self.inputs_dir / "chapters"
        for fpath in sorted(chap_dir.glob("*.md"), key=lambda p: p.stem):
            parsed = self._parse_chapter_file(fpath)
            if parsed:
                chapters.append(Chapter(
                    id=parsed["stem"],
                    title=parsed["title"],
                    raw_outline=parsed["outline"]
                ))
        chapters.sort(key=lambda c: int(c.id.split("-")[1]) if c.id.startswith("chapter-") else 0)
        return chapters

    def get_chapter(self, chapter_id: str) -> Optional[Chapter]:
        fpath = self.inputs_dir / "chapters" / f"{chapter_id}.md"
        if fpath.exists():
            parsed = self._parse_chapter_file(fpath)
            if parsed:
                return Chapter(id=chapter_id, title=parsed["title"], raw_outline=parsed["outline"])
        return None

    def save_chapter(self, chapter: Chapter) -> Chapter:
        fpath = self.inputs_dir / "chapters" / f"{chapter.id}.md"
        content = self._make_frontmatter({"title": chapter.title})
        content += f"# {chapter.title}\n\n"
        content += chapter.raw_outline
        fpath.write_text(content, encoding="utf-8")
        return chapter

    def delete_chapter(self, chapter_id: str, target: str = "both") -> bool:
        import shutil
        if target in ("input", "both"):
            # Delete the input outline markdown file
            fpath = self.inputs_dir / "chapters" / f"{chapter_id}.md"
            if fpath.exists():
                fpath.unlink()

        if target in ("output", "both"):
            # Delete the entire generated outputs directory
            out_dir = self.outputs_dir / chapter_id
            if out_dir.exists():
                shutil.rmtree(out_dir)
        return True

    # --- Blueprints (JSON in outputs) ---
    def get_blueprint(self, chapter_id: str) -> Optional[Blueprint]:
        fpath = self.outputs_dir / chapter_id / "blueprint.json"
        if fpath.exists():
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
                return Blueprint(**data)
        return None

    def save_blueprint(self, blueprint: Blueprint) -> Blueprint:
        out_dir = self.outputs_dir / blueprint.chapter_id
        out_dir.mkdir(parents=True, exist_ok=True)
        fpath = out_dir / "blueprint.json"
        with open(fpath, "w", encoding="utf-8") as f:
            # We must serialize datetime to isoformat
            json.dump(blueprint.model_dump(mode='json'), f, indent=2)
            
        # Write human-readable blueprint.md outline for the author
        md_path = out_dir / "blueprint.md"
        md_lines = []
        md_lines.append(f"# Chapter Blueprint: {blueprint.data.get('chapter_title', 'Untitled Chapter')}")
        md_lines.append("")
        
        acts = blueprint.data.get("acts", [])
        for act in acts:
            act_num = act.get("act_number", 1)
            act_theme = act.get("act_theme", "No Theme")
            act_hint = act.get("act_transition_hint", "")
            
            md_lines.append(f"## Act {act_num}: {act_theme}")
            if act_hint:
                md_lines.append(f"*Transition Hint: {act_hint}*")
            md_lines.append("")
            
            scenes = act.get("scenes", [])
            for scene in scenes:
                scene_num = scene.get("scene_number", 1)
                setting = scene.get("scene_setting", "Unknown Setting")
                desc = scene.get("scene_description", "")
                chars = ", ".join(scene.get("characters", []))
                
                md_lines.append(f"### Scene {scene_num}: {setting}")
                if chars:
                    md_lines.append(f"- **Characters:** {chars}")
                if desc:
                    md_lines.append(f"- **Description:** {desc}")
                md_lines.append("")
                
                events = scene.get("scene_events", [])
                if events:
                    md_lines.append("#### Sequential dramatic beats:")
                    for idx, event in enumerate(events):
                        beat_text = event.get("beat", "")
                        style = event.get("style", "general")
                        exchanges = event.get("expected_exchanges", "0")
                        flow = event.get("conversation_flow", [])
                        
                        md_lines.append(f"{idx + 1}. **[{style}]** {beat_text} *(Exchanges: {exchanges})*")
                        for bullet in flow:
                            md_lines.append(f"   - {bullet}")
                    md_lines.append("")
                    
        with open(md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(md_lines))
            
        return blueprint

    # --- Acts and Scenes ---
    def get_acts(self, chapter_id: str) -> List[Act]:
        bp = self.get_blueprint(chapter_id)
        if not bp: return []
        acts = []
        for act_data in bp.data.get("acts", []):
            acts.append(Act(
                id=f"{chapter_id}_act-{act_data['act_number']}",
                blueprint_id=bp.id,
                act_number=act_data['act_number'],
                act_theme=act_data.get('act_theme', ''),
                act_transition_hint=act_data.get('act_transition_hint', '')
            ))
        return acts

    def get_scene(self, scene_id: str) -> Optional[Scene]:
        # scene_id is of format: {chapter_slug}_act-{act_number}_scene-{scene_number}
        parts = scene_id.rsplit("_", 2)
        if len(parts) != 3: return None
        chapter_id, act_str, scene_str = parts
        act_dir = self.outputs_dir / chapter_id / act_str
        scene_dir = act_dir / scene_str
        
        plan_path = scene_dir / "plan.md"
        prose_path = scene_dir / "prose.md"
        
        if plan_path.exists():
            with open(plan_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
            frontmatter = yaml.safe_load(fm_match.group(1)) if fm_match else {}
            
            generated_content = None
            if prose_path.exists():
                with open(prose_path, "r", encoding="utf-8") as f:
                    generated_content = f.read()
                    
            frontmatter["generated_content"] = generated_content
            return Scene(**frontmatter)
            
        # Fallback to older metadata.json/scene.md setup
        meta_path = scene_dir / "metadata.json"
        scene_path = scene_dir / "scene.md"
        
        if meta_path.exists():
            with open(meta_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            generated_content = None
            if scene_path.exists():
                with open(scene_path, "r", encoding="utf-8") as f:
                    generated_content = f.read()
                    
            data["generated_content"] = generated_content
            return Scene(**data)
        return None

    def get_scenes_for_act(self, chapter_id: str, act_number: int) -> List[Scene]:
        bp = self.get_blueprint(chapter_id)
        if not bp: return []
        scenes = []
        act_str = f"act-{act_number}"
        
        # Need to read scenes from the blueprint's data to know what exists
        act_data = next((a for a in bp.data.get("acts", []) if a["act_number"] == act_number), None)
        if act_data:
            for sc in act_data.get("scenes", []):
                scene_num = sc["scene_number"]
                scene_id = f"{chapter_id}_{act_str}_scene-{scene_num}"
                scene = self.get_scene(scene_id)
                if scene:
                    scenes.append(scene)
                else:
                    # Fallback to blueprint planned scene details
                    scenes.append(Scene(
                        id=scene_id,
                        act_id=f"{chapter_id}_{act_str}",
                        scene_number=scene_num,
                        scene_setting=sc.get("scene_setting", "Setting"),
                        scene_description=sc.get("scene_description", ""),
                        characters=sc.get("characters", []),
                        scene_events=sc.get("scene_events", [])
                    ))
        return scenes

    def save_scene(self, scene: Scene) -> Scene:
        parts = scene.id.rsplit("_", 2)
        if len(parts) != 3: return scene
        chapter_id, act_str, scene_str = parts
        
        scene_dir = self.outputs_dir / chapter_id / act_str / scene_str
        scene_dir.mkdir(parents=True, exist_ok=True)
        
        plan_path = scene_dir / "plan.md"
        prose_path = scene_dir / "prose.md"
        
        # Clean up old files if they exist
        if (scene_dir / "metadata.json").exists(): (scene_dir / "metadata.json").unlink()
        if (scene_dir / "scene.md").exists(): (scene_dir / "scene.md").unlink()
        
        # Save metadata to plan.md
        data = scene.model_dump(mode='json', exclude={'generated_content'})
        
        content = "---\n"
        content += yaml.dump(data, default_flow_style=False, sort_keys=False)
        content += "---\n\n"
        content += f"# Scene Plan\n\n{scene.scene_description}\n"
        
        with open(plan_path, "w", encoding="utf-8") as f:
            f.write(content)
            
        # Save content
        if scene.generated_content is not None:
            with open(prose_path, "w", encoding="utf-8") as f:
                f.write(scene.generated_content)
                
        return scene

    def get_prior_scenes_for_context(self, chapter_id: str, act_number: int, current_scene_number: int) -> List[Scene]:
        """Load prior scenes in the same act for context."""
        scenes = self.get_scenes_for_act(chapter_id, act_number)
        return [s for s in scenes if s.scene_number < current_scene_number]

    # --- Agent Logs ---
    def save_agent_log(self, log: AgentLog):
        parts = log.scene_id.rsplit("_", 2)
        if len(parts) != 3: return
        chapter_id, act_str, scene_str = parts
        
        scene_dir = self.outputs_dir / chapter_id / act_str / scene_str
        scene_dir.mkdir(parents=True, exist_ok=True)
        
        logs_path = scene_dir / "logs.json"
        logs = []
        if logs_path.exists():
            with open(logs_path, "r", encoding="utf-8") as f:
                logs = json.load(f)
                
        logs.append(log.model_dump(mode='json'))
        
        with open(logs_path, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)

    def get_agent_logs(self, scene_id: str) -> List[AgentLog]:
        parts = scene_id.rsplit("_", 2)
        if len(parts) != 3: return []
        chapter_id, act_str, scene_str = parts
        
        logs_path = self.outputs_dir / chapter_id / act_str / scene_str / "logs.json"
        logs = []
        if logs_path.exists():
            with open(logs_path, "r", encoding="utf-8") as f:
                raw_logs = json.load(f)
                logs = [AgentLog(**log) for log in raw_logs]
                
        return sorted(logs, key=lambda x: x.beat_number)

    def clear_writer_logs(self, scene_id: str):
        """Clear logs where beat_number > 0 for regeneration."""
        parts = scene_id.rsplit("_", 2)
        if len(parts) != 3: return
        chapter_id, act_str, scene_str = parts

        logs_path = self.outputs_dir / chapter_id / act_str / scene_str / "logs.json"
        if logs_path.exists():
            with open(logs_path, "r", encoding="utf-8") as f:
                raw_logs = json.load(f)

            # Keep decomposer and scene agent logs
            filtered = [log for log in raw_logs if log.get('beat_number', 0) == 0]

            with open(logs_path, "w", encoding="utf-8") as f:
                json.dump(filtered, f, indent=2)

    def save_ai_editor_log(self, scene_id: str, log: dict):
        parts = scene_id.rsplit("_", 2)
        if len(parts) != 3: return
        chapter_id, act_str, scene_str = parts
        
        scene_dir = self.outputs_dir / chapter_id / act_str / scene_str
        scene_dir.mkdir(parents=True, exist_ok=True)
        
        logs_path = scene_dir / "ai_editor_logs.json"
        logs = []
        if logs_path.exists():
            with open(logs_path, "r", encoding="utf-8") as f:
                logs = json.load(f)
                
        logs.append(log)
        logs = logs[-20:]  # keep last 20 entries
        
        with open(logs_path, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)

    def get_ai_editor_logs(self, scene_id: str) -> list:
        parts = scene_id.rsplit("_", 2)
        if len(parts) != 3: return []
        chapter_id, act_str, scene_str = parts
        
        logs_path = self.outputs_dir / chapter_id / act_str / scene_str / "ai_editor_logs.json"
        if not logs_path.exists():
            return []
            
        with open(logs_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_chapter_ai_editor_log(self, chapter_id: str, log: dict, doc_type: str = None, doc_id: str = None):
        chapter_dir = self.outputs_dir / chapter_id
        chapter_dir.mkdir(parents=True, exist_ok=True)
        if doc_type:
            suffix = f"_{doc_type}_{doc_id}" if doc_id else f"_{doc_type}"
            logs_path = chapter_dir / f"ai_editor_logs{suffix}.json"
        else:
            logs_path = chapter_dir / "ai_editor_logs.json"
        logs = []
        if logs_path.exists():
            try:
                with open(logs_path, "r", encoding="utf-8") as f:
                    logs = json.load(f)
            except Exception:
                logs = []
        logs.append(log)
        logs = logs[-20:]
        with open(logs_path, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)

    def get_chapter_ai_editor_logs(self, chapter_id: str, doc_type: str = None, doc_id: str = None) -> list:
        if doc_type:
            suffix = f"_{doc_type}_{doc_id}" if doc_id else f"_{doc_type}"
            logs_path = self.outputs_dir / chapter_id / f"ai_editor_logs{suffix}.json"
        else:
            logs_path = self.outputs_dir / chapter_id / "ai_editor_logs.json"
        if not logs_path.exists():
            return []
        try:
            with open(logs_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def save_blueprint_log(self, chapter_id: str, system_prompt: str, user_prompt: str, output: str):
        import uuid
        from datetime import datetime
        logs_path = self.outputs_dir / chapter_id / "blueprint_logs.json"
        logs = []
        if logs_path.exists():
            try:
                with open(logs_path, "r", encoding="utf-8") as f:
                    logs = json.load(f)
            except Exception:
                logs = []
        log_entry = {
            "id": f"blueprint_{uuid.uuid4().hex}",
            "scene_id": "blueprint",
            "beat_number": 0,
            "agent_name": "BlueprintAgent",
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "output": output,
            "created_at": datetime.utcnow().isoformat()
        }
        logs.append(log_entry)
        logs = logs[-10:]
        logs_path.parent.mkdir(parents=True, exist_ok=True)
        with open(logs_path, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)

    def get_blueprint_logs(self, chapter_id: str) -> list:
        logs_path = self.outputs_dir / chapter_id / "blueprint_logs.json"
        if not logs_path.exists():
            return []
        try:
            with open(logs_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

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

    # --- Individual Beat Access ---
    def get_beat(self, scene_id: str, beat_num: int) -> Optional[Dict]:
        scene = self.get_scene(scene_id)
        if not scene or not scene.scene_events:
            return None
        events = _normalize_events(scene.scene_events)
        idx = beat_num - 1
        if idx < 0 or idx >= len(events):
            return None
        
        event = events[idx]
        style = event.get("style", "general")
        beat_text = event.get("beat", "")
        flow = event.get("conversation_flow", [])
        exchanges = event.get("expected_exchanges", "0")
        dialogue_density = event.get("dialogue_density")
        dialogue_guidelines = event.get("dialogue_guidelines")
        
        tiptap_lines = []
        tiptap_lines.append(beat_text)
        if flow:
            tiptap_lines.append("")
            for f in flow:
                tiptap_lines.append(f"- {f}")
        
        return {
            "beat": "\n".join(tiptap_lines),
            "raw_beat": beat_text,
            "style": style,
            "conversation_flow": flow,
            "expected_exchanges": exchanges,
            "dialogue_density": dialogue_density,
            "dialogue_guidelines": dialogue_guidelines,
        }

    def update_beat(self, scene_id: str, beat_num: int, beat_text: str) -> Optional[Dict]:
        scene = self.get_scene(scene_id)
        if not scene or not scene.scene_events:
            return None
        events = _normalize_events(scene.scene_events)
        idx = beat_num - 1
        if idx < 0 or idx >= len(events):
            return None
            
        existing_event = events[idx]
        lines = [line.strip() for line in beat_text.strip().split("\n") if line.strip()]
        
        style = existing_event.get("style", "general")
        exchanges = existing_event.get("expected_exchanges", "0")
        dialogue_density = existing_event.get("dialogue_density")
        dialogue_guidelines = existing_event.get("dialogue_guidelines")
        flow = []
        beat_lines = []
        
        for line in lines:
            if line.startswith("- ") or line.startswith("* "):
                flow.append(line[2:].strip())
            elif line.lower().startswith("exchanges:"):
                exchanges = line.split(":", 1)[1].strip()
            else:
                # Strip style tags if present
                style_match = re.match(r"^\[(.*?)\]\s*(.*)", line)
                if style_match:
                    style = style_match.group(1).strip()
                    rest = style_match.group(2).strip()
                else:
                    rest = line
                
                beat_match = re.match(r"^\*\*(.*?)\*\*$", rest)
                if beat_match:
                    rest = beat_match.group(1).strip()
                else:
                    rest = rest.replace("**", "").strip()
                
                if rest:
                    beat_lines.append(rest)
                    
        main_beat = " ".join(beat_lines)
        
        events[idx] = {
            "beat": main_beat,
            "style": style,
            "expected_exchanges": exchanges,
            "dialogue_density": dialogue_density,
            "dialogue_guidelines": dialogue_guidelines,
            "conversation_flow": flow
        }
        
        scene.scene_events = events
        self.save_scene(scene)
        return self.get_beat(scene_id, beat_num)

    # --- Individual Beat Sidecars ---
    def get_beat_draft(self, scene_id: str, beat_num: int, draft_type: str) -> Optional[str]:
        parts = scene_id.rsplit("_", 2)
        if len(parts) != 3:
            return None
        chapter_id, act_str, scene_str = parts
        scene_dir = self.outputs_dir / chapter_id / act_str / scene_str
        fpath = scene_dir / f"beat_{beat_num}_{draft_type}.md"
        if fpath.exists():
            return fpath.read_text(encoding="utf-8").strip()
        return None

    def save_beat_draft(self, scene_id: str, beat_num: int, draft_type: str, content: str) -> None:
        parts = scene_id.rsplit("_", 2)
        if len(parts) != 3:
            return
        chapter_id, act_str, scene_str = parts
        scene_dir = self.outputs_dir / chapter_id / act_str / scene_str
        scene_dir.mkdir(parents=True, exist_ok=True)
        fpath = scene_dir / f"beat_{beat_num}_{draft_type}.md"
        fpath.write_text(content.strip() + "\n", encoding="utf-8")

    def assemble_scene_prose(self, scene_id: str) -> Optional[str]:
        scene = self.get_scene(scene_id)
        if not scene or not scene.scene_events:
            return None
        
        parts = scene_id.rsplit("_", 2)
        if len(parts) != 3:
            return None
        chapter_id, act_str, scene_str = parts
        scene_dir = self.outputs_dir / chapter_id / act_str / scene_str
        
        beat_prose_blocks = []
        for idx in range(len(scene.scene_events)):
            fpath = scene_dir / f"beat_{idx + 1}_prose.md"
            if fpath.exists():
                beat_prose_blocks.append(fpath.read_text(encoding="utf-8").strip())
            else:
                beat_prose_blocks.append(f"*[Beat {idx + 1} not yet drafted]*")
                
        return "\n\n---\n\n".join(beat_prose_blocks)

    # --- Style Content ---
    def get_style_content(self, id: str) -> Optional[str]:
        fpath = self.inputs_dir / "styles" / f"{id}.md"
        if not fpath.exists():
            return None
        raw = fpath.read_text(encoding="utf-8")
        match = re.match(r"^---\s*\n.*?\n---\s*\n", raw, re.DOTALL)
        if match:
            return raw[match.end():].strip()
        return raw.strip()

    def parse_blueprint_markdown(self, markdown_content: str) -> dict:
        data = {
            "chapter_title": "Untitled Chapter",
            "acts": []
        }
        
        current_act = None
        current_scene = None
        current_beat = None
        
        lines = markdown_content.splitlines()
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
                
            # Chapter Title
            if stripped.startswith("# ") and not stripped.startswith("## ") and not stripped.startswith("### "):
                title = stripped[2:].replace("Chapter Blueprint:", "").strip()
                data["chapter_title"] = title
                continue
                
            # Act Headers
            act_match = re.match(r"^##\s+Act\s+(\d+):\s*(.*)$", stripped, re.IGNORECASE)
            if act_match:
                act_num = int(act_match.group(1))
                act_theme = act_match.group(2).strip()
                current_act = {
                    "act_number": act_num,
                    "act_theme": act_theme,
                    "act_transition_hint": "",
                    "scenes": []
                }
                data["acts"].append(current_act)
                current_scene = None
                current_beat = None
                continue
                
            # Act hint
            if current_act and stripped.startswith("*Transition Hint:") and stripped.endswith("*"):
                hint = stripped[17:-1].strip()
                current_act["act_transition_hint"] = hint
                continue
                
            # Scene Headers
            scene_match = re.match(r"^###\s+Scene\s+(\d+):\s*(.*)$", stripped, re.IGNORECASE)
            if scene_match:
                scene_num = int(scene_match.group(1))
                setting = scene_match.group(2).strip()
                current_scene = {
                    "scene_number": scene_num,
                    "scene_setting": setting,
                    "scene_description": "",
                    "characters": [],
                    "scene_events": []
                }
                if current_act:
                    current_act["scenes"].append(current_scene)
                current_beat = None
                continue
                
            # Scene Characters
            if current_scene and (stripped.startswith("- **Characters:**") or stripped.startswith("* **Characters:**")):
                chars_str = stripped[17:].strip()
                chars = [c.strip() for c in chars_str.split(",") if c.strip()]
                current_scene["characters"] = chars
                continue
                
            # Scene Description
            if current_scene and (stripped.startswith("- **Description:**") or stripped.startswith("* **Description:**")):
                desc = stripped[18:].strip()
                current_scene["scene_description"] = desc
                continue
                
            # Beat item
            if re.match(r"^\d+\.\s+\*\*\[", stripped):
                exchanges = 1
                exc_match = re.search(r"\*\(Exchanges:\s*(\d+)\)\*$", stripped)
                if exc_match:
                    exchanges = int(exc_match.group(1))
                    stripped_beat = stripped[:exc_match.start()].strip()
                else:
                    stripped_beat = stripped
                    
                beat_match = re.match(r"^\d+\.\s+\*\*\[(.*?)\]\*\*\s+(.*)$", stripped_beat)
                if beat_match:
                    style = beat_match.group(1).strip()
                    beat_text = beat_match.group(2).strip()
                    current_beat = {
                        "beat": beat_text,
                        "style": style,
                        "expected_exchanges": exchanges,
                        "dialogue_density": None,
                        "conversation_flow": []
                    }
                    if current_scene:
                        current_scene["scene_events"].append(current_beat)
                continue
                
            # Conversation flow bullet under a beat
            if current_beat and (stripped.startswith("- ") or stripped.startswith("* ")):
                bullet_text = stripped[2:].strip()
                current_beat["conversation_flow"].append(bullet_text)
                continue
                
        return data

    def _resolve_json_path(self, data: Any, path: str) -> tuple:
        """
        Helper to resolve a path like 'acts[0].scenes[1]' to (parent, target, last_key).
        """
        if not path:
            return None, data, None
            
        parts = re.split(r'\.|(?=\[)', path)
        parts = [p for p in parts if p]
        
        curr = data
        parent = None
        last_key = None
        
        for part in parts:
            parent = curr
            if part.endswith(']'):
                idx_str = part.rstrip(']')
                if '[' in idx_str:
                    arr_name, idx_val = idx_str.split('[')
                    if arr_name:
                        parent = curr
                        curr = curr[arr_name]
                        idx_val = int(idx_val)
                        last_key = idx_val
                        curr = curr[idx_val]
                    else:
                        idx_val = int(idx_val)
                        last_key = idx_val
                        curr = curr[idx_val]
                else:
                    idx_val = int(idx_str)
                    last_key = idx_val
                    curr = curr[idx_val]
            else:
                last_key = part
                curr = curr[part]
                
        return parent, curr, last_key

    def _renumber_blueprint_scenes(self, blueprint_data: dict):
        """Re-assign scene numbers within each act to be sequential (1-indexed)."""
        for act in blueprint_data.get("acts", []):
            for idx, scene in enumerate(act.get("scenes", [])):
                scene["scene_number"] = idx + 1

    def apply_blueprint_create(self, chapter_id: str, parent_path: str, element_type: str, item_data: dict, position: Optional[str] = None) -> dict:
        blueprint = self.get_blueprint(chapter_id)
        if not blueprint:
            raise ValueError("Blueprint not found")
            
        data = blueprint.data
        parent, target, last_key = self._resolve_json_path(data, parent_path)
        
        # If target is a dict and has key of element_type+'s' or plural form
        target_arr = None
        if isinstance(target, dict):
            plural = element_type + "s"
            if plural in target:
                target_arr = target[plural]
        elif isinstance(target, list):
            target_arr = target
            
        if target_arr is None:
            raise ValueError(f"Could not resolve array for {element_type} inside {parent_path}")
            
        # Append/insert
        if not position or position == "end":
            target_arr.append(item_data)
        elif position.startswith("before:"):
            idx = int(position.split(":")[1])
            target_arr.insert(idx, item_data)
        elif position.startswith("after:"):
            idx = int(position.split(":")[1])
            target_arr.insert(idx + 1, item_data)
        else:
            target_arr.append(item_data)
            
        # Re-number blueprint scenes
        self._renumber_blueprint_scenes(data)
        
        # Reset confirmed status to force reconfirm
        blueprint.confirmed = False
        self.save_blueprint(blueprint)
        return data

    def apply_blueprint_update(self, chapter_id: str, path: str, fields: dict) -> dict:
        blueprint = self.get_blueprint(chapter_id)
        if not blueprint:
            raise ValueError("Blueprint not found")
            
        data = blueprint.data
        parent, target, last_key = self._resolve_json_path(data, path)
        
        if not isinstance(target, dict):
            raise ValueError(f"Target at {path} is not a dictionary")
            
        # Patch specific fields
        for k, v in fields.items():
            target[k] = v
            
        self.save_blueprint(blueprint)
        return data

    def apply_blueprint_delete(self, chapter_id: str, path: str) -> dict:
        blueprint = self.get_blueprint(chapter_id)
        if not blueprint:
            raise ValueError("Blueprint not found")
            
        data = blueprint.data
        parent, target, last_key = self._resolve_json_path(data, path)
        
        if parent is None or last_key is None:
            raise ValueError(f"Invalid path to delete: {path}")
            
        if isinstance(parent, list) and isinstance(last_key, int):
            parent.pop(last_key)
        elif isinstance(parent, dict):
            parent.pop(last_key, None)
            
        # Re-number blueprint scenes
        self._renumber_blueprint_scenes(data)
        
        # Reset confirmed status to force reconfirm
        blueprint.confirmed = False
        self.save_blueprint(blueprint)
        return data

    def apply_scene_operation(self, scene_id: str, operation: dict) -> dict:
        """
        Generic dispatcher for scene-level structured edits from DocumentEditAgent.
        Accepts the raw operation dict and applies it against scene.scene_events.
        Replaces separate apply_scene_create/update/delete methods.
        """
        scene = self.get_scene(scene_id)
        if not scene:
            raise ValueError("Scene not found")

        op = operation.get("op")
        beats = list(scene.scene_events or [])

        if op == "create":
            item_data = operation.get("data", {})
            position = operation.get("position", "end")

            if not position or position == "end":
                beats.append(item_data)
            elif position.startswith("before:"):
                idx = int(position.split(":")[1])
                beats.insert(idx, item_data)
            elif position.startswith("after:"):
                idx = int(position.split(":")[1])
                beats.insert(idx + 1, item_data)
            else:
                beats.append(item_data)

        elif op == "update":
            # path is relative to scene_events, e.g. "[2]" or "scene_events[2]"
            raw_path = operation.get("path", "")
            # Strip leading "scene_events" prefix if LLM included it
            path = re.sub(r'^scene_events\.?', '', raw_path).strip()
            if path:
                parent, target, last_key = self._resolve_json_path(beats, path)
                if not isinstance(target, dict):
                    raise ValueError(f"Target beat at '{raw_path}' is not a dict")
                for k, v in operation.get("fields", {}).items():
                    target[k] = v
            else:
                raise ValueError(f"No valid path for update operation: {raw_path}")

        elif op == "delete":
            raw_path = operation.get("path", "")
            path = re.sub(r'^scene_events\.?', '', raw_path).strip()
            parent, target, last_key = self._resolve_json_path(beats, path)
            if parent is None or last_key is None:
                raise ValueError(f"Invalid path to delete: {raw_path}")
            if isinstance(parent, list) and isinstance(last_key, int):
                parent.pop(last_key)
            elif isinstance(parent, dict):
                parent.pop(last_key, None)

        else:
            raise ValueError(f"Unsupported scene operation: {op}")

        # Persist updated beats via save_scene
        scene.scene_events = beats
        self.save_scene(scene)
        return {"scene_events": beats}

    def reorder_scene_beats(self, scene_id: str, old_indices: List[int]) -> Optional[Scene]:
        scene = self.get_scene(scene_id)
        if not scene:
            return None
            
        events = list(scene.scene_events or [])
        if len(old_indices) != len(events):
            raise ValueError("Reorder mapping length must match events length")
            
        new_events = [events[idx] for idx in old_indices]
        scene.scene_events = new_events
        
        parts = scene_id.rsplit("_", 2)
        if len(parts) == 3:
            chapter_id, act_str, scene_str = parts
            scene_dir = self.outputs_dir / chapter_id / act_str / scene_str
            
            draft_types = ["narration", "dialogue", "prose"]
            
            # Rename existing files to a temp namespace to avoid collision/overwriting
            for idx in range(len(events)):
                beat_num = idx + 1
                for dtype in draft_types:
                    fpath = scene_dir / f"beat_{beat_num}_{dtype}.md"
                    if fpath.exists():
                        fpath.rename(scene_dir / f"beat_{beat_num}_{dtype}.md.tmp")
            
            # Move temp files to their new index locations
            for new_idx, old_idx in enumerate(old_indices):
                new_beat_num = new_idx + 1
                old_beat_num = old_idx + 1
                for dtype in draft_types:
                    temp_path = scene_dir / f"beat_{old_beat_num}_{dtype}.md.tmp"
                    target_path = scene_dir / f"beat_{new_beat_num}_{dtype}.md"
                    if temp_path.exists():
                        temp_path.rename(target_path)
                    elif target_path.exists():
                        target_path.unlink()
            
            # Clean up any leftover .tmp files
            for idx in range(len(events)):
                beat_num = idx + 1
                for dtype in draft_types:
                    temp_path = scene_dir / f"beat_{beat_num}_{dtype}.md.tmp"
                    if temp_path.exists():
                        temp_path.unlink()
                        
            # Update Agent Logs in logs.json
            logs_path = scene_dir / "logs.json"
            if logs_path.exists():
                try:
                    with open(logs_path, "r", encoding="utf-8") as f:
                        logs = json.load(f)
                    
                    old_to_new = {old_idx: new_idx for new_idx, old_idx in enumerate(old_indices)}
                    
                    for log in logs:
                        b_num = log.get("beat_number", 0)
                        if b_num > 0:
                            old_idx = b_num - 1
                            if old_idx in old_to_new:
                                log["beat_number"] = old_to_new[old_idx] + 1
                                
                    with open(logs_path, "w", encoding="utf-8") as f:
                        json.dump(logs, f, indent=2)
                except Exception as e:
                    print(f"Error updating logs during reorder: {e}")
                    
        self.save_scene(scene)
        return scene

    def save_style_content(self, id: str, body: str) -> None:
        fpath = self.inputs_dir / "styles" / f"{id}.md"
        fpath.parent.mkdir(parents=True, exist_ok=True)
        existing = fpath.read_text(encoding="utf-8") if fpath.exists() else ""
        match = re.match(r"^---\s*\n.*?\n---\s*\n", existing, re.DOTALL)
        frontmatter = match.group(0) if match else "---\n---\n\n"
        fpath.write_text(frontmatter + body.strip() + "\n", encoding="utf-8")


# Beat normalization helper
def _normalize_events(events: list) -> list:
    if not events:
        return []
    if isinstance(events[0], str):
        return [{"beat": e, "style": "general"} for e in events]
    return events


# Global singleton
storage = FileStorageService()
