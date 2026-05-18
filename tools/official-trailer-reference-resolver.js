#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true, quiet: true });
} catch {}

const { buildDemoStories } = require("../lib/creator-studio-os");
const {
  buildOfficialTrailerReferenceReport,
  renderOfficialTrailerReferenceMarkdown,
} = require("../lib/official-trailer-reference-resolver");
const {
  dedupeAssets,
  loadStillsAssetMapFromFiles,
} = require("../lib/official-trailer-reference-report-loader");
const {
  DEFAULT_REPORT_BASENAME,
  writeOfficialTrailerReferenceReportFiles,
} = require("../lib/official-trailer-reference-report-files");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_STILLS_REPORTS = [
  path.join(OUT, "asset_acquisition_pro.json"),
  path.join(OUT, "asset_acquisition_v16_gameplay_stills_apply_local.json"),
  path.join(OUT, "asset_acquisition_v16_gameplay_stills.json"),
  path.join(OUT, "asset_acquisition_v13_store_verification.json"),
  path.join(OUT, "asset_acquisition_v12_exact_subject.json"),
  path.join(OUT, "asset_acquisition_v15_multi_entity_apply_local.json"),
  path.join(OUT, "asset_acquisition_v15_multi_entity_store.json"),
  path.join(OUT, "asset_acquisition_v15_multi_entity_dry_run.json"),
  path.join(OUT, "asset_acquisition_v14_verified_store_apply_local.json"),
  path.join(OUT, "asset_acquisition_v14_verified_store_dry_run.json"),
  path.join(OUT, "asset_acquisition_v11_apply_local.json"),
  path.join(OUT, "asset_acquisition_v11_dry_run.json"),
];

function parseArgs(argv) {
  const args = {
    fixture: false,
    json: false,
    help: false,
    storyId: null,
    storyJsonPath: null,
    allApproved: false,
    limit: 5,
    offline: false,
    stillsReport: null,
    noStillsReport: false,
    segmentValidationReport: null,
    officialSourceIntakeReport: null,
    trustedFootageRegistryReport: null,
    noExcludeExhaustedSourceFamilies: false,
    exhaustedSourceFamilyThreshold: 8,
    outputDir: OUT,
    outputBasename: DEFAULT_REPORT_BASENAME,
    noLatestReport: false,
    writeLatestReport: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--all-approved") args.allApproved = true;
    else if (arg === "--story-id" || arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--story-json") args.storyJsonPath = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 5);
    else if (arg === "--offline" || arg === "--no-steam-network") args.offline = true;
    else if (arg === "--stills-report") args.stillsReport = argv[++i] || null;
    else if (arg === "--no-stills-report") args.noStillsReport = true;
    else if (arg === "--segment-validation-report") args.segmentValidationReport = argv[++i] || null;
    else if (arg === "--official-source-intake-report") args.officialSourceIntakeReport = argv[++i] || null;
    else if (arg === "--trusted-footage-registry-report") args.trustedFootageRegistryReport = argv[++i] || null;
    else if (arg === "--no-exclude-exhausted-source-families") args.noExcludeExhaustedSourceFamilies = true;
    else if (arg === "--exhausted-source-family-threshold") {
      args.exhaustedSourceFamilyThreshold = Math.max(1, Number(argv[++i]) || 8);
    }
    else if (arg === "--output-dir") args.outputDir = argv[++i] || OUT;
    else if (arg === "--output-basename") args.outputBasename = argv[++i] || DEFAULT_REPORT_BASENAME;
    else if (arg === "--no-latest-report") args.noLatestReport = true;
    else if (arg === "--write-latest-report") args.writeLatestReport = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function shouldWriteLatestReport(args = {}) {
  if (args.noLatestReport) return false;
  if (args.writeLatestReport) return true;
  return !args.storyId;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/official-trailer-reference-resolver.js [options]",
      "",
      "Options:",
      "  --fixture             Use built-in demo stories",
      "  --story-id <id>       Build trailer-reference plan for one story id",
      "  --story-json <p>      Use a local story override JSON",
      "  --all-approved        Include approved / auto-approved stories",
      "  --limit <n>           Limit local DB stories when not using --all-approved",
      "  --offline             Do not fetch Steam appdetails metadata",
      "  --stills-report <p>   Attach verified still assets from a specific v1.5/v1.4/v1.1 report",
      "  --no-stills-report    Do not attach still-enrichment report assets",
      "  --segment-validation-report <p>",
      "                        Exclude exhausted source families from a previous local validation report",
      "  --official-source-intake-report <p>",
      "                        Attach validated operator-supplied official references as reference-only inputs",
      "  --trusted-footage-registry-report <p>",
      "                        Attach accepted trusted footage registry references as autonomous reference-only inputs",
      "  --no-exclude-exhausted-source-families",
      "                        Keep exhausted references even when a segment report is supplied",
      "  --exhausted-source-family-threshold <n>",
      "                        Failed windows before a source family is treated as exhausted",
      "  --output-dir <p>      Write reports under this local directory",
      "  --output-basename <n> Basename for latest + story/batch-specific report files",
      "  --no-latest-report    Only write story/batch-specific report files, not the legacy latest files",
      "  --write-latest-report Explicitly update legacy latest files from a one-story run",
      "  --json                Print JSON instead of Markdown",
      "",
      "This command is report-only: it fetches Steam metadata JSON at most, and never downloads videos, extracts frames, slices clips, mutates the DB, publishes or touches Railway/OAuth.",
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
    media_candidates: Array.isArray(row.media_candidates)
      ? row.media_candidates
      : parseJsonField(row.media_candidates) || [],
    igdb_assets: Array.isArray(row.igdb_assets)
      ? row.igdb_assets
      : parseJsonField(row.igdb_assets) || [],
  };
}

function storyTime(story) {
  return Date.parse(story?.timestamp || story?.created_at || story?.updated_at || 0) || 0;
}

async function loadStories(args) {
  if (args.fixture) {
    return { stories: buildDemoStories(), mode: "fixture" };
  }

  if (args.storyJsonPath) {
    const storyJsonPath = path.resolve(ROOT, args.storyJsonPath);
    const parsed = await fs.readJson(storyJsonPath);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).map(normaliseStory);
    const selected = args.storyId ? rows.filter((story) => story.id === args.storyId) : rows;
    if (selected.length === 0) {
      throw new Error(`story JSON did not contain requested story id: ${args.storyId}`);
    }
    return { stories: selected, mode: "story_json" };
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
    process.stderr.write(`[trailer-reference] local DB read failed, using fixture: ${err.message}\n`);
  }

  return { stories: buildDemoStories(), mode: "fixture_fallback" };
}

async function loadStillsAssetMap(args) {
  if (args.noStillsReport) return { map: new Map(), source: null };
  const candidates = args.stillsReport ? [path.resolve(ROOT, args.stillsReport)] : DEFAULT_STILLS_REPORTS;
  return loadStillsAssetMapFromFiles(candidates);
}

async function loadSegmentValidationReport(args) {
  if (!args.segmentValidationReport) return { report: null, source: null };
  const source = path.resolve(ROOT, args.segmentValidationReport);
  try {
    return { report: await fs.readJson(source), source };
  } catch (err) {
    process.stderr.write(`[trailer-reference] segment validation report ignored: ${err.message}\n`);
    return { report: null, source };
  }
}

async function loadOfficialSourceIntakeReport(args) {
  if (!args.officialSourceIntakeReport) return { report: null, source: null };
  const source = path.resolve(ROOT, args.officialSourceIntakeReport);
  try {
    return { report: await fs.readJson(source), source };
  } catch (err) {
    process.stderr.write(`[trailer-reference] official source intake ignored: ${err.message}\n`);
    return { report: null, source };
  }
}

async function loadTrustedFootageRegistryReport(args) {
  if (!args.trustedFootageRegistryReport) return { report: null, source: null };
  const source = path.resolve(ROOT, args.trustedFootageRegistryReport);
  try {
    return { report: await fs.readJson(source), source };
  } catch (err) {
    process.stderr.write(`[trailer-reference] trusted footage registry ignored: ${err.message}\n`);
    return { report: null, source };
  }
}

function attachVerifiedStoreAssets(stories, assetMap) {
  return stories.map((story) => {
    const enriched = assetMap.get(story.id) || [];
    if (enriched.length === 0) return story;
    return {
      ...story,
      _verified_store_assets: dedupeAssets([
        ...(Array.isArray(story._verified_store_assets) ? story._verified_store_assets : []),
        ...enriched,
      ]),
    };
  });
}

async function fetchSteamAppDetails(appId) {
  if (typeof fetch !== "function") {
    return { success: false, title: null, movies: [], reason: "fetch_unavailable" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(
      appId,
    )}&filters=movies`;
    const response = await fetch(url, {
      headers: { "user-agent": "PulseGamingTrailerReferenceResolver/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        success: false,
        title: null,
        movies: [],
        reason: `steam_http_${response.status}`,
      };
    }
    return response.json();
  } catch (err) {
    return {
      success: false,
      title: null,
      movies: [],
      reason: err.name === "AbortError" ? "steam_lookup_timeout" : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const { stories: rawStories, mode } = await loadStories(args);
  const stills = await loadStillsAssetMap(args);
  const segmentValidation = await loadSegmentValidationReport(args);
  const officialSourceIntake = await loadOfficialSourceIntakeReport(args);
  const trustedFootageRegistry = await loadTrustedFootageRegistryReport(args);
  const stories = attachVerifiedStoreAssets(rawStories, stills.map);
  const report = await buildOfficialTrailerReferenceReport(stories, {
    mode,
    steamLookup: args.offline ? null : fetchSteamAppDetails,
    segmentValidationReport: segmentValidation.report,
    excludeExhaustedSourceFamilies:
      Boolean(segmentValidation.report) && !args.noExcludeExhaustedSourceFamilies,
    exhaustedSourceFamilyThreshold: args.exhaustedSourceFamilyThreshold,
    officialSourceIntakeReport: officialSourceIntake.report,
    trustedFootageRegistryReport: trustedFootageRegistry.report,
  });
  report.story_mode = mode;
  report.stills_report_source = stills.source;
  report.stills_report_sources = stills.sources || [];
  report.segment_validation_report_source = segmentValidation.source;
  report.official_source_intake_report_source = officialSourceIntake.source;
  report.trusted_footage_registry_report_source = trustedFootageRegistry.source;
  report.exhausted_source_family_filter_enabled =
    Boolean(segmentValidation.report) && !args.noExcludeExhaustedSourceFamilies;
  report.network_metadata_lookup = {
    steam_appdetails_enabled: !args.offline,
    downloads_allowed: false,
  };

  const markdown = renderOfficialTrailerReferenceMarkdown(report);

  const written = await writeOfficialTrailerReferenceReportFiles(report, markdown, {
    outputDir: path.resolve(ROOT, args.outputDir),
    basename: args.outputBasename,
    writeCanonical: shouldWriteLatestReport(args),
  });

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write(`[trailer-reference] wrote ${path.relative(ROOT, written.storyJson)}\n`);
  if (written.wroteStoryAlias) {
    process.stderr.write(`[trailer-reference] updated story alias ${path.relative(ROOT, written.storyAliasJson)}\n`);
  }
  if (written.wroteCanonical) {
    process.stderr.write(`[trailer-reference] updated latest ${path.relative(ROOT, written.canonicalJson)}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[trailer-reference] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  loadStories,
  normaliseStory,
  parseArgs,
  shouldWriteLatestReport,
};
