#!/usr/bin/env node
"use strict";

const path = require("node:path");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  repairMergedSegmentVoiceMetadata,
  renderGoalAudioVoiceMetadataRepairMarkdown,
  writeGoalAudioVoiceMetadataRepairReport,
} = require("../lib/goal-audio-timestamp-materializer");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyIds: [],
    workspaceRoot: ROOT,
    outDir: path.join(ROOT, "output", "goal-contract"),
    applyLocal: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-id") {
      const storyId = argv[++i];
      if (storyId) args.storyIds.push(storyId);
    } else if (arg.startsWith("--story-id=")) {
      args.storyIds.push(arg.slice("--story-id=".length));
    } else if (arg === "--workspace") {
      args.workspaceRoot = argv[++i] || args.workspaceRoot;
    } else if (arg === "--out-dir") {
      args.outDir = argv[++i] || args.outDir;
    } else if (arg === "--apply-local") {
      args.applyLocal = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-audio-voice-metadata-repair -- --story-id <id> [options]",
    "",
    "Options:",
    "  --story-id <id>      Story to repair; repeatable",
    "  --workspace <dir>    Workspace root for output/audio resolution",
    "  --out-dir <dir>      Report output directory",
    "  --apply-local        Update the local timestamp sidecar",
    "  --json               Print JSON",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  if (!args.storyIds.length) throw new Error("At least one --story-id is required");
  const reports = [];
  for (const storyId of args.storyIds) {
    const report = await repairMergedSegmentVoiceMetadata({
      workspaceRoot: path.resolve(args.workspaceRoot),
      storyId,
      applyLocal: args.applyLocal,
    });
    await writeGoalAudioVoiceMetadataRepairReport(report, {
      outputDir: path.resolve(args.outDir),
    });
    reports.push(report);
  }
  const result = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: args.applyLocal ? "apply-local" : "dry-run",
    story_count: reports.length,
    repaired_count: reports.filter((report) => report.action === "applied_segment_voice_metadata").length,
    blocked_count: reports.filter((report) => report.blockers?.length).length,
    reports,
    safety: {
      local_only: true,
      mutates_media: args.applyLocal === true,
      mutates_production_db: false,
      mutates_tokens: false,
      triggers_oauth: false,
      posts_to_platforms: false,
      weakens_gates: false,
    },
  };
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(reports.map(renderGoalAudioVoiceMetadataRepairMarkdown).join("\n").trimEnd());
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-audio-voice-metadata-repair] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
