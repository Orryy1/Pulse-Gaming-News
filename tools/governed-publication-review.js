#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  GovernedPublicationReviewError,
  executeGovernedPublicationReview,
} = require("../lib/services/governed-publication-review");

const VALUE_FLAGS = new Map([
  ["--manifest", "manifestPath"],
  ["--database", "databasePath"],
  ["--backup-evidence", "backupEvidencePath"],
  ["--confirm-story-id", "confirmStoryId"],
  ["--confirm-media-sha256", "confirmMediaSha256"],
  ["--confirm-script-sha256", "confirmScriptSha256"],
  ["--actor-id", "actorId"],
  ["--reason", "reason"],
  ["--generated-at", "generatedAt"],
  ["--out-dir", "outDir"],
  ["--ffprobe", "ffprobePath"],
  ["--probe-timeout-ms", "probeTimeoutMs"],
]);
const BOOLEAN_FLAGS = new Map([
  ["--apply", "apply"],
  ["--dry-run", "dryRun"],
  ["--help", "help"],
]);

function usage() {
  return [
    "Governed Pulse Gaming final publication review",
    "",
    "Usage:",
    "  node tools/governed-publication-review.js --manifest <file> [options]",
    "",
    "Dry-run is the default. It validates all local files and independently",
    "probes the final MP4, but never changes the database or publishes.",
    "",
    "A database write additionally requires:",
    "  --apply --database <db> --backup-evidence <file>",
    "  --confirm-story-id <id>",
    "  --confirm-media-sha256 <sha256>",
    "  --confirm-script-sha256 <sha256>",
    "  --actor-id <id> --reason <text>",
    "",
    "This command never admits a publication, loads an uploader, makes an",
    "external request, changes OAuth or creates a platform object.",
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
  if (args.probeTimeoutMs !== undefined) {
    const parsed = Number(args.probeTimeoutMs);
    if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 120000) {
      errors.push("probe_timeout_ms_invalid");
    } else {
      args.probeTimeoutMs = parsed;
    }
  }
  if (errors.length) {
    const error = new Error(
      "governed_publication_review_cli_arguments_invalid",
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
  return [
    "# Governed final publication review",
    "",
    `- Generated: ${result.generated_at}`,
    `- Mode: ${result.mode}`,
    `- Verdict: ${result.verdict}`,
    `- Story: ${result.story_id || "not resolved"}`,
    `- Channel: ${result.channel_id || "not resolved"}`,
    `- Mutated: ${result.mutated ? "yes" : "no"}`,
    `- Idempotent replay: ${result.idempotent ? "yes" : "no"}`,
    `- Review manifest SHA-256: ${result.review_manifest_sha256 || "not resolved"}`,
    `- Script SHA-256: ${result.script_sha256 || "not resolved"}`,
    `- Media SHA-256: ${result.media_sha256 || "not resolved"}`,
    "- Publish or admission performed: no",
    "- External calls: none",
    "- OAuth or token changes: none",
    "",
    "## Blockers",
    "",
    blockers,
    "",
  ].join("\n");
}

function writeArtifacts(result, outDir) {
  const resolvedOutDir = path.resolve(
    outDir || path.join("output", "governed-publication-review"),
  );
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const stamp = safeSegment(
    String(result.generated_at || "").replace(/:/g, "-"),
  );
  const stem = [
    "publication-review",
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
    return {
      help: true,
      text: usage(),
      exitCode: 0,
    };
  }
  const execute =
    dependencies.execute || executeGovernedPublicationReview;
  const result = await execute({
    ...args,
    apply: args.apply === true,
    env,
  });
  const artifacts = writeArtifacts(result, args.outDir);
  return {
    result: { ...result, artifacts },
    exitCode: result.verdict === "HOLD" ? 2 : 0,
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
    const errors =
      error instanceof GovernedPublicationReviewError
        ? error.codes
        : Array.isArray(error.codes)
          ? error.codes
          : [
              textError(
                error,
                "governed_publication_review_failed",
              ),
            ];
    process.stderr.write(
      `${JSON.stringify(
        {
          schema_version:
            "pulse-governed-publication-review-cli-error-v1",
          verdict: "ERROR",
          errors,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

function textError(error, fallback) {
  return String(error?.message || fallback).trim();
}

if (require.main === module) {
  main();
}

module.exports = {
  BOOLEAN_FLAGS,
  VALUE_FLAGS,
  parseCliArgs,
  renderMarkdown,
  run,
  usage,
  writeArtifacts,
};
