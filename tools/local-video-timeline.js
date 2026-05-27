#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildLocalVideoTimeline,
  renderLocalVideoTimelineMarkdown,
} = require("../lib/local-video-timeline");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv) {
  const args = {
    storyJson: null,
    timestamps: null,
    duration: null,
    outputJson: null,
    outputMd: null,
    json: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--story-json" || arg === "--story") args.storyJson = argv[++i] || null;
    else if (arg === "--timestamps") args.timestamps = argv[++i] || null;
    else if (arg === "--duration") args.duration = Number(argv[++i]);
    else if (arg === "--output-json") args.outputJson = argv[++i] || null;
    else if (arg === "--output-md") args.outputMd = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/local-video-timeline.js --story-json <json> --timestamps <json> --duration <seconds>",
      "",
      "Options:",
      "  --story-json <p>   Story JSON object",
      "  --timestamps <p>   Local TTS alignment or local ASR timestamp JSON",
      "  --duration <n>     Audio/video duration in seconds",
      "  --output-json <p>  Write timeline JSON sidecar",
      "  --output-md <p>    Write Markdown report",
      "  --json             Print JSON instead of Markdown",
      "",
      "This command builds a local transcript timeline sidecar. It never calls cloud transcription, downloads media, mutates the DB, triggers OAuth or posts.",
    ].join("\n") + "\n",
  );
}

async function readJsonIfExists(filePath, fallback) {
  if (!filePath) return fallback;
  const resolved = path.resolve(ROOT, filePath);
  if (!(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

function defaultOutputJson(args, story) {
  if (args.outputJson) return path.resolve(ROOT, args.outputJson);
  if (args.timestamps) {
    const resolved = path.resolve(ROOT, args.timestamps);
    return resolved.replace(/(?:_timestamps)?\.json$/i, "_timeline.json");
  }
  return path.join(OUT, `local_video_timeline_${story?.id || "story"}.json`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const story = await readJsonIfExists(args.storyJson, {});
  const timestamps = await readJsonIfExists(args.timestamps, {});
  const timeline = buildLocalVideoTimeline({
    story,
    timestamps,
    duration: args.duration,
  });
  const markdown = renderLocalVideoTimelineMarkdown(timeline);
  const outputJson = defaultOutputJson(args, story);
  const outputMd = path.resolve(
    ROOT,
    args.outputMd || outputJson.replace(/\.json$/i, ".md"),
  );

  await fs.ensureDir(path.dirname(outputJson));
  await fs.ensureDir(path.dirname(outputMd));
  await fs.writeJson(outputJson, timeline, { spaces: 2 });
  await fs.writeFile(outputMd, markdown);

  process.stdout.write(args.json ? JSON.stringify(timeline, null, 2) + "\n" : markdown);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[local-video-timeline] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
};
