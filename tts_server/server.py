"""
Local TTS server: drop-in replacement for ElevenLabs `with-timestamps`.

Endpoint contract (matches what audio.js expects from ElevenLabs):

  POST /v1/text-to-speech/{voice_id}/with-timestamps
  Body: { "text": str, "voice_settings": {...}, "output_format": "mp3_44100_128" }
  Returns:
    {
      "audio_base64": "<mp3 bytes, base64>",
      "alignment": {
        "characters": [...],
        "character_start_times_seconds": [...],
        "character_end_times_seconds": [...]
      }
    }

The voice_id path param is accepted but ignored (single-voice server -
configure the voice via REF_VOICE_PATH or VOICE_PROMPT env vars).

Health: GET /health -> {"status": "ok", "model_loaded": bool}

Run: uvicorn server:app --host 127.0.0.1 --port 8765
"""
import base64
import io
import logging
import os
from typing import Optional

import numpy as np
import soundfile as sf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("tts_server")

# --- Config ---
REF_VOICE_PATH = os.getenv("REF_VOICE_PATH")  # optional path to your reference clip
DEVICE = os.getenv("DEVICE", "cuda")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8765"))

# --- Lazy-init engines (loaded on first request to keep startup fast) ---
from voxcpm_engine import VoxCPMEngine
from aligner import Aligner

engine = VoxCPMEngine(
    ref_voice_path=REF_VOICE_PATH,
    device=DEVICE,
)
aligner = Aligner(language="en", device=DEVICE)


# --- Schemas ---
class VoiceSettings(BaseModel):
    stability: Optional[float] = 0.5
    similarity_boost: Optional[float] = 0.8
    style: Optional[float] = 0.0
    speaking_rate: Optional[float] = 1.0


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)
    voice_settings: Optional[VoiceSettings] = None
    output_format: Optional[str] = "mp3_44100_128"
    seed: Optional[int] = None


class Alignment(BaseModel):
    characters: list
    character_start_times_seconds: list
    character_end_times_seconds: list


class TTSResponse(BaseModel):
    audio_base64: str
    alignment: Alignment


# --- App ---
app = FastAPI(title="Pulse Gaming Local TTS", version="1.0.0")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": engine._model is not None,
        "aligner_loaded": aligner._model is not None,
        "ref_voice": REF_VOICE_PATH or None,
        "base_speed": engine.base_speed,
    }


@app.post("/v1/text-to-speech/{voice_id}/with-timestamps", response_model=TTSResponse)
def synth_with_timestamps(voice_id: str, req: TTSRequest):
    """Match the ElevenLabs path so audio.js can swap base URLs only."""
    return _synth(req)


@app.post("/tts", response_model=TTSResponse)
def synth_tts(req: TTSRequest):
    """Convenience alias."""
    return _synth(req)


def _synth(req: TTSRequest) -> TTSResponse:
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text is empty")

    rate = (req.voice_settings.speaking_rate if req.voice_settings else None) or 1.0

    log.info(f"Synth: '{text[:60]}...' (rate={rate})")

    try:
        audio_f32 = engine.synth(text, speaking_rate=rate, seed=req.seed)
    except Exception as e:
        log.exception("Synth failed")
        raise HTTPException(500, f"Synth failed: {e}")

    sample_rate = engine.SAMPLE_RATE

    # Encode to MP3 in memory via pydub (uses ffmpeg under the hood)
    try:
        mp3_bytes = _encode_mp3(audio_f32, sample_rate, target_format=req.output_format)
    except Exception as e:
        log.exception("MP3 encode failed")
        raise HTTPException(500, f"MP3 encode failed: {e}")

    # Forced alignment for char-level timestamps
    try:
        alignment = aligner.align(audio_f32, sample_rate, text)
    except Exception as e:
        log.warning(f"Alignment failed, using fallback: {e}")
        total_dur = len(audio_f32) / sample_rate
        alignment = Aligner._fallback_even(text, total_dur)

    return TTSResponse(
        audio_base64=base64.b64encode(mp3_bytes).decode("ascii"),
        alignment=Alignment(**alignment),
    )


def _encode_mp3(audio: np.ndarray, sample_rate: int, target_format: str = "mp3_44100_128") -> bytes:
    """Encode float32 audio to MP3 at the requested format."""
    from pydub import AudioSegment

    # Parse target: mp3_44100_128 -> sr=44100, bitrate=128k
    parts = (target_format or "mp3_44100_128").split("_")
    target_sr = int(parts[1]) if len(parts) > 1 else 44_100
    bitrate = f"{parts[2]}k" if len(parts) > 2 else "128k"

    # Resample if needed (linear is fine here, MP3 lossy compression dominates)
    if sample_rate != target_sr:
        ratio = target_sr / sample_rate
        new_len = int(len(audio) * ratio)
        idx = np.linspace(0, len(audio) - 1, new_len).astype(np.int64)
        audio = audio[idx]

    # Float32 [-1,1] -> int16
    audio_i16 = np.clip(audio, -1.0, 1.0)
    audio_i16 = (audio_i16 * 32_767.0).astype(np.int16)

    seg = AudioSegment(
        audio_i16.tobytes(),
        frame_rate=target_sr,
        sample_width=2,
        channels=1,
    )
    buf = io.BytesIO()
    seg.export(buf, format="mp3", bitrate=bitrate)
    return buf.getvalue()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
