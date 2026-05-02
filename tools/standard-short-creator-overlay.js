#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildStandardShortCreatorOverlayPlan,
  renderStandardShortCreatorOverlayMarkdown,
} = require("../lib/studio/v2/standard-short-creator-overlay");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    fixture: false,
    storyJson: null,
    scenesJson: null,
    durationS: 62,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--fixture") args.fixture = true;
    else if (arg === "--story-json") args.storyJson = argv[++i] || null;
    else if (arg === "--scenes-json") args.scenesJson = argv[++i] || null;
    else if (arg === "--duration") args.durationS = Math.max(1, Number(argv[++i]) || 62);
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/standard-short-creator-overlay.js [options]",
      "",
      "Options:",
      "  --fixture             Use a built-in GTA/Red Dead/BioShock fixture",
      "  --story-json <path>   Story JSON file",
      "  --scenes-json <path>  Scene JSON array file",
      "  --duration <seconds>  Runtime used for overlay planning",
      "  --json                Print JSON instead of Markdown",
      "",
      "This command is local/report-only. It does not render, publish or mutate production state.",
    ].join("\n") + "\n",
  );
}

function fixtureStory() {
  return {
    id: "fixture_take_two_legacy",
    title: "Take-Two killed a legacy sequel while GTA, Red Dead and BioShock fans watched",
    source_type: "rss",
    subreddit: "GameSpot",
    content_pillar: "Confirmed Drop",
    full_script:
      "Take-Two just made a surprising call. GTA, Red Dead and BioShock fans all have a reason to care.",
  };
}

function fixtureScenes() {
  return [
    { type: "opener", label: "opener_hero", entity: "GTA", duration: 4 },
    { type: "clip.frame", label: "frame_gta", entity: "GTA", duration: 4 },
    { type: "still", label: "red_dead", entity: "Red Dead", duration: 4 },
    { type: "card.source", label: "source", duration: 4 },
    { type: "still", label: "bioshock", entity: "BioShock", duration: 4 },
    { type: "card.stat", label: "context", duration: 4 },
    { type: "card.takeaway", label: "takeaway", duration: 4 },
  ];
}

async function readJson(filePath, label) {
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) throw new Error(`${label} not found: ${resolved}`);
  return fs.readJson(resolved);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const story = args.storyJson ? await readJson(args.storyJson, "story JSON") : fixtureStory();
  const scenes = args.scenesJson ? await readJson(args.scenesJson, "scenes JSON") : fixtureScenes();
  const plan = buildStandardShortCreatorOverlayPlan({
    story,
    scenes,
    durationS: args.durationS,
  });
  const markdown = renderStandardShortCreatorOverlayMarkdown(plan);

  await fs.ensureDir(OUT);
  await fs.writeJson(path.join(OUT, "standard_short_creator_overlay_v1.json"), plan, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "standard_short_creator_overlay_v1.md"), markdown, "utf8");
  process.stdout.write(args.json ? JSON.stringify(plan, null, 2) + "\n" : markdown);
  process.stderr.write("[standard-overlay] wrote test/output/standard_short_creator_overlay_v1.{json,md}\n");
}

main().catch((err) => {
  process.stderr.write(`[standard-overlay] ${err.stack || err.message}\n`);
  process.exit(1);
});
