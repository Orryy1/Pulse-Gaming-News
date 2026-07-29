"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bindRepositories } = require("../../lib/repositories");
const {
  createAutonomousOfficialJitPreparationManifest,
  STATIC_ARTIFACT_FIELDS,
} = require("../../lib/services/autonomous-official-jit-admission-packet");
const {
  REQUEST_SCHEMA_VERSION,
  composeGovernedAutonomousPreT90Candidates,
} = require("../../lib/services/governed-autonomous-pre-t90-candidate-composition");
const {
  applyGovernedAutonomousPreT90CandidateComposition,
} = require("../../lib/services/apply-governed-autonomous-pre-t90-candidate-composition");
const {
  canonicalSha256,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  MATERIALISER_ID: T90_SOURCE_MATERIALISER_ID,
  REPORT_SCHEMA_VERSION: T90_SOURCE_REPORT_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-t90-eligibility-source-report");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const NOW = "2026-07-30T07:28:00.000Z";
const T90 = "2026-07-30T07:30:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const REPORT_GENERATED_AT = "2026-07-30T07:27:30.000Z";
const REPORT_VALID_UNTIL = "2026-07-30T07:46:01.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

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

function addStory(db, storyId, overrides = {}) {
  const script = overrides.full_script ?? `${storyId}:\n   script`;
  const extra = overrides.extra ?? { breaking_fast_track: true };
  db.prepare(
    `INSERT INTO stories
       (id, title, full_script, approved, auto_approved, exported_path,
        breaking_score, score, channel_id, publish_status, youtube_post_id,
        _extra)
     VALUES
       (@id, @title, @full_script, @approved, 1, @exported_path,
        @breaking_score, 100, @channel_id, '', @youtube_post_id, @extra)`,
  ).run({
    id: storyId,
    title: `Official news for ${storyId}`,
    full_script: script,
    approved: overrides.approved ?? 1,
    exported_path: overrides.exported_path ?? null,
    breaking_score: overrides.breaking_score ?? 100,
    channel_id: overrides.channel_id ?? "pulse-gaming",
    youtube_post_id: overrides.youtube_post_id ?? null,
    extra: JSON.stringify(extra),
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return { bytes, sha256: sha256(bytes) };
}

function candidateFixture(workspaceRoot, storyId, role) {
  const artifactEntries = STATIC_ARTIFACT_FIELDS.map((field) => [
    field,
    {
      path: `output/canary/${storyId}/artifacts/${field}`,
      sha256: sha256(`${storyId}:${field}`),
    },
  ]);
  const artifacts = Object.fromEntries(artifactEntries);
  const mediaRelativePath = `output/canary/${storyId}/final/${storyId}.mp4`;
  const mediaBytes = Buffer.from(`${storyId}:final_mp4`, "utf8");
  const mediaSha256 = sha256(mediaBytes);
  artifacts.final_mp4 = {
    path: mediaRelativePath,
    sha256: mediaSha256,
  };
  const mediaPath = path.join(workspaceRoot, ...mediaRelativePath.split("/"));
  fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  fs.writeFileSync(mediaPath, mediaBytes);

  const candidateRevisionSha256 = sha256(`${storyId}:candidate-revision`);
  const requestFingerprint = sha256(`${storyId}:request-fingerprint`);
  const jitRightsLedgerSha256 = sha256(`${storyId}:jit-rights-ledger`);
  const preparation = createAutonomousOfficialJitPreparationManifest({
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
    artifacts,
    owned_visual_assets: [],
    publication_evidence_gate_input: {
      originality_transformation: {
        verdict: "STRONG",
        rationale: "Story-specific owned motion.",
        evidence_ref: artifacts.owned_motion_manifest.path,
        evidence_sha256: artifacts.owned_motion_manifest.sha256,
      },
      rights_ledger: {
        ledger_version: 1,
        decision: "CLEARED",
        items: [],
      },
      rights_ledger_sha256: jitRightsLedgerSha256,
      synthetic_media_disclosure: {
        decision_authority: "SYSTEM_POLICY",
        decision_provenance: {
          policy_id: "pulse-synthetic-media-policy",
          policy_version: "v1",
          evaluated_at: NOW,
          evidence_sha256: artifacts.final_composite_manifest.sha256,
        },
        altered_content: true,
        policy_basis: "DISCLOSE",
        youtube_field_value: true,
      },
    },
  });
  const lineage = {
    source_intake_sha256: artifacts.story_intake.sha256,
    claim_map_sha256: sha256(`${storyId}:claim-map`),
    script_sha256: sha256(`${storyId}: script`),
    narration_sha256: artifacts.narration_audio.sha256,
    timestamps_sha256: sha256(`${storyId}:timestamps`),
    media_inventory_sha256: sha256(`${storyId}:media-inventory`),
    rights_ledger_sha256: sha256(`${storyId}:editorial-rights-ledger`),
    motion_manifest_sha256: artifacts.owned_motion_manifest.sha256,
    render_manifest_sha256: artifacts.renderer_manifest.sha256,
    final_mp4_sha256: mediaSha256,
    qa_report_sha256: artifacts.deterministic_qa.sha256,
    publication_metadata_sha256: artifacts.publication_metadata.sha256,
    package_manifest_sha256: sha256(`${storyId}:package-manifest`),
  };
  const reportRelativePath =
    `output/canary/${storyId}/eligibility/t90-source-report.json`;
  const requestSha256 = sha256(`${storyId}:source-report-request`);
  const reportBody = {
    schema_version: T90_SOURCE_REPORT_SCHEMA_VERSION,
    materialiser_id: T90_SOURCE_MATERIALISER_ID,
    mode: "LOCAL_PROOF",
    generated_at: REPORT_GENERATED_AT,
    valid_until: REPORT_VALID_UNTIL,
    request_sha256: requestSha256,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    role,
    scheduled_for: SCHEDULED_FOR,
    jit_preparation_sha256: preparation.preparation_sha256,
    candidate_revision_sha256: candidateRevisionSha256,
    request_fingerprint: requestFingerprint,
    source_evidence_sha256: artifacts.source_evidence.sha256,
    story_intake_sha256: artifacts.story_intake.sha256,
    required_checkpoint: {
      name: "T75",
      t75_at: "2026-07-30T07:45:00.000Z",
      validity_margin_ms: 61_000,
      required_valid_through: REPORT_VALID_UNTIL,
      final_jit_revalidation_required: true,
    },
    source_last_checked_at: REPORT_GENERATED_AT,
    upstream_source_apply_report: {
      path: path.join(
        workspaceRoot,
        "output",
        "canary",
        storyId,
        "eligibility",
        "source-apply.json",
      ),
      file_sha256: sha256(`${storyId}:source-apply-file`),
      report_sha256: sha256(`${storyId}:source-apply-report`),
    },
    source_set_sha256: sha256(`${storyId}:source-set`),
    verdict: "GREEN",
    blockers: [],
    publish_authority: false,
    scheduler_authority: false,
    database_authority: false,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
  };
  const report = {
    ...reportBody,
    report_sha256: canonicalSha256(reportBody),
  };
  const reportFile = writeJson(
    path.join(workspaceRoot, ...reportRelativePath.split("/")),
    report,
  );

  return {
    mediaBytes,
    mediaPath,
    mediaRelativePath,
    reportPath: path.join(
      workspaceRoot,
      ...reportRelativePath.split("/"),
    ),
    coordinator_result: {
      schema_version: "pulse-governed-autonomous-production-result-v1",
      mode: "LOCAL_PROOF",
      verdict: "GREEN",
      blockers: [],
      story_id: storyId,
      green_supplement: {
        verdict: "GREEN",
        authority_scope: "LOCAL_PROOF_EVIDENCE_ONLY",
        story_id: storyId,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        hashes: lineage,
        prompt_injection: { verdict: "PASS" },
        media_items: [
          {
            item_id: "owned-motion",
            asset_sha256: sha256(`${storyId}:owned-motion-asset`),
            included_in_final: true,
            rights_decision: "CLEARED",
            rights_basis: "OWNED",
            rights_evidence_sha256: sha256(
              `${storyId}:owned-motion-rights`,
            ),
            licence_document_sha256: null,
            review_status: "VERIFIED",
            risk_decision: null,
            attribution_decision: "NOT_REQUIRED",
            attribution_text: null,
            scope: {
              destinations: ["YOUTUBE"],
              revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
              territory: "WORLDWIDE",
              account_id: "pulse-gaming-youtube",
            },
          },
        ],
        safety: {
          publish_authority: false,
          scheduler_authority: false,
          database_authority: false,
          oauth_or_token_authority: false,
          network_authority: false,
          platform_contacted: false,
        },
      },
      staging: {
        schema_version:
          "pulse-autonomous-official-candidate-staging-result-v3",
        mode: "LOCAL_PROOF",
        verdict: "GREEN",
        blockers: [],
        story_id: storyId,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: SCHEDULED_FOR,
        role,
        preparation_sha256: preparation.preparation_sha256,
        rights_ledger_sha256: jitRightsLedgerSha256,
        preparation_manifest: preparation,
        safety: {
          local_proof_only: true,
          publish_authority: false,
          external_publish_authorised: false,
          database_mutated: false,
          oauth_or_tokens_mutated: false,
          platform_contacted: false,
          network_used: false,
        },
      },
      safety: {
        publish_authority: false,
        scheduler_authority: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_contacted: false,
        external_publish_authorised: false,
      },
    },
    source_snapshot: {
      discovered_at: "2026-07-30T06:00:00.000Z",
      source_last_checked_at: REPORT_GENERATED_AT,
      publish_by: "2026-07-30T12:00:00.000Z",
      stale_after: "2026-07-30T13:00:00.000Z",
      stale_reframe_option: {
        allowed: true,
        reason: "Reframe as a confirmed player-impact explainer.",
      },
      source_report: {
        path: reportRelativePath,
        file_sha256: reportFile.sha256,
        report_sha256: report.report_sha256,
        request_sha256: requestSha256,
        generated_at: REPORT_GENERATED_AT,
        valid_until: REPORT_VALID_UNTIL,
      },
    },
  };
}

function setup(t) {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-apply-"),
  );
  const fixture = migratedFixture();
  t.after(() => {
    fixture.db.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });
  const primary = candidateFixture(
    workspaceRoot,
    "story-primary",
    "PRIMARY",
  );
  const standby = candidateFixture(
    workspaceRoot,
    "story-standby",
    "STANDBY",
  );
  addStory(fixture.db, "story-primary");
  addStory(fixture.db, "story-standby");
  const composition = composeGovernedAutonomousPreT90Candidates({
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    now: NOW,
    scheduled_for: SCHEDULED_FOR,
    primary: {
      coordinator_result: primary.coordinator_result,
      source_snapshot: primary.source_snapshot,
    },
    reserve: {
      coordinator_result: standby.coordinator_result,
      source_snapshot: standby.source_snapshot,
    },
  });
  return {
    ...fixture,
    workspaceRoot,
    primary,
    standby,
    composition,
  };
}

function apply(fixture, overrides = {}) {
  const options = {
    composition: fixture.composition,
    repos: fixture.repos,
    workspaceRoot: fixture.workspaceRoot,
    now: overrides.now ?? NOW,
    readMediaBytes: overrides.readMediaBytes,
  };
  if (Object.hasOwn(overrides, "sourceReportValidator")) {
    options.sourceReportValidator = overrides.sourceReportValidator;
  }
  return applyGovernedAutonomousPreT90CandidateComposition(options);
}

test("atomically binds exact media and admits PRIMARY/STANDBY through governed candidate authority", (t) => {
  const fixture = setup(t);

  const result = apply(fixture);

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.database_mutated, true);
  assert.equal(result.composition_sha256, fixture.composition.composition_sha256);
  assert.deepEqual(
    result.candidates.map(({ story_id, role, verdict }) => ({
      story_id,
      role,
      verdict,
    })),
    [
      {
        story_id: "story-primary",
        role: "PRIMARY",
        verdict: "APPLIED",
      },
      {
        story_id: "story-standby",
        role: "STANDBY",
        verdict: "APPLIED",
      },
    ],
  );
  for (const candidate of fixture.composition.candidates) {
    const story = fixture.repos.stories.get(candidate.story_id);
    const extra = JSON.parse(story._extra);
    assert.equal(
      story.exported_path,
      candidate.eligibility.jit_preparation.artifacts.final_mp4.path,
    );
    assert.equal(extra.media_sha256, candidate.eligibility.evidence_hashes.media_sha256);
    assert.equal(extra.script_sha256, candidate.eligibility.evidence_hashes.script_sha256);
    assert.equal(
      extra.autonomous_pre_t90_composition_sha256,
      fixture.composition.composition_sha256,
    );
  }
  assert.equal(
    fixture.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM operator_audit_log
         WHERE action IN (
           'governed_youtube_window_primary',
           'governed_youtube_runway_standby'
         )`,
      )
      .get().count,
    2,
  );
  assert.equal(
    fixture.db
      .prepare(
        "SELECT COUNT(*) AS count FROM jobs WHERE kind = 'admit_governed_publication'",
      )
      .get().count,
    1,
  );
  assert.equal(result.external_posting, false);
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.platform_contacted, false);
  assert.equal(result.network_used, false);
  assert.equal(result.oauth_or_tokens_mutated, false);
});

test("an exact replay is idempotent and does not duplicate audits or jobs", (t) => {
  const fixture = setup(t);
  const first = apply(fixture);
  const countsBefore = {
    audits: fixture.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM operator_audit_log
         WHERE action IN (
           'governed_youtube_window_primary',
           'governed_youtube_runway_standby'
         )`,
      )
      .get().count,
    jobs: fixture.db.prepare("SELECT COUNT(*) AS count FROM jobs").get()
      .count,
  };

  const replay = apply(fixture, {
    now: "2026-07-30T07:31:00.000Z",
  });

  assert.equal(first.verdict, "APPLIED");
  assert.equal(replay.verdict, "EXISTS");
  assert.equal(replay.database_mutated, false);
  assert.deepEqual(
    replay.candidates.map(({ role, verdict }) => ({ role, verdict })),
    [
      { role: "PRIMARY", verdict: "EXISTS" },
      { role: "STANDBY", verdict: "EXISTS" },
    ],
  );
  assert.deepEqual(
    {
      audits: fixture.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM operator_audit_log
           WHERE action IN (
             'governed_youtube_window_primary',
             'governed_youtube_runway_standby'
           )`,
        )
        .get().count,
      jobs: fixture.db.prepare("SELECT COUNT(*) AS count FROM jobs").get()
        .count,
    },
    countsBefore,
  );
});

test("an authority-backed replay with a missing canonical media binding is rejected instead of silently repaired", (t) => {
  const fixture = setup(t);
  apply(fixture);
  fixture.db
    .prepare("UPDATE stories SET exported_path = NULL WHERE id = ?")
    .run("story-standby");

  assert.throws(
    () => apply(fixture),
    (error) =>
      error?.code === "pre_t90_apply_inconsistent_replay_state",
  );
  assert.equal(
    fixture.repos.stories.get("story-standby").exported_path,
    null,
  );
  assert.equal(
    fixture.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM operator_audit_log
         WHERE action IN (
           'governed_youtube_window_primary',
           'governed_youtube_runway_standby'
         )`,
      )
      .get().count,
    2,
  );
});

test("a real second-candidate admission failure rolls back both media bindings and the first admission", (t) => {
  const fixture = setup(t);
  fixture.db.exec(`
    CREATE TRIGGER fail_second_candidate_admission
    BEFORE INSERT ON operator_audit_log
    WHEN NEW.action = 'governed_youtube_runway_standby'
    BEGIN
      SELECT RAISE(ABORT, 'forced_standby_admission_failure');
    END;
  `);

  assert.throws(
    () => apply(fixture),
    /forced_standby_admission_failure/,
  );

  for (const storyId of ["story-primary", "story-standby"]) {
    const story = fixture.repos.stories.get(storyId);
    assert.equal(story.exported_path, null);
    assert.deepEqual(JSON.parse(story._extra), {
      breaking_fast_track: true,
    });
  }
  assert.equal(
    fixture.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM operator_audit_log
         WHERE action IN (
           'governed_youtube_window_primary',
           'governed_youtube_runway_standby'
         )`,
      )
      .get().count,
    0,
  );
  assert.equal(
    fixture.db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
    0,
  );
});

test("new applications are rejected after T90 without mutation", (t) => {
  const fixture = setup(t);

  assert.throws(
    () =>
      apply(fixture, {
        now: "2026-07-30T07:30:00.001Z",
      }),
    (error) =>
      error?.code ===
      "pre_t90_apply_new_application_after_t90_forbidden",
  );

  assert.equal(
    fixture.repos.stories.get("story-primary").exported_path,
    null,
  );
  assert.equal(
    fixture.repos.stories.get("story-standby").exported_path,
    null,
  );
  assert.equal(
    fixture.db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
    0,
  );
});

test("the exact T90 boundary remains eligible for a new atomic application", (t) => {
  const fixture = setup(t);

  const result = apply(fixture, { now: T90 });

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.database_mutated, true);
});

test("the governed closed-schema source validator is the default and cannot be disabled with a non-function", (t) => {
  const fixture = setup(t);

  assert.throws(
    () => apply(fixture, { sourceReportValidator: null }),
    (error) =>
      error?.code ===
      "pre_t90_apply_source_report_validator_required",
  );
  assert.equal(
    fixture.repos.stories.get("story-primary").exported_path,
    null,
  );
});

test("the executor revalidates the closed composition before reading or mutating state", (t) => {
  const fixture = setup(t);
  const drifted = JSON.parse(JSON.stringify(fixture.composition));
  drifted.candidates[0].eligibility.evidence_hashes.media_sha256 =
    sha256("substitute-media");

  assert.throws(
    () =>
      applyGovernedAutonomousPreT90CandidateComposition({
        composition: drifted,
        repos: fixture.repos,
        workspaceRoot: fixture.workspaceRoot,
        now: NOW,
      }),
    (error) => error?.code === "pre_t90_composition_sha256_mismatch",
  );
  assert.equal(
    fixture.repos.stories.get("story-primary").exported_path,
    null,
  );
});

test("source-report bytes must be exact, canonical-schema validated and inside an allowed evidence root", async (t) => {
  await t.test("file hash drift", (t) => {
    const fixture = setup(t);
    fs.appendFileSync(fixture.primary.reportPath, "\n");

    assert.throws(
      () => apply(fixture),
      (error) =>
        error?.code ===
        "pre_t90_apply_source_report_file_hash_mismatch",
    );
    assert.equal(
      fixture.repos.stories.get("story-primary").exported_path,
      null,
    );
  });

  await t.test("schema validator rejection", (t) => {
    const fixture = setup(t);

    assert.throws(
      () =>
        apply(fixture, {
          sourceReportValidator() {
            throw new Error("unrecognised_source_report_schema");
          },
        }),
      (error) =>
        error?.code ===
        "pre_t90_apply_source_report_validation_failed",
    );
  });

  await t.test("path outside the allowed root", (t) => {
    const fixture = setup(t);
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "pulse-pre-t90-outside-"),
    );
    t.after(() =>
      fs.rmSync(outside, { recursive: true, force: true }),
    );
    const outsideReport = path.join(outside, "t90-source-report.json");
    fs.renameSync(fixture.primary.reportPath, outsideReport);

    assert.throws(
      () => apply(fixture),
      (error) =>
        error?.code ===
        "pre_t90_apply_source_report_path_forbidden",
    );
  });
});

test("exact MP4 bytes are rehashed immediately before commit and drift rolls back every write", (t) => {
  const fixture = setup(t);
  const reads = new Map();

  assert.throws(
    () =>
      apply(fixture, {
        readMediaBytes(filePath) {
          const count = (reads.get(filePath) || 0) + 1;
          reads.set(filePath, count);
          if (count > 1) return Buffer.from("drifted-media", "utf8");
          return fs.readFileSync(filePath);
        },
      }),
    (error) => error?.code === "pre_t90_apply_media_hash_mismatch",
  );

  for (const storyId of ["story-primary", "story-standby"]) {
    assert.equal(fixture.repos.stories.get(storyId).exported_path, null);
  }
  assert.equal(
    fixture.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM operator_audit_log
         WHERE action IN (
           'governed_youtube_window_primary',
           'governed_youtube_runway_standby'
         )`,
      )
      .get().count,
    0,
  );
  assert.equal(
    fixture.db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
    0,
  );
});

test("both MP4s must resolve to regular non-symlink files inside the workspace", (t) => {
  const fixture = setup(t);
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-media-outside-"),
  );
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.renameSync(
    fixture.standby.mediaPath,
    path.join(outside, "story-standby.mp4"),
  );

  assert.throws(
    () => apply(fixture),
    (error) => error?.code === "pre_t90_apply_media_path_forbidden",
  );
  assert.equal(
    fixture.repos.stories.get("story-primary").exported_path,
    null,
  );
});

test("only exact approved, unpublished breaking stories with the bound normalised script can be applied", async (t) => {
  const cases = [
    {
      name: "not approved",
      mutate(fixture) {
        fixture.db
          .prepare("UPDATE stories SET approved = 0 WHERE id = ?")
          .run("story-primary");
      },
      code: "pre_t90_apply_story_approval_required",
    },
    {
      name: "already published",
      mutate(fixture) {
        fixture.db
          .prepare("UPDATE stories SET youtube_post_id = ? WHERE id = ?")
          .run("published-id", "story-primary");
      },
      code: "pre_t90_apply_story_already_published",
    },
    {
      name: "wrong channel",
      mutate(fixture) {
        fixture.db.exec(
          "INSERT INTO channels (id, name, niche) VALUES ('other', 'Other', 'gaming')",
        );
        fixture.db
          .prepare("UPDATE stories SET channel_id = 'other' WHERE id = ?")
          .run("story-primary");
      },
      code: "pre_t90_apply_story_channel_mismatch",
    },
    {
      name: "missing channel",
      mutate(fixture) {
        fixture.db
          .prepare("UPDATE stories SET channel_id = NULL WHERE id = ?")
          .run("story-primary");
      },
      code: "pre_t90_apply_story_channel_mismatch",
    },
    {
      name: "not breaking",
      mutate(fixture) {
        fixture.db
          .prepare(
            "UPDATE stories SET breaking_score = 0, _extra = '{}' WHERE id = ?",
          )
          .run("story-primary");
      },
      code: "pre_t90_apply_story_breaking_lane_required",
    },
    {
      name: "script drift",
      mutate(fixture) {
        fixture.db
          .prepare("UPDATE stories SET full_script = ? WHERE id = ?")
          .run("substituted script", "story-primary");
      },
      code: "pre_t90_apply_story_script_hash_mismatch",
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, (t) => {
      const fixture = setup(t);
      entry.mutate(fixture);

      assert.throws(
        () => apply(fixture),
        (error) => error?.code === entry.code,
      );
      assert.equal(
        fixture.repos.stories.get("story-standby").exported_path,
        null,
      );
    });
  }
});

test("conflicting canonical media or _extra shadow bindings are rejected", async (t) => {
  await t.test("top-level media conflict", (t) => {
    const fixture = setup(t);
    fixture.db
      .prepare("UPDATE stories SET exported_path = ? WHERE id = ?")
      .run("output/substitute.mp4", "story-primary");

    assert.throws(
      () => apply(fixture),
      (error) =>
        error?.code ===
        "pre_t90_apply_story_media_binding_conflict",
    );
  });

  await t.test("_extra hash shadow conflict", (t) => {
    const fixture = setup(t);
    fixture.db
      .prepare("UPDATE stories SET _extra = ? WHERE id = ?")
      .run(
        JSON.stringify({
          breaking_fast_track: true,
          media_sha256: sha256("substitute"),
        }),
        "story-standby",
      );

    assert.throws(
      () => apply(fixture),
      (error) =>
        error?.code ===
          "pre_t90_apply_story_extra_shadow_conflict" &&
        error?.field === "media_sha256",
    );
    assert.equal(
      fixture.repos.stories.get("story-primary").exported_path,
      null,
    );
  });
});
