#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildStudioV2PromotionPacket,
  renderStudioV2PromotionPacketMarkdown,
} = require("../lib/studio/v2/promotion-packet");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_STILL_DECK_REPORT = path.join(
  ROOT,
  "test",
  "output",
  "studio-v2-still-deck",
  "studio_v2_still_deck_report.json",
);
const DEFAULT_OUT_DIR = path.join(ROOT, "test", "output", "studio-v2-promotion");
const ROOT_MARKDOWN = path.join(ROOT, "STUDIO_V2_OVERNIGHT_PROMOTION_PACKET.md");

function parseArgs(argv) {
  const args = {
    report: DEFAULT_STILL_DECK_REPORT,
    outDir: DEFAULT_OUT_DIR,
    rootMarkdown: ROOT_MARKDOWN,
    noRootMarkdown: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--report") args.report = path.resolve(argv[++i] || "");
    else if (arg === "--out-dir") args.outDir = path.resolve(argv[++i] || "");
    else if (arg === "--root-markdown") args.rootMarkdown = path.resolve(argv[++i] || "");
    else if (arg === "--no-root-markdown") args.noRootMarkdown = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v2-promotion-packet.js [options]",
      "",
      "Options:",
      "  --report <path>         Studio V2 still-deck report JSON",
      "  --out-dir <path>        Output directory, default test/output/studio-v2-promotion",
      "  --root-markdown <path>  Root markdown packet path",
      "  --no-root-markdown      Only write under --out-dir",
      "",
      "This command is reporting-only. It does not switch renderer defaults, mutate Railway, trigger OAuth, write production DB rows or post to platforms.",
    ].join("\n") + "\n",
  );
}

async function readJsonIfExists(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath).catch(() => null);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (!(await fs.pathExists(args.report))) {
    throw new Error(`Studio V2 still-deck report not found: ${args.report}`);
  }

  const stillDeckReport = await fs.readJson(args.report);
  const qaPath = stillDeckReport?.renders?.enriched?.qa
    ? path.resolve(ROOT, stillDeckReport.renders.enriched.qa)
    : null;
  const forensicPath = path.join(
    ROOT,
    "test",
    "output",
    "studio-v2-still-deck",
    "forensic_comparison.json",
  );
  const qaReport = (await readJsonIfExists(qaPath)) || {};
  const forensicComparison = await readJsonIfExists(forensicPath);
  const forensicReportPath = stillDeckReport?.renders?.enriched?.forensic?.jsonPath
    ? path.resolve(ROOT, stillDeckReport.renders.enriched.forensic.jsonPath)
    : null;
  const forensicReport = await readJsonIfExists(forensicReportPath);
  const packet = buildStudioV2PromotionPacket({
    stillDeckReport,
    qaReport,
    forensicComparison,
    forensicReport,
  });
  const markdown = renderStudioV2PromotionPacketMarkdown(packet);

  await fs.ensureDir(args.outDir);
  const jsonPath = path.join(args.outDir, "studio_v2_overnight_promotion_packet.json");
  const mdPath = path.join(args.outDir, "studio_v2_overnight_promotion_packet.md");
  await fs.writeJson(jsonPath, packet, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  if (!args.noRootMarkdown) {
    await fs.writeFile(args.rootMarkdown, markdown, "utf8");
  }

  process.stdout.write(markdown);
  process.stderr.write(
    `[studio-v2-promotion] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")} and ${path.relative(ROOT, mdPath).replace(/\\/g, "/")}\n`,
  );
  if (!args.noRootMarkdown) {
    process.stderr.write(
      `[studio-v2-promotion] wrote ${path.relative(ROOT, args.rootMarkdown).replace(/\\/g, "/")}\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`[studio-v2-promotion] ${err.stack || err.message}\n`);
  process.exit(1);
});
