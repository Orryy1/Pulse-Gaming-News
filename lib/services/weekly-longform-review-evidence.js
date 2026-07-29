"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  assessRightsLedger,
} = require("./publication-evidence-gates");
const {
  workOrderFingerprint,
} = require("./weekly-longform-work-order");

const SCHEMA_VERSION =
  "pulse-weekly-longform-review-evidence-manifest-v1";
const GENERATOR_ID =
  "pulse-weekly-longform-review-evidence-bridge-v1";
const LANE_ID = "weekly_longform";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_JSON_BYTES = 16 * 1024 * 1024;

class WeeklyLongformReviewEvidenceError extends Error {
  constructor(codes) {
    const values = unique(
      Array.isArray(codes) ? codes : [codes],
    );
    super(
      `weekly_longform_review_evidence_invalid: ${values.join(", ")}`,
    );
    this.name = "WeeklyLongformReviewEvidenceError";
    this.codes = values;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normaliseSha256(value) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_PATTERN.test(hash) ? hash : null;
}

function validateRunId(value) {
  const runId = text(value);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(runId)) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_run_id_invalid",
    );
  }
  return runId;
}

function validateGeneratedAt(value) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_generated_at_invalid",
    );
  }
  return new Date(parsed).toISOString();
}

function contained(root, candidate) {
  const relative = path.relative(
    path.resolve(root),
    path.resolve(candidate),
  );
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
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

function observeFile(
  ref,
  prefix,
  { json = false, allowedRoot = null } = {},
) {
  const blockers = [];
  const filePath = text(ref?.path);
  const expectedSha256 = normaliseSha256(
    ref?.sha256 || ref?.file_sha256,
  );
  if (!filePath) blockers.push(`${prefix}_path_required`);
  if (!expectedSha256) blockers.push(`${prefix}_sha256_required`);
  const resolvedPath = filePath ? path.resolve(filePath) : null;
  if (
    resolvedPath &&
    allowedRoot &&
    !contained(allowedRoot, resolvedPath)
  ) {
    blockers.push(`${prefix}_outside_run_root`);
  }
  if (resolvedPath && isSecretPath(resolvedPath)) {
    blockers.push(`${prefix}_secret_path_forbidden`);
  }
  let bytes = null;
  let value = null;
  if (resolvedPath && blockers.length === 0) {
    try {
      const stat = fs.lstatSync(resolvedPath);
      if (stat.isSymbolicLink()) {
        blockers.push(`${prefix}_symlink_forbidden`);
      } else if (!stat.isFile()) {
        blockers.push(`${prefix}_regular_file_required`);
      } else if (stat.size <= 0) {
        blockers.push(`${prefix}_file_empty`);
      } else if (json && stat.size > MAX_JSON_BYTES) {
        blockers.push(`${prefix}_file_too_large`);
      } else {
        const realPath = fs.realpathSync(resolvedPath);
        if (isSecretPath(realPath)) {
          blockers.push(`${prefix}_realpath_secret_forbidden`);
        } else {
          bytes = fs.readFileSync(resolvedPath);
        }
      }
    } catch (error) {
      blockers.push(`${prefix}_read_failed:${error.code || "unknown"}`);
    }
  }
  const observedSha256 = bytes ? sha256Bytes(bytes) : null;
  if (
    observedSha256 &&
    expectedSha256 &&
    observedSha256 !== expectedSha256
  ) {
    blockers.push(`${prefix}_sha256_mismatch`);
  }
  if (bytes && json) {
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
  if (blockers.length) {
    throw new WeeklyLongformReviewEvidenceError(blockers);
  }
  return {
    path: resolvedPath,
    sha256: observedSha256,
    byte_length: bytes.length,
    value,
  };
}

async function writeJson(outputDir, name, value) {
  const filePath = path.join(outputDir, name);
  const bytes = Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  const temporaryPath =
    `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }
  return {
    path: filePath,
    sha256: sha256Bytes(bytes),
    byte_length: bytes.length,
  };
}

function reviewRef(artifact, runId, extra = {}) {
  return {
    path: artifact.path,
    sha256: artifact.sha256,
    story_id: runId,
    lane_id: LANE_ID,
    ...extra,
  };
}

function sourceStories(workOrder) {
  const selected = Array.isArray(workOrder?.selection?.selected)
    ? workOrder.selection.selected
    : [];
  if (selected.length < 4 || selected.length > 6) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_source_story_set_invalid",
    );
  }
  const seenStoryIds = new Set();
  return selected.map((story, index) => {
    const storyId = text(story?.story_id);
    if (!storyId) {
      throw new WeeklyLongformReviewEvidenceError(
        "weekly_review_source_story_id_required",
      );
    }
    if (seenStoryIds.has(storyId)) {
      throw new WeeklyLongformReviewEvidenceError(
        "weekly_review_source_story_id_duplicate",
      );
    }
    seenStoryIds.add(storyId);
    const source = observeFile(
      story?.source_evidence,
      `weekly_review_source_evidence_${index + 1}`,
      { json: true },
    );
    const embeddedStoryId = text(source.value?.story_id);
    if (embeddedStoryId && embeddedStoryId !== storyId) {
      throw new WeeklyLongformReviewEvidenceError(
        "weekly_review_source_evidence_story_id_mismatch",
      );
    }
    if (
      text(source.value?.schema_version) !==
      "pulse-source-evidence-v1"
    ) {
      throw new WeeklyLongformReviewEvidenceError(
        "weekly_review_source_evidence_schema_invalid",
      );
    }
    const claims = Array.isArray(story?.source_evidence?.claims)
      ? story.source_evidence.claims
      : Array.isArray(source.value?.claims)
        ? source.value.claims
        : [];
    const claimIds = unique(
      claims.map((claim) => text(claim?.claim_id)),
    ).sort();
    if (!claimIds.length) {
      throw new WeeklyLongformReviewEvidenceError(
        "weekly_review_source_evidence_claims_required",
      );
    }
    const primarySourceUrl =
      text(story?.primary_source_url) ||
      text(source.value?.source_url);
    if (!/^https?:\/\//i.test(primarySourceUrl)) {
      throw new WeeklyLongformReviewEvidenceError(
        "weekly_review_primary_source_url_required",
      );
    }
    return {
      story_id: storyId,
      title: text(story?.title) || null,
      primary_source_url: primarySourceUrl,
      verified_claim_ids: claimIds,
      source_evidence: {
        path: source.path,
        sha256: source.sha256,
        byte_length: source.byte_length,
        schema_version: text(source.value?.schema_version) || null,
      },
    };
  });
}

function nestedValue(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return current[key];
  }, value);
}

function declaredHashes(value, paths) {
  return unique(
    paths
      .map((candidate) =>
        normaliseSha256(nestedValue(value, candidate)),
      )
      .filter(Boolean),
  );
}

function requireExactSingleHash(value, paths, expected, code) {
  const hashes = declaredHashes(value, paths);
  if (hashes.length !== 1 || hashes[0] !== expected) {
    throw new WeeklyLongformReviewEvidenceError(code);
  }
}

function requireIndependentGenerator(value, code) {
  const identity = text(value?.generator_identity);
  if (
    !identity ||
    identity.toLowerCase() === GENERATOR_ID.toLowerCase()
  ) {
    throw new WeeklyLongformReviewEvidenceError(code);
  }
}

function requireExactIdentity(value, runId, code) {
  if (
    text(value?.story_id) !== runId ||
    text(value?.run_id) !== runId ||
    text(value?.lane_id) !== LANE_ID
  ) {
    throw new WeeklyLongformReviewEvidenceError(code);
  }
}

function validateRendererManifest(
  artifact,
  { runId, workOrderSha256, masterSha256 },
) {
  const value = artifact.value;
  if (
    text(value?.schema_version) !==
    "pulse-weekly-longform-native-renderer-manifest-v1"
  ) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_renderer_manifest_schema_invalid",
    );
  }
  requireIndependentGenerator(
    value,
    "weekly_review_renderer_manifest_independent_generator_required",
  );
  requireExactIdentity(
    value,
    runId,
    "weekly_review_renderer_manifest_identity_mismatch",
  );
  const verdict = text(value?.verdict).toUpperCase();
  const status = text(value?.status).toUpperCase();
  const state = verdict || status;
  if (
    !["PASS", "GREEN", "READY_FOR_QA"].includes(state) ||
    (verdict && status && verdict !== status) ||
    !Array.isArray(value?.blockers) ||
    value.blockers.length ||
    !text(value?.renderer?.identity)
  ) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_renderer_manifest_not_ready",
    );
  }
  requireExactSingleHash(
    value,
    [
      "work_order_sha256",
      "production_work_order_sha256",
      "bindings.work_order_sha256",
      "bindings.production_work_order_sha256",
    ],
    workOrderSha256,
    "weekly_review_renderer_work_order_sha256_mismatch",
  );
  requireExactSingleHash(
    value,
    [
      "media_sha256",
      "final_media_sha256",
      "master_sha256",
      "output.sha256",
      "bindings.final_media_sha256",
    ],
    masterSha256,
    "weekly_review_renderer_final_media_sha256_mismatch",
  );
}

function validateMeasuredMetrics(metrics, requiredIds, prefix) {
  if (!Array.isArray(metrics)) {
    throw new WeeklyLongformReviewEvidenceError(
      `${prefix}_measurements_required`,
    );
  }
  const byId = new Map(
    metrics.map((metric) => [text(metric?.metric_id), metric]),
  );
  if (byId.size !== metrics.length) {
    throw new WeeklyLongformReviewEvidenceError(
      `${prefix}_measurement_id_duplicate`,
    );
  }
  for (const metricId of requiredIds) {
    const metric = byId.get(metricId);
    const value =
      typeof metric?.value === "number"
        ? metric.value
        : Number.NaN;
    const threshold =
      typeof metric?.threshold?.value === "number"
        ? metric.threshold.value
        : Number.NaN;
    const operator = text(metric?.threshold?.operator);
    const thresholdPassed = {
      "<": value < threshold,
      "<=": value <= threshold,
      ">": value > threshold,
      ">=": value >= threshold,
      "==": value === threshold,
    }[operator];
    const boundedMetric =
      metricId.endsWith("_ratio")
        ? value >= 0 &&
          value <= 1 &&
          threshold >= 0 &&
          threshold <= 1
        : Number.isInteger(value) && value >= 0;
    if (
      !metric ||
      !Number.isFinite(value) ||
      metric.pass !== true ||
      !text(metric.unit) ||
      !text(metric.measurement_source) ||
      text(metric.measurement_source).toLowerCase() ===
        GENERATOR_ID.toLowerCase() ||
      !Number.isFinite(threshold) ||
      thresholdPassed !== true ||
      !boundedMetric
    ) {
      throw new WeeklyLongformReviewEvidenceError(
        `${prefix}_${metricId}_measurement_invalid`,
      );
    }
  }
}

function validateNativeRendererQa(
  artifact,
  {
    runId,
    workOrderSha256,
    masterSha256,
    rendererManifestSha256,
  },
) {
  const value = artifact.value;
  if (
    text(value?.schema_version) !==
    "pulse-weekly-longform-native-renderer-qa-v1"
  ) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_native_renderer_qa_schema_invalid",
    );
  }
  requireIndependentGenerator(
    value,
    "weekly_review_native_renderer_qa_independent_generator_required",
  );
  requireExactIdentity(
    value,
    runId,
    "weekly_review_native_renderer_qa_identity_mismatch",
  );
  const verdict = text(value?.verdict).toUpperCase();
  const status = text(value?.status).toUpperCase();
  if (
    !["PASS", "GREEN"].includes(
      verdict || status,
    ) ||
    (verdict && status && verdict !== status) ||
    value?.complete !== true ||
    !Array.isArray(value?.blockers) ||
    value.blockers.length ||
    text(value?.visual_quality_gate?.verdict).toUpperCase() !==
      "GREEN" ||
    value?.visual_quality_gate?.strict_gate_applied !== true
  ) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_native_renderer_qa_not_strict_green",
    );
  }
  requireExactSingleHash(
    value,
    [
      "work_order_sha256",
      "bindings.work_order_sha256",
      "bindings.production_work_order_sha256",
    ],
    workOrderSha256,
    "weekly_review_native_renderer_qa_work_order_sha256_mismatch",
  );
  requireExactSingleHash(
    value,
    [
      "media_sha256",
      "final_media_sha256",
      "bindings.final_media_sha256",
    ],
    masterSha256,
    "weekly_review_native_renderer_qa_final_media_sha256_mismatch",
  );
  requireExactSingleHash(
    value,
    [
      "renderer_manifest_sha256",
      "bindings.renderer_manifest_sha256",
    ],
    rendererManifestSha256,
    "weekly_review_native_renderer_qa_renderer_sha256_mismatch",
  );
  validateMeasuredMetrics(
    value.visual_quality_gate.measurements,
    [
      "black_frame_ratio",
      "freeze_frame_ratio",
      "blur_frame_ratio",
      "repeated_frame_ratio",
      "safe_zone_compliance_ratio",
    ],
    "weekly_review_native_renderer_qa",
  );
}

function validateOriginalityMeasurement(
  artifact,
  {
    runId,
    workOrderSha256,
    masterSha256,
    rendererManifestSha256,
  },
) {
  const value = artifact.value;
  if (
    text(value?.schema_version) !==
    "pulse-weekly-longform-originality-transformation-measurement-v1"
  ) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_originality_measurement_schema_invalid",
    );
  }
  requireIndependentGenerator(
    value,
    "weekly_review_originality_independent_generator_required",
  );
  requireExactIdentity(
    value,
    runId,
    "weekly_review_originality_identity_mismatch",
  );
  if (
    !["ADEQUATE", "STRONG"].includes(
      text(value?.verdict).toUpperCase(),
    ) ||
    text(value?.rationale).length < 40 ||
    !text(value?.measurement?.method) ||
    !text(value?.measurement?.evaluator_identity) ||
    !Number.isFinite(Date.parse(text(value?.measurement?.measured_at)))
  ) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_originality_measurement_incomplete",
    );
  }
  requireExactSingleHash(
    value,
    [
      "work_order_sha256",
      "bindings.work_order_sha256",
      "bindings.production_work_order_sha256",
    ],
    workOrderSha256,
    "weekly_review_originality_work_order_sha256_mismatch",
  );
  requireExactSingleHash(
    value,
    [
      "media_sha256",
      "final_media_sha256",
      "bindings.final_media_sha256",
    ],
    masterSha256,
    "weekly_review_originality_final_media_sha256_mismatch",
  );
  requireExactSingleHash(
    value,
    [
      "renderer_manifest_sha256",
      "bindings.renderer_manifest_sha256",
    ],
    rendererManifestSha256,
    "weekly_review_originality_renderer_sha256_mismatch",
  );
  validateMeasuredMetrics(
    value.measurement.metrics,
    [
      "original_narration_ratio",
      "original_visual_design_ratio",
      "third_party_excerpt_ratio",
      "editorial_intervention_count",
    ],
    "weekly_review_originality",
  );
}

async function materializeWeeklyLongformReviewEvidence({
  runId,
  generatedAt,
  outputDir,
  runRoot,
  workOrder,
  finalMedia,
  rightsLedger,
  decodedQa,
  rendererManifest,
  nativeRendererQa,
  originalityTransformation,
  sameRunManifest,
  sameRunReport,
  derivativesManifest,
  productionAdapterNetworkUsed = null,
} = {}) {
  const exactRunId = validateRunId(runId);
  const exactGeneratedAt = validateGeneratedAt(generatedAt);
  const outputRoot = path.resolve(text(outputDir));
  const exactRunRoot = path.resolve(text(runRoot));
  if (!text(outputDir) || !text(runRoot)) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_output_roots_required",
    );
  }
  if (!contained(exactRunRoot, outputRoot)) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_output_outside_run_root",
    );
  }
  if (isSecretPath(outputRoot)) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_output_secret_path_forbidden",
    );
  }
  await fsp.mkdir(outputRoot, { recursive: true });

  const master = observeFile(
    finalMedia,
    "weekly_review_final_media",
    { allowedRoot: exactRunRoot },
  );
  const rights = observeFile(
    rightsLedger,
    "weekly_review_rights_ledger",
    { json: true, allowedRoot: exactRunRoot },
  );
  const rightsCanonicalSha256 =
    normaliseSha256(rightsLedger?.canonical_sha256) ||
    normaliseSha256(rights.value?.ledger_sha256);
  const rightsAssessment = assessRightsLedger(
    rights.value,
    rightsCanonicalSha256,
  );
  if (rightsAssessment.blockers.length) {
    throw new WeeklyLongformReviewEvidenceError(
      rightsAssessment.blockers.map(
        (blocker) => `weekly_review_rights:${blocker}`,
      ),
    );
  }
  const qaSource = observeFile(
    decodedQa,
    "weekly_review_decoded_qa",
    { json: true, allowedRoot: exactRunRoot },
  );
  if (
    text(qaSource.value?.verdict).toUpperCase() !== "PASS" ||
    qaSource.value?.complete !== true ||
    normaliseSha256(
      qaSource.value?.master_sha256 ||
        qaSource.value?.bindings?.master_sha256,
    ) !== master.sha256
  ) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_decoded_qa_not_bound_pass",
    );
  }
  const boundSameRunManifest = observeFile(
    sameRunManifest,
    "weekly_review_same_run_manifest",
    { json: true, allowedRoot: exactRunRoot },
  );
  const boundSameRunReport = observeFile(
    sameRunReport,
    "weekly_review_same_run_report",
    { json: true, allowedRoot: exactRunRoot },
  );
  const boundDerivatives = observeFile(
    derivativesManifest,
    "weekly_review_derivatives_manifest",
    { json: true, allowedRoot: exactRunRoot },
  );
  if (
    boundSameRunManifest.value?.machine_evidence_complete !== true ||
    boundSameRunReport.value?.machine_evidence_complete !== true ||
    text(boundDerivatives.value?.status).toUpperCase() !==
      "AWAITING_HUMAN_AV_REVIEW"
  ) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_upstream_machine_evidence_incomplete",
    );
  }

  const upstreamWorkOrderSha256 = normaliseSha256(
    workOrder?.work_order_sha256,
  );
  if (!upstreamWorkOrderSha256) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_upstream_work_order_sha256_required",
    );
  }
  if (workOrderFingerprint(workOrder) !== upstreamWorkOrderSha256) {
    throw new WeeklyLongformReviewEvidenceError(
      "weekly_review_upstream_work_order_sha256_mismatch",
    );
  }
  const stories = sourceStories(workOrder);
  const episodeSourceEvidence = {
    schema_version:
      "pulse-weekly-longform-episode-source-evidence-v1",
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    story_id: exactRunId,
    run_id: exactRunId,
    lane_id: LANE_ID,
    verification_status: "CONFIRMED",
    source_story_count: stories.length,
    sources: stories,
    bindings: {
      upstream_work_order_sha256: upstreamWorkOrderSha256,
      final_media_sha256: master.sha256,
    },
    controls: {
      local_files_rehashed: true,
      network_used_by_bridge: false,
      external_publish_authorised: false,
    },
  };
  const sourceArtifact = await writeJson(
    outputRoot,
    "episode-source-evidence.json",
    episodeSourceEvidence,
  );

  const reviewBlockers = [];
  const rendererEvidence =
    rendererManifest &&
    typeof rendererManifest === "object" &&
    text(rendererManifest.path)
      ? observeFile(
          rendererManifest,
          "weekly_review_renderer_manifest",
          { json: true, allowedRoot: exactRunRoot },
        )
      : null;
  const nativeQaEvidence =
    nativeRendererQa &&
    typeof nativeRendererQa === "object" &&
    text(nativeRendererQa.path)
      ? observeFile(
          nativeRendererQa,
          "weekly_review_native_renderer_qa",
          { json: true, allowedRoot: exactRunRoot },
        )
      : null;
  const originalityEvidence =
    originalityTransformation &&
    typeof originalityTransformation === "object" &&
    text(originalityTransformation.path)
      ? observeFile(
          originalityTransformation,
          "weekly_review_originality_transformation",
          { json: true, allowedRoot: exactRunRoot },
        )
      : null;

  if (!rendererEvidence) {
    reviewBlockers.push(
      "weekly_review_renderer_manifest_pending",
    );
  } else {
    validateRendererManifest(rendererEvidence, {
      runId: exactRunId,
      workOrderSha256: upstreamWorkOrderSha256,
      masterSha256: master.sha256,
    });
  }
  if (!nativeQaEvidence) {
    reviewBlockers.push(
      "weekly_review_native_renderer_qa_pending",
    );
  } else if (!rendererEvidence) {
    reviewBlockers.push(
      "weekly_review_native_renderer_qa_renderer_manifest_pending",
    );
  } else {
    validateNativeRendererQa(nativeQaEvidence, {
      runId: exactRunId,
      workOrderSha256: upstreamWorkOrderSha256,
      masterSha256: master.sha256,
      rendererManifestSha256: rendererEvidence.sha256,
    });
  }
  if (!originalityEvidence) {
    reviewBlockers.push(
      "weekly_review_measured_originality_transformation_pending",
    );
  } else if (!rendererEvidence) {
    reviewBlockers.push(
      "weekly_review_originality_renderer_manifest_pending",
    );
  } else {
    validateOriginalityMeasurement(originalityEvidence, {
      runId: exactRunId,
      workOrderSha256: upstreamWorkOrderSha256,
      masterSha256: master.sha256,
      rendererManifestSha256: rendererEvidence.sha256,
    });
  }
  const exactReviewBlockers = unique(reviewBlockers).sort();
  const reviewEvidenceReady = exactReviewBlockers.length === 0;

  const postProductionWorkOrder = {
    schema_version:
      "pulse-weekly-longform-post-production-review-work-order-v1",
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    story_id: exactRunId,
    run_id: exactRunId,
    lane_id: LANE_ID,
    mode: "HUMAN_REVIEW",
    status: reviewEvidenceReady
      ? "READY_FOR_HUMAN_AV_REVIEW"
      : "HOLD",
    blockers: exactReviewBlockers,
    work_order_sha256: upstreamWorkOrderSha256,
    canonical_sha256: upstreamWorkOrderSha256,
    upstream_work_order: {
      schema_version: text(workOrder?.schema_version) || null,
      canonical_sha256: upstreamWorkOrderSha256,
      production_runner_admission_status:
        text(
          workOrder?.production_runner_admission?.status,
        ).toUpperCase() || null,
    },
    exact_bindings: {
      final_media_sha256: master.sha256,
      rights_ledger_file_sha256: rights.sha256,
      rights_ledger_canonical_sha256:
        rightsAssessment.sha256,
      decoded_qa_source_sha256: qaSource.sha256,
      episode_source_evidence_sha256: sourceArtifact.sha256,
      same_run_manifest_sha256:
        boundSameRunManifest.sha256,
      same_run_report_sha256: boundSameRunReport.sha256,
      derivatives_manifest_sha256: boundDerivatives.sha256,
      renderer_manifest_sha256:
        rendererEvidence?.sha256 || null,
      native_renderer_qa_sha256:
        nativeQaEvidence?.sha256 || null,
      originality_transformation_sha256:
        originalityEvidence?.sha256 || null,
    },
    review_scope: {
      human_av_review_required: true,
      approval_inferred: false,
      publication_authority_created: false,
    },
    safety: {
      local_files_only: true,
      network_used_by_bridge: false,
      production_adapter_network_used:
        typeof productionAdapterNetworkUsed === "boolean"
          ? productionAdapterNetworkUsed
          : null,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      external_publish_authorised: false,
    },
  };
  const postWorkOrderArtifact = await writeJson(
    outputRoot,
    "post-production-review-work-order.json",
    postProductionWorkOrder,
  );

  const disclosureArtifact = await writeJson(
    outputRoot,
    "synthetic-disclosure-proposal.json",
    {
      schema_version:
        "pulse-synthetic-disclosure-proposal-v1",
      generated_at: exactGeneratedAt,
      generator_identity: GENERATOR_ID,
      story_id: exactRunId,
      run_id: exactRunId,
      lane_id: LANE_ID,
      proposal: {
        contains_synthetic_media: true,
        decision: "DISCLOSE",
        rationale:
          "The episode uses synthetic narration and designed synthetic visual elements, so the conservative proposal is to disclose altered or synthetic content.",
        disclosure_text:
          "Includes AI-generated narration and synthetic visual elements.",
        youtube_field_value: true,
        proposed_at: exactGeneratedAt,
      },
      bindings: {
        renderer_manifest_sha256:
          rendererEvidence?.sha256 || null,
        final_media_sha256: master.sha256,
      },
      proposal_only: true,
      human_decision_required: true,
    },
  );

  const reviewEvidence = {
    production_work_order_ref: reviewRef(
      postWorkOrderArtifact,
      exactRunId,
      { canonical_sha256: upstreamWorkOrderSha256 },
    ),
    final_media_ref: reviewRef(master, exactRunId),
    renderer_manifest_ref: rendererEvidence
      ? reviewRef(rendererEvidence, exactRunId)
      : null,
    qa_ref: nativeQaEvidence
      ? reviewRef(nativeQaEvidence, exactRunId)
      : null,
    source_evidence_ref: reviewRef(
      sourceArtifact,
      exactRunId,
    ),
    rights_ledger_ref: reviewRef(
      rights,
      exactRunId,
      { canonical_sha256: rightsAssessment.sha256 },
    ),
    originality_transformation_ref: originalityEvidence
      ? reviewRef(originalityEvidence, exactRunId)
      : null,
    synthetic_disclosure_proposal_ref: reviewRef(
      disclosureArtifact,
      exactRunId,
    ),
  };
  const manifest = {
    schema_version: SCHEMA_VERSION,
    generated_at: exactGeneratedAt,
    generator_identity: GENERATOR_ID,
    story_id: exactRunId,
    run_id: exactRunId,
    lane_id: LANE_ID,
    status: reviewEvidenceReady
      ? "READY_FOR_HUMAN_AV_REVIEW"
      : "HOLD",
    blockers: exactReviewBlockers,
    review_evidence: reviewEvidence,
    evidence_contract: {
      renderer_manifest:
        "pulse-weekly-longform-native-renderer-manifest-v1",
      native_renderer_qa:
        "pulse-weekly-longform-native-renderer-qa-v1",
      originality_transformation:
        "pulse-weekly-longform-originality-transformation-measurement-v1",
      externally_generated_required: true,
      exact_master_renderer_work_order_bindings_required: true,
      strict_visual_gate_required: true,
      measured_transformation_metrics_required: true,
      bridge_self_attestation_forbidden: true,
    },
    human_review: {
      required: true,
      decision: null,
      approval_inferred: false,
    },
    safety: {
      network_used_by_bridge: false,
      production_adapter_network_used:
        typeof productionAdapterNetworkUsed === "boolean"
          ? productionAdapterNetworkUsed
          : null,
      database_mutated: false,
      oauth_mutated: false,
      external_posting_attempted: false,
    },
  };
  const manifestArtifact = await writeJson(
    outputRoot,
    "weekly-longform-review-evidence-manifest.json",
    manifest,
  );
  return {
    manifest,
    manifest_ref: reviewRef(
      manifestArtifact,
      exactRunId,
    ),
    review_evidence: reviewEvidence,
  };
}

module.exports = {
  GENERATOR_ID,
  SCHEMA_VERSION,
  WeeklyLongformReviewEvidenceError,
  materializeWeeklyLongformReviewEvidence,
};
