#!/usr/bin/env node
"use strict";

const {
  materialiseSystemTraceYouTubePackage,
} = require("../lib/services/system-trace-youtube-package");

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    packageDir: null,
    manifest: null,
    storyId: null,
    materialise: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--package-dir") parsed.packageDir = argv[++index] || null;
    else if (arg === "--manifest") parsed.manifest = argv[++index] || null;
    else if (arg === "--story-id") parsed.storyId = argv[++index] || null;
    else if (arg === "--materialise") parsed.materialise = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`unknown_argument:${arg}`);
  }
  return parsed;
}

function usage() {
  return [
    "Usage: node tools/system-trace-youtube-package.js [options]",
    "",
    "Required:",
    "  --package-dir <path>",
    "  --manifest <path>",
    "  --story-id <id>",
    "  --materialise",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    log(usage());
    return { help: true };
  }
  if (args.materialise !== true) throw new Error("explicit_materialise_required");
  if (!args.packageDir || !args.manifest || !args.storyId) {
    throw new Error("package_dir_manifest_and_story_id_required");
  }
  const result = await materialiseSystemTraceYouTubePackage({
    packageRoot: args.packageDir,
    manifestPath: args.manifest,
    storyId: args.storyId,
  });
  log(
    `[system-trace-youtube-package] materialised ${args.storyId}: ` +
    result.artefacts.publish_pack_path,
  );
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[system-trace-youtube-package] BLOCKED: ${error.message}`);
    process.exitCode = 2;
  });
}

module.exports = { main, parseArgs, usage };
