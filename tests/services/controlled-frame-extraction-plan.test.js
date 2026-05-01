"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildControlledFrameExtractionPlan,
  buildControlledFrameExtractionReport,
  renderControlledFrameExtractionMarkdown,
} = require("../../lib/controlled-frame-extraction-plan");

function reference(entity, index = 1, extra = {}) {
  return {
    provider: "steam",
    source_type: "steam_movie",
    source_url: `https://video.example/${entity.toLowerCase()}-${index}.m3u8`,
    entity,
    movie_name: `${entity} Official Trailer ${index}`,
    rights_risk_class: "storefront_promotional_video",
    allowed_render_use: "reference_only_by_default",
    downloads_allowed: false,
    ...extra,
  };
}

function motionPlan(overrides = {}) {
  return {
    story_id: "frame-story",
    title: "Take-Two story mentions GTA, Red Dead and BioShock",
    motion_readiness: "reference_ready_for_local_frame_plan",
    existing_references: [
      reference("GTA"),
      reference("Red Dead"),
      reference("BioShock"),
    ],
    counts: { total_clips: 0, trailer_extracted_frames: 0 },
    ...overrides,
  };
}

test("Controlled Frame Extraction Plan is report-only and never enables downloads", () => {
  const plan = buildControlledFrameExtractionPlan(motionPlan());

  assert.equal(plan.execution_mode, "report_only");
  assert.equal(plan.will_download, false);
  assert.equal(plan.will_extract_frames, false);
  assert.equal(plan.safety.video_downloads, false);
  assert.equal(plan.safety.frame_extraction, false);
});

test("Controlled Frame Extraction Plan selects frames across unique exact entities", () => {
  const plan = buildControlledFrameExtractionPlan(motionPlan());

  assert.equal(plan.frame_plan_readiness, "frame_plan_ready");
  assert.equal(plan.selected_references.length, 3);
  assert.deepEqual(
    plan.selected_references.map((item) => item.entity),
    ["GTA", "Red Dead", "BioShock"],
  );
  assert.equal(plan.target_frames.length, 6);
  assert.ok(plan.target_frames.every((frame) => frame.downloads_allowed === false));
});

test("Controlled Frame Extraction Plan caps repeated same-entity references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1),
        reference("GTA", 2),
        reference("GTA", 3),
        reference("Red Dead", 1),
        reference("BioShock", 1),
      ],
    }),
  );

  assert.equal(plan.selected_references.length, 3);
  assert.equal(plan.selected_references.filter((item) => item.entity === "GTA").length, 1);
});

test("Controlled Frame Extraction Plan rejects stories without official references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      motion_readiness: "official_reference_search_required",
      existing_references: [],
    }),
  );

  assert.equal(plan.frame_plan_readiness, "no_reference");
  assert.equal(plan.target_frames.length, 0);
  assert.ok(plan.blockers.includes("no_official_motion_reference"));
});

test("Controlled Frame Extraction report emits valid JSON and readable Markdown", () => {
  const report = buildControlledFrameExtractionReport([
    motionPlan({ story_id: "ready" }),
    motionPlan({
      story_id: "missing",
      motion_readiness: "official_reference_search_required",
      existing_references: [],
    }),
  ]);
  const markdown = renderControlledFrameExtractionMarkdown(report);

  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
  assert.equal(report.summary.stories, 2);
  assert.equal(report.summary.frame_plan_ready, 1);
  assert.equal(report.summary.no_reference, 1);
  assert.match(markdown, /Controlled Frame Extraction Plan/);
  assert.match(markdown, /ready/);
  assert.match(markdown, /missing/);
});
