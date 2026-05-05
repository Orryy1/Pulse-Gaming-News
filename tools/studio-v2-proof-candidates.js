#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true });
} catch {}

const {
  buildStudioV2ProofCandidateReport,
  renderStudioV2ProofCandidatesMarkdown,
} = require("../lib/ops/studio-v2-proof-candidates");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

const DEFAULT_AUDIO_REPORTS = [
  "test/output/local_media_repair_audio_apply.json",
  "test/output/local_script_extension_audio_apply.json",
];
const DEFAULT_ASSET_REPORTS = [
  "test/output/asset_acquisition_v15_multi_entity_apply_local.json",
  "test/output/asset_acquisition_v14_verified_store_apply_local.json",
  "test/output/asset_acquisition_v11_apply_local.json",
  "test/output/asset_acquisition_pro.json",
];
const DEFAULT_FRAME_REPORTS = [
  "test/output/controlled_frame_extraction_worker_apply_local.json",
];
const DEFAULT_SEGMENT_VALIDATION_REPORTS = [
  "test/output/official_trailer_segment_validation_apply_local.json",
];
const DEFAULT_STILL_DECK_REPORTS = [
  "test/output/studio-v2-still-deck/studio_v2_still_deck_report.json",
];

function parseArgs(argv) {
  const args = {
    fixture: false,
    storyId: null,
    limit: 20,
    json: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 20);
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v2-proof-candidates.js [options]",
      "",
      "Options:",
      "  --fixture       Use a built-in fixture",
      "  --story <id>    Focus one story id",
      "  --limit <n>     Limit output candidates",
      "  --json          Print JSON instead of Markdown",
      "",
      "Read-only/report-only. Does not render, call TTS, post, mutate the DB or touch Railway.",
    ].join("\n") + "\n",
  );
}

async function readJsonIfExists(relPath) {
  const fullPath = path.resolve(ROOT, relPath);
  if (!(await fs.pathExists(fullPath))) return null;
  try {
    return await fs.readJson(fullPath);
  } catch (err) {
    process.stderr.write(`[proof-candidates] skipped unreadable ${relPath}: ${err.message}\n`);
    return null;
  }
}

async function readReports(paths) {
  const reports = [];
  for (const relPath of paths) {
    const report = await readJsonIfExists(relPath);
    if (report) reports.push(report);
  }
  return reports;
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
    game_images: Array.isArray(row.game_images)
      ? row.game_images
      : parseJsonField(row.game_images) || [],
    video_clips: Array.isArray(row.video_clips)
      ? row.video_clips
      : parseJsonField(row.video_clips) || [],
  };
}

function storyTime(story) {
  return Date.parse(story?.timestamp || story?.created_at || story?.updated_at || 0) || 0;
}

function fixtureStories() {
  return [
    {
      id: "fixture_flash_ready",
      title: "GTA 6 trailer evidence is stacking up",
      approved: true,
      breaking_score: 90,
      full_script: "GTA 6 has a confirmed clue today. ".repeat(32),
    },
  ];
}

function storyIdsFromReports(reports) {
  const ids = new Map();
  for (const report of reports) {
    if (report?.story_id) ids.set(report.story_id, report.title || report.story_id);
    for (const plan of Array.isArray(report?.plans) ? report.plans : []) {
      if (plan?.story_id) ids.set(plan.story_id, plan.title || plan.story_id);
    }
    for (const item of Array.isArray(report?.applied) ? report.applied : []) {
      if (item?.story_id) ids.set(item.story_id, item.title || item.story_id);
    }
  }
  return ids;
}

async function loadDbStories(args) {
  if (args.fixture) return fixtureStories();
  try {
    const db = require("../lib/db");
    const rows = (await db.getStories()).map(normaliseStory);
    if (args.storyId) return rows.filter((story) => story.id === args.storyId);
    const approved = rows
      .filter((story) => story.approved || story.auto_approved)
      .sort((a, b) => storyTime(b) - storyTime(a));
    return approved.slice(0, args.limit);
  } catch (err) {
    process.stderr.write(`[proof-candidates] local DB read failed: ${err.message}\n`);
    return [];
  }
}

function mergeReportStoryStubs(stories, reports, args) {
  const byId = new Map(stories.filter(Boolean).map((story) => [story.id, story]));
  const reportIds = storyIdsFromReports(reports);
  for (const [id, title] of reportIds.entries()) {
    if (args.storyId && id !== args.storyId) continue;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      title,
      approved: true,
      breaking_score: 0,
      full_script: "",
    });
  }
  return [...byId.values()];
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const localAudioReports = await readReports(DEFAULT_AUDIO_REPORTS);
  const assetReports = await readReports(DEFAULT_ASSET_REPORTS);
  const frameReports = await readReports(DEFAULT_FRAME_REPORTS);
  const segmentValidationReports = await readReports(DEFAULT_SEGMENT_VALIDATION_REPORTS);
  const stillDeckReports = await readReports(DEFAULT_STILL_DECK_REPORTS);
  const stories = mergeReportStoryStubs(
    await loadDbStories(args),
    [
      ...localAudioReports,
      ...assetReports,
      ...frameReports,
      ...segmentValidationReports,
      ...stillDeckReports,
    ],
    args,
  );
  const report = buildStudioV2ProofCandidateReport({
    stories,
    localAudioReports,
    assetReports,
    frameReports,
    segmentValidationReports,
    stillDeckReports,
    limit: args.limit,
  });
  const md = renderStudioV2ProofCandidatesMarkdown(report);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "studio_v2_proof_candidates.json");
  const mdPath = path.join(OUT, "studio_v2_proof_candidates.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, md, "utf8");

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : md);
  process.stderr.write(
    `[proof-candidates] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")} and ${path.relative(ROOT, mdPath).replace(/\\/g, "/")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[proof-candidates] ${err.stack || err.message}\n`);
  process.exit(1);
});
