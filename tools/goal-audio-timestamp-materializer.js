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
    ttsRate: null,
    localTtsTimeoutMs: null,
    localTtsRequestAttempts: null,
    localTtsSegmentedMaterializer: null,
    localTtsSegmentedWordThreshold: null,
    localTtsSegmentMaxWords: null,
    localTtsSegmentGapS: null,
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
    else if (arg === "--tts-rate") args.ttsRate = Number(argv[++i] || 0) || null;
    else if (arg === "--local-tts-timeout-ms") args.localTtsTimeoutMs = Number(argv[++i] || 0) || null;
    else if (arg === "--local-tts-request-attempts") args.localTtsRequestAttempts = Number(argv[++i] || 0) || null;
    else if (arg === "--local-tts-segmented-materializer") args.localTtsSegmentedMaterializer = argv[++i] || null;
    else if (arg === "--local-tts-segmented-word-threshold") args.localTtsSegmentedWordThreshold = Number(argv[++i] || 0) || null;
    else if (arg === "--local-tts-segment-max-words") args.localTtsSegmentMaxWords = Number(argv[++i] || 0) || null;
    else if (arg === "--local-tts-segment-gap-s") args.localTtsSegmentGapS = Number(argv[++i] || 0) || null;
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
    "  --tts-rate <number>    Explicit speaking-rate override for regenerated narration",
    "  --local-tts-timeout-ms <n>       Explicit bounded local TTS request timeout",
    "  --local-tts-request-attempts <n> Explicit bounded local TTS request attempts",
    "  --local-tts-segmented-materializer <true|false>  Enable sentence-level local TTS materialisation",
    "  --local-tts-segmented-word-threshold <n>         Segment local TTS scripts at or above this word count",
    "  --local-tts-segment-max-words <n>                Maximum words per local TTS segment",
    "  --local-tts-segment-gap-s <seconds>              Natural gap inserted between local TTS segments",
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

function setMinimumInteger(env, key, minimum) {
  const current = Number(env[key]);
  if (!Number.isInteger(current) || current < minimum) env[key] = String(minimum);
}

function configureWhisperRetryEnv(env = process.env) {
  env.LOCAL_WHISPER_MODELS = env.LOCAL_WHISPER_MODELS || "tiny.en,base.en,small.en";
  return env;
}

function configureLocalTtsBatchEnv(env = process.env, options = {}) {
  env.TTS_PROVIDER = "local";
  env.PULSE_LOCAL_TTS_ONLY = "true";
  if (Number.isFinite(Number(options.localTtsTimeoutMs)) && Number(options.localTtsTimeoutMs) > 0) {
    env.LOCAL_TTS_TIMEOUT_MS = String(Math.max(30000, Math.trunc(Number(options.localTtsTimeoutMs))));
  } else {
    setMinimumMs(env, "LOCAL_TTS_TIMEOUT_MS", 900000);
  }
  if (Number.isInteger(Number(options.localTtsRequestAttempts)) && Number(options.localTtsRequestAttempts) > 0) {
    env.LOCAL_TTS_REQUEST_ATTEMPTS = String(Math.max(1, Math.trunc(Number(options.localTtsRequestAttempts))));
  } else {
    setMinimumInteger(env, "LOCAL_TTS_REQUEST_ATTEMPTS", 3);
  }
  setMinimumMs(env, "LOCAL_TTS_START_WAIT_MS", 120000);
  setMinimumMs(env, "LOCAL_TTS_PREWARM_TIMEOUT_MS", 600000);
  env.LOCAL_TTS_OUTPUT_FORMAT = env.LOCAL_TTS_OUTPUT_FORMAT || "mp3_44100_256";
  configureWhisperRetryEnv(env);
  env.LOCAL_TTS_SEGMENTED_MATERIALIZER = env.LOCAL_TTS_SEGMENTED_MATERIALIZER || "false";
  return env;
}

function configureGoalTtsBatchEnv(env = process.env, { provider = "auto", localTtsTimeoutMs = null, localTtsRequestAttempts = null } = {}) {
  const selected = String(provider || "auto").toLowerCase();
  const localOptions = { localTtsTimeoutMs, localTtsRequestAttempts };
  if (selected === "local") return configureLocalTtsBatchEnv(env, localOptions);
  if (selected === "elevenlabs") {
    env.TTS_PROVIDER = "elevenlabs";
    delete env.PULSE_LOCAL_TTS_ONLY;
    configureWhisperRetryEnv(env);
    return env;
  }
  return configureLocalTtsBatchEnv(env, localOptions);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  configureGoalTtsBatchEnv(process.env, {
    provider: args.provider,
    localTtsTimeoutMs: args.localTtsTimeoutMs,
    localTtsRequestAttempts: args.localTtsRequestAttempts,
  });
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
    ttsRate: args.ttsRate,
    alignmentMode: args.alignmentMode,
    localTtsSegmentedMaterializer: args.localTtsSegmentedMaterializer,
    localTtsSegmentedWordThreshold: args.localTtsSegmentedWordThreshold,
    localTtsSegmentMaxWords: args.localTtsSegmentMaxWords,
    localTtsSegmentGapS: args.localTtsSegmentGapS,
  });
  const written = await writeGoalAudioTimestampMaterializationReport(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalAudioTimestampMaterializationMarkdown(report).trimEnd());
  return { report, written };
}

async function runCli(argv = process.argv.slice(2), {
  exit = process.exit,
  stderr = console.error,
} = {}) {
  try {
    await main(argv);
    exit(0);
  } catch (error) {
    stderr(`[goal-audio-timestamp-materializer] FAILED: ${error.stack || error.message}`);
    exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  configureGoalTtsBatchEnv,
  configureLocalTtsBatchEnv,
  main,
  parseArgs,
  runCli,
  usage,
};
