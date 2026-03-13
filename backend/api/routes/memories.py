from fastapi import APIRouter
from pydantic import BaseModel
from db.supabase import get_client

router = APIRouter()

class MemoryCreate(BaseModel):
    project_id: str
    content_text: str
    content_type: str = "text"

@router.get("/")
async def get_memories(project_id: str):
    client = get_client()
    result = client.table("memories").select("*").eq("project_id", project_id).order("created_at").execute()
    return {"memories": result.data}

@router.post("/")
async def add_memory(req: MemoryCreate):
    client = get_client()
    result = client.table("memories").insert({
        "project_id": req.project_id,
        "content_text": req.content_text,
        "content_type": req.content_type,
    }).execute()
    return {"memory": result.data[0]}
