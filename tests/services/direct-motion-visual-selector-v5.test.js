"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DIRECT_MOTION_VISUAL_SELECTOR_V5,
  scoreDirectMotionVisualSamples,
} = require("../../lib/studio/v5/direct-motion-visual-selector");

test("V5 direct-motion selector rejects source clips with baked caption-heavy frames", () => {
  const report = scoreDirectMotionVisualSamples([
    {
      text_overlay_likelihood: 0.08,
      trailer_frame_taste: { verdict: "pass", tags: ["gameplay_candidate"] },
    },
    {
      text_overlay_likelihood: 0.4,
      trailer_frame_taste: { verdict: "pass", tags: ["detail_rich", "text_heavy"] },
    },
  ]);

  assert.equal(report.version, DIRECT_MOTION_VISUAL_SELECTOR_V5.version);
  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("direct_motion_baked_caption_risk"));
});

test("V5 direct-motion selector preserves clean detailed gameplay", () => {
  const report = scoreDirectMotionVisualSamples([
    {
      text_overlay_likelihood: 0.02,
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    },
    {
      text_overlay_likelihood: 0.23,
      trailer_frame_taste: {
        verdict: "pass",
        tags: ["detail_rich", "colourful", "gameplay_candidate"],
      },
    },
  ]);

  assert.equal(report.eligible, true);
  assert.deepEqual(report.reasons, []);
  assert.equal(report.metrics.text_heavy_sample_count, 0);
});

test("V5 direct-motion selector fails closed when no decoded samples exist", () => {
  const report = scoreDirectMotionVisualSamples([]);

  assert.equal(report.eligible, false);
  assert.ok(report.reasons.includes("direct_motion_visual_samples_missing"));
});
