"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildBenchmarkManifest,
  buildBlindReviewPack,
  buildVoiceShootoutReport,
  EXPECTED_LOCAL_VOICE_REFERENCE_ID,
  generateLocalLiamBenchmarkSamples,
  localVoiceReadyStatus,
  localTtsReady,
  renderVoiceReviewSheet,
  renderVoiceShootoutMarkdown,
} = require("../../lib/studio/v2/voice-shootout");
const { parseArgs } = require("../../tools/voice-shootout");

function readyDoctor() {
  return {
    verdict: "green",
    before: {
      ok: true,
      ready: true,
      voice: {
        loaded: true,
        refResolved: true,
        reference: {
          id: EXPECTED_LOCAL_VOICE_REFERENCE_ID,
          referencePresent: true,
        },
      },
    },
  };
}

test("voice shootout treats accepted local Liam doctor as local ready", () => {
  assert.equal(localTtsReady(readyDoctor()), true);
  assert.equal(localVoiceReadyStatus(readyDoctor()).reason, "accepted_local_liam_reference_ready");
  assert.equal(localTtsReady({ verdict: "red" }), false);
  assert.equal(localTtsReady({ verdict: "green" }), false);
  assert.equal(localTtsReady({ before: { ready: true } }), false);
});

test("voice shootout accepts overnight report only when accepted Liam reference is present", () => {
  assert.equal(
    localTtsReady({
      overnightReport: {
        expected_local_voice_id: EXPECTED_LOCAL_VOICE_REFERENCE_ID,
        queue: {
          local_tts: {
            ready: true,
            status: "ok",
            phase: "ready",
            voice: {
              reference_present: true,
              accepted_reference_id: EXPECTED_LOCAL_VOICE_REFERENCE_ID,
            },
          },
        },
      },
    }),
    true,
  );
  assert.equal(
    localTtsReady({
      overnightReport: {
        queue: {
          local_tts: {
            ready: true,
            status: "ok",
            voice: { reference_present: true, accepted_reference_id: "old-voice" },
          },
        },
      },
    }),
    false,
  );
});

test("voice shootout benchmark manifest includes hard pronunciation cases", () => {
  const manifest = buildBenchmarkManifest({
    generatedAt: "2026-05-06T22:00:00.000Z",
    env: {},
    localTtsDoctorReport: readyDoctor(),
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
    localTtsDoctorReport: readyDoctor(),
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
    localTtsDoctorReport: readyDoctor(),
    samples: [
      {
        modelId: "local_liam_current",
        transcriptId: "prices",
        filePath: "test/output/voice-shootout/audio/local_liam_prices.mp3",
      },
    ],
  });
  const pack = buildBlindReviewPack(manifest);
  const sheet = renderVoiceReviewSheet(pack);

  assert.ok(pack.privateMap.some((row) => row.modelId === "local_liam_current"));
  assert.match(sheet, /voice_\d\d/);
  assert.doesNotMatch(sheet, /local_liam_current|elevenlabs_production_baseline|chatterbox/);
});

test("voice shootout blind review has no public rows until samples exist", () => {
  const manifest = buildBenchmarkManifest({
    env: {},
    localTtsDoctorReport: readyDoctor(),
  });
  const pack = buildBlindReviewPack(manifest);
  assert.equal(pack.publicRows.length, 0);
  assert.ok(pack.privateMap.some((row) => row.sampleStatus === "not_generated"));
});

test("voice shootout report is local, read-only and operator-readable", () => {
  const report = buildVoiceShootoutReport({
    generatedAt: "2026-05-06T22:00:00.000Z",
    env: {},
    localTtsDoctorReport: readyDoctor(),
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

test("voice shootout CLI parses safe output controls", () => {
  const args = parseArgs(["--out-dir", "test/output/voice-audit", "--no-root"]);
  assert.equal(args.updateRoot, false);
  assert.match(args.outDir, /test[\\/]output[\\/]voice-audit$/);
  assert.equal(parseArgs(["--update-root"]).updateRoot, true);

  const generationArgs = parseArgs([
    "--generate-local-liam",
    "--apply-local",
    "--engine",
    "chatterbox",
    "--rate",
    "0.92",
    "--base-url",
    "http://127.0.0.1:9999",
    "--voice-id",
    "liam",
    "--limit",
    "2",
  ]);
  assert.equal(generationArgs.generateLocalLiam, true);
  assert.equal(generationArgs.applyLocal, true);
  assert.equal(generationArgs.updateRoot, false);
  assert.equal(generationArgs.engine, "chatterbox");
  assert.equal(generationArgs.rate, 0.92);
  assert.equal(generationArgs.baseUrl, "http://127.0.0.1:9999");
  assert.equal(generationArgs.voiceId, "liam");
  assert.equal(generationArgs.limit, 2);
});

test("voice shootout local Liam generation refuses output outside test output", async () => {
  await assert.rejects(
    () =>
      generateLocalLiamBenchmarkSamples({
        localTtsDoctorReport: readyDoctor(),
        outputRoot: process.cwd(),
      }),
    /output must stay under test\/output/,
  );
});

test("voice shootout local Liam dry-run plans local calls without generated samples", async () => {
  let calls = 0;
  const report = await generateLocalLiamBenchmarkSamples({
    localTtsDoctorReport: {
      ...readyDoctor(),
      voice_id: "doctor-loaded-voice",
    },
    outputRoot: path.join(process.cwd(), "test", "output", "voice-shootout-unit", "audio"),
    applyLocal: false,
    limit: 1,
    generator: async ({ applyLocal, voiceId }) => {
      calls += 1;
      assert.equal(applyLocal, false);
      assert.equal(voiceId, "doctor-loaded-voice");
      return {
        status: "would_generate",
        request: { output_root: "test/output/voice-shootout-unit/audio" },
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(report.status, "would_generate");
  assert.equal(report.applyLocal, false);
  assert.equal(report.generatedSamples, 0);
  assert.equal(report.samples.length, 0);
  assert.equal(report.results[0].status, "would_generate");
  assert.equal(report.callsExternalApis, false);
  assert.equal(report.switchesProductionVoice, false);
});

test("voice shootout local Liam generation is blocked unless accepted Liam is verified", async () => {
  let calls = 0;
  const report = await generateLocalLiamBenchmarkSamples({
    localTtsDoctorReport: { verdict: "green" },
    outputRoot: path.join(process.cwd(), "test", "output", "voice-shootout-unit", "audio"),
    applyLocal: true,
    generator: async () => {
      calls += 1;
      return {};
    },
  });

  assert.equal(calls, 0);
  assert.equal(report.status, "blocked");
  assert.equal(report.reason, "accepted_local_liam_reference_not_verified");
  assert.equal(report.samples.length, 0);
});

test("voice shootout generated local Liam samples populate blind review rows", async () => {
  const generation = await generateLocalLiamBenchmarkSamples({
    localTtsDoctorReport: readyDoctor(),
    outputRoot: path.join(process.cwd(), "test", "output", "voice-shootout-unit", "audio"),
    applyLocal: true,
    limit: 1,
    generator: async ({ story, outputRoot, applyLocal }) => {
      assert.equal(applyLocal, true);
      return {
        status: "generated",
        request: { output_root: outputRoot },
        candidate: {
          path: path.join(outputRoot, `${story.id}.mp3`),
          timestampsPath: path.join(outputRoot, `${story.id}_timestamps.json`),
          durationS: 7.2,
          source: "local-production-voxcpm-path",
          acoustic: { medianPitchHz: 116 },
        },
      };
    },
  });
  const report = buildVoiceShootoutReport({
    env: {},
    localTtsDoctorReport: readyDoctor(),
    samples: generation.samples,
    localGeneration: generation,
  });
  const md = renderVoiceShootoutMarkdown(report);

  assert.equal(generation.status, "generated");
  assert.equal(generation.samples.length, 1);
  assert.equal(report.blindReviewPack.publicRows.length, 1);
  assert.match(md, /Local Liam Generation/);
  assert.match(md, /generated samples: 1/);
});
