"use strict";

const path = require("node:path");
const fs = require("fs-extra");
require("dotenv").config({ override: true });

const brand = require("../brand");
const mediaPaths = require("../lib/media-paths");
const {
  DEFAULT_LOCAL_TTS_URL,
  fetchLocalTtsHealth,
  formatLocalTtsStatus,
} = require("../lib/studio/local-tts-readiness");

process.env.TTS_PROVIDER = "local";
process.env.LOCAL_TTS_URL = process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL;
process.env.PULSE_SKIP_DOTENV = "true";

const audio = require("../audio");

async function main() {
  const voiceId = brand.voiceId || process.env.ELEVENLABS_VOICE_ID || "default";
  const summary = await fetchLocalTtsHealth({
    baseUrl: process.env.LOCAL_TTS_URL,
    voiceId,
    timeoutMs: Number(process.env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
  });

  console.log(`[tts] ${formatLocalTtsStatus(summary)}`);
  if (!summary.ok) {
    console.error(`[tts] local TTS is not ready: ${summary.reasons.join("; ")}`);
    console.error("[tts] Start tts_server\\start.bat, wait for the Pulse voice to load, then rerun npm run tts:smoke.");
    process.exit(1);
  }

  const rel = path.join("output", "audio", "__local_tts_smoke.mp3");
  const text =
    "Pulse Gaming local TTS is online. Pokemon is spoken clearly, and Pokémon keeps its accent in timestamps.";
  await audio.generateTTS(text, rel, Number(process.env.LOCAL_TTS_SMOKE_RATE || 1.0));

  const mp3Abs = await mediaPaths.resolveExisting(rel);
  const tsRel = rel.replace(/\.mp3$/, "_timestamps.json");
  const tsAbs = await mediaPaths.resolveExisting(tsRel);
  const timestamps = await fs.readJson(tsAbs);
  const prefix = (timestamps.characters || []).join("").slice(0, 96);

  console.log(`[tts] smoke mp3=${path.relative(process.cwd(), mp3Abs)}`);
  console.log(`[tts] smoke timestamps=${path.relative(process.cwd(), tsAbs)}`);
  console.log(`[tts] timestamp text="${prefix}"`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tts] ERROR: ${err.message}`);
    process.exit(1);
  });
}
