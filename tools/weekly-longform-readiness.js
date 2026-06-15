"use strict";

const fs = require("fs-extra");
const path = require("path");
const { execFile } = require("child_process");
const util = require("util");

const execFileAsync = util.promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_WEEKLY_DIR = path.join(ROOT, "output", "weekly");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    weeklyDir: DEFAULT_WEEKLY_DIR,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--weekly-dir") args.weeklyDir = path.resolve(argv[++i]);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function latestWeeklyVideo(weeklyDir = DEFAULT_WEEKLY_DIR) {
  if (!(await fs.pathExists(weeklyDir))) return null;
  const entries = await fs.readdir(weeklyDir);
  const videos = [];
  for (const entry of entries) {
    if (!/^weekly_roundup_.*\.mp4$/i.test(entry)) continue;
    const fullPath = path.join(weeklyDir, entry);
    const stat = await fs.stat(fullPath);
    videos.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  videos.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return videos[0] || null;
}

async function ffprobeVideo(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size,bit_rate",
    "-show_streams",
    "-of",
    "json",
    videoPath,
  ]);
  const parsed = JSON.parse(stdout || "{}");
  const video = (parsed.streams || []).find((stream) => stream.codec_type === "video") || {};
  return {
    durationSeconds: Number(parsed.format?.duration || video.duration || 0),
    size: Number(parsed.format?.size || 0),
    bitRate: Number(parsed.format?.bit_rate || 0),
    width: Number(video.width || 0) || null,
    height: Number(video.height || 0) || null,
    videoBitrate: Number(video.bit_rate || 0) || null,
    avgFrameRate: video.avg_frame_rate || null,
    nbFrames: Number(video.nb_frames || 0) || null,
  };
}

function extractAssTranscript(assText = "") {
  return String(assText || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Dialogue:"))
    .map((line) => line.split(",,").slice(1).join(",,"))
    .join(" ")
    .replace(/\\N/g, " ")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function readCaptionTranscript(weeklyDir = DEFAULT_WEEKLY_DIR) {
  const candidates = [
    path.join(ROOT, "output", "subs", "weekly_roundup.ass"),
    path.join(weeklyDir, "weekly_roundup.ass"),
  ];
  for (const candidate of candidates) {
    if (!(await fs.pathExists(candidate))) continue;
    return {
      path: candidate,
      transcript: extractAssTranscript(await fs.readFile(candidate, "utf8")),
    };
  }
  return { path: null, transcript: "" };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Weekly Longform Readiness");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push(`Video: ${report.video_path || "none"}`);
  lines.push("");
  lines.push("## Quality");
  lines.push("");
  lines.push(`- Duration: ${Math.round(report.probe.durationSeconds || 0)}s`);
  lines.push(`- Resolution: ${report.probe.width || "?"}x${report.probe.height || "?"}`);
  lines.push(`- Video bitrate: ${report.probe.videoBitrate || "unknown"}`);
  lines.push(`- Word count: ${report.quality_report.word_count}`);
  lines.push(`- Segments: ${report.quality_report.segment_count || 0}`);
  lines.push(`- Chapters: ${report.quality_report.chapter_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  lines.push("");
  if (report.quality_report.blockers.length) {
    for (const blocker of report.quality_report.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No upload");
  lines.push("- No production DB mutation");
  lines.push("- No OAuth or token mutation");
  return lines.join("\n");
}

async function buildWeeklyLongformReadinessReport({ weeklyDir = DEFAULT_WEEKLY_DIR } = {}) {
  const weekly = require("../weekly_compile");
  const video = await latestWeeklyVideo(weeklyDir);
  const caption = await readCaptionTranscript(weeklyDir);
  const probe = video ? await ffprobeVideo(video.path) : {};
  const qualityReport = weekly._private.buildLongformQualityReport({
    kind: "weekly_roundup",
    durationSeconds: probe.durationSeconds || 0,
    scriptText: caption.transcript,
    videoProbe: {
      width: probe.width,
      height: probe.height,
      videoBitrate: probe.videoBitrate,
      bit_rate: probe.videoBitrate,
    },
    segmentCount: weekly._private.minimumLongformSegments
      ? weekly._private.minimumLongformSegments("weekly_roundup")
      : 8,
    chapterTimestamps: [],
    sourcePack: [],
    visualPlan: [],
  });
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    verdict: qualityReport.verdict === "pass" ? "READY_FOR_OPERATOR_REVIEW" : "NOT_READY",
    video_path: video?.path || null,
    caption_path: caption.path,
    probe,
    quality_report: qualityReport,
    next_action:
      qualityReport.verdict === "pass"
        ? "Review the longform manually before enabling longform publish flags."
        : "Rebuild weekly longform with a 10+ minute sourced chapter plan, strong transcript, source pack and visual plan.",
    safety: {
      live_publish_attempted: false,
      db_mutation: false,
      oauth_or_token_mutation: false,
    },
  };
  return report;
}

async function main() {
  const args = parseArgs();
  const report = await buildWeeklyLongformReadinessReport(args);
  await fs.ensureDir(args.weeklyDir);
  const jsonPath = path.join(args.weeklyDir, "weekly_longform_readiness_report.json");
  const mdPath = path.join(args.weeklyDir, "weekly_longform_readiness_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderMarkdown(report));
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...report, paths: { json: jsonPath, md: mdPath } }, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderMarkdown(report)}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[weekly-longform-readiness] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildWeeklyLongformReadinessReport,
  extractAssTranscript,
  latestWeeklyVideo,
  renderMarkdown,
};
