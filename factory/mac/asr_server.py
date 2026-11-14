"""Speech check for the Mac: the same /transcribe the factory calls on the PC (src/assets/talk.ts), on
Apple silicon through MLX Whisper. It only has to count spoken words in a few seconds of game audio,
so the small English model is plenty and leaves the Mac's memory for renders.

POST /transcribe  (WAV body) -> {"words": [...], "text": "..."} or 409 while busy; GET /health.
Run: ~/PulseFactory/asr/bin/python ~/PulseFactory/factory/mac/asr_server.py
"""
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import mlx_whisper

MODEL = os.environ.get("ASR_MODEL", "mlx-community/whisper-small.en-mlx")
PORT = int(os.environ.get("ASR_PORT", "8877"))
busy = threading.Lock()


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
            self._send(200, {"status": "ok", "engine": "mlx-whisper", "model": MODEL, "active_requests": int(busy.locked())})
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
            busy.release()

    def log_message(self, *args) -> None:
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
