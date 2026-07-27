#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: false });
} catch {}

const { ffprobeDuration } = require("../lib/studio/media-acquisition");
const {
  buildFlashLaneProductionContract,
  renderFlashLaneProductionContractMarkdown,
} = require("../lib/studio/v2/flash-lane-production-contract");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = {
    storyId: null,
    audioPath: null,
    fixture: false,
    outputDir: OUT,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story") args.storyId = argv[++i] || null;
    else if (arg === "--audio") args.audioPath = path.resolve(argv[++i] || "");
    else if (arg === "--fixture") args.fixture = true;
    else if (arg === "--out-dir") args.outputDir = path.resolve(argv[++i] || OUT);
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function fixtureStory() {
  return {
    id: "fixture_flash_lane_story",
    title: "Xbox adds achievements to backwards-compatible games",
    hook: "Xbox has added achievement support to selected original Xbox games.",
    hook_type: "direct",
    editorial_lane_id: "what_changes_for_players",
    duration_band_id: "what_changes_standard_35_42",
    cta: "",
    cta_policy: {
      policy_version: "pulse-selective-cta-v2",
      scope: "shorts",
      include_cta: false,
      copy_strategy: "none",
      cohort_bucket: 1,
      cohort_numerator: 1,
      cohort_denominator: 3,
      audit_hash: `sha256:${"c".repeat(64)}`,
    },
    full_script: [
      "Xbox has added achievement support to selected original Xbox games in backwards compatibility.",
      "That changes old catalogue releases from simple nostalgia plays into trackable games with modern profile progress.",
      "Microsoft has not confirmed every title yet, so the affected list still matters.",
      "For players, the practical change is clear: returning classics can now contribute achievements alongside newer Game Pass releases.",
    ].join(" "),
  };
}

function parseJsonField(value) {
  if (!value || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normaliseStory(row) {
  return {
    ...row,
    downloaded_images: Array.isArray(row?.downloaded_images)
      ? row.downloaded_images
      : parseJsonField(row?.downloaded_images) || [],
    game_images: Array.isArray(row?.game_images)
      ? row.game_images
      : parseJsonField(row?.game_images) || [],
  };
}

async function loadStory(args) {
  if (args.fixture) return fixtureStory();
  const db = require("../lib/db");
  const rows = (await db.getStories()).map(normaliseStory);
  if (args.storyId) {
    const story = rows.find((item) => item.id === args.storyId);
    if (!story) throw new Error(`story not found: ${args.storyId}`);
    return story;
  }
  const latest = rows.find((item) => item.approved || item.auto_approved) || rows[0];
  if (!latest) throw new Error("no stories available; use --fixture");
  return latest;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/flash-lane-production-contract.js [options]",
      "",
      "Options:",
      "  --fixture       Use a local fixture story",
      "  --story <id>    Build contract for a local DB story",
      "  --audio <path>  Include existing narration duration in the contract",
      "  --out-dir <dir> Output directory, default test/output",
      "",
      "Read-only/report-only. Does not call TTS, render, OAuth, Railway or posting APIs.",
    ].join("\n") + "\n",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const story = await loadStory(args);
  const narrationDurationS =
    args.audioPath && (await fs.pathExists(args.audioPath))
      ? ffprobeDuration(args.audioPath)
      : null;
  const contract = buildFlashLaneProductionContract({
    story,
    narrationDurationS,
  });
  await fs.ensureDir(args.outputDir);
  const stem = `flash_lane_production_contract_${story.id || "story"}`;
  const jsonPath = path.join(args.outputDir, `${stem}.json`);
  const mdPath = path.join(args.outputDir, `${stem}.md`);
  await fs.writeJson(jsonPath, contract, { spaces: 2 });
  await fs.writeFile(mdPath, renderFlashLaneProductionContractMarkdown(contract), "utf8");
  process.stdout.write(renderFlashLaneProductionContractMarkdown(contract));
  process.stderr.write(
    `[flash-lane-contract] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")} and ${path.relative(ROOT, mdPath).replace(/\\/g, "/")}\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[flash-lane-contract] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  fixtureStory,
  parseArgs,
};
