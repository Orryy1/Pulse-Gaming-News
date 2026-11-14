"""Speech check for the Mac: the same /transcribe the factory calls on the PC (src/assets/talk.ts), on
Apple silicon through MLX Whisper. It only has to count spoken words in a few seconds of game audio,
so the small English model is plenty and leaves the Mac's memory for renders.

POST /transcribe  (WAV body) -> {"words": [...], "text": "..."} or 409 while busy; GET /health.
Run: ~/PulseFactory/asr/bin/python ~/PulseFactory/factory/mac/asr_server.py

ASR_IDLE_SEC (upgrade queue item 24, 0 = off): once loaded, MLX keeps the model and its buffer cache in GPU memory
for good (3.5 GB of footprint measured idle on 14 Nov 2026, during renders). With ASR_IDLE_SEC above 0 the buffer
cache is freed after every job, and the model is dropped after that many seconds without one; the next job loads
it again (a few seconds). Read from the environment, else from the factory's .env beside this folder.
"""
import gc
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import mlx.core as mx
import mlx_whisper
from mlx_whisper.transcribe import ModelHolder

MODEL = os.environ.get("ASR_MODEL", "mlx-community/whisper-small.en-mlx")
PORT = int(os.environ.get("ASR_PORT", "8877"))
busy = threading.Lock()


def env_setting(name: str, default: str) -> str:
    if name in os.environ:
        return os.environ[name]
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    try:
        with open(env, encoding="utf-8") as f:
            for line in f:
                key, sep, value = line.strip().partition("=")
                if sep and key.strip() == name:
                    return value.strip().strip('"').strip("'")
    except OSError:
        pass
    return default


IDLE_SEC = max(0, int(env_setting("ASR_IDLE_SEC", "0") or "0"))
last_job = [time.time()]


def free_cache() -> None:
    gc.collect()
    mx.clear_cache()


def unload() -> bool:
    """Drops the model and frees MLX's memory; False when there was nothing loaded."""
    if ModelHolder.model is None:
        return False
    ModelHolder.model = None
    ModelHolder.model_path = None
    free_cache()
    return True


def idle_watch() -> None:
    while True:
        time.sleep(min(30, max(1, IDLE_SEC // 4)))
        if ModelHolder.model is None or time.time() - last_job[0] < IDLE_SEC:
            continue
        if busy.acquire(blocking=False):  # never while a job runs
            try:
                if unload():
                    print(f"asr: model unloaded after {IDLE_SEC} s idle", flush=True)
            finally:
                busy.release()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"status": "ok", "engine": "mlx-whisper", "model": MODEL, "active_requests": int(busy.locked()),
                             "loaded": ModelHolder.model is not None, "idle_sec": IDLE_SEC})
        else:
            self._send(404, {"detail": "not found"})

    def do_POST(self) -> None:
        if self.path != "/transcribe":
            return self._send(404, {"detail": "not found"})
        # One job at a time, like the PC service: the caller waits and retries on 409.
        if not busy.acquire(blocking=False):
            return self._send(409, {"detail": "busy"})
        try:
            audio = self.rfile.read(int(self.headers.get("content-length", "0")))
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(audio)
                path = f.name
            try:
                text = mlx_whisper.transcribe(path, path_or_hf_repo=MODEL).get("text", "").strip()
            finally:
                os.unlink(path)
            words = text.split()
            if not words:
                return self._send(422, {"detail": "production_asr_transcript_empty"})
            self._send(200, {"words": words, "text": text})
        except Exception as e:  # a bad clip must not take the service down
            self._send(500, {"detail": str(e)[:300]})
        finally:
            last_job[0] = time.time()
            if IDLE_SEC:
                free_cache()
            busy.release()

    def log_message(self, *args) -> None:
        pass


if __name__ == "__main__":
    if IDLE_SEC:
        threading.Thread(target=idle_watch, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
