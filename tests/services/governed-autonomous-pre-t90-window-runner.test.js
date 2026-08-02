"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  runGovernedAutonomousPreT90WindowPreparation,
} = require("../../lib/services/governed-autonomous-pre-t90-window-runner");

const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const T94 = "2026-07-30T07:26:00.000Z";
const T90 = "2026-07-30T07:30:00.000Z";

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest("hex");
}

function request(workspaceRoot, overrides = {}) {
  return {
    schema_version: REQUEST_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    attempt_output_root: path.join(
      workspaceRoot,
      "output",
      "autonomous-pre-t90",
      "attempt-job-42",
    ),
    catch_up_allowed: false,
    publish_authority: false,
    external_posting: false,
    ...overrides,
  };
}

function candidate(role) {
  const suffix = role === "PRIMARY" ? "primary" : "standby";
  const storyId = `story-${suffix}`;
  const receipt = {
    schema_version:
      "pulse-governed-autonomous-candidate-completion-receipt-v1",
    mode: "LOCAL_PROOF",
    verdict: "GREEN",
    blockers: [],
    generated_at: "2026-07-30T06:00:00.000Z",
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role,
    candidate_revision_sha256: hash(`${storyId}:revision`),
    request_fingerprint: hash(`${storyId}:fingerprint`),
    coordinator_result: {
      path: `output/${storyId}/coordinator.json`,
      file_sha256: hash(`${storyId}:coordinator-file`),
      canonical_sha256: hash(`${storyId}:coordinator-canonical`),
    },
    staging_result: {
      path: `output/${storyId}/staging.json`,
      file_sha256: hash(`${storyId}:staging-file`),
      canonical_sha256: hash(`${storyId}:staging-canonical`),
    },
    preparation_manifest: {
      path: `output/${storyId}/preparation.json`,
      file_sha256: hash(`${storyId}:preparation-file`),
      canonical_sha256: hash(`${storyId}:preparation-canonical`),
    },
    final_mp4: {
      path: `output/${storyId}/final.mp4`,
      file_sha256: hash(`${storyId}:final`),
    },
    safety: {
      local_proof_only: true,
      database_mutated: false,
      network_used: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
    receipt_sha256: hash(`${storyId}:receipt`),
  };
  return {
    audit_id: role === "PRIMARY" ? 100 : 101,
    evidence: {
      receipt_ref: {
        path: `output/${storyId}/completion.json`,
        file_sha256: hash(`${storyId}:receipt-file`),
        receipt_sha256: receipt.receipt_sha256,
      },
    },
    receipt,
  };
}

function revalidated(entry) {
  const { receipt } = entry;
  const intake = {
    schema_version: "pulse-governed-story-intake-v1",
    story: { id: receipt.story_id },
    freshness: {
      discovered_at: "2026-07-30T05:00:00.000Z",
      source_last_checked_at: "2026-07-30T06:00:00.000Z",
      publish_by: "2026-07-30T12:00:00.000Z",
      stale_after: "2026-07-30T13:00:00.000Z",
      reverification_required: true,
      stale_reframe_option: {
        allowed: true,
        reason: "Reframe as a confirmed player-impact explainer.",
      },
    },
  };
  const preparation = {
    schema_version:
      "pulse-autonomous-official-source-jit-preparation-v3",
    story_id: receipt.story_id,
    channel_id: receipt.channel_id,
    lane_id: receipt.lane_id,
    platform: receipt.platform,
    scheduled_for: receipt.scheduled_for,
    role: receipt.role,
    candidate_revision_sha256: receipt.candidate_revision_sha256,
    request_fingerprint: receipt.request_fingerprint,
    artifacts: {
      story_intake: {
        path: `output/${receipt.story_id}/story-intake.json`,
        sha256: hash(`${receipt.story_id}:story-intake`),
      },
      source_evidence: {
        path: `output/${receipt.story_id}/source-evidence.json`,
        sha256: hash(`${receipt.story_id}:source-evidence`),
      },
    },
    owned_visual_assets: [],
    preparation_sha256:
      receipt.preparation_manifest.canonical_sha256,
  };
  return {
    receipt,
    coordinator_result: {
      schema_version:
        "pulse-governed-autonomous-production-result-v1",
      verdict: "GREEN",
      story_id: receipt.story_id,
    },
    preparation,
    intake,
  };
}

function clockSequence(...values) {
  let index = 0;
  return () => {
    const selected = values[Math.min(index, values.length - 1)];
    index += 1;
    return new Date(selected);
  };
}

function harness(workspaceRoot, overrides = {}) {
  const calls = [];
  const primary = candidate("PRIMARY");
  const standby = candidate("STANDBY");
  const dependencies = {
    clock: clockSequence(T94, "2026-07-30T07:28:00.000Z", "2026-07-30T07:28:01.000Z"),
    workspaceRoot,
    repos: {
      db: {},
      runtimeLeases: {},
    },
    runtimeAuthority: Object.freeze({ runtime_instance_id: "trusted-runtime" }),
    claimedJobAuthority: Object.freeze({
      claimed_job_authority_sha256: "b".repeat(64),
    }),
    env: {},
    async loadCompletionReceipts(input) {
      calls.push(["load", input.scheduledFor]);
      return {
        source: "operator_audit_log",
        channel_id: "pulse-gaming",
        lane_id: "breaking_short",
        platform: "youtube",
        scheduled_for: SCHEDULED_FOR,
        primary,
        standby,
      };
    },
    async revalidateCandidateCompletion(input) {
      calls.push([
        "revalidate",
        input.entry.receipt.story_id,
      ]);
      return revalidated(input.entry);
    },
    async runWithPublicationAdmissionLease(input) {
      calls.push(["lease", input.operation]);
      assert.equal(input.runtimeAuthority, dependencies.runtimeAuthority);
      assert.equal(
        input.claimedJobAuthority,
        dependencies.claimedJobAuthority,
      );
      return input.task({
        assertHealthy() {
          calls.push(["lease-healthy"]);
        },
        publicationAdmissionLease: {
          acquired: true,
          lease_name: "publication-admission:global",
          current_lock_owner_sha256: "a".repeat(64),
          claimed_job_authority_sha256: "b".repeat(64),
          expires_at: "2026-07-30T07:35:00.000Z",
        },
      });
    },
    async materialiseControlProofs(input) {
      calls.push(["controls", input.storyId]);
      return {
        schema_version:
          "pulse-autonomous-admission-control-proof-result-v2",
        verdict: "GREEN",
        generated_at: "2026-07-30T07:26:00.000Z",
        valid_until: "2026-07-30T07:27:00.000Z",
        story_id: input.storyId,
        channel_id: "pulse-gaming",
        kill_switch_proof: {
          path: path.join(input.outputDir, "kill.json"),
          sha256: hash(`${input.storyId}:kill`),
        },
        publication_admission_owner_proof: {
          path: path.join(input.outputDir, "owner.json"),
          sha256: hash(`${input.storyId}:owner`),
        },
        operational_publish_authority: false,
        dispatch_authorised: false,
        external_publish_authorised: false,
        platform_contacted: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
      };
    },
    async materialiseSourceEvidence(input) {
      calls.push(["source", input.story_id]);
      fs.mkdirSync(path.dirname(input.report_path), {
        recursive: true,
      });
      const report = {
        schema_version:
          "pulse-autonomous-official-source-evidence-apply-report-v4",
        materialiser_id:
          "pulse-autonomous-official-source-evidence-apply-v4",
        mode: "LOCAL_PROOF",
        generated_at: "2026-07-30T07:26:00.000Z",
        valid_until: "2026-07-30T07:28:00.000Z",
        request_sha256: hash(`${input.story_id}:source-request`),
        story_id: input.story_id,
        verdict: "GREEN",
        blockers: [],
        source_revalidation: { sources: [{}] },
        operational_publish_authority: false,
        dispatch_authorised: false,
        external_publish_authorised: false,
        platform_contacted: false,
        database_mutated: false,
        oauth_or_tokens_mutated: false,
        platform_objects_created: false,
        report_sha256: hash(`${input.story_id}:source-report`),
      };
      fs.writeFileSync(
        input.report_path,
        `${JSON.stringify(report)}\n`,
      );
      return {
        schema_version:
          "pulse-autonomous-official-source-evidence-apply-result-v3",
        status: "APPLIED",
        mutated: true,
        idempotent: false,
        report_path: input.report_path,
        report,
      };
    },
    async materialiseT90SourceReport(input) {
      calls.push(["t90-source", input.story_id]);
      fs.mkdirSync(path.dirname(input.output_path), {
        recursive: true,
      });
      const report = {
        report_sha256: hash(`${input.story_id}:t90-report`),
        request_sha256: hash(`${input.story_id}:t90-request`),
        generated_at: input.generated_at,
        valid_until: "2026-07-30T07:46:01.000Z",
      };
      fs.writeFileSync(
        input.output_path,
        `${JSON.stringify(report)}\n`,
      );
      return {
        schema_version:
          "pulse-governed-autonomous-t90-eligibility-source-result-v1",
        status: "APPLIED",
        mutated: true,
        idempotent: false,
        report_path: input.output_path,
        report_file_sha256: hash(
          fs.readFileSync(input.output_path),
        ),
        report,
        source_snapshot: {
          discovered_at: input.discovered_at,
          source_last_checked_at: input.generated_at,
          publish_by: input.publish_by,
          stale_after: input.stale_after,
          stale_reframe_option: input.stale_reframe_option,
          source_report: {
            path: input.output_path,
            file_sha256: hash(fs.readFileSync(input.output_path)),
            report_sha256: report.report_sha256,
            request_sha256: report.request_sha256,
            generated_at: report.generated_at,
            valid_until: report.valid_until,
          },
        },
        safety: {
          local_proof_only: true,
          network_used: false,
          database_mutated: false,
          oauth_or_tokens_mutated: false,
          platform_contacted: false,
          publish_authority: false,
          scheduler_authority: false,
          external_publish_authorised: false,
        },
      };
    },
    composeCandidates(input) {
      calls.push(["compose", input.now]);
      return {
        schema_version:
          "pulse-governed-autonomous-pre-t90-candidate-composition-result-v1",
        mode: "LOCAL_PROOF",
        verdict: "GREEN",
        blockers: [],
        generated_at: input.now,
        scheduled_for: input.scheduled_for,
        t90_at: T90,
        candidates: [
          {
            story_id: input.primary.coordinator_result.story_id,
            role: "PRIMARY",
          },
          {
            story_id: input.reserve.coordinator_result.story_id,
            role: "STANDBY",
          },
        ],
        safety: {
          local_proof_only: true,
          database_mutated: false,
          network_used: false,
          oauth_or_tokens_mutated: false,
          platform_contacted: false,
          publish_authority: false,
          scheduler_authority: false,
          external_publish_authorised: false,
        },
        composition_sha256: hash("composition"),
      };
    },
    applyComposition(input) {
      calls.push(["apply", input.now.toISOString()]);
      return {
        schema_version:
          "pulse-governed-autonomous-pre-t90-candidate-application-result-v1",
        verdict: "APPLIED",
        composition_sha256: input.composition.composition_sha256,
        applied_at: input.now.toISOString(),
        scheduled_for: SCHEDULED_FOR,
        t90_at: T90,
        candidates: [
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
        database_mutated: true,
        external_posting: false,
        publish_authority_created: false,
        scheduler_authority_created: false,
        platform_contacted: false,
        network_used: false,
        oauth_or_tokens_mutated: false,
      };
    },
    ...overrides,
  };
  return { calls, dependencies };
}

async function rejectsCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error?.code === code,
  );
}

test("prepares PRIMARY and STANDBY in one lease, applies once and persists no-authority evidence", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-runner-"),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  );
  const { calls, dependencies } = harness(workspaceRoot);

  const result =
    await runGovernedAutonomousPreT90WindowPreparation(
      request(workspaceRoot),
      dependencies,
    );

  assert.equal(result.schema_version, RESULT_SCHEMA_VERSION);
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.scheduled_for, SCHEDULED_FOR);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map(({ story_id, role }) => ({
      story_id,
      role,
    })),
    [
      { story_id: "story-primary", role: "PRIMARY" },
      { story_id: "story-standby", role: "STANDBY" },
    ],
  );
  assert.equal(result.publish_authority_created, false);
  assert.equal(result.external_posting, false);
  assert.equal(result.platform_contacted, false);
  assert.equal(result.oauth_or_tokens_mutated, false);
  assert.equal(result.database_mutated, true);
  assert.match(result.report_file_sha256, /^[a-f0-9]{64}$/);
  const persisted = JSON.parse(
    fs.readFileSync(result.report_path, "utf8"),
  );
  assert.equal(persisted.report_sha256, result.report.report_sha256);
  assert.equal(persisted.publish_authority_created, false);
  assert.equal(persisted.external_posting, false);
  assert.equal(
    calls.filter(([name]) => name === "lease").length,
    1,
  );
  assert.equal(
    calls.filter(([name]) => name === "source").length,
    2,
  );
  assert.equal(
    calls.filter(([name]) => name === "compose").length,
    1,
  );
  assert.equal(
    calls.filter(([name]) => name === "apply").length,
    1,
  );
  assert.ok(
    calls.filter(([name]) => name === "revalidate").length >= 4,
    "both immutable candidates are revalidated before evidence and again before composition",
  );
});

test("rejects early invocation, late catch-up and any catch-up permission", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-timing-"),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  );
  for (const scenario of [
    {
      now: "2026-07-30T07:25:59.999Z",
      override: {},
      code: "pre_t90_runner_outside_preparation_interval",
    },
    {
      now: T90,
      override: {},
      code: "pre_t90_runner_catch_up_forbidden",
    },
    {
      now: T94,
      override: { catch_up_allowed: true },
      code: "pre_t90_runner_catch_up_forbidden",
    },
  ]) {
    const { dependencies } = harness(workspaceRoot, {
      clock: clockSequence(scenario.now),
    });
    await rejectsCode(
      runGovernedAutonomousPreT90WindowPreparation(
        request(workspaceRoot, scenario.override),
        dependencies,
      ),
      scenario.code,
    );
  }
});

test("fails closed when the clock crosses T90 before composition or before atomic apply", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-crossing-"),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  );
  const beforeCompose = harness(workspaceRoot, {
    clock: clockSequence(
      T94,
      "2026-07-30T07:27:00.000Z",
      "2026-07-30T07:27:10.000Z",
      "2026-07-30T07:28:00.000Z",
      "2026-07-30T07:28:10.000Z",
      T90,
    ),
  });
  await rejectsCode(
    runGovernedAutonomousPreT90WindowPreparation(
      request(workspaceRoot),
      beforeCompose.dependencies,
    ),
    "pre_t90_runner_crossed_t90_before_composition",
  );
  assert.equal(
    beforeCompose.calls.some(([name]) => name === "apply"),
    false,
  );

  const beforeApply = harness(workspaceRoot, {
    clock: clockSequence(
      T94,
      "2026-07-30T07:27:00.000Z",
      "2026-07-30T07:27:10.000Z",
      "2026-07-30T07:28:00.000Z",
      "2026-07-30T07:28:10.000Z",
      "2026-07-30T07:29:59.999Z",
      T90,
    ),
  });
  await rejectsCode(
    runGovernedAutonomousPreT90WindowPreparation(
      request(workspaceRoot, {
        attempt_output_root: path.join(
          workspaceRoot,
          "output",
          "autonomous-pre-t90",
          "attempt-job-43",
        ),
      }),
      beforeApply.dependencies,
    ),
    "pre_t90_runner_crossed_t90_before_apply",
  );
  assert.equal(
    beforeApply.calls.some(([name]) => name === "apply"),
    false,
  );
});

test("fails closed for missing indexed receipts and candidate artefact drift", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-receipts-"),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  );
  const missing = harness(workspaceRoot, {
    async loadCompletionReceipts() {
      const error = new Error("candidate_completion_index_primary_missing");
      error.code = "candidate_completion_index_primary_missing";
      throw error;
    },
  });
  await rejectsCode(
    runGovernedAutonomousPreT90WindowPreparation(
      request(workspaceRoot),
      missing.dependencies,
    ),
    "pre_t90_runner_completion_receipts_unavailable",
  );

  const drift = harness(workspaceRoot, {
    async revalidateCandidateCompletion() {
      const error = new Error(
        "candidate_completion_coordinator_canonical_mismatch",
      );
      error.code =
        "candidate_completion_coordinator_canonical_mismatch";
      throw error;
    },
  });
  await rejectsCode(
    runGovernedAutonomousPreT90WindowPreparation(
      request(workspaceRoot, {
        attempt_output_root: path.join(
          workspaceRoot,
          "output",
          "autonomous-pre-t90",
          "attempt-job-44",
        ),
      }),
      drift.dependencies,
    ),
    "pre_t90_runner_candidate_artifact_drift",
  );
});

test("source failure and atomic apply failure never create a success receipt", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-failures-"),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  );
  const sourceFailure = harness(workspaceRoot, {
    async materialiseSourceEvidence() {
      throw new Error("official source unavailable");
    },
  });
  const sourceRequest = request(workspaceRoot, {
    attempt_output_root: path.join(
      workspaceRoot,
      "output",
      "autonomous-pre-t90",
      "attempt-source-failure",
    ),
  });
  await rejectsCode(
    runGovernedAutonomousPreT90WindowPreparation(
      sourceRequest,
      sourceFailure.dependencies,
    ),
    "pre_t90_runner_source_evidence_failed",
  );
  assert.equal(
    fs.existsSync(
      path.join(
        sourceRequest.attempt_output_root,
        "pre-t90-window-run.json",
      ),
    ),
    false,
  );

  const atomicFailure = harness(workspaceRoot, {
    applyComposition() {
      throw new Error("transaction rolled back");
    },
  });
  const atomicRequest = request(workspaceRoot, {
    attempt_output_root: path.join(
      workspaceRoot,
      "output",
      "autonomous-pre-t90",
      "attempt-atomic-failure",
    ),
  });
  await rejectsCode(
    runGovernedAutonomousPreT90WindowPreparation(
      atomicRequest,
      atomicFailure.dependencies,
    ),
    "pre_t90_runner_atomic_apply_failed",
  );
  assert.equal(
    fs.existsSync(
      path.join(
        atomicRequest.attempt_output_root,
        "pre-t90-window-run.json",
      ),
    ),
    false,
  );
});

test("rejects authority smuggled by any orchestration dependency", async (t) => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-pre-t90-authority-"),
  );
  t.after(() =>
    fs.rmSync(workspaceRoot, { recursive: true, force: true }),
  );
  const { dependencies } = harness(workspaceRoot, {
    applyComposition(input) {
      return {
        schema_version:
          "pulse-governed-autonomous-pre-t90-candidate-application-result-v1",
        verdict: "APPLIED",
        composition_sha256: input.composition.composition_sha256,
        applied_at: input.now.toISOString(),
        scheduled_for: SCHEDULED_FOR,
        t90_at: T90,
        candidates: [
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
        database_mutated: true,
        external_posting: true,
        publish_authority_created: true,
        scheduler_authority_created: false,
        platform_contacted: true,
        network_used: true,
        oauth_or_tokens_mutated: false,
      };
    },
  });
  await rejectsCode(
    runGovernedAutonomousPreT90WindowPreparation(
      request(workspaceRoot),
      dependencies,
    ),
    "pre_t90_runner_apply_authority_forbidden",
  );
});
