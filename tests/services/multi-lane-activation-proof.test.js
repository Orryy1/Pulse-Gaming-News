"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildMultiLaneActivationProof: buildRawMultiLaneActivationProof,
  MULTI_LANE_ACTIVATION_EVIDENCE_SCHEMA,
  MULTI_LANE_ACTIVATION_PROOF_SCHEMA,
  MULTI_LANE_RUNTIME_WIRING_SCHEMA,
  readMultiLaneActivationEvidenceFile,
  renderMultiLaneActivationProofJson,
  renderMultiLaneActivationProofMarkdown,
} = require("../../lib/services/multi-lane-activation-proof");

test("activation proof schemas are exported for evidence producers", () => {
  assert.equal(
    MULTI_LANE_ACTIVATION_EVIDENCE_SCHEMA,
    "pulse-multi-lane-activation-evidence-v2",
  );
  assert.equal(
    MULTI_LANE_ACTIVATION_PROOF_SCHEMA,
    "pulse-multi-lane-activation-proof-v2",
  );
  assert.equal(
    MULTI_LANE_RUNTIME_WIRING_SCHEMA,
    "pulse-multi-lane-runtime-wiring-v1",
  );
});

function provenRuntimeWiring(overrides = {}) {
  return {
    schema_version: "pulse-multi-lane-runtime-wiring-v1",
    source_bindings: [
      {
        component: "queue_bootstrap",
        path: "lib/bootstrap-queue.js",
        sha256: "a".repeat(64),
        bytes: 100,
        read_only: true,
      },
      {
        component: "server_entrypoint",
        path: "server.js",
        sha256: "b".repeat(64),
        bytes: 100,
        read_only: true,
      },
      {
        component: "run_entrypoint",
        path: "run.js",
        sha256: "c".repeat(64),
        bytes: 100,
        read_only: true,
      },
    ],
    isolated_worker_pools: {
      default_enabled: true,
    },
    breaking_watcher: {
      server_default_enabled: true,
      run_default_enabled: true,
    },
    ...overrides,
  };
}

function buildMultiLaneActivationProof(options = {}) {
  return buildRawMultiLaneActivationProof({
    runtimeWiring: provenRuntimeWiring(),
    ...options,
  });
}

function registeredHandlers() {
  return Object.fromEntries(
    [
      "breaking_story_discovery",
      "governed_editorial_evidence_backfill",
      "governed_editorial_evidence_discovery",
      "reconcile_editorial_inventory",
      "prepare_editorial_inventory",
      "evergreen_candidate_builder",
      "longform_evidence_refresh",
      "governed_multi_lane_plan",
      "plan_breaking_short",
      "plan_evergreen_short",
      "plan_weekly_longform",
      "produce_breaking_short",
      "enrich_evergreen_short",
      "produce_evergreen_short",
      "enrich_weekly_longform",
      "produce_weekly_longform",
      "review_breaking_short",
      "review_evergreen_short",
      "review_weekly_longform",
      "admit_governed_publication",
      "dispatch_governed_publication",
    ].map((kind) => [kind, () => {}]),
  );
}

function schedules() {
  return [
    {
      name: "governed_multi_lane_plan",
      kind: "governed_multi_lane_plan",
      cron_expr: "*/15 * * * *",
    },
    {
      name: "governed_editorial_evidence_backfill",
      kind: "governed_editorial_evidence_backfill",
      cron_expr: "5 */2 * * *",
    },
    {
      name: "editorial_inventory_reconcile",
      kind: "reconcile_editorial_inventory",
      cron_expr: "*/30 * * * *",
    },
    {
      name: "evergreen_candidate_builder",
      kind: "evergreen_candidate_builder",
      cron_expr: "30 */6 * * *",
    },
    {
      name: "longform_evidence_refresh",
      kind: "longform_evidence_refresh",
      cron_expr: "15 5 * * *",
    },
    {
      name: "weekly_longform_planner",
      kind: "plan_weekly_longform",
      cron_expr: "15 */6 * * *",
    },
  ];
}

function workerDefinitions() {
  return [
    {
      pool_id: "breaking_planning",
      instances: 2,
      kinds: [
        "breaking_story_discovery",
        "plan_breaking_short",
      ],
    },
    {
      pool_id: "editorial_evidence_capture",
      instances: 2,
      kinds: ["governed_editorial_evidence_discovery"],
    },
    {
      pool_id: "editorial_preparation",
      instances: 1,
      kinds: [
        "prepare_editorial_inventory",
        "reconcile_editorial_inventory",
      ],
    },
    {
      pool_id: "critical_planning",
      kinds: [
        "evergreen_candidate_builder",
        "governed_editorial_evidence_backfill",
        "governed_multi_lane_plan",
        "plan_evergreen_short",
        "plan_weekly_longform",
      ],
    },
    {
      pool_id: "governed_review",
      instances: 2,
      kinds: [
        "review_breaking_short",
        "review_evergreen_short",
        "review_weekly_longform",
      ],
    },
    {
      pool_id: "critical_publication",
      kinds: [
        "admit_governed_publication",
        "dispatch_governed_publication",
      ],
    },
    {
      pool_id: "breaking_production",
      instances: 2,
      kinds: ["produce_breaking_short"],
    },
    {
      pool_id: "evergreen_production",
      instances: 1,
      kinds: [
        "enrich_evergreen_short",
        "produce_evergreen_short",
      ],
    },
    {
      pool_id: "longform_production",
      instances: 1,
      kinds: [
        "longform_evidence_refresh",
        "enrich_weekly_longform",
        "produce_weekly_longform",
      ],
    },
  ];
}

function provenStage(overrides = {}) {
  return {
    status: "PROVEN",
    observed_at: "2026-07-28T11:30:00.000Z",
    proof_refs: ["node-test:focused-suite"],
    ...overrides,
  };
}

function readyWeeklyRuntimeCapabilities(overrides = {}) {
  return {
    schema_version:
      "pulse-weekly-longform-runtime-capabilities-v1",
    ready: true,
    blockers: [],
    dependencies: {
      produceNarration: { available: true },
      materializeAlignment: { available: true },
      renderLongform: { available: true },
      materializeVariants: { available: true },
      runDecodedQa: { available: true },
      materializeDerivatives: { available: true },
    },
    safety: {
      implicit_network_enabled: false,
      implicit_process_spawn_enabled: false,
      upload_authority: false,
      oauth_mutation_authority: false,
      database_mutation_authority: false,
    },
    ...overrides,
  };
}

function provenEvidence({ runtimeArmed = false } = {}) {
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
          human_review: provenStage({
            gate_enforced: true,
          }),
          live_dispatch: provenStage({
            exact_binding_enforced: true,
            kill_switch_enforced: true,
            control_tower_gate_enforced: true,
            runtime_armed: runtimeArmed,
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
    runtime_capabilities: readyWeeklyRuntimeCapabilities(),
  });
  return evidence;
}

test("missing lane evidence fails closed even when all wiring exists", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: {},
  });

  assert.equal(report.aggregate_verdict, "BLOCKED");
  assert.equal(report.lanes.length, 3);
  for (const lane of report.lanes) {
    assert.equal(lane.verdict, "BLOCKED");
    assert.deepEqual(
      Object.keys(lane.stages),
      ["planning", "production", "human_review", "live_dispatch"],
    );
    for (const stage of Object.values(lane.stages)) {
      assert.equal(stage.verdict, "BLOCKED");
      assert.ok(
        stage.blockers.some((blocker) =>
          blocker.includes("evidence_required"),
        ),
      );
    }
  }
  assert.deepEqual(report.external_publication, {
    in_scope: false,
    verified: false,
    statement:
      "This report proves activation readiness only; it does not prove that any external post was published.",
  });
});

test("proven capabilities remain AMBER while guarded live dispatch is not armed", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence(),
  });

  assert.equal(report.aggregate_verdict, "AMBER");
  for (const lane of report.lanes) {
    assert.equal(lane.verdict, "AMBER");
    assert.equal(lane.stages.planning.verdict, "GREEN");
    assert.equal(lane.stages.production.verdict, "GREEN");
    assert.equal(lane.stages.human_review.verdict, "GREEN");
    assert.equal(lane.stages.live_dispatch.verdict, "AMBER");
    assert.ok(
      lane.stages.live_dispatch.advisories.includes(
        "live_dispatch_runtime_not_armed",
      ),
    );
    assert.equal(
      lane.stages.live_dispatch.external_publication_verified,
      false,
    );
  }
});

test("fully proven guarded activation can be GREEN without claiming publication", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence({ runtimeArmed: true }),
  });

  assert.equal(report.aggregate_verdict, "GREEN");
  assert.ok(report.lanes.every((lane) => lane.verdict === "GREEN"));
  assert.equal(report.external_publication.in_scope, false);
  assert.equal(report.external_publication.verified, false);
  assert.doesNotMatch(JSON.stringify(report), /published_successfully/i);
});

test("an unknown evidence schema fails closed instead of blessing supplied claims", () => {
  const evidence = provenEvidence({ runtimeArmed: true });
  evidence.schema_version = "unknown-evidence-v99";

  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence,
  });

  assert.equal(report.aggregate_verdict, "BLOCKED");
  assert.ok(
    report.global_blockers.includes(
      "activation_evidence_schema_invalid",
    ),
  );
  assert.ok(report.lanes.every((lane) => lane.verdict === "BLOCKED"));
});

test("handler, schedule and worker topology gaps block only the affected stages", () => {
  const handlers = registeredHandlers();
  delete handlers.produce_breaking_short;
  const activeSchedules = schedules().filter(
    (schedule) => schedule.kind !== "evergreen_candidate_builder",
  );
  const pools = workerDefinitions().map((pool) => ({
    ...pool,
    kinds: pool.kinds.filter(
      (kind) => kind !== "produce_weekly_longform",
    ),
  }));

  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers,
    schedules: activeSchedules,
    workerDefinitions: pools,
    evidence: provenEvidence({ runtimeArmed: true }),
  });

  const byLane = Object.fromEntries(
    report.lanes.map((lane) => [lane.lane_id, lane]),
  );
  assert.ok(
    byLane.breaking_short.stages.production.blockers.includes(
      "handler_not_registered:produce_breaking_short",
    ),
  );
  assert.ok(
    byLane.evergreen_short.stages.planning.blockers.includes(
      "schedule_not_registered:evergreen_candidate_builder",
    ),
  );
  assert.ok(
    byLane.weekly_longform.stages.production.blockers.includes(
      "worker_pool_mismatch:produce_weekly_longform:" +
        "longform_production:unassigned",
    ),
  );
  assert.equal(report.aggregate_verdict, "BLOCKED");
});

test("JSON and Markdown renderers preserve stage verdicts and publication scope", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence(),
  });

  const json = renderMultiLaneActivationProofJson(report);
  assert.deepEqual(JSON.parse(json), report);

  const markdown = renderMultiLaneActivationProofMarkdown(report);
  assert.match(
    markdown,
    /^# Pulse Gaming Multi-lane Activation Proof/m,
  );
  assert.match(
    markdown,
    /\| Lane \| Planning \| Production \| Human review \| Live dispatch \| Overall \|/,
  );
  assert.match(markdown, /Breaking News Shorts/);
  assert.match(markdown, /AMBER/);
  assert.match(markdown, /## Runtime activation/);
  assert.match(markdown, /Isolated worker pools default: \*\*ENABLED\*\*/);
  assert.match(markdown, /Breaking watcher default via server: \*\*ENABLED\*\*/);
  assert.match(markdown, /Breaking watcher default via run: \*\*ENABLED\*\*/);
  assert.match(markdown, /Weekly longform runtime: \*\*READY\*\*/);
  assert.match(markdown, /Editorial enrichment evidenced: \*\*YES\*\*/);
  assert.match(markdown, /Production runner evidenced: \*\*YES\*\*/);
  assert.match(markdown, /does not prove that any external post was published/i);
  assert.doesNotMatch(markdown, /published successfully/i);
});

test("the report exposes positive handler, schedule and worker-pool inspections", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence({ runtimeArmed: true }),
  });

  const breaking = report.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.deepEqual(
    breaking.stages.planning.wiring.handlers.find(
      (check) => check.kind === "plan_breaking_short",
    ),
    { kind: "plan_breaking_short", registered: true },
  );
  assert.equal(
    breaking.stages.planning.wiring.schedules[0].registered,
    true,
  );
  assert.deepEqual(
    breaking.stages.production.wiring.worker_pools[0],
    {
      kind: "produce_breaking_short",
      expected_pool: "breaking_production",
      actual_pool: "breaking_production",
      matched: true,
    },
  );
});

test("the three-lane contract includes evergreen and weekly editorial enrichment in their isolated production pools", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence({ runtimeArmed: true }),
  });

  const evergreen = report.lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );
  const weekly = report.lanes.find(
    (lane) => lane.lane_id === "weekly_longform",
  );
  assert.deepEqual(
    evergreen.stages.production.wiring.handlers.map(
      (check) => check.kind,
    ),
    ["enrich_evergreen_short", "produce_evergreen_short"],
  );
  assert.deepEqual(
    weekly.stages.production.wiring.handlers.map(
      (check) => check.kind,
    ),
    ["enrich_weekly_longform", "produce_weekly_longform"],
  );
  assert.equal(
    evergreen.stages.production.wiring.worker_pools.find(
      (check) => check.kind === "enrich_evergreen_short",
    ).actual_pool,
    "evergreen_production",
  );
  assert.equal(
    weekly.stages.production.wiring.worker_pools.find(
      (check) => check.kind === "enrich_weekly_longform",
    ).actual_pool,
    "longform_production",
  );
});

test("each lane requires its exact review handler on dedicated governed review capacity", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence({ runtimeArmed: true }),
  });
  const expected = {
    breaking_short: "review_breaking_short",
    evergreen_short: "review_evergreen_short",
    weekly_longform: "review_weekly_longform",
  };

  for (const lane of report.lanes) {
    const review = lane.stages.human_review;
    assert.deepEqual(
      review.wiring.handlers.map((check) => check.kind),
      [expected[lane.lane_id], "admit_governed_publication"],
    );
    assert.equal(
      review.wiring.worker_pools.find(
        (check) => check.kind === expected[lane.lane_id],
      ).actual_pool,
      "governed_review",
    );
  }
  assert.deepEqual(
    report.runtime_activation.isolated_worker_pools.pools.find(
      (pool) => pool.pool_id === "governed_review",
    ),
    {
      pool_id: "governed_review",
      expected_instances: 2,
      actual_instances: 2,
      matched: true,
    },
  );
});

test("evergreen and weekly planning require isolated evidence capture and responsive inventory preparation", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence({ runtimeArmed: true }),
  });

  const byLane = Object.fromEntries(
    report.lanes.map((lane) => [lane.lane_id, lane]),
  );
  for (const laneId of ["evergreen_short", "weekly_longform"]) {
    const planning = byLane[laneId].stages.planning;
    assert.deepEqual(
      planning.wiring.handlers.find(
        (check) => check.kind === "reconcile_editorial_inventory",
      ),
      { kind: "reconcile_editorial_inventory", registered: true },
    );
    assert.deepEqual(
      planning.wiring.handlers.find(
        (check) => check.kind === "prepare_editorial_inventory",
      ),
      { kind: "prepare_editorial_inventory", registered: true },
    );
    assert.deepEqual(
      planning.wiring.worker_pools.find(
        (check) =>
          check.kind ===
          "governed_editorial_evidence_discovery",
      ),
      {
        kind: "governed_editorial_evidence_discovery",
        expected_pool: "editorial_evidence_capture",
        actual_pool: "editorial_evidence_capture",
        matched: true,
      },
    );
    assert.deepEqual(
      planning.wiring.worker_pools.find(
        (check) => check.kind === "prepare_editorial_inventory",
      ),
      {
        kind: "prepare_editorial_inventory",
        expected_pool: "editorial_preparation",
        actual_pool: "editorial_preparation",
        matched: true,
      },
    );
    assert.deepEqual(
      planning.wiring.schedules.find(
        (check) =>
          check.kind === "reconcile_editorial_inventory",
      ),
      {
        name: "editorial_inventory_reconcile",
        kind: "reconcile_editorial_inventory",
        expected_cron: "*/30 * * * *",
        actual_cron: "*/30 * * * *",
        registered: true,
        matched: true,
      },
    );
  }
  assert.deepEqual(
    report.runtime_activation.isolated_worker_pools.pools.find(
      (pool) => pool.pool_id === "editorial_evidence_capture",
    ),
    {
      pool_id: "editorial_evidence_capture",
      expected_instances: 2,
      actual_instances: 2,
      matched: true,
    },
  );
  assert.deepEqual(
    report.runtime_activation.isolated_worker_pools.pools.find(
      (pool) => pool.pool_id === "editorial_preparation",
    ),
    {
      pool_id: "editorial_preparation",
      expected_instances: 1,
      actual_instances: 1,
      matched: true,
    },
  );
});

test("missing editorial preparation capacity blocks evergreen and longform planning but not breaking", () => {
  const pools = workerDefinitions().filter(
    (pool) => pool.pool_id !== "editorial_preparation",
  );
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: pools,
    evidence: provenEvidence({ runtimeArmed: true }),
  });
  const byLane = Object.fromEntries(
    report.lanes.map((lane) => [lane.lane_id, lane]),
  );

  assert.equal(byLane.breaking_short.stages.planning.verdict, "GREEN");
  for (const laneId of ["evergreen_short", "weekly_longform"]) {
    assert.ok(
      byLane[laneId].stages.planning.blockers.includes(
        "isolated_worker_pool_capacity_mismatch:" +
          "editorial_preparation:1:unassigned",
      ),
    );
  }
  assert.equal(report.aggregate_verdict, "BLOCKED");
});

test("missing editorial evidence capture capacity blocks evidence-backed planning without blocking breaking", () => {
  const pools = workerDefinitions().filter(
    (pool) => pool.pool_id !== "editorial_evidence_capture",
  );
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: pools,
    evidence: provenEvidence({ runtimeArmed: true }),
  });
  const byLane = Object.fromEntries(
    report.lanes.map((lane) => [lane.lane_id, lane]),
  );

  assert.equal(byLane.breaking_short.stages.planning.verdict, "GREEN");
  for (const laneId of ["evergreen_short", "weekly_longform"]) {
    assert.ok(
      byLane[laneId].stages.planning.blockers.includes(
        "isolated_worker_pool_capacity_mismatch:" +
          "editorial_evidence_capture:2:unassigned",
      ),
    );
  }
  assert.equal(report.aggregate_verdict, "BLOCKED");
});

test("weekly production fails closed without a complete safe runtime-capability report", () => {
  const evidence = provenEvidence({ runtimeArmed: true });
  delete evidence.lanes.weekly_longform.production.runtime_capabilities;

  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence,
  });

  const weekly = report.lanes.find(
    (lane) => lane.lane_id === "weekly_longform",
  );
  assert.equal(weekly.stages.production.verdict, "BLOCKED");
  assert.ok(
    weekly.stages.production.blockers.includes(
      "weekly_longform_runtime_capabilities_required",
    ),
  );
  assert.equal(
    weekly.stages.production.capabilities.weekly_longform_runtime
      .ready,
    false,
  );
  assert.equal(report.aggregate_verdict, "BLOCKED");
});

test("weekly runtime evidence cannot be GREEN with a missing dependency or any mutation authority", () => {
  const evidence = provenEvidence({ runtimeArmed: true });
  evidence.lanes.weekly_longform.production.runtime_capabilities
    .dependencies.renderLongform.available = false;
  evidence.lanes.weekly_longform.production.runtime_capabilities
    .safety.upload_authority = true;

  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence,
  });
  const production = report.lanes.find(
    (lane) => lane.lane_id === "weekly_longform",
  ).stages.production;

  assert.equal(production.verdict, "BLOCKED");
  assert.ok(
    production.blockers.includes(
      "weekly_longform_runtime_dependency_unavailable:renderLongform",
    ),
  );
  assert.ok(
    production.blockers.includes(
      "weekly_longform_runtime_safety_flag_invalid:upload_authority",
    ),
  );
  assert.equal(
    production.capabilities.weekly_longform_runtime.ready,
    false,
  );
});

test("evergreen and weekly production evidence must prove both enrichment and the governed production runner", () => {
  const evidence = provenEvidence({ runtimeArmed: true });
  delete evidence.lanes.evergreen_short.production
    .editorial_enrichment_proven;
  delete evidence.lanes.weekly_longform.production
    .production_runner_proven;

  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence,
  });
  const byLane = Object.fromEntries(
    report.lanes.map((lane) => [lane.lane_id, lane]),
  );

  assert.ok(
    byLane.evergreen_short.stages.production.blockers.includes(
      "evergreen_editorial_enrichment_not_proven",
    ),
  );
  assert.ok(
    byLane.weekly_longform.stages.production.blockers.includes(
      "weekly_longform_production_runner_not_proven",
    ),
  );
  assert.equal(report.aggregate_verdict, "BLOCKED");
});

test("activation proof requires source-bound default isolated workers and both default breaking-watcher entrypoints", () => {
  const report = buildRawMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence({ runtimeArmed: true }),
    runtimeWiring: {
      schema_version: "pulse-multi-lane-runtime-wiring-v1",
      source_bindings: [],
      isolated_worker_pools: {
        default_enabled: false,
      },
      breaking_watcher: {
        server_default_enabled: true,
        run_default_enabled: false,
      },
    },
  });

  assert.equal(report.runtime_activation.verdict, "BLOCKED");
  assert.ok(
    report.runtime_activation.blockers.includes(
      "runtime_wiring_source_bindings_invalid",
    ),
  );
  assert.ok(
    report.runtime_activation.blockers.includes(
      "isolated_worker_pools_not_default",
    ),
  );
  assert.ok(
    report.runtime_activation.blockers.includes(
      "breaking_watcher_run_default_not_proven",
    ),
  );
  const byLane = Object.fromEntries(
    report.lanes.map((lane) => [lane.lane_id, lane]),
  );
  assert.ok(
    byLane.evergreen_short.stages.production.blockers.includes(
      "isolated_worker_pools_not_default",
    ),
  );
  assert.ok(
    byLane.breaking_short.stages.planning.blockers.includes(
      "breaking_watcher_run_default_not_proven",
    ),
  );
  assert.equal(report.aggregate_verdict, "BLOCKED");
});

test("runtime source bindings retain the exact three inspected component identities", () => {
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence({ runtimeArmed: true }),
  });

  assert.deepEqual(
    report.runtime_activation.source_bindings.map(
      (binding) => binding.component,
    ),
    ["queue_bootstrap", "server_entrypoint", "run_entrypoint"],
  );
  assert.equal(
    report.runtime_activation.source_bindings_valid,
    true,
  );
});

test("an isolated-pool capacity mismatch blocks only the production lane that owns that pool", () => {
  const changedPools = workerDefinitions().map((pool) =>
    pool.pool_id === "longform_production"
      ? { ...pool, instances: 2 }
      : pool,
  );
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: changedPools,
    evidence: provenEvidence({ runtimeArmed: true }),
  });
  const byLane = Object.fromEntries(
    report.lanes.map((lane) => [lane.lane_id, lane]),
  );

  assert.equal(
    byLane.breaking_short.stages.production.verdict,
    "GREEN",
  );
  assert.equal(
    byLane.evergreen_short.stages.production.verdict,
    "GREEN",
  );
  assert.ok(
    byLane.weekly_longform.stages.production.blockers.includes(
      "isolated_worker_pool_capacity_mismatch:" +
        "longform_production:1:2",
    ),
  );
  assert.equal(report.aggregate_verdict, "BLOCKED");
});

test("the upgraded activation contract emits v2 proof only for v2 evidence", () => {
  const evidence = provenEvidence({ runtimeArmed: true });
  evidence.schema_version =
    "pulse-multi-lane-activation-evidence-v2";
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence,
  });

  assert.equal(
    report.schema_version,
    "pulse-multi-lane-activation-proof-v2",
  );
  assert.deepEqual(report.global_blockers, []);
  assert.equal(report.aggregate_verdict, "GREEN");
});

test("evidence files are read locally and bound to the exact source bytes", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-evidence-"),
  );
  try {
    const evidencePath = path.join(directory, "evidence.json");
    const document = provenEvidence();
    const exactBytes = `${JSON.stringify(document, null, 2)}\n`;
    fs.writeFileSync(evidencePath, exactBytes, "utf8");

    const loaded = readMultiLaneActivationEvidenceFile(evidencePath);

    assert.deepEqual(loaded.evidence, document);
    assert.equal(loaded.source.path, path.resolve(evidencePath));
    assert.equal(loaded.source.bytes, Buffer.byteLength(exactBytes));
    assert.match(loaded.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(loaded.source.read_only, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("evidence loading refuses token and environment-secret paths", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-secret-boundary-"),
  );
  try {
    const tokensDirectory = path.join(directory, "tokens");
    fs.mkdirSync(tokensDirectory);
    const evidencePath = path.join(tokensDirectory, "evidence.json");
    fs.writeFileSync(evidencePath, "{}\n", "utf8");

    assert.throws(
      () => readMultiLaneActivationEvidenceFile(evidencePath),
      /multi_lane_activation_evidence_secret_path_forbidden/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stale stage evidence cannot produce a GREEN activation verdict", () => {
  const evidence = provenEvidence({ runtimeArmed: true });
  evidence.lanes.breaking_short.production.observed_at =
    "2026-07-01T00:00:00.000Z";

  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: schedules(),
    workerDefinitions: workerDefinitions(),
    evidence,
  });

  const breaking = report.lanes.find(
    (lane) => lane.lane_id === "breaking_short",
  );
  assert.equal(breaking.stages.production.verdict, "BLOCKED");
  assert.ok(
    breaking.stages.production.blockers.includes(
      "production_evidence_stale",
    ),
  );
  assert.equal(report.aggregate_verdict, "BLOCKED");
});

test("a changed scheduler cadence is reported as a wiring blocker", () => {
  const changedSchedules = schedules().map((schedule) =>
    schedule.kind === "evergreen_candidate_builder"
      ? { ...schedule, cron_expr: "0 0 * * *" }
      : schedule,
  );
  const report = buildMultiLaneActivationProof({
    now: "2026-07-28T12:00:00.000Z",
    handlers: registeredHandlers(),
    schedules: changedSchedules,
    workerDefinitions: workerDefinitions(),
    evidence: provenEvidence({ runtimeArmed: true }),
  });

  const evergreen = report.lanes.find(
    (lane) => lane.lane_id === "evergreen_short",
  );
  assert.ok(
    evergreen.stages.planning.blockers.includes(
      "schedule_cron_mismatch:evergreen_candidate_builder:" +
        "30 */6 * * *:0 0 * * *",
    ),
  );
  assert.equal(
    evergreen.stages.planning.wiring.schedules.find(
      (check) => check.kind === "evergreen_candidate_builder",
    ).matched,
    false,
  );
});
