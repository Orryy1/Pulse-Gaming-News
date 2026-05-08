#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildAlternateOfficialSourceHandoffReport,
  renderAlternateOfficialSourceHandoffMarkdown,
} = require("../lib/ops/alternate-official-source-handoff");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_MOTION_GAP_REPORT = path.join(OUT, "studio_v2_motion_gap.json");
const DEFAULT_REFERENCE_REPORT = path.join(OUT, "official_trailer_references_v1.json");
const DEFAULT_ROOT_REPORT = path.join(ROOT, "ALTERNATE_OFFICIAL_SOURCE_HANDOFF.md");
const DEFAULT_SOURCE_TEMPLATE = path.join(OUT, "official_source_intake_template.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    motionGapReport: DEFAULT_MOTION_GAP_REPORT,
    referenceReport: DEFAULT_REFERENCE_REPORT,
    templateOutput: DEFAULT_SOURCE_TEMPLATE,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--motion-gap-report") args.motionGapReport = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--reference-report") args.referenceReport = path.resolve(ROOT, argv[++i] || "");
    else if (arg === "--template-output") args.templateOutput = path.resolve(ROOT, argv[++i] || "");
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/alternate-official-source-handoff.js [options]",
      "",
      "Options:",
      "  --motion-gap-report <path>  Read Studio V2 motion-gap report",
      "  --reference-report <path>   Read official trailer reference report",
      "  --story-id <id>             Filter handoff and template rows to one story",
      "  --template-output <path>    Write fillable official-source intake template JSON",
      "  --json                      Print JSON instead of Markdown",
      "",
      "Read-only/report-only. Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth.",
    ].join("\n") + "\n",
  );
}

async function readJsonIfExists(filePath, label, required = true) {
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) {
    if (required) throw new Error(`${label} not found: ${resolved}`);
    return null;
  }
  return fs.readJson(resolved);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const motionGapReport = await readJsonIfExists(args.motionGapReport, "motion gap report", true);
  const referenceReport = await readJsonIfExists(args.referenceReport, "reference report", true);
  const report = buildAlternateOfficialSourceHandoffReport({
    motionGapReport,
    referenceReport,
    storyId: args.storyId,
  });
  const markdown = renderAlternateOfficialSourceHandoffMarkdown(report);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "alternate_official_source_handoff.json");
  const mdPath = path.join(OUT, "alternate_official_source_handoff.md");
  const templatePath = path.resolve(ROOT, args.templateOutput);
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.ensureDir(path.dirname(templatePath));
  await fs.writeJson(templatePath, report.source_intake_template?.entries || [], { spaces: 2 });
  await fs.writeFile(DEFAULT_ROOT_REPORT, markdown, "utf8");

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
  process.stderr.write(
    `[alternate-source-handoff] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")}, ${path.relative(
      ROOT,
      mdPath,
    ).replace(/\\/g, "/")}, ${path.relative(ROOT, templatePath).replace(/\\/g, "/")} and ${path.relative(
      ROOT,
      DEFAULT_ROOT_REPORT,
    ).replace(/\\/g, "/")}\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[alternate-source-handoff] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
};
