#!/usr/bin/env node
"use strict";

/*
 * Visual V3 proof renderer.
 *
 * Render-only: reads one existing MP4 and burns the Visual V3 overlay
 * plan onto it under test/output/visual-v3. No DB rows, tokens, OAuth
 * settings or platform posts are mutated.
 */

const path = require("node:path");
const { execFileSync, execSync } = require("node:child_process");
const fs = require("fs-extra");

require("dotenv").config();

const mediaPaths = require("../lib/media-paths");
const { resolveStudioDbPath } = require("../lib/studio/v2/studio-db-path");
const {
  characterAlignmentToSubtitleWords,
} = require("../lib/subtitle-timing");
const {
  buildVisualV3OverlayFilter,
  buildVisualV3OverlayPlan,
} = require("../lib/studio/v2/visual-v3-overlays");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "test", "output", "visual-v3");
const FONT_OPT =
  process.platform === "win32"
    ? "fontfile='C\\:/Windows/Fonts/arial.ttf'"
    : "font='DejaVu Sans'";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyId: null,
    input: null,
    output: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--input") args.input = argv[++i] || null;
    else if (arg === "--output") args.output = argv[++i] || null;
    else if (!args.storyId) args.storyId = arg;
  }
  args.storyId = args.storyId || "1te1oq7";
  return args;
}

function ffPath(filePath) {
  return String(filePath).replace(/\\/g, "/");
}

function ffprobeDurationS(filePath) {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8" },
    ).trim();
    const value = Number(out);
    return Number.isFinite(value) && value > 0 ? value : 60;
  } catch {
    return 60;
  }
}

function loadStory(storyId) {
  const Database = require("better-sqlite3");
  const db = new Database(resolveStudioDbPath({ root: ROOT }), {
    readonly: true,
  });
  const row = db
    .prepare(
      `SELECT id, title, hook, body, full_script, tts_script, classification,
              flair, subreddit, source_type, top_comment, audio_path,
              exported_path, article_image
       FROM stories WHERE id = ?`,
    )
    .get(storyId);
  db.close();
  if (!row) throw new Error(`story not found: ${storyId}`);
  return row;
}

async function resolveInputPath(story, explicitInput) {
  const input = explicitInput || story.exported_path;
  if (!input) throw new Error(`story ${story.id} has no exported_path; pass --input`);
  const resolved = await mediaPaths.resolveExisting(input);
  if (!resolved || !(await fs.pathExists(resolved))) {
    throw new Error(`input MP4 not found: ${input}`);
  }
  return resolved;
}

async function loadWords(story) {
  const audioPath = story.audio_path || `output/audio/${story.id}.mp3`;
  const timestampPath = audioPath.replace(/\.mp3$/i, "_timestamps.json");
  const resolved = await mediaPaths.resolveExisting(timestampPath);
  if (resolved && (await fs.pathExists(resolved))) {
    const alignment = await fs.readJson(resolved);
    return characterAlignmentToSubtitleWords(alignment).map((word) => ({
      word: word.text,
      start: word.start,
      end: word.end,
    }));
  }

  const script = story.tts_script || story.full_script || story.body || story.title || "";
  return script
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({
      word,
      start: index * 0.42,
      end: index * 0.42 + 0.34,
    }));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Visual V3 Proof");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Story: ${report.storyId}`);
  lines.push(`Input: ${report.input}`);
  lines.push(`Output: ${report.output}`);
  lines.push(`Verdict: ${report.plan.verdict}`);
  lines.push(`Blockers: ${report.plan.blockers.join(", ") || "clear"}`);
  lines.push("");
  lines.push("## Overlay Events");
  lines.push("");
  for (const event of report.plan.events) {
    lines.push(
      `- ${event.atS}s ${event.kind}: ${event.metric || event.entity || event.label || event.source || event.id}`,
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Render-only proof.");
  lines.push("- No DB rows, tokens, OAuth settings or platform posts are mutated.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs();
  const story = loadStory(args.storyId);
  const inputPath = await resolveInputPath(story, args.input);
  const durationS = ffprobeDurationS(inputPath);
  const words = await loadWords(story);
  const plan = buildVisualV3OverlayPlan({
    story,
    words,
    durationS,
  });

  const filter = buildVisualV3OverlayFilter({
    inputLabel: "0:v",
    outputLabel: "outv",
    plan,
    fontOpt: FONT_OPT,
  });
  if (!filter) throw new Error("visual_v3_no_overlay_filter");

  await fs.ensureDir(OUT_DIR);
  const filterPath = path.join(OUT_DIR, `${story.id}_visual_v3_filter.txt`);
  const outputPath = path.resolve(
    args.output || path.join(OUT_DIR, `visual_v3_${story.id}.mp4`),
  );
  await fs.writeFile(filterPath, filter, "utf8");

  const cmd = [
    "ffmpeg -y -hide_banner -loglevel warning",
    `-i "${ffPath(inputPath)}"`,
    `-filter_complex_script "${ffPath(filterPath)}"`,
    `-map "[outv]" -map 0:a?`,
    "-c:v libx264 -crf 19 -preset medium",
    "-pix_fmt yuv420p -profile:v high -level:v 4.0",
    "-c:a aac -b:a 192k",
    "-movflags +faststart",
    `"${ffPath(outputPath)}"`,
  ].join(" ");

  execSync(cmd, {
    cwd: ROOT,
    stdio: "inherit",
    maxBuffer: 80 * 1024 * 1024,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    storyId: story.id,
    input: inputPath,
    output: outputPath,
    filterPath,
    durationS,
    plan,
    safety:
      "Render-only. No DB rows, tokens, OAuth settings or platform posts are mutated.",
  };
  const reportJson = path.join(OUT_DIR, `${story.id}_visual_v3_report.json`);
  const reportMd = path.join(OUT_DIR, `${story.id}_visual_v3_report.md`);
  await fs.writeJson(reportJson, report, { spaces: 2 });
  await fs.writeFile(reportMd, renderMarkdown(report), "utf8");

  console.log(`[visual-v3] output=${path.relative(ROOT, outputPath)}`);
  console.log(`[visual-v3] report=${path.relative(ROOT, reportMd)}`);
  console.log(`[visual-v3] events=${plan.eventCount} verdict=${plan.verdict}`);
}

main().catch((err) => {
  console.error(`[visual-v3] ${err.stack || err.message}`);
  process.exit(1);
});
