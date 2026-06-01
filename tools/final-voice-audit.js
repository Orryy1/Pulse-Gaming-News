#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

const {
  buildFinalVoiceAudit,
  renderFinalVoiceAuditMarkdown,
} = require("../lib/studio/v2/final-voice-audit");
const {
  loadFinalVoiceReportsByStoryId,
} = require("../lib/studio/v2/final-voice-report-loader");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "goal-contract");
const TEST_OUT = path.join(ROOT, "test", "output");
const LOCAL_TEST_MANIFEST = path.join(OUT, "local_test_video_manifest.json");

function defaultOutDir() {
  return OUT;
}

function defaultLocalTestManifestPath() {
  return LOCAL_TEST_MANIFEST;
}

function parseArgs(argv) {
  const args = { includeLocalTestManifest: true };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--final-dir") args.finalDir = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--local-test-manifest") args.localTestManifestPath = argv[++i];
    else if (arg === "--skip-local-test-manifest") args.includeLocalTestManifest = false;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function collectMp4s(dir, depth = 3) {
  if (depth < 0 || !(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && /\.mp4$/i.test(entry.name)) {
      const stat = await fs.stat(fullPath);
      files.push({ fullPath, mtimeMs: stat.mtimeMs });
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    files.push(...(await collectMp4s(path.join(dir, entry.name), depth - 1)));
  }
  return files;
}

async function listMp4s(finalDir, limit) {
  if (!(await fs.pathExists(finalDir))) return [];
  const files = await collectMp4s(finalDir);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.fullPath.localeCompare(b.fullPath));
  const mp4s = files.map((file) => file.fullPath);
  return Number.isFinite(limit) && limit > 0 ? mp4s.slice(0, limit) : mp4s;
}

function manifestVideoPaths(manifest = {}) {
  const videos = Array.isArray(manifest.videos) ? manifest.videos : [];
  return videos
    .map((video) => video?.video_path || video?.videoPath)
    .filter((file) => typeof file === "string" && /\.mp4$/i.test(file))
    .map((file) => path.resolve(file));
}

async function listLocalTestManifestMp4s(manifestPath = defaultLocalTestManifestPath()) {
  try {
    const resolved = path.resolve(manifestPath);
    if (!(await fs.pathExists(resolved))) return [];
    return manifestVideoPaths(await fs.readJson(resolved));
  } catch (_) {
    return [];
  }
}

async function listAuditMp4s({
  finalDir,
  limit,
  localTestManifestPath = defaultLocalTestManifestPath(),
  includeLocalTestManifest = true,
} = {}) {
  const files = await listMp4s(finalDir, limit);
  if (includeLocalTestManifest) {
    files.push(...(await listLocalTestManifestMp4s(localTestManifestPath)));
  }
  return [...new Set(files)];
}

async function main() {
  dotenv.config({ override: true });
  const args = parseArgs(process.argv);
  const finalDir = path.resolve(
    args.finalDir ||
      process.env.FINAL_RENDER_DIR ||
      (process.env.MEDIA_ROOT
        ? path.join(process.env.MEDIA_ROOT, "output", "final")
        : "D:/pulse-data/media/output/final"),
  );
  const outDir = path.resolve(args.outDir || defaultOutDir());
  await fs.ensureDir(outDir);

  const files = await listAuditMp4s({
    finalDir,
    limit: args.limit,
    localTestManifestPath: args.localTestManifestPath || defaultLocalTestManifestPath(),
    includeLocalTestManifest: args.includeLocalTestManifest,
  });
  const reportsByStoryId = await loadFinalVoiceReportsByStoryId(files, {
    finalDir,
    outputDirs: [...new Set([outDir, OUT, TEST_OUT])],
  });
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

module.exports = {
  defaultLocalTestManifestPath,
  defaultOutDir,
  listAuditMp4s,
  listLocalTestManifestMp4s,
  listMp4s,
};
