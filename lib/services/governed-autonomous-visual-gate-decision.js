"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-visual-gate-request-v1";
const DECISION_SCHEMA_VERSION =
  "pulse-governed-autonomous-visual-gate-decision-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-autonomous-visual-gate-result-v1";
const VISUAL_QA_SCHEMA_VERSION =
  "pulse-local-multimodal-visual-review-v1";
const MODE = "LOCAL_PROOF";
const DECISION_AUTHORITY = "SYSTEM_POLICY";
const AUTHORITY_SCOPE =
  "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const POLICY_ID = "pulse-visual-review-policy";
const POLICY_VERSION = "2";
const POLICY_GATE = "AUTONOMOUS_OFFICIAL_UNANIMOUS";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FINAL_MP4_BYTES = 1024 * 1024 * 1024;
const MAX_VISUAL_QA_BYTES = 16 * 1024 * 1024;

const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "generated_at",
  "root_dir",
  "output_path",
  "final_mp4",
  "visual_qa",
]);
const FILE_REF_FIELDS = new Set(["path", "sha256"]);
const VISUAL_QA_REF_FIELDS = new Set([
  "path",
  "raw_sha256",
  "canonical_sha256",
]);
const VISUAL_QA_FIELDS = new Set([
  "schema_version",
  "mode",
  "generated_at",
  "story_id",
  "verdict",
  "blockers",
  "authority",
  "bindings",
  "frames",
  "model_aggregation",
  "model_reviews",
  "controls",
]);
const VISUAL_QA_AUTHORITY_FIELDS = new Set([
  "human_review",
  "approval_authority",
  "publication_authorised",
  "may_replace_human_approval",
]);
const VISUAL_QA_BINDINGS_FIELDS = new Set(["final_mp4"]);
const VISUAL_QA_AGGREGATION_FIELDS = new Set([
  "strategy",
  "requested_models",
  "review_count",
  "pass_count",
  "all_reviews_must_pass",
]);
const VISUAL_QA_REVIEW_FIELDS = new Set([
  "provider",
  "model",
  "verdict",
  "blockers",
  "capability_evidence",
]);
const VISUAL_QA_CAPABILITY_FIELDS = new Set([
  "completion",
  "vision",
]);
const VISUAL_QA_FRAME_FIELDS = new Set([
  "frame_id",
  "timestamp_ms",
  "path",
  "sha256",
  "width",
  "height",
  "deterministic_blockers",
]);
const VISUAL_QA_CONTROLS_FIELDS = new Set([
  "local_files_only",
  "database_mutated",
  "oauth_or_tokens_mutated",
  "platform_objects_created",
  "live_publish_attempted",
  "external_network_used",
  "loopback_inference_only",
]);

class GovernedAutonomousVisualGateDecisionError extends Error {
  constructor(code) {
    super(code);
    this.name = "GovernedAutonomousVisualGateDecisionError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousVisualGateDecisionError(code);
}

function text(value) {
  return String(value ?? "").trim();
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, fields, code) {
  if (!plainObject(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((field) => typeof field !== "string") ||
    ownKeys.some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      );
    })
  ) {
    fail(code);
  }
  const actual = ownKeys.sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    fail(code);
  }
  return raw;
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function normaliseRequest(value) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "autonomous_visual_gate_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("autonomous_visual_gate_request_schema_invalid");
  }
  const storyId = text(value.story_id);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(storyId)) {
    fail("autonomous_visual_gate_story_id_invalid");
  }
  if (
    text(value.channel_id) !== "pulse-gaming" ||
    text(value.lane_id) !== "breaking_short" ||
    text(value.platform) !== "youtube"
  ) {
    fail("autonomous_visual_gate_scope_invalid");
  }
  const generatedAt = exactTimestamp(
    value.generated_at,
    "autonomous_visual_gate_generated_at_invalid",
  );
  const rootDir = path.resolve(text(value.root_dir));
  const outputPath = path.resolve(text(value.output_path));
  if (
    !path.isAbsolute(text(value.root_dir)) ||
    !path.isAbsolute(text(value.output_path))
  ) {
    fail("autonomous_visual_gate_paths_invalid");
  }
  exactFields(
    value.final_mp4,
    FILE_REF_FIELDS,
    "autonomous_visual_gate_final_mp4_invalid",
  );
  exactFields(
    value.visual_qa,
    VISUAL_QA_REF_FIELDS,
    "autonomous_visual_gate_visual_qa_ref_invalid",
  );
  if (
    !path.isAbsolute(text(value.final_mp4.path)) ||
    !path.isAbsolute(text(value.visual_qa.path))
  ) {
    fail("autonomous_visual_gate_paths_invalid");
  }
  return {
    story_id: storyId,
    generated_at: generatedAt,
    root_dir: rootDir,
    output_path: outputPath,
    final_mp4: {
      path: path.resolve(text(value.final_mp4.path)),
      sha256: exactSha256(
        value.final_mp4.sha256,
        "autonomous_visual_gate_final_mp4_invalid",
      ),
    },
    visual_qa: {
      path: path.resolve(text(value.visual_qa.path)),
      raw_sha256: exactSha256(
        value.visual_qa.raw_sha256,
        "autonomous_visual_gate_visual_qa_ref_invalid",
      ),
      canonical_sha256: exactSha256(
        value.visual_qa.canonical_sha256,
        "autonomous_visual_gate_visual_qa_ref_invalid",
      ),
    },
  };
}

async function exactRoot(rootPath, fileSystem) {
  let stat;
  try {
    stat = await fileSystem.lstat(rootPath, { bigint: true });
  } catch {
    fail("autonomous_visual_gate_root_missing");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("autonomous_visual_gate_root_invalid");
  }
  const realPath = await fileSystem.realpath(rootPath);
  if (path.resolve(realPath) !== rootPath) {
    fail("autonomous_visual_gate_root_link_forbidden");
  }
  return { path: rootPath, real_path: path.resolve(realPath) };
}

async function exactFile({
  root,
  filePath,
  expectedSha256,
  maxBytes,
  label,
  fileSystem,
}) {
  if (!pathWithin(root.path, filePath)) {
    fail(`${label}_outside_root`);
  }
  let initial;
  try {
    initial = await fileSystem.lstat(filePath, { bigint: true });
  } catch {
    fail(`${label}_missing`);
  }
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(maxBytes) ||
    initial.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail(`${label}_invalid`);
  }
  const realPath = path.resolve(await fileSystem.realpath(filePath));
  if (!pathWithin(root.real_path, realPath)) {
    fail(`${label}_outside_root`);
  }
  const bytes = await fileSystem.readFile(filePath);
  const finalStat = await fileSystem.lstat(filePath, {
    bigint: true,
  });
  if (
    initial.dev !== finalStat.dev ||
    initial.ino !== finalStat.ino ||
    initial.size !== finalStat.size ||
    initial.mtimeNs !== finalStat.mtimeNs
  ) {
    fail(`${label}_changed_while_reading`);
  }
  const observedSha256 = sha256Bytes(bytes);
  if (observedSha256 !== expectedSha256) {
    fail(`${label}_sha256_mismatch`);
  }
  return { bytes, observed_sha256: observedSha256 };
}

function stringArray(value, code) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !text(item))
  ) {
    fail(code);
  }
  return value.map(text);
}

function validateVisualQa(report, request) {
  exactFields(
    report,
    VISUAL_QA_FIELDS,
    "autonomous_visual_gate_visual_qa_fields_invalid",
  );
  exactFields(
    report.authority,
    VISUAL_QA_AUTHORITY_FIELDS,
    "autonomous_visual_gate_visual_qa_authority_invalid",
  );
  exactFields(
    report.bindings,
    VISUAL_QA_BINDINGS_FIELDS,
    "autonomous_visual_gate_visual_qa_bindings_invalid",
  );
  exactFields(
    report.bindings.final_mp4,
    FILE_REF_FIELDS,
    "autonomous_visual_gate_visual_qa_bindings_invalid",
  );
  exactFields(
    report.model_aggregation,
    VISUAL_QA_AGGREGATION_FIELDS,
    "autonomous_visual_gate_model_aggregation_invalid",
  );
  exactFields(
    report.controls,
    VISUAL_QA_CONTROLS_FIELDS,
    "autonomous_visual_gate_visual_qa_controls_invalid",
  );

  const blockers = stringArray(
    report.blockers,
    "autonomous_visual_gate_visual_qa_blockers_invalid",
  );
  const requestedModels = stringArray(
    report.model_aggregation.requested_models,
    "autonomous_visual_gate_requested_models_invalid",
  );
  const reviews = Array.isArray(report.model_reviews)
    ? report.model_reviews
    : fail("autonomous_visual_gate_model_reviews_invalid");
  const frames = Array.isArray(report.frames)
    ? report.frames
    : fail("autonomous_visual_gate_frames_invalid");

  for (const frame of frames) {
    exactFields(
      frame,
      VISUAL_QA_FRAME_FIELDS,
      "autonomous_visual_gate_frame_fields_invalid",
    );
    if (
      !text(frame.frame_id) ||
      !Number.isInteger(frame.timestamp_ms) ||
      frame.timestamp_ms < 0 ||
      !path.isAbsolute(text(frame.path)) ||
      !pathWithin(
        request.root_dir,
        path.resolve(text(frame.path)),
      ) ||
      !SHA256_PATTERN.test(text(frame.sha256).toLowerCase()) ||
      Number(frame.width) !== 1080 ||
      Number(frame.height) !== 1920 ||
      stringArray(
        frame.deterministic_blockers,
        "autonomous_visual_gate_frame_blockers_invalid",
      ).length !== 0
    ) {
      fail("autonomous_visual_gate_frame_invalid");
    }
  }

  const reviewModels = [];
  for (const review of reviews) {
    exactFields(
      review,
      VISUAL_QA_REVIEW_FIELDS,
      "autonomous_visual_gate_model_review_fields_invalid",
    );
    exactFields(
      review.capability_evidence,
      VISUAL_QA_CAPABILITY_FIELDS,
      "autonomous_visual_gate_model_capabilities_invalid",
    );
    const model = text(review.model);
    if (
      !text(review.provider) ||
      !model ||
      text(review.verdict).toUpperCase() !== "PASS" ||
      stringArray(
        review.blockers,
        "autonomous_visual_gate_model_blockers_invalid",
      ).length !== 0 ||
      review.capability_evidence.completion !== true ||
      review.capability_evidence.vision !== true
    ) {
      fail("autonomous_visual_gate_unanimous_pass_required");
    }
    reviewModels.push(model);
  }

  const aggregation = report.model_aggregation;
  const distinctModels = new Set(requestedModels);
  if (
    report.schema_version !== VISUAL_QA_SCHEMA_VERSION ||
    report.mode !== MODE ||
    text(report.story_id) !== request.story_id ||
    text(report.verdict).toUpperCase() !== "PASS" ||
    blockers.length !== 0 ||
    report.authority.human_review !== false ||
    report.authority.approval_authority !== false ||
    report.authority.publication_authorised !== false ||
    report.authority.may_replace_human_approval !== false ||
    path.resolve(text(report.bindings.final_mp4.path)) !==
      request.final_mp4.path ||
    text(report.bindings.final_mp4.sha256).toLowerCase() !==
      request.final_mp4.sha256 ||
    frames.length < 1 ||
    aggregation.strategy !== "UNANIMOUS_PASS" ||
    aggregation.all_reviews_must_pass !== true ||
    !Number.isInteger(aggregation.review_count) ||
    aggregation.review_count < 2 ||
    aggregation.pass_count !== aggregation.review_count ||
    requestedModels.length !== aggregation.review_count ||
    distinctModels.size !== aggregation.review_count ||
    reviews.length !== aggregation.review_count ||
    JSON.stringify(reviewModels) !== JSON.stringify(requestedModels) ||
    report.controls.local_files_only !== true ||
    report.controls.database_mutated !== false ||
    report.controls.oauth_or_tokens_mutated !== false ||
    report.controls.platform_objects_created !== false ||
    report.controls.live_publish_attempted !== false ||
    report.controls.external_network_used !== false ||
    report.controls.loopback_inference_only !== true
  ) {
    fail("autonomous_visual_gate_unanimous_pass_required");
  }
  const visualQaGeneratedAt = exactTimestamp(
    report.generated_at,
    "autonomous_visual_gate_visual_qa_generated_at_invalid",
  );
  if (
    Date.parse(visualQaGeneratedAt) > Date.parse(request.generated_at)
  ) {
    fail("autonomous_visual_gate_visual_qa_from_future");
  }
  return requestedModels;
}

async function ensureOutputParent(
  root,
  outputPath,
  fileSystem,
) {
  if (!pathWithin(root.path, outputPath)) {
    fail("autonomous_visual_gate_output_outside_root");
  }
  const parent = path.dirname(outputPath);
  await fileSystem.mkdir(parent, { recursive: true });
  const relative = path.relative(root.path, parent);
  let cursor = root.path;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = await fileSystem.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("autonomous_visual_gate_output_parent_invalid");
    }
    const realPath = path.resolve(await fileSystem.realpath(cursor));
    if (!pathWithin(root.real_path, realPath)) {
      fail("autonomous_visual_gate_output_outside_root");
    }
  }
  try {
    const existing = await fileSystem.lstat(outputPath);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      fail("autonomous_visual_gate_output_invalid");
    }
  } catch (error) {
    if (error instanceof GovernedAutonomousVisualGateDecisionError) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeIdempotently(outputPath, bytes, fileSystem) {
  try {
    const existing = await fileSystem.readFile(outputPath);
    if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
    fail("autonomous_visual_gate_output_conflict");
  } catch (error) {
    if (error instanceof GovernedAutonomousVisualGateDecisionError) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
  let handle;
  try {
    handle = await fileSystem.open(outputPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = await fileSystem.readFile(outputPath);
      if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
      fail("autonomous_visual_gate_output_conflict");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return "CREATED";
}

async function materialiseGovernedAutonomousVisualGateDecision(
  value,
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const request = normaliseRequest(value);
  const root = await exactRoot(request.root_dir, fileSystem);
  await ensureOutputParent(root, request.output_path, fileSystem);
  await exactFile({
    root,
    filePath: request.final_mp4.path,
    expectedSha256: request.final_mp4.sha256,
    maxBytes: MAX_FINAL_MP4_BYTES,
    label: "autonomous_visual_gate_final_mp4",
    fileSystem,
  });
  const visualQaObservation = await exactFile({
    root,
    filePath: request.visual_qa.path,
    expectedSha256: request.visual_qa.raw_sha256,
    maxBytes: MAX_VISUAL_QA_BYTES,
    label: "autonomous_visual_gate_visual_qa",
    fileSystem,
  });
  let visualQa;
  try {
    visualQa = JSON.parse(visualQaObservation.bytes.toString("utf8"));
  } catch {
    fail("autonomous_visual_gate_visual_qa_json_invalid");
  }
  if (
    canonicalSha256(visualQa) !==
    request.visual_qa.canonical_sha256
  ) {
    fail("autonomous_visual_gate_visual_qa_canonical_sha256_mismatch");
  }
  const modelIds = validateVisualQa(visualQa, request);
  const decisionBody = stableValue({
    schema_version: DECISION_SCHEMA_VERSION,
    generated_at: request.generated_at,
    mode: MODE,
    story_id: request.story_id,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    verdict: "PASS",
    decision_authority: DECISION_AUTHORITY,
    authority_scope: AUTHORITY_SCOPE,
    visual_review_policy: {
      policy_id: POLICY_ID,
      policy_version: POLICY_VERSION,
      gate: POLICY_GATE,
      required_report_schema: VISUAL_QA_SCHEMA_VERSION,
      required_aggregation: "UNANIMOUS_PASS",
      minimum_distinct_vision_models: 2,
    },
    bindings: {
      final_mp4: structuredClone(request.final_mp4),
      visual_qa: structuredClone(request.visual_qa),
    },
    model_evidence: {
      strategy: "UNANIMOUS_PASS",
      model_ids: modelIds,
      distinct_model_count: new Set(modelIds).size,
      review_count: modelIds.length,
      pass_count: modelIds.length,
    },
    controls: {
      human_approval: false,
      models_treated_as_humans: false,
      publish_authority: false,
      scheduler_authority: false,
      database_authority: false,
      oauth_or_token_authority: false,
      platform_contacted: false,
      network_used: false,
    },
  });
  const decision = {
    ...decisionBody,
    decision_sha256: canonicalSha256(decisionBody),
  };
  const bytes = Buffer.from(
    `${JSON.stringify(decision, null, 2)}\n`,
    "utf8",
  );
  const status = await writeIdempotently(
    request.output_path,
    bytes,
    fileSystem,
  );
  const body = {
    schema_version: RESULT_SCHEMA_VERSION,
    status,
    story_id: request.story_id,
    path: request.output_path,
    file_sha256: sha256Bytes(bytes),
    decision,
    safety: {
      human_approval: false,
      models_treated_as_humans: false,
      publish_authority: false,
      external_publish_authorised: false,
      scheduler_authority: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      network_used: false,
    },
  };
  return Object.freeze({
    ...body,
    result_sha256: canonicalSha256(body),
  });
}

module.exports = {
  AUTHORITY_SCOPE,
  DECISION_AUTHORITY,
  DECISION_SCHEMA_VERSION,
  GovernedAutonomousVisualGateDecisionError,
  MODE,
  POLICY_GATE,
  POLICY_ID,
  POLICY_VERSION,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  canonicalSha256,
  materialiseGovernedAutonomousVisualGateDecision,
};
