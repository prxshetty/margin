from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.services.file_storage import storage
from api.models.domain import Blueprint, Act, Scene
from agents.blueprint_agent import BlueprintAgent

router = APIRouter(
    prefix="/chapters/{chapter_id}/blueprint",
    tags=["blueprint"]
)

class FeedbackRequest(BaseModel):
    feedback: str

@router.post("/")
def generate_blueprint(chapter_id: str):
    chapter = storage.get_chapter(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    # Check if blueprint already exists
    existing = storage.get_blueprint(chapter_id)
    if existing:
        raise HTTPException(status_code=400, detail="Blueprint already exists. Use PATCH to regenerate.")

    characters = storage.get_characters()
    char_names = [c.name for c in characters]

    agent = BlueprintAgent()
    result = agent.generate(
        chapter_title=chapter.title,
        user_outline=chapter.raw_outline,
        characters=char_names
    )
    
    if isinstance(result, list):
        raise HTTPException(status_code=400, detail={"questions": result})

    # Save Blueprint
    blueprint = Blueprint(
        id=f"{chapter_id}_blueprint",
        chapter_id=chapter_id,
        data=result.to_dict(),
        confirmed=False
    )
    storage.save_blueprint(blueprint)
    
    # Save Log
    storage.save_blueprint_log(
        chapter_id=chapter_id,
        system_prompt=agent.last_system_prompt,
        user_prompt=agent.last_user_prompt,
        output=agent.last_response
    )
    
    return {"status": "success", "blueprint_id": blueprint.id}

@router.get("/")
def get_blueprint(chapter_id: str):
    blueprint = storage.get_blueprint(chapter_id)
    if not blueprint:
        raise HTTPException(status_code=404, detail="Blueprint not found")
        
    acts = storage.get_acts(chapter_id)
    
    response_acts = []
    for act in acts:
        scenes = storage.get_scenes_for_act(chapter_id, act.act_number)
        act_dict = act.model_dump()
        act_dict["scenes"] = [s.model_dump() for s in scenes]
        response_acts.append(act_dict)
        
    return {
        "blueprint": blueprint.model_dump(),
        "acts": response_acts
    }

@router.get("/markdown")
def get_blueprint_markdown(chapter_id: str):
    md_path = storage.outputs_dir / chapter_id / "blueprint.md"
    if not md_path.exists():
        bp = storage.get_blueprint(chapter_id)
        if not bp:
            raise HTTPException(status_code=404, detail="Blueprint not found")
        storage.save_blueprint(bp)
        
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="Blueprint markdown file not found")
        
    content = md_path.read_text(encoding="utf-8")
    return {"status": "ok", "content": content, "file": str(md_path)}

@router.patch("/markdown")
def update_blueprint_markdown(chapter_id: str, payload: dict):
    content = payload.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="Missing markdown content")
        
    parsed_data = storage.parse_blueprint_markdown(content)
    
    existing = storage.get_blueprint(chapter_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Blueprint not found")
        
    # Update blueprint data
    existing.data = parsed_data
    storage.save_blueprint(existing)
    
    # Propagate changes to individual acts, scenes, and beat files ONLY if confirmed!
    if existing.confirmed:
        for act_data in parsed_data.get("acts", []):
            act_num = act_data["act_number"]
            act_id = f"{chapter_id}_act-{act_num}"
            for scene_data in act_data.get("scenes", []):
                scene_num = scene_data["scene_number"]
                scene_id = f"{act_id}_scene-{scene_num}"
                
                existing_scene = storage.get_scene(scene_id)
                if existing_scene:
                    existing_scene.scene_setting = scene_data.get("scene_setting", "")
                    existing_scene.scene_description = scene_data.get("scene_description", "")
                    existing_scene.characters = scene_data.get("characters", [])
                    existing_scene.scene_events = scene_data.get("scene_events", [])
                    storage.save_scene(existing_scene)
                else:
                    new_scene = Scene(
                        id=scene_id,
                        act_id=act_id,
                        scene_number=scene_num,
                        scene_setting=scene_data.get("scene_setting", ""),
                        scene_description=scene_data.get("scene_description", ""),
                        characters=scene_data.get("characters", []),
                        scene_events=scene_data.get("scene_events", [])
                    )
                    storage.save_scene(new_scene)
                
    return {"status": "success", "chapter_id": chapter_id}

@router.patch("/")
def regenerate_blueprint(chapter_id: str):
    chapter = storage.get_chapter(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    # Clear existing blueprint and scenes by wiping the outputs directory for this chapter
    import shutil
    out_dir = storage.outputs_dir / chapter_id
    if out_dir.exists():
        shutil.rmtree(out_dir)

    characters = storage.get_characters()
    char_names = [c.name for c in characters]

    agent = BlueprintAgent()
    result = agent.generate(
        chapter_title=chapter.title,
        user_outline=chapter.raw_outline,
        characters=char_names
    )
    
    if isinstance(result, list):
        raise HTTPException(status_code=400, detail={"questions": result})

    # Save Blueprint
    blueprint = Blueprint(
        id=f"{chapter_id}_blueprint",
        chapter_id=chapter_id,
        data=result.to_dict(),
        confirmed=False
    )
    storage.save_blueprint(blueprint)
    
    # Save Log
    storage.save_blueprint_log(
        chapter_id=chapter_id,
        system_prompt=agent.last_system_prompt,
        user_prompt=agent.last_user_prompt,
        output=agent.last_response
    )
    
    return {"status": "success", "blueprint_id": blueprint.id}

@router.post("/confirm")
def confirm_blueprint(chapter_id: str):
    blueprint = storage.get_blueprint(chapter_id)
    if not blueprint:
        raise HTTPException(status_code=404, detail="Blueprint not found")
        
    if blueprint.confirmed:
        return {"status": "success", "message": "Blueprint already confirmed"}
        
    blueprint.confirmed = True
    storage.save_blueprint(blueprint)
    
    # Save Initial Scenes to disk (plan.md files) using latest blueprint data!
    for act_data in blueprint.data.get("acts", []):
        act_num = act_data["act_number"]
        act_id = f"{chapter_id}_act-{act_num}"
        for scene_data in act_data.get("scenes", []):
            scene_num = scene_data["scene_number"]
            scene_id = f"{act_id}_scene-{scene_num}"
            
            existing_scene = storage.get_scene(scene_id)
            if not existing_scene:
                scene = Scene(
                    id=scene_id,
                    act_id=act_id,
                    scene_number=scene_num,
                    scene_setting=scene_data.get("scene_setting", "Setting"),
                    scene_description=scene_data.get("scene_description", ""),
                    characters=scene_data.get("characters", []),
                    scene_events=scene_data.get("scene_events", [])
                )
                storage.save_scene(scene)
                
    return {"status": "success", "blueprint_id": blueprint.id}

@router.get("/logs")
def get_blueprint_logs(chapter_id: str):
    return storage.get_blueprint_logs(chapter_id)
