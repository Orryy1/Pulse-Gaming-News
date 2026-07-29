"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  collectMultiLaneActivationEvidence,
  STAGE_PROOF_SCHEMA,
  STAGE_REQUIREMENTS,
  renderMultiLaneActivationEvidenceJson,
  renderMultiLaneActivationEvidenceMarkdown,
} = require("../../lib/services/multi-lane-activation-evidence-collector");
const {
  buildMultiLaneActivationProof,
} = require("../../lib/services/multi-lane-activation-proof");
const {
  inspectRepositoryWiring,
} = require("../../tools/multi-lane-activation-proof");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("activation evidence requires governed inventory and exact review-packet proof", () => {
  assert.ok(
    STAGE_REQUIREMENTS.evergreen_short.planning.includes(
      "governed_editorial_inventory_bound",
    ),
  );
  assert.ok(
    STAGE_REQUIREMENTS.weekly_longform.planning.includes(
      "governed_editorial_inventory_bound",
    ),
  );
  for (const lane of Object.values(STAGE_REQUIREMENTS)) {
    assert.ok(
      lane.human_review.includes(
        "governed_lane_review_packet_bound",
      ),
    );
  }
});

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function createCompleteInventory(directory, overrides = {}) {
  const sourcePath = path.join(directory, "bound-source.js");
  const sourceBytes = Buffer.from('"use strict";\nmodule.exports = {};\n');
  fs.writeFileSync(sourcePath, sourceBytes);
  const sourceSha256 = sha256(sourceBytes);
  const artifacts = [];
  for (const [laneId, stages] of Object.entries(STAGE_REQUIREMENTS)) {
    for (const [stage, requiredChecks] of Object.entries(stages)) {
      const proofPath = path.join(
        directory,
        `${laneId}-${stage}-proof.json`,
      );
      const proof = {
        schema_version: STAGE_PROOF_SCHEMA,
        generated_at: "2026-07-28T11:30:00.000Z",
        mode: "LOCAL_PROOF",
        lane_id: laneId,
        stage,
        test_run: {
          runner: "node:test",
          command: `node --test tests/${laneId}-${stage}.test.js`,
          exit_code: 0,
          passed: requiredChecks.length,
          failed: 0,
        },
        checks: requiredChecks.map((id) => ({
          id,
          result: "PASS",
        })),
        source_bindings: [
          {
            component: `${laneId}_${stage}`,
            path: path.basename(sourcePath),
            sha256: sourceSha256,
            bytes: sourceBytes.length,
            read_only: true,
          },
        ],
      };
      const proofSha256 = writeJson(proofPath, proof);
      artifacts.push({
        id: `${laneId}-${stage}-proof`,
        lane_id: laneId,
        stage,
        role: "stage_proof",
        path: path.basename(proofPath),
        sha256: proofSha256,
      });
    }
  }
  const runtimePath = path.join(
    directory,
    "weekly-longform-runtime-capabilities.json",
  );
  const runtimeCapabilities = {
    schema_version:
      "pulse-weekly-longform-runtime-capabilities-v1",
    generated_at: "2026-07-28T11:30:00.000Z",
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
      ].map((dependency) => [dependency, { available: true }]),
    ),
    safety: {
      implicit_network_enabled: false,
      implicit_process_spawn_enabled: false,
      upload_authority: false,
      oauth_mutation_authority: false,
      database_mutation_authority: false,
    },
  };
  const runtimeSha256 = writeJson(runtimePath, runtimeCapabilities);
  artifacts.push({
    id: "weekly-longform-runtime",
    lane_id: "weekly_longform",
    stage: "production",
    role: "runtime_capabilities",
    path: path.basename(runtimePath),
    sha256: runtimeSha256,
  });

  const indexPath = path.join(directory, "activation-index.json");
  const index = {
    schema_version:
      "pulse-multi-lane-activation-artifact-index-v1",
    generated_at: "2026-07-28T11:45:00.000Z",
    artifacts,
  };
  Object.assign(index, overrides.index || {});
  writeJson(indexPath, index);
  return {
    index,
    indexPath,
    runtimeCapabilities,
    runtimePath,
    sourcePath,
  };
}

function rewriteIndexedJson(fixture, reference, mutate) {
  const artifactPath = path.join(
    path.dirname(fixture.indexPath),
    reference.path,
  );
  const value = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  mutate(value);
  reference.sha256 = writeJson(artifactPath, value);
  writeJson(fixture.indexPath, fixture.index);
}

test("missing artefact inventory produces blocked v2 evidence for every lane stage", () => {
  const evidence = collectMultiLaneActivationEvidence({
    now: "2026-07-28T12:00:00.000Z",
  });

  assert.equal(
    evidence.schema_version,
    "pulse-multi-lane-activation-evidence-v2",
  );
  assert.equal(evidence.collection.verdict, "BLOCKED");
  assert.ok(
    evidence.collection.blockers.includes(
      "activation_artifact_index_required",
    ),
  );
  assert.deepEqual(Object.keys(evidence.lanes), [
    "breaking_short",
    "evergreen_short",
    "weekly_longform",
  ]);
  for (const lane of Object.values(evidence.lanes)) {
    assert.deepEqual(Object.keys(lane), [
      "planning",
      "production",
      "human_review",
      "live_dispatch",
    ]);
    for (const stage of Object.values(lane)) {
      assert.equal(stage.status, "BLOCKED");
      assert.equal(stage.proof_refs.length, 0);
    }
    assert.equal(lane.live_dispatch.runtime_armed, false);
  }
});

test("exact fresh stage proofs and runtime capabilities derive complete v2 activation evidence", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-evidence-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    assert.equal(evidence.collection.verdict, "PROVEN");
    assert.deepEqual(evidence.collection.blockers, []);
    for (const lane of Object.values(evidence.lanes)) {
      for (const stage of Object.values(lane)) {
        assert.equal(stage.status, "PROVEN");
        assert.ok(stage.proof_refs.length >= 2);
        assert.ok(
          stage.artifact_bindings.every(
            (binding) =>
              binding.sha256_matches === true &&
              binding.read_only === true,
          ),
        );
      }
    }
    assert.equal(
      evidence.lanes.evergreen_short.production
        .editorial_enrichment_proven,
      true,
    );
    assert.equal(
      evidence.lanes.evergreen_short.production
        .production_runner_proven,
      true,
    );
    assert.equal(
      evidence.lanes.weekly_longform.production
        .editorial_enrichment_proven,
      true,
    );
    assert.equal(
      evidence.lanes.weekly_longform.production
        .production_runner_proven,
      true,
    );
    assert.deepEqual(
      evidence.lanes.weekly_longform.production
        .runtime_capabilities,
      fixture.runtimeCapabilities,
    );
    assert.equal(
      evidence.lanes.breaking_short.human_review.gate_enforced,
      true,
    );
    assert.equal(
      evidence.lanes.breaking_short.live_dispatch
        .exact_binding_enforced,
      true,
    );
    assert.equal(
      evidence.lanes.breaking_short.live_dispatch
        .kill_switch_enforced,
      true,
    );
    assert.equal(
      evidence.lanes.breaking_short.live_dispatch
        .control_tower_gate_enforced,
      true,
    );
    assert.equal(
      evidence.lanes.breaking_short.live_dispatch.runtime_armed,
      false,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an artefact changed after indexing blocks only the stage that consumed it", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-evidence-drift-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    const reference = fixture.index.artifacts.find(
      (artifact) =>
        artifact.lane_id === "breaking_short" &&
        artifact.stage === "planning" &&
        artifact.role === "stage_proof",
    );
    fs.appendFileSync(
      path.join(directory, reference.path),
      "\n",
      "utf8",
    );

    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    const changed = evidence.lanes.breaking_short.planning;
    assert.equal(changed.status, "BLOCKED");
    assert.ok(
      changed.blockers.includes(
        "stage_proof:breaking_short:planning_sha256_mismatch",
      ),
    );
    assert.equal(
      changed.artifact_bindings[0].sha256_matches,
      false,
    );
    assert.equal(evidence.lanes.breaking_short.production.status, "PROVEN");
    assert.equal(evidence.collection.verdict, "BLOCKED");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("source drift behind an unchanged proof report is detected by re-hashing the live file", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-source-drift-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    fs.writeFileSync(
      fixture.sourcePath,
      '"use strict";\nmodule.exports = { changed: true };\n',
      "utf8",
    );

    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    const stage = evidence.lanes.weekly_longform.production;
    assert.equal(stage.status, "BLOCKED");
    assert.ok(
      stage.blockers.some((blocker) =>
        blocker.includes("source_binding") &&
        blocker.endsWith("_sha256_mismatch"),
      ),
    );
    assert.ok(
      stage.artifact_bindings.some(
        (binding) =>
          binding.role === "source_binding" &&
          binding.sha256_matches === false,
      ),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a hash-valid but stale stage proof cannot produce PROVEN evidence", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-stale-proof-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    const reference = fixture.index.artifacts.find(
      (artifact) =>
        artifact.lane_id === "evergreen_short" &&
        artifact.stage === "production" &&
        artifact.role === "stage_proof",
    );
    rewriteIndexedJson(fixture, reference, (proof) => {
      proof.generated_at = "2026-07-01T00:00:00.000Z";
    });

    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    const stage = evidence.lanes.evergreen_short.production;
    assert.equal(stage.status, "BLOCKED");
    assert.ok(
      stage.blockers.includes(
        "stage_proof:evergreen_short:production_stale",
      ),
    );
    assert.equal(stage.editorial_enrichment_proven, false);
    assert.equal(stage.production_runner_proven, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unsupported readiness booleans cannot replace a named passing proof check", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-unsupported-boolean-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    const reference = fixture.index.artifacts.find(
      (artifact) =>
        artifact.lane_id === "breaking_short" &&
        artifact.stage === "human_review" &&
        artifact.role === "stage_proof",
    );
    rewriteIndexedJson(fixture, reference, (proof) => {
      proof.checks = [];
      proof.gate_enforced = true;
      proof.ready = true;
    });

    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    const stage = evidence.lanes.breaking_short.human_review;
    assert.equal(stage.status, "BLOCKED");
    assert.equal(stage.gate_enforced, false);
    assert.ok(
      stage.blockers.includes(
        "stage_proof:breaking_short:human_review_required_check_missing:" +
          "human_review_gate_enforced",
      ),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime ready=true is rejected when a concrete dependency or safety detail is not ready", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-runtime-details-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    const reference = fixture.index.artifacts.find(
      (artifact) => artifact.role === "runtime_capabilities",
    );
    rewriteIndexedJson(fixture, reference, (runtime) => {
      runtime.ready = true;
      runtime.dependencies.materializeDerivatives.available = false;
      runtime.safety.upload_authority = true;
    });

    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    const stage = evidence.lanes.weekly_longform.production;
    assert.equal(stage.status, "BLOCKED");
    assert.ok(
      stage.blockers.includes(
        "weekly_longform_runtime_dependency_unavailable:" +
          "materializeDerivatives",
      ),
    );
    assert.ok(
      stage.blockers.includes(
        "weekly_longform_runtime_safety_flag_invalid:upload_authority",
      ),
    );
    assert.equal(stage.editorial_enrichment_proven, false);
    assert.equal(stage.production_runner_proven, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("polluted runtime capability keys block collection and are never echoed into evidence", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-runtime-pollution-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    const reference = fixture.index.artifacts.find(
      (artifact) => artifact.role === "runtime_capabilities",
    );
    rewriteIndexedJson(fixture, reference, (runtime) => {
      runtime.blockers = [
        "hand-authored diagnostic contains sensitive value = do-not-echo",
      ];
      runtime.unexpected_top_level = {
        client_secret: "must-not-enter-collected-evidence",
      };
      runtime.dependencies.produceNarration.access_token =
        "also-must-not-enter-collected-evidence";
      runtime.safety.debug_payload = {
        api_key: "never-echo-this-value",
      };
    });

    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    const stage = evidence.lanes.weekly_longform.production;
    assert.equal(stage.status, "BLOCKED");
    assert.ok(
      stage.blockers.includes(
        "weekly_longform_runtime_capabilities_document_keys_invalid",
      ),
    );
    assert.ok(
      stage.blockers.includes(
        "weekly_longform_runtime_capabilities_dependency_keys_invalid",
      ),
    );
    assert.ok(
      stage.blockers.includes(
        "weekly_longform_runtime_capabilities_safety_keys_invalid",
      ),
    );
    assert.ok(
      stage.blockers.includes(
        "weekly_longform_runtime_capabilities_blockers_invalid",
      ),
    );
    assert.deepEqual(stage.runtime_capabilities, {
      ...fixture.runtimeCapabilities,
      blockers: ["runtime_capability_probe_reports_blockers"],
    });
    const serialised = JSON.stringify(evidence);
    assert.doesNotMatch(serialised, /client_secret|access_token|api_key/);
    assert.doesNotMatch(
      serialised,
      /must-not-enter|never-echo|unexpected_top_level|debug_payload/,
    );
    assert.doesNotMatch(serialised, /hand-authored diagnostic|do-not-echo/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("token and environment-secret paths are refused before collection", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-secret-boundary-"),
  );
  try {
    const tokensDirectory = path.join(directory, "tokens");
    fs.mkdirSync(tokensDirectory);
    const indexPath = path.join(tokensDirectory, "activation-index.json");
    fs.writeFileSync(indexPath, '{"not":"read"}\n', "utf8");

    const evidence = collectMultiLaneActivationEvidence({
      indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    assert.equal(evidence.collection.verdict, "BLOCKED");
    assert.deepEqual(evidence.collection.blockers, [
      "activation_artifact_index_secret_path_forbidden",
    ]);
    assert.equal(evidence.collection.index_source, null);
    assert.equal(evidence.collection.safety.token_material_accessed, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("collector output has deterministic JSON and an operator-readable provenance summary", () => {
  const evidence = collectMultiLaneActivationEvidence({
    now: "2026-07-28T12:00:00.000Z",
  });

  assert.deepEqual(
    JSON.parse(renderMultiLaneActivationEvidenceJson(evidence)),
    evidence,
  );
  const markdown =
    renderMultiLaneActivationEvidenceMarkdown(evidence);
  assert.match(markdown, /^# Pulse Gaming Multi-lane Activation Evidence/m);
  assert.match(markdown, /Verdict: BLOCKED/);
  assert.match(markdown, /breaking_short \| planning \| BLOCKED/);
  assert.match(markdown, /No network, database, OAuth, token or publish action/i);
  assert.match(markdown, /does not prove an external publication/i);
});

test("collected evidence feeds the existing v2 proof without arming or claiming publication", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-proof-integration-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });
    const report = buildMultiLaneActivationProof({
      now: "2026-07-28T12:00:00.000Z",
      ...inspectRepositoryWiring(),
      evidence,
    });

    assert.equal(report.aggregate_verdict, "AMBER");
    assert.deepEqual(report.global_blockers, []);
    assert.ok(
      report.lanes.every(
        (lane) =>
          lane.stages.planning.verdict === "GREEN" &&
          lane.stages.production.verdict === "GREEN" &&
          lane.stages.human_review.verdict === "GREEN" &&
          lane.stages.live_dispatch.verdict === "AMBER" &&
          lane.stages.live_dispatch.runtime_armed === false,
      ),
    );
    assert.equal(report.external_publication.verified, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("the inventory itself rejects unsupported lane, stage and role records", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-index-contract-"),
  );
  try {
    const fixture = createCompleteInventory(directory);
    fixture.index.artifacts.push({
      id: "unsupported-claim",
      lane_id: "invented_lane",
      stage: "ready",
      role: "magic_boolean",
      path: "does-not-matter.json",
      sha256: "a".repeat(64),
      ready: true,
    });
    writeJson(fixture.indexPath, fixture.index);

    const evidence = collectMultiLaneActivationEvidence({
      indexPath: fixture.indexPath,
      now: "2026-07-28T12:00:00.000Z",
    });

    assert.equal(evidence.collection.verdict, "BLOCKED");
    assert.ok(
      evidence.collection.blockers.includes(
        "activation_artifact_lane_invalid:invented_lane",
      ),
    );
    assert.ok(
      evidence.collection.blockers.includes(
        "activation_artifact_stage_invalid:ready",
      ),
    );
    assert.ok(
      evidence.collection.blockers.includes(
        "activation_artifact_role_invalid:magic_boolean",
      ),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
