"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REPORT_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  materialiseGovernedAutonomousT90EligibilitySourceReport,
  validateGovernedAutonomousT90EligibilitySourceReport,
  validateGovernedAutonomousT90EligibilitySourceReportForApply,
} = require("../../lib/services/governed-autonomous-t90-eligibility-source-report");
const {
  APPLY_MATERIALISER_ID,
  APPLY_REPORT_SCHEMA_VERSION,
} = require("../../lib/services/autonomous-official-source-evidence-apply");
const {
  STATIC_ARTIFACT_FIELDS,
  createAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");
const {
  canonicalSha256,
} = require("../../lib/services/governed-youtube-release-runway");

const NOW = "2026-07-30T07:28:00.000Z";
const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const REQUIRED_VALID_THROUGH = "2026-07-30T07:46:01.000Z";
const STORY_ID = "official-primary";
const CANDIDATE_REVISION_SHA256 = "8".repeat(64);
const REQUEST_FINGERPRINT = "9".repeat(64);

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function upstreamReport(overrides = {}) {
  const body = {
    schema_version: APPLY_REPORT_SCHEMA_VERSION,
    materialiser_id: APPLY_MATERIALISER_ID,
    mode: "LOCAL_PROOF",
    generated_at: NOW,
    valid_until: "2026-07-30T07:30:00.000Z",
    request_sha256: sha256Bytes("upstream-request"),
    story_id: STORY_ID,
    verdict: "GREEN",
    blockers: [],
    authority: {
      method: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
      scope: "LOCAL_EDITORIAL_AND_RELEASE_EVIDENCE_ONLY",
      human_approval: false,
      may_impersonate_human: false,
    },
    source_revalidation: {
      policy: "PRIMARY_AND_ALL_SUPPORTING_OFFICIAL_SNAPSHOTS",
      snapshot_count: 1,
      primary_count: 1,
      supporting_count: 0,
      sources: [
        {
          role: "PRIMARY",
          source_id: "official-news",
          source_url: "https://example.com/official-news",
          snapshot_sha256: sha256Bytes("snapshot"),
          canonical_body_sha256: sha256Bytes("body"),
          matched_claim_text_sha256: [sha256Bytes("claim")],
          bytes_sha256: sha256Bytes("response"),
          fetch_status: 200,
          revalidated_at: NOW,
          unchanged: true,
          claims_match: true,
        },
      ],
    },
    lineage: {
      source_evidence_sha256: sha256Bytes("source-evidence"),
      story_intake_sha256: sha256Bytes("story-intake"),
      final_mp4_sha256: sha256Bytes("final-mp4"),
    },
    operational_publish_authority: false,
    dispatch_authorised: false,
    dispatch_revalidation_required: true,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    ...overrides,
  };
  return {
    ...body,
    report_sha256: canonicalSha256(body),
  };
}

function jitPreparation() {
  return createAutonomousOfficialJitPreparationManifest({
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role: "PRIMARY",
    candidate_revision_sha256: CANDIDATE_REVISION_SHA256,
    request_fingerprint: REQUEST_FINGERPRINT,
    artifacts: Object.fromEntries(
      STATIC_ARTIFACT_FIELDS.map((field, index) => [
        field,
        {
          path: `output/canary/${STORY_ID}/${field}`,
          sha256:
            field === "source_evidence"
              ? sha256Bytes("source-evidence")
              : field === "story_intake"
                ? sha256Bytes("story-intake")
                : (index + 20)
                    .toString(16)
                    .padStart(2, "0")
                    .repeat(32),
        },
      ]),
    ),
    owned_visual_assets: [],
    publication_evidence_gate_input: {
      originality_transformation: {},
      rights_ledger: {
        ledger_version: 1,
        decision: "CLEARED",
        items: [],
      },
      rights_ledger_sha256: "a".repeat(64),
      synthetic_media_disclosure: {
        decision_authority: "SYSTEM_POLICY",
        decision_provenance: {
          policy_id: "pulse-youtube-synthetic-media",
          policy_version: "1",
          evaluated_at: NOW,
          evidence_sha256: "b".repeat(64),
        },
        altered_content: true,
        policy_basis: "DISCLOSE",
        youtube_field_value: true,
      },
    },
  });
}

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-t90-source-report-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const upstreamPath = path.join(root, "source-apply.json");
  const outputPath = path.join(root, "t90-eligibility.json");
  const upstream = upstreamReport();
  const upstreamBytes = Buffer.from(
    `${JSON.stringify(upstream, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(upstreamPath, upstreamBytes);
  return {
    root,
    upstreamPath,
    outputPath,
    upstream,
    request: {
      schema_version: REQUEST_SCHEMA_VERSION,
      mode: "LOCAL_PROOF",
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      role: "PRIMARY",
      generated_at: NOW,
      scheduled_for: SCHEDULED_FOR,
      candidate_revision_sha256:
        CANDIDATE_REVISION_SHA256,
      request_fingerprint: REQUEST_FINGERPRINT,
      jit_preparation: jitPreparation(),
      discovered_at: "2026-07-30T07:00:00.000Z",
      publish_by: "2026-07-30T10:00:00.000Z",
      stale_after: "2026-07-30T10:00:00.000Z",
      stale_reframe_option: {
        allowed: true,
        reason: "Reframe as a confirmed platform explainer if late.",
      },
      upstream_source_apply_report: {
        path: upstreamPath,
        file_sha256: sha256Bytes(upstreamBytes),
        report_sha256: upstream.report_sha256,
      },
      output_path: outputPath,
    },
  };
}

test("materialises a hash-bound T90 eligibility report that safely spans T75 plus margin", async (t) => {
  const input = await fixture(t);
  const result =
    await materialiseGovernedAutonomousT90EligibilitySourceReport(
      input.request,
      {
        workspaceRoot: input.root,
        clock: () => new Date(NOW),
      },
    );

  assert.equal(result.status, "APPLIED");
  assert.equal(result.report.schema_version, REPORT_SCHEMA_VERSION);
  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.report.valid_until, REQUIRED_VALID_THROUGH);
  assert.equal(result.report.publish_authority, false);
  assert.equal(result.report.scheduler_authority, false);
  assert.equal(result.report.external_publish_authorised, false);
  assert.equal(result.report.platform_contacted, false);
  assert.equal(result.source_snapshot.source_last_checked_at, NOW);
  assert.equal(
    result.source_snapshot.source_report.valid_until,
    REQUIRED_VALID_THROUGH,
  );
  assert.equal(
    result.source_snapshot.source_report.file_sha256,
    sha256Bytes(await fs.readFile(input.outputPath)),
  );
  assert.deepEqual(
    validateGovernedAutonomousT90EligibilitySourceReport(
      JSON.parse(await fs.readFile(input.outputPath, "utf8")),
      {
        now: new Date(NOW),
        expected: {
          story_id: STORY_ID,
          scheduled_for: SCHEDULED_FOR,
        },
      },
    ),
    result.report,
  );
  assert.deepEqual(
    validateGovernedAutonomousT90EligibilitySourceReportForApply({
      value: result.report,
      bytes: await fs.readFile(input.outputPath),
      resolvedPath: input.outputPath,
      expected: {
        story_id: STORY_ID,
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        role: "PRIMARY",
        scheduled_for: SCHEDULED_FOR,
        file_sha256:
          result.source_snapshot.source_report.file_sha256,
        report_sha256: result.report.report_sha256,
        request_sha256: result.report.request_sha256,
        generated_at: result.report.generated_at,
        valid_until: result.report.valid_until,
        jit_preparation_sha256:
          input.request.jit_preparation.preparation_sha256,
        candidate_revision_sha256:
          CANDIDATE_REVISION_SHA256,
        request_fingerprint: REQUEST_FINGERPRINT,
        source_evidence_sha256:
          input.request.jit_preparation.artifacts.source_evidence.sha256,
        story_intake_sha256:
          input.request.jit_preparation.artifacts.story_intake.sha256,
      },
    }),
    {
      schema_version:
        "pulse-governed-t90-source-report-validation-v1",
      report_sha256: result.report.report_sha256,
      request_sha256: result.report.request_sha256,
      generated_at: result.report.generated_at,
      valid_until: result.report.valid_until,
    },
  );
});

test("replays exact output idempotently and rejects a no-clobber conflict", async (t) => {
  const input = await fixture(t);
  const options = {
    workspaceRoot: input.root,
    clock: () => new Date(NOW),
  };
  const first =
    await materialiseGovernedAutonomousT90EligibilitySourceReport(
      input.request,
      options,
    );
  const second =
    await materialiseGovernedAutonomousT90EligibilitySourceReport(
      input.request,
      options,
    );
  assert.equal(second.status, "IDEMPOTENT");
  assert.equal(second.report.report_sha256, first.report.report_sha256);

  const conflict = structuredClone(input.request);
  conflict.publish_by = "2026-07-30T09:59:00.000Z";
  await assert.rejects(
    materialiseGovernedAutonomousT90EligibilitySourceReport(
      conflict,
      options,
    ),
    (error) => error?.code === "t90_eligibility_output_conflict",
  );
});

test("fails closed on expired or unsafe upstream evidence and leaves no output", async (t) => {
  const cases = [
    {
      name: "expired",
      override: { valid_until: NOW },
      code: "t90_eligibility_upstream_expired",
    },
    {
      name: "not green",
      override: { verdict: "HOLD", blockers: ["source_changed"] },
      code: "t90_eligibility_upstream_not_green",
    },
    {
      name: "authority smuggling",
      override: { operational_publish_authority: true },
      code: "t90_eligibility_upstream_authority_forbidden",
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const input = await fixture(t);
      const upstream = upstreamReport(item.override);
      const bytes = Buffer.from(
        `${JSON.stringify(upstream, null, 2)}\n`,
        "utf8",
      );
      await fs.writeFile(input.upstreamPath, bytes);
      input.request.upstream_source_apply_report.file_sha256 =
        sha256Bytes(bytes);
      input.request.upstream_source_apply_report.report_sha256 =
        upstream.report_sha256;
      await assert.rejects(
        materialiseGovernedAutonomousT90EligibilitySourceReport(
          input.request,
          {
            workspaceRoot: input.root,
            clock: () => new Date(NOW),
          },
        ),
        (error) => error?.code === item.code,
      );
      await assert.rejects(fs.stat(input.outputPath), {
        code: "ENOENT",
      });
    });
  }
});

test("refuses to mint eligibility beyond the 30-minute freshness policy or story lifetime", async (t) => {
  const input = await fixture(t);
  input.request.generated_at = "2026-07-30T07:00:00.000Z";
  input.request.scheduled_for = "2026-07-30T08:35:00.000Z";
  await assert.rejects(
    materialiseGovernedAutonomousT90EligibilitySourceReport(
      input.request,
      {
        workspaceRoot: input.root,
        clock: () => new Date("2026-07-30T07:00:00.000Z"),
      },
    ),
    (error) =>
      error?.code === "t90_eligibility_guarded_window_required" ||
      error?.code === "t90_eligibility_validity_exceeds_freshness_policy",
  );

  const stale = await fixture(t);
  stale.request.publish_by = "2026-07-30T07:45:59.999Z";
  await assert.rejects(
    materialiseGovernedAutonomousT90EligibilitySourceReport(
      stale.request,
      {
        workspaceRoot: stale.root,
        clock: () => new Date(NOW),
      },
    ),
    (error) =>
      error?.code === "t90_eligibility_story_lifetime_too_short",
  );
});
