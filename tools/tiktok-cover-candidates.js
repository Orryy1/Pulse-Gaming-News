#!/usr/bin/env node
"use strict";

const cp = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const {
  buildTikTokCoverCandidateReport,
  renderTikTokCoverCandidateMarkdown,
} = require("../lib/platforms/tiktok-cover-candidates");
const {
  prescanImage,
} = require("../lib/visual-content-prescan");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output", "tiktok-cover-candidates");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story") args.story = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--mp4") args.mp4 = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--duration") args.duration = Number(argv[++i]);
    else if (arg === "--timestamps") args.timestamps = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
  }
  return args;
}

function resolvePath(raw) {
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function rel(filePath) {
  const value = path.relative(ROOT, filePath);
  return value.startsWith("..") ? filePath : value;
}

function probeDurationSeconds(mp4Path) {
  if (!mp4Path || !fs.existsSync(mp4Path)) return null;
  try {
    const raw = cp.execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        mp4Path,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const parsed = Number(String(raw || "").trim());
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
  } catch {
    return null;
  }
}

function parseTimestamps(raw, durationSeconds) {
  if (raw) {
    return String(raw)
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item >= 0);
  }
  const duration = Number(durationSeconds);
  const base = [3, 6, 9, 12, 16, 20, 26, 34, 42, 52, 62];
  if (!Number.isFinite(duration) || duration <= 8) return base.slice(0, 4);
  return base.filter((second) => second < duration - 2);
}

function extractFrame({ mp4Path, outputPath, timestampS }) {
  fs.ensureDirSync(path.dirname(outputPath));
  cp.execFileSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      String(timestampS),
      "-i",
      mp4Path,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath,
    ],
    { stdio: "ignore", windowsHide: true },
  );
}

async function buildContactSheet(candidates, outputPath) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    return null;
  }
  const existing = candidates.filter((candidate) => candidate.path && fs.existsSync(candidate.path));
  if (!existing.length) return null;
  const thumbW = 180;
  const thumbH = 320;
  const cols = Math.min(4, existing.length);
  const rows = Math.ceil(existing.length / cols);
  const composites = [];
  for (let i = 0; i < existing.length; i++) {
    const input = await sharp(existing[i].path).resize(thumbW, thumbH, { fit: "cover" }).jpeg().toBuffer();
    composites.push({
      input,
      left: (i % cols) * thumbW,
      top: Math.floor(i / cols) * thumbH,
    });
  }
  await sharp({
    create: {
      width: cols * thumbW,
      height: rows * thumbH,
      channels: 3,
      background: "#111111",
    },
  })
    .composite(composites)
    .jpeg({ quality: 88 })
    .toFile(outputPath);
  return outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mp4Path = resolvePath(args.mp4);
  if (!mp4Path) throw new Error("TikTok cover candidate scan requires --mp4.");
  if (!(await fs.pathExists(mp4Path))) throw new Error(`MP4 not found: ${mp4Path}`);

  const outDir = resolvePath(args.outDir || OUT);
  await fs.ensureDir(outDir);
  const storyId = args.story || path.basename(mp4Path, path.extname(mp4Path));
  const durationSeconds = Number.isFinite(Number(args.duration))
    ? Number(args.duration)
    : probeDurationSeconds(mp4Path);
  const coverDir = path.join(outDir, "covers");
  const timestamps = parseTimestamps(args.timestamps, durationSeconds);
  const candidates = [];

  for (const timestampS of timestamps) {
    const safeSecond = String(timestampS).replace(/[^0-9.]+/g, "_");
    const outputPath = path.join(coverDir, `${storyId}_${safeSecond}s.jpg`);
    try {
      extractFrame({ mp4Path, outputPath, timestampS });
      const prescan = await prescanImage(outputPath);
      candidates.push({
        path: outputPath,
        timestampS,
        exists: true,
        prescan,
      });
    } catch (err) {
      candidates.push({
        path: outputPath,
        timestampS,
        exists: false,
        error: err.message || String(err),
      });
    }
  }

  const report = buildTikTokCoverCandidateReport({
    storyId,
    title: args.title || storyId,
    durationSeconds,
    candidates,
  });
  const sheetPath = path.join(outDir, "tiktok_cover_candidates_contact_sheet.jpg");
  const contactSheet = await buildContactSheet(candidates, sheetPath);
  report.contactSheet = contactSheet;

  const jsonPath = path.join(outDir, "tiktok_cover_candidates.json");
  const mdPath = path.join(outDir, "tiktok_cover_candidates.md");
  const selectedPath = path.join(outDir, "tiktok_selected_cover.txt");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderTikTokCoverCandidateMarkdown(report), "utf8");
  await fs.writeFile(selectedPath, `${report.selected?.path || ""}\n`, "utf8");

  console.log(`[tiktok-covers] ready=${report.ready} selected=${report.selected?.path || "none"}`);
  console.log(`[tiktok-covers] json=${rel(jsonPath)}`);
  console.log(`[tiktok-covers] md=${rel(mdPath)}`);
  if (contactSheet) console.log(`[tiktok-covers] contact_sheet=${rel(contactSheet)}`);
  console.log(`[tiktok-covers] selected=${rel(selectedPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tiktok-covers] ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildContactSheet,
  extractFrame,
  main,
  parseArgs,
  parseTimestamps,
  probeDurationSeconds,
};
