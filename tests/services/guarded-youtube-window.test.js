"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  executeGuardedYoutubeWindow,
  inspectGuardedYoutubeDatabase,
  renderGuardedYoutubeWindowMarkdown,
  validateBackupEvidence,
} = require("../../lib/ops/guarded-youtube-window");

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
      publishNextStory: async () => {
        dispatches += 1;
        return {
          youtube: true,
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
      publishNextStory: async () => {
        dispatches += 1;
        throw new Error("network outcome unknown");
      },
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("publisher_dispatch_ambiguous_no_retry"));
  assert.equal(dispatches, 1);
  assert.equal(result.retry_attempted, false);
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
