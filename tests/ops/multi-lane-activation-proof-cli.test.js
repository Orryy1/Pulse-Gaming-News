"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "multi-lane-activation-proof.js");

function provenStage(overrides = {}) {
  return {
    status: "PROVEN",
    observed_at: "2026-07-28T11:30:00.000Z",
    proof_refs: ["node-test:focused-suite"],
    ...overrides,
  };
}

function evidenceDocument() {
  const evidence = {
    schema_version: "pulse-multi-lane-activation-evidence-v2",
    lanes: Object.fromEntries(
      [
        "breaking_short",
        "evergreen_short",
        "weekly_longform",
      ].map((laneId) => [
        laneId,
        {
          planning: provenStage(),
          production: provenStage(),
          human_review: provenStage({ gate_enforced: true }),
          live_dispatch: provenStage({
            exact_binding_enforced: true,
            kill_switch_enforced: true,
            control_tower_gate_enforced: true,
            runtime_armed: false,
          }),
        },
      ]),
    ),
  };
  evidence.lanes.evergreen_short.production = provenStage({
    editorial_enrichment_proven: true,
    production_runner_proven: true,
  });
  evidence.lanes.weekly_longform.production = provenStage({
    editorial_enrichment_proven: true,
    production_runner_proven: true,
    runtime_capabilities: {
      schema_version:
        "pulse-weekly-longform-runtime-capabilities-v1",
      ready: true,
      blockers: [],
      dependencies: Object.fromEntries(
        [
          "produceNarration",
          "materializeAlignment",
          "renderLongform",
          "materializeVariants",
          "runDecodedQa",
          "materializeDerivatives",
        ].map((name) => [name, { available: true }]),
      ),
      safety: {
        implicit_network_enabled: false,
        implicit_process_spawn_enabled: false,
        upload_authority: false,
        oauth_mutation_authority: false,
        database_mutation_authority: false,
      },
    },
  });
  return evidence;
}

test("CLI inspects repository wiring and writes read-only JSON and Markdown proof", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-cli-"),
  );
  try {
    const evidencePath = path.join(directory, "evidence.json");
    const outputDirectory = path.join(directory, "proof");
    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify(evidenceDocument(), null, 2)}\n`,
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        TOOL,
        "--evidence",
        evidencePath,
        "--output-dir",
        outputDirectory,
        "--now",
        "2026-07-28T12:00:00.000Z",
        "--json",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdoutReport = JSON.parse(result.stdout);
    assert.equal(stdoutReport.aggregate_verdict, "AMBER");
    assert.equal(stdoutReport.external_publication.verified, false);
    assert.match(stdoutReport.evidence_source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(stdoutReport.runtime_activation.verdict, "GREEN");
    assert.equal(
      stdoutReport.runtime_activation.isolated_worker_pools
        .default_enabled,
      true,
    );
    assert.equal(
      stdoutReport.runtime_activation.breaking_watcher
        .server_default_enabled,
      true,
    );
    assert.equal(
      stdoutReport.runtime_activation.breaking_watcher
        .run_default_enabled,
      true,
    );
    assert.equal(
      stdoutReport.lanes
        .find((lane) => lane.lane_id === "weekly_longform")
        .stages.production.capabilities.weekly_longform_runtime
        .ready,
      true,
    );

    const jsonPath = path.join(
      outputDirectory,
      "multi_lane_activation_proof.json",
    );
    const markdownPath = path.join(
      outputDirectory,
      "multi_lane_activation_proof.md",
    );
    assert.equal(fs.existsSync(jsonPath), true);
    assert.equal(fs.existsSync(markdownPath), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(jsonPath, "utf8")), stdoutReport);
    assert.match(
      fs.readFileSync(markdownPath, "utf8"),
      /does not prove that any external post was published/i,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI without an evidence document exits blocked and still writes an honest report", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-cli-blocked-"),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        TOOL,
        "--output-dir",
        directory,
        "--now",
        "2026-07-28T12:00:00.000Z",
        "--json",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.aggregate_verdict, "BLOCKED");
    assert.deepEqual(report.global_blockers, [
      "activation_evidence_required",
    ]);
    assert.equal(report.evidence_source.kind, "injected");
    assert.equal(report.external_publication.verified, false);
    assert.equal(
      fs.existsSync(
        path.join(directory, "multi_lane_activation_proof.json"),
      ),
      true,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI implementation has no token, database or network action path", () => {
  const source = fs.readFileSync(TOOL, "utf8");
  assert.doesNotMatch(source, /require\(["']dotenv["']\)/);
  assert.doesNotMatch(source, /\bgetRepos\s*\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /require\(["'](?:node:)?https?["']\)/);
  assert.doesNotMatch(source, /require\(["']\.\.\/publisher["']\)/);
  assert.doesNotMatch(source, /tokens[\\/]/i);
});

test("the activation proof has a stable operator command", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:multi-lane-activation-proof"],
    "node tools/multi-lane-activation-proof.js",
  );
});
