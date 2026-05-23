from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

class ChapterCreate(BaseModel):
    title: str
    raw_outline: str

class ChapterResponse(BaseModel):
    id: str
    title: str
    raw_outline: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
