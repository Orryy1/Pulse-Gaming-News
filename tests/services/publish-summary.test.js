/**
 * tests/services/publish-summary.test.js
 *
 * Pins the Core / Fallbacks / Optional / Status Discord summary.
 *
 * 2026-04-19 (initial split): the old single-line "YT: yes/FAIL | TT:
 * yes/FAIL | IG: yes/FAIL | FB: yes/FAIL | X: yes/FAIL" summary made a
 * Twitter 402 look as bad as a YouTube outage.
 *
 * 2026-04-19 (Reel-vs-Card reset): renamed core FB/IG labels to "FB Reel"
 * / "IG Reel" and introduced a Fallbacks line for the static card posts
 * that post ALONGSIDE the Reel (FB Card via /photo_stories, IG Story,
 * Twitter image tweet). Before this change, FB ✅ meant "the Reel API
 * returned a videoId" but the card also posted regardless, which looked
 * on Facebook like only the card had shipped. Now the summary
 * distinguishes video reach from card reach and status is computed from
 * Reels only.
 *
 * Covers:
 *   - classification invariants (TikTok core, Twitter optional)
 *   - all core green + FB Card + Twitter disabled → ok + three lines
 *   - one core Reel fails → degraded, error surfaced, Reel label used
 *   - YouTube AND TikTok both fail → failed (critical pair)
 *   - IG-Reel-only failure → degraded
 *   - Twitter 402 lives under Optional, never pollutes Core error tail
 *   - Fallbacks line only renders when a fallback was actually attempted
 *   - FB Reel ❌ + FB Card ✅ shape: renders BOTH lines correctly
 *     (this is the exact shape the channel owner was concerned about)
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
  FALLBACK_POSTS,
} = require("../../lib/job-handlers");

// ---------- Classification invariants ----------

test("platform classification: TikTok is core, Twitter is optional", () => {
  assert.ok(CORE_PLATFORMS.includes("tiktok"));
  assert.ok(CORE_PLATFORMS.includes("youtube"));
  assert.ok(CORE_PLATFORMS.includes("instagram"));
  assert.ok(CORE_PLATFORMS.includes("facebook"));
  assert.ok(!CORE_PLATFORMS.includes("twitter"));
  assert.ok(OPTIONAL_PLATFORMS.includes("twitter"));
});

test("fallback posts declared separately — not counted as core", () => {
  const keys = FALLBACK_POSTS.map((f) => f.key);
  assert.ok(keys.includes("facebook_card"));
  assert.ok(keys.includes("instagram_story"));
  assert.ok(keys.includes("twitter_image"));
  // Labels must distinguish themselves from the Reel labels.
  const labels = FALLBACK_POSTS.map((f) => f.label);
  assert.ok(labels.includes("FB Card"));
  assert.ok(labels.includes("IG Story"));
});

// ---------- All-green happy path ----------

test("all core Reels green + FB Card + IG Story + Twitter disabled → ok + three lines", () => {
  const result = {
    title: "Billbil-kun PS Plus leak",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: {},
    fallbacks: {
      facebook_card: true,
      instagram_story: true,
      twitter_image: false,
    },
  };
  const s = renderPublishSummary(result, { jobId: 42 });
  assert.equal(s.status, "ok");
  // Core line uses the Reel labels — explicit so there's no confusion
  // with the card/Story posts below.
  assert.match(s.message, /YT ✅/);
  assert.match(s.message, /TT ✅/);
  assert.match(s.message, /IG Reel ✅/);
  assert.match(s.message, /FB Reel ✅/);
  assert.match(s.message, /Fallbacks:\s+FB Card ✅ · IG Story ✅/);
  assert.match(s.message, /X ⏸ twitter_disabled/);
  assert.match(s.message, /Status:\s+ok/);
  assert.match(s.message, /job #42/);
  assert.doesNotMatch(s.message, /ERROR|error:/);
});

// ---------- The motivating case: FB Reel vs FB Card ----------

test("FB Reel ❌ + FB Card ✅ renders BOTH lines (channel-owner-reported shape)", () => {
  // This is the exact scenario the owner flagged: "Facebook appears to
  // be posting the static card/story image, not the actual video Reel."
  // Before the split, this shape rendered as FB ✅ and hid the Reel
  // failure. Now it MUST render as "FB Reel ❌" on the Core line and
  // "FB Card ✅" on the Fallbacks line.
  const result = {
    title: "Reel failed, card shipped",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: false,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: { facebook: "video_reels finish phase timeout" },
    fallbacks: {
      facebook_card: true,
      instagram_story: true,
      twitter_image: false,
    },
  };
  const s = renderPublishSummary(result, { jobId: 99 });
  assert.equal(s.status, "degraded");
  assert.match(s.message, /FB Reel ❌/);
  assert.match(s.message, /FB Card ✅/);
  // Core error block surfaces the Reel error with the Reel label, not
  // the generic "FB" label.
  assert.match(s.message, /FB Reel: video_reels finish phase timeout/);
  // Ensure FB Card success isn't hiding the Reel failure.
  assert.doesNotMatch(s.message, /^Core:.*FB Reel ✅/m);
});

test("FB Reel ✅ + FB Card ✅ (same run, both succeed) — renders both lines", () => {
  const result = {
    title: "both shipped",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: {},
    fallbacks: {
      facebook_card: true,
      instagram_story: false,
      twitter_image: false,
    },
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "ok");
  assert.match(s.message, /FB Reel ✅/);
  assert.match(s.message, /FB Card ✅/);
});

// ---------- Core-only failures ----------

test("one core Reel failure (Facebook Reel) → degraded, error surfaced", () => {
  const result = {
    title: "Tom Henderson Black Flag date",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: false,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: { facebook: "OAuth token expired" },
    fallbacks: {},
  };
  const s = renderPublishSummary(result, { jobId: 51 });
  assert.equal(s.status, "degraded");
  assert.match(s.message, /FB Reel ❌/);
  assert.match(s.message, /FB Reel: OAuth token expired/);
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
    fallbacks: {},
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "failed");
  assert.match(s.message, /YT ❌/);
  assert.match(s.message, /TT ❌/);
  assert.match(s.message, /IG Reel ✅/);
  assert.match(s.message, /FB Reel ✅/);
  assert.match(s.message, /YT: quota exhausted/);
  assert.match(s.message, /TT: not authenticated/);
});

test("single non-critical core failure (IG Reel only) → degraded", () => {
  const result = {
    title: "something",
    youtube: true,
    tiktok: true,
    instagram: false,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: { instagram: "rate limited" },
    fallbacks: {},
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "degraded");
  assert.match(s.message, /IG Reel ❌/);
  assert.match(s.message, /IG Reel: rate limited/);
});

// ---------- Optional + error-scoping ----------

test("Twitter 402 lives under Optional — never pollutes Core error tail", () => {
  const result = {
    title: "ok run with twitter 402",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: {},
    errors: { twitter: "Request failed with status code 402" },
    fallbacks: {},
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "ok");
  assert.match(s.message, /X ❌/);
  assert.doesNotMatch(s.message, /X: Request failed/);
  assert.doesNotMatch(s.message, /twitter: Request/);
});

// ---------- Fallbacks line is suppressed when nothing to show ----------

test("no story_image_path → Fallbacks line is omitted entirely", () => {
  const result = {
    title: "video-only run, no fallback card attempted",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: {},
    fallbacks: {
      facebook_card: false,
      instagram_story: false,
      twitter_image: false,
    },
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "ok");
  assert.doesNotMatch(
    s.message,
    /Fallbacks:/,
    "Fallbacks line must be suppressed when no fallback post was attempted",
  );
});

test("FB Card ❌ alone → Fallbacks line shows it, overall status unaffected", () => {
  const result = {
    title: "all Reels green, FB card failed",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: { facebook_story: "photo_stories permission denied" },
    fallbacks: {
      facebook_card: false,
      instagram_story: true,
      twitter_image: false,
    },
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "ok", "FB Card failure must NOT affect core status");
  assert.match(s.message, /FB Card ❌/);
  assert.match(s.message, /IG Story ✅/);
});

// ---------- Skipped core platform is neutral ----------

test("skipped core platform is neutral: 3 green + 1 skipped core → ok", () => {
  const result = {
    title: "partial skip",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: false,
    twitter: false,
    skipped: { facebook: "maintenance_window", twitter: "twitter_disabled" },
    errors: {},
    fallbacks: {},
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "ok");
  assert.match(s.message, /FB Reel ⏸ maintenance_window/);
  assert.match(s.message, /X ⏸ twitter_disabled/);
});

test("no summary when publishNextStory returned null result", () => {
  const s = renderPublishSummary(null);
  assert.equal(s, null);
});

// ---------- Multi-candidate fallback Discord summaries (2026-04-22) ----

test("no-safe-candidate result renders failed summary with Top reason + Skipped count", () => {
  // Every candidate in the window hit a QA hard-fail. Operator must
  // see (a) that the window failed, (b) how many candidates were
  // tried, (c) what broke them.
  const result = {
    no_safe_candidate: true,
    candidates_tried: 3,
    qa_skipped_count: 3,
    top_reason: "content_qa: exported_mp4_not_on_disk",
    qa_skipped: [
      {
        id: "a",
        title: "Story A",
        reason: "exported_mp4_not_on_disk",
        source: "content",
      },
      {
        id: "b",
        title: "Story B",
        reason: "exported_mp4_not_on_disk",
        source: "content",
      },
      {
        id: "c",
        title: "Story C",
        reason: "script_missing",
        source: "content",
      },
    ],
  };
  const s = renderPublishSummary(result, { jobId: 999 });
  assert.equal(s.status, "failed");
  assert.match(s.message, /Pulse Gaming Publish Attempt/);
  assert.match(s.message, /job #999/);
  assert.match(s.message, /No safe publish candidate passed QA/);
  assert.match(s.message, /Candidates tried: 3/);
  assert.match(s.message, /Skipped QA-failed candidates: 3/);
  assert.match(s.message, /Top reason: content_qa: exported_mp4_not_on_disk/);
  assert.match(s.message, /Story A/);
  assert.match(s.message, /Story B/);
  assert.match(s.message, /Story C/);
});

test("successful publish with qa_skipped_count > 0 includes the skipped line", () => {
  // First candidate QA-failed, second candidate published fine.
  // Operator wants to know the window nearly burned.
  const result = {
    title: "Retro Raiders Remaster",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: {},
    fallbacks: {},
    qa_skipped_count: 1,
    qa_skipped: [
      {
        id: "x",
        title: "Stale mp4",
        reason: "exported_mp4_not_on_disk",
        source: "content",
      },
    ],
  };
  const s = renderPublishSummary(result, { jobId: 42 });
  assert.equal(s.status, "ok");
  assert.match(s.message, /Retro Raiders Remaster/);
  assert.match(s.message, /Skipped QA-failed candidates: 1/);
});

test("successful publish with qa_skipped_count = 0 does NOT render the skipped line", () => {
  const result = {
    title: "Clean first pass",
    youtube: true,
    tiktok: true,
    instagram: true,
    facebook: true,
    twitter: false,
    skipped: { twitter: "twitter_disabled" },
    errors: {},
    fallbacks: {},
    qa_skipped_count: 0,
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "ok");
  assert.doesNotMatch(s.message, /Skipped QA-failed candidates/);
});

test("no-safe-candidate summary is still concise (no secrets, no full stack trace)", () => {
  // Pin: the failed-candidates block shows up to 3 entries, titles
  // are truncated to 80 chars, and no raw qa_failures arrays leak.
  const longTitle = "A".repeat(200);
  const result = {
    no_safe_candidate: true,
    candidates_tried: 5,
    qa_skipped_count: 5,
    top_reason: "content_qa: script_too_short (12 words, min 80)",
    qa_skipped: Array.from({ length: 5 }, (_, i) => ({
      id: `rss_${i}`,
      title: longTitle,
      reason: "script_too_short",
      source: "content",
    })),
  };
  const s = renderPublishSummary(result);
  assert.equal(s.status, "failed");
  // Only the first 3 titles should appear in the "Failed candidates" list.
  const titleHits = (s.message.match(/A{80}/g) || []).length;
  assert.equal(titleHits, 3, "summary must cap the displayed titles at 3");
  // Individual titles are truncated to 80 chars — no 200-char run.
  assert.doesNotMatch(s.message, /A{100}/);
  // Under 2000 chars (Discord cap).
  assert.ok(s.message.length < 2000);
});
