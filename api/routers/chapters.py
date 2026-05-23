import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List

from api.database import get_session
from api.models.db import Chapter, Blueprint, Act, Scene, AgentLog
from api.models.schemas import ChapterCreate, ChapterResponse

router = APIRouter(
    prefix="/chapters",
    tags=["chapters"]
)

@router.get("/", response_model=List[ChapterResponse])
def get_chapters(session: Session = Depends(get_session)):
    chapters = session.exec(select(Chapter)).all()
    return chapters

@router.post("/", response_model=ChapterResponse)
def create_chapter(chapter_in: ChapterCreate, session: Session = Depends(get_session)):
    chapter = Chapter(
        id=str(uuid.uuid4()),
        title=chapter_in.title,
        raw_outline=chapter_in.raw_outline
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)
    return chapter

@router.get("/{chapter_id}", response_model=ChapterResponse)
def get_chapter(chapter_id: str, session: Session = Depends(get_session)):
    chapter = session.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter

@router.delete("/{chapter_id}")
def delete_chapter(chapter_id: str, session: Session = Depends(get_session)):
    chapter = session.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Cascade: blueprints -> acts -> scenes (and scene events & agent logs)
    blueprints = session.exec(select(Blueprint).where(Blueprint.chapter_id == chapter_id)).all()
    for bp in blueprints:
        acts = session.exec(select(Act).where(Act.blueprint_id == bp.id)).all()
        for act in acts:
            scenes = session.exec(select(Scene).where(Scene.act_id == act.id)).all()
            for scene in scenes:
                # First delete all logs pointing to this scene
                logs = session.exec(select(AgentLog).where(AgentLog.scene_id == scene.id)).all()
                for log in logs:
                    session.delete(log)
                session.delete(scene)
            session.delete(act)
        session.delete(bp)

    session.delete(chapter)
    session.commit()
    return {"status": "deleted", "id": chapter_id}
