#!/usr/bin/env node
"use strict";

/**
 * Read-only multi-lane activation proof.
 *
 * This command inspects static module exports and optional local JSON
 * evidence. It never reads tokens, opens a database, calls a network
 * service or invokes an external publisher.
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const {
  buildMultiLaneActivationProof,
  readMultiLaneActivationEvidenceFile,
  renderMultiLaneActivationProofJson,
  renderMultiLaneActivationProofMarkdown,
} = require("../lib/services/multi-lane-activation-proof");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  ROOT,
  "test",
  "output",
  "multi-lane-activation-proof",
);

function parseArgs(argv) {
  const args = {
    evidencePath: null,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    json: false,
    help: false,
    now: new Date().toISOString(),
  };
  const values = argv.slice(2);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--evidence") {
      args.evidencePath = values[++index] || null;
    } else if (value === "--output-dir") {
      args.outputDirectory = values[++index] || null;
    } else if (value === "--now") {
      args.now = values[++index] || null;
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--help" || value === "-h" || value === "-?") {
      args.help = true;
    } else {
      throw new Error(`unknown_argument:${value}`);
    }
  }
  if (!args.outputDirectory) {
    throw new Error("multi_lane_activation_output_directory_required");
  }
  if (!Number.isFinite(Date.parse(args.now || ""))) {
    throw new Error("multi_lane_activation_proof_time_invalid");
  }
  return args;
}

function inspectRepositoryWiring() {
  const { handlers } = require("../lib/job-handlers");
  const {
    MULTI_LANE_SCHEDULER_PROFILE,
    schedulesForProfile,
  } = require("../lib/scheduler");
  const {
    buildMultiLaneWorkerDefinitions,
  } = require("../lib/services/multi-lane-worker-topology");
  return {
    handlers,
    schedulerProfile: MULTI_LANE_SCHEDULER_PROFILE,
    schedules: schedulesForProfile(MULTI_LANE_SCHEDULER_PROFILE),
    workerDefinitions: buildMultiLaneWorkerDefinitions({ handlers }),
    runtimeWiring: inspectRepositoryRuntimeWiring(),
  };
}

function inspectRepositoryRuntimeWiring() {
  const sources = [
    {
      id: "queue_bootstrap",
      path: path.join(ROOT, "lib", "bootstrap-queue.js"),
    },
    {
      id: "server_entrypoint",
      path: path.join(ROOT, "server.js"),
    },
    {
      id: "run_entrypoint",
      path: path.join(ROOT, "run.js"),
    },
  ].map((source) => {
    const bytes = fs.readFileSync(source.path);
    return {
      ...source,
      bytes,
      text: bytes.toString("utf8"),
      binding: {
        component: source.id,
        path: source.path,
        sha256: crypto
          .createHash("sha256")
          .update(bytes)
          .digest("hex"),
        bytes: bytes.length,
        read_only: true,
      },
    };
  });
  const byId = Object.fromEntries(
    sources.map((source) => [source.id, source]),
  );
  const multiLaneDefaultPattern =
    /multiLaneWorkers\s*=\s*process\.env\.PULSE_MULTI_LANE_WORKERS\s*!==\s*["']false["']/s;
  const breakingWatcherDefaultPattern =
    /runBreakingWatcher\s*:\s*process\.env\.BREAKING_WATCHER_ENABLED\s*!==\s*["']false["']/s;
  return {
    schema_version: "pulse-multi-lane-runtime-wiring-v1",
    source_bindings: sources.map((source) => source.binding),
    isolated_worker_pools: {
      default_enabled: multiLaneDefaultPattern.test(
        byId.queue_bootstrap.text,
      ),
    },
    breaking_watcher: {
      server_default_enabled: breakingWatcherDefaultPattern.test(
        byId.server_entrypoint.text,
      ),
      run_default_enabled: breakingWatcherDefaultPattern.test(
        byId.run_entrypoint.text,
      ),
    },
  };
}

function persistReport({ report, outputDirectory }) {
  const resolvedDirectory = path.resolve(outputDirectory);
  fs.mkdirSync(resolvedDirectory, { recursive: true });
  const jsonPath = path.join(
    resolvedDirectory,
    "multi_lane_activation_proof.json",
  );
  const markdownPath = path.join(
    resolvedDirectory,
    "multi_lane_activation_proof.md",
  );
  fs.writeFileSync(
    jsonPath,
    renderMultiLaneActivationProofJson(report),
    "utf8",
  );
  fs.writeFileSync(
    markdownPath,
    renderMultiLaneActivationProofMarkdown(report),
    "utf8",
  );
  return { json_path: jsonPath, markdown_path: markdownPath };
}

function run(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    return {
      help:
        "Usage: node tools/multi-lane-activation-proof.js " +
        "[--evidence FILE] [--output-dir DIR] [--now ISO] [--json]",
      exitCode: 0,
    };
  }
  const loaded = args.evidencePath
    ? readMultiLaneActivationEvidenceFile(args.evidencePath)
    : { evidence: {}, source: null };
  const wiring = inspectRepositoryWiring();
  const report = buildMultiLaneActivationProof({
    now: args.now,
    ...wiring,
    evidence: loaded.evidence,
    evidenceSource: loaded.source,
  });
  const files = persistReport({
    report,
    outputDirectory: args.outputDirectory,
  });
  return {
    report,
    files,
    output: args.json
      ? renderMultiLaneActivationProofJson(report)
      : `${renderMultiLaneActivationProofMarkdown(report)}\n`,
    exitCode: report.aggregate_verdict === "BLOCKED" ? 2 : 0,
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
      `[multi-lane-activation-proof] ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_OUTPUT_DIRECTORY,
  inspectRepositoryRuntimeWiring,
  inspectRepositoryWiring,
  parseArgs,
  persistReport,
  run,
};
