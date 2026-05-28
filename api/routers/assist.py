import json
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.document_edit_agent import DocumentEditAgent
from agents.rewrite_agent import RewriteAgent
from api.services.file_storage import storage
from schema_loader import get_schema

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

        parts = scene_id.split("_")
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
