"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const LANE_CONTRACTS = Object.freeze([
  Object.freeze({
    lane_id: "breaking_short",
    label: "Breaking News Shorts",
    stages: Object.freeze({
      planning: Object.freeze({
        handlers: Object.freeze([
          "breaking_story_discovery",
          "governed_multi_lane_plan",
          "plan_breaking_short",
        ]),
        schedules: Object.freeze([
          Object.freeze({
            kind: "governed_multi_lane_plan",
            cron_expr: "*/15 * * * *",
          }),
        ]),
        pools: Object.freeze({
          breaking_story_discovery: "breaking_planning",
          governed_multi_lane_plan: "critical_planning",
          plan_breaking_short: "breaking_planning",
        }),
      }),
      production: Object.freeze({
        handlers: Object.freeze(["produce_breaking_short"]),
        schedules: Object.freeze([]),
        pools: Object.freeze({
          produce_breaking_short: "breaking_production",
        }),
      }),
    }),
  }),
  Object.freeze({
    lane_id: "evergreen_short",
    label: "Evergreen Epix-style Verdict Shorts",
    stages: Object.freeze({
      planning: Object.freeze({
        handlers: Object.freeze([
          "governed_editorial_evidence_backfill",
          "governed_editorial_evidence_discovery",
          "reconcile_editorial_inventory",
          "prepare_editorial_inventory",
          "evergreen_candidate_builder",
          "governed_multi_lane_plan",
          "plan_evergreen_short",
        ]),
        schedules: Object.freeze([
          Object.freeze({
            name: "governed_editorial_evidence_backfill",
            kind: "governed_editorial_evidence_backfill",
            cron_expr: "5 */2 * * *",
          }),
          Object.freeze({
            name: "editorial_inventory_reconcile",
            kind: "reconcile_editorial_inventory",
            cron_expr: "*/30 * * * *",
          }),
          Object.freeze({
            kind: "governed_multi_lane_plan",
            cron_expr: "*/15 * * * *",
          }),
          Object.freeze({
            kind: "evergreen_candidate_builder",
            cron_expr: "30 */6 * * *",
          }),
        ]),
        pools: Object.freeze({
          governed_editorial_evidence_backfill:
            "critical_planning",
          governed_editorial_evidence_discovery:
            "editorial_evidence_capture",
          reconcile_editorial_inventory: "editorial_preparation",
          prepare_editorial_inventory: "editorial_preparation",
          evergreen_candidate_builder: "critical_planning",
          governed_multi_lane_plan: "critical_planning",
          plan_evergreen_short: "critical_planning",
        }),
      }),
      production: Object.freeze({
        handlers: Object.freeze([
          "enrich_evergreen_short",
          "produce_evergreen_short",
        ]),
        schedules: Object.freeze([]),
        pools: Object.freeze({
          enrich_evergreen_short: "evergreen_production",
          produce_evergreen_short: "evergreen_production",
        }),
      }),
    }),
  }),
  Object.freeze({
    lane_id: "weekly_longform",
    label: "Weekly Flagship Longform",
    stages: Object.freeze({
      planning: Object.freeze({
        handlers: Object.freeze([
          "governed_editorial_evidence_backfill",
          "governed_editorial_evidence_discovery",
          "reconcile_editorial_inventory",
          "prepare_editorial_inventory",
          "plan_weekly_longform",
        ]),
        schedules: Object.freeze([
          Object.freeze({
            name: "governed_editorial_evidence_backfill",
            kind: "governed_editorial_evidence_backfill",
            cron_expr: "5 */2 * * *",
          }),
          Object.freeze({
            name: "editorial_inventory_reconcile",
            kind: "reconcile_editorial_inventory",
            cron_expr: "*/30 * * * *",
          }),
          Object.freeze({
            name: "weekly_longform_planner",
            kind: "plan_weekly_longform",
            cron_expr: "15 */6 * * *",
          }),
        ]),
        pools: Object.freeze({
          governed_editorial_evidence_backfill:
            "critical_planning",
          governed_editorial_evidence_discovery:
            "editorial_evidence_capture",
          reconcile_editorial_inventory: "editorial_preparation",
          prepare_editorial_inventory: "editorial_preparation",
          plan_weekly_longform: "critical_planning",
        }),
      }),
      production: Object.freeze({
        handlers: Object.freeze([
          "enrich_weekly_longform",
          "produce_weekly_longform",
        ]),
        schedules: Object.freeze([]),
        pools: Object.freeze({
          enrich_weekly_longform: "longform_production",
          produce_weekly_longform: "longform_production",
        }),
      }),
    }),
  }),
]);

const STAGES = Object.freeze([
  "planning",
  "production",
  "human_review",
  "live_dispatch",
]);
const WEEKLY_LONGFORM_RUNTIME_CAPABILITIES_SCHEMA =
  "pulse-weekly-longform-runtime-capabilities-v1";
const WEEKLY_LONGFORM_RUNTIME_DEPENDENCIES = Object.freeze([
  "produceNarration",
  "materializeAlignment",
  "renderLongform",
  "materializeVariants",
  "runDecodedQa",
  "materializeDerivatives",
]);
const WEEKLY_LONGFORM_RUNTIME_SAFETY_FLAGS = Object.freeze([
  "implicit_network_enabled",
  "implicit_process_spawn_enabled",
  "upload_authority",
  "oauth_mutation_authority",
  "database_mutation_authority",
]);
const MULTI_LANE_RUNTIME_WIRING_SCHEMA =
  "pulse-multi-lane-runtime-wiring-v1";
const MULTI_LANE_ACTIVATION_EVIDENCE_SCHEMA =
  "pulse-multi-lane-activation-evidence-v2";
const MULTI_LANE_ACTIVATION_PROOF_SCHEMA =
  "pulse-multi-lane-activation-proof-v2";
const REVIEW_HANDLER_BY_LANE = Object.freeze({
  breaking_short: "review_breaking_short",
  evergreen_short: "review_evergreen_short",
  weekly_longform: "review_weekly_longform",
});
const REQUIRED_ISOLATED_PRODUCTION_POOLS = Object.freeze([
  Object.freeze({
    pool_id: "editorial_evidence_capture",
    instances: 2,
  }),
  Object.freeze({
    pool_id: "editorial_preparation",
    instances: 1,
  }),
  Object.freeze({
    pool_id: "governed_review",
    instances: 2,
  }),
  Object.freeze({
    pool_id: "breaking_planning",
    instances: 2,
  }),
  Object.freeze({
    pool_id: "breaking_production",
    instances: 2,
  }),
  Object.freeze({
    pool_id: "evergreen_production",
    instances: 1,
  }),
  Object.freeze({
    pool_id: "longform_production",
    instances: 1,
  }),
]);

function evidenceForLane(evidence, laneId) {
  const lanes = evidence?.lanes;
  if (!lanes || typeof lanes !== "object" || Array.isArray(lanes)) {
    return {};
  }
  const lane = lanes[laneId];
  return lane && typeof lane === "object" && !Array.isArray(lane)
    ? lane
    : {};
}

function readMultiLaneActivationEvidenceFile(filePath) {
  const inputPath = String(filePath || "").trim();
  if (!inputPath) {
    throw new Error("multi_lane_activation_evidence_path_required");
  }
  const resolvedPath = path.resolve(inputPath);
  const pathParts = resolvedPath
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
  const basename = path.basename(resolvedPath).toLowerCase();
  if (
    pathParts.includes("tokens") ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    /(?:credential|oauth|access[_-]?token|client[_-]?secret)/i.test(
      basename,
    )
  ) {
    throw new Error(
      "multi_lane_activation_evidence_secret_path_forbidden",
    );
  }
  let exactBytes;
  try {
    exactBytes = fs.readFileSync(resolvedPath);
  } catch (error) {
    throw new Error(
      `multi_lane_activation_evidence_read_failed:${error.code || "unknown"}`,
    );
  }
  let evidence;
  try {
    evidence = JSON.parse(exactBytes.toString("utf8"));
  } catch {
    throw new Error("multi_lane_activation_evidence_json_invalid");
  }
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence)
  ) {
    throw new Error("multi_lane_activation_evidence_document_invalid");
  }
  return {
    evidence,
    source: {
      path: resolvedPath,
      sha256: crypto
        .createHash("sha256")
        .update(exactBytes)
        .digest("hex"),
      bytes: exactBytes.length,
      read_only: true,
    },
  };
}

function missingStage(stage) {
  return {
    verdict: "BLOCKED",
    evidence_status: "MISSING",
    blockers: [`${stage}_evidence_required`],
    advisories: [],
  };
}

function hasHandler(handlers, kind) {
  return typeof handlers?.[kind] === "function";
}

function findSchedule(schedules, requirement) {
  return (Array.isArray(schedules) ? schedules : []).find(
    (schedule) =>
      (!requirement.name || schedule?.name === requirement.name) &&
      (!requirement.kind || schedule?.kind === requirement.kind),
  );
}

function poolForKind(workerDefinitions, kind) {
  const definition = (
    Array.isArray(workerDefinitions) ? workerDefinitions : []
  ).find((pool) => Array.isArray(pool?.kinds) && pool.kinds.includes(kind));
  return String(definition?.pool_id || "").trim();
}

function validRuntimeSourceBindings(value) {
  if (!Array.isArray(value) || value.length !== 3) return false;
  const expectedComponents = new Set([
    "queue_bootstrap",
    "server_entrypoint",
    "run_entrypoint",
  ]);
  const observedComponents = new Set(
    value.map((binding) => String(binding?.component || "")),
  );
  if (
    expectedComponents.size !== observedComponents.size ||
    [...expectedComponents].some(
      (component) => !observedComponents.has(component),
    )
  ) {
    return false;
  }
  return value.every(
    (binding) =>
      binding &&
      typeof binding === "object" &&
      !Array.isArray(binding) &&
      typeof binding.path === "string" &&
      binding.path.trim().length > 0 &&
      /^[a-f0-9]{64}$/.test(String(binding.sha256 || "")) &&
      Number.isInteger(Number(binding.bytes)) &&
      Number(binding.bytes) > 0 &&
      binding.read_only === true,
  );
}

function inspectRuntimeActivation(runtimeWiring, workerDefinitions) {
  const blockers = [];
  if (
    !runtimeWiring ||
    typeof runtimeWiring !== "object" ||
    Array.isArray(runtimeWiring)
  ) {
    blockers.push("runtime_wiring_evidence_required");
  } else if (
    runtimeWiring.schema_version !==
    MULTI_LANE_RUNTIME_WIRING_SCHEMA
  ) {
    blockers.push("runtime_wiring_schema_invalid");
  }
  if (!validRuntimeSourceBindings(runtimeWiring?.source_bindings)) {
    blockers.push("runtime_wiring_source_bindings_invalid");
  }
  if (
    runtimeWiring?.isolated_worker_pools?.default_enabled !== true
  ) {
    blockers.push("isolated_worker_pools_not_default");
  }
  if (
    runtimeWiring?.breaking_watcher?.server_default_enabled !== true
  ) {
    blockers.push("breaking_watcher_server_default_not_proven");
  }
  if (
    runtimeWiring?.breaking_watcher?.run_default_enabled !== true
  ) {
    blockers.push("breaking_watcher_run_default_not_proven");
  }
  const workerPools = REQUIRED_ISOLATED_PRODUCTION_POOLS.map(
    (requirement) => {
      const actual = (
        Array.isArray(workerDefinitions) ? workerDefinitions : []
      ).find((pool) => pool?.pool_id === requirement.pool_id);
      const actualInstances = Number(actual?.instances);
      const matched =
        Number.isInteger(actualInstances) &&
        actualInstances === requirement.instances;
      if (!matched) {
        blockers.push(
          `isolated_worker_pool_capacity_mismatch:` +
            `${requirement.pool_id}:${requirement.instances}:` +
            `${
              Number.isInteger(actualInstances)
                ? actualInstances
                : "unassigned"
            }`,
        );
      }
      return {
        pool_id: requirement.pool_id,
        expected_instances: requirement.instances,
        actual_instances: Number.isInteger(actualInstances)
          ? actualInstances
          : null,
        matched,
      };
    },
  );
  return {
    schema_version: MULTI_LANE_RUNTIME_WIRING_SCHEMA,
    verdict: blockers.length === 0 ? "GREEN" : "BLOCKED",
    blockers: [...new Set(blockers)],
    source_bindings_valid: validRuntimeSourceBindings(
      runtimeWiring?.source_bindings,
    ),
    source_bindings: Array.isArray(runtimeWiring?.source_bindings)
      ? runtimeWiring.source_bindings.map((binding) => ({
          component: String(binding?.component || ""),
          path: String(binding?.path || ""),
          sha256: String(binding?.sha256 || ""),
          bytes: Number(binding?.bytes || 0),
          read_only: binding?.read_only === true,
        }))
      : [],
    isolated_worker_pools: {
      default_enabled:
        runtimeWiring?.isolated_worker_pools?.default_enabled ===
        true,
      pools: workerPools,
    },
    breaking_watcher: {
      server_default_enabled:
        runtimeWiring?.breaking_watcher?.server_default_enabled ===
        true,
      run_default_enabled:
        runtimeWiring?.breaking_watcher?.run_default_enabled ===
        true,
    },
  };
}

function runtimeBlockersForStage(runtimeActivation, contract, stage) {
  const runtimeBlockers = runtimeActivation.blockers || [];
  const blockers = runtimeBlockers.filter(
    (blocker) =>
      blocker.startsWith("runtime_wiring_") ||
      (stage === "production" &&
        (blocker === "isolated_worker_pools_not_default" ||
          blocker.startsWith(
            `isolated_worker_pool_capacity_mismatch:` +
              `${
                contract.lane_id === "breaking_short"
                  ? "breaking_production"
                  : contract.lane_id === "evergreen_short"
                    ? "evergreen_production"
                    : "longform_production"
              }:`,
          ))) ||
      (stage === "planning" &&
        contract.lane_id === "breaking_short" &&
        blocker.startsWith("breaking_watcher_")) ||
      (stage === "planning" &&
        ["evergreen_short", "weekly_longform"].includes(
          contract.lane_id,
        ) &&
        [
          "editorial_evidence_capture",
          "editorial_preparation",
        ].some((poolId) =>
          blocker.startsWith(
            "isolated_worker_pool_capacity_mismatch:" +
              `${poolId}:`,
          ),
        )) ||
      (stage === "human_review" &&
        blocker.startsWith(
          "isolated_worker_pool_capacity_mismatch:" +
            "governed_review:",
        )),
  );
  return [...new Set(blockers)];
}

function contractForStage(contract, stage) {
  return (
    contract.stages?.[stage] ||
    (stage === "human_review"
      ? {
          handlers: [
            REVIEW_HANDLER_BY_LANE[contract.lane_id],
            "admit_governed_publication",
          ],
          schedules: [],
          pools: {
            [REVIEW_HANDLER_BY_LANE[contract.lane_id]]:
              "governed_review",
            admit_governed_publication: "critical_publication",
          },
        }
      : {
          handlers: ["dispatch_governed_publication"],
          schedules: [],
          pools: {
            dispatch_governed_publication: "critical_publication",
          },
        })
  );
}

function inspectStageWiring({
  contract,
  stage,
  handlers,
  schedules,
  workerDefinitions,
}) {
  const stageContract = contractForStage(contract, stage);
  const handlerChecks = (stageContract.handlers || []).map((kind) => ({
    kind,
    registered: hasHandler(handlers, kind),
  }));
  const scheduleChecks = (stageContract.schedules || []).map(
    (requirement) => {
      const actual = findSchedule(schedules, requirement);
      const actualCron =
        typeof actual?.cron_expr === "string"
          ? actual.cron_expr.trim()
          : null;
      const expectedCron = String(
        requirement.cron_expr || "",
      ).trim();
      return {
        name: requirement.name || null,
        kind: requirement.kind || null,
        expected_cron: expectedCron || null,
        actual_cron: actualCron,
        registered: Boolean(actual),
        matched:
          Boolean(actual) &&
          Boolean(actualCron) &&
          (!expectedCron || actualCron === expectedCron),
      };
    },
  );
  const workerPoolChecks = Object.entries(
    stageContract.pools || {},
  ).map(([kind, expectedPool]) => {
    const actualPool = poolForKind(workerDefinitions, kind);
    return {
      kind,
      expected_pool: expectedPool,
      actual_pool: actualPool || null,
      matched: actualPool === expectedPool,
    };
  });
  return {
    handlers: handlerChecks,
    schedules: scheduleChecks,
    worker_pools: workerPoolChecks,
  };
}

function wiringBlockers(wiring) {
  const blockers = [];
  for (const check of wiring.handlers) {
    if (!check.registered) {
      blockers.push(`handler_not_registered:${check.kind}`);
    }
  }
  for (const check of wiring.schedules) {
    if (!check.registered) {
      blockers.push(
        `schedule_not_registered:${check.name || check.kind}`,
      );
    } else if (!check.matched) {
      blockers.push(
        `schedule_cron_mismatch:${check.name || check.kind}:` +
          `${check.expected_cron || "nonempty"}:` +
          `${check.actual_cron || "missing"}`,
      );
    }
  }
  for (const check of wiring.worker_pools) {
    if (!check.matched) {
      blockers.push(
        `worker_pool_mismatch:${check.kind}:${check.expected_pool}:` +
          (check.actual_pool || "unassigned"),
      );
    }
  }
  return blockers;
}

function normaliseStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function inspectWeeklyLongformRuntimeCapabilities(stageEvidence) {
  const supplied = stageEvidence?.runtime_capabilities;
  const blockers = [];
  if (
    !supplied ||
    typeof supplied !== "object" ||
    Array.isArray(supplied)
  ) {
    blockers.push("weekly_longform_runtime_capabilities_required");
  } else {
    if (
      supplied.schema_version !==
      WEEKLY_LONGFORM_RUNTIME_CAPABILITIES_SCHEMA
    ) {
      blockers.push(
        "weekly_longform_runtime_capabilities_schema_invalid",
      );
    }
    if (supplied.ready !== true) {
      blockers.push("weekly_longform_runtime_not_ready");
    }
    if (
      !Array.isArray(supplied.blockers) ||
      supplied.blockers.length > 0
    ) {
      blockers.push("weekly_longform_runtime_reports_blockers");
    }
    for (const dependency of WEEKLY_LONGFORM_RUNTIME_DEPENDENCIES) {
      if (supplied.dependencies?.[dependency]?.available !== true) {
        blockers.push(
          `weekly_longform_runtime_dependency_unavailable:${dependency}`,
        );
      }
    }
    for (const flag of WEEKLY_LONGFORM_RUNTIME_SAFETY_FLAGS) {
      if (supplied.safety?.[flag] !== false) {
        blockers.push(
          `weekly_longform_runtime_safety_flag_invalid:${flag}`,
        );
      }
    }
  }
  return {
    schema_version:
      typeof supplied?.schema_version === "string"
        ? supplied.schema_version
        : null,
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    dependencies: Object.fromEntries(
      WEEKLY_LONGFORM_RUNTIME_DEPENDENCIES.map((dependency) => [
        dependency,
        {
          available:
            supplied?.dependencies?.[dependency]?.available === true,
        },
      ]),
    ),
    safety: Object.fromEntries(
      WEEKLY_LONGFORM_RUNTIME_SAFETY_FLAGS.map((flag) => [
        flag,
        supplied?.safety?.[flag] === false ? false : null,
      ]),
    ),
  };
}

function inspectStageCapabilities(contract, stage, stageEvidence) {
  const editorialPipeline =
    stage === "production" &&
    ["evergreen_short", "weekly_longform"].includes(
      contract.lane_id,
    )
      ? {
          editorial_enrichment_proven:
            stageEvidence?.editorial_enrichment_proven === true,
          production_runner_proven:
            stageEvidence?.production_runner_proven === true,
        }
      : null;
  if (
    contract.lane_id === "weekly_longform" &&
    stage === "production"
  ) {
    return {
      editorial_pipeline: editorialPipeline,
      weekly_longform_runtime:
        inspectWeeklyLongformRuntimeCapabilities(stageEvidence),
    };
  }
  return editorialPipeline
    ? { editorial_pipeline: editorialPipeline }
    : {};
}

function evidenceBlockers(
  contract,
  stage,
  stageEvidence,
  { nowMs, maxEvidenceAgeHours },
) {
  if (
    !stageEvidence ||
    typeof stageEvidence !== "object" ||
    Array.isArray(stageEvidence)
  ) {
    return [`${stage}_evidence_required`];
  }
  const blockers = [];
  const status = normaliseStatus(stageEvidence.status);
  if (!status) blockers.push(`${stage}_evidence_status_required`);
  const observedAtMs = Date.parse(stageEvidence.observed_at || "");
  if (!Number.isFinite(observedAtMs)) {
    blockers.push(`${stage}_evidence_observed_at_required`);
  } else {
    const ageHours = (nowMs - observedAtMs) / (60 * 60 * 1000);
    if (ageHours < -(5 / 60)) {
      blockers.push(`${stage}_evidence_from_future`);
    }
    if (ageHours > maxEvidenceAgeHours) {
      blockers.push(`${stage}_evidence_stale`);
    }
  }
  if (
    !Array.isArray(stageEvidence.proof_refs) ||
    stageEvidence.proof_refs.length === 0 ||
    stageEvidence.proof_refs.some(
      (reference) =>
        typeof reference !== "string" || reference.trim().length === 0,
    )
  ) {
    blockers.push(`${stage}_proof_refs_required`);
  }
  if (["FAILED", "FAIL", "BLOCKED", "RED"].includes(status)) {
    blockers.push(`${stage}_evidence_reports_failure`);
  } else if (
    status &&
    ![
      "PROVEN",
      "PASS",
      "GREEN",
      "IN_PROGRESS",
      "PENDING",
      "HOLD",
      "AMBER",
    ].includes(status)
  ) {
    blockers.push(`${stage}_evidence_status_invalid:${status}`);
  }
  if (
    stage === "human_review" &&
    stageEvidence.gate_enforced !== true
  ) {
    blockers.push("human_review_gate_not_proven");
  }
  if (stage === "live_dispatch") {
    if (stageEvidence.exact_binding_enforced !== true) {
      blockers.push("exact_dispatch_binding_not_proven");
    }
    if (stageEvidence.kill_switch_enforced !== true) {
      blockers.push("dispatch_kill_switch_not_proven");
    }
    if (stageEvidence.control_tower_gate_enforced !== true) {
      blockers.push("dispatch_control_tower_gate_not_proven");
    }
  }
  if (
    contract.lane_id === "weekly_longform" &&
    stage === "production"
  ) {
    blockers.push(
      ...inspectWeeklyLongformRuntimeCapabilities(stageEvidence)
        .blockers,
    );
  }
  if (
    stage === "production" &&
    contract.lane_id === "evergreen_short"
  ) {
    if (stageEvidence?.editorial_enrichment_proven !== true) {
      blockers.push("evergreen_editorial_enrichment_not_proven");
    }
    if (stageEvidence?.production_runner_proven !== true) {
      blockers.push("evergreen_production_runner_not_proven");
    }
  }
  if (
    stage === "production" &&
    contract.lane_id === "weekly_longform"
  ) {
    if (stageEvidence?.editorial_enrichment_proven !== true) {
      blockers.push(
        "weekly_longform_editorial_enrichment_not_proven",
      );
    }
    if (stageEvidence?.production_runner_proven !== true) {
      blockers.push(
        "weekly_longform_production_runner_not_proven",
      );
    }
  }
  return blockers;
}

function evaluateStage({
  contract,
  stage,
  stageEvidence,
  handlers,
  schedules,
  workerDefinitions,
  runtimeBlockers = [],
  nowMs,
  maxEvidenceAgeHours,
}) {
  const wiring = inspectStageWiring({
    contract,
    stage,
    handlers,
    schedules,
    workerDefinitions,
  });
  const capabilities = inspectStageCapabilities(
    contract,
    stage,
    stageEvidence,
  );
  const blockers = [
    ...wiringBlockers(wiring),
    ...runtimeBlockers,
    ...evidenceBlockers(contract, stage, stageEvidence, {
      nowMs,
      maxEvidenceAgeHours,
    }),
  ];
  const advisories = [];
  const status = normaliseStatus(stageEvidence?.status) || "MISSING";
  if (
    blockers.length === 0 &&
    ["IN_PROGRESS", "PENDING", "HOLD", "AMBER"].includes(status)
  ) {
    advisories.push(`${stage}_not_yet_proven`);
  }
  if (
    stage === "live_dispatch" &&
    blockers.length === 0 &&
    stageEvidence.runtime_armed !== true
  ) {
    advisories.push("live_dispatch_runtime_not_armed");
  }
  return {
    verdict:
      blockers.length > 0
        ? "BLOCKED"
        : advisories.length > 0
          ? "AMBER"
          : "GREEN",
    evidence_status: status,
    evidence_observed_at:
      typeof stageEvidence?.observed_at === "string"
        ? stageEvidence.observed_at
        : null,
    blockers: [...new Set(blockers)],
    advisories: [...new Set(advisories)],
    wiring,
    capabilities,
    ...(stage === "live_dispatch"
      ? {
          runtime_armed: stageEvidence?.runtime_armed === true,
          external_publication_verified: false,
        }
      : {}),
  };
}

function dominantVerdict(verdicts) {
  if (verdicts.includes("BLOCKED")) return "BLOCKED";
  if (verdicts.includes("AMBER")) return "AMBER";
  return verdicts.length > 0 ? "GREEN" : "BLOCKED";
}

function evidenceDocumentBlockers(evidence) {
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    Object.keys(evidence).length === 0
  ) {
    return ["activation_evidence_required"];
  }
  if (
    evidence.schema_version !==
    MULTI_LANE_ACTIVATION_EVIDENCE_SCHEMA
  ) {
    return ["activation_evidence_schema_invalid"];
  }
  return [];
}

function buildMultiLaneActivationProof({
  now = new Date().toISOString(),
  handlers = {},
  schedules = [],
  workerDefinitions = [],
  runtimeWiring = null,
  evidence = {},
  evidenceSource = null,
  maxEvidenceAgeHours = 7 * 24,
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("multi_lane_activation_proof_time_invalid");
  }
  if (
    !Number.isFinite(Number(maxEvidenceAgeHours)) ||
    Number(maxEvidenceAgeHours) <= 0
  ) {
    throw new Error("multi_lane_activation_evidence_max_age_invalid");
  }
  const globalBlockers = evidenceDocumentBlockers(evidence);
  const runtimeActivation = inspectRuntimeActivation(
    runtimeWiring,
    workerDefinitions,
  );
  const lanes = LANE_CONTRACTS.map((contract) => {
    const laneEvidence = evidenceForLane(evidence, contract.lane_id);
    const stages = Object.fromEntries(
      STAGES.map((stage) => [
        stage,
        evaluateStage({
          contract,
          stage,
          stageEvidence: laneEvidence[stage],
          handlers,
          schedules,
          workerDefinitions,
          runtimeBlockers: runtimeBlockersForStage(
            runtimeActivation,
            contract,
            stage,
          ),
          nowMs: generatedAt.getTime(),
          maxEvidenceAgeHours: Number(maxEvidenceAgeHours),
        }),
      ]),
    );
    return {
      lane_id: contract.lane_id,
      label: contract.label,
      verdict:
        globalBlockers.length > 0
          ? "BLOCKED"
          : dominantVerdict(
              Object.values(stages).map((stage) => stage.verdict),
            ),
      blockers: [...globalBlockers],
      stages,
    };
  });

  return {
    schema_version: MULTI_LANE_ACTIVATION_PROOF_SCHEMA,
    generated_at: generatedAt.toISOString(),
    mode: "READ_ONLY_ACTIVATION_PROOF",
    aggregate_verdict:
      globalBlockers.length > 0
        ? "BLOCKED"
        : dominantVerdict(lanes.map((lane) => lane.verdict)),
    global_blockers: globalBlockers,
    evidence_source: evidenceSource
      ? {
          kind: "local_json_file",
          path: String(evidenceSource.path || ""),
          sha256: String(evidenceSource.sha256 || ""),
          bytes: Number(evidenceSource.bytes || 0),
          read_only: evidenceSource.read_only === true,
        }
      : {
          kind: "injected",
          path: null,
          sha256: null,
          bytes: null,
          read_only: true,
        },
    runtime_activation: runtimeActivation,
    lanes,
    external_publication: {
      in_scope: false,
      verified: false,
      statement:
        "This report proves activation readiness only; it does not prove that any external post was published.",
    },
  };
}

function renderMultiLaneActivationProofJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function stageLabel(stage) {
  return stage
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderMultiLaneActivationProofMarkdown(report = {}) {
  const lanes = Array.isArray(report.lanes) ? report.lanes : [];
  const lines = [
    "# Pulse Gaming Multi-lane Activation Proof",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    "",
    `Aggregate verdict: **${report.aggregate_verdict || "BLOCKED"}**`,
    "",
    report.external_publication?.statement ||
      "This report proves activation readiness only; it does not prove that any external post was published.",
    "",
    "| Lane | Planning | Production | Human review | Live dispatch | Overall |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const lane of lanes) {
    lines.push(
      `| ${lane.label || lane.lane_id} | ` +
        `${lane.stages?.planning?.verdict || "BLOCKED"} | ` +
        `${lane.stages?.production?.verdict || "BLOCKED"} | ` +
        `${lane.stages?.human_review?.verdict || "BLOCKED"} | ` +
        `${lane.stages?.live_dispatch?.verdict || "BLOCKED"} | ` +
        `${lane.verdict || "BLOCKED"} |`,
    );
  }
  const runtime = report.runtime_activation || {};
  lines.push(
    "",
    "## Runtime activation",
    "",
    `- Verdict: **${runtime.verdict || "BLOCKED"}**`,
    `- Isolated worker pools default: **${
      runtime.isolated_worker_pools?.default_enabled
        ? "ENABLED"
        : "NOT PROVEN"
    }**`,
    `- Breaking watcher default via server: **${
      runtime.breaking_watcher?.server_default_enabled
        ? "ENABLED"
        : "NOT PROVEN"
    }**`,
    `- Breaking watcher default via run: **${
      runtime.breaking_watcher?.run_default_enabled
        ? "ENABLED"
        : "NOT PROVEN"
    }**`,
    "",
    "| Isolated pool | Expected instances | Actual instances | Match |",
    "| --- | ---: | ---: | --- |",
  );
  for (const pool of runtime.isolated_worker_pools?.pools || []) {
    lines.push(
      `| ${pool.pool_id} | ${pool.expected_instances} | ` +
        `${pool.actual_instances ?? "unassigned"} | ` +
        `${pool.matched ? "YES" : "NO"} |`,
    );
  }
  if (runtime.blockers?.length) {
    lines.push("", `Runtime blockers: ${runtime.blockers.join(", ")}`);
  }
  lines.push("", "## Stage evidence", "");
  for (const lane of lanes) {
    lines.push(`### ${lane.label || lane.lane_id}`, "");
    for (const stage of STAGES) {
      const result = lane.stages?.[stage] || missingStage(stage);
      lines.push(
        `- ${stageLabel(stage)}: **${result.verdict}** ` +
          `(evidence: ${result.evidence_status || "MISSING"})`,
      );
      if (result.blockers?.length) {
        lines.push(`  - Blockers: ${result.blockers.join(", ")}`);
      }
      if (result.advisories?.length) {
        lines.push(
          `  - Advisories: ${result.advisories.join(", ")}`,
        );
      }
      const editorial =
        result.capabilities?.editorial_pipeline;
      if (editorial) {
        lines.push(
          `  - Editorial enrichment evidenced: **${
            editorial.editorial_enrichment_proven ? "YES" : "NO"
          }**`,
          `  - Production runner evidenced: **${
            editorial.production_runner_proven ? "YES" : "NO"
          }**`,
        );
      }
      const weeklyRuntime =
        result.capabilities?.weekly_longform_runtime;
      if (weeklyRuntime) {
        lines.push(
          `  - Weekly longform runtime: **${
            weeklyRuntime.ready ? "READY" : "BLOCKED"
          }**`,
        );
        for (const [dependency, capability] of Object.entries(
          weeklyRuntime.dependencies || {},
        )) {
          lines.push(
            `    - ${dependency}: ${
              capability.available ? "available" : "unavailable"
            }`,
          );
        }
      }
    }
    lines.push("");
  }
  if (report.global_blockers?.length) {
    lines.push(
      "## Global blockers",
      "",
      ...report.global_blockers.map((blocker) => `- ${blocker}`),
      "",
    );
  }
  lines.push(
    "## Scope boundary",
    "",
    "- No token, OAuth, database, scheduler or platform mutation is performed.",
    "- A GREEN live-dispatch stage means guarded dispatch readiness was evidenced. It is not evidence of an external upload.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  LANE_CONTRACTS,
  MULTI_LANE_ACTIVATION_EVIDENCE_SCHEMA,
  MULTI_LANE_ACTIVATION_PROOF_SCHEMA,
  MULTI_LANE_RUNTIME_WIRING_SCHEMA,
  STAGES,
  buildMultiLaneActivationProof,
  dominantVerdict,
  readMultiLaneActivationEvidenceFile,
  renderMultiLaneActivationProofJson,
  renderMultiLaneActivationProofMarkdown,
};
