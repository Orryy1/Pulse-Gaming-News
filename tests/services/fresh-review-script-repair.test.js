"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFreshReviewScriptRepairPlan,
  selectFreshReviewScriptRepairRows,
} = require("../../lib/ops/fresh-review-script-repair");
const { commandSafety } = require("../../lib/ops/auto-repair-runner");

const NOW = "2026-06-17T09:00:00.000Z";

function row(overrides = {}) {
  return {
    story_id: "rss_hellraiser",
    title: "Hellraiser Revival Gets October Release Date",
    url: "https://www.eurogamer.net/hellraiser-revival-release-date",
    article_url: "https://www.eurogamer.net/hellraiser-revival-release-date",
    source_type: "rss",
    timestamp: "2026-06-16T12:00:00.000Z",
    created_at: "2026-06-16T12:00:00.000Z",
    scored_at: "2026-06-16 12:10:00",
    decision: "review",
    total: 74,
    decision_reason: "script_quality_score 0 below 7",
    inputs: JSON.stringify({ script_review_auto_block: "Hook starts with banned word: so" }),
    hard_stops: "[]",
    published_platform_post_count: 0,
    ...overrides,
  };
}

test("fresh review script repair selects current source-backed script-quality blockers", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row(),
    row({
      story_id: "rss_word_count",
      title: "Switch 2 Deal Needs A Better Short",
      decision_reason: "Actual spoken word count 149 outside 204-250",
      total: 71,
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), [
    "rss_hellraiser",
    "rss_word_count",
  ]);

  const plan = buildFreshReviewScriptRepairPlan({ rows: selected, now: NOW });
  assert.equal(plan.summary.selected_count, 2);
  assert.equal(plan.source_bound_rewrite_work_orders.length, 2);
  assert.equal(plan.source_bound_rewrite_work_orders[0].repair_lane, "source_bound_script_rewrite");
  assert.equal(plan.source_bound_rewrite_work_orders[0].db_mutation_required, false);
  assert.match(
    plan.source_bound_rewrite_work_orders[0].recommended_command,
    /^npm run ops:reprocess-script-failures -- --story-id rss_hellraiser --force-story --source-bound-only --dry-run --json$/,
  );
  assert.equal(
    commandSafety(plan.source_bound_rewrite_work_orders[0].recommended_command).safe,
    true,
  );
});

test("fresh review script repair excludes stale, non-script, published and reddit-only rows", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({ story_id: "fresh_good" }),
    row({
      story_id: "stale",
      timestamp: "2026-06-01T12:00:00.000Z",
      created_at: "2026-06-01T12:00:00.000Z",
    }),
    row({
      story_id: "strategy_review",
      decision_reason: "source confidence below auto threshold",
      inputs: JSON.stringify({ topicality_decision: "review" }),
    }),
    row({
      story_id: "published",
      youtube_post_id: "abc123",
      published_platform_post_count: 1,
    }),
    row({
      story_id: "reddit_only",
      source_type: "reddit",
      url: "https://www.reddit.com/r/gaming/comments/abc/example",
      article_url: "",
    }),
    row({
      story_id: "auto_story",
      decision: "auto",
      decision_reason: "",
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["fresh_good"]);
});
