#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const {
  bindRepositories,
} = require("../lib/repositories");
const {
  authoriseGovernedWindowCandidate,
  prepareGovernedWindowCandidateAuthority,
} = require("../lib/services/governed-youtube-window-candidate-authority");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(
        "governed_window_candidate_cli_option_invalid",
      );
    }
    const key = token.slice(2);
    if (
      [
        "apply",
        "confirm-apply-window-candidate-authority",
        "help",
      ].includes(key)
    ) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(
        `governed_window_candidate_cli_value_required:${key}`,
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
      `governed_window_candidate_cli_required:${key}`,
    );
  }
  return value;
}

function databasePath(options) {
  const value = required(options, "database");
  if (!path.isAbsolute(value)) {
    throw new Error(
      "governed_window_candidate_cli_database_must_be_absolute",
    );
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      "governed_window_candidate_cli_database_not_found",
    );
  }
  return resolved;
}

function serviceRequest(options, repos) {
  return {
    repos,
    storyId: required(options, "story-id"),
    role: required(options, "role"),
    scheduledFor: required(options, "scheduled-for"),
    humanReviewAuditId: required(
      options,
      "human-review-audit-id",
    ),
    actorId: required(options, "actor-id"),
    reason: required(options, "reason"),
  };
}

function helpReport() {
  return {
    schema_version:
      "pulse-governed-youtube-window-candidate-cli-help-v1",
    mode: "inspect_by_default",
    required: [
      "--database <absolute-existing-sqlite-path>",
      "--story-id <exact-story-id>",
      "--role <PRIMARY|STANDBY>",
      "--scheduled-for <exact-09:00-or-19:00-UTC-ISO>",
      "--human-review-audit-id <exact-latest-audit-id>",
      "--actor-id <operator-id>",
      "--reason <operator-reason>",
    ],
    apply_requires: [
      "--apply",
      "--confirm-apply-window-candidate-authority",
      "--confirm-story-id <same-story-id>",
      "--confirm-role <same-role>",
      "--confirm-scheduled-for <same-scheduled-for>",
      "--confirm-authority-binding-sha256 <inspection-hash>",
    ],
    safety: {
      migrations_run: false,
      publish_authority_created: false,
      external_posting: false,
      oauth_or_tokens_mutated: false,
    },
  };
}

function execute(options) {
  if (options.help) return helpReport();
  const target = databasePath(options);
  const apply = options.apply === true;
  const db = new Database(target, {
    readonly: !apply,
    fileMustExist: true,
  });
  try {
    db.pragma("foreign_keys = ON");
    const repos = bindRepositories(db);
    const request = serviceRequest(options, repos);
    if (!apply) {
      return prepareGovernedWindowCandidateAuthority(request);
    }
    if (
      options["confirm-apply-window-candidate-authority"] !==
      true
    ) {
      throw new Error(
        "governed_window_candidate_cli_apply_confirmation_required",
      );
    }
    return authoriseGovernedWindowCandidate({
      ...request,
      confirmStoryId: required(options, "confirm-story-id"),
      confirmRole: required(options, "confirm-role"),
      confirmScheduledFor: required(
        options,
        "confirm-scheduled-for",
      ),
      confirmAuthorityBindingSha256: required(
        options,
        "confirm-authority-binding-sha256",
      ),
    });
  } finally {
    db.close();
  }
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const result = execute(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schema_version:
          "pulse-governed-youtube-window-candidate-cli-error-v1",
        verdict: "HOLD",
        error:
          error?.code ||
          error?.message ||
          "governed_window_candidate_cli_failed",
        database_mutated: false,
        publish_authority_created: false,
        external_posting: false,
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
  main,
  parseArgs,
};
