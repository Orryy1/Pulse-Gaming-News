#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

const path = require("node:path");
const fs = require("fs-extra");
const {
  buildMultiVerticalCostProfitDashboard,
  writeMultiVerticalCostProfitDashboard,
} = require("../lib/multi-vertical-cost-profit-dashboard");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    renderJobsPath: path.join(ROOT, "output", "goal-contract", "render_cost_jobs.json"),
    affiliateAttributionPath: path.join(ROOT, "output", "goal16-landing-pages", "revenue_attribution_manifest.json"),
    sponsorReadinessPath: path.join(ROOT, "output", "goal-25", "goal25_readiness_report.json"),
    financeCryptoFirewallPath: path.join(ROOT, "output", "goal-18", "goal18_finance_crypto_firewall_report.json"),
    outDir: path.join(ROOT, "output", "multi-vertical-cost-profit"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--render-jobs") args.renderJobsPath = argv[++index] || args.renderJobsPath;
    else if (arg === "--affiliate-attribution") args.affiliateAttributionPath = argv[++index] || args.affiliateAttributionPath;
    else if (arg === "--sponsor-readiness") args.sponsorReadinessPath = argv[++index] || args.sponsorReadinessPath;
    else if (arg === "--finance-crypto-firewall") args.financeCryptoFirewallPath = argv[++index] || args.financeCryptoFirewallPath;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:multi-vertical-cost-profit -- [options]",
    "",
    "Options:",
    "  --render-jobs <path>                Render/job cost rows",
    "  --affiliate-attribution <path>      Affiliate/revenue attribution manifest",
    "  --sponsor-readiness <path>          Sponsor readiness report",
    "  --finance-crypto-firewall <path>    Finance/crypto firewall report",
    "  --out-dir <dir>                     Output directory",
    "  --generated-at <iso>                Fixed timestamp",
    "  --json                              Print report JSON",
    "",
    "LOCAL_PROOF only. This command does not publish, mutate DB rows, contact sponsors, change OAuth/tokens or make public revenue claims.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function rowsFromRenderInput(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.render_jobs)) return value.render_jobs;
  if (Array.isArray(value?.jobs)) return value.jobs;
  if (Array.isArray(value?.stories)) {
    return value.stories.map((story) => ({
      story_id: story.story_id || story.id,
      platform: story.platform || "unassigned",
      total_cost: story.total_cost || story.cost || 0,
      realized_revenue: story.realized_revenue || 0,
      views: story.views || 0,
    }));
  }
  return [];
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const renderInput = await readJsonIfPresent(path.resolve(args.renderJobsPath), []);
  const affiliateAttribution = await readJsonIfPresent(path.resolve(args.affiliateAttributionPath), {});
  const sponsorReadiness = await readJsonIfPresent(path.resolve(args.sponsorReadinessPath), {});
  const financeCryptoFirewallReport = await readJsonIfPresent(path.resolve(args.financeCryptoFirewallPath), {});
  const report = buildMultiVerticalCostProfitDashboard({
    renderJobs: rowsFromRenderInput(renderInput),
    affiliateAttribution,
    sponsorReadiness,
    financeCryptoFirewallReport,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeMultiVerticalCostProfitDashboard(report, { outputDir: path.resolve(args.outDir) });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    const markdown = await fs.readFile(written.reportMarkdown, "utf8");
    console.log(markdown.trimEnd());
  }
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[multi-vertical-cost-profit-dashboard] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
