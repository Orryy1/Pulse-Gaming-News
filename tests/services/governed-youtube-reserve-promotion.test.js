"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const jobsRepository = require("../../lib/repositories/jobs");
const {
  buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence,
  buildGovernedYoutubeReservePromotionEvidence,
  buildGovernedYoutubeRunwayLock,
  canonicalSha256,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  canonicalDisarmLedgerEventSha256,
  promoteGovernedYoutubeReserveRelease,
  resolveCanonicalPrimaryConfirmedDisarm,
} = require("../../lib/services/governed-youtube-reserve-promotion");

const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";

function sha(value) {
  return crypto
    .createHash("sha256")
    .update(
      typeof value === "string"
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
}

function admission(storyId) {
  return {
    actor_id: "operator-1",
    reason: "Exact reserve reviewed and approved",
    confirmation_story_id: storyId,
    scheduled_for: SCHEDULED_FOR,
    evidence: {
      source_evidence_sha256: "1".repeat(64),
      rights_ledger_sha256: "2".repeat(64),
      qa_report_sha256: "3".repeat(64),
    },
    human_review_status: "approved",
  };
}

function candidate(storyId, standby, packet) {
  return {
    story_id: storyId,
    lane_id: "breaking_short",
    score: standby ? 90 : 110,
    stage: "HUMAN_APPROVED",
    human_review_status: "approved",
    eligibility_verdict: "GREEN",
    media_sha256: "4".repeat(64),
    script_sha256: "5".repeat(64),
    qa_report_sha256: "6".repeat(64),
    rights_ledger_sha256: "7".repeat(64),
    source_evidence_sha256: "8".repeat(64),
    candidate_revision_sha256: "9".repeat(64),
    admission_evidence_sha256: sha(packet),
    standby_authorised: standby,
    standby_authorisation_event_id:
      standby ? "standby-event-1" : null,
    standby_authorisation_sha256:
      standby ? "a".repeat(64) : null,
    admission: packet,
  };
}

function fixture(t) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO stories (id, title) VALUES (?, ?), (?, ?)",
  ).run(
    "primary-story",
    "Primary",
    "reserve-story",
    "Reserve",
  );
  const jobs = jobsRepository.bind(db);
  const primaryPacket = admission("primary-story");
  const reservePacket = admission("reserve-story");
  const admissionJob = jobs.enqueue({
    kind: "admit_governed_publication",
    story_id: "primary-story",
    status: "pending",
    run_at: "2026-07-28T17:45:00.000Z",
    idempotency_key:
      `admit:youtube:breaking_short:primary-story:${"9".repeat(64)}:` +
      SCHEDULED_FOR,
    payload: {
      story_id: "primary-story",
      candidate_revision_sha256: "9".repeat(64),
      admission: primaryPacket,
    },
  });
  const runway = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      candidate("primary-story", false, primaryPacket),
      candidate("reserve-story", true, reservePacket),
    ],
    admission_jobs: [admissionJob],
  });
  assert.equal(runway.verdict, "GREEN");
  const lock = runway.lock;
  const primaryJobs = [
    [
      "verify_governed_youtube_release_tminus15",
      "2026-07-28T18:45:00.000Z",
      1,
    ],
    [
      "verify_governed_youtube_release_t0",
      SCHEDULED_FOR,
      0,
    ],
  ].map(([kind, runAt, priority]) =>
    jobs.enqueue({
      kind,
      story_id: "primary-story",
      priority,
      run_at: runAt,
      idempotency_key: `primary-chain:${kind}`,
      payload: {
        story_id: "primary-story",
        scheduled_for: SCHEDULED_FOR,
        runway_lock_sha256: lock.lock_sha256,
      },
    }),
  );
  const ledger = db
    .prepare(
      `INSERT INTO platform_dispatch_ledger
         (story_id, platform, idempotency_key, event_type,
          retryability_class, verification_status,
          verification_evidence_json)
       VALUES (?, 'youtube', ?, 'DISPATCH_FAILED_BEFORE_CREATE',
               'retryable_after_operator_review',
               'requires_reconciliation', '{}')
       RETURNING *`,
    )
    .get(
      "primary-story",
      "primary-precreate-failure",
    );
  db.prepare(
    `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state, external_id,
        verification_status, last_event_id)
     VALUES (?, 'youtube', 'DISPATCH_FAILED_BEFORE_CREATE',
             NULL, 'requires_reconciliation', ?)`,
  ).run("primary-story", ledger.id);
  const governance = {
    getState(storyId, platform) {
      return db
        .prepare(
          `SELECT *
           FROM platform_publication_state
           WHERE story_id = ? AND platform = ?`,
        )
        .get(storyId, platform);
    },
    recordOperatorDecision(input) {
      const existing = db
        .prepare(
          `SELECT *
           FROM operator_audit_log
           WHERE idempotency_key = ?`,
        )
        .get(input.idempotencyKey);
      if (existing) return existing;
      return db
        .prepare(
          `INSERT INTO operator_audit_log
             (actor_id, action, target_type, target_id,
              decision, reason, evidence_json,
              idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .get(
          input.actorId,
          input.action,
          input.targetType,
          input.targetId,
          input.decision,
          input.reason,
          JSON.stringify(input.evidence),
          input.idempotencyKey,
        );
    },
  };
  const failureBody = {
    classification: "DISPATCH_FAILED_BEFORE_CREATE",
    story_id: "primary-story",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    runway_lock_sha256: lock.lock_sha256,
    ledger_event_id: Number(ledger.id),
    ledger_idempotency_key: ledger.idempotency_key,
    platform_contacted: false,
    uncertain_external_creation: false,
    external_id: null,
  };
  const primaryFailure = {
    ...failureBody,
    failure_event_sha256: canonicalSha256(failureBody),
  };
  const built =
    buildGovernedYoutubeReservePromotionEvidence({
      now: "2026-07-28T17:50:00.000Z",
      lock,
      primary_failure: primaryFailure,
    });
  assert.equal(built.verdict, "GREEN");
  const artifactBody = {
    schema_version:
      "pulse-governed-youtube-reserve-admission-packet-v1",
    scheduled_for: SCHEDULED_FOR,
    runway_lock_sha256: lock.lock_sha256,
    story_id: "reserve-story",
    candidate_revision_sha256:
      lock.reserve.candidate_revision_sha256,
    admission_packet_sha256: sha(reservePacket),
    admission: reservePacket,
  };
  return {
    db,
    repos: {
      db,
      jobs,
      stories: {
        get(id) {
          return db
            .prepare("SELECT * FROM stories WHERE id = ?")
            .get(id);
        },
      },
      publicationGovernance: governance,
    },
    jobs,
    lock,
    primaryJobs,
    primaryFailure,
    promotion: built.promotion,
    reserveAdmissionArtifact: {
      ...artifactBody,
      artifact_sha256: sha(artifactBody),
    },
  };
}

function fakeAdmission(repos, { failAfterCancel = false } = {}) {
  return async (input) => {
    const transaction = repos.db.transaction(() => {
      input.transactionBoundaryCheck();
      if (failAfterCancel) {
        throw new Error("simulated_crash_after_primary_cancel");
      }
      const specs = [
        [
          "prestage_governed_youtube_release",
          input.dispatchJob.prestageRunAt,
          1,
        ],
        [
          "verify_governed_youtube_release_tminus15",
          "2026-07-28T18:45:00.000Z",
          1,
        ],
        [
          "verify_governed_youtube_release_t0",
          SCHEDULED_FOR,
          0,
        ],
      ];
      const releaseJobs = specs.map(
        ([kind, runAt, priority]) => {
          const row = repos.jobs.enqueueInTransaction({
            kind,
            story_id: "reserve-story",
            priority,
            run_at: runAt,
            idempotency_key: `reserve-chain:${kind}`,
            payload: {
              story_id: "reserve-story",
              scheduled_for: SCHEDULED_FOR,
              runway_lock_sha256:
                input.runwayLockSha256,
            },
          });
          return {
            id: row.id,
            kind,
            run_at: runAt,
            status: row.status,
            payload: {
              story_id: "reserve-story",
              scheduled_for: SCHEDULED_FOR,
              runway_lock_sha256:
                input.runwayLockSha256,
            },
          };
        },
      );
      input.transactionCompletionCheck({
        releaseJobs,
      });
      return {
        admitted: true,
        scheduled_event_id: 999,
        release_jobs: releaseJobs,
      };
    });
    return transaction.immediate();
  };
}

function confirmPrimaryRemoteDisarm(
  f,
  {
    verificationEvidenceOverrides = {},
    ledgerExternalId = null,
    stateExternalId = "youtube-primary-object",
  } = {},
) {
  const externalId = "youtube-primary-object";
  const verificationEvidence = {
    schema_version: "pulse-youtube-schedule-disarm-proof-v1",
    platform_object_confirmed: true,
    schedule_disarm_confirmed: true,
    external_id: externalId,
    privacy_status: "private",
    publish_at: null,
    checked_at: "2026-07-28T18:04:00.000Z",
    scheduled_for: SCHEDULED_FOR,
    runway_lock_sha256: f.lock.lock_sha256,
    ...verificationEvidenceOverrides,
  };
  const ledger = f.db
    .prepare(
      `INSERT INTO platform_dispatch_ledger
         (story_id, platform, idempotency_key, event_type,
          external_id, retryability_class,
          verification_status, verification_evidence_json)
       VALUES (?, 'youtube', ?, 'SCHEDULE_DISARM_CONFIRMED',
               ?, 'not_retryable',
               'confirmed_private_unscheduled', ?)
       RETURNING *`,
    )
    .get(
      "primary-story",
      "primary-schedule-disarm-confirmed",
      ledgerExternalId,
      JSON.stringify(verificationEvidence),
    );
  f.db
    .prepare(
      `UPDATE platform_publication_state
       SET lifecycle_state = 'PLATFORM_SCHEDULE_DISARMED',
           external_id = ?,
           verification_status =
             'confirmed_private_unscheduled',
           last_event_id = ?
       WHERE story_id = 'primary-story'
         AND platform = 'youtube'`,
    )
    .run(stateExternalId, ledger.id);
  return ledger;
}

test("reserve promotion atomically rolls back primary cancellation and promotion audit on injected admission crash", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    promoteGovernedYoutubeReserveRelease({
      repos: f.repos,
      lock: f.lock,
      primaryFailure: f.primaryFailure,
      promotion: f.promotion,
      reserveAdmissionArtifact:
        f.reserveAdmissionArtifact,
      now: "2026-07-28T17:50:00.000Z",
      admitPublication: fakeAdmission(f.repos, {
        failAfterCancel: true,
      }),
    }),
    /simulated_crash_after_primary_cancel/,
  );
  assert.deepEqual(
    f.primaryJobs.map(
      (row) => f.jobs.get(row.id).status,
    ),
    ["pending", "pending"],
  );
  assert.equal(
    f.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM operator_audit_log
         WHERE action =
           'governed_youtube_reserve_promotion'`,
      )
      .get().count,
    0,
  );
});

test("decisive zero-contact failure leaves exactly one active reserve T70/T15/T0 chain", async (t) => {
  const f = fixture(t);
  const currentPrimaryT70 = f.jobs.enqueue({
    kind: "prestage_governed_youtube_release",
    story_id: "primary-story",
    priority: 1,
    run_at: "2026-07-28T17:50:00.000Z",
    idempotency_key: "primary-current-t70",
    payload: {
      story_id: "primary-story",
      scheduled_for: SCHEDULED_FOR,
      runway_lock_sha256: f.lock.lock_sha256,
    },
  });
  f.db
    .prepare(
      `UPDATE jobs
       SET status = 'running',
           claimed_by = 'current-t70-worker',
           claimed_at = datetime('now'),
           lease_until = datetime('now', '+5 minutes')
       WHERE id = ?`,
    )
    .run(currentPrimaryT70.id);
  const result =
    await promoteGovernedYoutubeReserveRelease({
      repos: f.repos,
      lock: f.lock,
      primaryFailure: f.primaryFailure,
      promotion: f.promotion,
      reserveAdmissionArtifact:
        f.reserveAdmissionArtifact,
      now: "2026-07-28T17:50:00.000Z",
      admitPublication: fakeAdmission(f.repos),
    });
  assert.equal(result.promoted, true);
  assert.equal(
    f.jobs.get(currentPrimaryT70.id).status,
    "running",
  );
  assert.deepEqual(
    f.primaryJobs.map(
      (row) => f.jobs.get(row.id).status,
    ),
    ["cancelled", "cancelled"],
  );
  assert.deepEqual(
    result.reserve_release_jobs.map((row) => row.kind),
    [
      "prestage_governed_youtube_release",
      "verify_governed_youtube_release_tminus15",
      "verify_governed_youtube_release_t0",
    ],
  );
  assert.equal(
    f.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE status IN ('pending', 'claimed', 'running')
           AND story_id = 'primary-story'
           AND kind IN (
             'verify_governed_youtube_release_tminus15',
             'verify_governed_youtube_release_t0'
           )`,
      )
      .get().count,
    0,
  );
  assert.equal(
    f.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE status = 'pending'
           AND story_id = 'reserve-story'
           AND kind IN (
             'prestage_governed_youtube_release',
             'verify_governed_youtube_release_tminus15',
             'verify_governed_youtube_release_t0'
           )`,
      )
      .get().count,
    3,
  );
});

test("durably confirmed exact remote disarm promotes one reserve chain in the same window", async (t) => {
  const f = fixture(t);
  const ledger = confirmPrimaryRemoteDisarm(f);
  const canonical =
    resolveCanonicalPrimaryConfirmedDisarm(
      f.repos,
      f.lock,
    );
  assert.equal(canonical.eligible, true);
  assert.equal(
    canonical.ledger.idempotency_key,
    ledger.idempotency_key,
  );
  const built =
    buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
      now: "2026-07-28T18:05:00.000Z",
      lock: f.lock,
      primary_disarm: canonical.primary_disarm,
    });
  assert.equal(built.verdict, "GREEN");

  const result =
    await promoteGovernedYoutubeReserveRelease({
      repos: f.repos,
      lock: f.lock,
      primaryDisarm: canonical.primary_disarm,
      promotion: built.promotion,
      reserveAdmissionArtifact:
        f.reserveAdmissionArtifact,
      now: "2026-07-28T18:05:00.000Z",
      admitPublication: fakeAdmission(f.repos),
    });

  assert.equal(result.promoted, true);
  assert.deepEqual(
    f.primaryJobs.map(
      (row) => f.jobs.get(row.id).status,
    ),
    ["cancelled", "cancelled"],
  );
  assert.deepEqual(
    result.reserve_release_jobs.map((row) => row.kind),
    [
      "prestage_governed_youtube_release",
      "verify_governed_youtube_release_tminus15",
      "verify_governed_youtube_release_t0",
    ],
  );
  assert.equal(
    result.promotion.authority_type,
    "CONFIRMED_DISARM_FAILOVER",
  );
});

test("confirmed-disarm promotion replay and concurrent attempts converge on one reserve chain", async (t) => {
  const f = fixture(t);
  confirmPrimaryRemoteDisarm(f);
  const canonical =
    resolveCanonicalPrimaryConfirmedDisarm(
      f.repos,
      f.lock,
    );
  const built =
    buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
      now: "2026-07-28T18:05:00.000Z",
      lock: f.lock,
      primary_disarm: canonical.primary_disarm,
    });
  const input = {
    repos: f.repos,
    lock: f.lock,
    primaryDisarm: canonical.primary_disarm,
    promotion: built.promotion,
    reserveAdmissionArtifact:
      f.reserveAdmissionArtifact,
    now: "2026-07-28T18:05:00.000Z",
    admitPublication: fakeAdmission(f.repos),
  };

  const [first, replay] = await Promise.all([
    promoteGovernedYoutubeReserveRelease(input),
    promoteGovernedYoutubeReserveRelease(input),
  ]);

  assert.equal(first.promoted, true);
  assert.equal(replay.promoted, true);
  assert.equal(
    f.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE story_id = 'reserve-story'
           AND status IN ('pending', 'claimed', 'running')
           AND kind IN (
             'prestage_governed_youtube_release',
             'verify_governed_youtube_release_tminus15',
             'verify_governed_youtube_release_t0'
           )`,
      )
      .get().count,
    3,
  );
  assert.equal(
    f.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM operator_audit_log
         WHERE action =
           'governed_youtube_reserve_promotion'`,
      )
      .get().count,
    1,
  );
});

test("durable recovery fence refuses reconciliation and non-exact disarm ledgers without touching the primary chain", async (t) => {
  const cases = [
    {
      name: "reconciliation state",
      mutate(f) {
        f.db
          .prepare(
            `UPDATE platform_publication_state
             SET lifecycle_state =
               'RECONCILIATION_REQUIRED'
             WHERE story_id = 'primary-story'
               AND platform = 'youtube'`,
          )
          .run();
      },
      expected:
        "runway_primary_confirmed_disarm_state_required",
    },
    {
      name: "publishAt still present",
      confirm: {
        verificationEvidenceOverrides: {
          publish_at: SCHEDULED_FOR,
        },
      },
      expected:
        "runway_primary_confirmed_disarm_ledger_binding_required",
    },
    {
      name: "external identity mismatch",
      confirm: {
        stateExternalId: "different-youtube-object",
      },
      expected:
        "runway_primary_confirmed_disarm_ledger_binding_required",
    },
    {
      name: "window mismatch",
      confirm: {
        verificationEvidenceOverrides: {
          scheduled_for:
            "2026-07-29T19:00:00.000Z",
        },
      },
      expected:
        "runway_primary_confirmed_disarm_ledger_binding_required",
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async (st) => {
      const f = fixture(st);
      const ledger = confirmPrimaryRemoteDisarm(
        f,
        item.confirm,
      );
      item.mutate?.(f);
      const proofBody = {
        classification: "CONFIRMED_DISARM_FAILOVER",
        story_id: "primary-story",
        platform: "youtube",
        scheduled_for: SCHEDULED_FOR,
        runway_lock_sha256: f.lock.lock_sha256,
        lifecycle_state:
          "PLATFORM_SCHEDULE_DISARMED",
        external_id: "youtube-primary-object",
        verified_external_id:
          "youtube-primary-object",
        ledger_event_id: Number(ledger.id),
        ledger_idempotency_key:
          ledger.idempotency_key,
        disarm_ledger_event_sha256:
          canonicalDisarmLedgerEventSha256(ledger),
        privacy_status: "private",
        publish_at: null,
        verification_uncertain: false,
        reconciliation_required: false,
      };
      const primaryDisarm = {
        ...proofBody,
        disarm_event_sha256:
          canonicalSha256(proofBody),
      };
      const built =
        buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence(
          {
            now: "2026-07-28T18:05:00.000Z",
            lock: f.lock,
            primary_disarm: primaryDisarm,
          },
        );
      assert.equal(built.verdict, "GREEN");

      await assert.rejects(
        promoteGovernedYoutubeReserveRelease({
          repos: f.repos,
          lock: f.lock,
          primaryDisarm,
          promotion: built.promotion,
          reserveAdmissionArtifact:
            f.reserveAdmissionArtifact,
          now: "2026-07-28T18:05:00.000Z",
          admitPublication: fakeAdmission(f.repos),
        }),
        new RegExp(item.expected),
      );
      assert.deepEqual(
        f.primaryJobs.map(
          (row) => f.jobs.get(row.id).status,
        ),
        ["pending", "pending"],
      );
      assert.equal(
        f.db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM jobs
             WHERE story_id = 'reserve-story'
               AND kind =
                 'prestage_governed_youtube_release'`,
          )
          .get().count,
        0,
      );
    });
  }
});

test("confirmed-disarm promotion cannot reuse an earlier authority at or after T-15", async (t) => {
  const f = fixture(t);
  confirmPrimaryRemoteDisarm(f);
  const canonical =
    resolveCanonicalPrimaryConfirmedDisarm(
      f.repos,
      f.lock,
    );
  const built =
    buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence({
      now: "2026-07-28T18:05:00.000Z",
      lock: f.lock,
      primary_disarm: canonical.primary_disarm,
    });

  const result =
    await promoteGovernedYoutubeReserveRelease({
      repos: f.repos,
      lock: f.lock,
      primaryDisarm: canonical.primary_disarm,
      promotion: built.promotion,
      reserveAdmissionArtifact:
        f.reserveAdmissionArtifact,
      now: "2026-07-28T18:45:00.000Z",
      admitPublication: fakeAdmission(f.repos),
    });

  assert.equal(result.promoted, false);
  assert.ok(
    result.blockers.includes(
      "runway_confirmed_disarm_promotion_deadline_expired",
    ),
  );
  assert.deepEqual(
    f.primaryJobs.map(
      (row) => f.jobs.get(row.id).status,
    ),
    ["pending", "pending"],
  );
});

test("promotion refuses ambiguous or platform-contacted failures without cancelling primary jobs", async (t) => {
  const f = fixture(t);
  const contactedBody = {
    ...f.primaryFailure,
    platform_contacted: true,
  };
  delete contactedBody.failure_event_sha256;
  const contacted = {
    ...contactedBody,
    failure_event_sha256:
      canonicalSha256(contactedBody),
  };
  const result =
    await promoteGovernedYoutubeReserveRelease({
      repos: f.repos,
      lock: f.lock,
      primaryFailure: contacted,
      promotion: f.promotion,
      reserveAdmissionArtifact:
        f.reserveAdmissionArtifact,
      now: "2026-07-28T17:50:00.000Z",
      admitPublication: fakeAdmission(f.repos),
    });
  assert.equal(result.promoted, false);
  assert.ok(
    result.blockers.includes(
      "runway_primary_failure_external_contact_not_zero",
    ),
  );
  assert.deepEqual(
    f.primaryJobs.map(
      (row) => f.jobs.get(row.id).status,
    ),
    ["pending", "pending"],
  );
});
