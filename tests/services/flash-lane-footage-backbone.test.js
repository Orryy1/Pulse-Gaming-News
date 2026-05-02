"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFlashLaneFootageBackboneReport,
  renderFlashLaneFootageBackboneMarkdown,
} = require("../../lib/studio/v2/flash-lane-footage-backbone");

function frame({ entity, source = null, status = "accepted", failures = [], seconds = 44 } = {}) {
  return {
    status,
    source_url: source || `https://video.example/${entity}.m3u8`,
    source_type: "steam_movie",
    entity,
    target_time_seconds: seconds,
    qa: {
      failures,
      thumbnail_safe: status === "accepted",
      verdict: status === "accepted" ? "pass" : "fail",
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0.05,
        edge_density: 0.22,
        saturation_mean: 0.45,
      },
    },
  };
}

function frameReport(frames) {
  return {
    plans: [
      {
        story_id: "story-1",
        frames,
      },
    ],
  };
}

function segment({
  entity,
  source = null,
  allowed = true,
  reason = "segment_samples_passed",
  start = 48,
  motionClass = "gameplay_action",
  actionScore = 82,
  actionSampleCount = 3,
} = {}) {
  const url = source || `https://video.example/${entity}.m3u8`;
  return {
    story_id: "story-1",
    clip_key: `${url}|${String(entity).replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}|${Number(start).toFixed(2)}`,
    source_url: url,
    source_type: "steam_movie",
    entity,
    media_start_s: start,
    duration_s: 5,
    status: allowed ? "validated" : "rejected",
    segment_validated: allowed,
    allowed_for_flash_lane: allowed,
    validation_reason: reason,
    segment_motion_class: allowed ? motionClass : "rejected",
    action_score: allowed ? actionScore : 0,
    action_sample_count: allowed ? actionSampleCount : 0,
    samples: [{}, {}, {}],
  };
}

test("Flash Lane footage backbone downgrades stories with only one validated clip", () => {
  const report = buildFlashLaneFootageBackboneReport({
    storyId: "story-1",
    frameReport: frameReport([
      frame({ entity: "GTA" }),
      frame({ entity: "Red Dead", status: "rejected_qa", failures: ["black_frame"] }),
      frame({ entity: "BioShock" }),
    ]),
    segmentValidationReport: {
      segments: [
        segment({ entity: "BioShock", allowed: true }),
        segment({
          entity: "GTA",
          allowed: false,
          reason: "segment_contains_black_frame",
        }),
      ],
    },
  });

  assert.equal(report.verdict, "downgrade_to_standard_short");
  assert.ok(report.blockers.includes("footage_backbone_needs_three_validated_clip_windows"));
  assert.ok(report.recommendations.includes("downgrade_to_standard_short_until_footage_backbone_exists"));
  assert.equal(report.segment_inventory.validated_segments, 1);
});

test("Flash Lane footage backbone allows three validated clip windows", () => {
  const sourceA = "https://video.example/gta.m3u8";
  const sourceB = "https://video.example/reddead.m3u8";
  const sourceC = "https://video.example/bioshock.m3u8";
  const report = buildFlashLaneFootageBackboneReport({
    storyId: "story-1",
    targetRuntimeS: 15,
    frameReport: frameReport([
      frame({ entity: "GTA", source: sourceA }),
      frame({ entity: "Red Dead", source: sourceB }),
      frame({ entity: "BioShock", source: sourceC }),
    ]),
    segmentValidationReport: {
      segments: [
        segment({ entity: "GTA", source: sourceA }),
        segment({ entity: "Red Dead", source: sourceB }),
        segment({ entity: "BioShock", source: sourceC }),
      ],
    },
  });

  assert.equal(report.verdict, "ready_for_flash_render_preflight");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.validated_clip_refs.length, 3);
});

test("Flash Lane footage backbone projects a footage-heavy 60s Flash proof", () => {
  const entities = [
    "GTA",
    "Red Dead",
    "BioShock",
    "Mafia",
    "Borderlands",
    "Civilization",
    "NBA",
    "WWE",
    "Max Payne",
    "Bully",
  ];
  const frames = entities.map((entity, index) =>
    frame({
      entity,
      source: `https://video.example/${index}-${entity}.m3u8`,
      seconds: 44,
    }),
  );
  const segments = entities.map((entity, index) =>
    segment({
      entity,
      source: `https://video.example/${index}-${entity}.m3u8`,
    }),
  );

  const report = buildFlashLaneFootageBackboneReport({
    storyId: "story-1",
    targetRuntimeS: 66,
    frameReport: frameReport(frames),
    segmentValidationReport: { segments },
  });

  assert.equal(report.verdict, "ready_for_flash_render_preflight");
  assert.equal(report.validated_clip_refs.length, 9);
  assert.ok(report.projected_clip_dominance >= 0.65);
  assert.deepEqual(report.blockers, []);
});

test("Flash Lane footage backbone caps repeated use of the same trailer source", () => {
  const sharedSource = "https://video.example/shared-bioshock.m3u8";
  const frames = Array.from({ length: 6 }, (_, index) =>
    frame({
      entity: index % 2 === 0 ? "BioShock" : "GTA",
      source: sharedSource,
      seconds: 44 + index,
    }),
  );
  const segments = frames.map((item) =>
    segment({
      entity: item.entity,
      source: item.source_url,
      start: item.target_time_seconds + 4,
    }),
  );

  const report = buildFlashLaneFootageBackboneReport({
    storyId: "story-1",
    targetRuntimeS: 30,
    minClipDominance: 0.5,
    maxCandidateWindowsPerSource: 6,
    frameReport: frameReport(frames),
    segmentValidationReport: { segments },
  });

  const sharedUseCount = report.validated_clip_refs.filter((ref) => ref.path === sharedSource).length;
  assert.ok(sharedUseCount <= 3);
  assert.equal(report.filtered_source_overuse_clip_refs, frames.length - sharedUseCount);
});

test("Flash Lane footage backbone balances validated clips across story entities", () => {
  const frames = [
    frame({ entity: "GTA", source: "https://video.example/gta-1.m3u8", seconds: 44 }),
    frame({ entity: "GTA", source: "https://video.example/gta-2.m3u8", seconds: 44 }),
    frame({ entity: "GTA", source: "https://video.example/gta-3.m3u8", seconds: 44 }),
    frame({ entity: "Red Dead", source: "https://video.example/red-1.m3u8", seconds: 44 }),
    frame({ entity: "BioShock", source: "https://video.example/bio-1.m3u8", seconds: 44 }),
  ];
  const segments = frames.map((item) =>
    segment({
      entity: item.entity,
      source: item.source_url,
    }),
  );

  const report = buildFlashLaneFootageBackboneReport({
    storyId: "story-1",
    targetRuntimeS: 20,
    minClipDominance: 0.5,
    frameReport: frameReport(frames),
    segmentValidationReport: { segments },
  });

  assert.deepEqual(
    report.validated_clip_refs.slice(0, 3).map((ref) => ref.entity),
    ["GTA", "Red Dead", "BioShock"],
  );
});

test("Flash Lane footage backbone excludes validated clips below the Flash quality floor", () => {
  const lowQuality = frame({
    entity: "GTA",
    source: "https://video.example/gta-low.m3u8",
    seconds: 44,
  });
  lowQuality.qa.prescan.edge_density = 0.09;
  lowQuality.qa.prescan.saturation_mean = 0.1;
  lowQuality.qa.verdict = "warn";
  const highQuality = frame({
    entity: "BioShock",
    source: "https://video.example/bioshock-high.m3u8",
    seconds: 44,
  });

  const report = buildFlashLaneFootageBackboneReport({
    storyId: "story-1",
    targetRuntimeS: 15,
    frameReport: frameReport([lowQuality, highQuality]),
    segmentValidationReport: {
      segments: [
        segment({ entity: "GTA", source: "https://video.example/gta-low.m3u8" }),
        segment({ entity: "BioShock", source: "https://video.example/bioshock-high.m3u8" }),
      ],
    },
  });

  assert.deepEqual(
    report.validated_clip_refs.map((ref) => ref.entity),
    ["BioShock"],
  );
  assert.ok(report.blockers.includes("footage_backbone_needs_three_validated_clip_windows"));
});

test("Flash Lane footage backbone refuses clean segments that are not gameplay/action", () => {
  const sourceA = "https://video.example/gta-clean-card.m3u8";
  const sourceB = "https://video.example/reddead-clean-card.m3u8";
  const sourceC = "https://video.example/bioshock-clean-card.m3u8";
  const report = buildFlashLaneFootageBackboneReport({
    storyId: "story-1",
    targetRuntimeS: 15,
    frameReport: frameReport([
      frame({ entity: "GTA", source: sourceA }),
      frame({ entity: "Red Dead", source: sourceB }),
      frame({ entity: "BioShock", source: sourceC }),
    ]),
    segmentValidationReport: {
      segments: [
        segment({
          entity: "GTA",
          source: sourceA,
          motionClass: "non_gameplay_context",
          actionScore: 42,
          actionSampleCount: 0,
        }),
        segment({
          entity: "Red Dead",
          source: sourceB,
          motionClass: "non_gameplay_context",
          actionScore: 45,
          actionSampleCount: 1,
        }),
        segment({
          entity: "BioShock",
          source: sourceC,
          motionClass: "non_gameplay_context",
          actionScore: 48,
          actionSampleCount: 0,
        }),
      ],
    },
  });

  assert.equal(report.verdict, "downgrade_to_standard_short");
  assert.equal(report.segment_inventory.validated_segments, 0);
  assert.equal(report.segment_inventory.non_gameplay_context_segments, 3);
  assert.deepEqual(report.validated_clip_refs, []);
  assert.ok(report.blockers.includes("footage_backbone_needs_gameplay_action_clip_windows"));
});

test("Flash Lane footage backbone markdown is operator-readable", () => {
  const report = buildFlashLaneFootageBackboneReport({
    storyId: "story-1",
    frameReport: frameReport([frame({ entity: "GTA" })]),
    segmentValidationReport: { segments: [] },
  });
  const md = renderFlashLaneFootageBackboneMarkdown(report);

  assert.match(md, /Flash Lane Footage Backbone v1/);
  assert.match(md, /Verdict:/);
  assert.match(md, /Recommendations/);
});
