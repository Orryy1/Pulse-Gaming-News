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
    title: "GTA and Red Dead trailer evidence is stacking up",
    approved: true,
    breaking_score: 82,
    full_script: "GTA and Red Dead have a confirmed Take-Two clue today. ".repeat(32),
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
        frames: Array.from({ length: 10 }, (_, index) => ({
          status: "accepted",
          entity: index % 2 === 0 ? "GTA" : "Red Dead",
          source_url: `https://video.example.test/${storyId}_${index}.m3u8`,
          source_type: "steam_movie",
          target_time_seconds: 44 + index,
          local_path: `test/output/frames/${storyId}_${index}.jpg`,
          qa: {
            verdict: "pass",
            failures: [],
            prescan: {
              edge_density: 0.24,
              saturation_mean: 0.46,
              text_overlay_likelihood: 0.04,
              white_text_on_dark_likelihood: 0,
            },
          },
        })),
      },
    ],
  };
}

function segmentReport(storyId) {
  return {
    segments: Array.from({ length: 10 }, (_, index) => ({
      story_id: storyId,
      source_url: `https://video.example.test/${storyId}_${index}.m3u8`,
      entity: ["GTA", "Red Dead", "BioShock"][index % 3],
      media_start_s: 48 + index * 5,
      duration_s: 5,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      segment_motion_class: "gameplay_action",
      action_score: 82,
      action_sample_count: 3,
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
  await fs.writeJson(path.join(audioDir, "ready_story_liam_extended_timestamps.json"), []);
  await fs.writeJson(path.join(audioDir, "ready_story_liam_extended_proof.json"), {
    text_word_count: 190,
    wpm: 172,
    acoustic: { medianPitchHz: 107 },
    transcript: "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
    local_voice_metadata: "stamped",
    local_voice_reference: {
      id: "pulse-sleepy-liam-20260502",
      fileName: "pulse_liam_sleepy.wav",
      referencePresent: true,
    },
  });

  const discovered = await discoverLocalAudioProofReport({
    mediaRoot: root,
    repoRoot: path.join(root, "repo"),
    durationProbe: () => 66.4,
  });

  assert.equal(discovered.applied[0].proof_sidecar_path.endsWith("_proof.json"), true);
  assert.equal(discovered.applied[0].local_voice_reference.referencePresent, true);

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
