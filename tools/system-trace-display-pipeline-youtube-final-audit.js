#!/usr/bin/env node
"use strict";

const path = require("node:path");

const { main: runFixedAudit } = require("./system-trace-youtube-final-audit");

const REPO_ROOT = path.resolve(__dirname, "..");
const CONTRACT = Object.freeze({
  manifestSha256: "eec3a11928909fae7d1696b0f0cf4d90eac8ade6e2bec161811dfc9859725818",
  channelId: "UCvgNDjtTezrpxL8oUe6mYwA",
  episodes: Object.freeze([
    Object.freeze(["system-trace-screen-tearing", "2026-08-22T17:00:00.000Z"]),
    Object.freeze(["system-trace-vsync-latency", "2026-08-23T17:00:00.000Z"]),
    Object.freeze(["system-trace-variable-refresh-rate", "2026-08-24T17:00:00.000Z"]),
    Object.freeze(["system-trace-hdr-tone-mapping", "2026-08-25T17:00:00.000Z"]),
    Object.freeze(["system-trace-anti-aliasing", "2026-08-26T17:00:00.000Z"]),
    Object.freeze(["system-trace-motion-blur", "2026-08-27T17:00:00.000Z"]),
    Object.freeze(["system-trace-frame-generation", "2026-08-28T17:00:00.000Z"]),
  ]),
});
const DEFAULT_PATHS = Object.freeze({
  repoRoot: REPO_ROOT,
  evidenceRoot: "D:\\pulse-evidence\\system-trace-display-pipeline-buffer-20260820",
  tokenPath: "C:\\Users\\MORR\\gaming-studio\\pulse-gaming\\tokens\\youtube_token.json",
  manifestFile: "system-trace-display-pipeline-youtube-buffer.json",
  jsonFile: "final-youtube-buffer-audit.json",
  markdownFile: "final-youtube-buffer-audit.md",
});

function usage() {
  return [
    "Usage: node tools/system-trace-display-pipeline-youtube-final-audit.js",
    "",
    "Runs the fixed, read-only final YouTube audit for the exact 22-28 August",
    "Display Pipeline buffer. No caller paths or mutation options are accepted.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log || console.log;
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    log(usage());
    return { help: true };
  }
  if (argv.length !== 0) throw new Error(`unknown_argument:${argv[0]}`);
  return (deps.run || runFixedAudit)([], {
    paths: DEFAULT_PATHS,
    contract: CONTRACT,
    expectedManifestSha256: CONTRACT.manifestSha256,
    authenticatedReadOnlyYoutubeClientFactory:
      deps.authenticatedReadOnlyYoutubeClientFactory,
    generatedAt: deps.generatedAt,
    log,
  });
}

if (require.main === module) {
  main().then(
    (result) => {
      if (!result?.help && result?.report?.verdict !== "GREEN") process.exitCode = 2;
    },
    (error) => {
      console.error(`[display-pipeline-youtube-final-audit] BLOCKED: ${error.message || error}`);
      process.exitCode = 2;
    },
  );
}

module.exports = { CONTRACT, DEFAULT_PATHS, main, usage };
