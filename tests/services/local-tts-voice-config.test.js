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
  assert.equal(pulse.ref_voice_path, "voices/pulse_liam_sleepy.wav");
  assert.equal(pulse.accepted_reference_id, "pulse-sleepy-liam-20260502");
  assert.equal(pulse.accepted_reference_file, "pulse_liam_sleepy.wav");
  assert.equal(pulse.base_speed, 1.0);
  assert.equal(pulse.cfg_value, 2.0);
  assert.equal(pulse.inference_timesteps, 20);
  assert.equal(pulse.load_denoiser, false);
  assert.equal(pulse.use_prompt_text, false);
  assert.equal(pulse.voice_qa.enabled, true);
  assert.equal(pulse.voice_qa.min_median_f0_hz >= 95, true);
  assert.equal(pulse.voice_qa.retry_same_reference, false);
  assert.equal(pulse.voice_qa.fallback_without_reference, false);
  assert.equal(typeof pulse.ref_voice_text, "string");
  assert.match(pulse.ref_voice_text, /Metro/i);
  assert.match(pulse.notes, /Sleepy Empire Liam/i);
});

test("Pulse VoxCPM engine passes cfg, timesteps, prompt policy, voice QA and denoiser safety", () => {
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
  assert.match(serverSource, /prompt_text=prompt_text/);
  assert.match(serverSource, /voice_qa=cfg\.get\("voice_qa"\)/);
  assert.match(serverSource, /cfg\.get\("use_prompt_text",\s*True\)/);
  assert.match(engineSource, /_voice_quality_metrics/);
  assert.match(engineSource, /min_median_f0_hz/);
  assert.match(engineSource, /fallback_without_reference/);
  assert.match(engineSource, /voice_qa_all_candidates_rejected/);
  assert.match(serverSource, /cfg_value=cfg\.get\("cfg_value"/);
  assert.match(serverSource, /inference_timesteps=cfg\.get\("inference_timesteps"/);
  assert.match(serverSource, /load_denoiser=cfg\.get\("load_denoiser"/);
  assert.match(serverSource, /ALLOW_UNKNOWN_VOICE_FALLBACK/);
  assert.match(serverSource, /refusing default fallback voice/);
  assert.match(serverSource, /reference_sha1/);
  assert.match(serverSource, /accepted_reference_id/);
});

test("Pulse local TTS server returns per-request voice diagnostics", () => {
  const engineSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "voxcpm_engine.py"),
    "utf8",
  );
  const serverSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "server.py"),
    "utf8",
  );
  const audioSource = fs.readFileSync(path.join(ROOT, "audio.js"), "utf8");

  assert.match(engineSource, /self\.last_voice_diagnostics/);
  assert.match(engineSource, /selected_candidate/);
  assert.match(engineSource, /median_f0_hz/);
  assert.match(serverSource, /voice_diagnostics:\s*Optional\[dict\]/);
  assert.match(serverSource, /getattr\(engine,\s*"last_voice_diagnostics"/);
  assert.match(serverSource, /voice_diagnostics=voice_diagnostics/);
  assert.match(audioSource, /normaliseLocalVoiceDiagnostics/);
  assert.match(audioSource, /voice_diagnostics/);
  assert.match(audioSource, /medianPitchHz/);
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

test("Pulse VoxCPM voice QA analyses bounded audio windows instead of whole long renders", () => {
  const engineSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "voxcpm_engine.py"),
    "utf8",
  );

  assert.match(engineSource, /VOICE_QA_MAX_ANALYSIS_S/);
  assert.match(engineSource, /analysis_audio/);
  assert.match(engineSource, /analysis_duration_s/);
});

test("Pulse VoxCPM stretch prefers FFmpeg Rubber Band over librosa phase vocoder", () => {
  const engineSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "voxcpm_engine.py"),
    "utf8",
  );

  assert.match(engineSource, /VOXCPM_TIME_STRETCH_BACKEND/);
  assert.match(engineSource, /rubberband=tempo=/);
  assert.match(engineSource, /_time_stretch_rubberband/);
  assert.match(engineSource, /librosa_fallback/);
});

test("Pulse VoxCPM server uses model sample rate instead of hardcoded 16 kHz", () => {
  const engineSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "voxcpm_engine.py"),
    "utf8",
  );
  const serverSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "server.py"),
    "utf8",
  );

  assert.match(engineSource, /self\.sample_rate\s*=/);
  assert.match(engineSource, /tts_model/);
  assert.match(engineSource, /sample_rate/);
  assert.match(serverSource, /sample_rate\s*=\s*engine\.sample_rate/);
  assert.doesNotMatch(serverSource, /sample_rate\s*=\s*engine\.SAMPLE_RATE/);
});

test("Pulse local TTS prewarm reuse leaves the health state ready", () => {
  const serverSource = fs.readFileSync(
    path.join(ROOT, "tts_server", "server.py"),
    "utf8",
  );

  assert.match(serverSource, /if reused:\s+SERVICE_STATE\["phase"\]\s*=\s*"ready"/s);
  assert.match(serverSource, /SERVICE_STATE\["ready"\]\s*=\s*True/);
  assert.match(serverSource, /SERVICE_STATE\["warming"\]\s*=\s*False/);
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

test("Pulse local TTS can be deliberately slowed for too-short Liam proofs", () => {
  process.env.PULSE_SKIP_DOTENV = "true";
  const {
    resolveVoiceSettingsForProvider,
  } = require("../../audio");

  const local = resolveVoiceSettingsForProvider(
    "local",
    { speaking_rate: 1.1 },
    1.1,
    {
      LOCAL_TTS_MIN_SPEAKING_RATE: "0.65",
      LOCAL_TTS_EFFECTIVE_RATE_CAP: "0.75",
    },
  );

  assert.equal(local.speaking_rate, 0.75);
});

test("Pulse local TTS default rate no longer trusts legacy BASE_SPEED compensation", () => {
  process.env.PULSE_SKIP_DOTENV = "true";
  const {
    resolveVoiceSettingsForProvider,
  } = require("../../audio");

  const local = resolveVoiceSettingsForProvider(
    "local",
    { speaking_rate: 1.75 },
    1.75,
    {
      BASE_SPEED: "1.4",
    },
  );

  assert.equal(local.speaking_rate <= 1.0, true);
});

test("Pulse Studio V2 local voice defaults to natural speed", () => {
  const soundLayerSource = fs.readFileSync(
    path.join(ROOT, "lib", "studio", "sound-layer.js"),
    "utf8",
  );

  assert.match(soundLayerSource, /STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP\s*\|\|\s*1\.0/);
  assert.doesNotMatch(soundLayerSource, /STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP\s*\|\|\s*1\.15/);
});

test("Pulse local TTS smoke test uses a natural rate by default", () => {
  const smokeSource = fs.readFileSync(
    path.join(ROOT, "tools", "local-tts-smoke.js"),
    "utf8",
  );

  assert.match(smokeSource, /prewarmLocalTtsVoice/);
  assert.match(smokeSource, /createLocalTtsBatchRecovery/);
  assert.match(smokeSource, /generateTtsForStory/);
  assert.match(smokeSource, /LOCAL_TTS_SMOKE_TIMEOUT_MS/);
  assert.match(smokeSource, /LOCAL_TTS_SMOKE_ATTEMPTS/);
  assert.match(smokeSource, /LOCAL_TTS_SMOKE_TEXT/);
  assert.match(smokeSource, /LOCAL_TTS_PREWARM_TIMEOUT_MS/);
  assert.match(smokeSource, /LOCAL_TTS_SMOKE_RATE\s*\|\|\s*1\.0/);
  assert.match(smokeSource, /__local_tts_smoke_sleepy_liam_latest\.mp3/);
  assert.match(smokeSource, /stampLocalVoiceTimestampMeta/);
  assert.match(smokeSource, /Pokémon is spoken clearly/);
  assert.match(smokeSource, /Pokémon keeps its accent/);
  assert.doesNotMatch(smokeSource, /Pokemon is spoken clearly|Pokmon|PokÃ©mon/);
  assert.doesNotMatch(smokeSource, /audio\.generateTTS\(text,\s*rel,\s*rate\)/);
  assert.doesNotMatch(smokeSource, /LOCAL_TTS_SMOKE_RATE\s*\|\|\s*1\.75/);
});

test("Pulse Studio local TTS paths request high-bitrate source audio before mastering", () => {
  const soundLayerSource = fs.readFileSync(
    path.join(ROOT, "lib", "studio", "sound-layer.js"),
    "utf8",
  );
  const workbenchSource = fs.readFileSync(
    path.join(ROOT, "lib", "studio", "v2", "flash-lane-voice-workbench.js"),
    "utf8",
  );

  assert.match(soundLayerSource, /resolveTtsOutputFormat\("local"/);
  assert.match(workbenchSource, /resolveTtsOutputFormat\("local"/);
  assert.doesNotMatch(soundLayerSource, /output_format:\s*"mp3_44100_128"/);
  assert.doesNotMatch(workbenchSource, /output_format:\s*"mp3_44100_128"/);
});

test("Pulse flash-lane voice workbench hides Windows subprocess probes", () => {
  const workbenchSource = fs.readFileSync(
    path.join(ROOT, "tools", "flash-lane-voice-workbench.js"),
    "utf8",
  );
  const calls = [...workbenchSource.matchAll(/spawnSync\([\s\S]*?\n\s*\);/g)].map(
    (match) => match[0],
  );

  assert.equal(calls.length >= 3, true);
  for (const call of calls) {
    assert.match(call, /windowsHide:\s*true/);
  }
});

test("Pulse Studio local production voice metadata stays at native Liam rate", () => {
  const soundLayerSource = fs.readFileSync(
    path.join(ROOT, "lib", "studio", "sound-layer.js"),
    "utf8",
  );

  assert.match(soundLayerSource, /voiceSettings:\s*isLocal[\s\S]*speaking_rate:\s*1\.0/);
  assert.match(soundLayerSource, /rate:\s*isLocal \? 1\.0 : brand\.voiceSettings\?\.speaking_rate/);
  assert.match(soundLayerSource, /buildVoiceMasteringSignature/);
  assert.match(soundLayerSource, /segmentVoiceMastering/);
  assert.match(soundLayerSource, /voiceMastering:\s*sourceVoiceMeta\.voiceMastering/);
  assert.doesNotMatch(soundLayerSource, /STUDIO_V1_LIAM_RATE \|\| 1\.78/);
});

test("Pulse Studio V2 local render wrapper keeps the accepted Liam pace", () => {
  const wrapperSource = fs.readFileSync(
    path.join(ROOT, "tools", "studio-v2-local-render.js"),
    "utf8",
  );

  assert.match(wrapperSource, /STUDIO_V2_LOCAL_TTS_RATE_MULTIPLIER\s*\|\|\s*"1\.0"/);
  assert.match(wrapperSource, /STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP\s*\|\|\s*"1\.0"/);
  assert.doesNotMatch(wrapperSource, /STUDIO_V2_LOCAL_TTS_RATE_MULTIPLIER\s*\|\|\s*"1\.75"/);
  assert.doesNotMatch(wrapperSource, /STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP\s*\|\|\s*"1\.15"/);
});
