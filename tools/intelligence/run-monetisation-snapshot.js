#!/usr/bin/env node
"use strict";

/**
 * tools/intelligence/run-monetisation-snapshot.js — Session 3 prototype.
 *
 * Build a monetisation milestone snapshot from a fixture state. No
 * assumptions about YPP/Creator-Rewards eligibility — every
 * milestone is reported with its current value, threshold and
 * progress ratio.
 *
 * Read-only. No production data is read or written. The output
 * lives under test/output/monetisation/ and is for operator review.
 */

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "test", "output", "monetisation");

const { buildMonetisationSnapshot } = require(
  path.join(ROOT, "lib", "intelligence", "monetisation-tracker"),
);
const { recommend: recommendTikTokRoute, rankRoutesForBreakingNews } = require(
  path.join(ROOT, "lib", "intelligence", "tiktok-strategy"),
);

// Fixture: realistic-ish current state for a pre-monetisation gaming
// channel. All values are placeholders; an operator should overwrite
// these with real numbers from the dashboard before treating the
// output as actionable.
const FIXTURE_STATE = {
  subscribers: 320,
  shorts_views_90d: 28_000,
  longform_watch_hours_12m: 4,
  amazon_affiliate_tag: "pulsegaming-21",
  beehiiv_subscribers: 12,
  substack_subscribers: 0,
  indexed_pages: 5,
  blog_monthly_pageviews: 230,
  avd_seconds_shorts: 23,
  tiktok_followers: 0,
  tiktok_views_30d: 0,
};

function renderMonetisationMarkdown(snapshot, tiktok) {
  const lines = [];
  lines.push("# Pulse Gaming — Monetisation Snapshot (FIXTURE)");
  lines.push("");
  lines.push(`Generated: ${snapshot.generated_at}`);
  lines.push(
    `Cleared milestones: ${snapshot.summary.cleared} / ${snapshot.summary.total_milestones}`,
  );
  lines.push(`YPP eligible: ${snapshot.summary.ypp_eligible}`);
  if (snapshot.summary.ypp_blockers.length > 0) {
    lines.push(`YPP blockers: ${snapshot.summary.ypp_blockers.join("; ")}`);
  }
  lines.push("");
  for (const [section, body] of Object.entries(snapshot.sections)) {
    lines.push(`## ${section}`);
    lines.push("");
    for (const item of body.items) {
      lines.push(
        `- **${item.milestone_label}** — ${item.current_value} / ${item.threshold_value} ` +
          `(${item.progress_percent}%) · cleared=${item.cleared} · path=${item.unlock_path}`,
      );
      for (const n of item.notes || []) lines.push(`  - ${n}`);
    }
    lines.push("");
  }
  lines.push("## TikTok automation strategy");
  lines.push("");
  lines.push(
    `- primary recommendation: ${tiktok.primaryRecommendation?.label}`,
  );
  lines.push(`  rationale: ${tiktok.primaryRecommendation?.rationale}`);
  lines.push(`- fallback: ${tiktok.fallback?.label}`);
  lines.push(`  rationale: ${tiktok.fallback?.rationale}`);
  lines.push(`- rejected:`);
  for (const r of tiktok.rejected) lines.push(`  - ${r.id}: ${r.reason}`);
  lines.push("");
  lines.push(`Notes: ${tiktok.notes.join("; ")}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push(
    "- no monetisation eligibility is assumed beyond what's in the snapshot",
  );
  lines.push("- no auto-promotion of formats based on this report");
  lines.push("- no scoring weight changes triggered");
  return lines.join("\n") + "\n";
}

async function main() {
  await fs.ensureDir(OUT_DIR);
  const snapshot = buildMonetisationSnapshot(FIXTURE_STATE);
  const tiktok = recommendTikTokRoute({
    canMigrateToBusiness: false,
    hasOperatorOnPhone: true,
  });
  const date = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(OUT_DIR, `monetisation-${date}.json`);
  const tiktokJsonPath = path.join(OUT_DIR, `tiktok-${date}.json`);
  const tiktokRoutesPath = path.join(OUT_DIR, `tiktok-routes-${date}.json`);
  const mdPath = path.join(OUT_DIR, `monetisation-${date}.md`);

  await fs.writeFile(jsonPath, JSON.stringify(snapshot, null, 2));
  await fs.writeFile(tiktokJsonPath, JSON.stringify(tiktok, null, 2));
  await fs.writeFile(
    tiktokRoutesPath,
    JSON.stringify(rankRoutesForBreakingNews(), null, 2),
  );
  await fs.writeFile(mdPath, renderMonetisationMarkdown(snapshot, tiktok));

  return {
    cleared: snapshot.summary.cleared,
    total: snapshot.summary.total_milestones,
    ypp: snapshot.summary.ypp_eligible,
    artefacts: {
      monetisationJson: path.relative(ROOT, jsonPath),
      tiktokJson: path.relative(ROOT, tiktokJsonPath),
      tiktokRoutesJson: path.relative(ROOT, tiktokRoutesPath),
      md: path.relative(ROOT, mdPath),
    },
  };
}

if (require.main === module) {
  main()
    .then((r) => {
      console.log(
        `[monetisation] cleared=${r.cleared}/${r.total} ypp=${r.ypp}`,
      );
      for (const [k, v] of Object.entries(r.artefacts)) {
        console.log(`  ${k}: ${v}`);
      }
    })
    .catch((err) => {
      console.error(`[monetisation] FAILED: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { main, FIXTURE_STATE };
