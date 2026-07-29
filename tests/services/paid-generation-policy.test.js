"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  legacyCompilationSchedulerEnabled,
  paidElevenLabsMusicEnabled,
} = require("../../lib/services/paid-generation-policy");

test("ElevenLabs music generation is disabled by default and cannot be armed by credentials alone", () => {
  assert.equal(paidElevenLabsMusicEnabled({}), false);
  assert.equal(
    paidElevenLabsMusicEnabled({
      ELEVENLABS_API_KEY: "configured-secret",
    }),
    false,
  );
  assert.equal(
    paidElevenLabsMusicEnabled({
      ELEVENLABS_MUSIC_GENERATION_ENABLED: "true",
    }),
    false,
  );
  assert.equal(
    paidElevenLabsMusicEnabled({
      PULSE_PAID_MEDIA_GENERATION_ENABLED: "true",
    }),
    false,
  );
});

test("paid music requires both explicit cost-authority flags", () => {
  assert.equal(
    paidElevenLabsMusicEnabled({
      PULSE_PAID_MEDIA_GENERATION_ENABLED: "true",
      ELEVENLABS_MUSIC_GENERATION_ENABLED: "true",
    }),
    true,
  );
  assert.equal(
    paidElevenLabsMusicEnabled({
      PULSE_PAID_MEDIA_GENERATION_ENABLED: "TRUE",
      ELEVENLABS_MUSIC_GENERATION_ENABLED: "1",
    }),
    true,
  );
  assert.equal(
    paidElevenLabsMusicEnabled({
      PULSE_PAID_MEDIA_GENERATION_ENABLED: "false",
      ELEVENLABS_MUSIC_GENERATION_ENABLED: "true",
    }),
    false,
  );
});

test("the legacy compilation scheduler stays disabled outside explicit local proof", () => {
  assert.equal(legacyCompilationSchedulerEnabled({}), false);
  assert.equal(
    legacyCompilationSchedulerEnabled({
      PULSE_LEGACY_COMPILATION_ENABLED: "true",
      PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    }),
    false,
  );
  assert.equal(
    legacyCompilationSchedulerEnabled({
      PULSE_LEGACY_COMPILATION_ENABLED: "true",
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
    }),
    false,
  );
  assert.equal(
    legacyCompilationSchedulerEnabled({
      PULSE_LEGACY_COMPILATION_ENABLED: "true",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
    }),
    true,
  );
});

test("autonomous assemblers require the paid-music policy and legacy compilation routes TTS through the credit guard", () => {
  const root = path.resolve(__dirname, "..", "..");
  const shortAssembler = fs.readFileSync(
    path.join(root, "assemble.js"),
    "utf8",
  );
  const longformAssembler = fs.readFileSync(
    path.join(root, "assemble_longform.js"),
    "utf8",
  );
  const legacyWeekly = fs.readFileSync(
    path.join(root, "weekly_compile.js"),
    "utf8",
  );

  assert.match(shortAssembler, /paidElevenLabsMusicEnabled\(process\.env\)/);
  assert.match(longformAssembler, /paidElevenLabsMusicEnabled\(process\.env\)/);
  assert.match(legacyWeekly, /generateTTS\(ttsText,\s*outputPath,/);
  assert.match(
    legacyWeekly,
    /loadDotenvOnce\(\{\s*dotenv,\s*env:\s*process\.env\s*\}\)/,
  );
  assert.doesNotMatch(legacyWeekly, /dotenv\.config\(/);
  assert.doesNotMatch(legacyWeekly, /xi-api-key/);
  assert.doesNotMatch(
    legacyWeekly,
    /api\.elevenlabs\.io\/v1\/text-to-speech/,
  );
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(
    server,
    /legacyCompilationSchedulerEnabled\(process\.env\)/,
  );
});
