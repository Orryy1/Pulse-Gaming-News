#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  executeEpidemicDownloadIntake,
} = require("../lib/epidemic-download-intake");

function parseArgs(argv = process.argv) {
  const args = {
    sourceDir: path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), "Downloads"),
    targetRoot: path.join("audio", "epidemic"),
    outputDir: path.join("output", "epidemic-download-intake"),
    generatedAt: new Date().toISOString(),
    roleHint: "",
    sinceIso: "",
    allowUnprefixed: false,
    apply: false,
    json: false,
    help: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") args.sourceDir = argv[++index] || args.sourceDir;
    else if (arg === "--target-root") args.targetRoot = argv[++index] || args.targetRoot;
    else if (arg === "--out-dir") args.outputDir = argv[++index] || args.outputDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || args.generatedAt;
    else if (arg === "--role") args.roleHint = argv[++index] || "";
    else if (arg === "--since-iso") args.sinceIso = argv[++index] || "";
    else if (arg === "--allow-unprefixed") args.allowUnprefixed = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:epidemic-download-intake -- [options]",
    "",
    "Copies recognised Epidemic downloads into Pulse's governed audio/epidemic folders.",
    "Default mode is dry-run. Use --apply to copy. Source files are never deleted.",
    "",
    "Options:",
    "  --source <dir>         Source folder. Default: current user's Downloads",
    "  --target-root <dir>    Target root. Default: audio/epidemic",
    "  --out-dir <dir>        Proof output dir. Default: output/epidemic-download-intake",
    "  --generated-at <iso>   Deterministic proof timestamp",
    "  --role <role>          Explicit role hint for a batch with vague filenames",
    "  --since-iso <iso>      Only consider audio files modified at or after this timestamp",
    "  --allow-unprefixed     Permit filename-only classification. Default requires epidemic_<role>_ prefixes",
    "  --apply                Copy recognised files",
    "  --json                 Print JSON",
  ].join("\n");
}

async function writeReport(report, { outputDir } = {}) {
  const outDir = path.resolve(outputDir || path.join("output", "epidemic-download-intake"));
  await fs.ensureDir(outDir);
  const outputs = {
    reportPath: path.join(outDir, "epidemic_download_intake_report.json"),
    plannedCopiesPath: path.join(outDir, "epidemic_download_planned_copies.json"),
    needsReviewPath: path.join(outDir, "epidemic_download_needs_review.json"),
    markdownPath: path.join(outDir, "epidemic_download_intake_report.md"),
  };
  await fs.writeJson(outputs.reportPath, report, { spaces: 2 });
  await fs.writeJson(outputs.plannedCopiesPath, report.planned_copies || [], { spaces: 2 });
  await fs.writeJson(outputs.needsReviewPath, report.needs_review || [], { spaces: 2 });
  await fs.writeFile(outputs.markdownPath, renderMarkdown(report));
  return outputs;
}

function renderMarkdown(report = {}) {
  const lines = [];
  lines.push("# Epidemic Download Intake");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "(unknown)"}`);
  lines.push(`Mode: ${report.mode || "unknown"}`);
  lines.push(`Source: ${report.source_dir || "(unknown)"}`);
  lines.push(`Target: ${report.target_root || "(unknown)"}`);
  lines.push(`Prefix required: ${report.prefix_required === false ? "no" : "yes"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Candidate files: ${Number(report.summary?.candidate_files || 0)}`);
  lines.push(`- Planned copies: ${Number(report.summary?.planned_copies || 0)}`);
  lines.push(`- Copied files: ${Number(report.summary?.copied_files || 0)}`);
  lines.push(`- Needs review: ${Number(report.summary?.needs_review || 0)}`);
  lines.push("");
  if (report.planned_copies?.length) {
    lines.push("## Planned Copies");
    for (const item of report.planned_copies) {
      lines.push(`- ${item.role}: ${item.source_path} -> ${item.target_path}`);
    }
    lines.push("");
  }
  if (report.needs_review?.length) {
    lines.push("## Needs Review");
    for (const item of report.needs_review) {
      const detected = item.detected_role ? `, detected role ${item.detected_role}` : "";
      lines.push(`- ${item.source_path}: ${item.reason}${detected}`);
    }
    lines.push("");
  }
  lines.push("## Safety");
  if (report.safety?.copy_only) lines.push("- Copy-only intake.");
  if (report.safety?.no_source_deletion) lines.push("- Source files were not deleted or moved.");
  if (report.safety?.no_posting) lines.push("- No publishing APIs were called.");
  if (report.safety?.no_db_mutation) lines.push("- No database rows were mutated.");
  if (report.safety?.no_oauth_or_token_change) lines.push("- No OAuth or token settings were changed.");
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { args };
  }
  const report = await executeEpidemicDownloadIntake({
    workspaceRoot: process.cwd(),
    sourceDir: args.sourceDir,
    targetRoot: args.targetRoot,
    generatedAt: args.generatedAt,
    roleHint: args.roleHint,
    sinceIso: args.sinceIso,
    allowUnprefixed: args.allowUnprefixed,
    apply: args.apply,
  });
  const outputs = await writeReport(report, { outputDir: args.outputDir });
  if (args.json) {
    console.log(JSON.stringify({ report, outputs }, null, 2));
  } else {
    console.log(`Epidemic download intake: ${report.mode}`);
    console.log(`Planned copies: ${report.summary.planned_copies}`);
    console.log(`Copied files: ${report.summary.copied_files}`);
    console.log(`Needs review: ${report.summary.needs_review}`);
    console.log(`Report: ${outputs.reportPath}`);
  }
  return { report, outputs };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[epidemic-download-intake] ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  renderMarkdown,
  usage,
  writeReport,
};
