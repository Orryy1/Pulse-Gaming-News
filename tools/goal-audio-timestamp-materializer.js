#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  materializeGoalAudioTimestamps,
  renderGoalAudioTimestampMaterializationMarkdown,
  writeGoalAudioTimestampMaterializationReport,
} = require("../lib/goal-audio-timestamp-materializer");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workbenchPath: path.join(ROOT, "output", "goal-contract", "audio_timestamp_workbench.json"),
    outDir: path.join(ROOT, "output", "goal-contract"),
    workspaceRoot: ROOT,
    generatedAt: null,
    limit: 0,
    provider: "auto",
    storyIds: [],
    alignmentMode: "whisper",
    force: false,
    inspectOnly: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workbench") args.workbenchPath = argv[++i] || args.workbenchPath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++i] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--limit") args.limit = Number(argv[++i] || 0);
    else if (arg === "--provider") args.provider = argv[++i] || args.provider;
    else if (arg === "--story-id") {
      const storyId = argv[++i];
      if (storyId) args.storyIds.push(storyId);
    }
    else if (arg === "--alignment") args.alignmentMode = argv[++i] || args.alignmentMode;
    else if (arg === "--force") args.force = true;
    else if (arg === "--inspect-only") args.inspectOnly = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-audio-materialize -- [options]",
    "",
    "Options:",
    "  --workbench <path>    Audio timestamp workbench JSON",
    "  --out-dir <dir>       Output directory for reports",
    "  --workspace <dir>     Workspace root for output/audio",
    "  --generated-at <iso>  Fixed timestamp for deterministic reports",
    "  --limit <n>           Generate at most n stories; 0 means all candidates",
    "  --story-id <id>       Generate only this story; repeatable",
    "  --provider <auto|local|elevenlabs>  Narration provider preference; auto uses the provider selected by the workbench",
    "  --alignment <whisper|silence|auto|off>  Local word-timing alignment mode; default whisper for CLI materialisation",
    "  --force               Regenerate even if an audio/timestamp pair exists",
    "  --inspect-only        Do not call local TTS; write a pending-generation report",
    "  --json                Print JSON summary",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function setMinimumMs(env, key, minimum) {
  const current = Number(env[key]);
  if (!Number.isFinite(current) || current < minimum) env[key] = String(minimum);
}

function configureLocalTtsBatchEnv(env = process.env) {
  env.TTS_PROVIDER = "local";
  env.PULSE_LOCAL_TTS_ONLY = "true";
  setMinimumMs(env, "LOCAL_TTS_TIMEOUT_MS", 900000);
  env.LOCAL_TTS_REQUEST_ATTEMPTS = env.LOCAL_TTS_REQUEST_ATTEMPTS || "1";
  setMinimumMs(env, "LOCAL_TTS_START_WAIT_MS", 120000);
  setMinimumMs(env, "LOCAL_TTS_PREWARM_TIMEOUT_MS", 600000);
  env.LOCAL_TTS_OUTPUT_FORMAT = env.LOCAL_TTS_OUTPUT_FORMAT || "mp3_44100_256";
  env.LOCAL_WHISPER_MODELS = env.LOCAL_WHISPER_MODELS || "tiny.en,base.en,small.en";
  return env;
}

function configureGoalTtsBatchEnv(env = process.env, { provider = "auto" } = {}) {
  const selected = String(provider || "auto").toLowerCase();
  if (selected === "local") return configureLocalTtsBatchEnv(env);
  if (selected === "elevenlabs") {
    env.TTS_PROVIDER = "elevenlabs";
    delete env.PULSE_LOCAL_TTS_ONLY;
    return env;
  }
  return configureLocalTtsBatchEnv(env);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  configureGoalTtsBatchEnv(process.env, { provider: args.provider });
  const workbenchReport = await readJsonIfPresent(path.resolve(args.workbenchPath));
  const report = await materializeGoalAudioTimestamps({
    workbenchReport,
    workspaceRoot: path.resolve(args.workspaceRoot),
    generatedAt: args.generatedAt || new Date().toISOString(),
    limit: args.limit,
    storyIds: args.storyIds,
    force: args.force,
    inspectOnly: args.inspectOnly,
    provider: args.provider,
    alignmentMode: args.alignmentMode,
  });
  const written = await writeGoalAudioTimestampMaterializationReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalAudioTimestampMaterializationMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-audio-timestamp-materializer] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  configureGoalTtsBatchEnv,
  configureLocalTtsBatchEnv,
  main,
  parseArgs,
  usage,
};
