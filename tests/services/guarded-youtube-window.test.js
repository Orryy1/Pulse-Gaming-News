"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertGuardedSqliteTransactionBoundary,
  executeGuardedYoutubeWindow,
  inspectGuardedYoutubeDatabase,
  renderGuardedYoutubeWindowMarkdown,
  validateBackupEvidence,
} = require("../../lib/ops/guarded-youtube-window");
const {
  sqliteMutationBoundaryBlockers,
} = require("../../lib/ops/stabilisation-cutover-reconcile");
const {
  fingerprintOutsideCadenceAuthorisation,
} = require("../../lib/services/publication-admission");

const STORY_ID = "official_d86953ca92ca";
const NOW = "2026-07-27T19:02:00.000Z";
const SCHEDULED_FOR = "2026-07-27T19:00:00.000Z";
const MEDIA_SHA = "1".repeat(64);
const SCRIPT_SHA = "2".repeat(64);
const REQUEST_SHA = "3".repeat(64);
const RENDERER_SHA = "4".repeat(64);
const SOURCE_SHA = "5".repeat(64);
const DATABASE_SHA = "6".repeat(64);
const COMMIT_SHA = "a".repeat(40);
const DISPATCH_KEY = `youtube:${STORY_ID}:${SCHEDULED_FOR}`;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createCheckpointedWalDatabase(databasePath) {
  const Database = require("better-sqlite3");
  const db = new Database(databasePath);
  db.exec(
    `CREATE TABLE boundary_probe (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       value TEXT NOT NULL
     )`,
  );
  db.pragma("journal_mode = WAL");
  db.pragma("wal_autocheckpoint = 0");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  return sha256(fs.readFileSync(databasePath));
}

function liveEnv(patch = {}) {
  return {
    NODE_ENV: "test",
    CHANNEL: "pulse-gaming",
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    TIKTOK_ENABLED: "false",
    TIKTOK_AUTO_PUBLISH: "false",
    INSTAGRAM_AUTO_PUBLISH: "false",
    FACEBOOK_AUTO_PUBLISH: "false",
    TWITTER_ENABLED: "false",
    X_AUTO_PUBLISH: "false",
    THREADS_AUTO_PUBLISH: "false",
    PINTEREST_AUTO_PUBLISH: "false",
    SQLITE_DB_PATH: "C:\\data\\pulse.db",
    ...patch,
  };
}

function reviewResult(patch = {}) {
  return {
    schema_version: "pulse-governed-publication-review-result-v1",
    generated_at: "2026-07-27T18:45:00.000Z",
    mode: "APPLY",
    verdict: "APPLIED",
    mutated: true,
    idempotent: false,
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    script_sha256: SCRIPT_SHA,
    media_sha256: MEDIA_SHA,
    review_manifest_sha256: "b".repeat(64),
    preflight_evidence: {
      schema_version: "pulse-publication-review-evidence-v1",
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      script_sha256: SCRIPT_SHA,
      media_sha256: MEDIA_SHA,
      source_evidence_sha256: SOURCE_SHA,
      qa_report_sha256: "7".repeat(64),
      rights_ledger_sha256: "8".repeat(64),
      originality_transformation: {
        verdict: "PASS",
        rationale: "Transformative narrated analysis",
      },
      synthetic_media_disclosure: "Altered or synthetic content",
      renderer_manifest_sha256: RENDERER_SHA,
      renderer_manifest: {
        schema_version: "pulse-renderer-manifest-v1",
        story_id: STORY_ID,
        channel_id: "pulse-gaming",
      },
    },
    blockers: [],
    safety: {
      lifecycle_admission_performed: false,
      external_calls: [],
      uploads_performed: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
    },
    ...patch,
  };
}

function scheduledRow(storyId = STORY_ID, patch = {}) {
  return {
    story_id: storyId,
    platform: "youtube",
    lifecycle_state: "SCHEDULED",
    scheduled_event_id: 90,
    evidence: {
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at: "2026-07-27T18:59:30.000Z",
      scheduled_for: SCHEDULED_FOR,
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key:
        storyId === STORY_ID
          ? DISPATCH_KEY
          : `youtube:${storyId}:${SCHEDULED_FOR}`,
      request_fingerprint: REQUEST_SHA,
      publication_evidence: {
        source_evidence_sha256: SOURCE_SHA,
        renderer_manifest_sha256: RENDERER_SHA,
      },
      ...patch,
    },
  };
}

function persistedOutsideCadenceAuthorisation({
  scheduledFor,
  authorisationId,
  authorisedAt,
  dispatchKey,
  requestFingerprint = REQUEST_SHA,
  patch = {},
}) {
  const payload = {
    schema_version: "pulse-outside-cadence-authorisation-v1",
    authorisation_id: authorisationId,
    confirmed_authorisation_id: authorisationId,
    one_shot: true,
    basis: "explicit_operator_goal_authorisation",
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    platform: "youtube",
    scheduled_for: scheduledFor,
    authorised_at: authorisedAt,
    dispatch_idempotency_key: dispatchKey,
    request_fingerprint: requestFingerprint,
    ...patch,
  };
  return {
    ...payload,
    binding_sha256:
      fingerprintOutsideCadenceAuthorisation(payload),
  };
}

function baseSnapshot(patch = {}) {
  return {
    database_path: "C:\\data\\pulse.db",
    database_sha256: DATABASE_SHA,
    schema_ready: true,
    story: {
      id: STORY_ID,
      channel_id: "pulse-gaming",
      approved: true,
      auto_approved: false,
      exported_path: "C:\\media\\final.mp4",
      full_script: "Exact reviewed script",
      youtube_post_id: null,
      youtube_url: null,
      publish_status: null,
      qa_failed: false,
    },
    review_binding: {
      render_review_status: "approved",
      review_manifest_sha256: "b".repeat(64),
      preflight_evidence: reviewResult().preflight_evidence,
      immutable_audit_found: true,
      audit_evidence: {
        review_manifest_sha256: "b".repeat(64),
        script_sha256: SCRIPT_SHA,
        media_sha256: MEDIA_SHA,
        source_evidence: { sha256: SOURCE_SHA },
        renderer_manifest: { canonical_sha256: RENDERER_SHA },
      },
    },
    scheduled_rows: [],
    lifecycle_by_state: {},
    active_runtime_lease_count: 0,
    running_job_count: 0,
    active_worker_count: 0,
    published: null,
    ...patch,
  };
}

function commonOptions(action, dependencies = {}, patch = {}) {
  return {
    action,
    storyId: STORY_ID,
    confirmStoryId: STORY_ID,
    scheduledFor: SCHEDULED_FOR,
    confirmScheduledFor: SCHEDULED_FOR,
    confirmMediaSha256: MEDIA_SHA,
    confirmScriptSha256: SCRIPT_SHA,
    confirmRequestFingerprint: REQUEST_SHA,
    confirmRendererManifestSha256: RENDERER_SHA,
    confirmSourceEvidenceSha256: SOURCE_SHA,
    confirmDispatchKey: DISPATCH_KEY,
    expectedSourceCommit: COMMIT_SHA,
    expectedRuntimeCommit: COMMIT_SHA,
    actorId: "pulse-release-operator",
    confirmActorId: "pulse-release-operator",
    reason: "Approved one-window YouTube release",
    confirmReason: "Approved one-window YouTube release",
    changeWindowId: "pulse-youtube-20260727-1900",
    confirmChangeWindowId: "pulse-youtube-20260727-1900",
    confirmSupervisorStopped: true,
    confirmWorkersStopped: true,
    confirmLiveYoutubeDispatch: action === "dispatch",
    databasePath: "C:\\data\\pulse.db",
    backupEvidencePath: "C:\\proof\\backup.json",
    publicationReviewResultPath: "C:\\proof\\review.json",
    generatedAt: NOW,
    env: liveEnv(),
    dependencies: {
      readReviewResult: () => reviewResult(),
      validateBackupEvidence: () => ({
        valid: true,
        blockers: [],
        evidence: {
          source_database_path: "C:\\data\\pulse.db",
          source_database_sha256: DATABASE_SHA,
          verified_at: "2026-07-27T18:50:00.000Z",
        },
      }),
      resolveRuntimeBuildInfo: () => ({ commit_sha: COMMIT_SHA }),
      fingerprintPublicationRequest: async () => ({
        media_sha256: MEDIA_SHA,
        script_sha256: SCRIPT_SHA,
        request_fingerprint: REQUEST_SHA,
      }),
      mutationBoundaryBlockers: () => [],
      assertTransactionBoundary: () => 7,
      readDatabaseDataVersion: () => {
        throw new Error("post_transaction_data_version_read_forbidden");
      },
      ...dependencies,
    },
    ...patch,
  };
}

test("inspect is the default read-only lane and reports the exact review as ready to admit", async () => {
  let admissions = 0;
  let dispatches = 0;
  const result = await executeGuardedYoutubeWindow(
    commonOptions("inspect", {
      inspectDatabase: () => baseSnapshot(),
      admitPublication: async () => {
        admissions += 1;
      },
      publishNextStory: async () => {
        dispatches += 1;
      },
    }),
  );

  assert.equal(result.action, "inspect");
  assert.equal(result.verdict, "READY_TO_ADMIT");
  assert.equal(result.mutated, false);
  assert.equal(admissions, 0);
  assert.equal(dispatches, 0);
  assert.equal(result.selection_binding.story_id, STORY_ID);
  assert.equal(result.safety.platforms_contacted, false);
});

test("inspect exposes the computed exact confirmations without weakening the hold", async () => {
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "inspect",
      {
        inspectDatabase: () => baseSnapshot(),
      },
      {
        confirmMediaSha256: undefined,
        confirmScriptSha256: undefined,
        confirmRequestFingerprint: undefined,
        confirmRendererManifestSha256: undefined,
        confirmSourceEvidenceSha256: undefined,
        confirmDispatchKey: undefined,
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.deepEqual(result.expected_confirmations, {
    story_id: STORY_ID,
    scheduled_for: SCHEDULED_FOR,
    media_sha256: MEDIA_SHA,
    script_sha256: SCRIPT_SHA,
    request_fingerprint: REQUEST_SHA,
    renderer_manifest_sha256: RENDERER_SHA,
    source_evidence_sha256: SOURCE_SHA,
    dispatch_idempotency_key: DISPATCH_KEY,
  });
  assert.equal(result.request_fingerprint, REQUEST_SHA);
  assert.ok(result.blockers.includes("current_request_fingerprint_mismatch"));
  assert.equal(result.safety.platforms_contacted, false);
});

test("inspect accepts only an exact one-shot authorisation outside normal cadence", async () => {
  const scheduledFor = "2026-07-27T18:58:00.000Z";
  const authorisationId = "thread-019f6282-asap-youtube-one-shot";
  const dispatchKey = `youtube:${STORY_ID}:${scheduledFor}`;
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "inspect",
      {
        inspectDatabase: () => baseSnapshot(),
      },
      {
        scheduledFor,
        confirmScheduledFor: scheduledFor,
        confirmDispatchKey: dispatchKey,
        generatedAt: "2026-07-27T18:57:30.000Z",
        outsideCadenceAuthorisationId: authorisationId,
        confirmOutsideCadenceAuthorisationId: authorisationId,
        confirmOutsideCadenceOneShot: true,
      },
    ),
  );

  assert.equal(result.verdict, "READY_TO_ADMIT");
  assert.deepEqual(result.expected_confirmations, {
    story_id: STORY_ID,
    scheduled_for: scheduledFor,
    media_sha256: MEDIA_SHA,
    script_sha256: SCRIPT_SHA,
    request_fingerprint: REQUEST_SHA,
    renderer_manifest_sha256: RENDERER_SHA,
    source_evidence_sha256: SOURCE_SHA,
    dispatch_idempotency_key: dispatchKey,
    outside_cadence_authorisation_id: authorisationId,
    outside_cadence_one_shot: true,
  });
  assert.equal(result.safety.platforms_contacted, false);
});

test("inspect rejects an outside-cadence schedule without exact one-shot authorisation", async () => {
  const scheduledFor = "2026-07-27T18:58:00.000Z";
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "inspect",
      {
        inspectDatabase: () => baseSnapshot(),
      },
      {
        scheduledFor,
        confirmScheduledFor: scheduledFor,
        confirmDispatchKey: `youtube:${STORY_ID}:${scheduledFor}`,
        generatedAt: "2026-07-27T18:57:30.000Z",
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("schedule_outside_guarded_youtube_windows"),
  );
  assert.ok(
    result.blockers.includes("outside_cadence_authorisation_required"),
  );
  assert.equal(result.mutated, false);
});

test("inspect binds outside-cadence authorisation to the immutable scheduled row", async () => {
  const scheduledFor = "2026-07-27T18:58:00.000Z";
  const authorisationId = "thread-authorisation-current";
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "inspect",
      {
        inspectDatabase: () =>
          baseSnapshot({
            scheduled_rows: [
              scheduledRow(STORY_ID, {
                scheduled_for: scheduledFor,
                control_tower_checked_at:
                  "2026-07-27T18:58:00.000Z",
                dispatch_idempotency_key:
                  `youtube:${STORY_ID}:${scheduledFor}`,
                outside_cadence_authorisation: {
                  authorisation_id: "thread-authorisation-stale",
                  one_shot: true,
                  basis: "explicit_operator_goal_authorisation",
                },
              }),
            ],
            lifecycle_by_state: {
              SCRIPT_READY: { script_sha256: SCRIPT_SHA },
              RENDERED: {
                media_sha256: MEDIA_SHA,
                renderer_manifest_sha256: RENDERER_SHA,
              },
            },
          }),
      },
      {
        scheduledFor,
        confirmScheduledFor: scheduledFor,
        confirmDispatchKey: `youtube:${STORY_ID}:${scheduledFor}`,
        generatedAt: "2026-07-27T18:58:30.000Z",
        outsideCadenceAuthorisationId: authorisationId,
        confirmOutsideCadenceAuthorisationId: authorisationId,
        confirmOutsideCadenceOneShot: true,
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "scheduled_outside_cadence_authorisation_mismatch",
    ),
  );
});

test("inspect rejects a legacy surface-only outside-cadence row the publisher would refuse", async () => {
  const scheduledFor = "2026-07-27T18:58:00.000Z";
  const authorisationId = "thread-authorisation-current";
  const dispatchKey = `youtube:${STORY_ID}:${scheduledFor}`;
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "inspect",
      {
        inspectDatabase: () =>
          baseSnapshot({
            scheduled_rows: [
              scheduledRow(STORY_ID, {
                scheduled_for: scheduledFor,
                control_tower_checked_at:
                  "2026-07-27T18:58:00.000Z",
                dispatch_idempotency_key: dispatchKey,
                outside_cadence_authorisation: {
                  authorisation_id: authorisationId,
                  one_shot: true,
                  basis: "explicit_operator_goal_authorisation",
                },
              }),
            ],
            lifecycle_by_state: {
              SCRIPT_READY: { script_sha256: SCRIPT_SHA },
              RENDERED: {
                media_sha256: MEDIA_SHA,
                renderer_manifest_sha256: RENDERER_SHA,
              },
            },
          }),
      },
      {
        scheduledFor,
        confirmScheduledFor: scheduledFor,
        confirmDispatchKey: dispatchKey,
        generatedAt: "2026-07-27T18:58:30.000Z",
        outsideCadenceAuthorisationId: authorisationId,
        confirmOutsideCadenceAuthorisationId: authorisationId,
        confirmOutsideCadenceOneShot: true,
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "scheduled_outside_cadence_authorisation_schema_invalid",
    ),
  );
});

test("inspect accepts the same fully bound outside-cadence row as the publisher", async () => {
  const scheduledFor = "2026-07-27T18:58:00.000Z";
  const authorisationId = "thread-authorisation-current";
  const dispatchKey = `youtube:${STORY_ID}:${scheduledFor}`;
  const authorisation = persistedOutsideCadenceAuthorisation({
    scheduledFor,
    authorisationId,
    authorisedAt: "2026-07-27T18:57:30.000Z",
    dispatchKey,
  });
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "inspect",
      {
        inspectDatabase: () =>
          baseSnapshot({
            scheduled_rows: [
              scheduledRow(STORY_ID, {
                scheduled_for: scheduledFor,
                control_tower_checked_at:
                  "2026-07-27T18:58:00.000Z",
                dispatch_idempotency_key: dispatchKey,
                outside_cadence_authorisation: authorisation,
              }),
            ],
            lifecycle_by_state: {
              SCRIPT_READY: { script_sha256: SCRIPT_SHA },
              RENDERED: {
                media_sha256: MEDIA_SHA,
                renderer_manifest_sha256: RENDERER_SHA,
              },
            },
          }),
      },
      {
        scheduledFor,
        confirmScheduledFor: scheduledFor,
        confirmDispatchKey: dispatchKey,
        generatedAt: "2026-07-27T18:58:30.000Z",
        outsideCadenceAuthorisationId: authorisationId,
        confirmOutsideCadenceAuthorisationId: authorisationId,
        confirmOutsideCadenceOneShot: true,
      },
    ),
  );

  assert.equal(result.verdict, "READY_TO_DISPATCH");
  assert.deepEqual(result.blockers, []);
});

test("production execution rejects an injected guarded clock", async () => {
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "inspect",
      {
        inspectDatabase: () => baseSnapshot(),
      },
      {
        env: liveEnv({ NODE_ENV: "production" }),
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("operator_generated_at_forbidden"));
  assert.notEqual(result.generated_at, NOW);
});

test("admit invokes existing admission at most once, then proves the exact SCHEDULED row", async () => {
  let inspections = 0;
  let admissions = 0;
  let dispatches = 0;
  const result = await executeGuardedYoutubeWindow(
    commonOptions("admit", {
      inspectDatabase: () => {
        inspections += 1;
        return inspections === 1
          ? baseSnapshot()
          : baseSnapshot({
              scheduled_rows: [scheduledRow()],
              lifecycle_by_state: {
                SCRIPT_READY: { script_sha256: SCRIPT_SHA },
                RENDERED: {
                  media_sha256: MEDIA_SHA,
                  renderer_manifest_sha256: RENDERER_SHA,
                },
              },
            });
      },
      openRepositories: () => ({
        repos: { db: {}, stories: {}, publicationGovernance: {} },
        close() {},
      }),
      admitPublication: async () => {
        admissions += 1;
        return {
          admitted: true,
          story_id: STORY_ID,
          scheduled_for: SCHEDULED_FOR,
          dispatch_idempotency_key: DISPATCH_KEY,
          request_fingerprint: REQUEST_SHA,
          media_sha256: MEDIA_SHA,
          script_sha256: SCRIPT_SHA,
          renderer_manifest_sha256: RENDERER_SHA,
          lifecycle_state: "SCHEDULED",
          blockers: [],
        };
      },
      publishNextStory: async () => {
        dispatches += 1;
      },
    }),
  );

  assert.equal(result.verdict, "ADMITTED");
  assert.equal(result.mutated, true);
  assert.equal(admissions, 1);
  assert.equal(dispatches, 0);
  assert.equal(inspections, 2);
  assert.equal(result.scheduled_candidate.story_id, STORY_ID);
  assert.equal(result.safety.platforms_contacted, false);
});

test("admit rejects a WAL created after pre-open validation before admission can mutate", async (t) => {
  const Database = require("better-sqlite3");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-admit-wal-race-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "pulse.db");
  const databaseSha = createCheckpointedWalDatabase(databasePath);
  let admissions = 0;

  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "admit",
      {
        inspectDatabase: () =>
          baseSnapshot({
            database_path: databasePath,
            database_sha256: databaseSha,
          }),
        validateBackupEvidence: () => ({
          valid: true,
          blockers: [],
          evidence: {
            source_database_path: databasePath,
            source_database_sha256: databaseSha,
            verified_at: "2026-07-27T18:50:00.000Z",
          },
        }),
        mutationBoundaryBlockers: sqliteMutationBoundaryBlockers,
        assertTransactionBoundary:
          assertGuardedSqliteTransactionBoundary,
        openRepositories: () => {
          const db = new Database(databasePath);
          db.prepare(
            "INSERT INTO boundary_probe (value) VALUES ('racing-wal')",
          ).run();
          return {
            repos: {
              db,
              stories: {},
              publicationGovernance: {},
            },
            close() {
              db.close();
            },
          };
        },
        admitPublication: async () => {
          admissions += 1;
          return { admitted: true, blockers: [] };
        },
      },
      {
        databasePath,
        env: liveEnv({ SQLITE_DB_PATH: databasePath }),
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_database_wal_not_checkpointed"));
  assert.equal(result.mutated, false);
  assert.equal(result.safety.platforms_contacted, false);
  assert.equal(admissions, 0);
});

test("admit rejects SHM-only source state at the strict pre-open boundary", async (t) => {
  const Database = require("better-sqlite3");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-admit-shm-"));
  const databasePath = path.join(root, "pulse.db");
  const databaseSha = createCheckpointedWalDatabase(databasePath);
  const reader = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  t.after(() => {
    reader.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  reader.prepare("SELECT COUNT(*) FROM boundary_probe").pluck().get();
  assert.equal(fs.statSync(`${databasePath}-wal`).size, 0);
  assert.ok(fs.statSync(`${databasePath}-shm`).size > 0);
  let repositoryOpens = 0;

  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "admit",
      {
        inspectDatabase: () =>
          baseSnapshot({
            database_path: databasePath,
            database_sha256: databaseSha,
          }),
        validateBackupEvidence: () => ({
          valid: true,
          blockers: [],
          evidence: {
            source_database_path: databasePath,
            source_database_sha256: databaseSha,
            verified_at: "2026-07-27T18:50:00.000Z",
          },
        }),
        mutationBoundaryBlockers: sqliteMutationBoundaryBlockers,
        openRepositories: () => {
          repositoryOpens += 1;
          throw new Error("must_not_open");
        },
      },
      {
        databasePath,
        env: liveEnv({ SQLITE_DB_PATH: databasePath }),
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("source_database_shared_memory_present"),
  );
  assert.equal(result.mutated, false);
  assert.equal(repositoryOpens, 0);
});

test("admit refuses any existing scheduled row without calling admission", async () => {
  let admissions = 0;
  const result = await executeGuardedYoutubeWindow(
    commonOptions("admit", {
      inspectDatabase: () =>
        baseSnapshot({
          scheduled_rows: [scheduledRow("other-story")],
        }),
      admitPublication: async () => {
        admissions += 1;
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("another_scheduled_youtube_row_present"));
  assert.equal(admissions, 0);
});

test("admit accepts only an exact newly APPLIED governed publication review", async () => {
  let admissions = 0;
  const options = commonOptions("admit", {
    inspectDatabase: () => baseSnapshot(),
    readReviewResult: () =>
      reviewResult({
        verdict: "IDEMPOTENT",
        mutated: false,
        idempotent: true,
      }),
    admitPublication: async () => {
      admissions += 1;
    },
  });
  const result = await executeGuardedYoutubeWindow(options);

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("applied_publication_review_required"));
  assert.equal(admissions, 0);
});

test("dispatch calls the real publisher boundary once and independently confirms publication", async () => {
  let inspections = 0;
  let dispatches = 0;
  let publisherOptions = null;
  const result = await executeGuardedYoutubeWindow(
    commonOptions("dispatch", {
      inspectDatabase: () => {
        inspections += 1;
        if (inspections === 1) {
          return baseSnapshot({
            scheduled_rows: [scheduledRow()],
            lifecycle_by_state: {
              SCRIPT_READY: { script_sha256: SCRIPT_SHA },
              RENDERED: {
                media_sha256: MEDIA_SHA,
                renderer_manifest_sha256: RENDERER_SHA,
              },
            },
          });
        }
        return baseSnapshot({
          story: {
            ...baseSnapshot().story,
            youtube_post_id: "yt_exact_123",
            youtube_url: "https://youtu.be/yt_exact_123",
          },
          scheduled_rows: [],
          published: {
            story_id: STORY_ID,
            lifecycle_state: "PUBLISHED",
            verification_status: "confirmed",
            verified_at: "2026-07-27T19:03:00.000Z",
            external_id: "yt_exact_123",
            external_url: "https://youtu.be/yt_exact_123",
            ledger_event_type: "PUBLISHED",
            ledger_verification_status: "confirmed",
            ledger_external_id: "yt_exact_123",
            ledger_external_url: "https://youtu.be/yt_exact_123",
          },
        });
      },
      openRepositories: () => ({
        repos: { db: {}, runtimeLeases: {} },
        close() {},
      }),
      publisherRuntimeDatabasePath: () => "C:\\data\\pulse.db",
      publishNextStory: async (options) => {
        dispatches += 1;
        publisherOptions = options;
        options.onYoutubeAuthTelemetry({
          schema_version: "pulse-youtube-auth-telemetry-v1",
          durable_oauth_or_token_mutated: false,
          ephemeral_access_token_refresh: {
            attempted: true,
            succeeded: true,
            failed: false,
          },
        });
        return {
          youtube: true,
          story_id: STORY_ID,
          dispatch_idempotency_key: DISPATCH_KEY,
          request_fingerprint: REQUEST_SHA,
          platform_outcomes: { youtube: "new_upload" },
        };
      },
    }),
  );

  assert.equal(result.verdict, "PUBLISHED_CONFIRMED");
  assert.equal(dispatches, 1);
  assert.equal(inspections, 2);
  assert.equal(result.publication.external_id, "yt_exact_123");
  assert.equal(result.publication.story_projection_confirmed, true);
  assert.equal(result.safety.platforms_contacted, true);
  assert.equal(result.safety.durable_oauth_or_token_mutated, false);
  assert.deepEqual(
    result.safety.ephemeral_youtube_access_token_refresh,
    {
      attempted: true,
      succeeded: true,
      failed: false,
    },
  );
  assert.deepEqual(publisherOptions.exactDispatchBinding, {
    storyId: STORY_ID,
    platform: "youtube",
    scheduledFor: SCHEDULED_FOR,
    scheduledEventId: 90,
    dispatchIdempotencyKey: DISPATCH_KEY,
    requestFingerprint: REQUEST_SHA,
    databaseDataVersion: 7,
  });
});

test("dispatch rejects a WAL created after pre-open validation before contacting YouTube", async (t) => {
  const Database = require("better-sqlite3");
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-dispatch-wal-race-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "pulse.db");
  const databaseSha = createCheckpointedWalDatabase(databasePath);
  let dispatches = 0;

  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "dispatch",
      {
        inspectDatabase: () =>
          baseSnapshot({
            database_path: databasePath,
            database_sha256: databaseSha,
            scheduled_rows: [scheduledRow()],
            lifecycle_by_state: {
              SCRIPT_READY: { script_sha256: SCRIPT_SHA },
              RENDERED: {
                media_sha256: MEDIA_SHA,
                renderer_manifest_sha256: RENDERER_SHA,
              },
            },
          }),
        validateBackupEvidence: () => ({
          valid: true,
          blockers: [],
          evidence: {
            source_database_path: databasePath,
            source_database_sha256: databaseSha,
            verified_at: "2026-07-27T18:50:00.000Z",
          },
        }),
        mutationBoundaryBlockers: sqliteMutationBoundaryBlockers,
        assertTransactionBoundary:
          assertGuardedSqliteTransactionBoundary,
        openRepositories: () => {
          const db = new Database(databasePath);
          db.prepare(
            "INSERT INTO boundary_probe (value) VALUES ('racing-wal')",
          ).run();
          return {
            repos: { db, runtimeLeases: {} },
            close() {
              db.close();
            },
          };
        },
        publisherRuntimeDatabasePath: () => databasePath,
        publishNextStory: async () => {
          dispatches += 1;
        },
      },
      {
        databasePath,
        env: liveEnv({ SQLITE_DB_PATH: databasePath }),
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_database_wal_not_checkpointed"));
  assert.equal(result.mutated, false);
  assert.equal(result.safety.platforms_contacted, false);
  assert.equal(dispatches, 0);
});

test("dispatch transaction returns its data_version baseline before a post-return external commit", (t) => {
  const Database = require("better-sqlite3");
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-dispatch-data-version-"),
  );
  const databasePath = path.join(root, "pulse.db");
  const databaseSha = createCheckpointedWalDatabase(databasePath);
  const primary = new Database(databasePath, { fileMustExist: true });
  const writer = new Database(databasePath, { fileMustExist: true });
  t.after(() => {
    writer.close();
    primary.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const guardedBaseline = assertGuardedSqliteTransactionBoundary({
    repos: { db: primary },
    databasePath,
    expectedSourceSha256: databaseSha,
    mutationBoundaryBlockers: sqliteMutationBoundaryBlockers,
  });
  writer
    .prepare(
      "INSERT INTO boundary_probe (value) VALUES ('after-transaction')",
    )
    .run();
  const currentDataVersion = primary.pragma("data_version", {
    simple: true,
  });

  assert.equal(Number.isSafeInteger(guardedBaseline), true);
  assert.notEqual(currentDataVersion, guardedBaseline);
});

test("dispatch never retries an ambiguous publisher failure", async () => {
  let dispatches = 0;
  const result = await executeGuardedYoutubeWindow(
    commonOptions("dispatch", {
      inspectDatabase: ({ phase }) =>
        phase === "post_dispatch"
          ? baseSnapshot()
          : baseSnapshot({
              scheduled_rows: [scheduledRow()],
              lifecycle_by_state: {
                SCRIPT_READY: { script_sha256: SCRIPT_SHA },
                RENDERED: {
                  media_sha256: MEDIA_SHA,
                  renderer_manifest_sha256: RENDERER_SHA,
                },
              },
            }),
      openRepositories: () => ({
        repos: { db: {}, runtimeLeases: {} },
        close() {},
      }),
      publisherRuntimeDatabasePath: () => "C:\\data\\pulse.db",
      publishNextStory: async (options) => {
        dispatches += 1;
        options.onYoutubeAuthTelemetry({
          schema_version: "pulse-youtube-auth-telemetry-v1",
          durable_oauth_or_token_mutated: false,
          ephemeral_access_token_refresh: {
            attempted: true,
            succeeded: false,
            failed: true,
          },
        });
        throw new Error("network outcome unknown");
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("publisher_dispatch_ambiguous_no_retry"));
  assert.equal(dispatches, 1);
  assert.equal(result.retry_attempted, false);
  assert.deepEqual(
    result.safety.ephemeral_youtube_access_token_refresh,
    {
      attempted: true,
      succeeded: false,
      failed: true,
    },
  );
});

test("dispatch holds before the publisher on runtime, identity, build or selection drift", async () => {
  let dispatches = 0;
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "dispatch",
      {
        inspectDatabase: () =>
          baseSnapshot({
            scheduled_rows: [scheduledRow(), scheduledRow("other-story")],
            active_worker_count: 1,
          }),
        publishNextStory: async () => {
          dispatches += 1;
        },
      },
      {
        confirmMediaSha256: "f".repeat(64),
        expectedRuntimeCommit: "b".repeat(40),
      },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("exact_media_sha256_mismatch"));
  assert.ok(result.blockers.includes("runtime_commit_mismatch"));
  assert.ok(result.blockers.includes("active_workers_present"));
  assert.ok(
    result.blockers.includes("fresh_scheduled_candidate_count_must_be_one"),
  );
  assert.equal(dispatches, 0);
});

test("dispatch requires the explicit irreversible live confirmation", async () => {
  let dispatches = 0;
  const result = await executeGuardedYoutubeWindow(
    commonOptions(
      "dispatch",
      {
        inspectDatabase: () =>
          baseSnapshot({
            scheduled_rows: [scheduledRow()],
            lifecycle_by_state: {
              SCRIPT_READY: { script_sha256: SCRIPT_SHA },
              RENDERED: {
                media_sha256: MEDIA_SHA,
                renderer_manifest_sha256: RENDERER_SHA,
              },
            },
          }),
        publishNextStory: async () => {
          dispatches += 1;
        },
      },
      { confirmLiveYoutubeDispatch: false },
    ),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("live_youtube_dispatch_confirmation_required"),
  );
  assert.equal(dispatches, 0);
});

test("markdown makes the one-shot result and blockers operator-readable", () => {
  const markdown = renderGuardedYoutubeWindowMarkdown({
    generated_at: NOW,
    action: "dispatch",
    verdict: "HOLD",
    story_id: STORY_ID,
    scheduled_for: SCHEDULED_FOR,
    blockers: ["publisher_dispatch_ambiguous_no_retry"],
    safety: {
      platforms_contacted: true,
      oauth_or_tokens_mutated: false,
    },
  });

  assert.match(markdown, /^# Guarded YouTube Window/m);
  assert.match(markdown, /publisher_dispatch_ambiguous_no_retry/);
  assert.match(markdown, /No automatic retry/);
});

test("backup evidence is fresh and bound to the current exact database bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-backup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "pulse.db");
  const backupPath = path.join(root, "pulse.backup.db");
  const evidencePath = path.join(root, "backup-evidence.json");
  fs.writeFileSync(databasePath, "current-database");
  fs.writeFileSync(backupPath, "verified-backup");
  const databaseSha = sha256(fs.readFileSync(databasePath));
  fs.writeFileSync(
    evidencePath,
    JSON.stringify({
      schema_version: "pulse-cutover-backup-evidence-v1",
      source_database_path: databasePath,
      source_database_sha256: databaseSha,
      backup_path: backupPath,
      backup_sha256: sha256(fs.readFileSync(backupPath)),
      verified_at: "2026-07-27T18:55:00.000Z",
      restore_test_status: "PASS",
      integrity_check: "ok",
      foreign_key_check: "ok",
      quick_check: "ok",
      backup_restore_hashes_match: true,
      production_database_mutated: false,
    }),
  );

  const valid = validateBackupEvidence({
    backupEvidencePath: evidencePath,
    databasePath,
    databaseSha256: databaseSha,
    generatedAt: NOW,
  });
  assert.equal(valid.valid, true);

  fs.writeFileSync(databasePath, "database-changed-after-backup");
  const changed = validateBackupEvidence({
    backupEvidencePath: evidencePath,
    databasePath,
    databaseSha256: sha256(fs.readFileSync(databasePath)),
    generatedAt: NOW,
  });
  assert.equal(changed.valid, false);
  assert.ok(changed.blockers.includes("cutover_backup_source_sha256_mismatch"));
});

test(
  "backup source path comparison preserves POSIX case sensitivity",
  { skip: process.platform === "win32" },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-path-case-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const databasePath = path.join(root, "Pulse.db");
    const otherDatabasePath = path.join(root, "pulse.db");
    const backupPath = path.join(root, "pulse.backup.db");
    const evidencePath = path.join(root, "backup-evidence.json");
    fs.writeFileSync(databasePath, "current-database");
    fs.writeFileSync(otherDatabasePath, "different-database");
    fs.writeFileSync(backupPath, "verified-backup");
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        schema_version: "pulse-cutover-backup-evidence-v1",
        source_database_path: otherDatabasePath,
        source_database_sha256: sha256(fs.readFileSync(databasePath)),
        backup_path: backupPath,
        backup_sha256: sha256(fs.readFileSync(backupPath)),
        verified_at: "2026-07-27T18:55:00.000Z",
        restore_test_status: "PASS",
        integrity_check: "ok",
        foreign_key_check: "ok",
        quick_check: "ok",
        backup_restore_hashes_match: true,
        production_database_mutated: false,
      }),
    );

    const result = validateBackupEvidence({
      backupEvidencePath: evidencePath,
      databasePath,
      databaseSha256: sha256(fs.readFileSync(databasePath)),
      generatedAt: NOW,
    });

    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes("cutover_backup_source_path_mismatch"));
  },
);

test("database inspection is read-only and exposes stopped-runtime evidence", (t) => {
  const Database = require("better-sqlite3");
  const { runMigrations } = require("../../lib/migrate");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-inspect-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  runMigrations(db);
  db.prepare(
    "INSERT INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse Gaming')",
  ).run();
  db.prepare(
    `INSERT INTO stories
       (id, title, approved, auto_approved, full_script, exported_path,
        channel_id, _extra)
     VALUES (?, 'Reviewed story', 1, 0, 'Exact reviewed script',
             ?, 'pulse-gaming', ?)`,
  ).run(
    STORY_ID,
    path.join(root, "final.mp4"),
    JSON.stringify({
      render_review_status: "approved",
      final_publication_review: {
        review_manifest_sha256: "b".repeat(64),
      },
      preflight_evidence: reviewResult().preflight_evidence,
    }),
  );
  db.prepare(
    `INSERT INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision, reason,
        evidence_json, idempotency_key)
     VALUES ('reviewer', 'governed_publication_review', 'story', ?,
             'HUMAN_RENDER_APPROVED', 'reviewed', ?, 'review:test')`,
  ).run(
    STORY_ID,
    JSON.stringify({
      review_manifest_sha256: "b".repeat(64),
      script_sha256: SCRIPT_SHA,
      media_sha256: MEDIA_SHA,
      source_evidence: { sha256: SOURCE_SHA },
      renderer_manifest: { canonical_sha256: RENDERER_SHA },
    }),
  );
  db.close();
  const before = sha256(fs.readFileSync(databasePath));

  const snapshot = inspectGuardedYoutubeDatabase({
    databasePath,
    storyId: STORY_ID,
    generatedAt: NOW,
  });

  assert.equal(snapshot.schema_ready, true);
  assert.equal(snapshot.story.id, STORY_ID);
  assert.equal(snapshot.story.approved, true);
  assert.equal(snapshot.review_binding.immutable_audit_found, true);
  assert.equal(snapshot.active_runtime_lease_count, 0);
  assert.equal(snapshot.running_job_count, 0);
  assert.equal(snapshot.active_worker_count, 0);
  assert.equal(snapshot.scheduled_rows.length, 0);
  assert.equal(sha256(fs.readFileSync(databasePath)), before);
});

test("database inspection rejects SHM-only source state without touching source bytes", (t) => {
  const Database = require("better-sqlite3");
  const { runMigrations } = require("../../lib/migrate");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-guarded-shm-"));
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  runMigrations(db);
  db.close();
  const setup = new Database(databasePath, { fileMustExist: true });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();

  const reader = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  t.after(() => {
    reader.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  reader.prepare("SELECT version FROM schema_migrations LIMIT 1").get();
  assert.equal(fs.statSync(`${databasePath}-wal`).size, 0);
  assert.ok(fs.statSync(`${databasePath}-shm`).size > 0);
  const before = sha256(fs.readFileSync(databasePath));

  const snapshot = inspectGuardedYoutubeDatabase({
    databasePath,
    storyId: STORY_ID,
    generatedAt: NOW,
  });

  assert.equal(snapshot.schema_ready, false);
  assert.ok(
    snapshot.schema_blockers.includes(
      "source_database_shared_memory_present",
    ),
  );
  assert.equal(sha256(fs.readFileSync(databasePath)), before);
});

test("database inspection snapshots a clean checkpointed WAL database without creating source sidecars", (t) => {
  const Database = require("better-sqlite3");
  const { runMigrations } = require("../../lib/migrate");
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-guarded-wal-snapshot-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  runMigrations(db);
  db.close();
  const setup = new Database(databasePath, { fileMustExist: true });
  setup.pragma("journal_mode = WAL");
  setup.pragma("wal_autocheckpoint = 0");
  setup.pragma("wal_checkpoint(TRUNCATE)");
  setup.close();
  assert.equal(fs.existsSync(`${databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${databasePath}-shm`), false);
  const before = sha256(fs.readFileSync(databasePath));

  const snapshot = inspectGuardedYoutubeDatabase({
    databasePath,
    storyId: STORY_ID,
    generatedAt: NOW,
  });

  assert.equal(snapshot.schema_ready, true);
  assert.equal(fs.existsSync(`${databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${databasePath}-shm`), false);
  assert.equal(sha256(fs.readFileSync(databasePath)), before);
});
