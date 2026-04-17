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
import time
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
    log.info(f"[infer] kind={kind} job={job_id} ws={workspace} START")
    t0 = time.monotonic()
    try:
        result = handler(params, workspace)
    except Exception as e:
        dt_ms = int((time.monotonic() - t0) * 1000)
        log.exception(
            f"[infer] TIMING kind={kind} job={job_id} phase=total "
            f"elapsed_ms={dt_ms} status=error error={type(e).__name__}"
        )
        raise
    dt_ms = int((time.monotonic() - t0) * 1000)
    log.info(
        f"[infer] TIMING kind={kind} job={job_id} phase=total "
        f"elapsed_ms={dt_ms} status=ok"
    )
    return result


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
    t_synth = time.monotonic()
    for i, seg in enumerate(segments):
        text = seg.get("text") or ""
        if not text.strip():
            continue
        t_seg = time.monotonic()
        resp = _synth(voice_id, TTSRequest(text=text, voice_settings=settings))
        seg_ms = int((time.monotonic() - t_seg) * 1000)
        part_mp3 = workspace / f"part-{i:03d}.mp3"
        part_mp3.write_bytes(base64.b64decode(resp.audio_base64))
        part_paths.append(part_mp3)
        manifest.append({
            "index": i,
            "label": seg.get("label") or f"seg-{i}",
            "path": str(part_mp3),
        })
        log.info(
            f"[narrate_script] TIMING phase=synth seg={i} "
            f"label={seg.get('label') or f'seg-{i}'} elapsed_ms={seg_ms}"
        )
    synth_total_ms = int((time.monotonic() - t_synth) * 1000)

    if not part_paths:
        raise ValueError("no non-empty segments to narrate")

    # Concat via ffmpeg concat demuxer
    ffmpeg = _require_ffmpeg()
    list_file = workspace / "concat.txt"
    list_file.write_text("\n".join(f"file '{p.as_posix()}'" for p in part_paths))
    out_mp3 = workspace / "narration.mp3"
    t_concat = time.monotonic()
    subprocess.run(
        [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-c:a", "libmp3lame", "-b:a", "192k", str(out_mp3)],
        check=True,
        capture_output=True,
    )
    concat_ms = int((time.monotonic() - t_concat) * 1000)
    log.info(
        f"[narrate_script] TIMING phase=concat segs={len(part_paths)} "
        f"synth_total_ms={synth_total_ms} concat_ms={concat_ms} out={out_mp3}"
    )
    return {
        "narration_path": str(out_mp3),
        "segments": manifest,
    }


@register("compose_short")
def _compose_short(params: Dict[str, Any], workspace: Path) -> Dict[str, Any]:
    """
    Compose a 1080x1920 vertical short from a narration MP3 and an
    optional list of visuals. Falls back to a branded colour card when
    no visuals are supplied so the handler always produces a playable
    MP4 — better than failing on missing inputs.

    Required params:
        narration_path: absolute path to the narration MP3
        kind:           teaser_short | story_short (drives the filename
                        and the on-card label)

    Optional params:
        images:         list[str] — absolute image paths for Ken Burns
                        (if empty, we synth a branded card)
        channel:        channel id for colour accents (default pulse-gaming)
        title:          overlay text on the card (default falls back to
                        kind-appropriate copy)

    Returns: { output_path: "/abs/<kind>.mp4", duration_s: float }

    Note: deliberately uses libx264 (not NVENC) so this works on any
    host the inference server runs on. When the local GPU worker
    settles on a fixed NVIDIA box we can add a `use_nvenc` switch.
    """
    narration_path = params.get("narration_path")
    if not narration_path:
        raise ValueError("compose_short requires params.narration_path")
    np_path = Path(narration_path)
    if not np_path.exists():
        raise ValueError(f"narration not found at {narration_path}")

    kind = params.get("kind") or "short"
    channel = params.get("channel") or "pulse-gaming"
    images = [p for p in (params.get("images") or []) if Path(p).exists()]
    ffmpeg = _require_ffmpeg()

    # --- Probe narration duration so the card loop matches ------------
    try:
        dur_out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(np_path)],
            check=True, capture_output=True, text=True,
        )
        duration = float(dur_out.stdout.strip() or "0") or 40.0
    except Exception:
        duration = 40.0

    # Cap to reasonable shorts length (YouTube Shorts is <= 60s, teaser
    # targets ~45s). Pad by 0.5s so the outro card has room to breathe.
    total = min(max(duration, 5.0), 90.0) + 0.5

    # --- Per-channel accent colour for the card ------------------------
    accents = {
        "pulse-gaming": "0x0D0D0F:c1=0xFF6B1A",
        "stacked": "0x0A0A0C:c1=0x00C853",
        "the-signal": "0x0F0B1A:c1=0xA855F7",
    }
    bg_color, accent_dir = accents.get(channel, accents["pulse-gaming"]).split(":")
    accent = accent_dir.split("=", 1)[1] if "=" in accent_dir else "0xFF6B1A"

    # --- Label + title text -------------------------------------------
    title = params.get("title")
    if not title:
        title = "WEEKLY ROUNDUP" if kind == "teaser_short" else "BREAKING"
    # Sanitise for ffmpeg drawtext: strip quotes, colons and non-ASCII
    safe_title = "".join(c for c in str(title)
                         if 0x20 <= ord(c) < 0x7F and c not in ("'", ":", ";", "\\"))[:60]
    kind_label = kind.replace("_", " ").upper()

    out_path = workspace / f"{kind}.mp4"

    # --- Build filter graph -------------------------------------------
    # Two possible input shapes:
    #   (a) No images -> one `color` source, branded drawtext overlay
    #   (b) Images    -> Ken Burns on each, concat, drawtext overlay
    inputs = []
    filters = []

    # Platform-agnostic font hint. drawtext falls back to libass's
    # default if no font= is supplied, which is fine on Linux workers.
    font_hint = ""
    # Windows bundled Arial path (works when the server runs on Windows)
    win_font = "C\\:/Windows/Fonts/arial.ttf"
    if os.name == "nt" and Path("C:/Windows/Fonts/arial.ttf").exists():
        font_hint = f":fontfile='{win_font}'"

    if not images:
        inputs.extend(["-f", "lavfi", "-t", f"{total:.2f}",
                       "-i", f"color=c={bg_color}:s=1080x1920:r=30"])
        # drawbox wants `iw`/`ih` for input frame dimensions — `w`/`h` is
        # the box itself in current ffmpeg. drawtext still uses `w`/`h`
        # for the frame and `tw`/`th` for the text metrics, which is
        # the other way round — convention varies by filter.
        filters.append(
            f"[0:v]"
            f"drawbox=x=0:y=ih/2-2:w=iw:h=4:color={accent}@0.8:t=fill,"
            f"drawtext=text='{kind_label}'{font_hint}:fontcolor=0x{accent[2:]}:fontsize=56:"
            f"x=(w-tw)/2:y=(h-th)/2-120,"
            f"drawtext=text='{safe_title}'{font_hint}:fontcolor=0xF0F0F0:fontsize=72:"
            f"x=(w-tw)/2:y=(h-th)/2-20,"
            f"drawtext=text='{channel.upper()}'{font_hint}:fontcolor=0xF0F0F0@0.7:fontsize=38:"
            f"x=(w-tw)/2:y=(h-th)/2+90[v]"
        )
    else:
        per = max(2.5, total / len(images))
        kb_labels = []
        for i, img in enumerate(images):
            inputs.extend(["-loop", "1", "-t", f"{per:.2f}", "-i", str(img)])
            zoom = ("z=min(zoom+0.0008\\,1.12)"
                    if i % 2 == 0
                    else "z=if(eq(on\\,1)\\,1.12\\,max(zoom-0.0008\\,1.0))")
            frames = int(per * 30)
            filters.append(
                f"[{i}:v]scale=1080:1920:force_original_aspect_ratio=increase,"
                f"crop=1080:1920,zoompan={zoom}:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):"
                f"d={frames}:s=1080x1920:fps=30,format=yuv420p,setsar=1[kb{i}]"
            )
            kb_labels.append(f"kb{i}")
        filters.append(
            "".join(f"[{l}]" for l in kb_labels)
            + f"concat=n={len(kb_labels)}:v=1:a=0[bg]"
        )
        filters.append(
            f"[bg]drawtext=text='{kind_label}'{font_hint}:fontcolor=0x{accent[2:]}:fontsize=44:"
            f"box=1:boxcolor=0x0D0D0F@0.6:boxborderw=16:x=40:y=80,"
            f"drawtext=text='{safe_title}'{font_hint}:fontcolor=0xF0F0F0:fontsize=56:"
            f"box=1:boxcolor=0x0D0D0F@0.5:boxborderw=14:x=(w-tw)/2:y=h-260[v]"
        )

    # Narration input index (last)
    audio_idx = len(images) if images else 1
    inputs.extend(["-i", str(np_path)])

    filter_graph = ";".join(filters)

    cmd = [ffmpeg, "-y", *inputs,
           "-filter_complex", filter_graph,
           "-map", "[v]", "-map", f"{audio_idx}:a",
           "-c:v", "libx264", "-preset", "medium", "-crf", "22",
           "-c:a", "aac", "-b:a", "192k",
           "-r", "30", "-shortest",
           "-movflags", "+faststart",
           str(out_path)]

    log.info(f"[compose_short] rendering kind={kind} duration={total:.1f}s "
             f"images={len(images)} -> {out_path}")
    t_render = time.monotonic()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    render_ms = int((time.monotonic() - t_render) * 1000)
    if proc.returncode != 0:
        # Log the filter graph + full ffmpeg stderr so the caller can
        # diagnose drawtext / path / codec issues. The returned tail is
        # short so the Node side doesn't have to deal with a giant blob.
        log.error(f"[compose_short] filter graph:\n{filter_graph}")
        log.error(f"[compose_short] ffmpeg stderr:\n{proc.stderr}")
        log.error(
            f"[compose_short] TIMING phase=render kind={kind} "
            f"elapsed_ms={render_ms} status=error rc={proc.returncode}"
        )
        tail = (proc.stderr or "")[-600:]
        raise RuntimeError(f"ffmpeg failed (rc={proc.returncode}): {tail}")
    log.info(
        f"[compose_short] TIMING phase=render kind={kind} "
        f"elapsed_ms={render_ms} status=ok out={out_path}"
    )

    return {
        "output_path": str(out_path),
        "duration_s": round(total, 2),
        "kind": kind,
        "source": "compose_short/ffmpeg-libx264",
        "render_ms": render_ms,
    }


@register("transcribe")
def _transcribe(params: Dict[str, Any], workspace: Path) -> Dict[str, Any]:
    """
    Run local Whisper via faster-whisper. Returns the full transcript
    plus segment-level timestamps, and writes an .srt alongside the
    source audio for downstream subtitle workflows.

    Required params:
        audio_path: absolute path to an audio file (mp3/wav/m4a etc.)

    Optional params:
        model_size: tiny | base | small | medium | large-v3 (default base)
        language:   ISO-639-1 hint (default: auto-detect)
        beam_size:  decoding beam width (default 5)

    If faster-whisper isn't installed, returns { deferred: true } with
    an install hint so the job can be retried against the cloud API.
    """
    audio_path = params.get("audio_path")
    if not audio_path:
        raise ValueError("transcribe requires params.audio_path")
    ap = Path(audio_path)
    if not ap.exists():
        raise ValueError(f"audio not found at {audio_path}")

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        return {
            "deferred": True,
            "reason": "faster-whisper not installed in this venv",
            "install_hint": "pip install faster-whisper",
            "audio_path": str(ap),
        }

    model_size = params.get("model_size") or "base"
    language = params.get("language")
    beam_size = int(params.get("beam_size") or 5)
    # Default to CPU so we don't blow up on hosts without cuDNN installed.
    # The production GPU box can opt into CUDA via WHISPER_DEVICE=cuda.
    device = os.getenv("WHISPER_DEVICE", "cpu")
    compute_type = os.getenv(
        "WHISPER_COMPUTE_TYPE",
        "int8" if device == "cpu" else "default",
    )

    log.info(f"[transcribe] model={model_size} device={device} compute={compute_type} audio={ap}")
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
    except Exception as e:
        # Fall back to CPU if CUDA init failed (missing cuDNN, OOM, etc.)
        if device != "cpu":
            log.warning(f"[transcribe] {device} failed ({e}); falling back to CPU")
            device = "cpu"
            compute_type = "int8"
            model = WhisperModel(model_size, device=device, compute_type=compute_type)
        else:
            raise

    seg_iter, info = model.transcribe(
        str(ap),
        language=language,
        beam_size=beam_size,
        vad_filter=True,
    )
    segments = []
    for seg in seg_iter:
        segments.append({
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
        })

    # Write an SRT alongside the workspace for downstream pipelines.
    srt_path = workspace / f"{ap.stem}.srt"
    with srt_path.open("w", encoding="utf-8") as fh:
        for i, seg in enumerate(segments, start=1):
            fh.write(f"{i}\n{_srt_ts(seg['start'])} --> {_srt_ts(seg['end'])}\n{seg['text']}\n\n")

    return {
        "transcript": " ".join(s["text"] for s in segments).strip(),
        "segments": segments,
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration_s": round(info.duration, 2),
        "srt_path": str(srt_path),
        "model_size": model_size,
        "source": "transcribe/faster-whisper",
    }


def _srt_ts(t: float) -> str:
    """Format seconds as an SRT timestamp (HH:MM:SS,mmm)."""
    if t < 0:
        t = 0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
