"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveOfficialTrailerClipRefsForProof,
} = require("../../lib/studio/v2/proof-official-clip-safety");

function frame({ entity = "GTA", source = "https://video.example/gta.m3u8", seconds = 44 } = {}) {
  return {
    story_id: "story-1",
    status: "accepted",
    source_url: source,
    source_type: "steam_movie",
    entity,
    target_time_seconds: seconds,
    qa: {
      verdict: "pass",
      thumbnail_safe: true,
      likely_has_face: false,
      black_frame: false,
      prescan: {
        edge_density: 0.24,
        saturation_mean: 0.42,
        text_overlay_likelihood: 0.04,
        white_text_on_dark_likelihood: 0,
      },
    },
  };
}

function frameReport(frames = []) {
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
  entity = "GTA",
  source = "https://video.example/gta.m3u8",
  start = 48,
  allowed = true,
} = {}) {
  return {
    story_id: "story-1",
    clip_key: `${source}|${entity.toLowerCase()}|${Number(start).toFixed(2)}`,
    source_url: source,
    source_type: "steam_movie",
    entity,
    media_start_s: start,
    duration_s: 5,
    status: allowed ? "validated" : "rejected",
    segment_validated: allowed,
    allowed_for_flash_lane: allowed,
    validation_reason: allowed ? "segment_samples_passed" : "segment_contains_title_card",
    samples: [{}, {}, {}],
  };
}

test("proof official clips are disabled when the feature flag is off", () => {
  const result = resolveOfficialTrailerClipRefsForProof({
    storyId: "story-1",
    frameReport: frameReport([frame()]),
    useOfficialTrailerClips: false,
  });

  assert.equal(result.clipRefs.length, 0);
  assert.equal(result.safety.status, "disabled");
});

test("proof official clips require segment validation by default", () => {
  const result = resolveOfficialTrailerClipRefsForProof({
    storyId: "story-1",
    frameReport: frameReport([frame()]),
    useOfficialTrailerClips: true,
  });

  assert.equal(result.clipRefs.length, 0);
  assert.equal(result.safety.status, "blocked_missing_segment_validation");
  assert.match(result.safety.reason, /segment validation/i);
});

test("proof official clips use only validated segment-backed refs", () => {
  const result = resolveOfficialTrailerClipRefsForProof({
    storyId: "story-1",
    frameReport: frameReport([
      frame({ entity: "GTA", source: "https://video.example/gta.m3u8" }),
      frame({ entity: "BioShock", source: "https://video.example/bio.m3u8" }),
    ]),
    segmentValidationReport: {
      segments: [
        segment({ entity: "GTA", source: "https://video.example/gta.m3u8" }),
        segment({
          entity: "BioShock",
          source: "https://video.example/bio.m3u8",
          allowed: false,
        }),
      ],
    },
    useOfficialTrailerClips: true,
  });

  assert.equal(result.clipRefs.length, 1);
  assert.equal(result.clipRefs[0].entity, "GTA");
  assert.equal(result.clipRefs[0].provenance.segment_validated, true);
  assert.equal(result.safety.status, "validated_segments_only");
});

test("proof official clips can build unvalidated refs only for explicit diagnostic mode", () => {
  const result = resolveOfficialTrailerClipRefsForProof({
    storyId: "story-1",
    frameReport: frameReport([frame()]),
    useOfficialTrailerClips: true,
    allowUnvalidatedOfficialClips: true,
  });

  assert.ok(result.clipRefs.length > 0);
  assert.equal(result.safety.status, "unvalidated_diagnostic_only");
  assert.equal(result.clipRefs[0].provenance.allowed_for_flash_lane, false);
});
