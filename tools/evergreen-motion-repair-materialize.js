#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");

const {
  materializeEvergreenMotionRepair,
} = require("../lib/services/evergreen-motion-repair-materializer");

function usage() {
  return [
    "Usage:",
    "  node tools/evergreen-motion-repair-materialize.js \\",
    "    --work-order <evergreen-motion-coverage-repair-work-order.json> \\",
    "    --source-video <already-local-source.mp4> \\",
    "    --segments-file <segments.json> \\",
    "    [--source-media-url <official-source-url>] \\",
    "    [--output-dir <work-order-child-directory>] \\",
    "    [--apply-local]",
    "",
    "segments.json may be an array or {\"segments\":[...]}. Each segment",
    "requires start_seconds and duration_seconds. Dry-run is the default.",
    "This tool performs no download, rights decision, database, OAuth or",
    "platform action. --apply-local only extracts muted local clips.",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    apply_local: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }
    if (value === "--apply-local") {
      args.apply_local = true;
      continue;
    }
    const mapping = {
      "--work-order": "work_order_path",
      "--source-video": "source_video_path",
      "--segments-file": "segments_file",
      "--source-media-url": "source_media_url",
      "--output-dir": "output_dir",
    };
    const field = mapping[value];
    if (!field || !argv[index + 1]) {
      throw new Error(`unknown_or_incomplete_argument:${value}`);
    }
    args[field] = argv[index + 1];
    index += 1;
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return null;
  }
  for (const field of [
    "work_order_path",
    "source_video_path",
    "segments_file",
  ]) {
    if (!args[field]) {
      throw new Error(`required_argument_missing:${field}`);
    }
  }
  const segmentInput = await fs.readJson(args.segments_file);
  const segments = Array.isArray(segmentInput)
    ? segmentInput
    : segmentInput?.segments;
  const report = await materializeEvergreenMotionRepair({
    work_order_path: args.work_order_path,
    source_video_path: args.source_video_path,
    source_media_url: args.source_media_url,
    segments,
    output_dir: args.output_dir,
    apply_local: args.apply_local,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${String(error?.code || error?.message || "motion_repair_failed")}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
