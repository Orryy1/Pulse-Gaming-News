#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoal04OperatorSourceSubmissionPreflight,
  renderGoal04OperatorSourceSubmissionPreflightMarkdown,
} = require("../lib/goal04-operator-source-submission-preflight");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    operatorQueue: path.join(
      process.cwd(),
      "output",
      "goal-04",
      "operator-source-intake-queue-1050",
      "operator_source_intake_queue.json",
    ),
    officialSourceSubmissions: [],
    licensedMediaSubmissions: [],
    operatorPlanSubmissions: [],
    outputJson: path.join(
      process.cwd(),
      "output",
      "goal-04",
      "operator-source-submission-preflight.json",
    ),
    outputMd: path.join(
      process.cwd(),
      "output",
      "goal-04",
      "operator-source-submission-preflight.md",
    ),
    generatedAt: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--operator-queue") args.operatorQueue = argv[++i] || args.operatorQueue;
    else if (arg === "--official-source-submission") args.officialSourceSubmissions.push(argv[++i] || "");
    else if (arg === "--licensed-media-submission") args.licensedMediaSubmissions.push(argv[++i] || "");
    else if (arg === "--operator-plan-submission") args.operatorPlanSubmissions.push(argv[++i] || "");
    else if (arg === "--output-json") args.outputJson = argv[++i] || args.outputJson;
    else if (arg === "--output-md") args.outputMd = argv[++i] || args.outputMd;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.officialSourceSubmissions = args.officialSourceSubmissions.filter(Boolean);
  args.licensedMediaSubmissions = args.licensedMediaSubmissions.filter(Boolean);
  args.operatorPlanSubmissions = args.operatorPlanSubmissions.filter(Boolean);
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal04-source-submission-preflight -- [options]",
    "",
    "Options:",
    "  --operator-queue <path>             Operator source intake queue",
    "  --official-source-submission <path> Official-source submission JSON; repeatable",
    "  --licensed-media-submission <path>  Licensed/direct-media submission JSON; repeatable",
    "  --operator-plan-submission <path>   Operator plan approval JSON; repeatable",
    "  --output-json <path>                Preflight JSON",
    "  --output-md <path>                  Preflight Markdown",
    "  --generated-at <iso>                Fixed timestamp",
    "  --json                              Print compact JSON summary",
    "",
    "This command is report-only. It never runs intake validation, downloads media, mutates DB rows, touches OAuth tokens or publishes.",
  ].join("\n");
}

function resolvePath(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

async function readPayloads(root, paths) {
  const payloads = [];
  for (const filePath of paths) {
    const resolved = resolvePath(root, filePath);
    if (!(await fs.pathExists(resolved))) continue;
    payloads.push(await fs.readJson(resolved));
  }
  return payloads;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const root = path.resolve(args.root);
  const operatorQueue = await fs.readJson(resolvePath(root, args.operatorQueue));
  const report = buildGoal04OperatorSourceSubmissionPreflight({
    operatorQueue,
    officialSourceSubmissions: await readPayloads(root, args.officialSourceSubmissions),
    licensedMediaSubmissions: await readPayloads(root, args.licensedMediaSubmissions),
    operatorPlanSubmissions: await readPayloads(root, args.operatorPlanSubmissions),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const outputJson = resolvePath(root, args.outputJson);
  const outputMd = resolvePath(root, args.outputMd);
  await fs.ensureDir(path.dirname(outputJson));
  await fs.ensureDir(path.dirname(outputMd));
  await fs.writeJson(outputJson, report, { spaces: 2 });
  await fs.writeFile(outputMd, renderGoal04OperatorSourceSubmissionPreflightMarkdown(report), "utf8");

  const result = { report, artefacts: { outputJson, outputMd } };
  if (args.json) {
    console.log(JSON.stringify({
      verdict: report.summary.goal_verdict,
      stop_condition: report.stop_condition.status,
      validation_allowed: report.summary.validation_allowed,
      required_queue_items: report.summary.required_queue_items,
      complete_submission_items: report.summary.complete_submission_items,
      incomplete_submission_items: report.summary.incomplete_submission_items,
      missing_submission_items: report.summary.missing_submission_items,
      artefacts: result.artefacts,
    }, null, 2));
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
