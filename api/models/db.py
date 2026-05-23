from typing import Optional, Dict, Any, List
from datetime import datetime
from sqlmodel import Field, SQLModel, Column, JSON

class Chapter(SQLModel, table=True):
    id: str = Field(primary_key=True)
    title: str
    raw_outline: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class Blueprint(SQLModel, table=True):
    id: str = Field(primary_key=True)
    chapter_id: str = Field(foreign_key="chapter.id")
    data: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    approved: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Act(SQLModel, table=True):
    id: str = Field(primary_key=True)
    blueprint_id: str = Field(foreign_key="blueprint.id")
    act_number: int
    act_theme: str
    act_transition_hint: str

class Scene(SQLModel, table=True):
    id: str = Field(primary_key=True)
    act_id: str = Field(foreign_key="act.id")
    scene_number: int
    scene_setting: str
    scene_description: str
    characters: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    scene_events: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    generated_content: Optional[str] = Field(default=None)
    setting_draft: Optional[str] = Field(default=None)
    approved: bool = Field(default=False)
    approved_at: Optional[datetime] = Field(default=None)
    feedback_history: List[str] = Field(default_factory=list, sa_column=Column(JSON))

class AgentLog(SQLModel, table=True):
    id: str = Field(primary_key=True)
    scene_id: str = Field(foreign_key="scene.id")
    beat_number: int
    agent_name: str
    system_prompt: str
    user_prompt: str
    output: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Character(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    slug: str = Field(unique=True)
    data: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class Style(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str = Field(unique=True)
    description: str
    output_size: str
    agent_sections: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    is_system: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
