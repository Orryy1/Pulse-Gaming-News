#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  LIFECYCLE_ACTIONS,
  buildSupervisorReport,
  createDefaultLifecycleHandlers,
  executeLifecycleAction,
  loadSafeRuntimeProfile,
} = require("../lib/stabilisation/windows-local-runtime-supervisor");

const PROFILE_SELECTOR_FILES = Object.freeze({
  stabilisation_30d: "windows-local-runtime.stabilisation.json",
  governed_multi_lane:
    "windows-local-runtime.governed-multi-lane.json",
});

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    action: "plan",
    applyRequested: false,
  };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("--")) {
    options.action = String(argv[0]).toLowerCase();
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply" || token === "-a") {
      options.applyRequested = true;
      continue;
    }
    const shortKey = {
      "-r": "repoRoot",
      "-e": "expectedCommit",
      "-c": "confirmation",
      "-p": "profileSelector",
    }[token];
    if (!token.startsWith("--") && !shortKey) {
      throw new Error(`unexpected_argument:${token}`);
    }
    const key = token.startsWith("--") ? token.slice(2) : null;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing_value:${token}`);
    }
    index += 1;
    const mapped =
      shortKey ||
      {
        "repo-root": "repoRoot",
        "expected-commit": "expectedCommit",
        "db-path": "dbPath",
        confirm: "confirmation",
        "generated-at": "generatedAt",
        "profile-path": "profilePath",
        profile: "profileSelector",
      }[key];
    if (!mapped) throw new Error(`unknown_option:${token}`);
    options[mapped] = value;
  }
  if (!LIFECYCLE_ACTIONS.includes(options.action)) {
    throw new Error(`unknown_lifecycle_action:${options.action}`);
  }
  options.repoRoot = path.resolve(
    options.repoRoot || path.resolve(__dirname, ".."),
  );
  if (options.profilePath && options.profileSelector) {
    throw new Error("profile_path_and_selector_conflict");
  }
  if (options.profileSelector) {
    const fileName = PROFILE_SELECTOR_FILES[options.profileSelector];
    if (!fileName) {
      throw new Error(
        `unknown_profile_selector:${options.profileSelector}`,
      );
    }
    options.profilePath = path.join(
      options.repoRoot,
      "config",
      fileName,
    );
  } else if (options.profilePath) {
    options.profilePath = path.resolve(
      options.repoRoot,
      options.profilePath,
    );
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await buildSupervisorReport(options);
  const profile = loadSafeRuntimeProfile({
    profilePath: options.profilePath,
  });
  const execution = await executeLifecycleAction({
    report,
    profile,
    options,
    lifecycle: createDefaultLifecycleHandlers(),
  });
  const result = { ...report, execution };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        schema_version: "pulse-windows-local-runtime-error-v1",
        error: String(error?.message || error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  PROFILE_SELECTOR_FILES,
  main,
  parseArgs,
};
