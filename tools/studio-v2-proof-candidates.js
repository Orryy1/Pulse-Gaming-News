#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildStudioV2ProofCandidateReport,
  renderLocalRepairPromotionPacketMarkdown,
  renderStudioV2ProofCandidatesMarkdown,
} = require("../lib/ops/studio-v2-proof-candidates");
const {
  discoverLocalAudioProofReport,
} = require("../lib/ops/studio-v2-proof-audio-discovery");
const {
  loadLocalTtsProofReports,
} = require("../lib/studio/local-tts-proof-report-loader");
const { ffprobeDuration } = require("../lib/studio/media-acquisition");
const { normaliseText } = require("../lib/text-hygiene");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

const DEFAULT_AUDIO_REPORTS = [
  "test/output/local_media_repair_audio_apply.json",
  "test/output/local_script_extension_audio_apply.json",
];
const DEFAULT_STORY_CONTEXT_REPORTS = [
  "test/output/local_script_extension_plan.json",
  "test/output/local_media_repair_queue.json",
  "test/output/creator_studio_control_room.json",
];
const DEFAULT_ASSET_REPORTS = [
  "test/output/asset_acquisition_v16_gameplay_stills_apply_local.json",
  "test/output/asset_acquisition_v16_gameplay_stills.json",
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
const DEFAULT_FORENSIC_REPORTS = [
  "test/output/studio-v2-still-deck/qa_forensic_1szzhy9_enriched_report.json",
  "test/output/studio-v2-still-deck/qa_forensic_rss_5b3abe925b27a199_enriched_report.json",
  "test/output/qa_forensic_1szzhy9_enriched_report.json",
  "test/output/qa_forensic_rss_5b3abe925b27a199_enriched_report.json",
];

function parseArgs(argv) {
  const args = {
    fixture: false,
    noDb: false,
    storyId: null,
    limit: 20,
    json: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--no-db") args.noDb = true;
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
      "  --no-db         Do not read the local SQLite story DB; use report stubs only",
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

function storyContextFromItem(item = {}) {
  const id = item.story_id || item.storyId || item.id || null;
  if (!id) return null;
  return {
    id,
    title: normaliseText(item.title || item.story_title || item.headline || ""),
    source: item.source || item.publisher || item.source_name || item.subreddit || "",
    url: item.url || item.source_url || item.article_url || "",
    full_script:
      item.proposed_full_script ||
      item.full_script ||
      item.script ||
      item.narration ||
      "",
    hook: item.hook || "",
    body: item.body || "",
    approved: item.approved ?? true,
    auto_approved: item.auto_approved,
    breaking_score: Number(item.breaking_score || item.score || 0) || 0,
    timestamp: item.timestamp || item.created_at || item.updated_at || null,
  };
}

function mergeStoryContexts(base = {}, extra = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "title" && merged.title && merged.title !== merged.id) continue;
    if (key === "breaking_score") {
      merged.breaking_score = Math.max(Number(merged.breaking_score || 0), Number(value || 0));
      continue;
    }
    if (merged[key] === undefined || merged[key] === null || merged[key] === "" || merged[key] === merged.id) {
      merged[key] = value;
    }
  }
  return merged;
}

function storyContextsFromReports(reports) {
  const contexts = new Map();
  const add = (item) => {
    const context = storyContextFromItem(item);
    if (!context?.id) return;
    contexts.set(context.id, mergeStoryContexts(contexts.get(context.id), context));
  };
  for (const report of reports) {
    add(report);
    for (const key of ["plans", "applied", "drafts", "items", "rows", "candidates"]) {
      for (const item of Array.isArray(report?.[key]) ? report[key] : []) add(item);
    }
  }
  return contexts;
}

async function loadDbStories(args) {
  if (args.noDb) return [];
  if (args.fixture) return fixtureStories();
  try {
    const db = require("../lib/db");
    const rows = (await db.getStories()).map(normaliseStory);
    if (args.storyId) return rows.filter((story) => story.id === args.storyId);
    const approved = rows
      .filter((story) => story.approved || story.auto_approved)
      .sort((a, b) => storyTime(b) - storyTime(a));
    return approved;
  } catch (err) {
    process.stderr.write(`[proof-candidates] local DB read failed: ${err.message}\n`);
    return [];
  }
}

function mergeReportStoryStubs(stories, reports, args) {
  const byId = new Map(stories.filter(Boolean).map((story) => [story.id, story]));
  const reportContexts = storyContextsFromReports(reports);
  for (const [id, context] of reportContexts.entries()) {
    if (args.storyId && id !== args.storyId) continue;
    const existing = byId.get(id);
    if (existing) {
      byId.set(id, mergeStoryContexts(existing, context));
      continue;
    }
    byId.set(id, mergeStoryContexts({
      id,
      title: id,
      approved: true,
      breaking_score: 0,
      full_script: "",
    }, context));
  }
  return [...byId.values()];
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const discoveredLocalAudioReport = await discoverLocalAudioProofReport({
    mediaRoot: process.env.MEDIA_ROOT || null,
    repoRoot: ROOT,
    durationProbe: ffprobeDuration,
  });
  const proofHistoryReports = (await loadLocalTtsProofReports({ outDir: OUT })).map(
    (entry) => entry.report,
  );
  const localAudioReports = [
    ...(await readReports(DEFAULT_AUDIO_REPORTS)),
    ...proofHistoryReports,
    discoveredLocalAudioReport,
  ];
  const assetReports = await readReports(DEFAULT_ASSET_REPORTS);
  const frameReports = await readReports(DEFAULT_FRAME_REPORTS);
  const segmentValidationReports = await readReports(DEFAULT_SEGMENT_VALIDATION_REPORTS);
  const stillDeckReports = await readReports(DEFAULT_STILL_DECK_REPORTS);
  const latestForensicReports = await readReports(DEFAULT_FORENSIC_REPORTS);
  const storyContextReports = await readReports(DEFAULT_STORY_CONTEXT_REPORTS);
  const stories = mergeReportStoryStubs(
    await loadDbStories(args),
    [
      ...storyContextReports,
      ...localAudioReports,
      ...assetReports,
      ...frameReports,
      ...segmentValidationReports,
      ...stillDeckReports,
      ...latestForensicReports,
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
    latestForensicReports,
    limit: args.limit,
  });
  const md = renderStudioV2ProofCandidatesMarkdown(report);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "studio_v2_proof_candidates.json");
  const mdPath = path.join(OUT, "studio_v2_proof_candidates.md");
  const packetJsonPath = path.join(OUT, "studio_v2_local_repair_promotion_packet.json");
  const packetMdPath = path.join(OUT, "studio_v2_local_repair_promotion_packet.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, md, "utf8");
  await fs.writeJson(packetJsonPath, report.local_repair_promotion_packet, { spaces: 2 });
  await fs.writeFile(
    packetMdPath,
    renderLocalRepairPromotionPacketMarkdown(report.local_repair_promotion_packet),
    "utf8",
  );

  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : md);
  process.stderr.write(
    `[proof-candidates] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")}, ${path.relative(ROOT, mdPath).replace(/\\/g, "/")}, ${path.relative(ROOT, packetJsonPath).replace(/\\/g, "/")} and ${path.relative(ROOT, packetMdPath).replace(/\\/g, "/")}\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[proof-candidates] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  mergeReportStoryStubs,
  mergeStoryContexts,
  storyContextFromItem,
  storyContextsFromReports,
};
