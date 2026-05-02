"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recommendStudioV2Promotion,
} = require("../../lib/studio/v2/still-deck-promotion");

test("still-deck promotion recommendation distinguishes voice-only preflight block", () => {
  const recommendation = recommendStudioV2Promotion({
    renderPreflightBlocked: true,
    renderPreflight: {
      blockers: ["unapproved_local_tts_voice_path"],
    },
    renderAttempted: false,
    visualImproved: true,
  });

  assert.match(recommendation, /approved Flash Lane narration/i);
  assert.doesNotMatch(recommendation, /footage dominance|card-ratio/i);
});

test("still-deck promotion recommendation reports visual preflight blockers when present", () => {
  const recommendation = recommendStudioV2Promotion({
    renderPreflightBlocked: true,
    renderPreflight: {
      blockers: ["flash_lane_clip_reuse_too_high", "flash_visual_clip_source_overused"],
    },
    renderAttempted: false,
    visualImproved: true,
  });

  assert.match(recommendation, /visual blockers/i);
  assert.match(recommendation, /flash_lane_clip_reuse_too_high/);
});
