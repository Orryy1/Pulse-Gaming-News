"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  refreshBridgeCandidateMetadata,
} = require("../../lib/bridge-candidate-metadata-refresh");
const {
  parseArgs,
} = require("../../tools/bridge-candidate-metadata-refresh");

test("bridge candidate metadata refresh updates stale duration from current manifests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-meta-refresh-"));
  const artifactDir = path.join(root, "story-a");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    rendered_duration_s: 50.975,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    audio_duration_seconds: 50.64,
  });
  const bridgePath = path.join(root, "scheduler_bridge_candidates.json");
  await fs.writeJson(bridgePath, {
    scheduler_bridge_candidates: [
      {
        id: "story_a",
        title: "Story A",
        scheduler_bridge_source: "goal_production_cutover",
        scheduler_bridge_artifact_dir: artifactDir,
        duration_seconds: 40.921,
        audio_duration: 40.921,
      },
      {
        id: "story_b",
        duration_seconds: 42,
      },
    ],
  });

  const report = await refreshBridgeCandidateMetadata({
    bridgePath,
    storyIds: ["story_a"],
    generatedAt: "2026-06-18T10:00:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.refreshed_count, 1);
  assert.equal(report.summary.blocked_count, 0);
  assert.deepEqual(report.rows[0].before, {
    duration_seconds: 40.921,
    audio_duration: 40.921,
    video_duration_seconds: null,
    final_duration_seconds: null,
  });
  assert.deepEqual(report.rows[0].after, {
    duration_seconds: 50.975,
    audio_duration: 50.64,
    video_duration_seconds: 50.975,
    final_duration_seconds: 50.975,
    platform_manifest_refreshed: false,
  });
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_publish_triggered, true);

  const updated = await fs.readJson(bridgePath);
  assert.equal(updated.scheduler_bridge_candidates[0].duration_seconds, 50.975);
  assert.equal(updated.scheduler_bridge_candidates[0].audio_duration, 50.64);
  assert.equal(updated.scheduler_bridge_candidates[0].bridge_metadata_refresh_source, "current_render_audio_manifests");
  assert.equal(updated.scheduler_bridge_candidates[1].duration_seconds, 42);
});

test("bridge candidate metadata refresh updates embedded platform manifest from artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-platform-refresh-"));
  const artifactDir = path.join(root, "story-a");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), { duration_seconds: 41.2 });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Steam Next Fest Turns Demos Into A Trust Fight",
        description:
          "Steam Next Fest is turning demos into a public trust test for PC games. Source: Steam.",
        cover_frame: { headline: "STEAM NEXT FEST TRUST TEST" },
      },
    },
  });
  const bridgePath = path.join(root, "scheduler_bridge_candidates.json");
  await fs.writeJson(bridgePath, {
    scheduler_bridge_candidates: [
      {
        id: "story_a",
        scheduler_bridge_artifact_dir: artifactDir,
        duration_seconds: 40,
        platform_publish_manifest: {
          outputs: {
            youtube_shorts: {
              description:
                "Steam Next Fest: Confirmed Drop. Source: Steam. Sources and related links: /p/steam",
              cover_frame: { headline: "STEAM NEXT FEST" },
            },
          },
        },
      },
    ],
  });

  const report = await refreshBridgeCandidateMetadata({
    bridgePath,
    storyIds: ["story_a"],
    generatedAt: "2026-06-19T14:20:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.refreshed_count, 1);
  assert.equal(report.rows[0].after.platform_manifest_refreshed, true);
  const updated = await fs.readJson(bridgePath);
  const output = updated.scheduler_bridge_candidates[0].platform_publish_manifest.outputs.youtube_shorts;
  assert.match(output.description, /public trust test/i);
  assert.doesNotMatch(output.description, /Confirmed Drop|Sources and related links/i);
  assert.equal(output.cover_frame.headline, "STEAM NEXT FEST TRUST TEST");
  assert.equal(
    updated.scheduler_bridge_candidates[0].bridge_metadata_refresh_platform_manifest_path,
    path.join(artifactDir, "platform_publish_manifest.json"),
  );
});

test("bridge candidate metadata refresh updates stale copy and narration QA from artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-copy-refresh-"));
  const artifactDir = path.join(root, "story-gta");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    rendered_duration_s: 39.102,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    duration_seconds: 39.102,
    word_timestamp_source: "local_whisper_word_alignment",
  });
  await fs.writeJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    generated_at: "2026-06-27T04:52:34.589Z",
    cadence: {
      spoken_wpm: 167.3,
      duration_seconds: 39.102,
    },
  });
  await fs.writeJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "ready",
    display_text:
      "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument.",
  });
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story_gta",
    selected_title: "GTA VI Starts The Preorder Fight",
    narration_script:
      "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument.",
    full_script:
      "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument.",
    tts_script:
      "Rockstar just turned Rockstar's next Grand Theft Auto pre-orders into a buy, wait or skip argument.",
    spoken_narration_script:
      "Rockstar just turned Rockstar's next Grand Theft Auto pre-orders into a buy, wait or skip argument.",
    first_spoken_line:
      "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument.",
    thumbnail_headline: "GTA VI PREORDER FIGHT",
  });
  const bridgePath = path.join(root, "scheduler_bridge_candidates.json");
  await fs.writeJson(bridgePath, {
    scheduler_bridge_candidates: [
      {
        id: "story_gta",
        title: "GTA VI Starts The Preorder Fight",
        scheduler_bridge_artifact_dir: artifactDir,
        duration_seconds: 37.338,
        narration_script: "Grand Theft Auto VI now has one real preorder catch.",
        full_script: "Grand Theft Auto VI now has one real preorder catch.",
        tts_script: "Grand Theft Auto VI now has one real preorder catch.",
        voice_quality_report: {
          verdict: "PASS",
          generated_at: "2026-06-26T07:54:11.652Z",
          cadence: {
            spoken_wpm: 137.6,
            duration_seconds: 44.489,
          },
        },
      },
    ],
  });

  const report = await refreshBridgeCandidateMetadata({
    bridgePath,
    storyIds: ["story_gta"],
    generatedAt: "2026-06-27T05:10:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.refreshed_count, 1);
  assert.equal(report.rows[0].after.copy_refreshed, true);
  assert.equal(report.rows[0].after.voice_quality_refreshed, true);
  assert.equal(report.rows[0].after.caption_manifest_refreshed, true);
  const updated = await fs.readJson(bridgePath);
  const story = updated.scheduler_bridge_candidates[0];
  assert.equal(
    story.tts_script,
    "Rockstar just turned Rockstar's next Grand Theft Auto pre-orders into a buy, wait or skip argument.",
  );
  assert.equal(
    story.first_spoken_line,
    "Rockstar just turned Rockstar's next Grand Theft Auto pre-orders into a buy, wait or skip argument.",
  );
  assert.equal(story.voice_quality_report.cadence.duration_seconds, 39.102);
  assert.equal(story.caption_manifest.display_text, "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument.");
  assert.equal(story.thumbnail_headline, "GTA VI PREORDER FIGHT");
});

test("bridge candidate metadata refresh dry-run leaves bridge file unchanged", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-meta-dry-"));
  const artifactDir = path.join(root, "story-a");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), { duration_seconds: 51 });
  const bridgePath = path.join(root, "scheduler_bridge_candidates.json");
  await fs.writeJson(bridgePath, {
    scheduler_bridge_candidates: [
      { id: "story_a", scheduler_bridge_artifact_dir: artifactDir, duration_seconds: 40 },
    ],
  });

  const report = await refreshBridgeCandidateMetadata({
    bridgePath,
    storyIds: ["story_a"],
    apply: false,
  });

  assert.equal(report.summary.refreshed_count, 1);
  const unchanged = await fs.readJson(bridgePath);
  assert.equal(unchanged.scheduler_bridge_candidates[0].duration_seconds, 40);
});

test("bridge candidate metadata refresh CLI parses scoped apply args", () => {
  const args = parseArgs([
    "--bridge",
    "output/goal-contract/scheduler_bridge_candidates.json",
    "--story-id",
    "fresh_gears_eday_pc_specs_20260616",
    "--apply",
    "--json",
  ]);

  assert.equal(args.bridgePath, "output/goal-contract/scheduler_bridge_candidates.json");
  assert.deepEqual(args.storyIds, ["fresh_gears_eday_pc_specs_20260616"]);
  assert.equal(args.apply, true);
  assert.equal(args.json, true);
});
