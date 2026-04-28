"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  tokenSummary,
  classifyFacebookReelsEligibility,
  buildFacebookReelsEligibilityReport,
  renderFacebookReelsEligibilityMarkdown,
} = require("../../lib/platforms/facebook-reels-eligibility");

function evidence(overrides = {}) {
  return {
    generatedAt: "2026-04-28T00:00:00.000Z",
    pageId: "page_123",
    token: tokenSummary("fake_page_token_value"),
    page: {
      ok: true,
      data: {
        is_published: true,
        can_post: true,
        fan_count: 0,
        followers_count: 0,
        is_verified: false,
      },
    },
    videos: { ok: true, count: 0, sample: [] },
    reels: { ok: true, count: 0, sample: [] },
    posts: { ok: true, count: 5, sample: [] },
    tokenDebug: {
      ok: true,
      data: {
        type: "PAGE",
        expires_at: "never",
        is_valid: true,
        scopes: ["pages_manage_posts", "publish_video"],
      },
    },
    ...overrides,
  };
}

test("FB Reels eligibility: zero videos/reels keeps Reels gated", () => {
  const result = classifyFacebookReelsEligibility(evidence());
  assert.equal(result.verdict, "review");
  assert.equal(result.reason, "graph_zero_video_surfaces");
  assert.match(result.recommendedAction, /FACEBOOK_REELS_ENABLED=false/);
  assert.equal(result.counts.videos, 0);
  assert.equal(result.counts.reels, 0);
});

test("FB Reels eligibility: visible Graph Reel moves to probe-ready, not auto-enable", () => {
  const result = classifyFacebookReelsEligibility(
    evidence({
      reels: { ok: true, count: 1, sample: [{ id: "reel_1" }] },
    }),
  );
  assert.equal(result.verdict, "eligible_for_probe");
  assert.equal(result.reason, "visible_graph_video_or_reel_found");
  assert.match(result.recommendedAction, /deliberate low-risk Graph API probe/);
});

test("FB Reels eligibility: invalid token blocks enabling", () => {
  const result = classifyFacebookReelsEligibility(
    evidence({
      tokenDebug: { ok: true, data: { is_valid: false, scopes: [] } },
    }),
  );
  assert.equal(result.verdict, "blocked");
  assert.ok(result.hardFails.includes("token_invalid_or_unreadable"));
});

test("FB Reels eligibility markdown is useful and does not print token values", () => {
  const report = buildFacebookReelsEligibilityReport(evidence());
  const md = renderFacebookReelsEligibilityMarkdown(report);
  assert.match(md, /Facebook Reels Eligibility Check/);
  assert.match(md, /\/video_reels: 0/);
  assert.match(md, /read-only Graph API inspection/);
  assert.doesNotMatch(md, /fake_page_token_value/);
});
