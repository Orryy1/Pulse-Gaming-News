#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildLicensedDirectMediaAcquisitionReport,
  renderLicensedDirectMediaAcquisitionMarkdown,
} = require("../lib/studio/v4/licensed-direct-media-acquisition");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_SOURCE_FAMILY_REPORT = path.join(TEST_OUT, "studio_v4_source_family_acquisition.json");
const DEFAULT_DIRECT_MEDIA_REPORT = path.join(TEST_OUT, "official_direct_media_discovery.json");
const DEFAULT_OPERATOR_INTAKE = path.join(TEST_OUT, "licensed_direct_media_intake.json");
const DEFAULT_OUTPUT_JSON = path.join(TEST_OUT, "studio_v4_licensed_direct_media_acquisition.json");
const DEFAULT_OUTPUT_MD = path.join(TEST_OUT, "studio_v4_licensed_direct_media_acquisition.md");
const DEFAULT_INTAKE_TEMPLATE = path.join(TEST_OUT, "licensed_direct_media_intake_template.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    sourceFamilyReport: DEFAULT_SOURCE_FAMILY_REPORT,
    directMediaReport: DEFAULT_DIRECT_MEDIA_REPORT,
    operatorIntake: DEFAULT_OPERATOR_INTAKE,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
    intakeTemplate: DEFAULT_INTAKE_TEMPLATE,
    allowedLocalRoots: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--source-family-report") args.sourceFamilyReport = argv[++i] || DEFAULT_SOURCE_FAMILY_REPORT;
    else if (arg === "--direct-media-report") args.directMediaReport = argv[++i] || DEFAULT_DIRECT_MEDIA_REPORT;
    else if (arg === "--operator-intake") args.operatorIntake = argv[++i] || DEFAULT_OPERATOR_INTAKE;
    else if (arg === "--output-json") args.outputJson = argv[++i] || DEFAULT_OUTPUT_JSON;
    else if (arg === "--output-md") args.outputMd = argv[++i] || DEFAULT_OUTPUT_MD;
    else if (arg === "--intake-template") args.intakeTemplate = argv[++i] || DEFAULT_INTAKE_TEMPLATE;
    else if (arg === "--allowed-local-root") args.allowedLocalRoots.push(argv[++i] || "");
  }
  args.allowedLocalRoots = args.allowedLocalRoots.filter(Boolean);
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v4-licensed-direct-media.js [options]",
      "",
      "Options:",
      "  --story-id <id>                 Limit to one story",
      "  --source-family-report <path>   V4 source-family acquisition report",
      "  --direct-media-report <path>    Official direct media discovery report",
      "  --operator-intake <path>        Operator licence/local-file intake JSON",
      "  --allowed-local-root <path>     Extra allowed root for operator-supplied files; repeatable",
      "  --output-json <path>            Write local JSON report",
      "  --output-md <path>              Write local Markdown report",
      "  --intake-template <path>        Write fillable licence/direct-media intake template",
      "  --json                          Print JSON instead of Markdown",
      "",
      "This command does not download media, mutate the DB, change OAuth, restart services or post.",
    ].join("\n") + "\n",
  );
}

function resolveFromRoot(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
}

async function readJsonIfExists(filePath, fallback = {}) {
  const resolved = resolveFromRoot(filePath);
  if (!resolved || !(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

function rowsFromPayload(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.entries) && payload.entries.length) return payload.entries;
  if (Array.isArray(payload.items) && payload.items.length) return payload.items;
  if (Array.isArray(payload.rows) && payload.rows.length) return payload.rows;
  if (Array.isArray(payload.output_template?.entries) && payload.output_template.entries.length) {
    return payload.output_template.entries;
  }
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.output_template?.entries)) return payload.output_template.entries;
  return [];
}

function filterStoryInSourceFamilyReport(report = {}, storyId = null) {
  if (!storyId) return report;
  return {
    ...report,
    rows: rowsFromPayload(report.rows).filter((row) => String(row.story_id || "") === storyId),
    source_intake_template: {
      ...(report.source_intake_template || {}),
      entries: rowsFromPayload(report.source_intake_template || {}).filter(
        (entry) => String(entry.story_id || "") === storyId,
      ),
    },
  };
}

function filterStoryRows(payload = {}, storyId = null) {
  if (!storyId) return payload;
  const rows = rowsFromPayload(payload).filter((row) => String(row.story_id || "") === storyId);
  if (Array.isArray(payload)) return rows;
  return { ...payload, rows, entries: rows };
}

async function writeOutputs(args, report, markdown) {
  const outputJson = resolveFromRoot(args.outputJson);
  const outputMd = resolveFromRoot(args.outputMd);
  const intakeTemplate = resolveFromRoot(args.intakeTemplate);
  await fs.ensureDir(path.dirname(outputJson));
  await fs.ensureDir(path.dirname(outputMd));
  await fs.ensureDir(path.dirname(intakeTemplate));
  await fs.writeJson(outputJson, report, { spaces: 2 });
  await fs.writeFile(outputMd, markdown, "utf8");
  await fs.writeJson(intakeTemplate, report.intake_template.entries, { spaces: 2 });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const sourceFamilyReport = filterStoryInSourceFamilyReport(
    await readJsonIfExists(args.sourceFamilyReport, {}),
    args.storyId,
  );
  const directMediaReport = filterStoryRows(
    await readJsonIfExists(args.directMediaReport, {}),
    args.storyId,
  );
  const operatorIntake = filterStoryRows(
    await readJsonIfExists(args.operatorIntake, []),
    args.storyId,
  );
  const report = buildLicensedDirectMediaAcquisitionReport({
    sourceFamilyReport,
    directMediaReport,
    operatorIntake,
    allowedLocalRoots: args.allowedLocalRoots.map(resolveFromRoot),
    rootDir: ROOT,
  });
  const markdown = renderLicensedDirectMediaAcquisitionMarkdown(report);
  await writeOutputs(args, report, markdown);

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write(
    `[studio-v4-licensed-direct-media] wrote ${path.relative(ROOT, resolveFromRoot(args.outputJson)).replace(/\\/g, "/")}\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[studio-v4-licensed-direct-media] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  rowsFromPayload,
};
