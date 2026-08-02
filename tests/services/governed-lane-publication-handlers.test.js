"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { handlers } = require("../../lib/job-handlers");

const NOW = "2026-07-28T19:00:00.000Z";
const SCHEDULED_FOR = NOW;
const STORY_ID = "breaking-publish-001";
const EVENT_ID = 77;
const FINGERPRINT = "a".repeat(64);
const YOUTUBE_OAUTH_CLIENT_SHA256 = "f".repeat(64);
const DISPATCH_KEY = `youtube:${STORY_ID}:${SCHEDULED_FOR}`;

function liveGuardedEnv() {
  return {
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: YOUTUBE_OAUTH_CLIENT_SHA256,
  };
}

function scheduledDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      platform TEXT,
      to_state TEXT NOT NULL,
      evidence_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE platform_publication_state (
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      PRIMARY KEY (story_id, platform)
    );
  `);
  db.prepare(
    `
    INSERT INTO publication_lifecycle_events
      (id, story_id, platform, to_state, evidence_json, created_at)
    VALUES (?, ?, 'youtube', 'SCHEDULED', ?, ?)
  `,
  ).run(
    EVENT_ID,
    STORY_ID,
    JSON.stringify({
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at: "2026-07-28T18:55:00.000Z",
      scheduled_for: SCHEDULED_FOR,
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key: DISPATCH_KEY,
      request_fingerprint: FINGERPRINT,
    }),
    "2026-07-28T18:55:00.000Z",
  );
  db.prepare(
    `
    INSERT INTO platform_publication_state
      (story_id, platform, lifecycle_state)
    VALUES (?, 'youtube', 'SCHEDULED')
  `,
  ).run(STORY_ID);
  return db;
}

function dispatchJob(overrides = {}) {
  return {
    id: 901,
    kind: "dispatch_governed_publication",
    channel_id: "pulse-gaming",
    payload: {
      lane_id: "breaking_short",
      story_id: STORY_ID,
      platform: "youtube",
      scheduled_event_id: EVENT_ID,
      scheduled_for: SCHEDULED_FOR,
      dispatch_idempotency_key: DISPATCH_KEY,
      request_fingerprint: FINGERPRINT,
      guarded_dispatch_authority: true,
      ...overrides,
    },
  };
}

test("governed dispatch remains held outside an explicitly armed LIVE_GUARDED runtime", async (t) => {
  const db = scheduledDb();
  t.after(() => db.close());
  let called = false;
  const result = await handlers.dispatch_governed_publication(dispatchJob(), {
    repos: { db },
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      AUTO_PUBLISH: "false",
    },
    now: () => new Date(NOW),
    async publishNextStory() {
      called = true;
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, "held");
  assert.ok(
    result.blockers.includes("live_guarded_operating_contract_required"),
  );
});

test("governed dispatch re-resolves and passes the exact fresh scheduled binding to the publisher", async (t) => {
  const db = scheduledDb();
  t.after(() => db.close());
  let received = null;
  const runtimeAuthority = Object.freeze({ runtime: "trusted" });
  const claimedJobAuthority = Object.freeze({ claim: "trusted" });
  const result = await handlers.dispatch_governed_publication(dispatchJob(), {
    repos: { db },
    env: liveGuardedEnv(),
    now: () => new Date(NOW),
    async publishNextStory(options) {
      received = options;
      return {
        title: "Published exact breaking story",
        youtube: true,
        platform_outcomes: { youtube: "new_upload" },
      };
    },
    assertLeaseHealthy() {},
    runtimeAuthority,
    claimedJobAuthority,
  });

  assert.equal(result.status, "dispatched");
  assert.equal(result.story_id, STORY_ID);
  assert.equal(received.exactDispatchBinding.storyId, STORY_ID);
  assert.equal(received.exactDispatchBinding.scheduledEventId, EVENT_ID);
  assert.equal(received.exactDispatchBinding.requestFingerprint, FINGERPRINT);
  assert.equal(received.runtimeAuthority, runtimeAuthority);
  assert.equal(received.claimedJobAuthority, claimedJobAuthority);
  assert.equal(
    Number.isInteger(received.exactDispatchBinding.databaseDataVersion),
    true,
  );
});

test("governed dispatch fails closed when queued identity differs from current lifecycle evidence", async (t) => {
  const db = scheduledDb();
  t.after(() => db.close());
  let called = false;
  const result = await handlers.dispatch_governed_publication(
    dispatchJob({ request_fingerprint: "b".repeat(64) }),
    {
      repos: { db },
      env: liveGuardedEnv(),
      now: () => new Date(NOW),
      async publishNextStory() {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.status, "held");
  assert.ok(result.blockers.includes("scheduled_request_fingerprint_mismatch"));
});

test("governed admission requires an exact human packet before any lifecycle mutation", async () => {
  let called = false;
  const result = await handlers.admit_governed_publication(
    {
      kind: "admit_governed_publication",
      payload: {
        lane_id: "evergreen_short",
        story_id: "evergreen-admit-001",
        platform: "youtube",
        guarded_admission_authority: true,
      },
    },
    {
      repos: {},
      env: liveGuardedEnv(),
      async admitPublication() {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.status, "held");
  assert.ok(result.blockers.includes("exact_human_admission_packet_required"));
});

test("LIVE_GUARDED human admission stays held until a separately reviewed authority exists", async () => {
  const evidence = {
    source_evidence_sha256: "1".repeat(64),
    qa_report_sha256: "2".repeat(64),
    publication_metadata_sha256: "3".repeat(64),
    renderer_manifest: {
      schema_version: "pulse-renderer-manifest-v1",
    },
  };
  let received = null;
  const exactBinding = {
    storyId: "evergreen-admit-002",
    platform: "youtube",
    scheduledFor: SCHEDULED_FOR,
    scheduledEventId: 778,
    dispatchIdempotencyKey: `youtube:evergreen-admit-002:${SCHEDULED_FOR}`,
    requestFingerprint: "d".repeat(64),
  };
  const result = await handlers.admit_governed_publication(
    {
      channel_id: "pulse-gaming",
      kind: "admit_governed_publication",
      payload: {
        lane_id: "evergreen_short",
        story_id: "evergreen-admit-002",
        platform: "youtube",
        guarded_admission_authority: true,
        admission: {
          human_review_status: "approved",
          actor_id: "operator-001",
          reason: "Reviewed exact final video and metadata",
          confirmation_story_id: "evergreen-admit-002",
          scheduled_for: SCHEDULED_FOR,
          evidence,
        },
      },
    },
    {
      repos: {
        marker: true,
      },
      env: liveGuardedEnv(),
      now: () => new Date("2026-07-28T18:55:00.000Z"),
      async admitPublication(options) {
        received = options;
        return {
          admitted: true,
          story_id: options.storyId,
          lifecycle_state: "SCHEDULED",
          scheduled_for: SCHEDULED_FOR,
          dispatch_idempotency_key: exactBinding.dispatchIdempotencyKey,
          request_fingerprint: exactBinding.requestFingerprint,
          scheduled_event_id: exactBinding.scheduledEventId,
          dispatch_job: {
            id: 779,
            kind: "verify_governed_youtube_release_t0",
            status: "pending",
            idempotency_key: `verify-public:youtube:778:${"d".repeat(64)}`,
            run_at: SCHEDULED_FOR,
            payload: {
              lane_id: "evergreen_short",
              story_id: "evergreen-admit-002",
              platform: "youtube",
              scheduled_event_id: 778,
              scheduled_for: SCHEDULED_FOR,
              dispatch_idempotency_key: `youtube:evergreen-admit-002:${SCHEDULED_FOR}`,
              request_fingerprint: "d".repeat(64),
              guarded_dispatch_authority: true,
            },
          },
          release_jobs: [],
          blockers: [],
        };
      },
    },
  );

  assert.equal(result.status, "held");
  assert.deepEqual(result.blockers, [
    "publication_admission_authority_required",
  ]);
  assert.equal(result.lifecycle_mutation_attempted, false);
  assert.equal(result.no_external_posting, true);
  assert.equal(received, null);
});

function autonomousAdmissionPacket({
  validUntil = "2026-07-28T17:45:45.000Z",
} = {}) {
  const authority = {
    authority_id: "autonomous-official-publication:fresh",
    authority_type: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    authority_scope: "PUBLICATION_ADMISSION_ONLY",
    decision: "APPROVED",
    human_approval: false,
    may_impersonate_human: false,
    operational_publish_authority: false,
    dispatch_authorised: false,
    external_publish_authorised: false,
    issued_at: "2026-07-28T17:45:00.000Z",
    valid_until: validUntil,
    story_id: "breaking-autonomous-001",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: "2026-07-28T19:00:00.000Z",
    runway_lock_sha256: "b".repeat(64),
    request_fingerprint: "c".repeat(64),
    source_report: {
      report_sha256: "d".repeat(64),
      valid_until: "2026-07-28T17:46:00.000Z",
    },
    publication_evidence: {
      source_evidence_sha256: "1".repeat(64),
      qa_report_sha256: "2".repeat(64),
      rights_ledger_sha256: "3".repeat(64),
    },
    authority_sha256: "e".repeat(64),
  };
  return {
    approval_type: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    human_admission_required: false,
    confirmation_story_id: "breaking-autonomous-001",
    scheduled_for: "2026-07-28T19:00:00.000Z",
    autonomous_authority_id: authority.authority_id,
    autonomous_authority_sha256: authority.authority_sha256,
    autonomous_authority_valid_until: authority.valid_until,
    autonomous_source_report_sha256: authority.source_report.report_sha256,
    autonomous_source_report_valid_until: authority.source_report.valid_until,
    publication_evidence: authority.publication_evidence,
    evidence: authority.publication_evidence,
    autonomous_publication_authority: authority,
  };
}

test("T-75 rejects a prebuilt autonomous packet that bypasses JIT admission authority", async () => {
  const packet = autonomousAdmissionPacket();
  let received = null;
  const result = await handlers.admit_governed_publication(
    {
      id: 991,
      channel_id: "pulse-gaming",
      kind: "admit_governed_publication",
      payload: {
        lane_id: "breaking_short",
        story_id: "breaking-autonomous-001",
        platform: "youtube",
        guarded_admission_authority: true,
        human_admission_required: false,
        admission: packet,
      },
    },
    {
      repos: { marker: true },
      env: liveGuardedEnv(),
      now: () => new Date("2026-07-28T17:45:15.000Z"),
      async admitPublication() {
        assert.fail("human admission must not receive autonomous work");
      },
      async admitAutonomousOfficialPublication(options) {
        received = options;
        return {
          admitted: true,
          story_id: "breaking-autonomous-001",
          lifecycle_state: "SCHEDULED",
          scheduled_for: packet.scheduled_for,
          dispatch_idempotency_key: `youtube:breaking-autonomous-001:${packet.scheduled_for}`,
          request_fingerprint:
            packet.autonomous_publication_authority.request_fingerprint,
          dispatch_job: {
            id: 992,
            kind: "verify_governed_youtube_release_t0",
            payload: {
              story_id: "breaking-autonomous-001",
              platform: "youtube",
              scheduled_event_id: 993,
              scheduled_for: packet.scheduled_for,
              dispatch_idempotency_key: `youtube:breaking-autonomous-001:${packet.scheduled_for}`,
              request_fingerprint:
                packet.autonomous_publication_authority.request_fingerprint,
            },
          },
        };
      },
    },
  );

  assert.equal(result.status, "held", JSON.stringify(result));
  assert.deepEqual(result.blockers, [
    "publication_admission_authority_required",
  ]);
  assert.equal(result.lifecycle_mutation_attempted, false);
  assert.equal(result.no_external_posting, true);
  assert.equal(received, null);
});

test("T-75 rejects an expired autonomous authority before lifecycle mutation", async () => {
  let called = false;
  const result = await handlers.admit_governed_publication(
    {
      id: 994,
      channel_id: "pulse-gaming",
      kind: "admit_governed_publication",
      payload: {
        lane_id: "breaking_short",
        story_id: "breaking-autonomous-001",
        platform: "youtube",
        guarded_admission_authority: true,
        human_admission_required: false,
        admission: autonomousAdmissionPacket({
          validUntil: "2026-07-28T17:45:15.000Z",
        }),
      },
    },
    {
      repos: {},
      env: liveGuardedEnv(),
      now: () => new Date("2026-07-28T17:45:15.000Z"),
      async admitAutonomousOfficialPublication() {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.status, "held");
  assert.ok(
    result.blockers.includes(
      "exact_autonomous_authority_fresh_at_t75_required",
    ),
    JSON.stringify(result),
  );
  assert.equal(result.lifecycle_mutation_attempted, false);
  assert.equal(result.no_external_posting, true);
});
