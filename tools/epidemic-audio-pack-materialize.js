#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  executeEpidemicSoundImplementation,
  normaliseChannelIds,
  renderImplementationMarkdown,
} = require("../lib/epidemic-audio-pack-materializer");

function parseArgs(argv = process.argv) {
  const args = {
    intakeReportPath: path.join("output", "epidemic-sound-intake", "epidemic_sound_intake_report.json"),
    outputDir: path.join("output", "epidemic-implementation"),
    generatedAt: new Date().toISOString(),
    channelIds: [],
    apply: false,
    json: false,
    help: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--intake-report") args.intakeReportPath = argv[++index] || args.intakeReportPath;
    else if (arg === "--out-dir") args.outputDir = argv[++index] || args.outputDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || args.generatedAt;
    else if (arg === "--channel" || arg === "--channels") {
      args.channelIds = normaliseChannelIds([...args.channelIds, argv[++index] || ""]);
    }
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/epidemic-audio-pack-materialize.js [options]",
    "",
    "Materialises Epidemic Sound channel packs and SFX runtime manifests from a PASS intake report.",
    "Default mode writes proof artefacts only. Use --apply only after the report is PASS.",
    "",
    "Options:",
    "  --intake-report <path>  Intake report JSON. Default: output/epidemic-sound-intake/epidemic_sound_intake_report.json",
    "  --out-dir <dir>         Proof output dir. Default: output/epidemic-implementation",
    "  --generated-at <iso>    Deterministic proof timestamp",
    "  --channel <id>[,<id>]   Channel(s) covered by retained safelist evidence. Required with --apply",
    "  --apply                 Write channels/<channel>/audio/pack.json only when the intake is PASS",
    "  --json                  Print JSON",
    "",
    "Safety: no downloads, no publishing, no DB mutation, no OAuth/token mutation and no secret reads.",
  ].join("\n");
}

function renderMarkdown(plan = {}) {
  return renderImplementationMarkdown(plan);
}

async function readIntakeReport(filePath) {
  const resolved = path.resolve(filePath);
  if (!(await fs.pathExists(resolved))) {
    throw new Error(`intake report not found: ${resolved}`);
  }
  return fs.readJson(resolved);
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { args };
  }
  const report = await readIntakeReport(args.intakeReportPath);
  const result = await executeEpidemicSoundImplementation({
    workspaceRoot: process.cwd(),
    report,
    outputDir: args.outputDir,
    generatedAt: args.generatedAt,
    channelIds: args.channelIds,
    apply: args.apply,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Epidemic Sound implementation: ${result.plan.readiness.status}`);
    console.log(`Channel packs planned: ${result.plan.summary.channel_packs_planned}`);
    console.log(`Channel packs written: ${result.plan.summary.channel_packs_written}`);
    console.log(`Channel scope: ${result.plan.channel_filter.requested_channel_ids.join(", ") || "(not set)"}`);
    console.log(`SFX roles covered: ${result.plan.summary.sfx_roles_covered}`);
    console.log(`Report: ${result.outputs.reportPath}`);
    console.log("Safety: local-only, no downloads, no publish, no DB mutation, no OAuth changes.");
  }
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[epidemic-audio-pack-materialize] ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  renderMarkdown,
  usage,
};
