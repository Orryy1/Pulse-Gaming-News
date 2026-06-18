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
  });
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_publish_triggered, true);

  const updated = await fs.readJson(bridgePath);
  assert.equal(updated.scheduler_bridge_candidates[0].duration_seconds, 50.975);
  assert.equal(updated.scheduler_bridge_candidates[0].audio_duration, 50.64);
  assert.equal(updated.scheduler_bridge_candidates[0].bridge_metadata_refresh_source, "current_render_audio_manifests");
  assert.equal(updated.scheduler_bridge_candidates[1].duration_seconds, 42);
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
