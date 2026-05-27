#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const {
  applyBridgeCandidatePromotionPlan,
  buildBridgeCandidatePromotionPlan,
} = require("../lib/bridge-candidate-promotion");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "goal-contract");
const DEFAULT_BRIDGE_CANDIDATES = path.join(DEFAULT_OUT, "scheduler_bridge_candidates.json");
const DEFAULT_CANDIDATE_REPORT = path.join(ROOT, "test", "output", "next_publish_candidates.json");

function parseArgs(argv = process.argv) {
  const args = {
    json: false,
    help: false,
    apply: false,
    operatorConfirmed: false,
    storyId: "",
    limit: Infinity,
    bridgeCandidatesPath: DEFAULT_BRIDGE_CANDIDATES,
    candidateReportPath: DEFAULT_CANDIDATE_REPORT,
    outputDir: DEFAULT_OUT,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || "";
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--bridge-candidates" || arg === "--bridge") args.bridgeCandidatesPath = argv[++i] || "";
    else if (arg.startsWith("--bridge-candidates=")) args.bridgeCandidatesPath = arg.slice("--bridge-candidates=".length);
    else if (arg.startsWith("--bridge=")) args.bridgeCandidatesPath = arg.slice("--bridge=".length);
    else if (arg === "--candidate-report" || arg === "--preflight-report") args.candidateReportPath = argv[++i] || "";
    else if (arg.startsWith("--candidate-report=")) args.candidateReportPath = arg.slice("--candidate-report=".length);
    else if (arg.startsWith("--preflight-report=")) args.candidateReportPath = arg.slice("--preflight-report=".length);
    else if (arg === "--output-dir") args.outputDir = argv[++i] || DEFAULT_OUT;
    else if (arg.startsWith("--output-dir=")) args.outputDir = arg.slice("--output-dir=".length);
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/bridge-candidate-promotion.js --candidate-report PATH --bridge-candidates PATH [--apply --operator-confirmed] [--json]\n" +
      "Promotes only clean bridge candidates through a backed-up DB upsert path. It never posts or changes OAuth state.\n",
  );
}

async function readJsonFile(filePath, fallback) {
  if (!filePath) return fallback;
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

function formatBridgeCandidatePromotionMarkdown(plan = {}) {
  const lines = [];
  const summary = plan.summary || {};
  lines.push("# Bridge Candidate Promotion");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at || "unknown"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- DB mutation only with --apply --operator-confirmed");
  lines.push("- backup before upsert");
  lines.push("- no publishing");
  lines.push("- no OAuth or token changes");
  lines.push("- no safety gates weakened");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- status: ${plan.status || "unknown"}`);
  lines.push(`- bridge candidates seen: ${Number(summary.bridge_candidates_seen || 0)}`);
  lines.push(`- eligible for controlled promotion: ${Number(summary.eligible_count || 0)}`);
  lines.push(`- blocked or warning-held: ${Number(summary.blocked_count || 0)}`);
  if (Number(summary.applied_count || 0) > 0) {
    lines.push(`- applied: ${Number(summary.applied_count || 0)}`);
  }
  lines.push("");
  lines.push("## Eligible");
  const eligible = Array.isArray(plan.eligible_promotions) ? plan.eligible_promotions : [];
  if (!eligible.length) lines.push("- none");
  for (const item of eligible) {
    lines.push(`- ${item.story_id}: ${item.title}`);
    lines.push(`  preflight: ${item.evidence?.preflight_status || "unknown"}`);
    lines.push(`  render: ${item.evidence?.exported_path || "missing"}`);
    lines.push(`  rights records: ${Number(item.evidence?.rights_ledger_records || 0)}`);
  }
  lines.push("");
  lines.push("## Blocked");
  const blocked = Array.isArray(plan.blocked_candidates) ? plan.blocked_candidates : [];
  if (!blocked.length) lines.push("- none");
  for (const item of blocked.slice(0, 20)) {
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
  const [bridgeCandidates, candidateReport, liveStories] = await Promise.all([
    readJsonFile(args.bridgeCandidatesPath, []),
    readJsonFile(args.candidateReportPath, {}),
    deps.liveStories ? Promise.resolve(deps.liveStories) : db.getStories(),
  ]);

  const plan = buildBridgeCandidatePromotionPlan({
    bridgeCandidates,
    candidateReport,
    liveStories,
    storyId: args.storyId,
    limit: args.limit,
  });

  if (args.apply) {
    plan.apply_result = await applyBridgeCandidatePromotionPlan(plan, {
      db,
      operatorConfirmed: args.operatorConfirmed,
    });
    plan.summary.applied_count = plan.apply_result.applied_count;
  }

  const markdown = formatBridgeCandidatePromotionMarkdown(plan);
  const outputDir = path.resolve(args.outputDir);
  await fs.ensureDir(outputDir);
  const jsonPath = path.join(outputDir, "bridge_candidate_promotion_plan.json");
  const mdPath = path.join(outputDir, "bridge_candidate_promotion_plan.md");
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");

  if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else process.stdout.write(markdown);
  process.stderr.write(`[bridge-candidate-promotion] json=${path.relative(ROOT, jsonPath)}\n`);
  process.stderr.write(`[bridge-candidate-promotion] md=${path.relative(ROOT, mdPath)}\n`);
  return { exitCode: 0, plan, jsonPath, mdPath };
}

if (require.main === module) {
  runCli().catch((err) => {
    process.stderr.write(`[bridge-candidate-promotion] ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BRIDGE_CANDIDATES,
  DEFAULT_CANDIDATE_REPORT,
  formatBridgeCandidatePromotionMarkdown,
  parseArgs,
  runCli,
};
