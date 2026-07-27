"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  sqliteMutationBoundaryBlockers,
  verifyBackupEvidence,
  withReadOnlySqliteSnapshot,
} = require("./stabilisation-cutover-reconcile");
const {
  inspectOpenDatabase,
} = require("./governed-reviewed-qa-repair");
const governanceFactory = require("../repositories/publication_governance");
const {
  fingerprintOutsideCadenceAuthorisation,
} = require("../services/publication-admission");
const {
  REVIEWED_25_SECOND_VIDEO_FAILURE,
  reconcileGovernedReviewedVideoQa,
  resolveGovernedReviewedContentQaAuthority,
} = require("../services/governed-reviewed-content-qa");
const { runVideoQa } = require("../services/video-qa");

const RESULT_SCHEMA_VERSION =
  "pulse-governed-reviewed-video-qa-repair-result-v1";
const GUARDED_RESULT_SCHEMA_VERSION =
  "pulse-guarded-youtube-window-result-v1";
const PLATFORM = "youtube";
const CHANNEL_ID = "pulse-gaming";
const EXPECTED_QA_FAILURE = REVIEWED_25_SECOND_VIDEO_FAILURE;
const EXPECTED_QA_PUBLISH_ERROR = `qa_blocked: ${EXPECTED_QA_FAILURE}`;
const SCHEDULE_EXPIRY_MS = 15 * 60 * 1000;
const GENERATED_AT_MAX_SKEW_MS = 5 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SECONDARY_AUTOMATION_FLAGS = Object.freeze([
  "TIKTOK_ENABLED",
  "TIKTOK_AUTO_PUBLISH",
  "INSTAGRAM_AUTO_PUBLISH",
  "FACEBOOK_AUTO_PUBLISH",
  "TWITTER_ENABLED",
  "X_AUTO_PUBLISH",
  "THREADS_AUTO_PUBLISH",
  "PINTEREST_AUTO_PUBLISH",
]);

function text(value) {
  return String(value || "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function samePath(left, right) {
  if (!text(left) || !text(right)) return false;
  return (
    path.resolve(left).replace(/\\/g, "/").toLowerCase() ===
    path.resolve(right).replace(/\\/g, "/").toLowerCase()
  );
}

function truthy(value) {
  return value === true || /^(true|1|yes|on)$/i.test(text(value));
}

function explicitFalse(value) {
  return value === false || /^(false|0|no|off)$/i.test(text(value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseObject(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFileSync(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function isRuntimeTreeClean(
  cwd,
  { execFileSyncImpl = execFileSync } = {},
) {
  try {
    const output = String(
      execFileSyncImpl(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        {
          cwd,
          encoding: "utf8",
          timeout: 2000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ) || "",
    ).trim();
    return output === "";
  } catch {
    return false;
  }
}

function qaPublishErrorPersistenceShape(rawStory) {
  if (text(rawStory?.publish_error) !== EXPECTED_QA_PUBLISH_ERROR) {
    return null;
  }
  const storedExtra = parseObject(rawStory?._extra);
  if (!Object.prototype.hasOwnProperty.call(storedExtra, "publish_error")) {
    return "top_level_only";
  }
  return text(storedExtra.publish_error) === EXPECTED_QA_PUBLISH_ERROR
    ? "mirrored_exact"
    : null;
}

function scheduledDispatchFromInspection(inspection) {
  const event = inspection.scheduled;
  const evidence = inspection.scheduled_evidence;
  return {
    event,
    evidence,
    idempotencyKey: text(evidence.dispatch_idempotency_key),
    requestFingerprint: lower(evidence.request_fingerprint),
    publicationEvidence: evidence.publication_evidence,
    scheduledFor: new Date(evidence.scheduled_for).toISOString(),
  };
}

function exactBindingFromInspection(inspection) {
  const scheduled = scheduledDispatchFromInspection(inspection);
  return {
    storyId: inspection.story.id,
    platform: PLATFORM,
    scheduledFor: scheduled.scheduledFor,
    scheduledEventId: String(scheduled.event.id),
    dispatchIdempotencyKey: scheduled.idempotencyKey,
    requestFingerprint: scheduled.requestFingerprint,
  };
}

function readGuardedDispatchResult(filePath) {
  const resolvedPath = path.resolve(text(filePath));
  if (!text(filePath) || !fs.existsSync(resolvedPath)) {
    const error = new Error("guarded_dispatch_result_required");
    error.code = "guarded_dispatch_result_required";
    throw error;
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch {
    const error = new Error("guarded_dispatch_result_invalid_json");
    error.code = "guarded_dispatch_result_invalid_json";
    throw error;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("guarded_dispatch_result_invalid");
    error.code = "guarded_dispatch_result_invalid";
    throw error;
  }
  return {
    path: resolvedPath,
    sha256: hashFileSync(resolvedPath),
    value,
  };
}

function environmentBlockers(env = {}) {
  const blockers = [];
  const mode = text(env.PULSE_OPERATING_MODE || env.OPERATING_MODE);
  if (mode !== "HUMAN_REVIEW") {
    blockers.push("human_review_operating_mode_required");
  }
  if (
    (env.PULSE_OPERATING_MODE &&
      text(env.PULSE_OPERATING_MODE) !== "HUMAN_REVIEW") ||
    (env.OPERATING_MODE &&
      text(env.OPERATING_MODE) !== "HUMAN_REVIEW")
  ) {
    blockers.push("operating_mode_conflict");
  }
  if (!explicitFalse(env.AUTO_PUBLISH)) {
    blockers.push("auto_publish_must_be_false");
  }
  if (!explicitFalse(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED)) {
    blockers.push("guarded_live_dispatch_must_be_false");
  }
  if (
    !truthy(env.PULSE_EMERGENCY_KILL_SWITCH) &&
    !truthy(env.PULSE_KILL_SWITCH)
  ) {
    blockers.push("emergency_kill_switch_required");
  }
  if (!truthy(env.PULSE_CUTOVER_SCHEDULER_STOPPED)) {
    blockers.push("stopped_scheduler_confirmation_required");
  }
  if (!truthy(env.PULSE_CUTOVER_WORKERS_STOPPED)) {
    blockers.push("stopped_workers_confirmation_required");
  }
  if (!truthy(env.USE_SQLITE) || !truthy(env.USE_JOB_QUEUE)) {
    blockers.push("durable_sqlite_queue_required");
  }
  if (!explicitFalse(env.PULSE_PRIMARY_INSTANCE)) {
    blockers.push("primary_instance_must_be_false");
  }
  if (SECONDARY_AUTOMATION_FLAGS.some((key) => truthy(env[key]))) {
    blockers.push("secondary_platform_automation_must_be_false");
  }
  return unique(blockers);
}

function inspectionBlockers(inspection, generatedAt) {
  const blockers = [];
  if (inspection.missing_tables?.length) {
    blockers.push(
      ...inspection.missing_tables.map(
        (tableName) => `required_table_missing:${tableName}`,
      ),
    );
    return blockers;
  }
  const story = inspection.story;
  if (!story) return ["publication_story_not_found"];
  if (text(story.channel_id || CHANNEL_ID) !== CHANNEL_ID) {
    blockers.push("publication_story_channel_mismatch");
  }
  if (story.qa_failed !== true || story.publish_status !== "failed") {
    blockers.push("exact_persisted_video_qa_failure_required");
  }
  if (!qaPublishErrorPersistenceShape(inspection.raw_story)) {
    blockers.push("exact_video_qa_publish_error_required");
  }
  const persisted = Array.isArray(story.qa_failures)
    ? story.qa_failures
    : [];
  if (
    persisted.length !== 1 ||
    persisted[0] !== EXPECTED_QA_FAILURE
  ) {
    blockers.push("exact_persisted_video_qa_failure_required");
  }
  if (
    inspection.state?.lifecycle_state !== "SCHEDULED" ||
    !inspection.scheduled
  ) {
    blockers.push("expired_scheduled_admission_required");
  }
  const scheduledFor = Date.parse(
    inspection.scheduled_evidence?.scheduled_for,
  );
  const generatedMs = Date.parse(generatedAt);
  if (
    !Number.isFinite(scheduledFor) ||
    !Number.isFinite(generatedMs) ||
    generatedMs - scheduledFor <= SCHEDULE_EXPIRY_MS
  ) {
    blockers.push("scheduled_admission_not_expired");
  }
  if (
    inspection.later_lifecycle_count !== 0 ||
    inspection.latest_lifecycle?.id !== inspection.scheduled?.id ||
    inspection.dispatch_ledger_count !== 0
  ) {
    blockers.push("uploader_boundary_not_clear");
  }
  if (
    inspection.platform_post_count !== 0 ||
    text(inspection.state?.external_id) ||
    text(inspection.state?.external_url) ||
    text(story.youtube_post_id) ||
    text(story.youtube_url)
  ) {
    blockers.push("external_object_not_clear");
  }
  if (
    inspection.active_runtime_lease_count !== 0 ||
    inspection.running_job_count !== 0 ||
    inspection.active_worker_count !== 0
  ) {
    blockers.push("stopped_runtime_database_state_required");
  }
  const review = story.final_publication_review;
  const audit = inspection.review_audit_evidence;
  if (
    !inspection.review_audit ||
    sha256(JSON.stringify(stableValue(audit))) !==
      sha256(JSON.stringify(stableValue(review || {})))
  ) {
    blockers.push("immutable_publication_review_audit_required");
  }
  return unique(blockers);
}

function exactHashChain(story, scheduled, authority) {
  const review = story?.final_publication_review;
  const preflight = story?.preflight_evidence;
  const publicationEvidence = scheduled?.publicationEvidence;
  const reviewManifestSha256 = lower(review?.review_manifest_sha256);
  const rendererManifestSha256 = lower(
    authority?.renderer?.manifestSha256,
  );
  const sourceEvidenceSha256 = lower(
    preflight?.source_evidence_sha256,
  );
  const rightsLedgerSha256 = lower(
    preflight?.rights_ledger_sha256,
  );
  const publicationMetadataSha256 = lower(
    preflight?.publication_metadata_sha256,
  );
  const blockers = [];
  if (!SHA256_PATTERN.test(reviewManifestSha256)) {
    blockers.push("exact_review_manifest_sha256_required");
  }
  if (!SHA256_PATTERN.test(rendererManifestSha256)) {
    blockers.push("exact_renderer_manifest_sha256_required");
  }
  if (!SHA256_PATTERN.test(sourceEvidenceSha256)) {
    blockers.push("exact_source_evidence_sha256_required");
  }
  if (!SHA256_PATTERN.test(rightsLedgerSha256)) {
    blockers.push("exact_rights_ledger_sha256_required");
  }
  if (!SHA256_PATTERN.test(publicationMetadataSha256)) {
    blockers.push("exact_publication_metadata_sha256_required");
  }
  for (const [actual, expected, code] of [
    [
      lower(review?.renderer_manifest?.canonical_sha256),
      rendererManifestSha256,
      "reviewed_renderer_manifest_hash_mismatch",
    ],
    [
      lower(publicationEvidence?.renderer_manifest_sha256),
      rendererManifestSha256,
      "scheduled_renderer_manifest_hash_mismatch",
    ],
    [
      lower(review?.source_evidence?.sha256),
      sourceEvidenceSha256,
      "reviewed_source_evidence_hash_mismatch",
    ],
    [
      lower(publicationEvidence?.source_evidence_sha256),
      sourceEvidenceSha256,
      "scheduled_source_evidence_hash_mismatch",
    ],
    [
      lower(review?.rights_ledger?.canonical_sha256),
      rightsLedgerSha256,
      "reviewed_rights_ledger_hash_mismatch",
    ],
    [
      lower(publicationEvidence?.rights_ledger_sha256),
      rightsLedgerSha256,
      "scheduled_rights_ledger_hash_mismatch",
    ],
    [
      lower(review?.publication_metadata?.sha256),
      publicationMetadataSha256,
      "reviewed_publication_metadata_hash_mismatch",
    ],
    [
      lower(publicationEvidence?.publication_metadata_sha256),
      publicationMetadataSha256,
      "scheduled_publication_metadata_hash_mismatch",
    ],
  ]) {
    if (!actual || actual !== expected) blockers.push(code);
  }
  return {
    blockers: unique(blockers),
    reviewManifestSha256,
    rendererManifestSha256,
    sourceEvidenceSha256,
    rightsLedgerSha256,
    publicationMetadataSha256,
  };
}

function exactVideoQaBlockers(story, videoQa, reconciled) {
  const persisted = Array.isArray(story?.qa_failures)
    ? story.qa_failures
    : [];
  const observed = Array.isArray(videoQa?.failures)
    ? videoQa.failures
    : [];
  const resolved = Array.isArray(reconciled?.resolved)
    ? reconciled.resolved
    : [];
  const exact = (values) =>
    values.length === 1 && values[0] === EXPECTED_QA_FAILURE;
  const blockers = [];
  if (!exact(persisted) || !exact(observed)) {
    blockers.push("exact_current_and_persisted_video_qa_failure_required");
  }
  if (
    videoQa?.result !== "fail" ||
    reconciled?.result !== "warn" ||
    !Array.isArray(reconciled?.warnings) ||
    !reconciled.warnings.includes(
      `governed_review_resolved:${EXPECTED_QA_FAILURE}`,
    )
  ) {
    blockers.push("coherent_reviewed_video_qa_states_required");
  }
  if (
    !exact(resolved) ||
    !Array.isArray(reconciled?.failures) ||
    reconciled.failures.length !== 0
  ) {
    blockers.push("reviewed_video_qa_not_clean");
  }
  return blockers;
}

function guardedDispatchBlockers({
  guarded,
  inspection,
  scheduled,
  authority,
  hashes,
}) {
  const value = guarded?.value;
  const publisher = value?.publisher_result;
  const selection = value?.selection_binding;
  const candidate = value?.scheduled_candidate;
  const skipped = Array.isArray(publisher?.qa_skipped)
    ? publisher.qa_skipped
    : [];
  const one = skipped[0];
  const refresh =
    value?.safety?.ephemeral_youtube_access_token_refresh;
  const outsideCadence =
    inspection.scheduled_evidence?.outside_cadence_authorisation;
  const expectedReviewSha = lower(
    inspection.story?.final_publication_review?.review_manifest_sha256,
  );
  const blockers = [];
  for (const [actual, expected, code] of [
    [
      text(value?.schema_version),
      GUARDED_RESULT_SCHEMA_VERSION,
      "guarded_dispatch_result_schema_invalid",
    ],
    [
      lower(value?.action),
      "dispatch",
      "guarded_dispatch_action_required",
    ],
    [
      text(value?.verdict),
      "HOLD",
      "guarded_dispatch_hold_required",
    ],
    [
      text(value?.story_id),
      inspection.story.id,
      "guarded_dispatch_story_mismatch",
    ],
    [
      text(value?.channel_id),
      CHANNEL_ID,
      "guarded_dispatch_channel_mismatch",
    ],
    [
      lower(value?.platform),
      PLATFORM,
      "guarded_dispatch_platform_mismatch",
    ],
    [
      text(value?.scheduled_for),
      scheduled.scheduledFor,
      "guarded_dispatch_schedule_mismatch",
    ],
    [
      lower(value?.media_sha256),
      authority.mediaSha256,
      "guarded_dispatch_media_hash_mismatch",
    ],
    [
      lower(value?.script_sha256),
      authority.scriptSha256,
      "guarded_dispatch_script_hash_mismatch",
    ],
    [
      lower(value?.request_fingerprint),
      scheduled.requestFingerprint,
      "guarded_dispatch_request_fingerprint_mismatch",
    ],
    [
      lower(value?.renderer_manifest_sha256),
      hashes.rendererManifestSha256,
      "guarded_dispatch_renderer_hash_mismatch",
    ],
    [
      lower(value?.source_evidence_sha256),
      hashes.sourceEvidenceSha256,
      "guarded_dispatch_source_hash_mismatch",
    ],
    [
      text(value?.dispatch_idempotency_key),
      scheduled.idempotencyKey,
      "guarded_dispatch_key_mismatch",
    ],
    [
      lower(value?.review_manifest_sha256),
      expectedReviewSha,
      "guarded_dispatch_review_hash_mismatch",
    ],
    [
      String(candidate?.scheduled_event_id ?? ""),
      String(scheduled.event.id),
      "guarded_dispatch_event_mismatch",
    ],
    [
      text(selection?.method),
      "unique_fresh_scheduled_candidate_in_exact_sqlite",
      "guarded_dispatch_selection_method_mismatch",
    ],
    [
      text(selection?.story_id),
      inspection.story.id,
      "guarded_dispatch_selection_story_mismatch",
    ],
    [
      String(selection?.scheduled_event_id ?? ""),
      String(scheduled.event.id),
      "guarded_dispatch_selection_event_mismatch",
    ],
    [
      text(candidate?.story_id),
      inspection.story.id,
      "guarded_dispatch_candidate_story_mismatch",
    ],
    [
      lower(candidate?.platform),
      PLATFORM,
      "guarded_dispatch_candidate_platform_mismatch",
    ],
    [
      text(candidate?.lifecycle_state),
      "SCHEDULED",
      "guarded_dispatch_candidate_state_mismatch",
    ],
    [
      text(publisher?.top_reason),
      `video_qa: ${EXPECTED_QA_FAILURE}`,
      "guarded_dispatch_publisher_reason_mismatch",
    ],
    [
      text(one?.id),
      inspection.story.id,
      "guarded_dispatch_skipped_story_mismatch",
    ],
    [
      text(one?.source),
      "video",
      "guarded_dispatch_skipped_source_mismatch",
    ],
    [
      text(one?.reason),
      EXPECTED_QA_FAILURE,
      "guarded_dispatch_skipped_reason_mismatch",
    ],
    [
      text(value?.outside_cadence_authorisation_id),
      text(outsideCadence?.authorisation_id),
      "guarded_dispatch_outside_cadence_id_mismatch",
    ],
    [
      text(outsideCadence?.confirmed_authorisation_id),
      text(outsideCadence?.authorisation_id),
      "scheduled_outside_cadence_confirmation_mismatch",
    ],
    [
      text(outsideCadence?.story_id),
      inspection.story.id,
      "scheduled_outside_cadence_story_mismatch",
    ],
    [
      text(outsideCadence?.channel_id),
      CHANNEL_ID,
      "scheduled_outside_cadence_channel_mismatch",
    ],
    [
      lower(outsideCadence?.platform),
      PLATFORM,
      "scheduled_outside_cadence_platform_mismatch",
    ],
    [
      text(outsideCadence?.scheduled_for),
      scheduled.scheduledFor,
      "scheduled_outside_cadence_schedule_mismatch",
    ],
    [
      text(outsideCadence?.dispatch_idempotency_key),
      scheduled.idempotencyKey,
      "scheduled_outside_cadence_key_mismatch",
    ],
    [
      lower(outsideCadence?.request_fingerprint),
      scheduled.requestFingerprint,
      "scheduled_outside_cadence_fingerprint_mismatch",
    ],
  ]) {
    if (!actual || actual !== expected) blockers.push(code);
  }
  const generatedMs = Date.parse(value?.generated_at);
  const scheduledMs = Date.parse(scheduled.scheduledFor);
  if (
    !Number.isFinite(generatedMs) ||
    !Number.isFinite(scheduledMs) ||
    generatedMs < scheduledMs ||
    generatedMs - scheduledMs > SCHEDULE_EXPIRY_MS
  ) {
    blockers.push("guarded_dispatch_timestamp_invalid");
  }
  const exactBlockers = [
    "published_state_confirmation_required",
    "publisher_did_not_confirm_new_upload",
  ];
  const resultBlockers = Array.isArray(value?.blockers)
    ? value.blockers
    : [];
  if (
    JSON.stringify(resultBlockers.slice().sort()) !==
    JSON.stringify(exactBlockers.slice().sort())
  ) {
    blockers.push("guarded_dispatch_blockers_mismatch");
  }
  if (
    selection?.bound !== true ||
    value?.mutated !== true ||
    value?.retry_attempted !== false ||
    value?.publisher_threw !== false ||
    value?.publication !== null ||
    publisher?.no_safe_candidate !== true ||
    publisher?.qa_skipped_count !== 1 ||
    publisher?.candidates_tried !== 1 ||
    skipped.length !== 1 ||
    !Array.isArray(one?.failures) ||
    one.failures.length !== 1 ||
    one.failures[0] !== EXPECTED_QA_FAILURE
  ) {
    blockers.push("exact_pre_create_video_qa_refusal_proof_required");
  }
  if (
    !text(value?.change_window_id) ||
    outsideCadence?.schema_version !==
      "pulse-outside-cadence-authorisation-v1" ||
    outsideCadence?.one_shot !== true ||
    outsideCadence?.basis !== "explicit_operator_goal_authorisation" ||
    !SHA256_PATTERN.test(lower(outsideCadence?.binding_sha256)) ||
    lower(outsideCadence?.binding_sha256) !==
      fingerprintOutsideCadenceAuthorisation(outsideCadence)
  ) {
    blockers.push(
      "exact_guarded_change_window_and_outside_cadence_authority_required",
    );
  }
  if (
    sha256(JSON.stringify(stableValue(candidate?.evidence || {}))) !==
    sha256(
      JSON.stringify(stableValue(inspection.scheduled_evidence || {})),
    )
  ) {
    blockers.push("guarded_dispatch_scheduled_evidence_mismatch");
  }
  if (
    value?.safety?.database_mutated !== true ||
    value?.safety?.platforms_contacted !== true ||
    value?.safety?.oauth_or_tokens_mutated !== false ||
    value?.safety?.durable_oauth_or_token_mutated !== false ||
    refresh?.attempted !== false ||
    refresh?.succeeded !== false ||
    refresh?.failed !== false ||
    value?.safety?.uploader_override_used !== false ||
    value?.safety?.automatic_retry_performed !== false
  ) {
    blockers.push("zero_uploader_and_auth_telemetry_required");
  }
  return unique(blockers);
}

function confirmationBlockers(options, plan) {
  const blockers = [];
  for (const [actual, expected, code] of [
    [
      text(options.confirmStoryId),
      plan.story_id,
      "exact_story_confirmation_required",
    ],
    [
      String(options.confirmScheduledEventId ?? ""),
      String(plan.scheduled_event_id),
      "exact_scheduled_event_confirmation_required",
    ],
    [
      text(options.confirmDispatchIdempotencyKey),
      plan.dispatch_idempotency_key,
      "exact_dispatch_key_confirmation_required",
    ],
    [
      lower(options.confirmRequestFingerprint),
      plan.request_fingerprint,
      "exact_request_fingerprint_confirmation_required",
    ],
    [
      lower(options.confirmMediaSha256),
      plan.media_sha256,
      "exact_media_sha256_confirmation_required",
    ],
    [
      lower(options.confirmScriptSha256),
      plan.script_sha256,
      "exact_script_sha256_confirmation_required",
    ],
    [
      lower(options.confirmReviewManifestSha256),
      plan.review_manifest_sha256,
      "exact_review_manifest_sha256_confirmation_required",
    ],
    [
      lower(options.confirmRendererManifestSha256),
      plan.renderer_manifest_sha256,
      "exact_renderer_manifest_sha256_confirmation_required",
    ],
    [
      lower(options.confirmSourceEvidenceSha256),
      plan.source_evidence_sha256,
      "exact_source_evidence_sha256_confirmation_required",
    ],
    [
      lower(options.confirmGuardedDispatchResultSha256),
      plan.guarded_dispatch_result_sha256,
      "exact_guarded_dispatch_result_sha256_confirmation_required",
    ],
    [
      lower(options.confirmRightsLedgerSha256),
      plan.rights_ledger_sha256,
      "exact_rights_ledger_sha256_confirmation_required",
    ],
    [
      lower(options.confirmPublicationMetadataSha256),
      plan.publication_metadata_sha256,
      "exact_publication_metadata_sha256_confirmation_required",
    ],
  ]) {
    if (!actual || actual !== expected) blockers.push(code);
  }
  if (!text(options.actorId)) blockers.push("operator_actor_required");
  if (!text(options.reason)) blockers.push("operator_reason_required");
  if (
    !text(options.confirmActorId) ||
    text(options.confirmActorId) !== text(options.actorId)
  ) {
    blockers.push("exact_operator_actor_confirmation_required");
  }
  if (
    !text(options.confirmReason) ||
    text(options.confirmReason) !== text(options.reason)
  ) {
    blockers.push("exact_operator_reason_confirmation_required");
  }
  if (
    !text(options.confirmDatabasePath) ||
    !samePath(options.confirmDatabasePath, plan.database_path)
  ) {
    blockers.push("exact_database_path_confirmation_required");
  }
  if (
    !text(options.changeWindowId) ||
    !text(options.confirmChangeWindowId) ||
    text(options.changeWindowId) !== text(options.confirmChangeWindowId)
  ) {
    blockers.push("exact_change_window_confirmation_required");
  }
  if (
    text(options.changeWindowId) ===
    text(plan.guarded_dispatch_change_window_id)
  ) {
    blockers.push("repair_change_window_must_be_new");
  }
  return unique(blockers);
}

function boundaryFingerprint(inspection) {
  return sha256(
    JSON.stringify(
      stableValue({
        raw_story: inspection.raw_story || null,
        state: inspection.state || null,
        scheduled: inspection.scheduled || null,
        scheduled_evidence: inspection.scheduled_evidence || null,
        latest_lifecycle: inspection.latest_lifecycle || null,
        later_lifecycle_count: inspection.later_lifecycle_count,
        dispatch_ledger_count: inspection.dispatch_ledger_count,
        platform_post_count: inspection.platform_post_count,
        review_audit: inspection.review_audit || null,
        review_audit_evidence:
          inspection.review_audit_evidence || null,
        active_runtime_lease_count:
          inspection.active_runtime_lease_count,
        running_job_count: inspection.running_job_count,
        active_worker_count: inspection.active_worker_count,
      }),
    ),
  );
}

function historicalSafety(inspection, guarded) {
  if (!inspection || inspection.missing_tables?.length) {
    return {
      create_boundary_entered: null,
      external_object_created: null,
      auth_boundary_entered: null,
      uploader_invoked: null,
    };
  }
  const createBoundaryEntered =
    Number(inspection.later_lifecycle_count || 0) > 0 ||
    Number(inspection.dispatch_ledger_count || 0) > 0;
  const externalObjectCreated =
    Number(inspection.platform_post_count || 0) > 0 ||
    Boolean(text(inspection.state?.external_id)) ||
    Boolean(text(inspection.state?.external_url)) ||
    Boolean(text(inspection.story?.youtube_post_id)) ||
    Boolean(text(inspection.story?.youtube_url));
  const refresh =
    guarded?.value?.safety?.ephemeral_youtube_access_token_refresh;
  const authBoundaryEntered = guarded
    ? guarded.value?.safety?.oauth_or_tokens_mutated === true ||
      guarded.value?.safety?.durable_oauth_or_token_mutated === true ||
      refresh?.attempted === true ||
      refresh?.succeeded === true ||
      refresh?.failed === true
    : null;
  const publisher = guarded?.value?.publisher_result;
  const uploaderInvoked = guarded
    ? !(
        publisher?.no_safe_candidate === true &&
        publisher?.qa_skipped_count === 1 &&
        publisher?.qa_skipped?.[0]?.source === "video"
      )
    : null;
  return {
    create_boundary_entered: createBoundaryEntered,
    external_object_created: externalObjectCreated,
    auth_boundary_entered: authBoundaryEntered,
    uploader_invoked: uploaderInvoked,
  };
}

function buildResult({
  generatedAt,
  mode,
  verdict,
  mutated = false,
  blockers = [],
  plan = null,
  backup = null,
  repair = null,
  inspection = null,
  guarded = null,
  safetyUnknown = false,
} = {}) {
  const historical = safetyUnknown
    ? {
        create_boundary_entered: null,
        external_object_created: null,
        auth_boundary_entered: null,
        uploader_invoked: null,
      }
    : historicalSafety(inspection, guarded);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    generated_at: generatedAt || null,
    mode,
    verdict,
    mutated,
    blockers: unique(blockers),
    ...(plan || {}),
    backup: backup?.evidence || null,
    repair,
    safety: {
      ...historical,
      guarded_dispatch_reported_platform_contact:
        guarded?.value?.safety?.platforms_contacted === true,
      platform_calls_performed: false,
      oauth_or_tokens_mutated: false,
      secondary_platforms_contacted: false,
    },
  };
}

async function executeGovernedReviewedVideoQaRepair(options = {}) {
  const generatedDate = new Date(options.generatedAt || new Date());
  if (Number.isNaN(generatedDate.getTime())) {
    throw new Error("valid_generated_at_required");
  }
  const generatedAt = generatedDate.toISOString();
  const trustedCurrent = new Date(
    typeof options.nowImpl === "function"
      ? options.nowImpl()
      : new Date(),
  );
  if (Number.isNaN(trustedCurrent.getTime())) {
    throw new Error("trusted_current_time_invalid");
  }
  const trustedAt = trustedCurrent.toISOString();
  const databaseInput = text(options.databasePath || options.database);
  const storyId = text(options.storyId);
  if (!databaseInput || !storyId) {
    throw new Error("database_and_story_required");
  }
  const databasePath = path.resolve(databaseInput);
  const inspection = withReadOnlySqliteSnapshot(
    databasePath,
    (db) => inspectOpenDatabase(db, storyId, trustedAt),
    { DatabaseImpl: options.DatabaseImpl },
  );
  let blockers = inspectionBlockers(inspection, trustedAt);
  if (
    Math.abs(generatedDate.getTime() - trustedCurrent.getTime()) >
    GENERATED_AT_MAX_SKEW_MS
  ) {
    blockers.push("reviewed_video_qa_repair_generated_at_not_current");
  }

  const resolveRuntimeBuildInfo =
    options.resolveRuntimeBuildInfoImpl ||
    require("../runtime-build-info").resolveRuntimeBuildInfo;
  const build = resolveRuntimeBuildInfo({
    cwd: options.cwd || process.cwd(),
    env: {
      ...(options.env || process.env),
      DEPLOYMENT_MODE: "local",
    },
  });
  const runtimeCommit = lower(build?.commit_sha);
  const runtimeTreeClean =
    (options.isRuntimeTreeCleanImpl || isRuntimeTreeClean)(
      options.cwd || process.cwd(),
    ) === true;
  if (
    !FULL_COMMIT_PATTERN.test(runtimeCommit) ||
    lower(options.expectedSourceCommit) !== runtimeCommit
  ) {
    blockers.push("source_commit_mismatch");
  }
  if (
    !FULL_COMMIT_PATTERN.test(runtimeCommit) ||
    lower(options.expectedRuntimeCommit) !== runtimeCommit
  ) {
    blockers.push("runtime_commit_mismatch");
  }
  if (!runtimeTreeClean) blockers.push("runtime_worktree_must_be_clean");

  let guarded = null;
  try {
    guarded = (
      options.readGuardedDispatchResultImpl ||
      readGuardedDispatchResult
    )(options.guardedDispatchResultPath);
  } catch (error) {
    blockers.push(
      error?.code ||
        error?.message ||
        "guarded_dispatch_result_validation_failed",
    );
  }

  let scheduled = null;
  if (inspection.scheduled) {
    try {
      scheduled = scheduledDispatchFromInspection(inspection);
    } catch {
      blockers.push("scheduled_dispatch_evidence_invalid");
    }
  }

  let authority = null;
  let hashes = null;
  let videoQa = null;
  let reconciled = null;
  if (!blockers.length) {
    try {
      authority = await resolveGovernedReviewedContentQaAuthority({
        story: inspection.story,
        scheduledDispatch: scheduled,
        exactDispatchBinding: exactBindingFromInspection(inspection),
        resolveMediaPath: options.resolveMediaPath,
      });
      hashes = exactHashChain(inspection.story, scheduled, authority);
      blockers.push(...hashes.blockers);
      videoQa = await (options.runVideoQaImpl || runVideoQa)(
        authority.resolvedMediaPath,
      );
      reconciled = reconcileGovernedReviewedVideoQa(videoQa, authority);
      blockers.push(
        ...exactVideoQaBlockers(
          inspection.story,
          videoQa,
          reconciled,
        ),
      );
      blockers.push(
        ...guardedDispatchBlockers({
          guarded,
          inspection,
          scheduled,
          authority,
          hashes,
        }),
      );
    } catch (error) {
      blockers.push(
        ...(Array.isArray(error?.codes)
          ? error.codes
          : [
              error?.code ||
                error?.message ||
                "reviewed_video_qa_validation_failed",
            ]),
      );
    }
  }
  blockers.push(...environmentBlockers(options.env || process.env));

  const plan =
    inspection.story &&
    scheduled &&
    authority &&
    hashes &&
    guarded
      ? {
          generated_at: generatedAt,
          database_path: databasePath,
          story_id: inspection.story.id,
          channel_id: CHANNEL_ID,
          platform: PLATFORM,
          scheduled_event_id: Number(scheduled.event.id),
          scheduled_for: scheduled.scheduledFor,
          dispatch_idempotency_key: scheduled.idempotencyKey,
          request_fingerprint: scheduled.requestFingerprint,
          media_sha256: authority.mediaSha256,
          script_sha256: authority.scriptSha256,
          review_manifest_sha256: hashes.reviewManifestSha256,
          renderer_manifest_sha256:
            hashes.rendererManifestSha256,
          source_evidence_sha256: hashes.sourceEvidenceSha256,
          rights_ledger_sha256: hashes.rightsLedgerSha256,
          publication_metadata_sha256:
            hashes.publicationMetadataSha256,
          guarded_dispatch_result_path: guarded.path,
          guarded_dispatch_result_sha256: guarded.sha256,
          guarded_dispatch_change_window_id: text(
            guarded.value.change_window_id,
          ),
          outside_cadence_authorisation_id: text(
            guarded.value.outside_cadence_authorisation_id,
          ),
          reviewed_duration_seconds:
            authority.videoRuntime?.durationSeconds ?? null,
          reviewed_duration_band_id:
            authority.videoRuntime?.durationBandId ??
            authority.videoRuntime?.bandId ??
            null,
          qa_publish_error_persistence_shape:
            qaPublishErrorPersistenceShape(inspection.raw_story),
          qa_failures_before: inspection.story.qa_failures,
          qa_failures_resolved: reconciled?.resolved || [],
          boundary_fingerprint: boundaryFingerprint(inspection),
          source_commit: runtimeCommit || null,
          runtime_commit: runtimeCommit || null,
          runtime_tree_clean: runtimeTreeClean,
        }
      : null;

  const verifyBackup =
    options.verifyBackupEvidenceImpl || verifyBackupEvidence;
  let backup = null;
  try {
    backup = verifyBackup({
      evidencePath: options.backupEvidencePath,
      databasePath,
      generatedAt: trustedAt,
    });
  } catch (error) {
    backup = {
      verified: false,
      blockers: [
        error?.message || "backup_evidence_verification_failed",
      ],
    };
  }
  if (backup?.verified !== true) {
    blockers.push(
      ...(backup?.blockers?.length
        ? backup.blockers
        : ["valid_backup_evidence_required"]),
    );
  }
  blockers = unique(blockers);

  if (options.apply !== true) {
    return buildResult({
      generatedAt,
      mode: "DRY_RUN",
      verdict: blockers.length ? "HOLD" : "READY",
      blockers,
      plan,
      backup,
      inspection,
      guarded,
    });
  }
  if (plan) blockers.push(...confirmationBlockers(options, plan));
  else blockers.push("repair_plan_required");
  blockers = unique(blockers);
  if (blockers.length) {
    return buildResult({
      generatedAt,
      mode: "APPLY",
      verdict: "HOLD",
      blockers,
      plan,
      backup,
      inspection,
      guarded,
    });
  }

  const mutationBoundaryBlockers =
    options.sqliteMutationBoundaryBlockersImpl ||
    sqliteMutationBoundaryBlockers;
  const preOpenBoundaryBlockers = mutationBoundaryBlockers({
    databasePath,
    expectedSourceSha256:
      backup?.evidence?.source_database_sha256,
    allowSharedMemory: false,
  });
  if (preOpenBoundaryBlockers.length) {
    return buildResult({
      generatedAt,
      mode: "APPLY",
      verdict: "HOLD",
      blockers: preOpenBoundaryBlockers,
      plan,
      backup,
      inspection,
      guarded,
      safetyUnknown: true,
    });
  }

  const Database = options.DatabaseImpl || require("better-sqlite3");
  const db = new Database(databasePath, { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  let repair;
  try {
    repair = db
      .transaction(() => {
        const transactionBoundaryBlockers = mutationBoundaryBlockers({
          databasePath,
          expectedSourceSha256:
            backup?.evidence?.source_database_sha256,
          allowSharedMemory: true,
        });
        if (transactionBoundaryBlockers.length) {
          throw new Error(transactionBoundaryBlockers[0]);
        }
        const current = inspectOpenDatabase(db, storyId, trustedAt);
        const currentInspectionBlockers = inspectionBlockers(
          current,
          trustedAt,
        );
        if (currentInspectionBlockers.length) {
          throw new Error(currentInspectionBlockers[0]);
        }
        if (boundaryFingerprint(current) !== plan.boundary_fingerprint) {
          throw new Error(
            "reviewed_video_qa_repair_database_boundary_changed",
          );
        }
        if (
          hashFileSync(plan.guarded_dispatch_result_path) !==
          plan.guarded_dispatch_result_sha256
        ) {
          throw new Error(
            "reviewed_video_qa_repair_dispatch_proof_drift",
          );
        }
        const currentMediaPath = path.resolve(
          text(current.story.exported_path),
        );
        if (
          !fs.existsSync(currentMediaPath) ||
          hashFileSync(currentMediaPath) !== plan.media_sha256 ||
          sha256(String(current.story.full_script || "")) !==
            plan.script_sha256
        ) {
          throw new Error(
            "reviewed_video_qa_repair_media_or_script_drift",
          );
        }

        const governance = governanceFactory.bind(db);
        const decisionKey =
          `governed-reviewed-video-qa-repair:${storyId}:` +
          `${plan.scheduled_event_id}:` +
          `${plan.guarded_dispatch_result_sha256}:` +
          `${text(options.changeWindowId)}`;
        const sharedEvidence = {
          scheduled_event_id: plan.scheduled_event_id,
          dispatch_idempotency_key: plan.dispatch_idempotency_key,
          request_fingerprint: plan.request_fingerprint,
          media_sha256: plan.media_sha256,
          script_sha256: plan.script_sha256,
          review_manifest_sha256: plan.review_manifest_sha256,
          renderer_manifest_sha256: plan.renderer_manifest_sha256,
          source_evidence_sha256: plan.source_evidence_sha256,
          rights_ledger_sha256: plan.rights_ledger_sha256,
          publication_metadata_sha256:
            plan.publication_metadata_sha256,
          guarded_dispatch_result_sha256:
            plan.guarded_dispatch_result_sha256,
          guarded_dispatch_change_window_id:
            plan.guarded_dispatch_change_window_id,
          outside_cadence_authorisation_id:
            plan.outside_cadence_authorisation_id,
          source_commit: plan.source_commit,
          runtime_commit: plan.runtime_commit,
          runtime_tree_clean: plan.runtime_tree_clean,
          change_window_id: text(options.changeWindowId),
          backup_id: backup?.evidence?.backup_id || null,
          backup_sha256: backup?.evidence?.backup_sha256 || null,
          backup_evidence_file_sha256:
            backup?.evidence?.evidence_file_sha256 || null,
          source_database_sha256:
            backup?.evidence?.source_database_sha256 || null,
          qa_failures_resolved: plan.qa_failures_resolved,
          qa_publish_error_persistence_shape:
            plan.qa_publish_error_persistence_shape,
          create_boundary_entered: false,
          external_object_created: false,
          auth_boundary_entered: false,
          uploader_invoked: false,
        };
        const decision = governance.recordOperatorDecision({
          actorId: text(options.actorId),
          action: "repair_governed_reviewed_video_qa_refusal",
          targetType: "platform_publication",
          targetId: `${storyId}:${PLATFORM}`,
          decision: "APPROVED",
          reason: text(options.reason),
          evidence: sharedEvidence,
          idempotencyKey: `${decisionKey}:operator-decision`,
        });
        const cancellation =
          governance.cancelScheduledAdmissionBeforeDispatch({
            storyId,
            platform: PLATFORM,
            channelId: CHANNEL_ID,
            scheduledEventId: plan.scheduled_event_id,
            scheduledDispatchIdempotencyKey:
              plan.dispatch_idempotency_key,
            requestFingerprint: plan.request_fingerprint,
            actorId: text(options.actorId),
            operatorDecisionId: decision.id,
            now: trustedCurrent,
            evidence: sharedEvidence,
            idempotencyKey: `${decisionKey}:cancel-admission`,
          });
        const nextExtra = {
          ...parseObject(current.raw_story._extra),
          qa_failed: false,
          qa_failures: [],
          qa_failed_at: null,
          publish_error: null,
          governed_reviewed_video_qa_repair: {
            schema_version: RESULT_SCHEMA_VERSION,
            repaired_at: trustedAt,
            repaired_by: text(options.actorId),
            repair_reason: text(options.reason),
            cancellation_event_id: Number(cancellation.id),
            operator_decision_id: Number(decision.id),
            ...sharedEvidence,
          },
        };
        const update = db
          .prepare(
            `UPDATE stories
             SET publish_status = NULL,
                 publish_error = NULL,
                 updated_at = ?,
                 _extra = ?
             WHERE id = ?`,
          )
          .run(trustedAt, JSON.stringify(nextExtra), storyId);
        if (update.changes !== 1) {
          throw new Error(
            "reviewed_video_qa_repair_story_update_count_invalid",
          );
        }
        const after = inspectOpenDatabase(db, storyId, trustedAt);
        if (
          after.state?.lifecycle_state !==
            "ADMISSION_CANCELLED_BEFORE_DISPATCH" ||
          after.story?.qa_failed !== false ||
          after.story?.publish_status !== null ||
          text(after.raw_story?.publish_error) ||
          after.dispatch_ledger_count !== 0 ||
          after.platform_post_count !== 0 ||
          text(after.state?.external_id) ||
          text(after.state?.external_url) ||
          text(after.story?.youtube_post_id) ||
          text(after.story?.youtube_url)
        ) {
          throw new Error(
            "reviewed_video_qa_repair_postconditions_not_satisfied",
          );
        }
        return {
          operator_decision_id: Number(decision.id),
          cancellation_event_id: Number(cancellation.id),
          lifecycle_state:
            governance.getState(storyId, PLATFORM)?.lifecycle_state,
          qa_failure_cleared: true,
        };
      })
      .immediate();
  } catch (error) {
    return buildResult({
      generatedAt,
      mode: "APPLY",
      verdict: "ROLLED_BACK",
      blockers: [
        error?.message ||
          "reviewed_video_qa_repair_transaction_failed",
      ],
      plan,
      backup,
      repair: null,
      inspection,
      guarded,
      safetyUnknown: true,
    });
  } finally {
    db.close();
  }
  return buildResult({
    generatedAt,
    mode: "APPLY",
    verdict: "APPLIED",
    mutated: true,
    blockers: [],
    plan,
    backup,
    repair,
    inspection,
    guarded,
  });
}

module.exports = {
  EXPECTED_QA_FAILURE,
  RESULT_SCHEMA_VERSION,
  executeGovernedReviewedVideoQaRepair,
  readGuardedDispatchResult,
};
