"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const Database = require("better-sqlite3");

const {
  admitPublication,
  buildImmutablePublicationEvidence,
  fingerprintOutsideCadenceAuthorisation,
} = require("../../lib/services/publication-admission");
const {
  fingerprintPublicationRequest,
} = require("../../lib/services/publication-request-fingerprint");
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
  AUTO_PUBLISH: "true",
  PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
  USE_JOB_QUEUE: "true",
  USE_SQLITE: "true",
  PULSE_PRIMARY_INSTANCE: "true",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
      evidence_ref:
        "output/qa/story-admission-1-transformation-evidence.json",
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

test("immutable publication evidence retains the exact reviewed metadata binding", () => {
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
  assert.deepEqual(
    immutable.publication_metadata,
    publicationMetadata,
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
  assert.equal(
    evidenceByState.RENDERED.renderer.id,
    "studio-v21",
  );
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

test("admission rejects a relative publication-metadata path without writing governance rows", async (t) => {
  const { db, repos } = fixture(t);
  const relativePath = path.relative(
    process.cwd(),
    PUBLICATION_METADATA.path,
  );

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
  assert.ok(
    result.blockers.includes("publication_metadata_file_required"),
  );
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
  assert.ok(
    result.blockers.includes(
      "publication_metadata_sha256_mismatch",
    ),
  );
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
  assert.ok(
    result.blockers.includes("publication_metadata_binding_mismatch"),
  );
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
            publication_metadata_sha256:
              replacementMetadata.sha256,
            publication_metadata: replacementMetadata,
          }),
        }),
      ),
    /publication_idempotency_conflict/,
  );

  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
      .count,
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
  assert.equal(
    scheduled.request_fingerprint,
    admitted.request_fingerprint,
  );
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
    binding_sha256:
      fingerprintOutsideCadenceAuthorisation(
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
    result.blockers.includes(
      "exact_outside_cadence_authorisation_required",
    ),
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
  attributionLedger.items[0].attribution_decision =
    "REQUIRED_AND_SUPPLIED";
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
