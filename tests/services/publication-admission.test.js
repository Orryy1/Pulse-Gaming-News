"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  admitPublication,
} = require("../../lib/services/publication-admission");
const {
  fingerprintPublicationRequest,
} = require("../../lib/services/publication-request-fingerprint");
const governanceFactory = require("../../lib/repositories/publication_governance");
const storiesFactory = require("../../lib/repositories/stories");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const NOW = new Date("2026-07-27T08:55:00.000Z");
const SCHEDULED_FOR = "2026-07-27T09:00:00.000Z";
const SCRIPT = "Original Xbox games are returning with achievement support.";
const MEDIA = "final-reviewed-video";
const HASHES = Object.freeze({
  source_evidence_sha256: "1".repeat(64),
  rights_ledger_sha256: "2".repeat(64),
  qa_report_sha256: "3".repeat(64),
});
const LIVE_ENV = Object.freeze({
  PULSE_OPERATING_MODE: "LIVE_GUARDED",
  AUTO_PUBLISH: "true",
  PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
  USE_JOB_QUEUE: "true",
  USE_SQLITE: "true",
  PULSE_PRIMARY_INSTANCE: "true",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fixture(t, storyOverrides = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-publication-admission-"),
  );
  const mediaPath = path.join(directory, "reviewed-final.mp4");
  fs.writeFileSync(mediaPath, MEDIA);
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    "pulse-gaming",
    "Pulse Gaming",
  );
  const story = {
    id: "story-admission-1",
    title: "Xbox preservation gets a major upgrade",
    channel_id: "pulse-gaming",
    approved: 1,
    full_script: SCRIPT,
    exported_path: mediaPath,
    publish_status: null,
    youtube_post_id: null,
    ...storyOverrides,
  };
  db.prepare(
    `INSERT INTO stories
       (id, title, channel_id, approved, full_script, exported_path,
        publish_status, youtube_post_id)
     VALUES
       (@id, @title, @channel_id, @approved, @full_script, @exported_path,
        @publish_status, @youtube_post_id)`,
  ).run(story);
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    db,
    mediaPath,
    repos: {
      db,
      stories: storiesFactory.bind(db),
      publicationGovernance: governanceFactory.bind(db),
    },
    story,
  };
}

function admissionInput(repos, overrides = {}) {
  return {
    repos,
    storyId: "story-admission-1",
    channelId: "pulse-gaming",
    platform: "youtube",
    actorId: "operator-1",
    reason: "Reviewed final script, rights, render and QA evidence",
    confirmationStoryId: "story-admission-1",
    scheduledFor: SCHEDULED_FOR,
    evidence: { ...HASHES },
    env: { ...LIVE_ENV },
    now: NOW,
    channel: {
      id: "pulse-gaming",
      name: "Pulse Gaming",
      youtubeCategory: "20",
    },
    ...overrides,
  };
}

function assertNoAdmissionRows(db) {
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
      .get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM platform_publication_state").get()
      .count,
    0,
  );
}

test("operator admission atomically records exact evidence through SCHEDULED and exact replay is idempotent", async (t) => {
  const { db, repos, story } = fixture(t);
  const input = admissionInput(repos);
  const expectedFingerprint = await fingerprintPublicationRequest(story, {
    channelId: input.channelId,
    platform: input.platform,
    channel: input.channel,
  });

  const admitted = await admitPublication(input);
  const replay = await admitPublication(input);

  assert.deepEqual(replay, admitted);
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.lifecycle_state, "SCHEDULED");
  assert.equal(
    admitted.request_fingerprint,
    expectedFingerprint.request_fingerprint,
  );
  assert.equal(admitted.media_sha256, sha256(MEDIA));
  assert.equal(admitted.script_sha256, sha256(SCRIPT));

  const auditRows = db
    .prepare("SELECT * FROM operator_audit_log ORDER BY id")
    .all();
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].actor_id, "operator-1");
  assert.equal(auditRows[0].action, "approve_publication");
  assert.equal(auditRows[0].target_id, "story-admission-1:youtube");
  const auditEvidence = JSON.parse(auditRows[0].evidence_json);
  assert.deepEqual(
    {
      source_evidence_sha256: auditEvidence.source_evidence_sha256,
      rights_ledger_sha256: auditEvidence.rights_ledger_sha256,
      qa_report_sha256: auditEvidence.qa_report_sha256,
      media_sha256: auditEvidence.media_sha256,
      script_sha256: auditEvidence.script_sha256,
      request_fingerprint: auditEvidence.request_fingerprint,
    },
    {
      ...HASHES,
      media_sha256: expectedFingerprint.media_sha256,
      script_sha256: expectedFingerprint.script_sha256,
      request_fingerprint: expectedFingerprint.request_fingerprint,
    },
  );

  const lifecycleRows = db
    .prepare(
      `SELECT to_state, evidence_json
       FROM publication_lifecycle_events
       WHERE story_id = ? AND platform = ?
       ORDER BY id`,
    )
    .all("story-admission-1", "youtube");
  assert.deepEqual(
    lifecycleRows.map((row) => row.to_state),
    [
      "DISCOVERED",
      "VERIFIED",
      "EDITORIALLY_APPROVED",
      "SCRIPT_READY",
      "ASSETS_CLEARED",
      "RENDERED",
      "QA_PASSED",
      "HUMAN_APPROVED",
      "SCHEDULED",
    ],
  );
  const evidenceByState = Object.fromEntries(
    lifecycleRows.map((row) => [row.to_state, JSON.parse(row.evidence_json)]),
  );
  assert.equal(
    evidenceByState.VERIFIED.source_evidence_sha256,
    HASHES.source_evidence_sha256,
  );
  assert.equal(
    evidenceByState.SCRIPT_READY.script_sha256,
    expectedFingerprint.script_sha256,
  );
  assert.equal(
    evidenceByState.ASSETS_CLEARED.rights_ledger_sha256,
    HASHES.rights_ledger_sha256,
  );
  assert.equal(
    evidenceByState.RENDERED.media_sha256,
    expectedFingerprint.media_sha256,
  );
  assert.equal(
    evidenceByState.QA_PASSED.qa_report_sha256,
    HASHES.qa_report_sha256,
  );
  assert.equal(
    evidenceByState.HUMAN_APPROVED.operator_decision_id,
    auditRows[0].id,
  );
  assert.equal(
    evidenceByState.SCHEDULED.request_fingerprint,
    expectedFingerprint.request_fingerprint,
  );
  assert.equal(
    evidenceByState.SCHEDULED.dispatch_idempotency_key,
    admitted.dispatch_idempotency_key,
  );

  assert.throws(
    () =>
      db
        .prepare("UPDATE operator_audit_log SET reason = ? WHERE id = ?")
        .run("changed", auditRows[0].id),
    /immutable_operator_audit_log/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE publication_lifecycle_events SET evidence_json = ? WHERE id = ?",
        )
        .run("{}", 1),
    /immutable_publication_lifecycle_events/,
  );
});

test("a changed request cannot reuse an admitted operation identity or append partial history", async (t) => {
  const { db, mediaPath, repos } = fixture(t);
  const input = admissionInput(repos);
  const admitted = await admitPublication(input);
  fs.writeFileSync(mediaPath, "changed-after-operator-approval");

  await assert.rejects(
    admitPublication(input),
    /publication_idempotency_conflict/,
  );

  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    1,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
      .get().count,
    9,
  );
  assert.equal(
    repos.publicationGovernance.getState("story-admission-1", "youtube")
      .lifecycle_state,
    "SCHEDULED",
  );
  const originalAudit = JSON.parse(
    db.prepare("SELECT evidence_json FROM operator_audit_log").get()
      .evidence_json,
  );
  assert.equal(originalAudit.media_sha256, admitted.media_sha256);
  assert.notEqual(
    originalAudit.media_sha256,
    sha256("changed-after-operator-approval"),
  );
});

test("operator admission rejects a mismatched story confirmation without partial rows", async (t) => {
  const { db, repos } = fixture(t);

  const result = await admitPublication(
    admissionInput(repos, { confirmationStoryId: "different-story" }),
  );

  assert.equal(result.admitted, false);
  assert.ok(result.blockers.includes("matching_story_confirmation_required"));
  assertNoAdmissionRows(db);
});

test("operator admission rejects a schedule outside guarded YouTube windows without partial rows", async (t) => {
  const { db, repos } = fixture(t);

  const result = await admitPublication(
    admissionInput(repos, {
      scheduledFor: "2026-07-27T10:00:00.000Z",
      now: new Date("2026-07-27T10:05:00.000Z"),
    }),
  );

  assert.equal(result.admitted, false);
  assert.ok(
    result.blockers.includes("schedule_outside_guarded_youtube_windows"),
  );
  assertNoAdmissionRows(db);
});

test("operator admission cannot create a catch-up ticket after the guarded window has fired", async (t) => {
  const { db, repos } = fixture(t);

  const result = await admitPublication(
    admissionInput(repos, {
      now: new Date("2026-07-27T09:05:00.000Z"),
    }),
  );

  assert.equal(result.admitted, false);
  assert.ok(
    result.blockers.includes("operator_admission_after_dispatch_window"),
  );
  assertNoAdmissionRows(db);
});

test("LOCAL_PROOF cannot create an operator admission or lifecycle projection", async (t) => {
  const { db, repos } = fixture(t);

  const result = await admitPublication(
    admissionInput(repos, {
      env: {
        PULSE_OPERATING_MODE: "LOCAL_PROOF",
        AUTO_PUBLISH: "false",
        USE_JOB_QUEUE: "true",
        USE_SQLITE: "true",
      },
    }),
  );

  assert.equal(result.admitted, false);
  assert.ok(
    result.blockers.includes("live_guarded_operating_contract_required"),
  );
  assertNoAdmissionRows(db);
});

test("missing QA or evidence hashes fail closed without partial admission rows", async (t) => {
  const cases = [
    {
      name: "missing QA evidence",
      storyOverrides: {},
      inputOverrides: {
        evidence: {
          source_evidence_sha256: HASHES.source_evidence_sha256,
          rights_ledger_sha256: HASHES.rights_ledger_sha256,
        },
      },
      blockers: ["qa_report_hash_required"],
    },
    {
      name: "missing source and rights evidence",
      storyOverrides: {},
      inputOverrides: {
        evidence: { qa_report_sha256: HASHES.qa_report_sha256 },
      },
      blockers: [
        "source_evidence_hash_required",
        "rights_ledger_hash_required",
      ],
    },
    {
      name: "unresolved story QA failure",
      storyOverrides: { publish_status: "failed" },
      inputOverrides: {},
      blockers: ["story_has_unresolved_qa_failure"],
    },
  ];

  for (const item of cases) {
    const { db, repos } = fixture(t, item.storyOverrides);
    const result = await admitPublication(
      admissionInput(repos, item.inputOverrides),
    );
    assert.equal(result.admitted, false, item.name);
    for (const blocker of item.blockers) {
      assert.ok(result.blockers.includes(blocker), `${item.name}: ${blocker}`);
    }
    assertNoAdmissionRows(db);
  }
});
