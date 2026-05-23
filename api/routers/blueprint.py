import uuid
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel

from api.database import get_session
from api.models.db import Chapter, Blueprint, Act, Scene, Character
from agents.blueprint_agent import BlueprintAgent

router = APIRouter(
    prefix="/chapters/{chapter_id}/blueprint",
    tags=["blueprint"]
)

class FeedbackRequest(BaseModel):
    feedback: str

@router.post("/")
def generate_blueprint(chapter_id: str, session: Session = Depends(get_session)):
    chapter = session.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    # Check if blueprint already exists
    existing = session.exec(select(Blueprint).where(Blueprint.chapter_id == chapter_id)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Blueprint already exists. Use PATCH to regenerate.")

    characters = session.exec(select(Character)).all()
    char_names = [c.name for c in characters]

    agent = BlueprintAgent()
    result = agent.generate(
        chapter_title=chapter.title,
        user_outline=chapter.raw_outline,
        characters=char_names
    )
    
    if isinstance(result, list):
        # The agent returned clarifying questions instead of a blueprint.
        # For our automated flow, we might want to just handle this or force JSON.
        # But for now, let's return 400 with questions.
        raise HTTPException(status_code=400, detail={"questions": result})

    # Save Blueprint
    blueprint_db = Blueprint(
        id=str(uuid.uuid4()),
        chapter_id=chapter_id,
        data=result.to_dict()
    )
    session.add(blueprint_db)
    
    # Save Acts and Scenes
    for act_model in result.acts:
        act_db = Act(
            id=str(uuid.uuid4()),
            blueprint_id=blueprint_db.id,
            act_number=act_model.act_number,
            act_theme=act_model.act_theme,
            act_transition_hint=act_model.act_transition_hint
        )
        session.add(act_db)
        
        for scene_model in act_model.scenes:
            scene_db = Scene(
                id=str(uuid.uuid4()),
                act_id=act_db.id,
                scene_number=scene_model.scene_number,
                scene_setting=scene_model.scene_setting,
                scene_description=scene_model.scene_description,
                characters=scene_model.characters,
                scene_events=scene_model.scene_events if hasattr(scene_model, 'scene_events') else []
            )
            session.add(scene_db)
            
    session.commit()
    
    return {"status": "success", "blueprint_id": blueprint_db.id}

@router.get("/")
def get_blueprint(chapter_id: str, session: Session = Depends(get_session)):
    blueprint = session.exec(select(Blueprint).where(Blueprint.chapter_id == chapter_id)).first()
    if not blueprint:
        raise HTTPException(status_code=404, detail="Blueprint not found")
        
    acts = session.exec(select(Act).where(Act.blueprint_id == blueprint.id).order_by(Act.act_number)).all()
    
    response_acts = []
    for act in acts:
        scenes = session.exec(select(Scene).where(Scene.act_id == act.id).order_by(Scene.scene_number)).all()
        act_dict = act.model_dump()
        act_dict["scenes"] = [s.model_dump() for s in scenes]
        response_acts.append(act_dict)
        
    return {
        "blueprint": blueprint.model_dump(),
        "acts": response_acts
    }
