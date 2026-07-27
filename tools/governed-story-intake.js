#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  ACTIONS,
  GovernedStoryIntakeError,
  executeGovernedStoryIntake,
} = require("../lib/services/governed-story-intake");

const VALUE_FLAGS = new Map([
  ["--manifest", "manifestPath"],
  ["--database", "databasePath"],
  ["--backup-evidence", "backupEvidencePath"],
  ["--story-id", "storyId"],
  ["--confirm-story-id", "confirmStoryId"],
  ["--actor-id", "actorId"],
  ["--reason", "reason"],
  ["--script-sha256", "scriptSha256"],
  ["--asset-manifest", "assetManifestPath"],
  ["--asset-manifest-sha256", "assetManifestSha256"],
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
    "Governed Pulse Gaming story intake",
    "",
    "Usage:",
    "  node tools/governed-story-intake.js ingest --manifest <file> [options]",
    "  node tools/governed-story-intake.js approve-script --story-id <id> [options]",
    "  node tools/governed-story-intake.js attach-owned-assets --story-id <id> --asset-manifest <file> --asset-manifest-sha256 <sha> [options]",
    "",
    "Dry-run is the default. A database write requires --apply plus:",
    "  --database --backup-evidence --confirm-story-id --actor-id --reason",
    "Ingest and approve-script also require --script-sha256.",
    "",
    "Optional initial owned assets:",
    "  ingest ... --asset-manifest <file> --asset-manifest-sha256 <sha>",
  ].join("\n");
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const errors = [];
  const args = {};
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    args.action = argv[0];
    index = 1;
  } else {
    args.action = "ingest";
  }
  if (!ACTIONS.has(args.action)) {
    errors.push(`invalid_action:${args.action}`);
  }
  for (; index < argv.length; index += 1) {
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
  if (errors.length) {
    const error = new Error("governed_story_intake_cli_arguments_invalid");
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
    "# Governed story intake result",
    "",
    `- Action: ${result.action}`,
    `- Mode: ${result.mode}`,
    `- Verdict: ${result.verdict}`,
    `- Story: ${result.story_id || "not resolved"}`,
    `- Mutated: ${result.mutated ? "yes" : "no"}`,
    `- Idempotent replay: ${result.idempotent ? "yes" : "no"}`,
    `- Story manifest SHA-256: ${result.manifest_sha256 || "not applicable"}`,
    `- Source evidence SHA-256: ${result.source_evidence_sha256 || "not applicable"}`,
    `- Script SHA-256: ${result.script_sha256 || "not applicable"}`,
    `- Owned asset manifest SHA-256: ${result.owned_asset_manifest_sha256 || "not applicable"}`,
    "",
    "## Blockers",
    "",
    blockers,
    "",
  ].join("\n");
}

function writeArtifacts(result, outDir) {
  const resolvedOutDir = path.resolve(
    outDir || path.join("output", "governed-story-intake"),
  );
  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const stamp = safeSegment(
    String(result.generated_at || "").replace(/[:]/g, "-"),
  );
  const stem = [
    safeSegment(result.action),
    safeSegment(result.story_id),
    stamp,
  ].join("-");
  const jsonPath = path.join(resolvedOutDir, `${stem}.json`);
  const markdownPath = path.join(resolvedOutDir, `${stem}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(result), "utf8");
  return {
    json: jsonPath,
    markdown: markdownPath,
  };
}

function run(argv = process.argv.slice(2), env = process.env) {
  const args = parseCliArgs(argv);
  if (args.help) {
    return {
      help: true,
      text: usage(),
      exitCode: 0,
    };
  }
  const result = executeGovernedStoryIntake({
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

if (require.main === module) {
  try {
    const outcome = run();
    if (outcome.help) {
      process.stdout.write(`${outcome.text}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(outcome.result, null, 2)}\n`);
    }
    process.exitCode = outcome.exitCode;
  } catch (error) {
    const errors =
      error instanceof GovernedStoryIntakeError
        ? error.codes
        : Array.isArray(error.codes)
          ? error.codes
          : [String(error.message || "governed_story_intake_failed")];
    process.stderr.write(
      `${JSON.stringify(
        {
          schema_version: "pulse-governed-story-intake-cli-error-v1",
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

module.exports = {
  BOOLEAN_FLAGS,
  VALUE_FLAGS,
  parseCliArgs,
  renderMarkdown,
  run,
  usage,
  writeArtifacts,
};
