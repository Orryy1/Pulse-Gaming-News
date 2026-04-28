"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAnalyticsClient,
  fixturePullForVideo,
  SNAPSHOT_LABELS,
  REQUIRED_REAL_SCOPES,
} = require("../../lib/intelligence/analytics-client");
const {
  classifyComment,
  classifyMany,
  summariseVerdicts,
} = require("../../lib/intelligence/comment-classifier");
const {
  draftReply,
  buildReplyQueue,
} = require("../../lib/intelligence/reply-drafter");
const {
  buildMonetisationSnapshot,
  trackYPP,
  YPP_THRESHOLDS,
} = require("../../lib/intelligence/monetisation-tracker");
const {
  ROUTES,
  rankRoutesForBreakingNews,
  recommend: recommendTikTok,
} = require("../../lib/intelligence/tiktok-strategy");
const {
  extractVideoFeatures,
  detectTitlePattern,
  detectHookType,
  detectFranchise,
} = require("../../lib/intelligence/feature-extractor");
const {
  buildLearningDigest,
  renderDigestMarkdown,
  median,
  confidenceFor,
} = require("../../lib/intelligence/learning-digest");

// ── analytics-client ──────────────────────────────────────────────

test("analytics-client: fixture mode returns 6 snapshot labels", () => {
  const rows = fixturePullForVideo("vid-x");
  const labels = rows.map((r) => r.snapshot_label);
  assert.deepEqual(labels, SNAPSHOT_LABELS);
  assert.deepEqual(SNAPSHOT_LABELS, [
    "+1h",
    "+3h",
    "+24h",
    "+72h",
    "+7d",
    "+28d",
  ]);
});

test("analytics-client: real mode requires INTELLIGENCE_REAL_MODE=true", () => {
  delete process.env.INTELLIGENCE_REAL_MODE;
  assert.throws(
    () => buildAnalyticsClient({ mode: "real" }),
    /INTELLIGENCE_REAL_MODE=true/,
  );
});

test("analytics-client: declares the missing yt-analytics.readonly scope", () => {
  assert.deepEqual(REQUIRED_REAL_SCOPES, [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ]);
});

test("analytics-client: fixture pullSnapshotsForVideos handles empty input", async () => {
  const client = buildAnalyticsClient({ mode: "fixture" });
  const rows = await client.pullSnapshotsForVideos([]);
  assert.deepEqual(rows, []);
});

// ── comment-classifier ────────────────────────────────────────────

test("comment-classifier: hype text → hype/no_reply_needed", () => {
  const v = classifyComment({
    textOriginal: "Day 1 buy. Hyped beyond belief.",
  });
  assert.equal(v.category, "hype");
  assert.equal(v.decision, "no_reply_needed");
});

test("comment-classifier: question → draft_reply_candidate", () => {
  const v = classifyComment({ textOriginal: "Will this be on Switch too?" });
  assert.equal(v.category, "question");
  assert.equal(v.decision, "draft_reply_candidate");
});

test("comment-classifier: spam URL → moderation_review", () => {
  const v = classifyComment({
    textOriginal: "free nitro at https://discord.gg/totallylegit",
  });
  assert.equal(v.category, "abuse_spam");
  assert.equal(v.decision, "moderation_review");
});

test("comment-classifier: abuse term → moderation_review", () => {
  const v = classifyComment({ textOriginal: "you're an idiot" });
  assert.equal(v.category, "abuse_spam");
  assert.equal(v.decision, "moderation_review");
});

test("comment-classifier: useful criticism → needs_review", () => {
  const v = classifyComment({
    textOriginal:
      "Audio was a bit low on the cold open and the captions are mistimed at 0:14.",
  });
  assert.equal(v.category, "useful_criticism");
  assert.equal(v.decision, "needs_review");
});

test("comment-classifier: correction → needs_review", () => {
  const v = classifyComment({
    textOriginal:
      "Actually that release date is wrong, the publisher pushed it back to next month.",
  });
  assert.equal(v.category, "correction");
  assert.equal(v.decision, "needs_review");
});

test("comment-classifier: topic suggestion → needs_review", () => {
  const v = classifyComment({
    textOriginal: "Can you cover the Pale Compass roadmap next?",
  });
  assert.equal(v.category, "topic_suggestion");
  assert.equal(v.decision, "needs_review");
});

test("comment-classifier: noise → ignore", () => {
  const v = classifyComment({ textOriginal: "okay" });
  assert.equal(v.category, "noise");
  assert.equal(v.decision, "ignore");
});

test("comment-classifier: summariseVerdicts counts categories + decisions", () => {
  const verdicts = classifyMany([
    { textOriginal: "Hyped" },
    { textOriginal: "Will this be on Switch?" },
    { textOriginal: "free nitro https://discord.gg/x" },
    { textOriginal: "okay" },
  ]);
  const s = summariseVerdicts(verdicts);
  assert.equal(s.total, 4);
  assert.equal(s.counts.hype, 1);
  assert.equal(s.counts.question, 1);
  assert.equal(s.counts.abuse_spam, 1);
  assert.equal(s.counts.noise, 1);
  assert.equal(s.decisions.draft_reply_candidate, 1);
  assert.equal(s.decisions.moderation_review, 1);
  assert.equal(s.decisions.no_reply_needed, 1);
  assert.equal(s.decisions.ignore, 1);
});

// ── reply-drafter ─────────────────────────────────────────────────

test("reply-drafter: every draft is tagged is_draft + auto_send=false", () => {
  const verdicts = classifyMany([
    { textOriginal: "Will this be on Switch?", id: "q1", videoId: "v1" },
    {
      textOriginal: "Can you cover Pale Compass?",
      id: "q2",
      videoId: "v1",
    },
    { textOriginal: "Actually the date is wrong.", id: "q3", videoId: "v1" },
  ]);
  const queue = buildReplyQueue(verdicts);
  assert.ok(queue.length >= 1);
  for (const entry of queue) {
    assert.equal(entry.draft.is_draft, true);
    assert.equal(entry.draft.auto_send, false);
    assert.equal(entry.draft.requires_operator_review, true);
  }
});

test("reply-drafter: spam comments get NO draft", () => {
  const verdicts = classifyMany([
    { textOriginal: "free nitro https://discord.gg/x", id: "s1" },
    { textOriginal: "you're an idiot", id: "s2" },
  ]);
  const queue = buildReplyQueue(verdicts);
  assert.equal(queue.length, 0);
});

test("reply-drafter: draftReply on no-reply-needed returns null", () => {
  const v = classifyComment({ textOriginal: "Hyped, day 1 buy" });
  const draft = draftReply({ comment: { textOriginal: "Hyped" }, verdict: v });
  assert.equal(draft, null);
});

// ── monetisation-tracker ──────────────────────────────────────────

test("monetisation: YPP requires subs AND one watch path", () => {
  const ypp = trackYPP({
    subscribers: 1500,
    shorts_views_90d: 0,
    longform_watch_hours_12m: 0,
  });
  assert.equal(ypp.yppEligible, false);
  const ypp2 = trackYPP({
    subscribers: 1500,
    shorts_views_90d: 11_000_000,
    longform_watch_hours_12m: 0,
  });
  assert.equal(ypp2.yppEligible, true);
  const ypp3 = trackYPP({
    subscribers: 1500,
    shorts_views_90d: 0,
    longform_watch_hours_12m: 5000,
  });
  assert.equal(ypp3.yppEligible, true);
  const ypp4 = trackYPP({
    subscribers: 0,
    shorts_views_90d: 11_000_000,
    longform_watch_hours_12m: 5000,
  });
  assert.equal(ypp4.yppEligible, false);
});

test("monetisation: YPP thresholds match the documented values", () => {
  assert.equal(YPP_THRESHOLDS.subscribers.value, 1000);
  assert.equal(YPP_THRESHOLDS.shorts_views_90d.value, 10_000_000);
  assert.equal(YPP_THRESHOLDS.longform_watch_hours_12m.value, 4_000);
});

test("monetisation: snapshot reports per-section progress without fantasy revenue", () => {
  const s = buildMonetisationSnapshot({
    subscribers: 320,
    shorts_views_90d: 28_000,
    longform_watch_hours_12m: 4,
    amazon_affiliate_tag: "pulsegaming-21",
  });
  assert.ok(s.sections.youtube_partner_programme);
  assert.ok(s.sections.affiliate);
  assert.ok(s.sections.newsletter);
  assert.ok(s.sections.blog_seo);
  assert.ok(s.sections.sponsorship);
  assert.ok(s.sections.tiktok_creator_rewards);
  // snapshot must not invent a "revenue" number — check no surface
  // shape carries one.
  assert.equal(typeof s.summary.cleared, "number");
  assert.equal(typeof s.summary.ypp_eligible, "boolean");
  assert.ok(!("revenue" in s.summary));
  assert.ok(!("expected_revenue" in s.summary));
});

// ── tiktok-strategy ───────────────────────────────────────────────

test("tiktok-strategy: 5 routes, ranked", () => {
  assert.equal(ROUTES.length, 5);
  const sorted = rankRoutesForBreakingNews().map((r) => r.id);
  assert.equal(sorted[0], "official_api_reapply_business");
});

test("tiktok-strategy: recommend rejects browser RPA explicitly", () => {
  const r = recommendTikTok({ hasOperatorOnPhone: true });
  const rejected = r.rejected.find((x) => x.id === "browser_rpa_automation");
  assert.ok(rejected);
  assert.match(rejected.reason, /forbid|account ban|automated/i);
});

test("tiktok-strategy: business migration unlocks the official API as primary", () => {
  const r = recommendTikTok({ canMigrateToBusiness: true });
  assert.equal(r.primaryRecommendation.id, "official_api_reapply_business");
});

// ── feature-extractor ─────────────────────────────────────────────

test("feature-extractor: detectTitlePattern handles common shapes", () => {
  assert.equal(detectTitlePattern("What time does it launch?"), "question");
  assert.equal(
    detectTitlePattern("Aurora Drift Beta Confirmed"),
    "confirmed_reveal",
  );
  assert.equal(
    detectTitlePattern("Iron Saint Leak: Roadmap Detailed"),
    "leak_rumour",
  );
  assert.equal(
    detectTitlePattern("Top 10 Games of 2026"),
    "year_led", // matches /20\d\d/ first
  );
});

test("feature-extractor: detectHookType picks reasonable buckets", () => {
  assert.equal(detectHookType("This is real and confirmed"), "hard_reveal");
  assert.equal(detectHookType("Why is this happening?"), "question");
  assert.equal(
    detectHookType("Here's what just happened with the launch"),
    "fact_stack",
  );
});

test("feature-extractor: extractVideoFeatures emits all required fields", () => {
  const story = {
    id: "s1",
    title: "Iron Saint Roadmap Confirmed",
    flair: "Confirmed",
    youtube_post_id: "v1",
    duration_seconds: 50,
    downloaded_images: [
      { path: "x://k.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "x://h.jpg", type: "hero", source: "steam", priority: 92 },
      { path: "x://s.jpg", type: "screenshot", source: "steam", priority: 88 },
    ],
    video_clips: [],
  };
  const f = extractVideoFeatures(story);
  for (const k of [
    "story_id",
    "video_id",
    "title",
    "format_type",
    "media_inventory_class",
    "thumbnail_safety_status",
    "title_pattern",
    "hook_type",
    "flair_confidence",
  ]) {
    assert.ok(k in f, `missing field: ${k}`);
  }
});

// ── learning-digest ───────────────────────────────────────────────

test("learning-digest: median + confidence helpers", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(confidenceFor(0), "insufficient");
  assert.equal(confidenceFor(3), "low");
  assert.equal(confidenceFor(6), "medium");
  assert.equal(confidenceFor(15), "high");
});

test("learning-digest: empty input → insufficient confidence, no crash", () => {
  const d = buildLearningDigest({ snapshotsByVideo: {}, features: [] });
  assert.equal(d.confidence, "insufficient");
  assert.equal(d.total_videos, 0);
  assert.match(renderDigestMarkdown(d), /Learning Digest/);
});

test("learning-digest: real digest with fixture data emits all sections", () => {
  const features = [
    {
      video_id: "v1",
      title: "Iron Saint Confirmed",
      format_type: "daily_shorts",
      topic: "playstation",
      title_pattern: "confirmed_reveal",
      media_inventory_class: "premium_video",
    },
    {
      video_id: "v2",
      title: "Pale Compass Update",
      format_type: "daily_shorts",
      topic: "pc_steam",
      title_pattern: "statement",
      media_inventory_class: "standard_video",
    },
  ];
  const snapshotsByVideo = {
    v1: [
      {
        snapshot_label: "+24h",
        views: 5000,
        average_percentage_viewed: 0.55,
        average_view_duration_seconds: 30,
        comments: 12,
        subscribers_gained: 4,
      },
    ],
    v2: [
      {
        snapshot_label: "+24h",
        views: 1200,
        average_percentage_viewed: 0.31,
        average_view_duration_seconds: 18,
        comments: 2,
        subscribers_gained: 0,
      },
    ],
  };
  const d = buildLearningDigest({ snapshotsByVideo, features });
  assert.equal(d.total_videos, 2);
  assert.ok(d.by_format.length >= 1);
  assert.ok(d.by_topic.length >= 1);
  assert.equal(d.safety.auto_promote_formats, false);
  assert.equal(d.safety.auto_change_scoring_weights, false);
});
