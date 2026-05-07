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
      after: { verdict: "pass", failCount: 0, warnCount: 0, visualRepeatPairs: 0 },
      deltas: { failCount: -1, visualRepeatPairs: -16, warnCount: -2 },
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

function baseForensicReport(overrides = {}) {
  return {
    summary: {
      verdict: "warn",
      failCount: 0,
      warnCount: 2,
    },
    visual: {
      repeatPairCount: 2,
      repeatPairs: [
        { aTimeS: 46.5, bTimeS: 49.5, hamming: 6 },
        { aTimeS: 55.5, bTimeS: 58.5, hamming: 6 },
      ],
      taste: {
        verdict: "warn",
        badFrameCount: 2,
        badFrames: [
          { timeS: 16.5, reason: "dead_dark_frame", score: 62.5 },
          { timeS: 22.5, reason: "washed_low_detail_frame", score: 27.9 },
        ],
      },
    },
    issues: [
      {
        severity: "warn",
        code: "visual_repetition",
        message: "Frame sampling found possible repeated visuals.",
      },
      {
        severity: "warn",
        code: "rendered_frame_taste",
        message: "Rendered frame sampling found low-information frames.",
      },
    ],
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

test("Studio V2 promotion packet surfaces concrete forensic warning evidence", () => {
  const packet = buildStudioV2PromotionPacket({
    stillDeckReport: baseStillDeckReport(),
    qaReport: baseQaReport(),
    forensicReport: baseForensicReport(),
    now: "2026-05-06T21:00:00.000Z",
  });

  assert.equal(packet.forensic_warning_details.repeat_pair_count, 2);
  assert.deepEqual(packet.forensic_warning_details.repeat_pair_times, ["46.5s/49.5s", "55.5s/58.5s"]);
  assert.deepEqual(packet.forensic_warning_details.weak_frame_times, [
    "16.5s dead_dark_frame",
    "22.5s washed_low_detail_frame",
  ]);
  assert.ok(packet.forensic_warning_details.issue_codes.includes("rendered_frame_taste"));

  const markdown = renderStudioV2PromotionPacketMarkdown(packet);
  assert.match(markdown, /Forensic Warning Details/i);
  assert.match(markdown, /46\.5s\/49\.5s/i);
  assert.match(markdown, /22\.5s washed_low_detail_frame/i);
});

test("Studio V2 promotion packet blocks pilot promotion while forensic warnings remain", () => {
  const packet = buildStudioV2PromotionPacket({
    stillDeckReport: baseStillDeckReport({
      comparison: {
        before: { verdict: "fail", failCount: 1, warnCount: 2, visualRepeatPairs: 16 },
        after: { verdict: "warn", failCount: 0, warnCount: 2, visualRepeatPairs: 2 },
        deltas: { failCount: -1, warnCount: 0, visualRepeatPairs: -14 },
        verdict: "improved",
      },
    }),
    qaReport: baseQaReport(),
    forensicReport: baseForensicReport(),
    now: "2026-05-06T21:00:00.000Z",
  });

  assert.equal(packet.verdict, "RED_BLOCKED");
  assert.equal(packet.morning_approval_needed, false);
  assert.ok(packet.blockers.includes("forensic_warnings_remaining"));
  assert.ok(packet.blockers.includes("visual_repeat_pairs_remaining"));
  assert.ok(packet.blockers.includes("weak_rendered_frames_remaining"));
  assert.match(packet.recommendation, /Do not pilot Studio V2 yet/i);

  const markdown = renderStudioV2PromotionPacketMarkdown(packet);
  assert.match(markdown, /No Studio V2 pilot should be run until blockers are fixed/i);
  assert.doesNotMatch(markdown, /If Martin approves, use this as a one-story manual Studio V2 pilot/i);
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
