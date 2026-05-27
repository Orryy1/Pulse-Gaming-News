#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoal04OperatorSourceIntakeQueue,
  renderGoal04OperatorSourceIntakeQueueMarkdown,
} = require("../lib/goal04-operator-source-intake-queue");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    consolidationReport: path.join(
      process.cwd(),
      "output",
      "goal-04",
      "human-held-source-consolidation-1019",
      "goal04_human_held_source_consolidation.json",
    ),
    outputJson: path.join(process.cwd(), "output", "goal-04", "operator-source-intake-queue.json"),
    outputMd: path.join(process.cwd(), "output", "goal-04", "operator-source-intake-queue.md"),
    officialSourceTemplate: path.join(
      process.cwd(),
      "output",
      "goal-04",
      "operator-source-intake-queue",
      "official_source_entries_template.json",
    ),
    licensedMediaTemplate: path.join(
      process.cwd(),
      "output",
      "goal-04",
      "operator-source-intake-queue",
      "licensed_direct_media_operator_intake_template.json",
    ),
    validationPlan: path.join(
      process.cwd(),
      "output",
      "goal-04",
      "operator-source-intake-queue",
      "post_operator_submission_validation_plan.json",
    ),
    generatedAt: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--consolidation-report") args.consolidationReport = argv[++i] || args.consolidationReport;
    else if (arg === "--output-json") args.outputJson = argv[++i] || args.outputJson;
    else if (arg === "--output-md") args.outputMd = argv[++i] || args.outputMd;
    else if (arg === "--official-source-template") args.officialSourceTemplate = argv[++i] || args.officialSourceTemplate;
    else if (arg === "--licensed-media-template") args.licensedMediaTemplate = argv[++i] || args.licensedMediaTemplate;
    else if (arg === "--validation-plan") args.validationPlan = argv[++i] || args.validationPlan;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal04-operator-source-queue -- [options]",
    "",
    "Options:",
    "  --consolidation-report <path>      Goal 04 human-held consolidation report",
    "  --output-json <path>               Operator queue JSON",
    "  --output-md <path>                 Operator queue Markdown",
    "  --official-source-template <path>  Fillable official-source intake entries",
    "  --licensed-media-template <path>   Fillable licensed/direct-media entries",
    "  --validation-plan <path>           Post-submission validation command plan",
    "  --generated-at <iso>               Fixed timestamp",
    "  --json                             Print compact JSON summary",
    "",
    "This command creates a local operator queue only. It does not acquire sources, download media, mutate production DB rows, touch OAuth tokens or publish.",
  ].join("\n");
}

function resolvePath(root, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

async function writeJson(filePath, payload) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, payload, { spaces: 2 });
}

async function writeOutputs({
  report,
  outputJson,
  outputMd,
  officialSourceTemplate,
  licensedMediaTemplate,
  validationPlan,
}) {
  await writeJson(outputJson, report);
  await fs.ensureDir(path.dirname(outputMd));
  await fs.writeFile(outputMd, renderGoal04OperatorSourceIntakeQueueMarkdown(report), "utf8");
  await writeJson(officialSourceTemplate, report.official_source_entries_template);
  await writeJson(licensedMediaTemplate, report.licensed_direct_media_operator_intake_template);
  await writeJson(validationPlan, report.post_operator_submission_validation_plan);
  return {
    outputJson,
    outputMd,
    officialSourceTemplate,
    licensedMediaTemplate,
    validationPlan,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const root = path.resolve(args.root);
  const consolidation = await fs.readJson(resolvePath(root, args.consolidationReport));
  const report = buildGoal04OperatorSourceIntakeQueue({
    consolidationReport: consolidation,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeOutputs({
    report,
    outputJson: resolvePath(root, args.outputJson),
    outputMd: resolvePath(root, args.outputMd),
    officialSourceTemplate: resolvePath(root, args.officialSourceTemplate),
    licensedMediaTemplate: resolvePath(root, args.licensedMediaTemplate),
    validationPlan: resolvePath(root, args.validationPlan),
  });

  const result = { report, artefacts };
  if (args.json) {
    console.log(JSON.stringify({
      verdict: report.summary.goal_verdict,
      stop_condition: report.stop_condition.status,
      story_count: report.summary.story_count,
      queue_item_count: report.summary.queue_item_count,
      auto_continue_allowed: report.summary.auto_continue_allowed,
      artefacts,
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
