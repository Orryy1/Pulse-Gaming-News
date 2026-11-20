"""Picture checks on the Mac itself (MAC_VISION, 12 Nov 2026): a small local vision model on Apple silicon through
MLX, answering the same Ollama calls the factory makes to the PC's relay (src/assets/localvision.ts), so the frame
screen keeps working when the PC is off or its relay is down.

The model is Qwen3.5 (Apache 2.0, from Qwen's own Hugging Face page), quantised to 4-bit MLX on this Mac with
mlx_vlm.convert (see mac/migrate.sh prepare). The Mac's 16 GB is shared with 4K renders, so the model is never
resident by default:
  - the front (this process, standard library only, a few MB) answers /api/tags and /health at once;
  - the first picture starts a worker through ~/orch/macrun.sh, the Mac's turn-taking: it waits while a Pulse render
    runs or memory is short, and runs one job at a time at background priority;
  - the worker unloads (exits) after MAC_VISION_IDLE_SEC without a picture, at once when a Pulse render starts, and
    when the factory unloads vision before its own render (POST /api/generate with keep_alive 0).
A picture that arrives while the worker waits for its turn gets 503: the factory treats that as "not judged".

  POST /api/chat       Ollama chat body (messages[-1].content + images, format, options) -> {"message": {...}}
  POST /api/generate   {"keep_alive": 0} unloads the model; anything else 404
  GET  /api/tags       {"models": [{"name"}]}, never loads the model
  GET  /health         {"status", "worker": "off" | "waiting" | "ready", "model"}

Run: ~/PulseFactory/macvision/venv/bin/python ~/PulseFactory/factory/mac/vision_server.py
"""
import base64
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser("~")
MODEL = os.environ.get("MAC_VISION_MODEL", f"{HOME}/PulseFactory/macvision/models/qwen3.5-4b-4bit")
PORT = int(os.environ.get("MAC_VISION_PORT", "8878"))
WORKER_PORT = int(os.environ.get("MAC_VISION_WORKER_PORT", "8879"))
IDLE_SEC = int(os.environ.get("MAC_VISION_IDLE_SEC", "300"))
TURN_WAIT_SEC = int(os.environ.get("MAC_VISION_TURN_WAIT_SEC", "45"))
MACRUN = os.environ.get("MACRUN", f"{HOME}/orch/macrun.sh")
# The longest side a frame is shrunk to before the model sees it: enough to read writing and spot a webcam box,
# and four times fewer picture tokens than a 1280-wide frame.
MAX_SIDE = int(os.environ.get("MAC_VISION_MAX_SIDE", "768"))
NAME = os.path.basename(MODEL.rstrip("/"))


def json_hint(schema):
    """The answer's shape in words: the model has no grammar-constrained output, so it is asked plainly."""
    props = (schema or {}).get("properties") or {}
    if not props:
        return ""
    keys = ", ".join(f'"{k}" ({v.get("type", "value")})' for k, v in props.items())
    return f"\n\nReply with only one JSON object and nothing else, with exactly these keys: {keys}."


def bar_share(img):
    """The share of the picture under black bars, top and bottom plus left and right, measured from the pixels."""
    g = img.convert("L").resize((160, 90))
    px = g.load()
    dark_row = lambda y: sum(px[x, y] for x in range(160)) / 160 < 16
    dark_col = lambda x: sum(px[x, y] for y in range(90)) / 90 < 16
    top = next((y for y in range(90) if not dark_row(y)), 90)
    bottom = next((y for y in range(90) if not dark_row(89 - y)), 90)
    left = next((x for x in range(160) if not dark_col(x)), 160)
    right = next((x for x in range(160) if not dark_col(159 - x)), 160)
    rows = min(90, top + bottom) / 90
    cols = min(160, left + right) / 160
    return rows + cols - rows * cols


def measured(content, schema, share):
    """The model's answer with "letterbox" measured instead of guessed. The small model calls any bar a letterbox
    (all five thin-barred GTA VI trailer frames on 12 Nov 2026), and bars are a matter of pixels, not judgement."""
    if share is None or "letterbox" not in ((schema or {}).get("properties") or {}):
        return content
    try:
        start, end = content.index("{"), content.rindex("}") + 1
        answer = json.loads(content[start:end])
    except ValueError:
        return content
    answer["letterbox"] = share > 1 / 3
    return json.dumps(answer)


def pulse_rendering():
    return subprocess.run(["pgrep", "-f", "remotion|chrome-headless-shell"], capture_output=True).returncode == 0


# ---------------------------------------------------------------- worker: holds the model, started by macrun.sh


def worker():
    from PIL import Image
    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template
    from mlx_vlm.utils import load_config

    model, processor = load(MODEL)
    config = load_config(MODEL)
    lock = threading.Lock()
    last = [time.time()]

    def answer(body):
        msg = (body.get("messages") or [{}])[-1]
        opts = body.get("options") or {}
        files = []
        share = None
        try:
            for b64 in msg.get("images") or []:
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                    f.write(base64.b64decode(b64))
                img = Image.open(f.name).convert("RGB")
                share = bar_share(img) if share is None else share
                img.thumbnail((MAX_SIDE, MAX_SIDE))
                img.save(f.name, quality=92)
                files.append(f.name)
            prompt = (msg.get("content") or "") + json_hint(body.get("format"))
            text = apply_chat_template(processor, config, prompt, num_images=len(files), enable_thinking=False)
            started = time.time()
            out = generate(
                model,
                processor,
                text,
                image=files or None,
                max_tokens=min(int(opts.get("num_predict", 300)), 400),
                temperature=float(opts.get("temperature", 0)),
                verbose=False,
            )
            content = measured(str(getattr(out, "text", out)).strip(), body.get("format"), share)
            return {
                "model": NAME,
                "message": {"role": "assistant", "content": content},
                "done": True,
                "total_duration": int((time.time() - started) * 1e9),
            }
        finally:
            for p in files:
                os.unlink(p)

    class Worker(BaseHTTPRequestHandler):
        def _send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._send(200, {"status": "ready", "model": NAME})

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            if self.path == "/quit":
                self._send(200, {"status": "bye"})
                threading.Thread(target=lambda: (time.sleep(0.2), os._exit(0))).start()
                return
            with lock:  # one picture at a time: the GPU is shared with everything else on the Mac
                try:
                    self._send(200, answer(json.loads(body or b"{}")))
                except Exception as e:  # a bad picture must not take the worker down
                    self._send(500, {"error": str(e)[:300]})
                finally:
                    last[0] = time.time()

        def log_message(self, *args):
            pass

    def watchdog():
        while True:
            time.sleep(10)
            if lock.locked():
                continue
            if time.time() - last[0] > IDLE_SEC or pulse_rendering():
                os._exit(0)  # macrun.sh releases the turn when this exits

    threading.Thread(target=watchdog, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", WORKER_PORT), Worker).serve_forever()


# ---------------------------------------------------------------- front: tiny, always on


class Front:
    def __init__(self):
        self.proc = None
        self.mu = threading.Lock()

    def worker_ready(self):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{WORKER_PORT}/", timeout=2) as r:
                return r.status == 200
        except Exception:
            return False

    def state(self):
        if self.worker_ready():
            return "ready"
        return "waiting" if self.proc and self.proc.poll() is None else "off"

    def ensure(self):
        """Starts the worker through macrun.sh if it is not running; True once it answers."""
        with self.mu:
            if self.worker_ready():
                return True
            if not (self.proc and self.proc.poll() is None):
                env = dict(os.environ, MACRUN_WAIT_MIN=os.environ.get("MAC_VISION_MACRUN_WAIT_MIN", "30"))
                self.proc = subprocess.Popen(
                    [MACRUN, "macvision", sys.executable, os.path.abspath(__file__), "--worker"],
                    env=env,
                    start_new_session=True,  # its own group, so stop() reaches exactly what this started
                    stdout=subprocess.DEVNULL,
                    stderr=open(f"{HOME}/PulseFactory/logs/macvision-worker.log", "ab"),
                )
        deadline = time.time() + TURN_WAIT_SEC
        while time.time() < deadline:
            if self.worker_ready():
                return True
            if self.proc.poll() is not None:  # macrun gave up (no turn) or the model failed to load
                return False
            time.sleep(0.5)
        return False

    def stop(self):
        with self.mu:
            try:
                urllib.request.urlopen(
                    urllib.request.Request(f"http://127.0.0.1:{WORKER_PORT}/quit", data=b"{}", method="POST"),
                    timeout=3,
                ).read()
            except Exception:
                pass
            if self.proc and self.proc.poll() is None:
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(self.proc.pid, signal.SIGTERM)  # only the group this process started
            self.proc = None


front = Front()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/tags":
            self._send(200, {"models": [{"name": NAME, "model": NAME}]})
        elif self.path == "/health":
            self._send(200, {"status": "ok", "engine": "mlx-vlm", "model": NAME, "worker": front.state()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", "0")))
        if self.path == "/api/generate":
            req = json.loads(body or b"{}")
            if req.get("keep_alive") in (0, "0", "0s"):
                front.stop()
                return self._send(200, {"model": NAME, "done": True, "done_reason": "unload"})
            return self._send(404, {"error": "only unload is served here"})
        if self.path != "/api/chat":
            return self._send(404, {"error": "not found"})
        if not front.ensure():
            return self._send(503, {"error": "waiting for a turn on the Mac (render running or memory short)"})
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{WORKER_PORT}/chat",
                data=body,
                headers={"content-type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=170) as r:
                self._send(r.status, json.loads(r.read()))
        except urllib.error.HTTPError as e:
            self._send(e.code, {"error": e.read().decode(errors="replace")[:300]})
        except Exception as e:
            self._send(502, {"error": str(e)[:300]})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    if "--worker" in sys.argv:
        worker()
    else:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
