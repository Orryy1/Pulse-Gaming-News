#!/usr/bin/env node
"use strict";

const path = require("node:path");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: false });
}

const {
  buildElevenLabsLocalTtsTrainingCorpus,
  renderElevenLabsLocalTtsTrainingCorpusMarkdown,
  writeElevenLabsLocalTtsTrainingCorpus,
} = require("../lib/elevenlabs-local-tts-training-corpus");

const ROOT = path.resolve(__dirname, "..");

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    roots: [path.join(ROOT, "output")],
    manifestPaths: [],
    workspaceRoot: ROOT,
    outDir: path.join(ROOT, "output", "elevenlabs-local-tts-training-corpus"),
    generatedAt: null,
    operatorTrainingPermission: false,
    minAcceptedSamples: 10,
    minWords: 20,
    evalEvery: 5,
    trainerCommand: "",
    includePlatformVariants: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.roots = [argv[++index] || args.roots[0]];
    else if (arg === "--roots") args.roots = splitList(argv[++index]);
    else if (arg === "--manifest") args.manifestPaths.push(argv[++index]);
    else if (arg === "--manifests") args.manifestPaths.push(...splitList(argv[++index]));
    else if (arg === "--workspace") args.workspaceRoot = argv[++index] || args.workspaceRoot;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--operator-confirmed") args.operatorTrainingPermission = true;
    else if (arg === "--min-samples") args.minAcceptedSamples = Number(argv[++index] || 0);
    else if (arg === "--min-words") args.minWords = Number(argv[++index] || 0);
    else if (arg === "--eval-every") args.evalEvery = Number(argv[++index] || 0);
    else if (arg === "--trainer-command") args.trainerCommand = argv[++index] || "";
    else if (arg === "--include-platform-variants") args.includePlatformVariants = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:elevenlabs-tts-corpus -- [options]",
    "",
    "Options:",
    "  --root <dir>              Root to scan for audio_manifest.json files",
    "  --roots <a,b>             Comma-separated roots to scan",
    "  --manifest <path>         Explicit audio_manifest.json path, repeatable",
    "  --manifests <a,b>         Comma-separated explicit manifest paths",
    "  --workspace <dir>         Workspace root for relative paths",
    "  --out-dir <dir>           Output directory for corpus proof artefacts",
    "  --generated-at <iso>      Fixed timestamp for deterministic reports",
    "  --operator-confirmed      Confirm operator permission to train local model on ElevenLabs outputs",
    "  --min-samples <n>         Minimum accepted samples for PASS",
    "  --min-words <n>           Minimum transcript words per sample",
    "  --eval-every <n>          Put every nth sample into eval split",
    "  --trainer-command <cmd>   Record an approved local trainer command; it is not run",
    "  --include-platform-variants  Include platform-specific extended variants; excluded by default",
    "  --json                    Print JSON report",
    "",
    "LOCAL_PROOF only. This command scans retained ElevenLabs narration artefacts and writes a local training corpus/work order. It does not call ElevenLabs, run a trainer, upload files, mutate DB rows, touch OAuth/tokens or post externally.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const report = await buildElevenLabsLocalTtsTrainingCorpus({
    workspaceRoot: path.resolve(args.workspaceRoot),
    roots: args.roots,
    manifestPaths: args.manifestPaths,
    operatorTrainingPermission: args.operatorTrainingPermission,
    generatedAt: args.generatedAt || new Date().toISOString(),
    minAcceptedSamples: args.minAcceptedSamples,
    minWords: args.minWords,
    evalEvery: args.evalEvery,
    trainerCommand: args.trainerCommand,
    includePlatformVariants: args.includePlatformVariants,
  });
  const written = await writeElevenLabsLocalTtsTrainingCorpus(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderElevenLabsLocalTtsTrainingCorpusMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[elevenlabs-local-tts-training-corpus] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
