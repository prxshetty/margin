from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel, Field

class Chapter(BaseModel):
    id: str # chapter slug
    title: str
    raw_outline: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class Blueprint(BaseModel):
    id: str # {chapter_slug}_blueprint
    chapter_id: str
    data: Dict[str, Any] = Field(default_factory=dict)
    approved: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Act(BaseModel):
    id: str # {chapter_slug}_act-{act_number}
    blueprint_id: str
    act_number: int
    act_theme: str
    act_transition_hint: str

class SceneEvent(BaseModel):
    beat: str
    style: str = "general"
    expected_exchanges: str = "0"
    conversation_flow: List[str] = Field(default_factory=list)

class Scene(BaseModel):
    id: str # {chapter_slug}_act-{act_number}_scene-{scene_number}
    act_id: str
    scene_number: int
    scene_setting: str
    scene_description: str
    characters: List[str] = Field(default_factory=list)
    scene_events: List[Dict[str, Any]] = Field(default_factory=list)
    generated_content: Optional[str] = Field(default=None)
    setting_draft: Optional[str] = Field(default=None)
    approved: bool = Field(default=False)
    approved_at: Optional[datetime] = Field(default=None)
    feedback_history: List[str] = Field(default_factory=list)

class AgentLog(BaseModel):
    id: str
    scene_id: str
    beat_number: int
    agent_name: str
    system_prompt: str
    user_prompt: str
    output: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Character(BaseModel):
    id: str # slug
    name: str
    slug: str
    data: Dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class Style(BaseModel):
    id: str # slug
    name: str
    description: str
    output_size: str
    min_dialogues: int = 2
    agent_sections: Dict[str, Any] = Field(default_factory=dict)
    is_system: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
