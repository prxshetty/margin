from fastapi import APIRouter, HTTPException
from typing import List, Dict

from api.services.file_storage import storage

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


@router.get("/inputs/files")
def list_input_files() -> List[Dict[str, str]]:
    try:
        return storage.list_input_files()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inputs/files/{path:path}")
def get_input_file_content(path: str):
    try:
        content = storage.read_input_file(path)
        return {"content": content, "path": path}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
