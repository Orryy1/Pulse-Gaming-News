"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { handlers } = require("../../lib/job-handlers");
const { runMigrations } = require("../../lib/migrate");
const { bind } = require("../../lib/repositories/jobs");

const HASH = Object.freeze({
  media: "1".repeat(64),
  script: "2".repeat(64),
  qa: "3".repeat(64),
  rights: "4".repeat(64),
  source: "5".repeat(64),
  review: "6".repeat(64),
  admission: "7".repeat(64),
  revision: "8".repeat(64),
});

function runwayCandidate(storyId, standbyAuthorised) {
  const admission = {
    human_review_status: "approved",
    actor_id: "operator-001",
    reason: "Exact reviewed video approved",
    confirmation_story_id: storyId,
    scheduled_for: "2026-07-28T19:00:00.000Z",
    evidence: {},
  };
  return {
    story_id: storyId,
    lane_id: "breaking_short",
    score: standbyAuthorised ? 90 : 110,
    stage: "HUMAN_APPROVED",
    human_review_status: "approved",
    eligibility_verdict: "GREEN",
    media_sha256: HASH.media,
    script_sha256: HASH.script,
    qa_report_sha256: HASH.qa,
    rights_ledger_sha256: HASH.rights,
    source_evidence_sha256: HASH.source,
    human_review_evidence_sha256: HASH.review,
    admission_evidence_sha256: crypto
      .createHash("sha256")
      .update(JSON.stringify(admission))
      .digest("hex"),
    candidate_revision_sha256: HASH.revision,
    standby_authorised: standbyAuthorised,
    standby_authorisation_event_id:
      standbyAuthorised ? "standby-approval-1" : null,
    standby_authorisation_sha256:
      standbyAuthorised ? "9".repeat(64) : null,
    admission,
  };
}

function admissionJob() {
  return {
    id: 701,
    kind: "admit_governed_publication",
    story_id: "primary-ready",
    status: "pending",
    run_at: "2026-07-28 17:45:00",
    idempotency_key:
      `admit:youtube:breaking_short:primary-ready:` +
      `${HASH.revision}:2026-07-28T19:00:00.000Z`,
    payload: {
      story_id: "primary-ready",
      candidate_revision_sha256: HASH.revision,
      admission: {
        scheduled_for: "2026-07-28T19:00:00.000Z",
      },
    },
  };
}

test("the daily planning handler refreshes the durable 36-hour checkpoint horizon without publish authority", async () => {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  const jobs = bind(db);

  const result =
    await handlers.prime_governed_youtube_window_checkpoints(
      {
        payload: {
          scheduler_profile: "governed_multi_lane",
          horizon_hours: 36,
          planning_only: true,
          catch_up_allowed: false,
          publish_authority: false,
          external_posting: false,
        },
      },
      {
        repos: { jobs },
        now: () => new Date("2026-07-28T12:00:00.000Z"),
      },
    );

  assert.equal(result.status, "PRIMED");
  assert.equal(result.queued_jobs.length, 6);
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE kind IN (
           'governed_youtube_runway_t90',
           'governed_youtube_runway_tplus15'
         )`,
      )
      .get().count,
    6,
  );
  assert.equal(result.safety.external_posting, false);
  assert.equal(
    result.safety.publish_authority_created,
    false,
  );
  assert.equal(result.safety.catch_up_allowed, false);
  db.close();
});

test("T-90, T-60, T-15 and T+15 jobs more than 60 seconds late write one MISSED_INTERNAL incident and never execute catch-up work", async (t) => {
  for (const checkpoint of [
    {
      handler: "governed_youtube_runway_t90",
      phase: "T-90",
      runAt: "2026-07-28 17:30:00",
      now: "2026-07-28T17:31:00.001Z",
      evidenceFile: "t90-evidence.json",
    },
    {
      handler: "governed_youtube_runway_tplus15",
      phase: "T+15",
      runAt: "2026-07-28 19:15:00",
      now: "2026-07-28T19:16:00.001Z",
      evidenceFile: "tplus15-outcome.json",
    },
    {
      handler: "governed_youtube_runway_t60",
      phase: "T-60",
      runAt: "2026-07-28 18:00:00",
      now: "2026-07-28T18:01:00.001Z",
      evidenceFile: "t60-readiness.json",
    },
    {
      handler:
        "verify_governed_youtube_release_tminus15",
      phase: "T-15",
      runAt: "2026-07-28 18:45:00",
      now: "2026-07-28T18:46:00.001Z",
      evidenceFile: "tminus15-readiness.json",
    },
  ]) {
    const outDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "pulse-late-checkpoint-"),
    );
    t.after(() => fs.remove(outDir));
    const notifications = [];
    const job = {
      kind: checkpoint.handler,
      run_at: checkpoint.runAt,
      payload: {
        now: checkpoint.now,
        publish_hour_utc: 19,
        out_dir: outDir,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    };
    const ctx = {
      repos: {},
      async notifyRunwayIncident(incident) {
        notifications.push(incident);
      },
    };

    const first = await handlers[checkpoint.handler](
      job,
      ctx,
    );
    const replay = await handlers[checkpoint.handler](
      job,
      ctx,
    );

    assert.equal(first.status, "held");
    assert.equal(first.classification, "MISSED_INTERNAL");
    assert.equal(first.phase, checkpoint.phase);
    assert.equal(first.checkpoint_executed, false);
    assert.equal(first.catch_up_allowed, false);
    assert.equal(first.retry_allowed, false);
    assert.equal(first.publish_authority_created, false);
    assert.equal(
      await fs.pathExists(
        path.join(outDir, checkpoint.evidenceFile),
      ),
      false,
    );
    assert.equal(
      await fs.pathExists(first.incident_json),
      true,
    );
    assert.equal(first.notification_sent, true);
    assert.equal(replay.notification_sent, false);
    assert.equal(notifications.length, 1);
  }
});

test("T-90 deterministically enqueues one exact durable T-60 private pre-stage hook", async (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run("pulse-gaming", "Pulse Gaming");
  db.prepare(
    "INSERT INTO stories (id, title) VALUES (?, ?)",
  ).run("primary-ready", "Primary ready");
  const jobs = bind(db);
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-t60-hook-"),
  );
  t.after(() => fs.remove(outDir));
  const job = {
    kind: "governed_youtube_runway_t90",
    channel_id: "pulse-gaming",
    run_at: "2026-07-28 17:30:00",
    payload: {
      now: "2026-07-28T17:30:00.000Z",
      publish_hour_utc: 19,
      out_dir: outDir,
      candidates: [
        runwayCandidate("primary-ready", false),
        runwayCandidate("reserve-ready", true),
      ],
      admission_jobs: [admissionJob()],
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
    },
  };
  const ctx = {
    repos: { jobs },
    async notifyRunwayIncident() {},
  };

  const first =
    await handlers.governed_youtube_runway_t90(job, ctx);
  const replay =
    await handlers.governed_youtube_runway_t90(job, ctx);

  assert.equal(first.t60_job.kind, "governed_youtube_runway_t60");
  assert.equal(first.t60_job.run_at, "2026-07-28T18:00:00.000Z");
  assert.equal(replay.t60_job.id, first.t60_job.id);
  const rows = db
    .prepare(
      `SELECT *
       FROM jobs
       WHERE kind = 'governed_youtube_runway_t60'`,
    )
    .all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].run_at, "2026-07-28 18:00:00");
  const payload = JSON.parse(rows[0].payload);
  assert.equal(payload.private_only, true);
  assert.equal(payload.private_prestage_authority, false);
  assert.equal(payload.publish_authority, false);
  assert.equal(payload.external_posting, false);
});

test("the T-60 verifier fails closed without an exact runway envelope or live verification authority", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-t60-readiness-"),
  );
  t.after(() => fs.remove(outDir));
  const notifications = [];
  const job = {
    kind: "governed_youtube_runway_t60",
    run_at: "2026-07-28 18:00:00",
    payload: {
      phase: "T-60",
      scheduled_for: "2026-07-28T19:00:00.000Z",
      story_id: "primary-ready",
      lane_id: "breaking_short",
      runway_lock_sha256: "a".repeat(64),
      private_only: true,
      private_prestage_authority: false,
      human_review_required: true,
      catch_up_allowed: false,
      publish_authority: false,
      external_posting: false,
      out_dir: outDir,
      now: "2026-07-28T18:00:00.000Z",
    },
  };
  const ctx = {
    repos: {},
    async notifyRunwayIncident(incident) {
      notifications.push(incident);
    },
  };

  const result =
    await handlers.governed_youtube_runway_t60(job, ctx);

  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("runway_release_lock_unavailable"),
  );
  assert.ok(
    result.blockers.includes(
      "exact_readiness_verification_authority_required",
    ),
  );
  assert.equal(result.upload_attempted, false);
  assert.equal(result.remote_schedule_verified, false);
  assert.equal(result.catch_up_allowed, false);
  assert.equal(result.retry_allowed, false);
  assert.equal(
    await fs.pathExists(
      path.join(outDir, "t60-readiness.json"),
    ),
    true,
  );
  assert.equal(
    await fs.pathExists(
      path.join(outDir, "incident-tminus60.json"),
    ),
    true,
  );
  assert.equal(notifications.length, 1);
});
