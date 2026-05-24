from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from typing import List
import re
from pathlib import Path

from api.services.file_storage import storage
from api.models.domain import Chapter
from api.models.schemas import ChapterCreate, ChapterResponse

router = APIRouter(
    prefix="/chapters",
    tags=["chapters"]
)

@router.get("/", response_model=List[ChapterResponse])
def get_chapters():
    return storage.get_chapters()

@router.post("/", response_model=ChapterResponse)
def create_chapter(chapter_in: ChapterCreate):
    # generate slug
    slug = re.sub(r"[^a-z0-9_]", "_", chapter_in.title.lower())
    slug = re.sub(r"_+", "_", slug).strip("_")
    
    chapter = Chapter(
        id=slug,
        title=chapter_in.title,
        raw_outline=chapter_in.raw_outline
    )
    return storage.save_chapter(chapter)

@router.get("/{chapter_id}", response_model=ChapterResponse)
def get_chapter(chapter_id: str):
    chapter = storage.get_chapter(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter

@router.delete("/{chapter_id}")
def delete_chapter(chapter_id: str):
    chapter = storage.get_chapter(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    storage.delete_chapter(chapter_id)
    return {"status": "deleted", "id": chapter_id}


@router.post("/{chapter_id}/export")
def export_chapter(chapter_id: str):
    """
    Compile all scene generated_content for a chapter into a single markdown file.
    Scenes are assembled in act/scene order. Returns the compiled markdown and file path.
    """
    chapter = storage.get_chapter(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    blueprint = storage.get_blueprint(chapter_id)
    if not blueprint:
        raise HTTPException(status_code=404, detail="No blueprint found — generate a blueprint first")

    sections: list[str] = []
    sections.append(f"# {chapter.title}\n")

    acts = blueprint.data.get("acts", [])
    has_any_content = False

    for act_data in sorted(acts, key=lambda a: a["act_number"]):
        act_num = act_data["act_number"]
        act_theme = act_data.get("act_theme", "")
        act_section: list[str] = []

        for scene_data in sorted(act_data.get("scenes", []), key=lambda s: s["scene_number"]):
            scene_num = scene_data["scene_number"]
            scene_id = f"{chapter_id}_act-{act_num}_scene-{scene_num}"
            scene = storage.get_scene(scene_id)

            if scene and scene.generated_content and scene.generated_content.strip():
                act_section.append(scene.generated_content.strip())
                has_any_content = True

        if act_section:
            sections.append(f"\n## Act {act_num}: {act_theme}\n")
            sections.extend(act_section)

    if not has_any_content:
        raise HTTPException(
            status_code=422,
            detail="No generated scene content found. Generate at least one scene before exporting."
        )

    compiled = "\n\n---\n\n".join(sections)

    # Write to outputs/{chapter_id}/chapter.md
    out_path = storage.outputs_dir / chapter_id / "chapter.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(compiled, encoding="utf-8")

    return {
        "status": "exported",
        "chapter_id": chapter_id,
        "file": str(out_path),
        "content": compiled,
        "scene_count": sum(
            1 for act in acts
            for scene in act.get("scenes", [])
            if storage.get_scene(f"{chapter_id}_act-{act['act_number']}_scene-{scene['scene_number']}")
            and storage.get_scene(f"{chapter_id}_act-{act['act_number']}_scene-{scene['scene_number']}").generated_content
        )
    }


@router.get("/{chapter_id}/export")
def get_chapter_export(chapter_id: str):
    """Return the previously compiled chapter.md if it exists."""
    out_path = storage.outputs_dir / chapter_id / "chapter.md"
    if not out_path.exists():
        raise HTTPException(status_code=404, detail="No compiled chapter found. Export first.")
    content = out_path.read_text(encoding="utf-8")
    return {"status": "ok", "content": content, "file": str(out_path)}

@router.patch("/{chapter_id}/content")
def update_chapter_outline(chapter_id: str, payload: dict):
    chapter = storage.get_chapter(chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    content = payload.get("content", "")
    chapter.raw_outline = content
    storage.save_chapter(chapter)
    return {"status": "ok", "chapter_id": chapter_id}


from pydantic import BaseModel
from typing import Optional
from agents.rewrite_agent import RewriteAgent

class RewriteSelectionGenericRequest(BaseModel):
    selected_text: str
    feedback: str
    context: Optional[str] = ""

@router.post("/{chapter_id}/rewrite_selection")
def rewrite_selection_generic(chapter_id: str, payload: RewriteSelectionGenericRequest):
    agent = RewriteAgent()
    context = payload.context or ""
    rewritten_text = agent.generate(
        selected_text=payload.selected_text,
        feedback=payload.feedback,
        context_text=context
    )
    return {"rewritten_text": rewritten_text}

