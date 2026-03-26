"""
Transcription service using OpenAI Whisper (local).
"""
import tempfile
import os
from pathlib import Path

_model = None


def _load_model(size: str = "base"):
    global _model
    if _model is None:
        import whisper  # lazy: not installed in prod image; fails at call time, not startup
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"🎤 Loading Whisper '{size}' on {device}")
        _model = whisper.load_model(size, device=device)
    return _model


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "audio.mp3",
    model_size: str = "base",
) -> dict:
    """
    Transcribe audio bytes → {text, language, segments}.
    Supports any format ffmpeg can handle (mp3, mp4, wav, m4a, ogg…).
    """
    import torch  # lazy: mirrors _load_model; needed for fp16 flag below
    model = _load_model(model_size)

    # Write to temp file — Whisper requires a file path
    suffix = Path(filename).suffix or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        result = model.transcribe(tmp_path, fp16=torch.cuda.is_available())
        return {
            "text":     result["text"].strip(),
            "language": result.get("language", "en"),
            "segments": result.get("segments", []),
        }
    finally:
        os.unlink(tmp_path)
