#!/usr/bin/env node
/**
 * scripts/backfill-auto-lanes.js
 *
 * One-off backfill (2026-04-23). Applies the existing
 * `qualifiesForTrustedRumourAutoLane` AND the new (deployed in
 * commit 0a9b981) `qualifiesForTrustedPublisherAutoLane` to every
 * story currently sitting in the review queue.
 *
 * Rationale: runScoringPass in the normal code path only scores
 * UNSCORED stories. When we add a new auto-lane criterion, the
 * stories already sitting in review with a persisted score row
 * stay in review because nothing re-evaluates them. This script
 * closes that gap: it reads the existing score row, applies the
 * (now-deployed) lane logic, and promotes stories that qualify.
 *
 * Safety:
 *   - READ-ONLY by default. Pass `--apply` to actually write.
 *   - Applies the EXACT SAME lane logic the live publisher uses
 *     on every new story. Zero new rules.
 *   - Rumour lane is checked first (more specific), publisher
 *     lane second — matches decision-engine.js:147 ordering.
 *   - Updates: stories.approved=1, stories.auto_approved=1,
 *     and stashes an audit note in the story's `_extra` JSON
 *     blob (key: `backfill_auto_lane`) so we can tell which
 *     approvals came from this script vs the live decision
 *     engine.
 *
 * Usage (prod):
 *   railway ssh -- 'cd /app && node scripts/backfill-auto-lanes.js'           # dry run
 *   railway ssh -- 'cd /app && node scripts/backfill-auto-lanes.js --apply'   # actually write
 */

"use strict";

const path = require("node:path");
const Database = require("better-sqlite3");
const {
  qualifiesForTrustedPublisherAutoLane,
  qualifiesForTrustedRumourAutoLane,
} = require("../lib/scoring");

const DRY_RUN = !process.argv.includes("--apply");
const DB_PATH =
  process.env.SQLITE_DB_PATH ||
  path.resolve(__dirname, "..", "data", "pulse.db");

console.log(`[backfill] ${DRY_RUN ? "DRY RUN" : "APPLY"} — db=${DB_PATH}`);

const db = new Database(DB_PATH);

const QUERY = `
  SELECT s.id, s.title, s.subreddit, s.source_type, s.flair,
         s.hook, s.body, s.full_script,
         sc.total, sc.decision,
         sc.source_confidence, sc.story_importance, sc.freshness,
         sc.search_demand, sc.visual_viability, sc.originality,
         sc.duplicate_safety, sc.advertiser_safety,
         sc.roundup_suitability, sc.hook_bonus, sc.diversity_bonus,
         sc.repetition_penalty, sc.hard_stops
  FROM stories s
  JOIN (
    SELECT story_id, MAX(scored_at) AS scored_at
    FROM story_scores
    GROUP BY story_id
  ) latest ON latest.story_id = s.id
  JOIN story_scores sc ON sc.story_id = s.id AND sc.scored_at = latest.scored_at
  WHERE sc.decision = 'review' AND (s.approved = 0 OR s.approved IS NULL)
  ORDER BY sc.total DESC
`;

const rows = db.prepare(QUERY).all();
console.log(`[backfill] ${rows.length} review-tier stories to evaluate`);

const promoted = [];
const skipped = [];

for (const row of rows) {
  const story = {
    id: row.id,
    title: row.title,
    subreddit: row.subreddit,
    source_type: row.source_type,
    flair: row.flair,
    hook: row.hook || "",
    body: row.body || "",
    full_script: row.full_script || "",
  };
  const score = {
    total: row.total,
    decision: row.decision,
    hard_stops: (() => {
      try {
        return JSON.parse(row.hard_stops || "[]");
      } catch {
        return [];
      }
    })(),
    breakdown: {
      source_confidence: row.source_confidence,
      story_importance: row.story_importance,
      freshness: row.freshness,
      search_demand: row.search_demand,
      visual_viability: row.visual_viability,
      originality: row.originality,
      duplicate_safety: row.duplicate_safety,
      advertiser_safety: row.advertiser_safety,
      roundup_suitability: row.roundup_suitability,
    },
  };

  // Same order as decision-engine.js: rumour first (more specific).
  let laneCheck = qualifiesForTrustedRumourAutoLane(story, score);
  let laneName = "trusted_rumour";
  if (!laneCheck.qualifies) {
    laneCheck = qualifiesForTrustedPublisherAutoLane(story, score);
    laneName = "trusted_publisher";
  }

  if (!laneCheck.qualifies) {
    skipped.push({ id: row.id, total: row.total });
    continue;
  }

  promoted.push({
    id: row.id,
    title: (row.title || "").slice(0, 70),
    total: row.total,
    lane: laneName,
    reason: laneCheck.reason,
  });
}

console.log("");
console.log(`=== Promotions (${promoted.length}) ===`);
for (const p of promoted) {
  console.log(
    `  ${p.lane.padEnd(18)} (${p.total})  ${p.id.padEnd(20)}  ${p.title}`,
  );
  console.log(`    reason: ${p.reason}`);
}
console.log("");
console.log(`Skipped ${skipped.length} (didn't qualify for either lane)`);

if (DRY_RUN) {
  console.log("");
  console.log("DRY RUN — no changes written. Re-run with --apply to persist.");
  db.close();
  process.exit(0);
}

// Apply. Use a transaction so we don't end up with half-promoted state
// if anything below throws.
console.log("");
console.log("Writing promotions...");

const applyOne = db.transaction((p) => {
  // Read existing _extra so we merge rather than clobber.
  const existing = db
    .prepare("SELECT _extra FROM stories WHERE id = ?")
    .get(p.id);
  let extra = {};
  if (existing && existing._extra) {
    try {
      extra = JSON.parse(existing._extra);
    } catch {
      extra = {};
    }
  }
  extra.backfill_auto_lane = {
    lane: p.lane,
    reason: p.reason,
    promoted_at: new Date().toISOString(),
    script_version: "backfill-2026-04-23",
  };

  db.prepare(
    `UPDATE stories
     SET approved = 1,
         auto_approved = 1,
         _extra = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(JSON.stringify(extra), p.id);
});

let applied = 0;
for (const p of promoted) {
  try {
    applyOne(p);
    applied++;
  } catch (err) {
    console.error(`  FAIL ${p.id}: ${err.message}`);
  }
}
console.log(`Applied ${applied} of ${promoted.length} promotions.`);

db.close();
