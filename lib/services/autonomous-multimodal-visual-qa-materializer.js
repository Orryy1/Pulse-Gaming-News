"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const REQUEST_SCHEMA_VERSION =
  "pulse-autonomous-multimodal-visual-qa-request-v1";
const REPORT_SCHEMA_VERSION =
  "pulse-local-multimodal-visual-review-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-autonomous-multimodal-visual-qa-result-v1";
const MODE = "LOCAL_PROOF";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "channel_id",
  "lane_id",
  "platform",
  "generated_at",
  "root_dir",
  "output_dir",
  "final_mp4",
  "frame_plan",
  "reviewers",
]);
const FILE_REF_FIELDS = new Set(["path", "sha256"]);
const FRAME_PLAN_FIELDS = new Set(["frame_id", "timestamp_ms"]);
const REVIEWER_FIELDS = new Set([
  "provider",
  "model",
  "endpoint_origin",
]);
const EXTRACTED_FRAME_FIELDS = new Set([
  "frame_id",
  "timestamp_ms",
  "path",
  "sha256",
  "width",
  "height",
  "deterministic_blockers",
]);
const REVIEW_FIELDS = new Set([
  "provider",
  "model",
  "verdict",
  "blockers",
  "capability_evidence",
]);
const CAPABILITY_FIELDS = new Set(["completion", "vision"]);

class AutonomousMultimodalVisualQaMaterializerError extends Error {
  constructor(code) {
    super(code);
    this.name =
      "AutonomousMultimodalVisualQaMaterializerError";
    this.code = code;
  }
}

function fail(code) {
  throw new AutonomousMultimodalVisualQaMaterializerError(code);
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
  const actual = Object.keys(value).sort();
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

function exactTimestamp(value) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    fail("autonomous_visual_qa_generated_at_invalid");
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

function exactLoopbackOrigin(value) {
  let parsed;
  try {
    parsed = new URL(text(value));
  } catch {
    fail("autonomous_visual_qa_reviewer_endpoint_invalid");
  }
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    parsed.protocol !== "http:" ||
    !loopback.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== text(value)
  ) {
    fail("autonomous_visual_qa_reviewer_endpoint_invalid");
  }
  return parsed.origin;
}

function stringBlockers(value, code) {
  if (
    !Array.isArray(value) ||
    value.some((blocker) => !text(blocker))
  ) {
    fail(code);
  }
  return [...new Set(value.map(text))].sort();
}

function normaliseRequest(value) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "autonomous_visual_qa_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("autonomous_visual_qa_request_schema_invalid");
  }
  const storyId = text(value.story_id);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(storyId)) {
    fail("autonomous_visual_qa_story_id_invalid");
  }
  if (
    text(value.channel_id) !== "pulse-gaming" ||
    text(value.lane_id) !== "breaking_short" ||
    text(value.platform).toLowerCase() !== "youtube"
  ) {
    fail("autonomous_visual_qa_scope_invalid");
  }
  exactFields(
    value.final_mp4,
    FILE_REF_FIELDS,
    "autonomous_visual_qa_final_mp4_invalid",
  );
  const finalPath = text(value.final_mp4.path);
  if (!finalPath || !path.isAbsolute(finalPath)) {
    fail("autonomous_visual_qa_final_mp4_invalid");
  }
  if (
    !Array.isArray(value.frame_plan) ||
    value.frame_plan.length < 3
  ) {
    fail("autonomous_visual_qa_frame_plan_invalid");
  }
  const frameIds = new Set();
  const timestamps = new Set();
  const framePlan = value.frame_plan.map((frame) => {
    exactFields(
      frame,
      FRAME_PLAN_FIELDS,
      "autonomous_visual_qa_frame_plan_invalid",
    );
    const frameId = text(frame.frame_id);
    const timestampMs = Number(frame.timestamp_ms);
    if (
      !/^[A-Za-z0-9._-]{1,64}$/.test(frameId) ||
      !Number.isInteger(timestampMs) ||
      timestampMs < 0 ||
      frameIds.has(frameId) ||
      timestamps.has(timestampMs)
    ) {
      fail("autonomous_visual_qa_frame_plan_invalid");
    }
    frameIds.add(frameId);
    timestamps.add(timestampMs);
    return { frame_id: frameId, timestamp_ms: timestampMs };
  });
  if (
    !Array.isArray(value.reviewers) ||
    !value.reviewers.length
  ) {
    fail("autonomous_visual_qa_reviewers_required");
  }
  const reviewerKeys = new Set();
  const reviewers = value.reviewers.map((reviewer) => {
    exactFields(
      reviewer,
      REVIEWER_FIELDS,
      "autonomous_visual_qa_reviewer_fields_invalid",
    );
    const provider = text(reviewer.provider).toLowerCase();
    const model = text(reviewer.model);
    const key = `${provider}:${model}`;
    if (
      provider !== "ollama" ||
      !model ||
      reviewerKeys.has(key)
    ) {
      fail("autonomous_visual_qa_reviewer_invalid");
    }
    reviewerKeys.add(key);
    return {
      provider,
      model,
      endpoint_origin: exactLoopbackOrigin(
        reviewer.endpoint_origin,
      ),
      key,
    };
  });
  const rootDir = text(value.root_dir);
  const outputDir = text(value.output_dir);
  if (
    !rootDir ||
    !path.isAbsolute(rootDir) ||
    !outputDir ||
    !path.isAbsolute(outputDir)
  ) {
    fail("autonomous_visual_qa_output_invalid");
  }
  return {
    story_id: storyId,
    generated_at: exactTimestamp(value.generated_at),
    root_dir: path.resolve(rootDir),
    output_dir: path.resolve(outputDir),
    final_mp4: {
      path: path.resolve(finalPath),
      sha256: exactSha256(
        value.final_mp4.sha256,
        "autonomous_visual_qa_final_mp4_invalid",
      ),
    },
    frame_plan: framePlan,
    reviewers,
  };
}

async function exactRoot(value, fileSystem) {
  let stat;
  try {
    stat = await fileSystem.lstat(value, { bigint: true });
  } catch {
    fail("autonomous_visual_qa_root_missing");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("autonomous_visual_qa_root_invalid");
  }
  const realPath = await fileSystem.realpath(value);
  if (path.resolve(realPath) !== value) {
    fail("autonomous_visual_qa_root_link_forbidden");
  }
  return { path: value, real_path: realPath };
}

async function exactFile({
  root,
  filePath,
  expectedSha256,
  outsideCode,
  invalidCode,
  mismatchCode,
  fileSystem,
}) {
  if (!pathWithin(root.path, filePath)) fail(outsideCode);
  let initial;
  try {
    initial = await fileSystem.lstat(filePath, { bigint: true });
  } catch {
    fail(invalidCode);
  }
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.size <= 0n ||
    initial.size > BigInt(MAX_MEDIA_BYTES) ||
    initial.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail(invalidCode);
  }
  const realPath = await fileSystem.realpath(filePath);
  if (!pathWithin(root.real_path, realPath)) fail(outsideCode);
  const bytes = await fileSystem.readFile(filePath);
  const finalStat = await fileSystem.lstat(filePath, { bigint: true });
  if (
    initial.dev !== finalStat.dev ||
    initial.ino !== finalStat.ino ||
    initial.size !== finalStat.size ||
    initial.mtimeNs !== finalStat.mtimeNs
  ) {
    fail(invalidCode);
  }
  const observedSha256 = sha256Bytes(bytes);
  if (observedSha256 !== expectedSha256) fail(mismatchCode);
  return { observed_sha256: observedSha256, size_bytes: bytes.length };
}

async function ensureOutputDirectory(root, outputDir, fileSystem) {
  if (!pathWithin(root.path, outputDir)) {
    fail("autonomous_visual_qa_output_outside_root");
  }
  await fileSystem.mkdir(outputDir, { recursive: true });
  const relative = path.relative(root.path, outputDir);
  let cursor = root.path;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = await fileSystem.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("autonomous_visual_qa_output_invalid");
    }
    const realPath = await fileSystem.realpath(cursor);
    if (!pathWithin(root.real_path, realPath)) {
      fail("autonomous_visual_qa_output_outside_root");
    }
  }
}

async function validateExtractedFrames({
  request,
  root,
  frames,
  framesDir,
  fileSystem,
}) {
  if (
    !Array.isArray(frames) ||
    frames.length !== request.frame_plan.length
  ) {
    fail("autonomous_visual_qa_extracted_frames_invalid");
  }
  const result = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const planned = request.frame_plan[index];
    exactFields(
      frame,
      EXTRACTED_FRAME_FIELDS,
      "autonomous_visual_qa_extracted_frame_fields_invalid",
    );
    const framePath = path.resolve(text(frame.path));
    const hash = exactSha256(
      frame.sha256,
      "autonomous_visual_qa_frame_sha256_invalid",
    );
    if (
      text(frame.frame_id) !== planned.frame_id ||
      Number(frame.timestamp_ms) !== planned.timestamp_ms ||
      Number(frame.width) !== 1080 ||
      Number(frame.height) !== 1920
    ) {
      fail("autonomous_visual_qa_extracted_frames_invalid");
    }
    if (!pathWithin(framesDir, framePath)) {
      fail("autonomous_visual_qa_frame_outside_root");
    }
    await exactFile({
      root,
      filePath: framePath,
      expectedSha256: hash,
      outsideCode: "autonomous_visual_qa_frame_outside_root",
      invalidCode: "autonomous_visual_qa_frame_invalid",
      mismatchCode: "autonomous_visual_qa_frame_sha256_mismatch",
      fileSystem,
    });
    result.push({
      frame_id: planned.frame_id,
      timestamp_ms: planned.timestamp_ms,
      path: framePath,
      sha256: hash,
      width: 1080,
      height: 1920,
      deterministic_blockers: stringBlockers(
        frame.deterministic_blockers,
        "autonomous_visual_qa_frame_blockers_invalid",
      ),
    });
  }
  return result;
}

function normaliseReview(value, expected) {
  exactFields(
    value,
    REVIEW_FIELDS,
    "autonomous_visual_qa_review_fields_invalid",
  );
  exactFields(
    value.capability_evidence,
    CAPABILITY_FIELDS,
    "autonomous_visual_qa_review_capabilities_invalid",
  );
  const provider = text(value.provider).toLowerCase();
  const model = text(value.model);
  const verdict = text(value.verdict).toUpperCase();
  if (
    provider !== expected.provider ||
    model !== expected.model ||
    !["PASS", "HOLD"].includes(verdict) ||
    typeof value.capability_evidence.completion !== "boolean" ||
    typeof value.capability_evidence.vision !== "boolean"
  ) {
    fail("autonomous_visual_qa_review_invalid");
  }
  return {
    provider,
    model,
    verdict,
    blockers: stringBlockers(
      value.blockers,
      "autonomous_visual_qa_review_blockers_invalid",
    ),
    capability_evidence: {
      completion: value.capability_evidence.completion,
      vision: value.capability_evidence.vision,
    },
  };
}

function markdown(report) {
  return [
    "# Autonomous multimodal visual QA",
    "",
    `- Story: ${report.story_id}`,
    `- Verdict: ${report.verdict}`,
    `- Frames: ${report.frames.length}`,
    `- Vision reviews: ${report.model_aggregation.review_count}`,
    `- Blockers: ${report.blockers.length ? report.blockers.join(", ") : "none"}`,
    "",
    "This local proof grants no approval, scheduling or publication authority.",
    "",
  ].join("\n");
}

async function writeIdempotently(filePath, bytes, fileSystem) {
  try {
    const existing = await fileSystem.readFile(filePath);
    if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
    fail("autonomous_visual_qa_output_conflict");
  } catch (error) {
    if (
      error instanceof
      AutonomousMultimodalVisualQaMaterializerError
    ) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
  let handle;
  try {
    handle = await fileSystem.open(filePath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = await fileSystem.readFile(filePath);
      if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
      fail("autonomous_visual_qa_output_conflict");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return "CREATED";
}

async function materialiseAutonomousMultimodalVisualQa(
  value,
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const extractFrames = options.extractFrames;
  const reviewerAdapters =
    options.reviewerAdapters &&
    typeof options.reviewerAdapters === "object"
      ? options.reviewerAdapters
      : {};
  if (typeof extractFrames !== "function") {
    fail("autonomous_visual_qa_frame_extractor_required");
  }
  const request = normaliseRequest(value);
  const root = await exactRoot(request.root_dir, fileSystem);
  await ensureOutputDirectory(
    root,
    request.output_dir,
    fileSystem,
  );
  await exactFile({
    root,
    filePath: request.final_mp4.path,
    expectedSha256: request.final_mp4.sha256,
    outsideCode: "autonomous_visual_qa_final_mp4_outside_root",
    invalidCode: "autonomous_visual_qa_final_mp4_invalid",
    mismatchCode:
      "autonomous_visual_qa_final_mp4_sha256_mismatch",
    fileSystem,
  });
  const framesDir = path.join(request.output_dir, "frames");
  await fileSystem.mkdir(framesDir, { recursive: true });
  const extracted = await extractFrames({
    story_id: request.story_id,
    final_mp4: structuredClone(request.final_mp4),
    frame_plan: structuredClone(request.frame_plan),
    frames_dir: framesDir,
    publish_authority: false,
  });
  const frames = await validateExtractedFrames({
    request,
    root,
    frames: extracted,
    framesDir,
    fileSystem,
  });
  const modelReviews = [];
  for (const reviewer of request.reviewers) {
    const adapter = reviewerAdapters[reviewer.key];
    if (typeof adapter !== "function") {
      fail("autonomous_visual_qa_reviewer_adapter_required");
    }
    const raw = await adapter({
      story_id: request.story_id,
      final_mp4: structuredClone(request.final_mp4),
      frames: structuredClone(frames),
      endpoint_origin: reviewer.endpoint_origin,
      publish_authority: false,
    });
    modelReviews.push(normaliseReview(raw, reviewer));
  }
  const blockers = [];
  for (const frame of frames) {
    blockers.push(...frame.deterministic_blockers);
  }
  for (const review of modelReviews) {
    blockers.push(...review.blockers);
    if (review.verdict !== "PASS") {
      blockers.push(`model_review_not_pass:${review.model}`);
    }
    if (
      review.capability_evidence.completion !== true ||
      review.capability_evidence.vision !== true
    ) {
      blockers.push(`vision_capability_not_proven:${review.model}`);
    }
  }
  const uniqueBlockers = [...new Set(blockers)].sort();
  const passCount = modelReviews.filter(
    (review) =>
      review.verdict === "PASS" &&
      review.blockers.length === 0 &&
      review.capability_evidence.completion === true &&
      review.capability_evidence.vision === true,
  ).length;
  const report = stableValue({
    schema_version: REPORT_SCHEMA_VERSION,
    mode: MODE,
    generated_at: request.generated_at,
    story_id: request.story_id,
    verdict: uniqueBlockers.length ? "HOLD" : "PASS",
    blockers: uniqueBlockers,
    authority: {
      human_review: false,
      approval_authority: false,
      publication_authorised: false,
      may_replace_human_approval: false,
    },
    bindings: {
      final_mp4: structuredClone(request.final_mp4),
    },
    frames,
    model_aggregation: {
      strategy: "UNANIMOUS_PASS",
      requested_models: request.reviewers.map(
        (reviewer) => reviewer.model,
      ),
      review_count: request.reviewers.length,
      pass_count: passCount,
      all_reviews_must_pass: true,
    },
    model_reviews: modelReviews,
    controls: {
      local_files_only: true,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      live_publish_attempted: false,
      external_network_used: false,
      loopback_inference_only: true,
    },
  });
  const reportPath = path.join(
    request.output_dir,
    "local-multimodal-visual-review.json",
  );
  const summaryPath = path.join(
    request.output_dir,
    "local-multimodal-visual-review.md",
  );
  const reportBytes = Buffer.from(
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  const summaryBytes = Buffer.from(markdown(report), "utf8");
  const reportStatus = await writeIdempotently(
    reportPath,
    reportBytes,
    fileSystem,
  );
  const summaryStatus = await writeIdempotently(
    summaryPath,
    summaryBytes,
    fileSystem,
  );
  const body = {
    schema_version: RESULT_SCHEMA_VERSION,
    status:
      reportStatus === "REPLAYED" &&
      summaryStatus === "REPLAYED"
        ? "REPLAYED"
        : "CREATED",
    story_id: request.story_id,
    verdict: report.verdict,
    blockers: report.blockers,
    report_path: reportPath,
    summary_path: summaryPath,
    file_sha256: sha256Bytes(reportBytes),
    report,
    safety: {
      publish_authority: false,
      external_publish_authorised: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      network_used: false,
    },
  };
  return Object.freeze({
    ...body,
    result_sha256: canonicalSha256(body),
  });
}

module.exports = {
  AutonomousMultimodalVisualQaMaterializerError,
  MODE,
  REPORT_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  canonicalSha256,
  materialiseAutonomousMultimodalVisualQa,
};
