from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict

from api.services.file_storage import storage

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


class CreateFileRequest(BaseModel):
    folder: str
    name: str
    content: str = ""


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


@router.post("/inputs/files")
def create_input_file(req: CreateFileRequest):
    try:
        return storage.create_input_file(req.folder, req.name, req.content)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/inputs/files/{path:path}")
def delete_input_file(path: str):
    try:
        storage.delete_input_file(path)
        return {"status": "deleted", "path": path}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
