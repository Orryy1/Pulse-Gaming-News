"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  MULTI_LANE_ACTIVATION_EVIDENCE_SCHEMA,
  STAGES,
} = require("./multi-lane-activation-proof");

const COLLECTION_SCHEMA =
  "pulse-multi-lane-activation-evidence-collection-v1";
const INDEX_SCHEMA =
  "pulse-multi-lane-activation-artifact-index-v1";
const STAGE_PROOF_SCHEMA =
  "pulse-multi-lane-stage-proof-report-v1";
const RUNTIME_CAPABILITIES_SCHEMA =
  "pulse-weekly-longform-runtime-capabilities-v1";
const DEFAULT_MAX_ARTEFACT_AGE_HOURS = 7 * 24;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const LANE_IDS = Object.freeze([
  "breaking_short",
  "evergreen_short",
  "weekly_longform",
]);
const COMMON_REVIEW_REQUIREMENTS = Object.freeze([
  "human_review_gate_enforced",
  "governed_lane_review_packet_bound",
]);
const COMMON_DISPATCH_REQUIREMENTS = Object.freeze([
  "exact_dispatch_binding_enforced",
  "kill_switch_enforced",
  "control_tower_gate_enforced",
]);
const STAGE_REQUIREMENTS = Object.freeze({
  breaking_short: Object.freeze({
    planning: Object.freeze([
      "breaking_source_evidence_bound",
      "exact_short_planning_bound",
    ]),
    production: Object.freeze([
      "exact_short_production_scope_bound",
      "human_review_handoff_bound",
    ]),
    human_review: COMMON_REVIEW_REQUIREMENTS,
    live_dispatch: COMMON_DISPATCH_REQUIREMENTS,
  }),
  evergreen_short: Object.freeze({
    planning: Object.freeze([
      "governed_editorial_inventory_bound",
      "evergreen_autonomous_discovery_bound",
      "evergreen_candidate_rotation_bound",
    ]),
    production: Object.freeze([
      "evergreen_editorial_enrichment_bound",
      "evergreen_production_runner_bound",
    ]),
    human_review: COMMON_REVIEW_REQUIREMENTS,
    live_dispatch: COMMON_DISPATCH_REQUIREMENTS,
  }),
  weekly_longform: Object.freeze({
    planning: Object.freeze([
      "governed_editorial_inventory_bound",
      "weekly_longform_work_order_bound",
      "weekly_longform_schedule_bound",
    ]),
    production: Object.freeze([
      "weekly_longform_editorial_enrichment_bound",
      "weekly_longform_production_runner_bound",
      "weekly_longform_same_run_evidence_bound",
      "weekly_longform_derivatives_bound",
    ]),
    human_review: COMMON_REVIEW_REQUIREMENTS,
    live_dispatch: COMMON_DISPATCH_REQUIREMENTS,
  }),
});
const WEEKLY_RUNTIME_DEPENDENCIES = Object.freeze([
  "produceNarration",
  "materializeAlignment",
  "renderLongform",
  "materializeVariants",
  "runDecodedQa",
  "materializeDerivatives",
]);
const WEEKLY_RUNTIME_SAFETY_FLAGS = Object.freeze([
  "implicit_network_enabled",
  "implicit_process_spawn_enabled",
  "upload_authority",
  "oauth_mutation_authority",
  "database_mutation_authority",
]);
const WEEKLY_RUNTIME_DOCUMENT_KEYS = Object.freeze([
  "schema_version",
  "generated_at",
  "ready",
  "blockers",
  "dependencies",
  "safety",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function text(value) {
  return String(value || "").trim();
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/.test(text(value).toLowerCase());
}

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expectedKeys].sort())
  );
}

function projectRuntimeCapabilitiesDocument(value) {
  const blockers = [];
  if (!isPlainObject(value)) {
    return {
      capabilities: null,
      blockers: [
        "weekly_longform_runtime_capabilities_document_invalid",
      ],
    };
  }
  if (!hasExactKeys(value, WEEKLY_RUNTIME_DOCUMENT_KEYS)) {
    blockers.push(
      "weekly_longform_runtime_capabilities_document_keys_invalid",
    );
  }

  const generatedDate = new Date(value.generated_at);
  const generatedAtValid =
    typeof value.generated_at === "string" &&
    !Number.isNaN(generatedDate.getTime()) &&
    generatedDate.toISOString() === value.generated_at;
  if (!generatedAtValid) {
    blockers.push(
      "weekly_longform_runtime_capabilities_generated_at_invalid",
    );
  }
  if (typeof value.ready !== "boolean") {
    blockers.push(
      "weekly_longform_runtime_capabilities_ready_type_invalid",
    );
  }
  const blockerListValid =
    Array.isArray(value.blockers) &&
    value.blockers.every(
      (blocker) =>
        typeof blocker === "string" &&
        /^[a-z0-9][a-z0-9_:.-]{0,255}$/i.test(blocker),
    );
  if (!blockerListValid) {
    blockers.push(
      "weekly_longform_runtime_capabilities_blockers_invalid",
    );
  }

  if (
    !hasExactKeys(value.dependencies, WEEKLY_RUNTIME_DEPENDENCIES)
  ) {
    blockers.push(
      "weekly_longform_runtime_capabilities_dependency_keys_invalid",
    );
  }
  const dependencies = {};
  let dependencyRecordInvalid = false;
  for (const dependency of WEEKLY_RUNTIME_DEPENDENCIES) {
    const record = value.dependencies?.[dependency];
    if (
      !hasExactKeys(record, ["available"]) ||
      typeof record?.available !== "boolean"
    ) {
      dependencyRecordInvalid = true;
    }
    dependencies[dependency] = {
      available: record?.available === true,
    };
  }
  if (dependencyRecordInvalid) {
    blockers.push(
      "weekly_longform_runtime_capabilities_dependency_keys_invalid",
    );
  }

  if (!hasExactKeys(value.safety, WEEKLY_RUNTIME_SAFETY_FLAGS)) {
    blockers.push(
      "weekly_longform_runtime_capabilities_safety_keys_invalid",
    );
  }
  const safety = {};
  let safetyValueInvalid = false;
  for (const flag of WEEKLY_RUNTIME_SAFETY_FLAGS) {
    if (typeof value.safety?.[flag] !== "boolean") {
      safetyValueInvalid = true;
    }
    safety[flag] = value.safety?.[flag] === true;
  }
  if (safetyValueInvalid) {
    blockers.push(
      "weekly_longform_runtime_capabilities_safety_values_invalid",
    );
  }

  return {
    capabilities: {
      schema_version:
        value.schema_version === RUNTIME_CAPABILITIES_SCHEMA
          ? RUNTIME_CAPABILITIES_SCHEMA
          : null,
      generated_at: generatedAtValid
        ? generatedDate.toISOString()
        : null,
      ready: value.ready === true,
      blockers:
        blockerListValid && value.blockers.length === 0
          ? []
          : ["runtime_capability_probe_reports_blockers"],
      dependencies,
      safety,
    },
    blockers: unique(blockers),
  };
}

function isSecretPath(filePath) {
  const resolved = path.resolve(filePath);
  const parts = resolved
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
  const basename = path.basename(resolved).toLowerCase();
  return (
    parts.includes("tokens") ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    /(?:credential|oauth|access[_-]?token|client[_-]?secret)/i.test(
      basename,
    )
  );
}

function isWithin(candidatePath, rootPath) {
  const relative = path.relative(
    path.resolve(rootPath),
    path.resolve(candidatePath),
  );
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function safeResolvedPath({
  declaredPath,
  baseDirectory,
  allowedRoots,
  prefix,
} = {}) {
  const blockers = [];
  if (!text(declaredPath)) {
    return {
      path: null,
      blockers: [`${prefix}_path_required`],
    };
  }
  const resolvedPath = path.resolve(baseDirectory, declaredPath);
  if (isSecretPath(resolvedPath)) {
    blockers.push(`${prefix}_secret_path_forbidden`);
  }
  if (
    Array.isArray(allowedRoots) &&
    allowedRoots.length > 0 &&
    !allowedRoots.some((root) => isWithin(resolvedPath, root))
  ) {
    blockers.push(`${prefix}_outside_allowed_roots`);
  }
  return { path: resolvedPath, blockers };
}

function inspectFile({
  declaredPath,
  expectedSha256 = null,
  expectedBytes = null,
  baseDirectory,
  allowedRoots,
  prefix,
  json = false,
} = {}) {
  const resolved = safeResolvedPath({
    declaredPath,
    baseDirectory,
    allowedRoots,
    prefix,
  });
  const blockers = [...resolved.blockers];
  const filePath = resolved.path;
  const declaredHash = text(expectedSha256).toLowerCase();
  if (expectedSha256 !== null && !validSha256(declaredHash)) {
    blockers.push(`${prefix}_sha256_required`);
  }
  let bytes = null;
  let stat = null;
  let observedHash = null;
  let value = null;
  if (filePath && blockers.length === 0) {
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile()) blockers.push(`${prefix}_file_required`);
    } catch (error) {
      blockers.push(`${prefix}_read_failed:${error.code || "unknown"}`);
    }
  }
  if (stat?.isFile()) {
    if (stat.size <= 0) blockers.push(`${prefix}_file_empty`);
    if (stat.size > MAX_JSON_BYTES) {
      blockers.push(`${prefix}_file_too_large`);
    }
    if (!blockers.length) {
      try {
        const realPath = fs.realpathSync(filePath);
        if (
          Array.isArray(allowedRoots) &&
          allowedRoots.length > 0 &&
          !allowedRoots.some((root) => isWithin(realPath, root))
        ) {
          blockers.push(`${prefix}_realpath_outside_allowed_roots`);
        }
        if (isSecretPath(realPath)) {
          blockers.push(`${prefix}_realpath_secret_forbidden`);
        }
      } catch (error) {
        blockers.push(
          `${prefix}_realpath_failed:${error.code || "unknown"}`,
        );
      }
    }
    if (!blockers.length) {
      try {
        bytes = fs.readFileSync(filePath);
        observedHash = sha256(bytes);
      } catch (error) {
        blockers.push(
          `${prefix}_read_failed:${error.code || "unknown"}`,
        );
      }
    }
  }
  if (
    observedHash &&
    expectedSha256 !== null &&
    declaredHash !== observedHash
  ) {
    blockers.push(`${prefix}_sha256_mismatch`);
  }
  if (
    bytes &&
    expectedBytes !== null &&
    Number(expectedBytes) !== bytes.length
  ) {
    blockers.push(`${prefix}_byte_length_mismatch`);
  }
  if (json && bytes) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        blockers.push(`${prefix}_json_object_required`);
        value = null;
      }
    } catch {
      blockers.push(`${prefix}_json_invalid`);
    }
  }
  return {
    path: filePath,
    bytes,
    sha256: observedHash,
    byte_length: bytes?.length || null,
    mtime: stat?.mtime?.toISOString?.() || null,
    value,
    blockers: unique(blockers),
  };
}

function inspectTimestamp({
  value,
  nowMs,
  maxAgeHours,
  prefix,
} = {}) {
  const parsed = Date.parse(text(value));
  const blockers = [];
  if (!Number.isFinite(parsed)) {
    blockers.push(`${prefix}_generated_at_required`);
    return { observedAt: null, blockers };
  }
  if (parsed - nowMs > FUTURE_TOLERANCE_MS) {
    blockers.push(`${prefix}_from_future`);
  }
  if ((nowMs - parsed) / (60 * 60 * 1000) > maxAgeHours) {
    blockers.push(`${prefix}_stale`);
  }
  return {
    observedAt: new Date(parsed).toISOString(),
    blockers,
  };
}

function inspectIndex({
  indexPath,
  nowMs,
  maxAgeHours,
  repositoryRoot,
  allowedRoots,
} = {}) {
  if (!text(indexPath)) {
    return {
      index: null,
      source: null,
      baseDirectory: null,
      allowedRoots: [],
      blockers: ["activation_artifact_index_required"],
    };
  }
  const resolvedIndexPath = path.resolve(indexPath);
  if (isSecretPath(resolvedIndexPath)) {
    return {
      index: null,
      source: null,
      baseDirectory: path.dirname(resolvedIndexPath),
      allowedRoots: [],
      blockers: ["activation_artifact_index_secret_path_forbidden"],
    };
  }
  const baseDirectory = path.dirname(resolvedIndexPath);
  const effectiveRoots = unique(
    [
      baseDirectory,
      repositoryRoot,
      ...(Array.isArray(allowedRoots) ? allowedRoots : []),
    ].map((root) => path.resolve(root)),
  );
  const observed = inspectFile({
    declaredPath: resolvedIndexPath,
    baseDirectory,
    allowedRoots: effectiveRoots,
    prefix: "activation_artifact_index",
    json: true,
  });
  const blockers = [...observed.blockers];
  const index = observed.value;
  if (index?.schema_version !== INDEX_SCHEMA) {
    blockers.push("activation_artifact_index_schema_invalid");
  }
  const timestamp = inspectTimestamp({
    value: index?.generated_at,
    nowMs,
    maxAgeHours,
    prefix: "activation_artifact_index",
  });
  blockers.push(...timestamp.blockers);
  if (!Array.isArray(index?.artifacts)) {
    blockers.push("activation_artifact_index_artifacts_required");
  }
  const seenIds = new Set();
  const seenRoles = new Set();
  for (const artifact of Array.isArray(index?.artifacts)
    ? index.artifacts
    : []) {
    const id = text(artifact?.id);
    const laneId = text(artifact?.lane_id);
    const stage = text(artifact?.stage);
    const role = text(artifact?.role);
    const roleKey = [
      laneId,
      stage,
      role,
    ].join(":");
    if (!id) {
      blockers.push("activation_artifact_id_required");
    } else if (seenIds.has(id)) {
      blockers.push(`activation_artifact_id_duplicate:${id}`);
    }
    if (!LANE_IDS.includes(laneId)) {
      blockers.push(`activation_artifact_lane_invalid:${laneId || "missing"}`);
    }
    if (!STAGES.includes(stage)) {
      blockers.push(
        `activation_artifact_stage_invalid:${stage || "missing"}`,
      );
    }
    if (!["stage_proof", "runtime_capabilities"].includes(role)) {
      blockers.push(
        `activation_artifact_role_invalid:${role || "missing"}`,
      );
    }
    if (
      role === "runtime_capabilities" &&
      (laneId !== "weekly_longform" || stage !== "production")
    ) {
      blockers.push(
        "activation_runtime_capabilities_scope_invalid:" +
          `${laneId || "missing"}:${stage || "missing"}`,
      );
    }
    if (!text(artifact?.path)) {
      blockers.push(`activation_artifact_path_required:${id || "missing"}`);
    }
    if (!validSha256(artifact?.sha256)) {
      blockers.push(
        `activation_artifact_sha256_required:${id || "missing"}`,
      );
    }
    if (seenRoles.has(roleKey)) {
      blockers.push(`activation_artifact_role_duplicate:${roleKey}`);
    }
    seenIds.add(id);
    seenRoles.add(roleKey);
  }
  return {
    index,
    source: observed.sha256
      ? {
          path: observed.path,
          sha256: observed.sha256,
          bytes: observed.byte_length,
          read_only: true,
        }
      : null,
    baseDirectory,
    allowedRoots: effectiveRoots,
    blockers: unique(blockers),
  };
}

function bindingRecord({
  id,
  role,
  observed,
  declaredSha256,
} = {}) {
  return {
    id,
    role,
    path: observed.path,
    declared_sha256: text(declaredSha256).toLowerCase() || null,
    observed_sha256: observed.sha256,
    sha256_matches:
      Boolean(observed.sha256) &&
      text(declaredSha256).toLowerCase() === observed.sha256,
    bytes: observed.byte_length,
    read_only: true,
  };
}

function findArtifact(index, laneId, stage, role) {
  return (Array.isArray(index?.artifacts) ? index.artifacts : []).filter(
    (artifact) =>
      artifact?.lane_id === laneId &&
      artifact?.stage === stage &&
      artifact?.role === role,
  );
}

function inspectStageProof({
  reference,
  laneId,
  stage,
  requiredChecks,
  indexDirectory,
  allowedRoots,
  nowMs,
  maxAgeHours,
} = {}) {
  const blockers = [];
  if (!reference) {
    return {
      observedAt: null,
      blockers: ["stage_proof_required"],
      proofRefs: [],
      bindings: [],
      derivedChecks: [],
    };
  }
  const prefix = `stage_proof:${laneId}:${stage}`;
  const observed = inspectFile({
    declaredPath: reference.path,
    expectedSha256: reference.sha256,
    baseDirectory: indexDirectory,
    allowedRoots,
    prefix,
    json: true,
  });
  blockers.push(...observed.blockers);
  const binding = bindingRecord({
    id: text(reference.id),
    role: "stage_proof",
    observed,
    declaredSha256: reference.sha256,
  });
  const proof = observed.value;
  if (proof?.schema_version !== STAGE_PROOF_SCHEMA) {
    blockers.push(`${prefix}_schema_invalid`);
  }
  if (proof?.mode !== "LOCAL_PROOF") {
    blockers.push(`${prefix}_local_proof_mode_required`);
  }
  if (proof?.lane_id !== laneId) {
    blockers.push(`${prefix}_lane_mismatch`);
  }
  if (proof?.stage !== stage) {
    blockers.push(`${prefix}_stage_mismatch`);
  }
  const timestamp = inspectTimestamp({
    value: proof?.generated_at,
    nowMs,
    maxAgeHours,
    prefix,
  });
  blockers.push(...timestamp.blockers);

  const testRun = proof?.test_run;
  if (
    !testRun ||
    typeof testRun !== "object" ||
    Array.isArray(testRun)
  ) {
    blockers.push(`${prefix}_test_run_required`);
  } else {
    if (testRun.runner !== "node:test") {
      blockers.push(`${prefix}_node_test_runner_required`);
    }
    if (!/^node(?:\.exe)?\s+--test(?:\s|$)/i.test(text(testRun.command))) {
      blockers.push(`${prefix}_focused_test_command_required`);
    }
    if (Number(testRun.exit_code) !== 0) {
      blockers.push(`${prefix}_test_exit_code_not_zero`);
    }
    if (Number(testRun.failed) !== 0) {
      blockers.push(`${prefix}_test_failures_reported`);
    }
    if (
      !Number.isInteger(Number(testRun.passed)) ||
      Number(testRun.passed) < requiredChecks.length
    ) {
      blockers.push(`${prefix}_passing_test_count_insufficient`);
    }
  }

  const checks = Array.isArray(proof?.checks) ? proof.checks : [];
  if (!Array.isArray(proof?.checks)) {
    blockers.push(`${prefix}_checks_required`);
  }
  const derivedChecks = [];
  for (const requiredId of requiredChecks) {
    const matching = checks.filter((check) => check?.id === requiredId);
    if (matching.length !== 1) {
      blockers.push(
        matching.length === 0
          ? `${prefix}_required_check_missing:${requiredId}`
          : `${prefix}_required_check_duplicate:${requiredId}`,
      );
    } else if (text(matching[0].result).toUpperCase() !== "PASS") {
      blockers.push(`${prefix}_required_check_not_passed:${requiredId}`);
    } else {
      derivedChecks.push(requiredId);
    }
  }

  const sourceBindings = Array.isArray(proof?.source_bindings)
    ? proof.source_bindings
    : [];
  if (sourceBindings.length === 0) {
    blockers.push(`${prefix}_source_bindings_required`);
  }
  const bindings = [binding];
  const proofRefs = observed.sha256
    ? [
        `local-json:${text(reference.id)}:sha256:${observed.sha256}`,
      ]
    : [];
  const proofDirectory = observed.path
    ? path.dirname(observed.path)
    : indexDirectory;
  const seenComponents = new Set();
  for (let index = 0; index < sourceBindings.length; index += 1) {
    const source = sourceBindings[index] || {};
    const component = text(source.component);
    const sourcePrefix = `${prefix}_source_binding:${component || index}`;
    if (!component) {
      blockers.push(`${sourcePrefix}_component_required`);
    } else if (seenComponents.has(component)) {
      blockers.push(`${sourcePrefix}_component_duplicate`);
    }
    seenComponents.add(component);
    if (source.read_only !== true) {
      blockers.push(`${sourcePrefix}_read_only_required`);
    }
    const sourceObserved = inspectFile({
      declaredPath: source.path,
      expectedSha256: source.sha256,
      expectedBytes: source.bytes,
      baseDirectory: proofDirectory,
      allowedRoots,
      prefix: sourcePrefix,
      json: false,
    });
    blockers.push(...sourceObserved.blockers);
    bindings.push(
      bindingRecord({
        id: component || `source-${index}`,
        role: "source_binding",
        observed: sourceObserved,
        declaredSha256: source.sha256,
      }),
    );
    if (sourceObserved.sha256) {
      proofRefs.push(
        `local-source:${component || index}:sha256:${sourceObserved.sha256}`,
      );
    }
  }
  return {
    observedAt: timestamp.observedAt,
    blockers: unique(blockers),
    proofRefs: unique(proofRefs),
    bindings,
    derivedChecks,
  };
}

function inspectRuntimeCapabilities({
  reference,
  indexDirectory,
  allowedRoots,
} = {}) {
  const blockers = [];
  if (!reference) {
    return {
      capabilities: null,
      blockers: ["weekly_longform_runtime_capabilities_required"],
      proofRefs: [],
      bindings: [],
    };
  }
  const observed = inspectFile({
    declaredPath: reference.path,
    expectedSha256: reference.sha256,
    baseDirectory: indexDirectory,
    allowedRoots,
    prefix: "weekly_longform_runtime_capabilities",
    json: true,
  });
  blockers.push(...observed.blockers);
  const projected = projectRuntimeCapabilitiesDocument(observed.value);
  blockers.push(...projected.blockers);
  const capabilities = projected.capabilities;
  if (capabilities?.schema_version !== RUNTIME_CAPABILITIES_SCHEMA) {
    blockers.push("weekly_longform_runtime_capabilities_schema_invalid");
  }
  if (capabilities?.ready !== true) {
    blockers.push("weekly_longform_runtime_declared_ready_invalid");
  }
  if (
    !Array.isArray(capabilities?.blockers) ||
    capabilities.blockers.length > 0
  ) {
    blockers.push("weekly_longform_runtime_reports_blockers");
  }
  for (const dependency of WEEKLY_RUNTIME_DEPENDENCIES) {
    if (capabilities?.dependencies?.[dependency]?.available !== true) {
      blockers.push(
        `weekly_longform_runtime_dependency_unavailable:${dependency}`,
      );
    }
  }
  for (const flag of WEEKLY_RUNTIME_SAFETY_FLAGS) {
    if (capabilities?.safety?.[flag] !== false) {
      blockers.push(
        `weekly_longform_runtime_safety_flag_invalid:${flag}`,
      );
    }
  }
  return {
    capabilities,
    blockers: unique(blockers),
    proofRefs: observed.sha256
      ? [
          `local-json:${text(reference.id)}:sha256:${observed.sha256}`,
        ]
      : [],
    bindings: [
      bindingRecord({
        id: text(reference.id),
        role: "runtime_capabilities",
        observed,
        declaredSha256: reference.sha256,
      }),
    ],
  };
}

function collectStage({
  laneId,
  stage,
  indexInspection,
  globalBlockers,
  nowMs,
  maxAgeHours,
} = {}) {
  const requiredChecks = STAGE_REQUIREMENTS[laneId][stage];
  const proofReferences = findArtifact(
    indexInspection.index,
    laneId,
    stage,
    "stage_proof",
  );
  const blockers = [...globalBlockers];
  if (proofReferences.length > 1) {
    blockers.push("stage_proof_reference_ambiguous");
  }
  const proof = inspectStageProof({
    reference: proofReferences.length === 1 ? proofReferences[0] : null,
    laneId,
    stage,
    requiredChecks,
    indexDirectory: indexInspection.baseDirectory,
    allowedRoots: indexInspection.allowedRoots,
    nowMs,
    maxAgeHours,
  });
  blockers.push(...proof.blockers);
  const proofRefs = [...proof.proofRefs];
  const bindings = [...proof.bindings];
  let runtimeCapabilities;
  if (laneId === "weekly_longform" && stage === "production") {
    const runtimeReferences = findArtifact(
      indexInspection.index,
      laneId,
      stage,
      "runtime_capabilities",
    );
    if (runtimeReferences.length > 1) {
      blockers.push(
        "weekly_longform_runtime_capabilities_reference_ambiguous",
      );
    }
    const runtime = inspectRuntimeCapabilities({
      reference:
        runtimeReferences.length === 1 ? runtimeReferences[0] : null,
      indexDirectory: indexInspection.baseDirectory,
      allowedRoots: indexInspection.allowedRoots,
    });
    blockers.push(...runtime.blockers);
    proofRefs.push(...runtime.proofRefs);
    bindings.push(...runtime.bindings);
    runtimeCapabilities = runtime.capabilities;
  }
  const exactBlockers = unique(blockers);
  const status = exactBlockers.length === 0 ? "PROVEN" : "BLOCKED";
  const derivedChecks = proof.derivedChecks;
  return {
    status,
    observed_at:
      proof.observedAt || new Date(nowMs).toISOString(),
    proof_refs: unique(proofRefs),
    blockers: exactBlockers,
    artifact_bindings: bindings,
    derived_checks: derivedChecks,
    ...(stage === "production" &&
    ["evergreen_short", "weekly_longform"].includes(laneId)
      ? {
          editorial_enrichment_proven:
            status === "PROVEN" &&
            derivedChecks.includes(
              laneId === "evergreen_short"
                ? "evergreen_editorial_enrichment_bound"
                : "weekly_longform_editorial_enrichment_bound",
            ),
          production_runner_proven:
            status === "PROVEN" &&
            derivedChecks.includes(
              laneId === "evergreen_short"
                ? "evergreen_production_runner_bound"
                : "weekly_longform_production_runner_bound",
            ),
        }
      : {}),
    ...(laneId === "weekly_longform" && stage === "production"
      ? { runtime_capabilities: runtimeCapabilities || null }
      : {}),
    ...(stage === "human_review"
      ? {
          gate_enforced:
            status === "PROVEN" &&
            derivedChecks.includes("human_review_gate_enforced"),
        }
      : {}),
    ...(stage === "live_dispatch"
      ? {
          exact_binding_enforced:
            status === "PROVEN" &&
            derivedChecks.includes(
              "exact_dispatch_binding_enforced",
            ),
          kill_switch_enforced:
            status === "PROVEN" &&
            derivedChecks.includes("kill_switch_enforced"),
          control_tower_gate_enforced:
            status === "PROVEN" &&
            derivedChecks.includes(
              "control_tower_gate_enforced",
            ),
          runtime_armed: false,
        }
      : {}),
  };
}

function blockedStage({
  stage,
  observedAt,
  blockers,
  proofRefs = [],
} = {}) {
  return {
    status: "BLOCKED",
    observed_at: observedAt,
    proof_refs: proofRefs,
    blockers: [...new Set(blockers || [])],
    artifact_bindings: [],
    derived_checks: [],
    ...(stage === "human_review"
      ? { gate_enforced: false }
      : {}),
    ...(stage === "live_dispatch"
      ? {
          exact_binding_enforced: false,
          kill_switch_enforced: false,
          control_tower_gate_enforced: false,
          runtime_armed: false,
        }
      : {}),
  };
}

function collectMultiLaneActivationEvidence({
  now = new Date().toISOString(),
  indexPath = null,
  maxArtifactAgeHours = DEFAULT_MAX_ARTEFACT_AGE_HOURS,
  repositoryRoot = path.resolve(__dirname, "..", ".."),
  allowedRoots = [],
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("multi_lane_activation_evidence_collection_time_invalid");
  }
  if (
    !Number.isFinite(Number(maxArtifactAgeHours)) ||
    Number(maxArtifactAgeHours) <= 0
  ) {
    throw new Error(
      "multi_lane_activation_evidence_max_artifact_age_invalid",
    );
  }
  const generatedAtIso = generatedAt.toISOString();
  const indexInspection = inspectIndex({
    indexPath,
    nowMs: generatedAt.getTime(),
    maxAgeHours: Number(maxArtifactAgeHours),
    repositoryRoot,
    allowedRoots,
  });
  const globalBlockers = indexInspection.blockers;
  const lanes = Object.fromEntries(
    LANE_IDS.map((laneId) => [
      laneId,
      Object.fromEntries(
        STAGES.map((stage) => [
          stage,
          indexInspection.index
            ? collectStage({
                laneId,
                stage,
                indexInspection,
                globalBlockers,
                nowMs: generatedAt.getTime(),
                maxAgeHours: Number(maxArtifactAgeHours),
              })
            : blockedStage({
                stage,
                observedAt: generatedAtIso,
                blockers: globalBlockers,
              }),
        ]),
      ),
    ]),
  );
  const stageBlockers = [];
  for (const [laneId, lane] of Object.entries(lanes)) {
    for (const [stage, result] of Object.entries(lane)) {
      for (const blocker of result.blockers) {
        if (!globalBlockers.includes(blocker)) {
          stageBlockers.push(`${laneId}:${stage}:${blocker}`);
        }
      }
    }
  }
  const allProven = Object.values(lanes).every((lane) =>
    Object.values(lane).every((stage) => stage.status === "PROVEN"),
  );
  return {
    schema_version: MULTI_LANE_ACTIVATION_EVIDENCE_SCHEMA,
    generated_at: generatedAtIso,
    lanes,
    collection: {
      schema_version: COLLECTION_SCHEMA,
      mode: "READ_ONLY_LOCAL_ARTEFACT_COLLECTION",
      verdict: allProven ? "PROVEN" : "BLOCKED",
      blockers: unique([...globalBlockers, ...stageBlockers]),
      index_schema: INDEX_SCHEMA,
      index_source: indexInspection.source,
      safety: {
        network_used: false,
        database_accessed: false,
        external_publish_authorised: false,
        oauth_mutation_authorised: false,
        token_material_accessed: false,
        process_spawned: false,
      },
    },
  };
}

function renderMultiLaneActivationEvidenceJson(evidence = {}) {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

function renderMultiLaneActivationEvidenceMarkdown(evidence = {}) {
  const collection = evidence.collection || {};
  const lines = [
    "# Pulse Gaming Multi-lane Activation Evidence",
    "",
    `Generated: ${text(evidence.generated_at) || "unknown"}`,
    `Verdict: ${text(collection.verdict) || "BLOCKED"}`,
    `Mode: ${text(collection.mode) || "unknown"}`,
    "",
    "## Exact source index",
    "",
    collection.index_source
      ? `- Path: \`${collection.index_source.path}\``
      : "- Path: not supplied",
    collection.index_source?.sha256
      ? `- SHA-256: \`${collection.index_source.sha256}\``
      : "- SHA-256: not available",
    "",
    "## Lane stages",
    "",
    "| Lane | Stage | Status | Proof refs | Blockers |",
    "| --- | --- | --- | ---: | ---: |",
  ];
  for (const laneId of LANE_IDS) {
    const lane = evidence.lanes?.[laneId] || {};
    for (const stage of STAGES) {
      const result = lane[stage] || {};
      lines.push(
        `| ${laneId} | ${stage} | ${text(result.status) || "BLOCKED"} | ` +
          `${Array.isArray(result.proof_refs) ? result.proof_refs.length : 0} | ` +
          `${Array.isArray(result.blockers) ? result.blockers.length : 0} |`,
      );
    }
  }
  lines.push("", "## Collection blockers", "");
  const blockers = Array.isArray(collection.blockers)
    ? collection.blockers
    : [];
  lines.push(
    ...(blockers.length
      ? blockers.map((blocker) => `- ${blocker}`)
      : ["- None"]),
    "",
    "## Scope boundary",
    "",
    "- No network, database, OAuth, token or publish action is performed.",
    "- Every PROVEN field is derived from fresh, hash-matched local proof and exact source bindings.",
    "- Live dispatch is never armed by this collector.",
    "- This activation evidence does not prove an external publication.",
    "",
  );
  return lines.join("\n");
}

module.exports = {
  COLLECTION_SCHEMA,
  DEFAULT_MAX_ARTEFACT_AGE_HOURS,
  INDEX_SCHEMA,
  LANE_IDS,
  RUNTIME_CAPABILITIES_SCHEMA,
  STAGE_PROOF_SCHEMA,
  STAGE_REQUIREMENTS,
  collectMultiLaneActivationEvidence,
  projectRuntimeCapabilitiesDocument,
  renderMultiLaneActivationEvidenceJson,
  renderMultiLaneActivationEvidenceMarkdown,
};
