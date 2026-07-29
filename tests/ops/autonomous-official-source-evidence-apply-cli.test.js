"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  CLI_RESULT_SCHEMA_VERSION,
  parseArgs,
  runCli,
} = require("../../tools/autonomous-official-source-evidence-apply");

test("CLI accepts only one exact LOCAL_PROOF request and exposes no dispatch switch", async (t) => {
  const root = "D:\\pulse-data\\tmp\\pulse-tests";
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(
    path.join(root, "pulse-official-apply-cli-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const requestPath = path.join(directory, "request.json");
  const request = {
    schema_version:
      "pulse-autonomous-official-source-evidence-apply-request-v1",
    mode: "LOCAL_PROOF",
  };
  await fs.writeFile(requestPath, JSON.stringify(request));
  const writes = [];
  const observed = [];
  const observedOptions = [];

  const exitCode = await runCli(["--request", requestPath], {
    workspaceRoot: directory,
    execute: async (input, options) => {
      observed.push(input);
      observedOptions.push(options);
      return {
        status: "APPLIED",
        mutated: true,
        idempotent: false,
        report_path: "D:\\proof\\report.json",
        report: {
          verdict: "GREEN",
          report_sha256: "a".repeat(64),
          operational_publish_authority: false,
          dispatch_authorised: false,
        },
      };
    },
    stdout: {
      write(value) {
        writes.push(value);
      },
    },
    stderr: {
      write() {
        assert.fail("stderr was not expected");
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(observed, [request]);
  assert.equal(observedOptions[0].workspaceRoot, path.resolve(directory));
  const result = JSON.parse(writes.join(""));
  assert.equal(result.schema_version, CLI_RESULT_SCHEMA_VERSION);
  assert.equal(result.mode, "LOCAL_PROOF");
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.dispatch_authorised, false);

  assert.throws(
    () => parseArgs(["--request", requestPath, "--publish"]),
    /unknown_argument:--publish/,
  );
});
