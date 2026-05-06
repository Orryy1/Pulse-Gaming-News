"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTikTokCoverCandidateReport,
  rankTikTokCoverCandidates,
  renderTikTokCoverCandidateMarkdown,
  scoreTikTokCoverCandidate,
} = require("../../lib/platforms/tiktok-cover-candidates");

function candidate(overrides = {}) {
  return {
    path: `cover_${overrides.timestampS ?? 12}.jpg`,
    timestampS: 12,
    exists: true,
    prescan: {
      edge_density: 0.24,
      saturation_mean: 0.52,
      text_overlay_likelihood: 0.12,
      white_text_on_dark_likelihood: 0.04,
      dark_pixel_ratio: 0.18,
      bright_pixel_ratio: 0.08,
      likely_has_face: false,
      likely_is_stock_person: false,
      trailer_frame_taste: {
        verdict: "pass",
        reason: "taste_passed",
        score: 84,
        tags: ["gameplay_candidate"],
      },
    },
    ...overrides,
  };
}

test("cover scoring accepts colourful detailed gameplay-like frames", () => {
  const result = scoreTikTokCoverCandidate(candidate({ timestampS: 18 }), {
    durationSeconds: 70,
  });

  assert.equal(result.verdict, "candidate");
  assert.ok(result.score >= 80);
  assert.ok(result.reasons.includes("gameplay_candidate"));
});

test("cover scoring rejects rating and white-text slate frames", () => {
  const result = scoreTikTokCoverCandidate(
    candidate({
      timestampS: 3,
      prescan: {
        white_text_on_dark_likelihood: 0.9,
        text_overlay_likelihood: 0.12,
        edge_density: 0.1,
        saturation_mean: 0.2,
        dark_pixel_ratio: 0.8,
        bright_pixel_ratio: 0.07,
        trailer_frame_taste: {
          verdict: "fail",
          reason: "white_text_on_dark_card",
          score: 18,
          tags: ["very_dark"],
        },
      },
    }),
    { durationSeconds: 70 },
  );

  assert.equal(result.verdict, "reject");
  assert.ok(result.reasons.includes("white_text_on_dark_card"));
});

test("cover ranking rejects very early frames to avoid trailer rating cards", () => {
  const result = scoreTikTokCoverCandidate(candidate({ timestampS: 1.4 }), {
    durationSeconds: 70,
  });

  assert.equal(result.verdict, "reject");
  assert.ok(result.reasons.includes("too_close_to_start"));
});

test("cover ranking avoids stock or portrait-like cover images", () => {
  const result = scoreTikTokCoverCandidate(
    candidate({
      prescan: {
        likely_has_face: true,
        likely_is_stock_person: true,
        trailer_frame_taste: {
          verdict: "pass",
          reason: "taste_passed",
          score: 70,
          tags: [],
        },
      },
    }),
    { durationSeconds: 70 },
  );

  assert.equal(result.verdict, "reject");
  assert.ok(result.reasons.includes("stock_or_portrait_risk"));
});

test("cover ranking picks the strongest non-rejected frame", () => {
  const report = buildTikTokCoverCandidateReport({
    storyId: "story",
    durationSeconds: 70,
    candidates: [
      candidate({ path: "rating.jpg", timestampS: 1.2 }),
      candidate({
        path: "borderline.jpg",
        timestampS: 10,
        prescan: {
          edge_density: 0.1,
          saturation_mean: 0.2,
          text_overlay_likelihood: 0.22,
          trailer_frame_taste: {
            verdict: "warn",
            reason: "taste_borderline",
            score: 51,
            tags: [],
          },
        },
      }),
      candidate({ path: "best.jpg", timestampS: 24 }),
    ],
  });

  assert.equal(report.selected.path, "best.jpg");
  assert.equal(report.ready, true);
  assert.equal(report.ranked[0].path, "best.jpg");
});

test("cover markdown is operator-readable", () => {
  const ranked = rankTikTokCoverCandidates([candidate({ path: "best.jpg" })], {
    durationSeconds: 70,
  });
  const markdown = renderTikTokCoverCandidateMarkdown({
    generatedAt: "2026-05-06T22:00:00.000Z",
    storyId: "story",
    ready: true,
    selected: ranked[0],
    ranked,
  });

  assert.match(markdown, /TikTok Cover Candidates/);
  assert.match(markdown, /Selected: best\.jpg/);
  assert.match(markdown, /No upload or posting action/);
});
