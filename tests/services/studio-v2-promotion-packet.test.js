"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStudioV2PromotionPacket,
  renderStudioV2PromotionPacketMarkdown,
} = require("../../lib/studio/v2/promotion-packet");

function baseStillDeckReport(overrides = {}) {
  return {
    generated_at: "2026-05-06T19:11:45.524Z",
    story_id: "1szzhy9",
    title: "Marathon drops on every chart",
    narration: {
      mode: "real_audio",
      enriched_source: "provided-local-tts-audio",
      enriched_audio_path: "D:/pulse-data/media/test/output/local-script-extension/audio/1szzhy9_liam_extended.mp3",
      enriched_timestamps_path:
        "D:/pulse-data/media/test/output/local-script-extension/audio/1szzhy9_liam_extended_timestamps.json",
      durationS: 72.48,
    },
    motion: {
      official_clip_refs_used: 7,
      official_trailer_frames_used: 9,
    },
    render_preflight: {
      verdict: "allow",
      blockers: [],
      warnings: ["flash_lane_clip_dominance_supported_by_trailer_frames"],
      metrics: {
        narrationDurationS: 72.48,
        actualClipDominance: 0.44,
        motionDominance: 0.88,
        cardRatio: 0.13,
        spokenWpm: 128.3,
      },
      visualDirector: {
        verdict: "allow",
        blockers: [],
        warnings: [],
        metrics: {
          uniqueClipSources: 5,
          maxClipScenesPerSource: 2,
          distinctSceneBeats: 16,
          badFrameTasteScenes: [],
          ratingSlateScenes: [],
        },
      },
    },
    renders: {
      enriched: {
        mp4: "test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4",
        qa: "test/output/studio-v2-still-deck/1szzhy9_enriched_qa.json",
        forensic: {
          jsonPath:
            "test/output/studio-v2-still-deck/qa_forensic_1szzhy9_enriched_report.json",
          markdownPath: "test/output/studio-v2-still-deck/qa_forensic_1szzhy9_enriched.md",
        },
      },
    },
    comparison: {
      before: { verdict: "fail", failCount: 1, visualRepeatPairs: 16 },
      after: { verdict: "warn", failCount: 0, warnCount: 2, visualRepeatPairs: 0 },
      deltas: { failCount: -1, visualRepeatPairs: -16 },
      verdict: "improved",
    },
    judgement: {
      visual_output: "improved",
      studio_v2_suitability: "studio_v2_60s_candidate_local_proof",
      premium_blockers: ["official Steam trailer references need human visual approval"],
      recommendation: "keep local-only and test Studio V2 with enriched still decks on more stories",
    },
    artefacts: [
      {
        label: "enriched mp4",
        path: "test/output/studio-v2-still-deck/studio_v2_1szzhy9_enriched.mp4",
      },
      {
        label: "enriched contact sheet",
        path: "test/output/studio-v2-still-deck/1szzhy9_enriched_contact_sheet.jpg",
      },
    ],
    safety: {
      local_only: true,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      production_render_default_changed: false,
    },
    ...overrides,
  };
}

function baseQaReport(overrides = {}) {
  return {
    verdict: {
      lane: "pass",
      redTrips: 0,
      amberTrips: 4,
      greenHits: 14,
      reasons: ["all rubric thresholds clear"],
    },
    runtime: {
      durationS: 74.666,
      sizeBytes: 35924602,
    },
    auto: {
      voicePathUsed: {
        grade: "green",
        value: "approved-provided-local-tts",
        localVoiceReference: {
          id: "pulse-sleepy-liam-20260502",
          referencePresent: true,
        },
      },
      durationIntegrity: {
        grade: "green",
        renderedDurationS: 74.666,
        audioDurationS: 72.48,
      },
      sourceDiversity: { grade: "green", uniqueSources: 14, totalScenes: 16 },
      clipDominance: { grade: "green", value: 0.88 },
      captionGapsOver2s: { grade: "green", value: 0 },
      flashLanePreflight: {
        grade: "amber",
        verdict: "allow",
        warnings: ["flash_lane_clip_dominance_supported_by_trailer_frames"],
      },
    },
    subtitles: {
      status: "kinetic_ass_from_real_audio",
    },
    voice: {
      source: "provided-local-tts-audio",
    },
    ...overrides,
  };
}

test("Studio V2 promotion packet classifies a clean local proof as approval queued", () => {
  const packet = buildStudioV2PromotionPacket({
    stillDeckReport: baseStillDeckReport(),
    qaReport: baseQaReport(),
    now: "2026-05-06T21:00:00.000Z",
  });

  assert.equal(packet.verdict, "AMBER_LOCAL_PROOF");
  assert.equal(packet.production_ready, false);
  assert.equal(packet.morning_approval_needed, true);
  assert.match(packet.recommendation, /one-story Studio V2 pilot/i);
  assert.ok(packet.safety.local_only);
});

test("Studio V2 promotion packet blocks production recommendation when safety is not local-only", () => {
  const packet = buildStudioV2PromotionPacket({
    stillDeckReport: baseStillDeckReport({
      safety: {
        local_only: false,
        railway_mutated: true,
        production_db_mutated: false,
        oauth_triggered: false,
        posted_to_platforms: false,
        production_render_default_changed: false,
      },
    }),
    qaReport: baseQaReport(),
  });

  assert.equal(packet.verdict, "RED_BLOCKED");
  assert.equal(packet.morning_approval_needed, false);
  assert.ok(packet.blockers.includes("proof_safety_boundary_failed"));
});

test("Studio V2 promotion markdown includes rollback and no live-switch language", () => {
  const packet = buildStudioV2PromotionPacket({
    stillDeckReport: baseStillDeckReport(),
    qaReport: baseQaReport(),
    now: "2026-05-06T21:00:00.000Z",
  });

  const markdown = renderStudioV2PromotionPacketMarkdown(packet);

  assert.match(markdown, /Do not switch production renderer/i);
  assert.match(markdown, /Rollback/i);
  assert.match(markdown, /MORNING_APPROVAL_QUEUE/i);
  assert.doesNotMatch(markdown, /AUTO_PUBLISH=true/i);
});
