"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { renderPublishSummary } = require("../../lib/job-handlers");

// 2026-04-29 audit P1: every Discord publish summary should expose
// the render lane + visual count + outro state so the operator sees
// per-publish render quality without grepping the DB. Stamp-less
// pre-2026-04-29 rows render as "(unstamped)" so the absence is
// visible.

function basePublishResult(overrides = {}) {
  return {
    title: "Test Story",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: false,
    twitter: false,
    errors: {},
    skipped: {},
    fallbacks: {
      facebook_card: false,
      instagram_story: false,
      twitter_image: false,
    },
    platform_outcomes: {
      youtube: "new_upload",
      tiktok: "new_upload",
      instagram: "new_upload",
    },
    ...overrides,
  };
}

test("publish summary: stamped multi-image render shows lane + class + visual count", () => {
  const summary = renderPublishSummary(
    basePublishResult({
      render_lane: "legacy_multi_image",
      render_quality_class: "premium",
      distinct_visual_count: 6,
      outro_present: true,
    }),
  );
  assert.match(summary.message, /Render:\s+lane=legacy_multi_image/);
  assert.match(summary.message, /class=premium/);
  assert.match(summary.message, /visuals=6/);
  assert.doesNotMatch(summary.message, /thin/);
  assert.doesNotMatch(summary.message, /outro=missing/);
});

test("publish summary: thin-visual render flags it with a warning", () => {
  const summary = renderPublishSummary(
    basePublishResult({
      render_lane: "legacy_single_image_fallback",
      render_quality_class: "fallback",
      distinct_visual_count: 1,
      outro_present: true,
    }),
  );
  assert.match(summary.message, /visuals=1.*thin/);
});

test("publish summary: missing outro is flagged", () => {
  const summary = renderPublishSummary(
    basePublishResult({
      render_lane: "legacy_multi_image",
      render_quality_class: "standard",
      distinct_visual_count: 4,
      outro_present: false,
    }),
  );
  assert.match(summary.message, /outro=missing/);
});

test("publish summary: pre-stamp row renders '(unstamped)' explicitly", () => {
  const summary = renderPublishSummary(
    basePublishResult({
      render_lane: null,
      render_quality_class: null,
      distinct_visual_count: null,
      outro_present: null,
    }),
  );
  assert.match(summary.message, /Render:\s+\(unstamped/);
});

test("publish summary: visual count = 0 still renders (composite render visible)", () => {
  const summary = renderPublishSummary(
    basePublishResult({
      render_lane: "legacy_single_image_fallback",
      render_quality_class: "reject",
      distinct_visual_count: 0,
      outro_present: true,
    }),
  );
  assert.match(summary.message, /visuals=0.*thin/);
  assert.match(summary.message, /class=reject/);
});

test("publish summary: render_fallback_reason surfaces in Discord line", () => {
  // 2026-04-30 forensic stamp: when assemble.js dropped to single-
  // image fallback, the ffmpeg stderr tail is now persisted onto
  // the publish result. The summary should render the first ~80 chars
  // so the operator can see WHY the fallback fired without diving
  // into Railway logs.
  const summary = renderPublishSummary(
    basePublishResult({
      render_lane: "legacy_single_image_fallback",
      render_quality_class: "fallback",
      distinct_visual_count: 8,
      outro_present: true,
      render_fallback_reason:
        "ffmpeg: complex filtergraph error: invalid argument near input 7",
    }),
  );
  assert.match(summary.message, /fallback_reason="ffmpeg: complex filtergraph/);
});

test("publish summary: render_fallback_reason absent → no fallback_reason line", () => {
  const summary = renderPublishSummary(
    basePublishResult({
      render_lane: "legacy_multi_image",
      render_quality_class: "premium",
      distinct_visual_count: 6,
      outro_present: true,
      render_fallback_reason: null,
    }),
  );
  assert.doesNotMatch(summary.message, /fallback_reason/);
});

test("publish summary: render_fallback_reason truncated in Discord line", () => {
  // Long error (300 chars) — must show only the first ~80 chars
  const longErr = "x".repeat(300);
  const summary = renderPublishSummary(
    basePublishResult({
      render_lane: "legacy_single_image_fallback",
      render_quality_class: "fallback",
      distinct_visual_count: 5,
      outro_present: true,
      render_fallback_reason: longErr,
    }),
  );
  // Output should match fallback_reason="..." with the truncated content,
  // not the entire 300 chars.
  const match = summary.message.match(/fallback_reason="([^"]+)…?"/);
  assert.ok(match);
  assert.ok(match[1].length <= 100);
});
