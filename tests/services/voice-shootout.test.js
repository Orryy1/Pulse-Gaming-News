"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildBenchmarkManifest,
  buildBlindReviewPack,
  buildVoiceShootoutReport,
  localTtsReady,
  renderVoiceReviewSheet,
  renderVoiceShootoutMarkdown,
} = require("../../lib/studio/v2/voice-shootout");

test("voice shootout treats green local TTS doctor as local Liam ready", () => {
  assert.equal(localTtsReady({ verdict: "green" }), true);
  assert.equal(localTtsReady({ before: { ready: true } }), true);
  assert.equal(localTtsReady({ verdict: "red" }), false);
});

test("voice shootout benchmark manifest includes hard pronunciation cases", () => {
  const manifest = buildBenchmarkManifest({
    generatedAt: "2026-05-06T22:00:00.000Z",
    env: {},
    localTtsDoctorReport: { verdict: "green" },
  });

  const titleScript = manifest.transcripts.find((item) => item.id === "game_titles");
  assert.match(titleScript.text, /Pokémon/);
  assert.doesNotMatch(titleScript.text, /PokÃ©mon/);
  assert.ok(titleScript.pronunciation_watchlist.includes("Pokémon"));
  assert.ok(titleScript.pronunciation_watchlist.includes("BioShock"));
  assert.ok(titleScript.pronunciation_watchlist.includes("S.T.A.L.K.E.R. 2"));
  assert.equal(manifest.safety.callsExternalApis, false);
  assert.equal(manifest.safety.spendsPaidCredits, false);
});

test("voice shootout marks ElevenLabs as configured but externally locked", () => {
  const manifest = buildBenchmarkManifest({
    env: {
      ELEVENLABS_API_KEY: "secret",
      ELEVENLABS_VOICE_ID: "voice-id",
    },
    localTtsDoctorReport: { verdict: "green" },
  });

  const eleven = manifest.models.find((model) => model.id === "elevenlabs_production_baseline");
  const local = manifest.models.find((model) => model.id === "local_liam_current");
  const chatterbox = manifest.models.find((model) => model.id === "chatterbox_local");
  assert.equal(eleven.setupStatus, "configured_external_paid_locked");
  assert.equal(eleven.allowedTonight, false);
  assert.equal(eleven.approvalRequired, true);
  assert.equal(local.setupStatus, "ready_for_local_proof");
  assert.equal(local.allowedTonight, true);
  assert.equal(chatterbox.setupStatus, "not_detected_optional_setup");
  assert.equal(chatterbox.allowedTonight, false);
});

test("voice shootout blind review sheet hides model identities", () => {
  const manifest = buildBenchmarkManifest({
    env: {},
    localTtsDoctorReport: { verdict: "green" },
  });
  const pack = buildBlindReviewPack(manifest);
  const sheet = renderVoiceReviewSheet(pack);

  assert.ok(pack.privateMap.some((row) => row.modelId === "local_liam_current"));
  assert.match(sheet, /voice_01/);
  assert.doesNotMatch(sheet, /local_liam_current|elevenlabs_production_baseline|chatterbox/);
});

test("voice shootout report is local, read-only and operator-readable", () => {
  const report = buildVoiceShootoutReport({
    generatedAt: "2026-05-06T22:00:00.000Z",
    env: {},
    localTtsDoctorReport: { verdict: "green" },
  });
  const md = renderVoiceShootoutMarkdown(report);

  assert.equal(report.verdict, "AMBER_READY_FOR_LOCAL_BENCHMARKS");
  assert.ok(report.readyModels.includes("local_liam_current"));
  assert.match(md, /Voice Shootout Overnight Report/);
  assert.match(md, /Model Setup Status/);
  assert.match(md, /switchesProductionVoice: false/);
  assert.doesNotMatch(md, /secret|access_token|refresh_token|Bearer/);
});

test("voice shootout package script is available", () => {
  const pkg = require("../../package.json");
  assert.equal(pkg.scripts["voice:shootout"], "node tools/voice-shootout.js");
  assert.equal(fs.existsSync(path.join(process.cwd(), "tools", "voice-shootout.js")), true);
});
