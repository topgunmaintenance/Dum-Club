"""Content routes — create posts, ingest text content."""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel
from db.supabase import get_client
from services.retrieval.retrieval_service import ingest_document

router = APIRouter()


class PostCreate(BaseModel):
    creator_wallet: str
    title:          str
    body:           str
    media_url:      Optional[str] = None
    media_type:     Optional[str] = None
    is_gated:       bool = False
    min_vault_sol:  float = 0.0


@router.post("/")
async def create_post(req: PostCreate):
    client = get_client()
    creator = await client.table("profiles").select("id").eq("wallet_address", req.creator_wallet).single().execute()

    post = await client.table("posts").insert({
        "creator_id":    creator.data["id"],
        "title":         req.title,
        "body":          req.body,
        "media_url":     req.media_url,
        "media_type":    req.media_type or "text",
        "is_gated":      req.is_gated,
        "min_vault_sol": req.min_vault_sol,
    }).execute()

    post_id = post.data[0]["id"]
    if req.body:
        await ingest_document(post_id, f"{req.title}\n\n{req.body}")

    return {"post": post.data[0]}


@router.get("/feed")
async def get_feed(limit: int = 20, offset: int = 0):
    client = get_client()
    posts = await client.table("posts")\
        .select("*, profiles!creator_id(username, display_name, wallet_address, avatar_url)")\
        .order("created_at", desc=True)\
        .limit(limit)\
        .offset(offset)\
        .execute()
    return {"posts": posts.data}
