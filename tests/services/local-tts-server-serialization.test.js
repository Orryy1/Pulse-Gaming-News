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
print("max_active=1")
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
    assert.match(result.stdout, /max_active=1/);
  },
);
