from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routers import assist, workspace, settings

app = FastAPI(title="SLM Writing Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(assist.router)
app.include_router(workspace.router)
app.include_router(settings.router)

@app.get("/")
def root():
    return {"message": "SLM Writing Engine API is running"}
