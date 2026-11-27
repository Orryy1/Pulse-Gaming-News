"""Concept sketches on the Mac mini: FLUX.2 klein 4B (Apache 2.0; docs/licences/flux2-klein-4b.md) through
diffusers on Apple silicon (MPS), so documentaries get their pencil-and-ink ILLUSTRATION sketches
(src/assets/illustrate.ts) without the PC's GPU. The factory calls it with ILLUSTRATE_URL=http://127.0.0.1:8798.

GET  /health -> {"ok": true, "model": ..., "licence": "apache-2.0", "busy": false}; 503 when the weights are missing,
     so the factory skips sketches for that video instead of failing each one.
POST /draw   {"prompt", "seed", "width", "height", "steps", "deadline_s"} -> image/png; 409 while another sketch
     is being drawn, 504 when it ran past deadline_s (the job is stopped between steps, never left running).

Memory: the Mac has 16 GB shared with renders. The text encoder (Qwen3 4B, about 8 GB in bf16) and the transformer
(about 7.7 GB) are never in memory together: each job loads the encoder, turns the prompt into embeddings, frees it,
then loads the transformer, runs the four steps, frees it before the (tiled) VAE decode, and frees the rest, unless
SKETCH_KEEP_SEC keeps the transformer and VAE for that long after a job (then the next job's encoder sits beside them:
only for a Mac with memory to spare). Only the encoder layers the pipeline reads (up to 27 of 36) are built and read.
Measured on 20 Nov 2026 (M4, 16 GB, weights on the external drive): 85 to 94 s a 1280x720 sketch, about 45 s of it
loading weights, with the service's footprint peaking near 10 GB. A job that holds the lock past STUCK_SEC makes the
service exit so launchd starts a fresh one.

Run: ~/PulseFactory/sketch/venv/bin/python ~/PulseFactory/factory/mac/sketch_server.py (mac/sketch.sh installs it
as the launchd service com.pulse.sketch). Settings come from the environment, else the factory's .env beside this
folder: SKETCH_PORT (8798), SKETCH_MODEL_DIR, SKETCH_KEEP_SEC (0).
"""
import gc
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


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


PORT = int(env_setting("SKETCH_PORT", "8798"))
MODEL_DIR = env_setting("SKETCH_MODEL_DIR", "/Volumes/Storage/pulse-sketch/FLUX.2-klein-4B")
KEEP_SEC = max(0, int(env_setting("SKETCH_KEEP_SEC", "0") or "0"))
MODEL = "FLUX.2-klein-4B"
LICENCE = "apache-2.0"
TEXT_LAYERS = (9, 18, 27)  # what Flux2KleinPipeline reads from the encoder's hidden states
MAX_SIDE = 1536
busy = threading.Lock()
state = {"transformer": None, "vae": None, "last": 0.0, "started": 0.0, "jobs": 0}

import torch  # noqa: E402  (after the settings so a bad .env fails fast and cheaply)

DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
DTYPE = torch.bfloat16


class Late(Exception):
    pass


STUCK_SEC = 900  # a job holding the lock this long is wedged (say a file read that never returns): health says so
readable = {"ok": None, "why": "", "thread": None}


def probe_read() -> None:
    """Reads a few bytes of the weights once, in a thread: a launchd service may see the files but be refused (or
    left hanging) when it opens them, because macOS asks before a background process reads a removable volume.
    Found 20 Nov 2026: bash got "Operation not permitted" and Python blocked in open() for good."""
    def attempt() -> None:
        try:
            with open(os.path.join(MODEL_DIR, "model_index.json"), "rb") as f:
                f.read(64)
            readable.update(ok=True, why="")
        except OSError as err:
            readable.update(ok=False, why=f"cannot read the weights: {err}")
    old = readable.get("thread")
    if old is not None and old.is_alive():  # a read still hanging: no second one beside it
        return
    t = threading.Thread(target=attempt, daemon=True)
    readable["thread"] = t
    t.start()
    t.join(3)
    if t.is_alive():
        readable.update(ok=False, why="reading the weights hangs (macOS has not allowed this service to read the drive)")


def weights_ok() -> bool:
    need = ["model_index.json", "transformer/config.json", "text_encoder/config.json", "vae/config.json", "tokenizer/tokenizer.json"]
    if not all(os.path.exists(os.path.join(MODEL_DIR, n)) for n in need):
        readable.update(ok=False, why=f"weights missing in {MODEL_DIR}")
        return False
    if readable["ok"] is not True:
        probe_read()
    return readable["ok"] is True


def free() -> None:
    gc.collect()
    if DEVICE == "mps":
        torch.mps.empty_cache()


def drop_models() -> None:
    state["transformer"] = None
    state["vae"] = None
    free()


def embed(prompt: str, deadline: float):
    """The prompt as the transformer's conditioning, with the encoder loaded only for this and cut to the layers read."""
    from transformers import AutoConfig, AutoTokenizer, Qwen3ForCausalLM
    from diffusers import Flux2KleinPipeline

    tok = AutoTokenizer.from_pretrained(os.path.join(MODEL_DIR, "tokenizer"))
    # hidden_states[k] is the input to layer k, but the last entry is the final norm's output instead, so one layer
    # past the deepest one read is built and the later layers' weights are never read from disk (the embeddings were
    # checked identical to the full encoder's on 20 Nov 2026: max difference 0.0).
    cfg = AutoConfig.from_pretrained(os.path.join(MODEL_DIR, "text_encoder"))
    cfg.num_hidden_layers = max(TEXT_LAYERS) + 1
    if getattr(cfg, "layer_types", None):
        cfg.layer_types = cfg.layer_types[: cfg.num_hidden_layers]
    enc = Qwen3ForCausalLM.from_pretrained(
        os.path.join(MODEL_DIR, "text_encoder"), config=cfg, torch_dtype=DTYPE, device_map=DEVICE
    )
    if time.time() > deadline:
        raise Late("past the deadline while loading the text encoder")
    with torch.no_grad():
        emb = Flux2KleinPipeline._get_qwen3_prompt_embeds(
            enc, tok, prompt, dtype=DTYPE, device=DEVICE, max_sequence_length=512, hidden_states_layers=TEXT_LAYERS
        )
    emb = emb.detach().clone()
    del enc
    free()
    return emb


def draw(prompt: str, seed: int, width: int, height: int, steps: int, deadline: float) -> bytes:
    from diffusers import AutoencoderKLFlux2, FlowMatchEulerDiscreteScheduler, Flux2KleinPipeline, Flux2Transformer2DModel

    emb = embed(prompt, deadline)
    if state["transformer"] is None:
        state["transformer"] = Flux2Transformer2DModel.from_pretrained(
            os.path.join(MODEL_DIR, "transformer"), torch_dtype=DTYPE, device_map=DEVICE
        )
        state["vae"] = AutoencoderKLFlux2.from_pretrained(os.path.join(MODEL_DIR, "vae"), torch_dtype=DTYPE).to(DEVICE)
        state["vae"].enable_tiling()  # the decode at 1280x720 took 6 GB untiled, about 3 GB tiled
    if time.time() > deadline:
        raise Late("past the deadline while loading the transformer")
    pipe = Flux2KleinPipeline(
        scheduler=FlowMatchEulerDiscreteScheduler.from_pretrained(os.path.join(MODEL_DIR, "scheduler")),
        vae=state["vae"],
        text_encoder=None,
        tokenizer=None,
        transformer=state["transformer"],
        is_distilled=True,
    )

    def on_step(_pipe, _i, _t, kwargs):
        if time.time() > deadline:
            raise Late("past the deadline between steps")
        return kwargs

    gen = torch.Generator(device="cpu").manual_seed(int(seed))
    with torch.no_grad():
        latents = pipe(
            prompt_embeds=emb,
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=1.0,
            generator=gen,
            callback_on_step_end=on_step,
            output_type="latent",
        ).images
        vae, processor = state["vae"], pipe.image_processor
        del pipe, emb
        # The transformer goes before the decode, so the two never add up (peak about 9.7 GB instead of 14.6).
        if KEEP_SEC == 0:
            state["transformer"] = None
            free()
        img = processor.postprocess(vae.decode(latents.to(DEVICE), return_dict=False)[0], output_type="pil")[0]
    del latents
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def watchdog() -> None:
    """A job past STUCK_SEC is wedged (a read that never returns holds the lock for good): exit, and launchd's
    KeepAlive starts a fresh service, instead of answering 409 to every sketch until someone restarts it."""
    while True:
        time.sleep(30)
        if busy.locked() and time.time() - state["started"] > STUCK_SEC:
            print(f"sketch: one job has held the model for over {STUCK_SEC} s; restarting", flush=True)
            os._exit(1)


def keeper() -> None:
    while True:
        time.sleep(15)
        if state["transformer"] is None or time.time() - state["last"] < KEEP_SEC:
            continue
        if busy.acquire(blocking=False):
            try:
                drop_models()
                print("sketch: models unloaded while idle", flush=True)
            finally:
                busy.release()


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args) -> None:  # one line per sketch is printed instead
        pass

    def do_GET(self) -> None:
        if self.path.rstrip("/") != "/health":
            return self._json(404, {"error": "not found"})
        ok = weights_ok()
        why = readable["why"]
        if ok and busy.locked() and time.time() - state["started"] > STUCK_SEC:
            ok, why = False, f"one sketch has held the model for over {STUCK_SEC} s"
        self._json(
            200 if ok else 503,
            {"ok": ok, "error": why, "model": MODEL, "licence": LICENCE, "device": DEVICE, "busy": busy.locked(),
             "jobs": state["jobs"], "loaded": state["transformer"] is not None, "model_dir": MODEL_DIR},
        )

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/draw":
            return self._json(404, {"error": "not found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            prompt = str(req["prompt"]).strip()
            seed = int(req.get("seed", 0)) & 0x7FFFFFFF
            width = int(req.get("width", 1280))
            height = int(req.get("height", 720))
            steps = max(1, min(int(req.get("steps", 4)), 12))
            budget = max(5.0, min(float(req.get("deadline_s", 170)), 600.0))  # well under STUCK_SEC
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as err:
            return self._json(400, {"error": f"bad request: {err}"})
        if not prompt or width % 16 or height % 16 or not (256 <= width <= MAX_SIDE and 256 <= height <= MAX_SIDE):
            return self._json(400, {"error": "a prompt and a size of 256 to 1536, in steps of 16, are needed"})
        if not weights_ok():
            return self._json(503, {"error": readable["why"]})
        if not busy.acquire(blocking=False):
            return self._json(409, {"error": "busy with another sketch"})
        t0 = time.time()
        state["started"] = t0
        try:
            png = draw(prompt, seed, width, height, steps, t0 + budget)
        except Late as err:
            drop_models()
            print(f"sketch: stopped after {time.time() - t0:.1f}s ({err})", flush=True)
            return self._json(504, {"error": str(err)})
        except Exception as err:  # noqa: BLE001  (any model failure is one failed sketch, never a dead service)
            drop_models()
            print(f"sketch: failed after {time.time() - t0:.1f}s: {err}", flush=True)
            return self._json(500, {"error": str(err)[:300]})
        finally:
            state["last"] = time.time()
            state["jobs"] += 1
            if KEEP_SEC == 0:
                drop_models()
            else:
                free()  # after a failure the traceback that held the tensors is gone by now
            busy.release()
        secs = time.time() - t0
        print(f"sketch: {width}x{height} {steps} steps seed {seed} in {secs:.1f}s", flush=True)
        self.send_response(200)
        self.send_header("content-type", "image/png")
        self.send_header("content-length", str(len(png)))
        self.send_header("x-sketch-seconds", f"{secs:.1f}")
        self.end_headers()
        self.wfile.write(png)


if __name__ == "__main__":
    threading.Thread(target=watchdog, daemon=True).start()
    if KEEP_SEC:
        threading.Thread(target=keeper, daemon=True).start()
    weights_ok()
    print(f"sketch: {MODEL} on {DEVICE}, weights {MODEL_DIR} ({'readable' if readable['ok'] else readable['why']}), port {PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
