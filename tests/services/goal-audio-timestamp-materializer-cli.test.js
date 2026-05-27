"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  configureGoalTtsBatchEnv,
  configureLocalTtsBatchEnv,
  main,
  parseArgs,
} = require("../../tools/goal-audio-timestamp-materializer");

test("goal audio timestamp materializer CLI parses local batch arguments", () => {
  const args = parseArgs([
    "--workbench",
    "audio-workbench.json",
    "--out-dir",
    "out",
    "--workspace",
    "workspace",
    "--generated-at",
    "2026-05-22T06:15:00.000Z",
    "--limit",
    "2",
    "--story-id",
    "story-one",
    "--story-id",
    "story-two",
    "--provider",
    "elevenlabs",
    "--json",
  ]);

  assert.equal(args.workbenchPath, "audio-workbench.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.workspaceRoot, "workspace");
  assert.equal(args.generatedAt, "2026-05-22T06:15:00.000Z");
  assert.equal(args.limit, 2);
  assert.deepEqual(args.storyIds, ["story-one", "story-two"]);
  assert.equal(args.provider, "elevenlabs");
  assert.equal(args.json, true);
});

test("goal audio timestamp materializer CLI scopes inspect-only runs to requested stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-cli-scope-"));
  const workbenchPath = path.join(root, "audio_timestamp_workbench.json");
  await fs.outputJson(workbenchPath, {
    local_tts: { verdict: "green", ready: true },
    jobs: [
      {
        story_id: "blocked-motion",
        title: "Star Wars Still Needs Motion",
        status: "requires_audio_timestamp_generation",
        artifact_dir: path.join(root, "blocked-motion"),
      },
      {
        story_id: "ready-audio",
        title: "PS5 Prices Need ASR",
        status: "requires_word_timestamp_asr_alignment",
        artifact_dir: path.join(root, "ready-audio"),
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--workbench",
      workbenchPath,
      "--out-dir",
      path.join(root, "out"),
      "--workspace",
      root,
      "--story-id",
      "ready-audio",
      "--inspect-only",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.candidate_count, 1);
  assert.deepEqual(result.report.jobs.map((job) => job.story_id), ["ready-audio"]);
});

test("goal audio timestamp materializer CLI can run in inspect-only mode without TTS side effects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-cli-"));
  const workbenchPath = path.join(root, "audio_timestamp_workbench.json");
  await fs.outputJson(workbenchPath, {
    local_tts: { verdict: "green", ready: true },
    jobs: [
      {
        story_id: "story-cli",
        title: "Star Fox Deal Has One Catch",
        status: "requires_audio_timestamp_generation",
        artifact_dir: path.join(root, "missing-package"),
      },
    ],
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--workbench",
      workbenchPath,
      "--out-dir",
      path.join(root, "out"),
      "--workspace",
      root,
      "--generated-at",
      "2026-05-22T06:16:00.000Z",
      "--inspect-only",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.inspect_only_count, 1);
  assert.equal(result.report.safety.no_tts_generation_triggered, true);
  assert.equal(await fs.pathExists(path.join(root, "out", "audio_timestamp_materialization_report.json")), true);
});

test("goal audio timestamp materializer configures long local TTS batch timeouts", () => {
  const env = {
    LOCAL_TTS_TIMEOUT_MS: "120000",
    LOCAL_TTS_START_WAIT_MS: "45000",
  };
  configureLocalTtsBatchEnv(env);

  assert.equal(env.TTS_PROVIDER, "local");
  assert.equal(env.PULSE_LOCAL_TTS_ONLY, "true");
  assert.equal(env.LOCAL_TTS_TIMEOUT_MS, "900000");
  assert.equal(env.LOCAL_TTS_REQUEST_ATTEMPTS, "1");
  assert.equal(env.LOCAL_TTS_START_WAIT_MS, "120000");
  assert.equal(env.LOCAL_TTS_PREWARM_TIMEOUT_MS, "600000");
  assert.equal(env.LOCAL_WHISPER_MODELS, "tiny.en,base.en,small.en");
});

test("goal audio timestamp materializer auto mode keeps local Liam as the default voice path", () => {
  const env = {
    TTS_PROVIDER: "elevenlabs",
    LOCAL_TTS_TIMEOUT_MS: "120000",
  };

  configureGoalTtsBatchEnv(env, { provider: "auto" });

  assert.equal(env.TTS_PROVIDER, "local");
  assert.equal(env.PULSE_LOCAL_TTS_ONLY, "true");
  assert.equal(env.LOCAL_TTS_TIMEOUT_MS, "900000");
});

test("goal audio timestamp materializer can select ElevenLabs without local-only flags", () => {
  const env = {
    TTS_PROVIDER: "local",
    PULSE_LOCAL_TTS_ONLY: "true",
  };

  configureGoalTtsBatchEnv(env, { provider: "elevenlabs" });

  assert.equal(env.TTS_PROVIDER, "elevenlabs");
  assert.equal(Object.prototype.hasOwnProperty.call(env, "PULSE_LOCAL_TTS_ONLY"), false);
});
