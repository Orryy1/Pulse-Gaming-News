#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

const path = require("node:path");
const fs = require("fs-extra");
const {
  buildBreakingNewsCandidateQueue,
  buildBreakingNewsFastLaneOverview,
  buildGoalBreakingNewsFastLanePlan,
  writeBreakingNewsFastLaneOverview,
  writeGoalBreakingNewsFastLanePlan,
} = require("../lib/goal-breaking-news-fast-lane");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPath: "",
    autoSelectCurrent: false,
    humanReviewQueuePath: "",
    platformStatePath: "",
    outDir: path.join("output", "goal-contract", "breaking-news-fast-lane"),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story") args.storyPath = argv[++i] || "";
    else if (arg === "--auto-select-current") args.autoSelectCurrent = true;
    else if (arg === "--human-review-queue") args.humanReviewQueuePath = argv[++i] || "";
    else if (arg === "--platform-state") args.platformStatePath = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || "";
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-breaking-news -- [options]",
    "",
    "Options:",
    "  --story <path>             Canonical story manifest or story JSON",
    "  --auto-select-current      Select a source-safe story from the current human-review queue",
    "  --human-review-queue <path> Human-review queue JSON for auto-selection",
    "  --platform-state <path>    Platform status matrix JSON",
    "  --out-dir <path>           Output directory",
    "  --json                     Print JSON plan",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath) return fallback;
  if (!(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function loadStoriesFromHumanReviewQueue(queue = {}) {
  const storiesById = {};
  for (const item of Array.isArray(queue.review_items) ? queue.review_items : []) {
    const storyId = clean(item.story_id || item.id);
    const manifestPath = clean(item.evidence?.canonical_manifest_path) ||
      (clean(item.artifact_dir) ? path.join(clean(item.artifact_dir), "canonical_story_manifest.json") : "");
    if (!storyId || !manifestPath || !(await fs.pathExists(manifestPath))) continue;
    storiesById[storyId] = await fs.readJson(manifestPath);
  }
  return storiesById;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return null;
  }
  const platformStatePath = args.platformStatePath ||
    (await fs.pathExists(path.join("output", "goal-contract", "platform_status_matrix.json"))
      ? path.join("output", "goal-contract", "platform_status_matrix.json")
      : "");
  const platformState = await readJsonIfPresent(platformStatePath, {});
  if (args.autoSelectCurrent) {
    const humanReviewQueuePath = args.humanReviewQueuePath ||
      (await fs.pathExists(path.join("output", "goal-contract", "human_review_queue.json"))
        ? path.join("output", "goal-contract", "human_review_queue.json")
        : "");
    const reviewQueue = await readJsonIfPresent(humanReviewQueuePath, { review_items: [] });
    const storiesById = await loadStoriesFromHumanReviewQueue(reviewQueue);
    const candidateQueue = buildBreakingNewsCandidateQueue({ reviewQueue, storiesById, platformState });
    const selectedStoryId = candidateQueue.selected_story_id;
    if (!selectedStoryId) {
      const overview = buildBreakingNewsFastLaneOverview({ platformState });
      const result = {
        ...overview,
        breaking_news_candidate_queue: candidateQueue,
      };
      await writeBreakingNewsFastLaneOverview(result, { outputDir: args.outDir });
      await fs.writeJson(path.resolve(args.outDir, "breaking_news_candidate_queue.json"), candidateQueue, { spaces: 2 });
      if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else console.log("Breaking fast-lane auto-select found no eligible source-safe candidate.");
      return result;
    }
    const plan = await buildGoalBreakingNewsFastLanePlan({
      story: storiesById[selectedStoryId],
      platformState,
      candidateQueue,
    });
    await writeGoalBreakingNewsFastLanePlan(plan, { outputDir: args.outDir });
    if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    else console.log(`Breaking fast-lane selected: ${plan.breaking_news_manifest.title}`);
    return plan;
  }
  if (!args.storyPath) {
    const overview = buildBreakingNewsFastLaneOverview({ platformState });
    await writeBreakingNewsFastLaneOverview(overview, { outputDir: args.outDir });
    if (args.json) process.stdout.write(`${JSON.stringify(overview, null, 2)}\n`);
    else console.log(`Breaking fast-lane overview: ${overview.verdict} (${overview.required_input} required)`);
    return overview;
  }
  const story = await fs.readJson(path.resolve(args.storyPath));
  const plan = await buildGoalBreakingNewsFastLanePlan({ story, platformState });
  await writeGoalBreakingNewsFastLanePlan(plan, { outputDir: args.outDir });
  if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else console.log(`Breaking fast-lane verdict: ${plan.breaking_news_manifest.verdict}`);
  return plan;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-breaking-news-fast-lane] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
};
