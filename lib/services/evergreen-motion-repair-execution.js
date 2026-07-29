"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  hasValidEvergreenMotionRepairWorkOrderHash,
} = require("./evergreen-motion-repair-work-order");

const EXECUTION_REQUEST_SCHEMA =
  "pulse-evergreen-motion-repair-execution-request-v1";
const EXECUTION_REQUEST_FILENAME =
  "evergreen-motion-repair-execution-request.json";
const EXECUTION_QUEUE_SCHEMA =
  "pulse-evergreen-motion-repair-execution-queue-v1";
const OPERATOR_CONFIRMATION =
  "MATERIALISE_LOCAL_MUTED_SEGMENTS";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_REQUEST_BYTES = 1024 * 1024;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "").trim();
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fileSha256(filePath) {
  return sha256(await fs.readFile(filePath));
}

function hashEvergreenMotionRepairExecutionRequest(value) {
  const material = structuredClone(object(value));
  delete material.request_sha256;
  return sha256(stableJson(material));
}

function isUnder(parent, child) {
  const relative = path.relative(
    path.resolve(parent),
    path.resolve(child),
  );
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function exactFalseSafety(safety) {
  const value = object(safety);
  return (
    value.local_proof_only === true &&
    value.network_authorised === false &&
    value.database_mutation_authorised === false &&
    value.oauth_mutation_authorised === false &&
    value.platform_contact_authorised === false &&
    value.publish_authority_created === false
  );
}

async function inspectEvergreenMotionRepairExecutionRequest({
  workOrderRecord,
} = {}) {
  const blockers = [];
  const declaredWorkOrderPath = text(workOrderRecord?.path);
  const declaredWorkOrderFileSha256 = text(
    workOrderRecord?.file_sha256,
  ).toLowerCase();
  const declaredWorkOrderSha256 = text(
    workOrderRecord?.work_order_sha256,
  ).toLowerCase();
  if (
    !declaredWorkOrderPath ||
    !text(workOrderRecord?.story_id) ||
    !text(workOrderRecord?.candidate_id) ||
    !SHA256_PATTERN.test(declaredWorkOrderFileSha256) ||
    !SHA256_PATTERN.test(declaredWorkOrderSha256)
  ) {
    return {
      verdict: "HOLD",
      blockers: ["motion_repair_work_order_record_invalid"],
      request_path: null,
      request: null,
      request_file_sha256: null,
    };
  }
  const workOrderPath = path.resolve(
    declaredWorkOrderPath,
  );
  const workOrderDir = path.dirname(workOrderPath);
  const requestPath = path.join(
    workOrderDir,
    EXECUTION_REQUEST_FILENAME,
  );
  if (!(await fs.pathExists(requestPath))) {
    return {
      verdict: "HOLD",
      blockers: ["motion_repair_execution_request_missing"],
      request_path: requestPath,
      request: null,
      request_file_sha256: null,
    };
  }
  const requestBytes = await fs.readFile(requestPath);
  if (
    requestBytes.length === 0 ||
    requestBytes.length > MAXIMUM_REQUEST_BYTES
  ) {
    blockers.push("motion_repair_execution_request_size_invalid");
  }
  let request = null;
  try {
    request = JSON.parse(requestBytes.toString("utf8"));
  } catch {
    blockers.push("motion_repair_execution_request_json_invalid");
  }
  const value = object(request);
  const declaredRequestSha256 = text(
    value.request_sha256,
  ).toLowerCase();
  if (value.schema_version !== EXECUTION_REQUEST_SCHEMA) {
    blockers.push("motion_repair_execution_request_schema_invalid");
  }
  if (value.mode !== "LOCAL_PROOF") {
    blockers.push("motion_repair_execution_request_mode_invalid");
  }
  if (
    Number.isNaN(
      new Date(text(value.generated_at)).getTime(),
    )
  ) {
    blockers.push(
      "motion_repair_execution_request_generated_at_invalid",
    );
  }
  if (
    !SHA256_PATTERN.test(declaredRequestSha256) ||
    hashEvergreenMotionRepairExecutionRequest(value) !==
      declaredRequestSha256
  ) {
    blockers.push("motion_repair_execution_request_sha256_mismatch");
  }
  if (
    text(value.story_id) !== text(workOrderRecord?.story_id) ||
    text(value.candidate_id) !==
      text(workOrderRecord?.candidate_id)
  ) {
    blockers.push("motion_repair_execution_request_identity_mismatch");
  }
  if (
    value.apply_local !== true ||
    text(value.operator_confirmation) !== OPERATOR_CONFIRMATION
  ) {
    blockers.push("motion_repair_execution_operator_confirmation_required");
  }
  if (!exactFalseSafety(value.safety)) {
    blockers.push("motion_repair_execution_safety_envelope_invalid");
  }

  const workOrderRef = object(value.work_order);
  const expectedWorkOrderFileSha256 = text(
    workOrderRecord?.file_sha256,
  ).toLowerCase();
  const expectedWorkOrderSha256 = text(
    workOrderRecord?.work_order_sha256,
  ).toLowerCase();
  if (
    path.resolve(text(workOrderRef.path)) !== workOrderPath ||
    text(workOrderRef.file_sha256).toLowerCase() !==
      expectedWorkOrderFileSha256 ||
    text(workOrderRef.work_order_sha256).toLowerCase() !==
      expectedWorkOrderSha256
  ) {
    blockers.push("motion_repair_execution_work_order_binding_mismatch");
  }
  if (!(await fs.pathExists(workOrderPath))) {
    blockers.push("motion_repair_execution_work_order_missing");
  } else {
    const observedWorkOrderFileSha256 =
      await fileSha256(workOrderPath);
    let workOrder = null;
    try {
      workOrder = await fs.readJson(workOrderPath);
    } catch {
      blockers.push("motion_repair_execution_work_order_json_invalid");
    }
    if (
      observedWorkOrderFileSha256 !==
        expectedWorkOrderFileSha256 ||
      !hasValidEvergreenMotionRepairWorkOrderHash(workOrder) ||
      text(workOrder?.work_order_sha256).toLowerCase() !==
        expectedWorkOrderSha256
    ) {
      blockers.push("motion_repair_execution_work_order_hash_mismatch");
    }
  }

  const sourceVideo = object(value.source_video);
  const sourcePathText = text(sourceVideo.path);
  const sourcePath = path.resolve(sourcePathText);
  const expectedSourceSha256 = text(
    sourceVideo.file_sha256,
  ).toLowerCase();
  if (
    !sourcePathText ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(sourcePathText)
  ) {
    blockers.push("motion_repair_execution_local_source_required");
  } else if (!(await fs.pathExists(sourcePath))) {
    blockers.push("motion_repair_execution_source_missing");
  } else if (
    !SHA256_PATTERN.test(expectedSourceSha256) ||
    (await fileSha256(sourcePath)) !== expectedSourceSha256
  ) {
    blockers.push("motion_repair_execution_source_hash_mismatch");
  }
  if (!/^https:\/\//i.test(text(sourceVideo.source_media_url))) {
    blockers.push("motion_repair_execution_official_source_url_required");
  }
  if (
    !Array.isArray(value.segments) ||
    value.segments.length === 0 ||
    value.segments.length > 12
  ) {
    blockers.push("motion_repair_execution_segments_required");
  }
  const outputDir = path.resolve(
    text(value.output_dir) ||
      path.join(workOrderDir, "materialised-motion"),
  );
  if (!isUnder(workOrderDir, outputDir)) {
    blockers.push("motion_repair_execution_output_unbound");
  }

  return {
    verdict: blockers.length === 0 ? "READY" : "HOLD",
    blockers: [...new Set(blockers)].sort(),
    request_path: requestPath,
    request_file_sha256: sha256(requestBytes),
    request: value,
    execution: {
      work_order_path: workOrderPath,
      source_video_path: sourcePath,
      source_video_sha256: expectedSourceSha256,
      source_media_url: text(sourceVideo.source_media_url),
      segments: structuredClone(
        Array.isArray(value.segments) ? value.segments : [],
      ),
      output_dir: outputDir,
      request_sha256: declaredRequestSha256,
    },
  };
}

async function enqueueEvergreenMotionRepairExecutions({
  workOrders,
  jobs,
  channelId = "pulse-gaming",
  now = new Date().toISOString(),
} = {}) {
  const queued = [];
  const reused = [];
  const done = [];
  const held = [];
  for (const workOrder of Array.isArray(workOrders)
    ? workOrders
    : []) {
    const inspection =
      await inspectEvergreenMotionRepairExecutionRequest({
        workOrderRecord: workOrder,
      });
    if (inspection.verdict !== "READY") {
      held.push({
        story_id: workOrder.story_id,
        candidate_id: workOrder.candidate_id,
        work_order_sha256: workOrder.work_order_sha256,
        execution_request_path: inspection.request_path,
        blockers: inspection.blockers,
      });
      continue;
    }
    if (!jobs || typeof jobs.enqueue !== "function") {
      held.push({
        story_id: workOrder.story_id,
        candidate_id: workOrder.candidate_id,
        work_order_sha256: workOrder.work_order_sha256,
        execution_request_path: inspection.request_path,
        blockers: ["motion_repair_jobs_repository_required"],
      });
      continue;
    }
    const request = inspection.request;
    const idempotencyKey =
      `evergreen-motion-repair:${workOrder.story_id}:` +
      `${workOrder.work_order_sha256}:${request.request_sha256}`;
    const existing =
      typeof jobs.getByIdempotencyKey === "function"
        ? jobs.getByIdempotencyKey(idempotencyKey)
        : null;
    const enqueued = jobs.enqueue({
      kind: "materialize_evergreen_motion_repair",
      channel_id: channelId,
      story_id: workOrder.story_id,
      payload: {
        schema_version:
          "pulse-evergreen-motion-repair-materialization-job-v1",
        generated_at: new Date(
          request.generated_at,
        ).toISOString(),
        story_id: workOrder.story_id,
        candidate_id: workOrder.candidate_id,
        work_order: {
          story_id: workOrder.story_id,
          candidate_id: workOrder.candidate_id,
          path: workOrder.path,
          file_sha256: workOrder.file_sha256,
          work_order_sha256: workOrder.work_order_sha256,
        },
        execution_request: {
          path: inspection.request_path,
          file_sha256: inspection.request_file_sha256,
          request_sha256: request.request_sha256,
        },
        apply_local_authorised: true,
        human_review_required: true,
        publish_authority: false,
        external_posting_authorised: false,
        oauth_mutation_authorised: false,
      },
      priority: 11,
      requires_gpu: false,
      max_attempts: 2,
      idempotency_key: idempotencyKey,
    });
    const result = {
      id: enqueued.id,
      kind: enqueued.kind,
      status: enqueued.status || null,
      story_id: workOrder.story_id,
      candidate_id: workOrder.candidate_id,
      work_order_sha256: workOrder.work_order_sha256,
      execution_request_sha256: request.request_sha256,
    };
    if (existing?.status === "done") {
      done.push(result);
    } else if (existing) {
      reused.push(result);
    } else {
      queued.push(result);
    }
  }
  const verdict =
    queued.length > 0
      ? "QUEUED"
      : reused.length > 0
        ? "REUSED"
        : done.length > 0
          ? "DONE"
          : "HOLD";
  return {
    schema_version: EXECUTION_QUEUE_SCHEMA,
    generated_at: new Date(now).toISOString(),
    mode: "LOCAL_PROOF",
    verdict,
    queued,
    reused,
    done,
    held,
    safety: {
      local_proof_only: true,
      database_jobs_enqueued: queued.length,
      database_content_mutated: false,
      oauth_mutated: false,
      external_platform_contacted: false,
      publish_authority_created: false,
    },
  };
}

module.exports = {
  EXECUTION_QUEUE_SCHEMA,
  EXECUTION_REQUEST_FILENAME,
  EXECUTION_REQUEST_SCHEMA,
  OPERATOR_CONFIRMATION,
  enqueueEvergreenMotionRepairExecutions,
  hashEvergreenMotionRepairExecutionRequest,
  inspectEvergreenMotionRepairExecutionRequest,
};
