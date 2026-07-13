"use strict";

const path = require("node:path");

const {
  writeTikTokManualHandoff,
} = require("../lib/platforms/tiktok-manual-handoff");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    planPath: path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json"),
    outDir: path.join(ROOT, "output", "tiktok-manual-handoff"),
    storyId: null,
    contentPostingApiStatus: "permission_unavailable",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    const next = () => String(argv[++index] || "").trim();
    if (arg === "--plan") options.planPath = next();
    else if (arg === "--out-dir") options.outDir = next();
    else if (arg === "--story" || arg === "--story-id") options.storyId = next() || null;
    else if (arg === "--api-status") options.contentPostingApiStatus = next() || "unknown";
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: npm run tiktok:manual-handoff -- [options]",
    "",
    "Options:",
    "  --plan <path>        Strict dry-run publish plan",
    "  --out-dir <path>     Handoff output directory",
    "  --story <id>         Limit to one story",
    "  --api-status <state> Content Posting API state",
    "  --json               Print machine-readable summary",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const result = await writeTikTokManualHandoff(options);
  const summary = {
    status: result.report.summary.blocked === 0 ? "pass" : "partial",
    route: result.report.route,
    platform_state: result.report.platform_state,
    content_posting_api_status: result.report.content_posting_api_status,
    summary: result.report.summary,
    paths: result.paths,
    safety: result.report.safety,
  };
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(
      `[tiktok-manual-handoff] ready=${summary.summary.ready} blocked=${summary.summary.blocked} rewards=${summary.summary.creator_rewards_eligible}`,
    );
    console.log(`[tiktok-manual-handoff] json=${result.paths.json}`);
    console.log(`[tiktok-manual-handoff] markdown=${result.paths.markdown}`);
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[tiktok-manual-handoff] FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
