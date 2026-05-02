"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFlashLaneFootageAcquisitionPlan,
  renderFlashLaneFootageAcquisitionMarkdown,
} = require("../../lib/studio/v2/flash-lane-footage-acquisition");

function frameReport() {
  return {
    plans: [
      {
        story_id: "story-1",
        frames: [
          { entity: "GTA", status: "accepted" },
          { entity: "Red Dead", status: "accepted" },
          { entity: "BioShock", status: "accepted" },
        ],
      },
    ],
  };
}

function segmentReport() {
  return {
    segments: [
      {
        story_id: "story-1",
        entity: "BioShock",
        allowed_for_flash_lane: true,
        segment_motion_class: "gameplay_action",
        action_score: 82,
        action_sample_count: 3,
        status: "accepted",
        start_s: 22,
        media_start_s: 42,
        duration_s: 4,
      },
      {
        story_id: "story-1",
        entity: "GTA",
        allowed_for_flash_lane: false,
        status: "rejected",
        validation_reason: "segment_contains_title_or_rating_card",
        media_start_s: 36,
      },
      {
        story_id: "story-1",
        entity: "Red Dead",
        allowed_for_flash_lane: false,
        status: "rejected",
        validation_reason: "segment_contains_black_frame",
        media_start_s: 36,
      },
    ],
  };
}

test("footage acquisition plan requests only missing validated entity windows", () => {
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: "story-1",
    frameReport: frameReport(),
    segmentValidationReport: segmentReport(),
  });

  assert.equal(plan.verdict, "needs_more_validated_footage");
  assert.deepEqual(plan.validated_entities, ["BioShock"]);
  assert.deepEqual(
    plan.shopping_list.map((item) => item.entity),
    ["GTA", "Red Dead"],
  );
  assert.ok(plan.shopping_list.every((item) => item.acquisition_mode === "operator_or_local_apply_only"));
});

test("footage acquisition plan pushes failed early trailer samples later", () => {
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: "story-1",
    frameReport: frameReport(),
    segmentValidationReport: segmentReport(),
  });
  const gta = plan.shopping_list.find((item) => item.entity === "GTA");
  const redDead = plan.shopping_list.find((item) => item.entity === "Red Dead");

  assert.ok(gta.suggested_windows.every((window) => window.start_s >= 36));
  assert.ok(gta.reasons.includes("skip_rating_title_logo_sections"));
  assert.ok(redDead.reasons.includes("avoid_black_or_transition_windows"));
});

test("footage acquisition plan refuses stale allowed segments without gameplay action proof", () => {
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: "story-1",
    frameReport: frameReport(),
    segmentValidationReport: {
      segments: [
        { story_id: "story-1", entity: "GTA", allowed_for_flash_lane: true, status: "accepted" },
        {
          story_id: "story-1",
          entity: "Red Dead",
          allowed_for_flash_lane: true,
          status: "accepted",
          segment_motion_class: "gameplay_action",
          action_score: 66,
        },
        {
          story_id: "story-1",
          entity: "BioShock",
          allowed_for_flash_lane: true,
          status: "accepted",
          segment_motion_class: "gameplay_action",
          action_score: 82,
          action_sample_count: 3,
        },
      ],
    },
  });

  assert.equal(plan.verdict, "needs_more_validated_footage");
  assert.deepEqual(plan.validated_entities, ["BioShock"]);
  assert.ok(plan.rejected_reasons_by_entity.GTA.includes("segment_missing_gameplay_action_proof"));
  assert.ok(plan.rejected_reasons_by_entity["Red Dead"].includes("segment_action_score_below_flash_threshold"));
});

test("footage acquisition plan does not repeat exhausted intro windows", () => {
  const failedStarts = [36, 42, 48, 54, 60, 66];
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: "story-1",
    frameReport: frameReport(),
    segmentValidationReport: {
      segments: [
        {
          story_id: "story-1",
          entity: "BioShock",
          allowed_for_flash_lane: true,
          status: "accepted",
          segment_motion_class: "gameplay_action",
          action_score: 84,
        },
        ...failedStarts.map((start) => ({
          story_id: "story-1",
          entity: "GTA",
          allowed_for_flash_lane: false,
          status: "rejected",
          validation_reason: "segment_lacks_gameplay_action_samples",
          media_start_s: start,
        })),
      ],
    },
  });

  const gta = plan.shopping_list.find((item) => item.entity === "GTA");
  assert.ok(gta.reasons.includes("try_later_or_alternate_official_source_after_failed_windows"));
  assert.ok(gta.suggested_windows.every((window) => !failedStarts.includes(window.start_s)));
  assert.ok(gta.suggested_windows.every((window) => window.start_s >= 36));
});

test("footage acquisition plan becomes proof-ready with enough validated windows", () => {
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: "story-1",
    frameReport: frameReport(),
    segmentValidationReport: {
      segments: [
        {
          story_id: "story-1",
          entity: "GTA",
          allowed_for_flash_lane: true,
          status: "accepted",
          segment_motion_class: "gameplay_action",
          action_score: 80,
        },
        {
          story_id: "story-1",
          entity: "Red Dead",
          allowed_for_flash_lane: true,
          status: "accepted",
          segment_motion_class: "gameplay_action",
          action_score: 81,
        },
        {
          story_id: "story-1",
          entity: "BioShock",
          allowed_for_flash_lane: true,
          status: "accepted",
          segment_motion_class: "gameplay_action",
          action_score: 82,
        },
      ],
    },
  });

  assert.equal(plan.verdict, "ready_for_flash_footage_backbone");
  assert.deepEqual(plan.shopping_list, []);
});

test("footage acquisition markdown is readable and explicit about safety", () => {
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: "story-1",
    frameReport: frameReport(),
    segmentValidationReport: segmentReport(),
  });
  const md = renderFlashLaneFootageAcquisitionMarkdown(plan);

  assert.match(md, /Flash Lane Footage Acquisition v1/);
  assert.match(md, /Shopping List/);
  assert.match(md, /No downloads are performed/);
});
