"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

require("dotenv").config({ override: true });

process.env.STUDIO_V2_VOICE = process.env.STUDIO_V2_VOICE || "local";
process.env.TTS_PROVIDER = "local";
process.env.LOCAL_TTS_URL = process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765";
process.env.STUDIO_V2_LOCAL_TTS_RATE_MULTIPLIER =
  process.env.STUDIO_V2_LOCAL_TTS_RATE_MULTIPLIER || "1.75";
process.env.STUDIO_V2_LOCAL_TTS_BASE_SPEED =
  process.env.STUDIO_V2_LOCAL_TTS_BASE_SPEED || "1.4";
process.env.STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP =
  process.env.STUDIO_V2_LOCAL_TTS_EFFECTIVE_RATE_CAP || "2.35";
process.env.STUDIO_EDITORIAL_MAX_WORDS =
  process.env.STUDIO_EDITORIAL_MAX_WORDS || "125";
process.env.STUDIO_V2_LOCAL_TTS_MAX_SEGMENT_WORDS =
  process.env.STUDIO_V2_LOCAL_TTS_MAX_SEGMENT_WORDS || "18";
process.env.STUDIO_V2_LOCAL_TTS_MAX_SEGMENT_CHARS =
  process.env.STUDIO_V2_LOCAL_TTS_MAX_SEGMENT_CHARS || "150";
process.env.LOCAL_TTS_TIMEOUT_MS = process.env.LOCAL_TTS_TIMEOUT_MS || "600000";
process.env.STUDIO_V2_SFX_MODE = process.env.STUDIO_V2_SFX_MODE || "studio";
process.env.STUDIO_V2_LOUDNESS_TARGET =
  process.env.STUDIO_V2_LOUDNESS_TARGET || "-16";
process.env.PULSE_SKIP_DOTENV = "true";

const script = path.join(__dirname, "studio-v2-render.js");
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
