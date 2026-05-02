"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOfficialTrailerClipsFromFrameReport,
  safeClipStartFromFrame,
  scoreOfficialTrailerFrameForClip,
  MIN_OFFICIAL_CLIP_START_S,
} = require("../../lib/studio/v2/official-trailer-clip-refs");
const {
  segmentKeyForClipRef,
} = require("../../lib/studio/v2/official-trailer-segment-validator");

function acceptedFrame(overrides = {}) {
  return {
    status: "accepted",
    source_url: "https://video.example/game.m3u8",
    source_type: "steam_movie",
    entity: "GTA",
    target_time_seconds: 31.2,
    local_path: "frame.jpg",
    qa: {
      thumbnail_safe: true,
      verdict: "pass",
      content_hash: "hash",
      prescan: {
        likely_is_logo: false,
        text_overlay_likelihood: 0,
        edge_density: 0.18,
        saturation_mean: 0.29,
      },
    },
    ...overrides,
  };
}

test("official clip refs start after the accepted safe frame, not before it", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [acceptedFrame({ target_time_seconds: 31.2 })],
        },
      ],
    },
    "story-1",
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0].mediaStartS, 36);
  assert.equal(refs[0].provenance.clip_start_policy, "start_after_accepted_safe_frame");
  assert.equal(refs[0].provenance.requires_segment_validation, true);
  assert.equal(refs[0].provenance.segment_validated, false);
  assert.equal(refs[0].provenance.allowed_for_flash_lane, false);
});

test("official clip refs enforce a minimum start to avoid trailer rating/opening boards", () => {
  assert.equal(MIN_OFFICIAL_CLIP_START_S, 36);
  assert.equal(safeClipStartFromFrame({ target_time_seconds: 10.8 }), MIN_OFFICIAL_CLIP_START_S);
});

test("official clip refs ignore accepted frames that trailer guards classify as title/rating cards", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                prescan: {
                  likely_is_logo: true,
                  text_overlay_likelihood: 0.42,
                  edge_density: 0.25,
                  saturation_mean: 0.26,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(refs, []);
});

test("official clip refs ignore text-heavy rating cards even without logo detection", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0.51,
                  edge_density: 0.22,
                  saturation_mean: 0.18,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(refs, []);
});

test("official clip refs ignore frames already carrying blur or low-detail warnings", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              qa: {
                thumbnail_safe: true,
                verdict: "warn",
                blur_verdict: "warn",
                warnings: ["low_detail_or_blur_risk"],
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0.05,
                  edge_density: 0.011,
                  saturation_mean: 0.28,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.deepEqual(refs, []);
});

test("official clip refs choose the strongest quality frame, not merely the latest", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({
              target_time_seconds: 42.1,
              local_path: "late-but-weak.jpg",
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0.29,
                  edge_density: 0.055,
                  saturation_mean: 0.19,
                },
              },
            }),
            acceptedFrame({
              target_time_seconds: 24.4,
              local_path: "earlier-strong.jpg",
              qa: {
                thumbnail_safe: true,
                verdict: "pass",
                prescan: {
                  likely_is_logo: false,
                  text_overlay_likelihood: 0.04,
                  edge_density: 0.21,
                  saturation_mean: 0.46,
                },
              },
            }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0].provenance.frame_local_path, "earlier-strong.jpg");
  assert.equal(refs[0].provenance.segment_selection_policy, "highest_quality_safe_frame");
  assert.ok(refs[0].provenance.segment_quality_score > 0);
});

test("official clip frame quality score penalises text-heavy and dull frames", () => {
  const strong = scoreOfficialTrailerFrameForClip(
    acceptedFrame({
      qa: {
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0.04,
          edge_density: 0.22,
          saturation_mean: 0.43,
        },
      },
    }),
  );
  const weak = scoreOfficialTrailerFrameForClip(
    acceptedFrame({
      qa: {
        prescan: {
          likely_is_logo: false,
          text_overlay_likelihood: 0.31,
          edge_density: 0.06,
          saturation_mean: 0.16,
        },
      },
    }),
  );

  assert.ok(strong > weak);
});

test("official clip refs choose the later accepted frame per source", () => {
  const refs = buildOfficialTrailerClipsFromFrameReport(
    {
      plans: [
        {
          story_id: "story-1",
          frames: [
            acceptedFrame({ target_time_seconds: 10.8, local_path: "early.jpg" }),
            acceptedFrame({ target_time_seconds: 31.2, local_path: "late.jpg" }),
          ],
        },
      ],
    },
    "story-1",
  );

  assert.equal(refs.length, 1);
  assert.equal(refs[0].provenance.frame_local_path, "late.jpg");
  assert.equal(refs[0].mediaStartS, 36);
});

test("official clip refs inherit local segment validation before Flash Lane use", () => {
  const frameReport = {
    plans: [
      {
        story_id: "story-1",
        frames: [acceptedFrame({ target_time_seconds: 42, local_path: "strong.jpg" })],
      },
    ],
  };
  const unvalidated = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1");
  const refs = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1", {
    segmentValidationReport: {
      generated_at: "2026-05-02T22:00:00.000Z",
      segments: [
        {
          clip_key: segmentKeyForClipRef(unvalidated[0]),
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "segment_samples_passed",
          samples: [{}, {}, {}],
        },
      ],
    },
  });

  assert.equal(refs.length, 1);
  assert.equal(refs[0].provenance.segment_validated, true);
  assert.equal(refs[0].provenance.allowed_for_flash_lane, true);
  assert.equal(refs[0].provenance.segment_validation_reason, "segment_samples_passed");
});

test("official clip refs can filter out segment-validation failures for render packages", () => {
  const frameReport = {
    plans: [
      {
        story_id: "story-1",
        frames: [
          acceptedFrame({
            source_url: "https://video.example/gta.m3u8",
            entity: "GTA",
            target_time_seconds: 42,
          }),
          acceptedFrame({
            source_url: "https://video.example/reddead.m3u8",
            entity: "Red Dead",
            target_time_seconds: 42,
          }),
        ],
      },
    ],
  };
  const unvalidated = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1");
  const refs = buildOfficialTrailerClipsFromFrameReport(frameReport, "story-1", {
    requireValidatedSegments: true,
    segmentValidationReport: {
      generated_at: "2026-05-02T22:00:00.000Z",
      segments: [
        {
          clip_key: segmentKeyForClipRef(unvalidated.find((ref) => ref.entity === "GTA")),
          segment_validated: true,
          allowed_for_flash_lane: true,
          validation_reason: "segment_samples_passed",
          samples: [{}, {}, {}],
        },
        {
          clip_key: segmentKeyForClipRef(unvalidated.find((ref) => ref.entity === "Red Dead")),
          segment_validated: false,
          allowed_for_flash_lane: false,
          validation_reason: "segment_contains_low_detail_frame",
          samples: [{}, {}, {}],
        },
      ],
    },
  });

  assert.equal(refs.length, 1);
  assert.equal(refs[0].entity, "GTA");
  assert.equal(refs[0].provenance.allowed_for_flash_lane, true);
});
