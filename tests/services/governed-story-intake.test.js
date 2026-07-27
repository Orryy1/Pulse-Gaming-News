"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const {
  executeGovernedStoryIntake,
  validateStoryIntakeManifest,
} = require("../../lib/services/governed-story-intake");

const NOW = "2026-07-27T12:00:00.000Z";
const SOURCE_URL =
  "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947";
const STORY_ID = "official_ff567afb1a07";
const SCRIPT =
  "Delta Force just widened cheater compensation to cover thirty-day bans. Previously, victims qualified only after a ten-year ban. The official update says in-game mail should arrive within three business days of confirmation. But if a squadmate extracted and returned your gear, you cannot claim twice.";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-intake-"));
  const evidencePath = path.join(root, "source-evidence.json");
  const sourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    source_url: SOURCE_URL,
    source_type: "official",
    published_at: "2026-07-27T09:15:34.000Z",
    claims: [
      "Thirty-day bans now qualify victims for compensation.",
      "Compensation mail should arrive within three business days.",
      "Gear returned by a squadmate cannot be claimed twice.",
    ],
  };
  writeJson(evidencePath, sourceEvidence);
  const evidenceSha = sha256(fs.readFileSync(evidencePath));
  const scriptSha = sha256(SCRIPT);
  const manifestPath = path.join(root, "story-intake.json");
  const manifest = {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: SOURCE_URL,
    source_type: "official",
    source_evidence_path: "source-evidence.json",
    source_evidence_sha256: evidenceSha,
    published_at: sourceEvidence.published_at,
    claims: sourceEvidence.claims,
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id: "what_changes_short_25_32",
    },
    story: {
      id: STORY_ID,
      title: "Delta Force widens cheater compensation",
      hook: "Delta Force just widened cheater compensation.",
      full_script: SCRIPT,
      script_sha256: scriptSha,
      suggested_thumbnail_text: "CHEATER PAYBACK EXPANDS",
      operator_note: "Keep this field through the governed intake.",
    },
  };
  writeJson(manifestPath, manifest);
  return {
    root,
    evidencePath,
    evidenceSha,
    manifest,
    manifestPath,
    scriptSha,
  };
}

function migrationEnv() {
  return {
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    PULSE_MIGRATION_020_APPROVED: "true",
    PULSE_MIGRATION_020_APPROVAL_ID: "test-migration-020",
    PULSE_MIGRATION_020_APPROVED_BY: "test-operator",
    PULSE_MIGRATION_020_BACKUP_ID: "test-backup",
    PULSE_MIGRATION_020_BACKUP_SHA256: "a".repeat(64),
    PULSE_MIGRATION_020_BACKUP_VERIFIED_AT: "2026-07-27T11:00:00.000Z",
  };
}

function createDatabase(root) {
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  runMigrations(db, {
    env: migrationEnv(),
    now: new Date(NOW),
    log() {},
  });
  db.prepare(
    `INSERT INTO channels (id, name, enabled)
     VALUES ('pulse-gaming', 'Pulse Gaming', 1)`,
  ).run();
  db.close();
  return databasePath;
}

function createBackupEvidence(root, databasePath, suffix = "one") {
  const backupPath = path.join(root, `pulse-${suffix}.backup.db`);
  fs.copyFileSync(databasePath, backupPath);
  const evidencePath = path.join(root, `backup-${suffix}.json`);
  writeJson(evidencePath, {
    schema_version: "pulse-cutover-backup-evidence-v1",
    backup_id: `backup-${suffix}`,
    backup_path: path.basename(backupPath),
    backup_sha256: sha256(fs.readFileSync(backupPath)),
    source_database_path: databasePath,
    source_database_sha256: sha256(fs.readFileSync(databasePath)),
    verified_at: "2026-07-27T11:30:00.000Z",
    verified_by: "backup-verifier",
    restore_test_status: "PASS",
    integrity_check: "ok",
    foreign_key_check: "ok",
  });
  return evidencePath;
}

function applyEnv(overrides = {}) {
  return {
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    OPERATING_MODE: "HUMAN_REVIEW",
    AUTO_PUBLISH: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
    PULSE_CUTOVER_SCHEDULER_STOPPED: "true",
    PULSE_CUTOVER_WORKERS_STOPPED: "true",
    ...overrides,
  };
}

function applyOptions(values, databasePath, backupEvidencePath) {
  return {
    action: "ingest",
    apply: true,
    manifestPath: values.manifestPath,
    databasePath,
    backupEvidencePath,
    confirmStoryId: STORY_ID,
    actorId: "editor-1",
    reason: "Governed breaking-news candidate intake",
    scriptSha256: values.scriptSha,
    generatedAt: NOW,
    env: applyEnv(),
  };
}

test("validates the official source evidence, exact script and deterministic identity", () => {
  const values = fixture();
  const validated = validateStoryIntakeManifest({
    manifestPath: values.manifestPath,
  });

  assert.equal(validated.storyId, STORY_ID);
  assert.equal(validated.script, SCRIPT);
  assert.equal(validated.scriptSha256, values.scriptSha);
  assert.equal(validated.wordCount, 45);
  assert.equal(validated.sourceEvidenceSha256, values.evidenceSha);
  assert.deepEqual(validated.contract, values.manifest.contract);
});

test("dry-run is the default and does not need or mutate a database", () => {
  const values = fixture();
  const result = executeGovernedStoryIntake({
    manifestPath: values.manifestPath,
    generatedAt: NOW,
  });

  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.verdict, "VALID");
  assert.equal(result.mutated, false);
  assert.equal(result.story_id, STORY_ID);
});

test("rejects source-evidence drift, non-official sources and script contract drift", () => {
  const values = fixture();
  const tampered = { ...values.manifest, source_type: "rss" };
  writeJson(values.manifestPath, tampered);
  fs.appendFileSync(values.evidencePath, " ");

  assert.throws(
    () => validateStoryIntakeManifest({ manifestPath: values.manifestPath }),
    (error) => {
      assert.equal(error.name, "GovernedStoryIntakeError");
      assert.ok(error.codes.includes("official_source_type_required"));
      assert.ok(error.codes.includes("source_evidence_sha256_mismatch"));
      return true;
    },
  );

  const shortScript = "This script is much too short for the selected lane.";
  values.manifest.source_type = "official";
  values.manifest.source_evidence_sha256 = sha256(
    fs.readFileSync(values.evidencePath),
  );
  values.manifest.story.full_script = shortScript;
  values.manifest.story.script_sha256 = sha256(shortScript);
  writeJson(values.manifestPath, values.manifest);
  assert.throws(
    () => validateStoryIntakeManifest({ manifestPath: values.manifestPath }),
    (error) => {
      assert.ok(error.codes.includes("script_word_count_out_of_range"));
      return true;
    },
  );
});

test("apply inserts an unapproved story and immutable idempotent operator audit", () => {
  const values = fixture();
  const databasePath = createDatabase(values.root);
  const backupEvidencePath = createBackupEvidence(
    values.root,
    databasePath,
  );
  const result = executeGovernedStoryIntake(
    applyOptions(values, databasePath, backupEvidencePath),
  );

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.mutated, true);

  const db = new Database(databasePath, { readonly: true });
  const story = db.prepare("SELECT * FROM stories WHERE id = ?").get(STORY_ID);
  const audit = db
    .prepare(
      `SELECT * FROM operator_audit_log
       WHERE target_id = ? AND action = 'governed_story_ingest'`,
    )
    .get(STORY_ID);
  assert.equal(story.approved, 0);
  assert.equal(story.auto_approved, 0);
  assert.equal(story.source_type, "official");
  assert.equal(story.url, SOURCE_URL);
  assert.equal(story.full_script, SCRIPT);
  assert.equal(JSON.parse(story._extra).operator_note, values.manifest.story.operator_note);
  assert.equal(JSON.parse(story._extra).script_sha256, values.scriptSha);
  assert.equal(audit.actor_id, "editor-1");
  assert.match(audit.idempotency_key, new RegExp(`^governed-story-intake:ingest:${STORY_ID}:`));
  db.close();
});

test("apply refuses mutation unless every human-review and stopped-runtime gate passes", () => {
  const values = fixture();
  const databasePath = createDatabase(values.root);
  const backupEvidencePath = createBackupEvidence(
    values.root,
    databasePath,
  );
  const result = executeGovernedStoryIntake({
    ...applyOptions(values, databasePath, backupEvidencePath),
    env: applyEnv({
      AUTO_PUBLISH: "true",
      PULSE_CUTOVER_WORKERS_STOPPED: "false",
    }),
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(result.blockers.includes("auto_publish_must_be_explicitly_false"));
  assert.ok(result.blockers.includes("workers_must_be_stopped"));
  const db = new Database(databasePath, { readonly: true });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM stories").get().count,
    0,
  );
  db.close();
});

test("approve-script is exact-hash-bound, separately audited and never auto-approved", () => {
  const values = fixture();
  const databasePath = createDatabase(values.root);
  let backupEvidencePath = createBackupEvidence(
    values.root,
    databasePath,
    "ingest",
  );
  executeGovernedStoryIntake(
    applyOptions(values, databasePath, backupEvidencePath),
  );
  backupEvidencePath = createBackupEvidence(
    values.root,
    databasePath,
    "approve",
  );

  const result = executeGovernedStoryIntake({
    action: "approve-script",
    apply: true,
    storyId: STORY_ID,
    databasePath,
    backupEvidencePath,
    confirmStoryId: STORY_ID,
    actorId: "editor-2",
    reason: "Exact final script reviewed",
    scriptSha256: values.scriptSha,
    generatedAt: NOW,
    env: applyEnv(),
  });
  assert.equal(result.verdict, "APPLIED");

  const db = new Database(databasePath, { readonly: true });
  const story = db
    .prepare("SELECT approved, auto_approved, _extra FROM stories WHERE id = ?")
    .get(STORY_ID);
  assert.equal(story.approved, 1);
  assert.equal(story.auto_approved, 0);
  assert.equal(
    JSON.parse(story._extra).script_approved_sha256,
    values.scriptSha,
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'governed_story_script_approval' AND target_id = ?`,
      )
      .get(STORY_ID).count,
    1,
  );
  db.close();
});

test("owned assets can be hash-bound during intake or attached later without acquisition", () => {
  const values = fixture();
  const imagePath = path.join(values.root, "hero.png");
  const videoPath = path.join(values.root, "motion.mp4");
  fs.writeFileSync(imagePath, "owned-image");
  fs.writeFileSync(videoPath, "owned-video");
  const assetManifestPath = path.join(values.root, "owned-assets.json");
  writeJson(assetManifestPath, {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: STORY_ID,
    assets: [
      {
        path: "hero.png",
        sha256: sha256(fs.readFileSync(imagePath)),
        media_type: "image",
        role: "hero",
        ownership: "owned",
      },
      {
        path: "motion.mp4",
        sha256: sha256(fs.readFileSync(videoPath)),
        media_type: "video",
        role: "primary_motion",
        ownership: "owned",
      },
    ],
  });
  const assetManifestSha256 = sha256(fs.readFileSync(assetManifestPath));
  const databasePath = createDatabase(values.root);
  const backupEvidencePath = createBackupEvidence(
    values.root,
    databasePath,
  );
  executeGovernedStoryIntake({
    ...applyOptions(values, databasePath, backupEvidencePath),
    assetManifestPath,
    assetManifestSha256,
  });

  const db = new Database(databasePath, { readonly: true });
  const story = db
    .prepare(
      "SELECT image_path, downloaded_images, video_clips, _extra FROM stories WHERE id = ?",
    )
    .get(STORY_ID);
  assert.equal(story.image_path, imagePath);
  assert.deepEqual(JSON.parse(story.downloaded_images), [
    {
      path: imagePath,
      type: "owned",
      role: "hero",
      sha256: sha256(fs.readFileSync(imagePath)),
    },
  ]);
  assert.deepEqual(JSON.parse(story.video_clips), [videoPath]);
  assert.equal(
    JSON.parse(story._extra).owned_asset_manifest_sha256,
    assetManifestSha256,
  );
  db.close();
});

test("attach-owned-assets is separately gated, atomic and idempotently audited", () => {
  const values = fixture();
  const databasePath = createDatabase(values.root);
  executeGovernedStoryIntake(
    applyOptions(
      values,
      databasePath,
      createBackupEvidence(values.root, databasePath, "before-ingest"),
    ),
  );
  const videoPath = path.join(values.root, "later-motion.mp4");
  fs.writeFileSync(videoPath, "later-owned-video");
  const assetManifestPath = path.join(values.root, "later-assets.json");
  writeJson(assetManifestPath, {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: STORY_ID,
    assets: [
      {
        path: path.basename(videoPath),
        sha256: sha256(fs.readFileSync(videoPath)),
        media_type: "video",
        role: "primary_motion",
        ownership: "owned",
      },
    ],
  });
  const assetManifestSha256 = sha256(fs.readFileSync(assetManifestPath));
  const attach = (backupEvidencePath) =>
    executeGovernedStoryIntake({
      action: "attach-owned-assets",
      apply: true,
      storyId: STORY_ID,
      assetManifestPath,
      assetManifestSha256,
      databasePath,
      backupEvidencePath,
      confirmStoryId: STORY_ID,
      actorId: "asset-editor",
      reason: "Bind governed owned motion",
      generatedAt: NOW,
      env: applyEnv(),
    });

  const first = attach(
    createBackupEvidence(values.root, databasePath, "before-attach"),
  );
  assert.equal(first.verdict, "APPLIED");
  const replay = attach(
    createBackupEvidence(values.root, databasePath, "before-replay"),
  );
  assert.equal(replay.verdict, "IDEMPOTENT");
  assert.equal(replay.mutated, false);

  const db = new Database(databasePath, { readonly: true });
  const story = db
    .prepare(
      "SELECT approved, auto_approved, title, video_clips FROM stories WHERE id = ?",
    )
    .get(STORY_ID);
  assert.equal(story.approved, 0);
  assert.equal(story.auto_approved, 0);
  assert.equal(story.title, values.manifest.story.title);
  assert.deepEqual(JSON.parse(story.video_clips), [videoPath]);
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'governed_story_owned_assets_attached'
           AND target_id = ?`,
      )
      .get(STORY_ID).count,
    1,
  );
  db.close();
});
