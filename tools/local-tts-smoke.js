"use strict";

const path = require("node:path");
const fs = require("fs-extra");
require("dotenv").config({ override: true });

const brand = require("../brand");
const mediaPaths = require("../lib/media-paths");
const {
  DEFAULT_LOCAL_TTS_URL,
  fetchLocalTtsHealth,
  prewarmLocalTtsVoice,
  formatLocalTtsStatus,
} = require("../lib/studio/local-tts-readiness");
const {
  stampLocalVoiceTimestampMeta,
} = require("../lib/ops/local-voice-metadata");

process.env.TTS_PROVIDER = "local";
process.env.LOCAL_TTS_URL = process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL;
process.env.PULSE_SKIP_DOTENV = "true";

const audio = require("../audio");

async function main() {
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default";
  let summary = await fetchLocalTtsHealth({
    baseUrl: process.env.LOCAL_TTS_URL,
    voiceId,
    timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
  });

  console.log(`[tts] ${formatLocalTtsStatus(summary)}`);
  if (
    !summary.ok &&
    summary.status === "ok" &&
    summary.ready === true &&
    summary.voice?.present === true &&
    summary.voice?.refResolved === true &&
    summary.voice?.loaded !== true
  ) {
    console.log(`[tts] prewarming voice=${summary.voice.alias || voiceId}`);
    const prewarm = await prewarmLocalTtsVoice({
      baseUrl: process.env.LOCAL_TTS_URL,
      voiceId,
      timeoutMs: Number(process.env.LOCAL_TTS_PREWARM_TIMEOUT_MS || 600000),
    });
    console.log(
      `[tts] prewarm ok voice=${prewarm.voiceId} reused=${prewarm.reused === true} loaded_ms=${prewarm.loadedMs}`,
    );
    summary = await fetchLocalTtsHealth({
      baseUrl: process.env.LOCAL_TTS_URL,
      voiceId,
      timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
    });
    console.log(`[tts] ${formatLocalTtsStatus(summary)}`);
  }

  if (!summary.ok) {
    console.error(`[tts] local TTS is not ready: ${summary.reasons.join("; ")}`);
    console.error("[tts] Start tts_server\\start.bat, wait for the Pulse voice to load, then rerun npm run tts:smoke.");
    process.exit(1);
  }

  const smokeFileName =
    process.env.LOCAL_TTS_SMOKE_FILE || "__local_tts_smoke_sleepy_liam_latest.mp3";
  const rel = path.join("output", "audio", smokeFileName);
  const text =
    "Pulse Gaming local TTS is online. Pokémon is spoken clearly, and Pokémon keeps its accent in timestamps.";
  const rate = Number(process.env.LOCAL_TTS_SMOKE_RATE || 1.0);
  await audio.generateTTS(text, rel, rate);
  const voiceMeta = await stampLocalVoiceTimestampMeta({
    outputAudioPath: rel,
    text,
    source: "local-tts-smoke-sleepy-liam",
    rate,
  });

  const mp3Abs = await mediaPaths.resolveExisting(rel);
  const tsRel = rel.replace(/\.mp3$/, "_timestamps.json");
  const tsAbs = await mediaPaths.resolveExisting(tsRel);
  const timestamps = await fs.readJson(tsAbs);
  const prefix = (timestamps.characters || []).join("").slice(0, 96);

  console.log(`[tts] smoke mp3=${path.relative(process.cwd(), mp3Abs)}`);
  console.log(`[tts] smoke timestamps=${path.relative(process.cwd(), tsAbs)}`);
  console.log(
    `[tts] smoke voice_reference=${voiceMeta.local_voice_reference?.referencePresent === true ? "accepted_sleepy_liam" : "missing"}`,
  );
  console.log(`[tts] timestamp text="${prefix}"`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tts] ERROR: ${err.message}`);
    process.exit(1);
  });
}
