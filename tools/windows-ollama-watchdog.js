#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  buildWatchdogScheduledTaskPlan,
  runOllamaWatchdog,
} = require("../lib/stabilisation/windows-ollama-watchdog");
const {
  loadSafeRuntimeProfile,
  validateSafeRuntimeProfile,
} = require("../lib/stabilisation/windows-local-runtime-supervisor");

const PROFILE_FILES = Object.freeze({
  governed_multi_lane: "windows-local-runtime.governed-multi-lane.json",
  stabilisation_30d: "windows-local-runtime.stabilisation.json",
});

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    action: "status",
    profileSelector: "governed_multi_lane",
    generatedAt: null,
  };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    options.action = String(argv[0]).toLowerCase();
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    const key = {
      "-p": "profileSelector",
      "--profile": "profileSelector",
      "--generated-at": "generatedAt",
    }[token];
    if (!key) throw new Error(`unexpected_argument:${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`missing_value:${token}`);
    }
    options[key] = value;
    index += 1;
  }
  if (!["ensure", "status", "plan"].includes(options.action)) {
    throw new Error(`unknown_watchdog_action:${options.action}`);
  }
  if (!PROFILE_FILES[options.profileSelector]) {
    throw new Error(
      `unknown_profile_selector:${options.profileSelector}`,
    );
  }
  if (
    options.generatedAt &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      options.generatedAt,
    )
  ) {
    throw new Error("generated_at_invalid");
  }
  return options;
}

async function main(
  argv = process.argv.slice(2),
  {
    repoRoot = path.resolve(__dirname, ".."),
    nodeExecutable = process.execPath,
    writeOutput = (value) => process.stdout.write(value),
  } = {},
) {
  const options = parseArgs(argv);
  let result;
  if (options.action === "plan") {
    result = buildWatchdogScheduledTaskPlan({
      repoRoot,
      nodeExecutable,
    });
  } else {
    const profile = loadSafeRuntimeProfile({
      profilePath: path.join(
        repoRoot,
        "config",
        PROFILE_FILES[options.profileSelector],
      ),
    });
    const validation = validateSafeRuntimeProfile(profile);
    if (!validation.valid) {
      throw new Error(
        `safe_runtime_profile_invalid:${validation.blockers.join(",")}`,
      );
    }
    result = await runOllamaWatchdog({
      mode: options.action,
      profile,
      generatedAt: options.generatedAt || new Date().toISOString(),
    });
  }
  writeOutput(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main()
    .then((result) => {
      if (
        result?.schema_version ===
          "pulse-windows-ollama-watchdog-status-v1" &&
        result.ready !== true &&
        result.outcome !== "lock_busy"
      ) {
        process.exitCode = 2;
      }
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          schema_version: "pulse-windows-ollama-watchdog-error-v1",
          error_code: String(error?.message || "watchdog_failed").split(
            ":",
            1,
          )[0],
        })}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  PROFILE_FILES,
  main,
  parseArgs,
};
