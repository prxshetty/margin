from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from pydantic import BaseModel
import urllib.parse
from api.services.file_storage import storage

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

class CreateFileRequest(BaseModel):
    folder: str
    name: str
    content: str = ""

class RenameFileRequest(BaseModel):
    name: str

@router.get("/inputs/files")
def get_input_files():
    try:
        return storage.list_input_files()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/inputs/files/{path:path}")
def read_input_file(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        content = storage.read_input_file(decoded_path)
        return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/inputs/files")
def create_input_file(req: CreateFileRequest):
    try:
        return storage.create_input_file(req.folder, req.name, req.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/inputs/files/{path:path}")
def delete_input_file(path: str):
    try:
        decoded_path = urllib.parse.unquote(path)
        storage.delete_input_file(decoded_path)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("/inputs/files/{path:path}")
def rename_input_file(path: str, req: RenameFileRequest):
    try:
        decoded_path = urllib.parse.unquote(path)
        return storage.rename_input_file(decoded_path, req.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
