#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildFlashLaneDowngradePlan,
  renderFlashLaneDowngradePlanMarkdown,
  safeId,
} = require("../lib/ops/flash-lane-downgrade-planner");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_CURRENT_STATE = path.join(OUT, "flash_lane_current_state.json");
const DEFAULT_ROOT_REPORT = path.join(ROOT, "FLASH_LANE_DOWNGRADE_PLAN.md");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    limit: 20,
    currentState: DEFAULT_CURRENT_STATE,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 20);
    else if (arg === "--current-state") args.currentState = path.resolve(ROOT, argv[++i] || "");
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/flash-lane-downgrade-plan.js [options]",
      "",
      "Options:",
      "  --story <id>              Focus one story id",
      "  --limit <n>               Limit inspected current-state rows",
      "  --current-state <path>    Flash Lane current-state JSON",
      "  --json                    Print JSON instead of Markdown",
      "",
      "Read-only/report-only. Does not download, render, call TTS, post, mutate DB, touch Railway or trigger OAuth.",
    ].join("\n") + "\n",
  );
}

async function writeOverlayInputs(plan) {
  for (const row of plan.rows || []) {
    const rec = row.recommendation || {};
    if (!String(rec.verdict || "").includes("standard")) continue;
    const id = safeId(row.story_id);
    const storyPath = path.join(OUT, `flash_lane_downgrade_standard_story_${id}.json`);
    const scenesPath = path.join(OUT, `flash_lane_downgrade_standard_scenes_${id}.json`);
    await fs.writeJson(storyPath, rec.overlay_story || {}, { spaces: 2 });
    await fs.writeJson(scenesPath, rec.overlay_scenes || [], { spaces: 2 });
    rec.overlay_input_paths = {
      story_json: path.relative(ROOT, storyPath).replace(/\\/g, "/"),
      scenes_json: path.relative(ROOT, scenesPath).replace(/\\/g, "/"),
    };
    rec.overlay_command = [
      "npm run studio:v2:standard-overlay --",
      `--story-json ${rec.overlay_input_paths.story_json}`,
      `--scenes-json ${rec.overlay_input_paths.scenes_json}`,
      `--duration ${rec.target_runtime?.target_duration_s || 66}`,
    ].join(" ");
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const currentStatePath = path.resolve(ROOT, args.currentState);
  if (!(await fs.pathExists(currentStatePath))) {
    throw new Error(`Flash Lane current-state report not found: ${currentStatePath}`);
  }

  const currentStateReport = await fs.readJson(currentStatePath);
  const plan = buildFlashLaneDowngradePlan({
    currentStateReport,
    storyId: args.storyId,
    limit: args.limit,
  });
  await fs.ensureDir(OUT);
  await writeOverlayInputs(plan);
  const markdown = renderFlashLaneDowngradePlanMarkdown(plan);
  const jsonPath = path.join(OUT, "flash_lane_downgrade_plan.json");
  const mdPath = path.join(OUT, "flash_lane_downgrade_plan.md");
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");
  await fs.writeFile(DEFAULT_ROOT_REPORT, markdown, "utf8");

  process.stdout.write(args.json ? `${JSON.stringify(plan, null, 2)}\n` : markdown);
  process.stderr.write(
    `[flash-downgrade] wrote ${path.relative(ROOT, jsonPath).replace(/\\/g, "/")}, ${path.relative(
      ROOT,
      mdPath,
    ).replace(/\\/g, "/")} and ${path.relative(ROOT, DEFAULT_ROOT_REPORT).replace(/\\/g, "/")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[flash-downgrade] ${err.stack || err.message}\n`);
  process.exit(1);
});
