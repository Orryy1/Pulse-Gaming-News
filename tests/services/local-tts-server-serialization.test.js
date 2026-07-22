const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const TTS_ROOT = path.join(ROOT, "tts_server");
const PYTHON = path.join(TTS_ROOT, "venv", "Scripts", "python.exe");

test(
  "local TTS server serialises concurrent synthesis against the shared engine",
  { skip: !fs.existsSync(PYTHON) },
  () => {
    const script = String.raw`
import concurrent.futures
import sys
import threading
import time
import types

import numpy as np


class FakeCuda:
    @staticmethod
    def is_available():
        return False

    @staticmethod
    def empty_cache():
        return None


torch = types.ModuleType("torch")
torch.__version__ = "test"
torch.cuda = FakeCuda()
torch.version = types.SimpleNamespace(cuda=None)
torch.backends = types.SimpleNamespace(
    cudnn=types.SimpleNamespace(version=lambda: None),
)
sys.modules["torch"] = torch

for module_name in ("torchaudio", "safetensors", "transformers", "voxcpm"):
    module = types.ModuleType(module_name)
    module.__version__ = "test"
    sys.modules[module_name] = module

voxcpm_engine = types.ModuleType("voxcpm_engine")
voxcpm_engine.VoxCPMEngine = object
sys.modules["voxcpm_engine"] = voxcpm_engine


class ImportSafeAligner:
    def __init__(self, language="en", device="cpu"):
        self._model = None

    @staticmethod
    def _fallback_even(text, duration):
        return {
            "characters": list(text),
            "character_start_times_seconds": [],
            "character_end_times_seconds": [],
        }


aligner_module = types.ModuleType("aligner")
aligner_module.Aligner = ImportSafeAligner
sys.modules["aligner"] = aligner_module

import server
from fastapi import HTTPException


class FakeEngine:
    sample_rate = 48000
    last_voice_diagnostics = {"candidate": "fake"}

    def __init__(self):
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def synth(self, text, speaking_rate=1.0, seed=None):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(0.15)
        with self.lock:
            self.active -= 1
        return np.zeros(4800, dtype=np.float32)


class FakeAligner:
    def align(self, audio, sample_rate, text):
        chars = list(text)
        starts = [index * 0.01 for index in range(len(chars))]
        ends = [(index + 1) * 0.01 for index in range(len(chars))]
        return {
            "characters": chars,
            "character_start_times_seconds": starts,
            "character_end_times_seconds": ends,
        }


engine = FakeEngine()
server._get_engine = lambda voice_id: engine
server._encode_mp3 = lambda audio, sample_rate, target_format: b"fake-mp3"
server.aligner = FakeAligner()


def run(text):
    return server._synth(
        "TX3LPaxmHKxFdv7VOQHJ",
        server.TTSRequest(text=text, alignment_mode="forced"),
    )


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(run, ["first request", "second request"]))

assert len(results) == 2
assert engine.max_active == 1, (
    f"shared local TTS engine ran {engine.max_active} concurrent syntheses"
)


class BlockingEngine(FakeEngine):
    def __init__(self):
        super().__init__()
        self.calls = 0
        self.entered = threading.Event()
        self.release = threading.Event()

    def synth(self, text, speaking_rate=1.0, seed=None):
        self.calls += 1
        self.entered.set()
        assert self.release.wait(2), "test did not release active synthesis"
        return np.zeros(4800, dtype=np.float32)


blocking_engine = BlockingEngine()
server._get_engine = lambda voice_id: blocking_engine
server.INFERENCE_QUEUE_WAIT_S = 0.05
busy_error = None
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    active = pool.submit(run, "active request")
    assert blocking_engine.entered.wait(1), "active synthesis never entered engine"
    try:
        run("queued request")
    except HTTPException as exc:
        busy_error = exc
    finally:
        blocking_engine.release.set()
    active.result(timeout=2)

assert busy_error is not None, "queued synthesis waited without a deadline"
assert busy_error.status_code == 503, busy_error
assert "local_tts_busy" in str(busy_error.detail), busy_error.detail
assert blocking_engine.calls == 1, blocking_engine.calls
state = server._inference_state_snapshot()
assert state["waiting"] == 0, state
assert state["active"] is False, state
print("max_active=1 queue_timeout=1")
`;

    const result = spawnSync(PYTHON, ["-c", script], {
      cwd: TTS_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
      timeout: 30_000,
    });

    assert.equal(
      result.status,
      0,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
    assert.match(result.stdout, /max_active=1 queue_timeout=1/);
  },
);

test(
  "local TTS server refuses unsafe narration requests before inference",
  { skip: !fs.existsSync(PYTHON) },
  () => {
    const script = String.raw`
import sys
import types

import numpy as np


class FakeCuda:
    @staticmethod
    def is_available():
        return False

    @staticmethod
    def empty_cache():
        return None


torch = types.ModuleType("torch")
torch.__version__ = "test"
torch.cuda = FakeCuda()
torch.version = types.SimpleNamespace(cuda=None)
torch.backends = types.SimpleNamespace(
    cudnn=types.SimpleNamespace(version=lambda: None),
)
sys.modules["torch"] = torch

for module_name in ("torchaudio", "safetensors", "transformers", "voxcpm"):
    module = types.ModuleType(module_name)
    module.__version__ = "test"
    sys.modules[module_name] = module

voxcpm_engine = types.ModuleType("voxcpm_engine")
voxcpm_engine.VoxCPMEngine = object
sys.modules["voxcpm_engine"] = voxcpm_engine


class ImportSafeAligner:
    def __init__(self, language="en", device="cpu"):
        self._model = None

    @staticmethod
    def _fallback_even(text, duration):
        return {
            "characters": list(text),
            "character_start_times_seconds": [],
            "character_end_times_seconds": [],
        }


aligner_module = types.ModuleType("aligner")
aligner_module.Aligner = ImportSafeAligner
sys.modules["aligner"] = aligner_module

import server
from fastapi import HTTPException


class FakeEngine:
    sample_rate = 48000
    last_voice_diagnostics = {}

    def __init__(self):
        self.calls = 0

    def synth(self, text, speaking_rate=1.0, seed=None):
        self.calls += 1
        return np.zeros(4800, dtype=np.float32)


engine = FakeEngine()
server._get_engine = lambda voice_id: engine
server._encode_mp3 = lambda audio, sample_rate, target_format: b"fake-mp3"

try:
    server._synth(
        "TX3LPaxmHKxFdv7VOQHJ",
        server.TTSRequest(
            text=" ".join(["oversized"] * 100),
            alignment_mode="fallback",
        ),
    )
except HTTPException as exc:
    assert exc.status_code == 413, exc
    assert "single-take limit" in str(exc.detail), exc.detail
else:
    raise AssertionError("oversized local TTS request reached inference")

assert engine.calls == 0, f"engine was called {engine.calls} times"

engine._model = object()
server._vram_snapshot = lambda: {
    "free_b": 5 * 1024 * 1024 * 1024,
    "total_b": 24 * 1024 * 1024 * 1024,
    "allocated_b": 0,
    "reserved_b": 0,
    "device_index": 0,
}
try:
    server._synth(
        "TX3LPaxmHKxFdv7VOQHJ",
        server.TTSRequest(text="Short governed narration.", alignment_mode="fallback"),
    )
except HTTPException as exc:
    assert exc.status_code == 503, exc
    assert "local_tts_gpu_busy" in str(exc.detail), exc.detail
else:
    raise AssertionError("low-headroom local TTS request reached inference")

assert engine.calls == 0, f"engine was called {engine.calls} times"
print("unsafe_requests_refused_before_inference=1")
`;

    const result = spawnSync(PYTHON, ["-c", script], {
      cwd: TTS_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
      timeout: 30_000,
    });

    assert.equal(
      result.status,
      0,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );
    assert.match(result.stdout, /unsafe_requests_refused_before_inference=1/);
  },
);
