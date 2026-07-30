"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");
const {
  buildNextPublishCandidatesReport,
  readSqliteSnapshot,
} = require("../../lib/ops/stabilisation-preflight");

const ROOT = path.resolve(__dirname, "..", "..");
const NEXT_CANDIDATES_TOOL = path.join(
  ROOT,
  "tools",
  "next-publish-candidates.js",
);
const PLATFORM_DOCTOR_TOOL = path.join(
  ROOT,
  "tools",
  "platform-doctor.js",
);
const DRY_RUN_PUBLISH_TOOL = path.join(
  ROOT,
  "tools",
  "goal-dry-run-publish.js",
);

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runTool(tool, args, env = {}) {
  return execFileSync(process.execPath, [tool, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      USE_JOB_QUEUE: "true",
      ...env,
    },
    encoding: "utf8",
  });
}

function completeRendererManifest(storyId) {
  return {
    schema_version: "pulse-render-manifest-v1",
    story_id: storyId,
    channel_id: "pulse-gaming",
    renderer: {
      id: "studio-v21",
      role: "standard",
      version: "2.1.0",
    },
    stack: { hyperframes: true, ffmpeg: true },
    output: {
      sha256: "a".repeat(64),
      width: 1080,
      height: 1920,
      aspect_ratio: "9:16",
      video_codec: "h264",
      audio_codec: "aac",
      audio_sample_rate_hz: 48000,
      has_audio: true,
      duration_seconds: 37.2,
      ffprobe_passed: true,
      platform_video_qa_result: "pass",
    },
    timing: {
      first_frame_exact_subject: true,
      first_frame_text: "A TANK WITH TWO SHIELDS",
      hook_visible_by_ms: 250,
      consequence_by_ms: 1200,
      proof_by_ms: 2800,
    },
    motion: {
      scene_count: 8,
      motion_scene_count: 4,
      exact_subject_clip_count: 2,
      exact_subject_still_motion_count: 1,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
  };
}

function completeEvidence(storyId) {
  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    items: [
      {
        item_id: "owned-motion",
        source_url: `pulse-owned://${storyId}/motion`,
        asset_sha256: "b".repeat(64),
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: `output/rights/${storyId}.json`,
          sha256: "c".repeat(64),
        },
        attribution_decision: "NOT_REQUIRED",
      },
    ],
  };
  const rendererManifest = completeRendererManifest(storyId);
  return {
    source_evidence_sha256: "d".repeat(64),
    qa_report_sha256: "e".repeat(64),
    rights_ledger: rightsLedger,
    rights_ledger_sha256: hashRightsLedger(rightsLedger),
    originality_transformation: {
      verdict: "STRONG",
      rationale:
        "Original reporting, sequencing and motion design materially transform the reference.",
      evidence_ref: `output/qa/${storyId}-transformation.json`,
      evidence_sha256: "f".repeat(64),
    },
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T09:45:00.000Z",
    },
    renderer_manifest: rendererManifest,
    renderer_manifest_sha256:
      fingerprintRendererManifest(rendererManifest),
    artifact_evidence: {
      final_mp4_exists: true,
      narration_audio_exists: true,
      word_timestamps_exist: true,
      motion_materialised: true,
      hashes_verified: true,
    },
  };
}

function governedSchedules() {
  return [
    {
      name: "publish_morning",
      kind: "publish",
      cron_expr: "0 9 * * *",
      enabled: 1,
      payload: {
        target_platform: "youtube",
        scheduler_profile: "stabilisation_30d",
        cadence_policy: {
          rolling_window_hours: 24,
          max_publish_windows: 2,
          minimum_gap_hours: 4,
          catch_up: false,
        },
      },
    },
    {
      name: "publish_primary",
      kind: "publish",
      cron_expr: "0 19 * * *",
      enabled: 1,
      payload: {
        target_platform: "youtube",
        scheduler_profile: "stabilisation_30d",
        cadence_policy: {
          rolling_window_hours: 24,
          max_publish_windows: 2,
          minimum_gap_hours: 4,
          catch_up: false,
        },
      },
    },
  ];
}

function governedMultiLaneSchedules() {
  return [
    {
      name: "governed_multi_lane_plan",
      kind: "governed_multi_lane_plan",
      cron_expr: "*/15 * * * *",
      enabled: 1,
      payload: {
        scheduler_profile: "governed_multi_lane",
        governed_multi_lane: true,
        live_publish_enabled: false,
        human_admission_required: true,
      },
    },
    {
      name: "governed_youtube_window_inventory_monitor",
      kind: "governed_youtube_window_inventory_monitor",
      cron_expr: "*/5 * * * *",
      enabled: 1,
      payload: {
        horizon_hours: 36,
        human_review_required: true,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "plan_governed_autonomous_window_production_morning",
      kind: "plan_governed_autonomous_window_production",
      cron_expr: "35 6 * * *",
      enabled: 1,
      payload: {
        phase: "AUTONOMOUS_WINDOW_PRODUCTION_PLAN",
        publish_hour_utc: 9,
        job_max_attempts: 11,
        scheduler_profile: "governed_multi_lane",
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "plan_governed_autonomous_window_production_evening",
      kind: "plan_governed_autonomous_window_production",
      cron_expr: "35 16 * * *",
      enabled: 1,
      payload: {
        phase: "AUTONOMOUS_WINDOW_PRODUCTION_PLAN",
        publish_hour_utc: 19,
        job_max_attempts: 11,
        scheduler_profile: "governed_multi_lane",
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "prepare_governed_autonomous_pre_t90_window_morning",
      kind: "prepare_governed_autonomous_pre_t90_window",
      cron_expr: "26 7 * * *",
      enabled: 1,
      payload: {
        phase: "T-94",
        publish_hour_utc: 9,
        maximum_start_lateness_seconds: 60,
        scheduler_profile: "governed_multi_lane",
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "prepare_governed_autonomous_pre_t90_window_evening",
      kind: "prepare_governed_autonomous_pre_t90_window",
      cron_expr: "26 17 * * *",
      enabled: 1,
      payload: {
        phase: "T-94",
        publish_hour_utc: 19,
        maximum_start_lateness_seconds: 60,
        scheduler_profile: "governed_multi_lane",
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "governed_youtube_runway_t90_morning",
      kind: "governed_youtube_runway_t90",
      cron_expr: "30 7 * * *",
      enabled: 1,
      payload: {
        publish_hour_utc: 9,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "governed_youtube_runway_t90_evening",
      kind: "governed_youtube_runway_t90",
      cron_expr: "30 17 * * *",
      enabled: 1,
      payload: {
        publish_hour_utc: 19,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "governed_youtube_runway_tplus15_morning",
      kind: "governed_youtube_runway_tplus15",
      cron_expr: "15 9 * * *",
      enabled: 1,
      payload: {
        publish_hour_utc: 9,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "governed_youtube_runway_tplus15_evening",
      kind: "governed_youtube_runway_tplus15",
      cron_expr: "15 19 * * *",
      enabled: 1,
      payload: {
        publish_hour_utc: 19,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "governed_youtube_runway_slo_monitor",
      kind: "governed_youtube_runway_slo_monitor",
      cron_expr: "*/1 * * * *",
      enabled: 1,
      payload: {
        phase: "SLO_MONITOR",
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
      },
    },
    {
      name: "governed_youtube_window_checkpoint_prime_daily",
      kind: "prime_governed_youtube_window_checkpoints",
      cron_expr: "5 0 * * *",
      enabled: 1,
      payload: {
        horizon_hours: 36,
        catch_up_allowed: false,
        publish_authority: false,
        external_posting: false,
        scheduler_profile: "governed_multi_lane",
        governed_multi_lane: true,
        live_publish_enabled: false,
        human_admission_required: true,
      },
    },
    {
      name: "publish_morning",
      kind: "publish",
      cron_expr: "0 9 * * *",
      enabled: 0,
      payload: {},
    },
    {
      name: "publish_primary",
      kind: "publish",
      cron_expr: "0 19 * * *",
      enabled: 0,
      payload: {},
    },
  ];
}

test("LIVE_GUARDED runway preflight requires and reports the exact OAuth client hash before admission", () => {
  const snapshot = {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [],
    platform_posts: [],
    schedules: governedMultiLaneSchedules(),
    jobs: [],
    runtime_leases: [],
    evidence_by_story: {},
  };
  const liveEnv = {
    PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
  };
  const unbound = buildNextPublishCandidatesReport({
    snapshot,
    env: liveEnv,
    generatedAt: "2026-07-29T10:00:00.000Z",
    sourceCommitSha: "abc1234",
    runtimeCommitSha: "abc1234",
  });
  assert.ok(
    unbound.blockers.includes("youtube_oauth_client_sha256_required"),
  );

  const expectedHash = "d".repeat(64);
  const bound = buildNextPublishCandidatesReport({
    snapshot,
    env: {
      ...liveEnv,
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: expectedHash,
    },
    generatedAt: "2026-07-29T10:00:00.000Z",
    sourceCommitSha: "abc1234",
    runtimeCommitSha: "abc1234",
  });
  assert.equal(
    bound.blockers.includes("youtube_oauth_client_sha256_required"),
    false,
  );
  assert.deepEqual(bound.scheduler_contract.youtube_account_binding, {
    required: true,
    expected_oauth_client_sha256: expectedHash,
  });
});

test("governed multi-lane preflight proves its admission windows without demanding legacy publish jobs", () => {
  const workspace = temporaryDirectory("pulse-governed-preflight-");
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [],
    platform_posts: [],
    schedules: governedMultiLaneSchedules(),
    jobs: [],
    runtime_leases: [
      {
        name: "scheduler:primary",
        owner_id: "scheduler:governed:1",
        expires_at: "2026-07-28T12:05:00.000Z",
      },
    ],
    evidence_by_story: {},
  });

  try {
    runTool(
      NEXT_CANDIDATES_TOOL,
      [
        "--snapshot",
        snapshotPath,
        "--out-dir",
        outDir,
        "--generated-at",
        "2026-07-28T12:00:00.000Z",
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
        PULSE_OPERATING_MODE: "HUMAN_REVIEW",
        AUTO_PUBLISH: "false",
      },
    );
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );
    const markdown = fs.readFileSync(
      path.join(outDir, "next_publish_candidates.md"),
      "utf8",
    );

    assert.equal(report.mode, "HUMAN_REVIEW");
    assert.equal(report.environment, "HUMAN_REVIEW read-only snapshot");
    assert.equal(report.verdict, "HOLD");
    assert.equal(report.scheduler_ready, false);
    assert.equal(report.publish_authorised, false);
    assert.equal(
      report.scheduler_contract.schema_version,
      "pulse-scheduler-preflight-contract-v1",
    );
    assert.equal(
      report.scheduler_contract.strategy,
      "exact_scheduled_admission_release_chain",
    );
    assert.deepEqual(
      report.scheduler_contract.recurring_youtube_windows.map(
        (window) => window.utc_time,
      ),
      ["09:00", "19:00"],
    );
    assert.deepEqual(
      report.scheduler_contract.runway_schedule_contract,
      {
        schema_version:
          "pulse-governed-youtube-runway-schedule-contract-v1",
        verdict: "GREEN",
        schedule_count: 4,
        blockers: [],
        expected: [
          {
            name: "governed_youtube_runway_t90_morning",
            kind: "governed_youtube_runway_t90",
            cron_expr: "30 7 * * *",
            publish_hour_utc: 9,
          },
          {
            name: "governed_youtube_runway_t90_evening",
            kind: "governed_youtube_runway_t90",
            cron_expr: "30 17 * * *",
            publish_hour_utc: 19,
          },
          {
            name: "governed_youtube_runway_tplus15_morning",
            kind: "governed_youtube_runway_tplus15",
            cron_expr: "15 9 * * *",
            publish_hour_utc: 9,
          },
          {
            name: "governed_youtube_runway_tplus15_evening",
            kind: "governed_youtube_runway_tplus15",
            cron_expr: "15 19 * * *",
            publish_hour_utc: 19,
          },
        ],
        autonomous_production_plan_schedule_count: 2,
        autonomous_pre_t90_schedule_count: 2,
        autonomous_production_planning_enabled: true,
        autonomous_pre_t90_preparation_enabled: true,
        utc_only: true,
        catch_up_allowed: false,
        publish_authority: false,
        recovery_monitor_enabled: true,
        candidate_inventory_monitor_enabled: true,
        daily_horizon_priming_enabled: true,
      },
    );
    assert.deepEqual(
      report.scheduler_contract.one_shot_job_contract,
      {
        recurring_schedule_count: 0,
        valid: true,
        admission: {
          kind: "admit_governed_publication",
          timing: "T-75",
          durable_run_at_required: true,
        },
        private_prestage: {
          kind: "prestage_governed_youtube_release",
          timing: "T-70",
          durable_run_at_required: true,
        },
        scheduled_verification: {
          kind: "verify_governed_youtube_release_tminus15",
          timing: "T-15",
          durable_run_at_required: true,
        },
        public_verification: {
          kind: "verify_governed_youtube_release_t0",
          timing: "T0",
          durable_run_at_required: true,
        },
      },
    );
    assert.deepEqual(
      report.scheduler_contract.generic_publish_schedules,
      {
        required: false,
        enabled_count: 0,
        valid: true,
      },
    );
    assert.deepEqual(
      report.scheduler_contract.generic_publish_jobs,
      {
        required: false,
        active_count: 0,
        valid: true,
      },
    );
    assert.deepEqual(
      report.scheduler_contract.exact_scheduled_dispatch_binding,
      {
        required: true,
        observed: false,
        valid: false,
        story_id: null,
        scheduled_event_id: null,
        scheduled_for: null,
        dispatch_job_id: null,
        dispatch_job_run_at: null,
        dispatch_job_idempotency_key: null,
        admission_job_id: null,
        admission_job_status: null,
        admission_job_run_at: null,
        admission_job_idempotency_key: null,
        blocker: "fresh_scheduled_candidate_count_must_be_one",
      },
    );
    assert.equal(
      report.blockers.includes("exactly_two_publish_windows_required"),
      false,
    );
    assert.equal(
      report.blockers.some((blocker) =>
        blocker.startsWith("governed_publish_window_missing:"),
      ),
      false,
    );
    assert.ok(report.blockers.includes("no_publish_candidate"));
    assert.ok(
      report.blockers.includes(
        "fresh_scheduled_candidate_count_must_be_one",
      ),
    );
    assert.ok(
      report.blockers.includes("live_publish_authority_not_proven"),
    );
    assert.match(markdown, /Scheduler profile: governed_multi_lane/);
    assert.match(markdown, /09:00 UTC/);
    assert.match(markdown, /19:00 UTC/);
    assert.match(markdown, /Exact scheduled binding: HOLD/);
    assert.match(markdown, /Generic publish jobs: 0 \(required: no\)/);

    const contaminatedSnapshot = JSON.parse(
      fs.readFileSync(snapshotPath, "utf8"),
    );
    contaminatedSnapshot.schedules.push({
      name: "rogue_generic_publish",
      kind: "publish",
      cron_expr: "0 12 * * *",
      enabled: 1,
      payload: {},
    });
    contaminatedSnapshot.jobs.push({
      id: 99,
      kind: "publish",
      status: "pending",
      payload: {},
    });
    contaminatedSnapshot.schedules.push({
      name: "rogue_recurring_admission",
      kind: "admit_governed_publication",
      cron_expr: "45 8 * * *",
      enabled: 1,
      payload: {},
    });
    contaminatedSnapshot.schedules.find(
      (schedule) =>
        schedule.name === "governed_youtube_runway_t90_morning",
    ).cron_expr = "31 7 * * *";
    contaminatedSnapshot.schedules.find(
      (schedule) =>
        schedule.name === "governed_youtube_runway_t90_evening",
    ).enabled = 0;
    writeJson(snapshotPath, contaminatedSnapshot);
    const contaminatedOutDir = path.join(workspace, "contaminated-proof");
    runTool(
      NEXT_CANDIDATES_TOOL,
      [
        "--snapshot",
        snapshotPath,
        "--out-dir",
        contaminatedOutDir,
        "--generated-at",
        "2026-07-28T12:00:00.000Z",
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
        PULSE_OPERATING_MODE: "HUMAN_REVIEW",
        AUTO_PUBLISH: "false",
      },
    );
    const contaminatedReport = JSON.parse(
      fs.readFileSync(
        path.join(
          contaminatedOutDir,
          "next_publish_candidates.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      contaminatedReport.scheduler_contract.generic_publish_schedules,
      { required: false, enabled_count: 1, valid: false },
    );
    assert.deepEqual(
      contaminatedReport.scheduler_contract.generic_publish_jobs,
      { required: false, active_count: 1, valid: false },
    );
    assert.ok(
      contaminatedReport.blockers.includes(
        "governed_generic_publish_schedule_forbidden",
      ),
    );
    assert.ok(
      contaminatedReport.blockers.includes(
        "governed_generic_publish_job_forbidden",
      ),
    );
    assert.ok(
      contaminatedReport.blockers.includes(
        "governed_one_shot_release_schedule_forbidden",
      ),
    );
    assert.ok(
      contaminatedReport.blockers.includes(
        "runway_schedule_drifted:governed_youtube_runway_t90_morning",
      ),
    );
    assert.ok(
      contaminatedReport.blockers.includes(
        "runway_schedule_missing:governed_youtube_runway_t90_evening",
      ),
    );
    assert.ok(
      contaminatedReport.blockers.includes(
        "runway_schedule_count_must_equal_four",
      ),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("governed multi-lane preflight verifies one exact reviewed scheduled-dispatch binding but grants no HUMAN_REVIEW authority", () => {
  const workspace = temporaryDirectory(
    "pulse-governed-binding-preflight-",
  );
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  const storyId = "governed-ready-story";
  const scheduledFor = "2026-07-28T19:00:00.000Z";
  const dispatchIdempotencyKey =
    `youtube:${storyId}:${scheduledFor}`;
  const requestFingerprint = "7".repeat(64);
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [
      {
        id: "higher-score-unbound-story",
        channel_id: "pulse-gaming",
        title: "A higher-scoring story without the scheduled ticket",
        approved: true,
        full_script: "Another human-reviewed final script.",
        exported_path:
          "output/final/higher-score-unbound-story.mp4",
        human_review_status: "approved",
        breaking_score: 99,
      },
      {
        id: storyId,
        channel_id: "pulse-gaming",
        title: "A reviewed governed story",
        approved: true,
        full_script: "The exact human-reviewed final script.",
        exported_path: `output/final/${storyId}.mp4`,
        human_review_status: "approved",
        breaking_score: 94,
      },
    ],
    platform_posts: [],
    schedules: governedMultiLaneSchedules(),
    jobs: [
      {
        id: 901,
        kind: "verify_governed_youtube_release_t0",
        status: "pending",
        run_at: scheduledFor,
        idempotency_key:
          `verify-public:youtube:77:${requestFingerprint}`,
        payload: {
          story_id: storyId,
          platform: "youtube",
          scheduled_event_id: 77,
          scheduled_for: scheduledFor,
          dispatch_idempotency_key: dispatchIdempotencyKey,
          request_fingerprint: requestFingerprint,
          public_release_verification_authority: true,
        },
      },
      {
        id: 900,
        kind: "admit_governed_publication",
        story_id: storyId,
        status: "done",
        run_at: "2026-07-28T17:45:00.000Z",
        idempotency_key:
          `admit:youtube:breaking_short:${storyId}:` +
          "6".repeat(64) +
          `:${scheduledFor}`,
        payload: {
          lane_id: "breaking_short",
          story_id: storyId,
          platform: "youtube",
          candidate_revision_sha256: "6".repeat(64),
          admission: {
            scheduled_for: scheduledFor,
          },
        },
      },
    ],
    runtime_leases: [
      {
        name: "scheduler:primary",
        owner_id: "scheduler:governed:1",
        expires_at: "2026-07-28T19:05:00.000Z",
      },
    ],
    scheduled_dispatch_bindings: [
      {
        story_id: storyId,
        platform: "youtube",
        lifecycle_state: "SCHEDULED",
        scheduled_event_id: 77,
        evidence_json: JSON.stringify({
          schedule_verified: true,
          control_tower_verdict: "GREEN",
          control_tower_checked_at: "2026-07-28T18:55:00.000Z",
          scheduled_for: scheduledFor,
          kill_switch_healthy: true,
          operating_contract_valid: true,
          dispatch_idempotency_key: dispatchIdempotencyKey,
          request_fingerprint: requestFingerprint,
        }),
        scheduled_event_created_at: "2026-07-28T18:55:00.000Z",
      },
    ],
    evidence_by_story: {
      "higher-score-unbound-story": completeEvidence(
        "higher-score-unbound-story",
      ),
      [storyId]: completeEvidence(storyId),
    },
  });

  try {
    runTool(
      NEXT_CANDIDATES_TOOL,
      [
        "--snapshot",
        snapshotPath,
        "--out-dir",
        outDir,
        "--generated-at",
        scheduledFor,
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
        PULSE_OPERATING_MODE: "HUMAN_REVIEW",
        AUTO_PUBLISH: "false",
      },
    );
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );

    assert.equal(report.next_candidate.preflight_verdict, "PASS");
    assert.equal(
      report.scheduler_contract.exact_scheduled_dispatch_binding.valid,
      true,
    );
    assert.deepEqual(
      report.scheduler_contract.exact_scheduled_dispatch_binding,
      {
        required: true,
        observed: true,
        valid: true,
        story_id: storyId,
        scheduled_event_id: 77,
        scheduled_for: scheduledFor,
        dispatch_job_id: 901,
        dispatch_job_run_at: scheduledFor,
        dispatch_job_idempotency_key:
          `verify-public:youtube:77:${requestFingerprint}`,
        admission_job_id: 900,
        admission_job_status: "done",
        admission_job_run_at: "2026-07-28T17:45:00.000Z",
        admission_job_idempotency_key:
          `admit:youtube:breaking_short:${storyId}:` +
          "6".repeat(64) +
          `:${scheduledFor}`,
        blocker: null,
      },
    );
    assert.equal(
      report.scheduler_contract.human_review.candidate_approved,
      true,
    );
    assert.equal(
      report.scheduler_contract.live_authority.proven,
      false,
    );
    assert.equal(report.verdict, "HOLD");
    assert.equal(report.scheduler_ready, false);
    assert.equal(report.publish_authorised, false);
    assert.deepEqual(report.blockers, [
      "live_publish_authority_not_proven",
    ]);

    const driftedSnapshot = JSON.parse(
      fs.readFileSync(snapshotPath, "utf8"),
    );
    driftedSnapshot.jobs[0].payload.request_fingerprint =
      "9".repeat(64);
    driftedSnapshot.jobs[0].run_at =
      "2026-07-28T19:01:00.000Z";
    driftedSnapshot.jobs[0].idempotency_key =
      "verify-public:youtube:77:wrong";
    driftedSnapshot.jobs[1].run_at =
      "2026-07-28T17:46:00.000Z";
    driftedSnapshot.jobs[1].idempotency_key =
      "admit:youtube:breaking_short:wrong";
    writeJson(snapshotPath, driftedSnapshot);
    const driftedOutDir = path.join(workspace, "drifted-proof");
    runTool(
      NEXT_CANDIDATES_TOOL,
      [
        "--snapshot",
        snapshotPath,
        "--out-dir",
        driftedOutDir,
        "--generated-at",
        scheduledFor,
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
        PULSE_OPERATING_MODE: "HUMAN_REVIEW",
        AUTO_PUBLISH: "false",
      },
    );
    const driftedReport = JSON.parse(
      fs.readFileSync(
        path.join(driftedOutDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );
    assert.equal(
      driftedReport.scheduler_contract
        .exact_scheduled_dispatch_binding.valid,
      false,
    );
    assert.equal(
      driftedReport.scheduler_contract
        .exact_scheduled_dispatch_binding.blocker,
      "scheduled_request_fingerprint_mismatch",
    );
    assert.ok(
      driftedReport.blockers.includes(
        "scheduled_request_fingerprint_mismatch",
      ),
    );
    assert.ok(
      driftedReport.blockers.includes(
        "scheduled_dispatch_run_at_mismatch",
      ),
    );
    assert.ok(
      driftedReport.blockers.includes(
        "scheduled_dispatch_job_idempotency_key_mismatch",
      ),
    );
    assert.ok(
      driftedReport.blockers.includes(
        "scheduled_admission_run_at_mismatch",
      ),
    );
    assert.ok(
      driftedReport.blockers.includes(
        "scheduled_admission_job_idempotency_key_mismatch",
      ),
    );
    assert.equal(driftedReport.publish_authorised, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("governed preflight reads the exact scheduled lifecycle binding from SQLite without mutating it", () => {
  const workspace = temporaryDirectory(
    "pulse-governed-sqlite-preflight-",
  );
  const dbPath = path.join(workspace, "pulse.db");
  const outDir = path.join(workspace, "proof");
  const storyId = "governed-sqlite-story";
  const scheduledFor = "2026-07-28T19:00:00.000Z";
  const dispatchIdempotencyKey =
    `youtube:${storyId}:${scheduledFor}`;
  const requestFingerprint = "8".repeat(64);
  const database = new Database(dbPath);
  database.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      title TEXT,
      approved INTEGER,
      full_script TEXT,
      exported_path TEXT,
      youtube_post_id TEXT,
      breaking_score REAL,
      _extra TEXT
    );
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY,
      story_id TEXT,
      platform TEXT,
      status TEXT,
      external_id TEXT,
      published_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY,
      name TEXT,
      kind TEXT,
      cron_expr TEXT,
      enabled INTEGER,
      payload TEXT
    );
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT,
      story_id TEXT,
      status TEXT,
      run_at TEXT,
      idempotency_key TEXT,
      payload TEXT
    );
    CREATE TABLE runtime_leases (
      name TEXT,
      owner_id TEXT,
      heartbeat_at TEXT,
      expires_at TEXT
    );
    CREATE TABLE platform_dispatch_ledger (
      id INTEGER PRIMARY KEY,
      platform TEXT,
      event_type TEXT,
      verification_status TEXT,
      external_id TEXT,
      verification_evidence_json TEXT,
      created_at TEXT
    );
    CREATE TABLE publication_lifecycle_events (
      id INTEGER PRIMARY KEY,
      story_id TEXT NOT NULL,
      platform TEXT NOT NULL,
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
  database
    .prepare(
      `INSERT INTO stories
       (id, channel_id, title, approved, full_script, exported_path,
        youtube_post_id, breaking_score, _extra)
       VALUES (?, 'pulse-gaming', ?, 1, ?, ?, NULL, 95, ?)`,
    )
    .run(
      storyId,
      "A SQLite-bound governed story",
      "The exact human-reviewed final script.",
      `output/final/${storyId}.mp4`,
      JSON.stringify({
        human_review_status: "approved",
        preflight_evidence: completeEvidence(storyId),
      }),
    );
  const insertCandidateStory = database.prepare(
    `INSERT INTO stories
     (id, channel_id, title, approved, full_script, exported_path,
      youtube_post_id, breaking_score, _extra)
     VALUES (?, 'pulse-gaming', ?, 1, ?, ?, NULL, 40, '{}')`,
  );
  insertCandidateStory.run(
    "candidate-z",
    "Candidate Z",
    "Reviewed candidate Z.",
    "output/final/candidate-z.mp4",
  );
  insertCandidateStory.run(
    "candidate-a",
    "Candidate A",
    "Reviewed candidate A.",
    "output/final/candidate-a.mp4",
  );
  for (const schedule of governedMultiLaneSchedules()) {
    database
      .prepare(
        `INSERT INTO schedules
         (name, kind, cron_expr, enabled, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        schedule.name,
        schedule.kind,
        schedule.cron_expr,
        schedule.enabled,
        JSON.stringify(schedule.payload),
      );
  }
  const seedHistoricalBacklog = database.transaction(() => {
    const insertJob = database.prepare(
      `INSERT INTO jobs
       (id, kind, status, run_at, idempotency_key, payload)
       VALUES (?, 'analytics', 'done', ?, ?, '{}')`,
    );
    const insertPost = database.prepare(
      `INSERT INTO platform_posts
       (id, story_id, platform, status, external_id, published_at, updated_at)
       VALUES (?, ?, 'youtube', 'published', ?, ?, ?)`,
    );
    const insertLedger = database.prepare(
      `INSERT INTO platform_dispatch_ledger
       (id, platform, event_type, verification_status, external_id,
        verification_evidence_json, created_at)
       VALUES (?, 'youtube', 'PUBLISHED', 'confirmed', ?, '{}', ?)`,
    );
    for (let id = 1; id <= 1005; id += 1) {
      const oldTimestamp = "2026-06-01T12:00:00.000Z";
      insertJob.run(
        id,
        "2026-06-01 12:00:00",
        `historical-job:${id}`,
      );
      insertPost.run(
        id,
        `historical-story-${id}`,
        `historical-post-${id}`,
        oldTimestamp,
        oldTimestamp,
      );
      insertLedger.run(
        id,
        `historical-ledger-${id}`,
        oldTimestamp,
      );
    }
  });
  seedHistoricalBacklog();
  database
    .prepare(
      `INSERT INTO jobs
       (id, kind, story_id, status, run_at, idempotency_key, payload)
       VALUES
       (125047, 'verify_governed_youtube_release_t0', ?, 'pending', ?, ?, ?)`,
    )
    .run(
      storyId,
      "2026-07-28 19:00:00",
      `verify-public:youtube:77:${requestFingerprint}`,
      JSON.stringify({
        lane_id: "breaking_short",
        story_id: storyId,
        platform: "youtube",
        scheduled_event_id: 77,
        scheduled_for: scheduledFor,
        dispatch_idempotency_key: dispatchIdempotencyKey,
        request_fingerprint: requestFingerprint,
        public_release_verification_authority: true,
      }),
    );
  database
    .prepare(
      `INSERT INTO jobs
       (id, kind, story_id, status, run_at, idempotency_key, payload)
       VALUES
       (125046, 'admit_governed_publication', ?, 'done', ?, ?, ?)`,
    )
    .run(
      storyId,
      "2026-07-28 17:45:00",
      `admit:youtube:breaking_short:${storyId}:` +
        "6".repeat(64) +
        `:${scheduledFor}`,
      JSON.stringify({
        lane_id: "breaking_short",
        story_id: storyId,
        platform: "youtube",
        candidate_revision_sha256: "6".repeat(64),
        admission: {
          scheduled_for: scheduledFor,
        },
      }),
    );
  database
    .prepare(
      `INSERT INTO platform_posts
       (id, story_id, platform, status, external_id, published_at, updated_at)
       VALUES
       (125046, 'recent-platform-story', 'youtube', 'published',
        'recent-platform-object', ?, ?)`,
    )
    .run(
      "2026-07-28T18:30:00.000Z",
      "2026-07-28T18:30:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO platform_dispatch_ledger
       (id, platform, event_type, verification_status, external_id,
        verification_evidence_json, created_at)
       VALUES
       (125047, 'youtube', 'PUBLISHED', 'confirmed',
        'recent-ledger-object', '{}', ?)`,
    )
    .run("2026-07-28T16:00:00.000Z");
  database
    .prepare(
      `INSERT INTO runtime_leases
       (name, owner_id, heartbeat_at, expires_at)
       VALUES ('scheduler:primary', 'scheduler:governed:1', ?, ?)`,
    )
    .run(
      "2026-07-28T18:59:30.000Z",
      "2026-07-28T19:05:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO publication_lifecycle_events
       (id, story_id, platform, to_state, evidence_json, created_at)
       VALUES (77, ?, 'youtube', 'SCHEDULED', ?, ?)`,
    )
    .run(
      storyId,
      JSON.stringify({
        schedule_verified: true,
        control_tower_verdict: "GREEN",
        control_tower_checked_at: "2026-07-28T18:55:00.000Z",
        scheduled_for: scheduledFor,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        dispatch_idempotency_key: dispatchIdempotencyKey,
        request_fingerprint: requestFingerprint,
      }),
      "2026-07-28T18:55:00.000Z",
    );
  database
    .prepare(
      `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state)
       VALUES (?, 'youtube', 'SCHEDULED')`,
    )
    .run(storyId);
  database.close();
  const before = fs.statSync(dbPath);

  try {
    const orderedSnapshot = readSqliteSnapshot({
      stateRoot: workspace,
      env: { SQLITE_DB_PATH: dbPath },
    });
    assert.deepEqual(
      orderedSnapshot.stories.map((story) => story.id),
      [storyId, "candidate-a", "candidate-z"],
    );
    runTool(
      NEXT_CANDIDATES_TOOL,
      [
        "--state-root",
        workspace,
        "--out-dir",
        outDir,
        "--generated-at",
        scheduledFor,
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        USE_SQLITE: "true",
        SQLITE_DB_PATH: dbPath,
        PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
        PULSE_OPERATING_MODE: "HUMAN_REVIEW",
        AUTO_PUBLISH: "false",
      },
    );
    const after = fs.statSync(dbPath);
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );

    assert.equal(before.size, after.size);
    assert.equal(before.mtimeMs, after.mtimeMs);
    assert.equal(report.snapshot.kind, "sqlite_readonly");
    assert.equal(report.snapshot.database_file_unchanged, true);
    assert.equal(report.snapshot.read_transaction_committed, true);
    assert.equal(report.snapshot.transaction_consistent, true);
    assert.equal(
      report.snapshot.data_version_before,
      report.snapshot.data_version_after,
    );
    assert.deepEqual(
      report.scheduler_contract.exact_scheduled_dispatch_binding,
      {
        required: true,
        observed: true,
        valid: true,
        story_id: storyId,
        scheduled_event_id: 77,
        scheduled_for: scheduledFor,
        dispatch_job_id: 125047,
        dispatch_job_run_at: scheduledFor,
        dispatch_job_idempotency_key:
          `verify-public:youtube:77:${requestFingerprint}`,
        admission_job_id: 125046,
        admission_job_status: "done",
        admission_job_run_at: "2026-07-28T17:45:00.000Z",
        admission_job_idempotency_key:
          `admit:youtube:breaking_short:${storyId}:` +
          "6".repeat(64) +
          `:${scheduledFor}`,
        blocker: null,
      },
    );
    assert.ok(
      report.blockers.includes("stabilisation_rolling_publish_limit"),
    );
    assert.ok(
      report.blockers.includes("stabilisation_minimum_publish_gap"),
    );
    assert.equal(report.verdict, "HOLD");
    assert.equal(report.publish_authorised, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("SQLite preflight fails closed when data_version changes across its read transaction", () => {
  const workspace = temporaryDirectory(
    "pulse-mixed-version-preflight-",
  );
  const dbPath = path.join(workspace, "pulse.db");
  const database = new Database(dbPath);
  database.exec("CREATE TABLE harmless (id INTEGER PRIMARY KEY)");
  database.close();
  const before = fs.statSync(dbPath);
  let reads = 0;

  try {
    const snapshot = readSqliteSnapshot({
      stateRoot: workspace,
      env: { SQLITE_DB_PATH: dbPath },
      dataVersionReader() {
        reads += 1;
        return reads;
      },
    });
    const after = fs.statSync(dbPath);

    assert.equal(reads, 2);
    assert.equal(snapshot.source.kind, "sqlite_readonly");
    assert.equal(snapshot.source.read_only, true);
    assert.equal(snapshot.source.database_file_unchanged, true);
    assert.equal(snapshot.source.read_transaction_committed, true);
    assert.equal(snapshot.source.transaction_consistent, false);
    assert.equal(snapshot.source.data_version_before, 1);
    assert.equal(snapshot.source.data_version_after, 2);
    assert.ok(
      snapshot.source.errors.includes(
        "sqlite_data_version_changed_during_read",
      ),
    );
    assert.equal(before.size, after.size);
    assert.equal(before.mtimeMs, after.mtimeMs);

    const report = buildNextPublishCandidatesReport({
      snapshot,
      env: {
        PULSE_OPERATING_MODE: "LOCAL_PROOF",
        PULSE_SCHEDULER_PROFILE: "stabilisation_30d",
        AUTO_PUBLISH: "false",
      },
      generatedAt: "2026-07-28T19:00:00.000Z",
      sourceCommitSha: "abc1234",
      runtimeCommitSha: "abc1234",
    });
    assert.equal(report.verdict, "HOLD");
    assert.equal(report.scheduler_ready, false);
    assert.equal(report.publish_authorised, false);
    assert.ok(
      report.blockers.includes(
        "snapshot_source:sqlite_data_version_changed_during_read",
      ),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("next candidate CLI holds an empty read-only snapshot and writes proof artefacts", () => {
  const workspace = temporaryDirectory("pulse-next-candidate-");
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [],
    platform_posts: [],
    schedules: [],
    jobs: [],
    runtime_leases: [],
    evidence_by_story: {},
  });

  try {
    const stdout = runTool(NEXT_CANDIDATES_TOOL, [
      "--snapshot",
      snapshotPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
      "--source-commit-sha",
      "abc1234",
      "--runtime-commit-sha",
      "abc1234",
    ]);
    const reportPath = path.join(
      outDir,
      "next_publish_candidates.json",
    );
    const markdownPath = path.join(
      outDir,
      "next_publish_candidates.md",
    );
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const markdown = fs.readFileSync(markdownPath, "utf8");

    assert.match(stdout, /next_publish_candidates/);
    assert.equal(report.schema_version, "pulse-next-publish-candidates-v1");
    assert.equal(report.mode, "LOCAL_PROOF");
    assert.equal(report.snapshot.read_only, true);
    assert.equal(report.scheduler_ready, false);
    assert.equal(report.publish_authorised, false);
    assert.equal(report.next_candidate, null);
    assert.ok(report.blockers.includes("no_publish_candidate"));
    assert.match(markdown, /# Next Publish Candidates/);
    assert.match(markdown, /LOCAL_PROOF/);
    assert.match(markdown, /no_publish_candidate/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("next candidate CLI marks complete governed evidence scheduler-ready without authorising a publish", () => {
  const workspace = temporaryDirectory("pulse-ready-candidate-");
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [
      {
        id: "ready-story",
        channel_id: "pulse-gaming",
        title: "A verified exact-subject story",
        approved: true,
        full_script: "The reviewed final script.",
        exported_path: "output/final/ready-story_studio-v21.mp4",
        human_review_status: "approved",
        breaking_score: 91,
      },
    ],
    platform_posts: [],
    schedules: governedSchedules(),
    jobs: [],
    runtime_leases: [
      {
        name: "scheduler:primary",
        owner_id: "scheduler:test:1",
        expires_at: "2026-07-27T10:05:00.000Z",
      },
    ],
    evidence_by_story: {
      "ready-story": completeEvidence("ready-story"),
    },
  });

  try {
    runTool(NEXT_CANDIDATES_TOOL, [
      "--snapshot",
      snapshotPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
      "--source-commit-sha",
      "abc1234",
      "--runtime-commit-sha",
      "abc1234",
    ]);
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );

    assert.equal(report.verdict, "PASS");
    assert.equal(report.scheduler_profile, "stabilisation_30d");
    assert.equal(report.scheduler_contract, null);
    assert.equal(report.scheduler_ready, true);
    assert.equal(report.publish_authorised, false);
    assert.equal(report.next_candidate.story_id, "ready-story");
    assert.equal(report.next_candidate.preflight_verdict, "PASS");
    assert.deepEqual(report.next_candidate.blockers, []);
    assert.equal(report.candidates.length, 1);
    assert.deepEqual(report.blockers, []);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("platform doctor keeps every secondary platform visible but non-publishable and redacts credentials", () => {
  const workspace = temporaryDirectory("pulse-platform-doctor-");
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  const secret = "credential-value-must-not-appear";
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [],
    platform_posts: [],
    schedules: [],
    jobs: [],
    runtime_leases: [],
    evidence_by_story: {},
  });

  try {
    runTool(
      PLATFORM_DOCTOR_TOOL,
      [
        "--snapshot",
        snapshotPath,
        "--out-dir",
        outDir,
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        YOUTUBE_REFRESH_TOKEN: secret,
        INSTAGRAM_ACCESS_TOKEN: secret,
        FACEBOOK_PAGE_TOKEN: secret,
        TIKTOK_ACCESS_TOKEN: secret,
        TWITTER_ACCESS_SECRET: secret,
        TIKTOK_ENABLED: "true",
        INSTAGRAM_AUTO_PUBLISH: "true",
        FACEBOOK_AUTO_PUBLISH: "true",
        TWITTER_ENABLED: "true",
      },
    );
    const jsonPath = path.join(outDir, "platform_doctor.json");
    const markdownPath = path.join(outDir, "platform_doctor.md");
    const jsonText = fs.readFileSync(jsonPath, "utf8");
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const report = JSON.parse(jsonText);

    assert.deepEqual(
      report.platforms.map((platform) => platform.platform),
      [
        "youtube",
        "instagram",
        "facebook",
        "tiktok",
        "x",
        "threads",
        "pinterest",
      ],
    );
    assert.ok(report.platforms.every((platform) => platform.visible));
    assert.equal(
      report.platforms.find((platform) => platform.platform === "youtube")
        .automation,
      "governed_approval_union",
    );
    assert.ok(
      report.platforms
        .filter((platform) => platform.platform !== "youtube")
        .every((platform) => platform.publishable === false),
    );
    assert.ok(
      report.blockers.includes("secondary_platform_automation_frozen"),
    );
    assert.equal(report.publish_authorised, false);
    assert.doesNotMatch(jsonText, new RegExp(secret));
    assert.doesNotMatch(markdown, new RegExp(secret));
    assert.match(markdown, /Instagram/);
    assert.match(markdown, /Pinterest/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("strict dry-run publish builds a YouTube-only plan without any mutation or external call", () => {
  const workspace = temporaryDirectory("pulse-dry-run-publish-");
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  const secret = "dry-run-secret-must-not-appear";
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [
      {
        id: "dry-run-story",
        channel_id: "pulse-gaming",
        title: "A complete dry-run story",
        approved: true,
        full_script: "The reviewed final script.",
        exported_path: "output/final/dry-run-story_studio-v21.mp4",
        human_review_status: "approved",
        breaking_score: 88,
      },
    ],
    platform_posts: [],
    schedules: governedSchedules(),
    jobs: [],
    runtime_leases: [
      {
        name: "scheduler:primary",
        owner_id: "scheduler:test:1",
        expires_at: "2026-07-27T10:05:00.000Z",
      },
    ],
    evidence_by_story: {
      "dry-run-story": completeEvidence("dry-run-story"),
    },
  });

  try {
    runTool(
      DRY_RUN_PUBLISH_TOOL,
      [
        "--snapshot",
        snapshotPath,
        "--out-dir",
        outDir,
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        YOUTUBE_REFRESH_TOKEN: secret,
        INSTAGRAM_ACCESS_TOKEN: secret,
      },
    );
    const jsonPath = path.join(outDir, "goal_dry_run_publish.json");
    const markdownPath = path.join(outDir, "goal_dry_run_publish.md");
    const jsonText = fs.readFileSync(jsonPath, "utf8");
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const report = JSON.parse(jsonText);

    assert.equal(report.schema_version, "pulse-goal-dry-run-publish-v1");
    assert.equal(report.execution_mode, "DRY_RUN_PUBLISH");
    assert.equal(report.package_ready, true);
    assert.equal(report.scheduler_ready, true);
    assert.equal(report.publish_authorised, false);
    assert.equal(report.selected_candidate.story_id, "dry-run-story");
    assert.equal(report.target_platform, "youtube");
    assert.deepEqual(report.safety.external_calls, []);
    assert.equal(report.safety.production_database_mutated, false);
    assert.equal(report.safety.oauth_or_tokens_mutated, false);
    assert.equal(report.safety.platform_objects_created, false);
    assert.ok(
      report.platform_plan
        .filter((entry) => entry.platform !== "youtube")
        .every((entry) => entry.action === "SKIP_POLICY"),
    );
    assert.doesNotMatch(jsonText, new RegExp(secret));
    assert.doesNotMatch(markdown, new RegExp(secret));
    assert.match(markdown, /DRY_RUN_PUBLISH/);
    assert.match(markdown, /not publication authority/i);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("package scripts expose every preflight command named by AGENTS.md", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  const expected = {
    "ops:next-publish-candidates":
      "node tools/next-publish-candidates.js",
    "ops:platform-doctor": "node tools/platform-doctor.js",
    "ops:goal-dry-run-publish":
      "node tools/goal-dry-run-publish.js",
  };

  for (const [name, command] of Object.entries(expected)) {
    assert.equal(packageJson.scripts[name], command);
    const entrypoint = command.replace(/^node\s+/, "");
    assert.equal(fs.existsSync(path.join(ROOT, entrypoint)), true);
  }
});

test("a no-snapshot operator run captures JSON state read-only and fails closed on missing runtime evidence", () => {
  const workspace = temporaryDirectory("pulse-auto-snapshot-");
  const outDir = path.join(workspace, "proof");
  writeJson(path.join(workspace, "daily_news.json"), [
    {
      id: "local-story",
      title: "Local story",
      approved: true,
      full_script: "Reviewed script.",
      exported_path: "output/final/local-story.mp4",
    },
  ]);

  try {
    runTool(NEXT_CANDIDATES_TOOL, [
      "--state-root",
      workspace,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
      "--source-commit-sha",
      "abc1234",
      "--runtime-commit-sha",
      "abc1234",
    ]);
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );

    assert.equal(report.snapshot.kind, "json_fallback");
    assert.equal(report.snapshot.read_only, true);
    assert.equal(report.snapshot.story_count, 1);
    assert.equal(report.scheduler_ready, false);
    assert.equal(report.publish_authorised, false);
    assert.ok(
      report.blockers.includes("exactly_two_publish_windows_required"),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("SQLite auto-snapshot uses a read-only connection and leaves the database file unchanged", () => {
  const workspace = temporaryDirectory("pulse-sqlite-snapshot-");
  const dbPath = path.join(workspace, "pulse.db");
  const outDir = path.join(workspace, "proof");
  const database = new Database(dbPath);
  database.exec(`
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      approved INTEGER,
      full_script TEXT,
      exported_path TEXT,
      youtube_post_id TEXT,
      breaking_score REAL,
      _extra TEXT
    );
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY,
      story_id TEXT,
      platform TEXT,
      status TEXT,
      external_id TEXT,
      published_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY,
      name TEXT,
      kind TEXT,
      cron_expr TEXT,
      enabled INTEGER,
      payload TEXT
    );
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT,
      status TEXT,
      payload TEXT
    );
    CREATE TABLE runtime_leases (
      name TEXT,
      owner_id TEXT,
      expires_at TEXT
    );
  `);
  database
    .prepare(
      `INSERT INTO stories
       (id, title, approved, full_script, exported_path, breaking_score, _extra)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "sqlite-story",
      "SQLite candidate",
      1,
      "Reviewed script.",
      "output/final/sqlite-story.mp4",
      70,
      JSON.stringify({ human_review_status: "approved" }),
    );
  database.close();
  const before = fs.statSync(dbPath);

  try {
    runTool(
      NEXT_CANDIDATES_TOOL,
      [
        "--state-root",
        workspace,
        "--out-dir",
        outDir,
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        USE_SQLITE: "true",
        SQLITE_DB_PATH: dbPath,
      },
    );
    const after = fs.statSync(dbPath);
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );

    assert.equal(report.snapshot.kind, "sqlite_readonly");
    assert.equal(report.snapshot.read_only, true);
    assert.equal(report.snapshot.story_count, 1);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(report.publish_authorised, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("operator commands stamp the exact local source and runtime commit when hashes are not supplied", () => {
  const workspace = temporaryDirectory("pulse-preflight-provenance-");
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [],
    platform_posts: [],
    schedules: [],
    jobs: [],
    runtime_leases: [],
    evidence_by_story: {},
  });

  try {
    runTool(NEXT_CANDIDATES_TOOL, [
      "--snapshot",
      snapshotPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
    ]);
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );

    assert.match(report.source_commit_sha, /^[a-f0-9]{40}$/);
    assert.equal(report.runtime_commit_sha, report.source_commit_sha);
    assert.equal(report.authoritative, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("immutable YouTube dispatch evidence enforces the rolling two-publication limit", () => {
  const workspace = temporaryDirectory("pulse-ledger-cadence-");
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [
      {
        id: "held-by-cadence",
        channel_id: "pulse-gaming",
        title: "Technically complete but cadence held",
        approved: true,
        full_script: "The reviewed final script.",
        exported_path:
          "output/final/held-by-cadence_studio-v21.mp4",
        human_review_status: "approved",
        breaking_score: 99,
      },
    ],
    platform_posts: [],
    dispatch_ledger: [
      {
        platform: "youtube",
        event_type: "PUBLISHED",
        verification_status: "confirmed",
        external_id: "youtube-one",
        created_at: "2026-07-27T01:00:00.000Z",
      },
      {
        platform: "youtube",
        event_type: "PUBLISHED",
        verification_status: "confirmed",
        external_id: "youtube-two",
        created_at: "2026-07-27T06:00:00.000Z",
      },
    ],
    schedules: governedSchedules(),
    jobs: [],
    runtime_leases: [
      {
        name: "scheduler:primary",
        owner_id: "scheduler:test:1",
        expires_at: "2026-07-27T10:05:00.000Z",
      },
    ],
    evidence_by_story: {
      "held-by-cadence": completeEvidence("held-by-cadence"),
    },
  });

  try {
    runTool(NEXT_CANDIDATES_TOOL, [
      "--snapshot",
      snapshotPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-07-27T10:00:00.000Z",
      "--source-commit-sha",
      "abc1234",
      "--runtime-commit-sha",
      "abc1234",
    ]);
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "next_publish_candidates.json"),
        "utf8",
      ),
    );

    assert.equal(report.next_candidate.preflight_verdict, "PASS");
    assert.equal(report.scheduler_ready, false);
    assert.ok(
      report.blockers.includes("stabilisation_rolling_publish_limit"),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("strict dry-run refuses a fully armed LIVE_GUARDED environment", () => {
  const workspace = temporaryDirectory("pulse-live-env-dry-run-");
  const snapshotPath = path.join(workspace, "snapshot.json");
  const outDir = path.join(workspace, "proof");
  writeJson(snapshotPath, {
    schema_version: "pulse-preflight-snapshot-v1",
    source: { kind: "fixture", read_only: true },
    stories: [
      {
        id: "live-env-story",
        channel_id: "pulse-gaming",
        title: "Complete story in an unsafe proof environment",
        approved: true,
        full_script: "The reviewed final script.",
        exported_path: "output/final/live-env-story_studio-v21.mp4",
        human_review_status: "approved",
      },
    ],
    platform_posts: [],
    schedules: governedSchedules(),
    jobs: [],
    runtime_leases: [
      {
        name: "scheduler:primary",
        owner_id: "scheduler:test:1",
        expires_at: "2026-07-27T10:05:00.000Z",
      },
    ],
    evidence_by_story: {
      "live-env-story": completeEvidence("live-env-story"),
    },
  });

  try {
    runTool(
      DRY_RUN_PUBLISH_TOOL,
      [
        "--snapshot",
        snapshotPath,
        "--out-dir",
        outDir,
        "--generated-at",
        "2026-07-27T10:00:00.000Z",
        "--source-commit-sha",
        "abc1234",
        "--runtime-commit-sha",
        "abc1234",
      ],
      {
        PULSE_OPERATING_MODE: "LIVE_GUARDED",
        AUTO_PUBLISH: "true",
        PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
        USE_JOB_QUEUE: "true",
        USE_SQLITE: "true",
        PULSE_PRIMARY_INSTANCE: "true",
      },
    );
    const report = JSON.parse(
      fs.readFileSync(
        path.join(outDir, "goal_dry_run_publish.json"),
        "utf8",
      ),
    );

    assert.equal(report.package_ready, false);
    assert.equal(report.publish_authorised, false);
    assert.ok(
      report.blockers.includes("preflight_requires_local_proof_mode"),
    );
    assert.deepEqual(report.safety.external_calls, []);
    assert.equal(report.safety.platform_objects_created, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
