import re
from fastapi import APIRouter, HTTPException
from typing import List
from pydantic import BaseModel

from api.services.file_storage import storage
from api.models.domain import Character

router = APIRouter(
    prefix="/characters",
    tags=["characters"]
)

class CharacterCreate(BaseModel):
    name: str
    slug: str

class CharacterUpdate(BaseModel):
    name: str

@router.get("/")
def get_characters():
    return storage.get_characters()

@router.get("/{slug}")
def get_character(slug: str):
    char = storage.get_character(slug)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return char

@router.get("/{slug}/content")
def get_character_content(slug: str):
    char = storage.get_character(slug)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    content = storage.get_character_content(slug)
    return {"slug": slug, "name": char.name, "content": content or ""}

class ContentUpdate(BaseModel):
    content: str

@router.patch("/{slug}/content")
def update_character_content(slug: str, payload: ContentUpdate):
    char = storage.get_character(slug)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    storage.save_character_content(slug, payload.content)
    return {"status": "success"}

@router.post("/")
def create_character(char_in: CharacterCreate):
    existing = storage.get_character(char_in.slug)
    if existing:
        raise HTTPException(status_code=400, detail="Character slug already exists")

    char = Character(
        id=char_in.slug,
        name=char_in.name,
        slug=char_in.slug,
        data={}
    )
    return storage.save_character(char)

@router.put("/{slug}")
def update_character(slug: str, char_in: CharacterUpdate):
    char = storage.get_character(slug)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # Derive new slug from name
    new_slug = re.sub(r"[^a-z0-9_]", "_", char_in.name.lower())
    new_slug = re.sub(r"_+", "_", new_slug).strip("_")
    if new_slug and new_slug != slug:
        char = storage.rename_character(slug, new_slug)
        if not char:
            raise HTTPException(status_code=500, detail="Failed to rename character")

    return storage.save_character(char)
