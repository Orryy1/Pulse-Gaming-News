#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: false });
}

const {
  buildCinematicSoundscapeGenerationPlan,
  materializeCinematicSoundscapePack,
} = require("../lib/elevenlabs-cinematic-soundscape-generator");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    materialize: false,
    audioOutputDir: path.join(
      ROOT,
      "audio",
      "elevenlabs",
      "sfx",
      "cinematic-v1",
    ),
    governanceOutputDir: path.join(
      ROOT,
      "output",
      "elevenlabs-cinematic-soundscapes",
    ),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--materialize") args.materialize = true;
    else if (arg === "--audio-output-dir") {
      args.audioOutputDir = argv[++index] || args.audioOutputDir;
    } else if (arg === "--out-dir") {
      args.governanceOutputDir = argv[++index] || args.governanceOutputDir;
    } else if (arg === "--generated-at") {
      args.generatedAt = argv[++index] || null;
    } else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:elevenlabs-cinematic-soundscapes -- [options]",
    "",
    "Options:",
    "  --materialize                 Call ElevenLabs and create the governed pack",
    "  --audio-output-dir <dir>      Generated audio and sidecar directory",
    "  --out-dir <dir>               Governance and runtime-manifest directory",
    "  --generated-at <iso>          Fixed timestamp for deterministic proof",
    "  --json                        Print the result as JSON",
    "",
    "The default is a zero-cost LOCAL_PROOF plan. --materialize consumes ElevenLabs credits",
    "but never publishes, mutates OAuth, changes tokens or writes production database rows.",
  ].join("\n");
}

function renderPlanMarkdown(plan = {}) {
  const lines = [
    "# Pulse cinematic soundscape generation plan",
    "",
    `Generated: ${plan.generated_at || ""}`,
    `Estimated ElevenLabs credits: ${Number(plan.estimated_credit_cost || 0)}`,
    "",
    "## Slots",
    "",
  ];
  for (const slot of plan.slots || []) {
    lines.push(
      `- ${slot.role}: ${slot.duration_seconds}s seamless loop, estimated ${slot.estimated_credit_cost} credits`,
    );
  }
  lines.push(
    "",
    "The plan is narration-first. Generated sounds are secondary layers for finished editorial video only and may not be redistributed as isolated assets.",
    "",
    "No API call, publishing, OAuth mutation or production database mutation occurred in plan mode.",
  );
  return `${lines.join("\n")}\n`;
}

async function writePlan(plan, outputDir) {
  const resolved = path.resolve(outputDir);
  await fs.ensureDir(resolved);
  const jsonPath = path.join(
    resolved,
    "elevenlabs_cinematic_soundscape_generation_plan.json",
  );
  const markdownPath = path.join(
    resolved,
    "elevenlabs_cinematic_soundscape_generation_plan.md",
  );
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(markdownPath, renderPlanMarkdown(plan), "utf8");
  return { jsonPath, markdownPath };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const generatedAt = args.generatedAt || new Date().toISOString();
  if (!args.materialize) {
    const plan = buildCinematicSoundscapeGenerationPlan({ generatedAt });
    const written = await writePlan(plan, args.governanceOutputDir);
    if (args.json) console.log(JSON.stringify({ plan, written }, null, 2));
    else {
      console.log(renderPlanMarkdown(plan).trimEnd());
      console.log(`Plan: ${written.jsonPath}`);
    }
    return { mode: "plan", plan, written };
  }

  const result = await materializeCinematicSoundscapePack({
    workspaceRoot: ROOT,
    audioOutputDir: args.audioOutputDir,
    governanceOutputDir: args.governanceOutputDir,
    generatedAt,
    apiKey: process.env.ELEVENLABS_API_KEY,
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `Cinematic soundscapes: ${result.governance.verdict} ` +
        `(${result.assets.length} assets, ${result.generation_receipt.credits_reported} credits reported)`,
    );
    console.log(`Runtime manifest: ${result.written.sfxRuntimeManifest}`);
  }
  return { mode: "materialize", ...result };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `[elevenlabs-cinematic-soundscapes] FAILED: ${error.stack || error.message}`,
    );
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
  renderPlanMarkdown,
  usage,
  writePlan,
};
