#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  DEFAULT_TIMEOUT_MS,
  generateMultiLaneActivationStageProofs,
} = require("../lib/services/multi-lane-activation-stage-proof-generator");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  ROOT,
  "test",
  "output",
  "multi-lane-activation-stage-proofs",
);

function parseArgs(argv = process.argv) {
  const args = {
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    generatedAt: new Date().toISOString(),
    runtimeCapabilitiesPath: null,
    runtimeCapabilitiesSha256: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
    help: false,
  };
  const values = argv.slice(2);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--output-dir") {
      args.outputDirectory = values[++index] || null;
    } else if (value === "--now") {
      args.generatedAt = values[++index] || null;
    } else if (value === "--runtime-capabilities") {
      args.runtimeCapabilitiesPath = values[++index] || null;
    } else if (value === "--runtime-capabilities-sha256") {
      args.runtimeCapabilitiesSha256 = values[++index] || null;
    } else if (value === "--timeout-ms") {
      args.timeoutMs = Number(values[++index]);
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
      "multi_lane_activation_stage_proof_output_directory_required",
    );
  }
  if (!Number.isFinite(Date.parse(args.generatedAt || ""))) {
    throw new Error(
      "multi_lane_activation_stage_proof_generated_at_invalid",
    );
  }
  if (
    !Number.isInteger(args.timeoutMs) ||
    args.timeoutMs < 1000 ||
    args.timeoutMs > 15 * 60 * 1000
  ) {
    throw new Error(
      "multi_lane_activation_stage_proof_timeout_invalid",
    );
  }
  if (
    Boolean(args.runtimeCapabilitiesPath) !==
    Boolean(args.runtimeCapabilitiesSha256)
  ) {
    throw new Error(
      "runtime_capabilities_path_and_sha256_required_together",
    );
  }
  return args;
}

function renderSummary(result) {
  const blockers = Array.isArray(result.blockers)
    ? result.blockers.filter(Boolean)
    : [];
  return [
    "# Pulse Gaming Multi-lane Activation Stage Proofs",
    "",
    `Generated: ${result.generated_at}`,
    `Verdict: ${result.verdict}`,
    `All 12 focused stage tests passed: ${result.all_stage_tests_passed ? "Yes" : "No"}`,
    `All required stage checks proven: ${result.all_stage_checks_proven ? "Yes" : "No"}`,
    `Runtime capabilities: ${result.runtime_capabilities?.availability || "UNAVAILABLE"}`,
    `Artifact index: \`${result.index_path}\``,
    "",
    "## Safety",
    "",
    `Network used: ${result.safety?.network_used ? "Yes" : "No"}`,
    `Production database accessed: ${result.safety?.production_database_accessed ? "Yes" : "No"}`,
    `Ephemeral in-memory test database used: ${result.safety?.ephemeral_in_memory_test_database_used ? "Yes" : "No"}`,
    `OAuth accessed: ${result.safety?.oauth_accessed ? "Yes" : "No"}`,
    `Publishing action invoked: ${result.safety?.publish_action_invoked ? "Yes" : "No"}`,
    "",
    "## Blockers",
    "",
    ...(blockers.length
      ? blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "A BLOCKED verdict means exact stage evidence or supplied runtime truth is still incomplete.",
    "",
  ].join("\n");
}

function run(argv = process.argv, dependencies = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    return {
      help:
        "Usage: node tools/multi-lane-activation-stage-proofs.js " +
        "[--output-dir DIR] [--now ISO] [--timeout-ms NUMBER] " +
        "[--runtime-capabilities FILE " +
        "--runtime-capabilities-sha256 SHA256] [--json]",
      exitCode: 0,
    };
  }
  const generate =
    dependencies.generate || generateMultiLaneActivationStageProofs;
  const result = generate({
    repository_root: ROOT,
    output_dir: args.outputDirectory,
    generated_at: args.generatedAt,
    runtime_capabilities_path: args.runtimeCapabilitiesPath,
    runtime_capabilities_sha256: args.runtimeCapabilitiesSha256,
    timeout_ms: args.timeoutMs,
  });
  return {
    result,
    output: args.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${renderSummary(result)}\n`,
    exitCode: result.verdict === "PROVEN" ? 0 : 2,
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
      `[multi-lane-activation-stage-proofs] ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_OUTPUT_DIRECTORY,
  parseArgs,
  renderSummary,
  run,
};
