#!/usr/bin/env node
"use strict";

const dotenv = require("dotenv");

const {
  loadDotenvOnce,
} = require("../lib/stabilisation/runtime-config");
const {
  persistWeeklyLongformRuntimeCapabilities,
  probeWeeklyLongformRuntimeCapabilities,
  renderWeeklyLongformRuntimeCapabilitiesJson,
  renderWeeklyLongformRuntimeCapabilitiesMarkdown,
} = require("../lib/services/weekly-longform-runtime-capability-probe");

function parseArgs(argv = process.argv) {
  const args = {
    outputDirectory: null,
    generatedAt: new Date().toISOString(),
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
    } else if (value === "--json") {
      args.json = true;
    } else if (
      value === "--help" ||
      value === "-h" ||
      value === "-?"
    ) {
      args.help = true;
    } else {
      throw new Error(`unknown_argument:${value}`);
    }
  }
  if (!args.help && !args.outputDirectory) {
    throw new Error(
      "weekly_longform_runtime_capability_output_directory_required",
    );
  }
  if (!Number.isFinite(Date.parse(args.generatedAt || ""))) {
    throw new Error("weekly_longform_runtime_capability_time_invalid");
  }
  return args;
}

function run(argv = process.argv, dependencies = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    return {
      help:
        "Usage: node tools/weekly-longform-runtime-capabilities.js " +
        "--output-dir DIR [--now ISO] [--json]",
      exitCode: 0,
    };
  }
  const env = dependencies.env || process.env;
  const dotenvModule = dependencies.dotenv || dotenv;
  const load = dependencies.loadDotenvOnce || loadDotenvOnce;
  const probe =
    dependencies.probe || probeWeeklyLongformRuntimeCapabilities;
  const persist =
    dependencies.persist ||
    persistWeeklyLongformRuntimeCapabilities;

  load({ dotenv: dotenvModule, env });
  const document = probe({
    env,
    generatedAt: args.generatedAt,
  });
  const files = persist({
    document,
    outputDirectory: args.outputDirectory,
  });
  return {
    document,
    files,
    output: args.json
      ? renderWeeklyLongformRuntimeCapabilitiesJson(document)
      : `${renderWeeklyLongformRuntimeCapabilitiesMarkdown(document)}\n`,
    exitCode: document.ready === true ? 0 : 2,
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
      `[weekly-longform-runtime-capabilities] ${
        error?.message || "probe_failed"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  run,
};
