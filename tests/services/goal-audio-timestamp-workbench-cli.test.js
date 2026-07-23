"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal-audio-timestamp-workbench");

test("goal audio timestamp workbench CLI parses local dry-run arguments", () => {
  const args = parseArgs([
    "--work-order",
    "work-order.json",
    "--story-packages",
    "story-packages.json",
    "--local-tts-doctor",
    "doctor.json",
    "--out-dir",
    "out",
    "--generated-at",
    "2026-05-22T05:15:00.000Z",
    "--story-id",
    "story-one",
    "--story-id",
    "story-two",
    "--provider",
    "elevenlabs",
    "--json",
  ]);

  assert.equal(args.workOrderPath, "work-order.json");
  assert.equal(args.storyPackagesPath, "story-packages.json");
  assert.equal(args.localTtsDoctorPath, "doctor.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.generatedAt, "2026-05-22T05:15:00.000Z");
  assert.deepEqual(args.storyIds, ["story-one", "story-two"]);
  assert.equal(args.provider, "elevenlabs");
  assert.equal(args.json, true);
});

test("goal audio timestamp workbench CLI discovers missing narration directly from story packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-cli-packages-"));
  const artifactDir = path.join(root, "goal-proof-batch", "fresh-story");
  const storyPackagesPath = path.join(root, "story-packages.json");
  const doctorPath = path.join(root, "local_tts_doctor.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "fresh-story",
    title: "Fresh First-Party Story",
    narration_script:
      "A verified first-party announcement now has a direct path into narration production.",
  });
  await fs.outputJson(storyPackagesPath, [
    {
      story_id: "fresh-story",
      artifact_dir: artifactDir,
    },
  ]);
  await fs.outputJson(doctorPath, {
    generated_at: "2026-07-23T12:00:00.000Z",
    verdict: "green",
    ready: true,
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--story-packages",
      storyPackagesPath,
      "--local-tts-doctor",
      doctorPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-07-23T12:01:00.000Z",
      "--provider",
      "local",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.story_count, 1);
  assert.equal(result.report.summary.requires_generation_count, 1);
  assert.equal(result.report.jobs[0].story_id, "fresh-story");
  assert.equal(result.report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.equal(result.report.jobs[0].tts_provider, "local");
  assert.equal(result.report.safety.no_tts_generation_triggered, true);
});

test("goal audio timestamp workbench CLI scopes reports to requested stories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-cli-scope-"));
  const workOrderPath = path.join(root, "render_input_work_order.json");
  const doctorPath = path.join(root, "local_tts_doctor.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "blocked-motion",
        title: "Star Wars Still Needs Motion",
        status: "blocked_on_render_inputs",
        blockers: ["visual_evidence:direct_video_motion_missing"],
        actions: [{ action_id: "materialise_validated_real_motion_clips" }],
      },
      {
        story_id: "ready-audio",
        title: "PS5 Prices Need ASR",
        status: "blocked_on_render_inputs",
        blockers: ["word_timestamps_not_asr_aligned"],
        actions: [{ action_id: "generate_final_narration_audio_and_word_timestamps" }],
      },
    ],
  });
  await fs.outputJson(doctorPath, { verdict: "green", ready: true });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--local-tts-doctor",
      doctorPath,
      "--out-dir",
      outDir,
      "--story-id",
      "ready-audio",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.story_count, 1);
  assert.deepEqual(result.report.jobs.map((job) => job.story_id), ["ready-audio"]);
});

test("goal audio timestamp workbench CLI writes reports without TTS or publish side effects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-cli-"));
  const workOrderPath = path.join(root, "render_input_work_order.json");
  const doctorPath = path.join(root, "local_tts_doctor.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(workOrderPath, {
    jobs: [
      {
        story_id: "story-cli",
        title: "Star Fox Deal Has One Catch",
        status: "blocked_on_render_inputs",
        blockers: ["final_narration_audio_missing", "word_timestamps_missing"],
        actions: [{ action_id: "generate_final_narration_audio_and_word_timestamps" }],
      },
    ],
  });
  await fs.outputJson(doctorPath, {
    verdict: "red",
    failure_code: "server_down",
    reason: "local TTS HTTP health is unreachable",
  });

  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--work-order",
      workOrderPath,
      "--local-tts-doctor",
      doctorPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-22T05:16:00.000Z",
      "--provider",
      "local",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.report.summary.blocked_local_tts_count, 1);
  assert.equal(await fs.pathExists(path.join(outDir, "audio_timestamp_workbench.json")), true);
  assert.equal(await fs.pathExists(path.join(outDir, "audio_timestamp_workbench.md")), true);
  assert.equal(result.report.safety.no_tts_generation_triggered, true);
  assert.equal(result.report.safety.no_publish_triggered, true);
});
