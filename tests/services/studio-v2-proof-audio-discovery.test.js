"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  discoverLocalAudioProofReport,
} = require("../../lib/ops/studio-v2-proof-audio-discovery");
const {
  buildStudioV2ProofCandidateReport,
} = require("../../lib/ops/studio-v2-proof-candidates");

function story(id) {
  return {
    id,
    title: "GTA 6 trailer evidence is stacking up",
    approved: true,
    breaking_score: 82,
    full_script: "GTA 6 has a confirmed clue today. ".repeat(32),
  };
}

function assetReport(storyId) {
  return {
    plans: [
      {
        story_id: storyId,
        would_fetch: Array.from({ length: 6 }, (_, index) => ({
          id: `${storyId}_asset_${index}`,
          subject_match_quality: index % 2 === 0 ? "exact_game_match" : "exact_franchise_match",
          exact_subject_group: index % 2 === 0 ? "GTA" : "Red Dead",
          counted_for_premium: true,
          local_path: `test/output/assets/${storyId}_${index}.jpg`,
        })),
      },
    ],
  };
}

function frameReport(storyId) {
  return {
    plans: [
      {
        story_id: storyId,
        frames: Array.from({ length: 3 }, (_, index) => ({
          status: "accepted",
          entity: index % 2 === 0 ? "GTA" : "Red Dead",
          local_path: `test/output/frames/${storyId}_${index}.jpg`,
          qa: { verdict: "pass", failures: [] },
        })),
      },
    ],
  };
}

function segmentReport(storyId) {
  return {
    segments: Array.from({ length: 3 }, (_, index) => ({
      story_id: storyId,
      source_url: `https://video.example.test/${storyId}_${index}.m3u8`,
      entity: ["GTA", "Red Dead", "BioShock"][index % 3],
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
    })),
  };
}

test("local audio proof discovery finds existing Liam extension MP3s under MEDIA_ROOT", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-liam-discovery-"));
  const relDir = path.join("test", "output", "local-script-extension", "audio");
  const audioDir = path.join(root, relDir);
  await fs.ensureDir(audioDir);
  await fs.writeFile(path.join(audioDir, "1t186u4_liam_extended.mp3"), "fake mp3 bytes");
  await fs.writeJson(path.join(audioDir, "1t186u4_liam_extended_timestamps.json"), []);

  const report = await discoverLocalAudioProofReport({
    mediaRoot: root,
    repoRoot: path.join(root, "repo"),
    durationProbe: () => 66.56,
  });

  assert.equal(report.applied.length, 1);
  assert.equal(report.applied[0].story_id, "1t186u4");
  assert.equal(
    report.applied[0].output_audio_path,
    "test/output/local-script-extension/audio/1t186u4_liam_extended.mp3",
  );
  assert.equal(report.applied[0].duration_verdict, "pass");
});

test("proof candidates can use discovered Liam audio even when the latest apply report was overwritten", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-liam-candidate-"));
  const relDir = path.join("test", "output", "local-script-extension", "audio");
  const audioDir = path.join(root, relDir);
  await fs.ensureDir(audioDir);
  await fs.writeFile(path.join(audioDir, "ready_story_liam_extended.mp3"), "fake mp3 bytes");

  const discovered = await discoverLocalAudioProofReport({
    mediaRoot: root,
    repoRoot: path.join(root, "repo"),
    durationProbe: () => 66.4,
  });

  const report = buildStudioV2ProofCandidateReport({
    stories: [story("ready_story")],
    localAudioReports: [discovered],
    assetReports: [assetReport("ready_story")],
    frameReports: [frameReport("ready_story")],
    segmentValidationReports: [segmentReport("ready_story")],
  });

  assert.equal(report.candidates[0].audio.status, "approved_local_liam_audio_ready");
  assert.equal(report.candidates[0].verdict, "ready_flash_proof");
});
