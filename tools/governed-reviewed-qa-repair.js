#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  executeGovernedReviewedQaRepair,
} = require("../lib/ops/governed-reviewed-qa-repair");

const VALUE_FLAGS = new Map([
  ["--database", "databasePath"],
  ["--confirm-database-path", "confirmDatabasePath"],
  ["--backup-evidence", "backupEvidencePath"],
  ["--story-id", "storyId"],
  ["--expected-source-commit", "expectedSourceCommit"],
  ["--expected-runtime-commit", "expectedRuntimeCommit"],
  ["--confirm-story-id", "confirmStoryId"],
  ["--confirm-scheduled-event-id", "confirmScheduledEventId"],
  [
    "--confirm-dispatch-idempotency-key",
    "confirmDispatchIdempotencyKey",
  ],
  ["--confirm-request-fingerprint", "confirmRequestFingerprint"],
  ["--confirm-media-sha256", "confirmMediaSha256"],
  ["--confirm-script-sha256", "confirmScriptSha256"],
  [
    "--confirm-review-manifest-sha256",
    "confirmReviewManifestSha256",
  ],
  ["--actor-id", "actorId"],
  ["--confirm-actor-id", "confirmActorId"],
  ["--reason", "reason"],
  ["--confirm-reason", "confirmReason"],
  ["--change-window-id", "changeWindowId"],
  ["--confirm-change-window-id", "confirmChangeWindowId"],
  ["--generated-at", "generatedAt"],
  ["--out-dir", "outDir"],
]);
const BOOLEAN_FLAGS = new Map([
  ["--apply", "apply"],
  ["--dry-run", "dryRun"],
  ["--help", "help"],
]);

function usage() {
  return [
    "Governed reviewed-QA refusal repair",
    "",
    "Usage:",
    "  node tools/governed-reviewed-qa-repair.js [options]",
    "",
    "Dry-run is the default. It verifies the exact approved media, script,",
    "review chain, expired pre-create admission, stopped runtime and fresh",
    "backup evidence without changing the database.",
    "",
    "Apply additionally requires:",
    "  --apply --database <db> --backup-evidence <file>",
    "  --story-id <id> --confirm-story-id <id>",
    "  --expected-source-commit <40-char SHA>",
    "  --expected-runtime-commit <40-char SHA>",
    "  --confirm-database-path <exact-db-path>",
    "  --confirm-scheduled-event-id <id>",
    "  --confirm-dispatch-idempotency-key <key>",
    "  --confirm-request-fingerprint <sha256>",
    "  --confirm-media-sha256 <sha256>",
    "  --confirm-script-sha256 <sha256>",
    "  --confirm-review-manifest-sha256 <sha256>",
    "  --actor-id <id> --confirm-actor-id <same-id>",
    "  --reason <text> --confirm-reason <same-text>",
    "  --change-window-id <id> --confirm-change-window-id <same-id>",
    "",
    "This command never publishes, invokes an uploader, contacts a platform,",
    "changes OAuth or tokens, or enables autonomous publishing.",
  ].join("\n");
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const errors = [];
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (BOOLEAN_FLAGS.has(token)) {
      args[BOOLEAN_FLAGS.get(token)] = true;
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        errors.push(`missing_value:${token}`);
      } else {
        args[VALUE_FLAGS.get(token)] = value;
        index += 1;
      }
      continue;
    }
    if (token.startsWith("-")) {
      errors.push(`unknown_flag:${token}`);
    } else {
      errors.push(`unexpected_argument:${token}`);
    }
  }
  if (args.apply && args.dryRun) {
    errors.push("apply_and_dry_run_are_mutually_exclusive");
  }
  if (args.confirmScheduledEventId !== undefined) {
    const parsed = Number(args.confirmScheduledEventId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push("confirm_scheduled_event_id_invalid");
    } else {
      args.confirmScheduledEventId = parsed;
    }
  }
  if (errors.length) {
    const error = new Error(
      "governed_reviewed_qa_repair_cli_arguments_invalid",
    );
    error.codes = errors;
    throw error;
  }
  return args;
}

function safeSegment(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .slice(0, 120);
}

function renderMarkdown(result) {
  const blockers = result.blockers?.length
    ? result.blockers.map((blocker) => `- ${blocker}`).join("\n")
    : "- None";
  const resolved = result.qa_failures_resolved?.length
    ? result.qa_failures_resolved
        .map((failure) => `- ${failure}`)
        .join("\n")
    : "- None";
  const stateLabel = (value) =>
    value === true ? "yes" : value === false ? "no" : "unknown";
  return [
    "# Governed reviewed-QA refusal repair",
    "",
    `- Generated: ${result.generated_at || "not resolved"}`,
    `- Mode: ${result.mode}`,
    `- Verdict: ${result.verdict}`,
    `- Story: ${result.story_id || "not resolved"}`,
    `- Platform: ${result.platform || "not resolved"}`,
    `- Scheduled event: ${result.scheduled_event_id || "not resolved"}`,
    `- Mutated: ${result.mutated ? "yes" : "no"}`,
    `- Create boundary entered: ${stateLabel(result.safety?.create_boundary_entered)}`,
    `- External object created: ${stateLabel(result.safety?.external_object_created)}`,
    `- Platform calls performed: ${result.safety?.platform_calls_performed ? "yes" : "no"}`,
    `- OAuth or token changes: ${result.safety?.oauth_or_tokens_mutated ? "yes" : "no"}`,
    `- Secondary platforms contacted: ${result.safety?.secondary_platforms_contacted ? "yes" : "no"}`,
    "",
    "## Resolved QA findings",
    "",
    resolved,
    "",
    "## Blockers",
    "",
    blockers,
    "",
  ].join("\n");
}

function preflightArtifactOutput(outDir) {
  const resolvedOutDir = path.resolve(
    outDir || path.join("output", "governed-reviewed-qa-repair"),
  );
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const probePath = path.join(
    resolvedOutDir,
    `.artifact-write-probe-${process.pid}-${Date.now()}`,
  );
  let handle = null;
  try {
    handle = fs.openSync(probePath, "wx");
    fs.writeFileSync(handle, "proof-output-ready\n", "utf8");
  } finally {
    if (handle !== null) fs.closeSync(handle);
    try {
      fs.unlinkSync(probePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return resolvedOutDir;
}

function safeArtifactError(error) {
  const value = String(error?.message || "").trim();
  return /^[a-zA-Z0-9_.:-]{1,128}$/.test(value)
    ? value
    : "artifact_write_failed";
}

function writeArtifacts(result, outDir) {
  const resolvedOutDir = path.resolve(
    outDir || path.join("output", "governed-reviewed-qa-repair"),
  );
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const stamp = safeSegment(
    String(result.generated_at || new Date().toISOString()).replace(
      /:/g,
      "-",
    ),
  );
  const stem = [
    "governed-reviewed-qa-repair",
    safeSegment(result.story_id),
    stamp,
  ].join("-");
  const jsonPath = path.join(resolvedOutDir, `${stem}.json`);
  const markdownPath = path.join(resolvedOutDir, `${stem}.md`);
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(markdownPath, renderMarkdown(result), "utf8");
  return { json: jsonPath, markdown: markdownPath };
}

async function run(
  argv = process.argv.slice(2),
  env = process.env,
  dependencies = {},
) {
  const args = parseCliArgs(argv);
  if (args.help) {
    return { help: true, text: usage(), exitCode: 0 };
  }
  const preflightArtifacts =
    dependencies.preflightArtifacts || preflightArtifactOutput;
  preflightArtifacts(args.outDir);
  const execute =
    dependencies.execute || executeGovernedReviewedQaRepair;
  const result = await execute({
    ...args,
    apply: args.apply === true,
    env,
  });
  const write =
    dependencies.writeArtifacts || writeArtifacts;
  let artifacts;
  try {
    artifacts = write(result, args.outDir);
  } catch (error) {
    return {
      result: {
        ...result,
        artifacts: null,
        artifact_write_failed: true,
        artifact_error: safeArtifactError(error),
      },
      exitCode: result.mutated === true ? 3 : 1,
    };
  }
  return {
    result: { ...result, artifacts },
    exitCode:
      result.verdict === "READY" || result.verdict === "APPLIED"
        ? 0
        : result.verdict === "HOLD"
          ? 2
          : 1,
  };
}

async function main() {
  try {
    const outcome = await run();
    if (outcome.help) {
      process.stdout.write(`${outcome.text}\n`);
    } else {
      process.stdout.write(
        `${JSON.stringify(outcome.result, null, 2)}\n`,
      );
    }
    process.exitCode = outcome.exitCode;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          schema_version:
            "pulse-governed-reviewed-qa-repair-cli-error-v1",
          verdict: "ERROR",
          errors: Array.isArray(error?.codes)
            ? error.codes
            : [
                String(
                  error?.message ||
                    "governed_reviewed_qa_repair_failed",
                ),
              ],
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  BOOLEAN_FLAGS,
  VALUE_FLAGS,
  parseCliArgs,
  preflightArtifactOutput,
  renderMarkdown,
  run,
  usage,
  writeArtifacts,
};
