"""
Speech synthesis route — text → audio via Piper TTS.
"""
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from services.speech.piper_service import generate_speech

router = APIRouter()


class SpeechRequest(BaseModel):
    text:   str
    voice:  str  = "en_US-lessac-medium"
    format: str  = "wav"   # "wav" or "mp3"


@router.post("/synthesize")
async def synthesize(req: SpeechRequest):
    audio = await generate_speech(req.text, voice=req.voice, output_format=req.format)
    media_type = "audio/mpeg" if req.format == "mp3" else "audio/wav"
    return Response(content=audio, media_type=media_type)
