import json
import re
import uuid
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import difflib

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from agents.document_edit_agent import DocumentEditAgent
from agents.rewrite_agent import RewriteAgent
from api.services.file_storage import storage
from schema_loader import get_schema
import llm
import config

router = APIRouter(prefix="/api/assist", tags=["assist"])


class AssistSelection(BaseModel):
    text: str
    from_position: Optional[int] = Field(default=None, alias="from")
    to: Optional[int] = None


class AssistEditRequest(BaseModel):
    context_path: str
    content: Optional[str] = ""
    message: str
    history: List[Dict[str, Any]] = Field(default_factory=list)
    selection: Optional[AssistSelection] = None
    cursor: Optional[int] = None
    block_type: Optional[str] = "paragraph"
    text_before: Optional[str] = None
    text_after: Optional[str] = None
    current_beat_index: Optional[int] = None
    chapter_id: Optional[str] = None


def _preview(text: Optional[str], limit: int = 1200) -> str:
    if not text:
        return ""
    clean = text.strip()
    return clean if len(clean) <= limit else clean[:limit].rstrip() + "..."


def _log_for_path(
    path: str,
    message: str,
    output: str,
    operation: str,
    chapter_id: Optional[str] = None,
    input_text: Optional[str] = None,
    raw_operation: Optional[dict] = None,
) -> None:
    log = {
        "id": str(uuid.uuid4()),
        "operation": operation,
        "context_path": path,
        "feedback": message,
        "input_preview": _preview(input_text),
        "output": output,
        "timestamp": datetime.utcnow().isoformat(),
        "isAI": True,
    }
    if raw_operation is not None:
        log["raw_operation"] = raw_operation

    scene_match = re.match(r"^scenes/([^/]+)", path)
    if scene_match:
        storage.save_ai_editor_log(scene_match.group(1), log)
        return

    target_chapter_id = chapter_id
    chapter_match = re.match(r"^chapters/([^/]+)/([^/]+)", path)
    doc_type = None
    doc_id = None
    if chapter_match:
        target_chapter_id = chapter_match.group(1)
        doc_type = chapter_match.group(2)
        doc_id = doc_type
    elif path.startswith("characters/"):
        doc_type = "character"
        doc_id = path.split("/", 1)[1]
    elif path.startswith("styles/"):
        doc_type = "style"
        doc_id = path.split("/", 1)[1]

    if target_chapter_id:
        storage.save_chapter_ai_editor_log(target_chapter_id, log, doc_type=doc_type, doc_id=doc_id)


def _save_text_target(path: str, content: str) -> None:
    beat_draft = re.match(r"^scenes/([^/]+)/beats/(\d+)/(narration|dialogue)$", path)
    if beat_draft:
        scene_id, beat_num, draft_type = beat_draft.groups()
        if not storage.get_scene(scene_id):
            raise HTTPException(status_code=404, detail="Scene not found")
        storage.save_beat_draft(scene_id, int(beat_num), draft_type, content)
        return

    scene_prose = re.match(r"^scenes/([^/]+)/prose$", path)
    if scene_prose:
        scene_id = scene_prose.group(1)
        scene = storage.get_scene(scene_id)
        if not scene:
            raise HTTPException(status_code=404, detail="Scene not found")
        scene.generated_content = content
        storage.save_scene(scene)
        return

    outline = re.match(r"^chapters/([^/]+)/outline$", path)
    if outline:
        chapter_id = outline.group(1)
        chapter = storage.get_chapter(chapter_id)
        if not chapter:
            raise HTTPException(status_code=404, detail="Chapter not found")
        chapter.raw_outline = content
        storage.save_chapter(chapter)
        return

    character = re.match(r"^characters/([^/]+)$", path)
    if character:
        storage.save_character_content(character.group(1), content)
        return

    style = re.match(r"^styles/([^/]+)$", path)
    if style:
        storage.save_style_content(style.group(1), content)
        return

    raise HTTPException(status_code=400, detail=f"Unsupported text edit path: {path}")


def _feedback_for_text_path(path: str, message: str) -> str:
    draft_match = re.match(r"^scenes/[^/]+/beats/\d+/(narration|dialogue)$", path)
    if not draft_match:
        return message

    draft_type = draft_match.group(1)
    if draft_type == "dialogue":
        format_note = (
            "Formatting requirement: this is a dialogue draft, not a beat outline. "
            "Write natural dialogue/script-style paragraphs. Do not use markdown bullets "
            "or numbered lists unless the user explicitly asks for a list."
        )
    else:
        format_note = (
            "Formatting requirement: this is a narration draft, not a beat outline. "
            "Write polished prose paragraphs. Do not use markdown bullets or numbered "
            "lists unless the user explicitly asks for a list."
        )
    return f"{message}\n\n{format_note}"


def _apply_blueprint_operation(chapter_id: str, operation: dict) -> tuple[str, Any]:
    op_type = operation.get("op")
    if op_type == "create":
        updated_data = storage.apply_blueprint_create(
            chapter_id=chapter_id,
            parent_path=operation.get("parent_path", ""),
            element_type=operation.get("element_type", "scene"),
            item_data=operation.get("data", {}),
            position=operation.get("position"),
        )
        return f"Successfully created {operation.get('element_type')}.", updated_data
    if op_type == "update":
        updated_data = storage.apply_blueprint_update(
            chapter_id=chapter_id,
            path=operation.get("path", ""),
            fields=operation.get("fields", {}),
        )
        return f"Successfully updated {operation.get('element_type')}.", updated_data
    if op_type == "delete":
        updated_data = storage.apply_blueprint_delete(
            chapter_id=chapter_id,
            path=operation.get("path", ""),
        )
        return f"Successfully deleted {operation.get('element_type')}.", updated_data
    raise HTTPException(status_code=400, detail=f"Unsupported operation: {op_type}")


@router.post("/edit")
def edit(payload: AssistEditRequest):
    path = payload.context_path.strip("/")
    message = payload.message.strip()
    if not path:
        raise HTTPException(status_code=400, detail="Missing context_path")
    if not message:
        raise HTTPException(status_code=400, detail="Missing message")

    if payload.selection and payload.selection.text:
        rewritten_text = RewriteAgent().generate(
            selected_text=payload.selection.text,
            feedback=_feedback_for_text_path(path, message),
            context_text=payload.content or "",
        )
        _log_for_path(
            path,
            message,
            rewritten_text,
            "rewrite",
            payload.chapter_id,
            input_text=payload.selection.text,
        )
        return {"type": "rewrite", "rewritten_text": rewritten_text}

    blueprint = re.match(r"^chapters/([^/]+)/blueprint$", path)
    if blueprint:
        chapter_id = blueprint.group(1)
        current = storage.get_blueprint(chapter_id)
        if not current:
            raise HTTPException(status_code=404, detail="Blueprint not found")
        schema_dict = get_schema().get_schema_for_document_type("blueprint")
        operation = DocumentEditAgent().generate_operation(
            document_type="blueprint",
            current_data=current.data,
            schema_dict=schema_dict,
            user_message=message,
            history=payload.history,
        )
        if operation.get("op") == "clarify":
            return {
                "type": "clarification_needed",
                "question": operation.get("question", "Could you clarify your request?"),
                "options": operation.get("options", []),
            }
        msg, updated_data = _apply_blueprint_operation(chapter_id, operation)
        _log_for_path(
            path,
            message,
            msg,
            operation.get("op", "edit"),
            payload.chapter_id,
            input_text=json.dumps(current.data, indent=2),
            raw_operation=operation,
        )
        return {"type": "applied", "message": msg, "data": updated_data, "strategy": "structure"}

    scene_beats = re.match(r"^scenes/([^/]+)/beats(?:/(\d+))?$", path)
    if scene_beats:
        scene_id, beat_num = scene_beats.groups()
        scene = storage.get_scene(scene_id)
        if not scene:
            raise HTTPException(status_code=404, detail="Scene not found")

        parts = scene_id.rsplit("_", 2)
        act_num = parts[1].replace("act-", "") if len(parts) > 1 else "?"
        scene_num = parts[2].replace("scene-", "") if len(parts) > 2 else "?"
        focused_index = payload.current_beat_index
        if focused_index is None and beat_num:
            focused_index = int(beat_num) - 1

        focused_beat_str = (
            f"FOCUSED BEAT: index {focused_index} (Beat {focused_index + 1}).\n"
            if focused_index is not None else ""
        )
        doc_content_str = (
            f"CURRENT BEAT CONTENT (as the user sees it):\n{payload.content}\n"
            if payload.content else ""
        )
        schema_dict = get_schema().get_schema_for_document_type("beat")
        operation = DocumentEditAgent().generate_operation(
            document_type="beat",
            current_data=scene.scene_events or [],
            schema_dict=schema_dict,
            user_message=message,
            history=payload.history,
            context_str=(
                f"You are editing Act {act_num}, Scene {scene_num}.\n"
                f"Scene Setting: {scene.scene_setting}\n"
                f"Scene Description: {scene.scene_description}\n"
                f"Characters: {', '.join(scene.characters or [])}\n"
                f"{focused_beat_str}"
                f"{doc_content_str}"
                f"Note: The focused beat's TipTap markdown shows its current text. The paragraph text is the 'beat' description field. Lines starting with '*' or '-' are the beat's sub-bullets, which correspond to the 'conversation_flow' list field. In your 'conversation_flow' list updates, store clean strings WITHOUT the '*' or '-' prefix. If the user request is a normal prose addition, append it directly to the beat description field string.\n"
                f"CRITICAL RULE: When a beat is FOCUSED, instructions like 'add here', 'add to this', 'insert here', or 'edit this' modify that focused beat. Do NOT create a new beat unless the user explicitly requests a new beat.\n"
                f"For 'create', use parent_path='scene_events' or leave it empty. For 'update'/'delete', use path='[N]' referencing the beat index directly."
            ),
        )
        if operation.get("op") == "clarify":
            return {
                "type": "clarification_needed",
                "question": operation.get("question", "Could you clarify your request?"),
                "options": operation.get("options", []),
            }
        updated_data = storage.apply_scene_operation(scene_id, operation)
        msg = f"Successfully applied '{operation.get('op')}' to scene beat."
        _log_for_path(
            path,
            message,
            msg,
            operation.get("op", "edit"),
            payload.chapter_id,
            input_text=json.dumps(scene.scene_events or [], indent=2),
            raw_operation=operation,
        )
        return {"type": "applied", "message": msg, "data": updated_data, "strategy": "structure"}

    agent = RewriteAgent()
    if payload.text_before is not None or payload.text_after is not None:
        insert_text = agent.generate_insert(
            text_before=payload.text_before or "",
            text_after=payload.text_after or "",
            block_type=payload.block_type or "paragraph",
            feedback=_feedback_for_text_path(path, message),
        )
        updated_content = f"{payload.text_before or ''}\n\n{insert_text}{payload.text_after or ''}"
        _save_text_target(path, updated_content)
        _log_for_path(
            path,
            message,
            insert_text,
            "insert",
            payload.chapter_id,
            input_text=f"Before:\n{payload.text_before or ''}\n\nAfter:\n{payload.text_after or ''}",
        )
        return {"type": "applied", "message": "Text inserted.", "content": updated_content, "strategy": "text"}

    original = payload.content or ""
    rewritten = agent.generate(
        selected_text=original,
        feedback=_feedback_for_text_path(path, message),
        context_text=original,
    )
    _save_text_target(path, rewritten)
    _log_for_path(path, message, rewritten, "rewrite", payload.chapter_id, input_text=original)
    return {"type": "applied", "message": "Text updated.", "content": rewritten, "strategy": "text"}


def _resolve_simple_assist_client() -> llm.LLMClient:
    """Return an LLMClient configured with the active endpoint from settings,
    falling back to .env defaults if no endpoint is active."""
    s = storage.get_settings()
    ep_id = s.get("active_endpoint")
    if ep_id:
        endpoints = s.get("endpoints") or {}
        ep = endpoints.get(ep_id)
        if ep:
            return llm.LLMClient(
                model=ep.get("model") or None,
                base_url=ep.get("url") or None,
                api_key=ep.get("api_key") or None,
            )
    return llm.LLMClient()


def _build_simple_system_prompt(base_text: str) -> str:
    """Prepend additional_context to a system prompt if it's non-empty."""
    s = storage.get_settings()
    ctx = (s.get("additional_context") or "").strip()
    if ctx:
        return f"\n\n--- USER CONTEXT ---\n{ctx}\n--- END USER CONTEXT ---\n\n{base_text}"
    return base_text


def _inject_pinned_ref_files(system_parts: list, already_seen: set) -> list:
    """Append pinned ref file contents to the system prompt parts list."""
    s = storage.get_settings()
    pinned = s.get("pinned_ref_files") or []
    if not pinned:
        return system_parts
    available = {f["path"]: f["name"] for f in storage.list_input_files()}
    for pp in pinned:
        if pp in already_seen:
            continue
        if pp not in available:
            continue
        try:
            content = storage.read_input_file(pp)
        except Exception:
            continue
        label = available[pp].replace("_", " ").replace(".md", "").upper()
        system_parts.append(f"--- PINNED CONTEXT: {label} ---\n{content}")
        already_seen.add(pp)
    return system_parts


def _pick_writer_max_tokens() -> int | None:
    """Pick max_tokens from default_verbosity setting. None if token limits disabled."""
    if config.DISABLE_TOKEN_LIMITS:
        return None
    s = storage.get_settings()
    mapping = {"concise": 250, "balanced": 500, "expansive": 1000}
    return mapping.get(s.get("default_verbosity", "balanced"), 500)


def _load_simple_prompt(filename: str) -> str:
    path = Path(__file__).parent.parent.parent / "prompts" / "simple" / filename
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as e:
        print(f"Error loading prompt {filename} from {path}: {e}")
        return ""


class SimpleAssistRequest(BaseModel):
    content: str = ""
    message: str
    mode: str = "chat"
    history: List[Dict[str, Any]] = Field(default_factory=list)
    selected_text: Optional[str] = None
    text_before: Optional[str] = None
    text_after: Optional[str] = None
    ref_files: Optional[List[Dict[str, Any]]] = None
    cursor_paragraph_index: Optional[int] = None



@router.get("/simple/logs")
def get_simple_logs():
    return storage.get_simple_ai_logs()


@router.delete("/simple/logs")
def clear_simple_logs():
    storage.clear_simple_ai_logs()
    return {"status": "ok"}


def _log_simple_assist(
    mode: str,
    system_prompt: str,
    user_prompt: str,
    response: str,
    instruction: str,
    selected_text: Optional[str] = None,
    text_before: Optional[str] = None,
    text_after: Optional[str] = None,
    ref_files: Optional[List[Dict[str, Any]]] = None,
    edit_mode: Optional[str] = None,
    planner_system_prompt: Optional[str] = None,
    planner_user_prompt: Optional[str] = None,
    planner_output: Optional[str] = None,
) -> None:
    log_entry = {
        "id": f"simple_{uuid.uuid4().hex}",
        "timestamp": datetime.utcnow().isoformat(),
        "mode": mode,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "output": response,
        "instruction": instruction,
        "selected_text": selected_text,
        "text_before": text_before,
        "text_after": text_after,
        "ref_files": ref_files,
        "success": True,
    }
    if edit_mode is not None:
        log_entry["edit_mode"] = edit_mode
    if planner_system_prompt is not None:
        log_entry["planner_system_prompt"] = planner_system_prompt
    if planner_user_prompt is not None:
        log_entry["planner_user_prompt"] = planner_user_prompt
    if planner_output is not None:
        log_entry["planner_output"] = planner_output
    storage.save_simple_ai_log(log_entry)


def run_planner(message: str, selected_text: Optional[str] = None) -> tuple[dict, str, str, str]:
    system = _load_simple_prompt("simple-planner.md")
    
    available = storage.list_input_files()
    
    user_prompt_lines = [f"INSTRUCTION: {message}\n"]
    if selected_text:
        user_prompt_lines.append(f"SELECTED TEXT (hint for placement):\n{selected_text}\n")
    
    user_prompt_lines.append(f"AVAILABLE FILES:\n" + "\n".join(f['path'] for f in available))
    
    user = "\n".join(user_prompt_lines)
    
    raw = llm.LLMClient().generate_to_completion(
        system_prompt=system,
        user_prompt=user,
        temperature=0.1,
        max_tokens=300
    )
    
    try:
        return json.loads(raw), system, user, raw
    except Exception:
        try:
            start, end = raw.find("{"), raw.rfind("}") + 1
            return json.loads(raw[start:end]), system, user, raw
        except Exception:
            return {"context_needed": []}, system, user, raw



def build_generator_prompts(
    message: str,
    context_needed: List[str],
    content: str,
    target_paragraph_index: int,
    replace: bool,
    selected_text: Optional[str] = None,
) -> tuple[str, str]:
    
    paragraphs = [p for p in content.split('\n\n') if p.strip()]
    
    idx = max(0, min(target_paragraph_index, len(paragraphs) - 1))
    
    target_para = paragraphs[idx] if paragraphs else ""
    
    system_parts = [_load_simple_prompt("simple-writer.md")]
    
    available_paths = [f['path'] for f in storage.list_input_files()]
    
    for filepath in context_needed:
        actual_path = filepath
        if actual_path not in available_paths:
            matches = difflib.get_close_matches(filepath, available_paths, n=1, cutoff=0.5)
            if matches:
                actual_path = matches[0]
            else:
                # Fallback: check if the first part of the filename matches (e.g. "kaelen")
                req_base = filepath.split('/')[-1].split('_')[0].lower()
                for p in available_paths:
                    if p.split('/')[-1].lower().startswith(req_base):
                        actual_path = p
                        break
        
        try:
            file_content = storage.read_input_file(actual_path)
            parts = actual_path.split("/")
            folder_name = parts[0] if len(parts) > 1 else ""
            file_name = parts[-1]
            
            if folder_name.lower().endswith("s"):
                folder_str = folder_name[:-1].upper()
            else:
                folder_str = folder_name.upper()
                
            label = file_name.replace("_", " ").replace(".md", "").upper()
            
            if folder_str:
                header = f"--- {folder_str} CONTEXT: {label} ---"
            else:
                header = f"--- CONTEXT: {label} ---"
                
            system_parts.append(f"{header}\n{file_content}")
        except Exception:
            pass
    
    user_parts = [f"INSTRUCTION:\n{message}"]
    if selected_text:
        user_parts.append(f"USER'S SELECTED TEXT:\n{selected_text}")
    
    if replace:
        user_parts.append(f"REPLACE THIS PARAGRAPH:\n{target_para}")
    else:
        user_parts.append(f"INSERT AFTER THIS PARAGRAPH:\n{target_para}")
    
    return "\n\n".join(system_parts), "\n\n".join(user_parts)



@router.post("/simple")
async def simple_assist(payload: SimpleAssistRequest):
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Missing message")

    mode = payload.mode.strip().lower()

    async def event_generator():
        try:
            if mode == "edit":
                yield {"data": json.dumps({"status": "planning"})}

                loop = asyncio.get_running_loop()
                plan, planner_system, planner_user, planner_raw = await loop.run_in_executor(
                    None,
                    lambda: run_planner(payload.message, payload.selected_text)
                )

                context_needed = plan.get("context_needed", [])
                yield {"data": json.dumps({
                    "status": "context_resolved",
                    "context_needed": context_needed
                })}

                yield {"data": json.dumps({"status": "generating"})}

                paragraphs = [p for p in payload.content.split('\n\n') if p.strip()]
                
                # Determine placement mechanically
                if payload.selected_text:
                    replace = True
                    # Find which paragraph contains the selected text
                    target_idx = next(
                        (i for i, p in enumerate(paragraphs) if payload.selected_text[:50] in p),
                        len(paragraphs) - 1
                    )
                else:
                    replace = False
                    target_idx = payload.cursor_paragraph_index if payload.cursor_paragraph_index is not None else len(paragraphs) - 1
                
                resolved_idx = max(0, min(target_idx, len(paragraphs) - 1))

                system_prompt, user_prompt = build_generator_prompts(
                    payload.message, context_needed, payload.content, resolved_idx, replace, payload.selected_text
                )

                raw = await loop.run_in_executor(
                    None,
                    lambda: llm.LLMClient().generate_to_completion(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        temperature=0.7,
                        max_tokens=config.AGENT_CONFIG.get("writer", {}).get("max_tokens", 500)
                    )
                )

                clean_raw = raw.strip()
                if clean_raw.startswith("```"):
                    lines = clean_raw.splitlines()
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    clean_raw = "\n".join(lines).strip()

                output_text = clean_raw
                edit_mode = "replace" if payload.selected_text else "insert"

                await loop.run_in_executor(
                    None,
                    lambda: _log_simple_assist(
                        mode="edit",
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        response=raw,
                        instruction=payload.message,
                        selected_text=payload.selected_text,
                        text_before=payload.text_before,
                        text_after=payload.text_after,
                        ref_files=payload.ref_files,
                        edit_mode=edit_mode,
                        planner_system_prompt=planner_system,
                        planner_user_prompt=planner_user,
                        planner_output=planner_raw,
                    )
                )

                yield {"data": json.dumps({
                    "status": "applied",
                    "output": output_text,
                    "placement": {
                        "anchor_text": "",
                        "paragraph_index": resolved_idx,
                        "replace": replace
                    }
                })}

            else:  # chat
                yield {"data": json.dumps({"status": "generating"})}

                system_prompt = _load_simple_prompt("simple-chat.md")
                client = llm.LLMClient()
                full_system = system_prompt
                if payload.content:
                    full_system += f"\n\nHere is the user's document for context:\n{payload.content}"

                user_message = message
                if payload.selected_text:
                    user_message = f"[{len(payload.selected_text)} Ch]: \"{payload.selected_text[:120]}...\"\n\n{user_message}"

                user_prompt = ""
                for h in payload.history:
                    role = h.get("role", "user")
                    content = h.get("content", "")
                    tag = "User" if role == "user" else "Assistant"
                    user_prompt += f"{tag}: {content}\n\n"
                user_prompt += f"User: {user_message}"

                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: client.generate_to_completion(
                        system_prompt=full_system,
                        user_prompt=user_prompt,
                        temperature=0.7,
                        max_tokens=config.AGENT_CONFIG.get("writer", {}).get("max_tokens", 500),
                    )
                )
                
                await loop.run_in_executor(
                    None,
                    lambda: _log_simple_assist(
                        mode="chat",
                        system_prompt=full_system,
                        user_prompt=user_prompt,
                        response=result,
                        instruction=message,
                        ref_files=payload.ref_files,
                        selected_text=payload.selected_text,
                    )
                )

                yield {"data": json.dumps({
                    "status": "chat",
                    "output": result
                })}
        except Exception as e:
            yield {"data": json.dumps({
                "status": "error",
                "detail": str(e)
            })}

    return EventSourceResponse(event_generator())


class PromptSaveRequest(BaseModel):
    content: str


@router.get("/prompts")
def list_prompts():
    """Retrieve all available markdown prompt files from the prompts directory."""
    prompts_dir = Path(__file__).parent.parent.parent / "prompts" / "simple"
    if not prompts_dir.exists():
        return []

    files = []
    for f in prompts_dir.glob("*.md"):
        files.append({"name": f.name, "path": f.name})
    return sorted(files, key=lambda x: x["name"])


@router.get("/prompts/{filename}")
def get_prompt_content(filename: str):
    """Read the plain text content of a prompt file."""
    filename = Path(filename).name
    prompts_dir = Path(__file__).parent.parent.parent / "prompts" / "simple"
    file_path = prompts_dir / filename

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Prompt file not found")

    return {"content": file_path.read_text(encoding="utf-8")}


@router.post("/prompts/{filename}")
def save_prompt_content(filename: str, payload: PromptSaveRequest):
    """Write the updated content to a prompt file."""
    filename = Path(filename).name
    prompts_dir = Path(__file__).parent.parent.parent / "prompts" / "simple"
    file_path = prompts_dir / filename

    try:
        prompts_dir.mkdir(parents=True, exist_ok=True)
        file_path.write_text(payload.content, encoding="utf-8")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save prompt: {str(e)}")
