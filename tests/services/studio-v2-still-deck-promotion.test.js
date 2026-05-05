"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateStillDeckRenderReadiness,
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

test("still-deck render readiness blocks packages that reduce visual diversity", () => {
  const gate = evaluateStillDeckRenderReadiness({
    baselineSummary: { topicalSources: 5, sourceMixScore: 60 },
    enrichedSummary: { topicalSources: 3, sourceMixScore: 36 },
    enrichedMetrics: {
      acceptedCount: 3,
      acceptedFrameCount: 0,
      acceptedOfficialClipRefs: 0,
    },
  });

  assert.equal(gate.verdict, "block");
  assert.ok(gate.blockers.includes("still_deck_degrades_source_diversity"));
  assert.ok(gate.blockers.includes("still_deck_too_thin_for_render"));
});

test("still-deck render readiness allows diverse packages or motion-backed packages", () => {
  const diverse = evaluateStillDeckRenderReadiness({
    baselineSummary: { topicalSources: 3, sourceMixScore: 36 },
    enrichedSummary: { topicalSources: 6, sourceMixScore: 72 },
    enrichedMetrics: {
      acceptedCount: 6,
      acceptedFrameCount: 0,
      acceptedOfficialClipRefs: 0,
    },
  });
  assert.equal(diverse.verdict, "pass");

  const motionBacked = evaluateStillDeckRenderReadiness({
    baselineSummary: { topicalSources: 5, sourceMixScore: 60 },
    enrichedSummary: { topicalSources: 3, sourceMixScore: 36 },
    enrichedMetrics: {
      acceptedCount: 2,
      acceptedFrameCount: 2,
      acceptedOfficialClipRefs: 1,
    },
  });
  assert.equal(motionBacked.verdict, "pass");
});
