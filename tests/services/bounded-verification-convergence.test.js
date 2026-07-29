"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  runBoundedVerificationConvergence,
} = require("../../lib/services/bounded-verification-convergence");

const SHA = Object.freeze({
  request: "1".repeat(64),
  lock: "2".repeat(64),
  media: "3".repeat(64),
  script: "4".repeat(64),
});

function exactIdentity(overrides = {}) {
  return {
    story_id: "story-primary",
    selected_role: "primary",
    selected_story_id: "story-primary",
    scheduled_for: "2026-07-29T19:00:00.000Z",
    scheduled_event_id: 701,
    external_id: "yt-primary",
    dispatch_idempotency_key: "publish:youtube:story-primary",
    request_fingerprint: SHA.request,
    promotion_sha256: null,
    runway_lock_sha256: SHA.lock,
    media_sha256: SHA.media,
    script_sha256: SHA.script,
    ...overrides,
  };
}

async function temporaryStateDir(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-verification-convergence-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
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

function rehashArtifact(value) {
  const body = structuredClone(value);
  delete body.artifact_sha256;
  return {
    ...body,
    artifact_sha256: crypto
      .createHash("sha256")
      .update(JSON.stringify(canonical(body)))
      .digest("hex"),
  };
}

test("a confirmed read-only verification creates one append-only attempt and one replayable GREEN final", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let calls = 0;
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 15_000,
    maxAttempts: 4,
    now: () => new Date("2026-07-29T19:00:05.000Z"),
    verifyReadOnly: async (context) => {
      calls += 1;
      assert.equal(context.verification_only, true);
      assert.equal(context.external_create_authority, "none");
      assert.equal(context.upload_authority, false);
      assert.equal(context.schedule_arm_authority, false);
      assert.equal("upload" in context, false);
      assert.equal("arm" in context, false);
      return {
        outcome: "CONFIRMED",
        reason: "youtube_public_processed",
        evidence: {
          external_id: "yt-primary",
          privacy_status: "public",
          upload_status: "processed",
        },
      };
    },
  };

  const first = await runBoundedVerificationConvergence(options);
  const replay = await runBoundedVerificationConvergence({
    ...options,
    verifyReadOnly: async () => {
      throw new Error("replay_must_not_reverify");
    },
  });

  assert.equal(calls, 1);
  assert.equal(first.status, "GREEN");
  assert.equal(first.final.verdict, "GREEN");
  assert.equal(first.final.attempt_count, 1);
  assert.equal(first.final.winning_attempt_number, 1);
  assert.equal(first.final.retry.required, false);
  assert.equal(first.reused, false);
  assert.equal(replay.status, "GREEN");
  assert.equal(replay.reused, true);
  assert.equal(replay.final.convergence_id, first.final.convergence_id);

  const attempt = JSON.parse(
    await fs.readFile(
      path.join(stateDir, "attempts", "attempt-000001.json"),
      "utf8",
    ),
  );
  const final = JSON.parse(
    await fs.readFile(path.join(stateDir, "final.json"), "utf8"),
  );
  assert.equal(attempt.outcome, "CONFIRMED");
  assert.equal(attempt.verification_only, true);
  assert.equal(attempt.retry.required, false);
  assert.deepEqual(final, first.final);
});

test("a retryable observation schedules an explicit retry and only re-verifies when the live clock reaches it", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T18:00:05.000Z");
  let calls = 0;
  const options = {
    phase: "T-60",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T18:00:00.000Z",
    cutoffAt: "2026-07-29T18:10:00.000Z",
    retryIntervalMs: 15_000,
    maxAttempts: 4,
    now: () => new Date(clock),
    verifyReadOnly: async ({ attempt_number: attemptNumber }) => {
      calls += 1;
      return attemptNumber === 1
        ? {
            outcome: "RETRYABLE",
            reason: "youtube_upload_processing",
            blockers: ["youtube_upload_not_processed"],
            evidence: { upload_status: "uploaded" },
          }
        : {
            outcome: "CONFIRMED",
            reason: "youtube_private_unscheduled_processed",
            evidence: {
              external_id: "yt-primary",
              upload_status: "processed",
            },
          };
    },
  };

  const first = await runBoundedVerificationConvergence(options);
  assert.equal(first.status, "RETRY_SCHEDULED");
  assert.equal(first.terminal, false);
  assert.deepEqual(first.retry, {
    required: true,
    retry_at: "2026-07-29T18:00:20.000Z",
    cutoff_at: "2026-07-29T18:10:00.000Z",
    delay_ms: 15_000,
    next_attempt_number: 2,
  });
  assert.equal(first.retry_after_seconds, 15);
  assert.equal(calls, 1);
  await assert.rejects(
    fs.access(path.join(stateDir, "final.json")),
    { code: "ENOENT" },
  );

  clock = new Date("2026-07-29T18:00:19.999Z");
  const waiting = await runBoundedVerificationConvergence(options);
  assert.equal(waiting.status, "WAITING");
  assert.equal(waiting.retry.retry_at, first.retry.retry_at);
  assert.equal(waiting.retry_after_seconds, 1);
  assert.equal(calls, 1);

  clock = new Date("2026-07-29T18:00:20.000Z");
  const second = await runBoundedVerificationConvergence(options);
  assert.equal(second.status, "GREEN");
  assert.equal(second.final.attempt_count, 2);
  assert.equal(second.final.winning_attempt_number, 2);
  assert.equal(calls, 2);

  const attempts = (
    await fs.readdir(path.join(stateDir, "attempts"))
  ).sort();
  assert.deepEqual(attempts, [
    "attempt-000001.json",
    "attempt-000001.started.json",
    "attempt-000002.json",
    "attempt-000002.started.json",
  ]);
});

test("the live cutoff creates a canonical terminal HOLD without invoking verification", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let calls = 0;
  const result = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 15_000,
    maxAttempts: 4,
    now: () => new Date("2026-07-29T19:15:00.000Z"),
    verifyReadOnly: async () => {
      calls += 1;
      return {
        outcome: "CONFIRMED",
        reason: "too_late",
        evidence: { external_id: "yt-primary" },
      };
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.status, "HOLD");
  assert.equal(result.final.verdict, "HOLD");
  assert.equal(
    result.final.reason,
    "verification_convergence_cutoff_reached",
  );
  assert.deepEqual(result.final.blockers, [
    "verification_convergence_cutoff_reached",
  ]);
  assert.equal(result.final.attempt_count, 0);
  assert.equal(result.final.retry.required, false);
  assert.equal(result.final.catch_up_allowed, false);
  await assert.rejects(
    fs.access(path.join(stateDir, "attempts")),
    { code: "ENOENT" },
  );
});

test("a verification that completes at the cutoff is evidenced but cannot turn the final checkpoint GREEN", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T19:14:59.000Z");
  const result = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 1_000,
    maxAttempts: 4,
    now: () => new Date(clock),
    verifyReadOnly: async () => {
      clock = new Date("2026-07-29T19:15:00.000Z");
      return {
        outcome: "CONFIRMED",
        reason: "youtube_public_processed",
        evidence: {
          external_id: "yt-primary",
          upload_status: "processed",
        },
      };
    },
  });

  assert.equal(result.status, "HOLD");
  assert.equal(
    result.final.reason,
    "verification_convergence_cutoff_reached",
  );
  assert.equal(result.final.attempt_count, 1);
  assert.equal(result.final.winning_attempt_number, null);
  const attempt = JSON.parse(
    await fs.readFile(
      path.join(stateDir, "attempts", "attempt-000001.json"),
      "utf8",
    ),
  );
  assert.equal(attempt.outcome, "RETRYABLE");
  assert.equal(attempt.timed_out, true);
  assert.equal(attempt.completed_within_cutoff, false);

  const replay = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 1_000,
    maxAttempts: 4,
    now: () => new Date("2026-07-29T19:30:00.000Z"),
    verifyReadOnly: async () => {
      throw new Error("late_final_replay_must_not_verify");
    },
  });
  assert.equal(replay.status, "HOLD");
  assert.equal(replay.reused, true);
});

test("the attempt budget terminates persistent processing lag with one canonical HOLD", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T18:00:00.000Z");
  const options = {
    phase: "T-60",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T18:00:00.000Z",
    cutoffAt: "2026-07-29T18:10:00.000Z",
    retryIntervalMs: 5_000,
    maxAttempts: 2,
    now: () => new Date(clock),
    verifyReadOnly: async () => ({
      outcome: "RETRYABLE",
      reason: "youtube_upload_processing",
      blockers: ["youtube_upload_not_processed"],
      evidence: { upload_status: "uploaded" },
    }),
  };

  const first = await runBoundedVerificationConvergence(options);
  assert.equal(first.status, "RETRY_SCHEDULED");

  clock = new Date(first.retry.retry_at);
  const second = await runBoundedVerificationConvergence(options);
  assert.equal(second.status, "HOLD");
  assert.equal(
    second.final.reason,
    "verification_convergence_attempt_limit_reached",
  );
  assert.deepEqual(second.final.blockers, [
    "youtube_upload_not_processed",
    "verification_convergence_attempt_limit_reached",
  ]);
  assert.equal(second.final.attempt_count, 2);
  assert.equal(second.final.retry.required, false);
});

test("replay reconstructs the final from a durable confirmed attempt without repeating the read-only check", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 15_000,
    maxAttempts: 4,
    now: () => new Date("2026-07-29T19:00:05.000Z"),
    verifyReadOnly: async () => ({
      outcome: "CONFIRMED",
      reason: "youtube_public_processed",
      evidence: { external_id: "yt-primary" },
    }),
  };
  await runBoundedVerificationConvergence(options);
  await fs.rm(path.join(stateDir, "final.json"));

  const recovered = await runBoundedVerificationConvergence({
    ...options,
    verifyReadOnly: async () => {
      throw new Error("durable_attempt_replay_must_not_verify");
    },
  });

  assert.equal(recovered.status, "GREEN");
  assert.equal(recovered.final.attempt_count, 1);
  assert.equal(recovered.final.winning_attempt_number, 1);
  assert.equal(recovered.reused, true);
  assert.equal(recovered.recovered_from_attempt, true);
});

test("a state directory cannot be replayed under a different exact release contract", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let calls = 0;
  const base = {
    phase: "T-60",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T18:00:00.000Z",
    cutoffAt: "2026-07-29T18:10:00.000Z",
    retryIntervalMs: 5_000,
    maxAttempts: 3,
    now: () => new Date("2026-07-29T18:00:00.000Z"),
    verifyReadOnly: async () => {
      calls += 1;
      return {
        outcome: "RETRYABLE",
        reason: "youtube_upload_processing",
      };
    },
  };
  await runBoundedVerificationConvergence(base);

  await assert.rejects(
    runBoundedVerificationConvergence({
      ...base,
      identity: exactIdentity({
        story_id: "story-other",
        selected_story_id: "story-other",
      }),
    }),
    {
      code: "verification_convergence_contract_conflict",
    },
  );
  assert.equal(calls, 1);
});

test("a caller can explicitly classify a transient read-only API failure for bounded retry", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const result = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 10_000,
    maxAttempts: 3,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async () => {
      const error = new Error("transient remote failure");
      error.code = "youtube_api_check_error";
      throw error;
    },
    classifyVerificationError(error, context) {
      assert.equal(error.code, "youtube_api_check_error");
      assert.equal(context.verification_only, true);
      return {
        outcome: "RETRYABLE",
        reason: "youtube_api_check_error",
        blockers: ["youtube_api_check_error"],
        evidence: { error_code: error.code },
      };
    },
  });

  assert.equal(result.status, "RETRY_SCHEDULED");
  assert.equal(result.retry.next_attempt_number, 2);
  assert.equal(result.attempt.outcome, "RETRYABLE");
  assert.deepEqual(result.attempt.evidence, {
    error_code: "youtube_api_check_error",
  });
});

test("an early invocation waits until the bounded verification window opens", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let calls = 0;
  const result = await runBoundedVerificationConvergence({
    phase: "T-60",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T18:00:00.000Z",
    cutoffAt: "2026-07-29T18:10:00.000Z",
    retryIntervalMs: 10_000,
    maxAttempts: 3,
    now: () => new Date("2026-07-29T17:59:59.000Z"),
    verifyReadOnly: async () => {
      calls += 1;
      return {
        outcome: "CONFIRMED",
        reason: "must_not_run_early",
        evidence: { external_id: "yt-primary" },
      };
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.status, "WAITING");
  assert.deepEqual(result.retry, {
    required: true,
    retry_at: "2026-07-29T18:00:00.000Z",
    cutoff_at: "2026-07-29T18:10:00.000Z",
    delay_ms: 1_000,
    next_attempt_number: 1,
  });
});

test("a non-retryable verification verdict immediately creates a terminal HOLD with an actionable blocker", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const result = await runBoundedVerificationConvergence({
    phase: "T-60",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T18:00:00.000Z",
    cutoffAt: "2026-07-29T18:10:00.000Z",
    retryIntervalMs: 10_000,
    maxAttempts: 3,
    now: () => new Date("2026-07-29T18:00:01.000Z"),
    verifyReadOnly: async () => ({
      outcome: "TERMINAL",
      reason: "youtube_exact_object_identity_mismatch",
    }),
  });

  assert.equal(result.status, "HOLD");
  assert.equal(
    result.final.reason,
    "youtube_exact_object_identity_mismatch",
  );
  assert.deepEqual(result.final.blockers, [
    "youtube_exact_object_identity_mismatch",
  ]);
  assert.equal(result.final.retry.required, false);
});

test("replay after an exhausted retry attempt finalises HOLD without exceeding the attempt budget", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T18:00:00.000Z");
  let calls = 0;
  const options = {
    phase: "T-60",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T18:00:00.000Z",
    cutoffAt: "2026-07-29T18:10:00.000Z",
    retryIntervalMs: 5_000,
    maxAttempts: 1,
    now: () => new Date(clock),
    verifyReadOnly: async () => {
      calls += 1;
      return {
        outcome: "RETRYABLE",
        reason: "youtube_upload_processing",
      };
    },
  };
  await runBoundedVerificationConvergence(options);
  await fs.rm(path.join(stateDir, "final.json"));
  clock = new Date("2026-07-29T18:00:30.000Z");

  const recovered = await runBoundedVerificationConvergence({
    ...options,
    verifyReadOnly: async () => {
      calls += 1;
      throw new Error("attempt_budget_must_not_be_exceeded");
    },
  });

  assert.equal(calls, 1);
  assert.equal(recovered.status, "HOLD");
  assert.equal(
    recovered.final.reason,
    "verification_convergence_attempt_limit_reached",
  );
  assert.equal(recovered.recovered_from_attempt, true);
});

test("replay rejects a final whose embedded exact release identity was altered without changing its claimed contract id", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async () => ({
      outcome: "CONFIRMED",
      reason: "youtube_public_processed",
      evidence: { external_id: "yt-primary" },
    }),
  };
  await runBoundedVerificationConvergence(options);
  const finalPath = path.join(stateDir, "final.json");
  const tampered = JSON.parse(await fs.readFile(finalPath, "utf8"));
  tampered.identity.story_id = "story-tampered";
  tampered.identity.selected_story_id = "story-tampered";
  await fs.writeFile(
    finalPath,
    JSON.stringify(rehashArtifact(tampered), null, 2),
  );

  await assert.rejects(
    runBoundedVerificationConvergence({
      ...options,
      verifyReadOnly: async () => {
        throw new Error("tampered_final_must_not_verify");
      },
    }),
    { code: "verification_convergence_final_binding_invalid" },
  );
});

test("reserve convergence is bound to promotion evidence and primary convergence cannot borrow it", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const base = {
    phase: "T0",
    stateDir,
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async () => ({
      outcome: "CONFIRMED",
      reason: "must_not_run",
      evidence: { external_id: "yt-primary" },
    }),
  };

  await assert.rejects(
    runBoundedVerificationConvergence({
      ...base,
      identity: exactIdentity({
        selected_role: "reserve",
        promotion_sha256: null,
      }),
    }),
    {
      code:
        "verification_convergence_reserve_promotion_sha256_required",
    },
  );
  await assert.rejects(
    runBoundedVerificationConvergence({
      ...base,
      identity: exactIdentity({
        promotion_sha256: "5".repeat(64),
      }),
    }),
    {
      code:
        "verification_convergence_primary_promotion_sha256_forbidden",
    },
  );
});

test("a final cannot survive deletion of the decisive append-only attempt it names", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async () => ({
      outcome: "CONFIRMED",
      reason: "youtube_public_processed",
      evidence: { external_id: "yt-primary" },
    }),
  };
  await runBoundedVerificationConvergence(options);
  await fs.rm(
    path.join(stateDir, "attempts", "attempt-000001.json"),
  );

  await assert.rejects(
    runBoundedVerificationConvergence(options),
    {
      code:
        "verification_convergence_final_attempt_evidence_invalid",
    },
  );
});

test("a backwards live clock step fails closed and preserves monotonic attempt evidence", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const times = [
    new Date("2026-07-29T19:14:59.000Z"),
    new Date("2026-07-29T18:00:00.000Z"),
  ];
  const result = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    maxAttempts: 2,
    now: () => times.shift(),
    verifyReadOnly: async () => ({
      outcome: "CONFIRMED",
      reason: "youtube_public_processed",
      evidence: { external_id: "yt-primary" },
    }),
  });

  assert.equal(result.status, "HOLD");
  assert.equal(
    result.final.reason,
    "verification_convergence_clock_regressed",
  );
  const attempt = JSON.parse(
    await fs.readFile(
      path.join(stateDir, "attempts", "attempt-000001.json"),
      "utf8",
    ),
  );
  assert.equal(attempt.clock_regressed, true);
  assert.equal(
    attempt.observed_clock_at,
    "2026-07-29T18:00:00.000Z",
  );
  assert.equal(attempt.completed_at, attempt.started_at);
});

test("an exclusive attempt claim prevents concurrent invocations from executing the same verifier", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let calls = 0;
  let releaseFirst;
  let firstEntered;
  const entered = new Promise((resolve) => {
    firstEntered = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async () => {
      calls += 1;
      if (calls === 1) {
        firstEntered();
        await gate;
      }
      return {
        outcome: "CONFIRMED",
        reason: "youtube_public_processed",
        evidence: { external_id: "yt-primary" },
      };
    },
  };

  const firstPromise =
    runBoundedVerificationConvergence(options);
  await entered;
  const concurrent =
    await runBoundedVerificationConvergence(options);
  assert.equal(concurrent.status, "WAITING");
  assert.equal(
    concurrent.reason,
    "verification_convergence_attempt_in_progress",
  );
  assert.equal(calls, 1);

  releaseFirst();
  const first = await firstPromise;
  assert.equal(first.status, "GREEN");
  assert.equal(calls, 1);
  assert.deepEqual(
    await fs.readdir(path.join(stateDir, "attempts")),
    [
      "attempt-000001.json",
      "attempt-000001.started.json",
    ],
  );
});

test("a never-settling read-only verifier is aborted at its bounded attempt deadline and recorded for retry", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let aborted = false;
  const result = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 10,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async ({ signal }) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise(() => {});
    },
  });

  assert.equal(result.status, "RETRY_SCHEDULED");
  assert.equal(result.attempt.reason, "verification_convergence_attempt_timed_out");
  assert.equal(aborted, true);
  assert.equal(
    result.attempt.completed_at,
    "2026-07-29T19:00:01.010Z",
  );
});

test("a crash-shaped orphan STARTED record consumes the attempt budget before any replayed remote read", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T19:00:01.000Z");
  let calls = 0;
  let firstSignal;
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 200,
    maxAttempts: 1,
    now: () => new Date(clock),
    verifyReadOnly: async ({ signal }) => {
      calls += 1;
      firstSignal = signal;
      return new Promise(() => {});
    },
  };
  const abandonedInvocation =
    runBoundedVerificationConvergence(options);
  const startedPath = path.join(
    stateDir,
    "attempts",
    "attempt-000001.started.json",
  );
  for (let index = 0; index < 50; index += 1) {
    try {
      await fs.access(startedPath);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  clock = new Date("2026-07-29T19:00:01.201Z");

  const recovered = await runBoundedVerificationConvergence({
    ...options,
    verifyReadOnly: async () => {
      calls += 1;
      throw new Error("orphan_recovery_must_not_repeat_remote_read");
    },
  });

  assert.equal(calls, 1);
  assert.equal(recovered.status, "HOLD");
  assert.equal(
    recovered.final.reason,
    "verification_convergence_attempt_limit_reached",
  );
  const completion = JSON.parse(
    await fs.readFile(
      path.join(
        stateDir,
        "attempts",
        "attempt-000001.json",
      ),
      "utf8",
    ),
  );
  assert.equal(completion.interrupted, true);
  assert.equal(
    completion.reason,
    "verification_convergence_attempt_interrupted",
  );

  await abandonedInvocation;
  assert.equal(firstSignal.aborted, true);
  assert.equal(calls, 1);
});

test("a verifier result observed after its attempt deadline cannot win a delayed event-loop race", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T19:00:01.000Z");
  const result = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 1_000,
    maxAttempts: 2,
    now: () => new Date(clock),
    verifyReadOnly: async () => {
      clock = new Date("2026-07-29T19:00:02.001Z");
      return {
        outcome: "CONFIRMED",
        reason: "youtube_public_processed",
        evidence: { external_id: "yt-primary" },
      };
    },
  });

  assert.equal(result.status, "RETRY_SCHEDULED");
  assert.equal(
    result.attempt.reason,
    "verification_convergence_attempt_timed_out",
  );
  assert.equal(result.attempt.timed_out, true);
});

test("a CONFIRMED result for a different YouTube object is terminal HOLD", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const result = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 1_000,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async () => ({
      outcome: "CONFIRMED",
      reason: "youtube_public_processed",
      evidence: {
        external_id: "yt-different-object",
        upload_status: "processed",
      },
    }),
  });

  assert.equal(result.status, "HOLD");
  assert.equal(
    result.final.reason,
    "verification_convergence_confirmed_external_id_mismatch",
  );
  const attempt = JSON.parse(
    await fs.readFile(result.attempt_path, "utf8"),
  );
  assert.equal(attempt.outcome, "TERMINAL");
  assert.equal(attempt.identity.external_id, "yt-primary");
  assert.equal(attempt.retry.required, false);
});

test("the decisive attempt transitively binds every earlier attempt through a hash chain", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T19:00:01.000Z");
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 1_000,
    maxAttempts: 2,
    now: () => new Date(clock),
    verifyReadOnly: async ({ attempt_number: attemptNumber }) =>
      attemptNumber === 1
        ? {
            outcome: "RETRYABLE",
            reason: "youtube_upload_processing",
            evidence: { upload_status: "uploaded" },
          }
        : {
            outcome: "CONFIRMED",
            reason: "youtube_public_processed",
            evidence: {
              external_id: "yt-primary",
              upload_status: "processed",
            },
          },
  };

  const first = await runBoundedVerificationConvergence(options);
  clock = new Date(first.retry.retry_at);
  const second = await runBoundedVerificationConvergence(options);
  assert.equal(second.status, "GREEN");

  const firstAttemptPath = path.join(
    stateDir,
    "attempts",
    "attempt-000001.json",
  );
  const firstAttempt = JSON.parse(
    await fs.readFile(firstAttemptPath, "utf8"),
  );
  firstAttempt.reason = "rewritten_history";
  await fs.writeFile(
    firstAttemptPath,
    `${JSON.stringify(rehashArtifact(firstAttempt), null, 2)}\n`,
  );

  await assert.rejects(
    runBoundedVerificationConvergence(options),
    {
      code:
        "verification_convergence_final_attempt_evidence_invalid",
    },
  );
});

test("a finite synchronous verifier stall cannot bypass the armed attempt timeout", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const result = await runBoundedVerificationConvergence({
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 5,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: () => {
      const blockedUntil = Date.now() + 30;
      while (Date.now() < blockedUntil) {
        // Deliberately block to prove a late return cannot win the race.
      }
      return {
        outcome: "CONFIRMED",
        reason: "youtube_public_processed",
        evidence: { external_id: "yt-primary" },
      };
    },
  });

  assert.equal(result.status, "RETRY_SCHEDULED");
  assert.equal(
    result.attempt.reason,
    "verification_convergence_attempt_timed_out",
  );
  assert.equal(result.attempt.timed_out, true);
});

test("unsupported atomic hard links fail closed with a filesystem diagnostic", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const originalLink = fs.link;
  fs.link = async () => {
    const error = new Error("hard links unsupported");
    error.code = "ENOTSUP";
    throw error;
  };
  t.after(() => {
    fs.link = originalLink;
  });

  await assert.rejects(
    runBoundedVerificationConvergence({
      phase: "T0",
      stateDir,
      identity: exactIdentity(),
      startedAt: "2026-07-29T19:00:00.000Z",
      cutoffAt: "2026-07-29T19:15:00.000Z",
      retryIntervalMs: 5_000,
      attemptTimeoutMs: 1_000,
      maxAttempts: 2,
      now: () => new Date("2026-07-29T19:00:01.000Z"),
      verifyReadOnly: async () => ({
        outcome: "CONFIRMED",
        reason: "must_not_reach_remote_read",
        evidence: { external_id: "yt-primary" },
      }),
    }),
    (error) =>
      error?.code ===
        "verification_convergence_atomic_publish_failed" &&
      error?.filesystem_code === "ENOTSUP",
  );
});

test("a cutoff final binds the tail of its append-only attempt chain", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T19:00:01.000Z");
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:00:10.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 1_000,
    maxAttempts: 2,
    now: () => new Date(clock),
    verifyReadOnly: async () => ({
      outcome: "RETRYABLE",
      reason: "youtube_upload_processing",
      evidence: { upload_status: "uploaded" },
    }),
  };

  const first = await runBoundedVerificationConvergence(options);
  assert.equal(first.status, "RETRY_SCHEDULED");
  clock = new Date("2026-07-29T19:00:10.000Z");
  const cutoff = await runBoundedVerificationConvergence(options);
  assert.equal(cutoff.status, "HOLD");

  const firstAttemptPath = path.join(
    stateDir,
    "attempts",
    "attempt-000001.json",
  );
  const firstAttempt = JSON.parse(
    await fs.readFile(firstAttemptPath, "utf8"),
  );
  firstAttempt.reason = "rewritten_cutoff_history";
  await fs.writeFile(
    firstAttemptPath,
    `${JSON.stringify(rehashArtifact(firstAttempt), null, 2)}\n`,
  );

  await assert.rejects(
    runBoundedVerificationConvergence(options),
    {
      code: "verification_convergence_final_binding_invalid",
    },
  );
});

test("replay rejects a rehashed STARTED record whose derived expiry exceeds the cutoff", async (t) => {
  const stateDir = await temporaryStateDir(t);
  let clock = new Date("2026-07-29T19:00:01.000Z");
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 100,
    maxAttempts: 2,
    now: () => new Date(clock),
    verifyReadOnly: ({ signal }) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () =>
            resolve({
              outcome: "RETRYABLE",
              reason: "aborted_test_read",
            }),
          { once: true },
        );
      }),
  };
  let firstError = null;
  const firstInvocation =
    runBoundedVerificationConvergence(options).catch((error) => {
      firstError = error;
    });
  const startedPath = path.join(
    stateDir,
    "attempts",
    "attempt-000001.started.json",
  );
  for (let index = 0; index < 50; index += 1) {
    try {
      await fs.access(startedPath);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  const started = JSON.parse(
    await fs.readFile(startedPath, "utf8"),
  );
  started.attempt_expires_at = "2027-07-29T19:15:00.000Z";
  await fs.writeFile(
    startedPath,
    `${JSON.stringify(rehashArtifact(started), null, 2)}\n`,
  );
  clock = new Date("2026-07-29T19:15:00.000Z");

  await assert.rejects(
    runBoundedVerificationConvergence(options),
    {
      code:
        "verification_convergence_attempt_started_binding_invalid",
    },
  );
  await firstInvocation;
  assert.ok(firstError);
});

test("crash recovery revalidates the CONFIRMED external ID in durable attempt evidence", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:15:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 1_000,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async () => ({
      outcome: "CONFIRMED",
      reason: "youtube_public_processed",
      evidence: { external_id: "yt-primary" },
    }),
  };
  const green = await runBoundedVerificationConvergence(options);
  assert.equal(green.status, "GREEN");
  await fs.rm(path.join(stateDir, "final.json"));

  const attemptPath = path.join(
    stateDir,
    "attempts",
    "attempt-000001.json",
  );
  const attempt = JSON.parse(
    await fs.readFile(attemptPath, "utf8"),
  );
  attempt.evidence.external_id = "yt-wrong-object";
  await fs.writeFile(
    attemptPath,
    `${JSON.stringify(rehashArtifact(attempt), null, 2)}\n`,
  );

  await assert.rejects(
    runBoundedVerificationConvergence(options),
    {
      code: "verification_convergence_attempt_binding_invalid",
    },
  );
});

test("crash recovery rejects a rehashed attempt with contradictory cutoff timing", async (t) => {
  const stateDir = await temporaryStateDir(t);
  const options = {
    phase: "T0",
    stateDir,
    identity: exactIdentity(),
    startedAt: "2026-07-29T19:00:00.000Z",
    cutoffAt: "2026-07-29T19:10:00.000Z",
    retryIntervalMs: 5_000,
    attemptTimeoutMs: 1_000,
    maxAttempts: 2,
    now: () => new Date("2026-07-29T19:00:01.000Z"),
    verifyReadOnly: async () => ({
      outcome: "CONFIRMED",
      reason: "youtube_public_processed",
      evidence: { external_id: "yt-primary" },
    }),
  };
  const green = await runBoundedVerificationConvergence(options);
  assert.equal(green.status, "GREEN");
  await fs.rm(path.join(stateDir, "final.json"));

  const attemptPath = path.join(
    stateDir,
    "attempts",
    "attempt-000001.json",
  );
  const attempt = JSON.parse(
    await fs.readFile(attemptPath, "utf8"),
  );
  attempt.completed_at = "2026-07-29T19:10:01.000Z";
  attempt.observed_clock_at = "2026-07-29T19:10:01.000Z";
  attempt.completed_within_cutoff = true;
  await fs.writeFile(
    attemptPath,
    `${JSON.stringify(rehashArtifact(attempt), null, 2)}\n`,
  );

  await assert.rejects(
    runBoundedVerificationConvergence(options),
    {
      code: "verification_convergence_attempt_binding_invalid",
    },
  );
});
