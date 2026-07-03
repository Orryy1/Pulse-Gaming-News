#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  repairCaptionTimeline,
  writeCaptionTimelineRepairReport,
} = require("../lib/caption-timeline-repair");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    artifactDir: "",
    storyId: "",
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    apply: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--artifact-dir") args.artifactDir = argv[++i] || "";
    else if (arg === "--story-id") args.storyId = argv[++i] || "";
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:caption-timeline-repair -- [options]",
    "",
    "Options:",
    "  --artifact-dir <dir>  Story artefact directory containing audio/word_timestamps.json",
    "  --story-id <id>       Story ID for report metadata",
    "  --out-dir <dir>       Output report directory",
    "  --generated-at <iso>  Fixed timestamp",
    "  --apply               Rewrite captions.srt and platform variant captions",
    "  --json                Print JSON",
    "",
    "Repairs truncated SRT timelines from existing Whisper word timestamps.",
    "This command never publishes, mutates DB rows or touches OAuth/token settings.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  if (!args.artifactDir) throw new Error("--artifact-dir is required");
  const root = path.resolve(args.root);
  const report = await repairCaptionTimeline({
    artifactDir: path.resolve(root, args.artifactDir),
    storyId: args.storyId,
    apply: args.apply,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeCaptionTimelineRepairReport(report, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log([
      `Caption timeline repair: ${report.story_id}`,
      `Applied: ${report.applied}`,
      `Words: ${report.word_count}`,
      `Base end: ${report.base_last_caption_end_s}`,
      `Variant repairs: ${report.variant_repairs.length}`,
      `Report: ${artefacts.jsonPath}`,
      "Safety: no publish, DB, token or OAuth change.",
    ].join("\n"));
  }
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[caption-timeline-repair] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
