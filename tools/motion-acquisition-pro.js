#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true });
} catch {}

const { buildDemoStories } = require("../lib/creator-studio-os");
const {
  buildMotionAcquisitionReport,
  renderMotionAcquisitionMarkdown,
} = require("../lib/motion-acquisition-pro");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_TRAILER_REFERENCE_REPORT = path.join(OUT, "official_trailer_references_v1.json");

function parseArgs(argv) {
  const args = {
    fixture: false,
    json: false,
    help: false,
    storyId: null,
    allApproved: false,
    limit: 5,
    trailerReferences: null,
    noTrailerReferences: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--all-approved") args.allApproved = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 5);
    else if (arg === "--trailer-references") args.trailerReferences = argv[++i] || null;
    else if (arg === "--no-trailer-references") args.noTrailerReferences = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/motion-acquisition-pro.js [options]",
      "",
      "Options:",
      "  --fixture             Use built-in demo stories",
      "  --story-id <id>       Build a motion plan for one story id",
      "  --all-approved        Include approved / auto-approved stories",
      "  --limit <n>           Limit local DB stories when not using --all-approved",
      "  --trailer-references <p>",
      "                        Read official trailer references from a resolver report",
      "  --no-trailer-references",
      "                        Ignore test/output/official_trailer_references_v1.json",
      "  --json                Print JSON instead of Markdown",
      "",
      "This command is report-only: it does not download videos, extract frames, slice clips, publish or mutate data.",
    ].join("\n") + "\n",
  );
}

async function loadTrailerReferenceReport(args) {
  if (args.noTrailerReferences) return { report: null, source: null };
  const filePath = args.trailerReferences
    ? path.resolve(ROOT, args.trailerReferences)
    : DEFAULT_TRAILER_REFERENCE_REPORT;
  if (!(await fs.pathExists(filePath))) return { report: null, source: null };
  return { report: await fs.readJson(filePath), source: filePath };
}

function parseJsonField(value) {
  if (!value || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normaliseStory(row) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    downloaded_images: Array.isArray(row.downloaded_images)
      ? row.downloaded_images
      : parseJsonField(row.downloaded_images) || [],
    video_clips: Array.isArray(row.video_clips)
      ? row.video_clips
      : parseJsonField(row.video_clips) || [],
    game_images: Array.isArray(row.game_images)
      ? row.game_images
      : parseJsonField(row.game_images) || [],
    trailer_references: Array.isArray(row.trailer_references)
      ? row.trailer_references
      : parseJsonField(row.trailer_references) || [],
  };
}

function storyTime(story) {
  return Date.parse(story?.timestamp || story?.created_at || story?.updated_at || 0) || 0;
}

async function loadStories(args) {
  if (args.fixture) {
    return { stories: buildDemoStories(), mode: "fixture" };
  }

  try {
    const db = require("../lib/db");
    const rows = (await db.getStories()).map(normaliseStory);
    let selected = rows;
    if (args.storyId) {
      selected = rows.filter((story) => story.id === args.storyId);
    } else if (args.allApproved) {
      selected = rows.filter((story) => story.approved || story.auto_approved);
    } else {
      selected = rows
        .filter((story) => story.approved || story.auto_approved)
        .sort((a, b) => storyTime(b) - storyTime(a))
        .slice(0, args.limit);
      if (selected.length === 0) {
        selected = rows.sort((a, b) => storyTime(b) - storyTime(a)).slice(0, args.limit);
      }
    }
    if (selected.length > 0) {
      return { stories: selected, mode: args.storyId ? "story_id" : "local_db" };
    }
  } catch (err) {
    process.stderr.write(`[motion-acquisition] local DB read failed, using fixture: ${err.message}\n`);
  }

  return { stories: buildDemoStories(), mode: "fixture_fallback" };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const { stories, mode } = await loadStories(args);
  const trailerReferences = await loadTrailerReferenceReport(args);
  const report = buildMotionAcquisitionReport(stories, {
    mode,
    officialTrailerReferenceReport: trailerReferences.report,
  });
  report.story_mode = mode;
  report.official_trailer_reference_source = trailerReferences.source;
  const markdown = renderMotionAcquisitionMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "motion_acquisition_v1.json"), report, { spaces: 2 });
  await fs.writeFile(path.join(OUT, "motion_acquisition_v1.md"), markdown, "utf8");

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write("[motion-acquisition] wrote test/output/motion_acquisition_v1.{json,md}\n");
}

main().catch((err) => {
  process.stderr.write(`[motion-acquisition] ${err.stack || err.message}\n`);
  process.exit(1);
});
