#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  GovernedSourceMediaEphemeralError,
  acquireEphemeralSourceMedia,
  validateEphemeralSourceMedia,
} = require("../lib/services/governed-source-media-ephemeral");
const {
  GovernedSourceMediaError,
  validateGovernedSourceMediaManifest,
} = require("../lib/services/governed-source-media");

const ACTIONS = new Set(["acquire", "validate"]);
const VALUE_FLAGS = Object.freeze({
  "--mode": "mode",
  "--manifest": "manifestPath",
  "--manifest-sha256": "expectedManifestSha256",
  "--story-id": "expectedStoryId",
});
const FORBIDDEN_FLAGS = new Set([
  "--apply",
  "--auto-publish",
  "--database",
  "--db",
  "--live",
  "--oauth",
  "--platform",
  "--publish",
  "--token",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    action: null,
    mode: null,
    manifestPath: null,
    expectedManifestSha256: null,
    expectedStoryId: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--help" ||
      argument === "-h" ||
      argument === "-?"
    ) {
      args.help = true;
      continue;
    }
    if (FORBIDDEN_FLAGS.has(argument)) {
      throw new Error(`forbidden_argument:${argument}`);
    }
    if (!argument.startsWith("-") && args.action === null) {
      if (!ACTIONS.has(argument)) {
        throw new Error(`unknown_action:${argument}`);
      }
      args.action = argument;
      continue;
    }
    const mapped = VALUE_FLAGS[argument];
    if (!mapped) throw new Error(`unknown_argument:${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing_value:${argument}`);
    }
    args[mapped] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    "Governed Pulse Gaming ephemeral source-media lane",
    "",
    "Usage:",
    "  node tools/governed-source-media-ephemeral.js acquire [options]",
    "  node tools/governed-source-media-ephemeral.js validate [options]",
    "",
    "Required:",
    "  --mode LOCAL_PROOF          Explicit non-publishing mode",
    "  --manifest <path>           Governed source-media manifest",
    "  --manifest-sha256 <hash>    Independently supplied SHA-256",
    "  --story-id <id>             Independently supplied story ID",
    "",
    "Acquire downloads only the seven allowlisted official FFXIV",
    "JPEGs, verifies every declared hash and atomically promotes them",
    "to the gitignored EPHEMERAL_UNTRACKED asset directory.",
    "",
    "Validate performs no network access. It verifies the exact",
    "ephemeral bytes and then runs the full governed rights validator.",
    "",
    "This command never opens a database, changes OAuth or tokens,",
    "contacts a publishing API, creates a platform object or publishes.",
  ].join("\n");
}

function requireValue(value, code) {
  if (!String(value || "").trim()) throw new Error(code);
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true };
  }
  requireValue(args.action, "action_required");
  requireValue(args.mode, "mode_required");
  if (args.mode !== "LOCAL_PROOF") {
    throw new Error("mode_must_be_local_proof");
  }
  requireValue(args.manifestPath, "manifest_required");
  requireValue(
    args.expectedManifestSha256,
    "manifest_sha256_required",
  );
  if (
    !/^[a-f0-9]{64}$/i.test(
      args.expectedManifestSha256,
    )
  ) {
    throw new Error("manifest_sha256_invalid");
  }
  requireValue(args.expectedStoryId, "story_id_required");
  const options = {
    mode: args.mode,
    manifestPath: path.resolve(args.manifestPath),
    expectedManifestSha256:
      args.expectedManifestSha256.toLowerCase(),
    expectedStoryId: args.expectedStoryId,
  };

  let result;
  if (args.action === "acquire") {
    const acquire =
      deps.acquire || acquireEphemeralSourceMedia;
    const validateGoverned =
      deps.validateGoverned ||
      validateGovernedSourceMediaManifest;
    const ephemeral = await acquire(options);
    const governed = validateGoverned({
      manifestPath: options.manifestPath,
      expectedManifestSha256:
        options.expectedManifestSha256,
      expectedStoryId: options.expectedStoryId,
    });
    result = buildCombinedReadyResult({
      operation:
        "ACQUIRE_AND_VALIDATE_GOVERNED_SOURCE_MEDIA",
      ephemeral,
      governed,
    });
  } else {
    const validateEphemeral =
      deps.validateEphemeral ||
      validateEphemeralSourceMedia;
    const validateGoverned =
      deps.validateGoverned ||
      validateGovernedSourceMediaManifest;
    const ephemeral = validateEphemeral(options);
    const governed = validateGoverned({
      manifestPath: options.manifestPath,
      expectedManifestSha256:
        options.expectedManifestSha256,
      expectedStoryId: options.expectedStoryId,
    });
    result = buildCombinedReadyResult({
      operation:
        "VALIDATE_EPHEMERAL_AND_GOVERNED_SOURCE_MEDIA",
      ephemeral,
      governed,
    });
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function buildCombinedReadyResult({
  operation,
  ephemeral,
  governed,
}) {
  return {
    schema_version:
      "pulse-governed-source-media-validation-cli-v1",
    verdict: "READY",
    operation,
    mode: "LOCAL_PROOF",
    persistence: "EPHEMERAL_UNTRACKED",
    story_id: governed.story_id,
    manifest_sha256: governed.manifest_sha256,
    ephemeral,
    governed: {
      story_id: governed.story_id,
      manifest_sha256: governed.manifest_sha256,
      rights_review_sha256:
        governed.rights_review.sha256,
      component_count: governed.components.length,
    },
    safety: {
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      published: false,
    },
  };
}

async function runCli() {
  try {
    await main();
  } catch (error) {
    const codes =
      error instanceof GovernedSourceMediaEphemeralError ||
      error instanceof GovernedSourceMediaError
        ? error.codes
        : [
            String(
              error?.message ||
                "governed_source_media_ephemeral_failed",
            ),
          ];
    process.stderr.write(
      `${JSON.stringify(
        {
          schema_version:
            "pulse-governed-source-media-ephemeral-cli-error-v1",
          verdict: "ERROR",
          errors: codes,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  ACTIONS,
  FORBIDDEN_FLAGS,
  VALUE_FLAGS,
  main,
  parseArgs,
  usage,
};
