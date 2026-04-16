"""
infer_service.py — the Phase 8 local inference boundary.

Wraps every GPU-dependent step into a kind -> async handler map that the
Node local-worker can reach over HTTP. The goal is a single opinionated
process that owns the GPU: one CUDA context, one model cache, one
ffmpeg binary path. The FastAPI server (server.py) exposes `/v1/infer`
and dispatches to the registry below.

Kinds supported (stub-or-real, see each handler):

    tts             — synthesise narration for arbitrary text (delegates
                      back to the existing /tts path via _synth_text).
    narrate_script  — take a story script payload and return aligned MP3.
                      Used by story_short + teaser_short pipelines.
    compose_short   — stitch narration + image track + overlays via
                      ffmpeg. Returns path to the rendered vertical MP4.
    transcribe      — pull audio, run local Whisper-large, return srt.
                      Stub for now; we haven't adopted local ASR yet.

All handlers are sync-ish (CPU/GPU bound); FastAPI will run each in a
thread pool so one slow render doesn't stall health checks.

Worker contract: each handler receives the request params dict and a
`workspace` Path where it may place output files. It returns a dict
that MUST be JSON-serialisable; large binaries are written to disk
and the path is returned (the worker then uploads to S3 / R2 / cloud).

Idempotency is the caller's job. The handler gets a `job_id` if one
is passed so it can write deterministic output paths.
"""
from __future__ import annotations

import base64
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable, Dict, Optional

log = logging.getLogger("infer_service")

# --- Workspace handling --------------------------------------------------

WORKSPACE_ROOT = Path(os.getenv("INFER_WORKSPACE", tempfile.gettempdir())) / "pulse-infer"
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)


def _job_workspace(job_id: Optional[str]) -> Path:
    """Return a deterministic-ish workspace for this job."""
    key = job_id or f"adhoc-{os.getpid()}"
    d = WORKSPACE_ROOT / key
    d.mkdir(parents=True, exist_ok=True)
    return d


def cleanup_workspace(job_id: str) -> None:
    d = WORKSPACE_ROOT / job_id
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


# --- Handler registry ----------------------------------------------------

HandlerFn = Callable[[Dict[str, Any], Path], Dict[str, Any]]
_handlers: Dict[str, HandlerFn] = {}


def register(kind: str):
    def _wrap(fn: HandlerFn) -> HandlerFn:
        _handlers[kind] = fn
        return fn

    return _wrap


def list_kinds() -> list:
    return sorted(_handlers.keys())


def run(kind: str, params: Dict[str, Any], job_id: Optional[str] = None) -> Dict[str, Any]:
    handler = _handlers.get(kind)
    if handler is None:
        raise KeyError(f"no handler for kind={kind}; known: {list_kinds()}")
    workspace = _job_workspace(job_id)
    log.info(f"[infer] kind={kind} job={job_id} ws={workspace}")
    return handler(params, workspace)


# --- Shared helpers ------------------------------------------------------


def _require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not on PATH; install it or set FFMPEG_BIN")
    return os.getenv("FFMPEG_BIN", exe)


# --- Handlers ------------------------------------------------------------


@register("tts")
def _tts(params: Dict[str, Any], workspace: Path) -> Dict[str, Any]:
    """
    Synthesise narration for `text` and return base64 MP3 + alignment.
    Delegates to the same VoxCPMEngine used by /v1/text-to-speech, so
    this is just a uniform entry point for the worker.
    """
    # Late import so importing this module doesn't eagerly pull in torch.
    from server import _synth, TTSRequest, VoiceSettings  # type: ignore

    text = params.get("text")
    if not text:
        raise ValueError("tts requires params.text")
    voice_id = params.get("voice_id", "__default__")
    settings = VoiceSettings(
        speaking_rate=params.get("speaking_rate", 1.0),
        stability=params.get("stability", 0.5),
        similarity_boost=params.get("similarity_boost", 0.8),
        style=params.get("style", 0.0),
    )
    req = TTSRequest(
        text=text,
        voice_settings=settings,
        output_format=params.get("output_format", "mp3_44100_128"),
        seed=params.get("seed"),
    )
    resp = _synth(voice_id, req)
    return resp.model_dump()


@register("narrate_script")
def _narrate_script(params: Dict[str, Any], workspace: Path) -> Dict[str, Any]:
    """
    Take a hook/body/loop script triple, synthesise each, and write the
    joined MP3 to workspace/narration.mp3. Returns the output path + a
    per-segment alignment for the downstream assembler.
    """
    from server import _synth, TTSRequest, VoiceSettings  # type: ignore

    segments = params.get("segments") or []
    if not segments:
        raise ValueError("narrate_script requires params.segments[]")
    voice_id = params.get("voice_id", "__default__")
    settings = VoiceSettings(speaking_rate=params.get("speaking_rate", 1.0))

    part_paths = []
    manifest = []
    for i, seg in enumerate(segments):
        text = seg.get("text") or ""
        if not text.strip():
            continue
        resp = _synth(voice_id, TTSRequest(text=text, voice_settings=settings))
        part_mp3 = workspace / f"part-{i:03d}.mp3"
        part_mp3.write_bytes(base64.b64decode(resp.audio_base64))
        part_paths.append(part_mp3)
        manifest.append({
            "index": i,
            "label": seg.get("label") or f"seg-{i}",
            "path": str(part_mp3),
        })

    if not part_paths:
        raise ValueError("no non-empty segments to narrate")

    # Concat via ffmpeg concat demuxer
    ffmpeg = _require_ffmpeg()
    list_file = workspace / "concat.txt"
    list_file.write_text("\n".join(f"file '{p.as_posix()}'" for p in part_paths))
    out_mp3 = workspace / "narration.mp3"
    subprocess.run(
        [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-c:a", "libmp3lame", "-b:a", "192k", str(out_mp3)],
        check=True,
        capture_output=True,
    )
    return {
        "narration_path": str(out_mp3),
        "segments": manifest,
    }


@register("compose_short")
def _compose_short(params: Dict[str, Any], workspace: Path) -> Dict[str, Any]:
    """
    Stub for now. The existing assemble.js path handles this in Node
    via ffmpeg; this handler exists so the same job can be claimed by
    the local worker when it's GPU-only (nvenc encode, etc.). Real
    implementation will land in Phase 8.1 once we decide whether the
    compose step stays in Node or moves here.
    """
    return {
        "deferred": True,
        "reason": "compose_short handled by Node assemble.js for now",
        "hints": {
            "switch_to_python_when": "we adopt NVENC + FFmpegFilterComplex",
        },
    }


@register("transcribe")
def _transcribe(params: Dict[str, Any], workspace: Path) -> Dict[str, Any]:
    """Stub — Whisper-large-v3 hookup comes later."""
    audio_path = params.get("audio_path")
    if not audio_path:
        raise ValueError("transcribe requires params.audio_path")
    return {
        "deferred": True,
        "reason": "local ASR not yet wired; route to OpenAI whisper API in the meantime",
        "audio_path": audio_path,
    }
