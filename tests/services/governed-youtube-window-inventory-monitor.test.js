"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  buildGovernedYoutubeWindowInventoryReport,
  readGovernedYoutubeWindowInventoryReport,
  renderGovernedYoutubeWindowInventoryMarkdown,
} = require("../../lib/services/governed-youtube-window-inventory-monitor");
const {
  canonicalSha256,
} = require("../../lib/services/governed-youtube-release-runway");

const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const HASHES = Object.freeze({
  media_sha256: "1".repeat(64),
  script_sha256: "2".repeat(64),
  qa_report_sha256: "3".repeat(64),
  rights_ledger_sha256: "4".repeat(64),
  source_evidence_sha256: "5".repeat(64),
});

function authority(role, storyId, overrides = {}) {
  const body = {
    schema_version:
      "pulse-governed-youtube-window-candidate-authority-v1",
    platform: "youtube",
    role,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    scheduled_for: SCHEDULED_FOR,
    admission_run_at:
      role === "PRIMARY"
        ? "2026-07-28T17:45:00.000Z"
        : null,
    candidate_revision_sha256:
      (role === "PRIMARY" ? "a" : "b").repeat(64),
    candidate_revision: {
      schema_version: "pulse-multi-lane-candidate-revision-v1",
    },
    human_review_audit_id: role === "PRIMARY" ? 101 : 102,
    human_review_audit_sha256: "6".repeat(64),
    human_review_evidence_sha256: "7".repeat(64),
    human_review_audit_idempotency_key: `review:${storyId}`,
    evidence_hashes: HASHES,
    operator: {
      actor_id: "window-editor",
      reason: `Approved ${role.toLowerCase()} for exact window`,
    },
    standby_authorised: role === "STANDBY",
    admission: {
      human_review_status: "approved",
      confirmation_story_id: storyId,
      scheduled_for: SCHEDULED_FOR,
      evidence: HASHES,
    },
    publish_authority: false,
    external_posting: false,
    immediate_scheduling: false,
    ...overrides,
  };
  const evidence = {
    ...body,
    authority_binding_sha256: canonicalSha256(body),
  };
  return {
    id: role === "PRIMARY" ? 201 : 202,
    action:
      role === "PRIMARY"
        ? "governed_youtube_window_primary"
        : "governed_youtube_runway_standby",
    target_type: "story",
    target_id: storyId,
    decision: "APPROVED",
    evidence_json: JSON.stringify(evidence),
  };
}

function primaryAdmissionJob(overrides = {}) {
  return {
    id: 301,
    kind: "admit_governed_publication",
    story_id: "primary-story",
    status: "pending",
    run_at: "2026-07-28 17:45:00",
    payload: {
      candidate_revision_sha256: "a".repeat(64),
      admission: {
        scheduled_for: SCHEDULED_FOR,
      },
      window_candidate_authority: {
        audit_id: 201,
        authority_binding_sha256: authority(
          "PRIMARY",
          "primary-story",
        ).evidence_json
          ? JSON.parse(
              authority("PRIMARY", "primary-story").evidence_json,
            ).authority_binding_sha256
          : null,
      },
    },
    ...overrides,
  };
}

test("the next exact window is COVERED only with one distinct immutable PRIMARY, STANDBY and the exact pending T-75 admission", () => {
  const report = buildGovernedYoutubeWindowInventoryReport({
    now: "2026-07-28T14:00:00.000Z",
    horizonHours: 6,
    authorityAudits: [
      authority("PRIMARY", "primary-story"),
      authority("STANDBY", "reserve-story"),
    ],
    jobs: [primaryAdmissionJob()],
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.windows.length, 1);
  assert.equal(report.next_window.coverage_status, "COVERED");
  assert.equal(report.next_window.primary.story_id, "primary-story");
  assert.equal(report.next_window.standby.story_id, "reserve-story");
  assert.equal(report.next_window.primary_admission_job.id, 301);
  assert.equal(report.next_window.minutes_remaining, 300);
  assert.equal(report.next_window.lock_deadline, "2026-07-28T17:30:00.000Z");
  assert.equal(report.next_window.review_deadline, "2026-07-28T17:00:00.000Z");
  assert.deepEqual(report.next_window.blockers, []);
  assert.equal(report.publish_authority, false);
  assert.equal(report.external_posting, false);
});

test("an uncovered window escalates before T-90 instead of being counted as reliable", () => {
  const report = buildGovernedYoutubeWindowInventoryReport({
    now: "2026-07-28T16:00:00.000Z",
    horizonHours: 4,
    authorityAudits: [
      authority("PRIMARY", "primary-story"),
    ],
    jobs: [primaryAdmissionJob()],
  });

  assert.equal(report.verdict, "HOLD");
  assert.equal(report.next_window.coverage_status, "AT_RISK");
  assert.equal(report.next_window.escalation, "WARNING");
  assert.ok(
    report.next_window.blockers.includes(
      "governed_window_standby_authority_required",
    ),
  );
  assert.equal(report.next_window.supply_deficit, 1);
});

test("an uncovered window inside T-90 is a missed inventory floor and cannot invite catch-up", () => {
  const report = buildGovernedYoutubeWindowInventoryReport({
    now: "2026-07-28T17:31:00.000Z",
    horizonHours: 2,
    authorityAudits: [],
    jobs: [],
  });

  assert.equal(report.next_window.coverage_status, "MISSED_T90");
  assert.equal(report.next_window.escalation, "INCIDENT");
  assert.equal(report.next_window.catch_up_allowed, false);
  assert.equal(report.next_window.publish_authority, false);
});

test("tampered authority, duplicate story roles or a drifted T-75 job fail closed", () => {
  const tamperedStandby = authority(
    "STANDBY",
    "reserve-story",
  );
  const tamperedEvidence = JSON.parse(
    tamperedStandby.evidence_json,
  );
  tamperedEvidence.evidence_hashes.media_sha256 =
    "f".repeat(64);
  tamperedStandby.evidence_json =
    JSON.stringify(tamperedEvidence);

  const report = buildGovernedYoutubeWindowInventoryReport({
    now: "2026-07-28T14:00:00.000Z",
    horizonHours: 6,
    authorityAudits: [
      authority("PRIMARY", "same-story"),
      tamperedStandby,
      authority("STANDBY", "same-story"),
    ],
    jobs: [
      primaryAdmissionJob({
        story_id: "same-story",
        run_at: "2026-07-28 17:46:00",
      }),
    ],
  });

  assert.equal(report.verdict, "HOLD");
  assert.ok(
    report.next_window.blockers.includes(
      "governed_window_authority_binding_invalid",
    ),
  );
  assert.ok(
    report.next_window.blockers.includes(
      "governed_window_distinct_candidates_required",
    ),
  );
  assert.ok(
    report.next_window.blockers.includes(
      "governed_window_primary_admission_t75_required",
    ),
  );
});

test("the database monitor reads canonical authorities without a newest-100 candidate-page blind spot", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE operator_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        evidence_json TEXT
      );
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        story_id TEXT,
        status TEXT NOT NULL,
        run_at TEXT,
        payload TEXT
      );
    `);
    const insertAudit = db.prepare(`
      INSERT INTO operator_audit_log
        (id, action, target_type, target_id, decision, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of [
      authority("PRIMARY", "primary-story"),
      authority("STANDBY", "reserve-story"),
    ]) {
      insertAudit.run(
        row.id,
        row.action,
        row.target_type,
        row.target_id,
        row.decision,
        row.evidence_json,
      );
    }
    for (let index = 0; index < 150; index += 1) {
      const noise = authority(
        "STANDBY",
        `future-noise-${index}`,
        {
          scheduled_for: "2026-07-29T19:00:00.000Z",
        },
      );
      insertAudit.run(
        1000 + index,
        noise.action,
        noise.target_type,
        noise.target_id,
        noise.decision,
        noise.evidence_json,
      );
    }
    const admission = primaryAdmissionJob();
    db.prepare(`
      INSERT INTO jobs
        (id, kind, story_id, status, run_at, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      admission.id,
      admission.kind,
      admission.story_id,
      admission.status,
      admission.run_at,
      JSON.stringify(admission.payload),
    );

    const report = readGovernedYoutubeWindowInventoryReport({
      db,
      now: "2026-07-28T14:00:00.000Z",
      horizonHours: 6,
    });

    assert.equal(report.verdict, "GREEN");
    assert.equal(report.next_window.primary.story_id, "primary-story");
    assert.equal(report.next_window.standby.story_id, "reserve-story");
    assert.equal(report.source.authority_rows_read, 152);
    assert.equal(report.source.job_rows_read, 1);
  } finally {
    db.close();
  }
});

test("the operator summary says plainly whether an exact window is genuinely covered", () => {
  const report = buildGovernedYoutubeWindowInventoryReport({
    now: "2026-07-28T16:00:00.000Z",
    horizonHours: 4,
    authorityAudits: [
      authority("PRIMARY", "primary-story"),
    ],
    jobs: [primaryAdmissionJob()],
  });

  const markdown =
    renderGovernedYoutubeWindowInventoryMarkdown(report);

  assert.match(
    markdown,
    /^# Governed YouTube window inventory/m,
  );
  assert.match(markdown, /19:00:00\.000Z — AT_RISK \(HOLD\)/);
  assert.match(
    markdown,
    /governed_window_standby_authority_required/,
  );
  assert.match(markdown, /Catch-up publishing: forbidden/);
});
