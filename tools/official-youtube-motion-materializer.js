#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  DEFAULT_END_SECONDS,
  DEFAULT_START_SECONDS,
  materializeOfficialYoutubeMotionReferences,
} = require("../lib/official-youtube-motion-materializer");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_ROOT = path.join(ROOT, "test", "output", "official-youtube-motion");

function parseArgs(argv = process.argv) {
  const args = {
    help: false,
    json: false,
    input: path.join(
      ROOT,
      "test",
      "output",
      "official_search_intake_autofill.json",
    ),
    storyId: null,
    outputDir: DEFAULT_ROOT,
    outputJson: path.join(DEFAULT_ROOT, "official_youtube_motion_report.json"),
    outputTemplate: path.join(
      DEFAULT_ROOT,
      "official_youtube_motion_intake.json",
    ),
    startSeconds: DEFAULT_START_SECONDS,
    endSeconds: DEFAULT_END_SECONDS,
    timeoutMs: 180000,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--input") args.input = argv[++index] || args.input;
    else if (arg === "--story-id" || arg === "--story") {
      args.storyId = argv[++index] || null;
    } else if (arg === "--output-dir") {
      args.outputDir = argv[++index] || args.outputDir;
    } else if (arg === "--output-json") {
      args.outputJson = argv[++index] || args.outputJson;
    } else if (arg === "--output-template") {
      args.outputTemplate = argv[++index] || args.outputTemplate;
    } else if (arg === "--start-seconds") {
      const value = Number(argv[++index]);
      args.startSeconds = Number.isFinite(value)
        ? Math.max(0, value)
        : DEFAULT_START_SECONDS;
    } else if (arg === "--end-seconds") {
      args.endSeconds = Math.max(
        args.startSeconds + 20,
        Number(argv[++index]) || DEFAULT_END_SECONDS,
      );
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Math.max(30000, Number(argv[++index]) || 180000);
    }
  }
  return args;
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.rows)) {
    return payload.rows
      .map((row) => row.output_entry || row)
      .filter(Boolean);
  }
  if (Array.isArray(payload.output_template?.entries)) {
    return payload.output_template.entries;
  }
  return [];
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function helpText() {
  return [
    "Usage: node tools/official-youtube-motion-materializer.js [options]",
    "",
    "Materialises verified exact-entity official YouTube references into bounded local MP4 masters.",
    "Each accepted master is decoded, hashed and bound to an oEmbed source-identity sidecar.",
    "This creates no rights grant and never publishes, mutates the production DB or changes OAuth/tokens.",
    "",
    "Options:",
    "  --input <path>",
    "  --story-id <id>",
    "  --output-dir <path>",
    "  --output-json <path>",
    "  --output-template <path>",
    "  --start-seconds <n>",
    "  --end-seconds <n>",
    "  --timeout-ms <n>",
    "  --json",
  ].join("\n");
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }
  const inputPath = resolveFromRoot(args.input);
  const payload = await fs.readJson(inputPath);
  const entries = rowsFromPayload(payload).filter(
    (entry) => !args.storyId || cleanStoryId(entry) === args.storyId,
  );
  const report = await materializeOfficialYoutubeMotionReferences({
    entries,
    outputDir: resolveFromRoot(args.outputDir),
    startSeconds: args.startSeconds,
    endSeconds: args.endSeconds,
    timeoutMs: args.timeoutMs,
  });
  const outputJson = resolveFromRoot(args.outputJson);
  const outputTemplate = resolveFromRoot(args.outputTemplate);
  await fs.ensureDir(path.dirname(outputJson));
  await fs.ensureDir(path.dirname(outputTemplate));
  await fs.writeJson(outputJson, report, { spaces: 2 });
  await fs.writeJson(outputTemplate, report.output_template, { spaces: 2 });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        "# Official YouTube Motion Materializer",
        "",
        `Verdict: ${report.verdict}`,
        `Accepted: ${report.summary.accepted}`,
        `Blocked: ${report.summary.blocked}`,
        `Report: ${outputJson}`,
        "",
        "No publishing, production DB mutation, OAuth/token change or rights grant occurred.",
        "",
      ].join("\n"),
    );
  }
  if (report.verdict !== "GREEN") process.exitCode = 2;
}

function cleanStoryId(entry = {}) {
  return String(entry.story_id || entry.id || "").trim();
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `[official-youtube-motion-materializer] ${error.stack || error.message}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  rowsFromPayload,
};
