#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true, quiet: true });
}

const {
  buildGoalHumanReviewQueue,
  renderGoalHumanReviewQueueMarkdown,
  writeGoalHumanReviewQueue,
} = require("../lib/goal-human-review-queue");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    dryRunPlanPath: null,
    tiktokCreatorRewardsWorkOrderPath: null,
    tiktokCreatorRewardsRepairReportPath: null,
    renderInputWorkOrderPath: null,
    operatorSourceQueuePath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    maxItems: 30,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--dry-run-plan") args.dryRunPlanPath = argv[++i] || "";
    else if (arg === "--tiktok-creator-rewards-work-order") {
      args.tiktokCreatorRewardsWorkOrderPath = argv[++i] || "";
    }
    else if (arg === "--tiktok-creator-rewards-repair-report") {
      args.tiktokCreatorRewardsRepairReportPath = argv[++i] || "";
    }
    else if (arg === "--render-input-work-order") args.renderInputWorkOrderPath = argv[++i] || "";
    else if (arg === "--operator-source-queue") args.operatorSourceQueuePath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--max-items") args.maxItems = Number(argv[++i] || args.maxItems);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-human-review -- [options]",
    "",
    "Options:",
    "  --root <dir>             Workspace root",
    "  --dry-run-plan <path>    Strict dry-run publish plan",
    "  --tiktok-creator-rewards-work-order <path>  TikTok 61s+ variant repair work order",
    "  --tiktok-creator-rewards-repair-report <path>  TikTok variant repair execution report",
    "  --render-input-work-order <path>  Render-input repair work order for blocked-story detail",
    "  --operator-source-queue <path>  Operator source-intake queue for blocked-story detail",
    "  --out-dir <dir>          Output directory",
    "  --generated-at <iso>     Fixed timestamp",
    "  --max-items <n>          Maximum review packets",
    "  --json                   Print JSON",
    "",
    "Human-review queue only. Does not publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const dryRunPlanPath = args.dryRunPlanPath
    ? path.resolve(root, args.dryRunPlanPath)
    : path.join(root, "output", "goal-contract", "dry_run_publish_plan.json");
  const dryRunPlan = await fs.readJson(dryRunPlanPath);
  const tiktokCreatorRewardsWorkOrderPath = args.tiktokCreatorRewardsWorkOrderPath
    ? path.resolve(root, args.tiktokCreatorRewardsWorkOrderPath)
    : path.join(root, "output", "goal-contract", "tiktok_creator_rewards_variant_work_order.json");
  const tiktokCreatorRewardsVariantWorkOrder = await fs.pathExists(tiktokCreatorRewardsWorkOrderPath)
    ? await fs.readJson(tiktokCreatorRewardsWorkOrderPath)
    : {};
  const tiktokCreatorRewardsRepairReportPath = args.tiktokCreatorRewardsRepairReportPath
    ? path.resolve(root, args.tiktokCreatorRewardsRepairReportPath)
    : path.join(root, "output", "goal-contract", "duration_variant_repair_report.json");
  const tiktokCreatorRewardsRepairReport = await fs.pathExists(tiktokCreatorRewardsRepairReportPath)
    ? await fs.readJson(tiktokCreatorRewardsRepairReportPath)
    : {};
  const renderInputWorkOrderPath = args.renderInputWorkOrderPath
    ? path.resolve(root, args.renderInputWorkOrderPath)
    : path.join(root, "output", "goal-contract", "render_input_work_order.json");
  const renderInputWorkOrder = await fs.pathExists(renderInputWorkOrderPath)
    ? await fs.readJson(renderInputWorkOrderPath)
    : {};
  const operatorSourceQueuePath = args.operatorSourceQueuePath
    ? path.resolve(root, args.operatorSourceQueuePath)
    : path.join(root, "output", "goal-contract", "operator_source_intake_queue.json");
  const operatorSourceQueue = await fs.pathExists(operatorSourceQueuePath)
    ? await fs.readJson(operatorSourceQueuePath)
    : {};
  const queue = await buildGoalHumanReviewQueue({
    dryRunPlan,
    generatedAt: args.generatedAt || new Date().toISOString(),
    maxItems: args.maxItems,
    tiktokCreatorRewardsVariantWorkOrder,
    tiktokCreatorRewardsRepairReport,
    renderInputWorkOrder,
    operatorSourceQueue,
    visualReviewEvidenceDir: path.resolve(root, args.outDir),
  });
  const artefacts = await writeGoalHumanReviewQueue(queue, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(queue, null, 2));
  else console.log(renderGoalHumanReviewQueueMarkdown(queue).trimEnd());
  return { queue, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-human-review-queue] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
