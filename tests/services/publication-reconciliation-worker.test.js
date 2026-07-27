"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const governanceFactory = require("../../lib/repositories/publication_governance");
const postsFactory = require("../../lib/repositories/platform_posts");
const {
  reconcilePublicationCandidate,
  reconciliationKey,
} = require("../../lib/services/publication-reconciliation-worker");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const RECONCILIATION_NOW = new Date("2026-07-27T13:00:00.000Z");

function fixture() {
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
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-2",
    "Story two",
  );
  const info = db
    .prepare(
      `INSERT INTO platform_posts
         (story_id, channel_id, platform, status, external_id, external_url,
          error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "story-1",
      "pulse-gaming",
      "youtube",
      "failed",
      "yt-existing",
      "https://youtube.example/yt-existing",
      "legacy_callback_failed",
    );
  const governance = governanceFactory.bind(db);
  const platformPosts = postsFactory.bind(db);
  return {
    db,
    governance,
    platformPosts,
    candidate: governance.listReconciliationCandidates().find(
      (row) => row.platform_post_id === Number(info.lastInsertRowid),
    ),
  };
}

function verification(verifiedAt = "2026-07-27T12:59:00.000Z") {
  return {
    confirmed: true,
    externalId: "yt-existing",
    externalUrl: "https://youtube.example/yt-existing",
    verifiedAt,
    evidence: {
      privacy_status: "public",
      platform_object_confirmed: true,
    },
  };
}

function backup() {
  return {
    verified: true,
    backup_id: "backup-before-repair-1",
    sha256: "b".repeat(64),
    verifiedAt: "2026-07-27T12:00:00.000Z",
  };
}

function decision() {
  return {
    approved: true,
    actorId: "operator-1",
    reason: "Platform object is public and matches the stored ID",
    changeWindowId: "change-window-42",
  };
}

function reconcile(input) {
  return reconcilePublicationCandidate({
    now: RECONCILIATION_NOW,
    ...input,
  });
}

test("reconciliation operation identity is stable across verification checks", () => {
  const candidate = {
    platform_post_id: 17,
    story_id: "story-1",
    channel_id: "pulse-gaming",
    platform: "youtube",
    external_id: "yt-existing",
  };
  assert.equal(
    reconciliationKey(candidate, verification("2026-07-27T12:00:00.000Z")),
    reconciliationKey(candidate, verification("2026-07-27T13:00:00.000Z")),
  );
});

test("valid reconciliation remains a dry-run until apply is explicit", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => verification(),
    backupEvidence: backup(),
    operatorDecision: decision(),
  });
  assert.equal(result.applied, false);
  assert.equal(result.ready_to_apply, true);
  assert.ok(
    result.blockers.includes("explicit_apply_authorisation_required"),
  );
  assert.equal(platformPosts.getById(candidate.platform_post_id).status, "failed");
  assert.equal(governance.getState("story-1", "youtube"), null);
  db.close();
});

test("verification, backup and operator evidence all fail closed", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => ({
      confirmed: true,
      externalId: "yt-existing",
      verifiedAt: "not-a-time",
      evidence: {},
    }),
    backupEvidence: { verified: false },
    operatorDecision: { approved: true, actorId: "operator-1" },
    apply: true,
  });
  assert.equal(result.applied, false);
  for (const blocker of [
    "platform_verification_time_required",
    "public_platform_evidence_required",
    "verified_database_backup_required",
    "explicit_operator_reconciliation_approval_required",
  ]) {
    assert.ok(result.blockers.includes(blocker), blocker);
  }
  assert.equal(platformPosts.getById(candidate.platform_post_id).status, "failed");
  assert.equal(governance.getState("story-1", "youtube"), null);
  db.close();
});

test("public proof and verification times are bounded", async () => {
  const cases = [
    {
      name: "object existence is not public proof",
      verification: {
        ...verification(),
        evidence: { platform_object_confirmed: true },
      },
      backup: backup(),
      blocker: "public_platform_evidence_required",
    },
    {
      name: "future platform verification",
      verification: verification("2026-07-27T13:00:01.000Z"),
      backup: backup(),
      blocker: "platform_verification_time_in_future",
    },
    {
      name: "stale platform verification",
      verification: verification("2026-07-27T11:59:59.000Z"),
      backup: backup(),
      blocker: "platform_verification_stale",
    },
    {
      name: "future backup verification",
      verification: verification(),
      backup: {
        ...backup(),
        verifiedAt: "2026-07-27T13:00:01.000Z",
      },
      blocker: "verified_database_backup_required",
    },
    {
      name: "stale backup verification",
      verification: verification(),
      backup: {
        ...backup(),
        verifiedAt: "2026-07-26T12:59:59.000Z",
      },
      blocker: "verified_database_backup_required",
    },
  ];
  for (const item of cases) {
    const { db, candidate, governance, platformPosts } = fixture();
    const result = await reconcile({
      db,
      candidate,
      governance,
      platformPosts,
      verifyPlatformObject: async () => item.verification,
      backupEvidence: item.backup,
      operatorDecision: decision(),
      apply: true,
    });
    assert.equal(result.applied, false, item.name);
    assert.ok(result.blockers.includes(item.blocker), item.name);
    assert.equal(
      platformPosts.getById(candidate.platform_post_id).status,
      "failed",
      item.name,
    );
    db.close();
  }
});

test("stale or mismatched candidate identity cannot mutate another row", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  let verifyCalls = 0;
  const result = await reconcile({
    db,
    candidate: { ...candidate, story_id: "story-2" },
    governance,
    platformPosts,
    verifyPlatformObject: async () => {
      verifyCalls += 1;
      return verification();
    },
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  });
  assert.equal(result.applied, false);
  assert.ok(result.blockers.includes("reconciliation_candidate_identity_mismatch"));
  assert.equal(verifyCalls, 0);
  assert.equal(platformPosts.getById(candidate.platform_post_id).status, "failed");
  assert.equal(governance.getState("story-1", "youtube"), null);
  db.close();
});

test("identity-less governed ambiguity requires discovery before verification", async () => {
  const { db, governance, platformPosts } = fixture();
  db.prepare(
    `UPDATE platform_posts
     SET external_id = NULL, external_url = NULL
     WHERE story_id = ? AND platform = ?`,
  ).run("story-1", "youtube");
  db.prepare(
    `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state, verification_status)
     VALUES (?, ?, 'RECONCILIATION_REQUIRED', 'requires_reconciliation')`,
  ).run("story-1", "youtube");
  const candidate = governance
    .listReconciliationCandidates({ now: RECONCILIATION_NOW })
    .find((row) => row.story_id === "story-1");
  let verifierCalls = 0;

  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => {
      verifierCalls += 1;
      return verification();
    },
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  });

  assert.equal(result.applied, false);
  assert.ok(result.blockers.includes("stored_external_id_required"));
  assert.equal(verifierCalls, 0);
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  db.close();
});

test("candidate identity is re-read after platform verification", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => {
      db.prepare(
        "UPDATE platform_posts SET external_id = ? WHERE id = ?",
      ).run("yt-changed-during-verification", candidate.platform_post_id);
      return verification();
    },
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  });
  assert.equal(result.applied, false);
  assert.ok(result.blockers.includes("reconciliation_candidate_identity_mismatch"));
  assert.equal(governance.getState("story-1", "youtube"), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  db.close();
});

test("verified operator-approved reconciliation is atomic and auditable", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => verification(),
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  });
  assert.equal(result.applied, true);
  const post = platformPosts.getById(candidate.platform_post_id);
  assert.equal(post.status, "published");
  assert.equal(post.error_message, null);
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "PUBLISHED",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    1,
  );
  const audit = db.prepare("SELECT * FROM operator_audit_log").get();
  const auditEvidence = JSON.parse(audit.evidence_json);
  assert.equal(
    auditEvidence.backup_verified_at,
    "2026-07-27T12:00:00.000Z",
  );
  assert.equal(auditEvidence.change_window_id, "change-window-42");
  const importedLedger = db
    .prepare(
      `SELECT operator_decision_id, verification_evidence_json
       FROM platform_dispatch_ledger
       WHERE event_type = 'LEGACY_RECONCILIATION_IMPORTED'`,
    )
    .get();
  assert.equal(importedLedger.operator_decision_id, String(audit.id));
  assert.equal(
    JSON.parse(importedLedger.verification_evidence_json)
      .backup_verified_at,
    "2026-07-27T12:00:00.000Z",
  );
  db.close();
});

test("existing governed reconciliation publishes without a legacy import and projects YouTube truth", async () => {
  const { db, governance, platformPosts } = fixture();
  db.prepare(
    `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state, external_id, external_url,
        verification_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "story-1",
    "youtube",
    "RECONCILIATION_REQUIRED",
    "yt-existing",
    "https://youtube.example/yt-existing",
    "requires_reconciliation",
    "2026-07-27 12:30:00",
  );
  const candidate = governance
    .listReconciliationCandidates({ now: RECONCILIATION_NOW })
    .find((row) => row.story_id === "story-1");

  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => verification(),
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  });

  assert.equal(result.applied, true);
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM platform_dispatch_ledger
         WHERE event_type = 'LEGACY_RECONCILIATION_IMPORTED'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "PUBLISHED",
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT youtube_post_id, youtube_url, youtube_published_at,
                published_at, publish_status
         FROM stories
         WHERE id = ?`,
      )
      .get("story-1"),
    {
      youtube_post_id: "yt-existing",
      youtube_url: "https://youtube.example/yt-existing",
      youtube_published_at: "2026-07-27T12:59:00.000Z",
      published_at: "2026-07-27T12:59:00.000Z",
      publish_status: "published",
    },
  );
  assert.ok(
    result.mutations_performed.includes("stories_youtube_projection"),
  );
  db.close();
});

test("story projection retains the stored URL when verification omits one", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => ({
      ...verification(),
      externalUrl: null,
    }),
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  });

  assert.equal(result.applied, true);
  assert.equal(
    db
      .prepare("SELECT youtube_url FROM stories WHERE id = ?")
      .get("story-1").youtube_url,
    candidate.external_url,
  );
  db.close();
});

test("reconciliation rejects a conflicting story YouTube identity before mutation", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  db.prepare(
    `UPDATE stories
     SET youtube_post_id = ?, youtube_url = ?, publish_status = 'published'
     WHERE id = ?`,
  ).run(
    "yt-different",
    "https://youtube.example/yt-different",
    "story-1",
  );
  let verifierCalls = 0;

  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => {
      verifierCalls += 1;
      return verification();
    },
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  });

  assert.equal(result.applied, false);
  assert.ok(result.blockers.includes("story_youtube_identity_conflict"));
  assert.equal(verifierCalls, 0);
  assert.equal(platformPosts.getById(candidate.platform_post_id).status, "failed");
  assert.equal(governance.getState("story-1", "youtube"), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT youtube_post_id FROM stories WHERE id = ?")
      .get("story-1").youtube_post_id,
    "yt-different",
  );
  db.close();
});

test("reconciliation rejects a story URL that identifies another YouTube object", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  db.prepare(
    `UPDATE stories
     SET youtube_url = ?
     WHERE id = ?`,
  ).run(
    "https://www.youtube.com/watch?v=yt-different",
    "story-1",
  );
  let verifierCalls = 0;

  const result = await reconcile({
    db,
    candidate,
    governance,
    platformPosts,
    verifyPlatformObject: async () => {
      verifierCalls += 1;
      return verification();
    },
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  });

  assert.equal(result.applied, false);
  assert.ok(
    result.blockers.includes("story_youtube_url_identity_conflict"),
  );
  assert.equal(verifierCalls, 0);
  assert.equal(platformPosts.getById(candidate.platform_post_id).status, "failed");
  assert.equal(governance.getState("story-1", "youtube"), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  db.close();
});

test("database transaction rolls every reconciliation mutation back on failure", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  await assert.rejects(
    reconcile({
      db,
      candidate,
      governance,
      platformPosts: {
        ...platformPosts,
        markPublished() {
          throw new Error("simulated_projection_write_failure");
        },
      },
      verifyPlatformObject: async () => verification(),
      backupEvidence: backup(),
      operatorDecision: decision(),
      apply: true,
    }),
    /simulated_projection_write_failure/,
  );
  assert.equal(platformPosts.getById(candidate.platform_post_id).status, "failed");
  assert.equal(governance.getState("story-1", "youtube"), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  db.close();
});

test("story projection failure rolls governance, post and audit writes back", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  db.exec(
    `CREATE TRIGGER fail_reconciliation_story_projection
     BEFORE UPDATE OF youtube_post_id ON stories
     BEGIN
       SELECT RAISE(ABORT, 'simulated_story_projection_failure');
     END`,
  );

  await assert.rejects(
    reconcile({
      db,
      candidate,
      governance,
      platformPosts,
      verifyPlatformObject: async () => verification(),
      backupEvidence: backup(),
      operatorDecision: decision(),
      apply: true,
    }),
    /simulated_story_projection_failure/,
  );

  assert.equal(platformPosts.getById(candidate.platform_post_id).status, "failed");
  assert.equal(governance.getState("story-1", "youtube"), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT youtube_post_id, youtube_url, youtube_published_at,
                published_at, publish_status
         FROM stories
         WHERE id = ?`,
      )
      .get("story-1"),
    {
      youtube_post_id: null,
      youtube_url: null,
      youtube_published_at: null,
      published_at: null,
      publish_status: null,
    },
  );
  db.close();
});

test("an already-applied retry is a no-op even when verification time changes", async () => {
  const { db, candidate, governance, platformPosts } = fixture();
  const common = {
    db,
    candidate,
    governance,
    platformPosts,
    backupEvidence: backup(),
    operatorDecision: decision(),
    apply: true,
  };
  await reconcile({
    ...common,
    verifyPlatformObject: async () => verification(),
  });
  let verifyCalls = 0;
  const retry = await reconcile({
    ...common,
    verifyPlatformObject: async () => {
      verifyCalls += 1;
      return verification("2026-07-27T13:00:00.000Z");
    },
  });
  assert.equal(retry.applied, false);
  assert.equal(retry.already_applied, true);
  assert.equal(verifyCalls, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM publication_lifecycle_events WHERE story_id = ?",
      )
      .get("story-1").count,
    3,
  );
  db.close();
});
