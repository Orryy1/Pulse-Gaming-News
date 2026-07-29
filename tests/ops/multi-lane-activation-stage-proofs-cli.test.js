"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(
  ROOT,
  "tools",
  "multi-lane-activation-stage-proofs.js",
);

const {
  DEFAULT_OUTPUT_DIRECTORY,
  parseArgs,
  renderSummary,
  run,
} = require("../../tools/multi-lane-activation-stage-proofs");

test("CLI parses only the fixed generator controls, not arbitrary test files", () => {
  const args = parseArgs([
    "node",
    TOOL,
    "--output-dir",
    "proof",
    "--now",
    "2026-07-28T12:00:00.000Z",
    "--runtime-capabilities",
    "runtime.json",
    "--runtime-capabilities-sha256",
    "a".repeat(64),
    "--timeout-ms",
    "90000",
    "--json",
  ]);
  assert.equal(args.outputDirectory, "proof");
  assert.equal(args.generatedAt, "2026-07-28T12:00:00.000Z");
  assert.equal(args.runtimeCapabilitiesPath, "runtime.json");
  assert.equal(args.runtimeCapabilitiesSha256, "a".repeat(64));
  assert.equal(args.timeoutMs, 90000);
  assert.equal(args.json, true);
  assert.equal(args.testFiles, undefined);
  assert.throws(
    () => parseArgs(["node", TOOL, "--test-file", "anything.test.js"]),
    /unknown_argument:--test-file/,
  );
  assert.ok(path.isAbsolute(DEFAULT_OUTPUT_DIRECTORY));
});

test("CLI returns BLOCKED with code 2 when runtime truth is unavailable", () => {
  let received = null;
  const result = run(
    [
      "node",
      TOOL,
      "--output-dir",
      "proof",
      "--now",
      "2026-07-28T12:00:00.000Z",
      "--json",
    ],
    {
      generate(options) {
        received = options;
        return {
          schema_version:
            "pulse-multi-lane-activation-stage-proof-generation-v1",
          generated_at: options.generated_at,
          verdict: "BLOCKED",
          blockers: [
            "weekly_longform_runtime_capabilities_not_supplied",
          ],
          all_stage_tests_passed: true,
          stage_proofs: [],
          runtime_capabilities: {
            availability: "UNAVAILABLE",
            ready: false,
          },
          index_path: "proof/index.json",
          safety: {
            network_used: false,
            database_accessed: false,
            oauth_accessed: false,
            publish_action_invoked: false,
          },
        };
      },
    },
  );
  assert.equal(received.output_dir, "proof");
  assert.equal(received.generated_at, "2026-07-28T12:00:00.000Z");
  assert.equal(received.runtime_capabilities_path, null);
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.output).verdict, "BLOCKED");
});

test("human summary reports exact blockers and distinguishes ephemeral fixtures from production DB access", () => {
  const output = renderSummary({
    generated_at: "2026-07-28T12:00:00.000Z",
    verdict: "BLOCKED",
    blockers: [
      "evergreen_short:production:exact_positive_test_evidence_unavailable:" +
        "evergreen_production_runner_bound",
    ],
    all_stage_tests_passed: true,
    all_stage_checks_proven: false,
    runtime_capabilities: {
      availability: "SUPPLIED",
    },
    index_path: "proof/index.json",
    safety: {
      ephemeral_in_memory_test_database_used: true,
    },
  });

  assert.match(output, /All required stage checks proven: No/);
  assert.match(output, /Production database accessed: No/);
  assert.match(output, /Ephemeral in-memory test database used: Yes/);
  assert.match(output, /evergreen_production_runner_bound/);
  assert.doesNotMatch(output, /No network, database, OAuth/);
});

test("CLI help describes the hash-bound optional runtime artifact", () => {
  const result = run(["node", TOOL, "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.help, /--runtime-capabilities FILE/);
  assert.match(result.help, /--runtime-capabilities-sha256 SHA256/);
  assert.doesNotMatch(result.help, /--test-file/);
});

test("CLI surface imports no network, database, OAuth or publisher implementation", () => {
  const source = fs.readFileSync(TOOL, "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /require\(["'](?:node:)?https?["']\)/);
  assert.doesNotMatch(source, /require\(["']\.\.\/lib\/db["']\)/);
  assert.doesNotMatch(source, /require\(["']\.\.\/publisher["']\)/);
  assert.doesNotMatch(source, /require\(["']\.\.\/upload_/);
  assert.doesNotMatch(source, /require\(["']\.\.\/lib\/oauth/);
});

test("package exposes the stage generator next to the evidence collector", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:multi-lane-activation-stage-proofs"],
    "node tools/multi-lane-activation-stage-proofs.js",
  );
  assert.equal(
    packageJson.scripts["ops:multi-lane-activation-evidence"],
    "node tools/multi-lane-activation-evidence.js",
  );
});
