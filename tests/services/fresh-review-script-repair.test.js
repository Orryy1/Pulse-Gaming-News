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
    story_id: "rss_gears",
    title: "Gears of War E-Day PC Specs Revealed",
    url: "https://www.pcgamer.com/games/action/gears-of-war-e-day-pc-specs",
    article_url: "https://www.pcgamer.com/games/action/gears-of-war-e-day-pc-specs",
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
    "rss_gears",
    "rss_word_count",
  ]);

  const plan = buildFreshReviewScriptRepairPlan({ rows: selected, now: NOW });
  assert.equal(plan.summary.selected_count, 2);
  assert.equal(plan.source_bound_rewrite_work_orders.length, 2);
  assert.equal(plan.source_bound_rewrite_work_orders[0].repair_lane, "source_bound_script_rewrite");
  assert.equal(plan.source_bound_rewrite_work_orders[0].db_mutation_required, false);
  assert.match(
    plan.source_bound_rewrite_work_orders[0].recommended_command,
    /^npm run ops:reprocess-script-failures -- --story-id rss_gears --force-story --source-bound-only --dry-run --json$/,
  );
  assert.equal(
    commandSafety(plan.source_bound_rewrite_work_orders[0].recommended_command).safe,
    true,
  );
});

test("fresh review script repair excludes off-topic entertainment feed noise", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({ story_id: "fresh_gaming" }),
    row({
      story_id: "movie_noise",
      title: "Jim Carrey Returning For Grinch Sequel 25 Years After The Original",
      url: "https://kotaku.com/jim-carrey-returning-for-grinch-sequel-25-years-after-the-original-2000708170",
      article_url: "https://kotaku.com/jim-carrey-returning-for-grinch-sequel-25-years-after-the-original-2000708170",
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["fresh_gaming"]);
});

test("fresh review script repair excludes commerce deals roundups from editorial refill", () => {
  const selected = selectFreshReviewScriptRepairRows([
    row({ story_id: "fresh_good" }),
    row({
      story_id: "deals_roundup",
      title: "The Best Deals Today: AirPods Pro 3, Tears of the Kingdom Switch 2 Edition, Nioh 3, and More",
      url: "https://www.ign.com/articles/best-deals-for-june-21-2026",
      article_url: "https://www.ign.com/articles/best-deals-for-june-21-2026",
    }),
  ], { now: NOW, limit: 10 });

  assert.deepEqual(selected.map((item) => item.story_id), ["fresh_good"]);
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

test("fresh review script repair turns transcript backlog into safe rewrite work orders", () => {
  const plan = buildFreshReviewScriptRepairPlan({
    rows: [],
    now: NOW,
    candidateReport: {
      candidates: [
        {
          id: "fresh_gears_eday_pc_specs_20260616",
          title: "Gears Of War E-Day PC Specs Are A Storage Warning",
          status: "publish_ready",
          score: 92,
          source_manifest: {
            primary_source: {
              name: "PC Gamer",
              url: "https://www.pcgamer.com/gears-e-day-pc-specs",
              published_at: "2026-06-16T09:00:00.000Z",
            },
          },
        },
      ],
    },
    transcriptAudienceReport: {
      generated_at: NOW,
      summary: { total: 1, pass: 0, rewrite_required: 1 },
      stories: [
        {
          story_id: "fresh_gears_eday_pc_specs_20260616",
          title: "Gears Of War E-Day PC Specs Are A Storage Warning",
          verdict: "rewrite_required",
          blockers: ["mass_audience:abstract_payoff", "mass_audience:unclear_referents"],
          viral_score: 55,
        },
      ],
    },
  });

  assert.equal(plan.summary.selected_count, 1);
  assert.equal(plan.summary.transcript_backlog_selected_count, 1);
  assert.equal(plan.source_bound_rewrite_work_orders[0].blocker_type, "transcript_audience_rewrite_required");
  assert.equal(plan.source_bound_rewrite_work_orders[0].repair_lane, "source_bound_script_rewrite");
  assert.match(
    plan.source_bound_rewrite_work_orders[0].recommended_command,
    /^npm run ops:reprocess-script-failures -- --story-id fresh_gears_eday_pc_specs_20260616 --force-story --source-bound-only --dry-run --json$/,
  );
  assert.equal(
    commandSafety(plan.source_bound_rewrite_work_orders[0].recommended_command).safe,
    true,
  );
});
