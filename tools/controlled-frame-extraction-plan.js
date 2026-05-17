#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true });
} catch {}

const { buildDemoStories } = require("../lib/creator-studio-os");
const { buildMotionAcquisitionReport } = require("../lib/motion-acquisition-pro");
const {
  buildControlledFrameExtractionReport,
  renderControlledFrameExtractionMarkdown,
} = require("../lib/controlled-frame-extraction-plan");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_MOTION_REPORT = path.join(OUT, "motion_acquisition_v1.json");
const DEFAULT_TRAILER_REFERENCE_REPORT = path.join(OUT, "official_trailer_references_v1.json");

function parseArgs(argv) {
  const args = {
    fixture: false,
    json: false,
    help: false,
    storyId: null,
    allApproved: false,
    limit: 5,
    motionReport: null,
    trailerReferences: null,
    noTrailerReferences: false,
    maxReferences: 4,
    maxReferencesPerEntity: 1,
    maxTargetFrames: 12,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--all-approved") args.allApproved = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 5);
    else if (arg === "--motion-report") args.motionReport = argv[++i] || null;
    else if (arg === "--trailer-references") args.trailerReferences = argv[++i] || null;
    else if (arg === "--no-trailer-references") args.noTrailerReferences = true;
    else if (arg === "--max-references") {
      args.maxReferences = Math.max(1, Number(argv[++i]) || args.maxReferences);
    } else if (arg === "--max-references-per-entity") {
      args.maxReferencesPerEntity = Math.max(1, Number(argv[++i]) || args.maxReferencesPerEntity);
    } else if (arg === "--max-target-frames") {
      args.maxTargetFrames = Math.max(1, Number(argv[++i]) || args.maxTargetFrames);
    }
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/controlled-frame-extraction-plan.js [options]",
      "",
      "Options:",
      "  --fixture             Use built-in demo stories",
      "  --story-id <id>       Build a frame plan for one story id",
      "  --all-approved        Include approved / auto-approved stories",
      "  --limit <n>           Limit local DB stories when not using --all-approved",
      "  --motion-report <p>   Read an existing Motion Acquisition report",
      "  --trailer-references <p>",
      "                        Read official trailer references when building motion plans",
      "  --no-trailer-references",
      "                        Ignore official trailer reference report",
      "  --max-references <n>  Maximum official trailer references per story",
      "  --max-references-per-entity <n>",
      "                        Allow controlled alternate official references per game/entity",
      "  --max-target-frames <n>",
      "                        Maximum target frames to plan per story",
      "  --json                Print JSON instead of Markdown",
      "",
      "This command is report-only: it plans target frames but never downloads videos, extracts frames, slices clips, publishes or mutates data.",
    ].join("\n") + "\n",
  );
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
  if (args.fixture) return { stories: buildDemoStories(), mode: "fixture" };

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
    if (selected.length > 0) return { stories: selected, mode: args.storyId ? "story_id" : "local_db" };
  } catch (err) {
    process.stderr.write(`[frame-plan] local DB read failed, using fixture: ${err.message}\n`);
  }

  return { stories: buildDemoStories(), mode: "fixture_fallback" };
}

async function readJsonIfExists(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath);
}

async function loadTrailerReferenceReport(args) {
  if (args.noTrailerReferences) return null;
  const filePath = args.trailerReferences
    ? path.resolve(ROOT, args.trailerReferences)
    : DEFAULT_TRAILER_REFERENCE_REPORT;
  return readJsonIfExists(filePath);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function motionPlanReferenceCount(plan) {
  return asArray(plan?.existing_references).length;
}

function trailerReferenceCountForStory(report, storyId) {
  if (!storyId) return 0;
  const plan = asArray(report?.plans).find((item) => item?.story_id === storyId);
  return asArray(plan?.references).length;
}

function shouldRebuildMotionPlansFromReferences({
  storyId,
  explicitMotionPath,
  plans,
  trailerReferenceReport,
} = {}) {
  if (explicitMotionPath || !storyId || !trailerReferenceReport) return false;
  return asArray(plans).some(
    (plan) =>
      plan?.story_id === storyId &&
      motionPlanReferenceCount(plan) === 0 &&
      trailerReferenceCountForStory(trailerReferenceReport, storyId) > 0,
  );
}

async function loadMotionPlans(args) {
  const explicitMotionPath = args.motionReport ? path.resolve(ROOT, args.motionReport) : null;
  const trailerReferenceReport = await loadTrailerReferenceReport(args);
  const defaultReport = !args.fixture ? await readJsonIfExists(explicitMotionPath || DEFAULT_MOTION_REPORT) : null;
  if (defaultReport && Array.isArray(defaultReport.plans)) {
    const plans = args.storyId
      ? defaultReport.plans.filter((plan) => plan.story_id === args.storyId)
      : defaultReport.plans;
    if (
      (plans.length > 0 || explicitMotionPath) &&
      !shouldRebuildMotionPlansFromReferences({
        storyId: args.storyId,
        explicitMotionPath,
        plans,
        trailerReferenceReport,
      })
    ) {
      return {
        plans,
        mode: "motion_report",
        motionReportSource: explicitMotionPath || DEFAULT_MOTION_REPORT,
      };
    }
  }

  const { stories, mode } = await loadStories(args);
  const motionReport = buildMotionAcquisitionReport(stories, {
    mode,
    officialTrailerReferenceReport: trailerReferenceReport,
  });
  return { plans: motionReport.plans, mode, motionReportSource: null };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const motion = await loadMotionPlans(args);
  const report = buildControlledFrameExtractionReport(motion.plans, {
    maxReferences: args.maxReferences,
    maxReferencesPerEntity: args.maxReferencesPerEntity,
    maxTargetFrames: args.maxTargetFrames,
  });
  report.story_mode = motion.mode;
  report.motion_report_source = motion.motionReportSource;
  const markdown = renderControlledFrameExtractionMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "controlled_frame_extraction_v1.json"), report, { spaces: 2 });
  await fs.writeFile(path.join(OUT, "controlled_frame_extraction_v1.md"), markdown, "utf8");

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write("[frame-plan] wrote test/output/controlled_frame_extraction_v1.{json,md}\n");
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[frame-plan] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  loadMotionPlans,
  parseArgs,
  shouldRebuildMotionPlansFromReferences,
};
