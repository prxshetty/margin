"""
Schema Loader — reads schema.yaml to generate prompts and validate structure.
This is the bridge between the user-editable schema and the code.
"""

import yaml
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Any


class SchemaLoader:
    """Loads schema from schema/ directory or legacy schema.yaml file."""

    def __init__(self, schema_path: str = None):
        self.schema_path = Path(schema_path) if schema_path else None
        self.schema = self._load()

    def _load(self) -> dict:
        schema_dir = Path("schema")

        if schema_dir.exists() and (schema_dir / "scene.yaml").exists():
            return self._load_from_directory(schema_dir)

        if self.schema_path and self.schema_path.exists():
            with open(self.schema_path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {"scene": {"fields": {}}, "act": {"fields": {}}, "agent_fields": {}}

        return {"scene": {"fields": {}}, "act": {"fields": {}}, "agent_fields": {}}

    def _load_from_directory(self, schema_dir: Path) -> dict:
        result = {"scene": {"fields": {}}, "act": {"fields": {}}, "agent_fields": {}}

        scene_file = schema_dir / "scene.yaml"
        if scene_file.exists():
            with open(scene_file, "r", encoding="utf-8") as f:
                scene_data = yaml.safe_load(f) or {}
                result["scene"] = scene_data

        act_file = schema_dir / "act.yaml"
        if act_file.exists():
            with open(act_file, "r", encoding="utf-8") as f:
                act_data = yaml.safe_load(f) or {}
                result["act"] = act_data

        agents_file = schema_dir / "agents.yaml"
        if agents_file.exists():
            with open(agents_file, "r", encoding="utf-8") as f:
                agents_data = yaml.safe_load(f) or {}
                result["agent_fields"] = {k: v for k, v in agents_data.items() if isinstance(v, list)}

        return result

    def reload(self):
        """Reload schema from disk."""
        self.schema = self._load()

    def get_scene_fields(self) -> dict:
        """Get all scene field definitions."""
        return self.schema.get("scene", {}).get("fields", {})

    def get_act_fields(self) -> dict:
        """Get all act field definitions."""
        return self.schema.get("act", {}).get("fields", {})

    def get_field_names(self, entity: str) -> List[str]:
        """Get list of field names for an entity type."""
        if entity == "scene":
            return list(self.get_scene_fields().keys())
        elif entity == "act":
            return list(self.get_act_fields().keys())
        return []

    def get_required_fields(self, entity: str) -> List[str]:
        """Get list of required field names."""
        fields = self.get_scene_fields() if entity == "scene" else self.get_act_fields()
        return [name for name, cfg in fields.items() if cfg.get("required", False)]

    def get_field_config(self, entity: str, field_name: str) -> Optional[dict]:
        """Get config for a specific field."""
        fields = self.get_scene_fields() if entity == "scene" else self.get_act_fields()
        return fields.get(field_name)

    def get_field_type(self, entity: str, field_name: str) -> str:
        """Get the type of a field (int, str, list[str], etc)."""
        config = self.get_field_config(entity, field_name)
        if config:
            return config.get("type", "str")
        return "str"

    def get_field_default(self, entity: str, field_name: str) -> Any:
        """Get the default value for a field."""
        config = self.get_field_config(entity, field_name)
        if not config:
            return ""
        ftype = config.get("type", "str")
        if ftype == "int":
            return config.get("default", 0)
        elif ftype == "list[str]":
            return []
        elif ftype == "bool":
            return config.get("default", False)
        return config.get("default", "")

    def get_field_options(self, entity: str, field_name: str) -> List[str]:
        """Get allowed options for a field, if any."""
        config = self.get_field_config(entity, field_name)
        if config:
            return config.get("options", [])
        return []

    def generate_json_schema(self, entity: str) -> str:
        """Generate the JSON schema section for the blueprint prompt."""
        if entity == "scene":
            fields = self.get_scene_fields()
        elif entity == "act":
            fields = self.get_act_fields()
        else:
            return ""

        lines = []
        for name, config in fields.items():
            ftype = config.get("type", "str")
            required = config.get("required", False)
            desc = config.get("description", "")
            options = config.get("options")

            json_type = {
                "int": "integer",
                "str": "string",
                "list[str]": "array of strings",
                "list": "array",
                "bool": "boolean",
            }.get(ftype, "string")

            constraint = ""
            if options:
                constraint = f" (options: {', '.join(options)})"

            req_mark = " (required)" if required else ""
            lines.append(f'          "{name}": {json_type}  #{desc}{constraint}{req_mark}')

        return ",\n".join(lines) if lines else ""

    def generate_blueprint_schema_section(self) -> str:
        """Build the full JSON schema that goes into blueprint.txt prompt."""
        scene_json = self.generate_json_schema("scene")
        act_json = self.generate_json_schema("act")

        return f"""Output a JSON structure with this schema:
{{
  "chapter_title": "string",
  "acts": [
    {{
      "act_number": integer,
      "act_theme": "string",
      "act_transition_hint": "string",
      "scenes": [
        {{
{scene_json}
        }}
      ]
    }}
  ]
}}"""

    def generate_field_list_for_agent(self, agent: str) -> str:
        """Generate a list of fields relevant to a specific agent."""
        agent_fields_map = self.schema.get("agent_fields", {})

        available_scene_fields = self.get_field_names("scene")

        if agent in agent_fields_map:
            relevant_fields = agent_fields_map[agent]
        else:
            relevant_fields = []

        lines = []
        for field_name in relevant_fields:
            if field_name in available_scene_fields:
                config = self.get_field_config("scene", field_name)
                desc = config.get("description", "") if config else ""
                lines.append(f"- {field_name}: {desc}")

        return "\n".join(lines) if lines else ""

    def parse_blueprint_response(self, response: str) -> dict:
        """Parse the LLM response and extract data using schema knowledge."""
        try:
            data = json.loads(response)
        except json.JSONDecodeError:
            try:
                start = response.find("{")
                end = response.rfind("}") + 1
                if start >= 0 and end > start:
                    data = json.loads(response[start:end])
            except:
                data = {"chapter_title": "Untitled", "acts": []}

        return self._normalize_blueprint_data(data)

    def _normalize_blueprint_data(self, data: dict) -> dict:
        """Normalize raw LLM response to match schema."""
        scene_fields = self.get_field_names("scene")
        act_fields = self.get_field_names("act")

        normalized = {
            "chapter_title": data.get("chapter_title", "Untitled Chapter"),
            "acts": []
        }

        for act_data in data.get("acts", []):
            norm_act = {"scenes": []}

            for field_name in act_fields:
                if field_name in act_data:
                    norm_act[field_name] = act_data[field_name]

            for scene_data in act_data.get("scenes", []):
                norm_scene = {}
                for field_name in scene_fields:
                    if field_name in scene_data:
                        norm_scene[field_name] = scene_data[field_name]

                if norm_scene:
                    norm_act["scenes"].append(norm_scene)

            if norm_act["scenes"]:
                normalized["acts"].append(norm_act)

        return normalized

    def get_extra_fields_from_data(self, data: dict, entity: str) -> dict:
        """Extract any fields not in schema (for forward compatibility)."""
        known_fields = set(self.get_field_names(entity))
        extra = {}

        for key, value in data.items():
            if key not in known_fields:
                extra[key] = value

        return extra


def get_schema(schema_path: str = None) -> SchemaLoader:
    """Get a SchemaLoader instance."""
    return SchemaLoader(schema_path)