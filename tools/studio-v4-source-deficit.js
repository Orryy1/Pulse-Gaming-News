#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildStudioV4SourceDeficitReport,
  renderStudioV4SourceDeficitMarkdown,
} = require("../lib/studio/v4/source-deficit");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_MOTION_PACK_DIR = path.join(ROOT, "output", "studio-v4", "motion-packs");
const DEFAULT_MOTION_PACK_INDEX = path.join(DEFAULT_MOTION_PACK_DIR, "visual_v4_motion_packs.json");
const DEFAULT_SOURCE_FAMILY_REPORT = path.join(TEST_OUT, "studio_v4_source_family_acquisition.json");
const DEFAULT_DIRECT_MEDIA_REPORT = path.join(TEST_OUT, "official_direct_media_discovery.json");
const DEFAULT_SEGMENT_VALIDATION_REPORT = path.join(
  TEST_OUT,
  "official_trailer_segment_validation_apply_local.json",
);
const DEFAULT_OUTPUT_JSON = path.join(TEST_OUT, "studio_v4_source_deficit.json");
const DEFAULT_OUTPUT_MD = path.join(TEST_OUT, "studio_v4_source_deficit.md");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    motionPackIndex: DEFAULT_MOTION_PACK_INDEX,
    motionPack: null,
    motionPacks: [],
    sourceFamilyReport: DEFAULT_SOURCE_FAMILY_REPORT,
    directMediaReport: DEFAULT_DIRECT_MEDIA_REPORT,
    segmentValidationReport: DEFAULT_SEGMENT_VALIDATION_REPORT,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--motion-pack-index") args.motionPackIndex = argv[++i] || DEFAULT_MOTION_PACK_INDEX;
    else if (arg === "--motion-pack") {
      const value = argv[++i] || null;
      args.motionPack = value;
      if (value) args.motionPacks.push(value);
    } else if (arg === "--source-family-report") {
      args.sourceFamilyReport = argv[++i] || DEFAULT_SOURCE_FAMILY_REPORT;
    } else if (arg === "--direct-media-report") {
      args.directMediaReport = argv[++i] || DEFAULT_DIRECT_MEDIA_REPORT;
    } else if (arg === "--segment-validation-report") {
      args.segmentValidationReport = argv[++i] || DEFAULT_SEGMENT_VALIDATION_REPORT;
    } else if (arg === "--output-json") {
      args.outputJson = argv[++i] || DEFAULT_OUTPUT_JSON;
    } else if (arg === "--output-md") {
      args.outputMd = argv[++i] || DEFAULT_OUTPUT_MD;
    }
  }
  return args;
}

function helpText() {
  return [
    "Usage: node tools/studio-v4-source-deficit.js [options]",
    "",
    "Options:",
    "  --story-id <id>              Limit to one story",
    "  --motion-pack <path>         Read one motion-pack manifest; repeatable",
    "  --motion-pack-index <path>   Read the motion-pack index",
    "  --source-family-report <p>   Read the V4 source-family acquisition report",
    "  --direct-media-report <p>    Read the official direct-media discovery report",
    "  --segment-validation-report <p> Read the latest local segment validation report",
    "  --output-json <path>         Write local JSON report",
    "  --output-md <path>           Write local Markdown report",
    "  --json                       Print JSON instead of Markdown",
    "",
    "This command writes local reports only. It does not fetch media, mutate the DB, touch OAuth or post.",
  ].join("\n") + "\n";
}

function resolveFromRoot(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function rowsFromPayload(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.entries)) return payload.entries;
  return [];
}

function sourceFamilyStoryIdSet(sourceFamilyReport = {}) {
  const ids = rowsFromPayload(sourceFamilyReport)
    .map((row) => cleanText(row.story_id || row.storyId))
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

async function readJsonIfExists(filePath, fallback = {}) {
  const resolved = resolveFromRoot(filePath);
  if (!resolved || !(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

async function loadMotionPacks(args, sourceFamilyReport = {}) {
  const paths = [...args.motionPacks];
  const sourceFamilyStoryIds = args.storyId ? null : sourceFamilyStoryIdSet(sourceFamilyReport);
  if (!paths.length) {
    const index = await readJsonIfExists(args.motionPackIndex, null);
    for (const item of Array.isArray(index?.packs) ? index.packs : []) {
      if (!item.manifest_path) continue;
      if (args.storyId && item.story_id !== args.storyId) continue;
      if (!args.storyId && sourceFamilyStoryIds?.size && !sourceFamilyStoryIds.has(cleanText(item.story_id))) {
        continue;
      }
      paths.push(item.manifest_path);
    }
  }
  if (!paths.length && args.storyId) {
    paths.push(path.join(DEFAULT_MOTION_PACK_DIR, `${args.storyId}_motion_pack_manifest.json`));
  } else if (!paths.length && sourceFamilyStoryIds?.size) {
    for (const storyId of sourceFamilyStoryIds) {
      paths.push(path.join(DEFAULT_MOTION_PACK_DIR, `${storyId}_motion_pack_manifest.json`));
    }
  }
  const packs = [];
  for (const filePath of paths) {
    const pack = await readJsonIfExists(filePath, null);
    if (!pack) continue;
    if (args.storyId && pack.story_id !== args.storyId) continue;
    if (!args.storyId && sourceFamilyStoryIds?.size && !sourceFamilyStoryIds.has(cleanText(pack.story_id))) {
      continue;
    }
    packs.push(pack);
  }
  return packs;
}

async function writeOutputs(args, report, markdown) {
  const outputJson = resolveFromRoot(args.outputJson);
  const outputMd = resolveFromRoot(args.outputMd);
  await fs.ensureDir(path.dirname(outputJson));
  await fs.ensureDir(path.dirname(outputMd));
  await fs.writeJson(outputJson, report, { spaces: 2 });
  await fs.writeFile(outputMd, markdown, "utf8");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText());
    return { help: true };
  }
  const sourceFamilyReport = await readJsonIfExists(args.sourceFamilyReport, {});
  const motionPackReports = await loadMotionPacks(args, sourceFamilyReport);
  const directMediaDiscoveryReport = await readJsonIfExists(args.directMediaReport, {});
  const segmentValidationReport = await readJsonIfExists(args.segmentValidationReport, {});
  const report = buildStudioV4SourceDeficitReport({
    motionPackReports,
    sourceFamilyReport,
    directMediaDiscoveryReport,
    segmentValidationReport,
  });
  const markdown = renderStudioV4SourceDeficitMarkdown(report);
  await writeOutputs(args, report, markdown);
  process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : markdown);
  return { report };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[studio-v4-source-deficit] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  safety: {
    video_downloads_started: false,
    retained_video_files: false,
    oauth_triggered: false,
    social_posting_triggered: false,
  },
};
