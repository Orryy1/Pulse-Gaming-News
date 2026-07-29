"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence,
  buildGovernedYoutubeRunwayLock,
  buildGovernedYoutubeReservePromotionEvidence,
  canonicalSha256,
  classifyGovernedYoutubeWindowOutcome,
  validateLock,
  verifyGovernedYoutubeLockedDispatch,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  createAutonomousEligibleCandidateFixture,
} = require("../helpers/autonomous-window-eligibility-fixture");

const SHA = Object.freeze({
  media: "1".repeat(64),
  script: "2".repeat(64),
  qa: "3".repeat(64),
  rights: "4".repeat(64),
  source: "5".repeat(64),
  review: "6".repeat(64),
  admission: "7".repeat(64),
  revision: "8".repeat(64),
  standby: "9".repeat(64),
});

function candidate(storyId, overrides = {}) {
  return {
    story_id: storyId,
    lane_id: "breaking_short",
    score: 100,
    stage: "HUMAN_APPROVED",
    human_review_status: "approved",
    eligibility_verdict: "GREEN",
    media_sha256: SHA.media,
    script_sha256: SHA.script,
    qa_report_sha256: SHA.qa,
    rights_ledger_sha256: SHA.rights,
    source_evidence_sha256: SHA.source,
    human_review_evidence_sha256: SHA.review,
    admission_evidence_sha256: SHA.admission,
    candidate_revision_sha256: SHA.revision,
    standby_authorised: false,
    standby_authorisation_event_id: "standby-approval-1",
    standby_authorisation_sha256: SHA.standby,
    ...overrides,
  };
}

function autonomousCandidate(storyId, overrides = {}) {
  const scheduledFor =
    overrides.scheduled_for || "2026-07-28T19:00:00.000Z";
  const {
    scheduled_for: _scheduledFor,
    standby_authorised: standbyAuthorised,
    ...candidateOverrides
  } = overrides;
  return createAutonomousEligibleCandidateFixture({
    storyId,
    scheduledFor,
    role: standbyAuthorised === true
      ? "STANDBY"
      : "PRIMARY",
    candidateRevisionSha256: SHA.revision,
    requestFingerprint:
      storyId === "autonomous-primary"
        ? "a".repeat(64)
        : "b".repeat(64),
    evidenceHashes: {
      media_sha256: SHA.media,
      script_sha256: SHA.script,
      qa_report_sha256: SHA.qa,
      rights_ledger_sha256: SHA.rights,
      source_evidence_sha256: SHA.source,
    },
    candidateOverrides,
  });
}

function admissionJob(
  storyId,
  scheduledFor = "2026-07-28T19:00:00.000Z",
  overrides = {},
) {
  const runAt = new Date(
    Date.parse(scheduledFor) - 75 * 60 * 1000,
  ).toISOString();
  return {
    id: 701,
    kind: "admit_governed_publication",
    story_id: storyId,
    status: "pending",
    run_at: runAt,
    idempotency_key:
      `admit:youtube:breaking_short:${storyId}:${SHA.revision}:` +
      scheduledFor,
    payload: {
      story_id: storyId,
      platform: "youtube",
      candidate_revision_sha256: SHA.revision,
      admission: {
        scheduled_for: scheduledFor,
      },
    },
    ...overrides,
  };
}

function autonomousAdmissionJob(
  storyId,
  scheduledFor = "2026-07-28T19:00:00.000Z",
) {
  const exactCandidate = autonomousCandidate(storyId, {
    scheduled_for: scheduledFor,
  });
  return admissionJob(storyId, scheduledFor, {
    payload: {
      story_id: storyId,
      candidate_revision_sha256: SHA.revision,
      admission: exactCandidate.admission,
      autonomous_jit_materialisation_required: true,
      publish_authority: false,
      external_posting: false,
    },
  });
}

function greenRunway() {
  return buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      candidate("primary-ready", { score: 110 }),
      candidate("reserve-ready", {
        score: 90,
        standby_authorised: true,
      }),
    ],
    admission_jobs: [admissionJob("primary-ready")],
  });
}

function rehashLock(lock) {
  const body = structuredClone(lock);
  delete body.lock_sha256;
  return {
    ...body,
    lock_sha256: canonicalSha256(body),
  };
}

test("T-90 fails closed until one distinct human-reviewed reserve is ready", () => {
  const result = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T07:30:00.000Z",
    publish_hour_utc: 9,
    candidates: [candidate("primary-ready")],
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.phase, "T-90");
  assert.equal(result.scheduled_for, "2026-07-28T09:00:00.000Z");
  assert.equal(result.lock, null);
  assert.ok(
    result.blockers.includes("runway_reserve_candidate_not_ready"),
  );
  assert.equal(result.incident.required, true);
  assert.equal(result.safety.publish_authority_created, false);
  assert.equal(result.safety.external_publish_attempted, false);
  assert.equal(result.safety.catch_up_allowed, false);
});

test("T-90 creates an immutable primary-plus-reserve lock with conditional failover authority", () => {
  const result = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      candidate("primary-ready", { score: 110 }),
      candidate("reserve-ready", {
        score: 90,
        standby_authorised: true,
      }),
    ],
    admission_jobs: [admissionJob("primary-ready")],
  });

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.scheduled_for, "2026-07-28T19:00:00.000Z");
  assert.equal(result.lock.schema_version, "pulse-governed-youtube-release-runway-lock-v1");
  assert.equal(result.lock.primary.story_id, "primary-ready");
  assert.equal(result.lock.reserve.story_id, "reserve-ready");
  assert.notEqual(
    result.lock.primary.story_id,
    result.lock.reserve.story_id,
  );
  assert.equal(result.lock.primary.media_sha256, SHA.media);
  assert.equal(result.lock.primary.script_sha256, SHA.script);
  assert.equal(result.lock.primary.qa_report_sha256, SHA.qa);
  assert.equal(result.lock.primary.rights_ledger_sha256, SHA.rights);
  assert.equal(result.lock.primary.source_evidence_sha256, SHA.source);
  assert.equal(
    result.lock.primary.human_review_evidence_sha256,
    SHA.review,
  );
  assert.equal(
    result.lock.primary.admission_evidence_sha256,
    SHA.admission,
  );
  assert.equal(result.lock.reserve.standby_authorised, true);
  assert.equal(result.lock.reserve_scheduled, false);
  assert.equal(result.lock.primary_admission_job.status, "pending");
  assert.equal(
    result.lock.primary_admission_job.run_at,
    "2026-07-28T17:45:00.000Z",
  );
  assert.equal(
    result.lock.primary_admission_job.candidate_revision_sha256,
    SHA.revision,
  );
  assert.equal(result.lock.reserve_failover.verdict, "GREEN");
  assert.equal(
    result.lock.reserve_failover.code,
    "runway_reserve_conditionally_armed",
  );
  assert.equal(
    result.lock.reserve_failover.promotion_authority,
    true,
  );
  assert.match(
    result.lock.reserve_failover
      .failover_authorisation_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    result.lock.reserve_failover.confirmed_disarm_authority
      .authority_type,
    "CONFIRMED_DISARM_FAILOVER",
  );
  assert.equal(
    result.lock.reserve_failover.confirmed_disarm_authority
      .required_lifecycle_state,
    "PLATFORM_SCHEDULE_DISARMED",
  );
  assert.equal(
    result.lock.reserve_failover.confirmed_disarm_authority
      .required_ledger_event_type,
    "SCHEDULE_DISARM_CONFIRMED",
  );
  assert.equal(
    result.lock.reserve_failover.confirmed_disarm_authority
      .promotion_deadline_offset_minutes,
    -15,
  );
  assert.match(
    result.lock.reserve_failover
      .confirmed_disarm_authorisation_sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.match(result.lock.lock_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.lock.publish_authority, false);
  assert.equal(result.incident.required, false);
});

test("T-90 locks independently verified autonomous primary and standby eligibility without inventing human approval", () => {
  const result = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      autonomousCandidate("autonomous-primary"),
      autonomousCandidate("autonomous-reserve", {
        standby_authorised: true,
      }),
    ],
    admission_jobs: [
      autonomousAdmissionJob("autonomous-primary"),
    ],
  });

  assert.equal(result.verdict, "GREEN", JSON.stringify(result));
  assert.equal(
    result.lock.primary.stage,
    "AUTONOMOUS_ELIGIBLE",
  );
  assert.equal(
    result.lock.reserve.stage,
    "AUTONOMOUS_ELIGIBLE",
  );
  assert.equal(
    result.lock.primary.approval_type,
    "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
  );
  assert.equal(
    result.lock.reserve.approval_type,
    "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
  );
  assert.equal(
    Object.hasOwn(result.lock.primary, "human_review_status"),
    false,
  );
  assert.equal(
    Object.hasOwn(
      result.lock.primary,
      "human_review_evidence_sha256",
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(result.lock.reserve, "human_review_event_id"),
    false,
  );
  assert.equal(result.lock.publish_authority, false);
  assert.equal(
    result.lock.primary
      .autonomous_eligibility_attestation_sha256,
    autonomousCandidate("autonomous-primary").admission
      .autonomous_eligibility_attestation_sha256,
  );
  assert.notEqual(
    result.lock.primary
      .autonomous_eligibility_attestation_sha256,
    result.lock.reserve
      .autonomous_eligibility_attestation_sha256,
  );
  assert.equal(
    Object.hasOwn(
      result.lock.primary,
      "autonomous_publication_authority",
    ),
    false,
  );
  assert.deepEqual(validateLock(result.lock), []);
});

test("T-90 fails closed on stale or human-conflated autonomous eligibility", () => {
  const stale =
    createAutonomousEligibleCandidateFixture({
      storyId: "autonomous-primary",
      now: "2026-07-28T17:28:00.000Z",
      validUntil: "2026-07-28T17:29:00.000Z",
      candidateRevisionSha256: SHA.revision,
      requestFingerprint: "a".repeat(64),
      evidenceHashes: {
        media_sha256: SHA.media,
        script_sha256: SHA.script,
        qa_report_sha256: SHA.qa,
        rights_ledger_sha256: SHA.rights,
        source_evidence_sha256: SHA.source,
      },
      candidateOverrides: {
        human_review_status: "approved",
      },
    });

  const result = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      stale,
      autonomousCandidate("autonomous-reserve", {
        standby_authorised: true,
      }),
    ],
    admission_jobs: [
      autonomousAdmissionJob("autonomous-primary"),
    ],
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.lock, null);
  assert.ok(
    result.candidates.rejected.some(
      (entry) =>
        entry.story_id === "autonomous-primary" &&
        entry.blockers.includes(
          "autonomous_window_eligibility_stale",
        ) &&
        entry.blockers.includes(
          "runway_autonomous_human_approval_conflation",
        ),
    ),
    JSON.stringify(result),
  );
});

test("reserve promotion authority remains bounded to pre-T-60 crash recovery", () => {
  const runway = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      candidate("primary-ready", { score: 110 }),
      candidate("reserve-ready", {
        score: 90,
        standby_authorised: true,
      }),
    ],
    admission_jobs: [admissionJob("primary-ready")],
  });
  const failureBody = {
    classification: "DISPATCH_FAILED_BEFORE_CREATE",
    story_id: "primary-ready",
    platform: "youtube",
    scheduled_for: runway.lock.scheduled_for,
    runway_lock_sha256: runway.lock.lock_sha256,
    ledger_event_id: 91,
    ledger_idempotency_key: "primary-pre-create-failure",
    platform_contacted: false,
    uncertain_external_creation: false,
    external_id: null,
  };
  const primaryFailure = {
    ...failureBody,
    failure_event_sha256: canonicalSha256(failureBody),
  };

  const atT70 =
    buildGovernedYoutubeReservePromotionEvidence({
      now: "2026-07-28T17:50:00.000Z",
      lock: runway.lock,
      primary_failure: primaryFailure,
    });
  const atT65 =
    buildGovernedYoutubeReservePromotionEvidence({
      now: "2026-07-28T17:55:00.000Z",
      lock: runway.lock,
      primary_failure: primaryFailure,
    });
  const atT60 =
    buildGovernedYoutubeReservePromotionEvidence({
      now: "2026-07-28T18:00:00.000Z",
      lock: runway.lock,
      primary_failure: primaryFailure,
    });

  assert.equal(atT70.verdict, "GREEN");
  assert.equal(atT65.verdict, "GREEN");
  assert.equal(atT60.verdict, "HOLD");
  assert.ok(
    atT60.blockers.includes(
      "runway_reserve_promotion_deadline_expired",
    ),
  );
});

test("confirmed exact remote disarm activates the distinct reserve authority until T-15 only", () => {
  const runway = greenRunway();
  const disarmBody = {
    classification: "CONFIRMED_DISARM_FAILOVER",
    story_id: runway.lock.primary.story_id,
    platform: "youtube",
    scheduled_for: runway.lock.scheduled_for,
    runway_lock_sha256: runway.lock.lock_sha256,
    lifecycle_state: "PLATFORM_SCHEDULE_DISARMED",
    external_id: "youtube-primary-object",
    verified_external_id: "youtube-primary-object",
    ledger_event_id: 92,
    ledger_idempotency_key:
      "primary-schedule-disarm-confirmed",
    disarm_ledger_event_sha256: "a".repeat(64),
    privacy_status: "private",
    publish_at: null,
    verification_uncertain: false,
    reconciliation_required: false,
  };
  const primaryDisarm = {
    ...disarmBody,
    disarm_event_sha256: canonicalSha256(disarmBody),
  };

  const atT55 =
    buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
      now: "2026-07-28T18:05:00.000Z",
      lock: runway.lock,
      primary_disarm: primaryDisarm,
    });
  const atT15 =
    buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
      now: "2026-07-28T18:45:00.000Z",
      lock: runway.lock,
      primary_disarm: primaryDisarm,
    });

  assert.equal(atT55.verdict, "GREEN");
  assert.equal(
    atT55.promotion.authority_type,
    "CONFIRMED_DISARM_FAILOVER",
  );
  assert.equal(
    atT55.promotion.external_id,
    "youtube-primary-object",
  );
  assert.equal(
    atT55.promotion.primary_disarm_event_sha256,
    primaryDisarm.disarm_event_sha256,
  );
  assert.equal(atT55.promotion.catch_up_allowed, false);
  assert.equal(atT15.verdict, "HOLD");
  assert.ok(
    atT15.blockers.includes(
      "runway_confirmed_disarm_promotion_deadline_expired",
    ),
  );
});

test("confirmed-disarm promotion fails closed when remote verification names a different object", () => {
  const runway = greenRunway();
  const disarmBody = {
    classification: "CONFIRMED_DISARM_FAILOVER",
    story_id: runway.lock.primary.story_id,
    platform: "youtube",
    scheduled_for: runway.lock.scheduled_for,
    runway_lock_sha256: runway.lock.lock_sha256,
    lifecycle_state: "PLATFORM_SCHEDULE_DISARMED",
    external_id: "youtube-primary-object",
    verified_external_id: "different-youtube-object",
    ledger_event_id: 92,
    ledger_idempotency_key:
      "primary-schedule-disarm-confirmed",
    disarm_ledger_event_sha256: "a".repeat(64),
    privacy_status: "private",
    publish_at: null,
    verification_uncertain: false,
    reconciliation_required: false,
  };
  const result =
    buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
      now: "2026-07-28T18:05:00.000Z",
      lock: runway.lock,
      primary_disarm: {
        ...disarmBody,
        disarm_event_sha256:
          canonicalSha256(disarmBody),
      },
    });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "runway_primary_confirmed_disarm_external_identity_mismatch",
    ),
  );
});

test("confirmed-disarm promotion refuses uncertain verification even when the projected status looks safe", () => {
  const runway = greenRunway();
  const disarmBody = {
    classification: "CONFIRMED_DISARM_FAILOVER",
    story_id: runway.lock.primary.story_id,
    platform: "youtube",
    scheduled_for: runway.lock.scheduled_for,
    runway_lock_sha256: runway.lock.lock_sha256,
    lifecycle_state: "PLATFORM_SCHEDULE_DISARMED",
    external_id: "youtube-primary-object",
    verified_external_id: "youtube-primary-object",
    ledger_event_id: 92,
    ledger_idempotency_key:
      "primary-schedule-disarm-confirmed",
    disarm_ledger_event_sha256: "a".repeat(64),
    privacy_status: "private",
    publish_at: null,
    verification_uncertain: true,
    reconciliation_required: false,
  };
  const result =
    buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
      now: "2026-07-28T18:05:00.000Z",
      lock: runway.lock,
      primary_disarm: {
        ...disarmBody,
        disarm_event_sha256:
          canonicalSha256(disarmBody),
      },
    });

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "runway_primary_confirmed_disarm_proof_invalid",
    ),
  );
});

test("confirmed-disarm authority fails closed on reconciliation, a surviving publishAt or a different window", () => {
  const runway = greenRunway();
  const base = {
    classification: "CONFIRMED_DISARM_FAILOVER",
    story_id: runway.lock.primary.story_id,
    platform: "youtube",
    scheduled_for: runway.lock.scheduled_for,
    runway_lock_sha256: runway.lock.lock_sha256,
    lifecycle_state: "PLATFORM_SCHEDULE_DISARMED",
    external_id: "youtube-primary-object",
    verified_external_id: "youtube-primary-object",
    ledger_event_id: 92,
    ledger_idempotency_key:
      "primary-schedule-disarm-confirmed",
    disarm_ledger_event_sha256: "a".repeat(64),
    privacy_status: "private",
    publish_at: null,
    verification_uncertain: false,
    reconciliation_required: false,
  };
  const cases = [
    {
      name: "reconciliation",
      overrides: { reconciliation_required: true },
      blocker:
        "runway_primary_confirmed_disarm_proof_invalid",
    },
    {
      name: "publishAt survives",
      overrides: {
        publish_at: runway.lock.scheduled_for,
      },
      blocker:
        "runway_primary_confirmed_disarm_proof_invalid",
    },
    {
      name: "different window",
      overrides: {
        scheduled_for: "2026-07-29T19:00:00.000Z",
      },
      blocker:
        "runway_primary_confirmed_disarm_binding_mismatch",
    },
  ];

  for (const item of cases) {
    const body = { ...base, ...item.overrides };
    const result =
      buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
        now: "2026-07-28T18:05:00.000Z",
        lock: runway.lock,
        primary_disarm: {
          ...body,
          disarm_event_sha256:
            canonicalSha256(body),
        },
      });
    assert.equal(result.verdict, "HOLD", item.name);
    assert.ok(
      result.blockers.includes(item.blocker),
      item.name,
    );
  }
});

test("T-90 refuses GREEN without one pending primary admission job due exactly at T-75", () => {
  const base = {
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      candidate("primary-ready", { score: 110 }),
      candidate("reserve-ready", {
        score: 90,
        standby_authorised: true,
      }),
    ],
  };
  for (const admission_jobs of [
    [],
    [
      admissionJob("primary-ready", undefined, {
        status: "done",
      }),
    ],
    [
      admissionJob("primary-ready", undefined, {
        run_at: "2026-07-28T17:44:59.000Z",
      }),
    ],
    [admissionJob("different-story")],
  ]) {
    const result = buildGovernedYoutubeRunwayLock({
      ...base,
      admission_jobs,
    });
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.lock, null);
    assert.ok(
      result.blockers.includes(
        "runway_primary_admission_job_not_pending_at_t75",
      ),
    );
    assert.equal(result.safety.catch_up_allowed, false);
  }
});

test("T-90 requires source evidence and rejects an unapproved reserve or duplicate role", () => {
  const missingSource = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T07:30:00.000Z",
    publish_hour_utc: 9,
    candidates: [
      candidate("primary-ready"),
      candidate("missing-source", {
        source_evidence_sha256: null,
      }),
      candidate("reserve-unapproved", {
        standby_authorised: true,
        human_review_status: "pending",
      }),
      candidate("primary-ready", {
        standby_authorised: true,
      }),
    ],
  });

  assert.equal(missingSource.verdict, "HOLD");
  assert.equal(missingSource.lock, null);
  assert.ok(
    missingSource.blockers.includes(
      "runway_reserve_candidate_not_ready",
    ),
  );
  assert.ok(
    missingSource.candidates.rejected.some(
      (entry) =>
        entry.story_id === "missing-source" &&
        entry.blockers.includes(
          "runway_source_evidence_sha256_required",
        ),
    ),
  );
  assert.ok(
    missingSource.candidates.rejected.some(
      (entry) =>
        entry.story_id === "reserve-unapproved" &&
        entry.blockers.includes(
          "runway_human_review_approval_required",
        ),
    ),
  );
});

test("lock validation recomputes primary and reserve bindings after media or source tampering", () => {
  const runway = greenRunway();
  const tamperedMedia = structuredClone(runway.lock);
  tamperedMedia.primary.media_sha256 = "8".repeat(64);
  const rehashedMedia = rehashLock(tamperedMedia);
  assert.ok(
    validateLock(rehashedMedia).includes(
      "runway_lock_primary_binding_sha256_mismatch",
    ),
  );

  const tamperedSource = structuredClone(runway.lock);
  tamperedSource.reserve.source_evidence_sha256 =
    "9".repeat(64);
  const rehashedSource = rehashLock(tamperedSource);
  assert.ok(
    validateLock(rehashedSource).includes(
      "runway_lock_reserve_binding_sha256_mismatch",
    ),
  );

  const tamperedJob = structuredClone(runway.lock);
  tamperedJob.primary_admission_job.job_id = 0;
  tamperedJob.primary_admission_job.idempotency_key =
    `admit:youtube:wrong-lane:${tamperedJob.primary.story_id}:` +
    tamperedJob.primary.candidate_revision_sha256 +
    `:${tamperedJob.scheduled_for}`;
  const rehashedJob = rehashLock(tamperedJob);
  const jobBlockers = validateLock(rehashedJob);
  assert.ok(
    jobBlockers.includes(
      "runway_lock_primary_admission_job_binding_invalid",
    ),
  );
});

test("T-90 is UTC exact across UK DST boundaries and refuses non-guarded windows", () => {
  for (const now of [
    "2026-03-28T07:30:00.000Z",
    "2026-03-29T07:30:00.000Z",
    "2026-10-24T07:30:00.000Z",
    "2026-10-25T07:30:00.000Z",
  ]) {
    const result = buildGovernedYoutubeRunwayLock({
      now,
      publish_hour_utc: 9,
      candidates: [
        candidate("primary"),
        candidate("reserve", {
          standby_authorised: true,
        }),
      ],
      admission_jobs: [
        admissionJob(
          "primary",
          `${now.slice(0, 10)}T09:00:00.000Z`,
        ),
      ],
    });
    assert.equal(result.verdict, "GREEN");
    assert.deepEqual(result.blockers, []);
    assert.match(result.scheduled_for, /T09:00:00\.000Z$/);
  }

  const outsideWindow = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T12:30:00.000Z",
    publish_hour_utc: 14,
    candidates: [],
  });
  assert.equal(outsideWindow.verdict, "HOLD");
  assert.deepEqual(outsideWindow.blockers, [
    "runway_publish_hour_not_guarded",
  ]);
  assert.equal(outsideWindow.safety.catch_up_allowed, false);
});

test("T0 verifies one exact scheduled story against the immutable lock hash", () => {
  const runway = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      candidate("primary-ready", { score: 110 }),
      candidate("reserve-ready", {
        score: 90,
        standby_authorised: true,
      }),
    ],
    admission_jobs: [admissionJob("primary-ready")],
  });
  const result = verifyGovernedYoutubeLockedDispatch({
    now: "2026-07-28T19:00:00.000Z",
    lock: runway.lock,
    scheduled_binding: {
      storyId: "primary-ready",
      platform: "youtube",
      scheduledFor: "2026-07-28T19:00:00.000Z",
      scheduledEventId: 501,
      dispatchIdempotencyKey:
        "youtube:primary-ready:2026-07-28T19:00:00.000Z",
      requestFingerprint: "a".repeat(64),
      runwayLockSha256: runway.lock.lock_sha256,
    },
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.selected_role, "primary");
  assert.equal(result.story_id, "primary-ready");
  assert.equal(result.exact_scheduled_youtube_rows_required, 1);
  assert.equal(result.dispatch_authority_created, false);
  assert.equal(result.catch_up_allowed, false);

  const reserveWithoutPromotion =
    verifyGovernedYoutubeLockedDispatch({
      now: "2026-07-28T19:00:00.000Z",
      lock: runway.lock,
      scheduled_binding: {
        storyId: "reserve-ready",
        platform: "youtube",
        scheduledFor: "2026-07-28T19:00:00.000Z",
        scheduledEventId: 502,
        dispatchIdempotencyKey:
          "youtube:reserve-ready:2026-07-28T19:00:00.000Z",
        requestFingerprint: "b".repeat(64),
        runwayLockSha256: runway.lock.lock_sha256,
      },
    });
  assert.equal(reserveWithoutPromotion.verdict, "HOLD");
  assert.ok(
    reserveWithoutPromotion.blockers.includes(
      "runway_reserve_promotion_evidence_required",
    ),
  );
});

test("T0 recognises the reserve only when its confirmed-disarm promotion remains hash-bound to the lock", () => {
  const runway = greenRunway();
  const disarmBody = {
    classification: "CONFIRMED_DISARM_FAILOVER",
    story_id: runway.lock.primary.story_id,
    platform: "youtube",
    scheduled_for: runway.lock.scheduled_for,
    runway_lock_sha256: runway.lock.lock_sha256,
    lifecycle_state: "PLATFORM_SCHEDULE_DISARMED",
    external_id: "youtube-primary-object",
    verified_external_id: "youtube-primary-object",
    ledger_event_id: 92,
    ledger_idempotency_key:
      "primary-schedule-disarm-confirmed",
    disarm_ledger_event_sha256: "a".repeat(64),
    privacy_status: "private",
    publish_at: null,
    verification_uncertain: false,
    reconciliation_required: false,
  };
  const built =
    buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
      now: "2026-07-28T18:05:00.000Z",
      lock: runway.lock,
      primary_disarm: {
        ...disarmBody,
        disarm_event_sha256:
          canonicalSha256(disarmBody),
      },
    });

  const result = verifyGovernedYoutubeLockedDispatch({
    now: runway.lock.scheduled_for,
    lock: runway.lock,
    scheduled_binding: {
      storyId: runway.lock.reserve.story_id,
      platform: "youtube",
      scheduledFor: runway.lock.scheduled_for,
      scheduledEventId: 502,
      dispatchIdempotencyKey:
        "youtube:reserve-ready:2026-07-28T19:00:00.000Z",
      requestFingerprint: "b".repeat(64),
      runwayLockSha256: runway.lock.lock_sha256,
      reservePromotion: built.promotion,
    },
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.selected_role, "reserve");
  const tampered = structuredClone(built.promotion);
  tampered.external_id = "different-primary-object";
  const held = verifyGovernedYoutubeLockedDispatch({
    now: runway.lock.scheduled_for,
    lock: runway.lock,
    scheduled_binding: {
      storyId: runway.lock.reserve.story_id,
      platform: "youtube",
      scheduledFor: runway.lock.scheduled_for,
      scheduledEventId: 502,
      dispatchIdempotencyKey:
        "youtube:reserve-ready:2026-07-28T19:00:00.000Z",
      requestFingerprint: "b".repeat(64),
      runwayLockSha256: runway.lock.lock_sha256,
      reservePromotion: tampered,
    },
  });
  assert.equal(held.verdict, "HOLD");
  assert.ok(
    held.blockers.includes(
      "runway_reserve_promotion_sha256_mismatch",
    ),
  );
});

test("T+15 records HIT only from a verified real YouTube publication identity and time", () => {
  const runway = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      candidate("primary-ready", { score: 110 }),
      candidate("reserve-ready", {
        score: 90,
        standby_authorised: true,
      }),
    ],
    admission_jobs: [admissionJob("primary-ready")],
  });
  const result = classifyGovernedYoutubeWindowOutcome({
    now: "2026-07-28T19:15:00.000Z",
    lock: runway.lock,
    selected_release: {
      role: "primary",
      story_id: runway.lock.primary.story_id,
    },
    observations: [
      {
        story_id: "primary-ready",
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_real_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_real_501",
        published_at: "2026-07-28T19:03:00.000Z",
        platform_contacted: true,
      },
      {
        story_id: runway.lock.reserve.story_id,
        platform: "youtube",
        verification_status: "unverified",
      },
    ],
  });

  assert.equal(result.classification, "HIT");
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.incident.required, false);
  assert.equal(result.publication.external_id, "yt_real_501");
  assert.equal(result.catch_up_allowed, false);
  assert.equal(result.retry_allowed, false);
});

test("T+15 accepts the reserve identity only when reserve is the canonical selected release", () => {
  const runway = greenRunway();
  const result = classifyGovernedYoutubeWindowOutcome({
    now: "2026-07-28T19:15:00.000Z",
    lock: runway.lock,
    selected_release: {
      role: "reserve",
      story_id: runway.lock.reserve.story_id,
    },
    observations: [
      {
        story_id: runway.lock.primary.story_id,
        platform: "youtube",
        verification_status: "unverified",
      },
      {
        story_id: runway.lock.reserve.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_reserve_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_reserve_501",
        published_at: "2026-07-28T19:03:00.000Z",
        platform_contacted: true,
      },
    ],
  });

  assert.equal(result.classification, "HIT");
  assert.equal(result.verdict, "GREEN");
  assert.equal(
    result.publication.story_id,
    runway.lock.reserve.story_id,
  );
  assert.equal(
    result.publication.external_id,
    "yt_reserve_501",
  );
  assert.equal(result.incident.required, false);
});

test("T+15 rejects a selected role and story that do not form one canonical lock binding", () => {
  const runway = greenRunway();
  const result = classifyGovernedYoutubeWindowOutcome({
    now: "2026-07-28T19:15:00.000Z",
    lock: runway.lock,
    selected_release: {
      role: "reserve",
      story_id: runway.lock.primary.story_id,
    },
    observations: [
      {
        story_id: runway.lock.primary.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_primary_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_primary_501",
        published_at: "2026-07-28T19:03:00.000Z",
        platform_contacted: true,
      },
      {
        story_id: runway.lock.reserve.story_id,
        platform: "youtube",
        verification_status: "unverified",
      },
    ],
  });

  assert.equal(result.classification, "EXTERNAL_FAILURE");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.publication, null);
  assert.equal(result.incident.required, true);
  assert.ok(
    result.blockers.includes(
      "runway_selected_release_binding_mismatch",
    ),
  );
});

test("T+15 cannot record HIT without an explicit canonical selected release", () => {
  const runway = greenRunway();
  const result = classifyGovernedYoutubeWindowOutcome({
    now: "2026-07-28T19:15:00.000Z",
    lock: runway.lock,
    observations: [
      {
        story_id: runway.lock.primary.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_primary_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_primary_501",
        published_at: "2026-07-28T19:03:00.000Z",
        platform_contacted: true,
      },
      {
        story_id: runway.lock.reserve.story_id,
        platform: "youtube",
        verification_status: "unverified",
      },
    ],
  });

  assert.equal(result.classification, "EXTERNAL_FAILURE");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.publication, null);
  assert.equal(result.incident.required, true);
  assert.ok(
    result.blockers.includes(
      "runway_selected_release_required",
    ),
  );
});

test("T+15 cannot record HIT unless canonical observations cover both locked roles", () => {
  const runway = greenRunway();
  const result = classifyGovernedYoutubeWindowOutcome({
    now: "2026-07-28T19:15:00.000Z",
    lock: runway.lock,
    selected_release: {
      role: "primary",
      story_id: runway.lock.primary.story_id,
    },
    observations: [
      {
        story_id: runway.lock.primary.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_primary_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_primary_501",
        published_at: "2026-07-28T19:03:00.000Z",
        platform_contacted: true,
      },
    ],
  });

  assert.equal(result.classification, "EXTERNAL_FAILURE");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.publication, null);
  assert.equal(result.incident.required, true);
  assert.ok(
    result.blockers.includes(
      "runway_locked_publication_observation_scope_incomplete",
    ),
  );
});

test("T+15 holds when the confirmed publication belongs to the non-selected locked role", () => {
  const runway = greenRunway();
  const result = classifyGovernedYoutubeWindowOutcome({
    now: "2026-07-28T19:15:00.000Z",
    lock: runway.lock,
    selected_release: {
      role: "primary",
      story_id: runway.lock.primary.story_id,
    },
    observations: [
      {
        story_id: runway.lock.reserve.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_reserve_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_reserve_501",
        published_at: "2026-07-28T19:03:00.000Z",
        platform_contacted: true,
      },
    ],
  });

  assert.equal(result.classification, "EXTERNAL_FAILURE");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.publication, null);
  assert.equal(result.incident.required, true);
  assert.ok(
    result.blockers.includes(
      "runway_wrong_role_publication_confirmed",
    ),
  );
});

test("T+15 raises an incident when both locked primary and reserve identities are published", () => {
  const runway = greenRunway();
  const result = classifyGovernedYoutubeWindowOutcome({
    now: "2026-07-28T19:15:00.000Z",
    lock: runway.lock,
    selected_release: {
      role: "primary",
      story_id: runway.lock.primary.story_id,
    },
    observations: [
      {
        story_id: runway.lock.primary.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_primary_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_primary_501",
        published_at: "2026-07-28T19:02:00.000Z",
        platform_contacted: true,
      },
      {
        story_id: runway.lock.reserve.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_reserve_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_reserve_501",
        published_at: "2026-07-28T19:03:00.000Z",
        platform_contacted: true,
      },
    ],
  });

  assert.equal(result.classification, "EXTERNAL_FAILURE");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.publication, null);
  assert.equal(result.incident.required, true);
  assert.ok(
    result.blockers.includes(
      "runway_duplicate_locked_publication_confirmed",
    ),
  );
});

test("T+15 requires exactly one confirmed identity for the selected locked story", () => {
  const runway = greenRunway();
  const result = classifyGovernedYoutubeWindowOutcome({
    now: "2026-07-28T19:15:00.000Z",
    lock: runway.lock,
    selected_release: {
      role: "primary",
      story_id: runway.lock.primary.story_id,
    },
    observations: [
      {
        story_id: runway.lock.primary.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_primary_501",
        external_url:
          "https://www.youtube.com/watch?v=yt_primary_501",
        published_at: "2026-07-28T19:02:00.000Z",
        platform_contacted: true,
      },
      {
        story_id: runway.lock.primary.story_id,
        platform: "youtube",
        verification_status: "confirmed",
        external_id: "yt_primary_502",
        external_url:
          "https://www.youtube.com/watch?v=yt_primary_502",
        published_at: "2026-07-28T19:03:00.000Z",
        platform_contacted: true,
      },
      {
        story_id: runway.lock.reserve.story_id,
        platform: "youtube",
        verification_status: "unverified",
      },
    ],
  });

  assert.equal(result.classification, "EXTERNAL_FAILURE");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.publication, null);
  assert.equal(result.incident.required, true);
  assert.ok(
    result.blockers.includes(
      "runway_selected_publication_identity_count_invalid",
    ),
  );
});

test("T+15 never calls a missing or fake external identity a HIT", () => {
  const runway = greenRunway();
  for (const observation of [
    {
      story_id: "primary-ready",
      platform: "youtube",
      verification_status: "confirmed",
      external_id: "",
      external_url: "",
      published_at: "2026-07-28T19:03:00.000Z",
      platform_contacted: true,
    },
    {
      story_id: "primary-ready",
      platform: "youtube",
      verification_status: "confirmed",
      external_id: "yt_real_501",
      external_url: "https://example.com/yt_real_501",
      published_at: "2026-07-28T19:03:00.000Z",
      platform_contacted: true,
    },
    {
      story_id: "not-locked",
      platform: "youtube",
      verification_status: "confirmed",
      external_id: "yt_real_501",
      external_url:
        "https://www.youtube.com/watch?v=yt_real_501",
      published_at: "2026-07-28T19:03:00.000Z",
      platform_contacted: true,
    },
  ]) {
    const result = classifyGovernedYoutubeWindowOutcome({
      now: "2026-07-28T19:15:00.000Z",
      lock: runway.lock,
      observation,
    });
    assert.equal(result.classification, "EXTERNAL_FAILURE");
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.publication, null);
    assert.equal(result.incident.required, true);
    assert.equal(result.catch_up_allowed, false);
    assert.equal(result.retry_allowed, false);
  }
});

test("T+15 classifies policy holds, internal misses and external failures without catch-up", () => {
  const runway = greenRunway();
  const cases = [
    {
      observation: {
        held_policy: true,
        policy_blockers: ["scheduled_control_tower_not_green"],
      },
      classification: "HELD_POLICY",
    },
    {
      observation: {},
      classification: "MISSED_INTERNAL",
    },
    {
      observation: { dispatch_attempted: true },
      classification: "EXTERNAL_FAILURE",
    },
  ];
  for (const entry of cases) {
    const result = classifyGovernedYoutubeWindowOutcome({
      now: "2026-07-28T19:15:00.000Z",
      lock: runway.lock,
      observation: entry.observation,
    });
    assert.equal(result.classification, entry.classification);
    assert.equal(result.verdict, "HOLD");
    assert.equal(result.incident.required, true);
    assert.equal(result.catch_up_allowed, false);
    assert.equal(result.retry_allowed, false);
    assert.equal(result.publish_authority_created, false);
  }
});
