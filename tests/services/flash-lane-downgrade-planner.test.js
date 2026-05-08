"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildFlashLaneDowngradePlan,
  renderFlashLaneDowngradePlanMarkdown,
  recommendationForRow,
} = require("../../lib/ops/flash-lane-downgrade-planner");

const ROOT = path.resolve(__dirname, "..", "..");

function row(overrides = {}) {
  return {
    story_id: "story_motion_lite",
    title: "GTA 6 Owner Passed On A Legacy Franchise",
    stage: "needs_alternate_official_motion_source",
    distance_to_local_proof: "one_blocker",
    blocking_dimensions: ["alternate_official_source"],
    audio: {
      ready: true,
      status: "approved_local_liam_audio_ready",
      duration_seconds: 66.2,
      output_audio_path: "test/output/audio/story_motion_lite.mp3",
    },
    visuals: {
      exact_subject_count: 39,
      exact_subject_groups: ["GTA", "BioShock", "Red Dead"],
      story_entities: ["GTA", "BioShock", "Red Dead"],
      validated_entities: ["GTA", "BioShock", "Red Dead"],
      validated_clip_ref_count: 9,
      validated_clip_source_count: 4,
      missing_motion_entities: [],
      clip_dominance_shortfall_seconds: 10.24,
      visual_evidence_gate_ready: true,
    },
    ...overrides,
  };
}

test("downgrade planner routes motion-dominance-only Flash blockers to standard motion-lite", () => {
  const plan = buildFlashLaneDowngradePlan({
    currentStateReport: {
      generated_at: "2026-05-08T10:00:00.000Z",
      rows: [row()],
    },
  });
  const rec = plan.rows[0].recommendation;

  assert.equal(rec.verdict, "downgrade_to_standard_short_motion_lite");
  assert.equal(rec.recommended_lane, "pulse_standard_short_motion_lite");
  assert.equal(rec.target_runtime.target_duration_s, 66.2);
  assert.equal(rec.target_runtime.tiktok_60s_eligible, true);
  assert.equal(rec.overlay_story.subreddit, "Pulse");
  assert.equal(rec.overlay_contract.caption_rules.max_lines, 1);
  assert.deepEqual(
    rec.overlay_contract.entity_popups.map((item) => item.entity),
    ["GTA", "BioShock", "Red Dead"],
  );
  assert.equal(plan.summary.downgrade_to_standard_short, 1);
});

test("downgrade planner keeps fully ready Flash candidates in Flash Lane", () => {
  const rec = recommendationForRow(
    row({
      stage: "ready_for_local_flash_proof",
      blocking_dimensions: [],
      distance_to_local_proof: "ready",
    }),
  );

  assert.equal(rec.verdict, "keep_flash_lane");
  assert.equal(rec.recommended_lane, "pulse_flash_lane");
  assert.deepEqual(rec.next_actions, ["render_local_flash_proof"]);
});

test("downgrade planner refuses downgrade until approved Liam audio exists", () => {
  const rec = recommendationForRow(
    row({
      audio: { ready: false, status: "approved_local_liam_audio_missing" },
    }),
  );

  assert.equal(rec.verdict, "blocked_before_downgrade");
  assert.equal(rec.recommended_lane, "hold_until_local_liam_audio_ready");
  assert.match(rec.reason, /approved narration/i);
});

test("downgrade planner sends thin exact-subject visuals away from video", () => {
  const rec = recommendationForRow(
    row({
      visuals: {
        exact_subject_count: 1,
        story_entities: ["GTA"],
        validated_entities: [],
        validated_clip_ref_count: 0,
        validated_clip_source_count: 0,
        missing_motion_entities: ["GTA"],
        visual_evidence_gate_ready: true,
      },
    }),
  );

  assert.equal(rec.verdict, "not_safe_for_video_yet");
  assert.equal(rec.recommended_lane, "short_only_or_card_only_review");
});

test("downgrade planner markdown is operator-readable and safety-labelled", () => {
  const plan = buildFlashLaneDowngradePlan({
    currentStateReport: { rows: [row()] },
  });
  plan.rows[0].recommendation.overlay_command = "npm run studio:v2:standard-overlay -- --story-json test/output/story.json";
  const md = renderFlashLaneDowngradePlanMarkdown(plan);

  assert.match(md, /Flash Lane Downgrade Plan/);
  assert.match(md, /Downgrade to standard short: 1/);
  assert.match(md, /pulse_standard_short_motion_lite/);
  assert.match(md, /Overlay command/);
  assert.match(md, /Does not render, download media, call TTS, post, mutate the DB, touch Railway, trigger OAuth or switch production renderer/);
});

test("studio:v2:downgrade-plan command is registered and read-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["studio:v2:downgrade-plan"], "node tools/flash-lane-downgrade-plan.js");
  assert.equal(pkg.scripts["ops:flash-downgrade"], "node tools/flash-lane-downgrade-plan.js");
  const tool = fs.readFileSync(path.join(ROOT, "tools", "flash-lane-downgrade-plan.js"), "utf8");
  assert.match(tool, /flash_lane_downgrade_plan\.json/);
  assert.match(tool, /Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth/);
});
