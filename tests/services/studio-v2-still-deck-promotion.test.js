"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyStudioV2Suitability,
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

test("Studio V2 suitability treats single-game footage-backed proofs as 60s local candidates", () => {
  const suitability = classifyStudioV2Suitability({
    renderPreflightBlocked: false,
    renderAttempted: true,
    renderRejected: false,
    enrichedVoiceGate: null,
    enrichedVisualCount: 12,
    distinctEntities: 1,
    officialClipRefsUsed: 7,
    acceptedFrameCount: 9,
    renderPreflight: {
      verdict: "allow",
      metrics: {
        narrationDurationS: 72.48,
        motionDominance: 0.81,
        actualClipScenes: 7,
        availableClipRefs: 7,
      },
      blockers: [],
    },
  });

  assert.equal(suitability, "studio_v2_60s_candidate_local_proof");
});

test("Studio V2 suitability keeps still-only single-entity packages at standard short", () => {
  const suitability = classifyStudioV2Suitability({
    renderPreflightBlocked: false,
    renderAttempted: true,
    renderRejected: false,
    enrichedVoiceGate: null,
    enrichedVisualCount: 8,
    distinctEntities: 1,
    officialClipRefsUsed: 0,
    acceptedFrameCount: 0,
    renderPreflight: {
      verdict: "allow",
      metrics: {
        narrationDurationS: 62,
        motionDominance: 0.1,
        actualClipScenes: 0,
        availableClipRefs: 0,
      },
      blockers: [],
    },
  });

  assert.equal(suitability, "standard_short_candidate");
});
