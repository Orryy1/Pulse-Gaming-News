"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoal07DirectorBrain,
  writeGoal07DirectorBrain,
} = require("../../lib/goal07-director-brain");

async function makePackage(root, storyId, directorPlan) {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    canonical_subject: "Forza Horizon 6",
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), directorPlan);
  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    artefacts: ["canonical_story_manifest.json", "director_beat_map.json"],
  };
}

function readyDirectorPlan(storyId = "story-director") {
  return {
    schema_version: 1,
    story_id: storyId,
    execution_mode: "visual_v4_director_brain",
    local_only: true,
    readiness: {
      status: "director_ready",
      blockers: [],
      warnings: [],
    },
    shot_budget: {
      min_actual_motion_clips: 5,
      available_motion_clips: 5,
      min_distinct_motion_families: 4,
      available_distinct_motion_families: 5,
      max_static_card_ratio: 0.28,
      max_static_card_seconds: 14,
      target_motion_ratio: 0.64,
    },
    shot_plan: [
      {
        id: "hook_slam",
        kind: "hook_slam",
        startS: 0,
        durationS: 1.1,
        label: "THE HEADLINE",
        visual_treatment: "instant motion hit, no text stack",
      },
      {
        id: "motion_clip_01",
        kind: "motion_clip",
        startS: 0.35,
        durationS: 3,
        source_family: "steam",
        media_path: "output/video/clip-1.mp4",
      },
      {
        id: "source_lock",
        kind: "source_lock",
        startS: 2.2,
        durationS: 2,
        source: "IGN",
        visual_treatment: "large readable source bug",
      },
      {
        id: "proof_card",
        kind: "proof_card",
        startS: 4.6,
        durationS: 2,
        label: "SOURCE LOCKED",
      },
      {
        id: "motion_clip_02",
        kind: "motion_clip",
        startS: 7,
        durationS: 3,
        source_family: "xbox",
        media_path: "output/video/clip-2.mp4",
      },
      {
        id: "motion_clip_03",
        kind: "motion_clip",
        startS: 13,
        durationS: 3,
        source_family: "steamdb",
        media_path: "output/video/clip-3.mp4",
      },
      {
        id: "motion_clip_04",
        kind: "motion_clip",
        startS: 20,
        durationS: 3,
        source_family: "publisher",
        media_path: "output/video/clip-4.mp4",
      },
      {
        id: "motion_clip_05",
        kind: "motion_clip",
        startS: 28,
        durationS: 3,
        source_family: "gameplay",
        media_path: "output/video/clip-5.mp4",
      },
    ],
    sound_transition_plan: {
      duration_s: 42,
      readiness: { verdict: "pass", blockers: [], warnings: [] },
    },
    transition_plan: {
      planned: [
        { into: "motion_clip_01", atS: 0.31, family: "speed_ramp" },
        { into: "source_lock", atS: 2.16, family: "source_wipe" },
        { into: "proof_card", atS: 4.56, family: "hard_cut" },
        { into: "motion_clip_02", atS: 6.96, family: "whip_pan" },
      ],
      max_same_transition_run: 1,
    },
    sfx_plan: {
      cue_count: 8,
      cues: [
        { id: "sfx_01", target: "hook_slam", target_kind: "hook_slam", atS: 0, family: "impact" },
        { id: "sfx_02", target: "motion_clip_01", target_kind: "motion_clip", atS: 0.35, family: "whoosh" },
        { id: "sfx_03", target: "source_lock", target_kind: "source_lock", atS: 2.2, family: "source_tick" },
        { id: "sfx_04", target: "proof_card", target_kind: "proof_card", atS: 4.6, family: "transition_hit" },
        { id: "sfx_05", target: "motion_clip_02", target_kind: "motion_clip", atS: 7, family: "whoosh" },
        { id: "sfx_06", target: "motion_clip_03", target_kind: "motion_clip", atS: 13, family: "transition_hit" },
        { id: "sfx_07", target: "motion_clip_04", target_kind: "motion_clip", atS: 20, family: "whoosh" },
        { id: "sfx_08", target: "motion_clip_05", target_kind: "motion_clip", atS: 28, family: "transition_hit" },
      ],
      max_same_family_run: 1,
      mastering: {
        duck_under_narration: true,
        local_only: true,
      },
    },
    visual_obligations: {
      forbid_empty_rectangles: true,
      forbid_text_on_text: true,
      source_locks_must_be_readable: true,
      use_actual_motion_before_static_cards: true,
    },
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

test("Goal 07 director brain passes a timed plan with early visual change, motion and SFX alignment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-ready-"));
  const storyPackage = await makePackage(root, "story-ready", readyDirectorPlan("story-ready"));

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:10:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.ready_story_count, 1);
  assert.equal(report.stories[0].status, "ready");
  assert.equal(report.timeline_plan.stories[0].timeline.length, 8);
  assert.equal(report.retention_intent_map.stories[0].first_1_5s_visual_change, true);
  assert.equal(report.retention_intent_map.stories[0].first_3s_strength, "strong");
});

test("Goal 07 director brain blocks upstream director holds without pretending the plan is ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-upstream-"));
  const blocked = readyDirectorPlan("story-blocked");
  blocked.readiness = {
    status: "director_blocked",
    blockers: ["actual_motion_clip_minimum_not_met", "distinct_motion_families_minimum_not_met"],
  };
  const storyPackage = await makePackage(root, "story-blocked", blocked);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:11:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].blockers.includes("director:actual_motion_clip_minimum_not_met"));
  assert.ok(report.stories[0].blockers.includes("director:distinct_motion_families_minimum_not_met"));
});

test("Goal 07 director brain blocks weak first seconds, card-heavy edits and missing SFX coverage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-weak-"));
  const weak = readyDirectorPlan("story-weak");
  weak.shot_plan = [
    { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 2.8 },
    { id: "source_lock", kind: "source_lock", startS: 3.2, durationS: 3, source: "SOURCE", visual_treatment: "tiny bug" },
    { id: "proof_1", kind: "proof_card", startS: 6.5, durationS: 5 },
    { id: "proof_2", kind: "proof_card", startS: 12, durationS: 5 },
  ];
  weak.sfx_plan = { cues: [{ target: "hook_slam", atS: 0, family: "impact" }], cue_count: 1 };
  const storyPackage = await makePackage(root, "story-weak", weak);

  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:12:00.000Z",
  });

  const blockers = report.stories[0].blockers;
  assert.equal(report.verdict, "BLOCKED");
  assert.ok(blockers.includes("director:no_visual_change_first_1_5s"));
  assert.ok(blockers.includes("director:weak_first_3s"));
  assert.ok(blockers.includes("director:too_many_card_only_beats"));
  assert.ok(blockers.includes("director:source_lock_not_readable"));
  assert.ok(blockers.includes("director:sfx_alignment_missing"));
});

test("Goal 07 director brain writes readiness, beat map, timeline and retention artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal07-write-"));
  const storyPackage = await makePackage(root, "story-write", readyDirectorPlan("story-write"));
  const report = await buildGoal07DirectorBrain({
    storyPackages: [storyPackage],
    workspaceRoot: root,
    outputDir: path.join(root, "goal-07"),
    generatedAt: "2026-05-25T22:13:00.000Z",
  });

  const written = await writeGoal07DirectorBrain(report, {
    outputDir: path.join(root, "goal-07"),
  });

  assert.equal(await fs.pathExists(written.readinessJson), true);
  assert.equal(await fs.pathExists(written.readinessMarkdown), true);
  assert.equal(await fs.pathExists(written.directorBeatMap), true);
  assert.equal(await fs.pathExists(written.timelinePlan), true);
  assert.equal(await fs.pathExists(written.retentionIntentMap), true);
  const markdown = await fs.readFile(written.readinessMarkdown, "utf8");
  assert.match(markdown, /Goal 07 Director Brain/);
  assert.match(markdown, /story-write: ready/);
});
