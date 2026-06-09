import json
import re
import uuid
import asyncio
import difflib
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from api.services.file_storage import storage
import llm
import config

router = APIRouter(prefix="/api/assist", tags=["assist"])


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


def _build_simple_system_prompt(base_text: str = "", include_tone: bool = False) -> str:
    """Prepend additional_context to a system prompt if it's non-empty, and optionally inject style guidelines."""
    s = storage.get_settings()
    ctx = (s.get("additional_context") or "").strip()
    system_prompt = base_text
    if ctx:
        system_prompt = f"\n\n--- USER CONTEXT ---\n{ctx}\n--- END USER CONTEXT ---\n\n{system_prompt}"
        
    if include_tone:
        tone = s.get("tone_preset")
        if tone and tone.lower() not in ("none", "auto") and tone.strip() != "":
            import style_loader
            try:
                style_data = style_loader.load_style(tone)
                if style_data:
                    agent_sections = style_data.get("agent_sections") or {}
                    writer_guidelines = agent_sections.get("writer")
                    if writer_guidelines:
                        system_prompt = f"{system_prompt}\n\n--- STYLE GUIDELINES ({tone.upper()}) ---\n{writer_guidelines}"
            except Exception as e:
                print(f"Error loading style guidelines for {tone}: {e}")
                
    return system_prompt


def _inject_pinned_ref_files(system_parts: list, already_seen: set) -> list:
    """Append pinned ref file contents to the system prompt parts list."""
    s = storage.get_settings()
    pinned = s.get("pinned_ref_files") or []
    if not pinned:
        return system_parts
    available = {f["path"]: f["name"] for f in storage.list_input_files()}
    ignored = set(s.get("ignored_ref_files") or [])
    for pp in pinned:
        if pp in already_seen:
            continue
        if pp in ignored:
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
    path = Path(__file__).parent.parent.parent / "prompts" / filename
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as e:
        print(f"Error loading prompt {filename} from {path}: {e}")
        return ""


class SimpleAssistRequest(BaseModel):
    content: str = ""
    message: str
    mode: str = "chat"
    session_id: Optional[str] = None
    history: List[Dict[str, Any]] = Field(default_factory=list)
    selected_text: Optional[str] = None
    cursor_paragraph_text: Optional[str] = None
    ref_files: Optional[List[Dict[str, Any]]] = None
    available_files: List[Dict[str, str]] = Field(default_factory=list)



@router.get("/simple/logs")
def get_simple_logs():
    return storage.get_simple_ai_logs()


@router.delete("/simple/session/{session_id}")
def delete_session_logs(session_id: str):
    storage.delete_simple_ai_logs_by_session(session_id)
    return {"status": "ok"}


def _log_simple_assist(
    mode: str,
    system_prompt: str,
    user_prompt: str,
    response: str,
    instruction: str,
    session_id: Optional[str] = None,
    selected_text: Optional[str] = None,
    text_before: Optional[str] = None,
    text_after: Optional[str] = None,
    ref_files: Optional[List[Dict[str, Any]]] = None,
    edit_mode: Optional[str] = None,
    planner_system_prompt: Optional[str] = None,
    planner_user_prompt: Optional[str] = None,
    planner_output: Optional[str] = None,
    success: bool = True,
    cursor_paragraph_index: Optional[int] = None,
) -> None:
    log_entry = {
        "id": f"simple_{uuid.uuid4().hex}",
        "timestamp": datetime.utcnow().isoformat(),
        "mode": mode,
        "session_id": session_id,
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "output": response,
        "instruction": instruction,
        "selected_text": selected_text,
        "text_before": text_before,
        "text_after": text_after,
        "ref_files": ref_files,
        "success": success,
    }
    if edit_mode is not None:
        log_entry["edit_mode"] = edit_mode
    if planner_system_prompt is not None:
        log_entry["planner_system_prompt"] = planner_system_prompt
    if planner_user_prompt is not None:
        log_entry["planner_user_prompt"] = planner_user_prompt
    if planner_output is not None:
        log_entry["planner_output"] = planner_output
    if cursor_paragraph_index is not None:
        log_entry["cursor_paragraph_index"] = cursor_paragraph_index
    storage.save_simple_ai_log(log_entry)


def extract_anchor_context(
    content: str,
    selected_text: str | None,
    cursor_paragraph_text: str | None = None,
) -> tuple[str, str, str, int, bool]:
    """
    Returns paragraph_before, target_paragraph, paragraph_after, target_idx, replace.
    replace=True  → caller should overwrite the target paragraph.
    replace=False → caller should insert new content after the target paragraph.
    """
    paragraphs = [p for p in content.split('\n\n') if p.strip()]
    target_idx = len(paragraphs) - 1 # default to end
    replace = False

    if selected_text:
        replace = True
        for i, p in enumerate(paragraphs):
            if selected_text[:50] in p:
                target_idx = i
                break
    elif cursor_paragraph_text:
        cursor_text = cursor_paragraph_text.strip()
        for i, p in enumerate(paragraphs):
            if cursor_text[:60] in p:
                target_idx = i
                break

    target_paragraph = paragraphs[target_idx] if paragraphs else ""
    paragraph_before = paragraphs[target_idx - 1] if target_idx > 0 else ""
    paragraph_after = paragraphs[target_idx + 1] if target_idx < len(paragraphs) - 1 else ""

    return paragraph_before, target_paragraph, paragraph_after, target_idx, replace


def run_planner(
    content: str,
    message: str,
    selected_text: Optional[str] = None,
    cursor_paragraph_text: Optional[str] = None,
) -> tuple[dict, str, str, str]:
    system = _load_simple_prompt("simple-planner.md")
    
    # Build document outline
    paragraphs = [p for p in content.split('\n\n') if p.strip()]
    outline_lines = []
    for i, p in enumerate(paragraphs):
        preview = p[:60].replace('\n', ' ')
        outline_lines.append(f"[{i}] {preview}...")
    outline_text = "\n".join(outline_lines)
    
    user_prompt_lines = [f"USER_INSTRUCTION:\n{message}\n"]
    user_prompt_lines.append(f"DOCUMENT_OUTLINE:\n{outline_text}\n")
    
    if selected_text:
        user_prompt_lines.append(f"SELECTED_TEXT:\n{selected_text}\n")
    elif cursor_paragraph_text:
        user_prompt_lines.append(f"ANCHOR_PARAGRAPH_TEXT:\n{cursor_paragraph_text}\n")
    
    manifest_sections = []
    for manifest_rel, label in [("characters/CHARACTERS.md", "CHARACTERS"), ("chapters/CHAPTERS.md", "CHAPTERS")]:
        try:
            raw = storage.read_input_file(manifest_rel)
            if raw.strip():
                manifest_sections.append(f"--- {label} ---\n{raw.strip()}")
        except Exception:
            pass
    s = storage.get_settings()
    tone = (s.get("tone_preset") or "").strip().lower()
    if tone == "auto":
        try:
            from style_loader import read_styles_md
            styles_map = read_styles_md(path=storage.inputs_dir / "styles" / "STYLES.md")
            if styles_map:
                styles_lines = [f"- **{k}** — {v}" for k, v in styles_map.items()]
                manifest_sections.append("--- STYLES ---\n" + "\n".join(styles_lines))
        except Exception:
            pass
    if manifest_sections:
        user_prompt_lines.append("AVAILABLE_CONTEXT:\n" + "\n\n".join(manifest_sections))
    
    user = "\n".join(user_prompt_lines)
    system = _build_simple_system_prompt(system)
    
    raw = _resolve_simple_assist_client().generate_to_completion(
        system_prompt=system,
        user_prompt=user,
        temperature=0.1,
        max_tokens=400
    )
    
    try:
        return json.loads(raw), system, user, raw
    except Exception:
        try:
            start, end = raw.find("{"), raw.rfind("}") + 1
            return json.loads(raw[start:end]), system, user, raw
        except Exception:
            return {"context_needed": [], "query": message}, system, user, raw



def build_generator_prompts(
    paragraph_before: str,
    target_paragraph: str,
    paragraph_after: str,
    query: str,
    context_needed: List[str],
    available_files: List[Dict[str, str]] = None,
) -> tuple[str, str]:
    
    system_parts = [_build_simple_system_prompt(_load_simple_prompt("simple-writer.md"), include_tone=True)]
    
    available = available_files if available_files is not None else []
    available_paths = [f['path'] for f in available]
    
    s = storage.get_settings()
    ignored_paths = set(s.get("ignored_ref_files") or [])
    
    for filepath in context_needed:
        if filepath in ignored_paths:
            continue
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
        
        if actual_path in ignored_paths:
            continue
            
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
    already_seen = set(context_needed)
    system_parts = _inject_pinned_ref_files(system_parts, already_seen)
    
    user_parts = [
        f"PARAGRAPH_BEFORE:\n{paragraph_before}",
    ]
    if target_paragraph:
        user_parts.append(f"TARGET:\n{target_paragraph}")
        
    user_parts.append(f"PARAGRAPH_AFTER:\n{paragraph_after}")
    user_parts.append(f"INSTRUCTION:\n{query}")
    
    return "\n\n".join(system_parts), "\n\n".join(user_parts)



@router.post("/simple")
async def simple_assist(payload: SimpleAssistRequest):
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Missing message")

    mode = payload.mode.strip().lower()

    async def event_generator():
        planner_system = None
        planner_user = None
        planner_raw = None
        system_prompt = ""
        user_prompt = ""
        edit_mode = "replace" if payload.selected_text else "insert"

        try:
            if mode == "edit":
                yield {"data": json.dumps({"status": "planning"})}

                loop = asyncio.get_running_loop()
                plan, planner_system, planner_user, planner_raw = await loop.run_in_executor(
                    None,
                    lambda: run_planner(
                        payload.content,
                        payload.message,
                        payload.selected_text,
                        payload.cursor_paragraph_text,
                    )
                )

                context_needed = plan.get("context_needed", [])
                query = plan.get("query", payload.message)
                if not isinstance(query, str) or not query.strip():
                    query = payload.message

                yield {"data": json.dumps({
                    "status": "context_resolved",
                    "context_needed": context_needed
                })}

                yield {"data": json.dumps({"status": "generating"})}

                paragraph_before, target_paragraph, paragraph_after, resolved_idx, replace = extract_anchor_context(
                    payload.content, payload.selected_text, payload.cursor_paragraph_text
                )

                system_prompt, user_prompt = build_generator_prompts(
                    paragraph_before, target_paragraph, paragraph_after, query, context_needed, payload.available_files
                )

                max_toks = _pick_writer_max_tokens() or config.AGENT_CONFIG.get("writer", {}).get("max_tokens", 500)
                raw = await loop.run_in_executor(
                    None,
                    lambda: _resolve_simple_assist_client().generate_to_completion(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        temperature=0.7,
                        max_tokens=max_toks
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

                writer_output = clean_raw

                if replace and payload.selected_text:
                    # If the writer output is already the full modified paragraph,
                    # we should not splice it again to avoid duplication.
                    ratio = difflib.SequenceMatcher(None, target_paragraph, writer_output).ratio()
                    if ratio > 0.5:
                        output_text = writer_output
                    else:
                        # Replace only within the confirmed target paragraph
                        if payload.selected_text in target_paragraph:
                            output_text = target_paragraph.replace(payload.selected_text, writer_output, 1)
                        else:
                            # Selection not found in target — fall back to full paragraph replacement
                            output_text = writer_output
                else:
                    output_text = writer_output

                await loop.run_in_executor(
                    None,
                    lambda: _log_simple_assist(
                        mode="edit",
                        session_id=payload.session_id,
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        response=raw,
                        instruction=payload.message,
                        selected_text=payload.selected_text,
                        text_before=paragraph_before,
                        text_after=paragraph_after,
                        ref_files=payload.ref_files,
                        edit_mode="replace" if replace else "insert",
                        planner_system_prompt=planner_system,
                        planner_user_prompt=planner_user,
                        planner_output=planner_raw,
                        success=True,
                        cursor_paragraph_index=resolved_idx,
                    )
                )

                yield {"data": json.dumps({
                    "status": "applied",
                    "output": output_text,
                    "cursor_paragraph_index": resolved_idx
                })}

            else:  # chat
                yield {"data": json.dumps({"status": "generating"})}

                system_prompt = _load_simple_prompt("simple-chat.md")
                client = _resolve_simple_assist_client()
                full_system = _build_simple_system_prompt(system_prompt)
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

                system_prompt = full_system

                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(
                    None,
                    lambda: client.generate_to_completion(
                        system_prompt=full_system,
                        user_prompt=user_prompt,
                        temperature=0.7,
                        max_tokens=_pick_writer_max_tokens() or config.AGENT_CONFIG.get("writer", {}).get("max_tokens", 500),
                    )
                )
                
                await loop.run_in_executor(
                    None,
                    lambda: _log_simple_assist(
                        mode="chat",
                        session_id=payload.session_id,
                        system_prompt=full_system,
                        user_prompt=user_prompt,
                        response=result,
                        instruction=message,
                        ref_files=payload.ref_files,
                        selected_text=payload.selected_text,
                        success=True,
                    )
                )

                yield {"data": json.dumps({
                    "status": "chat",
                    "output": result
                })}
        except Exception as e:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: _log_simple_assist(
                        mode=mode,
                        session_id=payload.session_id,
                        system_prompt=system_prompt or "",
                        user_prompt=user_prompt or payload.message,
                        response=f"Error: {str(e)}",
                        instruction=payload.message,
                        selected_text=payload.selected_text,
                        text_before=locals().get('paragraph_before', None),
                        text_after=locals().get('paragraph_after', None),
                        ref_files=payload.ref_files,
                        edit_mode=edit_mode if mode == "edit" else None,
                        planner_system_prompt=planner_system,
                        planner_user_prompt=planner_user,
                        planner_output=planner_raw,
                        success=False,
                    )
                )
            except Exception as log_ex:
                print(f"Failed to log error simple assist: {log_ex}")

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
    prompts_dir = Path(__file__).parent.parent.parent / "prompts"
    if not prompts_dir.exists():
        return []

    files = []
    for f in prompts_dir.glob("*.md"):
        files.append({"name": f.name, "path": f.name})
    return sorted(files, key=lambda x: x["name"])


@router.get("/prompts/{filename}")
def get_prompt_content(filename: str):
    """Retrieve the content of a specific markdown prompt file."""
    prompts_dir = Path(__file__).parent.parent.parent / "prompts"
    file_path = prompts_dir / filename

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Prompt file not found")

    return {"content": file_path.read_text(encoding="utf-8")}


@router.post("/prompts/{filename}")
def save_prompt_content(filename: str, payload: PromptSaveRequest):
    """Save the content of a specific markdown prompt file. Creates file and directories if they don't exist."""
    prompts_dir = Path(__file__).parent.parent.parent / "prompts"
    file_path = prompts_dir / filename

    try:
        prompts_dir.mkdir(parents=True, exist_ok=True)
        file_path.write_text(payload.content, encoding="utf-8")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save prompt: {str(e)}")
