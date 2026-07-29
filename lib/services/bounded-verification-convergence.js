"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const CONTRACT_SCHEMA =
  "pulse-bounded-verification-convergence-contract-v1";
const ATTEMPT_SCHEMA =
  "pulse-bounded-verification-convergence-attempt-v1";
const ATTEMPT_STARTED_SCHEMA =
  "pulse-bounded-verification-convergence-attempt-started-v1";
const FINAL_SCHEMA =
  "pulse-bounded-verification-convergence-final-v1";
const OUTCOMES = new Set(["CONFIRMED", "RETRYABLE", "TERMINAL"]);

/*
 * Executes at most one due remote read per invocation. Callers reschedule the
 * same durable job from retry_after_seconds; this module deliberately accepts
 * no upload, create, update or schedule-arm capability.
 *
 * Production integration contract: verifyReadOnly must be an official
 * asynchronous GET/list adapter, use read-only credentials and honour the
 * supplied AbortSignal. A JavaScript callback can retain arbitrary closure
 * authority and an infinitely blocking callback cannot be pre-empted inside
 * this process, so callers must never close over upload/arm/create clients. If
 * an adapter cannot meet that contract, isolate it in a killable worker or
 * child process before wiring it here.
 */
function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function text(value, code) {
  const result = String(value || "").trim();
  if (!result) fail(code);
  return result;
}

function dateIso(value, code) {
  const date = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);
  if (Number.isNaN(date.getTime())) fail(code);
  return date.toISOString();
}

function sha(value, code) {
  const result = text(value, code).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) fail(code);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function sealArtifact(value) {
  return {
    ...value,
    artifact_sha256: hash(value),
  };
}

function artifactHashValid(value) {
  if (!value || typeof value !== "object") return false;
  const body = { ...value };
  const claimed = String(body.artifact_sha256 || "").toLowerCase();
  delete body.artifact_sha256;
  return /^[a-f0-9]{64}$/.test(claimed) && hash(body) === claimed;
}

function normaliseIdentity(value = {}) {
  const storyId = text(
    value.story_id,
    "verification_convergence_story_id_required",
  );
  const selectedStoryId = text(
    value.selected_story_id,
    "verification_convergence_selected_story_id_required",
  );
  if (storyId !== selectedStoryId) {
    fail("verification_convergence_selected_story_mismatch");
  }
  const role = text(
    value.selected_role,
    "verification_convergence_selected_role_required",
  );
  if (!["primary", "reserve"].includes(role)) {
    fail("verification_convergence_selected_role_invalid");
  }
  const eventId = Number(value.scheduled_event_id);
  if (!Number.isInteger(eventId) || eventId < 1) {
    fail("verification_convergence_scheduled_event_id_invalid");
  }
  const promotionSha256 = value.promotion_sha256 == null
    ? null
    : sha(
        value.promotion_sha256,
        "verification_convergence_promotion_sha256_invalid",
      );
  if (role === "reserve" && !promotionSha256) {
    fail(
      "verification_convergence_reserve_promotion_sha256_required",
    );
  }
  if (role === "primary" && promotionSha256) {
    fail(
      "verification_convergence_primary_promotion_sha256_forbidden",
    );
  }
  return {
    story_id: storyId,
    selected_role: role,
    selected_story_id: selectedStoryId,
    scheduled_for: dateIso(
      value.scheduled_for,
      "verification_convergence_scheduled_for_invalid",
    ),
    scheduled_event_id: eventId,
    external_id: text(
      value.external_id,
      "verification_convergence_external_id_required",
    ),
    dispatch_idempotency_key: text(
      value.dispatch_idempotency_key,
      "verification_convergence_dispatch_key_required",
    ),
    request_fingerprint: sha(
      value.request_fingerprint,
      "verification_convergence_request_fingerprint_invalid",
    ),
    promotion_sha256: promotionSha256,
    runway_lock_sha256: sha(
      value.runway_lock_sha256,
      "verification_convergence_runway_lock_sha256_invalid",
    ),
    media_sha256: sha(
      value.media_sha256,
      "verification_convergence_media_sha256_invalid",
    ),
    script_sha256: sha(
      value.script_sha256,
      "verification_convergence_script_sha256_invalid",
    ),
  };
}

function configuration(input) {
  const phase = text(
    input.phase,
    "verification_convergence_phase_required",
  );
  if (!["T-60", "T0"].includes(phase)) {
    fail("verification_convergence_phase_invalid");
  }
  const startedAt = dateIso(
    input.startedAt,
    "verification_convergence_started_at_invalid",
  );
  const cutoffAt = dateIso(
    input.cutoffAt,
    "verification_convergence_cutoff_at_invalid",
  );
  if (Date.parse(cutoffAt) <= Date.parse(startedAt)) {
    fail("verification_convergence_cutoff_order_invalid");
  }
  const retryIntervalMs = Number(input.retryIntervalMs);
  if (
    !Number.isInteger(retryIntervalMs) ||
    retryIntervalMs < 1 ||
    retryIntervalMs > 15 * 60 * 1000
  ) {
    fail("verification_convergence_retry_interval_invalid");
  }
  const maxAttempts = Number(input.maxAttempts);
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 100
  ) {
    fail("verification_convergence_max_attempts_invalid");
  }
  const attemptTimeoutMs = Number(
    input.attemptTimeoutMs ?? 60_000,
  );
  if (
    !Number.isInteger(attemptTimeoutMs) ||
    attemptTimeoutMs < 1 ||
    attemptTimeoutMs > 5 * 60 * 1000
  ) {
    fail("verification_convergence_attempt_timeout_invalid");
  }
  if (typeof input.now !== "function") {
    fail("verification_convergence_live_clock_required");
  }
  if (typeof input.verifyReadOnly !== "function") {
    fail("verification_convergence_readonly_verifier_required");
  }
  if (
    input.classifyVerificationError != null &&
    typeof input.classifyVerificationError !== "function"
  ) {
    fail("verification_convergence_error_classifier_invalid");
  }
  const contract = {
    schema_version: CONTRACT_SCHEMA,
    phase,
    identity: normaliseIdentity(input.identity),
    started_at: startedAt,
    cutoff_at: cutoffAt,
    retry_interval_ms: retryIntervalMs,
    attempt_timeout_ms: attemptTimeoutMs,
    max_attempts: maxAttempts,
  };
  return {
    ...contract,
    stateDir: path.resolve(
      text(
        input.stateDir,
        "verification_convergence_state_dir_required",
      ),
    ),
    convergenceId: hash(contract),
    now: input.now,
    verifyReadOnly: input.verifyReadOnly,
    classifyVerificationError:
      input.classifyVerificationError || null,
  };
}

async function readJson(filePath, code) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail(code);
  }
}

// Publishing through a same-directory hard link gives create-new semantics:
// a crash leaves only an ignored temp file, while a race selects one complete
// immutable observation without replacing the winner.
async function publishNewJson(filePath, proposed) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await fs.open(temp, "wx");
    await handle.writeFile(`${JSON.stringify(proposed, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fs.link(temp, filePath);
      return { value: proposed, created: true };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        const failure = new Error(
          "verification_convergence_atomic_publish_failed",
        );
        failure.code =
          "verification_convergence_atomic_publish_failed";
        failure.filesystem_code =
          String(error?.code || "").trim() || null;
        failure.cause = error;
        throw failure;
      }
      return {
        value: await readJson(
          filePath,
          "verification_convergence_immutable_evidence_invalid",
        ),
        created: false,
      };
    }
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

function assertContractId(value, config) {
  if (
    value?.convergence_id &&
    value.convergence_id !== config.convergenceId
  ) {
    fail("verification_convergence_contract_conflict");
  }
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function assertFinal(value, config) {
  assertContractId(value, config);
  if (
    value?.schema_version !== FINAL_SCHEMA ||
    value?.convergence_id !== config.convergenceId ||
    value?.phase !== config.phase ||
    !sameJson(value?.identity, config.identity) ||
    value?.started_at !== config.started_at ||
    value?.cutoff_at !== config.cutoff_at ||
    value?.retry_interval_ms !== config.retry_interval_ms ||
    value?.attempt_timeout_ms !== config.attempt_timeout_ms ||
    value?.max_attempts !== config.max_attempts ||
    value?.verification_only !== true ||
    value?.catch_up_allowed !== false ||
    value?.publish_authority !== false ||
    (
      value?.attempt_count === 0
        ? value?.history_tail_sha256 !== null
        : !/^[a-f0-9]{64}$/.test(
            String(value?.history_tail_sha256 || ""),
          )
    ) ||
    !artifactHashValid(value) ||
    !["GREEN", "HOLD"].includes(value?.verdict)
  ) {
    fail("verification_convergence_final_binding_invalid");
  }
}

function assertAttempt(value, config, number) {
  assertContractId(value, config);
  const confirmedExternalId = String(
    value?.evidence?.external_id || "",
  ).trim();
  const startedAtMs = Date.parse(value?.started_at);
  const completedAtMs = Date.parse(value?.completed_at);
  const observedClockAtMs = Date.parse(
    value?.observed_clock_at,
  );
  const completedWithinCutoff =
    completedAtMs < Date.parse(config.cutoff_at);
  if (
    value?.schema_version !== ATTEMPT_SCHEMA ||
    value?.convergence_id !== config.convergenceId ||
    value?.phase !== config.phase ||
    !sameJson(value?.identity, config.identity) ||
    value?.attempt_number !== number ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(completedAtMs) ||
    !Number.isFinite(observedClockAtMs) ||
    completedAtMs < startedAtMs ||
    value?.completed_within_cutoff !== completedWithinCutoff ||
    value?.cutoff_at !== config.cutoff_at ||
    value?.retry_interval_ms !== config.retry_interval_ms ||
    value?.attempt_timeout_ms !== config.attempt_timeout_ms ||
    value?.max_attempts !== config.max_attempts ||
    value?.verification_only !== true ||
    value?.external_create_authority !== "none" ||
    value?.upload_authority !== false ||
    value?.schedule_arm_authority !== false ||
    !artifactHashValid(value) ||
    !OUTCOMES.has(value?.outcome) ||
    (
      value?.outcome === "CONFIRMED" &&
      confirmedExternalId !== config.identity.external_id
    )
  ) {
    fail("verification_convergence_attempt_binding_invalid");
  }
}

function assertStartedAttempt(
  value,
  config,
  number,
  previousAttemptSha256,
) {
  assertContractId(value, config);
  const startedAtMs = Date.parse(value?.started_at);
  const attemptExpiresAtMs = Date.parse(
    value?.attempt_expires_at,
  );
  const expectedAttemptExpiresAtMs = Math.min(
    startedAtMs + config.attempt_timeout_ms,
    Date.parse(config.cutoff_at),
  );
  if (
    value?.schema_version !== ATTEMPT_STARTED_SCHEMA ||
    value?.convergence_id !== config.convergenceId ||
    value?.phase !== config.phase ||
    !sameJson(value?.identity, config.identity) ||
    value?.attempt_number !== number ||
    value?.previous_attempt_sha256 !== previousAttemptSha256 ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(attemptExpiresAtMs) ||
    startedAtMs < Date.parse(config.started_at) ||
    startedAtMs >= Date.parse(config.cutoff_at) ||
    attemptExpiresAtMs !== expectedAttemptExpiresAtMs ||
    value?.cutoff_at !== config.cutoff_at ||
    value?.retry_interval_ms !== config.retry_interval_ms ||
    value?.attempt_timeout_ms !== config.attempt_timeout_ms ||
    value?.max_attempts !== config.max_attempts ||
    value?.verification_only !== true ||
    value?.external_create_authority !== "none" ||
    value?.upload_authority !== false ||
    value?.schedule_arm_authority !== false ||
    !artifactHashValid(value)
  ) {
    fail("verification_convergence_attempt_started_binding_invalid");
  }
}

function attemptFile(config, number, suffix = ".json") {
  return path.join(
    config.stateDir,
    "attempts",
    `attempt-${String(number).padStart(6, "0")}${suffix}`,
  );
}

async function readStartedAttempt(
  config,
  number,
  previousAttemptSha256,
) {
  const value = await readJson(
    attemptFile(config, number, ".started.json"),
    "verification_convergence_attempt_started_evidence_invalid",
  );
  if (value) {
    assertStartedAttempt(
      value,
      config,
      number,
      previousAttemptSha256,
    );
  }
  return value;
}

async function attempts(config) {
  const dir = path.join(config.stateDir, "attempts");
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  names = names
    .filter((name) => /^attempt-\d{6}\.json$/.test(name))
    .sort();
  const result = [];
  let previousAttemptSha256 = null;
  for (let index = 0; index < names.length; index += 1) {
    const number = index + 1;
    const name = `attempt-${String(number).padStart(6, "0")}.json`;
    if (names[index] !== name) {
      fail("verification_convergence_attempt_sequence_invalid");
    }
    const value = await readJson(
      attemptFile(config, number),
      "verification_convergence_attempt_evidence_invalid",
    );
    assertAttempt(value, config, number);
    const started = await readStartedAttempt(
      config,
      number,
      previousAttemptSha256,
    );
    if (
      !started ||
      value.attempt_started_sha256 !== started.artifact_sha256
    ) {
      fail("verification_convergence_attempt_started_evidence_invalid");
    }
    result.push(value);
    previousAttemptSha256 = value.artifact_sha256;
  }
  return result;
}

function outcome(value) {
  const status = text(
    value?.outcome,
    "verification_convergence_outcome_required",
  ).toUpperCase();
  if (!OUTCOMES.has(status)) {
    fail("verification_convergence_outcome_invalid");
  }
  let evidence = null;
  if (value?.evidence != null) {
    try {
      evidence = JSON.parse(JSON.stringify(value.evidence));
    } catch {
      fail("verification_convergence_evidence_not_json");
    }
  }
  return {
    outcome: status,
    reason: text(
      value?.reason,
      "verification_convergence_reason_required",
    ),
    blockers: Array.isArray(value?.blockers)
      ? [...new Set(
          value.blockers.map((item) => String(item).trim()).filter(Boolean),
        )]
      : [],
    evidence,
  };
}

function bindConfirmedExternalId(observed, identity) {
  if (observed.outcome !== "CONFIRMED") return observed;
  const observedExternalId = String(
    observed.evidence?.external_id || "",
  ).trim();
  if (observedExternalId === identity.external_id) return observed;
  const reason =
    "verification_convergence_confirmed_external_id_mismatch";
  return {
    outcome: "TERMINAL",
    reason,
    blockers: [reason],
    evidence: {
      expected_external_id: identity.external_id,
      observed_external_id: observedExternalId || null,
      verifier_evidence: observed.evidence,
    },
  };
}

function retry(config, attemptNumber, retryAt = null) {
  return {
    required: Boolean(retryAt),
    retry_at: retryAt,
    cutoff_at: config.cutoff_at,
    delay_ms: retryAt ? config.retry_interval_ms : null,
    next_attempt_number: retryAt ? attemptNumber + 1 : null,
  };
}

function retrySeconds(value, currentAt) {
  if (value?.required !== true || !value.retry_at) return null;
  return Math.max(
    1,
    Math.ceil(
      (Date.parse(value.retry_at) - Date.parse(currentAt)) / 1000,
    ),
  );
}

function finalBase(
  config,
  finalisedAt,
  attemptCount,
  historyTailSha256,
) {
  return {
    schema_version: FINAL_SCHEMA,
    convergence_id: config.convergenceId,
    phase: config.phase,
    identity: config.identity,
    started_at: config.started_at,
    cutoff_at: config.cutoff_at,
    retry_interval_ms: config.retry_interval_ms,
    attempt_timeout_ms: config.attempt_timeout_ms,
    max_attempts: config.max_attempts,
    finalised_at: finalisedAt,
    attempt_count: attemptCount,
    history_tail_sha256: historyTailSha256,
    verification_only: true,
    catch_up_allowed: false,
    publish_authority: false,
    retry: retry(config, attemptCount),
  };
}

function finalFromAttempt(config, attempt) {
  const cutoffMissed =
    Date.parse(attempt.completed_at) >= Date.parse(config.cutoff_at);
  const limitReached =
    attempt.outcome === "RETRYABLE" &&
    attempt.attempt_number >= config.max_attempts;
  const retryWindowExhausted =
    attempt.outcome === "RETRYABLE" &&
    attempt.retry?.required !== true &&
    !cutoffMissed &&
    !limitReached;
  const green =
    attempt.outcome === "CONFIRMED" &&
    attempt.completed_within_cutoff === true &&
    Date.parse(attempt.completed_at) < Date.parse(config.cutoff_at);
  let reason = attempt.reason;
  let blockers = attempt.blockers.length
    ? attempt.blockers
    : [attempt.reason];
  if (cutoffMissed) {
    reason = "verification_convergence_cutoff_reached";
    blockers = [reason];
  } else if (limitReached) {
    reason = "verification_convergence_attempt_limit_reached";
    blockers = [...new Set([...blockers, reason])];
  } else if (retryWindowExhausted) {
    reason = "verification_convergence_retry_window_exhausted";
    blockers = [...new Set([...blockers, reason])];
  }
  return {
    ...finalBase(
      config,
      attempt.completed_at,
      attempt.attempt_number,
      attempt.artifact_sha256,
    ),
    verdict: green ? "GREEN" : "HOLD",
    reason,
    blockers: green ? [] : blockers,
    decisive_attempt_number: attempt.attempt_number,
    decisive_attempt_evidence:
      `attempts/attempt-${String(attempt.attempt_number).padStart(6, "0")}.json`,
    decisive_attempt_sha256: attempt.artifact_sha256,
    winning_attempt_number: green ? attempt.attempt_number : null,
    winning_attempt_evidence: green
      ? `attempts/attempt-${String(attempt.attempt_number).padStart(6, "0")}.json`
      : null,
  };
}

function deadlineFinal(config, now, count, historyTailSha256) {
  const reason = "verification_convergence_cutoff_reached";
  return {
    ...finalBase(config, now, count, historyTailSha256),
    verdict: "HOLD",
    reason,
    blockers: [reason],
    decisive_attempt_number: null,
    decisive_attempt_evidence: null,
    decisive_attempt_sha256: null,
    winning_attempt_number: null,
    winning_attempt_evidence: null,
  };
}

async function validateFinalEvidence(value, config) {
  assertFinal(value, config);
  let history;
  try {
    history = await attempts(config);
  } catch {
    fail("verification_convergence_final_attempt_evidence_invalid");
  }
  let expected;
  if (Number.isInteger(value.decisive_attempt_number)) {
    const attempt = history[value.decisive_attempt_number - 1];
    const expectedPath =
      `attempts/attempt-${String(value.decisive_attempt_number).padStart(6, "0")}.json`;
    if (
      !attempt ||
      value.decisive_attempt_evidence !== expectedPath ||
      value.decisive_attempt_sha256 !== attempt.artifact_sha256
    ) {
      fail("verification_convergence_final_attempt_evidence_invalid");
    }
    expected = sealArtifact(finalFromAttempt(config, attempt));
  } else {
    expected = sealArtifact(
      deadlineFinal(
        config,
        value.finalised_at,
        history.length,
        history.at(-1)?.artifact_sha256 || null,
      ),
    );
  }
  if (expected.artifact_sha256 !== value.artifact_sha256) {
    fail("verification_convergence_final_binding_invalid");
  }
}

async function persistFinal(config, finalPath, proposed, extra = {}) {
  const stored = await publishNewJson(
    finalPath,
    sealArtifact(proposed),
  );
  await validateFinalEvidence(stored.value, config);
  return {
    status: stored.value.verdict,
    terminal: true,
    reused: !stored.created,
    final: stored.value,
    final_path: finalPath,
    retry: stored.value.retry,
    ...extra,
  };
}

function safeErrorCode(error) {
  const code = String(error?.code || "").trim();
  return /^[a-z0-9_.:-]{1,128}$/i.test(code)
    ? code
    : "verification_readonly_check_failed";
}

function attemptStartedRecord(
  config,
  number,
  startedAt,
  previousAttemptSha256,
) {
  const expiresAt = new Date(
    Math.min(
      Date.parse(startedAt) + config.attempt_timeout_ms,
      Date.parse(config.cutoff_at),
    ),
  ).toISOString();
  return sealArtifact({
    schema_version: ATTEMPT_STARTED_SCHEMA,
    convergence_id: config.convergenceId,
    phase: config.phase,
    identity: config.identity,
    attempt_number: number,
    previous_attempt_sha256: previousAttemptSha256,
    started_at: startedAt,
    attempt_expires_at: expiresAt,
    cutoff_at: config.cutoff_at,
    retry_interval_ms: config.retry_interval_ms,
    attempt_timeout_ms: config.attempt_timeout_ms,
    max_attempts: config.max_attempts,
    verification_only: true,
    external_create_authority: "none",
    upload_authority: false,
    schedule_arm_authority: false,
  });
}

function attemptRecord({
  config,
  started,
  completedAt,
  observedClockAt,
  observed,
  clockRegressed = false,
  timedOut = false,
  interrupted = false,
}) {
  const proposedRetryAt = new Date(
    Date.parse(completedAt) + config.retry_interval_ms,
  ).toISOString();
  const canRetry =
    observed.outcome === "RETRYABLE" &&
    started.attempt_number < config.max_attempts &&
    Date.parse(proposedRetryAt) < Date.parse(config.cutoff_at);
  return sealArtifact({
    schema_version: ATTEMPT_SCHEMA,
    convergence_id: config.convergenceId,
    phase: config.phase,
    identity: config.identity,
    attempt_number: started.attempt_number,
    started_at: started.started_at,
    attempt_started_sha256: started.artifact_sha256,
    completed_at: completedAt,
    observed_clock_at: observedClockAt,
    clock_regressed: clockRegressed,
    timed_out: timedOut,
    interrupted,
    completed_within_cutoff:
      Date.parse(completedAt) < Date.parse(config.cutoff_at),
    cutoff_at: config.cutoff_at,
    retry_interval_ms: config.retry_interval_ms,
    attempt_timeout_ms: config.attempt_timeout_ms,
    max_attempts: config.max_attempts,
    ...observed,
    verification_only: true,
    external_create_authority: "none",
    upload_authority: false,
    schedule_arm_authority: false,
    retry: retry(
      config,
      started.attempt_number,
      canRetry ? proposedRetryAt : null,
    ),
  });
}

function waitingForStartedAttempt(config, started, currentAt, finalPath) {
  const schedule = {
    required: true,
    retry_at: started.attempt_expires_at,
    cutoff_at: config.cutoff_at,
    delay_ms: Math.max(
      1,
      Date.parse(started.attempt_expires_at) - Date.parse(currentAt),
    ),
    next_attempt_number: started.attempt_number,
  };
  return {
    status: "WAITING",
    reason: "verification_convergence_attempt_in_progress",
    terminal: false,
    reused: true,
    final: null,
    final_path: finalPath,
    retry: schedule,
    retry_after_seconds: retrySeconds(schedule, currentAt),
  };
}

async function resultFromCanonicalAttempt(
  config,
  finalPath,
  fallbackAttempt,
) {
  const existing = await readJson(
    finalPath,
    "verification_convergence_final_invalid",
  );
  if (existing) {
    await validateFinalEvidence(existing, config);
    return {
      status: existing.verdict,
      terminal: true,
      reused: true,
      final: existing,
      final_path: finalPath,
      retry: existing.retry,
    };
  }
  const history = await attempts(config);
  const inProgress = await readStartedAttempt(
    config,
    history.length + 1,
    history.at(-1)?.artifact_sha256 || null,
  );
  if (inProgress) {
    return waitingForStartedAttempt(
      config,
      inProgress,
      dateIso(
        config.now(),
        "verification_convergence_live_clock_invalid",
      ),
      finalPath,
    );
  }
  const canonicalAttempt = history.at(-1) || fallbackAttempt;
  assertAttempt(
    canonicalAttempt,
    config,
    canonicalAttempt.attempt_number,
  );
  const canonicalPath = attemptFile(
    config,
    canonicalAttempt.attempt_number,
  );
  if (
    canonicalAttempt.outcome === "RETRYABLE" &&
    canonicalAttempt.retry?.required === true
  ) {
    return {
      status: "RETRY_SCHEDULED",
      terminal: false,
      reused:
        canonicalAttempt.artifact_sha256 !==
        fallbackAttempt.artifact_sha256,
      final: null,
      final_path: finalPath,
      attempt_path: canonicalPath,
      attempt: canonicalAttempt,
      retry: canonicalAttempt.retry,
      retry_after_seconds: retrySeconds(
        canonicalAttempt.retry,
        canonicalAttempt.completed_at,
      ),
    };
  }
  return persistFinal(
    config,
    finalPath,
    finalFromAttempt(config, canonicalAttempt),
    { attempt_path: canonicalPath },
  );
}

async function runBoundedVerificationConvergence(input = {}) {
  const config = configuration(input);
  const finalPath = path.join(config.stateDir, "final.json");
  const existing = await readJson(
    finalPath,
    "verification_convergence_final_invalid",
  );
  if (existing) {
    await validateFinalEvidence(existing, config);
    return {
      status: existing.verdict,
      terminal: true,
      reused: true,
      final: existing,
      final_path: finalPath,
      retry: existing.retry,
    };
  }

  let history = await attempts(config);
  let previous = history.at(-1) || null;
  const currentAt = dateIso(
    config.now(),
    "verification_convergence_live_clock_invalid",
  );
  const interruptedStart = await readStartedAttempt(
    config,
    history.length + 1,
    history.at(-1)?.artifact_sha256 || null,
  );
  if (interruptedStart) {
    if (
      Date.parse(currentAt) <
      Date.parse(interruptedStart.attempt_expires_at)
    ) {
      return waitingForStartedAttempt(
        config,
        interruptedStart,
        currentAt,
        finalPath,
      );
    }
    const interrupted = attemptRecord({
      config,
      started: interruptedStart,
      completedAt: currentAt,
      observedClockAt: currentAt,
      observed: {
        outcome: "RETRYABLE",
        reason: "verification_convergence_attempt_interrupted",
        blockers: [
          "verification_convergence_attempt_interrupted",
        ],
        evidence: {
          attempt_started_sha256:
            interruptedStart.artifact_sha256,
          attempt_expired_at:
            interruptedStart.attempt_expires_at,
        },
      },
      interrupted: true,
    });
    const storedInterrupted = await publishNewJson(
      attemptFile(config, interruptedStart.attempt_number),
      interrupted,
    );
    assertAttempt(
      storedInterrupted.value,
      config,
      interruptedStart.attempt_number,
    );
    return resultFromCanonicalAttempt(
      config,
      finalPath,
      storedInterrupted.value,
    );
  }

  const recoverableFinal =
    previous &&
    (
      previous.outcome !== "RETRYABLE" ||
      previous.retry?.required !== true
    );
  if (recoverableFinal) {
    const recovered = await persistFinal(
      config,
      finalPath,
      finalFromAttempt(config, previous),
      { recovered_from_attempt: true },
    );
    return { ...recovered, reused: true };
  }

  if (Date.parse(currentAt) < Date.parse(config.started_at)) {
    const schedule = {
      required: true,
      retry_at: config.started_at,
      cutoff_at: config.cutoff_at,
      delay_ms: Date.parse(config.started_at) - Date.parse(currentAt),
      next_attempt_number: history.length + 1,
    };
    return {
      status: "WAITING",
      terminal: false,
      reused: history.length > 0,
      final: null,
      final_path: finalPath,
      retry: schedule,
      retry_after_seconds: retrySeconds(schedule, currentAt),
    };
  }

  if (Date.parse(currentAt) >= Date.parse(config.cutoff_at)) {
    return persistFinal(
      config,
      finalPath,
      deadlineFinal(
        config,
        currentAt,
        history.length,
        history.at(-1)?.artifact_sha256 || null,
      ),
    );
  }

  if (
    previous?.retry?.required === true &&
    Date.parse(currentAt) < Date.parse(previous.retry.retry_at)
  ) {
    return {
      status: "WAITING",
      terminal: false,
      reused: true,
      final: null,
      final_path: finalPath,
      retry: previous.retry,
      retry_after_seconds: retrySeconds(previous.retry, currentAt),
    };
  }

  const attemptNumber = history.length + 1;
  const proposedStart = attemptStartedRecord(
    config,
    attemptNumber,
    currentAt,
    previous?.artifact_sha256 || null,
  );
  const claimed = await publishNewJson(
    attemptFile(config, attemptNumber, ".started.json"),
    proposedStart,
  );
  assertStartedAttempt(
    claimed.value,
    config,
    attemptNumber,
    previous?.artifact_sha256 || null,
  );
  if (!claimed.created) {
    const completed = await readJson(
      attemptFile(config, attemptNumber),
      "verification_convergence_attempt_evidence_invalid",
    );
    if (completed) {
      assertAttempt(completed, config, attemptNumber);
      return resultFromCanonicalAttempt(
        config,
        finalPath,
        completed,
      );
    }
    return waitingForStartedAttempt(
      config,
      claimed.value,
      currentAt,
      finalPath,
    );
  }
  const abortController = new AbortController();
  const context = Object.freeze({
    schema_version: "pulse-bounded-verification-readonly-context-v1",
    phase: config.phase,
    identity: Object.freeze({ ...config.identity }),
    attempt_number: attemptNumber,
    started_at: currentAt,
    attempt_expires_at: claimed.value.attempt_expires_at,
    cutoff_at: config.cutoff_at,
    signal: abortController.signal,
    verification_only: true,
    external_create_authority: "none",
    upload_authority: false,
    schedule_arm_authority: false,
  });
  const monotonicAttemptStartedAt = process.hrtime.bigint();
  const attemptBudgetMs = Math.max(
    1,
    Date.parse(claimed.value.attempt_expires_at) -
      Date.parse(currentAt),
  );
  let timeoutHandle;
  const timeoutTask = new Promise((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve({ timedOut: true, value: null }),
      attemptBudgetMs,
    );
  });
  // Arm the bound before entering the adapter. Official adapters must remain
  // asynchronous and honour this AbortSignal; the live-clock check below also
  // rejects a finite event-loop stall that returns after the attempt deadline.
  const verificationTask = Promise.resolve().then(async () => {
    try {
      return {
        timedOut: false,
        value: await config.verifyReadOnly(context),
      };
    } catch (error) {
      const code = safeErrorCode(error);
      return {
        timedOut: false,
        value: config.classifyVerificationError
          ? await config.classifyVerificationError(error, context)
          : {
              outcome: "TERMINAL",
              reason: code,
              blockers: [code],
              evidence: { error_code: code },
            },
      };
    }
  });
  const bounded = await Promise.race([
    verificationTask,
    timeoutTask,
  ]);
  clearTimeout(timeoutHandle);
  let observed;
  let observedClockAt;
  let timedOut = bounded.timedOut;
  if (bounded.timedOut) {
    abortController.abort(
      new Error("verification_convergence_attempt_timed_out"),
    );
    observed = {
      outcome: "RETRYABLE",
      reason: "verification_convergence_attempt_timed_out",
      blockers: ["verification_convergence_attempt_timed_out"],
      evidence: {
        attempt_expires_at: claimed.value.attempt_expires_at,
      },
    };
    observedClockAt = claimed.value.attempt_expires_at;
  } else {
    observed = outcome(bounded.value);
    observedClockAt = dateIso(
      config.now(),
      "verification_convergence_live_clock_invalid",
    );
    const monotonicElapsedMs =
      Number(process.hrtime.bigint() - monotonicAttemptStartedAt) /
      1_000_000;
    if (
      monotonicElapsedMs >= attemptBudgetMs ||
      Date.parse(observedClockAt) >=
      Date.parse(claimed.value.attempt_expires_at)
    ) {
      timedOut = true;
      abortController.abort(
        new Error("verification_convergence_attempt_timed_out"),
      );
      observed = {
        outcome: "RETRYABLE",
        reason: "verification_convergence_attempt_timed_out",
        blockers: ["verification_convergence_attempt_timed_out"],
        evidence: {
          attempt_expires_at:
            claimed.value.attempt_expires_at,
          elapsed_ms: Math.ceil(monotonicElapsedMs),
          late_verifier_outcome: observed,
        },
      };
    }
  }
  const clockRegressed =
    Date.parse(observedClockAt) < Date.parse(currentAt);
  const completedAt = clockRegressed
    ? currentAt
    : observedClockAt;
  if (clockRegressed) {
    observed = {
      outcome: "TERMINAL",
      reason: "verification_convergence_clock_regressed",
      blockers: ["verification_convergence_clock_regressed"],
      evidence: {
        observed_clock_at: observedClockAt,
        verifier_outcome: observed,
      },
    };
  }
  observed = bindConfirmedExternalId(observed, config.identity);
  const record = attemptRecord({
    config,
    started: claimed.value,
    completedAt,
    observedClockAt,
    observed,
    clockRegressed,
    timedOut,
  });
  const attemptPath = attemptFile(config, attemptNumber);
  const stored = await publishNewJson(attemptPath, record);
  assertAttempt(stored.value, config, attemptNumber);
  return resultFromCanonicalAttempt(
    config,
    finalPath,
    stored.value,
  );
}

module.exports = { runBoundedVerificationConvergence };
