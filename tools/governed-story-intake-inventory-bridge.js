#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  materializeGovernedLockedStoryIntakeFromInventory,
  materializeGovernedStoryIntakeFromLegacyPackage,
} = require("../lib/services/governed-story-intake-inventory-bridge");

const REQUEST_SCHEMA =
  "pulse-governed-story-intake-inventory-bridge-request-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_REQUEST_BYTES = 256 * 1024;

function usage() {
  return [
    "Governed story-intake compatibility bridge",
    "",
    "Usage:",
    "  node tools/governed-story-intake-inventory-bridge.js \\",
    "    --request <request.json> --materialize \\",
    "    --confirm-request-sha256 <sha256>",
    "",
    "This command writes local proof artefacts only. It never mutates a",
    "database, OAuth state or a platform and never creates publish authority.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    requestPath: null,
    materialize: false,
    confirmRequestSha256: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--materialize") {
      args.materialize = true;
    } else if (token === "--request") {
      args.requestPath = argv[++index] || null;
    } else if (token === "--confirm-request-sha256") {
      args.confirmRequestSha256 = argv[++index] || null;
    } else {
      throw new Error(`unknown_argument:${token}`);
    }
  }
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readRequest(requestPath) {
  if (!requestPath) throw new Error("request_path_required");
  const absolutePath = path.resolve(requestPath);
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    throw new Error("request_file_required");
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MAXIMUM_REQUEST_BYTES
  ) {
    throw new Error("request_file_invalid");
  }
  const bytes = fs.readFileSync(absolutePath);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("request_json_invalid");
  }
  return {
    path: absolutePath,
    bytes,
    sha256: sha256(bytes),
    value,
  };
}

function validateRequest(request, args) {
  const blockers = [];
  const value = request.value || {};
  const safety = value.safety || {};
  const confirmedSha256 = String(
    args.confirmRequestSha256 || "",
  ).toLowerCase();
  if (args.materialize !== true) {
    blockers.push("explicit_local_materialize_required");
  }
  if (!SHA256_PATTERN.test(confirmedSha256)) {
    blockers.push("request_sha256_confirmation_required");
  } else if (confirmedSha256 !== request.sha256) {
    blockers.push("request_sha256_confirmation_mismatch");
  }
  if (value.schema_version !== REQUEST_SCHEMA) {
    blockers.push("request_schema_invalid");
  }
  if (
    ![
      "LEGACY_SEED_AND_PROOF_PACKAGE",
      "READY_INVENTORY_AND_LOCKED_OFFICIAL_SCRIPT",
    ].includes(value.input_kind)
  ) {
    blockers.push("request_input_kind_invalid");
  }
  if (
    safety.local_proof_only !== true ||
    safety.database_mutation_authorised !== false ||
    safety.oauth_mutation_authorised !== false ||
    safety.platform_contact_authorised !== false ||
    safety.publish_authority !== false
  ) {
    blockers.push("request_safety_contract_invalid");
  }
  if (blockers.length) {
    const error = new Error(
      `governed_story_intake_bridge_request_denied:${blockers.join(",")}`,
    );
    error.blockers = blockers;
    throw error;
  }
  return value;
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    return { help: usage() };
  }
  const request = readRequest(args.requestPath);
  const value = validateRequest(request, args);
  const inputs = value.inputs || {};
  const result =
    value.input_kind ===
    "READY_INVENTORY_AND_LOCKED_OFFICIAL_SCRIPT"
      ? await materializeGovernedLockedStoryIntakeFromInventory({
          inventoryPath: inputs.inventory_path,
          inventoryFileSha256:
            inputs.inventory_file_sha256,
          inventoryRoot: inputs.inventory_root,
          allowedRoots: inputs.allowed_roots,
          canonicalIdentityUrl:
            value.canonical_identity_url,
          finalScript: value.final_script,
          finalScriptSha256: value.final_script_sha256,
          scriptClaimBindings:
            value.script_claim_bindings,
          presentationClaimBindings:
            value.presentation_claim_bindings,
          supplementalOfficialSources:
            value.supplemental_official_sources,
          contract: value.contract,
          freshness: value.freshness,
          visualBrief: value.visual_brief,
          outputDir: value.output_dir,
        })
      : await materializeGovernedStoryIntakeFromLegacyPackage({
          seedPath: inputs.seed_path,
          seedFileSha256: inputs.seed_file_sha256,
          canonicalStoryManifestPath:
            inputs.canonical_story_manifest_path,
          canonicalStoryManifestFileSha256:
            inputs.canonical_story_manifest_file_sha256,
          sourceManifestPath: inputs.source_manifest_path,
          sourceManifestFileSha256:
            inputs.source_manifest_file_sha256,
          allowedRoots: inputs.allowed_roots,
          finalScript: value.final_script,
          finalScriptSha256: value.final_script_sha256,
          scriptClaimBindings:
            value.script_claim_bindings,
          outputDir: value.output_dir,
        });
  return {
    verdict: result.verdict,
    publish_verdict: result.publish_verdict,
    story_id: result.story_id,
    legacy_story_id: result.legacy_story_id,
    word_count: result.word_count,
    request: {
      path: request.path,
      file_sha256: request.sha256,
    },
    paths: result.paths,
    safety: {
      database_mutated: false,
      oauth_mutated: false,
      platform_contacted: false,
      publish_authority_created: false,
    },
  };
}

if (require.main === module) {
  run()
    .then((result) => {
      if (result.help) {
        process.stdout.write(`${result.help}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify(
          {
            error: error.name || "Error",
            message: error.message,
            blockers: error.blockers || [],
          },
          null,
          2,
        )}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  REQUEST_SCHEMA,
  parseArgs,
  readRequest,
  run,
  usage,
  validateRequest,
};
