"""
Transcription route — upload audio/video → Whisper → embed → store.
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from services.transcription.whisper_service import transcribe_audio
from services.retrieval.retrieval_service import ingest_document
from db.supabase import get_client

router = APIRouter()


@router.post("/")
async def transcribe(
    file:    UploadFile = File(...),
    post_id: str        = Form(...),
):
    """
    Transcribe uploaded media and store transcript + embeddings.
    Accepts any ffmpeg-compatible format.
    """
    audio_bytes = await file.read()
    if len(audio_bytes) > 500 * 1024 * 1024:  # 500 MB guard
        raise HTTPException(status_code=413, detail="File too large (max 500 MB)")

    # 1. Transcribe with Whisper
    result = await transcribe_audio(audio_bytes, filename=file.filename or "upload")

    # 2. Store raw transcript
    client = get_client()
    await client.table("transcripts").insert({
        "post_id":  post_id,
        "raw_text": result["text"],
        "language": result["language"],
    }).execute()

    # 3. Chunk + embed + store in pgvector
    n_chunks = await ingest_document(post_id, result["text"])

    return {
        "transcript": result["text"],
        "language":   result["language"],
        "chunks_stored": n_chunks,
    }
