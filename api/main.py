import uuid
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import assist, chapters, blueprint, scenes, characters, styles, settings

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
app.include_router(settings.router)
app.include_router(assist.router)

@app.get("/")
def root():
    return {"message": "SLM Writing Engine API is running"}
