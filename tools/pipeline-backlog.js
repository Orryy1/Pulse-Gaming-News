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

function parseArgs(argv) {
  const args = { json: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
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
  const report = buildPipelineBacklog(stories, {
    corePlatforms: requiredCorePlatformsFromEnv(process.env),
    selectionScore: (story) => scoreCandidate(story, { analyticsText }).score,
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

main().catch((err) => {
  process.stderr.write(`[pipeline-backlog] ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
