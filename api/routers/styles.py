import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List
from pydantic import BaseModel

from api.database import get_session
from api.models.db import Style

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
    description: str
    output_size: str
    agent_sections: dict

@router.get("/")
def get_styles(session: Session = Depends(get_session)):
    return session.exec(select(Style)).all()

@router.post("/")
def create_style(style_in: StyleCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Style).where(Style.name == style_in.name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Style already exists")
        
    style = Style(
        id=str(uuid.uuid4()),
        name=style_in.name,
        description=style_in.description,
        output_size=style_in.output_size,
        agent_sections=style_in.agent_sections,
        is_system=False
    )
    session.add(style)
    session.commit()
    session.refresh(style)
    return style

@router.put("/{id}")
def update_style(id: str, style_in: StyleUpdate, session: Session = Depends(get_session)):
    style = session.get(Style, id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")
        
    if style.is_system:
        raise HTTPException(status_code=403, detail="Cannot edit system styles")
        
    style.description = style_in.description
    style.output_size = style_in.output_size
    style.agent_sections = style_in.agent_sections
    
    session.add(style)
    session.commit()
    session.refresh(style)
    return style

@router.delete("/{id}")
def delete_style(id: str, session: Session = Depends(get_session)):
    style = session.get(Style, id)
    if not style:
        raise HTTPException(status_code=404, detail="Style not found")
        
    if style.is_system:
        raise HTTPException(status_code=403, detail="Cannot delete system styles")
        
    session.delete(style)
    session.commit()
    return {"status": "success"}
