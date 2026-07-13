#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildLongformFormatPortfolio,
  renderLongformFormatPortfolioMarkdown,
} = require("../lib/longform-format-portfolio");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join(ROOT, "output", "longform-portfolio");

function parseArgs(argv = []) {
  const args = {
    outDir: DEFAULT_OUT_DIR,
    generatedAt: null,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++index] || "");
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg.startsWith("--generated-at=")) args.generatedAt = arg.slice("--generated-at=".length) || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }

  return args;
}

function renderHelp() {
  return [
    "Usage: node tools/longform-format-portfolio.js [options]",
    "",
    "Options:",
    "  --out-dir <path>       Proof output directory; default output/longform-portfolio",
    "  --generated-at <iso>    Fixed generation timestamp for deterministic proof",
    "  --json                  Print the completion summary as JSON",
    "  --help                  Show this help",
    "",
    "This command writes local JSON and Markdown proof only. It cannot upload or publish.",
    "",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(renderHelp());
    return { status: "help" };
  }

  const report = buildLongformFormatPortfolio({
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const markdown = renderLongformFormatPortfolioMarkdown(report);
  const jsonPath = path.join(args.outDir, "longform_format_portfolio.json");
  const markdownPath = path.join(args.outDir, "longform_format_portfolio.md");

  await fs.mkdir(args.outDir, { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, markdown, "utf8");

  const result = {
    status: "completed",
    formatCount: report.summary.format_count,
    jsonPath,
    markdownPath,
    safety: report.safety,
  };
  if (args.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else stdout.write(`Longform portfolio proof written to ${args.outDir}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[longform-format-portfolio] ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_OUT_DIR,
  parseArgs,
  renderHelp,
  main,
};
