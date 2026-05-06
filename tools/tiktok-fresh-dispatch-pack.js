#!/usr/bin/env node
"use strict";

const cp = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const {
  buildFreshTikTokDispatchPack,
  renderFreshTikTokDispatchMarkdown,
} = require("../lib/platforms/tiktok-fresh-dispatch-pack");
const {
  resolveAcceptedLocalVoiceReference,
} = require("../lib/studio/v2/local-voice-reference");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output", "tiktok-fresh-dispatch");

function parseArgs(argv) {
  const args = {
    dryRun: true,
    maxAgeHours: 36,
    coverTimestamp: "00:00:06",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story") args.story = argv[++i];
    else if (arg === "--title") args.title = argv[++i];
    else if (arg === "--mp4") args.mp4 = argv[++i];
    else if (arg === "--cover") args.cover = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--duration") args.duration = Number(argv[++i]);
    else if (arg === "--max-age-hours") args.maxAgeHours = Number(argv[++i]);
    else if (arg === "--approved-audio") args.approvedAudio = argv[++i];
    else if (arg === "--transcript") args.transcript = argv[++i];
    else if (arg === "--transcript-file") args.transcriptFile = argv[++i];
    else if (arg === "--timestamps-json") args.timestampsJson = argv[++i];
    else if (arg === "--median-pitch-hz") args.medianPitchHz = Number(argv[++i]);
    else if (arg === "--extract-cover") args.extractCover = true;
    else if (arg === "--cover-timestamp") args.coverTimestamp = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
  }
  return args;
}

function resolvePath(raw) {
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function relativeForConsole(filePath) {
  if (!filePath) return "missing";
  const relative = path.relative(ROOT, filePath);
  return relative.startsWith("..") ? filePath : relative;
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

async function inspectMp4(mp4Path, args = {}) {
  if (!mp4Path) {
    return {
      exists: false,
      absolute_path: null,
      is_current_render: false,
      reason: "mp4_path_missing",
      max_age_hours: args.maxAgeHours,
    };
  }
  const resolved = resolvePath(mp4Path);
  if (!(await fs.pathExists(resolved))) {
    return {
      exists: false,
      absolute_path: resolved,
      is_current_render: false,
      reason: "mp4_missing_on_disk",
      max_age_hours: args.maxAgeHours,
    };
  }
  const stat = await fs.stat(resolved);
  const ageHours = Math.max(0, (Date.now() - stat.mtimeMs) / 3_600_000);
  const maxAgeHours = Number.isFinite(Number(args.maxAgeHours)) && Number(args.maxAgeHours) > 0
    ? Number(args.maxAgeHours)
    : 36;
  const current = ageHours <= maxAgeHours;
  return {
    exists: true,
    absolute_path: resolved,
    size_bytes: stat.size,
    mtime_iso: stat.mtime.toISOString(),
    age_hours: Math.round(ageHours * 100) / 100,
    max_age_hours: maxAgeHours,
    is_current_render: current,
    reason: current ? "current_render_window_ok" : "stale_or_unverified_mp4",
  };
}

async function extractCoverFrame({ mp4Path, outDir, storyId, timestamp }) {
  const outputPath = path.join(outDir, `${storyId || "fresh"}_cover.jpg`);
  await fs.ensureDir(outDir);
  cp.execFileSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      timestamp || "00:00:06",
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
  return outputPath;
}

async function readTranscript(args) {
  if (args.transcript) return args.transcript;
  if (args.transcriptFile) {
    return fs.readFile(resolvePath(args.transcriptFile), "utf8");
  }
  if (args.timestampsJson) {
    const payload = await fs.readJson(resolvePath(args.timestampsJson));
    if (typeof payload.transcript === "string") return payload.transcript;
    if (typeof payload.text === "string") return payload.text;
    if (Array.isArray(payload.characters)) return payload.characters.join("");
  }
  return "";
}

async function buildVoiceNarration(args) {
  if (!args.approvedAudio) return null;
  const transcript = await readTranscript(args);
  const medianPitchHz = Number(args.medianPitchHz);
  return {
    provider: "local",
    source: "local-production-voxcpm",
    audioPath: resolvePath(args.approvedAudio),
    approvedLocalVoice: true,
    acceptedLocalVoice: resolveAcceptedLocalVoiceReference(process.env),
    acoustic: Number.isFinite(medianPitchHz) ? { medianPitchHz } : {},
    transcript,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolvePath(args.outDir || OUT);
  await fs.ensureDir(outDir);

  if (!args.mp4) {
    throw new Error("Fresh TikTok dispatch requires --mp4. Refusing to auto-select a live render.");
  }

  const mp4Path = resolvePath(args.mp4);
  const storyId = args.story || path.basename(mp4Path, path.extname(mp4Path));
  let coverPath = resolvePath(args.cover);
  if (!coverPath && args.extractCover) {
    coverPath = await extractCoverFrame({
      mp4Path,
      outDir,
      storyId,
      timestamp: args.coverTimestamp,
    });
  }

  let tiktokTokenStatus = null;
  try {
    const { inspectTokenStatus } = require("../upload_tiktok");
    tiktokTokenStatus = await inspectTokenStatus();
  } catch (err) {
    tiktokTokenStatus = {
      ok: false,
      reason: `token_status_failed:${err.message}`,
      refresh_available: false,
      needs_reauth: true,
    };
  }

  const mediaInfo = await inspectMp4(mp4Path, args);
  const durationSeconds = Number.isFinite(Number(args.duration))
    ? Number(args.duration)
    : probeDurationSeconds(mp4Path);
  const voiceNarration = await buildVoiceNarration(args);
  const result = buildFreshTikTokDispatchPack({
    story: {
      id: storyId,
      title: args.title || storyId,
      flair: "manual_local_dispatch",
    },
    mp4Path,
    coverPath,
    durationSeconds,
    voiceNarration,
    mediaInfo,
    tiktokTokenStatus,
    requireExistingAudio: true,
  });

  const jsonPath = path.join(outDir, "tiktok_fresh_dispatch_pack.json");
  const mdPath = path.join(outDir, "tiktok_fresh_dispatch_pack.md");
  const inboxPath = path.join(outDir, "tiktok_fresh_inbox_plan.json");
  const captionPath = path.join(outDir, "tiktok_fresh_caption.txt");
  await fs.writeJson(jsonPath, result, { spaces: 2 });
  await fs.writeFile(mdPath, renderFreshTikTokDispatchMarkdown(result), "utf8");
  await fs.writeJson(inboxPath, result.inboxPlan, { spaces: 2 });
  await fs.writeFile(
    captionPath,
    `${result.dispatchPack.caption}\n${result.dispatchPack.hashtags.join(" ")}\n`,
    "utf8",
  );

  console.log(
    `[tiktok-fresh] status=${result.dispatchPack.status} inbox=${result.inboxPlan.status} dry_run=${result.inboxPlan.dry_run}`,
  );
  console.log(`[tiktok-fresh] json=${relativeForConsole(jsonPath)}`);
  console.log(`[tiktok-fresh] md=${relativeForConsole(mdPath)}`);
  console.log(`[tiktok-fresh] inbox=${relativeForConsole(inboxPath)}`);
  console.log(`[tiktok-fresh] caption=${relativeForConsole(captionPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tiktok-fresh] ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildVoiceNarration,
  extractCoverFrame,
  inspectMp4,
  main,
  parseArgs,
  probeDurationSeconds,
  readTranscript,
};
