"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  SYSTEM_POLICY_DISCLOSURE_SCHEMA,
  assessPublicationEvidence,
} = require("./publication-evidence-gates");
const {
  validateOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");

const VERIFIER_ID = "pulse-autonomous-official-publication-authority-v3";
const REPORT_SCHEMA =
  "pulse-autonomous-official-source-evidence-apply-report-v3";
const AUTHORITY_TYPE = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const AUTHORITY_SCOPE = "PUBLICATION_ADMISSION_ONLY";
const MAX_REPORT_AGE_MS = 2 * 60 * 1000;
const MAX_CONTROL_AGE_MS = 60 * 1000;
const AUTHORITY_TTL_MS = 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GUARDED_YOUTUBE_HOURS_UTC = new Set([9, 19]);
const REQUEST_FIELDS = new Set([
  "source_report",
  "binding",
  "publication_evidence",
  "publication_evidence_gate_input",
  "admission_controls",
]);
const SOURCE_REPORT_REFERENCE_FIELDS = new Set(["path", "file_sha256"]);
const BINDING_FIELDS = new Set([
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "scheduled_for",
  "runway_lock_sha256",
  "dispatch_idempotency_key",
  "request_fingerprint",
]);
const GATE_INPUT_FIELDS = new Set([
  "originality_transformation",
  "rights_ledger",
  "rights_ledger_sha256",
  "synthetic_media_disclosure",
]);
const ADMISSION_CONTROL_FIELDS = new Set([
  "kill_switch_proof_sha256",
  "kill_switch_checked_at",
  "single_owner_proof_sha256",
  "single_owner_checked_at",
]);
const PUBLICATION_EVIDENCE_FIELDS = new Set([
  "schema_version",
  "source_evidence_sha256",
  "official_source_release_binding",
  "qa_report_sha256",
  "publication_metadata_sha256",
  "publication_metadata",
  "originality_transformation",
  "rights_ledger_sha256",
  "synthetic_media_disclosure",
  "renderer_manifest_sha256",
  "renderer",
]);
const PUBLICATION_METADATA_FIELDS = new Set([
  "path",
  "sha256",
  "platform",
  "title",
  "description",
]);
const ORIGINALITY_FIELDS = new Set([
  "verdict",
  "rationale",
  "evidence_ref",
  "evidence_sha256",
]);
const SYNTHETIC_DISCLOSURE_FIELDS = new Set([
  "schema_version",
  "decision_authority",
  "altered_content",
  "policy_basis",
  "youtube_field_value",
  "decision_provenance",
]);
const SYSTEM_POLICY_PROVENANCE_FIELDS = new Set([
  "policy_id",
  "policy_version",
  "evaluated_at",
  "evidence_sha256",
]);
const RENDERER_FIELDS = new Set(["id", "role", "version"]);
const REPORT_FIELDS = new Set([
  "schema_version",
  "materialiser_id",
  "mode",
  "generated_at",
  "valid_until",
  "request_sha256",
  "story_id",
  "verdict",
  "blockers",
  "authority",
  "visual_policy",
  "audio_policy",
  "source_revalidation",
  "lineage",
  "controls",
  "qa",
  "input_files",
  "owned_visual_files",
  "operational_publish_authority",
  "dispatch_authorised",
  "dispatch_revalidation_required",
  "external_publish_authorised",
  "platform_contacted",
  "database_mutated",
  "oauth_or_tokens_mutated",
  "platform_objects_created",
  "local_files_written",
  "network_scope",
  "report_sha256",
]);
const REPORT_AUTHORITY_FIELDS = new Set([
  "method",
  "scope",
  "human_approval",
  "may_impersonate_human",
]);
const REPORT_SOURCE_REVALIDATION_FIELDS = new Set([
  "policy",
  "snapshot_count",
  "primary_count",
  "supporting_count",
  "sources",
]);
const REPORT_SOURCE_FIELDS = new Set([
  "role",
  "source_id",
  "source_url",
  "snapshot_sha256",
  "canonical_body_sha256",
  "matched_claim_text_sha256",
  "bytes_sha256",
  "fetch_status",
  "revalidated_at",
  "unchanged",
  "claims_match",
]);
const REPORT_LINEAGE_FIELDS = new Set([
  "story_intake_sha256",
  "source_evidence_sha256",
  "script_sha256",
  "owned_motion_manifest_sha256",
  "owned_motion_source_manifest_sha256",
  "owned_programme_sha256",
  "narration_audio_sha256",
  "narration_manifest_sha256",
  "narration_licence_evidence_sha256",
  "final_composite_manifest_sha256",
  "renderer_manifest_file_sha256",
  "renderer_manifest_canonical_sha256",
  "deterministic_qa_sha256",
  "multimodal_visual_qa_sha256",
  "final_mp4_sha256",
  "publication_metadata_sha256",
  "autonomous_green_supplement_sha256",
  "autonomous_visual_gate_decision_sha256",
  "kill_switch_proof_sha256",
  "single_owner_proof_sha256",
]);
const REPORT_CONTROLS_FIELDS = new Set([
  "kill_switch",
  "scheduler_and_publisher_ownership",
  "kill_switch_proof",
  "single_owner_proof",
]);
const REPORT_QA_FIELDS = new Set([
  "deterministic",
  "multimodal",
  "deterministic_report",
  "multimodal_report",
]);
const REPORT_OBSERVATION_FIELDS = new Set([
  "declared_path",
  "resolved_path",
  "real_path",
  "observed_sha256",
  "size_bytes",
]);
const VISUAL_GATE_DECISION_FIELDS = new Set([
  "schema_version",
  "generated_at",
  "mode",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "verdict",
  "decision_authority",
  "authority_scope",
  "visual_review_policy",
  "bindings",
  "model_evidence",
  "controls",
  "decision_sha256",
]);
const VISUAL_GATE_POLICY_FIELDS = new Set([
  "policy_id",
  "policy_version",
  "gate",
  "required_report_schema",
  "required_aggregation",
  "minimum_distinct_vision_models",
]);
const VISUAL_GATE_BINDING_FIELDS = new Set([
  "final_mp4",
  "visual_qa",
]);
const VISUAL_GATE_FILE_FIELDS = new Set(["path", "sha256"]);
const VISUAL_GATE_QA_FILE_FIELDS = new Set([
  "path",
  "raw_sha256",
  "canonical_sha256",
]);
const VISUAL_GATE_MODEL_FIELDS = new Set([
  "strategy",
  "model_ids",
  "distinct_model_count",
  "review_count",
  "pass_count",
]);
const VISUAL_GATE_CONTROL_FIELDS = new Set([
  "human_approval",
  "models_treated_as_humans",
  "publish_authority",
  "scheduler_authority",
  "database_authority",
  "oauth_or_token_authority",
  "platform_contacted",
  "network_used",
]);

class AutonomousOfficialPublicationAuthorityError extends Error {
  constructor(code) {
    super(code);
    this.name = "AutonomousOfficialPublicationAuthorityError";
    this.code = code;
  }
}

function fail(code) {
  throw new AutonomousOfficialPublicationAuthorityError(code);
}

function text(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return sha256Bytes(JSON.stringify(stableValue(value)));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const timestamp = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw
  ) {
    fail(code);
  }
  return timestamp;
}

function trustedNow(clock) {
  if (typeof clock !== "function") {
    fail("autonomous_publication_authority_trusted_clock_required");
  }
  const value = clock();
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("autonomous_publication_authority_trusted_clock_invalid");
  }
  return date;
}

function exactSchedule(value, nowMs) {
  const scheduleMs = exactTimestamp(
    value,
    "autonomous_publication_authority_schedule_invalid",
  );
  const schedule = new Date(scheduleMs);
  if (
    !GUARDED_YOUTUBE_HOURS_UTC.has(schedule.getUTCHours()) ||
    schedule.getUTCMinutes() !== 0 ||
    schedule.getUTCSeconds() !== 0 ||
    schedule.getUTCMilliseconds() !== 0
  ) {
    fail("autonomous_publication_authority_schedule_not_guarded");
  }
  if (scheduleMs <= nowMs) {
    fail("autonomous_publication_authority_schedule_not_future");
  }
  return schedule;
}

function requireExactFields(value, expected, code) {
  const input = object(value);
  if (!input) fail(code);
  const actual = Object.keys(input).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((field, index) => field !== wanted[index])
  ) {
    fail(code);
  }
  return input;
}

function sameFilePath(left, right) {
  if (!text(left) || !text(right)) return false;
  const leftPath = path.resolve(text(left));
  const rightPath = path.resolve(text(right));
  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

async function validateVisualGateDecisionArtifact({
  report,
  readFile,
}) {
  const inputFiles = object(report.input_files);
  const decisionObservation = object(
    inputFiles?.autonomous_visual_gate_decision,
  );
  const finalObservation = object(inputFiles?.final_mp4);
  const visualQaObservation = object(
    inputFiles?.multimodal_visual_qa,
  );
  for (const observation of [
    decisionObservation,
    finalObservation,
    visualQaObservation,
  ]) {
    requireExactFields(
      observation,
      REPORT_OBSERVATION_FIELDS,
      "autonomous_publication_authority_visual_gate_observation_invalid",
    );
  }
  const decisionFileSha256 = exactSha256(
    decisionObservation.observed_sha256,
    "autonomous_publication_authority_visual_gate_file_hash_invalid",
  );
  if (
    decisionFileSha256 !==
      report.lineage.autonomous_visual_gate_decision_sha256 ||
    exactSha256(
      finalObservation.observed_sha256,
      "autonomous_publication_authority_visual_gate_media_hash_invalid",
    ) !== report.lineage.final_mp4_sha256 ||
    exactSha256(
      visualQaObservation.observed_sha256,
      "autonomous_publication_authority_visual_gate_qa_hash_invalid",
    ) !== report.lineage.multimodal_visual_qa_sha256 ||
    !sameFilePath(
      decisionObservation.resolved_path,
      decisionObservation.real_path,
    )
  ) {
    fail("autonomous_publication_authority_visual_gate_lineage_mismatch");
  }
  let raw;
  try {
    raw = await readFile(
      path.resolve(text(decisionObservation.resolved_path)),
    );
  } catch {
    fail("autonomous_publication_authority_visual_gate_read_failed");
  }
  const bytes = Buffer.isBuffer(raw)
    ? Buffer.from(raw)
    : Buffer.from(raw || []);
  if (!bytes.length || sha256Bytes(bytes) !== decisionFileSha256) {
    fail("autonomous_publication_authority_visual_gate_file_hash_mismatch");
  }
  let decision;
  try {
    decision = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("autonomous_publication_authority_visual_gate_json_invalid");
  }
  requireExactFields(
    decision,
    VISUAL_GATE_DECISION_FIELDS,
    "autonomous_publication_authority_visual_gate_fields_invalid",
  );
  const policy = requireExactFields(
    decision.visual_review_policy,
    VISUAL_GATE_POLICY_FIELDS,
    "autonomous_publication_authority_visual_gate_policy_invalid",
  );
  const bindings = requireExactFields(
    decision.bindings,
    VISUAL_GATE_BINDING_FIELDS,
    "autonomous_publication_authority_visual_gate_bindings_invalid",
  );
  const finalBinding = requireExactFields(
    bindings.final_mp4,
    VISUAL_GATE_FILE_FIELDS,
    "autonomous_publication_authority_visual_gate_media_binding_invalid",
  );
  const visualQaBinding = requireExactFields(
    bindings.visual_qa,
    VISUAL_GATE_QA_FILE_FIELDS,
    "autonomous_publication_authority_visual_gate_qa_binding_invalid",
  );
  const modelEvidence = requireExactFields(
    decision.model_evidence,
    VISUAL_GATE_MODEL_FIELDS,
    "autonomous_publication_authority_visual_gate_models_invalid",
  );
  const controls = requireExactFields(
    decision.controls,
    VISUAL_GATE_CONTROL_FIELDS,
    "autonomous_publication_authority_visual_gate_controls_invalid",
  );
  const decisionSelfSha256 = exactSha256(
    decision.decision_sha256,
    "autonomous_publication_authority_visual_gate_self_hash_invalid",
  );
  const { decision_sha256: _decisionSha256, ...decisionBody } = decision;
  const modelIds = Array.isArray(modelEvidence.model_ids)
    ? modelEvidence.model_ids.map((model) => text(model))
    : [];
  const generatedAtMs = exactTimestamp(
    decision.generated_at,
    "autonomous_publication_authority_visual_gate_time_invalid",
  );
  if (
    decision.schema_version !==
      "pulse-governed-autonomous-visual-gate-decision-v1" ||
    decision.mode !== "LOCAL_PROOF" ||
    decision.story_id !== report.story_id ||
    decision.channel_id !== "pulse-gaming" ||
    decision.lane_id !== "breaking_short" ||
    decision.platform !== "youtube" ||
    decision.verdict !== "PASS" ||
    decision.decision_authority !== "SYSTEM_POLICY" ||
    decision.authority_scope !== AUTHORITY_TYPE ||
    canonicalSha256(decisionBody) !== decisionSelfSha256 ||
    generatedAtMs > Date.parse(report.generated_at) ||
    policy.policy_id !== "pulse-visual-review-policy" ||
    policy.policy_version !== "2" ||
    policy.gate !== "AUTONOMOUS_OFFICIAL_UNANIMOUS" ||
    policy.required_report_schema !==
      "pulse-local-multimodal-visual-review-v1" ||
    policy.required_aggregation !== "UNANIMOUS_PASS" ||
    policy.minimum_distinct_vision_models !== 2 ||
    !sameFilePath(finalBinding.path, finalObservation.resolved_path) ||
    finalBinding.sha256 !== report.lineage.final_mp4_sha256 ||
    !sameFilePath(
      visualQaBinding.path,
      visualQaObservation.resolved_path,
    ) ||
    visualQaBinding.raw_sha256 !==
      report.lineage.multimodal_visual_qa_sha256 ||
    !SHA256_PATTERN.test(text(visualQaBinding.canonical_sha256)) ||
    modelEvidence.strategy !== "UNANIMOUS_PASS" ||
    modelIds.length < 2 ||
    modelIds.some((model) => !model) ||
    new Set(modelIds).size !== modelIds.length ||
    modelEvidence.distinct_model_count !== modelIds.length ||
    modelEvidence.review_count !== modelIds.length ||
    modelEvidence.pass_count !== modelIds.length ||
    controls.human_approval !== false ||
    controls.models_treated_as_humans !== false ||
    controls.publish_authority !== false ||
    controls.scheduler_authority !== false ||
    controls.database_authority !== false ||
    controls.oauth_or_token_authority !== false ||
    controls.platform_contacted !== false ||
    controls.network_used !== false
  ) {
    fail("autonomous_publication_authority_visual_gate_invalid");
  }
  return {
    decision_file_sha256: decisionFileSha256,
    decision_self_sha256: decisionSelfSha256,
    decision_authority: decision.decision_authority,
    authority_scope: decision.authority_scope,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    gate: policy.gate,
    required_report_schema: policy.required_report_schema,
    required_aggregation: policy.required_aggregation,
    minimum_distinct_vision_models:
      policy.minimum_distinct_vision_models,
    distinct_model_count: modelEvidence.distinct_model_count,
    human_approval: controls.human_approval,
    models_treated_as_humans: controls.models_treated_as_humans,
    publish_authority: controls.publish_authority,
    scheduler_authority: controls.scheduler_authority,
    database_authority: controls.database_authority,
    oauth_or_token_authority: controls.oauth_or_token_authority,
    platform_contacted: controls.platform_contacted,
    network_used: controls.network_used,
  };
}

function validateReport(report, nowMs) {
  requireExactFields(
    report,
    REPORT_FIELDS,
    "autonomous_publication_authority_report_fields_invalid",
  );
  requireExactFields(
    report.authority,
    REPORT_AUTHORITY_FIELDS,
    "autonomous_publication_authority_report_authority_fields_invalid",
  );
  requireExactFields(
    report.source_revalidation,
    REPORT_SOURCE_REVALIDATION_FIELDS,
    "autonomous_publication_authority_report_source_fields_invalid",
  );
  requireExactFields(
    report.lineage,
    REPORT_LINEAGE_FIELDS,
    "autonomous_publication_authority_report_lineage_fields_invalid",
  );
  requireExactFields(
    report.controls,
    REPORT_CONTROLS_FIELDS,
    "autonomous_publication_authority_report_control_fields_invalid",
  );
  requireExactFields(
    report.qa,
    REPORT_QA_FIELDS,
    "autonomous_publication_authority_report_qa_fields_invalid",
  );
  for (const observation of [
    report.controls.kill_switch_proof,
    report.controls.single_owner_proof,
    report.qa.deterministic_report,
    report.qa.multimodal_report,
  ]) {
    requireExactFields(
      observation,
      REPORT_OBSERVATION_FIELDS,
      "autonomous_publication_authority_report_observation_fields_invalid",
    );
  }
  if (
    report.schema_version !== REPORT_SCHEMA ||
    report.materialiser_id !==
      "pulse-autonomous-official-source-evidence-apply-v3" ||
    report.mode !== "LOCAL_PROOF" ||
    report.verdict !== "GREEN" ||
    !Array.isArray(report.blockers) ||
    report.blockers.length !== 0
  ) {
    fail("autonomous_publication_authority_report_not_green");
  }
  const reportSha256 = exactSha256(
    report.report_sha256,
    "autonomous_publication_authority_report_self_hash_required",
  );
  const { report_sha256: _reportSha256, ...payload } = report;
  if (canonicalSha256(payload) !== reportSha256) {
    fail("autonomous_publication_authority_report_self_hash_mismatch");
  }
  const generatedAtMs = exactTimestamp(
    report.generated_at,
    "autonomous_publication_authority_report_generated_at_invalid",
  );
  const validUntilMs = exactTimestamp(
    report.valid_until,
    "autonomous_publication_authority_report_valid_until_invalid",
  );
  if (generatedAtMs > nowMs) {
    fail("autonomous_publication_authority_report_from_future");
  }
  if (nowMs - generatedAtMs > MAX_REPORT_AGE_MS || nowMs >= validUntilMs) {
    fail("autonomous_publication_authority_report_stale");
  }
  if (
    report.authority?.method !== AUTHORITY_TYPE ||
    report.authority?.scope !== "LOCAL_EDITORIAL_AND_RELEASE_EVIDENCE_ONLY" ||
    report.authority?.human_approval !== false ||
    report.authority?.may_impersonate_human !== false ||
    report.operational_publish_authority !== false ||
    report.dispatch_authorised !== false ||
    report.dispatch_revalidation_required !== true ||
    report.external_publish_authorised !== false ||
    report.platform_contacted !== false ||
    report.database_mutated !== false ||
    report.oauth_or_tokens_mutated !== false ||
    report.platform_objects_created !== false
  ) {
    fail("autonomous_publication_authority_report_scope_invalid");
  }
  if (
    report.controls?.kill_switch !== "FRESH_HEALTHY" ||
    report.controls?.scheduler_and_publisher_ownership !== "SINGLE_OWNER" ||
    report.qa?.deterministic !== "PASS" ||
    report.qa?.multimodal !== "UNANIMOUS_PASS"
  ) {
    fail("autonomous_publication_authority_report_controls_invalid");
  }
  const sources = report.source_revalidation?.sources;
  if (
    report.source_revalidation?.policy !==
      "PRIMARY_AND_ALL_SUPPORTING_OFFICIAL_SNAPSHOTS" ||
    !Array.isArray(sources) ||
    sources.length < 1 ||
    Number(report.source_revalidation.snapshot_count) !== sources.length ||
    Number(report.source_revalidation.primary_count) !== 1 ||
    Number(report.source_revalidation.supporting_count) !== sources.length - 1
  ) {
    fail("autonomous_publication_authority_source_revalidation_invalid");
  }
  let primaryCount = 0;
  for (const source of sources) {
    requireExactFields(
      source,
      REPORT_SOURCE_FIELDS,
      "autonomous_publication_authority_report_source_record_fields_invalid",
    );
    if (source?.role === "PRIMARY") primaryCount += 1;
    if (
      !["PRIMARY", "SUPPORTING"].includes(source?.role) ||
      source?.unchanged !== true ||
      source?.claims_match !== true ||
      Number(source?.fetch_status) < 200 ||
      Number(source?.fetch_status) >= 300
    ) {
      fail("autonomous_publication_authority_source_revalidation_invalid");
    }
    const revalidatedAtMs = exactTimestamp(
      source.revalidated_at,
      "autonomous_publication_authority_source_revalidation_time_invalid",
    );
    if (
      revalidatedAtMs > nowMs ||
      nowMs - revalidatedAtMs > MAX_REPORT_AGE_MS
    ) {
      fail("autonomous_publication_authority_source_revalidation_stale");
    }
  }
  if (primaryCount !== 1) {
    fail("autonomous_publication_authority_source_revalidation_invalid");
  }
  return {
    reportSha256,
    generatedAtMs,
    validUntilMs,
  };
}

function validatePublicationEvidence({
  publicationEvidence,
  gateInput,
  report,
  storyId,
}) {
  requireExactFields(
    publicationEvidence,
    PUBLICATION_EVIDENCE_FIELDS,
    "autonomous_publication_authority_publication_evidence_fields_invalid",
  );
  requireExactFields(
    publicationEvidence.publication_metadata,
    PUBLICATION_METADATA_FIELDS,
    "autonomous_publication_authority_metadata_fields_invalid",
  );
  requireExactFields(
    publicationEvidence.originality_transformation,
    ORIGINALITY_FIELDS,
    "autonomous_publication_authority_originality_fields_invalid",
  );
  if (
    publicationEvidence.synthetic_media_disclosure?.schema_version !==
      SYSTEM_POLICY_DISCLOSURE_SCHEMA ||
    publicationEvidence.synthetic_media_disclosure?.decision_authority !==
      "SYSTEM_POLICY"
  ) {
    fail("autonomous_publication_authority_system_policy_disclosure_required");
  }
  requireExactFields(
    publicationEvidence.synthetic_media_disclosure,
    SYNTHETIC_DISCLOSURE_FIELDS,
    "autonomous_publication_authority_disclosure_fields_invalid",
  );
  requireExactFields(
    publicationEvidence.synthetic_media_disclosure.decision_provenance,
    SYSTEM_POLICY_PROVENANCE_FIELDS,
    "autonomous_publication_authority_disclosure_provenance_fields_invalid",
  );
  requireExactFields(
    publicationEvidence.renderer,
    RENDERER_FIELDS,
    "autonomous_publication_authority_renderer_fields_invalid",
  );
  if (publicationEvidence.schema_version !== "pulse-publication-evidence-v1") {
    fail("autonomous_publication_authority_publication_evidence_invalid");
  }
  const assessment = assessPublicationEvidence(gateInput);
  if (!assessment.eligible) {
    fail("autonomous_publication_authority_publication_evidence_not_green");
  }
  const expectedOriginality = assessment.normalized.originality_transformation;
  const expectedSynthetic = assessment.normalized.synthetic_media_disclosure;
  if (
    expectedSynthetic?.schema_version !== SYSTEM_POLICY_DISCLOSURE_SCHEMA ||
    expectedSynthetic?.decision_authority !== "SYSTEM_POLICY"
  ) {
    fail("autonomous_publication_authority_system_policy_disclosure_required");
  }
  if (
    JSON.stringify(
      stableValue(publicationEvidence.originality_transformation),
    ) !== JSON.stringify(stableValue(expectedOriginality)) ||
    JSON.stringify(
      stableValue(publicationEvidence.synthetic_media_disclosure),
    ) !== JSON.stringify(stableValue(expectedSynthetic)) ||
    exactSha256(
      publicationEvidence.rights_ledger_sha256,
      "autonomous_publication_authority_rights_hash_invalid",
    ) !== assessment.normalized.rights_ledger_sha256
  ) {
    fail(
      "autonomous_publication_authority_publication_evidence_not_normalized",
    );
  }
  const lineage = report.lineage;
  for (const [actual, expected, code] of [
    [
      publicationEvidence.source_evidence_sha256,
      lineage.source_evidence_sha256,
      "autonomous_publication_authority_source_hash_mismatch",
    ],
    [
      publicationEvidence.qa_report_sha256,
      lineage.deterministic_qa_sha256,
      "autonomous_publication_authority_qa_hash_mismatch",
    ],
    [
      publicationEvidence.publication_metadata_sha256,
      lineage.publication_metadata_sha256,
      "autonomous_publication_authority_metadata_hash_mismatch",
    ],
    [
      publicationEvidence.renderer_manifest_sha256,
      lineage.renderer_manifest_canonical_sha256,
      "autonomous_publication_authority_renderer_hash_mismatch",
    ],
  ]) {
    if (
      exactSha256(
        actual,
        "autonomous_publication_authority_publication_hash_invalid",
      ) !==
      exactSha256(
        expected,
        "autonomous_publication_authority_report_lineage_invalid",
      )
    ) {
      fail(code);
    }
  }
  const metadata = publicationEvidence.publication_metadata;
  if (
    metadata?.sha256 !== publicationEvidence.publication_metadata_sha256 ||
    metadata?.platform !== "youtube_shorts" ||
    !text(metadata?.path) ||
    !text(metadata?.title) ||
    !text(metadata?.description)
  ) {
    fail("autonomous_publication_authority_metadata_invalid");
  }
  if (
    publicationEvidence.renderer?.id !== "studio-v21" ||
    publicationEvidence.renderer?.role !== "standard" ||
    !text(publicationEvidence.renderer?.version)
  ) {
    fail("autonomous_publication_authority_renderer_invalid");
  }
  try {
    const validated = validateOfficialSourceReleaseBinding(
      publicationEvidence.official_source_release_binding,
      {
        storyId,
        sourceEvidenceSha256: publicationEvidence.source_evidence_sha256,
      },
    );
    if (
      JSON.stringify(stableValue(validated.value)) !==
      JSON.stringify(
        stableValue(publicationEvidence.official_source_release_binding),
      )
    ) {
      fail("autonomous_publication_authority_source_binding_not_normalized");
    }
  } catch (error) {
    if (error instanceof AutonomousOfficialPublicationAuthorityError) {
      throw error;
    }
    fail(
      text(error?.code) ||
        "autonomous_publication_authority_source_binding_invalid",
    );
  }
}

function validateControls(controls, report, nowMs) {
  const killHash = exactSha256(
    controls.kill_switch_proof_sha256,
    "autonomous_publication_authority_kill_switch_hash_invalid",
  );
  const ownerHash = exactSha256(
    controls.single_owner_proof_sha256,
    "autonomous_publication_authority_single_owner_hash_invalid",
  );
  if (
    killHash !== report.lineage.kill_switch_proof_sha256 ||
    ownerHash !== report.lineage.single_owner_proof_sha256 ||
    report.controls?.kill_switch_proof?.observed_sha256 !== killHash ||
    report.controls?.single_owner_proof?.observed_sha256 !== ownerHash
  ) {
    fail("autonomous_publication_authority_control_hash_mismatch");
  }
  const killCheckedAtMs = exactTimestamp(
    controls.kill_switch_checked_at,
    "autonomous_publication_authority_kill_switch_time_invalid",
  );
  const ownerCheckedAtMs = exactTimestamp(
    controls.single_owner_checked_at,
    "autonomous_publication_authority_single_owner_time_invalid",
  );
  for (const checkedAtMs of [killCheckedAtMs, ownerCheckedAtMs]) {
    if (checkedAtMs > nowMs || nowMs - checkedAtMs >= MAX_CONTROL_AGE_MS) {
      fail("autonomous_publication_authority_controls_stale");
    }
  }
  return {
    killHash,
    ownerHash,
    killCheckedAtMs,
    ownerCheckedAtMs,
  };
}

function authorityLineage(report, publicationEvidence) {
  const source = report.lineage;
  const result = {
    story_intake_sha256: source.story_intake_sha256,
    source_evidence_sha256: source.source_evidence_sha256,
    script_sha256: source.script_sha256,
    owned_motion_manifest_sha256: source.owned_motion_manifest_sha256,
    narration_audio_sha256: source.narration_audio_sha256,
    narration_manifest_sha256: source.narration_manifest_sha256,
    final_composite_manifest_sha256: source.final_composite_manifest_sha256,
    renderer_manifest_file_sha256: source.renderer_manifest_file_sha256,
    renderer_manifest_canonical_sha256:
      source.renderer_manifest_canonical_sha256,
    qa_report_sha256: source.deterministic_qa_sha256,
    multimodal_visual_qa_sha256: source.multimodal_visual_qa_sha256,
    media_sha256: source.final_mp4_sha256,
    publication_metadata_sha256: source.publication_metadata_sha256,
    autonomous_green_supplement_sha256:
      source.autonomous_green_supplement_sha256,
    autonomous_visual_gate_decision_sha256:
      source.autonomous_visual_gate_decision_sha256,
    rights_ledger_sha256: publicationEvidence.rights_ledger_sha256,
  };
  for (const [field, value] of Object.entries(result)) {
    result[field] = exactSha256(
      value,
      `autonomous_publication_authority_lineage_${field}_invalid`,
    );
  }
  return result;
}

async function createAutonomousOfficialPublicationAuthority(
  request,
  options = {},
) {
  const input = object(request);
  if (!input) {
    fail("autonomous_publication_authority_request_invalid");
  }
  requireExactFields(
    input,
    REQUEST_FIELDS,
    "autonomous_publication_authority_request_fields_invalid",
  );
  const now = trustedNow(options.clock);
  const nowMs = now.getTime();
  const sourceReport = object(input.source_report);
  const binding = object(input.binding);
  const publicationEvidence = object(input.publication_evidence);
  const gateInput = object(input.publication_evidence_gate_input);
  const admissionControls = object(input.admission_controls);
  if (
    !sourceReport ||
    !binding ||
    !publicationEvidence ||
    !gateInput ||
    !admissionControls
  ) {
    fail("autonomous_publication_authority_request_invalid");
  }
  requireExactFields(
    sourceReport,
    SOURCE_REPORT_REFERENCE_FIELDS,
    "autonomous_publication_authority_source_report_fields_invalid",
  );
  requireExactFields(
    binding,
    BINDING_FIELDS,
    "autonomous_publication_authority_binding_fields_invalid",
  );
  requireExactFields(
    gateInput,
    GATE_INPUT_FIELDS,
    "autonomous_publication_authority_gate_input_fields_invalid",
  );
  requireExactFields(
    admissionControls,
    ADMISSION_CONTROL_FIELDS,
    "autonomous_publication_authority_admission_control_fields_invalid",
  );
  const readFile =
    options.fileSystem?.readFile?.bind(options.fileSystem) ||
    defaultFileSystem.readFile.bind(defaultFileSystem);
  const reportPath = path.resolve(text(sourceReport.path));
  const expectedFileSha256 = exactSha256(
    sourceReport.file_sha256,
    "autonomous_publication_authority_report_file_hash_required",
  );
  let raw;
  try {
    raw = await readFile(reportPath);
  } catch {
    fail("autonomous_publication_authority_report_read_failed");
  }
  const reportBytes = Buffer.isBuffer(raw)
    ? Buffer.from(raw)
    : Buffer.from(raw || []);
  if (!reportBytes.length || sha256Bytes(reportBytes) !== expectedFileSha256) {
    fail("autonomous_publication_authority_report_file_hash_mismatch");
  }
  let report;
  try {
    report = JSON.parse(reportBytes.toString("utf8"));
  } catch {
    fail("autonomous_publication_authority_report_json_invalid");
  }
  const reportValidation = validateReport(report, nowMs);
  const autonomousVisualGate =
    await validateVisualGateDecisionArtifact({
      report,
      readFile,
    });
  const storyId = text(binding.story_id);
  if (!storyId || report.story_id !== storyId) {
    fail("autonomous_publication_authority_story_mismatch");
  }
  if (
    binding.channel_id !== "pulse-gaming" ||
    binding.lane_id !== "breaking_short" ||
    binding.platform !== "youtube"
  ) {
    fail("autonomous_publication_authority_binding_scope_invalid");
  }
  const schedule = exactSchedule(binding.scheduled_for, nowMs);
  const scheduledFor = schedule.toISOString();
  const runwayLockSha256 = exactSha256(
    binding.runway_lock_sha256,
    "autonomous_publication_authority_runway_hash_invalid",
  );
  const requestFingerprint = exactSha256(
    binding.request_fingerprint,
    "autonomous_publication_authority_request_fingerprint_invalid",
  );
  const dispatchIdempotencyKey = text(binding.dispatch_idempotency_key);
  if (dispatchIdempotencyKey !== `youtube:${storyId}:${scheduledFor}`) {
    fail("autonomous_publication_authority_dispatch_identity_mismatch");
  }
  validatePublicationEvidence({
    publicationEvidence,
    gateInput,
    report,
    storyId,
  });
  const controls = validateControls(admissionControls, report, nowMs);
  const validUntilMs = Math.min(
    nowMs + AUTHORITY_TTL_MS,
    reportValidation.validUntilMs,
    controls.killCheckedAtMs + MAX_CONTROL_AGE_MS,
    controls.ownerCheckedAtMs + MAX_CONTROL_AGE_MS,
    schedule.getTime(),
  );
  if (validUntilMs <= nowMs) {
    fail("autonomous_publication_authority_no_fresh_window");
  }
  const publicationEvidenceCopy = deepClone(publicationEvidence);
  const authorityClaims = {
    verifier_id: VERIFIER_ID,
    issued_at: now.toISOString(),
    valid_until: new Date(validUntilMs).toISOString(),
    decision: "APPROVED",
    authority_type: AUTHORITY_TYPE,
    authority_scope: AUTHORITY_SCOPE,
    autonomous_visual_gate: autonomousVisualGate,
    human_approval: false,
    may_impersonate_human: false,
    operational_publish_authority: false,
    dispatch_authorised: false,
    external_publish_authorised: false,
    story_id: storyId,
    channel_id: binding.channel_id,
    lane_id: binding.lane_id,
    platform: binding.platform,
    scheduled_for: scheduledFor,
    runway_lock_sha256: runwayLockSha256,
    dispatch_idempotency_key: dispatchIdempotencyKey,
    request_fingerprint: requestFingerprint,
    source_report: {
      path: reportPath,
      file_sha256: expectedFileSha256,
      report_sha256: reportValidation.reportSha256,
      request_sha256: exactSha256(
        report.request_sha256,
        "autonomous_publication_authority_source_request_hash_invalid",
      ),
      generated_at: report.generated_at,
      valid_until: report.valid_until,
    },
    lineage: authorityLineage(report, publicationEvidenceCopy),
    publication_evidence: publicationEvidenceCopy,
    admission_controls: {
      kill_switch_proof_sha256: controls.killHash,
      kill_switch_checked_at: admissionControls.kill_switch_checked_at,
      single_owner_proof_sha256: controls.ownerHash,
      single_owner_checked_at: admissionControls.single_owner_checked_at,
    },
    required_release_boundary: {
      boundary: "T_MINUS_15",
      official_source_revalidation_required: true,
      kill_switch_revalidation_required: true,
      single_owner_revalidation_required: true,
      exact_binding_revalidation_required: true,
      max_control_age_ms: MAX_CONTROL_AGE_MS,
      disarm_on_failure: true,
    },
    single_use: true,
  };
  const authorityBody = {
    authority_id: [
      "autonomous-official-publication",
      canonicalSha256(authorityClaims),
    ].join(":"),
    ...authorityClaims,
  };
  const authority = {
    ...authorityBody,
    authority_sha256: canonicalSha256(authorityBody),
  };
  return deepFreeze(authority);
}

module.exports = {
  AUTHORITY_SCOPE,
  AUTHORITY_TYPE,
  AutonomousOfficialPublicationAuthorityError,
  MAX_CONTROL_AGE_MS,
  MAX_REPORT_AGE_MS,
  VERIFIER_ID,
  createAutonomousOfficialPublicationAuthority,
};
