#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const {
  applyBridgePreflightStampRepairPlan,
  buildBridgePreflightStampRepairPlan,
} = require("../lib/bridge-preflight-stamp-repair");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "goal-contract");

function parseArgs(argv = process.argv) {
  const args = {
    apply: false,
    operatorConfirmed: false,
    json: false,
    help: false,
    storyId: "",
    limit: Infinity,
    outputDir: DEFAULT_OUT,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || "";
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg.startsWith("--story=")) args.storyId = arg.slice("--story=".length);
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--output-dir") args.outputDir = argv[++i] || DEFAULT_OUT;
    else if (arg.startsWith("--output-dir=")) args.outputDir = arg.slice("--output-dir=".length);
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/bridge-preflight-stamp-repair.js [--apply --operator-confirmed] [--story-id ID] [--json]\n" +
      "Clears only known stale QA stamps on bridge-promoted Visual V4 retention-short rows after current QA gates pass.\n",
  );
}

function formatBridgePreflightStampRepairMarkdown(plan = {}) {
  const summary = plan.summary || {};
  const lines = [];
  lines.push("# Bridge Preflight Stamp Repair");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at || "unknown"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- dry-run by default");
  lines.push("- DB mutation only with --apply --operator-confirmed");
  lines.push("- backup before upsert");
  lines.push("- no publishing");
  lines.push("- no OAuth or token changes");
  lines.push("- no safety gates weakened");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- status: ${plan.status || "unknown"}`);
  lines.push(`- QA-failed rows seen: ${Number(summary.qa_failed_rows_seen || 0)}`);
  lines.push(`- eligible stale stamps: ${Number(summary.eligible_count || 0)}`);
  lines.push(`- blocked: ${Number(summary.blocked_count || 0)}`);
  if (Number(summary.applied_count || 0) > 0) lines.push(`- applied: ${Number(summary.applied_count || 0)}`);
  lines.push("");
  lines.push("## Eligible");
  const eligible = Array.isArray(plan.eligible_repairs) ? plan.eligible_repairs : [];
  if (!eligible.length) lines.push("- none");
  for (const item of eligible) {
    lines.push(`- ${item.story_id}: ${item.title}`);
    lines.push(`  original failures: ${(item.evidence?.original_failures || []).join("; ")}`);
    lines.push(`  render: ${item.evidence?.render_lane || "unknown"} / ${item.evidence?.render_quality_class || "unknown"}`);
  }
  lines.push("");
  lines.push("## Blocked");
  const blocked = Array.isArray(plan.blocked_repairs) ? plan.blocked_repairs : [];
  if (!blocked.length) lines.push("- none");
  for (const item of blocked.slice(0, 30)) {
    lines.push(`- ${item.story_id || "unknown"}: ${(item.reasons || []).join(", ")}`);
  }
  if (plan.apply_result) {
    lines.push("");
    lines.push("## Apply Result");
    lines.push(`- status: ${plan.apply_result.status || "unknown"}`);
    lines.push(`- applied count: ${Number(plan.apply_result.applied_count || 0)}`);
    lines.push(`- backup: ${plan.apply_result.backup_path || "unknown"}`);
  }
  return `${lines.join("\n")}\n`;
}

async function runCli(argv = process.argv, deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { exitCode: 0 };
  }

  const db = deps.db || require("../lib/db");
  const stories = deps.stories ? await Promise.resolve(deps.stories) : await db.getStories();
  const plan = await buildBridgePreflightStampRepairPlan({
    stories,
    storyId: args.storyId,
    limit: args.limit,
    deps,
  });

  if (args.apply) {
    plan.apply_result = await applyBridgePreflightStampRepairPlan(plan, {
      db,
      operatorConfirmed: args.operatorConfirmed,
    });
    plan.summary.applied_count = plan.apply_result.applied_count;
  }

  const outputDir = path.resolve(args.outputDir);
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "bridge_preflight_stamp_repair_plan.json");
  const mdPath = path.join(outputDir, "bridge_preflight_stamp_repair_plan.md");
  const markdown = formatBridgePreflightStampRepairMarkdown(plan);
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");

  if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else process.stdout.write(markdown);
  process.stderr.write(`[bridge-preflight-stamp-repair] json=${path.relative(ROOT, jsonPath)}\n`);
  process.stderr.write(`[bridge-preflight-stamp-repair] md=${path.relative(ROOT, mdPath)}\n`);
  return { exitCode: 0, plan, jsonPath, mdPath };
}

if (require.main === module) {
  runCli().catch((err) => {
    process.stderr.write(`[bridge-preflight-stamp-repair] ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_OUT,
  formatBridgePreflightStampRepairMarkdown,
  parseArgs,
  runCli,
};
