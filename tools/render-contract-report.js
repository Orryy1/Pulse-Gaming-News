#!/usr/bin/env node
"use strict";

/**
 * tools/render-contract-report.js — operator audit of the render
 * contract verdicts across all stories in the canonical store.
 *
 * Read-only. Surfaces:
 *   - per-story class (premium/standard/fallback/reject)
 *   - blocked count + reasons
 *   - top-10 reject candidates (if any)
 *
 * Usage:
 *   node tools/render-contract-report.js              # markdown
 *   node tools/render-contract-report.js --json
 *   node tools/render-contract-report.js --discord
 */

const fs = require("fs-extra");
const path = require("node:path");
const {
  decideForStories,
  summariseDecisions,
} = require("../lib/render-decision");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = { json: false, discord: false, help: false };
  for (const a of argv.slice(2)) {
    if (a === "--json") args.json = true;
    else if (a === "--discord") args.discord = true;
    else if (a === "--help" || a === "-?") args.help = true;
  }
  return args;
}

function formatMarkdown(decisions, summary) {
  const glyph = {
    premium: "💎",
    standard: "✅",
    fallback: "⚠️",
    reject: "🚫",
  };
  const lines = [];
  lines.push("**Pulse Gaming — Render Contract Verdicts**");
  lines.push(
    `Total: ${summary.total} | Allowed: ${summary.allowed} | Blocked: ${summary.blocked}`,
  );
  lines.push("");
  lines.push("**By contract class**");
  for (const cls of ["premium", "standard", "fallback", "reject"]) {
    const n = summary.by_class[cls] || 0;
    if (n === 0) continue;
    lines.push(`  ${glyph[cls]} ${cls}: ${n}`);
  }

  if (summary.blocked > 0) {
    lines.push("");
    lines.push("**Blocked reasons**");
    const sortedReasons = Object.entries(summary.blocked_reasons).sort(
      (a, b) => b[1] - a[1],
    );
    for (const [reason, n] of sortedReasons.slice(0, 8)) {
      lines.push(`  • ${reason}: ${n}`);
    }
  }

  // Top reject candidates (most-recent first)
  const rejects = decisions.filter((d) => d.verdict.class === "reject");
  if (rejects.length > 0) {
    lines.push("");
    lines.push(`**Reject candidates** (top 10 of ${rejects.length})`);
    for (const r of rejects.slice(0, 10)) {
      lines.push(
        `  🚫 ${r.story_id} — ${r.title}\n      reasons: ${(r.verdict.reasons || []).join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      "Usage: node tools/render-contract-report.js [--json] [--discord]\n",
    );
    return;
  }

  const db = require("../lib/db");
  let stories = [];
  try {
    stories = (await db.getStories()) || [];
  } catch (err) {
    process.stderr.write(`[contract] getStories failed: ${err.message}\n`);
  }

  const decisions = await decideForStories(stories);
  const summary = summariseDecisions(decisions);
  const markdown = formatMarkdown(decisions, summary);

  try {
    await fs.ensureDir(OUT);
    await fs.writeJson(
      path.join(OUT, "render_contract.json"),
      { decisions, summary, generated_at: new Date().toISOString() },
      { spaces: 2 },
    );
    await fs.writeFile(path.join(OUT, "render_contract.md"), markdown, "utf-8");
  } catch (err) {
    process.stderr.write(`[contract] persist failed: ${err.message}\n`);
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify({ decisions, summary }, null, 2) + "\n",
    );
  } else {
    process.stdout.write(markdown + "\n");
  }

  if (args.discord) {
    try {
      const sendDiscord = require("../notify");
      await sendDiscord(markdown);
    } catch (err) {
      process.stderr.write(`[contract] discord post failed: ${err.message}\n`);
    }
  }

  // Non-zero exit if there are any rejects so this can be wired into
  // a pre-deploy preflight chain.
  if ((summary.by_class.reject || 0) > 0) process.exit(2);
}

main().catch((err) => {
  process.stderr.write(`[contract] ${err.stack || err.message}\n`);
  process.exit(1);
});
