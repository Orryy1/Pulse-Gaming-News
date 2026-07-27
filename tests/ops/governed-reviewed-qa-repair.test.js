"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  executeGovernedReviewedQaRepair,
} = require("../../lib/ops/governed-reviewed-qa-repair");
const {
  admitPublication,
} = require("../../lib/services/publication-admission");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  createRendererEvidence,
} = require("../../lib/stabilisation/render-manifest");
const {
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");
const governanceFactory = require("../../lib/repositories/publication_governance");
const storiesFactory = require("../../lib/repositories/stories");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const STORY_ID = "official_reviewed_qa_repair";
const SCRIPT =
  "Final Fantasy XIV just revealed a tank that fights with two giant shields. Bastion arrives in Evercold and only works in Evolved Mode. The expansion makes its story less linear, auto-scales content and adds a Final Fantasy VII raid. The MMO hits Switch 2 on August fourth.";
const GENERATED_AT = "2026-07-27T09:20:00.000Z";
const COMMIT_SHA = "c".repeat(40);
const SAFE_ENV = Object.freeze({
  PULSE_OPERATING_MODE: "HUMAN_REVIEW",
  OPERATING_MODE: "HUMAN_REVIEW",
  AUTO_PUBLISH: "false",
  PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
  PULSE_EMERGENCY_KILL_SWITCH: "true",
  PULSE_KILL_SWITCH: "true",
  PULSE_CUTOVER_SCHEDULER_STOPPED: "true",
  PULSE_CUTOVER_WORKERS_STOPPED: "true",
  PULSE_PRIMARY_INSTANCE: "false",
  USE_SQLITE: "true",
  USE_JOB_QUEUE: "true",
  TIKTOK_ENABLED: "false",
  TIKTOK_AUTO_PUBLISH: "false",
  INSTAGRAM_AUTO_PUBLISH: "false",
  FACEBOOK_AUTO_PUBLISH: "false",
  TWITTER_ENABLED: "false",
  X_AUTO_PUBLISH: "false",
  THREADS_AUTO_PUBLISH: "false",
  PINTEREST_AUTO_PUBLISH: "false",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-reviewed-qa-repair-"),
  );
  const databasePath = path.join(directory, "pulse.db");
  const mediaPath = path.join(directory, "reviewed-final.mp4");
  const mediaBytes = Buffer.alloc(220 * 1024, 0x5a);
  fs.writeFileSync(mediaPath, mediaBytes);
  const metadataPath = path.join(directory, "publication-metadata.json");
  const metadataValue = {
    schema_version: "pulse-governed-publication-metadata-v1",
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    platform: "youtube_shorts",
    title: "Final Fantasy XIV's New Tank Uses TWO Giant Shields",
    description: "A fast player-first breakdown.\n\nFootage: © SQUARE ENIX",
  };
  const metadataBytes = Buffer.from(
    `${JSON.stringify(metadataValue, null, 2)}\n`,
  );
  fs.writeFileSync(metadataPath, metadataBytes);

  const db = new Database(databasePath);
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
    id: STORY_ID,
    title: metadataValue.title,
    channel_id: "pulse-gaming",
    approved: true,
    auto_approved: false,
    full_script: SCRIPT,
    exported_path: mediaPath,
  };
  const scriptSha256 = sha256(SCRIPT);
  const mediaSha256 = sha256(mediaBytes);
  const rendererManifest = createRendererEvidence({
    story,
    rendererVersion: "studio-v21.4.0",
    mediaSha256,
    stack: { hyperframes: true, ffmpeg: true },
    platformVideoQa: {
      result: "pass",
      failures: [],
      warnings: [],
      technical: {
        video_codec: "h264",
        video_profile: "High",
        pixel_format: "yuv420p",
        width: 1080,
        height: 1920,
        audio_codec: "aac",
        audio_sample_rate_hz: 48000,
        has_audio: true,
        duration_seconds: 25,
        ffprobe_passed: true,
      },
    },
    timing: {
      first_frame_exact_subject: true,
      hook_visible_by_ms: 0,
      consequence_by_ms: 0,
      proof_by_ms: 0,
    },
    motion: {
      scene_count: 13,
      motion_scene_count: 13,
      exact_subject_clip_count: 0,
      exact_subject_still_motion_count: 13,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
    operatingMode: "LIVE_GUARDED",
  }).manifest;
  const rendererManifestSha256 =
    fingerprintRendererManifest(rendererManifest);
  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-motion",
        source_url: `pulse-owned://${STORY_ID}/motion`,
        asset_sha256: "7".repeat(64),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: "output/rights/reviewed-qa-repair.json",
          sha256: "8".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
        attribution_text: null,
      },
    ],
  };
  const rightsLedgerSha256 = hashRightsLedger(rightsLedger);
  const qaReportSha256 = "2".repeat(64);
  const sourceEvidenceSha256 = "1".repeat(64);
  const publicationMetadataSha256 = sha256(metadataBytes);
  const preflightEvidence = {
    schema_version: "pulse-publication-review-evidence-v1",
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    source_evidence_sha256: sourceEvidenceSha256,
    qa_report_sha256: qaReportSha256,
    rights_ledger_sha256: rightsLedgerSha256,
    renderer_manifest_sha256: rendererManifestSha256,
    publication_metadata_sha256: publicationMetadataSha256,
    media_sha256: mediaSha256,
    script_sha256: scriptSha256,
    artifact_evidence: {
      final_mp4_exists: true,
      narration_audio_exists: true,
      word_timestamps_exist: true,
      motion_materialised: true,
      hashes_verified: true,
    },
    renderer_manifest: rendererManifest,
  };
  const finalReview = {
    schema_version: "pulse-final-publication-review-v1",
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    review_manifest_sha256: "b".repeat(64),
    script_sha256: scriptSha256,
    media_sha256: mediaSha256,
    source_evidence: {
      path: path.join(directory, "source-evidence.json"),
      sha256: sourceEvidenceSha256,
    },
    qa_report: {
      path: path.join(directory, "final-render-qa.json"),
      sha256: qaReportSha256,
      verdict: "PASS",
    },
    rights_ledger: {
      path: path.join(directory, "rights-ledger.json"),
      canonical_sha256: rightsLedgerSha256,
    },
    renderer_manifest: {
      path: path.join(directory, "renderer-manifest.json"),
      canonical_sha256: rendererManifestSha256,
      verdict: "PASS",
      publishable_under_human_review: true,
    },
    final_mp4: {
      path: mediaPath,
      sha256: mediaSha256,
    },
    publication_metadata: {
      path: metadataPath,
      sha256: publicationMetadataSha256,
      platform: "youtube_shorts",
    },
    reviewed_by: "user:MORR",
    review_reason: "Exact reviewed QA repair fixture",
    reviewed_at: "2026-07-27T08:45:00.000Z",
  };
  const extra = {
    render_engine: "studio-v21",
    render_review_status: "approved",
    operator_review_status: "script_approved",
    script_sha256: scriptSha256,
    script_approved_sha256: scriptSha256,
    script_approved_by: "user:MORR",
    script_approved_at: "2026-07-27T08:40:00.000Z",
    editorial_lane_id: "what_changes_for_players",
    duration_band_id: "what_changes_short_25_32",
    hook_type: "direct",
    preflight_evidence: preflightEvidence,
    final_publication_review: finalReview,
  };
  db.prepare(
    `INSERT INTO stories
       (id, title, channel_id, approved, auto_approved, full_script,
        exported_path, publish_status, publish_error, youtube_post_id,
        youtube_url, _extra)
     VALUES (?, ?, 'pulse-gaming', 1, 0, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run(
    STORY_ID,
    metadataValue.title,
    SCRIPT,
    mediaPath,
    JSON.stringify(extra),
  );
  const repos = {
    db,
    stories: storiesFactory.bind(db),
    publicationGovernance: governanceFactory.bind(db),
  };
  const evidence = {
    source_evidence_sha256: sourceEvidenceSha256,
    qa_report_sha256: qaReportSha256,
    rights_ledger: rightsLedger,
    rights_ledger_sha256: rightsLedgerSha256,
    originality_transformation: {
      verdict: "STRONG",
      rationale: "Original reporting and designed motion transform the source.",
      evidence_ref: "output/qa/reviewed-qa-repair.json",
      evidence_sha256: "3".repeat(64),
    },
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
    publication_metadata_sha256: publicationMetadataSha256,
    publication_metadata: {
      path: metadataPath,
      sha256: publicationMetadataSha256,
      platform: "youtube_shorts",
      title: metadataValue.title,
      description: metadataValue.description,
    },
    renderer_manifest: rendererManifest,
    renderer_manifest_sha256: rendererManifestSha256,
  };
  const admission = await admitPublication({
    repos,
    storyId: STORY_ID,
    channelId: "pulse-gaming",
    platform: "youtube",
    actorId: "user:MORR",
    reason: "Exact reviewed QA repair fixture admission",
    confirmationStoryId: STORY_ID,
    scheduledFor: "2026-07-27T09:00:00.000Z",
    evidence,
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
    },
    now: new Date("2026-07-27T08:55:00.000Z"),
    channel: {
      id: "pulse-gaming",
      name: "Pulse Gaming",
      youtubeCategory: "20",
    },
  });
  assert.equal(admission.admitted, true);
  db.prepare(
    `INSERT INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision, reason,
        evidence_json, idempotency_key)
     VALUES (?, 'governed_publication_review', 'story', ?,
             'HUMAN_RENDER_APPROVED', ?, ?, ?)`,
  ).run(
    "user:MORR",
    STORY_ID,
    finalReview.review_reason,
    JSON.stringify(finalReview),
    `governed-publication-review:${STORY_ID}:${mediaSha256}:${scriptSha256}`,
  );
  const failedExtra = {
    ...extra,
    qa_failed: true,
    qa_failures: [
      "legacy_unstamped_render_requires_rerender",
      "script_too_short (47 words, min 80)",
    ],
    qa_warnings: ["benign_existing_warning"],
    qa_failed_at: "2026-07-27T09:01:00.000Z",
    publish_error:
      "qa_blocked: legacy_unstamped_render_requires_rerender",
  };
  db.prepare(
    `UPDATE stories
     SET publish_status = 'failed',
         publish_error = 'qa_blocked: legacy_unstamped_render_requires_rerender',
         _extra = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(failedExtra), "2026-07-27T09:01:00.000Z", STORY_ID);
  const scheduled = repos.publicationGovernance.getLatestLifecycleEvent(
    STORY_ID,
    "youtube",
    "SCHEDULED",
  );
  db.close();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    admission,
    databasePath,
    finalReview,
    mediaSha256,
    scheduled,
    scriptSha256,
    verifyBackupEvidenceImpl() {
      return {
        verified: true,
        blockers: [],
        evidence: {
          backup_id: "test-reviewed-qa-repair-backup",
          verified_at: "2026-07-27T09:19:00.000Z",
          source_database_sha256: sha256(
            fs.readFileSync(databasePath),
          ),
        },
      };
    },
  };
}

function repairOptions(fx, overrides = {}) {
  return {
    databasePath: fx.databasePath,
    backupEvidencePath: path.join(
      path.dirname(fx.databasePath),
      "backup-evidence.json",
    ),
    storyId: STORY_ID,
    actorId: "user:MORR",
    reason: "Repair the exact reviewed pre-create QA false positive",
    generatedAt: GENERATED_AT,
    nowImpl: () => new Date(GENERATED_AT),
    expectedSourceCommit: COMMIT_SHA,
    expectedRuntimeCommit: COMMIT_SHA,
    resolveRuntimeBuildInfoImpl: () => ({
      commit_sha: COMMIT_SHA,
      commit_source: "test",
    }),
    isRuntimeTreeCleanImpl: () => true,
    env: { ...SAFE_ENV },
    verifyBackupEvidenceImpl: fx.verifyBackupEvidenceImpl,
    ...overrides,
  };
}

function applyOptions(fx, overrides = {}) {
  const scheduledEvidence = JSON.parse(fx.scheduled.evidence_json);
  return repairOptions(fx, {
    apply: true,
    confirmDatabasePath: fx.databasePath,
    confirmStoryId: STORY_ID,
    confirmScheduledEventId: fx.scheduled.id,
    confirmDispatchIdempotencyKey:
      scheduledEvidence.dispatch_idempotency_key,
    confirmRequestFingerprint:
      scheduledEvidence.request_fingerprint,
    confirmMediaSha256: fx.mediaSha256,
    confirmScriptSha256: fx.scriptSha256,
    confirmReviewManifestSha256:
      fx.finalReview.review_manifest_sha256,
    confirmActorId: "user:MORR",
    confirmReason:
      "Repair the exact reviewed pre-create QA false positive",
    changeWindowId: "test-reviewed-qa-repair-window",
    confirmChangeWindowId: "test-reviewed-qa-repair-window",
    ...overrides,
  });
}

test("reviewed QA repair atomically clears only the proven false positive and cancels the expired pre-create ticket", async (t) => {
  const fx = await fixture(t);
  const common = repairOptions(fx);

  const missingBackupProof = await executeGovernedReviewedQaRepair({
    ...common,
    verifyBackupEvidenceImpl() {
      return {
        verified: false,
        blockers: [],
        evidence: null,
      };
    },
  });
  assert.equal(missingBackupProof.verdict, "HOLD");
  assert.ok(
    missingBackupProof.blockers.includes(
      "valid_backup_evidence_required",
    ),
  );

  const inspection = await executeGovernedReviewedQaRepair(common);
  assert.equal(inspection.mode, "DRY_RUN");
  assert.equal(inspection.verdict, "READY");
  assert.equal(inspection.mutated, false);
  assert.deepEqual(inspection.blockers, []);
  assert.equal(
    inspection.qa_publish_error_persistence_shape,
    "mirrored_exact",
  );
  assert.equal(inspection.safety.create_boundary_entered, false);

  const result = await executeGovernedReviewedQaRepair({
    ...applyOptions(fx),
  });
  assert.equal(result.mode, "APPLY");
  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.mutated, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(
    result.qa_publish_error_persistence_shape,
    "mirrored_exact",
  );

  const db = new Database(fx.databasePath, { readonly: true });
  const row = db.prepare("SELECT * FROM stories WHERE id = ?").get(STORY_ID);
  const extra = JSON.parse(row._extra);
  assert.equal(row.publish_status, null);
  assert.equal(row.publish_error, null);
  assert.equal(extra.qa_failed, false);
  assert.deepEqual(extra.qa_failures, []);
  assert.deepEqual(extra.qa_warnings, ["benign_existing_warning"]);
  assert.equal(extra.qa_failed_at, null);
  assert.equal(extra.publish_error, null);
  assert.equal(
    db
      .prepare(
        `SELECT lifecycle_state
         FROM platform_publication_state
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).lifecycle_state,
    "ADMISSION_CANCELLED_BEFORE_DISPATCH",
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM platform_dispatch_ledger
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).count,
    0,
  );
  db.close();
});

test("reviewed QA repair accepts and applies the production top-level-only QA publish error", async (t) => {
  const fx = await fixture(t);
  const db = new Database(fx.databasePath);
  const row = db.prepare("SELECT _extra FROM stories WHERE id = ?").get(STORY_ID);
  const extra = JSON.parse(row._extra);
  delete extra.publish_error;
  db.prepare("UPDATE stories SET _extra = ? WHERE id = ?").run(
    JSON.stringify(extra),
    STORY_ID,
  );
  db.close();

  const inspection = await executeGovernedReviewedQaRepair(
    repairOptions(fx),
  );
  assert.equal(inspection.mode, "DRY_RUN");
  assert.equal(inspection.verdict, "READY");
  assert.deepEqual(inspection.blockers, []);
  assert.equal(inspection.mutated, false);
  assert.equal(
    inspection.qa_publish_error_persistence_shape,
    "top_level_only",
  );

  const result = await executeGovernedReviewedQaRepair(
    applyOptions(fx),
  );
  assert.equal(result.mode, "APPLY");
  assert.equal(result.verdict, "APPLIED");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.mutated, true);
  assert.equal(
    result.qa_publish_error_persistence_shape,
    "top_level_only",
  );
  assert.equal(result.safety.platform_calls_performed, false);
  assert.equal(result.safety.oauth_or_tokens_mutated, false);
  assert.equal(result.safety.secondary_platforms_contacted, false);

  const verified = new Database(fx.databasePath, { readonly: true });
  const repaired = verified
    .prepare(
      "SELECT publish_status, publish_error, _extra FROM stories WHERE id = ?",
    )
    .get(STORY_ID);
  assert.equal(repaired.publish_status, null);
  assert.equal(repaired.publish_error, null);
  assert.equal(JSON.parse(repaired._extra).publish_error, null);
  assert.equal(
    verified
      .prepare(
        `SELECT COUNT(*) AS count FROM platform_dispatch_ledger
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).count,
    0,
  );
  assert.equal(
    verified
      .prepare(
        `SELECT COUNT(*) AS count FROM platform_posts
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).count,
    0,
  );
  const decisionEvidence = JSON.parse(
    verified
      .prepare(
        `SELECT evidence_json FROM operator_audit_log
         WHERE action = 'repair_governed_reviewed_qa_refusal'
           AND target_id = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(`${STORY_ID}:youtube`).evidence_json,
  );
  assert.equal(
    decisionEvidence.qa_publish_error_persistence_shape,
    "top_level_only",
  );
  verified.close();
});

test("reviewed QA repair fails closed on a mismatched mirrored publish error without any platform or OAuth action", async (t) => {
  const fx = await fixture(t);
  const db = new Database(fx.databasePath);
  const row = db.prepare("SELECT _extra FROM stories WHERE id = ?").get(STORY_ID);
  const extra = JSON.parse(row._extra);
  extra.publish_error = "qa_blocked: different_failure";
  db.prepare("UPDATE stories SET _extra = ? WHERE id = ?").run(
    JSON.stringify(extra),
    STORY_ID,
  );
  db.close();

  const result = await executeGovernedReviewedQaRepair(
    applyOptions(fx),
  );
  assert.equal(result.mode, "APPLY");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(
    result.blockers.includes("exact_qa_publish_error_required"),
  );
  assert.equal(result.safety.platform_calls_performed, false);
  assert.equal(result.safety.oauth_or_tokens_mutated, false);
  assert.equal(result.safety.secondary_platforms_contacted, false);

  const verified = new Database(fx.databasePath, { readonly: true });
  const unchanged = verified
    .prepare(
      "SELECT publish_status, publish_error, _extra FROM stories WHERE id = ?",
    )
    .get(STORY_ID);
  assert.equal(unchanged.publish_status, "failed");
  assert.equal(
    unchanged.publish_error,
    "qa_blocked: legacy_unstamped_render_requires_rerender",
  );
  assert.equal(
    JSON.parse(unchanged._extra).publish_error,
    "qa_blocked: different_failure",
  );
  assert.equal(
    verified
      .prepare(
        `SELECT lifecycle_state
         FROM platform_publication_state
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).lifecycle_state,
    "SCHEDULED",
  );
  assert.equal(
    verified
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'repair_governed_reviewed_qa_refusal'
           AND target_id = ?`,
      )
      .get(`${STORY_ID}:youtube`).count,
    0,
  );
  assert.equal(
    verified
      .prepare(
        `SELECT COUNT(*) AS count FROM platform_dispatch_ledger
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).count,
    0,
  );
  assert.equal(
    verified
      .prepare(
        `SELECT COUNT(*) AS count FROM platform_posts
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).count,
    0,
  );
  verified.close();
});

test("reviewed QA repair rejects null and arbitrary persisted publish-error values", async (t) => {
  const cases = [
    {
      name: "null top-level value",
      topLevel: null,
      extra: "qa_blocked: legacy_unstamped_render_requires_rerender",
    },
    {
      name: "arbitrary top-level value",
      topLevel: "qa_blocked: different_failure",
      extra: "qa_blocked: legacy_unstamped_render_requires_rerender",
    },
    {
      name: "explicit null mirrored value",
      topLevel:
        "qa_blocked: legacy_unstamped_render_requires_rerender",
      extra: null,
    },
  ];

  for (const current of cases) {
    await t.test(current.name, async (subtest) => {
      const fx = await fixture(subtest);
      const db = new Database(fx.databasePath);
      const row = db
        .prepare("SELECT _extra FROM stories WHERE id = ?")
        .get(STORY_ID);
      const extra = JSON.parse(row._extra);
      extra.publish_error = current.extra;
      db.prepare(
        "UPDATE stories SET publish_error = ?, _extra = ? WHERE id = ?",
      ).run(current.topLevel, JSON.stringify(extra), STORY_ID);
      db.close();

      const result = await executeGovernedReviewedQaRepair(
        repairOptions(fx),
      );
      assert.equal(result.verdict, "HOLD");
      assert.equal(result.mutated, false);
      assert.ok(
        result.blockers.includes("exact_qa_publish_error_required"),
      );
      assert.equal(result.safety.platform_calls_performed, false);
      assert.equal(result.safety.oauth_or_tokens_mutated, false);
    });
  }
});

test("reviewed QA repair rejects a caller-controlled future clock", async (t) => {
  const fx = await fixture(t);
  const result = await executeGovernedReviewedQaRepair(
    repairOptions(fx, {
      generatedAt: "2026-07-28T09:20:00.000Z",
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes(
      "reviewed_qa_repair_generated_at_not_current",
    ),
  );
  assert.equal(result.mutated, false);
});

test("reviewed QA repair uses trusted current time, not reporting time, for admission expiry", async (t) => {
  const fx = await fixture(t);
  const result = await executeGovernedReviewedQaRepair(
    repairOptions(fx, {
      generatedAt: "2026-07-27T09:15:01.000Z",
      nowImpl: () => new Date("2026-07-27T09:10:01.000Z"),
    }),
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(
    result.blockers.includes("scheduled_admission_not_expired"),
  );
});

test("reviewed QA repair requires an exact clean runtime commit", async (t) => {
  const fx = await fixture(t);
  const mismatch = await executeGovernedReviewedQaRepair(
    repairOptions(fx, {
      expectedRuntimeCommit: "d".repeat(40),
    }),
  );
  assert.equal(mismatch.verdict, "HOLD");
  assert.ok(mismatch.blockers.includes("runtime_commit_mismatch"));

  const dirty = await executeGovernedReviewedQaRepair(
    repairOptions(fx, {
      isRuntimeTreeCleanImpl: () => false,
    }),
  );
  assert.equal(dirty.verdict, "HOLD");
  assert.ok(dirty.blockers.includes("runtime_worktree_must_be_clean"));
});

test("reviewed QA repair enforces both backup mutation boundaries", async (t) => {
  const preOpen = await fixture(t);
  let preOpenCalls = 0;
  const preOpenResult = await executeGovernedReviewedQaRepair(
    applyOptions(preOpen, {
      sqliteMutationBoundaryBlockersImpl() {
        preOpenCalls += 1;
        return ["source_database_sha256_changed_before_apply"];
      },
    }),
  );
  assert.equal(preOpenCalls, 1);
  assert.equal(preOpenResult.verdict, "HOLD");
  assert.equal(preOpenResult.safety.create_boundary_entered, null);
  assert.equal(preOpenResult.safety.external_object_created, null);
  assert.ok(
    preOpenResult.blockers.includes(
      "source_database_sha256_changed_before_apply",
    ),
  );

  const inTransaction = await fixture(t);
  let transactionCalls = 0;
  const transactionResult = await executeGovernedReviewedQaRepair(
    applyOptions(inTransaction, {
      sqliteMutationBoundaryBlockersImpl() {
        transactionCalls += 1;
        return transactionCalls === 2
          ? ["source_database_sha256_changed_before_apply"]
          : [];
      },
    }),
  );
  assert.equal(transactionCalls, 2);
  assert.equal(transactionResult.verdict, "ROLLED_BACK");
  assert.equal(
    transactionResult.safety.create_boundary_entered,
    null,
  );
  const db = new Database(inTransaction.databasePath, {
    readonly: true,
  });
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) FROM operator_audit_log
         WHERE action = 'repair_governed_reviewed_qa_refusal'`,
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) FROM publication_lifecycle_events
         WHERE to_state = 'ADMISSION_CANCELLED_BEFORE_DISPATCH'`,
      )
      .pluck()
      .get(),
    0,
  );
  db.close();
});

test("reviewed QA repair rechecks stopped runtime inside the immediate transaction", async (t) => {
  const fx = await fixture(t);
  let calls = 0;
  const result = await executeGovernedReviewedQaRepair(
    applyOptions(fx, {
      sqliteMutationBoundaryBlockersImpl() {
        calls += 1;
        if (calls === 1) {
          const writer = new Database(fx.databasePath);
          writer
            .prepare(
              `INSERT INTO workers (id, display_name, status)
               VALUES ('race-worker', 'Race worker', 'busy')`,
            )
            .run();
          writer.close();
        }
        return [];
      },
    }),
  );

  assert.equal(result.verdict, "ROLLED_BACK");
  assert.ok(
    result.blockers.includes(
      "stopped_runtime_database_state_required",
    ),
  );
  const db = new Database(fx.databasePath, { readonly: true });
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) FROM operator_audit_log
         WHERE action = 'repair_governed_reviewed_qa_refusal'`,
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    db
      .prepare(
        `SELECT lifecycle_state FROM platform_publication_state
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .pluck()
      .get(STORY_ID),
    "SCHEDULED",
  );
  db.close();
});

test("reviewed QA repair rolls back the audit and cancellation if story clearing fails", async (t) => {
  const fx = await fixture(t);
  const setup = new Database(fx.databasePath);
  setup.exec(
    `CREATE TRIGGER abort_reviewed_qa_repair_update
     BEFORE UPDATE ON stories
     WHEN NEW.publish_status IS NULL
     BEGIN
       SELECT RAISE(ABORT, 'fixture_story_update_abort');
     END;`,
  );
  setup.close();

  const result = await executeGovernedReviewedQaRepair(
    applyOptions(fx),
  );
  assert.equal(result.verdict, "ROLLED_BACK");

  const db = new Database(fx.databasePath, { readonly: true });
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) FROM operator_audit_log
         WHERE action = 'repair_governed_reviewed_qa_refusal'`,
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) FROM publication_lifecycle_events
         WHERE to_state = 'ADMISSION_CANCELLED_BEFORE_DISPATCH'`,
      )
      .pluck()
      .get(),
    0,
  );
  const story = db
    .prepare(
      "SELECT publish_status, publish_error, _extra FROM stories WHERE id = ?",
    )
    .get(STORY_ID);
  assert.equal(story.publish_status, "failed");
  assert.equal(
    story.publish_error,
    "qa_blocked: legacy_unstamped_render_requires_rerender",
  );
  assert.equal(JSON.parse(story._extra).qa_failed, true);
  db.close();
});

test("reviewed QA repair accepts the real verified backup contract", async (t) => {
  const fx = await fixture(t);
  const directory = path.dirname(fx.databasePath);
  const backupPath = path.join(directory, "pulse-backup.db");
  const evidencePath = path.join(directory, "backup-evidence.json");
  fs.copyFileSync(fx.databasePath, backupPath);
  const evidence = {
    schema_version: "pulse-cutover-backup-evidence-v1",
    backup_id: "reviewed-qa-repair-real-backup",
    verified_by: "test:backup-verifier",
    backup_path: backupPath,
    backup_sha256: sha256(fs.readFileSync(backupPath)),
    source_database_path: fx.databasePath,
    source_database_sha256: sha256(
      fs.readFileSync(fx.databasePath),
    ),
    verified_at: GENERATED_AT,
    restore_test_status: "PASS",
    integrity_check: "ok",
    foreign_key_check: "ok",
  };
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );

  const result = await executeGovernedReviewedQaRepair(
    repairOptions(fx, {
      backupEvidencePath: evidencePath,
      verifyBackupEvidenceImpl: undefined,
    }),
  );
  assert.equal(result.verdict, "READY");
  assert.equal(
    result.backup.source_database_sha256,
    evidence.source_database_sha256,
  );

  const writer = new Database(fx.databasePath);
  writer
    .prepare("UPDATE channels SET name = ? WHERE id = ?")
    .run("Pulse Gaming changed after backup", "pulse-gaming");
  writer.close();
  const staleBackupResult = await executeGovernedReviewedQaRepair(
    applyOptions(fx, {
      backupEvidencePath: evidencePath,
      verifyBackupEvidenceImpl: undefined,
    }),
  );
  assert.equal(staleBackupResult.verdict, "HOLD");
  assert.ok(
    staleBackupResult.blockers.includes(
      "source_database_sha256_mismatch",
    ),
  );
  const check = new Database(fx.databasePath, { readonly: true });
  assert.equal(
    check
      .prepare(
        `SELECT COUNT(*) FROM operator_audit_log
         WHERE action = 'repair_governed_reviewed_qa_refusal'`,
      )
      .pluck()
      .get(),
    0,
  );
  check.close();
});
