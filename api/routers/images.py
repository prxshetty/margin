from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from api.services.file_storage import storage
from api.services.image_providers import (
    compose_final_prompt,
    extract_comfy_image_candidates,
    extract_comfy_seed_candidates,
    extract_comfy_text_candidates,
    get_image_provider,
    list_styles,
    resolve_style_prompt,
    validate_comfy_workflow,
)

router = APIRouter(prefix="/api/images", tags=["images"])


class GenerateImageRequest(BaseModel):
    prompt: str = ""
    style_name: Optional[str] = None
    reference_path: Optional[str] = None


class ComfyAnalyzeRequest(BaseModel):
    workflow: Dict[str, Any]


@router.get("/styles")
def get_image_styles():
    return {"styles": list_styles(storage.get_settings())}


@router.get("/logs")
def get_image_logs():
    return {"logs": storage.get_image_logs()}


@router.delete("/logs/{log_id}")
def delete_image_log(log_id: str):
    if not storage.delete_image_log(log_id):
        raise HTTPException(status_code=404, detail="Image log entry not found")
    return {"success": True}


@router.post("/reveal")
def reveal_generated_folder():
    """Open the workspace assets/generated/ folder in the OS file manager.
    Fixed directory only — no user input, nothing to traverse."""
    import subprocess
    import sys

    target = storage.generated_dir()
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        elif sys.platform == "win32":
            subprocess.Popen(["explorer", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"Could not open folder: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not open folder: {e}")
    return {"success": True, "path": f"assets/generated"}


@router.post("/comfy/analyze")
def analyze_comfy_workflow(req: ComfyAnalyzeRequest):
    """Validate an imported ComfyUI API-format workflow and rank its text
    and image inputs as prompt/reference-mapping candidates. No generation,
    no persistence — the frontend saves workflow + mappings via settings
    when the user picks."""
    try:
        workflow = validate_comfy_workflow(req.workflow)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "node_count": len(workflow),
        "candidates": extract_comfy_text_candidates(workflow),
        "image_candidates": extract_comfy_image_candidates(workflow),
        "seed_candidates": extract_comfy_seed_candidates(workflow),
    }


@router.post("/generate")
def generate_image(req: GenerateImageRequest):
    prompt = (req.prompt or "").strip()
    ref_path = (req.reference_path or "").strip() or None

    # Every entry point requires typed content — empty prompts are always
    # a client error, never silently expanded server-side.
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    settings = storage.get_settings()

    try:
        style_prompt = resolve_style_prompt(req.style_name, settings)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    reference_bytes: Optional[bytes] = None
    if ref_path:
        try:
            full, _mime = storage.read_media(ref_path)
            reference_bytes = full.read_bytes()
        except FileNotFoundError:
            raise HTTPException(status_code=400, detail=f"Reference image not found: {ref_path}")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read reference image: {e}")

    final_prompt = compose_final_prompt(prompt, style_prompt)

    try:
        provider = get_image_provider(settings)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result = provider.generate(final_prompt, reference_bytes)
    except ValueError as e:
        msg = str(e)
        # Config/auth errors are client errors; upstream failures are 502.
        if any(s in msg for s in ("not configured", "Unknown image provider",
                                  "Unknown image style", "Prompt is required",
                                  "rejected the API key", "not found — is this",
                                  "not supported by the", "no longer matches",
                                  "API format", "not API format",
                                  "is not a text field",
                                  "is not an image field",
                                  "is not a seed field",
                                  "seed mapping is invalid",
                                  "needs a reference image input",
                                  "needs an edit workflow",
                                  "needs a text-to-image workflow",
                                  "Settings → Images",
                                  "ComfyUI workflow error",
                                  "ComfyUI rejected the workflow")):
            raise HTTPException(status_code=400, detail=msg)
        raise HTTPException(status_code=502, detail=msg)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Image provider failed: {e}")

    try:
        saved = storage.save_generated_bytes(result.data, result.mime_type)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"Provider returned an invalid image: {e}")

    # Persist the run (prompt, seed, asset) for the history view. Logging
    # must never fail the generation itself.
    try:
        storage.save_image_log({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "prompt": prompt,
            "final_prompt": final_prompt,
            "style": req.style_name,
            "provider": str(settings.get("active_image_endpoint") or "openai-compatible"),
            "reference_path": ref_path,
            "seed": result.seed,
            "path": saved["path"],
        })
    except Exception:
        pass

    # Backend never touches Markdown — it returns the asset path and the
    # editor inserts/swaps the reference. Seed is informational only
    # (ComfyUI mapped runs; cloud providers report None).
    return {"path": saved["path"], "seed": result.seed}
