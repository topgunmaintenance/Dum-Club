from fastapi import APIRouter
from pydantic import BaseModel
from db.supabase import get_client
import ollama
import os

router = APIRouter()

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
client = ollama.Client(host=OLLAMA_HOST)


class RefineRequest(BaseModel):
    project_id: str
    prompt: str


@router.post("")
async def refine_project(req: RefineRequest):
    supabase = get_client()

    project = (
        supabase.table("projects")
        .select("*")
        .eq("id", req.project_id)
        .single()
        .execute()
    )

    if not project.data:
        return {"error": "project not found"}

    project_data = project.data

    context = f"""
Project Title: {project_data.get("title")}
Description: {project_data.get("description")}
User Request: {req.prompt}

Improve the project description and functionality.
Return only the updated project description in clean text.
"""

    response = client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "user", "content": context}
        ]
    )

    refined_text = response["message"]["content"]

    supabase.table("projects").update(
        {"description": refined_text}
    ).eq("id", req.project_id).execute()

    return {
        "status": "success",
        "updated_description": refined_text
    }
