"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { handlers } = require("../../lib/job-handlers");
const {
  buildGovernedYoutubeRunwayLock,
  canonicalSha256,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  createAutonomousEligibleCandidateFixture,
} = require("../helpers/autonomous-window-eligibility-fixture");

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

function candidate(storyId, standbyAuthorised) {
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

function autonomousRunwayCandidate(storyId, standby = false) {
  return createAutonomousEligibleCandidateFixture({
    storyId,
    now: "2026-07-28T17:30:00.000Z",
    scheduledFor: "2026-07-28T19:00:00.000Z",
    role: standby ? "STANDBY" : "PRIMARY",
    candidateRevisionSha256: HASH.revision,
    requestFingerprint: standby
      ? "a".repeat(64)
      : "b".repeat(64),
    evidenceHashes: {
      media_sha256: HASH.media,
      script_sha256: HASH.script,
      qa_report_sha256: HASH.qa,
      rights_ledger_sha256: HASH.rights,
      source_evidence_sha256: HASH.source,
    },
  });
}

function autonomousRunwayAdmission(storyId, standby = false) {
  return autonomousRunwayCandidate(storyId, standby).admission;
}

function primaryAdmissionJob() {
  return {
    id: 701,
    kind: "admit_governed_publication",
    story_id: "primary-ready",
    status: "pending",
    run_at: "2026-07-28 17:45:00",
    idempotency_key:
      `admit:youtube:breaking_short:primary-ready:${HASH.revision}:` +
      "2026-07-28T19:00:00.000Z",
    payload: {
      story_id: "primary-ready",
      candidate_revision_sha256: HASH.revision,
      admission: {
        scheduled_for: "2026-07-28T19:00:00.000Z",
      },
    },
  };
}

async function materialiseSloMonitorRunway(t) {
  const runwayRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-slo-contract-"),
  );
  t.after(() => fs.remove(runwayRoot));
  const t90 = buildGovernedYoutubeRunwayLock({
    now: "2026-07-28T17:30:00.000Z",
    publish_hour_utc: 19,
    candidates: [
      candidate("primary-ready", false),
      candidate("reserve-ready", true),
    ],
    admission_jobs: [primaryAdmissionJob()],
  });
  assert.equal(t90.verdict, "GREEN", JSON.stringify(t90));
  const windowDir = path.join(
    runwayRoot,
    "2026-07-28",
    "1900",
  );
  await fs.ensureDir(windowDir);
  await fs.writeJson(
    path.join(windowDir, "runway-lock.json"),
    t90.lock,
  );
  await fs.writeJson(
    path.join(windowDir, "t90-evidence.json"),
    t90,
  );
  const admissionJob = {
    ...primaryAdmissionJob(),
    status: "done",
  };
  const scheduledEvidence = {
    scheduled_for: t90.lock.scheduled_for,
    dispatch_idempotency_key:
      "youtube:primary-ready:2026-07-28T19:00:00.000Z",
    request_fingerprint: "a".repeat(64),
    runway_lock_sha256: t90.lock.lock_sha256,
  };
  const publicationState = {
    lifecycle_state: "PLATFORM_SCHEDULED",
    external_id: "youtube-primary-object",
    verification_status: "confirmed_private_scheduled",
    last_event_id: 802,
  };
  return {
    runwayRoot,
    windowDir,
    lock: t90.lock,
    publicationState,
    context: {
      repos: {
        jobs: {
          getByIdempotencyKey(key) {
            return key === admissionJob.idempotency_key
              ? admissionJob
              : null;
          },
        },
        publicationGovernance: {
          getLatestLifecycleEvent(
            storyId,
            platform,
            toState,
          ) {
            return storyId === "primary-ready" &&
              platform === "youtube" &&
              toState === "SCHEDULED"
              ? {
                  id: 801,
                  story_id: storyId,
                  platform,
                  to_state: toState,
                  evidence_json:
                    JSON.stringify(scheduledEvidence),
                }
              : null;
          },
          getState(storyId, platform) {
            return storyId === "primary-ready" &&
              platform === "youtube"
              ? { ...publicationState }
              : null;
          },
          assertScheduledPlatformReleaseCommitment(
            input,
          ) {
            assert.equal(
              input.storyId,
              "primary-ready",
            );
            assert.equal(
              input.externalId,
              "youtube-primary-object",
            );
            assert.equal(
              input.scheduledFor,
              t90.lock.scheduled_for,
            );
            assert.equal(
              input.requestFingerprint,
              "a".repeat(64),
            );
            assert.equal(
              input.runwayLockSha256,
              t90.lock.lock_sha256,
            );
            return {
              storyId: input.storyId,
              externalId: input.externalId,
              scheduledFor: input.scheduledFor,
            };
          },
        },
      },
      async notifyRunwayIncident() {},
    },
  };
}

function exactSloCheckpoint({
  lock,
  phase,
  evidence,
}) {
  return {
    phase,
    scheduled_for: lock.scheduled_for,
    runway_lock_sha256: lock.lock_sha256,
    story_id: lock.primary.story_id,
    selected_role: "primary",
    selected_story_id: lock.primary.story_id,
    scheduled_event_id: 801,
    dispatch_idempotency_key:
      "youtube:primary-ready:2026-07-28T19:00:00.000Z",
    request_fingerprint: "a".repeat(64),
    promotion_sha256: null,
    media_sha256: lock.primary.media_sha256,
    script_sha256: lock.primary.script_sha256,
    verdict: "GREEN",
    blockers: [],
    external_id: "youtube-primary-object",
    ...evidence,
  };
}

test("T-90 handler materialises immutable lock and incident evidence then notifies without posting", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-t90-"),
  );
  t.after(() => fs.remove(outDir));
  const notifications = [];

  const result =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
          catch_up_allowed: false,
          publish_authority: false,
        },
      },
      {
        repos: {},
        async notifyRunwayIncident(incident) {
          notifications.push(incident);
        },
      },
    );

  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "runway_t60_durable_jobs_repository_required",
    ),
  );
  assert.equal(result.no_external_posting, true);
  assert.equal(result.catch_up_allowed, false);
  assert.equal(
    await fs.pathExists(
      path.join(outDir, "runway-lock.json"),
    ),
    true,
  );
  assert.equal(
    await fs.pathExists(
      path.join(outDir, "t90-evidence.json"),
    ),
    true,
  );
  assert.equal(
    await fs.pathExists(
      path.join(outDir, "incident-t90.json"),
    ),
    true,
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].phase, "T-90");
  assert.equal(notifications[0].publish_authority, false);
});

test("T+15 handler classifies a failed external dispatch and emits one durable incident", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-tplus15-"),
  );
  t.after(() => fs.remove(outDir));
  const notifications = [];
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        repos: {},
        async notifyRunwayIncident() {},
      },
    );

  const result =
    await handlers.governed_youtube_runway_tplus15(
      {
        payload: {
          now: "2026-07-28T19:15:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          lock: t90.lock,
          observation: {
            story_id: "primary-ready",
            platform: "youtube",
            platform_contacted: true,
            dispatch_attempted: true,
          },
        },
      },
      {
        repos: {},
        async notifyRunwayIncident(incident) {
          notifications.push(incident);
        },
      },
    );

  assert.equal(result.classification, "EXTERNAL_FAILURE");
  assert.equal(result.status, "held");
  assert.equal(result.catch_up_allowed, false);
  assert.equal(result.retry_allowed, false);
  assert.equal(
    await fs.pathExists(
      path.join(outDir, "tplus15-outcome.json"),
    ),
    true,
  );
  assert.equal(
    await fs.pathExists(
      path.join(outDir, "incident-tplus15.json"),
    ),
    true,
  );
  assert.equal(notifications.length, 1);
  assert.equal(
    notifications[0].classification,
    "EXTERNAL_FAILURE",
  );
});

test("T+15 remotely observes both locked identities and incidents an unselected reserve publication", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-tplus15-dual-"),
  );
  t.after(() => fs.remove(outDir));
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        repos: {},
        async notifyRunwayIncident() {},
      },
    );
  const verifiedStoryIds = [];
  const incidents = [];

  const result =
    await handlers.governed_youtube_runway_tplus15(
      {
        payload: {
          now: "2026-07-28T19:15:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          lock: t90.lock,
          observations: [
            {
              story_id: "primary-ready",
              platform: "youtube",
              external_id: "yt_primary_remote",
              external_url:
                "https://www.youtube.com/watch?v=yt_primary_remote",
              platform_contacted: true,
            },
            {
              story_id: "reserve-ready",
              platform: "youtube",
              external_id: "yt_reserve_remote",
              external_url:
                "https://www.youtube.com/watch?v=yt_reserve_remote",
              platform_contacted: true,
            },
          ],
        },
      },
      {
        repos: {},
        async verifyYoutubePublication(input) {
          verifiedStoryIds.push(input.storyId);
          return {
            confirmed: true,
            externalId: input.externalId,
            externalUrl:
              `https://www.youtube.com/watch?v=${input.externalId}`,
            publishedAt: "2026-07-28T19:03:00.000Z",
          };
        },
        async notifyRunwayIncident(incident) {
          incidents.push(incident);
        },
      },
    );

  assert.deepEqual(verifiedStoryIds, [
    "primary-ready",
    "reserve-ready",
  ]);
  assert.equal(result.classification, "EXTERNAL_FAILURE");
  assert.ok(
    result.blockers.includes(
      "runway_wrong_role_publication_confirmed",
    ),
  );
  assert.equal(incidents.length, 1);
});

test("T+15 cannot turn a payload-injected legacy confirmed observation into HIT", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-tplus15-legacy-"),
  );
  t.after(() => fs.remove(outDir));
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        repos: {},
        async notifyRunwayIncident() {},
      },
    );

  const result =
    await handlers.governed_youtube_runway_tplus15(
      {
        payload: {
          now: "2026-07-28T19:15:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          lock: t90.lock,
          observation: {
            story_id: "primary-ready",
            platform: "youtube",
            verification_status: "confirmed",
            external_id: "yt_payload_only",
            external_url:
              "https://www.youtube.com/watch?v=yt_payload_only",
            published_at: "2026-07-28T19:03:00.000Z",
            platform_contacted: true,
            dispatch_attempted: true,
          },
        },
      },
      {
        repos: {},
        async notifyRunwayIncident() {},
      },
    );

  assert.notEqual(result.classification, "HIT");
  assert.equal(result.verdict, "HOLD");
});

test("runway lock survives a handler restart under PULSE_STATE_ROOT and T+15 reloads it", async (t) => {
  const stateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-state-root-"),
  );
  t.after(() => fs.remove(stateRoot));
  const env = { PULSE_STATE_ROOT: stateRoot };
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        env,
        repos: {},
        async notifyRunwayIncident() {},
      },
    );
  const durableWindow = path.join(
    stateRoot,
    "governed-youtube-runway",
    "2026-07-28",
    "1900",
  );
  assert.equal(
    path.dirname(t90.lock_json),
    durableWindow,
  );
  assert.equal(
    await fs.pathExists(t90.lock_json),
    true,
  );

  const afterRestart =
    await handlers.governed_youtube_runway_tplus15(
      {
        payload: {
          now: "2026-07-28T19:15:00.000Z",
          publish_hour_utc: 19,
          observation: {
            story_id: "primary-ready",
            platform: "youtube",
            dispatch_attempted: true,
          },
        },
      },
      {
        env,
        repos: {},
        async notifyRunwayIncident() {},
      },
    );
  const outcome = await fs.readJson(
    afterRestart.outcome_json,
  );
  assert.equal(
    outcome.runway_lock_sha256,
    t90.runway_lock_sha256,
  );
  assert.equal(
    path.dirname(afterRestart.outcome_json),
    durableWindow,
  );
});

test("scheduler-shaped handlers derive candidates, admission jobs, lock and confirmed outcome from durable repos", async (t) => {
  const stateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-production-shape-"),
  );
  t.after(() => fs.remove(stateRoot));
  const scheduledFor = "2026-07-28T19:00:00.000Z";
  const reviewEvidence = {
    schema_version: "pulse-final-publication-review-v1",
    media_sha256: HASH.media,
    script_sha256: HASH.script,
    source_evidence: { sha256: HASH.source },
    qa_report: { sha256: HASH.qa, verdict: "PASS" },
    rights_ledger: { canonical_sha256: HASH.rights },
  };
  const reviewRow = (storyId) => ({
    id: storyId === "primary-ready" ? 1 : 2,
    action: "governed_publication_review",
    decision: "HUMAN_RENDER_APPROVED",
    evidence_json: JSON.stringify(reviewEvidence),
  });
  const reserveRevision = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        review_id: 2,
        review_evidence: reviewEvidence,
      }),
    )
    .digest("hex");
  const row = (storyId, standby) => {
    const admission = {
      human_review_status: "approved",
      actor_id: "operator-production",
      reason: "Reviewed exact final",
      confirmation_story_id: storyId,
      scheduled_for: scheduledFor,
      evidence: {
        qa_report_sha256: HASH.qa,
      },
    };
    return {
    id: storyId,
    title: `${storyId} exact story`,
    breaking_score: standby ? 90 : 110,
    score: standby ? 90 : 110,
    full_script: "A complete exact reviewed narration script.",
    exported_path: `D:/pulse-data/${storyId}.mp4`,
    audio_path: `D:/pulse-data/${storyId}.mp3`,
    publish_status: "",
    youtube_post_id: "",
    created_at: "2026-07-28T16:00:00.000Z",
    _extra: JSON.stringify({
      breaking_fast_track: true,
      human_review_status: "approved",
      runway_eligibility_verdict: "GREEN",
      runway_standby_authorised: standby,
      source_evidence_sha256: HASH.source,
      script_sha256: HASH.script,
      media_sha256: HASH.media,
      qa_report_sha256: HASH.qa,
      rights_ledger_canonical_sha256: HASH.rights,
      human_review_evidence_sha256: HASH.review,
      admission_evidence_sha256: crypto
        .createHash("sha256")
        .update(JSON.stringify(admission))
        .digest("hex"),
      candidate_revision_sha256: HASH.revision,
      standby_authorisation_event_id:
        standby ? "standby-approval-production" : null,
      standby_authorisation_sha256:
        standby ? "9".repeat(64) : null,
      admission,
    }),
  };
  };
  const storyRows = [
    row("primary-ready", false),
    row("reserve-ready", true),
  ];
  const db = {
    prepare(sql) {
      if (sql.includes("FROM stories")) {
        return { all: () => storyRows };
      }
      if (sql.includes("FROM operator_audit_log")) {
        if (
          sql.includes(
            "governed_youtube_runway_standby",
          )
        ) {
          return {
            get: (storyId) =>
              storyId === "reserve-ready"
                ? {
                    id: 3,
                    action:
                      "governed_youtube_runway_standby",
                    decision: "APPROVED",
                    evidence_json: JSON.stringify({
                      standby_authorised: true,
                      candidate_revision_sha256:
                        reserveRevision,
                      scheduled_for: scheduledFor,
                    }),
                  }
                : null,
          };
        }
        return {
          get: (storyId) => reviewRow(storyId),
        };
      }
      if (sql.includes("FROM platform_publication_state")) {
        if (sql.includes("JOIN publication_lifecycle_events")) {
          return { get: () => null };
        }
        return {
          get: () => ({
            lifecycle_state: "PUBLISHED",
            external_id: "yt_production_exact",
            external_url:
              "https://www.youtube.com/watch?v=yt_production_exact",
            verification_status: "confirmed",
            verified_at: "2026-07-28T19:03:00.000Z",
            last_event_id: 902,
          }),
        };
      }
      if (sql.includes("FROM platform_dispatch_ledger")) {
        if (sql.includes("WHERE id = ?")) {
          return {
            get: () => ({
              id: 902,
              event_type: "PUBLISHED",
              verification_status: "confirmed",
              verification_evidence_json: JSON.stringify({
                external_id: "yt_production_exact",
              }),
            }),
          };
        }
        return {
          get: () => ({
            id: 901,
            event_type: "PLATFORM_OBJECT_CREATED",
            external_id: "yt_production_exact",
          }),
        };
      }
      if (sql.includes("FROM platform_posts")) {
        return {
          get: () => ({
            status: "published",
            external_id: "yt_production_exact",
            external_url:
              "https://www.youtube.com/watch?v=yt_production_exact",
            published_at: "2026-07-28T19:03:00.000Z",
          }),
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const repos = {
    db,
    jobs: {
      listPending() {
        return [primaryAdmissionJob()];
      },
    },
    stories: {
      get(storyId) {
        if (storyId !== "primary-ready") return null;
        return {
          ...storyRows[0],
          youtube_post_id: "yt_production_exact",
          youtube_url:
            "https://www.youtube.com/watch?v=yt_production_exact",
          publish_status: "published",
          published_at: "2026-07-28T19:03:00.000Z",
          youtube_published_at: "2026-07-28T19:03:00.000Z",
          _extra: JSON.stringify({
            youtube_platform_contacted: true,
            youtube_dispatch_attempted: true,
          }),
        };
      },
    },
  };
  const schedulerPayload = (phase, publishHourUtc) => ({
    phase,
    publish_hour_utc: publishHourUtc,
    scheduler_profile: "governed_multi_lane",
    governed_multi_lane: true,
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
  });

  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: schedulerPayload("T-90", 19),
      },
      {
        env: { PULSE_STATE_ROOT: stateRoot },
        repos,
        now: () => new Date("2026-07-28T17:30:00.000Z"),
        async notifyRunwayIncident() {},
      },
    );
  assert.equal(t90.lock.primary.story_id, "primary-ready");
  assert.equal(t90.lock.reserve.story_id, "reserve-ready");
  assert.equal(
    t90.lock.primary_admission_job.job_id,
    701,
  );

  const tplus15 =
    await handlers.governed_youtube_runway_tplus15(
      {
        payload: schedulerPayload("T+15", 19),
      },
      {
        env: { PULSE_STATE_ROOT: stateRoot },
        repos,
        now: () => new Date("2026-07-28T19:15:00.000Z"),
        async notifyRunwayIncident() {
          throw new Error("HIT must not notify");
        },
      },
    );
  assert.equal(tplus15.classification, "HIT");
  assert.equal(
    tplus15.publication.external_id,
    "yt_production_exact",
  );
});

test("scheduler-shaped T-90 derives reviewed hashes, eligibility and reserve authorisation from canonical audit rows", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-canonical-review-"),
  );
  t.after(() => fs.remove(outDir));
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      breaking_score REAL,
      virality_score REAL,
      quality_score REAL,
      score REAL,
      full_script TEXT,
      exported_path TEXT,
      audio_path TEXT,
      publish_status TEXT,
      youtube_post_id TEXT,
      published_at TEXT,
      timestamp TEXT,
      created_at TEXT,
      _extra TEXT
    );
    CREATE TABLE platform_publication_state (
      story_id TEXT, platform TEXT, lifecycle_state TEXT
    );
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY, story_id TEXT, platform TEXT,
      to_state TEXT, evidence_json TEXT
    );
    CREATE TABLE operator_audit_log (
      id INTEGER PRIMARY KEY,
      actor_id TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      decision TEXT,
      reason TEXT,
      evidence_json TEXT
    );
  `);
  const scheduledFor = "2026-07-28T19:00:00.000Z";
  const admission = (storyId) => ({
    human_review_status: "approved",
    actor_id: "operator-canonical",
    reason: "Reviewed exact final",
    confirmation_story_id: storyId,
    scheduled_for: scheduledFor,
    evidence: {},
  });
  for (const [storyId, score] of [
    ["primary-ready", 110],
    ["reserve-ready", 90],
  ]) {
    db.prepare(
      `INSERT INTO stories
         (id, title, breaking_score, score, full_script,
          exported_path, audio_path, publish_status,
          youtube_post_id, created_at, _extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`,
    ).run(
      storyId,
      `${storyId} exact story`,
      score,
      score,
      "A complete exact reviewed narration script.",
      `D:/pulse-data/${storyId}.mp4`,
      `D:/pulse-data/${storyId}.mp3`,
      "2026-07-28T16:00:00.000Z",
      JSON.stringify({
        breaking_fast_track: true,
        admission: admission(storyId),
      }),
    );
  }
  const reviewEvidence = {
    schema_version: "pulse-final-publication-review-v1",
    media_sha256: HASH.media,
    script_sha256: HASH.script,
    source_evidence: { sha256: HASH.source },
    qa_report: { sha256: HASH.qa, verdict: "PASS" },
    rights_ledger: {
      canonical_sha256: HASH.rights,
    },
  };
  db.prepare(
    `INSERT INTO operator_audit_log
       (id, action, target_type, target_id, decision, evidence_json)
     VALUES (?, 'governed_publication_review', 'story', ?,
             'HUMAN_RENDER_APPROVED', ?)`,
  ).run(1, "primary-ready", JSON.stringify(reviewEvidence));
  db.prepare(
    `INSERT INTO operator_audit_log
       (id, action, target_type, target_id, decision, evidence_json)
     VALUES (?, 'governed_publication_review', 'story', ?,
             'HUMAN_RENDER_APPROVED', ?)`,
  ).run(2, "reserve-ready", JSON.stringify(reviewEvidence));
  const reserveRevision = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        review_id: 2,
        review_evidence: reviewEvidence,
      }),
    )
    .digest("hex");
  db.prepare(
    `INSERT INTO operator_audit_log
       (id, action, target_type, target_id, decision, evidence_json)
     VALUES (3, 'governed_youtube_runway_standby', 'story', ?,
             'APPROVED', ?)`,
  ).run(
    "reserve-ready",
    JSON.stringify({
      standby_authorised: true,
      candidate_revision_sha256: reserveRevision,
      scheduled_for: scheduledFor,
    }),
  );

  const result =
    await handlers.governed_youtube_runway_t90(
      {
        kind: "governed_youtube_runway_t90",
        run_at: "2026-07-28 17:30:00",
        payload: {
          phase: "T-90",
          publish_hour_utc: 19,
          scheduler_profile: "governed_multi_lane",
          out_dir: outDir,
        },
      },
      {
        repos: {
          db,
          jobs: {
            listPending() {
              return [primaryAdmissionJob()];
            },
          },
        },
        now: () => new Date("2026-07-28T17:30:00.000Z"),
        async notifyRunwayIncident() {},
      },
    );

  assert.ok(
    result.lock,
    JSON.stringify({
      blockers: result.blockers,
      candidates: result.candidates,
    }),
  );
  assert.equal(result.lock.primary.story_id, "primary-ready");
  assert.equal(result.lock.primary.media_sha256, HASH.media);
  assert.equal(result.lock.primary.qa_report_sha256, HASH.qa);
  assert.equal(result.lock.primary.eligibility_verdict, "GREEN");
  assert.equal(result.lock.reserve.story_id, "reserve-ready");
  assert.equal(result.lock.reserve.standby_authorised, true);
  assert.equal(
    result.lock.reserve.candidate_revision_sha256,
    reserveRevision,
  );
});

test("scheduler-shaped T-90 derives autonomous eligibility without querying or fabricating operator audit evidence", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-autonomous-eligibility-"),
  );
  t.after(() => fs.remove(outDir));
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      breaking_score REAL,
      virality_score REAL,
      quality_score REAL,
      score REAL,
      full_script TEXT,
      exported_path TEXT,
      audio_path TEXT,
      publish_status TEXT,
      youtube_post_id TEXT,
      published_at TEXT,
      timestamp TEXT,
      created_at TEXT,
      _extra TEXT
    );
    CREATE TABLE platform_publication_state (
      story_id TEXT, platform TEXT, lifecycle_state TEXT
    );
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY, story_id TEXT, platform TEXT,
      to_state TEXT, evidence_json TEXT
    );
  `);
  for (const [storyId, score, standby] of [
    ["autonomous-primary", 110, false],
    ["autonomous-reserve", 90, true],
  ]) {
    const exactCandidate =
      autonomousRunwayCandidate(storyId, standby);
    const admission = exactCandidate.admission;
    db.prepare(
      `INSERT INTO stories
         (id, title, breaking_score, score, full_script,
          exported_path, audio_path, publish_status,
          youtube_post_id, created_at, _extra)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`,
    ).run(
      storyId,
      `${storyId} exact story`,
      score,
      score,
      "A complete autonomous official-source narration.",
      `D:/pulse-data/${storyId}.mp4`,
      `D:/pulse-data/${storyId}.mp3`,
      "2026-07-28T16:00:00.000Z",
      JSON.stringify({
        breaking_fast_track: true,
        runway_eligibility_verdict: "GREEN",
        runway_standby_authorised: standby,
        source_evidence_sha256: HASH.source,
        script_sha256: HASH.script,
        media_sha256: HASH.media,
        qa_report_sha256: HASH.qa,
        rights_ledger_canonical_sha256: HASH.rights,
        admission_evidence_sha256:
          canonicalSha256(admission),
        candidate_revision_sha256: HASH.revision,
        candidate_binding_sha256:
          exactCandidate.candidate_binding_sha256,
        request_fingerprint:
          exactCandidate.request_fingerprint,
        autonomous_eligibility_attestation_sha256:
          exactCandidate
            .autonomous_eligibility_attestation_sha256,
        admission,
      }),
    );
  }
  const primaryAdmission = autonomousRunwayAdmission(
    "autonomous-primary",
  );
  const admissionJob = {
    id: 1701,
    kind: "admit_governed_publication",
    story_id: "autonomous-primary",
    status: "pending",
    run_at: "2026-07-28 17:45:00",
    idempotency_key:
      `admit:youtube:breaking_short:autonomous-primary:${HASH.revision}:` +
      "2026-07-28T19:00:00.000Z",
    payload: {
      lane_id: "breaking_short",
      story_id: "autonomous-primary",
      platform: "youtube",
      human_admission_required: false,
      candidate_revision_sha256: HASH.revision,
      admission: primaryAdmission,
      autonomous_jit_materialisation_required: true,
      publish_authority: false,
      external_posting: false,
    },
  };

  const result =
    await handlers.governed_youtube_runway_t90(
      {
        kind: "governed_youtube_runway_t90",
        run_at: "2026-07-28 17:30:00",
        payload: {
          phase: "T-90",
          publish_hour_utc: 19,
          scheduler_profile: "governed_multi_lane",
          out_dir: outDir,
        },
      },
      {
        repos: {
          db,
          jobs: {
            listPending() {
              return [admissionJob];
            },
            enqueue(request) {
              return {
                id: 1702,
                status: "pending",
                ...request,
              };
            },
          },
        },
        now: () => new Date("2026-07-28T17:30:00.000Z"),
        async notifyRunwayIncident() {},
      },
    );

  assert.equal(result.verdict, "GREEN", JSON.stringify(result));
  assert.equal(
    result.lock.primary.approval_type,
    "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
  );
  assert.equal(
    result.lock.reserve.approval_type,
    "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
  );
  for (const role of ["primary", "reserve"]) {
    assert.equal(
      Object.hasOwn(
        result.lock[role],
        "human_review_evidence_sha256",
      ),
      false,
    );
    assert.equal(
      Object.hasOwn(
        result.lock[role],
        "human_review_event_id",
      ),
      false,
    );
  }
});

test("T+15 derives HIT from canonical published state, ledger, platform post and exact story projection", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-canonical-hit-"),
  );
  t.after(() => fs.remove(outDir));
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        kind: "governed_youtube_runway_t90",
        run_at: "2026-07-28 17:30:00",
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        repos: {},
        async notifyRunwayIncident() {},
      },
    );
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE platform_publication_state (
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      verification_status TEXT,
      verified_at TEXT,
      last_event_id INTEGER
    );
    CREATE TABLE platform_dispatch_ledger (
      id INTEGER PRIMARY KEY,
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      event_type TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      verification_status TEXT,
      verification_evidence_json TEXT
    );
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY,
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      published_at TEXT
    );
  `);
  const externalId = "yt_canonical_hit";
  const externalUrl =
    `https://www.youtube.com/watch?v=${externalId}`;
  db.prepare(
    `INSERT INTO platform_dispatch_ledger
       (id, story_id, platform, event_type, external_id)
     VALUES (901, ?, 'youtube', 'PLATFORM_OBJECT_CREATED', ?)`,
  ).run("primary-ready", externalId);
  db.prepare(
    `INSERT INTO platform_dispatch_ledger
       (id, story_id, platform, event_type, verification_status,
        verification_evidence_json)
     VALUES (902, ?, 'youtube', 'PUBLISHED', 'confirmed', ?)`,
  ).run(
    "primary-ready",
    JSON.stringify({
      external_id: externalId,
      visibility: "public",
      upload_status: "processed",
    }),
  );
  db.prepare(
    `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state, external_id,
        external_url, verification_status, verified_at,
        last_event_id)
     VALUES (?, 'youtube', 'PUBLISHED', ?, ?, 'confirmed', ?, 902)`,
  ).run(
    "primary-ready",
    externalId,
    externalUrl,
    "2026-07-28T19:03:00.000Z",
  );
  db.prepare(
    `INSERT INTO platform_posts
       (id, story_id, platform, status, external_id,
        external_url, published_at)
     VALUES (903, ?, 'youtube', 'published', ?, ?, ?)`,
  ).run(
    "primary-ready",
    externalId,
    externalUrl,
    "2026-07-28T19:03:00.000Z",
  );
  const repos = {
    db,
    stories: {
      get(storyId) {
        return storyId === "primary-ready"
          ? {
              id: storyId,
              youtube_post_id: externalId,
              youtube_url: externalUrl,
              youtube_published_at:
                "2026-07-28T19:03:00.000Z",
              publish_status: "published",
            }
          : null;
      },
    },
  };

  const outcome =
    await handlers.governed_youtube_runway_tplus15(
      {
        kind: "governed_youtube_runway_tplus15",
        run_at: "2026-07-28 19:15:00",
        payload: {
          now: "2026-07-28T19:15:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          lock: t90.lock,
        },
      },
      {
        repos,
        async notifyRunwayIncident() {
          throw new Error("canonical HIT must not notify");
        },
      },
    );

  assert.equal(outcome.classification, "HIT");
  assert.equal(outcome.publication.external_id, externalId);
});

test("T+15 fails closed when canonical platform and story identities differ", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-canonical-mismatch-"),
  );
  t.after(() => fs.remove(outDir));
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        kind: "governed_youtube_runway_t90",
        run_at: "2026-07-28 17:30:00",
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        repos: {},
        async notifyRunwayIncident() {},
      },
    );
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE platform_publication_state (
      story_id TEXT, platform TEXT, lifecycle_state TEXT,
      external_id TEXT, external_url TEXT,
      verification_status TEXT, verified_at TEXT,
      last_event_id INTEGER
    );
    CREATE TABLE platform_dispatch_ledger (
      id INTEGER PRIMARY KEY, story_id TEXT, platform TEXT,
      event_type TEXT, external_id TEXT, external_url TEXT,
      verification_status TEXT, verification_evidence_json TEXT
    );
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY, story_id TEXT, platform TEXT,
      status TEXT, external_id TEXT, external_url TEXT,
      published_at TEXT
    );
  `);
  const externalId = "yt_canonical_state";
  const externalUrl =
    `https://www.youtube.com/watch?v=${externalId}`;
  db.prepare(
    `INSERT INTO platform_dispatch_ledger
       VALUES (901, ?, 'youtube', 'PLATFORM_OBJECT_CREATED',
               ?, ?, NULL, NULL)`,
  ).run("primary-ready", externalId, externalUrl);
  db.prepare(
    `INSERT INTO platform_dispatch_ledger
       VALUES (902, ?, 'youtube', 'PUBLISHED',
               NULL, NULL, 'confirmed', ?)`,
  ).run(
    "primary-ready",
    JSON.stringify({ external_id: externalId }),
  );
  db.prepare(
    `INSERT INTO platform_publication_state
       VALUES (?, 'youtube', 'PUBLISHED', ?, ?, 'confirmed', ?, 902)`,
  ).run(
    "primary-ready",
    externalId,
    externalUrl,
    "2026-07-28T19:03:00.000Z",
  );
  db.prepare(
    `INSERT INTO platform_posts
       VALUES (903, ?, 'youtube', 'published', ?, ?, ?)`,
  ).run(
    "primary-ready",
    "yt_different_object",
    "https://www.youtube.com/watch?v=yt_different_object",
    "2026-07-28T19:03:00.000Z",
  );
  const notifications = [];
  const outcome =
    await handlers.governed_youtube_runway_tplus15(
      {
        kind: "governed_youtube_runway_tplus15",
        run_at: "2026-07-28 19:15:00",
        payload: {
          now: "2026-07-28T19:15:00.000Z",
          publish_hour_utc: 19,
          out_dir: outDir,
          lock: t90.lock,
        },
      },
      {
        repos: {
          db,
          stories: {
            get() {
              return {
                youtube_post_id: externalId,
                youtube_url: externalUrl,
                youtube_published_at:
                  "2026-07-28T19:03:00.000Z",
                publish_status: "published",
              };
            },
          },
        },
        async notifyRunwayIncident(incident) {
          notifications.push(incident);
        },
      },
    );

  assert.equal(outcome.classification, "EXTERNAL_FAILURE");
  assert.equal(outcome.publication, null);
  assert.equal(notifications.length, 1);
});

test("governed admission and dispatch enforce the persisted runway HOLD before lifecycle or platform contact", async (t) => {
  const stateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-enforcement-"),
  );
  t.after(() => fs.remove(stateRoot));
  const env = {
    PULSE_STATE_ROOT: stateRoot,
    PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
      "d".repeat(64),
  };
  const unauthorisedReserve = candidate(
    "reserve-ready",
    true,
  );
  unauthorisedReserve.standby_authorisation_event_id =
    null;
  unauthorisedReserve.standby_authorisation_sha256 =
    null;
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          candidates: [
            candidate("primary-ready", false),
            unauthorisedReserve,
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        env,
        repos: {},
        async notifyRunwayIncident() {},
      },
    );
  let admissionCalled = false;
  const admission = await handlers.admit_governed_publication(
    {
      id: 701,
      idempotency_key:
        `admit:youtube:breaking_short:primary-ready:${HASH.revision}:` +
        "2026-07-28T19:00:00.000Z",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: "primary-ready",
        platform: "youtube",
        guarded_admission_authority: true,
        candidate_revision_sha256: HASH.revision,
        admission: {
          human_review_status: "approved",
          actor_id: "operator",
          reason: "Reviewed exact final",
          confirmation_story_id: "primary-ready",
          scheduled_for: "2026-07-28T19:00:00.000Z",
          evidence: {},
        },
      },
    },
    {
      env,
      repos: {},
      async admitPublication() {
        admissionCalled = true;
      },
    },
  );
  assert.equal(admissionCalled, false);
  assert.equal(admission.status, "held");
  assert.ok(
    admission.blockers.includes(
      "runway_lock_artifact_required",
    ),
  );
  assert.equal(admission.lifecycle_mutation_attempted, false);

  let platformCalled = false;
  const dispatch =
    await handlers.dispatch_governed_publication(
      {
        id: 702,
        payload: {
          lane_id: "breaking_short",
          story_id: "primary-ready",
          platform: "youtube",
          scheduled_event_id: 801,
          scheduled_for: "2026-07-28T19:00:00.000Z",
          dispatch_idempotency_key:
            "youtube:primary-ready:2026-07-28T19:00:00.000Z",
          request_fingerprint: "a".repeat(64),
          runway_lock_sha256: t90.runway_lock_sha256,
          guarded_dispatch_authority: true,
        },
      },
      {
        env,
        repos: {},
        now: () => new Date("2026-07-28T19:00:00.000Z"),
        async resolveRunwayFreshControl() {
          return {
            verdict: "GREEN",
            checked_at: "2026-07-28T19:00:00.000Z",
            kill_switch_healthy: true,
            operating_contract_valid: true,
            scheduler_owner_healthy: true,
          };
        },
        async publishNextStory() {
          platformCalled = true;
        },
        async notifyRunwayIncident() {},
      },
    );
  assert.equal(platformCalled, false);
  assert.equal(dispatch.status, "held");
  assert.ok(
    dispatch.blockers.includes(
      "legacy_t0_upload_dispatch_forbidden_use_public_verifier",
    ),
  );
  assert.equal(dispatch.external_post_attempted, false);
  assert.equal(
    await fs.pathExists(
      path.join(
        stateRoot,
        "governed-youtube-runway",
        "2026-07-28",
        "1900",
        "incident-t0.json",
      ),
    ),
    false,
  );
});

test("SLO monitor accepts the private-first runway only after the T-15 source revalidation and exact arm", async (t) => {
  const fixture = await materialiseSloMonitorRunway(t);
  await fs.writeJson(
    path.join(
      fixture.windowDir,
      "t70-prestage-attempt-aaaaaaaaaaaa.json",
    ),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-70",
      evidence: {
        private_unscheduled_object_created: true,
        release_armed: false,
        scheduled_release_authority_created: false,
        release_commitment_confirmed: false,
      },
    }),
  );
  await fs.writeJson(
    path.join(fixture.windowDir, "t60-readiness.json"),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-60",
      evidence: {
        private_unscheduled_verified: true,
        upload_processed: true,
        publish_at_absent: true,
        release_armed: false,
        release_commitment_confirmed: false,
        remote_disarm_confirmed: false,
      },
    }),
  );
  await fs.writeJson(
    path.join(
      fixture.windowDir,
      "tminus15-readiness.json",
    ),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-15",
      evidence: {
        official_source_revalidated: true,
        schedule_arm_confirmed: true,
        release_armed: true,
        remote_schedule_verified: true,
        release_commitment_confirmed: true,
        remote_disarm_confirmed: false,
      },
    }),
  );

  const result =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T18:46:00.000Z",
          runway_root: fixture.runwayRoot,
        },
      },
      fixture.context,
    );

  assert.equal(result.status, "healthy", JSON.stringify(result));
  assert.deepEqual(result.missing_phases, []);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.catch_up_allowed, false);
});

test("SLO monitor rejects a GREEN T-15 checkpoint bound to the wrong exact release identity", async (t) => {
  const fixture = await materialiseSloMonitorRunway(t);
  await fs.writeJson(
    path.join(
      fixture.windowDir,
      "t70-prestage-attempt-aaaaaaaaaaaa.json",
    ),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-70",
      evidence: {
        private_unscheduled_object_created: true,
        release_armed: false,
        scheduled_release_authority_created: false,
        release_commitment_confirmed: false,
      },
    }),
  );
  await fs.writeJson(
    path.join(fixture.windowDir, "t60-readiness.json"),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-60",
      evidence: {
        private_unscheduled_verified: true,
        upload_processed: true,
        publish_at_absent: true,
        release_armed: false,
        release_commitment_confirmed: false,
        remote_disarm_confirmed: false,
      },
    }),
  );
  await fs.writeJson(
    path.join(
      fixture.windowDir,
      "tminus15-readiness.json",
    ),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-15",
      evidence: {
        selected_role: "reserve",
        selected_story_id: fixture.lock.reserve.story_id,
        story_id: fixture.lock.reserve.story_id,
        request_fingerprint: "f".repeat(64),
        official_source_revalidated: true,
        schedule_arm_confirmed: true,
        release_armed: true,
        remote_schedule_verified: true,
        release_commitment_confirmed: true,
        remote_disarm_confirmed: false,
      },
    }),
  );

  const result =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T18:46:00.000Z",
          runway_root: fixture.runwayRoot,
        },
      },
      fixture.context,
    );

  assert.equal(result.status, "held");
  assert.ok(
    result.missing_phases.includes("T-15"),
    JSON.stringify(result),
  );
});

test("SLO monitor rejects a stale GREEN T-15 checkpoint after governance enters reconciliation", async (t) => {
  const fixture = await materialiseSloMonitorRunway(t);
  await fs.writeJson(
    path.join(
      fixture.windowDir,
      "t70-prestage-attempt-aaaaaaaaaaaa.json",
    ),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-70",
      evidence: {
        private_unscheduled_object_created: true,
        release_armed: false,
        scheduled_release_authority_created: false,
        release_commitment_confirmed: false,
      },
    }),
  );
  await fs.writeJson(
    path.join(fixture.windowDir, "t60-readiness.json"),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-60",
      evidence: {
        private_unscheduled_verified: true,
        upload_processed: true,
        publish_at_absent: true,
        release_armed: false,
        release_commitment_confirmed: false,
        remote_disarm_confirmed: false,
      },
    }),
  );
  await fs.writeJson(
    path.join(
      fixture.windowDir,
      "tminus15-readiness.json",
    ),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-15",
      evidence: {
        official_source_revalidated: true,
        schedule_arm_confirmed: true,
        release_armed: true,
        remote_schedule_verified: true,
        release_commitment_confirmed: true,
        remote_disarm_confirmed: false,
      },
    }),
  );
  fixture.publicationState.lifecycle_state =
    "RECONCILIATION_REQUIRED";
  fixture.publicationState.verification_status =
    "reconciliation_required";

  const result =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T18:46:00.000Z",
          runway_root: fixture.runwayRoot,
        },
      },
      fixture.context,
    );

  assert.equal(result.status, "held");
  assert.ok(
    result.missing_phases.includes("T-15"),
    JSON.stringify(result),
  );
});

test("SLO monitor rejects a forged T+15 HIT for the non-selected locked release", async (t) => {
  const fixture = await materialiseSloMonitorRunway(t);
  await fs.writeJson(
    path.join(fixture.windowDir, "tplus15-outcome.json"),
    {
      schema_version:
        "pulse-governed-youtube-window-outcome-v1",
      phase: "T+15",
      generated_at: "2026-07-28T19:15:00.000Z",
      scheduled_for: fixture.lock.scheduled_for,
      classification: "HIT",
      verdict: "GREEN",
      blockers: [],
      runway_lock_sha256: fixture.lock.lock_sha256,
      selected_release: {
        role: "reserve",
        story_id: fixture.lock.reserve.story_id,
      },
      selected_publication_identity_count: 1,
      locked_publication_observation_scope: {
        complete: true,
        required_story_ids: [
          fixture.lock.primary.story_id,
          fixture.lock.reserve.story_id,
        ],
        observed_story_ids: [
          fixture.lock.primary.story_id,
          fixture.lock.reserve.story_id,
        ],
      },
      publication: {
        story_id: fixture.lock.reserve.story_id,
        external_id: "youtube-reserve-object",
        external_url:
          "https://www.youtube.com/watch?v=youtube-reserve-object",
        published_at: "2026-07-28T19:03:00.000Z",
        verification_status: "confirmed",
      },
    },
  );

  const result =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T19:21:00.000Z",
          runway_root: fixture.runwayRoot,
        },
      },
      fixture.context,
    );

  assert.equal(result.status, "held");
  assert.ok(
    result.missing_phases.includes("T+15"),
    JSON.stringify(result),
  );
});

test("SLO monitor preserves the exact T-15 proof after the selected release advances to PUBLISHED", async (t) => {
  const fixture = await materialiseSloMonitorRunway(t);
  for (const [filename, phase, evidence] of [
    [
      "t70-prestage-attempt-aaaaaaaaaaaa.json",
      "T-70",
      {
        private_unscheduled_object_created: true,
        release_armed: false,
        scheduled_release_authority_created: false,
        release_commitment_confirmed: false,
      },
    ],
    [
      "t60-readiness.json",
      "T-60",
      {
        private_unscheduled_verified: true,
        upload_processed: true,
        publish_at_absent: true,
        release_armed: false,
        release_commitment_confirmed: false,
        remote_disarm_confirmed: false,
      },
    ],
    [
      "tminus15-readiness.json",
      "T-15",
      {
        official_source_revalidated: true,
        schedule_arm_confirmed: true,
        release_armed: true,
        remote_schedule_verified: true,
        release_commitment_confirmed: true,
        remote_disarm_confirmed: false,
      },
    ],
    [
      "t0-dispatch-verification.json",
      "T0",
      {
        public_release_confirmed: true,
        release_commitment_asserted: true,
        upload_attempted: false,
      },
    ],
  ]) {
    await fs.writeJson(
      path.join(fixture.windowDir, filename),
      exactSloCheckpoint({
        lock: fixture.lock,
        phase,
        evidence,
      }),
    );
  }
  await fs.writeJson(
    path.join(fixture.windowDir, "tplus15-outcome.json"),
    {
      schema_version:
        "pulse-governed-youtube-window-outcome-v1",
      phase: "T+15",
      generated_at: "2026-07-28T19:15:00.000Z",
      scheduled_for: fixture.lock.scheduled_for,
      classification: "HIT",
      verdict: "GREEN",
      blockers: [],
      runway_lock_sha256: fixture.lock.lock_sha256,
      selected_release: {
        role: "primary",
        story_id: fixture.lock.primary.story_id,
      },
      selected_publication_identity_count: 1,
      locked_publication_observation_scope: {
        complete: true,
        required_story_ids: [
          fixture.lock.primary.story_id,
          fixture.lock.reserve.story_id,
        ],
        observed_story_ids: [
          fixture.lock.primary.story_id,
          fixture.lock.reserve.story_id,
        ],
      },
      publication: {
        story_id: fixture.lock.primary.story_id,
        external_id: "youtube-primary-object",
        external_url:
          "https://www.youtube.com/watch?v=youtube-primary-object",
        published_at: "2026-07-28T19:03:00.000Z",
        verification_status: "confirmed",
      },
    },
  );
  fixture.publicationState.lifecycle_state = "PUBLISHED";
  fixture.publicationState.verification_status = "confirmed";
  const getAdmissionJob =
    fixture.context.repos.jobs.getByIdempotencyKey;
  fixture.context.repos.jobs.getByIdempotencyKey = (key) =>
    key === `verify-public:youtube:801:${"a".repeat(64)}`
      ? {
          id: 803,
          kind: "verify_governed_youtube_release_t0",
          status: "done",
          idempotency_key: key,
        }
      : getAdmissionJob(key);

  const result =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T19:21:00.000Z",
          runway_root: fixture.runwayRoot,
        },
      },
      fixture.context,
    );

  assert.equal(result.status, "healthy", JSON.stringify(result));
  assert.deepEqual(result.missing_phases, []);
});

test("SLO monitor rejects legacy early scheduling and a T-15 checkpoint without source revalidation", async (t) => {
  const fixture = await materialiseSloMonitorRunway(t);
  await fs.writeJson(
    path.join(
      fixture.windowDir,
      "t70-prestage-attempt-aaaaaaaaaaaa.json",
    ),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-70",
      evidence: {
        release_armed: true,
        scheduled_release_authority_created: true,
        release_commitment_confirmed: true,
        final_release_commitment: true,
        commitment_frozen_at:
          "2026-07-28T17:50:00.000Z",
      },
    }),
  );
  await fs.writeJson(
    path.join(fixture.windowDir, "t60-readiness.json"),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-60",
      evidence: {
        remote_schedule_verified: true,
        release_commitment_confirmed: true,
        public_release_authority_active: true,
        remote_disarm_confirmed: false,
      },
    }),
  );
  await fs.writeJson(
    path.join(
      fixture.windowDir,
      "tminus15-readiness.json",
    ),
    exactSloCheckpoint({
      lock: fixture.lock,
      phase: "T-15",
      evidence: {
        remote_schedule_verified: true,
        release_commitment_reverified: true,
        release_commitment_confirmed: true,
        remote_disarm_confirmed: false,
      },
    }),
  );

  const result =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T18:46:00.000Z",
          runway_root: fixture.runwayRoot,
        },
      },
      fixture.context,
    );

  assert.equal(result.status, "held");
  assert.deepEqual(result.missing_phases, [
    "T-70",
    "T-60",
    "T-15",
  ]);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.catch_up_allowed, false);
});

test("every-minute SLO monitor raises MISSED_INTERNAL for missing checkpoint artefacts without catch-up", async (t) => {
  const runwayRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-slo-"),
  );
  t.after(() => fs.remove(runwayRoot));
  const notifications = [];
  const windowDir = path.join(
    runwayRoot,
    "2026-07-28",
    "0900",
  );
  await fs.ensureDir(windowDir);
  for (const [filename, phase] of [
    ["t70-prestage-attempt-aaaaaaaaaaaa.json", "T-70"],
    ["tminus15-readiness.json", "T-15"],
    ["t0-dispatch-verification.json", "T0"],
    ["tplus15-outcome.json", "T+15"],
  ]) {
    await fs.writeJson(path.join(windowDir, filename), {
      phase,
      scheduled_for: "2026-07-28T09:00:00.000Z",
      verdict: "HOLD",
      blockers: ["deliberate_test_hold"],
    });
  }
  await fs.writeJson(
    path.join(windowDir, "incident-t0.json"),
    {
      phase: "T0",
      classification: "MISSED_INTERNAL",
      verdict: "HOLD",
    },
  );
  const job = {
    payload: {
      now: "2026-07-28T09:21:00.000Z",
      runway_root: runwayRoot,
      publish_authority: false,
      catch_up_allowed: false,
    },
  };
  const ctx = {
    async notifyRunwayIncident(incident) {
      notifications.push(incident);
    },
  };

  const first =
    await handlers.governed_youtube_runway_slo_monitor(
      job,
      ctx,
    );
  const replay =
    await handlers.governed_youtube_runway_slo_monitor(
      job,
      ctx,
    );

  assert.equal(first.status, "held");
  assert.equal(first.classification, "MISSED_INTERNAL");
  assert.deepEqual(first.missing_phases, [
    "T-90",
    "T-75",
    "T-70",
    "T-60",
    "T-15",
    "T0",
    "T+15",
  ]);
  assert.equal(first.catch_up_allowed, false);
  assert.equal(first.publish_authority_created, false);
  for (const phase of ["T-70", "T-15", "T0", "T+15"]) {
    assert.ok(
      first.blockers.includes(
        `runway_checkpoint_not_green:${phase}:2026-07-28T09:00:00.000Z`,
      ),
    );
  }
  assert.equal(replay.notification_sent, false);
  assert.equal(replay.notifications_sent, 0);
  assert.equal(notifications.length, 7);
  assert.equal(
    await fs.pathExists(first.incident_json),
    true,
  );
});

test("SLO monitor never synthesises T-15 remote readiness from local admission and pending jobs", async (t) => {
  const stateRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-runway-tminus15-slo-"),
  );
  t.after(() => fs.remove(stateRoot));
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY,
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      to_state TEXT NOT NULL,
      evidence_json TEXT,
      created_at TEXT
    );
    CREATE TABLE platform_publication_state (
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      PRIMARY KEY (story_id, platform)
    );
  `);
  const pendingAdmission = primaryAdmissionJob();
  const jobs = {
    listPending() {
      return [pendingAdmission];
    },
    get(id) {
      return id === 701
        ? { ...pendingAdmission, status: "done" }
        : null;
    },
    getByIdempotencyKey(key) {
      if (key === pendingAdmission.idempotency_key) {
        return {
          ...pendingAdmission,
          status: "done",
        };
      }
      return key ===
        `dispatch:youtube:801:${"a".repeat(64)}`
        ? {
            id: 802,
            kind: "dispatch_governed_publication",
            status: "pending",
            run_at: "2026-07-28 19:00:00",
            idempotency_key: key,
          }
        : null;
    },
  };
  const ctx = {
    env: { PULSE_STATE_ROOT: stateRoot },
    repos: { db, jobs },
    async notifyRunwayIncident() {},
  };
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [pendingAdmission],
        },
      },
      ctx,
    );
  await handlers.governed_youtube_runway_t60(
    {
      kind: "governed_youtube_runway_t60",
      run_at: "2026-07-28 18:00:00",
      payload: {
        now: "2026-07-28T18:00:00.000Z",
        scheduled_for:
          "2026-07-28T19:00:00.000Z",
        story_id: "primary-ready",
        lane_id: "breaking_short",
        runway_lock_sha256: t90.runway_lock_sha256,
        private_only: true,
        private_prestage_authority: false,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    ctx,
  );
  await fs.writeJson(
    path.join(
      stateRoot,
      "governed-youtube-runway",
      "2026-07-28",
      "1900",
      "t70-prestage-attempt-000000000000.json",
    ),
    {
      phase: "T-70",
      scheduled_for: "2026-07-28T19:00:00.000Z",
      verdict: "GREEN",
    },
  );
  db.prepare(
    `INSERT INTO publication_lifecycle_events
       (id, story_id, platform, to_state, evidence_json, created_at)
     VALUES (801, 'primary-ready', 'youtube', 'SCHEDULED', ?, ?)`,
  ).run(
    JSON.stringify({
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at:
        "2026-07-28T18:45:00.000Z",
      scheduled_for: "2026-07-28T19:00:00.000Z",
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key:
        "youtube:primary-ready:2026-07-28T19:00:00.000Z",
      request_fingerprint: "a".repeat(64),
      runway_lock_sha256: t90.runway_lock_sha256,
    }),
    "2026-07-28T18:45:00.000Z",
  );
  db.prepare(
    `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state)
     VALUES ('primary-ready', 'youtube', 'SCHEDULED')`,
  ).run();

  const result =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T18:46:00.000Z",
          runway_root: path.join(
            stateRoot,
            "governed-youtube-runway",
          ),
        },
      },
      ctx,
    );

  assert.equal(result.status, "held");
  assert.deepEqual(result.missing_phases, [
    "T-90",
    "T-70",
    "T-60",
    "T-15",
  ]);
  assert.ok(
    result.blockers.includes(
      "runway_checkpoint_not_green:T-90:2026-07-28T19:00:00.000Z",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "runway_checkpoint_not_green:T-60:2026-07-28T19:00:00.000Z",
    ),
  );
  assert.ok(
    result.blockers.includes(
      "runway_checkpoint_missing:T-15:2026-07-28T19:00:00.000Z",
    ),
  );
  assert.equal(
    await fs.pathExists(
      path.join(
        stateRoot,
        "governed-youtube-runway",
        "2026-07-28",
        "1900",
        "tminus15-readiness.json",
      ),
    ),
    false,
  );
});

test("T-70 anchors one exact private unscheduled object without creating release authority", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "pulse-runway-t70-private-unscheduled-",
    ),
  );
  t.after(() => fs.remove(outDir));
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE operator_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      decision TEXT,
      reason TEXT,
      evidence_json TEXT,
      idempotency_key TEXT
    );
  `);
  const queued = [];
  const jobs = {
    enqueue(request) {
      const row = {
        id: queued.length + 900,
        status: "pending",
        ...structuredClone(request),
      };
      queued.push(row);
      return row;
    },
    listPending() {
      return [primaryAdmissionJob()];
    },
  };
  const env = {
    PULSE_STATE_ROOT: outDir,
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
  };
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        env,
        repos: { db, jobs },
        async notifyRunwayIncident() {},
      },
    );
  assert.equal(t90.verdict, "GREEN");

  let state = null;
  const result =
    await handlers.prestage_governed_youtube_release(
      {
        kind: "prestage_governed_youtube_release",
        channel_id: "pulse-gaming",
        run_at: "2026-07-28 17:50:00",
        payload: {
          now: "2026-07-28T17:50:00.000Z",
          story_id: "primary-ready",
          platform: "youtube",
          scheduled_for:
            "2026-07-28T19:00:00.000Z",
          scheduled_event_id: 801,
          request_fingerprint: "a".repeat(64),
          runway_lock_sha256:
            t90.runway_lock_sha256,
          private_prestage_authority: true,
          catch_up_allowed: false,
          publish_authority: false,
          external_posting: false,
        },
      },
      {
        env,
        workerId: "critical-window-worker",
        assertLeaseHealthy() {},
        irreversibleBoundaryNow: () =>
          new Date("2026-07-28T18:00:00.000Z"),
        repos: {
          db,
          jobs,
          publicationGovernance: {
            getState() {
              return state ? { ...state } : null;
            },
            getLatestLifecycleEvent(
              storyId,
              platform,
              toState,
            ) {
              return storyId === "primary-ready" &&
                platform === "youtube" &&
                toState === "SCHEDULED"
                ? {
                    id: 801,
                    story_id: storyId,
                    platform,
                    to_state: toState,
                    evidence_json: JSON.stringify({
                      scheduled_for:
                        "2026-07-28T19:00:00.000Z",
                      dispatch_idempotency_key:
                        "youtube:primary-ready:2026-07-28T19:00:00.000Z",
                      request_fingerprint:
                        "a".repeat(64),
                      runway_lock_sha256:
                        t90.runway_lock_sha256,
                    }),
                  }
                : null;
            },
          },
        },
        resolveRunwayFreshControl() {
          return {
            verdict: "GREEN",
            checked_at:
              "2026-07-28T17:50:00.000Z",
            kill_switch_healthy: true,
            operating_contract_valid: true,
            scheduler_owner_healthy: true,
            live_publish_enabled: true,
          };
        },
        async prestageExactGovernedYoutubeRelease() {
          state = {
            lifecycle_state:
              "PLATFORM_OBJECT_CREATED",
            external_id: "youtube-primary-object",
            verification_status:
              "private_unscheduled_processing",
          };
          return {
            status: "platform_object_created",
            releaseState: "private_unscheduled",
            scheduled: false,
            releaseArmed: false,
            platformContacted: true,
            externalId: "youtube-primary-object",
            governanceState: { ...state },
          };
        },
        async notifyRunwayIncident() {},
      },
    );

  assert.equal(
    result.status,
    "platform_object_created",
    JSON.stringify(result),
  );
  assert.equal(result.verdict, "GREEN");
  assert.equal(
    result.private_unscheduled_object_created,
    true,
  );
  assert.equal(result.release_armed, false);
  assert.equal(
    result.scheduled_release_authority_created,
    false,
  );
  assert.equal(
    result.release_commitment_confirmed,
    false,
  );
  assert.equal(result.final_release_commitment, false);
  assert.equal(result.reserve_promoted, false);

  const checkpoint = await fs.readJson(
    result.readiness_json,
  );
  assert.equal(checkpoint.verdict, "GREEN");
  assert.equal(
    checkpoint.private_unscheduled_object_created,
    true,
  );
  assert.equal(checkpoint.release_armed, false);
  assert.equal(
    checkpoint.scheduled_release_authority_created,
    false,
  );
  assert.equal(
    checkpoint.release_commitment_confirmed,
    false,
  );
  assert.equal(
    checkpoint.final_release_commitment,
    false,
  );
  assert.equal(
    checkpoint.platform_state,
    "PLATFORM_OBJECT_CREATED",
  );
  assert.equal(
    checkpoint.external_id,
    "youtube-primary-object",
  );
});

test("T-60 verifies one exact private processed unscheduled object without disarm, promotion or commitment", async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "pulse-runway-confirmed-disarm-recovery-",
    ),
  );
  t.after(() => fs.remove(outDir));
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE operator_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      decision TEXT,
      reason TEXT,
      evidence_json TEXT,
      idempotency_key TEXT
    );
    CREATE TABLE platform_dispatch_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      channel_id TEXT,
      platform TEXT NOT NULL,
      idempotency_key TEXT,
      event_type TEXT NOT NULL,
      external_id TEXT,
      request_fingerprint TEXT,
      retryability_class TEXT,
      verification_status TEXT,
      verification_evidence_json TEXT
    );
  `);
  const queued = [];
  const jobs = {
    enqueue(request) {
      const row = {
        id: queued.length + 900,
        status: "pending",
        ...structuredClone(request),
      };
      queued.push(row);
      return row;
    },
    listPending() {
      return [primaryAdmissionJob()];
    },
  };
  const t90 =
    await handlers.governed_youtube_runway_t90(
      {
        payload: {
          now: "2026-07-28T17:30:00.000Z",
          publish_hour_utc: 19,
          candidates: [
            candidate("primary-ready", false),
            candidate("reserve-ready", true),
          ],
          admission_jobs: [primaryAdmissionJob()],
        },
      },
      {
        env: { PULSE_STATE_ROOT: outDir },
        repos: { db, jobs },
        async notifyRunwayIncident() {},
      },
    );
  assert.equal(t90.verdict, "GREEN");
  const scheduledEvidence = {
    scheduled_for: "2026-07-28T19:00:00.000Z",
    dispatch_idempotency_key:
      "youtube:primary-ready:2026-07-28T19:00:00.000Z",
    request_fingerprint: "a".repeat(64),
    runway_lock_sha256: t90.runway_lock_sha256,
  };
  let state = {
    lifecycle_state: "PLATFORM_OBJECT_CREATED",
    external_id: "youtube-primary-object",
    verification_status: "processing",
    last_event_id: 41,
  };
  const governance = {
    getState() {
      return { ...state };
    },
    getLatestLifecycleEvent(
      storyId,
      platform,
      toState,
    ) {
      return storyId === "primary-ready" &&
        platform === "youtube" &&
        toState === "SCHEDULED"
        ? {
            id: 801,
            story_id: storyId,
            platform,
            to_state: toState,
            evidence_json:
              JSON.stringify(scheduledEvidence),
          }
        : null;
    },
  };
  let disarmCalls = 0;
  let promotionCalls = 0;
  const env = {
    PULSE_STATE_ROOT: outDir,
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
  };
  const t60Job = queued.find(
    (row) =>
      row.kind === "governed_youtube_runway_t60",
  );
  assert.ok(t60Job);

  const result =
    await handlers.governed_youtube_runway_t60(
      {
        ...t60Job,
        run_at: "2026-07-28 18:00:00",
        payload: {
          ...t60Job.payload,
          now: "2026-07-28T18:00:00.000Z",
        },
      },
      {
        env,
        workerId: "critical-window-worker",
        assertLeaseHealthy() {},
        irreversibleBoundaryNow: () =>
          new Date("2026-07-28T18:00:00.000Z"),
        repos: {
          db,
          jobs,
          publicationGovernance: governance,
          runtimeLeases: {},
        },
        resolveRunwayFreshControl() {
          return {
            verdict: "GREEN",
            checked_at:
              "2026-07-28T18:00:00.000Z",
            kill_switch_healthy: true,
            operating_contract_valid: true,
            scheduler_owner_healthy: true,
            live_publish_enabled: true,
          };
        },
        async verifyExactGovernedYoutubePrivatePrestage() {
          state = {
            lifecycle_state: "PLATFORM_OBJECT_CREATED",
            external_id: "youtube-primary-object",
            verification_status:
              "private_unscheduled_processed",
            last_event_id: 42,
          };
          return {
            status: "private_object_verified",
            scheduled: false,
            releaseArmed: false,
            releaseCommitmentConfirmed: false,
            externalId: "youtube-primary-object",
          };
        },
        async disarmExactGovernedYoutubeScheduledRelease() {
          disarmCalls += 1;
          throw new Error(
            "T-60 must not disarm a private unscheduled object",
          );
        },
        async runWithPublisherLease(input) {
          return input.task({
            assertHealthy() {},
          });
        },
        async promoteGovernedYoutubeReserveRelease() {
          promotionCalls += 1;
          throw new Error(
            "T-60 must not promote the reserve",
          );
        },
        async notifyRunwayIncident() {},
      },
    );

  assert.equal(
    result.status,
    "ready",
    JSON.stringify(result),
  );
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.private_unscheduled_verified, true);
  assert.equal(result.upload_processed, true);
  assert.equal(result.publish_at_absent, true);
  assert.equal(result.release_armed, false);
  assert.equal(
    result.release_commitment_confirmed,
    false,
  );
  assert.equal(result.remote_schedule_verified, false);
  assert.equal(result.remote_disarm_required, false);
  assert.equal(result.reserve_recovery_attempted, false);
  assert.equal(result.reserve_promoted, false);
  assert.equal(disarmCalls, 0);
  assert.equal(promotionCalls, 0);
  const checkpoint = await fs.readJson(
    result.readiness_json,
  );
  assert.equal(
    checkpoint.private_unscheduled_verified,
    true,
  );
  assert.equal(checkpoint.upload_processed, true);
  assert.equal(checkpoint.publish_at_absent, true);
  assert.equal(checkpoint.release_armed, false);
  assert.equal(
    checkpoint.release_commitment_confirmed,
    false,
  );
  assert.equal(checkpoint.remote_disarm_attempted, false);
  assert.equal(checkpoint.reserve_promoted, false);
});

test("T-60 transient private processing retries, then confirms the same object and writes one GREEN checkpoint", async (t) => {
  const runway = await materialiseSloMonitorRunway(t);
  runway.publicationState.lifecycle_state =
    "PLATFORM_OBJECT_CREATED";
  runway.publicationState.verification_status =
    "private_unscheduled_processing";
  const env = {
    PULSE_STATE_ROOT: runway.runwayRoot,
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
  };
  let readCalls = 0;
  let finaliseCalls = 0;
  let clockNow =
    "2026-07-28T18:00:00.000Z";
  const job = {
    kind: "governed_youtube_runway_t60",
    channel_id: "pulse-gaming",
    story_id: "primary-ready",
    attempt_count: 1,
    run_at: "2026-07-28 18:00:00",
    payload: {
      phase: "T-60",
      now: "2026-07-28T18:00:00.000Z",
      scheduled_for: runway.lock.scheduled_for,
      story_id: "primary-ready",
      platform: "youtube",
      runway_root: runway.runwayRoot,
      runway_lock_sha256: runway.lock.lock_sha256,
      readiness_verification_authority: true,
      publish_authority: false,
      external_posting: false,
    },
  };
  const context = {
    ...runway.context,
    env,
    workerId: "critical-window-worker",
    assertLeaseHealthy() {},
    irreversibleBoundaryNow: () =>
      new Date(clockNow),
    resolveRunwayFreshControl() {
      return {
        verdict: "GREEN",
        checked_at: job.payload.now,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        scheduler_owner_healthy: true,
        live_publish_enabled: true,
      };
    },
    async verifyYoutubePrivateObject(candidate, options) {
      readCalls += 1;
      assert.equal(
        candidate.externalId,
        "youtube-primary-object",
      );
      assert.equal(options.maxAttempts, 1);
      assert.ok(options.signal);
      if (readCalls === 1) {
        return {
          confirmed: false,
          externalId: "youtube-primary-object",
          verifiedAt: clockNow,
          reason: "youtube_private_object_upload_not_processed",
          evidence: {
            platform: "youtube",
            platform_object_confirmed: true,
            privacy_status: "private",
            upload_status: "uploaded",
            processing_status: "processing",
            publish_at: null,
            publish_at_present: false,
            release_armed: false,
            reason:
              "youtube_private_object_upload_not_processed",
          },
        };
      }
      return {
        confirmed: true,
        externalId: "youtube-primary-object",
        verifiedAt: clockNow,
        reason: "youtube_private_unscheduled_processed",
        evidence: {
          platform: "youtube",
          platform_object_confirmed: true,
          privacy_status: "private",
          upload_status: "processed",
          processing_status: "succeeded",
          publish_at: null,
          publish_at_present: false,
          release_armed: false,
          reason: "youtube_private_unscheduled_processed",
        },
      };
    },
    async verifyExactGovernedYoutubePrivatePrestage(input) {
      finaliseCalls += 1;
      assert.equal(
        input.exactStagedBinding.external_id,
        "youtube-primary-object",
      );
      const replayed = await input
        .createYoutubePrivateObjectVerifier()({
          platform: "youtube",
          externalId: "youtube-primary-object",
        });
      assert.equal(replayed.confirmed, true);
      runway.publicationState.lifecycle_state =
        "PLATFORM_OBJECT_CREATED";
      runway.publicationState.verification_status =
        "private_unscheduled_processed";
      return {
        status: "private_object_verified",
        scheduled: false,
        releaseArmed: false,
        releaseCommitmentConfirmed: false,
        externalId: "youtube-primary-object",
      };
    },
  };

  const result =
    await handlers.governed_youtube_runway_t60(
      job,
      context,
    );

  assert.equal(result.status, "held");
  assert.equal(
    result.job_outcome,
    "RETRY",
    JSON.stringify(result),
  );
  assert.equal(result.retryable, true);
  assert.equal(result.retry_after_seconds, 60);
  assert.equal(result.terminal, false);
  assert.equal(result.retry_allowed, true);
  assert.equal(readCalls, 1);
  assert.equal(finaliseCalls, 0);
  assert.equal(
    await fs.pathExists(
      path.join(runway.windowDir, "t60-readiness.json"),
    ),
    false,
  );
  assert.equal(
    await fs.pathExists(
      path.join(runway.windowDir, "incident-tminus60.json"),
    ),
    false,
  );
  const inProgressSlo =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T18:01:00.000Z",
          runway_root: runway.runwayRoot,
        },
      },
      runway.context,
    );
  assert.equal(
    inProgressSlo.missing_phases.includes("T-60"),
    false,
    JSON.stringify(inProgressSlo),
  );

  clockNow = "2026-07-28T18:01:00.000Z";
  job.attempt_count = 2;
  job.run_at = "2026-07-28 18:01:00";
  job.payload.now = clockNow;
  const confirmed =
    await handlers.governed_youtube_runway_t60(
      job,
      context,
    );

  assert.equal(confirmed.status, "ready", JSON.stringify(confirmed));
  assert.equal(confirmed.verdict, "GREEN");
  assert.equal(confirmed.private_unscheduled_verified, true);
  assert.equal(confirmed.retry_allowed, false);
  assert.equal(readCalls, 2);
  assert.equal(finaliseCalls, 1);
  const checkpoint = await fs.readJson(
    path.join(runway.windowDir, "t60-readiness.json"),
  );
  assert.equal(checkpoint.verdict, "GREEN");
  assert.equal(
    checkpoint.external_id,
    "youtube-primary-object",
  );
  assert.equal(
    await fs.pathExists(
      path.join(runway.windowDir, "incident-tminus60.json"),
    ),
    false,
  );
});

test("T0 propagation lag retries, then confirms and reconciles the exact public object once", async (t) => {
  const runway = await materialiseSloMonitorRunway(t);
  const env = {
    PULSE_STATE_ROOT: runway.runwayRoot,
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
  };
  let readCalls = 0;
  let confirmCalls = 0;
  let clockNow = "2026-07-28T19:00:00.000Z";
  const job = {
    kind: "verify_governed_youtube_release_t0",
    channel_id: "pulse-gaming",
    story_id: "primary-ready",
    attempt_count: 1,
    run_at: "2026-07-28 19:00:00",
    payload: {
      phase: "T0",
      now: clockNow,
      scheduled_for: runway.lock.scheduled_for,
      story_id: "primary-ready",
      platform: "youtube",
      runway_root: runway.runwayRoot,
      runway_lock_sha256: runway.lock.lock_sha256,
      public_verification_only: true,
      public_release_verification_authority: true,
      publish_authority: false,
      external_posting: false,
    },
  };
  const context = {
    ...runway.context,
    env,
    workerId: "critical-window-worker",
    assertLeaseHealthy() {},
    irreversibleBoundaryNow: () =>
      new Date(clockNow),
    async verifyYoutubePublicObject(candidate, options) {
      readCalls += 1;
      assert.equal(
        candidate.externalId,
        "youtube-primary-object",
      );
      assert.equal(options.maxAttempts, 1);
      assert.ok(options.signal);
      if (readCalls === 1) {
        return {
          confirmed: false,
          externalId: "youtube-primary-object",
          verifiedAt: clockNow,
          reason: "youtube_privacy_not_public",
          evidence: {
            platform: "youtube",
            platform_object_confirmed: true,
            public: false,
            privacy_status: "private",
            upload_status: "processed",
            reason: "youtube_privacy_not_public",
          },
        };
      }
      return {
        confirmed: true,
        externalId: "youtube-primary-object",
        externalUrl:
          "https://www.youtube.com/watch?v=youtube-primary-object",
        verifiedAt: clockNow,
        reason: "youtube_public_processed",
        evidence: {
          platform: "youtube",
          platform_object_confirmed: true,
          public: true,
          privacy_status: "public",
          upload_status: "processed",
          reason: "youtube_public_processed",
        },
      };
    },
    async confirmExactGovernedYoutubeScheduledRelease(input) {
      confirmCalls += 1;
      const replayed = await input.verifyPublic({
        platform: "youtube",
        externalId: "youtube-primary-object",
      });
      assert.equal(replayed.confirmed, true);
      runway.publicationState.lifecycle_state = "PUBLISHED";
      runway.publicationState.verification_status = "confirmed";
      return {
        status: "published",
        published: true,
        externalId: "youtube-primary-object",
        externalUrl:
          "https://www.youtube.com/watch?v=youtube-primary-object",
      };
    },
  };

  const result =
    await handlers.verify_governed_youtube_release_t0(
      job,
      context,
    );

  assert.equal(result.status, "held");
  assert.equal(result.job_outcome, "RETRY");
  assert.equal(result.retryable, true);
  assert.equal(result.retry_after_seconds, 60);
  assert.equal(result.terminal, false);
  assert.equal(result.retry_allowed, true);
  assert.equal(readCalls, 1);
  assert.equal(confirmCalls, 0);
  assert.equal(
    await fs.pathExists(
      path.join(
        runway.windowDir,
        "t0-dispatch-verification.json",
      ),
    ),
    false,
  );
  assert.equal(
    await fs.pathExists(
      path.join(runway.windowDir, "incident-t0.json"),
    ),
    false,
  );
  const inProgressSlo =
    await handlers.governed_youtube_runway_slo_monitor(
      {
        payload: {
          now: "2026-07-28T19:01:00.000Z",
          runway_root: runway.runwayRoot,
        },
      },
      runway.context,
    );
  assert.equal(
    inProgressSlo.missing_phases.includes("T0"),
    false,
    JSON.stringify(inProgressSlo),
  );

  clockNow = "2026-07-28T19:01:00.000Z";
  job.attempt_count = 2;
  job.run_at = "2026-07-28 19:01:00";
  job.payload.now = clockNow;
  const confirmed =
    await handlers.verify_governed_youtube_release_t0(
      job,
      context,
    );

  assert.equal(
    confirmed.status,
    "published",
    JSON.stringify(confirmed),
  );
  assert.equal(confirmed.verdict, "GREEN");
  assert.equal(
    confirmed.release_commitment_asserted,
    true,
  );
  assert.equal(confirmed.retry_allowed, false);
  assert.equal(readCalls, 2);
  assert.equal(confirmCalls, 1);
  const checkpoint = await fs.readJson(
    path.join(
      runway.windowDir,
      "t0-dispatch-verification.json",
    ),
  );
  assert.equal(checkpoint.verdict, "GREEN");
  assert.equal(checkpoint.public_release_confirmed, true);
  assert.equal(
    checkpoint.external_id,
    "youtube-primary-object",
  );
  assert.equal(
    await fs.pathExists(
      path.join(runway.windowDir, "incident-t0.json"),
    ),
    false,
  );
});

test("T0 cutoff writes one terminal HOLD without a remote read or upload", async (t) => {
  const runway = await materialiseSloMonitorRunway(t);
  const cutoffAt = "2026-07-28T19:15:00.000Z";
  let readCalls = 0;
  let confirmCalls = 0;

  const result =
    await handlers.verify_governed_youtube_release_t0(
      {
        kind: "verify_governed_youtube_release_t0",
        channel_id: "pulse-gaming",
        story_id: "primary-ready",
        attempt_count: 2,
        run_at: "2026-07-28 19:15:00",
        payload: {
          phase: "T0",
          now: cutoffAt,
          scheduled_for: runway.lock.scheduled_for,
          story_id: "primary-ready",
          platform: "youtube",
          runway_root: runway.runwayRoot,
          runway_lock_sha256: runway.lock.lock_sha256,
          public_verification_only: true,
          public_release_verification_authority: true,
          publish_authority: false,
          external_posting: false,
        },
      },
      {
        ...runway.context,
        env: {
          PULSE_STATE_ROOT: runway.runwayRoot,
          PULSE_OPERATING_MODE: "LIVE_GUARDED",
          PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
          AUTO_PUBLISH: "true",
          PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
          USE_JOB_QUEUE: "true",
          USE_SQLITE: "true",
          PULSE_PRIMARY_INSTANCE: "true",
          PULSE_EMERGENCY_KILL_SWITCH: "false",
          PULSE_KILL_SWITCH: "false",
        },
        workerId: "critical-window-worker",
        assertLeaseHealthy() {},
        irreversibleBoundaryNow: () =>
          new Date(cutoffAt),
        async verifyYoutubePublicObject() {
          readCalls += 1;
          throw new Error("cutoff must prevent remote reads");
        },
        async confirmExactGovernedYoutubeScheduledRelease() {
          confirmCalls += 1;
          throw new Error("cutoff must prevent finalisation");
        },
      },
    );

  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "verification_convergence_cutoff_reached",
    ),
    JSON.stringify(result),
  );
  assert.equal(result.retry_allowed, false);
  assert.equal(result.upload_attempted, false);
  assert.equal(readCalls, 0);
  assert.equal(confirmCalls, 0);
  const checkpoint = await fs.readJson(
    path.join(
      runway.windowDir,
      "t0-dispatch-verification.json",
    ),
  );
  assert.equal(checkpoint.verdict, "HOLD");
  assert.ok(
    checkpoint.blockers.includes(
      "verification_convergence_cutoff_reached",
    ),
  );
});

test("T-60 confirmed disarm promotes exactly one reserve chain and retries without a false GREEN checkpoint", async (t) => {
  const runway = await materialiseSloMonitorRunway(t);
  runway.publicationState.lifecycle_state =
    "PLATFORM_OBJECT_CREATED";
  runway.publicationState.verification_status =
    "private_unscheduled_processing";
  await fs.writeJson(
    path.join(runway.windowDir, "reserve-admission.json"),
    {
      schema_version:
        "pulse-governed-youtube-reserve-admission-packet-v1",
      scheduled_for: runway.lock.scheduled_for,
      runway_lock_sha256: runway.lock.lock_sha256,
      story_id: runway.lock.reserve.story_id,
      admission: {
        human_review_status: "approved",
      },
    },
  );
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
  let disarmCalls = 0;
  let promotionCalls = 0;

  const result =
    await handlers.governed_youtube_runway_t60(
      {
        kind: "governed_youtube_runway_t60",
        channel_id: "pulse-gaming",
        story_id: "primary-ready",
        attempt_count: 1,
        run_at: "2026-07-28 18:00:00",
        payload: {
          phase: "T-60",
          now: "2026-07-28T18:00:00.000Z",
          scheduled_for: runway.lock.scheduled_for,
          story_id: "primary-ready",
          platform: "youtube",
          runway_root: runway.runwayRoot,
          runway_lock_sha256: runway.lock.lock_sha256,
          readiness_verification_authority: true,
          publish_authority: false,
          external_posting: false,
        },
      },
      {
        ...runway.context,
        env: {
          PULSE_STATE_ROOT: runway.runwayRoot,
          PULSE_OPERATING_MODE: "LIVE_GUARDED",
          PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
          AUTO_PUBLISH: "true",
          PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
          USE_JOB_QUEUE: "true",
          USE_SQLITE: "true",
          PULSE_PRIMARY_INSTANCE: "true",
          PULSE_EMERGENCY_KILL_SWITCH: "false",
          PULSE_KILL_SWITCH: "false",
        },
        workerId: "critical-window-worker",
        assertLeaseHealthy() {},
        irreversibleBoundaryNow: () =>
          new Date("2026-07-28T18:00:00.000Z"),
        resolveRunwayFreshControl() {
          return {
            verdict: "GREEN",
            checked_at: "2026-07-28T18:00:00.000Z",
            kill_switch_healthy: true,
            operating_contract_valid: true,
            scheduler_owner_healthy: true,
            live_publish_enabled: true,
          };
        },
        async verifyYoutubePrivateObject() {
          return {
            confirmed: false,
            externalId: "youtube-primary-object",
            verifiedAt: "2026-07-28T18:00:00.000Z",
            reason:
              "youtube_private_object_unexpected_publish_at",
            incident_required: true,
            evidence: {
              platform: "youtube",
              platform_object_confirmed: true,
              privacy_status: "private",
              upload_status: "processed",
              processing_status: "succeeded",
              publish_at: runway.lock.scheduled_for,
              publish_at_present: true,
              release_armed: true,
              reason:
                "youtube_private_object_unexpected_publish_at",
            },
          };
        },
        async disarmExactGovernedYoutubeScheduledRelease() {
          disarmCalls += 1;
          runway.publicationState.lifecycle_state =
            "PLATFORM_SCHEDULE_DISARMED";
          runway.publicationState.verification_status =
            "confirmed_private_unscheduled";
          return {
            disarmed: true,
            confirmed: true,
            externalId: "youtube-primary-object",
          };
        },
        resolveCanonicalPrimaryConfirmedDisarm() {
          return {
            eligible: true,
            blockers: [],
            primary_disarm: primaryDisarm,
          };
        },
        async runWithPublisherLease(input) {
          return input.task({
            assertHealthy() {},
          });
        },
        async promoteGovernedYoutubeReserveRelease(input) {
          promotionCalls += 1;
          assert.equal(
            input.primaryDisarm.disarm_event_sha256,
            primaryDisarm.disarm_event_sha256,
          );
          assert.equal(
            input.promotion.authority_type,
            "CONFIRMED_DISARM_FAILOVER",
          );
          return {
            promoted: true,
            status: "reserve_admitted",
            promotion: input.promotion,
            reserve_release_jobs: [
              {
                kind:
                  "prestage_governed_youtube_release",
              },
              {
                kind:
                  "verify_governed_youtube_release_tminus15",
              },
              {
                kind:
                  "verify_governed_youtube_release_t0",
              },
            ],
          };
        },
      },
    );

  assert.equal(result.status, "held");
  assert.equal(
    result.job_outcome,
    "RETRY",
    JSON.stringify(result),
  );
  assert.equal(result.retryable, true);
  assert.equal(result.retry_allowed, true);
  assert.equal(result.reserve_recovery_attempted, true);
  assert.equal(result.reserve_promoted, true);
  assert.equal(disarmCalls, 1);
  assert.equal(promotionCalls, 1);
  assert.equal(
    await fs.pathExists(
      path.join(runway.windowDir, "t60-readiness.json"),
    ),
    false,
  );
});

test("T-60 immediately disarms an exact anchored object when verification discovers an unexpected publishAt", async (t) => {
  const runway = await materialiseSloMonitorRunway(t);
  const scheduledEvidence = {
    scheduled_for: runway.lock.scheduled_for,
    dispatch_idempotency_key:
      "youtube:primary-ready:2026-07-28T19:00:00.000Z",
    request_fingerprint: "a".repeat(64),
    runway_lock_sha256: runway.lock.lock_sha256,
  };
  let state = {
    lifecycle_state: "PLATFORM_OBJECT_CREATED",
    external_id: "youtube-primary-object",
    verification_status: "processing",
  };
  const governance = {
    getState() {
      return { ...state };
    },
    getLatestLifecycleEvent(storyId, platform, toState) {
      return storyId === "primary-ready" &&
        platform === "youtube" &&
        toState === "SCHEDULED"
        ? {
            id: 801,
            story_id: storyId,
            platform,
            to_state: toState,
            evidence_json: JSON.stringify(scheduledEvidence),
          }
        : null;
    },
  };
  let disarmCalls = 0;
  const env = {
    PULSE_STATE_ROOT: runway.runwayRoot,
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
  };

  const result =
    await handlers.governed_youtube_runway_t60(
      {
        kind: "governed_youtube_runway_t60",
        channel_id: "pulse-gaming",
        run_at: "2026-07-28 18:00:00",
        payload: {
          phase: "T-60",
          now: "2026-07-28T18:00:00.000Z",
          scheduled_for: runway.lock.scheduled_for,
          story_id: "primary-ready",
          platform: "youtube",
          runway_root: runway.runwayRoot,
          runway_lock_sha256: runway.lock.lock_sha256,
          readiness_verification_authority: true,
          publish_authority: false,
          external_posting: false,
        },
      },
      {
        env,
        workerId: "critical-window-worker",
        assertLeaseHealthy() {},
        irreversibleBoundaryNow: () =>
          new Date("2026-07-28T18:00:00.000Z"),
        repos: {
          ...runway.context.repos,
          publicationGovernance: governance,
          runtimeLeases: {},
        },
        resolveRunwayFreshControl() {
          return {
            verdict: "GREEN",
            checked_at:
              "2026-07-28T18:00:00.000Z",
            kill_switch_healthy: true,
            operating_contract_valid: true,
            scheduler_owner_healthy: true,
            live_publish_enabled: true,
          };
        },
        async verifyExactGovernedYoutubePrivatePrestage() {
          state = {
            lifecycle_state: "RECONCILIATION_REQUIRED",
            external_id: "youtube-primary-object",
            verification_status:
              "requires_reconciliation",
          };
          const error = new Error(
            "youtube_private_unscheduled_incident:youtube_private_object_unexpected_publish_at",
          );
          error.remoteDisarmRequired = true;
          throw error;
        },
        async disarmExactGovernedYoutubeScheduledRelease() {
          disarmCalls += 1;
          return {
            disarmed: true,
            confirmed: true,
            externalId: "youtube-primary-object",
          };
        },
        async notifyRunwayIncident() {},
      },
    );

  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.remote_disarm_required, true);
  assert.equal(result.remote_disarm_attempted, true);
  assert.equal(result.remote_disarm_confirmed, true);
  assert.equal(disarmCalls, 1);
});

test("T-60 trusts an exact emergency-containment proof and never launches a second normal disarm", async (t) => {
  const runway = await materialiseSloMonitorRunway(t);
  const scheduledEvidence = {
    scheduled_for: runway.lock.scheduled_for,
    dispatch_idempotency_key:
      "youtube:primary-ready:2026-07-28T19:00:00.000Z",
    request_fingerprint: "a".repeat(64),
    runway_lock_sha256: runway.lock.lock_sha256,
  };
  let state = {
    lifecycle_state: "PLATFORM_OBJECT_CREATED",
    external_id: "youtube-primary-object",
    verification_status: "processing",
  };
  const governance = {
    getState() {
      return { ...state };
    },
    getLatestLifecycleEvent(storyId, platform, toState) {
      return storyId === "primary-ready" &&
        platform === "youtube" &&
        toState === "SCHEDULED"
        ? {
            id: 801,
            story_id: storyId,
            platform,
            to_state: toState,
            evidence_json: JSON.stringify(scheduledEvidence),
          }
        : null;
    },
  };
  let normalDisarmCalls = 0;
  const env = {
    PULSE_STATE_ROOT: runway.runwayRoot,
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
  };

  const result =
    await handlers.governed_youtube_runway_t60(
      {
        kind: "governed_youtube_runway_t60",
        channel_id: "pulse-gaming",
        run_at: "2026-07-28 18:00:00",
        payload: {
          phase: "T-60",
          now: "2026-07-28T18:00:00.000Z",
          scheduled_for: runway.lock.scheduled_for,
          story_id: "primary-ready",
          platform: "youtube",
          runway_root: runway.runwayRoot,
          runway_lock_sha256:
            runway.lock.lock_sha256,
          readiness_verification_authority: true,
          publish_authority: false,
          external_posting: false,
        },
      },
      {
        env,
        workerId: "critical-window-worker",
        assertLeaseHealthy() {},
        irreversibleBoundaryNow: () =>
          new Date("2026-07-28T18:00:00.000Z"),
        repos: {
          ...runway.context.repos,
          publicationGovernance: governance,
          runtimeLeases: {},
        },
        resolveRunwayFreshControl() {
          return {
            verdict: "GREEN",
            checked_at:
              "2026-07-28T18:00:00.000Z",
            kill_switch_healthy: true,
            operating_contract_valid: true,
            scheduler_owner_healthy: true,
            live_publish_enabled: true,
          };
        },
        async verifyExactGovernedYoutubePrivatePrestage() {
          state = {
            lifecycle_state:
              "RECONCILIATION_REQUIRED",
            external_id: "youtube-primary-object",
            verification_status:
              "requires_reconciliation",
          };
          const error = new Error(
            "youtube_private_unscheduled_incident:youtube_private_object_published_early",
          );
          error.compensationRequired = true;
          error.compensationAttempted = true;
          error.compensationConfirmed = true;
          error.remoteContainmentRequired = false;
          error.remoteDisarmRequired = false;
          throw error;
        },
        async disarmExactGovernedYoutubeScheduledRelease() {
          normalDisarmCalls += 1;
          throw new Error(
            "contained object must not be disarmed twice",
          );
        },
        async notifyRunwayIncident() {},
      },
    );

  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.remote_disarm_required, false);
  assert.equal(result.remote_disarm_attempted, false);
  assert.equal(
    result.emergency_containment_confirmed,
    true,
  );
  assert.equal(normalDisarmCalls, 0);
});

test("T-15 revalidates the official source and arms the exact private object once", async (t) => {
  const runway = await materialiseSloMonitorRunway(t);
  const scheduledEvidence = {
    scheduled_for: runway.lock.scheduled_for,
    dispatch_idempotency_key:
      "youtube:primary-ready:2026-07-28T19:00:00.000Z",
    request_fingerprint: "a".repeat(64),
    runway_lock_sha256: runway.lock.lock_sha256,
  };
  let state = {
    lifecycle_state: "PLATFORM_OBJECT_CREATED",
    external_id: "youtube-primary-object",
    verification_status:
      "private_unscheduled_processed",
    last_event_id: 41,
  };
  const governance = {
    getState() {
      return { ...state };
    },
    getLatestLifecycleEvent(
      storyId,
      platform,
      toState,
    ) {
      return storyId === "primary-ready" &&
        platform === "youtube" &&
        toState === "SCHEDULED"
        ? {
            id: 801,
            story_id: storyId,
            platform,
            to_state: toState,
            evidence_json:
              JSON.stringify(scheduledEvidence),
          }
        : null;
    },
    assertScheduledPlatformReleaseCommitment() {
      if (state.lifecycle_state !== "PLATFORM_SCHEDULED") {
        throw new Error("release_commitment_confirmed_required");
      }
      return {
        externalId: "youtube-primary-object",
        evidence: {
          release_commitment_confirmed: true,
          committed_at:
            "2026-07-28T18:45:00.000Z",
          source_revalidation: {
            schema_version:
              "pulse-official-source-revalidation-v1",
            official_source: true,
            unchanged: true,
            claims_match: true,
            source_revision_sha256:
              "b".repeat(64),
            revalidated_at:
              "2026-07-28T18:45:00.000Z",
          },
          schedule_arm_proof: {
            schedule_arm_confirmed: true,
            release_armed: true,
            publish_at: runway.lock.scheduled_for,
          },
        },
      };
    },
  };
  const env = {
    PULSE_STATE_ROOT: runway.runwayRoot,
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
      "d".repeat(64),
  };
  let armCalls = 0;
  let replayVerificationCalls = 0;
  let disarmCalls = 0;
  const sourceRevisionSha256 = "b".repeat(64);
  const t15Job = {
        kind:
          "verify_governed_youtube_release_tminus15",
        channel_id: "pulse-gaming",
        story_id: "primary-ready",
        run_at: "2026-07-28 18:45:00",
        payload: {
          phase: "T-15",
          now: "2026-07-28T18:45:00.000Z",
          scheduled_for: runway.lock.scheduled_for,
          story_id: "primary-ready",
          platform: "youtube",
          runway_root: runway.runwayRoot,
          runway_lock_sha256:
            runway.lock.lock_sha256,
          arm_private_schedule_once: true,
          scheduled_release_authority: true,
          official_source_revalidation_required:
            true,
          scheduled_release_verification_authority:
            true,
          publish_authority: false,
          external_posting: false,
        },
      };
  const t15Context = {
        env,
        workerId: "critical-window-worker",
        assertLeaseHealthy() {},
        repos: {
          ...runway.context.repos,
          publicationGovernance: governance,
          runtimeLeases: {},
        },
        resolveRunwayFreshControl() {
          return {
            verdict: "GREEN",
            checked_at:
              "2026-07-28T18:45:00.000Z",
            kill_switch_healthy: true,
            operating_contract_valid: true,
            scheduler_owner_healthy: true,
            live_publish_enabled: true,
          };
        },
        async armExactGovernedYoutubeScheduledRelease(
          input,
        ) {
          armCalls += 1;
          assert.equal(
            input.exactStagedBinding.story_id,
            "primary-ready",
          );
          assert.equal(
            input.exactStagedBinding.external_id,
            "youtube-primary-object",
          );
          state = {
            lifecycle_state: "PLATFORM_SCHEDULED",
            external_id: "youtube-primary-object",
            verification_status:
              "confirmed_private_scheduled",
            last_event_id: 43,
          };
          return {
            status: "platform_scheduled",
            scheduled: true,
            releaseArmed: true,
            releaseCommitmentConfirmed: true,
            commitmentFrozenAt:
              "2026-07-28T18:45:00.000Z",
            externalId: "youtube-primary-object",
            sourceRevalidation: {
              schema_version:
                "pulse-official-source-revalidation-v1",
              official_source: true,
              unchanged: true,
              claims_match: true,
              source_url:
                "https://publisher.example/news",
              source_revision_sha256:
                sourceRevisionSha256,
              revalidated_at:
                "2026-07-28T18:45:00.000Z",
            },
            armResult: {
              confirmed: true,
              evidence: {
                schedule_arm_confirmed: true,
                release_armed: true,
                publish_at:
                  runway.lock.scheduled_for,
              },
            },
            verification: {
              confirmed: true,
              evidence: {
                privacy_status: "private",
                publish_at:
                  runway.lock.scheduled_for,
                upload_status: "processed",
                processing_status: "succeeded",
              },
            },
          };
        },
        async verifyExactGovernedYoutubeScheduledReplay(
          input,
        ) {
          replayVerificationCalls += 1;
          assert.equal(
            input.externalId,
            "youtube-primary-object",
          );
          assert.equal(
            input.exactStagedBinding.story_id,
            "primary-ready",
          );
          return {
            status:
              "platform_scheduled_verified",
            confirmed: true,
            scheduled: true,
            releaseArmed: true,
            reused: true,
            externalId:
              "youtube-primary-object",
            scheduledFor:
              runway.lock.scheduled_for,
            verification: {
              confirmed: true,
              externalId:
                "youtube-primary-object",
              scheduledFor:
                runway.lock.scheduled_for,
              evidence: {
                scheduled_release_confirmed:
                  true,
                privacy_status: "private",
                publish_at:
                  runway.lock.scheduled_for,
                upload_status: "processed",
                processing_status: "succeeded",
              },
            },
            youtubeAccountBindingProof: {
              proof_sha256: "c".repeat(64),
            },
            side_effects: {
              read_only_network_contacted: true,
              database_mutated: false,
              external_mutation_attempted: false,
              upload_attempted: false,
            },
          };
        },
        async disarmExactGovernedYoutubeScheduledRelease() {
          disarmCalls += 1;
          throw new Error(
            "successful T-15 must not disarm",
          );
        },
        async notifyRunwayIncident() {},
      };
  const result =
    await handlers.verify_governed_youtube_release_tminus15(
      t15Job,
      t15Context,
    );

  assert.equal(
    result.status,
    "ready",
    JSON.stringify(result),
  );
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.official_source_revalidated, true);
  assert.equal(
    result.source_revision_sha256,
    sourceRevisionSha256,
  );
  assert.equal(result.schedule_arm_confirmed, true);
  assert.equal(result.release_armed, true);
  assert.equal(result.remote_schedule_verified, true);
  assert.equal(
    result.release_commitment_confirmed,
    true,
  );
  assert.equal(result.remote_disarm_required, false);
  assert.equal(armCalls, 1);
  assert.equal(replayVerificationCalls, 0);
  assert.equal(disarmCalls, 0);
  const checkpoint = await fs.readJson(
    result.readiness_json,
  );
  assert.equal(
    checkpoint.official_source_revalidated,
    true,
  );
  assert.equal(
    checkpoint.source_revision_sha256,
    sourceRevisionSha256,
  );
  assert.equal(checkpoint.schedule_arm_confirmed, true);
  assert.equal(checkpoint.release_armed, true);
  assert.equal(
    checkpoint.release_commitment_confirmed,
    true,
  );

  const replay =
    await handlers.verify_governed_youtube_release_tminus15(
      t15Job,
      t15Context,
    );
  assert.equal(replay.status, "ready", JSON.stringify(replay));
  assert.equal(replay.verdict, "GREEN");
  assert.equal(replay.release_commitment_confirmed, true);
  assert.equal(
    replay.scheduled_replay_remote_verified,
    true,
  );
  assert.equal(
    replay.youtube_account_binding_proof_sha256,
    "c".repeat(64),
  );
  assert.equal(armCalls, 1);
  assert.equal(replayVerificationCalls, 1);
  assert.equal(disarmCalls, 0);
});

test("T-15 consumes a durable orphan arm intent and disarms even when the failed adapter loses in-memory metadata", async (t) => {
  const runway = await materialiseSloMonitorRunway(t);
  const scheduledEvidence = {
    scheduled_for: runway.lock.scheduled_for,
    dispatch_idempotency_key:
      "youtube:primary-ready:2026-07-28T19:00:00.000Z",
    request_fingerprint: "a".repeat(64),
    runway_lock_sha256: runway.lock.lock_sha256,
  };
  let state = {
    lifecycle_state: "PLATFORM_OBJECT_CREATED",
    external_id: "youtube-primary-object",
    verification_status: "private_unscheduled_processed",
  };
  let durableArmAttempt = null;
  const governance = {
    getState() {
      return { ...state };
    },
    getLatestLifecycleEvent(storyId, platform, toState) {
      return storyId === "primary-ready" &&
        platform === "youtube" &&
        toState === "SCHEDULED"
        ? {
            id: 801,
            story_id: storyId,
            platform,
            to_state: toState,
            evidence_json: JSON.stringify(scheduledEvidence),
          }
        : null;
    },
    getScheduledPlatformArmAttempt() {
      return durableArmAttempt;
    },
  };
  let disarmCalls = 0;
  const env = {
    PULSE_STATE_ROOT: runway.runwayRoot,
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
  };

  const result =
    await handlers.verify_governed_youtube_release_tminus15(
      {
        kind:
          "verify_governed_youtube_release_tminus15",
        channel_id: "pulse-gaming",
        story_id: "primary-ready",
        run_at: "2026-07-28 18:45:00",
        payload: {
          phase: "T-15",
          now: "2026-07-28T18:45:00.000Z",
          scheduled_for: runway.lock.scheduled_for,
          story_id: "primary-ready",
          platform: "youtube",
          runway_root: runway.runwayRoot,
          runway_lock_sha256: runway.lock.lock_sha256,
          arm_private_schedule_once: true,
          scheduled_release_authority: true,
          official_source_revalidation_required: true,
          scheduled_release_verification_authority: true,
          publish_authority: false,
          external_posting: false,
        },
      },
      {
        env,
        workerId: "critical-window-worker",
        assertLeaseHealthy() {},
        repos: {
          ...runway.context.repos,
          publicationGovernance: governance,
          runtimeLeases: {},
        },
        resolveRunwayFreshControl() {
          return {
            verdict: "GREEN",
            checked_at:
              "2026-07-28T18:45:00.000Z",
            kill_switch_healthy: true,
            operating_contract_valid: true,
            scheduler_owner_healthy: true,
            live_publish_enabled: true,
          };
        },
        async armExactGovernedYoutubeScheduledRelease() {
          durableArmAttempt = {
            externalId: "youtube-primary-object",
            remoteScheduleMayExist: true,
          };
          state = {
            lifecycle_state: "RECONCILIATION_REQUIRED",
            external_id: "youtube-primary-object",
            verification_status: "requires_reconciliation",
          };
          throw new Error("metadata_lost_after_remote_update");
        },
        async disarmExactGovernedYoutubeScheduledRelease() {
          disarmCalls += 1;
          return {
            disarmed: true,
            confirmed: true,
            externalId: "youtube-primary-object",
          };
        },
        async notifyRunwayIncident() {},
      },
    );

  assert.equal(result.status, "held");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.remote_disarm_required, true);
  assert.equal(result.remote_disarm_attempted, true);
  assert.equal(result.remote_disarm_confirmed, true);
  assert.equal(disarmCalls, 1);
});
