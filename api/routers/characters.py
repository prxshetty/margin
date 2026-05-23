import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List
from pydantic import BaseModel

from api.database import get_session
from api.models.db import Character

router = APIRouter(
    prefix="/characters",
    tags=["characters"]
)

class CharacterCreate(BaseModel):
    name: str
    slug: str
    data: dict

class CharacterUpdate(BaseModel):
    name: str
    data: dict

@router.get("/")
def get_characters(session: Session = Depends(get_session)):
    return session.exec(select(Character)).all()

@router.get("/{slug}")
def get_character(slug: str, session: Session = Depends(get_session)):
    char = session.exec(select(Character).where(Character.slug == slug)).first()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return char

@router.post("/")
def create_character(char_in: CharacterCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Character).where(Character.slug == char_in.slug)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Character slug already exists")
        
    char = Character(
        id=str(uuid.uuid4()),
        name=char_in.name,
        slug=char_in.slug,
        data=char_in.data
    )
    session.add(char)
    session.commit()
    session.refresh(char)
    return char

@router.put("/{slug}")
def update_character(slug: str, char_in: CharacterUpdate, session: Session = Depends(get_session)):
    char = session.exec(select(Character).where(Character.slug == slug)).first()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
        
    char.name = char_in.name
    char.data = char_in.data
    session.add(char)
    session.commit()
    session.refresh(char)
    return char
