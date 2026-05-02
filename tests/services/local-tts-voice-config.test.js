"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

test("Pulse VoxCPM voice map carries Sleepy-proven safety parameters", () => {
  const voices = JSON.parse(
    fs.readFileSync(path.join(ROOT, "tts_server", "voices.json"), "utf8"),
  );
  const pulse = voices.TX3LPaxmHKxFdv7VOQHJ;

  assert.ok(pulse, "Pulse Liam voice mapping must exist");
  assert.equal(pulse.ref_voice_path, "voices/pulse_v2.wav");
  assert.equal(pulse.base_speed <= 1.4, true);
  assert.equal(pulse.cfg_value, 2.0);
  assert.equal(pulse.inference_timesteps, 20);
  assert.equal(pulse.load_denoiser, false);
  assert.equal(typeof pulse.ref_voice_text, "string");
  assert.match(pulse.ref_voice_text, /Metro/i);
});

test("Pulse VoxCPM engine passes cfg, timesteps, prompt conditioning and denoiser safety", () => {
  const engineSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "voxcpm_engine.py"),
    "utf8",
  );
  const serverSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "server.py"),
    "utf8",
  );

  assert.match(engineSource, /"cfg_value":\s*self\.cfg_value/);
  assert.match(engineSource, /"inference_timesteps":\s*self\.inference_timesteps/);
  assert.match(engineSource, /load_denoiser=self\.load_denoiser/);
  assert.match(engineSource, /kwargs\["prompt_wav_path"\]\s*=\s*str\(self\.ref_voice_path\)/);
  assert.match(engineSource, /kwargs\["prompt_text"\]\s*=\s*self\.prompt_text/);
  assert.match(serverSource, /prompt_text=cfg\.get\("ref_voice_text"\)/);
  assert.match(serverSource, /cfg_value=cfg\.get\("cfg_value"/);
  assert.match(serverSource, /inference_timesteps=cfg\.get\("inference_timesteps"/);
  assert.match(serverSource, /load_denoiser=cfg\.get\("load_denoiser"/);
});

test("Pulse VoxCPM generation is serialised and stage-timed for hangs", () => {
  const engineSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "voxcpm_engine.py"),
    "utf8",
  );

  assert.match(engineSource, /_generation_lock\s*=\s*threading\.Lock\(\)/);
  assert.match(engineSource, /with\s+_generation_lock:/);
  assert.match(engineSource, /generate_begin/);
  assert.match(engineSource, /generate_end/);
  assert.match(engineSource, /stretch_begin/);
  assert.match(engineSource, /stretch_end/);
});

test("Pulse local TTS request rate is capped before server base-speed multiplication", () => {
  process.env.PULSE_SKIP_DOTENV = "true";
  const {
    resolveVoiceSettingsForProvider,
  } = require("../../audio");

  const local = resolveVoiceSettingsForProvider(
    "local",
    { stability: 0.2, similarity_boost: 0.8, style: 0.75, speaking_rate: 1.1 },
    1.68,
    {
      LOCAL_TTS_BASE_SPEED: "1.4",
      LOCAL_TTS_EFFECTIVE_RATE_CAP: "1.65",
    },
  );
  assert.equal(local.speaking_rate <= 1.18, true);
  assert.equal(local.speaking_rate * 1.4 <= 1.66, true);

  const eleven = resolveVoiceSettingsForProvider(
    "elevenlabs",
    { speaking_rate: 1.1 },
    1.68,
    {},
  );
  assert.equal(eleven.speaking_rate, 1.68);
});
