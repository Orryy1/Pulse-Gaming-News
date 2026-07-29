#!/usr/bin/env node
"use strict";

const {
  executeGovernedPublicationEvidencePackage,
} = require("../lib/services/governed-publication-evidence-package");

const VALUE_ARGUMENTS = Object.freeze({
  "--story-intake": "storyIntakePath",
  "--source-evidence": "sourceEvidencePath",
  "--owned-motion-manifest": "ownedMotionManifestPath",
  "--source-media-manifest": "sourceMediaManifestPath",
  "--source-media-manifest-sha256": "sourceMediaManifestSha256",
  "--governed-narration-manifest": "governedNarrationManifestPath",
  "--final-composite-manifest": "finalCompositeManifestPath",
  "--renderer-manifest": "rendererManifestPath",
  "--qa-report": "qaReportPath",
  "--final-mp4": "finalMp4Path",
  "--publication-metadata": "publicationMetadataPath",
  "--publication-metadata-sha256": "publicationMetadataSha256",
  "--out-dir": "outDir",
  "--generated-at": "generatedAt",
});

const APPROVAL_ARGUMENTS = Object.freeze({
  "--approval-actor": "actor",
  "--approval-timestamp": "approvedAt",
  "--confirm-story-id": "confirmStoryId",
  "--confirm-media-sha256": "confirmMediaSha256",
  "--confirm-script-sha256": "confirmScriptSha256",
  "--confirm-renderer-canonical-sha256": "confirmRendererCanonicalSha256",
  "--confirm-disclosure": "disclosureConfirmation",
});

function usage() {
  return [
    "Usage:",
    "  node tools/governed-publication-evidence-package.js [inputs] [--apply approval-flags]",
    "",
    "Default mode is a validation-only dry-run.",
    "",
    "Required inputs:",
    "  --story-intake PATH",
    "  --source-evidence PATH",
    "  --owned-motion-manifest PATH",
    "  --governed-narration-manifest PATH",
    "  --final-composite-manifest PATH",
    "  --renderer-manifest PATH",
    "  --qa-report PATH",
    "  --final-mp4 PATH",
    "  --publication-metadata PATH",
    "  --publication-metadata-sha256 SHA256",
    "  --out-dir PATH",
    "",
    "Optional governed source media (both values are required together):",
    "  --source-media-manifest PATH",
    "  --source-media-manifest-sha256 SHA256",
    "",
    "Apply requires every exact confirmation:",
    "  --apply",
    "  --approval-actor VALUE",
    "  --approval-timestamp ISO-8601",
    "  --confirm-story-id VALUE",
    "  --confirm-media-sha256 SHA256",
    "  --confirm-script-sha256 SHA256",
    "  --confirm-renderer-canonical-sha256 SHA256",
    "  --confirm-disclosure DISCLOSE_AND_SET_YOUTUBE_TRUE",
    "",
    "This command only validates evidence and writes local files.",
    "It never changes credentials, a database or a platform.",
    "",
  ].join("\n");
}

function takeValue(argv, index, argument) {
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`argument_value_required:${argument}`);
  }
  return value;
}

function parseArgs(argv = []) {
  const options = { apply: false };
  const approval = {};
  let approvalSupplied = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (VALUE_ARGUMENTS[argument]) {
      options[VALUE_ARGUMENTS[argument]] = takeValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (APPROVAL_ARGUMENTS[argument]) {
      approval[APPROVAL_ARGUMENTS[argument]] = takeValue(argv, index, argument);
      approvalSupplied = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown_argument:${argument}`);
  }
  if (options.help) return options;
  if (
    Boolean(options.sourceMediaManifestPath) !==
    Boolean(options.sourceMediaManifestSha256)
  ) {
    throw new Error("source_media_manifest_pair_required");
  }
  if (
    Boolean(options.publicationMetadataPath) !==
    Boolean(options.publicationMetadataSha256) ||
    !options.publicationMetadataPath
  ) {
    throw new Error("publication_metadata_pair_required");
  }
  if (approvalSupplied) options.humanApproval = approval;
  return options;
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const execute =
    dependencies.execute || executeGovernedPublicationEvidencePackage;
  try {
    const options = parseArgs(argv);
    if (options.help) {
      stdout.write(usage());
      return 0;
    }
    const result = await execute(options);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const payload = {
      schema_version:
        "pulse-governed-publication-evidence-package-cli-error-v1",
      verdict: "REJECTED",
      error: error.message,
      blockers: Array.isArray(error.codes) ? error.codes : [error.message],
    };
    stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 1;
  }
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  parseArgs,
  runCli,
  usage,
};
