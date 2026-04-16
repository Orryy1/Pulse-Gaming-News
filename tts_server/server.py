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

Multi-voice routing:
  voice_id lookups are resolved against voices.json (see VOICES_CONFIG_PATH).
  Each mapped voice_id gets its own VoxCPMEngine instance, lazy-loaded on first
  request and cached for the life of the process. This lets one server handle
  both Pulse Gaming (Liam) and Sleepy Stories (Christopher) without restart.

  Fallback: if a voice_id isn't in voices.json, the server uses the default
  engine built from REF_VOICE_PATH / BASE_SPEED env vars. That keeps the old
  single-voice contract working.

Health: GET /health -> {"status": "ok", "voices": [...], "model_loaded": bool}

Run: uvicorn server:app --host 127.0.0.1 --port 8765
"""
import base64
import io
import json
import logging
import os
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import soundfile as sf  # noqa: F401 - kept for future direct WAV paths
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
REF_VOICE_PATH = os.getenv("REF_VOICE_PATH")  # fallback ref when voice_id isn't mapped
DEVICE = os.getenv("DEVICE", "cuda")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8765"))
VOICES_CONFIG_PATH = os.getenv("VOICES_CONFIG_PATH", "voices.json")

# --- Imports ---
from voxcpm_engine import VoxCPMEngine
from aligner import Aligner


# --- Voice registry ---
# voice_id -> { alias, ref_voice_path, base_speed, channel, ... }
def _load_voices_map() -> Dict[str, dict]:
    path = Path(VOICES_CONFIG_PATH)
    if not path.is_absolute():
        path = Path(__file__).parent / path
    if not path.exists():
        log.warning(f"voices.json not found at {path} — single-voice fallback only")
        return {}
    try:
        with path.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except Exception as e:
        log.error(f"Failed to parse {path}: {e}")
        return {}
    # Drop any underscore-prefixed metadata keys (like _description)
    voices = {k: v for k, v in raw.items() if not k.startswith("_")}
    log.info(f"Loaded {len(voices)} voice(s) from {path}: {[v.get('alias', vid) for vid, v in voices.items()]}")
    return voices


VOICES_MAP = _load_voices_map()

# Shared aligner (language-agnostic enough for our stories, and it's not
# cheap to double-load wav2vec2 into VRAM).
aligner = Aligner(language="en", device=DEVICE)

# Per-voice engine cache. Each VoxCPMEngine wraps one reference clip + base
# speed. They're lazy-loaded on first request — loading all at startup would
# fight for VRAM and slow cold start.
_engine_cache: Dict[str, VoxCPMEngine] = {}


def _resolve_ref_path(ref_path: Optional[str]) -> Optional[str]:
    """Voices.json paths are relative to tts_server/. Resolve to absolute so
    the engine can just read the file."""
    if not ref_path:
        return None
    p = Path(ref_path)
    if not p.is_absolute():
        p = Path(__file__).parent / p
    return str(p) if p.exists() else None


def _get_engine(voice_id: str) -> VoxCPMEngine:
    """Fetch or build the VoxCPMEngine for a voice_id."""
    if voice_id in _engine_cache:
        return _engine_cache[voice_id]

    cfg = VOICES_MAP.get(voice_id)
    if cfg is None:
        # Unknown voice_id: fall back to env-var default (original behaviour).
        # Cache under the special "__default__" key so we reuse it for any
        # future unmapped voice_ids rather than rebuilding per-request.
        if "__default__" not in _engine_cache:
            log.info(f"voice_id={voice_id!r} not in voices.json — using env default (ref={REF_VOICE_PATH})")
            eng = VoxCPMEngine(
                ref_voice_path=_resolve_ref_path(REF_VOICE_PATH),
                device=DEVICE,
            )
            _engine_cache["__default__"] = eng
        _engine_cache[voice_id] = _engine_cache["__default__"]
        return _engine_cache[voice_id]

    ref = _resolve_ref_path(cfg.get("ref_voice_path"))
    base_speed = float(cfg.get("base_speed", 1.0))
    alias = cfg.get("alias", voice_id)
    log.info(f"Loading engine for voice_id={voice_id!r} (alias={alias}, ref={ref}, base_speed={base_speed})")

    # VoxCPMEngine reads BASE_SPEED from env at __init__ — override via a
    # temporary env stamp so the instance picks up the per-voice value.
    # (Cleaner than mutating private state of the engine.)
    prev = os.environ.get("BASE_SPEED")
    os.environ["BASE_SPEED"] = str(base_speed)
    try:
        eng = VoxCPMEngine(ref_voice_path=ref, device=DEVICE)
    finally:
        if prev is None:
            os.environ.pop("BASE_SPEED", None)
        else:
            os.environ["BASE_SPEED"] = prev

    _engine_cache[voice_id] = eng
    return eng


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
app = FastAPI(title="Pulse Gaming Local TTS", version="1.1.0")


@app.get("/health")
def health():
    voices_listed = [
        {
            "voice_id": vid,
            "alias": cfg.get("alias", vid),
            "channel": cfg.get("channel"),
            "base_speed": cfg.get("base_speed"),
            "ref_resolved": _resolve_ref_path(cfg.get("ref_voice_path")) is not None,
            "loaded": vid in _engine_cache,
        }
        for vid, cfg in VOICES_MAP.items()
    ]
    return {
        "status": "ok",
        "voices": voices_listed,
        "default_ref_voice": REF_VOICE_PATH or None,
        "aligner_loaded": aligner._model is not None,
        "engine_count": len(_engine_cache),
    }


@app.post("/v1/text-to-speech/{voice_id}/with-timestamps", response_model=TTSResponse)
def synth_with_timestamps(voice_id: str, req: TTSRequest):
    """Match the ElevenLabs path so audio.js can swap base URLs only."""
    return _synth(voice_id, req)


# --- Phase 8: unified inference boundary ---------------------------------
# Single kind-dispatch endpoint the local-worker hits for any GPU job.
# Routes through tts_server/infer_service.py which owns the handler
# registry. Separate from /tts so the registry can grow (image, video,
# ASR, etc.) without reshaping the core TTS contract.

class InferRequest(BaseModel):
    kind: str = Field(..., min_length=1, max_length=64)
    params: dict = Field(default_factory=dict)
    job_id: Optional[str] = None


class InferResponse(BaseModel):
    ok: bool
    kind: str
    job_id: Optional[str] = None
    result: Optional[dict] = None
    error: Optional[str] = None


@app.get("/v1/infer/kinds")
def infer_kinds():
    """Introspection — what inference kinds does this worker support?"""
    import infer_service  # noqa: WPS433

    return {"kinds": infer_service.list_kinds()}


@app.post("/v1/infer", response_model=InferResponse)
def infer(req: InferRequest):
    """
    Generic GPU job entry point. Called by workers/local-worker.js when
    it claims a job whose kind requires_gpu=1. Dispatches to the handler
    registry in infer_service.py. Errors are captured and returned with
    ok=False so the Node side can transition the job to 'fail' cleanly.
    """
    import infer_service  # noqa: WPS433

    try:
        result = infer_service.run(req.kind, req.params, job_id=req.job_id)
        return InferResponse(ok=True, kind=req.kind, job_id=req.job_id, result=result)
    except KeyError as e:
        log.warning(f"unknown infer kind: {req.kind}")
        raise HTTPException(404, str(e))
    except ValueError as e:
        log.warning(f"bad infer params for {req.kind}: {e}")
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception(f"infer failed: kind={req.kind}")
        return InferResponse(ok=False, kind=req.kind, job_id=req.job_id, error=str(e))


@app.post("/tts", response_model=TTSResponse)
def synth_tts(req: TTSRequest):
    """Convenience alias — uses the env-default voice."""
    return _synth("__default__", req)


def _synth(voice_id: str, req: TTSRequest) -> TTSResponse:
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text is empty")

    rate = (req.voice_settings.speaking_rate if req.voice_settings else None) or 1.0

    engine = _get_engine(voice_id)
    alias = VOICES_MAP.get(voice_id, {}).get("alias", voice_id)
    log.info(f"Synth [{alias}]: '{text[:60]}...' (rate={rate})")

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
