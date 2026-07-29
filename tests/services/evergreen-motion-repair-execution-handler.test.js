"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  hashEvergreenMotionRepairExecutionRequest,
  OPERATOR_CONFIRMATION,
} = require("../../lib/services/evergreen-motion-repair-execution");
const {
  hashEvergreenMotionRepairWorkOrder,
} = require("../../lib/services/evergreen-motion-repair-work-order");

const NOW = "2026-07-28T12:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-evergreen-motion-job-"),
  );
  t.after(() => fs.remove(root));
  const workOrderDir = path.join(
    root,
    "motion-repair",
    "story-motion-job",
  );
  await fs.ensureDir(workOrderDir);
  const workOrderBase = {
    schema_version:
      "pulse-evergreen-motion-coverage-repair-work-order-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: "story-motion-job",
    candidate_id: "candidate-motion-job",
    blocker: "exact_subject_motion_ratio_too_low",
    minimum_required_motion_seconds: 53.3,
    verified_materialised_motion_seconds: 28,
    additional_motion_seconds_required: 25.3,
    safety: {
      local_proof_only: true,
      publish_authority_created: false,
    },
  };
  const workOrder = {
    ...workOrderBase,
    work_order_sha256:
      hashEvergreenMotionRepairWorkOrder(workOrderBase),
  };
  const workOrderPath = path.join(
    workOrderDir,
    "evergreen-motion-coverage-repair-work-order.json",
  );
  await fs.writeJson(workOrderPath, workOrder, { spaces: 2 });
  const workOrderBytes = await fs.readFile(workOrderPath);
  const sourceVideoPath = path.join(root, "official-source.mp4");
  const sourceBytes = Buffer.from("official-source-video");
  await fs.writeFile(sourceVideoPath, sourceBytes);
  const outputDir = path.join(
    workOrderDir,
    "materialised-motion",
  );
  const requestBase = {
    schema_version:
      "pulse-evergreen-motion-repair-execution-request-v1",
    generated_at: NOW,
    mode: "LOCAL_PROOF",
    story_id: workOrder.story_id,
    candidate_id: workOrder.candidate_id,
    work_order: {
      path: workOrderPath,
      file_sha256: sha256(workOrderBytes),
      work_order_sha256: workOrder.work_order_sha256,
    },
    source_video: {
      path: sourceVideoPath,
      file_sha256: sha256(sourceBytes),
      source_media_url:
        "https://publisher.example/official-source",
    },
    segments: [
      { start_seconds: 30, duration_seconds: 5 },
      { start_seconds: 75, duration_seconds: 5 },
      { start_seconds: 120, duration_seconds: 5 },
      { start_seconds: 165, duration_seconds: 5 },
      { start_seconds: 210, duration_seconds: 5 },
      { start_seconds: 255, duration_seconds: 5 },
    ],
    output_dir: outputDir,
    apply_local: true,
    operator_confirmation: OPERATOR_CONFIRMATION,
    safety: {
      local_proof_only: true,
      network_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      platform_contact_authorised: false,
      publish_authority_created: false,
    },
  };
  const request = {
    ...requestBase,
    request_sha256:
      hashEvergreenMotionRepairExecutionRequest(requestBase),
  };
  const requestPath = path.join(
    workOrderDir,
    "evergreen-motion-repair-execution-request.json",
  );
  await fs.writeJson(requestPath, request, { spaces: 2 });
  const requestBytes = await fs.readFile(requestPath);
  return {
    workOrder,
    workOrderPath,
    workOrderFileSha256: sha256(workOrderBytes),
    sourceVideoPath,
    sourceVideoSha256: sha256(sourceBytes),
    outputDir,
    request,
    requestPath,
    requestFileSha256: sha256(requestBytes),
  };
}

function repairJob(value) {
  return {
    kind: "materialize_evergreen_motion_repair",
    channel_id: "pulse-gaming",
    story_id: value.workOrder.story_id,
    payload: {
      schema_version:
        "pulse-evergreen-motion-repair-materialization-job-v1",
      generated_at: NOW,
      story_id: value.workOrder.story_id,
      candidate_id: value.workOrder.candidate_id,
      work_order: {
        story_id: value.workOrder.story_id,
        candidate_id: value.workOrder.candidate_id,
        path: value.workOrderPath,
        file_sha256: value.workOrderFileSha256,
        work_order_sha256:
          value.workOrder.work_order_sha256,
      },
      execution_request: {
        path: value.requestPath,
        file_sha256: value.requestFileSha256,
        request_sha256: value.request.request_sha256,
      },
      apply_local_authorised: true,
      human_review_required: true,
      publish_authority: false,
      external_posting_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
}

test("durable evergreen motion-repair job materialises only the exact local approved request", async (t) => {
  const value = await fixture(t);
  const receiptPath = path.join(
    value.outputDir,
    "evergreen-motion-materialisation-receipt.json",
  );
  const receiptBytes = Buffer.from("receipt");
  const calls = [];

  const result =
    await handlers.materialize_evergreen_motion_repair(
      repairJob(value),
      {
        async materializeEvergreenMotionRepair(input) {
          calls.push(input);
          await fs.ensureDir(value.outputDir);
          await fs.writeFile(receiptPath, receiptBytes);
          return {
            schema_version:
              "pulse-evergreen-motion-materialisation-v1",
            verdict: "MATERIALISED",
            story_id: value.workOrder.story_id,
            candidate_id: value.workOrder.candidate_id,
            work_order_sha256:
              value.workOrder.work_order_sha256,
            receipt_path: receiptPath,
            receipt_file_sha256: sha256(receiptBytes),
            safety: {
              network_used: false,
              database_mutated: false,
              oauth_mutated: false,
              external_platform_contacted: false,
              publish_authority_created: false,
            },
          };
        },
      },
    );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].work_order_path,
    value.workOrderPath,
  );
  assert.equal(
    calls[0].source_video_path,
    value.sourceVideoPath,
  );
  assert.equal(
    calls[0].source_video_sha256,
    value.sourceVideoSha256,
  );
  assert.deepEqual(calls[0].segments, value.request.segments);
  assert.equal(calls[0].output_dir, value.outputDir);
  assert.equal(calls[0].apply_local, true);
  assert.equal(result.status, "MATERIALISED_AWAITING_COMPLETION");
  assert.deepEqual(result.blockers, [
    "motion_repair_completion_manifest_required",
  ]);
  assert.equal(result.receipt_path, receiptPath);
  assert.equal(result.no_publish, true);
  assert.equal(result.no_external_posting, true);
  assert.equal(result.no_oauth_or_token_change, true);
});

test("durable evergreen motion-repair job fails closed before compute when source bytes drift", async (t) => {
  const value = await fixture(t);
  await fs.writeFile(
    value.sourceVideoPath,
    Buffer.from("mutated-source-video"),
  );
  let materializerCalls = 0;

  const result =
    await handlers.materialize_evergreen_motion_repair(
      repairJob(value),
      {
        async materializeEvergreenMotionRepair() {
          materializerCalls += 1;
          throw new Error("must_not_run");
        },
      },
    );

  assert.equal(materializerCalls, 0);
  assert.equal(result.status, "HOLD");
  assert.ok(
    result.blockers.includes(
      "motion_repair_execution_source_hash_mismatch",
    ),
  );
  assert.equal(result.receipt_path, null);
  assert.equal(result.no_publish, true);
});
