const { test } = require("node:test");
const assert = require("node:assert");

// Coverage for the FB Reel publish-verification contract and the
// renderPublishSummary behaviour that keeps FB Reel / FB Card on
// separate lines.
//
// Context: FB Reel publish was marked ✅ in Discord even when
// Meta returned {} or {success: true} without the Reel actually
// going live. Commit bde6c43 introduced the post-publish poll;
// this suite locks the behaviour in and pins the Core-vs-Fallback
// labelling so a successful FB Card can never dress itself up as a
// FB Reel success.

const { interpretReelStatusSnapshot } = require("../../upload_facebook");
const { renderPublishSummary } = require("../../lib/job-handlers");

// ---------- interpretReelStatusSnapshot ----------

test("interpretReelStatusSnapshot: video_status=ready + publish=published → ready", () => {
  const v = interpretReelStatusSnapshot({
    status: {
      video_status: "ready",
      publishing_phase: { status: "published" },
    },
    published: true,
    permalink_url: "https://fb.com/reel/xyz",
  });
  assert.deepStrictEqual(v, { outcome: "ready" });
});

test("interpretReelStatusSnapshot: video_status=ready + published=true (no publishing_phase) → ready", () => {
  // Meta sometimes only sets one of the two signals. Either is
  // sufficient evidence the Reel is live.
  const v = interpretReelStatusSnapshot({
    status: { video_status: "ready" },
    published: true,
  });
  assert.deepStrictEqual(v, { outcome: "ready" });
});

test("interpretReelStatusSnapshot: video_status=error → errored with enum-only reason", () => {
  const v = interpretReelStatusSnapshot({
    status: {
      video_status: "error",
      publishing_phase: { status: "draft" },
    },
  });
  assert.strictEqual(v.outcome, "errored");
  // Must NOT include raw Graph body fields — just enum tags.
  assert.match(v.reason, /^video_status=error publish=draft$/);
});

test("interpretReelStatusSnapshot: still processing → processing (keep polling)", () => {
  const v = interpretReelStatusSnapshot({
    status: {
      video_status: "processing",
      publishing_phase: { status: "draft" },
    },
  });
  assert.deepStrictEqual(v, { outcome: "processing" });
});

test("interpretReelStatusSnapshot: ready video but NOT published → processing, never ready", () => {
  // Finish phase can return `ready` with publish still in a draft
  // state when Meta queues moderation. Don't mark FB Reel ✅ until
  // publish actually flips — the previous "ready is enough" logic
  // is what produced the silent-success regression.
  const v = interpretReelStatusSnapshot({
    status: {
      video_status: "ready",
      publishing_phase: { status: "scheduled" },
    },
    published: false,
  });
  assert.strictEqual(v.outcome, "processing");
});

test("interpretReelStatusSnapshot: null / empty / malformed input → processing (safe default)", () => {
  assert.strictEqual(interpretReelStatusSnapshot(null).outcome, "processing");
  assert.strictEqual(interpretReelStatusSnapshot({}).outcome, "processing");
  assert.strictEqual(
    interpretReelStatusSnapshot({ status: {} }).outcome,
    "processing",
  );
});

test("interpretReelStatusSnapshot: errored reason never embeds the raw response body", () => {
  // Belt-and-braces: if Graph ever returns a `permalink_url` with
  // a short-lived CDN access code embedded, our error message must
  // not echo it. The reason string is tag-only by construction.
  const v = interpretReelStatusSnapshot({
    status: {
      video_status: "error",
      publishing_phase: { status: "draft" },
    },
    permalink_url:
      "https://scontent.xx.fbcdn.net/v/SECRET_LOOKING_CODE_VALUE/video.mp4",
    error: { message: "leak-me" },
  });
  assert.strictEqual(v.reason.includes("SECRET_LOOKING_CODE_VALUE"), false);
  assert.strictEqual(v.reason.includes("leak-me"), false);
});

// ---------- renderPublishSummary: FB Card does not dress as FB Reel ----------

test("renderPublishSummary: successful FB Card alone does NOT flip FB Reel to ✅", () => {
  const summary = renderPublishSummary({
    title: "Test story",
    youtube: true,
    tiktok: false,
    instagram: true,
    facebook: false, // Reel failed
    twitter: false,
    errors: {},
    skipped: { twitter: "disabled" },
    fallbacks: { facebook_card: true, instagram_story: true }, // Card OK
  });
  assert.ok(summary);
  // Core line must show FB Reel ❌ even though FB Card went up.
  assert.match(summary.message, /FB Reel ❌/);
  assert.match(summary.message, /FB Card ✅/);
  // And the overall status must reflect the FB Reel failure, not
  // be rescued by the card.
  assert.notStrictEqual(summary.status, "ok");
});

test("renderPublishSummary: FB Reel ✅ is only when Graph confirmed publish (result.facebook=true)", () => {
  const summary = renderPublishSummary({
    title: "Test story",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true, // Reel verified live
    twitter: false,
    errors: {},
    skipped: { twitter: "disabled" },
    fallbacks: { facebook_card: true },
  });
  assert.match(summary.message, /FB Reel ✅/);
  assert.strictEqual(summary.status, "ok");
});

test("renderPublishSummary: FB Reel failure with Card success renders both outcomes separately", () => {
  // This is the exact mixed shape we want to be truthful about —
  // the 2026-04-20 regression was "FB Reel ✅" lying while the
  // Reel was absent and only the Card was live.
  const summary = renderPublishSummary({
    title: "Mixed",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: false,
    twitter: false,
    errors: { facebook: "Facebook Reel did not go live within 2 min" },
    skipped: { twitter: "disabled" },
    fallbacks: { facebook_card: true },
  });
  // Core line: FB Reel ❌ (not ✅)
  assert.match(summary.message, /FB Reel ❌/);
  // Fallbacks line: FB Card ✅
  assert.match(summary.message, /FB Card ✅/);
  // Error detail surfaces — caller can see it in Discord. Must be
  // the enum-style failure reason, not a raw Graph response dump.
  assert.match(summary.message, /FB Reel: Facebook Reel did not go live/);
  // Status is at least degraded.
  assert.strictEqual(summary.status, "degraded");
});
