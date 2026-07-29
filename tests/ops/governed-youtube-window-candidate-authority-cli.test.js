"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const Database = require("better-sqlite3");
const {
  canonicalSha256,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(
  ROOT,
  "tools",
  "governed-youtube-window-candidate-authority.js",
);
const MIGRATIONS = path.join(ROOT, "db", "migrations");
const SCHEDULED_FOR = "2099-07-29T19:00:00.000Z";

function databaseFixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-window-authority-cli-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "fixture.db");
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare(
    `INSERT INTO channels (id, name, niche)
     VALUES ('pulse-gaming', 'Pulse Gaming', 'gaming')`,
  ).run();
  db.prepare(
    `INSERT INTO stories
       (id, title, full_script, approved, exported_path, audio_path,
        breaking_score, score, channel_id, publish_status,
        youtube_post_id, _extra)
     VALUES
       ('cli-story', 'CLI exact story', 'Complete reviewed script',
        1, 'D:/pulse-data/cli-story.mp4',
        'D:/pulse-data/cli-story.mp3', 100, 100,
        'pulse-gaming', '', '', ?)`,
  ).run(JSON.stringify({ breaking_fast_track: true }));
  const claimText = "Official release evidence for cli-story.";
  const claimTextSha256 = crypto
    .createHash("sha256")
    .update(claimText)
    .digest("hex");
  const sourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    story_id: "cli-story",
    source_url: "https://example.com/news/cli-story",
    source_type: "official",
    claims: [
      {
        claim_key: "official-release",
        text: claimText,
        claim_text_sha256: claimTextSha256,
      },
    ],
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: "https://example.com/news/cli-story",
      source_id: "official:cli-story",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256: claimTextSha256,
      claims: [
        {
          claim_key: "official-release",
          text: claimText,
          claim_text_sha256: claimTextSha256,
        },
      ],
    },
  };
  const admissionEvidence = {
    schema_version: "pulse-publication-review-evidence-v1",
    story_id: "cli-story",
    channel_id: "pulse-gaming",
    media_sha256: "1".repeat(64),
    script_sha256: "2".repeat(64),
    qa_report_sha256: "3".repeat(64),
    rights_ledger_sha256: "4".repeat(64),
    source_evidence_sha256: "5".repeat(64),
    official_source_release_binding: buildOfficialSourceReleaseBinding({
      storyId: "cli-story",
      sourceEvidenceSha256: "5".repeat(64),
      sourceEvidence,
    }),
  };
  const evidence = {
    schema_version: "pulse-final-publication-review-v1",
    story_id: "cli-story",
    channel_id: "pulse-gaming",
    media_sha256: "1".repeat(64),
    script_sha256: "2".repeat(64),
    qa_report: {
      sha256: "3".repeat(64),
      verdict: "PASS",
    },
    rights_ledger: {
      canonical_sha256: "4".repeat(64),
    },
    source_evidence: {
      sha256: "5".repeat(64),
    },
    final_mp4: {
      sha256: "1".repeat(64),
    },
    admission_evidence: admissionEvidence,
    admission_evidence_sha256: canonicalSha256(admissionEvidence),
  };
  const review = db
    .prepare(
      `INSERT INTO operator_audit_log
         (actor_id, action, target_type, target_id, decision,
          reason, evidence_json, idempotency_key)
       VALUES
         ('render-editor', 'governed_publication_review', 'story',
          'cli-story', 'HUMAN_RENDER_APPROVED',
          'Reviewed exact final render', ?, 'review:cli-story')`,
    )
    .run(JSON.stringify(evidence));
  db.close();
  return {
    databasePath,
    reviewAuditId: Number(review.lastInsertRowid),
  };
}

function commonArgs(fixture) {
  return [
    CLI,
    "--database",
    fixture.databasePath,
    "--story-id",
    "cli-story",
    "--role",
    "PRIMARY",
    "--scheduled-for",
    SCHEDULED_FOR,
    "--human-review-audit-id",
    String(fixture.reviewAuditId),
    "--actor-id",
    "window-editor",
    "--reason",
    "Exact CLI authority proof",
  ];
}

function runCli(args) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("CLI defaults to read-only inspection and emits the exact confirmation binding", (t) => {
  const fixture = databaseFixture(t);
  const result = runCli(commonArgs(fixture));

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.database_mutated, false);
  assert.equal(report.publish_authority_created, false);
  assert.equal(report.external_posting, false);
  assert.equal(report.authority.story_id, "cli-story");
  assert.equal(report.authority.role, "PRIMARY");
  assert.equal(report.authority.scheduled_for, SCHEDULED_FOR);
  assert.match(report.authority.authority_binding_sha256, /^[a-f0-9]{64}$/);

  const db = new Database(fixture.databasePath, {
    readonly: true,
  });
  try {
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action = 'governed_youtube_window_primary'`,
        )
        .get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test("CLI apply refuses mutation without the explicit apply switch and exact immutable tuple", (t) => {
  const fixture = databaseFixture(t);
  const inspected = runCli(commonArgs(fixture));
  assert.equal(inspected.status, 0, inspected.stderr);
  const binding = JSON.parse(inspected.stdout).authority
    .authority_binding_sha256;

  const result = runCli([
    ...commonArgs(fixture),
    "--apply",
    "--confirm-story-id",
    "cli-story",
    "--confirm-role",
    "PRIMARY",
    "--confirm-scheduled-for",
    SCHEDULED_FOR,
    "--confirm-authority-binding-sha256",
    binding,
  ]);
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr);
  assert.equal(error.verdict, "HOLD");
  assert.equal(
    error.error,
    "governed_window_candidate_cli_apply_confirmation_required",
  );
  assert.equal(error.database_mutated, false);

  const db = new Database(fixture.databasePath, {
    readonly: true,
  });
  try {
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action = 'governed_youtube_window_primary'`,
        )
        .get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test("CLI applies only the inspected exact authority and creates no publication authority", (t) => {
  const fixture = databaseFixture(t);
  const inspected = runCli(commonArgs(fixture));
  assert.equal(inspected.status, 0, inspected.stderr);
  const authority = JSON.parse(inspected.stdout).authority;

  const result = runCli([
    ...commonArgs(fixture),
    "--apply",
    "--confirm-apply-window-candidate-authority",
    "--confirm-story-id",
    authority.story_id,
    "--confirm-role",
    authority.role,
    "--confirm-scheduled-for",
    authority.scheduled_for,
    "--confirm-authority-binding-sha256",
    authority.authority_binding_sha256,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verdict, "APPLIED");
  assert.equal(report.mutated, true);
  assert.equal(report.story_id, "cli-story");
  assert.equal(report.publish_authority_created, false);
  assert.equal(report.external_posting, false);
  assert.ok(Number.isInteger(report.authority_audit_id));
  assert.ok(Number.isInteger(report.admission_job_id));

  const db = new Database(fixture.databasePath, {
    readonly: true,
  });
  try {
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action = 'governed_youtube_window_primary'
             AND target_id = 'cli-story'
             AND decision = 'APPROVED'`,
        )
        .get().count,
      1,
    );
    const job = db
      .prepare(
        `SELECT *
         FROM jobs
         WHERE kind = 'admit_governed_publication'`,
      )
      .get();
    assert.equal(job.status, "pending");
    assert.equal(job.run_at, "2099-07-29 17:45:00");
    assert.equal(job.story_id, "cli-story");
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM publication_lifecycle_events`,
        )
        .get().count,
      0,
    );
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM platform_dispatch_ledger`,
        )
        .get().count,
      0,
    );
  } finally {
    db.close();
  }
});

test("CLI rejects a tampered binding hash without a partial authority or job", (t) => {
  const fixture = databaseFixture(t);
  const result = runCli([
    ...commonArgs(fixture),
    "--apply",
    "--confirm-apply-window-candidate-authority",
    "--confirm-story-id",
    "cli-story",
    "--confirm-role",
    "PRIMARY",
    "--confirm-scheduled-for",
    SCHEDULED_FOR,
    "--confirm-authority-binding-sha256",
    "0".repeat(64),
  ]);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stderr);
  assert.equal(
    report.error,
    "governed_window_candidate_exact_binding_confirmation_required",
  );
  assert.equal(report.database_mutated, false);
  const db = new Database(fixture.databasePath, {
    readonly: true,
  });
  try {
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action = 'governed_youtube_window_primary'`,
        )
        .get().count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
      0,
    );
  } finally {
    db.close();
  }
});
