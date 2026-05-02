"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFlashLaneVisualDirector,
  MIN_SAFE_CLIP_START_S,
} = require("../../lib/studio/v2/flash-lane-visual-director");

function clip(label, source, mediaStartS = 30) {
  return { type: "clip", label, source, mediaStartS, duration: 4.2 };
}

function card(label = "card_context") {
  return { type: "card.stat", label, duration: 4.2 };
}

test("Flash Lane Visual Director blocks two reused clip refs across a 60s plan", () => {
  const scenes = [
    clip("opener", "gta.m3u8", 32),
    clip("clip_1", "bioshock.m3u8", 34),
    clip("clip_2", "gta.m3u8", 37),
    clip("clip_3", "bioshock.m3u8", 39),
    clip("clip_4", "gta.m3u8", 42),
    clip("clip_5", "bioshock.m3u8", 44),
    clip("clip_6", "gta.m3u8", 47),
    clip("clip_7", "bioshock.m3u8", 49),
    { type: "clip.frame", label: "frame", source: "gta-frame.jpg", duration: 4.2 },
    card(),
    card("card_takeaway"),
  ];
  const report = buildFlashLaneVisualDirector({
    scenes,
    media: { clips: [{ path: "gta.m3u8" }, { path: "bioshock.m3u8" }] },
    narrationDurationS: 66.8,
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_visual_requires_three_unique_clip_refs_for_60s"));
  assert.ok(report.blockers.includes("flash_visual_clip_source_overused"));
  assert.equal(report.metrics.uniqueClipSources, 2);
});

test("Flash Lane Visual Director blocks clip anchors that start inside likely ratings/logo material", () => {
  const report = buildFlashLaneVisualDirector({
    scenes: [
      clip("safe_a", "a.m3u8", 32),
      clip("too_early", "b.m3u8", MIN_SAFE_CLIP_START_S - 0.1),
      clip("safe_c", "c.m3u8", 36),
      { type: "clip.frame", source: "frame.jpg", duration: 4.2 },
      card(),
      card("card_takeaway"),
    ],
    media: { clips: [{ path: "a.m3u8" }, { path: "b.m3u8" }, { path: "c.m3u8" }] },
    narrationDurationS: 62,
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_visual_clip_start_too_early"));
  assert.equal(report.metrics.earlyClipSceneCount, 1);
});

test("Flash Lane Visual Director allows diverse safe clip-led plans", () => {
  const scenes = [
    clip("a1", "a.m3u8", 30),
    clip("b1", "b.m3u8", 32),
    clip("c1", "c.m3u8", 34),
    clip("a2", "a.m3u8", 38),
    clip("b2", "b.m3u8", 40),
    clip("c2", "c.m3u8", 42),
    { type: "clip.frame", label: "frame_a", source: "frame-a.jpg", duration: 4.2 },
    { type: "still", label: "still_a", source: "steam-screenshot.jpg", sourceType: "steam_screenshot", duration: 4.2 },
    card("card_context"),
    card("card_takeaway"),
  ];
  const report = buildFlashLaneVisualDirector({
    scenes,
    media: {
      clips: [
        { path: "a.m3u8", provenance: { segment_quality_score: 90 } },
        { path: "b.m3u8", provenance: { segment_quality_score: 89 } },
        { path: "c.m3u8", provenance: { segment_quality_score: 91 } },
      ],
    },
    narrationDurationS: 64,
  });

  assert.equal(report.verdict, "allow");
  assert.equal(report.metrics.uniqueClipSources, 3);
  assert.equal(report.metrics.maxClipScenesPerSource, 2);
});

test("Flash Lane Visual Director blocks unvalidated official trailer segments", () => {
  const scenes = [
    clip("a1", "a.m3u8", 40),
    clip("b1", "b.m3u8", 42),
    clip("c1", "c.m3u8", 44),
    clip("a2", "a.m3u8", 48),
    clip("b2", "b.m3u8", 50),
    clip("c2", "c.m3u8", 52),
    { type: "clip.frame", label: "frame_a", source: "frame-a.jpg", duration: 4.2 },
    card("card_context"),
    card("card_takeaway"),
  ];
  const report = buildFlashLaneVisualDirector({
    scenes,
    media: {
      clips: [
        {
          path: "a.m3u8",
          source: "official-trailer-reference",
          provenance: {
            requires_segment_validation: true,
            segment_validated: false,
            allowed_for_flash_lane: false,
          },
        },
        { path: "b.m3u8" },
        { path: "c.m3u8" },
      ],
    },
    narrationDurationS: 64,
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_visual_unvalidated_official_clip_segment"));
  assert.equal(report.metrics.unvalidatedOfficialSegments.length, 2);
});

test("Flash Lane Visual Director blocks low-quality official clip anchors", () => {
  const scenes = [
    clip("a1", "a.m3u8", 40),
    clip("b1", "b.m3u8", 42),
    clip("c1", "c.m3u8", 44),
    clip("a2", "a.m3u8", 48),
    clip("b2", "b.m3u8", 50),
    clip("c2", "c.m3u8", 52),
    { type: "clip.frame", label: "frame_a", source: "frame-a.jpg", duration: 4.2 },
    card("card_context"),
    card("card_takeaway"),
  ];
  const report = buildFlashLaneVisualDirector({
    scenes,
    media: {
      clips: [
        { path: "a.m3u8", provenance: { segment_quality_score: 61 } },
        { path: "b.m3u8", provenance: { segment_quality_score: 89 } },
        { path: "c.m3u8", provenance: { segment_quality_score: 91 } },
      ],
    },
    narrationDurationS: 64,
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_visual_low_quality_clip_segment"));
});

test("Flash Lane Visual Director warns when cards and cover art are support, not backbone", () => {
  const scenes = [
    clip("a1", "a.m3u8", 30),
    clip("b1", "b.m3u8", 32),
    clip("c1", "c.m3u8", 34),
    { type: "card.source", label: "card_source", duration: 4.2 },
    { type: "still", label: "cover_a", source: "game-header.jpg", sourceType: "steam_header", duration: 4.2 },
    { type: "clip.frame", label: "frame", source: "frame.jpg", duration: 4.2 },
    card("card_context"),
    card("card_takeaway"),
  ];
  const report = buildFlashLaneVisualDirector({
    scenes,
    media: { clips: [{ path: "a.m3u8" }, { path: "b.m3u8" }, { path: "c.m3u8" }] },
    narrationDurationS: 63,
  });

  assert.ok(report.warnings.includes("flash_visual_cover_art_should_only_support"));
  assert.ok(report.warnings.includes("flash_visual_card_ratio_high"));
});
