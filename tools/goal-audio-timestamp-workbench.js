#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoalAudioTimestampWorkbench,
  renderGoalAudioTimestampWorkbenchMarkdown,
  writeGoalAudioTimestampWorkbench,
} = require("../lib/goal-audio-timestamp-workbench");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workOrderPath: path.join(ROOT, "output", "goal-contract", "render_input_work_order.json"),
    localTtsDoctorPath: path.join(ROOT, "test", "output", "local_tts_doctor.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    workspaceRoot: ROOT,
    generatedAt: null,
    provider: "auto",
    storyIds: [],
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--work-order") args.workOrderPath = argv[++i] || args.workOrderPath;
    else if (arg === "--local-tts-doctor") args.localTtsDoctorPath = argv[++i] || args.localTtsDoctorPath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++i] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--provider") args.provider = argv[++i] || args.provider;
    else if (arg === "--story-id") {
      const storyId = argv[++i];
      if (storyId) args.storyIds.push(storyId);
    }
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-audio-timestamps -- [options]",
    "",
    "Options:",
    "  --work-order <path>        Goal render input work-order JSON",
    "  --local-tts-doctor <path>  Local TTS doctor JSON",
    "  --out-dir <dir>            Output directory for reports",
    "  --workspace <dir>          Workspace root for relative paths",
    "  --generated-at <iso>       Fixed timestamp for deterministic reports",
    "  --story-id <id>            Check only this story; repeatable",
    "  --provider <auto|local|elevenlabs>  Narration provider preference; auto uses the local clone only; ElevenLabs must be explicit",
    "  --json                     Print JSON summary",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const workOrder = await readJsonIfPresent(path.resolve(args.workOrderPath));
  const localTtsDoctorReport = await readJsonIfPresent(path.resolve(args.localTtsDoctorPath));
  const report = await buildGoalAudioTimestampWorkbench({
    workOrder,
    localTtsDoctorReport,
    ttsEnv: process.env,
    providerPreference: args.provider,
    storyIds: args.storyIds,
    workspaceRoot: path.resolve(args.workspaceRoot),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoalAudioTimestampWorkbench(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalAudioTimestampWorkbenchMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-audio-timestamp-workbench] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
