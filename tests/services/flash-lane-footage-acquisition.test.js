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
        status: "accepted",
        start_s: 22,
        duration_s: 4,
      },
      {
        story_id: "story-1",
        entity: "GTA",
        allowed_for_flash_lane: false,
        status: "rejected",
        validation_reason: "segment_contains_title_or_rating_card",
        start_s: 0,
      },
      {
        story_id: "story-1",
        entity: "Red Dead",
        allowed_for_flash_lane: false,
        status: "rejected",
        validation_reason: "segment_contains_black_frame",
        start_s: 3,
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

  assert.ok(gta.suggested_windows.every((window) => window.start_s >= 12));
  assert.ok(gta.reasons.includes("skip_rating_title_logo_sections"));
  assert.ok(redDead.reasons.includes("avoid_black_or_transition_windows"));
});

test("footage acquisition plan becomes proof-ready with enough validated windows", () => {
  const plan = buildFlashLaneFootageAcquisitionPlan({
    storyId: "story-1",
    frameReport: frameReport(),
    segmentValidationReport: {
      segments: [
        { story_id: "story-1", entity: "GTA", allowed_for_flash_lane: true, status: "accepted" },
        { story_id: "story-1", entity: "Red Dead", allowed_for_flash_lane: true, status: "accepted" },
        { story_id: "story-1", entity: "BioShock", allowed_for_flash_lane: true, status: "accepted" },
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
