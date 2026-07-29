#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  materialiseAutonomousOfficialSourceEvidence,
} = require("../lib/services/autonomous-official-source-evidence-apply");

const CLI_RESULT_SCHEMA_VERSION =
  "pulse-autonomous-official-source-evidence-apply-cli-result-v1";

function usage() {
  return [
    "Usage:",
    "  node tools/autonomous-official-source-evidence-apply.js --request <exact-request.json>",
    "",
    "This command revalidates only the request's official sources and",
    "atomically writes one immutable LOCAL_PROOF evidence report.",
    "It cannot dispatch, mutate a database, change OAuth state or",
    "create a platform object.",
    "",
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (argument !== "--request") {
      throw new Error(`unknown_argument:${argument}`);
    }
    if (result.requestPath) {
      throw new Error("request_argument_duplicate");
    }
    const value = argv[index + 1];
    if (!value || String(value).startsWith("--")) {
      throw new Error("request_path_required");
    }
    result.requestPath = path.resolve(value);
    index += 1;
  }
  if (!result.help && !result.requestPath) {
    throw new Error("request_path_required");
  }
  if (result.help && result.requestPath) {
    throw new Error("help_must_be_used_alone");
  }
  return result;
}

function isPathWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function readRequest(requestPath, fileSystem, workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedRequest = path.resolve(requestPath);
  if (!isPathWithinRoot(resolvedRoot, resolvedRequest)) {
    throw new Error("request_path_outside_workspace_root");
  }
  const [realRoot, realRequest, requestStat] = await Promise.all([
    fileSystem.realpath(resolvedRoot),
    fileSystem.realpath(resolvedRequest),
    fileSystem.lstat(resolvedRequest),
  ]);
  if (
    !isPathWithinRoot(realRoot, realRequest) ||
    !requestStat.isFile() ||
    requestStat.isSymbolicLink()
  ) {
    throw new Error("request_path_outside_workspace_root");
  }
  let request;
  try {
    request = JSON.parse(await fileSystem.readFile(requestPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("request_json_invalid");
    }
    throw error;
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("request_json_object_required");
  }
  return request;
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const fileSystem = dependencies.fileSystem || fs;
  const workspaceRoot = path.resolve(
    dependencies.workspaceRoot || process.cwd(),
  );
  const execute =
    dependencies.execute || materialiseAutonomousOfficialSourceEvidence;
  try {
    const args = parseArgs(argv);
    if (args.help) {
      stdout.write(usage());
      return 0;
    }
    const request = await readRequest(
      args.requestPath,
      fileSystem,
      workspaceRoot,
    );
    const result = await execute(request, {
      clock: () => new Date(),
      fileSystem,
      workspaceRoot,
    });
    const output = {
      schema_version: CLI_RESULT_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      status: result.status,
      verdict: result.report.verdict,
      mutated: result.mutated,
      idempotent: result.idempotent,
      report_path: result.report_path,
      report_sha256: result.report.report_sha256,
      operational_publish_authority: false,
      dispatch_authorised: false,
    };
    stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return 0;
  } catch (error) {
    const output = {
      schema_version:
        "pulse-autonomous-official-source-evidence-apply-cli-error-v1",
      mode: "LOCAL_PROOF",
      verdict: "HOLD",
      blockers: Array.isArray(error?.codes)
        ? error.codes
        : [error?.code || error?.message || "unknown_error"],
      operational_publish_authority: false,
      dispatch_authorised: false,
    };
    stderr.write(`${JSON.stringify(output, null, 2)}\n`);
    return 1;
  }
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  CLI_RESULT_SCHEMA_VERSION,
  parseArgs,
  runCli,
  usage,
};
