#!/usr/bin/env node
"use strict";

const path = require("node:path");
require("dotenv").config({ quiet: true });

const {
  materializeElevenLabsCommercialRightsEvidence,
} = require("../lib/elevenlabs-commercial-rights-evidence");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    artifactDir: "",
    storyId: "",
    assetId: "",
    audioPath: "",
    modelId: "eleven_multilingual_v2",
    targetPlatforms: [
      "youtube_shorts",
      "instagram_reels",
      "facebook_reels",
    ],
    generatedAt: "",
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact-dir") args.artifactDir = argv[++index] || "";
    else if (arg === "--story-id") args.storyId = argv[++index] || "";
    else if (arg === "--asset-id") args.assetId = argv[++index] || "";
    else if (arg === "--audio") args.audioPath = argv[++index] || "";
    else if (arg === "--model-id") args.modelId = argv[++index] || args.modelId;
    else if (arg === "--platforms") {
      args.targetPlatforms = String(argv[++index] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--generated-at") args.generatedAt = argv[++index] || "";
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:elevenlabs-rights-evidence -- --artifact-dir <dir> --story-id <id> --audio <path> [options]",
    "",
    "Reads the current ElevenLabs subscription status and writes a sanitised,",
    "audio-bound entitlement snapshot. A current lookup cannot prove that older",
    "audio was generated while paid, so this command remains AMBER unless a",
    "separate generation-time request/history lineage already exists. It never",
    "records the API key, personal account data, invoices or payment details and",
    "performs no mutation.",
    "",
    "Options:",
    "  --asset-id <id>       Rights asset ID; defaults to <story-id>_audio_path",
    "  --model-id <id>       ElevenLabs model used for the current narration",
    "  --platforms <keys>     Comma-separated target platform keys",
    "  --generated-at <iso>   Claimed audio generation time; never used as retrieval time",
    "  --json                 Print sanitised JSON result",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  if (!args.artifactDir) throw new Error("--artifact-dir is required");
  if (!args.storyId) throw new Error("--story-id is required");
  if (!args.audioPath) throw new Error("--audio is required");
  const result = await materializeElevenLabsCommercialRightsEvidence({
    artifactDir: path.resolve(ROOT, args.artifactDir),
    storyId: args.storyId,
    assetId: args.assetId || `${args.storyId}_audio_path`,
    audioPath: path.resolve(ROOT, args.audioPath),
    modelId: args.modelId,
    targetPlatforms: args.targetPlatforms,
    generatedAt: args.generatedAt || new Date().toISOString(),
    apiKey: process.env.ELEVENLABS_API_KEY,
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`ElevenLabs current entitlement evidence: ${result.verdict}`);
    console.log(`Evidence: ${result.evidence_path}`);
    console.log(`Blockers: ${result.evidence.blockers.join(", ") || "none"}`);
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[elevenlabs-rights-evidence] FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
