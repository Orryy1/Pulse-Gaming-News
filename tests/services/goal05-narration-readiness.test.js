"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal05NarrationReadiness,
  writeGoal05NarrationReadiness,
} = require("../../lib/goal05-narration-readiness");

async function makeReadyPackage(root, storyId = "story-audio", overrides = {}) {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const audioDir = path.join(root, "output", "audio");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Star Fox Deal Has One Catch",
    narration_script: "Star Fox just got a sharper Switch camera deal.",
    ...overrides.canonical,
  });
  await fs.outputFile(path.join(audioDir, `${storyId}.mp3`), Buffer.alloc(4096, 1));
  await fs.outputJson(path.join(audioDir, `${storyId}_timestamps.json`), {
    words: [
      { word: "Star", start: 0, end: 0.2 },
      { word: "Fox", start: 0.22, end: 0.5 },
      { word: "just", start: 0.52, end: 0.8 },
      { word: "got", start: 0.82, end: 1.0 },
      { word: "sharper", start: 1.02, end: 1.4 },
      { word: "Switch", start: 1.42, end: 1.8 },
      { word: "camera", start: 1.82, end: 2.2 },
      { word: "deal", start: 2.22, end: 2.5 },
    ],
  });
  return artifactDir;
}

function readyJob(root, storyId, artifactDir) {
  return {
    story_id: storyId,
    title: "Star Fox Deal Has One Catch",
    artifact_dir: artifactDir,
    status: "ready_audio_timestamp_pair",
    audio: {
      path: path.join(root, "output", "audio", `${storyId}.mp3`),
      exists: true,
      usable: true,
      size_bytes: 4096,
    },
    timestamps: {
      path: path.join(root, "output", "audio", `${storyId}_timestamps.json`),
      exists: true,
      usable: true,
      word_count: 8,
    },
  };
}

test("Goal 05 readiness creates transcript, caption and quality proof for a ready pair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal05-ready-"));
  const artifactDir = await makeReadyPackage(root, "story-audio");

  const report = await buildGoal05NarrationReadiness({
    workspaceRoot: root,
    outputDir: path.join(root, "goal-05"),
    workbenchReport: {
      local_tts: { verdict: "green", ready: true, failure_code: null },
      jobs: [readyJob(root, "story-audio", artifactDir)],
    },
    generatedAt: "2026-05-25T19:45:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.ready_story_count, 1);
  assert.equal(report.stories[0].status, "ready");
  assert.equal(report.stories[0].proof.transcript_exists, true);
  assert.equal(report.stories[0].proof.srt_exists, true);
  assert.equal(report.stories[0].voice_quality_report.verdict, "PASS");
  assert.equal(await fs.pathExists(report.stories[0].transcript_path), true);
  assert.equal(await fs.pathExists(report.stories[0].caption_srt_path), true);
  const srt = await fs.readFile(report.stories[0].caption_srt_path, "utf8");
  assert.match(srt, /00:00:00,000 --> 00:00:02,500/);
  assert.match(srt, /Star Fox just got sharper Switch camera deal/);
});

test("Goal 05 readiness blocks malformed timestamp files without creating false-ready captions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal05-malformed-"));
  const artifactDir = await makeReadyPackage(root, "story-bad");
  await fs.outputJson(path.join(root, "output", "audio", "story-bad_timestamps.json"), {
    alignment: { characters: ["S", "t", "a", "r"] },
  });

  const report = await buildGoal05NarrationReadiness({
    workspaceRoot: root,
    outputDir: path.join(root, "goal-05"),
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [readyJob(root, "story-bad", artifactDir)],
    },
    generatedAt: "2026-05-25T19:46:00.000Z",
  });

  assert.equal(report.verdict, "PARTIAL");
  assert.equal(report.summary.blocked_story_count, 1);
  assert.equal(report.stories[0].status, "blocked");
  assert.ok(report.stories[0].blockers.includes("word_timestamps_missing_or_malformed"));
  assert.equal(report.stories[0].proof.srt_exists, false);
});

test("Goal 05 readiness keeps TTS failures as blocked work instead of silent passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal05-tts-fail-"));

  const report = await buildGoal05NarrationReadiness({
    workspaceRoot: root,
    outputDir: path.join(root, "goal-05"),
    workbenchReport: {
      local_tts: {
        verdict: "red",
        ready: false,
        failure_code: "server_down",
        reason: "local TTS HTTP health is unreachable",
      },
      jobs: [
        {
          story_id: "story-missing",
          title: "Missing Audio",
          status: "blocked_local_tts_unreachable",
          missing: ["narration_audio", "word_timestamps"],
        },
      ],
    },
    generatedAt: "2026-05-25T19:47:00.000Z",
  });

  assert.equal(report.verdict, "PARTIAL");
  assert.equal(report.summary.tts_blocked_story_count, 1);
  assert.equal(report.stories[0].status, "blocked");
  assert.ok(report.stories[0].blockers.includes("tts_unavailable"));
});

test("Goal 05 readiness writes the required machine and human proof artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal05-write-"));
  const artifactDir = await makeReadyPackage(root, "story-write");
  const report = await buildGoal05NarrationReadiness({
    workspaceRoot: root,
    outputDir: path.join(root, "goal-05"),
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [readyJob(root, "story-write", artifactDir)],
    },
    generatedAt: "2026-05-25T19:48:00.000Z",
  });

  const written = await writeGoal05NarrationReadiness(report, {
    outputDir: path.join(root, "goal-05"),
  });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.captionManifest), true);
  assert.equal(await fs.pathExists(written.voiceQualityReport), true);
  const markdown = await fs.readFile(written.readinessMarkdown, "utf8");
  assert.match(markdown, /Goal 05 Narration Readiness/);
  assert.match(markdown, /story-write: ready/);
});
