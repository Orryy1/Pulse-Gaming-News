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
  validateOwnedAssetManifest,
  validateStoryIntakeManifest,
} = require("../../lib/services/governed-story-intake");
const {
  createGovernedHybridStoryIntakeFixture,
} = require("../fixtures/governed-hybrid-story-intake");

const NOW = "2026-07-27T12:00:00.000Z";
const SOURCE_URL =
  "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947";
const STORY_ID = "official_ff567afb1a07";
const SCRIPT =
  "Delta Force just widened cheater compensation to cover thirty-day bans. Previously, victims qualified only after a ten-year ban. The official update says in-game mail should arrive within three business days of confirmation. But if a squadmate extracted and returned your gear, you cannot claim twice.";
const YAZD_SOURCE_URL =
  "https://store.steampowered.com/app/674750/";
const YAZD_STORY_ID = "official_3b8d305c4e17";
const YAZD_SPOKEN_SCRIPT =
  "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July. Claim it before the deadline and the full game stays in your library, this is not a free weekend. It mixes top down shooting with tower defence: spend daylight building barricades, placing turrets and buying weapons, then protect your position when the horde arrives at night. You can play alone, share local co op or fight online with up to four players total. Open the Steam page, make sure the discount shows 100 per cent, and add it to your account. After 30 July, the price comes back.";
const YAZD_TARGET_DURATION_SECONDS = 36.48;
const STANDARD_FRESHNESS = Object.freeze({
  discovered_at: "2026-07-27T09:20:00.000Z",
  source_last_checked_at: "2026-07-27T11:30:00.000Z",
  publish_by: "2026-07-28T18:00:00.000Z",
  stale_after: "2026-07-28T20:00:00.000Z",
  reverification_required: true,
  stale_reframe_option: {
    allowed: true,
    reason: "The confirmed policy change can be reframed as analysis.",
  },
});
const YAZD_FRESHNESS = Object.freeze({
  discovered_at: "2026-07-28T20:00:00.000Z",
  source_last_checked_at: "2026-07-28T20:29:05.648Z",
  publish_by: "2026-07-30T15:00:00.000Z",
  stale_after: "2026-07-30T17:00:00.000Z",
  reverification_required: true,
  stale_reframe_option: {
    allowed: false,
    reason:
      "The script and call to action depend on the live free-to-keep offer.",
  },
});

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
    freshness: structuredClone(STANDARD_FRESHNESS),
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

function highCadenceFixture() {
  const values = fixture();
  const publishedAt = "2026-07-27T03:32:08.000Z";
  const claims = [
    "The official Steam listing marks Yet Another Zombie Defense HD as free to keep.",
    "The offer ends on 30 July 2026.",
    "The official listing describes single-player, local co-op and online co-op modes for up to four players.",
    "The game combines top-down shooting, barricade building and night-time defence.",
  ];
  const sourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    source_url: YAZD_SOURCE_URL,
    source_type: "official",
    published_at: publishedAt,
    claims,
  };
  writeJson(values.evidencePath, sourceEvidence);
  const evidenceSha = sha256(fs.readFileSync(values.evidencePath));
  const scriptSha = sha256(YAZD_SPOKEN_SCRIPT);
  const targetDurationReview = {
    status: "APPROVED",
    target_duration_seconds: YAZD_TARGET_DURATION_SECONDS,
    script_sha256: scriptSha,
    reviewed_by: "pulse-editorial-operator",
    reviewed_at: "2026-07-28T17:20:00.000Z",
  };
  const manifest = {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: YAZD_SOURCE_URL,
    source_type: "official",
    source_evidence_path: "source-evidence.json",
    source_evidence_sha256: evidenceSha,
    published_at: publishedAt,
    claims,
    freshness: structuredClone(YAZD_FRESHNESS),
    contract: {
      editorial_lane_id: "what_changes_for_players",
      hook_type: "direct",
      duration_band_id:
        "what_changes_breaking_high_cadence_35_42",
      target_duration_seconds: YAZD_TARGET_DURATION_SECONDS,
      target_duration_review: targetDurationReview,
    },
    story: {
      id: YAZD_STORY_ID,
      title:
        "Yet Another Zombie Defense HD Is Free To Keep Until 30 July",
      hook:
        "Yet Another Zombie Defense HD is free to keep on Steam, but the offer ends on 30 July.",
      full_script: YAZD_SPOKEN_SCRIPT,
      script_sha256: scriptSha,
      suggested_thumbnail_text: "FREE TO KEEP",
    },
  };
  writeJson(values.manifestPath, manifest);
  return {
    ...values,
    evidenceSha,
    manifest,
    scriptSha,
    targetDurationReview,
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
    PULSE_MIGRATION_024_APPROVED: "true",
    PULSE_MIGRATION_024_APPROVAL_ID: "test-migration-024",
    PULSE_MIGRATION_024_APPROVED_BY: "test-operator",
    PULSE_MIGRATION_024_BACKUP_ID: "test-backup-024",
    PULSE_MIGRATION_024_BACKUP_SHA256: "b".repeat(64),
    PULSE_MIGRATION_024_BACKUP_VERIFIED_AT: "2026-07-27T11:30:00.000Z",
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

test("validates the explicit operator-reviewed 36.48-second high-cadence contract against the exact 106-word YAZD spoken script", () => {
  const values = highCadenceFixture();
  const validated = validateStoryIntakeManifest({
    manifestPath: values.manifestPath,
  });

  assert.equal(validated.storyId, YAZD_STORY_ID);
  assert.equal(validated.script, YAZD_SPOKEN_SCRIPT);
  assert.equal(validated.scriptSha256, values.scriptSha);
  assert.equal(validated.wordCount, 106);
  assert.deepEqual(validated.freshness, YAZD_FRESHNESS);
  assert.deepEqual(validated.contract, values.manifest.contract);
  assert.equal(
    validated.contract.target_duration_seconds,
    YAZD_TARGET_DURATION_SECONDS,
  );
  assert.deepEqual(
    validated.contract.target_duration_review,
    values.targetDurationReview,
  );
});

test("rejects a high-cadence target that has no explicit operator review", () => {
  const values = highCadenceFixture();
  delete values.manifest.contract.target_duration_review;
  writeJson(values.manifestPath, values.manifest);

  assert.throws(
    () =>
      validateStoryIntakeManifest({
        manifestPath: values.manifestPath,
      }),
    (error) => {
      assert.ok(
        error.codes.includes("target_duration_review_required"),
      );
      return true;
    },
  );
});

test("rejects a high-cadence target without an explicit freshness contract", () => {
  const values = highCadenceFixture();
  delete values.manifest.freshness;
  writeJson(values.manifestPath, values.manifest);

  assert.throws(
    () =>
      validateStoryIntakeManifest({
        manifestPath: values.manifestPath,
      }),
    (error) => {
      assert.ok(
        error.codes.includes("story_freshness_contract_required"),
      );
      return true;
    },
  );
});

test("rejects malformed or chronologically incoherent freshness contracts", () => {
  const cases = [
    {
      name: "discovery timestamp",
      expectedCode: "freshness_discovered_at_invalid",
      mutate(freshness) {
        freshness.discovered_at = "not-a-timestamp";
      },
    },
    {
      name: "zone-less discovery timestamp",
      expectedCode: "freshness_discovered_at_invalid",
      mutate(freshness) {
        freshness.discovered_at = "2026-07-28T20:00:00";
      },
    },
    {
      name: "source check timestamp",
      expectedCode: "freshness_source_last_checked_at_invalid",
      mutate(freshness) {
        freshness.source_last_checked_at = "";
      },
    },
    {
      name: "publish deadline",
      expectedCode: "freshness_publish_by_invalid",
      mutate(freshness) {
        freshness.publish_by = "not-a-timestamp";
      },
    },
    {
      name: "stale boundary",
      expectedCode: "freshness_stale_after_invalid",
      mutate(freshness) {
        freshness.stale_after = null;
      },
    },
    {
      name: "source check before discovery",
      expectedCode: "freshness_source_check_before_discovery",
      mutate(freshness) {
        freshness.source_last_checked_at =
          "2026-07-28T19:59:59.999Z";
      },
    },
    {
      name: "publish deadline after stale boundary",
      expectedCode: "freshness_publish_by_after_stale_after",
      mutate(freshness) {
        freshness.publish_by = "2026-07-30T17:00:00.001Z";
      },
    },
    {
      name: "source check after publish deadline",
      expectedCode: "freshness_source_check_after_publish_by",
      mutate(freshness) {
        freshness.source_last_checked_at =
          "2026-07-30T15:00:00.001Z";
      },
    },
    {
      name: "publish deadline before discovery",
      expectedCode: "freshness_publish_by_before_discovery",
      mutate(freshness) {
        freshness.publish_by = "2026-07-28T19:59:59.999Z";
      },
    },
    {
      name: "reverification flag",
      expectedCode: "freshness_reverification_required_invalid",
      mutate(freshness) {
        freshness.reverification_required = "true";
      },
    },
    {
      name: "stale reframe object",
      expectedCode: "freshness_stale_reframe_option_invalid",
      mutate(freshness) {
        freshness.stale_reframe_option = null;
      },
    },
    {
      name: "stale reframe flag",
      expectedCode: "freshness_stale_reframe_allowed_invalid",
      mutate(freshness) {
        freshness.stale_reframe_option.allowed = "false";
      },
    },
    {
      name: "stale reframe reason",
      expectedCode: "freshness_stale_reframe_reason_required",
      mutate(freshness) {
        freshness.stale_reframe_option.reason = "";
      },
    },
    {
      name: "unexpected freshness field",
      expectedCode: "freshness_fields_invalid",
      mutate(freshness) {
        freshness.publish_immediately = true;
      },
    },
    {
      name: "unexpected stale reframe field",
      expectedCode: "freshness_stale_reframe_fields_invalid",
      mutate(freshness) {
        freshness.stale_reframe_option.auto_publish = true;
      },
    },
  ];

  for (const scenario of cases) {
    const values = highCadenceFixture();
    scenario.mutate(values.manifest.freshness);
    writeJson(values.manifestPath, values.manifest);

    assert.throws(
      () =>
        validateStoryIntakeManifest({
          manifestPath: values.manifestPath,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(scenario.expectedCode),
          `${scenario.name}: ${error.codes.join(", ")}`,
        );
        return true;
      },
      scenario.name,
    );
  }
});

test("rejects a high-cadence review that is not bound to the exact target, script and operator decision", () => {
  const cases = [
    {
      name: "approval status",
      expectedCode: "target_duration_review_status_invalid",
      mutate(review) {
        review.status = "PENDING";
      },
    },
    {
      name: "target duration",
      expectedCode: "target_duration_review_target_mismatch",
      mutate(review) {
        review.target_duration_seconds = 36.47;
      },
    },
    {
      name: "script hash",
      expectedCode:
        "target_duration_review_script_sha256_mismatch",
      mutate(review) {
        review.script_sha256 = "f".repeat(64);
      },
    },
    {
      name: "reviewer",
      expectedCode: "target_duration_review_actor_required",
      mutate(review) {
        review.reviewed_by = "";
      },
    },
    {
      name: "review timestamp",
      expectedCode: "target_duration_review_timestamp_invalid",
      mutate(review) {
        review.reviewed_at = "not-a-timestamp";
      },
    },
  ];

  for (const scenario of cases) {
    const values = highCadenceFixture();
    scenario.mutate(
      values.manifest.contract.target_duration_review,
    );
    writeJson(values.manifestPath, values.manifest);

    assert.throws(
      () =>
        validateStoryIntakeManifest({
          manifestPath: values.manifestPath,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(scenario.expectedCode),
          `${scenario.name}: ${error.codes.join(", ")}`,
        );
        return true;
      },
      scenario.name,
    );
  }
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
  assert.deepEqual(
    JSON.parse(story._extra).freshness,
    STANDARD_FRESHNESS,
  );
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
  const checkpoint = new Database(databasePath);
  assert.equal(
    checkpoint.pragma("journal_mode = WAL", { simple: true }),
    "wal",
  );
  checkpoint.pragma("wal_checkpoint(TRUNCATE)");
  checkpoint.close();
  assert.equal(fs.existsSync(`${databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${databasePath}-shm`), false);
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
  assert.equal(fs.existsSync(`${databasePath}-wal`), false);
  assert.equal(fs.existsSync(`${databasePath}-shm`), false);

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

test("accepts the exact hash-bound governed mixed HyperFrames intermediate and preserves the combined manifest SHA", () => {
  const values = createGovernedHybridStoryIntakeFixture();

  const result = executeGovernedStoryIntake({
    action: "ingest",
    manifestPath: values.storyIntakePath,
    assetManifestPath: values.assetManifestPath,
    assetManifestSha256: values.assetManifestSha256,
    generatedAt: NOW,
  });

  assert.equal(result.verdict, "VALID");
  assert.equal(result.story_id, values.storyId);
  assert.equal(
    result.owned_asset_manifest_sha256,
    values.assetManifestSha256,
  );
  assert.equal(
    result.owned_asset_manifest_sha256,
    sha256(fs.readFileSync(values.assetManifestPath)),
  );
});

test("rejects a mixed HyperFrames intermediate that declares itself as its owned source backbone", () => {
  const values = createGovernedHybridStoryIntakeFixture({
    mutateAssetManifest(manifest) {
      const hybrid = manifest.assets[1];
      manifest.assets[0] = {
        path: hybrid.path,
        sha256: hybrid.sha256,
        media_type: "video",
        role: "owned_motion_backbone",
        ownership: "owned",
        rights_basis: "OWNED",
        attribution_required: false,
      };
      hybrid.provenance.source_backbone = {
        path: hybrid.path,
        sha256: hybrid.sha256,
      };
    },
  });

  assert.throws(
    () =>
      executeGovernedStoryIntake({
        action: "ingest",
        manifestPath: values.storyIntakePath,
        assetManifestPath: values.assetManifestPath,
        assetManifestSha256: values.assetManifestSha256,
        generatedAt: NOW,
      }),
    (error) =>
      error?.codes?.includes(
        "owned_asset_1_owned_source_backbone_not_distinct",
      ),
  );
});

test("requires the governed hybrid source backbone to carry exact owned-backbone policy metadata", () => {
  const cases = [
    {
      name: "role",
      mutate(backbone) {
        backbone.role = "primary_motion";
      },
    },
    {
      name: "rights basis",
      mutate(backbone) {
        backbone.rights_basis = "LICENSED";
      },
    },
    {
      name: "attribution",
      mutate(backbone) {
        backbone.attribution_required = true;
      },
    },
  ];

  for (const scenario of cases) {
    const values = createGovernedHybridStoryIntakeFixture({
      mutateAssetManifest(manifest) {
        const backbone = manifest.assets[0];
        backbone.role = "owned_motion_backbone";
        backbone.rights_basis = "OWNED";
        backbone.attribution_required = false;
        scenario.mutate(backbone);
      },
    });

    assert.throws(
      () =>
        executeGovernedStoryIntake({
          action: "ingest",
          manifestPath: values.storyIntakePath,
          assetManifestPath: values.assetManifestPath,
          assetManifestSha256: values.assetManifestSha256,
          generatedAt: NOW,
        }),
      (error) =>
        error?.codes?.includes(
          "owned_asset_1_owned_source_backbone_policy_invalid",
        ),
      scenario.name,
    );
  }
});

test("rejects a governed mixed HyperFrames intermediate when any source-media hash, licence or transformation evidence drifts", () => {
  const cases = [
    {
      name: "source manifest binding",
      create: () =>
        createGovernedHybridStoryIntakeFixture({
          mutateAssetManifest(manifest) {
            manifest.assets[1].provenance.source_media_manifest.sha256 =
              "0".repeat(64);
          },
        }),
      expectedCode:
        "owned_asset_1_source_media_manifest_sha256_mismatch",
    },
    {
      name: "licence evidence",
      create: () =>
        createGovernedHybridStoryIntakeFixture({
          mutateSourceMediaManifest(manifest) {
            manifest.components[0].licence_evidence_url =
              "https://example.com/not-the-reviewed-licence";
          },
        }),
      expectedCode:
        "owned_asset_1_source_media_component_0_licence_evidence_url_invalid",
    },
    {
      name: "transformation evidence",
      create: () =>
        createGovernedHybridStoryIntakeFixture({
          mutateSourceMediaManifest(manifest) {
            manifest.components[0].editorial.treatment = "";
          },
        }),
      expectedCode: "owned_asset_1_transformation_evidence_invalid",
    },
  ];

  for (const scenario of cases) {
    const values = scenario.create();
    assert.throws(
      () =>
        executeGovernedStoryIntake({
          action: "ingest",
          manifestPath: values.storyIntakePath,
          assetManifestPath: values.assetManifestPath,
          assetManifestSha256: values.assetManifestSha256,
          generatedAt: NOW,
        }),
      (error) => {
        assert.ok(
          error.codes.includes(scenario.expectedCode),
          `${scenario.name}: ${error.codes.join(", ")}`,
        );
        return true;
      },
    );
  }
});

test("continues to reject ordinary mixed and third-party owned-asset records", () => {
  const values = fixture();
  const assetPath = path.join(values.root, "untrusted-motion.mp4");
  fs.writeFileSync(assetPath, "untrusted-motion");
  const manifestPath = path.join(values.root, "untrusted-assets.json");

  for (const ownership of ["mixed", "third_party"]) {
    writeJson(manifestPath, {
      schema_version: "pulse-owned-motion-manifest-v1",
      story_id: STORY_ID,
      assets: [
        {
          path: path.basename(assetPath),
          sha256: sha256(fs.readFileSync(assetPath)),
          media_type: "video",
          role: "primary_motion",
          ownership,
        },
      ],
    });

    assert.throws(
      () =>
        validateOwnedAssetManifest({
          manifestPath,
          expectedSha256: sha256(fs.readFileSync(manifestPath)),
          expectedStoryId: STORY_ID,
        }),
      (error) => {
        assert.ok(error.codes.includes("owned_asset_0_ownership_invalid"));
        return true;
      },
    );
  }
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
