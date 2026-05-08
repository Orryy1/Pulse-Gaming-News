#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true });
} catch {}

const { buildDemoStories } = require("../lib/creator-studio-os");
const {
  renderStillImageEnrichmentMarkdown,
  runStillImageEnrichment,
} = require("../lib/still-image-enrichment");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_ASSET_OUT = path.join(OUT, "asset-acquisition-v11", "assets");

function parseArgs(argv) {
  const args = {
    fixture: false,
    help: false,
    storyId: null,
    limit: 5,
    dryRun: true,
    applyLocal: false,
    verifyStoreMetadata: false,
    requireVerifiedStore: false,
    multiEntityStoreSearch: false,
    preferGameplayStills: false,
    maxStoreSearchEntities: 5,
    maxStoreAssetsPerEntity: 3,
    maxDownloadsPerStory: undefined,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 5);
    else if (arg === "--dry-run") {
      args.dryRun = true;
      args.applyLocal = false;
    } else if (arg === "--apply-local") {
      args.dryRun = false;
      args.applyLocal = true;
    } else if (arg === "--verified-store-metadata") {
      args.verifyStoreMetadata = true;
    } else if (arg === "--require-verified-store") {
      args.requireVerifiedStore = true;
    } else if (arg === "--multi-entity-store-search") {
      args.multiEntityStoreSearch = true;
    } else if (arg === "--prefer-gameplay-stills") {
      args.preferGameplayStills = true;
    } else if (arg === "--max-store-search-entities") {
      args.maxStoreSearchEntities = Math.max(1, Number(argv[++i]) || 5);
    } else if (arg === "--max-store-assets-per-entity") {
      args.maxStoreAssetsPerEntity = Math.max(1, Number(argv[++i]) || 3);
    } else if (arg === "--max-downloads-per-story") {
      args.maxDownloadsPerStory = Math.max(1, Number(argv[++i]) || 6);
    } else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/still-image-enrichment.js [options]",
      "",
      "Options:",
      "  --fixture          Use built-in demo stories",
      "  --story <id>       Build an enrichment plan for one story id",
      "  --limit <n>        Limit local DB stories",
      "  --dry-run          Default. Plan only, no asset writes",
      "  --apply-local      Download allowed still images to test/output only",
      "  --verified-store-metadata",
      "                     Resolve missing Steam app titles locally before planning",
      "  --require-verified-store",
      "                     Reject Steam/IGDB assets unless store title/slug verification passes",
      "  --multi-entity-store-search",
      "                     Search Steam stills for each required game/franchise entity",
      "  --prefer-gameplay-stills",
      "                     Prefer Steam screenshots/gameplay-like stills over covers and capsules",
      "  --max-store-search-entities <n>",
      "                     Cap entity searches (default 5)",
      "  --max-store-assets-per-entity <n>",
      "                     Cap still assets per entity (default 3)",
      "  --max-downloads-per-story <n>",
      "                     Cap accepted/applied still downloads per story",
      "",
      "Forbidden in this command: trailer/video downloads, yt-dlp, browser scraping, DB mutation, OAuth, publishing and Railway changes.",
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
    game_images: Array.isArray(row.game_images)
      ? row.game_images
      : parseJsonField(row.game_images) || [],
    video_clips: Array.isArray(row.video_clips)
      ? row.video_clips
      : parseJsonField(row.video_clips) || [],
    article_inline_images: Array.isArray(row.article_inline_images)
      ? row.article_inline_images
      : parseJsonField(row.article_inline_images) || [],
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
  if (args.fixture) return { stories: buildDemoStories(), mode: "fixture" };

  try {
    const db = require("../lib/db");
    const rows = (await db.getStories()).map(normaliseStory);
    let selected = rows;
    if (args.storyId) {
      selected = rows.filter((story) => story.id === args.storyId);
    } else {
      selected = rows
        .filter((story) => story.approved || story.auto_approved)
        .sort((a, b) => storyTime(b) - storyTime(a))
        .slice(0, args.limit);
      if (selected.length === 0) {
        selected = rows.sort((a, b) => storyTime(b) - storyTime(a)).slice(0, args.limit);
      }
    }
    if (selected.length > 0) return { stories: selected, mode: "local_db" };
  } catch (err) {
    process.stderr.write(`[stills] local DB read failed, using fixture: ${err.message}\n`);
  }

  return { stories: buildDemoStories(), mode: "fixture_fallback" };
}

function buildVisualDeckExamples(report) {
  return {
    schema_version: 1,
    generated_at: report.generated_at,
    mode: report.mode,
    examples: (report.plans || []).map((plan) => ({
      story_id: plan.story_id,
      title: plan.title,
      before: plan.before,
      after_projected: plan.after_projected,
      deck_change: plan.would_change_visual_deck,
      enrichment_items: plan.would_fetch.map((item, index) => ({
        order: index + 1,
        visual_type: item.source_type,
        visual_target: item.entity || "story_subject",
        source_url: item.source_url,
        rights_risk_class: item.rights_risk_class,
        reason: "adds_safe_still_image_diversity",
      })),
      rejected_summary: plan.would_reject.reduce((counts, item) => {
        counts[item.reason] = (counts[item.reason] || 0) + 1;
        return counts;
      }, {}),
    })),
  };
}

function renderVisualDeckExamplesMarkdown(deckReport) {
  const lines = [];
  lines.push("# Asset Acquisition Pro v1.1 - Visual Deck Examples");
  lines.push("");
  lines.push(`Generated: ${deckReport.generated_at}`);
  lines.push(`Mode: ${deckReport.mode}`);
  for (const example of deckReport.examples || []) {
    lines.push("");
    lines.push(`## ${example.story_id}`);
    lines.push("");
    lines.push(`Title: ${example.title}`);
    lines.push(`Before: ${example.before.readiness_colour}/${example.before.creator_studio_media_verdict}`);
    lines.push(
      `After: ${example.after_projected.readiness_colour}/${example.after_projected.creator_studio_media_verdict}`,
    );
    lines.push("");
    lines.push("| order | type | target | risk |");
    lines.push("| ---: | --- | --- | --- |");
    for (const item of example.enrichment_items) {
      lines.push(`| ${item.order} | ${item.visual_type} | ${item.visual_target} | ${item.rights_risk_class} |`);
    }
    if (example.enrichment_items.length === 0) {
      lines.push("| 0 | none | no safe still-image improvement | n/a |");
    }
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (args.applyLocal && process.env.RAILWAY_ENVIRONMENT) {
    throw new Error("apply-local is disabled in Railway environments");
  }

  const { stories, mode } = await loadStories(args);
  const report = await runStillImageEnrichment(stories, {
    dryRun: args.dryRun,
    applyLocal: args.applyLocal,
    verifyStoreMetadata: args.verifyStoreMetadata,
    requireVerifiedStore: args.requireVerifiedStore,
    multiEntityStoreSearch: args.multiEntityStoreSearch || args.preferGameplayStills,
    preferGameplayStills: args.preferGameplayStills,
    maxStoreSearchEntities: args.maxStoreSearchEntities,
    maxStoreAssetsPerEntity: args.maxStoreAssetsPerEntity,
    maxDownloadsPerStory: args.maxDownloadsPerStory,
    outputRoot: DEFAULT_ASSET_OUT,
  });
  report.story_mode = mode;
  const markdown = renderStillImageEnrichmentMarkdown(report);
  const deckExamples = buildVisualDeckExamples(report);
  const deckMarkdown = renderVisualDeckExamplesMarkdown(deckExamples);

  await fs.ensureDir(OUT);
  const v16 = args.preferGameplayStills;
  const v15 = args.multiEntityStoreSearch || v16;
  const v14 = args.verifyStoreMetadata || args.requireVerifiedStore || v15;
  const stem = v16
    ? args.applyLocal
      ? "asset_acquisition_v16_gameplay_stills_apply_local"
      : "asset_acquisition_v16_gameplay_stills_dry_run"
    : v15
    ? args.applyLocal
      ? "asset_acquisition_v15_multi_entity_apply_local"
      : "asset_acquisition_v15_multi_entity_dry_run"
    : v14
    ? args.applyLocal
      ? "asset_acquisition_v14_verified_store_apply_local"
      : "asset_acquisition_v14_verified_store_dry_run"
    : args.applyLocal
      ? "asset_acquisition_v11_apply_local"
      : "asset_acquisition_v11_dry_run";
  await fs.writeJson(path.join(OUT, `${stem}.json`), report, { spaces: 2 });
  await fs.writeFile(path.join(OUT, `${stem}.md`), markdown, "utf8");
  await fs.writeJson(path.join(OUT, "asset_acquisition_v11_visual_deck_examples.json"), deckExamples, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(OUT, "asset_acquisition_v11_visual_deck_examples.md"),
    deckMarkdown,
    "utf8",
  );
  if (!args.applyLocal) {
    await fs.writeJson(path.join(OUT, "asset_acquisition_v11_dry_run.json"), report, { spaces: 2 });
    await fs.writeFile(path.join(OUT, "asset_acquisition_v11_dry_run.md"), markdown, "utf8");
  }
  if (v14) {
    await fs.writeJson(path.join(OUT, "asset_acquisition_v14_verified_store.json"), report, {
      spaces: 2,
    });
    await fs.writeFile(
      path.join(OUT, "asset_acquisition_v14_verified_store.md"),
      markdown,
      "utf8",
    );
  }
  if (v15) {
    await fs.writeJson(path.join(OUT, "asset_acquisition_v15_multi_entity_store.json"), report, {
      spaces: 2,
    });
    await fs.writeFile(
      path.join(OUT, "asset_acquisition_v15_multi_entity_store.md"),
      markdown,
      "utf8",
    );
  }
  if (v16) {
    await fs.writeJson(path.join(OUT, "asset_acquisition_v16_gameplay_stills.json"), report, {
      spaces: 2,
    });
    await fs.writeFile(
      path.join(OUT, "asset_acquisition_v16_gameplay_stills.md"),
      markdown,
      "utf8",
    );
  }

  process.stdout.write(markdown);
  process.stderr.write(`[stills] wrote test/output/${stem}.{json,md}\n`);
}

main().catch((err) => {
  process.stderr.write(`[stills] ${err.stack || err.message}\n`);
  process.exit(1);
});
