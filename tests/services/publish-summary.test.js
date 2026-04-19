/**
 * tests/services/publish-summary.test.js
 *
 * Pins the Core/Optional/Status Discord summary added 2026-04-19. The
 * old single-line "YT: yes/FAIL | TT: yes/FAIL | IG: yes/FAIL |
 * FB: yes/FAIL | X: yes/FAIL" summary made a Twitter 402 look as bad
 * as a YouTube outage. Post-reclassification:
 *
 *   - TikTok is a CORE platform alongside YouTube, Instagram, Facebook.
 *   - Twitter/X is OPTIONAL and cannot make a publish look broken.
 *   - Overall status is driven by CORE platforms only.
 *
 * Covers:
 *   - all core green + Twitter disabled → status ok, X ⏸ disabled line
 *   - one core (e.g. FB) fails → status degraded, error surfaced
 *   - YouTube AND TikTok both fail → status failed
 *   - a single core failure that isn't YT or TT → still degraded
 *   - Twitter errors never show in the Core error block
 *   - skipped core platform (edge case) is treated as neither pass nor fail
 *
 * Run: node --test tests/services/publish-summary.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderPublishSummary,
  CORE_PLATFORMS,
  OPTIONAL_PLATFORMS,
} = require("../../lib/job-handlers");

test("platform classification: TikTok is core, Twitter is optional", () => {
  assert.ok(CORE_PLATFORMS.includes("tiktok"));
  assert.ok(CORE_PLATFORMS.includes("youtube"));
  assert.ok(CORE_PLATFORMS.includes("instagram"));
  assert.ok(CORE_PLATFORMS.includes("facebook"));
  assert.ok(!CORE_PLATFORMS.includes("twitter"));
  assert.ok(OPTIONAL_PLATFORMS.includes("twitter"));
});

test("all core green + Twitter disabled → ok + '⏸ twitter_disabled'", () => {
  const result = {
    title: "Billbil-kun PS Plus leak",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: {},
  };
  const s = renderPublishSummary(result, { jobId: 42 });
  assert.equal(s.status, "ok");
  assert.match(s.message, /YT ✅/);
  assert.match(s.message, /TT ✅/);
  assert.match(s.message, /IG ✅/);
  assert.match(s.message, /FB ✅/);
  assert.match(s.message, /X ⏸ twitter_disabled/);
  assert.match(s.message, /Status:\s+ok/);
  assert.match(s.message, /job #42/);
  // No core errors block when nothing core failed.
  assert.doesNotMatch(s.message, /FAIL|error|ERROR/);
});

test("one core failure (Facebook) → degraded, error surfaced", () => {
  const result = {
    title: "Tom Henderson Black Flag date",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: false,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: { facebook: "OAuth token expired" },
  };
  const s = renderPublishSummary(result, { jobId: 51 });
  assert.equal(s.status, "degraded");
  assert.match(s.message, /FB ❌/);
  assert.match(s.message, /FB: OAuth token expired/);
  assert.match(s.message, /X ⏸ twitter_disabled/);
  assert.match(s.message, /Status:\s+degraded/);
});

test("YouTube AND TikTok both fail → failed (critical pair)", () => {
  const result = {
    title: "THQ Nordic Switch 2",
    youtube: false,
    tiktok: false,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: {
      youtube: "quota exhausted",
      tiktok: "not authenticated",
    },
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "failed");
  assert.match(s.message, /YT ❌/);
  assert.match(s.message, /TT ❌/);
  assert.match(s.message, /IG ✅/);
  assert.match(s.message, /FB ✅/);
  assert.match(s.message, /YT: quota exhausted/);
  assert.match(s.message, /TT: not authenticated/);
});

test("single non-critical core failure (Instagram only) → degraded", () => {
  const result = {
    title: "something",
    youtube: true,
    tiktok: true,
    instagram: false,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: { instagram: "rate limited" },
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "degraded");
  assert.match(s.message, /IG ❌/);
  assert.match(s.message, /IG: rate limited/);
});

test("Twitter 402 surfaces as Optional ❌, never pollutes Core error block", () => {
  // Simulate TWITTER_ENABLED=true + 402 — Twitter attempt ran, threw,
  // publisher caught into errors.twitter. Status stays ok because all
  // Core platforms succeeded; the summary renders X ❌ under Optional,
  // and the Core error block below does NOT mention twitter.
  const result = {
    title: "ok run with twitter 402",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: {},
    errors: { twitter: "Request failed with status code 402" },
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "ok");
  assert.match(s.message, /X ❌/);
  // Twitter error detail must NOT appear in the Core error tail.
  assert.doesNotMatch(s.message, /X: Request failed/);
  assert.doesNotMatch(s.message, /twitter: Request/);
});

test("skipped core platform is neutral: 3 green + 1 skipped core → ok", () => {
  // Hypothetical future skip (not currently possible in code). Prove the
  // math works: skipped counts as neither pass nor fail.
  const result = {
    title: "partial skip",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: false, // skipped, not failed
    twitter: false,
    skipped: { facebook: "maintenance_window", twitter: "twitter_disabled" },
    errors: {},
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "ok");
  assert.match(s.message, /FB ⏸ maintenance_window/);
  assert.match(s.message, /X ⏸ twitter_disabled/);
});

test("no summary when publishNextStory returned null result", () => {
  const s = renderPublishSummary(null);
  assert.equal(s, null);
});
