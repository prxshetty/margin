import json
import re
import llm
import config
from typing import Dict, List, Optional, Any

class DocumentEditAgent:
    """
    Schema-driven, context-aware Document Edit Agent.
    Receives current document structure + user request + schema context,
    and returns a structured edit operation (create/update/delete/clarify).
    """

    def __init__(self):
        self.client = llm.LLMClient()
        self.system_prompt_template = """You are a precise structural document editor assistant.
Your task is to analyze the user's natural language request to edit a narrative writing document, and output EXACTLY one structured edit operation matching the current document data and schema.

You must only use the following 4 generic operations:

1. CREATE A NEW ELEMENT:
{{"op": "create", "element_type": "scene" or "beat" or "act", "parent_path": "acts[0]" or "scene_events" or "", "data": {{...fields matching schema...}}, "position": "before:N" or "after:N" or "end"}}

2. UPDATE AN EXISTING ELEMENT'S FIELDS:
{{"op": "update", "element_type": "scene" or "beat" or "act", "path": "acts[0].scenes[1]" or "scene_events[2]" or "acts[0]", "fields": {{...only the fields being modified...}}}}

3. DELETE AN ELEMENT:
{{"op": "delete", "element_type": "scene" or "beat" or "act", "path": "acts[0].scenes[2]" or "scene_events[1]"}}

4. ASK FOR CLARIFICATION (when intent is ambiguous, e.g. "add a scene" but you don't know where, or target path is unclear):
{{"op": "clarify", "question": "Your clarifying question to the user", "options": ["Option A", "Option B"]}}

DOCUMENT TYPE: {document_type}

ACTIVE DOCUMENT CURRENT DATA:
```json
{current_data_json}
```

SCHEMA FOR THIS ELEMENT TYPE:
```yaml
{schema_yaml}
```

SURROUNDING DOCUMENT CONTEXT:
{document_context}

CRITICAL RULES:
1. Output ONLY a valid JSON object matching one of the 4 operations.
2. Do NOT output any preamble, extra chat prose, explanations, or thinking blocks in the final text.
3. Make sure paths are correct. Indexing is 0-indexed in the JSON arrays (e.g. `acts[0].scenes[1]`).
4. In "position" for a create operation:
   - Use "before:N" to insert before the N-th element (0-indexed).
   - Use "after:N" to insert after the N-th element.
   - Use "end" or leave out to append to the end.
5. All fields in your "data" or "fields" object MUST conform strictly to the SCHEMA provided.
"""

    def generate_operation(
        self,
        document_type: str,
        current_data: Any,
        schema_dict: dict,
        user_message: str,
        history: List[Dict[str, str]] = None,
        context_str: str = ""
    ) -> dict:
        import yaml
        
        current_data_json = json.dumps(current_data, indent=2)
        schema_yaml = yaml.dump(schema_dict, indent=2) if schema_dict else "No explicit schema provided."

        system_prompt = self.system_prompt_template.format(
            document_type=document_type,
            current_data_json=current_data_json,
            schema_yaml=schema_yaml,
            document_context=context_str or "No additional context."
        )

        user_prompt = f"User Request: {user_message}\n"
        if history:
            user_prompt += "\nConversation History:\n"
            for turn in history:
                role = turn.get("role", "user")
                content = turn.get("content", "")
                user_prompt += f"- {role}: {content}\n"

        response = self.client.generate_to_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.1,  # highly deterministic
            max_tokens=1000
        )

        # Parse JSON from response
        try:
            parsed = json.loads(response)
            return parsed
        except json.JSONDecodeError:
            try:
                start = response.find("{")
                end = response.rfind("}") + 1
                if start >= 0 and end > start:
                    return json.loads(response[start:end])
            except Exception:
                pass

        # Fallback to clarification
        return {
            "op": "clarify",
            "question": "I had trouble parsing the edit instruction. Could you please specify exactly what you'd like to change?",
            "options": []
        }
