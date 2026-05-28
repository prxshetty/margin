import re
from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel

from api.services.file_storage import storage
from api.models.domain import Style

router = APIRouter(
    prefix="/styles",
    tags=["styles"]
)

class StyleCreate(BaseModel):
    name: str
    description: str
    output_size: str
    agent_sections: dict

class StyleUpdate(BaseModel):
    name: str
    description: str
    output_size: str
    agent_sections: dict

class ContentUpdate(BaseModel):
    content: str

@router.get("/")
def get_styles():
    return storage.get_styles()

@router.get("/{id}/content")
def get_style_content(id: str):
    style = storage.get_style(id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")
    content = storage.get_style_content(id)
    return {
        "id": id,
        "name": style.name,
        "description": style.description,
        "output_size": style.output_size,
        "content": content or ""
    }

@router.patch("/{id}/content")
def update_style_content(id: str, payload: ContentUpdate):
    style = storage.get_style(id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")
    if style.is_system:
        raise HTTPException(status_code=403, detail="Cannot edit system styles")
    storage.save_style_content(id, payload.content)
    return {"status": "success"}

@router.post("/")
def create_style(style_in: StyleCreate):
    import re
    slug = re.sub(r"[^a-z0-9_]", "_", style_in.name.lower())
    slug = re.sub(r"_+", "_", slug).strip("_")

    existing = storage.get_style(slug)
    if existing:
        raise HTTPException(status_code=400, detail="Style already exists")

    style = Style(
        id=slug,
        name=style_in.name,
        description=style_in.description,
        output_size=style_in.output_size,
        agent_sections=style_in.agent_sections,
        is_system=False
    )
    return storage.save_style(style)

@router.put("/{id}")
def update_style(id: str, style_in: StyleUpdate):
    style = storage.get_style(id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")

    if style.is_system:
        raise HTTPException(status_code=403, detail="Cannot edit system styles")

    # Rename if name changed
    new_id = re.sub(r"[^a-z0-9_]", "_", style_in.name.lower())
    new_id = re.sub(r"_+", "_", new_id).strip("_")
    if new_id and new_id != id:
        style = storage.rename_style(id, new_id)
        if not style:
            raise HTTPException(status_code=500, detail="Failed to rename style")

    style.description = style_in.description
    style.output_size = style_in.output_size
    style.agent_sections = style_in.agent_sections

    return storage.save_style(style)

@router.delete("/{id}")
def delete_style(id: str):
    style = storage.get_style(id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")

    if style.is_system:
        raise HTTPException(status_code=403, detail="Cannot delete system styles")

    storage.delete_style(id)
    return {"status": "success"}
