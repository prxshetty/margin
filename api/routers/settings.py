from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any

from api.services.file_storage import storage

router = APIRouter(
    prefix="/settings",
    tags=["settings"]
)

class LinkRequest(BaseModel):
    inputs_path: str

@router.get("/status", response_model=Dict[str, Any])
def get_status():
    return storage.get_directory_status()

@router.post("/link", response_model=Dict[str, Any])
def link_directory(payload: LinkRequest):
    try:
        status = storage.link_directories(payload.inputs_path)
        return status
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

@router.post("/unlink", response_model=Dict[str, Any])
def unlink_directory():
    try:
        status = storage.unlink_directories()
        return status
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")
