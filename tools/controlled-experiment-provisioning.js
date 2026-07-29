#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const {
  bind: bindControlledExperiments,
} = require("../lib/repositories/controlled_video_experiments");
const {
  inspectControlledExperimentProvisioning,
  provisionControlledExperiment,
} = require("../lib/services/controlled-experiment-provisioning");

const BOOLEAN_OPTIONS = new Set([
  "apply",
  "confirm-provision-controlled-experiment",
  "help",
]);
const VALUE_OPTIONS = new Set([
  "database",
  "experiment-id",
  "channel-id",
  "confirm-plan-sha256",
  "output",
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(
        "controlled_experiment_provisioning_cli_option_invalid",
      );
    }
    const key = token.slice(2);
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(key)) {
      throw new Error(
        `controlled_experiment_provisioning_cli_option_unknown:${key}`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(
        `controlled_experiment_provisioning_cli_value_required:${key}`,
      );
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function required(options, key) {
  const value = String(options[key] || "").trim();
  if (!value) {
    throw new Error(
      `controlled_experiment_provisioning_cli_required:${key}`,
    );
  }
  return value;
}

function absoluteExistingDatabase(options) {
  const value = required(options, "database");
  if (!path.isAbsolute(value)) {
    throw new Error(
      "controlled_experiment_provisioning_cli_database_must_be_absolute",
    );
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      "controlled_experiment_provisioning_cli_database_not_found",
    );
  }
  return resolved;
}

function optionalAbsoluteOutput(options) {
  const value = String(options.output || "").trim();
  if (!value) return null;
  if (!path.isAbsolute(value)) {
    throw new Error(
      "controlled_experiment_provisioning_cli_output_must_be_absolute",
    );
  }
  return path.resolve(value);
}

function writeImmutableReport(filePath, report) {
  if (!filePath) return;
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });
  if (fs.existsSync(filePath)) {
    if (fs.readFileSync(filePath, "utf8") !== bytes) {
      throw new Error(
        "controlled_experiment_provisioning_cli_output_conflict",
      );
    }
    return;
  }
  const temporary = `${filePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, bytes, {
      encoding: "utf8",
      flag: "wx",
    });
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.rmSync(temporary, { force: true });
    }
  }
}

function helpReport() {
  return {
    schema_version:
      "pulse-controlled-experiment-provisioning-cli-help-v1",
    mode: "inspect_read_only_by_default",
    inspect_requires: [
      "--database <absolute-existing-sqlite-path>",
      "--experiment-id <exact-experiment-id>",
      "--channel-id <exact-channel-id>",
    ],
    apply_requires: [
      "--apply",
      "--confirm-provision-controlled-experiment",
      "--confirm-plan-sha256 <exact-inspection-plan-sha256>",
    ],
    optional: [
      "--output <absolute-immutable-json-proof-path>",
    ],
    safety: {
      migrations_run: false,
      database_mutated_by_default: false,
      publish_authority_created: false,
      external_posting: false,
      oauth_or_tokens_mutated: false,
    },
  };
}

function execute(options) {
  if (options.help) return helpReport();
  const databasePath = absoluteExistingDatabase(options);
  const outputPath = optionalAbsoluteOutput(options);
  const experimentId = required(
    options,
    "experiment-id",
  );
  const channelId = required(options, "channel-id");
  const apply = options.apply === true;
  const db = new Database(databasePath, {
    readonly: !apply,
    fileMustExist: true,
  });
  let report;
  try {
    db.pragma("foreign_keys = ON");
    const channel = db
      .prepare("SELECT id FROM channels WHERE id = ?")
      .get(channelId);
    if (!channel) {
      throw new Error(
        "controlled_experiment_provisioning_cli_channel_not_found",
      );
    }
    const controlledExperiments =
      bindControlledExperiments(db);
    const request = {
      controlledExperiments,
      experimentId,
      channelId,
    };
    if (!apply) {
      report =
        inspectControlledExperimentProvisioning(request);
    } else {
      if (
        options[
          "confirm-provision-controlled-experiment"
        ] !== true
      ) {
        throw new Error(
          "controlled_experiment_provisioning_cli_apply_confirmation_required",
        );
      }
      report = provisionControlledExperiment({
        ...request,
        confirmProvision: true,
        confirmPlanSha256: required(
          options,
          "confirm-plan-sha256",
        ),
      });
    }
  } finally {
    db.close();
  }
  writeImmutableReport(outputPath, report);
  return report;
}

function main(argv = process.argv.slice(2)) {
  try {
    const report = execute(parseArgs(argv));
    process.stdout.write(
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schema_version:
          "pulse-controlled-experiment-provisioning-cli-error-v1",
        verdict: "HOLD",
        error:
          error?.code ||
          error?.message ||
          "controlled_experiment_provisioning_cli_failed",
        database_mutated: false,
        publish_authority_created: false,
        external_posting: false,
        oauth_or_tokens_mutated: false,
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  execute,
  helpReport,
  main,
  parseArgs,
};
