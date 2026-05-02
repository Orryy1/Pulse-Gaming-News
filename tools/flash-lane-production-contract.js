#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: true });
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
    title: "GTA 6 Owner Passed On A Sequel To A Legacy Franchise",
    hook: "Take-Two just made the weirdest legacy franchise call of the week.",
    full_script: [
      "Take-Two just made the weirdest legacy franchise call of the week.",
      "The company says it passed on a sequel to one of its legacy franchises because the pitch was not strong enough.",
      "That matters because Take-Two owns names that still make gaming audiences stop scrolling: GTA, Red Dead, BioShock, Mafia and Borderlands.",
      "This is not a release-date reveal and it is not confirmation of a cancelled project.",
      "It is a rare look at how the publisher decides what gets revived and what stays buried.",
      "The interesting bit is the standard.",
      "Take-Two is basically saying nostalgia alone is not enough.",
      "If a sequel cannot clear the creative bar, even a famous logo does not save it.",
      "That makes the mystery bigger, not smaller.",
      "Was it BioShock, Midnight Club, Bully, Max Payne or something else entirely?",
      "For players, the real takeaway is brutal.",
      "A beloved franchise can still lose internally if the pitch feels average.",
      "Follow Pulse Gaming so you never miss a beat.",
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

main().catch((err) => {
  process.stderr.write(`[flash-lane-contract] ${err.stack || err.message}\n`);
  process.exit(1);
});
