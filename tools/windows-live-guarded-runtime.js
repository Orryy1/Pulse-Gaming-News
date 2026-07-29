#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  LIVE_LIFECYCLE_ACTIONS,
  buildLiveRuntimeDoctorReport,
  createDefaultLiveLifecycleHandlers,
  executeLiveLifecycleAction,
  loadLiveGuardedRuntimeProfile,
  runLiveSupervision,
} = require(
  "../lib/stabilisation/windows-live-guarded-runtime",
);

const CLI_ACTIONS = Object.freeze([
  ...LIVE_LIFECYCLE_ACTIONS,
  "supervise",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    action: "doctor",
    applyRequested: false,
    noninteractive: false,
  };
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    options.action = String(argv[0]).trim().toLowerCase();
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      options.applyRequested = true;
      continue;
    }
    if (token === "--noninteractive") {
      options.noninteractive = true;
      continue;
    }
    const mapped = {
      "--repo-root": "repoRoot",
      "--expected-commit": "expectedCommit",
      "--profile-path": "profilePath",
      "--activation-receipt": "activationReceiptPath",
      "--confirm": "confirmation",
      "--operator-id": "operatorId",
      "--reason": "reason",
      "--generated-at": "generatedAt",
      "--youtube-oauth-client-sha256":
        "youtubeOAuthClientSha256",
    }[token];
    if (!mapped) throw new Error(`unknown_option:${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing_value:${token}`);
    }
    options[mapped] = value;
    index += 1;
  }
  if (!CLI_ACTIONS.includes(options.action)) {
    throw new Error(`unknown_live_lifecycle_action:${options.action}`);
  }
  options.repoRoot = path.resolve(
    options.repoRoot || path.resolve(__dirname, ".."),
  );
  options.profilePath = path.resolve(
    options.profilePath || DEFAULT_LIVE_GUARDED_PROFILE_PATH,
  );
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.action === "supervise") {
    if (options.noninteractive !== true) {
      throw new Error(
        "live_supervision_noninteractive_contract_required",
      );
    }
    const result = await runLiveSupervision(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (options.applyRequested && options.generatedAt) {
    throw new Error("operator_generated_at_forbidden");
  }
  const report = buildLiveRuntimeDoctorReport(options);
  const profile = loadLiveGuardedRuntimeProfile({
    profilePath: options.profilePath,
  });
  const execution = await executeLiveLifecycleAction({
    report,
    profile,
    options,
    handlers: createDefaultLiveLifecycleHandlers(),
  });
  const result = {
    ...report,
    execution,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        schema_version:
          "pulse-windows-live-guarded-runtime-error-v1",
        error: String(error?.message || error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  CLI_ACTIONS,
  main,
  parseArgs,
};
