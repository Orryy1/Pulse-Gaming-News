#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  AutonomousOfficialCandidateStagingError,
  stageAutonomousOfficialCandidate,
} = require("../lib/services/autonomous-official-candidate-staging");

function usage() {
  return (
    "Usage: node tools/autonomous-official-candidate-staging.js " +
    "--request <absolute-or-relative-json-path>"
  );
}

function requestPath(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--request" ||
    !String(argv[1] || "").trim()
  ) {
    throw new Error("candidate_staging_cli_arguments_invalid");
  }
  return path.resolve(String(argv[1]).trim());
}

async function main() {
  const filePath = requestPath(process.argv.slice(2));
  let request;
  try {
    request = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    throw new Error("candidate_staging_cli_request_invalid");
  }
  const result = await stageAutonomousOfficialCandidate(request);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const blockers =
    error instanceof AutonomousOfficialCandidateStagingError
      ? error.blockers
      : [String(error?.message || error || "candidate_staging_cli_failed")];
  process.stderr.write(
    `${JSON.stringify(
      {
        schema_version:
          "pulse-autonomous-official-candidate-staging-cli-result-v1",
        mode: "LOCAL_PROOF",
        verdict: "HOLD",
        blockers,
        usage: usage(),
        safety: {
          publish_authority: false,
          external_publish_authorised: false,
          database_mutated: false,
          oauth_or_tokens_mutated: false,
          platform_contacted: false,
          network_used: false,
        },
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
