#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

const {
  buildFinalVoiceAudit,
  renderFinalVoiceAuditMarkdown,
  storyIdFromPath,
} = require("../lib/studio/v2/final-voice-audit");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--final-dir") args.finalDir = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function safeReadJson(file) {
  try {
    if (await fs.pathExists(file)) return await fs.readJson(file);
  } catch (_) {
    return null;
  }
  return null;
}

async function loadReportsByStoryId(files, finalDir) {
  const reports = {};
  for (const file of files) {
    const id = storyIdFromPath(file);
    const candidates = [
      path.join(finalDir, `${id}.voice.json`),
      path.join(finalDir, `${id}.render_manifest.json`),
      path.join(finalDir, `${id}.json`),
      path.join(OUT, `${id}.voice.json`),
      path.join(OUT, `${id}.render_manifest.json`),
    ];
    for (const candidate of candidates) {
      const json = await safeReadJson(candidate);
      if (json) {
        reports[id] = json;
        break;
      }
    }
  }
  return reports;
}

async function listMp4s(finalDir, limit) {
  if (!(await fs.pathExists(finalDir))) return [];
  const entries = await fs.readdir(finalDir);
  const files = entries
    .filter((entry) => /\.mp4$/i.test(entry))
    .sort()
    .map((entry) => path.join(finalDir, entry));
  return Number.isFinite(limit) && limit > 0 ? files.slice(0, limit) : files;
}

async function main() {
  const args = parseArgs(process.argv);
  const finalDir = path.resolve(
    args.finalDir ||
      process.env.FINAL_RENDER_DIR ||
      (process.env.MEDIA_ROOT
        ? path.join(process.env.MEDIA_ROOT, "output", "final")
        : "D:/pulse-data/media/output/final"),
  );
  const outDir = path.resolve(args.outDir || OUT);
  await fs.ensureDir(outDir);

  const files = await listMp4s(finalDir, args.limit);
  const reportsByStoryId = await loadReportsByStoryId(files, finalDir);
  const report = buildFinalVoiceAudit({ files, reportsByStoryId });
  const jsonPath = path.join(outDir, "final_voice_audit.json");
  const mdPath = path.join(outDir, "final_voice_audit.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderFinalVoiceAuditMarkdown(report), "utf8");

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(
      `[final-voice-audit] verdict=${report.verdict} pass=${report.counts.pass} review=${report.counts.review} reject=${report.counts.reject} skip=${report.counts.skip}\n`,
    );
    process.stdout.write(`[final-voice-audit] final_dir=${finalDir}\n`);
    process.stdout.write(`[final-voice-audit] json=${path.relative(ROOT, jsonPath)}\n`);
    process.stdout.write(`[final-voice-audit] md=${path.relative(ROOT, mdPath)}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[final-voice-audit] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
