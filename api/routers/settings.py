from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
import requests

from api.services.file_storage import storage
import config

router = APIRouter(prefix="/api/settings", tags=["settings"])

class SettingsUpdateRequest(BaseModel):
    updates: Dict[str, Any]

class TestEndpointRequest(BaseModel):
    url: str
    api_key: Optional[str] = None
    model: Optional[str] = None

class TestImageProviderRequest(BaseModel):
    provider: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None

@router.get("/")
def get_settings():
    return storage.get_settings()


@router.get("/env-default")
def get_env_default():
    """Effective .env values (what the fallback path would actually use) plus
    independent explicit-presence flags. Frontend keys row visibility purely
    off `from_env` without knowing backend defaults. URL + model only —
    no credentials."""
    import os
    return {
        "base_url": config.LMSTUDIO.get("base_url", "http://localhost:1234/v1"),
        "model": config.LMSTUDIO.get("model", ""),
        "from_env": {
            "base_url": "LM_STUDIO_BASE_URL" in os.environ,
            "model": "LM_STUDIO_MODEL" in os.environ,
        },
    }


@router.patch("/")
def update_settings(req: SettingsUpdateRequest):
    try:
        updated = storage.update_settings(req.updates)
        return {"success": True, "settings": updated}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/test-endpoint")
def test_endpoint(req: TestEndpointRequest):
    try:
        if req.url == "default" or req.url == "":
            base_url = config.LMSTUDIO["base_url"].rstrip("/")
        else:
            base_url = req.url.rstrip("/")

        if not base_url.endswith("/v1"):
            base_url += "/v1"
        url = f"{base_url}/models"
        headers = {}
        if req.api_key:
            headers["Authorization"] = f"Bearer {req.api_key}"

        try:
            response = requests.get(url, headers=headers, timeout=5)
            response.raise_for_status()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Endpoint not reachable: {e}")
        try:
            payload = response.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Endpoint reachable but /models did not return JSON")
        listed = payload.get("data") if isinstance(payload, dict) else None
        listed_ids = [m.get("id") for m in (listed or []) if isinstance(m, dict) and m.get("id")]
        model_count = len(listed_ids)

        wanted = (req.model or "").strip() or None
        if not wanted:
            return {"success": True, "reachable": True, "model_count": model_count, "models": payload, "model_found": None, "probe": None}
        found = wanted in listed_ids
        if not found:
            # Skip probe when the model isn't listed — a probe failure here
            # would be misleading (wrong id vs wrong format).
            return {"success": True, "reachable": True, "model_count": model_count, "models": payload, "model_found": False, "probe": None}
        # Minimal cheap probe: 1-token completion to verify the id is accepted.
        # A rejection may still mean format mismatch, not an invalid model —
        # callers must surface probe failure as a warning, not invalid-model.
        try:
            probe_resp = requests.post(
                f"{base_url}/chat/completions",
                headers={"Content-Type": "application/json", **headers},
                json={"model": wanted, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1, "temperature": 0},
                timeout=10,
            )
            if probe_resp.ok:
                return {"success": True, "reachable": True, "model_count": model_count, "models": payload, "model_found": True, "probe": {"ok": True}}
            detail = ""
            try:
                detail = probe_resp.text[:300]
            except Exception:
                pass
            return {"success": True, "reachable": True, "model_count": model_count, "models": payload, "model_found": True, "probe": {"ok": False, "status": probe_resp.status_code, "detail": detail}}
        except Exception as e:
            return {"success": True, "reachable": True, "model_count": model_count, "models": payload, "model_found": True, "probe": {"ok": False, "detail": str(e)[:300]}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/test-image-provider")
def test_image_provider(req: TestImageProviderRequest):
    """Validate image provider connectivity/config without a full generation."""
    from api.services.file_storage import storage as _storage

    try:
        saved = _storage.get_settings()
        entries = saved.get("image_endpoints")
        active_entry = entries.get(saved.get("active_image_endpoint")) if isinstance(entries, dict) else None
        if not isinstance(active_entry, dict):
            active_entry = {}
        provider = (req.provider or active_entry.get("provider") or "openai-compatible").strip().lower()
        base_url = (req.base_url if req.base_url is not None else active_entry.get("base_url") or "").strip()
        api_key = req.api_key if req.api_key is not None else (active_entry.get("api_key") or "")
        model = (req.model if req.model is not None else active_entry.get("model") or "").strip()

        if provider in ("openai-compatible", "openai", "lmstudio", "local"):
            if not base_url:
                raise HTTPException(status_code=400, detail="Image base URL is not configured")
            url = base_url.rstrip("/") + "/v1/models"
            headers = {}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            try:
                resp = requests.get(url, headers=headers, timeout=10)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not reach image provider: {e}")
            if resp.status_code in (401, 403):
                raise HTTPException(status_code=400, detail="Image provider rejected the API key (401/403)")
            if not resp.ok:
                raise HTTPException(status_code=400, detail=f"Image provider test failed ({resp.status_code}): {resp.text[:300]}")
            try:
                n = len(resp.json().get("data", []))
            except Exception:
                n = 0
            return {"success": True, "provider": provider, "models": n}
        if provider == "stability":
            if not api_key:
                raise HTTPException(status_code=400, detail="Stability API key is not configured")
            try:
                resp = requests.get("https://api.stability.ai/v2beta/user/account",
                                    headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not reach Stability: {e}")
            if resp.status_code in (401, 403):
                raise HTTPException(status_code=400, detail="Stability rejected the API key (401/403)")
            if not resp.ok:
                raise HTTPException(status_code=400, detail=f"Stability test failed ({resp.status_code}): {resp.text[:300]}")
            return {"success": True, "provider": provider}
        if provider == "fal":
            if not api_key:
                raise HTTPException(status_code=400, detail="FAL API key is not configured")
            if not model:
                raise HTTPException(status_code=400, detail="FAL model is not configured")
            return {"success": True, "provider": provider, "note": "Key + model present; generation tested on use."}
        if provider == "gemini":
            from api.services.image_providers import GeminiProvider

            try:
                GeminiProvider(api_key=api_key, model=model, base_url=base_url).check_model()
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            return {"success": True, "provider": provider, "model": model}
        if provider == "comfyui":
            from api.services.image_providers import (
                validate_comfy_edit_image_map,
                validate_comfy_prompt_map,
                validate_comfy_seed_map,
            )

            def slot_status(workflow: Any, prompt_map: Any,
                            image_map: Any = "skip",
                            seed_map: Any = None) -> str:
                if not isinstance(workflow, dict) or not workflow:
                    return "missing"
                try:
                    validate_comfy_prompt_map(workflow, prompt_map)
                    if image_map != "skip":
                        validate_comfy_edit_image_map(workflow, image_map)
                    validate_comfy_seed_map(workflow, seed_map)
                except ValueError as e:
                    return f"stale: {e}"
                return "ok"

            text_status = slot_status(saved.get("image_comfy_text_workflow"),
                                      saved.get("image_comfy_text_prompt_map"),
                                      seed_map=saved.get("image_comfy_text_seed_map"))
            edit_status = slot_status(saved.get("image_comfy_edit_workflow"),
                                      saved.get("image_comfy_edit_prompt_map"),
                                      saved.get("image_comfy_edit_image_map"),
                                      saved.get("image_comfy_edit_seed_map"))
            if text_status == "missing" and edit_status == "missing":
                raise HTTPException(status_code=400, detail=(
                    "No ComfyUI workflow is configured — import a text-to-image "
                    "and/or edit workflow in Settings → Images"))
            if not base_url:
                raise HTTPException(status_code=400, detail="ComfyUI base URL is not configured")
            try:
                resp = requests.get(base_url.rstrip("/") + "/system_stats", timeout=10)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not reach ComfyUI: {e}")
            if not resp.ok:
                raise HTTPException(status_code=400, detail=f"ComfyUI test failed ({resp.status_code}): {resp.text[:300]}")
            return {"success": True, "provider": provider,
                    "text": text_status, "edit": edit_status}
        raise HTTPException(status_code=400, detail=f"Unknown image provider: {provider!r}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

