#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

try {
  require("dotenv").config({ override: true });
} catch {}

const { buildDemoStories } = require("../lib/creator-studio-os");
const {
  buildAssetAcquisitionControlRoom,
  buildVisualDeckMarkdown,
  renderAssetAcquisitionMarkdown,
  renderExactSubjectMarkdown,
  renderStoreVerificationMarkdown,
} = require("../lib/asset-acquisition-pro");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const PLAN_OUT = path.join(OUT, "asset-acquisition");

function parseArgs(argv) {
  const args = {
    fixture: false,
    json: false,
    help: false,
    storyId: null,
    allApproved: false,
    limit: 5,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--all-approved") args.allApproved = true;
    else if (arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 5);
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/asset-acquisition-pro.js [options]",
      "",
      "Options:",
      "  --fixture             Use built-in demo stories",
      "  --story-id <id>       Build an acquisition plan for one story id",
      "  --all-approved        Include approved / auto-approved stories",
      "  --limit <n>           Limit local DB stories when not using --all-approved",
      "  --json                Print JSON instead of Markdown",
      "",
      "This command is plan-only: it does not download assets, render videos, publish or mutate data.",
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
    process.stderr.write(`[asset-acquisition] local DB read failed, using fixture: ${err.message}\n`);
  }

  return { stories: buildDemoStories(), mode: "fixture_fallback" };
}

function safeName(value) {
  return String(value || "story")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function sectionMarkdown(title, obj) {
  return `# ${title}\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
}

async function writePlanFiles(plan) {
  const dir = path.join(PLAN_OUT, safeName(plan.story_id));
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "asset_acquisition_plan.json"), plan, { spaces: 2 });
  await fs.writeJson(path.join(dir, "media_provenance.json"), plan.media_provenance, {
    spaces: 2,
  });
  await fs.writeJson(path.join(dir, "visual_deck.json"), plan.visual_deck, { spaces: 2 });
  await fs.writeFile(path.join(dir, "visual_deck.md"), buildVisualDeckMarkdown(plan), "utf8");
  await fs.writeJson(
    path.join(dir, "creator_studio_readiness_delta.json"),
    plan.creator_studio_integration,
    { spaces: 2 },
  );
  await fs.writeFile(
    path.join(dir, "asset_acquisition_plan.md"),
    sectionMarkdown(`Asset Acquisition Plan - ${plan.story_id}`, plan),
    "utf8",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const { stories, mode } = await loadStories(args);
  const report = buildAssetAcquisitionControlRoom(stories, { mode });
  const markdown = renderAssetAcquisitionMarkdown(report);
  const exactSubjectMarkdown = renderExactSubjectMarkdown(report);
  const storeVerificationMarkdown = renderStoreVerificationMarkdown(report);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "asset_acquisition_pro.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "asset_acquisition_pro.md"), markdown, "utf8");
  await fs.writeJson(path.join(OUT, "asset_acquisition_v12_exact_subject.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(OUT, "asset_acquisition_v12_exact_subject.md"),
    exactSubjectMarkdown,
    "utf8",
  );
  await fs.writeJson(path.join(OUT, "asset_acquisition_v13_store_verification.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(
    path.join(OUT, "asset_acquisition_v13_store_verification.md"),
    storeVerificationMarkdown,
    "utf8",
  );
  await fs.writeJson(
    path.join(OUT, "media_provenance.json"),
    report.plans.flatMap((plan) => plan.media_provenance || []),
    { spaces: 2 },
  );
  await fs.writeJson(
    path.join(OUT, "visual_deck.json"),
    report.plans.map((plan) => ({
      story_id: plan.story_id,
      title: plan.title,
      visual_deck: plan.visual_deck,
    })),
    { spaces: 2 },
  );
  await fs.writeFile(
    path.join(OUT, "visual_deck.md"),
    report.plans.map((plan) => buildVisualDeckMarkdown(plan)).join("\n"),
    "utf8",
  );
  for (const plan of report.plans) {
    await writePlanFiles(plan);
  }

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write(
    `[asset-acquisition] wrote test/output/asset_acquisition_pro.{json,md}, media_provenance.json, visual_deck.{json,md} and ${report.plans.length} plan(s)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[asset-acquisition] ${err.stack || err.message}\n`);
  process.exit(1);
});
