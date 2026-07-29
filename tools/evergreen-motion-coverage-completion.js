#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  COMPLETION_FILENAME,
  materializeEvergreenMotionCoverageCompletion,
  validateEvergreenMotionCoverageCompletion,
} = require("../lib/services/evergreen-motion-coverage-completion");

const RESULT_SCHEMA =
  "pulse-evergreen-motion-coverage-completion-operator-v1";
const CONFIRMATION = "LOCAL_ONLY_MOTION_COMPLETION";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    action: null,
    requestPath: null,
    outputPath: null,
    confirmRequestSha256: null,
    confirmation: null,
    manifestPath: null,
    manifestFileSha256: null,
    expectedStoryId: null,
    expectedSourcePacketSha256: null,
    expectedBaselineLedgerSha256: null,
    rootDir: null,
    ffprobePath: "ffprobe",
    help: false,
  };
  let index = 0;
  if (["create", "validate"].includes(argv[0])) {
    args.action = argv[0];
    index = 1;
  }
  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h" || argument === "-?") {
      args.help = true;
      continue;
    }
    const mapped = {
      "--request": "requestPath",
      "--output": "outputPath",
      "--confirm-request-sha256": "confirmRequestSha256",
      "--confirm": "confirmation",
      "--manifest": "manifestPath",
      "--manifest-file-sha256": "manifestFileSha256",
      "--expected-story-id": "expectedStoryId",
      "--expected-source-packet-sha256":
        "expectedSourcePacketSha256",
      "--expected-baseline-ledger-sha256":
        "expectedBaselineLedgerSha256",
      "--root-dir": "rootDir",
      "--ffprobe": "ffprobePath",
    }[argument];
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
    "Usage:",
    "  node tools/evergreen-motion-coverage-completion.js create [options]",
    "  node tools/evergreen-motion-coverage-completion.js validate [options]",
    "",
    "Create from an already-local clip request:",
    "  --request <json>                       Completion request JSON",
    "  --confirm-request-sha256 <sha256>      Exact request-file SHA-256",
    `  --confirm ${CONFIRMATION}`,
    "  --output <json>                        Optional; must use the governed filename",
    "",
    "Validate an existing manifest:",
    "  --manifest <json>",
    "  --manifest-file-sha256 <sha256>",
    "  --expected-story-id <id>",
    "  --expected-source-packet-sha256 <sha256>",
    "  --expected-baseline-ledger-sha256 <sha256>",
    "",
    "Optional:",
    "  --root-dir <path>",
    "  --ffprobe <path>",
    "",
    "This tool reads already-local evidence and video only. It never downloads",
    "media, uses a database, mutates OAuth, contacts a platform or grants",
    "scheduling, approval or publishing authority.",
  ].join("\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function text(value) {
  return String(value ?? "").trim();
}

function safety() {
  return {
    local_proof_only: true,
    local_files_only: true,
    network_used: false,
    download_performed: false,
    database_mutated: false,
    oauth_mutated: false,
    external_platform_contacted: false,
    publish_authority_created: false,
    scheduler_authority_created: false,
    external_posting_authorised: false,
  };
}

function resolveFrom(value, baseDir) {
  const declared = text(value);
  if (!declared) return declared;
  return path.resolve(
    path.isAbsolute(declared)
      ? declared
      : path.join(baseDir, declared),
  );
}

function normaliseRequestPaths(request, requestDir) {
  const value = structuredClone(request);
  if (value?.repair_work_order) {
    value.repair_work_order.path = resolveFrom(
      value.repair_work_order.path,
      requestDir,
    );
  }
  if (value?.materialisation_receipt) {
    value.materialisation_receipt.path = resolveFrom(
      value.materialisation_receipt.path,
      requestDir,
    );
  }
  if (value?.source_binding) {
    value.source_binding.source_evidence_path = resolveFrom(
      value.source_binding.source_evidence_path,
      requestDir,
    );
  }
  if (value?.baseline_rights_ledger) {
    value.baseline_rights_ledger.path = resolveFrom(
      value.baseline_rights_ledger.path,
      requestDir,
    );
  }
  if (value?.amended_rights_ledger) {
    value.amended_rights_ledger.path = resolveFrom(
      value.amended_rights_ledger.path,
      requestDir,
    );
  }
  if (Array.isArray(value?.segments)) {
    value.segments = value.segments.map((segment) => ({
      ...segment,
      local_path: resolveFrom(segment?.local_path, requestDir),
    }));
  }
  return value;
}

function hold(action, blockers, extra = {}) {
  return {
    schema_version: RESULT_SCHEMA,
    action,
    verdict: "HOLD",
    blockers: [...new Set(blockers)],
    ...extra,
    safety: safety(),
  };
}

async function create(args, deps) {
  if (!args.requestPath) {
    return hold("create", ["request_path_required"]);
  }
  const requestPath = path.resolve(args.requestPath);
  const requestBytes = await fs.readFile(requestPath);
  const requestSha256 = sha256(requestBytes);
  const blockers = [];
  if (args.confirmation !== CONFIRMATION) {
    blockers.push("confirmation_phrase_mismatch");
  }
  if (
    !SHA256_PATTERN.test(text(args.confirmRequestSha256)) ||
    text(args.confirmRequestSha256).toLowerCase() !== requestSha256
  ) {
    blockers.push("request_sha256_confirmation_mismatch");
  }
  let request;
  try {
    request = normaliseRequestPaths(
      JSON.parse(requestBytes.toString("utf8")),
      path.dirname(requestPath),
    );
  } catch {
    blockers.push("request_json_invalid");
    request = {};
  }
  if (blockers.length) {
    return hold("create", blockers, {
      request_path: requestPath,
      request_file_sha256: requestSha256,
    });
  }
  const workOrderPath = text(request?.repair_work_order?.path);
  if (!workOrderPath) {
    return hold("create", ["repair_work_order_path_required"], {
      request_path: requestPath,
      request_file_sha256: requestSha256,
    });
  }
  const outputPath = path.resolve(
    args.outputPath
      ? args.outputPath
      : path.join(path.dirname(workOrderPath), COMPLETION_FILENAME),
  );
  const materialize =
    deps.materialize ||
    materializeEvergreenMotionCoverageCompletion;
  const result = await materialize({
    request,
    output_path: outputPath,
    expected_story_id: request.story_id,
    expected_source_packet_sha256:
      request?.source_binding?.source_evidence_packet_sha256,
    expected_baseline_rights_ledger_sha256:
      request?.baseline_rights_ledger?.ledger_sha256,
    root_dir: args.rootDir
      ? path.resolve(args.rootDir)
      : path.dirname(requestPath),
    ffprobe_path: args.ffprobePath,
  });
  return {
    schema_version: RESULT_SCHEMA,
    action: "create",
    request_path: requestPath,
    request_file_sha256: requestSha256,
    ...result,
    safety: safety(),
  };
}

async function validate(args, deps) {
  const blockers = [];
  if (!args.manifestPath) blockers.push("manifest_path_required");
  if (!SHA256_PATTERN.test(text(args.manifestFileSha256))) {
    blockers.push("manifest_file_sha256_required");
  }
  if (!text(args.expectedStoryId)) {
    blockers.push("expected_story_id_required");
  }
  if (!SHA256_PATTERN.test(text(args.expectedSourcePacketSha256))) {
    blockers.push("expected_source_packet_sha256_required");
  }
  if (!SHA256_PATTERN.test(text(args.expectedBaselineLedgerSha256))) {
    blockers.push("expected_baseline_ledger_sha256_required");
  }
  if (blockers.length) return hold("validate", blockers);
  const validateCompletion =
    deps.validate || validateEvergreenMotionCoverageCompletion;
  const result = await validateCompletion({
    reference: {
      path: path.resolve(args.manifestPath),
      file_sha256: text(args.manifestFileSha256).toLowerCase(),
    },
    expected_story_id: text(args.expectedStoryId),
    expected_source_packet_sha256: text(
      args.expectedSourcePacketSha256,
    ).toLowerCase(),
    expected_baseline_rights_ledger_sha256: text(
      args.expectedBaselineLedgerSha256,
    ).toLowerCase(),
    root_dir: args.rootDir
      ? path.resolve(args.rootDir)
      : path.dirname(path.resolve(args.manifestPath)),
    ffprobe_path: args.ffprobePath,
  });
  return {
    schema_version: RESULT_SCHEMA,
    action: "validate",
    ...result,
    safety: safety(),
  };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true };
  }
  if (!args.action) throw new Error("action_required");
  const result =
    args.action === "create"
      ? await create(args, deps)
      : await validate(args, deps);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main()
    .then((result) => {
      if (result?.verdict === "HOLD") process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(
        `[evergreen-motion-completion] ${
          error.stack || error.message
        }\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  CONFIRMATION,
  RESULT_SCHEMA,
  main,
  parseArgs,
  usage,
};
