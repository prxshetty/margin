import uuid
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, Session, select
from pathlib import Path

from api.database import engine
from api.models.db import Style
from api.routers import chapters, blueprint, scenes, characters, styles
from style_loader import _parse_style_file

app = FastAPI(title="SLM Writing Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chapters.router)
app.include_router(blueprint.router)
app.include_router(scenes.router)
app.include_router(characters.router)
app.include_router(styles.router)

def create_db_tables():
    SQLModel.metadata.create_all(engine)

def sync_system_styles():
    """Reads inputs/styles/*.md and upserts into Style table with is_system=True."""
    styles_dir = Path("inputs/styles")
    if not styles_dir.exists():
        return
        
    with Session(engine) as session:
        for fpath in styles_dir.glob("*.md"):
            if fpath.stem.lower() == "styles":
                continue
                
            name = fpath.stem.lower()
            parsed = _parse_style_file(fpath)
            
            existing_style = session.exec(select(Style).where(Style.name == name)).first()
            if existing_style:
                if existing_style.is_system:
                    # Update existing system style
                    existing_style.description = parsed.get("description", "")
                    existing_style.output_size = str(parsed.get("output_size", "balanced"))
                    existing_style.agent_sections = parsed.get("agent_sections", {})
                    session.add(existing_style)
            else:
                # Create new system style
                new_style = Style(
                    id=str(uuid.uuid4()),
                    name=name,
                    description=parsed.get("description", ""),
                    output_size=str(parsed.get("output_size", "balanced")),
                    agent_sections=parsed.get("agent_sections", {}),
                    is_system=True
                )
                session.add(new_style)
                
        session.commit()

@app.on_event("startup")
def startup():
    create_db_tables()
    sync_system_styles()

@app.get("/")
def root():
    return {"message": "SLM Writing Engine API is running"}
