from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from db.supabase import get_client
import ollama
import os

router = APIRouter()

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
_client = ollama.Client(host=OLLAMA_HOST)


class ChatRequest(BaseModel):
    message: str
    project_id: str | None = None
    stream: bool = False


@router.post("/")
async def chat(req: ChatRequest):
    memories_text = ""
    result = None

    if req.project_id:
        client = get_client()
        result = (
            client.table("memories")
            .select("content_text")
            .eq("project_id", req.project_id)
            .execute()
        )
        if result.data:
            memories_text = "\n".join([m["content_text"] for m in result.data])

    if memories_text:
        system = f"""You are an AI assistant representing a person based only on their saved memories.
Use these memories to answer naturally and clearly.
If the answer is not in the memories, say you do not know.

MEMORIES:
{memories_text}"""
    else:
        system = "You are a helpful AI assistant for DUM Club, a Solana-native AI app builder."

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": req.message},
    ]

    if req.stream:
        def event_stream():
            stream = _client.chat(model=OLLAMA_MODEL, messages=messages, stream=True)
            for chunk in stream:
                token = chunk["message"]["content"]
                yield f"data: {token}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    response = _client.chat(model=OLLAMA_MODEL, messages=messages)

    return {
        "answer": response["message"]["content"],
        "project_id": req.project_id,
        "memories_used": len(result.data) if result and result.data else 0,
    }
