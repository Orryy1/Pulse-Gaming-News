"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFreshReviewLocalPromotionIntake,
  storyDraftFromReprocessedRow,
} = require("../../lib/fresh-review-local-promotion-intake");
const { parseArgs } = require("../../tools/fresh-review-local-promotion-intake");
const packageJson = require("../../package.json");

function sourceBackedReviewRow(overrides = {}) {
  return {
    id: "rss_black_ops_ports",
    story_id: "rss_black_ops_ports",
    title: "Call of Duty: Black Ops 1 and 2 Listings Have Fans Fearing Pricey PlayStation Ports",
    description:
      "IGN reports Call of Duty: Black Ops 1 and 2 store listings appeared for PlayStation, raising pricing questions for classic ports.",
    article_url:
      "https://www.ign.com/articles/call-of-duty-black-ops-1-and-2-listings-have-fans-fearing-pricey-playstation-ports",
    source_type: "rss",
    source_name: "IGN",
    source_published_at: "2026-06-21T22:00:00.000Z",
    created_at: "2026-06-21T22:05:00.000Z",
    scored_at: "2026-06-21T22:10:00.000Z",
    decision: "review",
    total: 76,
    decision_reason: "script_quality_score 0 below 7 total=76",
    inputs: "{}",
    hard_stops: "[]",
    ...overrides,
  };
}

test("fresh review local promotion intake converts a repaired row into source-backed draft copy", () => {
  const draft = storyDraftFromReprocessedRow({
    id: "rss_black_ops_ports",
    title: "Black Ops Classics Have A Price Trust Problem",
    suggested_title: "Black Ops Classics Have A Price Trust Problem",
    source_name: "IGN",
    article_url:
      "https://www.ign.com/articles/call-of-duty-black-ops-1-and-2-listings-have-fans-fearing-pricey-playstation-ports",
    source_type: "rss",
    source_published_at: "2026-06-21T22:00:00.000Z",
    full_script:
      "Black Ops just gave PlayStation players a nostalgia test with a price tag. IGN reports new listings for Black Ops 1 and 2 have fans watching for classic ports. Follow Pulse Gaming so you never miss a beat.",
    script_generation_status: "script_ready",
  });

  assert.equal(draft.id, "rss_black_ops_ports");
  assert.equal(draft.primary_source.name, "IGN");
  assert.equal(draft.primary_source.type, "rss");
  assert.match(draft.full_script, /Black Ops/);
  assert.match(draft.hook, /^Black Ops just gave/);
  assert.equal(draft.local_promotion_intake_only, true);
  assert.equal(draft.pinned_comment, "Source: IGN.");
});

test("fresh review local promotion intake builds local promotion stories without DB or publish side effects", async () => {
  const row = sourceBackedReviewRow();
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [row],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_black_ops_ports" }],
    },
    now: new Date("2026-06-21T23:00:00.000Z"),
  });

  assert.equal(report.mode, "FRESH_REVIEW_LOCAL_PROMOTION_INTAKE");
  assert.equal(report.summary.rows_seen, 1);
  assert.equal(report.summary.repair_plan_selected_count, 1);
  assert.equal(report.summary.local_promotion_story_count, 1);
  assert.equal(report.summary.production_db_mutation_required, false);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);
  assert.equal(report.fresh_source_intake_stories[0].id, "rss_black_ops_ports");
  assert.equal(report.fresh_source_intake_stories[0].primary_source.name, "IGN");
  assert.match(report.fresh_source_intake_stories[0].selected_title, /Black Ops/i);
  assert.match(report.fresh_source_intake_stories[0].full_script, /price test|PlayStation listings|nostalgia/i);
  assert.doesNotMatch(report.fresh_source_intake_stories[0].full_script, /one concrete player question/i);
  assert.equal(report.repair_results[0].output_story_ready, true);
});

test("fresh review local promotion intake rejects generic source-bound scaffolds", async () => {
  const report = await buildFreshReviewLocalPromotionIntake({
    rows: [
      sourceBackedReviewRow({
        story_id: "rss_generic",
        id: "rss_generic",
        title: "Unknown Game Has A Small Update",
        description: "",
        article_url: "https://www.ign.com/articles/unknown-game-small-update",
      }),
    ],
    plan: {
      summary: { selected_count: 1 },
      source_bound_rewrite_work_orders: [{ story_id: "rss_generic" }],
    },
    now: new Date("2026-06-21T23:00:00.000Z"),
  });

  assert.equal(report.summary.local_promotion_story_count, 0);
  assert.equal(report.repair_results[0].output_story_ready, false);
  assert.ok(report.repair_results[0].quality_failures.includes("local_intake:generic_player_question_script"));
});

test("fresh review local promotion intake CLI is registered", () => {
  assert.equal(
    packageJson.scripts["ops:fresh-review-local-promotion-intake"],
    "node tools/fresh-review-local-promotion-intake.js",
  );
  const args = parseArgs(["--json", "--limit", "8", "--out-dir", "output/example"]);
  assert.equal(args.json, true);
  assert.equal(args.limit, 8);
  assert.match(args.outDir, /output[\\/]example$/);
});
