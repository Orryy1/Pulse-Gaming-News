"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const Database = require("better-sqlite3");

const {
  admitAutonomousOfficialPublication,
  admitPublication,
  buildImmutablePublicationEvidence,
  fingerprintOutsideCadenceAuthorisation,
} = require("../../lib/services/publication-admission");
const {
  createAutonomousOfficialPublicationAuthority,
} = require("../../lib/services/autonomous-official-publication-authority");
const {
  fingerprintPublicationRequest,
} = require("../../lib/services/publication-request-fingerprint");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const {
  buildControlledExperimentObservation,
} = require("../../lib/services/controlled-experiment-observation");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  createRendererEvidence,
} = require("../../lib/stabilisation/render-manifest");
const {
  EXPERIMENTAL_RENDERER_ID,
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");
const governanceFactory = require("../../lib/repositories/publication_governance");
const jobsFactory = require("../../lib/repositories/jobs");
const storiesFactory = require("../../lib/repositories/stories");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const NOW = new Date("2026-07-27T08:55:00.000Z");
const SCHEDULED_FOR = "2026-07-27T09:00:00.000Z";
const SCRIPT = "Original Xbox games are returning with achievement support.";
const MEDIA = "final-reviewed-video";
const RIGHTS_LEDGER = Object.freeze({
  ledger_version: 1,
  decision: "CLEARED",
  items: [
    {
      item_id: "owned-motion-package",
      source_url: "pulse-owned://story-admission-1/motion-package",
      asset_sha256: "4".repeat(64),
      included_in_final: true,
      rights_decision: "CLEARED",
      rights_basis: "OWNED",
      rights_evidence: {
        reference: "output/rights/story-admission-1-owned-motion.json",
        sha256: "5".repeat(64),
      },
      attribution_decision: "NOT_REQUIRED",
      attribution_text: null,
    },
  ],
});
const HASHES = Object.freeze({
  source_evidence_sha256: "1".repeat(64),
  rights_ledger_sha256: hashRightsLedger(RIGHTS_LEDGER),
  qa_report_sha256: "3".repeat(64),
});
const SOURCE_URL = "https://news.xbox.com/en-us/2026/07/27/example/";
const SOURCE_CLAIM =
  "Original Xbox games are returning with achievement support.";
const OFFICIAL_SOURCE_BINDING = buildOfficialSourceReleaseBinding({
  storyId: "story-admission-1",
  sourceEvidenceSha256: HASHES.source_evidence_sha256,
  sourceEvidence: {
    schema_version: "pulse-source-evidence-v1",
    story_id: "story-admission-1",
    source_url: SOURCE_URL,
    source_type: "official",
    claims: [
      {
        claim_key: "xbox.original-games.return",
        text: SOURCE_CLAIM,
        claim_text_sha256: sha256(SOURCE_CLAIM),
      },
    ],
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: SOURCE_URL,
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256: sha256(SOURCE_CLAIM),
      claims: [
        {
          claim_key: "xbox.original-games.return",
          text: SOURCE_CLAIM,
          claim_text_sha256: sha256(SOURCE_CLAIM),
        },
      ],
    },
  },
});
const PUBLICATION_METADATA_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), "pulse-approved-publication-metadata-"),
);
const PUBLICATION_METADATA_PATH = path.join(
  PUBLICATION_METADATA_DIRECTORY,
  "publication-metadata.json",
);
const PUBLICATION_METADATA_VALUE = Object.freeze({
  schema_version: "pulse-governed-publication-metadata-v1",
  story_id: "story-admission-1",
  channel_id: "pulse-gaming",
  platform: "youtube_shorts",
  title: "The exact approved YouTube title",
  description:
    "The exact approved YouTube description.\n\nFootage: © SQUARE ENIX",
});
const PUBLICATION_METADATA_BYTES = Buffer.from(
  `${JSON.stringify(PUBLICATION_METADATA_VALUE, null, 2)}\n`,
);
fs.writeFileSync(PUBLICATION_METADATA_PATH, PUBLICATION_METADATA_BYTES);
const PUBLICATION_METADATA = Object.freeze({
  path: PUBLICATION_METADATA_PATH,
  sha256: sha256(PUBLICATION_METADATA_BYTES),
  platform: PUBLICATION_METADATA_VALUE.platform,
  title: PUBLICATION_METADATA_VALUE.title,
  description: PUBLICATION_METADATA_VALUE.description,
});
after(() => {
  fs.rmSync(PUBLICATION_METADATA_DIRECTORY, {
    recursive: true,
    force: true,
  });
});
const LIVE_ENV = Object.freeze({
  PULSE_OPERATING_MODE: "LIVE_GUARDED",
  PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "a".repeat(64),
  AUTO_PUBLISH: "true",
  PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
  USE_JOB_QUEUE: "true",
  USE_SQLITE: "true",
  PULSE_PRIMARY_INSTANCE: "true",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function rendererManifest(overrides = {}) {
  return createRendererEvidence({
    story: {
      id: "story-admission-1",
      channel_id: "pulse-gaming",
    },
    rendererVersion: "2.1.0",
    mediaSha256: sha256(MEDIA),
    stack: {
      hyperframes: true,
      ffmpeg: true,
    },
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
        duration_seconds: 37.2,
        ffprobe_passed: true,
      },
    },
    timing: {
      first_frame_exact_subject: true,
      first_frame_text: "A TANK WITH TWO SHIELDS",
      hook_visible_by_ms: 200,
      consequence_by_ms: 1100,
      proof_by_ms: 2600,
    },
    motion: {
      scene_count: 8,
      motion_scene_count: 4,
      exact_subject_clip_count: 2,
      exact_subject_still_motion_count: 1,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
    operatingMode: "LIVE_GUARDED",
    ...overrides,
  }).manifest;
}

function completeEvidence(overrides = {}) {
  const manifest = overrides.renderer_manifest || rendererManifest();
  return {
    ...HASHES,
    originality_transformation: {
      verdict: "STRONG",
      rationale:
        "Pulse adds an original player consequence, comparison, sequencing and motion treatment.",
      evidence_ref: "output/qa/story-admission-1-transformation-evidence.json",
      evidence_sha256: "6".repeat(64),
    },
    rights_ledger: RIGHTS_LEDGER,
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale:
        "The final edit contains synthetic narration and designed motion elements.",
      disclosure_text:
        "Includes AI-generated narration and synthetic visual elements.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
    publication_metadata_sha256: PUBLICATION_METADATA.sha256,
    publication_metadata: PUBLICATION_METADATA,
    official_source_release_binding: OFFICIAL_SOURCE_BINDING,
    renderer_manifest: manifest,
    renderer_manifest_sha256: fingerprintRendererManifest(manifest),
    ...overrides,
  };
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
      jobs: jobsFactory.bind(db),
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
    evidence: completeEvidence(),
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

async function autonomousAdmissionInput(repos, story, overrides = {}) {
  const {
    authorityIssuedAt = "2026-07-27T08:55:00.000Z",
    admissionAt: admissionTime = "2026-07-27T08:55:05.000Z",
    ...inputOverrides
  } = overrides;
  const issuedAt = new Date(authorityIssuedAt);
  const admissionAt = new Date(admissionTime);
  const scheduledFor = SCHEDULED_FOR;
  const channel = {
    id: "pulse-gaming",
    name: "Pulse Gaming",
    youtubeCategory: "20",
  };
  const gateInput = completeEvidence({
    synthetic_media_disclosure: {
      decision_authority: "SYSTEM_POLICY",
      altered_content: true,
      policy_basis: "DISCLOSE",
      youtube_field_value: true,
      decision_provenance: {
        policy_id: "pulse-youtube-synthetic-media-disclosure",
        policy_version: "1",
        evaluated_at: "2026-07-27T08:45:00.000Z",
        evidence_sha256: HASHES.qa_report_sha256,
      },
    },
  });
  const publicationEvidence = buildImmutablePublicationEvidence({
    evidence: gateInput,
    operatingMode: "LIVE_GUARDED",
  });
  const fingerprint = await fingerprintPublicationRequest(story, {
    channelId: "pulse-gaming",
    platform: "youtube",
    channel,
    publicationEvidence,
  });
  const lineage = {
    story_intake_sha256: "a1".repeat(32),
    source_evidence_sha256: publicationEvidence.source_evidence_sha256,
    script_sha256: fingerprint.script_sha256,
    owned_motion_manifest_sha256: "a2".repeat(32),
    owned_motion_source_manifest_sha256: "a3".repeat(32),
    owned_programme_sha256: "a4".repeat(32),
    narration_audio_sha256: "a5".repeat(32),
    narration_manifest_sha256: "a6".repeat(32),
    narration_licence_evidence_sha256: "a7".repeat(32),
    final_composite_manifest_sha256: "a8".repeat(32),
    renderer_manifest_file_sha256: "a9".repeat(32),
    renderer_manifest_canonical_sha256:
      publicationEvidence.renderer_manifest_sha256,
    deterministic_qa_sha256: publicationEvidence.qa_report_sha256,
    multimodal_visual_qa_sha256: "ab".repeat(32),
    autonomous_green_supplement_sha256: "b0".repeat(32),
    final_mp4_sha256: fingerprint.media_sha256,
    publication_metadata_sha256:
      publicationEvidence.publication_metadata_sha256,
    kill_switch_proof_sha256: "ac".repeat(32),
    single_owner_proof_sha256: "ad".repeat(32),
  };
  const reportPayload = {
    schema_version: "pulse-autonomous-official-source-evidence-apply-report-v2",
    materialiser_id: "pulse-autonomous-official-source-evidence-apply-v2",
    mode: "LOCAL_PROOF",
    generated_at: "2026-07-27T08:54:30.000Z",
    valid_until: "2026-07-27T08:56:30.000Z",
    request_sha256: "ae".repeat(32),
    story_id: story.id,
    verdict: "GREEN",
    blockers: [],
    authority: {
      method: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
      scope: "LOCAL_EDITORIAL_AND_RELEASE_EVIDENCE_ONLY",
      human_approval: false,
      may_impersonate_human: false,
    },
    visual_policy: "OWNED_ONLY",
    audio_policy: "LICENSED_NARRATION_ONLY",
    source_revalidation: {
      policy: "PRIMARY_AND_ALL_SUPPORTING_OFFICIAL_SNAPSHOTS",
      snapshot_count: 1,
      primary_count: 1,
      supporting_count: 0,
      sources: [
        {
          role: "PRIMARY",
          source_id: "xbox-wire",
          source_url: SOURCE_URL,
          snapshot_sha256: "af".repeat(32),
          canonical_body_sha256: sha256(SOURCE_CLAIM),
          matched_claim_text_sha256: [sha256(SOURCE_CLAIM)],
          bytes_sha256: "b0".repeat(32),
          fetch_status: 200,
          revalidated_at: "2026-07-27T08:54:30.000Z",
          unchanged: true,
          claims_match: true,
        },
      ],
    },
    lineage,
    controls: {
      kill_switch: "FRESH_HEALTHY",
      scheduler_and_publisher_ownership: "SINGLE_OWNER",
      kill_switch_proof: {
        declared_path: "output/proof/kill-switch.json",
        resolved_path: "C:\\proof\\kill-switch.json",
        real_path: "C:\\proof\\kill-switch.json",
        observed_sha256: lineage.kill_switch_proof_sha256,
        size_bytes: 300,
      },
      single_owner_proof: {
        declared_path: "output/proof/single-owner.json",
        resolved_path: "C:\\proof\\single-owner.json",
        real_path: "C:\\proof\\single-owner.json",
        observed_sha256: lineage.single_owner_proof_sha256,
        size_bytes: 400,
      },
    },
    qa: {
      deterministic: "PASS",
      multimodal: "UNANIMOUS_PASS",
      deterministic_report: {
        declared_path: "output/qa/final-render-qa.json",
        resolved_path: "C:\\proof\\final-render-qa.json",
        real_path: "C:\\proof\\final-render-qa.json",
        observed_sha256: lineage.deterministic_qa_sha256,
        size_bytes: 4000,
      },
      multimodal_report: {
        declared_path: "output/qa/visual-review.json",
        resolved_path: "C:\\proof\\visual-review.json",
        real_path: "C:\\proof\\visual-review.json",
        observed_sha256: lineage.multimodal_visual_qa_sha256,
        size_bytes: 5000,
      },
    },
    input_files: {},
    owned_visual_files: [],
    operational_publish_authority: false,
    dispatch_authorised: false,
    dispatch_revalidation_required: true,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    local_files_written: 1,
    network_scope: "OFFICIAL_PRIMARY_AND_SUPPORTING_SOURCE_READS_ONLY",
  };
  const report = {
    ...reportPayload,
    report_sha256: canonicalSha256(reportPayload),
  };
  const reportBytes = Buffer.from(
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  const runwayLockSha256 = "b1".repeat(32);
  const authority = await createAutonomousOfficialPublicationAuthority(
    {
      source_report: {
        path: path.join(os.tmpdir(), "pulse-autonomous-admission-report.json"),
        file_sha256: sha256(reportBytes),
      },
      binding: {
        story_id: story.id,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: scheduledFor,
        runway_lock_sha256: runwayLockSha256,
        dispatch_idempotency_key: `youtube:${story.id}:${scheduledFor}`,
        request_fingerprint: fingerprint.request_fingerprint,
      },
      publication_evidence: publicationEvidence,
      publication_evidence_gate_input: {
        originality_transformation: gateInput.originality_transformation,
        rights_ledger: gateInput.rights_ledger,
        rights_ledger_sha256: gateInput.rights_ledger_sha256,
        synthetic_media_disclosure: gateInput.synthetic_media_disclosure,
      },
      admission_controls: {
        kill_switch_proof_sha256: lineage.kill_switch_proof_sha256,
        kill_switch_checked_at: "2026-07-27T08:54:40.000Z",
        single_owner_proof_sha256: lineage.single_owner_proof_sha256,
        single_owner_checked_at: "2026-07-27T08:54:45.000Z",
      },
    },
    {
      clock: () => issuedAt,
      fileSystem: {
        async readFile() {
          return reportBytes;
        },
      },
    },
  );
  return {
    repos,
    authority,
    storyId: story.id,
    channelId: "pulse-gaming",
    laneId: "breaking_short",
    platform: "youtube",
    scheduledFor,
    runwayLockSha256,
    requestFingerprint: fingerprint.request_fingerprint,
    publicationEvidence,
    env: { ...LIVE_ENV },
    clock: () => admissionAt,
    channel,
    dispatchJob: {
      laneId: "breaking_short",
      priority: 6,
      maxAttempts: 3,
    },
    ...inputOverrides,
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

test("operator admission runs the supplied database boundary check first inside its write transaction", async (t) => {
  const { db, repos } = fixture(t);
  let boundaryChecks = 0;

  await assert.rejects(
    admitPublication(
      admissionInput(repos, {
        transactionBoundaryCheck() {
          boundaryChecks += 1;
          assert.equal(db.inTransaction, true);
          assertNoAdmissionRows(db);
          throw new Error("source_database_wal_not_checkpointed");
        },
      }),
    ),
    /source_database_wal_not_checkpointed/,
  );

  assert.equal(boundaryChecks, 1);
  assertNoAdmissionRows(db);
});

test("autonomous official admission atomically records its exact authority, schedules the governed release jobs and never creates a human decision", async (t) => {
  const { db, repos, story } = fixture(t);
  const input = await autonomousAdmissionInput(repos, story);

  const admitted = await admitAutonomousOfficialPublication(input);

  assert.equal(admitted.admitted, true);
  assert.equal(admitted.lifecycle_state, "SCHEDULED");
  assert.equal(admitted.story_id, story.id);
  assert.equal(admitted.channel_id, "pulse-gaming");
  assert.equal(admitted.lane_id, "breaking_short");
  assert.equal(admitted.platform, "youtube");
  assert.equal(admitted.scheduled_for, SCHEDULED_FOR);
  assert.equal(admitted.runway_lock_sha256, input.runwayLockSha256);
  assert.equal(admitted.request_fingerprint, input.requestFingerprint);
  assert.deepEqual(admitted.publication_evidence, input.publicationEvidence);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );

  const authorityRows = db
    .prepare("SELECT * FROM publication_authority_audit_log ORDER BY id")
    .all();
  assert.equal(authorityRows.length, 1);
  assert.equal(
    authorityRows[0].authority_binding_sha256,
    input.authority.authority_sha256,
  );
  assert.equal(
    authorityRows[0].authority_type,
    "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
  );
  assert.equal(admitted.publication_authority_audit_id, authorityRows[0].id);
  const authorityEvidence = JSON.parse(authorityRows[0].evidence_json);
  assert.equal(authorityEvidence.exact_candidate_bound, true);
  assert.equal(
    authorityEvidence.authority_binding_sha256,
    input.authority.authority_sha256,
  );
  assert.equal(
    authorityEvidence.autonomous_green_supplement_sha256,
    input.authority.lineage.autonomous_green_supplement_sha256,
  );
  assert.equal(
    Object.keys(authorityEvidence).some((field) =>
      /actor|operator|human/i.test(field),
    ),
    false,
  );

  const lifecycle = db
    .prepare(
      `SELECT to_state, actor_type, actor_id,
              publication_authority_audit_id, evidence_json
       FROM publication_lifecycle_events
       WHERE story_id = ? AND platform = ?
       ORDER BY id`,
    )
    .all(story.id, "youtube");
  assert.deepEqual(
    lifecycle.map((row) => row.to_state),
    [
      "DISCOVERED",
      "VERIFIED",
      "EDITORIALLY_APPROVED",
      "SCRIPT_READY",
      "ASSETS_CLEARED",
      "RENDERED",
      "QA_PASSED",
      "AUTONOMOUSLY_APPROVED",
      "SCHEDULED",
    ],
  );
  assert.ok(
    lifecycle.every(
      (row) => row.actor_type === "system" && row.actor_id === null,
    ),
  );
  assert.equal(
    lifecycle[7].publication_authority_audit_id,
    authorityRows[0].id,
  );
  assert.ok(
    lifecycle
      .filter((row) => row.to_state !== "AUTONOMOUSLY_APPROVED")
      .every((row) => row.publication_authority_audit_id === null),
  );

  assert.deepEqual(
    admitted.release_jobs.map((job) => [job.kind, job.run_at]),
    [
      ["prestage_governed_youtube_release", "2026-07-27T07:50:00.000Z"],
      ["verify_governed_youtube_release_tminus15", "2026-07-27T08:45:00.000Z"],
      ["verify_governed_youtube_release_t0", SCHEDULED_FOR],
    ],
  );
  assert.equal(admitted.release_jobs[0].payload.external_posting, false);
  assert.equal(admitted.release_jobs[0].payload.private_only, true);
  assert.equal(
    admitted.release_jobs[1].payload.official_source_revalidation_required,
    true,
  );
  assert.equal(admitted.release_jobs[1].payload.publish_authority, false);
  assert.equal(admitted.release_jobs[2].payload.publish_authority, false);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM platform_posts").get().count,
    0,
  );
});

test("autonomous official admission requires the GREEN supplement lineage digest before any database write", async (t) => {
  const { db, repos, story } = fixture(t);
  const input = await autonomousAdmissionInput(repos, story);
  const authority = structuredClone(input.authority);
  delete authority.lineage.autonomous_green_supplement_sha256;

  await assert.rejects(
    admitAutonomousOfficialPublication({
      ...input,
      authority,
    }),
    /autonomous_publication_admission_lineage_fields_invalid/,
  );

  assert.deepEqual(
    {
      authority: db
        .prepare(
          "SELECT COUNT(*) AS count FROM publication_authority_audit_log",
        )
        .get().count,
      lifecycle: db
        .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
        .get().count,
      jobs: db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
    },
    {
      authority: 0,
      lifecycle: 0,
      jobs: 0,
    },
  );
});

test("autonomous official admission establishes the legacy story projection without fabricating human approval", async (t) => {
  const { db, repos, story } = fixture(t, {
    approved: 0,
  });
  const input = await autonomousAdmissionInput(repos, story);

  const admitted = await admitAutonomousOfficialPublication(input);

  assert.equal(admitted.admitted, true);
  const projected = db
    .prepare(
      `SELECT approved, auto_approved, approved_at, _extra
       FROM stories
       WHERE id = ?`,
    )
    .get(story.id);
  assert.equal(projected.approved, 1);
  assert.equal(projected.auto_approved, 1);
  assert.equal(projected.approved_at, input.authority.issued_at);
  const extra = JSON.parse(projected._extra);
  assert.deepEqual(extra.autonomous_publication_approval, {
    approval_type: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    authority_id: input.authority.authority_id,
    authority_sha256: input.authority.authority_sha256,
    approved_at: input.authority.issued_at,
  });
  assert.equal(
    /actor|operator|human/i.test(
      JSON.stringify(extra.autonomous_publication_approval),
    ),
    false,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get().count,
    0,
  );
});

test("autonomous official admission is exactly idempotent across its authority, lifecycle and governed release-job transaction", async (t) => {
  const { db, repos, story } = fixture(t);
  const input = await autonomousAdmissionInput(repos, story);

  const admitted = await admitAutonomousOfficialPublication(input);
  const replay = await admitAutonomousOfficialPublication(input);

  assert.deepEqual(replay, admitted);
  assert.deepEqual(
    {
      authority: db
        .prepare(
          "SELECT COUNT(*) AS count FROM publication_authority_audit_log",
        )
        .get().count,
      lifecycle: db
        .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
        .get().count,
      jobs: db
        .prepare(
          `SELECT COUNT(*) AS count FROM jobs
           WHERE kind IN (
             'prestage_governed_youtube_release',
             'verify_governed_youtube_release_tminus15',
             'verify_governed_youtube_release_t0'
           )`,
        )
        .get().count,
      operator: db
        .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
        .get().count,
    },
    {
      authority: 1,
      lifecycle: 9,
      jobs: 3,
      operator: 0,
    },
  );
});

test("an accepted autonomous operation rejects a newly issued authority with a changed immutable binding", async (t) => {
  const { db, repos, story } = fixture(t);
  const first = await autonomousAdmissionInput(repos, story);
  const changed = await autonomousAdmissionInput(repos, story, {
    authorityIssuedAt: "2026-07-27T08:55:01.000Z",
  });
  assert.notEqual(
    changed.authority.authority_sha256,
    first.authority.authority_sha256,
  );

  const admitted = await admitAutonomousOfficialPublication(first);
  await assert.rejects(
    admitAutonomousOfficialPublication(changed),
    /publication_idempotency_conflict/,
  );

  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM publication_authority_audit_log")
      .get().count,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT authority_binding_sha256 FROM publication_authority_audit_log",
      )
      .get().authority_binding_sha256,
    first.authority.authority_sha256,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
      .get().count,
    9,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count, 3);
  assert.equal(
    admitted.publication_authority_audit_id,
    db.prepare("SELECT id FROM publication_authority_audit_log").get().id,
  );
});

test("autonomous official admission fails closed when any authority, story, channel, lane, platform, schedule, runway, fingerprint or publication-evidence binding changes", async (t) => {
  const { db, repos, story } = fixture(t);
  const input = await autonomousAdmissionInput(repos, story);
  const changedEvidence = structuredClone(input.publicationEvidence);
  changedEvidence.publication_metadata.title =
    "A title outside the exact authority";
  const changedAuthority = structuredClone(input.authority);
  changedAuthority.runway_lock_sha256 = "b2".repeat(32);

  const cases = [
    {
      name: "authority",
      value: { ...input, authority: changedAuthority },
    },
    {
      name: "story",
      value: { ...input, storyId: "different-story" },
    },
    {
      name: "channel",
      value: { ...input, channelId: "stacked" },
    },
    {
      name: "lane",
      value: { ...input, laneId: "evergreen_short" },
    },
    {
      name: "platform",
      value: { ...input, platform: "instagram" },
    },
    {
      name: "schedule",
      value: {
        ...input,
        scheduledFor: "2026-07-27T19:00:00.000Z",
      },
    },
    {
      name: "runway",
      value: {
        ...input,
        runwayLockSha256: "b2".repeat(32),
      },
    },
    {
      name: "fingerprint",
      value: {
        ...input,
        requestFingerprint: "b3".repeat(32),
      },
    },
    {
      name: "publication evidence",
      value: {
        ...input,
        publicationEvidence: changedEvidence,
      },
    },
  ];

  for (const item of cases) {
    await assert.rejects(
      admitAutonomousOfficialPublication(item.value),
      undefined,
      item.name,
    );
  }

  assert.deepEqual(
    {
      authority: db
        .prepare(
          "SELECT COUNT(*) AS count FROM publication_authority_audit_log",
        )
        .get().count,
      lifecycle: db
        .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
        .get().count,
      jobs: db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
      operator: db
        .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
        .get().count,
    },
    {
      authority: 0,
      lifecycle: 0,
      jobs: 0,
      operator: 0,
    },
  );
});

test("autonomous official admission requires a fresh trusted clock and leaves no partial rows when authority freshness fails", async (t) => {
  const { db, repos, story } = fixture(t);
  const input = await autonomousAdmissionInput(repos, story);

  await assert.rejects(
    admitAutonomousOfficialPublication({
      ...input,
      clock: undefined,
    }),
    /autonomous_publication_admission_trusted_clock_required/,
  );
  await assert.rejects(
    admitAutonomousOfficialPublication({
      ...input,
      clock: () => new Date("2026-07-27T08:55:41.000Z"),
    }),
    /autonomous_publication_admission_authority_stale/,
  );

  assert.deepEqual(
    {
      authority: db
        .prepare(
          "SELECT COUNT(*) AS count FROM publication_authority_audit_log",
        )
        .get().count,
      lifecycle: db
        .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
        .get().count,
      jobs: db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
    },
    { authority: 0, lifecycle: 0, jobs: 0 },
  );
});

test("autonomous official admission rolls back authority, lifecycle and release jobs together when the transaction cannot complete", async (t) => {
  const { db, repos, story } = fixture(t);
  const input = await autonomousAdmissionInput(repos, story, {
    transactionCompletionCheck({
      authorityAudit,
      scheduledEvent,
      releaseJobs,
    }) {
      assert.equal(db.inTransaction, true);
      assert.ok(Number(authorityAudit.id) > 0);
      assert.ok(Number(scheduledEvent.id) > 0);
      assert.equal(releaseJobs.length, 3);
      throw new Error("simulated_autonomous_commit_failure");
    },
  });

  await assert.rejects(
    admitAutonomousOfficialPublication(input),
    /simulated_autonomous_commit_failure/,
  );

  assert.deepEqual(
    {
      authority: db
        .prepare(
          "SELECT COUNT(*) AS count FROM publication_authority_audit_log",
        )
        .get().count,
      lifecycle: db
        .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
        .get().count,
      state: db
        .prepare("SELECT COUNT(*) AS count FROM platform_publication_state")
        .get().count,
      jobs: db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
      operator: db
        .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
        .get().count,
    },
    {
      authority: 0,
      lifecycle: 0,
      state: 0,
      jobs: 0,
      operator: 0,
    },
  );
});

test("immutable publication evidence retains the exact reviewed metadata and official-source release bindings", () => {
  const publicationMetadata = { ...PUBLICATION_METADATA };
  const immutable = buildImmutablePublicationEvidence({
    evidence: completeEvidence({
      publication_metadata_sha256: publicationMetadata.sha256,
      publication_metadata: publicationMetadata,
    }),
    operatingMode: "LIVE_GUARDED",
  });

  assert.equal(
    immutable.publication_metadata_sha256,
    publicationMetadata.sha256,
  );
  assert.deepEqual(immutable.publication_metadata, publicationMetadata);
  assert.deepEqual(
    immutable.official_source_release_binding,
    OFFICIAL_SOURCE_BINDING,
  );
  assert.equal(
    require("../../publisher").readScheduledPublicationEvidence({
      publication_evidence: immutable,
    }).official_source_release_binding.binding_sha256,
    OFFICIAL_SOURCE_BINDING.binding_sha256,
  );
  assert.throws(
    () =>
      require("../../publisher").readScheduledPublicationEvidence({
        publication_evidence: {
          ...immutable,
          official_source_release_binding: {
            ...OFFICIAL_SOURCE_BINDING,
            source_url: "https://example.com/forged",
          },
        },
      }),
    /official_source_(?:release_binding|revision)_sha256_mismatch/,
  );
});

test("immutable publication evidence retains only an exact controlled-experiment observation bound to reviewed artefacts", () => {
  const gateInput = completeEvidence();
  const expectedIdentity = {
    story_id: "story-admission-1",
    channel_id: "pulse-gaming",
  };
  const expectedBindings = {
    story_intake_sha256: "a1".repeat(32),
    narration_manifest_sha256: "a2".repeat(32),
    renderer_manifest_file_sha256: "a3".repeat(32),
    renderer_manifest_canonical_sha256:
      gateInput.renderer_manifest_sha256,
    qa_report_sha256: gateInput.qa_report_sha256,
    media_sha256: gateInput.renderer_manifest.output.sha256,
    script_sha256: sha256(SCRIPT),
  };
  const observation = buildControlledExperimentObservation(
    {
      identity: expectedIdentity,
      experiment: {
        eligible: true,
        experiment_id: "pulse-v1-controlled-12",
        matrix_version: "pulse-controlled-12-v1",
        expected_cell_id:
          "what_changes_for_players:direct:standard",
        ineligibility_reason: null,
      },
      creative_static: {
        runtime_seconds: 37.2,
        hook_type: "direct",
        narrator_version: "elevenlabs:voice:model:1",
        first_frame_text: "XBOX JUST CHANGED",
        motion_ratio: 0.5,
        topic: "Xbox preservation",
        game: "Xbox classics",
        subject_platform: "Xbox",
        source_type: "official",
        consequence_lane: "what_changes_for_players",
        renderer_version: gateInput.renderer_manifest.renderer.version,
        qa_result: "pass",
      },
      bindings: expectedBindings,
    },
    { expectedIdentity, expectedBindings },
  );
  const evidence = {
    ...gateInput,
    controlled_experiment_observation: observation,
  };

  const immutable = buildImmutablePublicationEvidence({
    evidence,
    operatingMode: "LIVE_GUARDED",
    controlledExperimentExpectedIdentity: expectedIdentity,
    controlledExperimentExpectedBindings: expectedBindings,
  });
  assert.deepEqual(
    immutable.controlled_experiment_observation,
    observation,
  );

  assert.throws(
    () =>
      buildImmutablePublicationEvidence({
        evidence: {
          ...evidence,
          controlled_experiment_observation: {
            ...observation,
            creative_static: {
              ...observation.creative_static,
              first_frame_text: "FORGED OPENING",
            },
          },
        },
        operatingMode: "LIVE_GUARDED",
        controlledExperimentExpectedIdentity: expectedIdentity,
        controlledExperimentExpectedBindings: expectedBindings,
      }),
    /controlled_experiment_observation_sha256_mismatch/,
  );
});

test("operator admission binds an eligible experiment observation into the immutable scheduled event", async (t) => {
  const { repos } = fixture(t);
  const input = admissionInput(repos);
  const expectedIdentity = {
    story_id: input.storyId,
    channel_id: input.channelId,
  };
  const expectedBindings = {
    story_intake_sha256: "b1".repeat(32),
    narration_manifest_sha256: "b2".repeat(32),
    renderer_manifest_file_sha256: "b3".repeat(32),
    renderer_manifest_canonical_sha256:
      input.evidence.renderer_manifest_sha256,
    qa_report_sha256: input.evidence.qa_report_sha256,
    media_sha256:
      input.evidence.renderer_manifest.output.sha256,
    script_sha256: sha256(SCRIPT),
  };
  const observation = buildControlledExperimentObservation(
    {
      identity: expectedIdentity,
      experiment: {
        eligible: true,
        experiment_id: "pulse-v1-controlled-12",
        matrix_version: "pulse-controlled-12-v1",
        expected_cell_id:
          "what_changes_for_players:direct:standard",
        ineligibility_reason: null,
      },
      creative_static: {
        runtime_seconds: 37.2,
        hook_type: "direct",
        narrator_version: "elevenlabs:voice:model:1",
        first_frame_text: "XBOX JUST CHANGED",
        motion_ratio: 0.5,
        topic: "Xbox preservation",
        game: "Xbox classics",
        subject_platform: "Xbox",
        source_type: "official",
        consequence_lane: "what_changes_for_players",
        renderer_version:
          input.evidence.renderer_manifest.renderer.version,
        qa_result: "pass",
      },
      bindings: expectedBindings,
    },
    { expectedIdentity, expectedBindings },
  );
  input.evidence = {
    ...input.evidence,
    story_intake_sha256:
      expectedBindings.story_intake_sha256,
    narration_manifest_sha256:
      expectedBindings.narration_manifest_sha256,
    renderer_manifest_file_sha256:
      expectedBindings.renderer_manifest_file_sha256,
    controlled_experiment_observation: observation,
  };

  const admitted = await admitPublication(input);
  assert.equal(admitted.admitted, true, JSON.stringify(admitted));
  assert.deepEqual(
    admitted.publication_evidence
      .controlled_experiment_observation,
    observation,
  );
  const scheduled =
    repos.publicationGovernance.getLatestLifecycleEvent(
      input.storyId,
      input.platform,
      "SCHEDULED",
    );
  assert.deepEqual(
    JSON.parse(scheduled.evidence_json)
      .publication_evidence
      .controlled_experiment_observation,
    observation,
  );
});

test("operator admission atomically records exact evidence through SCHEDULED and exact replay is idempotent", async (t) => {
  const { db, repos, story } = fixture(t);
  const input = admissionInput(repos);
  const publicationEvidence = buildImmutablePublicationEvidence({
    evidence: input.evidence,
    operatingMode: "LIVE_GUARDED",
  });
  const expectedFingerprint = await fingerprintPublicationRequest(story, {
    channelId: input.channelId,
    platform: input.platform,
    channel: input.channel,
    publicationEvidence,
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
    evidenceByState.ASSETS_CLEARED.originality_transformation.verdict,
    "STRONG",
  );
  assert.equal(
    evidenceByState.ASSETS_CLEARED.rights_ledger.items[0].rights_basis,
    "OWNED",
  );
  assert.equal(
    evidenceByState.RENDERED.media_sha256,
    expectedFingerprint.media_sha256,
  );
  assert.equal(
    evidenceByState.RENDERED.renderer_manifest_sha256,
    input.evidence.renderer_manifest_sha256,
  );
  assert.equal(evidenceByState.RENDERED.renderer.id, "studio-v21");
  assert.equal(
    evidenceByState.QA_PASSED.qa_report_sha256,
    HASHES.qa_report_sha256,
  );
  assert.equal(
    evidenceByState.HUMAN_APPROVED.operator_decision_id,
    auditRows[0].id,
  );
  assert.equal(
    evidenceByState.HUMAN_APPROVED.synthetic_media_disclosure.decision,
    "DISCLOSE",
  );
  assert.equal(
    evidenceByState.SCHEDULED.request_fingerprint,
    expectedFingerprint.request_fingerprint,
  );
  assert.deepEqual(
    evidenceByState.SCHEDULED.publication_evidence,
    publicationEvidence,
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

test("operator admission commits SCHEDULED and the exact T-70, T-15 and T0 release jobs in the same transaction", async (t) => {
  const { db, repos } = fixture(t);
  const input = admissionInput(repos, {
    dispatchJob: {
      laneId: "breaking_short",
      priority: 6,
      maxAttempts: 3,
    },
  });

  const admitted = await admitPublication(input);
  const replay = await admitPublication(input);

  assert.equal(admitted.admitted, true);
  assert.deepEqual(replay, admitted);
  assert.equal(
    admitted.dispatch_job.kind,
    "verify_governed_youtube_release_t0",
  );
  assert.equal(admitted.dispatch_job.run_at, SCHEDULED_FOR);
  assert.equal(
    admitted.dispatch_job.idempotency_key,
    `verify-public:youtube:${admitted.scheduled_event_id}:` +
      admitted.request_fingerprint,
  );
  assert.equal(
    admitted.dispatch_job.payload.scheduled_event_id,
    admitted.scheduled_event_id,
  );
  assert.equal(admitted.dispatch_job.payload.runway_lock_sha256, undefined);

  assert.deepEqual(
    admitted.release_jobs.map((job) => [job.kind, job.run_at]),
    [
      ["prestage_governed_youtube_release", "2026-07-27T07:50:00.000Z"],
      ["verify_governed_youtube_release_tminus15", "2026-07-27T08:45:00.000Z"],
      ["verify_governed_youtube_release_t0", SCHEDULED_FOR],
    ],
  );
  const t70 = admitted.release_jobs[0].payload;
  assert.equal(t70.private_prestage_authority, true);
  assert.equal(t70.private_only, true);
  assert.equal(t70.scheduled_release_authority, false);
  assert.equal(t70.publish_authority, false);
  const t15 = admitted.release_jobs[1].payload;
  assert.equal(t15.scheduled_release_authority, true);
  assert.equal(t15.arm_private_schedule_once, true);
  assert.equal(t15.official_source_revalidation_required, true);
  assert.equal(t15.catch_up_allowed, false);
  assert.equal(t15.publish_authority, false);
  const jobs = db
    .prepare(
      `SELECT * FROM jobs
       WHERE kind IN (
         'prestage_governed_youtube_release',
         'verify_governed_youtube_release_tminus15',
         'verify_governed_youtube_release_t0'
       )
       ORDER BY run_at`,
    )
    .all();
  assert.equal(jobs.length, 3);
  assert.equal(jobs[2].id, admitted.dispatch_job.id);
  assert.deepEqual(
    jobs.map((job) => job.max_attempts),
    [3, 3, 16],
  );
  assert.equal(jobs[2].run_at, "2026-07-27 09:00:00");
  assert.equal(JSON.parse(jobs[2].payload).scheduled_for, SCHEDULED_FOR);
});

test("confirmed-disarm reserve admission accepts only the typed T-60-to-T-15 recovery interval", async (t) => {
  const { repos } = fixture(t);
  const promotionSha256 = "a".repeat(64);
  const admitted = await admitPublication(
    admissionInput(repos, {
      now: new Date("2026-07-27T08:05:00.000Z"),
      runwayLockSha256: "9".repeat(64),
      dispatchJob: {
        laneId: "breaking_short",
        priority: 1,
        maxAttempts: 3,
        promotedReserve: true,
        promotionSha256,
        promotionAuthorityType: "CONFIRMED_DISARM_FAILOVER",
        prestageRunAt: "2026-07-27T08:05:00.000Z",
      },
    }),
  );

  assert.equal(admitted.admitted, true);
  assert.equal(admitted.release_jobs[0].run_at, "2026-07-27T08:05:00.000Z");
  assert.equal(
    admitted.release_jobs[0].payload.phase,
    "CONFIRMED_DISARM_FAILOVER_PRESTAGE",
  );
  assert.equal(
    admitted.release_jobs[0].payload.reserve_promotion_authority_type,
    "CONFIRMED_DISARM_FAILOVER",
  );
  assert.equal(
    admitted.release_jobs[0].payload.reserve_promotion_sha256,
    promotionSha256,
  );
});

test("confirmed-disarm reserve admission rolls back when prestage reaches T-15", async (t) => {
  const { db, repos } = fixture(t);

  await assert.rejects(
    admitPublication(
      admissionInput(repos, {
        now: new Date("2026-07-27T08:45:00.000Z"),
        runwayLockSha256: "9".repeat(64),
        dispatchJob: {
          laneId: "breaking_short",
          priority: 1,
          maxAttempts: 3,
          promotedReserve: true,
          promotionSha256: "a".repeat(64),
          promotionAuthorityType: "CONFIRMED_DISARM_FAILOVER",
          prestageRunAt: "2026-07-27T08:45:00.000Z",
        },
      }),
    ),
    /publication_promoted_reserve_outside_failover_window/,
  );
  assertNoAdmissionRows(db);
});

test("a dispatch enqueue failure after SCHEDULED rolls back the entire admission transaction", async (t) => {
  const { db, repos } = fixture(t);
  let enqueueCalls = 0;
  const failingRepos = {
    ...repos,
    jobs: {
      enqueueInTransaction() {
        enqueueCalls += 1;
        assert.equal(db.inTransaction, true);
        assert.equal(
          db
            .prepare(
              `SELECT COUNT(*) AS count
               FROM publication_lifecycle_events
               WHERE to_state = 'SCHEDULED'`,
            )
            .get().count,
          1,
        );
        throw new Error("simulated_crash_after_scheduled");
      },
    },
  };

  await assert.rejects(
    admitPublication(
      admissionInput(failingRepos, {
        dispatchJob: {
          laneId: "breaking_short",
          priority: 6,
          maxAttempts: 3,
        },
      }),
    ),
    /simulated_crash_after_scheduled/,
  );

  assert.equal(enqueueCalls, 1);
  assertNoAdmissionRows(db);
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM jobs
         WHERE kind IN (
           'prestage_governed_youtube_release',
           'verify_governed_youtube_release_tminus15',
           'verify_governed_youtube_release_t0'
         )`,
      )
      .get().count,
    0,
  );
});

test("operator admission binds the exact runway lock hash into immutable SCHEDULED evidence", async (t) => {
  const { repos } = fixture(t);
  const runwayLockSha256 = "9".repeat(64);
  const admitted = await admitPublication(
    admissionInput(repos, {
      runwayLockSha256,
    }),
  );

  assert.equal(admitted.admitted, true);
  assert.equal(admitted.runway_lock_sha256, runwayLockSha256);
  const scheduled = repos.publicationGovernance.getLatestLifecycleEvent(
    admitted.story_id,
    "youtube",
    "SCHEDULED",
  );
  const evidence = JSON.parse(scheduled.evidence_json);
  assert.equal(evidence.runway_lock_sha256, runwayLockSha256);
});

test("a cancelled pre-dispatch admission can be admitted into one fresh schedule", async (t) => {
  const { db, repos } = fixture(t);
  const first = await admitPublication(admissionInput(repos));
  const scheduled = repos.publicationGovernance.getLatestLifecycleEvent(
    first.story_id,
    "youtube",
    "SCHEDULED",
  );
  const scheduledEvidence = JSON.parse(scheduled.evidence_json);
  const repairDecision = repos.publicationGovernance.recordOperatorDecision({
    actorId: "operator-1",
    action: "repair_governed_reviewed_qa_refusal",
    targetType: "platform_publication",
    targetId: `${first.story_id}:youtube`,
    decision: "APPROVED",
    reason: "Reviewed QA repair proved no create boundary was entered",
    evidence: {
      scheduled_event_id: scheduled.id,
      dispatch_idempotency_key: scheduledEvidence.dispatch_idempotency_key,
      request_fingerprint: scheduledEvidence.request_fingerprint,
      create_boundary_entered: false,
    },
    idempotencyKey: "qa-repair:story-admission-1:decision",
  });
  repos.publicationGovernance.cancelScheduledAdmissionBeforeDispatch({
    storyId: first.story_id,
    platform: "youtube",
    channelId: "pulse-gaming",
    scheduledEventId: scheduled.id,
    scheduledDispatchIdempotencyKey: scheduledEvidence.dispatch_idempotency_key,
    requestFingerprint: scheduledEvidence.request_fingerprint,
    actorId: "operator-1",
    operatorDecisionId: repairDecision.id,
    now: new Date("2026-07-27T09:16:01.000Z"),
    evidence: {
      create_boundary_entered: false,
      external_object_created: false,
    },
    idempotencyKey: "qa-repair:story-admission-1:cancel",
  });

  const readmitted = await admitPublication(
    admissionInput(repos, {
      scheduledFor: "2026-07-27T19:00:00.000Z",
      now: new Date("2026-07-27T18:55:00.000Z"),
      reason: "Fresh schedule after governed pre-create QA repair",
    }),
  );

  assert.equal(readmitted.admitted, true);
  assert.equal(readmitted.lifecycle_state, "SCHEDULED");
  assert.equal(readmitted.scheduled_for, "2026-07-27T19:00:00.000Z");
  assert.notEqual(
    readmitted.dispatch_idempotency_key,
    first.dispatch_idempotency_key,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT to_state
         FROM publication_lifecycle_events
         WHERE story_id = ? AND platform = 'youtube'
         ORDER BY id`,
      )
      .all(first.story_id)
      .slice(-2)
      .map((row) => row.to_state),
    ["ADMISSION_CANCELLED_BEFORE_DISPATCH", "SCHEDULED"],
  );
});

test("admission rejects a relative publication-metadata path without writing governance rows", async (t) => {
  const { db, repos } = fixture(t);
  const relativePath = path.join(".", "relative-publication-metadata.json");

  const result = await admitPublication(
    admissionInput(repos, {
      evidence: completeEvidence({
        publication_metadata: {
          ...PUBLICATION_METADATA,
          path: relativePath,
        },
      }),
    }),
  );

  assert.equal(result.admitted, false);
  assert.ok(
    result.blockers.includes(
      "publication_metadata_canonical_absolute_path_required",
    ),
  );
  assertNoAdmissionRows(db);
});

test("admission rejects a missing publication-metadata file without writing governance rows", async (t) => {
  const { db, mediaPath, repos } = fixture(t);
  const missingPath = path.join(
    path.dirname(mediaPath),
    "missing-publication-metadata.json",
  );

  const result = await admitPublication(
    admissionInput(repos, {
      evidence: completeEvidence({
        publication_metadata: {
          ...PUBLICATION_METADATA,
          path: missingPath,
        },
      }),
    }),
  );

  assert.equal(result.admitted, false);
  assert.ok(result.blockers.includes("publication_metadata_file_required"));
  assertNoAdmissionRows(db);
});

test("admission rejects drifted publication-metadata bytes without writing governance rows", async (t) => {
  const { db, mediaPath, repos } = fixture(t);
  const driftedPath = path.join(
    path.dirname(mediaPath),
    "drifted-publication-metadata.json",
  );
  fs.writeFileSync(
    driftedPath,
    Buffer.concat([PUBLICATION_METADATA_BYTES, Buffer.from(" ")]),
  );

  const result = await admitPublication(
    admissionInput(repos, {
      evidence: completeEvidence({
        publication_metadata: {
          ...PUBLICATION_METADATA,
          path: driftedPath,
        },
      }),
    }),
  );

  assert.equal(result.admitted, false);
  assert.ok(result.blockers.includes("publication_metadata_sha256_mismatch"));
  assertNoAdmissionRows(db);
});

test("admission rejects a mutable metadata snapshot that differs from the approved file", async (t) => {
  const { db, repos } = fixture(t);

  const result = await admitPublication(
    admissionInput(repos, {
      evidence: completeEvidence({
        publication_metadata: {
          ...PUBLICATION_METADATA,
          title: "A replacement title that was never approved",
        },
      }),
    }),
  );

  assert.equal(result.admitted, false);
  assert.ok(result.blockers.includes("publication_metadata_binding_mismatch"));
  assertNoAdmissionRows(db);
});

test("a changed request cannot reuse an admitted operation identity or append partial history", async (t) => {
  const { db, mediaPath, repos } = fixture(t);
  const input = admissionInput(repos);
  const admitted = await admitPublication(input);
  fs.writeFileSync(mediaPath, "changed-after-operator-approval");

  const changed = await admitPublication(input);
  assert.equal(changed.admitted, false);
  assert.ok(changed.blockers.includes("renderer_media_hash_mismatch"));

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

test("metadata-only replay cannot reuse an admitted operation identity", async (t) => {
  const { db, mediaPath, repos } = fixture(t);
  const input = admissionInput(repos);
  const admitted = await admitPublication(input);
  const replacementValue = {
    ...PUBLICATION_METADATA_VALUE,
    title: "A different valid title for the same scheduled operation",
  };
  const replacementBytes = Buffer.from(
    `${JSON.stringify(replacementValue, null, 2)}\n`,
  );
  const replacementPath = path.join(
    path.dirname(mediaPath),
    "replacement-publication-metadata.json",
  );
  fs.writeFileSync(replacementPath, replacementBytes);
  const replacementMetadata = {
    path: replacementPath,
    sha256: sha256(replacementBytes),
    platform: replacementValue.platform,
    title: replacementValue.title,
    description: replacementValue.description,
  };

  await assert.rejects(
    () =>
      admitPublication(
        admissionInput(repos, {
          evidence: completeEvidence({
            publication_metadata_sha256: replacementMetadata.sha256,
            publication_metadata: replacementMetadata,
          }),
        }),
      ),
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
  const scheduled = JSON.parse(
    db
      .prepare(
        `SELECT evidence_json
         FROM publication_lifecycle_events
         WHERE story_id = ? AND platform = 'youtube'
           AND to_state = 'SCHEDULED'`,
      )
      .get("story-admission-1").evidence_json,
  );
  assert.equal(scheduled.request_fingerprint, admitted.request_fingerprint);
  assert.equal(
    scheduled.publication_evidence.publication_metadata_sha256,
    PUBLICATION_METADATA.sha256,
  );
  assert.equal(
    scheduled.publication_evidence.publication_metadata.path,
    PUBLICATION_METADATA.path,
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

test("operator admission accepts an exact one-shot outside-cadence authorisation and records it immutably", async (t) => {
  const { db, repos } = fixture(t);
  const authorisationId = "thread-019f6282-asap-youtube-one-shot";

  const result = await admitPublication(
    admissionInput(repos, {
      scheduledFor: "2026-07-27T10:00:00.000Z",
      now: new Date("2026-07-27T09:55:00.000Z"),
      outsideCadenceAuthorisation: {
        authorisationId,
        confirmAuthorisationId: authorisationId,
        oneShotConfirmed: true,
      },
    }),
  );

  assert.equal(result.admitted, true);
  const expectedAuthorisation = {
    schema_version: "pulse-outside-cadence-authorisation-v1",
    authorisation_id: authorisationId,
    confirmed_authorisation_id: authorisationId,
    one_shot: true,
    basis: "explicit_operator_goal_authorisation",
    story_id: "story-admission-1",
    channel_id: "pulse-gaming",
    platform: "youtube",
    scheduled_for: "2026-07-27T10:00:00.000Z",
    authorised_at: "2026-07-27T09:55:00.000Z",
    dispatch_idempotency_key:
      "youtube:story-admission-1:2026-07-27T10:00:00.000Z",
    request_fingerprint: result.request_fingerprint,
  };
  assert.deepEqual(result.outside_cadence_authorisation, {
    ...expectedAuthorisation,
    binding_sha256: fingerprintOutsideCadenceAuthorisation(
      expectedAuthorisation,
    ),
  });
  const scheduled = JSON.parse(
    db
      .prepare(
        `SELECT evidence_json
         FROM publication_lifecycle_events
         WHERE story_id = ? AND platform = 'youtube' AND to_state = 'SCHEDULED'`,
      )
      .get("story-admission-1").evidence_json,
  );
  assert.deepEqual(
    scheduled.outside_cadence_authorisation,
    result.outside_cadence_authorisation,
  );
  const audit = JSON.parse(
    db
      .prepare(
        `SELECT evidence_json FROM operator_audit_log
         WHERE target_id = 'story-admission-1:youtube'`,
      )
      .get().evidence_json,
  );
  assert.deepEqual(
    audit.outside_cadence_authorisation,
    result.outside_cadence_authorisation,
  );
});

test("operator admission rejects mismatched outside-cadence authorisation without partial rows", async (t) => {
  const { db, repos } = fixture(t);

  const result = await admitPublication(
    admissionInput(repos, {
      scheduledFor: "2026-07-27T10:00:00.000Z",
      now: new Date("2026-07-27T09:55:00.000Z"),
      outsideCadenceAuthorisation: {
        authorisationId: "thread-authorisation-a",
        confirmAuthorisationId: "thread-authorisation-b",
        oneShotConfirmed: true,
      },
    }),
  );

  assert.equal(result.admitted, false);
  assert.ok(
    result.blockers.includes("exact_outside_cadence_authorisation_required"),
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
      name: "missing reviewed publication metadata",
      storyOverrides: {},
      inputOverrides: {
        evidence: completeEvidence({
          publication_metadata_sha256: undefined,
          publication_metadata: undefined,
        }),
      },
      blockers: ["publication_metadata_hash_required"],
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

test("admission binds transformation, per-item rights and synthetic disclosure decisions", async (t) => {
  const weak = completeEvidence({
    originality_transformation: {
      verdict: "WEAK",
      rationale: "This edit is too close to a narrated source summary.",
      evidence_ref: "output/qa/weak.json",
      evidence_sha256: "7".repeat(64),
    },
  });
  const attributionLedger = structuredClone(RIGHTS_LEDGER);
  attributionLedger.items[0].rights_basis = "ATTRIBUTION_ONLY";
  attributionLedger.items[0].attribution_decision = "REQUIRED_AND_SUPPLIED";
  attributionLedger.items[0].attribution_text = "Credit: publisher";

  const cases = [
    {
      name: "weak transformation",
      evidence: weak,
      blocker: "originality_transformation_weak",
    },
    {
      name: "attribution presented as permission",
      evidence: completeEvidence({
        rights_ledger: attributionLedger,
        rights_ledger_sha256: hashRightsLedger(attributionLedger),
      }),
      blocker: "attribution_is_not_permission",
    },
    {
      name: "missing synthetic decision",
      evidence: completeEvidence({
        synthetic_media_disclosure: undefined,
      }),
      blocker: "synthetic_media_presence_decision_required",
    },
  ];

  for (const item of cases) {
    const { db, repos } = fixture(t);
    const result = await admitPublication(
      admissionInput(repos, { evidence: item.evidence }),
    );
    assert.equal(result.admitted, false, item.name);
    assert.ok(
      result.blockers.includes(item.blocker),
      `${item.name}: ${item.blocker}`,
    );
    assertNoAdmissionRows(db);
  }
});

test("admission requires the active governed renderer and exact final media", async (t) => {
  const experimental = rendererManifest();
  experimental.renderer = {
    id: EXPERIMENTAL_RENDERER_ID,
    role: "experimental",
    version: "0.1.0",
  };
  const thinMotion = rendererManifest();
  thinMotion.motion = {
    ...thinMotion.motion,
    exact_subject_clip_count: 0,
    exact_subject_still_motion_count: 0,
  };
  const wrongMedia = rendererManifest();
  wrongMedia.output = {
    ...wrongMedia.output,
    sha256: "9".repeat(64),
  };

  const cases = [
    {
      name: "experimental renderer",
      evidence: completeEvidence({ renderer_manifest: experimental }),
      blocker: "experimental_renderer_not_publishable",
    },
    {
      name: "missing exact-subject motion",
      evidence: completeEvidence({ renderer_manifest: thinMotion }),
      blocker: "exact_subject_motion_missing",
    },
    {
      name: "renderer describes different final media",
      evidence: completeEvidence({ renderer_manifest: wrongMedia }),
      blocker: "renderer_media_hash_mismatch",
    },
  ];

  for (const item of cases) {
    const { db, repos } = fixture(t);
    const result = await admitPublication(
      admissionInput(repos, { evidence: item.evidence }),
    );
    assert.equal(result.admitted, false, item.name);
    assert.ok(
      result.blockers.includes(item.blocker),
      `${item.name}: ${item.blocker}`,
    );
    assertNoAdmissionRows(db);
  }
});
