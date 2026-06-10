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

@router.get("/")
def get_settings():
    return storage.get_settings()


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
        
        response = requests.get(url, headers=headers, timeout=5)
        response.raise_for_status()
        return {"success": True, "models": response.json()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

