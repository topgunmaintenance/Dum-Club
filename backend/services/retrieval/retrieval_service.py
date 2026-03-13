"""
RAG retrieval using Supabase pgvector.
"""
import os
from typing import List
from db.supabase import get_client


async def ingest_document(post_id: str, text: str) -> int:
    from services.embeddings.embedding_service import chunk_text, embed_texts
    chunks = chunk_text(text)
    if not chunks:
        return 0
    embeddings = embed_texts(chunks)
    client = get_client()
    rows = [
        {"post_id": post_id, "chunk_text": chunk, "embedding": emb}
        for chunk, emb in zip(chunks, embeddings)
    ]
    client.table("content_embeddings").insert(rows).execute()
    return len(rows)


async def retrieve_context(query: str, top_k: int = 5) -> List[dict]:
    from services.embeddings.embedding_service import embed_single
    client = get_client()
    query_vec = embed_single(query)
    result = client.rpc(
        "match_content_embeddings",
        {
            "query_embedding": query_vec,
            "match_count": top_k,
            "match_threshold": 0.60,
        },
    ).execute()
    return result.data or []
