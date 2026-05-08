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
  assert.equal(plan.target_frames.length, 12);
  assert.ok(plan.target_frames.every((frame) => frame.downloads_allowed === false));
});

test("Controlled Frame Extraction Plan interleaves safe non-intro probe points across sources", () => {
  const plan = buildControlledFrameExtractionPlan(motionPlan());
  const firstSix = plan.target_frames.slice(0, 6).map((frame) => ({
    entity: frame.entity,
    percent: frame.target_time_percent,
    sampleOrder: frame.sample_order,
    strategy: frame.sampling_strategy,
  }));

  assert.deepEqual(firstSix, [
    {
      entity: "GTA",
      percent: 0.42,
      sampleOrder: 1,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "Red Dead",
      percent: 0.42,
      sampleOrder: 2,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "BioShock",
      percent: 0.42,
      sampleOrder: 3,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "GTA",
      percent: 0.58,
      sampleOrder: 4,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "Red Dead",
      percent: 0.58,
      sampleOrder: 5,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
    {
      entity: "BioShock",
      percent: 0.58,
      sampleOrder: 6,
      strategy: "interleaved_non_intro_multi_probe_v3",
    },
  ]);
  assert.ok(plan.target_frames.every((frame) => frame.target_time_percent >= 0.42));
});

test("Controlled Frame Extraction Plan supports a max target frame cap", () => {
  const plan = buildControlledFrameExtractionPlan(motionPlan(), { maxTargetFrames: 5 });

  assert.equal(plan.target_frames.length, 5);
  assert.deepEqual(
    plan.target_frames.map((frame) => `${frame.entity}:${frame.target_time_percent}`),
    ["GTA:0.42", "Red Dead:0.42", "BioShock:0.42", "GTA:0.58", "Red Dead:0.58"],
  );
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

test("Controlled Frame Extraction Plan de-prioritises PEGI and rating-board trailer references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1, {
          movie_name: "GTA Official PEGI Rating Trailer",
        }),
        reference("GTA", 2, {
          movie_name: "GTA Gameplay Update Trailer",
        }),
        reference("Red Dead", 1),
        reference("BioShock", 1),
      ],
    }),
  );

  assert.equal(
    plan.selected_references.find((item) => item.entity === "GTA").movie_name,
    "GTA Gameplay Update Trailer",
  );
});

test("Controlled Frame Extraction Plan excludes localised and subtitle-labelled trailer references", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("Red Dead", 1, {
          movie_name: "RDR2 60 FPS Trailer (DE)",
        }),
        reference("Red Dead", 2, {
          movie_name: "Red Dead Redemption 2 Gameplay Trailer",
        }),
        reference("BioShock", 1, {
          movie_name: "BioShock Infinite Launch Trailer Subtitles",
        }),
        reference("BioShock", 2, {
          movie_name: "BioShock Infinite Gameplay Trailer",
        }),
        reference("GTA", 1),
      ],
    }),
  );

  assert.equal(
    plan.selected_references.find((item) => item.entity === "Red Dead").movie_name,
    "Red Dead Redemption 2 Gameplay Trailer",
  );
  assert.equal(
    plan.selected_references.find((item) => item.entity === "BioShock").movie_name,
    "BioShock Infinite Gameplay Trailer",
  );
  assert.ok(!plan.target_frames.some((frame) => /\(DE\)|Subtitles/i.test(frame.movie_name || "")));
});

test("Controlled Frame Extraction Plan can include alternate official references for retry QA", () => {
  const plan = buildControlledFrameExtractionPlan(
    motionPlan({
      existing_references: [
        reference("GTA", 1),
        reference("GTA", 2),
        reference("Red Dead", 1),
        reference("Red Dead", 2),
        reference("BioShock", 1),
      ],
    }),
    {
      maxReferences: 5,
      maxReferencesPerEntity: 2,
      maxTargetFrames: 10,
    },
  );

  assert.equal(plan.selected_references.length, 5);
  assert.deepEqual(
    plan.selected_references.map((item) => `${item.entity}:${item.movie_name}`),
    [
      "GTA:GTA Official Trailer 1",
      "Red Dead:Red Dead Official Trailer 1",
      "BioShock:BioShock Official Trailer 1",
      "GTA:GTA Official Trailer 2",
      "Red Dead:Red Dead Official Trailer 2",
    ],
  );
  assert.equal(plan.selected_references.filter((item) => item.entity === "Red Dead").length, 2);
  assert.equal(plan.exact_subject_motion_coverage.max_references_per_entity, 2);
  assert.equal(plan.target_frames.length, 10);
});

test("Controlled Frame Extraction Plan still caps alternates per entity", () => {
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
    {
      maxReferences: 5,
      maxReferencesPerEntity: 2,
    },
  );

  assert.equal(plan.selected_references.length, 4);
  assert.equal(plan.selected_references.filter((item) => item.entity === "GTA").length, 2);
  assert.ok(!plan.selected_references.some((item) => item.movie_name === "GTA Official Trailer 3"));
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
