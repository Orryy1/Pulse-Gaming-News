#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  buildBreakingNewsSloReport,
  renderBreakingNewsSloMarkdown,
  writeBreakingNewsSloReport,
} = require("../lib/breaking-news-slo");

function bool(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || ""));
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    outDir: path.join("output", "cadence-recovery", "breaking-news-slo"),
    storyId: "",
    announcementAt: "",
    nextFeedPollAt: "",
    detectedAt: "",
    editorialDecisionAt: "",
    schedulerCandidateAt: "",
    safeDispatchOpportunityAt: "",
    dispatchGatesPermit: false,
    generatedAt: null,
    rootCauses: {},
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index] || args.root;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--story-id") args.storyId = argv[++index] || "";
    else if (arg === "--announcement-at") args.announcementAt = argv[++index] || "";
    else if (arg === "--next-feed-poll-at") args.nextFeedPollAt = argv[++index] || "";
    else if (arg === "--detected-at") args.detectedAt = argv[++index] || "";
    else if (arg === "--editorial-decision-at") args.editorialDecisionAt = argv[++index] || "";
    else if (arg === "--scheduler-candidate-at") args.schedulerCandidateAt = argv[++index] || "";
    else if (arg === "--dispatch-opportunity-at") args.safeDispatchOpportunityAt = argv[++index] || "";
    else if (arg === "--dispatch-gates-permit") args.dispatchGatesPermit = bool(argv[++index]);
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--root-cause") {
      const value = String(argv[++index] || "");
      const separator = value.indexOf("=");
      if (separator <= 0) throw new Error("--root-cause must be stage=cause");
      const stage = value.slice(0, separator).trim();
      const cause = value.slice(separator + 1).trim();
      if (!stage || !cause) throw new Error("--root-cause must be stage=cause");
      if (!args.rootCauses[stage]) args.rootCauses[stage] = [];
      args.rootCauses[stage].push(cause);
    } else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:breaking-news-slo -- [options]",
    "",
    "Required:",
    "  --story-id <id>",
    "  --announcement-at <iso>",
    "  --next-feed-poll-at <iso>",
    "",
    "Stage evidence:",
    "  --detected-at <iso>",
    "  --editorial-decision-at <iso>",
    "  --scheduler-candidate-at <iso>",
    "  --dispatch-opportunity-at <iso>",
    "  --dispatch-gates-permit <true|false>",
    "  --root-cause <stage=cause>  Repeatable",
    "",
    "Output:",
    "  --out-dir <dir>",
    "  --generated-at <iso>",
    "  --json",
    "",
    "Evidence only. This command does not publish, mutate the DB or alter tokens.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const report = buildBreakingNewsSloReport({
    storyId: args.storyId,
    announcementAt: args.announcementAt,
    nextFeedPollAt: args.nextFeedPollAt,
    detectedAt: args.detectedAt,
    editorialDecisionAt: args.editorialDecisionAt,
    schedulerCandidateAt: args.schedulerCandidateAt,
    safeDispatchOpportunityAt: args.safeDispatchOpportunityAt,
    dispatchGatesPermit: args.dispatchGatesPermit,
    generatedAt: args.generatedAt || new Date().toISOString(),
    rootCauses: args.rootCauses,
  });
  const artefacts = await writeBreakingNewsSloReport(report, {
    outputDir: path.resolve(args.root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderBreakingNewsSloMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[breaking-news-slo] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, usage };
