"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bindRepositories } = require("../../lib/repositories");
const { handlers } = require("../../lib/job-handlers");
const {
  admitAutonomousGovernedWindowCandidate,
  authoriseGovernedWindowCandidate,
  prepareGovernedWindowCandidateAuthority,
} = require("../../lib/services/governed-youtube-window-candidate-authority");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const {
  canonicalSha256,
  createAutonomousWindowEligibilityAttestation,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  STATIC_ARTIFACT_FIELDS,
  createAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const SCHEDULED_FOR = "2026-07-29T19:00:00.000Z";
const AUTHORISED_AT = new Date("2026-07-29T12:00:00.000Z");
const T90_AT = new Date("2026-07-29T17:30:00.000Z");

const HASH = Object.freeze({
  media: "1".repeat(64),
  script: "2".repeat(64),
  qa: "3".repeat(64),
  rights: "4".repeat(64),
  source: "5".repeat(64),
});
const AUTONOMOUS_AUTHORITY_TYPE = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";

function migratedFixture() {
  const db = new Database(":memory:");
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
  return { db, repos: bindRepositories(db) };
}

function addReviewedStory(
  db,
  {
    storyId,
    title = "An exact reviewed gaming story",
    score = 100,
    hashes = HASH,
    legacyEvidence = false,
  },
) {
  db.prepare(
    `INSERT INTO stories
       (id, title, full_script, approved, auto_approved,
        exported_path, audio_path, breaking_score, score,
        channel_id, publish_status, youtube_post_id, _extra)
     VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?, 'pulse-gaming', '', '', ?)`,
  ).run(
    storyId,
    title,
    "This is a complete, exact and human-reviewed narration script.",
    `D:/pulse-data/${storyId}.mp4`,
    `D:/pulse-data/${storyId}.mp3`,
    score,
    score,
    JSON.stringify({ breaking_fast_track: true }),
  );
  const claimText = `Official release evidence for ${storyId}.`;
  const claimTextSha256 = crypto
    .createHash("sha256")
    .update(claimText)
    .digest("hex");
  const sourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    story_id: storyId,
    source_url: `https://example.com/news/${storyId}`,
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
      source_url: `https://example.com/news/${storyId}`,
      source_id: `official:${storyId}`,
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
    story_id: storyId,
    channel_id: "pulse-gaming",
    media_sha256: hashes.media,
    script_sha256: hashes.script,
    qa_report_sha256: hashes.qa,
    rights_ledger_sha256: hashes.rights,
    source_evidence_sha256: hashes.source,
    official_source_release_binding: buildOfficialSourceReleaseBinding({
      storyId,
      sourceEvidenceSha256: hashes.source,
      sourceEvidence,
    }),
  };
  const evidence = {
    schema_version: "pulse-final-publication-review-v1",
    story_id: storyId,
    channel_id: "pulse-gaming",
    media_sha256: hashes.media,
    script_sha256: hashes.script,
    source_evidence: {
      path: `D:/pulse-data/${storyId}.source.json`,
      sha256: hashes.source,
    },
    qa_report: {
      path: `D:/pulse-data/${storyId}.qa.json`,
      sha256: hashes.qa,
      verdict: "PASS",
    },
    rights_ledger: {
      path: `D:/pulse-data/${storyId}.rights.json`,
      canonical_sha256: hashes.rights,
    },
    final_mp4: {
      path: `D:/pulse-data/${storyId}.mp4`,
      sha256: hashes.media,
    },
    ...(!legacyEvidence
      ? {
          admission_evidence: admissionEvidence,
          admission_evidence_sha256: canonicalSha256(admissionEvidence),
        }
      : {}),
  };
  const result = db
    .prepare(
      `INSERT INTO operator_audit_log
         (actor_id, action, target_type, target_id, decision,
          reason, evidence_json, idempotency_key)
       VALUES
         ('render-editor', 'governed_publication_review', 'story', ?,
          'HUMAN_RENDER_APPROVED', 'Reviewed exact final render', ?, ?)`,
    )
    .run(
      storyId,
      JSON.stringify(evidence),
      `review:${storyId}:${hashes.media}`,
    );
  return {
    reviewAuditId: Number(result.lastInsertRowid),
    evidence,
  };
}

function addAutonomousStory(db, storyId) {
  db.prepare(
    `INSERT INTO stories
       (id, title, full_script, approved, auto_approved,
        exported_path, audio_path, breaking_score, score,
        channel_id, publish_status, youtube_post_id, _extra)
     VALUES (?, ?, ?, 1, 1, ?, ?, 100, 100,
             'pulse-gaming', '', '', ?)`,
  ).run(
    storyId,
    "A low-risk official-source breaking story",
    "This is the exact evidence-bound narration script.",
    `D:/pulse-data/${storyId}.mp4`,
    `D:/pulse-data/${storyId}.mp3`,
    JSON.stringify({ breaking_fast_track: true }),
  );
}

function autonomousPublicationAuthority(storyId, overrides = {}) {
  const claimText = `Official release evidence for ${storyId}.`;
  const claimTextSha256 = crypto
    .createHash("sha256")
    .update(claimText)
    .digest("hex");
  const sourceEvidence = {
    schema_version: "pulse-source-evidence-v1",
    story_id: storyId,
    source_url: `https://example.com/news/${storyId}`,
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
      source_url: `https://example.com/news/${storyId}`,
      source_id: `official:${storyId}`,
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
  const publicationEvidence = {
    schema_version: "pulse-publication-evidence-v1",
    source_evidence_sha256: HASH.source,
    official_source_release_binding: buildOfficialSourceReleaseBinding({
      storyId,
      sourceEvidenceSha256: HASH.source,
      sourceEvidence,
    }),
    qa_report_sha256: HASH.qa,
    publication_metadata_sha256: "6".repeat(64),
    publication_metadata: {
      path: `D:/pulse-data/${storyId}.youtube.json`,
      sha256: "6".repeat(64),
      platform: "youtube_shorts",
      title: "The official player-facing change",
      description: "Verified against the official source.",
    },
    originality_transformation: {
      verdict: "PASS",
      rationale: "Original player-impact analysis.",
      evidence_ref: `D:/pulse-data/${storyId}.originality.json`,
      evidence_sha256: "7".repeat(64),
    },
    rights_ledger_sha256: HASH.rights,
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      synthetic_disclosure_required: true,
      decision: "DISCLOSE",
      operator_decision: "DISCLOSE",
      rationale: "Synthetic narration is used.",
      reason: "Synthetic narration is used.",
      disclosure_text: "Includes synthetic narration.",
      policy_basis: null,
      youtube_field_value: true,
      reviewed_at: "2026-07-29T11:59:00.000Z",
    },
    renderer_manifest_sha256: "8".repeat(64),
    renderer: {
      id: "studio-v21",
      role: "standard",
      version: "21.0.0",
    },
  };
  const claims = {
    verifier_id: "pulse-autonomous-official-publication-authority-v1",
    issued_at: "2026-07-29T11:59:30.000Z",
    valid_until: "2026-07-29T12:01:00.000Z",
    decision: "APPROVED",
    authority_type: AUTONOMOUS_AUTHORITY_TYPE,
    authority_scope: "PUBLICATION_ADMISSION_ONLY",
    human_approval: false,
    may_impersonate_human: false,
    operational_publish_authority: false,
    dispatch_authorised: false,
    external_publish_authorised: false,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    runway_lock_sha256: "9".repeat(64),
    dispatch_idempotency_key: `youtube:${storyId}:${SCHEDULED_FOR}`,
    request_fingerprint: "a".repeat(64),
    source_report: {
      path: `D:/pulse-data/${storyId}.autonomous-report.json`,
      file_sha256: "b".repeat(64),
      report_sha256: "c".repeat(64),
      request_sha256: "d".repeat(64),
      generated_at: "2026-07-29T11:59:20.000Z",
      valid_until: "2026-07-29T12:02:00.000Z",
    },
    lineage: {
      story_intake_sha256: "e".repeat(64),
      source_evidence_sha256: HASH.source,
      script_sha256: HASH.script,
      owned_motion_manifest_sha256: "f".repeat(64),
      narration_audio_sha256: "0".repeat(64),
      narration_manifest_sha256: "1a".repeat(32),
      final_composite_manifest_sha256: "2b".repeat(32),
      renderer_manifest_file_sha256: "3c".repeat(32),
      renderer_manifest_canonical_sha256: "8".repeat(64),
      qa_report_sha256: HASH.qa,
      multimodal_visual_qa_sha256: "4d".repeat(32),
      media_sha256: HASH.media,
      publication_metadata_sha256: "6".repeat(64),
      rights_ledger_sha256: HASH.rights,
    },
    publication_evidence: publicationEvidence,
    admission_controls: {
      kill_switch_proof_sha256: "5e".repeat(32),
      kill_switch_checked_at: "2026-07-29T11:59:40.000Z",
      single_owner_proof_sha256: "6f".repeat(32),
      single_owner_checked_at: "2026-07-29T11:59:45.000Z",
    },
    required_release_boundary: {
      boundary: "T_MINUS_15",
      official_source_revalidation_required: true,
      kill_switch_revalidation_required: true,
      single_owner_revalidation_required: true,
      exact_binding_revalidation_required: true,
      max_control_age_ms: 60000,
      disarm_on_failure: true,
    },
    single_use: true,
    ...overrides,
  };
  const authorityBody = {
    authority_id: [
      "autonomous-official-publication",
      canonicalSha256(claims),
    ].join(":"),
    ...claims,
  };
  return {
    ...authorityBody,
    authority_sha256: canonicalSha256(authorityBody),
  };
}

function autonomousJitPreparation(storyId, role = "PRIMARY") {
  return createAutonomousOfficialJitPreparationManifest({
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role,
    candidate_revision_sha256: "6".repeat(64),
    request_fingerprint: "7".repeat(64),
    artifacts: Object.fromEntries(
      STATIC_ARTIFACT_FIELDS.map((field, index) => [
        field,
        {
          path: `D:/pulse-data/${storyId}/${field}`,
          sha256: (index + 16).toString(16).padStart(2, "0").repeat(32),
        },
      ]),
    ),
    owned_visual_assets: [],
    publication_evidence_gate_input: {
      originality_transformation: {
        verdict: "STRONG",
        rationale: "Original player-impact reporting.",
      },
      rights_ledger: {
        ledger_version: 1,
        decision: "CLEARED",
        items: [],
      },
      rights_ledger_sha256: HASH.rights,
      synthetic_media_disclosure: {
        decision_authority: "SYSTEM_POLICY",
        decision_provenance: {
          policy_id: "pulse-youtube-synthetic-disclosure",
          policy_version: "1",
          evaluated_at: T90_AT.toISOString(),
          evidence_sha256: "8".repeat(64),
        },
        altered_content: true,
        policy_basis: "DISCLOSE",
        youtube_field_value: true,
      },
    },
  });
}

function autonomousEligibilityApproval(
  storyId,
  role = "PRIMARY",
  overrides = {},
) {
  const authority = autonomousPublicationAuthority(storyId);
  const jitPreparation =
    overrides.jit_preparation || autonomousJitPreparation(storyId, role);
  const greenAdmission = {
    result_schema_version: "pulse-autonomous-green-admission-result-v2",
    evaluator_schema_version: "pulse-autonomous-green-admission-evaluator-v2",
    policy_version: "pulse-autonomous-green-policy-v2",
    decision_scope: "EDITORIAL_ELIGIBILITY_ONLY",
    operational_publish_authority: false,
    trust_semantics: "AUTHORITATIVE_MATERIALISER_REQUIRED",
    dispatch_revalidation_required: true,
    evaluated_at: "2026-07-29T17:29:00.000Z",
    valid_until: overrides.valid_until || "2026-07-29T17:50:00.000Z",
    story_id: storyId,
    final_mp4_sha256: HASH.media,
    verdict: "GREEN",
    eligible: true,
    blockers: [],
    evidence_sha256: "7d".repeat(32),
  };
  greenAdmission.decision_sha256 = canonicalSha256(greenAdmission);
  const attestation = createAutonomousWindowEligibilityAttestation({
    now: overrides.now || T90_AT,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role,
    evidence_hashes: {
      media_sha256: HASH.media,
      script_sha256: HASH.script,
      qa_report_sha256: HASH.qa,
      rights_ledger_sha256: HASH.rights,
      source_evidence_sha256: HASH.source,
    },
    source_report: {
      ...authority.source_report,
      generated_at: "2026-07-29T17:29:00.000Z",
      valid_until: overrides.valid_until || "2026-07-29T17:50:00.000Z",
    },
    green_admission: greenAdmission,
    jit_preparation: jitPreparation,
  });
  return {
    type: AUTONOMOUS_AUTHORITY_TYPE,
    eligibilityAttestation: overrides.attestation || attestation,
    jitPreparation,
  };
}

function exactAuthorisationInput(prepared, overrides = {}) {
  return {
    ...prepared.request,
    confirmStoryId: prepared.authority.story_id,
    confirmRole: prepared.authority.role,
    confirmScheduledFor: prepared.authority.scheduled_for,
    confirmAuthorityBindingSha256: prepared.authority.authority_binding_sha256,
    ...overrides,
  };
}

test("candidate authority rejects a legacy review audit without exact nested admission evidence", () => {
  const { db, repos } = migratedFixture();
  try {
    const { reviewAuditId } = addReviewedStory(db, {
      storyId: "legacy-review-without-admission-evidence",
      legacyEvidence: true,
    });
    assert.throws(
      () =>
        prepareGovernedWindowCandidateAuthority({
          repos,
          storyId: "legacy-review-without-admission-evidence",
          role: "PRIMARY",
          scheduledFor: SCHEDULED_FOR,
          humanReviewAuditId: reviewAuditId,
          actorId: "window-editor",
          reason: "Legacy evidence must not be silently promoted",
          now: AUTHORISED_AT,
        }),
      {
        message: "governed_window_candidate_admission_evidence_required",
      },
    );
  } finally {
    db.close();
  }
});

test("the explicit HUMAN approval union is byte-compatible with the legacy human review input", () => {
  const { db, repos } = migratedFixture();
  try {
    const { reviewAuditId } = addReviewedStory(db, {
      storyId: "explicit-human-approval-union",
    });
    const common = {
      repos,
      storyId: "explicit-human-approval-union",
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      actorId: "window-editor",
      reason: "Exact reviewed video approved",
      now: AUTHORISED_AT,
    };
    const legacy = prepareGovernedWindowCandidateAuthority({
      ...common,
      humanReviewAuditId: reviewAuditId,
    });
    const tagged = prepareGovernedWindowCandidateAuthority({
      ...common,
      approval: {
        type: "HUMAN",
        humanReviewAuditId: reviewAuditId,
      },
    });

    assert.deepEqual(tagged, legacy);
  } finally {
    db.close();
  }
});

test("autonomous official-source preparation is admission-only and never queries or forges a human review", () => {
  const { db, repos } = migratedFixture();
  try {
    const storyId = "autonomous-official-preparation";
    addAutonomousStory(db, storyId);
    const approval = autonomousEligibilityApproval(storyId);
    const beforeAudits = db
      .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
      .get().count;
    const beforeJobs = db
      .prepare("SELECT COUNT(*) AS count FROM jobs")
      .get().count;

    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId,
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      approval,
      now: T90_AT,
    });

    assert.equal(prepared.verdict, "GREEN");
    assert.equal(prepared.mutation_allowed, false);
    assert.equal(prepared.database_mutated, false);
    assert.equal(prepared.external_posting, false);
    assert.equal(prepared.publish_authority_created, false);
    assert.equal(
      prepared.authority.candidate_revision.stage,
      "AUTONOMOUS_ELIGIBLE",
    );
    assert.equal(prepared.authority.approval_type, AUTONOMOUS_AUTHORITY_TYPE);
    assert.equal(prepared.authority.human_admission_required, false);
    assert.equal(
      prepared.authority.autonomous_eligibility_attestation_id,
      approval.eligibilityAttestation.attestation_id,
    );
    assert.equal(
      prepared.authority.autonomous_eligibility_attestation_sha256,
      approval.eligibilityAttestation.attestation_sha256,
    );
    assert.equal(
      prepared.authority.autonomous_source_report_sha256,
      approval.eligibilityAttestation.source_report.report_sha256,
    );
    assert.equal(
      prepared.authority.autonomous_source_report_valid_until,
      approval.eligibilityAttestation.source_report.valid_until,
    );
    assert.equal(
      prepared.authority.autonomous_eligibility_valid_until,
      approval.eligibilityAttestation.valid_until,
    );
    assert.deepEqual(
      prepared.authority.jit_preparation,
      approval.jitPreparation,
    );
    assert.deepEqual(
      prepared.authority.admission.jit_preparation,
      approval.jitPreparation,
    );
    assert.equal(prepared.authority.admission.human_admission_required, false);
    assert.equal(
      prepared.authority.admission.approval_type,
      AUTONOMOUS_AUTHORITY_TYPE,
    );
    assert.equal(
      prepared.authority.admission.autonomous_window_eligibility_attestation
        .attestation_sha256,
      approval.eligibilityAttestation.attestation_sha256,
    );
    assert.equal(
      Object.hasOwn(prepared.authority, "human_review_audit_id"),
      false,
    );
    assert.equal(Object.hasOwn(prepared.authority, "operator"), false);
    assert.equal(
      Object.hasOwn(
        prepared.authority.admission,
        "autonomous_publication_authority",
      ),
      false,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
        .count,
      beforeAudits,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
      beforeJobs,
    );
  } finally {
    db.close();
  }
});

test("autonomous STANDBY remains eligibility-locked and does not carry a T-75 admission job identity", () => {
  const { db, repos } = migratedFixture();
  try {
    const storyId = "autonomous-official-standby";
    addAutonomousStory(db, storyId);
    const approval = autonomousEligibilityApproval(storyId, "STANDBY");
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId,
      role: "STANDBY",
      scheduledFor: SCHEDULED_FOR,
      approval,
      now: T90_AT,
    });

    assert.equal(prepared.verdict, "GREEN");
    assert.equal(prepared.authority.role, "STANDBY");
    assert.equal(prepared.authority.standby_authorised, true);
    assert.equal(prepared.authority.admission_run_at, null);
    assert.equal(prepared.authority.admission_job_idempotency_key, null);
    assert.equal(
      prepared.authority.admission.autonomous_window_eligibility_attestation
        .role,
      "STANDBY",
    );
    assert.equal(Object.hasOwn(prepared.authority, "operator"), false);
  } finally {
    db.close();
  }
});

test("autonomous preparation rejects short-lived authority, mismatched, elevated and cross-conflated eligibility", () => {
  const { db, repos } = migratedFixture();
  try {
    const storyId = "autonomous-official-rejections";
    addAutonomousStory(db, storyId);
    const prepare = (approval, extra = {}) =>
      prepareGovernedWindowCandidateAuthority({
        repos,
        storyId,
        role: "PRIMARY",
        scheduledFor: SCHEDULED_FOR,
        approval,
        now: T90_AT,
        ...extra,
      });

    assert.throws(
      () =>
        prepare({
          type: AUTONOMOUS_AUTHORITY_TYPE,
          authority: autonomousPublicationAuthority(storyId),
        }),
      {
        code: "governed_window_candidate_autonomous_approval_fields_invalid",
      },
    );
    const primaryApproval = autonomousEligibilityApproval(storyId);
    assert.throws(
      () =>
        prepare(
          {
            ...primaryApproval,
            jitPreparation: autonomousJitPreparation(storyId, "STANDBY"),
          },
          { role: "STANDBY" },
        ),
      {
        code: "autonomous_window_eligibility_binding_mismatch",
      },
    );
    assert.throws(
      () =>
        prepare({
          ...primaryApproval,
          eligibilityAttestation: {
            ...primaryApproval.eligibilityAttestation,
            dispatch_authorised: true,
          },
        }),
      {
        code: "autonomous_window_eligibility_sha256_mismatch",
      },
    );
    assert.throws(
      () =>
        prepare(primaryApproval, {
          humanReviewAuditId: 123,
        }),
      {
        code: "governed_window_candidate_approval_cross_conflation",
      },
    );
    assert.throws(
      () =>
        prepare(primaryApproval, {
          actorId: "human-operator",
          reason: "A human reason must not bleed into autonomy",
        }),
      {
        code: "governed_window_candidate_approval_cross_conflation",
      },
    );
    assert.throws(
      () =>
        prepareGovernedWindowCandidateAuthority({
          repos,
          storyId,
          role: "PRIMARY",
          scheduledFor: SCHEDULED_FOR,
          approval: {
            type: "HUMAN",
            humanReviewAuditId: 123,
            eligibilityAttestation: primaryApproval.eligibilityAttestation,
          },
          actorId: "window-editor",
          reason: "Conflated human and autonomous approval",
          now: AUTHORISED_AT,
        }),
      {
        code: "governed_window_candidate_human_approval_fields_invalid",
      },
    );
  } finally {
    db.close();
  }
});

test("the human window-authorisation mutator refuses the autonomous union before any database write", () => {
  const { db, repos } = migratedFixture();
  try {
    const storyId = "autonomous-mutator-separation";
    addAutonomousStory(db, storyId);
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId,
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      approval: autonomousEligibilityApproval(storyId),
      now: T90_AT,
    });

    assert.throws(
      () =>
        authoriseGovernedWindowCandidate({
          repos,
          ...exactAuthorisationInput(prepared),
          now: T90_AT,
        }),
      {
        code: "governed_window_candidate_autonomous_mutation_forbidden",
      },
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
        .count,
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

test("autonomous PRIMARY atomically persists the exact admission, audits it and enqueues one T-75 JIT intent", () => {
  const { db, repos } = migratedFixture();
  try {
    const storyId = "autonomous-primary-admission";
    addAutonomousStory(db, storyId);
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId,
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      approval: autonomousEligibilityApproval(storyId),
      now: T90_AT,
    });

    const applied = admitAutonomousGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: T90_AT,
    });

    assert.equal(applied.verdict, "APPLIED");
    assert.equal(applied.mutated, true);
    assert.equal(applied.external_posting, false);
    assert.equal(applied.publish_authority_created, false);
    assert.ok(Number.isInteger(applied.authority_audit_id));
    assert.ok(Number.isInteger(applied.admission_job_id));

    const extra = JSON.parse(repos.stories.get(storyId)._extra);
    assert.deepEqual(extra.admission, prepared.authority.admission);
    assert.equal(extra.approval_type, AUTONOMOUS_AUTHORITY_TYPE);
    assert.equal(extra.runway_eligibility_verdict, "GREEN");
    assert.equal(extra.standby_authorised, false);
    assert.equal(
      extra.candidate_revision_sha256,
      prepared.authority.candidate_revision_sha256,
    );
    assert.equal(
      extra.candidate_binding_sha256,
      prepared.authority.candidate_binding_sha256,
    );
    assert.equal(
      extra.autonomous_eligibility_attestation_sha256,
      prepared.authority.autonomous_eligibility_attestation_sha256,
    );
    for (const field of [
      "human_review_status",
      "human_review_event_id",
      "human_review_evidence_sha256",
      "human_review_audit_id",
      "humanReviewAuditId",
      "operator",
      "actor_id",
      "reason",
      "autonomous_publication_authority",
    ]) {
      assert.equal(Object.hasOwn(extra, field), false, field);
      assert.equal(Object.hasOwn(extra.admission, field), false, field);
    }

    const audit = db
      .prepare("SELECT * FROM operator_audit_log WHERE id = ?")
      .get(applied.authority_audit_id);
    assert.equal(audit.action, "governed_youtube_window_primary");
    assert.equal(audit.decision, "APPROVED");
    assert.equal(audit.target_id, storyId);
    assert.deepEqual(JSON.parse(audit.evidence_json), prepared.authority);

    const pending = repos.jobs.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, "admit_governed_publication");
    assert.equal(pending[0].story_id, storyId);
    assert.equal(pending[0].run_at, "2026-07-29 17:45:00");
    assert.equal(
      pending[0].idempotency_key,
      prepared.authority.admission_job_idempotency_key,
    );
    assert.equal(pending[0].payload.human_admission_required, false);
    assert.equal(
      pending[0].payload.autonomous_jit_materialisation_required,
      true,
    );
    assert.equal(pending[0].payload.publish_authority, false);
    assert.equal(pending[0].payload.external_posting, false);
    assert.equal(
      Object.hasOwn(
        pending[0].payload.admission,
        "autonomous_publication_authority",
      ),
      false,
    );

    const retried = admitAutonomousGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: new Date("2026-07-29T18:00:00.000Z"),
    });
    assert.equal(retried.verdict, "EXISTS");
    assert.equal(retried.mutated, false);
    assert.equal(retried.authority_audit_id, applied.authority_audit_id);
    assert.equal(retried.admission_job_id, applied.admission_job_id);
    assert.equal(repos.jobs.listPending().length, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
        .count,
      1,
    );
  } finally {
    db.close();
  }
});

test("autonomous STANDBY persists an exact reserve admission and audit but creates no job", () => {
  const { db, repos } = migratedFixture();
  try {
    const storyId = "autonomous-standby-admission";
    addAutonomousStory(db, storyId);
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId,
      role: "STANDBY",
      scheduledFor: SCHEDULED_FOR,
      approval: autonomousEligibilityApproval(storyId, "STANDBY"),
      now: T90_AT,
    });

    const applied = admitAutonomousGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: T90_AT,
    });

    assert.equal(applied.verdict, "APPLIED");
    assert.equal(applied.admission_job_id, null);
    assert.equal(repos.jobs.listPending().length, 0);
    const extra = JSON.parse(repos.stories.get(storyId)._extra);
    assert.deepEqual(extra.admission, prepared.authority.admission);
    assert.equal(extra.standby_authorised, true);
    assert.equal(extra.runway_standby_authorised, true);
    const audit = db
      .prepare("SELECT * FROM operator_audit_log WHERE id = ?")
      .get(applied.authority_audit_id);
    assert.equal(audit.action, "governed_youtube_runway_standby");
    assert.equal(audit.decision, "APPROVED");
  } finally {
    db.close();
  }
});

test("autonomous admission conflicts fail closed and roll back story, audit and T-75 job together", () => {
  const { db, repos } = migratedFixture();
  try {
    const storyId = "autonomous-admission-atomic-conflict";
    addAutonomousStory(db, storyId);
    const beforeExtra = repos.stories.get(storyId)._extra;
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId,
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      approval: autonomousEligibilityApproval(storyId),
      now: T90_AT,
    });
    repos.jobs.enqueue({
      kind: "hunt",
      channel_id: "pulse-gaming",
      story_id: storyId,
      payload: { conflicting_work: true },
      run_at: prepared.authority.admission_run_at,
      idempotency_key: prepared.authority.admission_job_idempotency_key,
    });

    assert.throws(
      () =>
        admitAutonomousGovernedWindowCandidate({
          repos,
          ...exactAuthorisationInput(prepared),
          now: T90_AT,
        }),
      { message: "job_idempotency_conflict" },
    );
    assert.equal(repos.stories.get(storyId)._extra, beforeExtra);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM operator_audit_log").get()
        .count,
      0,
    );
    assert.equal(repos.jobs.listPending().length, 1);
    assert.equal(repos.jobs.listPending()[0].kind, "hunt");
  } finally {
    db.close();
  }
});

test("an explicit PRIMARY authority atomically creates one immutable authority and one future T-75 admission intent", () => {
  const { db, repos } = migratedFixture();
  try {
    const { reviewAuditId } = addReviewedStory(db, {
      storyId: "primary-story",
    });
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "primary-story",
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: reviewAuditId,
      actorId: "window-editor",
      reason: "Primary candidate for the exact evening window",
      now: AUTHORISED_AT,
    });

    assert.equal(prepared.verdict, "GREEN");
    assert.equal(
      prepared.authority.admission_run_at,
      "2026-07-29T17:45:00.000Z",
    );
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action = 'governed_youtube_window_primary'`,
        )
        .get().count,
      0,
      "preparation must remain read-only",
    );
    assert.equal(repos.jobs.listPending().length, 0);

    const applied = authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: AUTHORISED_AT,
    });
    assert.equal(applied.verdict, "APPLIED");
    assert.equal(applied.mutated, true);
    assert.ok(Number.isInteger(applied.authority_audit_id));
    assert.ok(Number.isInteger(applied.admission_job_id));

    const pending = repos.jobs.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].kind, "admit_governed_publication");
    assert.equal(pending[0].story_id, "primary-story");
    assert.equal(pending[0].run_at, "2026-07-29 17:45:00");
    assert.equal(
      pending[0].payload.window_candidate_authority.audit_id,
      applied.authority_audit_id,
    );
    assert.equal(
      pending[0].payload.window_candidate_authority.authority_binding_sha256,
      prepared.authority.authority_binding_sha256,
    );
    assert.equal(
      pending[0].payload.candidate_revision_sha256,
      prepared.authority.candidate_revision_sha256,
    );
    assert.equal(
      pending[0].idempotency_key,
      prepared.authority.admission_job_idempotency_key,
    );
    assert.deepEqual(
      pending[0].payload.admission.evidence,
      prepared.authority.admission.evidence,
    );

    const retried = authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: AUTHORISED_AT,
    });
    assert.equal(retried.verdict, "EXISTS");
    assert.equal(retried.mutated, false);
    assert.equal(retried.authority_audit_id, applied.authority_audit_id);
    assert.equal(retried.admission_job_id, applied.admission_job_id);
    assert.equal(repos.jobs.listPending().length, 1);
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action = 'governed_youtube_window_primary'`,
        )
        .get().count,
      1,
    );
  } finally {
    db.close();
  }
});

test("an explicit STANDBY authority persists the canonical T-90 audit binding without scheduling work", () => {
  const { db, repos } = migratedFixture();
  try {
    const hashes = {
      media: "6".repeat(64),
      script: "7".repeat(64),
      qa: "8".repeat(64),
      rights: "9".repeat(64),
      source: "a".repeat(64),
    };
    const { reviewAuditId } = addReviewedStory(db, {
      storyId: "standby-story",
      score: 90,
      hashes,
    });
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "standby-story",
      role: "STANDBY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: reviewAuditId,
      actorId: "window-editor",
      reason: "Exact reviewed reserve for a primary pre-create failure",
      now: AUTHORISED_AT,
    });
    const applied = authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: AUTHORISED_AT,
    });

    assert.equal(applied.verdict, "APPLIED");
    assert.equal(applied.admission_job_id, null);
    assert.equal(repos.jobs.listPending().length, 0);
    const audit = db
      .prepare(
        `SELECT *
         FROM operator_audit_log
         WHERE id = ?`,
      )
      .get(applied.authority_audit_id);
    assert.equal(audit.action, "governed_youtube_runway_standby");
    assert.equal(audit.decision, "APPROVED");
    assert.equal(audit.target_type, "story");
    assert.equal(audit.target_id, "standby-story");
    const evidence = JSON.parse(audit.evidence_json);
    assert.equal(evidence.role, "STANDBY");
    assert.equal(evidence.standby_authorised, true);
    assert.equal(evidence.scheduled_for, SCHEDULED_FOR);
    assert.equal(
      evidence.candidate_revision_sha256,
      prepared.authority.candidate_revision_sha256,
    );
    assert.deepEqual(evidence.evidence_hashes, {
      media_sha256: hashes.media,
      script_sha256: hashes.script,
      qa_report_sha256: hashes.qa,
      rights_ledger_sha256: hashes.rights,
      source_evidence_sha256: hashes.source,
    });
    assert.equal(evidence.admission.confirmation_story_id, "standby-story");
    assert.equal(
      evidence.authority_binding_sha256,
      prepared.authority.authority_binding_sha256,
    );
  } finally {
    db.close();
  }
});

test("one story cannot occupy both PRIMARY and STANDBY roles in the same window", () => {
  const { db, repos } = migratedFixture();
  try {
    const { reviewAuditId } = addReviewedStory(db, {
      storyId: "single-story",
    });
    const primary = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "single-story",
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: reviewAuditId,
      actorId: "window-editor",
      reason: "Exact primary reservation",
      now: AUTHORISED_AT,
    });
    authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(primary),
      now: AUTHORISED_AT,
    });
    const standby = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "single-story",
      role: "STANDBY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: reviewAuditId,
      actorId: "window-editor",
      reason: "Conflicting standby reservation",
      now: AUTHORISED_AT,
    });

    assert.throws(
      () =>
        authoriseGovernedWindowCandidate({
          repos,
          ...exactAuthorisationInput(standby),
          now: AUTHORISED_AT,
        }),
      {
        message: "governed_window_candidate_distinct_story_required",
      },
    );
    assert.equal(repos.jobs.listPending().length, 1);
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action IN (
             'governed_youtube_window_primary',
             'governed_youtube_runway_standby'
           )`,
        )
        .get().count,
      1,
    );
  } finally {
    db.close();
  }
});

test("a story reservation cannot be silently reused in another publication window", () => {
  const { db, repos } = migratedFixture();
  try {
    const { reviewAuditId } = addReviewedStory(db, {
      storyId: "reserved-once",
    });
    const first = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "reserved-once",
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: reviewAuditId,
      actorId: "window-editor",
      reason: "Exact first window reservation",
      now: AUTHORISED_AT,
    });
    authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(first),
      now: AUTHORISED_AT,
    });
    const anotherWindow = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "reserved-once",
      role: "PRIMARY",
      scheduledFor: "2026-07-30T09:00:00.000Z",
      humanReviewAuditId: reviewAuditId,
      actorId: "window-editor",
      reason: "Attempted second window reservation",
      now: AUTHORISED_AT,
    });

    assert.throws(
      () =>
        authoriseGovernedWindowCandidate({
          repos,
          ...exactAuthorisationInput(anotherWindow),
          now: AUTHORISED_AT,
        }),
      {
        message: "governed_window_candidate_cross_window_reservation_conflict",
      },
    );
    assert.equal(repos.jobs.listPending().length, 1);
  } finally {
    db.close();
  }
});

test("an occupied window role is immutable and cannot be replaced by another story", () => {
  const { db, repos } = migratedFixture();
  try {
    const firstReview = addReviewedStory(db, {
      storyId: "primary-one",
    });
    const secondReview = addReviewedStory(db, {
      storyId: "primary-two",
      score: 120,
      hashes: {
        media: "b".repeat(64),
        script: "c".repeat(64),
        qa: "d".repeat(64),
        rights: "e".repeat(64),
        source: "f".repeat(64),
      },
    });
    const first = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "primary-one",
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: firstReview.reviewAuditId,
      actorId: "window-editor",
      reason: "Exact immutable primary slot",
      now: AUTHORISED_AT,
    });
    authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(first),
      now: AUTHORISED_AT,
    });
    const replacement = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "primary-two",
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: secondReview.reviewAuditId,
      actorId: "window-editor",
      reason: "Attempted silent primary replacement",
      now: AUTHORISED_AT,
    });

    assert.throws(
      () =>
        authoriseGovernedWindowCandidate({
          repos,
          ...exactAuthorisationInput(replacement),
          now: AUTHORISED_AT,
        }),
      {
        message: "governed_window_candidate_role_slot_conflict",
      },
    );
    assert.equal(repos.jobs.listPending().length, 1);
    assert.equal(repos.jobs.listPending()[0].story_id, "primary-one");
  } finally {
    db.close();
  }
});

test("an exact immutable retry remains idempotent after T-75 instead of creating late work", () => {
  const { db, repos } = migratedFixture();
  try {
    const { reviewAuditId } = addReviewedStory(db, {
      storyId: "retry-after-t75",
    });
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "retry-after-t75",
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: reviewAuditId,
      actorId: "window-editor",
      reason: "Exact retryable authority",
      now: AUTHORISED_AT,
    });
    const applied = authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: AUTHORISED_AT,
    });

    const retried = authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: new Date("2026-07-29T18:00:00.000Z"),
    });
    assert.equal(retried.verdict, "EXISTS");
    assert.equal(retried.mutated, false);
    assert.equal(retried.authority_audit_id, applied.authority_audit_id);
    assert.equal(repos.jobs.listPending().length, 1);
    assert.equal(repos.jobs.listPending()[0].run_at, "2026-07-29 17:45:00");
  } finally {
    db.close();
  }
});

test("PRIMARY authority and its T-75 job roll back together on an outbox conflict", () => {
  const { db, repos } = migratedFixture();
  try {
    const { reviewAuditId } = addReviewedStory(db, {
      storyId: "atomic-primary",
    });
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: "atomic-primary",
      role: "PRIMARY",
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: reviewAuditId,
      actorId: "window-editor",
      reason: "Atomic authority and outbox proof",
      now: AUTHORISED_AT,
    });
    repos.jobs.enqueue({
      kind: "hunt",
      channel_id: "pulse-gaming",
      story_id: "atomic-primary",
      payload: { conflicting_work: true },
      run_at: prepared.authority.admission_run_at,
      idempotency_key: prepared.authority.admission_job_idempotency_key,
    });

    assert.throws(
      () =>
        authoriseGovernedWindowCandidate({
          repos,
          ...exactAuthorisationInput(prepared),
          now: AUTHORISED_AT,
        }),
      { message: "job_idempotency_conflict" },
    );
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
    assert.equal(repos.jobs.listPending().length, 1);
    assert.equal(repos.jobs.listPending()[0].kind, "hunt");
  } finally {
    db.close();
  }
});

test("authority cannot bind a superseded human render approval", () => {
  const { db, repos } = migratedFixture();
  try {
    const first = addReviewedStory(db, {
      storyId: "reviewed-twice",
    });
    const latestEvidence = structuredClone(first.evidence);
    latestEvidence.media_sha256 = "b".repeat(64);
    latestEvidence.final_mp4.sha256 = "b".repeat(64);
    db.prepare(
      `INSERT INTO operator_audit_log
         (actor_id, action, target_type, target_id, decision,
          reason, evidence_json, idempotency_key)
       VALUES
         ('render-editor', 'governed_publication_review', 'story', ?,
          'HUMAN_RENDER_APPROVED', 'Reviewed replacement final render',
          ?, ?)`,
    ).run(
      "reviewed-twice",
      JSON.stringify(latestEvidence),
      `review:reviewed-twice:${"b".repeat(64)}`,
    );

    assert.throws(
      () =>
        prepareGovernedWindowCandidateAuthority({
          repos,
          storyId: "reviewed-twice",
          role: "PRIMARY",
          scheduledFor: SCHEDULED_FOR,
          humanReviewAuditId: first.reviewAuditId,
          actorId: "window-editor",
          reason: "Attempt to reserve superseded render",
          now: AUTHORISED_AT,
        }),
      {
        message: "governed_window_candidate_review_audit_not_current",
      },
    );
    assert.equal(repos.jobs.listPending().length, 0);
  } finally {
    db.close();
  }
});

test("real repositories and explicit authorities give T-90 one pending T-75 primary plus a GREEN distinct reserve lock", async (t) => {
  const { db, repos } = migratedFixture();
  t.after(() => db.close());
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-window-authority-t90-"),
  );
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const primaryReview = addReviewedStory(db, {
    storyId: "integration-primary",
    score: 120,
  });
  const reserveReview = addReviewedStory(db, {
    storyId: "integration-reserve",
    score: 90,
    hashes: {
      media: "6".repeat(64),
      script: "7".repeat(64),
      qa: "8".repeat(64),
      rights: "9".repeat(64),
      source: "a".repeat(64),
    },
  });
  for (const candidate of [
    {
      storyId: "integration-primary",
      role: "PRIMARY",
      reviewAuditId: primaryReview.reviewAuditId,
      reason: "Exact primary integration authority",
    },
    {
      storyId: "integration-reserve",
      role: "STANDBY",
      reviewAuditId: reserveReview.reviewAuditId,
      reason: "Exact standby integration authority",
    },
  ]) {
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: candidate.storyId,
      role: candidate.role,
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: candidate.reviewAuditId,
      actorId: "window-editor",
      reason: candidate.reason,
      now: AUTHORISED_AT,
    });
    authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: AUTHORISED_AT,
    });
  }

  const beforeT90 = repos.jobs
    .listPending()
    .filter((job) => job.kind === "admit_governed_publication");
  assert.equal(beforeT90.length, 1);
  assert.equal(beforeT90[0].story_id, "integration-primary");
  assert.equal(beforeT90[0].run_at, "2026-07-29 17:45:00");

  const result = await handlers.governed_youtube_runway_t90(
    {
      kind: "governed_youtube_runway_t90",
      channel_id: "pulse-gaming",
      run_at: "2026-07-29 17:30:00",
      payload: {
        phase: "T-90",
        publish_hour_utc: 19,
        scheduler_profile: "governed_multi_lane",
        out_dir: outDir,
      },
    },
    {
      repos,
      now: () => new Date("2026-07-29T17:30:00.000Z"),
      async notifyRunwayIncident() {},
    },
  );

  assert.equal(
    result.verdict,
    "GREEN",
    JSON.stringify({
      blockers: result.blockers,
      candidates: result.candidates,
    }),
  );
  assert.equal(result.lock.primary.story_id, "integration-primary");
  assert.equal(result.lock.reserve.story_id, "integration-reserve");
  assert.equal(result.lock.reserve.standby_authorised, true);
  assert.equal(
    repos.jobs
      .listPending()
      .filter((job) => job.kind === "admit_governed_publication").length,
    1,
  );
});

test("T-90 refuses a standby authority superseded by a later review even when all media hashes are unchanged", async (t) => {
  const { db, repos } = migratedFixture();
  t.after(() => db.close());
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-window-stale-standby-"),
  );
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const primaryReview = addReviewedStory(db, {
    storyId: "stale-check-primary",
    score: 120,
  });
  const reserveReview = addReviewedStory(db, {
    storyId: "stale-check-reserve",
    score: 90,
    hashes: {
      media: "6".repeat(64),
      script: "7".repeat(64),
      qa: "8".repeat(64),
      rights: "9".repeat(64),
      source: "a".repeat(64),
    },
  });
  for (const candidate of [
    {
      storyId: "stale-check-primary",
      role: "PRIMARY",
      reviewAuditId: primaryReview.reviewAuditId,
    },
    {
      storyId: "stale-check-reserve",
      role: "STANDBY",
      reviewAuditId: reserveReview.reviewAuditId,
    },
  ]) {
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: candidate.storyId,
      role: candidate.role,
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: candidate.reviewAuditId,
      actorId: "window-editor",
      reason: `Exact ${candidate.role.toLowerCase()} stale-review test`,
      now: AUTHORISED_AT,
    });
    authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: AUTHORISED_AT,
    });
  }
  db.prepare(
    `INSERT INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision,
        reason, evidence_json, idempotency_key)
     VALUES
       ('render-editor', 'governed_publication_review', 'story', ?,
        'HUMAN_RENDER_APPROVED', 'Repeated review after reservation',
        ?, ?)`,
  ).run(
    "stale-check-reserve",
    JSON.stringify(reserveReview.evidence),
    "review:stale-check-reserve:replacement-identical-hashes",
  );

  const result = await handlers.governed_youtube_runway_t90(
    {
      kind: "governed_youtube_runway_t90",
      channel_id: "pulse-gaming",
      run_at: "2026-07-29 17:30:00",
      payload: {
        phase: "T-90",
        publish_hour_utc: 19,
        scheduler_profile: "governed_multi_lane",
        out_dir: outDir,
      },
    },
    {
      repos,
      now: () => new Date("2026-07-29T17:30:00.000Z"),
      async notifyRunwayIncident() {},
    },
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("runway_reserve_candidate_not_ready"));
  assert.equal(result.lock, null);
});

test("T-90 refuses a primary job whose exact authority was superseded by a later identical-hash review", async (t) => {
  const { db, repos } = migratedFixture();
  t.after(() => db.close());
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-window-stale-primary-"),
  );
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const primaryReview = addReviewedStory(db, {
    storyId: "stale-primary",
    score: 120,
  });
  const reserveReview = addReviewedStory(db, {
    storyId: "stale-primary-reserve",
    score: 90,
    hashes: {
      media: "6".repeat(64),
      script: "7".repeat(64),
      qa: "8".repeat(64),
      rights: "9".repeat(64),
      source: "a".repeat(64),
    },
  });
  for (const candidate of [
    {
      storyId: "stale-primary",
      role: "PRIMARY",
      reviewAuditId: primaryReview.reviewAuditId,
    },
    {
      storyId: "stale-primary-reserve",
      role: "STANDBY",
      reviewAuditId: reserveReview.reviewAuditId,
    },
  ]) {
    const prepared = prepareGovernedWindowCandidateAuthority({
      repos,
      storyId: candidate.storyId,
      role: candidate.role,
      scheduledFor: SCHEDULED_FOR,
      humanReviewAuditId: candidate.reviewAuditId,
      actorId: "window-editor",
      reason: `Exact ${candidate.role.toLowerCase()} primary stale test`,
      now: AUTHORISED_AT,
    });
    authoriseGovernedWindowCandidate({
      repos,
      ...exactAuthorisationInput(prepared),
      now: AUTHORISED_AT,
    });
  }
  db.prepare(
    `INSERT INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision,
        reason, evidence_json, idempotency_key)
     VALUES
       ('render-editor', 'governed_publication_review', 'story', ?,
        'HUMAN_RENDER_APPROVED', 'Repeated primary review',
        ?, ?)`,
  ).run(
    "stale-primary",
    JSON.stringify(primaryReview.evidence),
    "review:stale-primary:replacement-identical-hashes",
  );

  const result = await handlers.governed_youtube_runway_t90(
    {
      kind: "governed_youtube_runway_t90",
      channel_id: "pulse-gaming",
      run_at: "2026-07-29 17:30:00",
      payload: {
        phase: "T-90",
        publish_hour_utc: 19,
        scheduler_profile: "governed_multi_lane",
        out_dir: outDir,
      },
    },
    {
      repos,
      now: () => new Date("2026-07-29T17:30:00.000Z"),
      async notifyRunwayIncident() {},
    },
  );

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("runway_primary_candidate_not_ready"));
  assert.equal(result.lock, null);
});
