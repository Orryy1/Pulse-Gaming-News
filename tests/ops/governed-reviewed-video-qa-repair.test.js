"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  executeGovernedReviewedVideoQaRepair,
} = require("../../lib/ops/governed-reviewed-video-qa-repair");
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
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const governanceFactory = require("../../lib/repositories/publication_governance");
const storiesFactory = require("../../lib/repositories/stories");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const STORY_ID = "official_reviewed_video_qa_repair";
const SCRIPT =
  "Final Fantasy XIV just revealed a tank that fights with two giant shields. Bastion arrives in Evercold and only works in Evolved Mode. The expansion makes its story less linear, auto-scales content and adds a Final Fantasy VII raid. The MMO hits Switch 2 on August fourth.";
const GENERATED_AT = "2026-07-27T10:20:00.000Z";
const COMMIT_SHA = "d".repeat(40);
const EXPECTED_FAILURE = "duration_too_short (25.00s)";
const EXPECTED_PUBLISH_ERROR = `qa_blocked: ${EXPECTED_FAILURE}`;
const YOUTUBE_OAUTH_CLIENT_SHA256 = "7".repeat(64);
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

function officialSourceBinding(sourceEvidenceSha256) {
  const claimText =
    "The exact official source confirms this release.";
  const claim = {
    claim_key: "release_claim",
    text: claimText,
    claim_text_sha256: sha256(claimText),
  };
  return buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256,
    sourceEvidence: {
      schema_version: "pulse-source-evidence-v1",
      story_id: STORY_ID,
      source_type: "official",
      source_url:
        "https://publisher.example/news/release",
      claims: [claim],
      official_source_snapshot: {
        schema_version:
          "pulse-official-source-snapshot-v1",
        source_url:
          "https://publisher.example/news/release",
        source_id: "publisher-release",
        source_class: "OFFICIAL_FIRST_PARTY",
        canonical_body_algorithm:
          "pulse-readable-body-v1",
        canonical_body_sha256: "9".repeat(64),
        claims: [claim],
      },
    },
  });
}

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-reviewed-video-qa-repair-"),
  );
  const databasePath = path.join(directory, "pulse.db");
  const mediaPath = path.join(directory, "reviewed-final.mp4");
  const mediaBytes = Buffer.alloc(220 * 1024, 0x35);
  fs.writeFileSync(mediaPath, mediaBytes);
  const metadataPath = path.join(directory, "publication-metadata.json");
  const metadataValue = {
    schema_version: "pulse-governed-publication-metadata-v1",
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    platform: "youtube_shorts",
    title: "Final Fantasy XIV's New Tank Uses TWO Giant Shields",
    description:
      "A fast player-first breakdown.\n\nFootage: © SQUARE ENIX",
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
      first_frame_text: "A TANK WITH TWO SHIELDS",
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
          reference: "output/rights/reviewed-video-qa-repair.json",
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
  const sourceReleaseBinding = officialSourceBinding(
    sourceEvidenceSha256,
  );
  const publicationMetadataSha256 = sha256(metadataBytes);
  const preflightEvidence = {
    schema_version: "pulse-publication-review-evidence-v1",
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    source_evidence_sha256: sourceEvidenceSha256,
    official_source_release_binding:
      sourceReleaseBinding,
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
    review_reason: "Exact reviewed video-QA repair fixture",
    reviewed_at: "2026-07-27T08:45:00.000Z",
  };
  if (typeof options.mutateFinalReview === "function") {
    options.mutateFinalReview(finalReview);
  }
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
    official_source_release_binding:
      sourceReleaseBinding,
    qa_report_sha256: qaReportSha256,
    rights_ledger: rightsLedger,
    rights_ledger_sha256: rightsLedgerSha256,
    originality_transformation: {
      verdict: "STRONG",
      rationale:
        "Original reporting and designed motion transform the source.",
      evidence_ref: "output/qa/reviewed-video-qa-repair.json",
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
    reason: "Exact reviewed video-QA repair fixture admission",
    confirmationStoryId: STORY_ID,
    scheduledFor: "2026-07-27T10:00:00.000Z",
    evidence,
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
        YOUTUBE_OAUTH_CLIENT_SHA256,
    },
    now: new Date("2026-07-27T09:55:00.000Z"),
    outsideCadenceAuthorisation: {
      authorisationId: "test-video-qa-one-shot",
      confirmAuthorisationId: "test-video-qa-one-shot",
      oneShotConfirmed: true,
    },
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
    qa_failures: [EXPECTED_FAILURE],
    qa_warnings: ["benign_existing_warning"],
    qa_failed_at: "2026-07-27T10:01:00.000Z",
  };
  db.prepare(
    `UPDATE stories
     SET publish_status = 'failed',
         publish_error = ?,
         _extra = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    EXPECTED_PUBLISH_ERROR,
    JSON.stringify(failedExtra),
    "2026-07-27T10:01:00.000Z",
    STORY_ID,
  );
  const scheduled = repos.publicationGovernance.getLatestLifecycleEvent(
    STORY_ID,
    "youtube",
    "SCHEDULED",
  );
  const scheduledEvidence = JSON.parse(scheduled.evidence_json);
  const guardedDispatchResultPath = path.join(
    directory,
    "guarded-youtube-window-dispatch.json",
  );
  const guardedDispatchResult = {
    schema_version: "pulse-guarded-youtube-window-result-v1",
    generated_at: "2026-07-27T10:00:42.000Z",
    action: "dispatch",
    verdict: "HOLD",
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    platform: "youtube",
    scheduled_for: scheduledEvidence.scheduled_for,
    media_sha256: mediaSha256,
    script_sha256: scriptSha256,
    request_fingerprint: scheduledEvidence.request_fingerprint,
    renderer_manifest_sha256: rendererManifestSha256,
    source_evidence_sha256: sourceEvidenceSha256,
    dispatch_idempotency_key:
      scheduledEvidence.dispatch_idempotency_key,
    outside_cadence_authorisation_id:
      scheduledEvidence.outside_cadence_authorisation.authorisation_id,
    review_manifest_sha256: finalReview.review_manifest_sha256,
    change_window_id: "test-original-guarded-dispatch-window",
    mutated: true,
    blockers: [
      "published_state_confirmation_required",
      "publisher_did_not_confirm_new_upload",
    ],
    retry_attempted: false,
    safety: {
      database_mutated: true,
      platforms_contacted: true,
      oauth_or_tokens_mutated: false,
      durable_oauth_or_token_mutated: false,
      ephemeral_youtube_access_token_refresh: {
        attempted: false,
        succeeded: false,
        failed: false,
      },
      uploader_override_used: false,
      automatic_retry_performed: false,
    },
    scheduled_candidate: {
      story_id: STORY_ID,
      platform: "youtube",
      lifecycle_state: "SCHEDULED",
      scheduled_event_id: scheduled.id,
      evidence: scheduledEvidence,
    },
    selection_binding: {
      bound: true,
      method: "unique_fresh_scheduled_candidate_in_exact_sqlite",
      story_id: STORY_ID,
      scheduled_event_id: scheduled.id,
    },
    publisher_result: {
      no_safe_candidate: true,
      qa_skipped_count: 1,
      qa_skipped: [
        {
          id: STORY_ID,
          title: metadataValue.title,
          reason: EXPECTED_FAILURE,
          source: "video",
          failures: [EXPECTED_FAILURE],
        },
      ],
      top_reason: `video_qa: ${EXPECTED_FAILURE}`,
      candidates_tried: 1,
    },
    publisher_threw: false,
    publication: null,
  };
  fs.writeFileSync(
    guardedDispatchResultPath,
    `${JSON.stringify(guardedDispatchResult, null, 2)}\n`,
  );
  const guardedDispatchResultSha256 = sha256(
    fs.readFileSync(guardedDispatchResultPath),
  );
  db.close();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    databasePath,
    finalReview,
    guardedDispatchResultPath,
    guardedDispatchResultSha256,
    mediaSha256,
    publicationMetadataSha256,
    rendererManifestSha256,
    rightsLedgerSha256,
    scheduled,
    scriptSha256,
    sourceEvidenceSha256,
    verifyBackupEvidenceImpl() {
      return {
        verified: true,
        blockers: [],
        evidence: {
          backup_id: "test-reviewed-video-qa-repair-backup",
          verified_at: "2026-07-27T10:19:00.000Z",
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
    guardedDispatchResultPath: fx.guardedDispatchResultPath,
    storyId: STORY_ID,
    actorId: "user:MORR",
    reason: "Repair the exact reviewed pre-create video-QA false positive",
    generatedAt: GENERATED_AT,
    nowImpl: () => new Date(GENERATED_AT),
    expectedSourceCommit: COMMIT_SHA,
    expectedRuntimeCommit: COMMIT_SHA,
    resolveRuntimeBuildInfoImpl: () => ({
      commit_sha: COMMIT_SHA,
      commit_source: "test",
    }),
    isRuntimeTreeCleanImpl: () => true,
    runVideoQaImpl: async () => ({
      result: "fail",
      failures: [EXPECTED_FAILURE],
      warnings: [],
    }),
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
    confirmRendererManifestSha256: fx.rendererManifestSha256,
    confirmSourceEvidenceSha256: fx.sourceEvidenceSha256,
    confirmGuardedDispatchResultSha256:
      fx.guardedDispatchResultSha256,
    confirmRightsLedgerSha256: fx.rightsLedgerSha256,
    confirmPublicationMetadataSha256:
      fx.publicationMetadataSha256,
    confirmActorId: "user:MORR",
    confirmReason:
      "Repair the exact reviewed pre-create video-QA false positive",
    changeWindowId: "test-reviewed-video-qa-repair-window",
    confirmChangeWindowId: "test-reviewed-video-qa-repair-window",
    ...overrides,
  });
}

function mutateGuardedDispatchResult(fx, mutate) {
  const value = JSON.parse(
    fs.readFileSync(fx.guardedDispatchResultPath, "utf8"),
  );
  mutate(value);
  fs.writeFileSync(
    fx.guardedDispatchResultPath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
  return sha256(fs.readFileSync(fx.guardedDispatchResultPath));
}

test("governed reviewed video-QA repair exposes a dedicated repair interface", () => {
  assert.equal(typeof executeGovernedReviewedVideoQaRepair, "function");
});

test("exact reviewed 25-second video-QA refusal is dry-run READY then atomically cancelled and cleared", async (t) => {
  const fx = await fixture(t);
  const inspection = await executeGovernedReviewedVideoQaRepair(
    repairOptions(fx),
  );
  assert.equal(inspection.mode, "DRY_RUN");
  assert.equal(inspection.verdict, "READY");
  assert.equal(inspection.mutated, false);
  assert.deepEqual(inspection.blockers, []);
  assert.deepEqual(inspection.qa_failures_resolved, [
    EXPECTED_FAILURE,
  ]);
  assert.equal(
    inspection.renderer_manifest_sha256,
    fx.rendererManifestSha256,
  );
  assert.equal(
    inspection.source_evidence_sha256,
    fx.sourceEvidenceSha256,
  );
  assert.equal(
    inspection.guarded_dispatch_result_sha256,
    fx.guardedDispatchResultSha256,
  );
  assert.equal(
    inspection.rights_ledger_sha256,
    fx.rightsLedgerSha256,
  );
  assert.equal(
    inspection.publication_metadata_sha256,
    fx.publicationMetadataSha256,
  );
  assert.equal(
    inspection.guarded_dispatch_change_window_id,
    "test-original-guarded-dispatch-window",
  );
  assert.equal(
    inspection.outside_cadence_authorisation_id,
    "test-video-qa-one-shot",
  );
  assert.equal(inspection.safety.create_boundary_entered, false);
  assert.equal(inspection.safety.auth_boundary_entered, false);

  const result = await executeGovernedReviewedVideoQaRepair(
    applyOptions(fx),
  );
  assert.equal(result.mode, "APPLY");
  assert.equal(
    result.verdict,
    "APPLIED",
    JSON.stringify(result, null, 2),
  );
  assert.equal(result.mutated, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.safety.platform_calls_performed, false);
  assert.equal(result.safety.oauth_or_tokens_mutated, false);

  const db = new Database(fx.databasePath, { readonly: true });
  const row = db
    .prepare("SELECT * FROM stories WHERE id = ?")
    .get(STORY_ID);
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
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM platform_posts
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).count,
    0,
  );
  const audit = db
    .prepare(
      `SELECT evidence_json FROM operator_audit_log
       WHERE action = 'repair_governed_reviewed_video_qa_refusal'
       ORDER BY id DESC LIMIT 1`,
    )
    .get();
  assert.ok(audit);
  const auditEvidence = JSON.parse(audit.evidence_json);
  assert.equal(
    auditEvidence.guarded_dispatch_result_sha256,
    fx.guardedDispatchResultSha256,
  );
  assert.equal(
    auditEvidence.guarded_dispatch_change_window_id,
    "test-original-guarded-dispatch-window",
  );
  assert.equal(
    auditEvidence.rights_ledger_sha256,
    fx.rightsLedgerSha256,
  );
  assert.equal(auditEvidence.auth_boundary_entered, false);
  db.close();
});

test("video-QA repair refuses any guarded dispatch proof showing OAuth activity", async (t) => {
  const cases = [
    ["refresh attempted", (s) => (s.ephemeral_youtube_access_token_refresh.attempted = true)],
    ["refresh succeeded", (s) => (s.ephemeral_youtube_access_token_refresh.succeeded = true)],
    ["refresh failed", (s) => (s.ephemeral_youtube_access_token_refresh.failed = true)],
    ["durable mutation", (s) => (s.durable_oauth_or_token_mutated = true)],
    ["OAuth mutation", (s) => (s.oauth_or_tokens_mutated = true)],
    ["uploader override", (s) => (s.uploader_override_used = true)],
    ["automatic retry", (s) => (s.automatic_retry_performed = true)],
  ];
  for (const [name, mutateSafety] of cases) {
    const fx = await fixture(t);
    const changedSha256 = mutateGuardedDispatchResult(fx, (value) => {
      mutateSafety(value.safety);
    });
    const result = await executeGovernedReviewedVideoQaRepair(
      applyOptions(fx, {
        confirmGuardedDispatchResultSha256: changedSha256,
      }),
    );
    assert.equal(result.mode, "APPLY", name);
    assert.equal(result.verdict, "HOLD", name);
    assert.equal(result.mutated, false, name);
    assert.ok(
      result.blockers.includes(
        "zero_uploader_and_auth_telemetry_required",
      ),
      name,
    );
    const db = new Database(fx.databasePath, { readonly: true });
    assert.equal(
      db
        .prepare(
          `SELECT lifecycle_state FROM platform_publication_state
           WHERE story_id = ? AND platform = 'youtube'`,
        )
        .get(STORY_ID).lifecycle_state,
      "SCHEDULED",
      name,
    );
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM operator_audit_log
           WHERE action = 'repair_governed_reviewed_video_qa_refusal'`,
        )
        .get().count,
      0,
      name,
    );
    db.close();
  }
});

test("video-QA repair requires the exact guarded event and single publisher duration refusal", async (t) => {
  const cases = [
    {
      name: "scheduled event",
      mutate(value) {
        value.scheduled_candidate.scheduled_event_id += 1;
      },
      blocker: "guarded_dispatch_event_mismatch",
    },
    {
      name: "single refusal",
      mutate(value) {
        value.publisher_result.qa_skipped_count = 2;
      },
      blocker: "exact_pre_create_video_qa_refusal_proof_required",
    },
    {
      name: "no publication object",
      mutate(value) {
        value.publication = {
          external_id: "unexpected",
          external_url: "https://youtube.example/unexpected",
        };
      },
      blocker: "exact_pre_create_video_qa_refusal_proof_required",
    },
    {
      name: "non-throwing publisher",
      mutate(value) {
        value.publisher_threw = true;
      },
      blocker: "exact_pre_create_video_qa_refusal_proof_required",
    },
    {
      name: "bound selection",
      mutate(value) {
        value.selection_binding.bound = false;
      },
      blocker: "exact_pre_create_video_qa_refusal_proof_required",
    },
    {
      name: "selection method",
      mutate(value) {
        value.selection_binding.method = "caller_selected_story";
      },
      blocker: "guarded_dispatch_selection_method_mismatch",
    },
    {
      name: "selection story",
      mutate(value) {
        value.selection_binding.story_id = "another-story";
      },
      blocker: "guarded_dispatch_selection_story_mismatch",
    },
    {
      name: "scheduled candidate state",
      mutate(value) {
        value.scheduled_candidate.lifecycle_state = "DISPATCHING";
      },
      blocker: "guarded_dispatch_candidate_state_mismatch",
    },
    {
      name: "scheduled candidate evidence",
      mutate(value) {
        value.scheduled_candidate.evidence.request_fingerprint =
          "0".repeat(64);
      },
      blocker: "guarded_dispatch_scheduled_evidence_mismatch",
    },
    {
      name: "outside-cadence authority",
      mutate(value) {
        value.outside_cadence_authorisation_id =
          "another-authorisation";
      },
      blocker: "guarded_dispatch_outside_cadence_id_mismatch",
    },
    {
      name: "original guarded change window",
      mutate(value) {
        value.change_window_id = "";
      },
      blocker:
        "exact_guarded_change_window_and_outside_cadence_authority_required",
    },
  ];
  for (const current of cases) {
    const fx = await fixture(t);
    mutateGuardedDispatchResult(fx, current.mutate);
    const result = await executeGovernedReviewedVideoQaRepair(
      repairOptions(fx),
    );
    assert.equal(result.verdict, "HOLD", current.name);
    assert.equal(result.mutated, false, current.name);
    assert.ok(result.blockers.includes(current.blocker), current.name);
  }
});

test("video-QA repair refuses DB evidence of dispatch, platform post or external identity", async (t) => {
  const cases = [
    {
      name: "dispatch ledger",
      mutate(db) {
        db.prepare(
          `INSERT INTO platform_dispatch_ledger
             (story_id, platform, idempotency_key, event_type)
           VALUES (?, 'youtube', ?, 'DISPATCH_STARTED')`,
        ).run(STORY_ID, `youtube:${STORY_ID}:unexpected-dispatch`);
      },
      blocker: "uploader_boundary_not_clear",
    },
    {
      name: "platform post",
      mutate(db) {
        db.prepare(
          `INSERT INTO platform_posts
             (story_id, channel_id, platform, status, external_id,
              external_url)
           VALUES (?, 'pulse-gaming', 'youtube', 'failed', ?, ?)`,
        ).run(
          STORY_ID,
          "unexpected-post",
          "https://youtube.example/unexpected-post",
        );
      },
      blocker: "external_object_not_clear",
    },
    {
      name: "publication state external identity",
      mutate(db) {
        db.prepare(
          `UPDATE platform_publication_state
           SET external_id = ?, external_url = ?
           WHERE story_id = ? AND platform = 'youtube'`,
        ).run(
          "unexpected-state",
          "https://youtube.example/unexpected-state",
          STORY_ID,
        );
      },
      blocker: "external_object_not_clear",
    },
  ];
  for (const current of cases) {
    const fx = await fixture(t);
    const db = new Database(fx.databasePath);
    current.mutate(db);
    db.close();
    const result = await executeGovernedReviewedVideoQaRepair(
      applyOptions(fx),
    );
    assert.equal(result.verdict, "HOLD", current.name);
    assert.equal(result.mutated, false, current.name);
    assert.ok(result.blockers.includes(current.blocker), current.name);
  }
});

test("video-QA repair requires a fresh verified backup and every exact hash confirmation", async (t) => {
  const fx = await fixture(t);
  const noBackup = await executeGovernedReviewedVideoQaRepair(
    repairOptions(fx, {
      verifyBackupEvidenceImpl() {
        return {
          verified: false,
          blockers: ["backup_evidence_too_old"],
          evidence: null,
        };
      },
    }),
  );
  assert.equal(noBackup.verdict, "HOLD");
  assert.ok(noBackup.blockers.includes("backup_evidence_too_old"));

  const mismatches = [
    [
      "confirmRendererManifestSha256",
      "exact_renderer_manifest_sha256_confirmation_required",
    ],
    [
      "confirmSourceEvidenceSha256",
      "exact_source_evidence_sha256_confirmation_required",
    ],
    [
      "confirmGuardedDispatchResultSha256",
      "exact_guarded_dispatch_result_sha256_confirmation_required",
    ],
    [
      "confirmRightsLedgerSha256",
      "exact_rights_ledger_sha256_confirmation_required",
    ],
    [
      "confirmPublicationMetadataSha256",
      "exact_publication_metadata_sha256_confirmation_required",
    ],
    [
      "confirmReviewManifestSha256",
      "exact_review_manifest_sha256_confirmation_required",
    ],
    [
      "confirmMediaSha256",
      "exact_media_sha256_confirmation_required",
    ],
    [
      "confirmScriptSha256",
      "exact_script_sha256_confirmation_required",
    ],
    [
      "confirmRequestFingerprint",
      "exact_request_fingerprint_confirmation_required",
    ],
  ];
  for (const [field, blocker] of mismatches) {
    const result = await executeGovernedReviewedVideoQaRepair(
      applyOptions(fx, { [field]: "0".repeat(64) }),
    );
    assert.equal(result.verdict, "HOLD", field);
    assert.equal(result.mutated, false, field);
    assert.ok(result.blockers.includes(blocker), field);
  }
});

test("video-QA repair refuses any extra current or persisted video failure", async (t) => {
  const currentFx = await fixture(t);
  const current = await executeGovernedReviewedVideoQaRepair(
    repairOptions(currentFx, {
      runVideoQaImpl: async () => ({
        result: "fail",
        failures: [
          EXPECTED_FAILURE,
          "black_segment_too_long (2.50s @ 0.00s)",
        ],
        warnings: [],
      }),
    }),
  );
  assert.equal(current.verdict, "HOLD");
  assert.ok(
    current.blockers.includes(
      "exact_current_and_persisted_video_qa_failure_required",
    ),
  );
  assert.ok(current.blockers.includes("reviewed_video_qa_not_clean"));

  const persistedFx = await fixture(t);
  const db = new Database(persistedFx.databasePath);
  const row = db.prepare("SELECT _extra FROM stories WHERE id = ?").get(
    STORY_ID,
  );
  const extra = JSON.parse(row._extra);
  extra.qa_failures.push("black_segment_too_long (2.50s @ 0.00s)");
  db.prepare("UPDATE stories SET _extra = ? WHERE id = ?").run(
    JSON.stringify(extra),
    STORY_ID,
  );
  db.close();
  const persisted = await executeGovernedReviewedVideoQaRepair(
    repairOptions(persistedFx),
  );
  assert.equal(persisted.verdict, "HOLD");
  assert.ok(
    persisted.blockers.includes("exact_persisted_video_qa_failure_required"),
  );
});

test("video-QA repair refuses a contradictory pass result carrying the duration failure", async (t) => {
  const fx = await fixture(t);
  const result = await executeGovernedReviewedVideoQaRepair(
    repairOptions(fx, {
      runVideoQaImpl: async () => ({
        result: "pass",
        failures: [EXPECTED_FAILURE],
        warnings: [],
      }),
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(
    result.blockers.includes(
      "coherent_reviewed_video_qa_states_required",
    ),
  );
});

test("video-QA repair cross-binds final-review rights and publication metadata to scheduled evidence", async (t) => {
  const rightsFx = await fixture(t, {
    mutateFinalReview(review) {
      review.rights_ledger.canonical_sha256 = "a".repeat(64);
    },
  });
  const rights = await executeGovernedReviewedVideoQaRepair(
    repairOptions(rightsFx),
  );
  assert.equal(rights.verdict, "HOLD");
  assert.ok(
    rights.blockers.includes("reviewed_rights_ledger_hash_mismatch"),
  );

  const metadataFx = await fixture(t, {
    mutateFinalReview(review) {
      review.publication_metadata.sha256 = "a".repeat(64);
    },
  });
  const metadata = await executeGovernedReviewedVideoQaRepair(
    repairOptions(metadataFx),
  );
  assert.equal(metadata.verdict, "HOLD");
  assert.ok(
    metadata.blockers.includes(
      "reviewed_publication_metadata_hash_mismatch",
    ),
  );

  const reviewFx = await fixture(t, {
    mutateFinalReview(review) {
      review.review_manifest_sha256 = "not-a-sha256";
    },
  });
  const review = await executeGovernedReviewedVideoQaRepair(
    repairOptions(reviewFx),
  );
  assert.equal(review.verdict, "HOLD");
  assert.ok(
    review.blockers.includes("exact_review_manifest_sha256_required"),
  );
});

test("video-QA repair requires a new repair change window distinct from the guarded dispatch", async (t) => {
  const fx = await fixture(t);
  const result = await executeGovernedReviewedVideoQaRepair(
    applyOptions(fx, {
      changeWindowId: "test-original-guarded-dispatch-window",
      confirmChangeWindowId: "test-original-guarded-dispatch-window",
    }),
  );
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(result.blockers.includes("repair_change_window_must_be_new"));
});

test("video-QA repair fails closed on provenance, environment, clock and SQLite mutation boundaries", async (t) => {
  const cases = [
    {
      name: "source commit",
      overrides: { expectedSourceCommit: "e".repeat(40) },
      blocker: "source_commit_mismatch",
    },
    {
      name: "runtime commit",
      overrides: { expectedRuntimeCommit: "e".repeat(40) },
      blocker: "runtime_commit_mismatch",
    },
    {
      name: "dirty runtime",
      overrides: { isRuntimeTreeCleanImpl: () => false },
      blocker: "runtime_worktree_must_be_clean",
    },
    {
      name: "unsafe environment",
      overrides: { env: { ...SAFE_ENV, AUTO_PUBLISH: "true" } },
      blocker: "auto_publish_must_be_false",
    },
    {
      name: "caller reporting clock",
      overrides: {
        generatedAt: "2026-07-27T10:30:01.000Z",
      },
      blocker: "reviewed_video_qa_repair_generated_at_not_current",
    },
  ];
  for (const current of cases) {
    const fx = await fixture(t);
    const result = await executeGovernedReviewedVideoQaRepair(
      applyOptions(fx, current.overrides),
    );
    assert.equal(result.verdict, "HOLD", current.name);
    assert.equal(result.mutated, false, current.name);
    assert.ok(result.blockers.includes(current.blocker), current.name);
  }

  const boundaryFx = await fixture(t);
  const boundary = await executeGovernedReviewedVideoQaRepair(
    applyOptions(boundaryFx, {
      sqliteMutationBoundaryBlockersImpl() {
        return ["source_database_sha256_changed_before_apply"];
      },
    }),
  );
  assert.equal(boundary.verdict, "HOLD");
  assert.equal(boundary.mutated, false);
  assert.ok(
    boundary.blockers.includes(
      "source_database_sha256_changed_before_apply",
    ),
  );
  assert.equal(boundary.safety.create_boundary_entered, null);
});

test("video-QA repair rolls back atomically if the guarded proof drifts at the mutation boundary", async (t) => {
  const fx = await fixture(t);
  let boundaryCalls = 0;
  const result = await executeGovernedReviewedVideoQaRepair(
    applyOptions(fx, {
      sqliteMutationBoundaryBlockersImpl() {
        boundaryCalls += 1;
        if (boundaryCalls === 2) {
          mutateGuardedDispatchResult(fx, (value) => {
            value.publisher_result.candidates_tried = 2;
          });
        }
        return [];
      },
    }),
  );
  assert.equal(result.verdict, "ROLLED_BACK");
  assert.equal(result.mutated, false);
  assert.ok(
    result.blockers.includes(
      "reviewed_video_qa_repair_dispatch_proof_drift",
    ),
  );
  const db = new Database(fx.databasePath, { readonly: true });
  assert.equal(
    db
      .prepare(
        `SELECT lifecycle_state FROM platform_publication_state
         WHERE story_id = ? AND platform = 'youtube'`,
      )
      .get(STORY_ID).lifecycle_state,
    "SCHEDULED",
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'repair_governed_reviewed_video_qa_refusal'`,
      )
      .get().count,
    0,
  );
  db.close();
});
