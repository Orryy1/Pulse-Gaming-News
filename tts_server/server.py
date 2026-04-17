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
import faulthandler
import io
import json
import logging
import os
import platform
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

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

# --- Phase 1C forensics ---------------------------------------------------
# Instrumentation only. The hang root cause is still unknown; these helpers
# exist so the NEXT hang leaves better artefacts than the 2026-04-17 one.
# See docs/inference-forensics-plan.md for the failure-mode table this
# implements against.

# Every process gets a short boot id. It appears in every breadcrumb line
# and in /health so the Node side can detect restarts without relying on
# pid (which gets reused).
BOOT_ID = uuid.uuid4().hex[:8]
BOOT_PID = os.getpid()
BOOT_STARTED_MONO = time.monotonic()
BOOT_STARTED_WALL = time.time()

# Where diagnostic artefacts live. Defaults to tts_server/diag/ so they
# sit next to server.log for easy zip-and-attach during incident response.
BOOT_DIAG_DIR = Path(os.getenv("BOOT_DIAG_DIR", Path(__file__).parent / "diag"))
try:
    BOOT_DIAG_DIR.mkdir(parents=True, exist_ok=True)
except Exception as _e:  # never let diag setup kill the server
    log.warning(f"[forensics] could not create BOOT_DIAG_DIR={BOOT_DIAG_DIR}: {_e}")

# faulthandler: when a native crash (SIGSEGV / SIGABRT / SIGFPE / SIGILL on
# POSIX; SIGBREAK + SIGILL on Windows) hits, Python's default behaviour is
# to die with no trace. faulthandler dumps all thread stacks to the chosen
# file just before the process exits. Effectively zero runtime cost.
_FAULT_LOG_PATH = BOOT_DIAG_DIR / f"faulthandler.{BOOT_ID}.log"
try:
    _fault_fp = open(_FAULT_LOG_PATH, "w", buffering=1, encoding="utf-8")
    faulthandler.enable(file=_fault_fp, all_threads=True)
    # Dump every 60s while the supervisor is warming — if the load thread
    # wedges holding the GIL, this still fires from a C-level timer thread
    # so we get a live stack trace of the hang without having to run py-spy.
    # Cancelled when the supervisor flips phase='ready' or phase='failed'.
    # The cancel is best-effort — worst case the file grows by one stack
    # trace every minute until restart, which is cheap.
    _fault_dump_every_s = int(os.getenv("BOOT_FAULT_DUMP_EVERY_S", "60"))
    if _fault_dump_every_s > 0:
        faulthandler.dump_traceback_later(
            _fault_dump_every_s,
            repeat=True,
            file=_fault_fp,
        )
except Exception as _e:
    log.warning(f"[forensics] faulthandler setup failed: {_e}")

# Make Python's own stdout line-buffered. VoxCPM (and its deps) print
# directly to stdout — that's how "Loading model from safetensors: ..."
# ends up in server.log but "Loaded VoxCPM 2" doesn't if the process
# dies first. Line buffering forces a flush on every newline so the
# last print before a hang/crash reaches disk.
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception as _e:
    log.warning(f"[forensics] stdout reconfigure failed: {_e}")


def _atomic_write_json(path: Path, data: Dict[str, Any]) -> None:
    """Write JSON via tmp+rename so a crash mid-write doesn't corrupt the
    breadcrumb file. Best-effort — never raises."""
    try:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
        os.replace(tmp, path)
    except Exception as e:
        log.warning(f"[forensics] _atomic_write_json({path}) failed: {e}")


def _vram_snapshot() -> Optional[Dict[str, int]]:
    """Return allocated/reserved VRAM in bytes + free/total from the driver.
    None if CUDA isn't usable. Best-effort; swallows every exception
    because forensic hooks must never break the hot path."""
    try:
        import torch  # late import so non-CUDA dev machines don't pay this

        if not torch.cuda.is_available():
            return None
        dev = torch.cuda.current_device()
        free_b, total_b = torch.cuda.mem_get_info(dev)
        return {
            "device_index": int(dev),
            "allocated_b": int(torch.cuda.memory_allocated(dev)),
            "reserved_b": int(torch.cuda.memory_reserved(dev)),
            "free_b": int(free_b),
            "total_b": int(total_b),
        }
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


def _collect_versions() -> Dict[str, Any]:
    """Gather dependency versions + platform info for the boot banner."""
    info: Dict[str, Any] = {
        "python": sys.version.split()[0],
        "python_impl": platform.python_implementation(),
        "platform": platform.platform(),
        "executable": sys.executable,
    }
    for mod_name in ("torch", "torchaudio", "numpy", "safetensors", "voxcpm",
                     "transformers", "fastapi", "uvicorn", "pydantic"):
        try:
            mod = __import__(mod_name)
            info[mod_name] = getattr(mod, "__version__", "unknown")
        except Exception as e:
            info[mod_name] = f"!import: {type(e).__name__}: {e}"
    # CUDA runtime info, conditional on torch being importable
    try:
        import torch  # noqa: WPS433

        info["torch_cuda_available"] = bool(torch.cuda.is_available())
        info["torch_cuda_version"] = getattr(torch.version, "cuda", None)
        info["torch_cudnn_version"] = getattr(
            getattr(torch.backends, "cudnn", None), "version", lambda: None
        )()
        if info["torch_cuda_available"]:
            info["cuda_device_count"] = torch.cuda.device_count()
            try:
                props = torch.cuda.get_device_properties(0)
                info["cuda_device_0"] = {
                    "name": props.name,
                    "total_memory_b": props.total_memory,
                    "major": props.major,
                    "minor": props.minor,
                }
            except Exception as e:
                info["cuda_device_0"] = f"!props: {type(e).__name__}: {e}"
    except Exception as e:
        info["torch_probe_error"] = f"{type(e).__name__}: {e}"
    return info


# Single-slot mutable breadcrumb. Updated by _mark_phase; serialised to
# BOOT_DIAG_DIR/boot_state.json on every update so a post-mortem has a
# record of the last known phase even if the process died silently.
BOOT_STATE: Dict[str, Any] = {
    "boot_id": BOOT_ID,
    "pid": BOOT_PID,
    "started_wall": BOOT_STARTED_WALL,
    "started_iso": time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(BOOT_STARTED_WALL)
    ),
    "phase": "init",
    "history": [],  # ordered (phase, monotonic_s, wall_s, wall_iso, vram, extra)
    "faulthandler_log": str(_FAULT_LOG_PATH),
    "versions": None,  # filled on first banner log
}
_BOOT_STATE_PATH = BOOT_DIAG_DIR / "boot_state.json"


def _mark_phase(phase: str, **extra: Any) -> None:
    """Record a phase transition. Appends to BOOT_STATE.history + flushes
    to disk. Safe from any thread; BOOT_STATE mutations are GIL-protected
    and the json write is atomic. Also emits a structured log line the
    operator can grep: `[forensics] phase=<p> boot=<id> ...`."""
    now_mono = time.monotonic() - BOOT_STARTED_MONO
    now_wall = time.time()
    vram = _vram_snapshot()
    entry = {
        "phase": phase,
        "mono_s": round(now_mono, 3),
        "wall_s": round(now_wall - BOOT_STARTED_WALL, 3),
        "wall_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_wall)),
        "vram": vram,
        "extra": extra or None,
    }
    BOOT_STATE["phase"] = phase
    BOOT_STATE["last_mono_s"] = entry["mono_s"]
    BOOT_STATE["last_wall_iso"] = entry["wall_iso"]
    # Detect wall-clock jumps (machine slept). If wall elapsed is
    # significantly larger than monotonic elapsed between the last two
    # marks, we almost certainly suspended.
    hist = BOOT_STATE["history"]
    if hist:
        prev = hist[-1]
        d_mono = entry["mono_s"] - prev["mono_s"]
        d_wall = entry["wall_s"] - prev["wall_s"]
        drift = d_wall - d_mono
        entry["drift_s"] = round(drift, 3)
        if drift > 5.0:
            log.warning(
                f"[forensics] clock drift detected between phases "
                f"prev={prev['phase']} now={phase} drift_s={drift:.1f} "
                "— machine may have slept mid-load"
            )
    hist.append(entry)
    # Keep the on-disk breadcrumb bounded — last 64 phases is plenty.
    if len(hist) > 64:
        BOOT_STATE["history"] = hist[-64:]
    _atomic_write_json(_BOOT_STATE_PATH, BOOT_STATE)
    log.info(
        f"[forensics] phase={phase} boot={BOOT_ID} mono_s={entry['mono_s']} "
        f"vram={_fmt_vram(vram)} extra={extra or '-'}"
    )


def _fmt_vram(v: Optional[Dict[str, int]]) -> str:
    if not v or "error" in v:
        return str(v) if v else "none"
    def _gb(x: int) -> str:
        return f"{x / (1024 ** 3):.2f}GB"
    return (
        f"alloc={_gb(v['allocated_b'])} reserved={_gb(v['reserved_b'])} "
        f"free={_gb(v['free_b'])}/{_gb(v['total_b'])}"
    )


def _emit_startup_banner() -> None:
    """One-shot structured banner at server boot. Versions + env + device
    properties. The single most useful artefact for post-mortem: 'what
    was the world like at the moment we started loading?'"""
    versions = _collect_versions()
    BOOT_STATE["versions"] = versions
    env_snapshot = {
        k: os.getenv(k)
        for k in (
            "DEVICE", "PREWARM_ON_BOOT", "PREWARM_VOICE_ID",
            "PREWARM_WATCHDOG_S", "BASE_SPEED", "REF_VOICE_PATH",
            "HOST", "PORT", "LOG_LEVEL",
            "BOOT_DIAG_DIR", "BOOT_FAULT_DUMP_EVERY_S",
            # HuggingFace cache location affects first-time cold boot cost
            "HF_HOME", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE",
            # CUDA selection
            "CUDA_VISIBLE_DEVICES", "CUDA_DEVICE_ORDER",
        )
    }
    BOOT_STATE["env"] = env_snapshot
    _atomic_write_json(_BOOT_STATE_PATH, BOOT_STATE)
    log.info(
        f"[forensics] banner boot={BOOT_ID} pid={BOOT_PID} "
        f"fault_log={_FAULT_LOG_PATH}"
    )
    log.info(f"[forensics] versions={json.dumps(versions, default=str)}")
    log.info(f"[forensics] env={json.dumps(env_snapshot, default=str)}")
    vram = _vram_snapshot()
    log.info(f"[forensics] boot_vram={_fmt_vram(vram)}")


# Emit banner immediately at import time (not inside the startup event)
# so we have the versions snapshot even if FastAPI startup never fires.
try:
    _emit_startup_banner()
    _mark_phase("module_imported")
except Exception as _e:
    log.warning(f"[forensics] banner emit failed: {_e}")

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
# Phase 1B watchdog: hard wall-clock ceiling on a single eng.load() call.
# When the thread running the load is still alive past this budget, the
# service transitions to phase='failed' with last_error='PREWARM_WATCHDOG_EXPIRED'
# so /health surfaces the deadlock instead of silently staying in 'warming'.
# 420s = 7 min covers the observed 2-5 min cold-boot cost on cached weights
# plus safetensors slowpaths, while still catching the ~25+ min deadlock
# observed on 2026-04-17. See docs/inference-boot-procedure.md for the
# failure mode this addresses.
PREWARM_WATCHDOG_S = int(os.getenv("PREWARM_WATCHDOG_S", "420"))

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
    # Phase 1B: last time the prewarm thread logged a heartbeat. Lets
    # operators grep /health to tell "load in progress" from "load
    # deadlocked and thread holding the GIL". Updated by the supervisor
    # thread before/after each potentially-blocking call.
    "last_heartbeat_ts": None,
    # Phase 1B: watchdog budget reflected in /health so callers don't
    # have to grep logs to know when phase='failed' will trip.
    "watchdog_s": PREWARM_WATCHDOG_S,
}

# Phase 1B: a single-slot lock + handle so concurrent /v1/prewarm calls
# don't race each other into two in-flight loads (which would just
# compound the memory-pressure problem the safetensors deadlock seems to
# exacerbate). Access is short — holders only consult/set the handle.
_prewarm_lock = threading.Lock()
_prewarm_thread: Optional[threading.Thread] = None


def _heartbeat(tag: str) -> None:
    """Stamp SERVICE_STATE so /health surfaces liveness for the prewarm
    thread. Cheap and always called from the supervisor or load thread —
    never from the main event loop."""
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    SERVICE_STATE["last_heartbeat_ts"] = ts
    log.info(f"[prewarm-heartbeat] tag={tag} ts={ts}")


def _run_engine_load_watchdogged(voice_id: str, watchdog_s: int) -> Dict[str, object]:
    """
    Load the engine for `voice_id` in a daemon thread with a wall-clock
    watchdog. Returns a dict with one of:
      { "status": "ok",       "elapsed_ms": int }
      { "status": "error",    "elapsed_ms": int, "error": Exception }
      { "status": "timeout",  "elapsed_ms": int, "watchdog_s": int }

    When status='timeout' the load thread may still be alive (Python
    can't safely kill a thread stuck in native code); the caller must
    treat this as unrecoverable within the current process and surface
    PREWARM_WATCHDOG_EXPIRED to the operator. Subsequent calls short-
    circuit on `__default__ in _engine_cache` if the stuck thread ever
    finishes, but the state is untrustworthy until a restart.
    """
    result: Dict[str, object] = {"status": None, "elapsed_ms": 0, "error": None}
    started = time.monotonic()

    def _target() -> None:
        try:
            _heartbeat(f"load-begin:{voice_id}")
            _mark_phase("load_begin", voice_id=voice_id)
            eng = _get_engine(voice_id)
            _mark_phase("engine_resolved", voice_id=voice_id)
            # VoxCPMEngine defers the HF weight load to first synth().
            # Force it here so the prewarm actually pays the cost; the
            # observed safetensors deadlock happens inside this call.
            if hasattr(eng, "load"):
                _heartbeat(f"engine-load-call:{voice_id}")
                _mark_phase("engine_load_call", voice_id=voice_id)
                # Flush stdout/stderr so any prints inside VoxCPM that
                # precede the hang are on disk before we cross into
                # potentially-blocking native code.
                try:
                    sys.stdout.flush()
                    sys.stderr.flush()
                except Exception:
                    pass
                eng.load()
                _mark_phase("engine_load_return", voice_id=voice_id)
            _heartbeat(f"load-end:{voice_id}")
            _mark_phase("load_end", voice_id=voice_id)
            result["status"] = "ok"
        except Exception as e:
            _mark_phase("load_exception", voice_id=voice_id,
                        error=f"{type(e).__name__}: {e}")
            result["status"] = "error"
            result["error"] = e

    th = threading.Thread(
        target=_target,
        name=f"voxcpm-load-{voice_id}",
        daemon=True,
    )
    th.start()
    th.join(watchdog_s)
    result["elapsed_ms"] = int((time.monotonic() - started) * 1000)

    if th.is_alive():
        # We intentionally do NOT try to kill the thread. Python has no
        # safe cross-platform thread-kill, and the stuck code is almost
        # certainly in safetensors/torch native — killing from Python
        # would leave CUDA context in a bad state anyway. The supervisor
        # flags phase='failed' and leaves the thread orphaned; process
        # restart is the only clean recovery. faulthandler's periodic
        # dump_traceback_later is still firing, so the stuck thread's
        # stack will be captured in BOOT_DIAG_DIR/faulthandler.<boot>.log
        # — that's the primary evidence for the next root-cause pass.
        _mark_phase("watchdog_expired", voice_id=voice_id,
                    watchdog_s=watchdog_s)
        # One explicit dump right now too, so we don't have to wait up to
        # the full BOOT_FAULT_DUMP_EVERY_S cadence to get a stack trace
        # of the wedged thread.
        try:
            faulthandler.dump_traceback(file=_fault_fp, all_threads=True)
            _fault_fp.flush()
        except Exception:
            pass
        result["status"] = "timeout"
        result["watchdog_s"] = watchdog_s
    return result


def _run_prewarm_supervisor(voice_id: str) -> None:
    """
    Background supervisor. Transitions SERVICE_STATE through
    warming -> ready | failed based on the watchdogged load outcome.
    Called fire-and-forget from the startup event so uvicorn can bind
    the port immediately instead of waiting for a potentially 5+ min
    safetensors load.
    """
    SERVICE_STATE["phase"] = "warming"
    SERVICE_STATE["warming"] = True
    SERVICE_STATE["ready"] = False
    SERVICE_STATE["last_error"] = None
    _heartbeat(f"supervisor-start:{voice_id}")

    outcome = _run_engine_load_watchdogged(voice_id, PREWARM_WATCHDOG_S)

    if outcome["status"] == "ok":
        SERVICE_STATE["phase"] = "ready"
        SERVICE_STATE["ready"] = True
        SERVICE_STATE["warming"] = False
        SERVICE_STATE["last_load_ms"] = outcome["elapsed_ms"]
        SERVICE_STATE["last_error"] = None
        _mark_phase("ready", voice_id=voice_id,
                    elapsed_ms=outcome["elapsed_ms"])
        # Cancel the periodic faulthandler dump — the dangerous window
        # (load call) is over, further periodic stack dumps just bloat
        # the fault log for no incident value.
        try:
            faulthandler.cancel_dump_traceback_later()
        except Exception:
            pass
        log.info(
            f"[boot] prewarm complete voice_id={voice_id} "
            f"elapsed_ms={outcome['elapsed_ms']} engine_count={len(_engine_cache)}"
        )
        return

    if outcome["status"] == "timeout":
        SERVICE_STATE["phase"] = "failed"
        SERVICE_STATE["ready"] = False
        SERVICE_STATE["warming"] = False
        SERVICE_STATE["last_load_ms"] = None
        SERVICE_STATE["last_error"] = (
            f"PREWARM_WATCHDOG_EXPIRED voice_id={voice_id} "
            f"watchdog_s={PREWARM_WATCHDOG_S} elapsed_ms={outcome['elapsed_ms']}"
        )
        log.error(
            f"[boot] PREWARM_WATCHDOG_EXPIRED voice_id={voice_id} "
            f"watchdog_s={PREWARM_WATCHDOG_S} elapsed_ms={outcome['elapsed_ms']} "
            "— load thread still alive, likely stuck in safetensors/AudioVAE. "
            "/health will now report phase=failed; uvicorn is still serving but "
            "will NOT transition to ready without a process restart. "
            f"Capture a py-spy dump BEFORE killing: py-spy dump --pid {os.getpid()}"
        )
        return

    # outcome["status"] == "error"
    err = outcome["error"]
    SERVICE_STATE["phase"] = "failed"
    SERVICE_STATE["ready"] = False
    SERVICE_STATE["warming"] = False
    SERVICE_STATE["last_load_ms"] = outcome["elapsed_ms"]
    SERVICE_STATE["last_error"] = f"{type(err).__name__}: {err}"
    log.error(
        f"[boot] prewarm FAILED voice_id={voice_id} "
        f"elapsed_ms={outcome['elapsed_ms']} error={type(err).__name__}: {err}",
        exc_info=err,
    )


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
    """Log a boot banner + optionally schedule a background prewarm.

    Phase 1B change: the prewarm is now fire-and-forget in a supervisor
    thread. Starlette runs sync startup handlers inline on the event
    loop, so a blocking eng.load() here prevents uvicorn from ever
    binding the listen socket — which is exactly the failure mode the
    2026-04-17 incident exposed (uvicorn never bound :8765, /health
    unreachable, no way for the Node side to distinguish 'still loading'
    from 'dead'). Handing the load to a daemon thread lets the socket
    come up immediately and gives the watchdog a place to fire.
    """
    global _prewarm_thread

    boot_ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    SERVICE_STATE["boot_ts"] = boot_ts
    SERVICE_STATE["prewarm_voice_id"] = PREWARM_VOICE_ID
    log.info(
        f"[boot] pulse-gaming tts_server starting ts={boot_ts} "
        f"device={DEVICE} voices={len(VOICES_MAP)} prewarm_on_boot={PREWARM_ON_BOOT} "
        f"prewarm_voice_id={PREWARM_VOICE_ID} prewarm_watchdog_s={PREWARM_WATCHDOG_S}"
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

    log.info(
        f"[boot] scheduling background prewarm voice_id={PREWARM_VOICE_ID} "
        f"watchdog_s={PREWARM_WATCHDOG_S} — startup returns immediately, "
        "supervisor thread will flip phase to ready|failed"
    )
    SERVICE_STATE["phase"] = "warming"
    SERVICE_STATE["warming"] = True
    SERVICE_STATE["ready"] = False
    with _prewarm_lock:
        _prewarm_thread = threading.Thread(
            target=_run_prewarm_supervisor,
            args=(PREWARM_VOICE_ID,),
            name="voxcpm-prewarm-supervisor",
            daemon=True,
        )
        _prewarm_thread.start()


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
        # Phase 1B additions: watchdog budget + last heartbeat from the
        # supervisor thread. `last_heartbeat_ts` advances while the load
        # is progressing; if it stops advancing while phase='warming',
        # the load is wedged in native code and the watchdog will fire.
        "last_heartbeat_ts": SERVICE_STATE["last_heartbeat_ts"],
        "watchdog_s": SERVICE_STATE["watchdog_s"],
        # Phase 1C forensics. boot_id lets Node callers detect restarts
        # cleanly (pid gets reused across crashes); diag_dir points ops
        # at the breadcrumb + faulthandler artefacts for post-mortem.
        "boot_id": BOOT_ID,
        "pid": BOOT_PID,
        "diag_dir": str(BOOT_DIAG_DIR),
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

    Phase 1B: the load itself runs under the same watchdog as the boot
    prewarm. If the watchdog expires the endpoint returns 504 and
    SERVICE_STATE flips to phase='failed', so Node-side waitForReady
    can stop polling a dead service.

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

    if reused:
        SERVICE_STATE["prewarm_voice_id"] = voice_id
        log.info(
            f"[prewarm] voice_id={voice_id} reused=True engine_count={len(_engine_cache)}"
        )
        return {
            "voice_id": voice_id,
            "loaded_ms": 0,
            "engine_count": len(_engine_cache),
            "reused": True,
        }

    SERVICE_STATE["phase"] = "warming"
    SERVICE_STATE["warming"] = True
    SERVICE_STATE["ready"] = False
    SERVICE_STATE["last_error"] = None
    SERVICE_STATE["prewarm_voice_id"] = voice_id

    outcome = _run_engine_load_watchdogged(voice_id, PREWARM_WATCHDOG_S)

    if outcome["status"] == "timeout":
        SERVICE_STATE["phase"] = "failed"
        SERVICE_STATE["ready"] = False
        SERVICE_STATE["warming"] = False
        SERVICE_STATE["last_load_ms"] = None
        SERVICE_STATE["last_error"] = (
            f"PREWARM_WATCHDOG_EXPIRED voice_id={voice_id} "
            f"watchdog_s={PREWARM_WATCHDOG_S} elapsed_ms={outcome['elapsed_ms']}"
        )
        log.error(
            f"[prewarm] PREWARM_WATCHDOG_EXPIRED voice_id={voice_id} "
            f"watchdog_s={PREWARM_WATCHDOG_S} elapsed_ms={outcome['elapsed_ms']} — "
            "load thread still alive; restart the process and capture "
            f"py-spy dump --pid {os.getpid()} before the next attempt"
        )
        raise HTTPException(
            504,
            f"prewarm watchdog expired after {PREWARM_WATCHDOG_S}s — "
            "load thread stuck, restart the service",
        )

    if outcome["status"] == "error":
        err = outcome["error"]
        SERVICE_STATE["phase"] = "failed"
        SERVICE_STATE["ready"] = False
        SERVICE_STATE["warming"] = False
        SERVICE_STATE["last_load_ms"] = outcome["elapsed_ms"]
        SERVICE_STATE["last_error"] = f"{type(err).__name__}: {err}"
        log.exception(f"[prewarm] failed voice_id={voice_id}", exc_info=err)
        raise HTTPException(500, f"prewarm failed: {err}")

    dt_ms = outcome["elapsed_ms"]
    SERVICE_STATE["phase"] = "ready"
    SERVICE_STATE["ready"] = True
    SERVICE_STATE["warming"] = False
    SERVICE_STATE["last_load_ms"] = dt_ms
    SERVICE_STATE["last_error"] = None
    log.info(
        f"[prewarm] voice_id={voice_id} reused=False elapsed_ms={dt_ms} "
        f"engine_count={len(_engine_cache)}"
    )
    return {
        "voice_id": voice_id,
        "loaded_ms": dt_ms,
        "engine_count": len(_engine_cache),
        "reused": False,
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
