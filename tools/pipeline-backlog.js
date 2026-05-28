#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const {
  buildPipelineBacklog,
  requiredCorePlatformsFromEnv,
  renderPipelineBacklogMarkdown,
} = require("../lib/services/pipeline-backlog");
const { scoreCandidate } = require("./next-publish-candidates");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_ANALYTICS_PATH = "D:\\pulse-data\\analytics_findings.md";
const DEFAULT_CANDIDATE_REPORT_PATH = path.join(OUT, "next_publish_candidates.json");

function parseArgs(argv) {
  const args = {
    json: false,
    candidateReportPath: DEFAULT_CANDIDATE_REPORT_PATH,
  };
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--candidate-report") args.candidateReportPath = raw[++i] || args.candidateReportPath;
    else if (arg.startsWith("--candidate-report=")) {
      args.candidateReportPath = arg.slice("--candidate-report=".length);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write("Usage: node tools/pipeline-backlog.js [--json]\n");
    return;
  }

  const stories = await require("../lib/db").getStories();
  const analyticsText = readOptionalFile(
    process.env.PUBLISH_SELECTION_ANALYTICS_PATH ||
      process.env.ANALYTICS_FINDINGS_PATH ||
      DEFAULT_ANALYTICS_PATH,
  );
  const schedulerBridgeCandidateReport = readOptionalJson(args.candidateReportPath);
  const report = buildPipelineBacklog(stories, {
    corePlatforms: requiredCorePlatformsFromEnv(process.env),
    strictContentQa: true,
    selectionScore: (story) => scoreCandidate(story, { analyticsText }).score,
    schedulerBridgeCandidateReport,
  });
  const markdown = renderPipelineBacklogMarkdown(report);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "pipeline_backlog.json");
  const mdPath = path.join(OUT, "pipeline_backlog.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(markdown);
  process.stderr.write(`[pipeline-backlog] json=${path.relative(ROOT, jsonPath)}\n`);
  process.stderr.write(`[pipeline-backlog] md=${path.relative(ROOT, mdPath)}\n`);
}

function readOptionalFile(target) {
  if (!target) return "";
  try {
    return fs.pathExistsSync(target) ? fs.readFileSync(target, "utf8") : "";
  } catch {
    return "";
  }
}

function readOptionalJson(target) {
  if (!target) return null;
  try {
    const resolved = path.resolve(target);
    return fs.pathExistsSync(resolved) ? fs.readJsonSync(resolved) : null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  process.stderr.write(`[pipeline-backlog] ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
