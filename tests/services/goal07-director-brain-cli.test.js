"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
} = require("../../tools/goal07-director-brain");

function directorPlan(storyId) {
  return {
    schema_version: 1,
    story_id: storyId,
    readiness: { status: "director_ready", blockers: [] },
    shot_budget: {
      min_actual_motion_clips: 2,
      min_distinct_motion_families: 2,
      max_static_card_ratio: 0.4,
      max_static_card_seconds: 12,
    },
    shot_plan: [
      { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 1 },
      { id: "motion_1", kind: "motion_clip", startS: 0.4, durationS: 3, source_family: "steam", media_path: "clip1.mp4" },
      { id: "source_lock", kind: "source_lock", startS: 2.2, durationS: 2, source: "IGN", visual_treatment: "large readable source bug" },
      { id: "motion_2", kind: "motion_clip", startS: 6, durationS: 3, source_family: "xbox", media_path: "clip2.mp4" },
    ],
    sound_transition_plan: { duration_s: 32, readiness: { verdict: "pass", blockers: [] } },
    transition_plan: { planned: [{ into: "motion_1", family: "speed_ramp" }], max_same_transition_run: 1 },
    sfx_plan: {
      cues: [
        { target: "hook_slam", atS: 0, family: "impact" },
        { target: "motion_1", atS: 0.4, family: "whoosh" },
        { target: "source_lock", atS: 2.2, family: "source_tick" },
        { target: "motion_2", atS: 6, family: "transition_hit" },
      ],
    },
    visual_obligations: { source_locks_must_be_readable: true },
    caption_policy: {
      subtitles_last: true,
      clean_manual_captions: true,
      avoid_lower_third_collisions: true,
    },
    safety: {
      planner_only: true,
      social_posting_triggered: false,
      oauth_triggered: false,
      production_db_mutated: false,
    },
  };
}

test("Goal 07 director brain CLI parses package and output arguments", () => {
  const args = parseArgs([
    "--story-packages",
    "packages.json",
    "--out-dir",
    "out",
    "--workspace",
    ".",
    "--generated-at",
    "2026-05-25T22:14:00.000Z",
    "--json",
  ]);

  assert.equal(args.storyPackagesPath, "packages.json");
  assert.equal(args.outDir, "out");
  assert.equal(args.workspaceRoot, ".");
  assert.equal(args.generatedAt, "2026-05-25T22:14:00.000Z");
  assert.equal(args.json, true);
});

test("Goal 07 director brain CLI writes proof reports from a story package manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-cli-"));
  const artifactDir = path.join(root, "package", "story-cli");
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-cli",
    selected_title: "Switch 2 Upgrade Path Gets Clearer",
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), directorPlan("story-cli"));
  const packagesPath = path.join(root, "packages.json");
  const outDir = path.join(root, "out");
  await fs.writeJson(packagesPath, [{ story_id: "story-cli", artifact_dir: artifactDir }], { spaces: 2 });

  const { report, written } = await main([
    "--story-packages",
    packagesPath,
    "--out-dir",
    outDir,
    "--workspace",
    root,
    "--generated-at",
    "2026-05-25T22:15:00.000Z",
    "--json",
  ]);

  assert.equal(report.verdict, "PASS");
  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(path.join(outDir, "timeline_plan.json")), true);
  assert.equal((await fs.readJson(path.join(outDir, "retention_intent_map.json"))).stories[0].first_1_5s_visual_change, true);
});
