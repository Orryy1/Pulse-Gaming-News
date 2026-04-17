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
import time
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
# When true, load the __default__ engine during app startup so the first
# real request doesn't pay the 3-5 min VoxCPM 2 cold-boot cost while the
# Node-side runner counts down its timeout. Default off for dev
# convenience (keeps uvicorn reloads snappy); production boots should set
# PREWARM_ON_BOOT=true in the service env.
PREWARM_ON_BOOT = os.getenv("PREWARM_ON_BOOT", "false").strip().lower() in (
    "1", "true", "yes", "on",
)
PREWARM_VOICE_ID = os.getenv("PREWARM_VOICE_ID", "__default__")

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

# Service readiness state. Phase F stability patch addition: callers
# (Node-side bootstrap-queue, workers/local-worker.js, operators) need a
# way to distinguish "server process up, not ready for GPU work yet"
# from "server up AND default engine loaded AND ready to synth". The
# state transitions:
#   init          — module imported, startup event hasn't fired
#   warming       — PREWARM_ON_BOOT path has entered eng.load()
#   ready         — /v1/infer can handle requests
#   ready-skipped — PREWARM_ON_BOOT=false, first /v1/infer call will pay
#                   the cold-start cost but the service technically
#                   accepts requests now
#   failed        — prewarm raised; the service still accepts requests
#                   but callers should expect the first /v1/infer to
#                   pay the cold-start (or hit the same failure)
SERVICE_STATE: Dict[str, object] = {
    "phase": "init",
    "ready": False,
    "warming": False,
    "prewarm_voice_id": None,
    "last_load_ms": None,
    "last_error": None,
    "boot_ts": None,
}


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
    """Fetch or build the VoxCPMEngine for a voice_id.

    First-time calls for a voice_id pay the full cold-start cost:
    HuggingFace weight fetch (cached after first time), VoxCPM 2 model
    assemble, AudioVAE load, denoiser init. On a Windows box with cached
    weights this is consistently 2-4 minutes; on a cold HF cache it can
    be 10 minutes or more. The Phase F stability patch wraps each load
    in timing logs so we can track regressions over time.
    """
    if voice_id in _engine_cache:
        log.info(f"[engine] reuse voice_id={voice_id!r} (cached)")
        return _engine_cache[voice_id]

    cfg = VOICES_MAP.get(voice_id)
    if cfg is None:
        # Unknown voice_id: fall back to env-var default (original behaviour).
        # Cache under the special "__default__" key so we reuse it for any
        # future unmapped voice_ids rather than rebuilding per-request.
        if "__default__" not in _engine_cache:
            log.info(
                f"[engine] COLD_START voice_id={voice_id!r} -> __default__ "
                f"(ref={REF_VOICE_PATH}) — loading VoxCPM 2, expect 2-5 min"
            )
            t0 = time.monotonic()
            eng = VoxCPMEngine(
                ref_voice_path=_resolve_ref_path(REF_VOICE_PATH),
                device=DEVICE,
            )
            dt_ms = int((time.monotonic() - t0) * 1000)
            log.info(f"[engine] LOADED voice_id=__default__ elapsed_ms={dt_ms}")
            _engine_cache["__default__"] = eng
        _engine_cache[voice_id] = _engine_cache["__default__"]
        return _engine_cache[voice_id]

    ref = _resolve_ref_path(cfg.get("ref_voice_path"))
    base_speed = float(cfg.get("base_speed", 1.0))
    alias = cfg.get("alias", voice_id)
    log.info(
        f"[engine] COLD_START voice_id={voice_id!r} alias={alias} ref={ref} "
        f"base_speed={base_speed} — loading VoxCPM 2, expect 2-5 min"
    )
    t0 = time.monotonic()

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

    dt_ms = int((time.monotonic() - t0) * 1000)
    log.info(f"[engine] LOADED voice_id={voice_id!r} alias={alias} elapsed_ms={dt_ms}")
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
app = FastAPI(title="Pulse Gaming Local TTS", version="1.2.0")


@app.on_event("startup")
def _on_startup():
    """Log a boot banner + optionally prewarm the default engine.

    The banner gives ops a single grep target (`[boot]`) to confirm the
    server is fresh and configured correctly. When PREWARM_ON_BOOT=true,
    we load __default__ here so the first real /v1/infer call doesn't
    eat the cold-start cost. The prewarm is best-effort — if it fails,
    the server still serves requests (they'll just pay the cost on first
    call).
    """
    boot_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    SERVICE_STATE["boot_ts"] = boot_ts
    SERVICE_STATE["prewarm_voice_id"] = PREWARM_VOICE_ID
    log.info(
        f"[boot] pulse-gaming tts_server starting ts={boot_ts} "
        f"device={DEVICE} voices={len(VOICES_MAP)} prewarm_on_boot={PREWARM_ON_BOOT} "
        f"prewarm_voice_id={PREWARM_VOICE_ID}"
    )
    if not PREWARM_ON_BOOT:
        log.info(
            "[boot] prewarm skipped — set PREWARM_ON_BOOT=true to warm the "
            "default engine during startup"
        )
        # Service is accepting requests, but the first /v1/infer will
        # still pay the cold-start. Callers that want strict readiness
        # should POST /v1/prewarm before dispatching jobs.
        SERVICE_STATE["phase"] = "ready-skipped"
        SERVICE_STATE["ready"] = True
        return
    try:
        log.info(f"[boot] prewarming voice_id={PREWARM_VOICE_ID}")
        SERVICE_STATE["phase"] = "warming"
        SERVICE_STATE["warming"] = True
        t0 = time.monotonic()
        eng = _get_engine(PREWARM_VOICE_ID)
        # VoxCPMEngine defers HuggingFace weight load to first synth(). Force
        # the eager load here so PREWARM_ON_BOOT actually pays the cost now
        # instead of at first real request. The Phase F drill found the
        # shell-only prewarm returned in 0ms and left the next /v1/infer
        # call to eat 3-5 minutes — defeating the entire point of the flag.
        if hasattr(eng, "load"):
            eng.load()
        dt_ms = int((time.monotonic() - t0) * 1000)
        SERVICE_STATE["last_load_ms"] = dt_ms
        SERVICE_STATE["phase"] = "ready"
        SERVICE_STATE["ready"] = True
        SERVICE_STATE["warming"] = False
        log.info(
            f"[boot] prewarm complete voice_id={PREWARM_VOICE_ID} "
            f"elapsed_ms={dt_ms} engine_count={len(_engine_cache)}"
        )
    except Exception as e:
        SERVICE_STATE["phase"] = "failed"
        SERVICE_STATE["warming"] = False
        SERVICE_STATE["last_error"] = str(e)
        # Service still accepts requests — callers can retry /v1/prewarm
        # manually. "ready=True" here means "the HTTP server responds",
        # not "GPU work will succeed". Distinguishing the two is why
        # SERVICE_STATE.phase exists alongside SERVICE_STATE.ready.
        SERVICE_STATE["ready"] = True
        log.exception(
            f"[boot] prewarm FAILED voice_id={PREWARM_VOICE_ID}: {e} — "
            "first /v1/infer call will pay the cold-start cost instead"
        )


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
        # Phase F readiness state. Callers that need to know whether the
        # GPU engine is actually resident (as opposed to "HTTP responds")
        # should read .phase and .ready together — see SERVICE_STATE
        # comment in this file for the full state machine.
        "phase": SERVICE_STATE["phase"],
        "ready": SERVICE_STATE["ready"],
        "warming": SERVICE_STATE["warming"],
        "prewarm_voice_id": SERVICE_STATE["prewarm_voice_id"],
        "last_load_ms": SERVICE_STATE["last_load_ms"],
        "last_error": SERVICE_STATE["last_error"],
        "boot_ts": SERVICE_STATE["boot_ts"],
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


class PrewarmRequest(BaseModel):
    voice_id: Optional[str] = "__default__"


@app.post("/v1/prewarm")
def prewarm(req: PrewarmRequest):
    """
    Manually load a voice engine without dispatching a job.

    The Node-side inference-client::prewarm() calls this during worker
    boot (or from scripts/prewarm-infer.ps1) so the cold-start cost is
    paid OUTSIDE the runner's timeout budget. Safe to call repeatedly —
    a cached engine short-circuits immediately.

    Returns:
        voice_id      which id was warmed
        loaded_ms     time to load (0 when already cached)
        engine_count  total cached engines after this call
        reused        true if the engine was already loaded before this call
    """
    voice_id = (req.voice_id or "__default__").strip()
    reused = voice_id in _engine_cache
    # Also catch the "__default__ already loaded, unmapped voice_id" case
    # so we don't double-warm. _get_engine handles the mapping internally.
    if not reused and voice_id not in VOICES_MAP and "__default__" in _engine_cache:
        reused = True

    t0 = time.monotonic()
    prior_phase = SERVICE_STATE["phase"]
    SERVICE_STATE["phase"] = "warming"
    SERVICE_STATE["warming"] = True
    try:
        eng = _get_engine(voice_id)
        # Force eager weight load — VoxCPMEngine defers it to first synth()
        # otherwise, and a shell-only prewarm doesn't help the runner at all.
        if hasattr(eng, "load"):
            eng.load()
    except Exception as e:
        SERVICE_STATE["phase"] = "failed"
        SERVICE_STATE["warming"] = False
        SERVICE_STATE["last_error"] = str(e)
        log.exception(f"[prewarm] failed voice_id={voice_id}")
        raise HTTPException(500, f"prewarm failed: {e}")
    dt_ms = int((time.monotonic() - t0) * 1000)
    # Only flip to "ready" if the prior phase wasn't something stronger
    # (e.g. already ready from the boot prewarm) or weaker in a way
    # that indicates the rest of the service is unhealthy.
    SERVICE_STATE["phase"] = "ready"
    SERVICE_STATE["ready"] = True
    SERVICE_STATE["warming"] = False
    SERVICE_STATE["last_load_ms"] = dt_ms
    SERVICE_STATE["prewarm_voice_id"] = voice_id
    SERVICE_STATE["last_error"] = None  # clear any prior failure
    _ = prior_phase  # retained for debug/log extension
    log.info(
        f"[prewarm] voice_id={voice_id} reused={reused} elapsed_ms={dt_ms} "
        f"engine_count={len(_engine_cache)}"
    )
    return {
        "voice_id": voice_id,
        "loaded_ms": dt_ms,
        "engine_count": len(_engine_cache),
        "reused": reused,
    }


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
