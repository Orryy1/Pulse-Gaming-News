#!/usr/bin/env node
"use strict";

/**
 * Read-only local activation-evidence collection.
 *
 * The command reads an exact SHA-256 artefact index and its local proof
 * files, then writes a v2 evidence document. It has no runtime-system or
 * external-platform authority.
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  collectMultiLaneActivationEvidence,
  renderMultiLaneActivationEvidenceJson,
  renderMultiLaneActivationEvidenceMarkdown,
} = require("../lib/services/multi-lane-activation-evidence-collector");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  ROOT,
  "test",
  "output",
  "multi-lane-activation-evidence",
);

function parseArgs(argv = process.argv) {
  const args = {
    indexPath: null,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    now: new Date().toISOString(),
    maxArtifactAgeHours: 7 * 24,
    json: false,
    help: false,
  };
  const values = argv.slice(2);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--index") {
      args.indexPath = values[++index] || null;
    } else if (value === "--output-dir") {
      args.outputDirectory = values[++index] || null;
    } else if (value === "--now") {
      args.now = values[++index] || null;
    } else if (value === "--max-age-hours") {
      args.maxArtifactAgeHours = Number(values[++index]);
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--help" || value === "-h" || value === "-?") {
      args.help = true;
    } else {
      throw new Error(`unknown_argument:${value}`);
    }
  }
  if (!args.outputDirectory) {
    throw new Error(
      "multi_lane_activation_evidence_output_directory_required",
    );
  }
  if (!Number.isFinite(Date.parse(args.now || ""))) {
    throw new Error(
      "multi_lane_activation_evidence_collection_time_invalid",
    );
  }
  if (
    !Number.isFinite(args.maxArtifactAgeHours) ||
    args.maxArtifactAgeHours <= 0
  ) {
    throw new Error(
      "multi_lane_activation_evidence_max_artifact_age_invalid",
    );
  }
  return args;
}

function persistEvidence({ evidence, outputDirectory } = {}) {
  const resolvedDirectory = path.resolve(outputDirectory);
  fs.mkdirSync(resolvedDirectory, { recursive: true });
  const jsonPath = path.join(
    resolvedDirectory,
    "multi_lane_activation_evidence.json",
  );
  const markdownPath = path.join(
    resolvedDirectory,
    "multi_lane_activation_evidence.md",
  );
  fs.writeFileSync(
    jsonPath,
    renderMultiLaneActivationEvidenceJson(evidence),
    "utf8",
  );
  fs.writeFileSync(
    markdownPath,
    renderMultiLaneActivationEvidenceMarkdown(evidence),
    "utf8",
  );
  return {
    json_path: jsonPath,
    markdown_path: markdownPath,
  };
}

function run(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    return {
      help:
        "Usage: node tools/multi-lane-activation-evidence.js " +
        "[--index FILE] [--output-dir DIR] [--now ISO] " +
        "[--max-age-hours NUMBER] [--json]",
      exitCode: 0,
    };
  }
  const evidence = collectMultiLaneActivationEvidence({
    indexPath: args.indexPath,
    now: args.now,
    maxArtifactAgeHours: args.maxArtifactAgeHours,
    repositoryRoot: ROOT,
  });
  const files = persistEvidence({
    evidence,
    outputDirectory: args.outputDirectory,
  });
  return {
    evidence,
    files,
    output: args.json
      ? renderMultiLaneActivationEvidenceJson(evidence)
      : `${renderMultiLaneActivationEvidenceMarkdown(evidence)}\n`,
    exitCode:
      evidence.collection?.verdict === "PROVEN" ? 0 : 2,
  };
}

function main() {
  try {
    const result = run(process.argv);
    if (result.help) {
      process.stdout.write(`${result.help}\n`);
    } else {
      process.stdout.write(result.output);
    }
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(
      `[multi-lane-activation-evidence] ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_OUTPUT_DIRECTORY,
  parseArgs,
  persistEvidence,
  run,
};
