#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true });
} catch {}

const { buildDemoStories } = require("../lib/creator-studio-os");
const {
  buildVisualV4MotionPack,
  renderVisualV4MotionPackMarkdown,
} = require("../lib/studio/v4/motion-pack");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_SEGMENT_REPORT = path.join(
  TEST_OUT,
  "official_trailer_segment_validation_apply_local.json",
);
const FALLBACK_SEGMENT_REPORT = path.join(
  TEST_OUT,
  "official_trailer_segment_validation_v1.json",
);
const DEFAULT_TRUSTED_REPORTS = [
  path.join(ROOT, "output", "trusted_footage_registry_report.json"),
  path.join(TEST_OUT, "trusted_footage_registry_report.json"),
];
const DEFAULT_OUT_DIR = path.join(ROOT, "output", "studio-v4", "motion-packs");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    stories: null,
    segmentReport: DEFAULT_SEGMENT_REPORT,
    trustedFootageReport: null,
    previousMotionPack: null,
    preserveExisting: true,
    outDir: DEFAULT_OUT_DIR,
    maxClips: 12,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--stories") args.stories = argv[++i] || null;
    else if (arg === "--segment-report" || arg === "--segment-validation-report") {
      args.segmentReport = argv[++i] || DEFAULT_SEGMENT_REPORT;
    } else if (arg === "--trusted-footage-report") {
      args.trustedFootageReport = argv[++i] || null;
    } else if (arg === "--previous-motion-pack") {
      args.previousMotionPack = argv[++i] || null;
    } else if (arg === "--no-preserve-existing") {
      args.preserveExisting = false;
    } else if (arg === "--out-dir") {
      args.outDir = argv[++i] || DEFAULT_OUT_DIR;
    } else if (arg === "--max-clips") {
      args.maxClips = Math.max(1, Number(argv[++i]) || 12);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v4-motion-pack.js [options]",
      "",
      "Options:",
      "  --story-id <id>                 Build one story pack",
      "  --stories <path>                Read stories from a local JSON file",
      "  --segment-report <path>         Read official trailer segment validation report",
      "  --trusted-footage-report <path> Read trusted footage registry report",
      "  --previous-motion-pack <path>   Preserve validated clips from an existing pack",
      "  --no-preserve-existing          Do not read the existing output pack before overwriting it",
      "  --out-dir <path>                Output directory, default output/studio-v4/motion-packs",
      "  --max-clips <n>                 Cap accepted clips per story",
      "  --json                          Print JSON index instead of Markdown",
      "",
      "This command only writes local manifests. It does not download videos, mutate the DB, change OAuth, restart services or post.",
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

function readCanonicalManifestForRow(row) {
  const artifactDir = row?.artifact_dir || row?.artifactDir;
  if (!artifactDir) return {};
  const manifestPath = path.join(path.resolve(ROOT, artifactDir), "canonical_story_manifest.json");
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return fs.readJsonSync(manifestPath);
  } catch {
    return {};
  }
}

function normaliseStory(row) {
  if (!row || typeof row !== "object") return row;
  const hydrated = {
    ...readCanonicalManifestForRow(row),
    ...row,
  };
  return {
    ...hydrated,
    id: hydrated.id || hydrated.story_id,
    title: hydrated.title || hydrated.selected_title || hydrated.canonical_title,
    full_script: hydrated.full_script || hydrated.narration_script,
    game_title: hydrated.game_title || hydrated.canonical_game || hydrated.canonical_subject,
    primary_entity: hydrated.primary_entity || hydrated.canonical_subject || hydrated.canonical_game,
    downloaded_images: Array.isArray(hydrated.downloaded_images)
      ? hydrated.downloaded_images
      : parseJsonField(hydrated.downloaded_images) || [],
    game_images: Array.isArray(hydrated.game_images)
      ? hydrated.game_images
      : parseJsonField(hydrated.game_images) || [],
    media_candidates: Array.isArray(hydrated.media_candidates)
      ? hydrated.media_candidates
      : parseJsonField(hydrated.media_candidates) || [],
    video_clips: Array.isArray(hydrated.video_clips)
      ? hydrated.video_clips
      : parseJsonField(hydrated.video_clips) || [],
  };
}

async function loadStories(args) {
  if (args.stories) {
    const payload = await fs.readJson(path.resolve(ROOT, args.stories));
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.stories)
        ? payload.stories
        : Array.isArray(payload.items)
          ? payload.items
          : [payload];
    return rows.map(normaliseStory).filter((story) => !args.storyId || story.id === args.storyId);
  }

  try {
    const db = require("../lib/db");
    const rows = (await db.getStories()).map(normaliseStory);
    return rows.filter((story) => !args.storyId || story.id === args.storyId);
  } catch {
    const stories = buildDemoStories().map(normaliseStory);
    return stories.filter((story) => !args.storyId || story.id === args.storyId);
  }
}

async function readJsonIfExists(filePath, fallback = {}) {
  if (!filePath) return fallback;
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

async function loadSegmentReport(args) {
  const primary = path.resolve(ROOT, args.segmentReport || DEFAULT_SEGMENT_REPORT);
  if (await fs.pathExists(primary)) return fs.readJson(primary);
  if (await fs.pathExists(FALLBACK_SEGMENT_REPORT)) return fs.readJson(FALLBACK_SEGMENT_REPORT);
  return {};
}

async function loadTrustedFootageReport(args) {
  if (args.trustedFootageReport) {
    return readJsonIfExists(args.trustedFootageReport, {});
  }
  for (const filePath of DEFAULT_TRUSTED_REPORTS) {
    if (await fs.pathExists(filePath)) return fs.readJson(filePath);
  }
  return {};
}

function safeName(value) {
  return (
    String(value || "story")
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "story"
  );
}

async function loadPreviousMotionPack(args, story, outDir) {
  if (args.preserveExisting === false) return {};
  if (args.previousMotionPack) {
    return readJsonIfExists(args.previousMotionPack, {});
  }
  const base = safeName(story.id || story.story_id);
  return readJsonIfExists(path.join(outDir, `${base}_motion_pack_manifest.json`), {});
}

function renderIndexMarkdown(index) {
  const lines = [];
  lines.push("# Visual V4 Motion Pack Index");
  lines.push("");
  lines.push(`Generated: ${index.generated_at}`);
  lines.push(`Stories: ${index.summary.stories}`);
  lines.push(`Ready: ${index.summary.ready}`);
  lines.push(`Blocked: ${index.summary.blocked}`);
  lines.push("");
  lines.push("| story | status | clips | rejected | manifest |");
  lines.push("| --- | --- | ---: | ---: | --- |");
  for (const item of index.packs) {
    lines.push(
      `| ${item.story_id || "unknown"} | ${item.readiness_status || "unknown"} | ${item.clip_count} | ${item.rejected_count} | ${item.manifest_path} |`,
    );
  }
  if (!index.packs.length) lines.push("| none | none | 0 | 0 | none |");
  lines.push("");
  lines.push("Safety: local manifests only; no downloads, DB mutation, OAuth or posting.");
  return lines.join("\n") + "\n";
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const stories = await loadStories(args);
  const segmentValidationReport = await loadSegmentReport(args);
  const trustedFootageReport = await loadTrustedFootageReport(args);
  const outDir = path.resolve(ROOT, args.outDir || DEFAULT_OUT_DIR);
  await fs.ensureDir(outDir);

  const packs = [];
  for (const story of stories) {
    const previousMotionPack = await loadPreviousMotionPack(args, story, outDir);
    const pack = buildVisualV4MotionPack({
      story,
      trustedFootageReport,
      segmentValidationReport,
      previousMotionPack,
      maxClips: args.maxClips,
    });
    const base = safeName(story.id || pack.story_id);
    const jsonPath = path.join(outDir, `${base}_motion_pack_manifest.json`);
    const mdPath = path.join(outDir, `${base}_motion_pack_manifest.md`);
    await fs.writeJson(jsonPath, pack, { spaces: 2 });
    await fs.writeFile(mdPath, renderVisualV4MotionPackMarkdown(pack), "utf8");
    packs.push({
      story_id: pack.story_id,
      title: pack.title,
      readiness_status: pack.readiness?.status || "unknown",
      blockers: pack.readiness?.blockers || [],
      clip_count: pack.clips.length,
      rejected_count: pack.rejected_candidates.length,
      manifest_path: path.relative(ROOT, jsonPath).replace(/\\/g, "/"),
      markdown_path: path.relative(ROOT, mdPath).replace(/\\/g, "/"),
    });
  }

  const index = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "visual_v4_motion_pack_index",
    local_only: true,
    summary: {
      stories: packs.length,
      ready: packs.filter((pack) => pack.readiness_status === "v4_motion_ready").length,
      blocked: packs.filter((pack) => pack.readiness_status !== "v4_motion_ready").length,
      clips: packs.reduce((sum, pack) => sum + pack.clip_count, 0),
      rejected_candidates: packs.reduce((sum, pack) => sum + pack.rejected_count, 0),
    },
    packs,
    safety: {
      local_only: true,
      video_downloads_started: false,
      retained_video_files: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
    },
  };
  await fs.writeJson(path.join(outDir, "visual_v4_motion_packs.json"), index, { spaces: 2 });
  await fs.writeFile(path.join(outDir, "visual_v4_motion_packs.md"), renderIndexMarkdown(index), "utf8");

  process.stdout.write(args.json ? JSON.stringify(index, null, 2) + "\n" : renderIndexMarkdown(index));
  process.stderr.write(
    `[studio-v4-motion-pack] wrote ${path.relative(ROOT, outDir).replace(/\\/g, "/")}/visual_v4_motion_packs.{json,md}\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[studio-v4-motion-pack] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  normaliseStory,
  parseArgs,
};
