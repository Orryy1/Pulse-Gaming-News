/**
 * tests/services/platform-outcomes.test.js
 *
 * Pins the truthful platform-outcome semantics added 2026-04-23
 * after the forensic audit found Discord rendering ✅ for stale
 * pre-existing post ids. See docs / final report for context.
 *
 * Exercises renderPublishSummary against hand-built result shapes
 * (no actual publish pipeline) to prove each outcome maps to the
 * correct Discord glyph and status.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderPublishSummary } = require("../../lib/job-handlers");

function baseResult(outcomes, overrides = {}) {
  return {
    title: "Test story",
    youtube: false,
    tiktok: false,
    instagram: false,
    facebook: false,
    twitter: false,
    errors: {},
    skipped: {},
    fallbacks: {},
    platform_outcomes: Object.assign(
      {
        youtube: "not_attempted",
        tiktok: "not_attempted",
        instagram: "not_attempted",
        facebook: "not_attempted",
        twitter: "not_attempted",
        facebook_card: "not_attempted",
        instagram_story: "not_attempted",
        twitter_image: "not_attempted",
      },
      outcomes,
    ),
    ...overrides,
  };
}

// ---------- 1. Stale existing YouTube id does not render as fresh ✅ ----

test("already_published renders with ↩ glyph, not ✅", () => {
  const r = baseResult(
    {
      youtube: "already_published",
      tiktok: "failed",
      instagram: "already_published",
      facebook: "already_published",
      twitter: "skipped",
    },
    { skipped: { twitter: "twitter_disabled" } },
  );
  const s = renderPublishSummary(r, { jobId: 6719 });
  assert.match(s.message, /YT ↩ already/);
  assert.doesNotMatch(s.message, /YT ✅/);
});

// ---------- 2. Duplicate/sentinel renders as dup ---------------------

test("duplicate_blocked renders ⊘ dup, not ✅", () => {
  const r = baseResult({
    youtube: "duplicate_blocked",
    tiktok: "new_upload",
    instagram: "new_upload",
    facebook: "new_upload",
  });
  r.youtube = false;
  const s = renderPublishSummary(r);
  assert.match(s.message, /YT ⊘ dup/);
});

// ---------- 3. Existing IG media id does not count as new ------------

test("Instagram already_published does not count as new_upload", () => {
  const r = baseResult({
    youtube: "new_upload",
    tiktok: "new_upload",
    instagram: "already_published",
    facebook: "new_upload",
  });
  const s = renderPublishSummary(r);
  assert.match(s.message, /IG Reel ↩ already/);
  assert.match(s.message, /YT ✅/);
});

// ---------- 4. Accepted/processing renders ⏳ -----------------------

test("accepted_processing renders ⏳, not ✅ or ❌", () => {
  const r = baseResult({
    youtube: "new_upload",
    tiktok: "new_upload",
    instagram: "new_upload",
    facebook: "accepted_processing",
  });
  const s = renderPublishSummary(r);
  assert.match(s.message, /FB Reel ⏳/);
  assert.doesNotMatch(s.message, /FB Reel ✅/);
  assert.doesNotMatch(s.message, /FB Reel ❌/);
});

// ---------- 5. FB Card success does not imply FB Reel success ------

test("FB Card already_published does not imply FB Reel success", () => {
  // Stale FB Card, no FB Reel success.
  const r = baseResult({
    youtube: "already_published",
    tiktok: "failed",
    instagram: "already_published",
    facebook: "already_published",
    facebook_card: "already_published",
  });
  const s = renderPublishSummary(r);
  // FB Reel line shows ↩ already (correct distinct state)
  assert.match(s.message, /FB Reel ↩ already/);
  // FB Card shows ↩ already on the Fallbacks line
  assert.match(s.message, /FB Card ↩ already/);
});

// ---------- 6. IG Story success does not imply IG Reel success -----

test("IG Story new_upload does not imply IG Reel success", () => {
  const r = baseResult({
    youtube: "already_published",
    tiktok: "failed",
    instagram: "already_published",
    facebook: "already_published",
    instagram_story: "new_upload",
  });
  const s = renderPublishSummary(r);
  assert.match(s.message, /IG Reel ↩ already/);
  assert.match(s.message, /IG Story ✅/);
  assert.doesNotMatch(s.message, /IG Reel ✅/);
});

// ---------- 7. No platform marked ✅ when no uploader was called ----

test("not_attempted renders — (em dash), not ✅", () => {
  const r = baseResult({
    youtube: "not_attempted",
    tiktok: "not_attempted",
    instagram: "not_attempted",
    facebook: "not_attempted",
    twitter: "not_attempted",
  });
  const s = renderPublishSummary(r);
  assert.match(s.message, /YT —/);
  assert.doesNotMatch(s.message, /YT ✅/);
});

// ---------- 8. Truthful fresh upload renders ✅ ----------------------

test("all-core new_upload renders ✅ and Status: ok", () => {
  const r = baseResult(
    {
      youtube: "new_upload",
      tiktok: "new_upload",
      instagram: "new_upload",
      facebook: "new_upload",
      twitter: "skipped",
    },
    { skipped: { twitter: "twitter_disabled" } },
  );
  const s = renderPublishSummary(r);
  assert.match(s.message, /YT ✅/);
  assert.match(s.message, /TT ✅/);
  assert.match(s.message, /IG Reel ✅/);
  assert.match(s.message, /FB Reel ✅/);
  assert.match(s.message, /Status: {4}ok/);
});

// ---------- 9. Already-published state renders with Status: no_new_post ---

test("all-core already_published yields Status: no_new_post", () => {
  const r = baseResult(
    {
      youtube: "already_published",
      tiktok: "already_published",
      instagram: "already_published",
      facebook: "already_published",
      twitter: "skipped",
    },
    { skipped: { twitter: "twitter_disabled" } },
  );
  const s = renderPublishSummary(r);
  assert.match(s.message, /Status: {4}no_new_post/);
  assert.equal(s.status, "no_new_post");
});

test("partial-retry: 3 already + 1 failed yields no_new_post", () => {
  // This is exactly the shape of today's ghost-success windows:
  // YT/IG/FB already_published from 3 days ago, TT failed with
  // file-not-found. Zero new posts. Must NOT render as "ok".
  const r = baseResult(
    {
      youtube: "already_published",
      tiktok: "failed",
      instagram: "already_published",
      facebook: "already_published",
      twitter: "skipped",
    },
    {
      skipped: { twitter: "twitter_disabled" },
      errors: { tiktok: "Video file not found" },
    },
  );
  const s = renderPublishSummary(r);
  assert.equal(s.status, "no_new_post");
  assert.match(s.message, /TT ❌/);
  assert.match(s.message, /YT ↩ already/);
});

// ---------- 10. No secret / token leakage ---------------------------

test("outcomes rendering is compact and does not fabricate secrets", () => {
  // Source invariant: publisher.js is the scrubbing boundary. It
  // redacts Bearer/access_token/api-key shaped substrings on their
  // way into result.errors (see upload_tiktok.js catch-block and
  // publisher.js TikTok API-fail path). renderPublishSummary then
  // emits errors verbatim on the core-errors detail line.
  //
  // Here we pass already-scrubbed input (simulating the real
  // publisher.js output) and assert the summary passes it through
  // without re-introducing secret-looking strings of its own and
  // stays under the Discord 2000-char cap.
  const r = baseResult(
    {
      youtube: "failed",
      tiktok: "failed",
      instagram: "new_upload",
      facebook: "new_upload",
    },
    {
      errors: {
        youtube: "quota exceeded",
        tiktok: "Bearer <redacted> error",
      },
    },
  );
  const s = renderPublishSummary(r);
  assert.ok(s.message.length < 2000);
  // The redacted markers survive (operator signal).
  assert.match(s.message, /<redacted>/);
  // The summary itself emits no bare Bearer token pattern.
  assert.doesNotMatch(s.message, /Bearer\s+[A-Za-z0-9._-]{10,}/);
});

// ---------- Legacy fallback (platform_outcomes absent) --------------

test("absent platform_outcomes falls back to legacy boolean semantics", () => {
  const r = {
    title: "Legacy shape",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    errors: {},
    skipped: { twitter: "twitter_disabled" },
    fallbacks: {},
  };
  const s = renderPublishSummary(r);
  assert.match(s.message, /YT ✅/);
  assert.match(s.message, /Status: {4}ok/);
});
