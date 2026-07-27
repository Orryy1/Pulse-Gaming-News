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
      "human_review_only",
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
