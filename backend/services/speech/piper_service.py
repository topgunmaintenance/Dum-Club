"""
Speech synthesis using Piper TTS (local, fast, offline).
Later upgrade path: swap generate_speech() for Coqui TTS voice cloning.
"""
import asyncio
import os
import subprocess
import tempfile
from pathlib import Path

PIPER_BIN    = os.getenv("PIPER_BIN", "/usr/local/bin/piper")
VOICES_DIR   = os.getenv("PIPER_VOICES_DIR", "/voices")
DEFAULT_VOICE = "en_US-lessac-medium"   # good quality, fast


async def generate_speech(
    text: str,
    voice: str = DEFAULT_VOICE,
    output_format: str = "wav",
) -> bytes:
    """
    Convert text → audio bytes using Piper.
    Returns raw WAV (or MP3 if ffmpeg post-processed).
    """
    voice_model = Path(VOICES_DIR) / f"{voice}.onnx"
    voice_config = Path(VOICES_DIR) / f"{voice}.onnx.json"

    if not voice_model.exists():
        await _download_voice(voice)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out_file:
        out_path = out_file.name

    try:
        cmd = [
            PIPER_BIN,
            "--model",       str(voice_model),
            "--config",      str(voice_config),
            "--output_file", out_path,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate(input=text.encode())

        if proc.returncode != 0:
            raise RuntimeError(f"Piper failed: {stderr.decode()}")

        with open(out_path, "rb") as f:
            audio_bytes = f.read()

        if output_format == "mp3":
            audio_bytes = await _wav_to_mp3(audio_bytes)

        return audio_bytes
    finally:
        os.unlink(out_path)


async def _download_voice(voice_name: str) -> None:
    """Download Piper voice model from HuggingFace."""
    base_url = (
        f"https://huggingface.co/rhasspy/piper-voices/resolve/main/"
        f"en/en_US/{voice_name.split('-')[2]}/medium/"
    )
    os.makedirs(VOICES_DIR, exist_ok=True)
    for ext in [".onnx", ".onnx.json"]:
        url = f"{base_url}{voice_name}{ext}"
        dest = Path(VOICES_DIR) / f"{voice_name}{ext}"
        proc = await asyncio.create_subprocess_exec(
            "wget", "-q", "-O", str(dest), url
        )
        await proc.wait()


async def _wav_to_mp3(wav_bytes: bytes) -> bytes:
    """Convert WAV → MP3 via ffmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wf:
        wf.write(wav_bytes)
        wav_path = wf.name
    mp3_path = wav_path.replace(".wav", ".mp3")
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", wav_path, "-q:a", "4", mp3_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
        with open(mp3_path, "rb") as f:
            return f.read()
    finally:
        for p in [wav_path, mp3_path]:
            if os.path.exists(p):
                os.unlink(p)


# ─────────────────────────────────────────────────────────────
# UPGRADE PATH: Coqui TTS voice cloning
# Replace generate_speech() with this when ready:
# ─────────────────────────────────────────────────────────────
# from TTS.api import TTS
#
# async def generate_speech_coqui(
#     text: str,
#     speaker_wav: str,       # path to reference voice clip
#     language: str = "en",
# ) -> bytes:
#     tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
#     with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out:
#         tts.tts_to_file(
#             text=text,
#             speaker_wav=speaker_wav,
#             language=language,
#             file_path=out.name,
#         )
#         out.seek(0)
#         return out.read()
