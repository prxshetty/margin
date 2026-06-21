import json
import re
import uuid
import asyncio
import difflib
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from api.services.file_storage import storage
import llm
import config
from api.services import context_injector

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
            is_thinking = ep.get("is_thinking", True)
            custom_tags = ep.get("custom_thinking_tags") or []
            custom_open = [t["open"] for t in custom_tags if isinstance(t, dict) and "open" in t]
            custom_close = [t["close"] for t in custom_tags if isinstance(t, dict) and "close" in t]
            return llm.LLMClient(
                model=ep.get("model") or None,
                base_url=ep.get("url") or None,
                api_key=ep.get("api_key") or None,
                is_thinking=is_thinking,
                custom_opening_tags=custom_open,
                custom_closing_tags=custom_close,
            )
    is_thinking = s.get("is_thinking", True)
    return llm.LLMClient(is_thinking=is_thinking)


def _build_simple_system_prompt(base_text: str = "") -> str:
    """Prepend additional_context to a system prompt if it's non-empty."""
    s = storage.get_settings()
    ctx = (s.get("additional_context") or "").strip()
    system_prompt = base_text
    if ctx:
        system_prompt = f"\n\n--- USER CONTEXT ---\n{ctx}\n--- END USER CONTEXT ---\n\n{system_prompt}"
                
    return system_prompt


def _is_blocked(filepath: str, ignored: set) -> bool:
    """Check if a file is blocked — either directly or via its folder's manifest."""
    folder = filepath.split('/')[0]
    manifest_path = f"{folder}/{folder.upper()}.md"
    if manifest_path in ignored:
        return True
    if filepath in ignored:
        return True
    return False


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
        if _is_blocked(pp, ignored):
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
    mapping = {"concise": 250, "balanced": 500, "expansive": 1000, "none": None}
    val = mapping.get(s.get("default_verbosity", "balanced"), 500)
    return val


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
    active_filename: Optional[str] = None



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
    model_used: Optional[str] = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    thinking_output: Optional[str] = None,
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
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }
    if thinking_output is not None:
        log_entry["thinking_output"] = thinking_output
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
    if model_used is not None:
        log_entry["model_used"] = model_used
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


def _get_active_context_window(settings: dict) -> int:
    active_ep = settings.get("active_endpoint")
    if active_ep:
        endpoints = settings.get("endpoints") or {}
        ep = endpoints.get(active_ep)
        if ep and ep.get("context_window"):
            try:
                return int(ep.get("context_window"))
            except ValueError:
                pass
    return int(settings.get("default_context_window") or 8192)


def _build_chat_messages(
    session_id: Optional[str],
    system_prompt: str,
    current_user_msg: str,
    settings: dict,
) -> list[dict]:
    if not session_id:
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": current_user_msg}
        ]

    logs = storage.get_simple_ai_logs()
    filtered_logs = [
        log for log in logs
        if log.get("session_id") == session_id
        and log.get("mode") in ("chat", "edit_write")
        and log.get("success", True)
    ]
    filtered_logs.sort(key=lambda x: x.get("timestamp", ""))

    history_turns = int(settings.get("history_turns", 5))
    threshold_pct = 85
    context_window = _get_active_context_window(settings)
    threshold_tokens = (threshold_pct / 100.0) * context_window

    history_pairs = filtered_logs[-history_turns:] if history_turns > 0 else []

    while True:
        messages = [{"role": "system", "content": system_prompt}]
        for log in history_pairs:
            messages.append({"role": "user", "content": log.get("instruction", "")})
            messages.append({"role": "assistant", "content": log.get("output", "")})
        messages.append({"role": "user", "content": current_user_msg})

        if not history_pairs:
            break

        # Estimate total tokens: sum(len(content) / 4.0)
        total_tokens = sum(len(msg["content"]) / 4.0 for msg in messages)
        if total_tokens <= threshold_tokens:
            break

        history_pairs.pop(0)

    return messages


def _build_planner_history(session_id: Optional[str], settings: dict) -> str:
    if not session_id:
        return ""
    
    logs = storage.get_simple_ai_logs()
    filtered_logs = [
        log for log in logs
        if log.get("session_id") == session_id
        and log.get("mode") == "edit_plan"
        and log.get("success", True)
    ]
    filtered_logs.sort(key=lambda x: x.get("timestamp", ""))
    
    history_turns = int(settings.get("history_turns", 5))
    recent_logs = filtered_logs[-history_turns:] if history_turns > 0 else []
    
    if not recent_logs:
        return ""
    
    lines = ["RECENT_EDITS:"]
    for idx, log in enumerate(recent_logs):
        instruction = log.get("instruction", "")
        pl_out = log.get("planner_output")
        refined_query = ""
        context_files = []
        if pl_out:
            try:
                if isinstance(pl_out, str):
                    try:
                        pl_dict = json.loads(pl_out)
                    except Exception:
                        start, end = pl_out.find("{"), pl_out.rfind("}") + 1
                        if start != -1 and end > start:
                            pl_dict = json.loads(pl_out[start:end])
                        else:
                            pl_dict = {}
                else:
                    pl_dict = pl_out
                context_files = pl_dict.get("context_needed", [])
                refined_query = pl_dict.get("refined_query", "")
            except Exception:
                pass
        lines.append(f"[Turn {idx + 1}] USER: \"{instruction}\" → REFINED: \"{refined_query}\" → FILES: {json.dumps(context_files)}")
    
    return "\n".join(lines)



def run_planner(
    content: str,
    message: str,
    selected_text: Optional[str] = None,
    cursor_paragraph_text: Optional[str] = None,
    session_id: Optional[str] = None,
) -> tuple[dict, str, str, str, Optional[dict], str]:
    system = _load_simple_prompt("simple-planner.md")
    
    user_prompt_lines = [f"USER_INSTRUCTION:\n{message}\n"]

    s = storage.get_settings()

    # Build document outline if enabled
    if s.get("planner_include_outline", False):
        paragraphs = [p for p in content.split('\n\n') if p.strip()]
        outline_lines = []
        for i, p in enumerate(paragraphs):
            preview = p[:60].replace('\n', ' ')
            outline_lines.append(f"[{i}] {preview}...")
        outline_text = "\n".join(outline_lines)
        user_prompt_lines.append(f"DOCUMENT_OUTLINE:\n{outline_text}\n")
    
    if selected_text:
        user_prompt_lines.append(f"SELECTED_TEXT:\n{selected_text}\n")
    elif cursor_paragraph_text:
        user_prompt_lines.append(f"ANCHOR_PARAGRAPH_TEXT:\n{cursor_paragraph_text}\n")
    
    # Inject planner history
    history_str = _build_planner_history(session_id, s)
    if history_str:
        user_prompt_lines.append(f"{history_str}\n")
    
    manifest_sections = []
    ignored_manifests = set(s.get("ignored_ref_files") or [])
    try:
        for f in storage.workspace_dir.glob("*/*.md"):
            folder_name = f.parent.name
            if f.name == f"{folder_name.upper()}.md":
                if _is_blocked(f"{folder_name}/{f.name}", ignored_manifests):
                    continue
                raw = f.read_text(encoding="utf-8")
                if raw.strip():
                    manifest_sections.append(f"--- {folder_name.upper()} ---\n{raw.strip()}")
    except Exception as e:
        print(f"Error scanning manifests: {e}")
    if manifest_sections:
        user_prompt_lines.append("AVAILABLE_CONTEXT:\n" + "\n\n".join(manifest_sections))
    
    user = "\n".join(user_prompt_lines)
    system = _build_simple_system_prompt(system)
    
    client = _resolve_simple_assist_client()
    raw = client.generate_to_completion(
        system_prompt=system,
        user_prompt=user,
        temperature=0.1,
        max_tokens=None
    )
    model_used = getattr(client, "last_model_used", client.model)
    
    try:
        return json.loads(raw), system, user, raw, client.last_usage, model_used
    except Exception:
        try:
            start, end = raw.find("{"), raw.rfind("}") + 1
            return json.loads(raw[start:end]), system, user, raw, client.last_usage, model_used
        except Exception:
            return {"context_needed": [], "refined_query": message}, system, user, raw, client.last_usage, model_used




def build_generator_prompts(
    paragraph_before: str,
    target_paragraph: str,
    paragraph_after: str,
    query: str,
    context_needed: List[str],
    available_files: List[Dict[str, str]] = None,
) -> tuple[str, str]:
    
    system_parts = [_build_simple_system_prompt(_load_simple_prompt("simple-writer.md"))]
    
    available = available_files if available_files is not None else []
    available_paths = [f['path'] for f in available]
    
    s = storage.get_settings()
    ignored_paths = set(s.get("ignored_ref_files") or [])
    
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
        
        if _is_blocked(actual_path, ignored_paths):
            continue
            
        context_injector.inject(filepath, actual_path, system_parts, available_paths, s)
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
        stop_event = threading.Event()
        
        if payload.session_id:
            _active_stop_events[payload.session_id] = stop_event

        try:
            if mode == "edit":
                yield {"data": json.dumps({"status": "planning"})}

                loop = asyncio.get_running_loop()
                plan, planner_system, planner_user, planner_raw, planner_usage, planner_model = await loop.run_in_executor(
                    None,
                    lambda: run_planner(
                        payload.content,
                        payload.message,
                        payload.selected_text,
                        payload.cursor_paragraph_text,
                        payload.session_id,
                    )
                )

                await loop.run_in_executor(
                    None,
                    lambda: _log_simple_assist(
                        mode="edit_plan",
                        session_id=payload.session_id,
                        system_prompt=planner_system,
                        user_prompt=planner_user,
                        response=planner_raw,
                        instruction=payload.message,
                        selected_text=payload.selected_text,
                        edit_mode=edit_mode,
                        success=True,
                        model_used=planner_model,
                        planner_output=planner_raw,
                        prompt_tokens=planner_usage.get("prompt_tokens", 0) if planner_usage else 0,
                        completion_tokens=planner_usage.get("completion_tokens", 0) if planner_usage else 0,
                        total_tokens=planner_usage.get("total_tokens", 0) if planner_usage else 0,
                    )
                )
                context_needed = plan.get("context_needed", [])
                query = plan.get("refined_query") or payload.message

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

                max_toks = _pick_writer_max_tokens()
                client = _resolve_simple_assist_client()

                queue = asyncio.Queue()
                loop = asyncio.get_running_loop()

                def run_writer_stream():
                    try:
                        gen = client.generate(
                            system_prompt=system_prompt,
                            user_prompt=user_prompt,
                            stream=True,
                            temperature=0.7,
                            max_tokens=max_toks,
                            stop_event=stop_event
                        )
                        for chunk_type, chunk_text in gen:
                            if stop_event.is_set():
                                break
                            loop.call_soon_threadsafe(queue.put_nowait, (chunk_type, chunk_text))
                        loop.call_soon_threadsafe(queue.put_nowait, ("done", None))
                    except Exception as e:
                        loop.call_soon_threadsafe(queue.put_nowait, ("error", e))

                # Start streaming in executor thread
                loop.run_in_executor(None, run_writer_stream)

                full_raw = ""
                full_thinking = ""
                while True:
                    msg_type, val = await queue.get()
                    if msg_type == "chunk":
                        full_raw += val
                        yield {"data": json.dumps({"status": "chunk", "chunk": val})}
                    elif msg_type == "thinking":
                        full_thinking += val
                        yield {"data": json.dumps({"status": "thinking_chunk", "chunk": val})}
                    elif msg_type == "done":
                        break
                    elif msg_type == "error":
                        raise val

                actual_model = getattr(client, "last_model_used", client.model)
                writer_usage = client.last_usage or {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0
                }

                clean_raw = full_raw.strip()
                if clean_raw.startswith("```"):
                    lines = clean_raw.splitlines()
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    clean_raw = "\n".join(lines).strip()

                # Belt-and-suspenders: strip any reasoning tags that leaked into the stream
                writer_output = client._clean_reasoning(clean_raw)

                await loop.run_in_executor(
                    None,
                    lambda: _log_simple_assist(
                        mode="edit_write",
                        session_id=payload.session_id,
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        response=full_raw,
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
                        model_used=actual_model,
                        prompt_tokens=writer_usage.get("prompt_tokens", 0),
                        completion_tokens=writer_usage.get("completion_tokens", 0),
                        total_tokens=writer_usage.get("total_tokens", 0),
                        thinking_output=full_thinking or None,
                    )
                )

                yield {"data": json.dumps({
                    "status": "applied",
                    "output": writer_output,
                    "cursor_paragraph_index": resolved_idx,
                    "model_used": actual_model
                })}

            else:  # chat
                yield {"data": json.dumps({"status": "generating"})}

                system_prompt = _load_simple_prompt("simple-chat.md")
                client = _resolve_simple_assist_client()
                full_system = _build_simple_system_prompt(system_prompt)
                if payload.content:
                    if payload.active_filename:
                        full_system += f"\n\nHere is the file the user is currently viewing: {payload.active_filename}\n{payload.content}"
                    else:
                        full_system += f"\n\nHere is the user's document for context:\n{payload.content}"

                user_message = message
                if payload.selected_text:
                    user_message = f"[{len(payload.selected_text)} Ch]: \"{payload.selected_text[:120]}...\"\n\n{user_message}"

                settings = storage.get_settings()
                messages = _build_chat_messages(payload.session_id, full_system, user_message, settings)

                user_prompt = ""
                for msg in messages:
                    if msg["role"] == "user":
                        user_prompt += f"User: {msg['content']}\n\n"
                    elif msg["role"] == "assistant":
                        user_prompt += f"Assistant: {msg['content']}\n\n"
                user_prompt = user_prompt.strip()

                system_prompt = full_system

                loop = asyncio.get_running_loop()
                queue = asyncio.Queue()

                def run_chat_stream():
                    try:
                        gen = client.generate_stream_with_history(
                            messages=messages,
                            temperature=0.7,
                            max_tokens=_pick_writer_max_tokens(),
                            stop_event=stop_event
                        )
                        for chunk_type, chunk_text in gen:
                            if stop_event.is_set():
                                break
                            loop.call_soon_threadsafe(queue.put_nowait, (chunk_type, chunk_text))
                        loop.call_soon_threadsafe(queue.put_nowait, ("done", None))
                    except Exception as e:
                        loop.call_soon_threadsafe(queue.put_nowait, ("error", e))

                # Start streaming in executor thread
                loop.run_in_executor(None, run_chat_stream)

                full_chat = ""
                full_thinking = ""
                while True:
                    msg_type, val = await queue.get()
                    if msg_type == "chunk":
                        full_chat += val
                        yield {"data": json.dumps({"status": "chunk", "chunk": val})}
                    elif msg_type == "thinking":
                        full_thinking += val
                        yield {"data": json.dumps({"status": "thinking_chunk", "chunk": val})}
                    elif msg_type == "done":
                        break
                    elif msg_type == "error":
                        raise val

                actual_model = getattr(client, "last_model_used", client.model)
                chat_usage = client.last_usage or {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0
                }
                
                await loop.run_in_executor(
                    None,
                    lambda: _log_simple_assist(
                        mode="chat",
                        session_id=payload.session_id,
                        system_prompt=full_system,
                        user_prompt=user_prompt,
                        response=full_chat,
                        instruction=message,
                        ref_files=payload.ref_files,
                        selected_text=payload.selected_text,
                        success=True,
                        model_used=actual_model,
                        prompt_tokens=chat_usage.get("prompt_tokens", 0),
                        completion_tokens=chat_usage.get("completion_tokens", 0),
                        total_tokens=chat_usage.get("total_tokens", 0),
                        thinking_output=full_thinking or None,
                    )
                )

                yield {"data": json.dumps({
                    "status": "chat",
                    "output": full_chat,
                    "model_used": actual_model
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
                        success=False,
                        prompt_tokens=0,
                        completion_tokens=0,
                        total_tokens=0,
                    )
                )
            except Exception as log_ex:
                print(f"Failed to log error simple assist: {log_ex}")

            yield {"data": json.dumps({
                "status": "error",
                "detail": str(e)
            })}
        finally:
            if payload.session_id and payload.session_id in _active_stop_events:
                del _active_stop_events[payload.session_id]

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
