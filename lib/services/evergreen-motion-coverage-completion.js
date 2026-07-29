"use strict";

const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const {
  assessRightsLedger,
} = require("./publication-evidence-gates");
const {
  hashEvergreenMotionRepairWorkOrder,
} = require("./evergreen-motion-repair-work-order");

const execFileAsync = promisify(execFile);

const COMPLETION_SCHEMA_VERSION =
  "pulse-evergreen-motion-coverage-completion-v1";
const WORK_ORDER_SCHEMA_VERSION =
  "pulse-evergreen-motion-coverage-repair-work-order-v1";
const MATERIALISATION_RECEIPT_SCHEMA_VERSION =
  "pulse-evergreen-motion-materialisation-v1";
const COMPLETION_FILENAME =
  "evergreen-motion-coverage-completion.json";
const MODE = "LOCAL_PROOF";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;
const MAXIMUM_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MAXIMUM_SEGMENTS = 12;
const MAXIMUM_SEGMENT_SECONDS = 45;
const MAXIMUM_TOTAL_COMPLETION_SECONDS = 120;
const DURATION_TOLERANCE_SECONDS = 0.5;
const ALLOWED_VIDEO_EXTENSIONS = new Set([
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".webm",
]);
const RIGHTS_BASIS_MAP = Object.freeze({
  LICENSED: "licensed",
  PERMISSION_GRANTED: "licensed",
  PLATFORM_AUTHORISED: "official_publisher_policy",
  TRANSFORMATIVE_EDITORIAL_USE: "bounded_editorial_excerpt",
});
const ATTRIBUTION_DECISIONS = new Set([
  "NOT_REQUIRED",
  "REQUIRED_AND_SUPPLIED",
]);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseSha256(value) {
  const normalised = text(value)
    .replace(/^sha256:/i, "")
    .toLowerCase();
  return SHA256_PATTERN.test(normalised) ? normalised : null;
}

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

function hashObject(value) {
  return sha256(
    Buffer.from(JSON.stringify(stableValue(value)), "utf8"),
  );
}

function hashEvergreenMotionCoverageCompletion(value) {
  const base = structuredClone(object(value));
  delete base.manifest_sha256;
  return hashObject(base);
}

function buildEvergreenMotionCoverageCompletionManifest(
  request = {},
) {
  const input = object(request);
  const generatedAt = new Date(input.generated_at);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("motion_completion_generated_at_invalid");
  }
  const base = {
    schema_version: COMPLETION_SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    mode: MODE,
    story_id: text(input.story_id),
    candidate_id: text(input.candidate_id),
    repair_work_order: structuredClone(
      object(input.repair_work_order),
    ),
    materialisation_receipt: structuredClone(
      object(input.materialisation_receipt),
    ),
    source_binding: structuredClone(object(input.source_binding)),
    baseline_rights_ledger: structuredClone(
      object(input.baseline_rights_ledger),
    ),
    amended_rights_ledger: structuredClone(
      object(input.amended_rights_ledger),
    ),
    segments: structuredClone(array(input.segments)),
    safety: completionSafety(),
  };
  return {
    ...base,
    manifest_sha256: hashObject(base),
  };
}

function unique(values) {
  return [...new Set(array(values).filter(Boolean))];
}

function resolveLocalPath(value, baseDir) {
  const declared = String(value ?? "").trim();
  if (!declared || /^[a-z][a-z0-9+.-]*:\/\//i.test(declared)) {
    return null;
  }
  return path.resolve(
    path.isAbsolute(declared)
      ? declared
      : path.join(baseDir, declared),
  );
}

async function observeFile({
  declaredPath,
  expectedSha256,
  baseDir,
  prefix,
  maximumBytes,
  json = false,
  expectedRequired = true,
}) {
  const blockers = [];
  const absolutePath = resolveLocalPath(declaredPath, baseDir);
  const expected = normaliseSha256(expectedSha256);
  if (!absolutePath) blockers.push(`${prefix}_path_required`);
  if (expectedRequired && !expected) {
    blockers.push(`${prefix}_file_sha256_required`);
  }
  if (blockers.length) {
    return {
      blockers,
      path: absolutePath,
      file_sha256: null,
      byte_length: null,
      value: null,
    };
  }
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return {
      blockers: [`${prefix}_file_missing`],
      path: absolutePath,
      file_sha256: null,
      byte_length: null,
      value: null,
    };
  }
  if (!stat.isFile()) {
    return {
      blockers: [`${prefix}_not_a_file`],
      path: absolutePath,
      file_sha256: null,
      byte_length: stat.size,
      value: null,
    };
  }
  if (!(stat.size > 0) || stat.size > maximumBytes) {
    return {
      blockers: [`${prefix}_file_size_invalid`],
      path: absolutePath,
      file_sha256: null,
      byte_length: stat.size,
      value: null,
    };
  }
  let bytes;
  try {
    bytes = await fs.readFile(absolutePath);
  } catch {
    return {
      blockers: [`${prefix}_file_unreadable`],
      path: absolutePath,
      file_sha256: null,
      byte_length: stat.size,
      value: null,
    };
  }
  const observedSha256 = sha256(bytes);
  if (expected && observedSha256 !== expected) {
    blockers.push(`${prefix}_file_sha256_mismatch`);
  }
  let value = null;
  if (json) {
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      blockers.push(`${prefix}_json_invalid`);
    }
  }
  return {
    blockers,
    path: absolutePath,
    file_sha256: observedSha256,
    byte_length: bytes.length,
    bytes,
    value,
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameMillisecondValue(left, right) {
  const leftNumber = finiteNumber(left);
  const rightNumber = finiteNumber(right);
  return (
    leftNumber !== null &&
    rightNumber !== null &&
    Math.round(leftNumber * 1000) ===
      Math.round(rightNumber * 1000)
  );
}

function embeddedMediaTokens(mediaUrl) {
  const tokens = [text(mediaUrl)].filter(Boolean);
  try {
    const parsed = new URL(mediaUrl);
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      if (id) tokens.push(id);
    } else if (
      /(^|\.)youtube\.com$/i.test(parsed.hostname)
    ) {
      const id =
        parsed.searchParams.get("v") ||
        (/^\/(?:embed|shorts)\/([^/?#]+)/.exec(parsed.pathname)?.[1] ??
          null);
      if (id) tokens.push(id);
    }
  } catch {
    return tokens;
  }
  return unique(tokens);
}

function requiredAdditionalSeconds(workOrder) {
  const coverage = object(workOrder.coverage);
  return finiteNumber(
    coverage.missing_motion_seconds ??
      workOrder.additional_motion_seconds_required,
  );
}

function requiredTotalSeconds(workOrder) {
  const coverage = object(workOrder.coverage);
  return finiteNumber(
    coverage.required_exact_subject_motion_seconds ??
      workOrder.minimum_required_motion_seconds,
  );
}

function baselineWorkOrderBinding(workOrder) {
  const baseline = object(workOrder.baseline);
  return {
    ledger_sha256: normaliseSha256(
      baseline.rights_ledger_sha256 ??
        workOrder.baseline_rights_ledger_sha256,
    ),
    asset_ids: array(
      baseline.asset_ids ?? workOrder.baseline_rights_asset_ids,
    )
      .map(text)
      .filter(Boolean)
      .sort(),
  };
}

function workOrderReason(workOrder) {
  return text(
    workOrder.reason_code || workOrder.blocker,
  ).toLowerCase();
}

async function probeVideoFile(
  filePath,
  { ffprobePath = "ffprobe" } = {},
) {
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,format_name:stream=codec_type,duration,width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    },
  );
  const probe = JSON.parse(stdout);
  const streams = array(probe.streams);
  const videoStreams = streams.filter(
    (stream) => text(stream.codec_type).toLowerCase() === "video",
  );
  const audioStreams = streams.filter(
    (stream) => text(stream.codec_type).toLowerCase() === "audio",
  );
  const durationCandidates = [
    finiteNumber(probe?.format?.duration),
    ...videoStreams.map((stream) => finiteNumber(stream.duration)),
  ].filter((value) => value !== null && value > 0);
  const primaryVideo = videoStreams[0] || {};
  return {
    duration_seconds: durationCandidates.length
      ? Math.max(...durationCandidates)
      : null,
    video_stream_count: videoStreams.length,
    audio_stream_count: audioStreams.length,
    width: finiteNumber(primaryVideo.width),
    height: finiteNumber(primaryVideo.height),
    format_name: text(probe?.format?.format_name),
  };
}

function completionSafety() {
  return {
    mode: MODE,
    local_proof_only: true,
    local_files_only: true,
    network_used: false,
    download_performed: false,
    database_mutated: false,
    oauth_mutated: false,
    external_platform_contacted: false,
    publish_authority_created: false,
    scheduler_authority_created: false,
    external_posting_authorised: false,
  };
}

function safeOutputSegment(value, fallback = "unresolved") {
  const normalised = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalised || fallback;
}

async function findEvergreenMotionCoverageCompletionReference({
  story_id: storyIdInput,
  root_dir: rootDir = process.cwd(),
  explicit_reference: explicitReference,
} = {}) {
  const storyId = text(storyIdInput);
  const explicit = object(explicitReference);
  if (text(explicit.path) || text(explicit.file_sha256)) {
    const explicitPath = resolveLocalPath(
      explicit.path,
      path.resolve(rootDir),
    );
    const explicitSha256 = normaliseSha256(explicit.file_sha256);
    const blockers = [];
    if (!explicitPath) {
      blockers.push("motion_completion_explicit_path_required");
    }
    if (!explicitSha256) {
      blockers.push(
        "motion_completion_explicit_file_sha256_required",
      );
    }
    return {
      mode: "explicit",
      story_id: storyId || null,
      reference:
        blockers.length === 0
          ? {
              path: explicitPath,
              file_sha256: explicitSha256,
            }
          : null,
      blockers,
      candidates: explicitPath ? [explicitPath] : [],
      safety: completionSafety(),
    };
  }

  if (!storyId) {
    return {
      mode: "deterministic_local",
      story_id: null,
      reference: null,
      blockers: ["motion_completion_story_id_required"],
      candidates: [],
      safety: completionSafety(),
    };
  }
  const storyRoot = path.join(
    path.resolve(rootDir),
    "output",
    "evergreen-verdict-candidates",
    "current",
    "motion-repair",
    safeOutputSegment(storyId),
  );
  let entries;
  try {
    entries = await fs.readdir(storyRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        mode: "none",
        story_id: storyId,
        reference: null,
        blockers: [],
        candidates: [],
        safety: completionSafety(),
      };
    }
    throw error;
  }
  const candidates = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !SHA256_PATTERN.test(entry.name.toLowerCase())
    ) {
      continue;
    }
    const candidate = path.join(
      storyRoot,
      entry.name,
      COMPLETION_FILENAME,
    );
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) candidates.push(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  candidates.sort((left, right) => left.localeCompare(right));
  if (candidates.length === 0) {
    return {
      mode: "none",
      story_id: storyId,
      reference: null,
      blockers: [],
      candidates,
      safety: completionSafety(),
    };
  }
  if (candidates.length > 1) {
    return {
      mode: "deterministic_local",
      story_id: storyId,
      reference: null,
      blockers: ["motion_completion_manifest_ambiguous"],
      candidates,
      safety: completionSafety(),
    };
  }
  return {
    mode: "deterministic_local",
    story_id: storyId,
    reference: {
      path: candidates[0],
      file_sha256: null,
    },
    blockers: [],
    candidates,
    safety: completionSafety(),
  };
}

function validateSafety(value, prefix) {
  const safety = object(value);
  const blockers = [];
  const requiredFalse = [
    "network_used",
    "network_authorised",
    "network_access_authorised",
    "download_performed",
    "database_mutated",
    "database_mutation_authorised",
    "oauth_mutated",
    "oauth_mutation_authorised",
    "external_platform_contacted",
    "platform_contact_authorised",
    "external_platform_action_authorised",
    "external_posting_authorised",
    "approval_authority_created",
    "publish_authority",
    "publish_authority_created",
    "scheduler_authority",
    "scheduler_authority_created",
  ];
  for (const key of requiredFalse) {
    if (
      Object.prototype.hasOwnProperty.call(safety, key) &&
      safety[key] !== false
    ) {
      blockers.push(`${prefix}_${key}_must_be_false`);
    }
  }
  return blockers;
}

function overlaps(left, right) {
  return (
    left.source_start_seconds < right.source_end_seconds &&
    right.source_start_seconds < left.source_end_seconds
  );
}

/**
 * Validate an operator-authored, already-local exact-subject motion
 * completion. This function performs local reads and ffprobe only. It never
 * downloads, edits, schedules or publishes media.
 */
async function validateEvergreenMotionCoverageCompletion({
  reference = {},
  expected_story_id: expectedStoryId,
  expected_source_packet_sha256: expectedSourcePacketSha256,
  expected_baseline_rights_ledger_sha256:
    expectedBaselineRightsLedgerSha256,
  root_dir: rootDir = process.cwd(),
  ffprobe_path: ffprobePath = "ffprobe",
  probe_video: probeVideo = probeVideoFile,
} = {}) {
  const root = path.resolve(rootDir);
  const manifestObserved = await observeFile({
    declaredPath: reference.path,
    expectedSha256: reference.file_sha256,
    baseDir: root,
    prefix: "motion_completion_manifest",
    maximumBytes: MAXIMUM_JSON_BYTES,
    json: true,
    expectedRequired: Boolean(text(reference.file_sha256)),
  });
  const blockers = [...manifestObserved.blockers];
  const manifest = object(manifestObserved.value);
  const manifestDir = manifestObserved.path
    ? path.dirname(manifestObserved.path)
    : root;
  if (manifest.schema_version !== COMPLETION_SCHEMA_VERSION) {
    blockers.push("motion_completion_manifest_schema_invalid");
  }
  if (text(manifest.mode).toUpperCase() !== MODE) {
    blockers.push("motion_completion_manifest_mode_invalid");
  }
  const declaredManifestSha256 = normaliseSha256(
    manifest.manifest_sha256,
  );
  if (!declaredManifestSha256) {
    blockers.push("motion_completion_manifest_sha256_required");
  } else if (
    hashEvergreenMotionCoverageCompletion(manifest) !==
    declaredManifestSha256
  ) {
    blockers.push("motion_completion_manifest_sha256_mismatch");
  }
  const storyId = text(manifest.story_id);
  const candidateId = text(manifest.candidate_id);
  if (!storyId || storyId !== text(expectedStoryId)) {
    blockers.push("motion_completion_story_id_mismatch");
  }
  if (!candidateId) {
    blockers.push("motion_completion_candidate_id_required");
  }
  blockers.push(
    ...validateSafety(manifest.safety, "motion_completion"),
  );

  const workOrderRef = object(manifest.repair_work_order);
  const workOrderObserved = await observeFile({
    declaredPath: workOrderRef.path,
    expectedSha256: workOrderRef.file_sha256,
    baseDir: manifestDir,
    prefix: "motion_completion_work_order",
    maximumBytes: MAXIMUM_JSON_BYTES,
    json: true,
  });
  blockers.push(...workOrderObserved.blockers);
  const workOrder = object(workOrderObserved.value);
  const declaredWorkOrderSha256 = normaliseSha256(
    workOrderRef.work_order_sha256,
  );
  if (workOrder.schema_version !== WORK_ORDER_SCHEMA_VERSION) {
    blockers.push("motion_completion_work_order_schema_invalid");
  }
  if (
    !declaredWorkOrderSha256 ||
    normaliseSha256(workOrder.work_order_sha256) !==
      declaredWorkOrderSha256 ||
    hashEvergreenMotionRepairWorkOrder(workOrder) !==
      declaredWorkOrderSha256
  ) {
    blockers.push("motion_completion_work_order_sha256_mismatch");
  }
  if (
    manifestObserved.path &&
    workOrderObserved.path &&
    path.dirname(manifestObserved.path) !==
      path.dirname(workOrderObserved.path)
  ) {
    blockers.push("motion_completion_not_beside_work_order");
  }
  if (text(workOrder.story_id) !== storyId) {
    blockers.push("motion_completion_work_order_story_id_mismatch");
  }
  if (text(workOrder.candidate_id) !== candidateId) {
    blockers.push(
      "motion_completion_work_order_candidate_id_mismatch",
    );
  }
  if (workOrderReason(workOrder) !== "exact_subject_motion_ratio_too_low") {
    blockers.push("motion_completion_work_order_reason_invalid");
  }
  blockers.push(
    ...validateSafety(
      workOrder.safety,
      "motion_completion_work_order",
    ),
  );

  const receiptRef = object(manifest.materialisation_receipt);
  const receiptObserved = await observeFile({
    declaredPath: receiptRef.path,
    expectedSha256: receiptRef.file_sha256,
    baseDir: manifestDir,
    prefix: "motion_completion_materialisation_receipt",
    maximumBytes: MAXIMUM_JSON_BYTES,
    json: true,
  });
  blockers.push(...receiptObserved.blockers);
  const materialisationReceipt = object(receiptObserved.value);
  if (
    materialisationReceipt.schema_version !==
    MATERIALISATION_RECEIPT_SCHEMA_VERSION
  ) {
    blockers.push(
      "motion_completion_materialisation_receipt_schema_invalid",
    );
  }
  if (
    text(materialisationReceipt.mode).toUpperCase() !==
      "APPLY_LOCAL" ||
    text(materialisationReceipt.verdict).toUpperCase() !==
      "MATERIALISED"
  ) {
    blockers.push(
      "motion_completion_materialisation_receipt_not_materialised",
    );
  }
  if (
    text(materialisationReceipt.story_id) !== storyId ||
    text(materialisationReceipt.candidate_id) !== candidateId
  ) {
    blockers.push(
      "motion_completion_materialisation_receipt_identity_mismatch",
    );
  }
  if (
    normaliseSha256(materialisationReceipt.work_order_sha256) !==
    declaredWorkOrderSha256
  ) {
    blockers.push(
      "motion_completion_materialisation_receipt_work_order_mismatch",
    );
  }
  const receiptWorkOrderRef = object(
    materialisationReceipt.work_order_ref,
  );
  const receiptWorkOrderPath = resolveLocalPath(
    receiptWorkOrderRef.path,
    receiptObserved.path
      ? path.dirname(receiptObserved.path)
      : manifestDir,
  );
  if (
    receiptWorkOrderPath !== workOrderObserved.path ||
    normaliseSha256(receiptWorkOrderRef.file_sha256) !==
      workOrderObserved.file_sha256
  ) {
    blockers.push(
      "motion_completion_materialisation_receipt_work_order_ref_mismatch",
    );
  }
  blockers.push(
    ...validateSafety(
      materialisationReceipt.safety,
      "motion_completion_materialisation_receipt",
    ),
  );

  const sourceBinding = object(manifest.source_binding);
  const sourceObserved = await observeFile({
    declaredPath: sourceBinding.source_evidence_path,
    expectedSha256: sourceBinding.source_evidence_file_sha256,
    baseDir: manifestDir,
    prefix: "motion_completion_source_evidence",
    maximumBytes: MAXIMUM_JSON_BYTES,
    json: true,
  });
  blockers.push(...sourceObserved.blockers);
  const packet = object(sourceObserved.value);
  const sourcePacketSha256 = normaliseSha256(
    sourceBinding.source_evidence_packet_sha256,
  );
  if (
    !sourcePacketSha256 ||
    sourcePacketSha256 !== normaliseSha256(packet.packet_sha256) ||
    sourcePacketSha256 !==
      normaliseSha256(expectedSourcePacketSha256)
  ) {
    blockers.push("motion_completion_source_packet_sha256_mismatch");
  }
  if (text(packet.story_id) !== storyId) {
    blockers.push("motion_completion_source_story_id_mismatch");
  }
  if (
    packet.verification_status !== "CONFIRMED" ||
    packet.verified_for_planning !== true
  ) {
    blockers.push("motion_completion_source_not_confirmed");
  }
  const sourceId = text(sourceBinding.source_id);
  const sourceUrl = text(sourceBinding.source_url);
  const sourceProvenanceSha256 = normaliseSha256(
    sourceBinding.source_provenance_sha256,
  );
  const boundSource = array(packet.sources).find(
    (source) =>
      source?.status === "CAPTURED" &&
      text(source.source_id) === sourceId &&
      text(source.final_url) === sourceUrl &&
      text(source.source_class).toUpperCase() ===
        "OFFICIAL_FIRST_PARTY" &&
      normaliseSha256(source.provenance_sha256) ===
        sourceProvenanceSha256,
  );
  if (!boundSource) {
    blockers.push("motion_completion_official_source_binding_invalid");
  }
  const mediaUrl = text(sourceBinding.media_url);
  let mediaProtocol = null;
  try {
    mediaProtocol = new URL(mediaUrl).protocol;
  } catch {
    mediaProtocol = null;
  }
  if (mediaProtocol !== "https:") {
    blockers.push("motion_completion_media_url_invalid");
  }
  const receiptSource = object(materialisationReceipt.source);
  if (text(receiptSource.source_media_url) !== mediaUrl) {
    blockers.push(
      "motion_completion_materialisation_source_url_mismatch",
    );
  }
  const receiptSourceFileSha256 = normaliseSha256(
    receiptSource.file_sha256,
  );
  const boundSourceFileSha256 = normaliseSha256(
    sourceBinding.source_file_sha256,
  );
  if (
    !receiptSourceFileSha256 ||
    !boundSourceFileSha256 ||
    receiptSourceFileSha256 !== boundSourceFileSha256
  ) {
    blockers.push(
      "motion_completion_materialisation_source_hash_binding_mismatch",
    );
  }
  const materialisationSourceObserved = await observeFile({
    declaredPath: receiptSource.local_path,
    expectedSha256: receiptSourceFileSha256,
    baseDir: receiptObserved.path
      ? path.dirname(receiptObserved.path)
      : manifestDir,
    prefix: "motion_completion_materialisation_source",
    maximumBytes: MAXIMUM_ASSET_BYTES,
    json: false,
  });
  blockers.push(...materialisationSourceObserved.blockers);
  if (!text(sourceBinding.media_owner)) {
    blockers.push("motion_completion_media_owner_required");
  }
  let archiveObserved = {
    blockers: [],
    path: null,
    file_sha256: null,
  };
  if (boundSource) {
    const provenance = object(boundSource.provenance);
    archiveObserved = await observeFile({
      declaredPath: provenance.archive_path,
      expectedSha256:
        provenance.bytes_sha256 || boundSource.bytes_sha256,
      baseDir: sourceObserved.path
        ? path.dirname(sourceObserved.path)
        : manifestDir,
      prefix: "motion_completion_source_archive",
      maximumBytes: MAXIMUM_JSON_BYTES,
      json: false,
    });
    blockers.push(...archiveObserved.blockers);
    if (archiveObserved.bytes) {
      const archiveText = archiveObserved.bytes.toString("utf8");
      if (
        !embeddedMediaTokens(mediaUrl).some((token) =>
          archiveText.includes(token),
        )
      ) {
        blockers.push(
          "motion_completion_media_not_embedded_in_official_source",
        );
      }
    }
  }

  const baselineRef = object(manifest.baseline_rights_ledger);
  const baselineObserved = await observeFile({
    declaredPath: baselineRef.path,
    expectedSha256: baselineRef.file_sha256,
    baseDir: manifestDir,
    prefix: "motion_completion_baseline_rights_ledger",
    maximumBytes: MAXIMUM_JSON_BYTES,
    json: true,
  });
  blockers.push(...baselineObserved.blockers);
  const baselineLedger = object(baselineObserved.value);
  const baselineLedgerSha256 = normaliseSha256(
    baselineRef.ledger_sha256,
  );
  const expectedBaselineSha256 = normaliseSha256(
    expectedBaselineRightsLedgerSha256,
  );
  const baselineAssessment = assessRightsLedger(
    baselineLedger,
    baselineLedgerSha256,
  );
  blockers.push(
    ...baselineAssessment.blockers.map(
      (blocker) => `motion_completion_baseline_${blocker}`,
    ),
  );
  if (
    !baselineLedgerSha256 ||
    baselineLedgerSha256 !== expectedBaselineSha256 ||
    baselineLedgerSha256 !==
      normaliseSha256(baselineLedger.ledger_sha256)
  ) {
    blockers.push(
      "motion_completion_baseline_rights_ledger_sha256_mismatch",
    );
  }
  if (text(baselineLedger.story_id) !== storyId) {
    blockers.push(
      "motion_completion_baseline_rights_ledger_story_id_mismatch",
    );
  }
  const workOrderBaseline = baselineWorkOrderBinding(workOrder);
  if (workOrderBaseline.ledger_sha256 !== baselineLedgerSha256) {
    blockers.push(
      "motion_completion_work_order_baseline_ledger_mismatch",
    );
  }
  const baselineItems = array(baselineLedger.items).filter(
    (item) => item?.included_in_final === true,
  );
  const baselineAssetIds = baselineItems
    .map((item) => text(item.item_id))
    .filter(Boolean)
    .sort();
  if (
    JSON.stringify(workOrderBaseline.asset_ids) !==
    JSON.stringify(baselineAssetIds)
  ) {
    blockers.push(
      "motion_completion_work_order_baseline_asset_ids_mismatch",
    );
  }
  const baselineIdSet = new Set(baselineAssetIds);
  const baselineHashSet = new Set(
    baselineItems
      .map((item) => normaliseSha256(item.asset_sha256))
      .filter(Boolean),
  );
  const baselinePathSet = new Set(
    baselineItems
      .map((item) =>
        resolveLocalPath(
          item.local_path ||
            item.asset_path ||
            item.materialised_path ||
            item.path,
          baselineObserved.path
            ? path.dirname(baselineObserved.path)
            : manifestDir,
        ),
      )
      .filter(Boolean),
  );

  const amendedRef = object(manifest.amended_rights_ledger);
  const amendedObserved = await observeFile({
    declaredPath: amendedRef.path,
    expectedSha256: amendedRef.file_sha256,
    baseDir: manifestDir,
    prefix: "motion_completion_amended_rights_ledger",
    maximumBytes: MAXIMUM_JSON_BYTES,
    json: true,
  });
  blockers.push(...amendedObserved.blockers);
  const amendedLedger = object(amendedObserved.value);
  const amendedLedgerSha256 = normaliseSha256(
    amendedRef.ledger_sha256,
  );
  const amendedAssessment = assessRightsLedger(
    amendedLedger,
    amendedLedgerSha256,
  );
  blockers.push(
    ...amendedAssessment.blockers.map(
      (blocker) => `motion_completion_amended_${blocker}`,
    ),
  );
  if (
    !amendedLedgerSha256 ||
    amendedLedgerSha256 !==
      normaliseSha256(amendedLedger.ledger_sha256)
  ) {
    blockers.push(
      "motion_completion_amended_rights_ledger_sha256_mismatch",
    );
  }
  if (
    amendedLedgerSha256 &&
    amendedLedgerSha256 === baselineLedgerSha256
  ) {
    blockers.push(
      "motion_completion_amended_rights_ledger_sha256_not_new",
    );
  }
  if (text(amendedLedger.story_id) !== storyId) {
    blockers.push(
      "motion_completion_amended_rights_ledger_story_id_mismatch",
    );
  }
  if (
    !Number.isInteger(Number(amendedLedger.ledger_version)) ||
    Number(amendedLedger.ledger_version) <=
      Number(baselineLedger.ledger_version)
  ) {
    blockers.push(
      "motion_completion_amended_rights_ledger_version_not_incremented",
    );
  }
  const baselineRawItems = array(baselineLedger.items);
  const amendedItems = array(amendedLedger.items);
  const amendedItemsById = new Map(
    amendedItems.map((item) => [text(item?.item_id), item]),
  );
  for (const baselineItem of baselineRawItems) {
    const amendedBaselineItem = amendedItemsById.get(
      text(baselineItem?.item_id),
    );
    if (
      !amendedBaselineItem ||
      hashObject(amendedBaselineItem) !== hashObject(baselineItem)
    ) {
      blockers.push(
        "motion_completion_amended_baseline_item_mismatch",
      );
    }
  }

  const segments = array(manifest.segments);
  if (!segments.length || segments.length > MAXIMUM_SEGMENTS) {
    blockers.push("motion_completion_segment_count_invalid");
  }
  const receiptSegments = array(materialisationReceipt.segments);
  if (
    !receiptSegments.length ||
    receiptSegments.length !== segments.length
  ) {
    blockers.push(
      "motion_completion_materialisation_segment_inventory_mismatch",
    );
  }
  const matchedReceiptSegmentIndexes = new Set();
  const rightsRecords = [];
  const assetProvenance = [];
  const ranges = [];
  const seenIds = new Set();
  const seenPaths = new Set();
  const seenHashes = new Set();
  let verifiedMotionSeconds = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = object(segments[index]);
    const prefix = `motion_completion_segment_${index + 1}`;
    const assetId = text(segment.asset_id);
    const assetSha256 = normaliseSha256(segment.asset_sha256);
    const localPath = resolveLocalPath(segment.local_path, manifestDir);
    const receiptMatches = receiptSegments
      .map((receiptSegment, receiptIndex) => ({
        receiptSegment: object(receiptSegment),
        receiptIndex,
        localPath: resolveLocalPath(
          receiptSegment?.local_path,
          receiptObserved.path
            ? path.dirname(receiptObserved.path)
            : manifestDir,
        ),
      }))
      .filter((entry) => entry.localPath === localPath);
    const receiptSegment =
      receiptMatches.length === 1
        ? receiptMatches[0].receiptSegment
        : null;
    if (!receiptSegment) {
      blockers.push(
        `${prefix}_materialisation_receipt_binding_invalid`,
      );
    } else {
      matchedReceiptSegmentIndexes.add(
        receiptMatches[0].receiptIndex,
      );
      if (
        text(receiptSegment.status).toUpperCase() !==
          "MATERIALISED" ||
        normaliseSha256(receiptSegment.file_sha256) !==
          assetSha256
      ) {
        blockers.push(
          `${prefix}_materialisation_output_sha256_mismatch`,
        );
      }
    }
    if (!assetId) blockers.push(`${prefix}_asset_id_required`);
    if (
      baselineIdSet.has(assetId) ||
      seenIds.has(assetId)
    ) {
      blockers.push("motion_completion_asset_id_duplicate");
    }
    seenIds.add(assetId);
    if (
      (localPath && baselinePathSet.has(localPath)) ||
      (localPath && seenPaths.has(localPath))
    ) {
      blockers.push("motion_completion_asset_path_duplicate");
    }
    if (localPath) seenPaths.add(localPath);
    if (
      (assetSha256 && baselineHashSet.has(assetSha256)) ||
      (assetSha256 && seenHashes.has(assetSha256))
    ) {
      blockers.push("motion_completion_asset_sha256_duplicate");
    }
    if (assetSha256) seenHashes.add(assetSha256);
    if (
      text(segment.media_type).toLowerCase() !== "video" ||
      !localPath ||
      !ALLOWED_VIDEO_EXTENSIONS.has(
        path.extname(localPath).toLowerCase(),
      )
    ) {
      blockers.push(`${prefix}_video_file_required`);
    }
    const start = finiteNumber(segment.source_start_seconds);
    const end = finiteNumber(segment.source_end_seconds);
    const sourceDuration = finiteNumber(
      segment.source_duration_seconds,
    );
    const windowSeconds =
      start !== null && end !== null ? end - start : null;
    if (
      start === null ||
      end === null ||
      sourceDuration === null ||
      start < 0 ||
      end <= start ||
      end > sourceDuration ||
      windowSeconds > MAXIMUM_SEGMENT_SECONDS
    ) {
      blockers.push(`${prefix}_source_window_invalid`);
    }
    if (
      receiptSegment &&
      (!sameMillisecondValue(
        receiptSegment.start_seconds,
        start,
      ) ||
        !sameMillisecondValue(
          receiptSegment.end_seconds,
          end,
        ) ||
        !sameMillisecondValue(
          receiptSegment.duration_seconds,
          windowSeconds,
        ))
    ) {
      blockers.push(
        `${prefix}_materialisation_window_mismatch`,
      );
    }
    if (
      receiptSegment &&
      (!sameMillisecondValue(
        receiptSource.source_duration_seconds,
        sourceDuration,
      ) ||
        !sameMillisecondValue(
          materialisationReceipt?.source?.source_duration_seconds,
          sourceDuration,
        ))
    ) {
      blockers.push(
        `${prefix}_materialisation_source_duration_mismatch`,
      );
    }
    const exactMotionSeconds = finiteNumber(
      segment.exact_subject_motion_seconds,
    );
    if (
      exactMotionSeconds === null ||
      exactMotionSeconds <= 0 ||
      (windowSeconds !== null &&
        exactMotionSeconds >
          windowSeconds + DURATION_TOLERANCE_SECONDS)
    ) {
      blockers.push(`${prefix}_exact_subject_motion_seconds_invalid`);
    }
    if (
      segment.exact_subject_verified !== true ||
      text(segment.exact_subject_story_id) !== storyId ||
      !text(segment.exact_subject_evidence)
    ) {
      blockers.push(`${prefix}_exact_subject_evidence_invalid`);
    }
    if (
      segment.included_in_final !== true ||
      text(segment.rights_decision).toUpperCase() !== "CLEARED"
    ) {
      blockers.push(`${prefix}_rights_not_cleared`);
    }
    const declaredRightsBasis = text(
      segment.rights_basis,
    ).toUpperCase();
    const rightsBasis = RIGHTS_BASIS_MAP[declaredRightsBasis] || null;
    if (!rightsBasis) {
      blockers.push(`${prefix}_rights_basis_not_allowed`);
    }
    const rightsEvidence = object(segment.rights_evidence);
    const rightsEvidenceSha256 = normaliseSha256(
      rightsEvidence.sha256,
    );
    if (
      !text(rightsEvidence.reference) ||
      !rightsEvidenceSha256
    ) {
      blockers.push(`${prefix}_rights_evidence_invalid`);
    }
    const attributionDecision = text(
      segment.attribution_decision,
    ).toUpperCase();
    if (
      !ATTRIBUTION_DECISIONS.has(attributionDecision) ||
      (attributionDecision === "REQUIRED_AND_SUPPLIED" &&
        !text(segment.attribution_text))
    ) {
      blockers.push(`${prefix}_attribution_invalid`);
    }
    const owner = text(segment.owner);
    const usage = text(segment.usage);
    const motionFamily = text(segment.motion_family);
    if (!owner) blockers.push(`${prefix}_owner_required`);
    if (
      owner &&
      owner !== text(sourceBinding.media_owner)
    ) {
      blockers.push(`${prefix}_owner_source_binding_mismatch`);
    }
    if (
      declaredRightsBasis === "TRANSFORMATIVE_EDITORIAL_USE" &&
      (text(rightsEvidence.reference) !== sourceUrl ||
        rightsEvidenceSha256 !== sourcePacketSha256)
    ) {
      blockers.push(
        `${prefix}_editorial_rights_evidence_binding_invalid`,
      );
    }
    if (!usage) blockers.push(`${prefix}_usage_required`);
    if (!motionFamily) {
      blockers.push(`${prefix}_motion_family_required`);
    }

    const observed = await observeFile({
      declaredPath: localPath,
      expectedSha256: assetSha256,
      baseDir: manifestDir,
      prefix: `${prefix}_asset`,
      maximumBytes: MAXIMUM_ASSET_BYTES,
      json: false,
    });
    blockers.push(...observed.blockers);
    let probe = null;
    if (
      observed.blockers.length === 0 &&
      localPath &&
      text(segment.media_type).toLowerCase() === "video"
    ) {
      try {
        probe = await probeVideo(localPath, { ffprobePath });
      } catch {
        blockers.push(`${prefix}_ffprobe_failed`);
      }
    }
    const probedDuration = finiteNumber(probe?.duration_seconds);
    if (
      probe &&
      (Number(probe.video_stream_count) < 1 ||
        Number(probe.audio_stream_count) !== 0 ||
        probedDuration === null ||
        probedDuration <= 0 ||
        (windowSeconds !== null &&
          Math.abs(probedDuration - windowSeconds) >
            DURATION_TOLERANCE_SECONDS) ||
        (exactMotionSeconds !== null &&
          exactMotionSeconds >
            probedDuration + DURATION_TOLERANCE_SECONDS))
    ) {
      blockers.push(`${prefix}_ffprobe_video_contract_invalid`);
    }
    if (
      start !== null &&
      end !== null &&
      start >= 0 &&
      end > start
    ) {
      const range = {
        source_start_seconds: start,
        source_end_seconds: end,
      };
      if (ranges.some((existing) => overlaps(existing, range))) {
        blockers.push("motion_completion_source_window_overlap");
      }
      ranges.push(range);
    }

    const segmentBlockers = blockers.filter(
      (blocker) =>
        blocker.startsWith(prefix) ||
        [
          "motion_completion_asset_id_duplicate",
          "motion_completion_asset_path_duplicate",
          "motion_completion_asset_sha256_duplicate",
          "motion_completion_source_window_overlap",
        ].includes(blocker),
    );
    if (
      segmentBlockers.length === 0 &&
      rightsBasis &&
      observed.blockers.length === 0 &&
      probe
    ) {
      verifiedMotionSeconds += exactMotionSeconds;
      rightsRecords.push({
        asset_id: assetId,
        owner,
        source_url: mediaUrl,
        rights_basis: rightsBasis,
        rights_evidence: {
          reference: text(rightsEvidence.reference),
          sha256: rightsEvidenceSha256,
        },
        attribution_decision: attributionDecision,
        attribution_text:
          attributionDecision === "REQUIRED_AND_SUPPLIED"
            ? text(segment.attribution_text)
            : null,
        usage,
        materialised_path: observed.path,
        asset_sha256: observed.file_sha256,
        motion_family: motionFamily,
        exact_subject_motion_seconds: exactMotionSeconds,
        source_segment: {
          start_seconds: start,
          end_seconds: end,
          source_duration_seconds: sourceDuration,
        },
      });
      assetProvenance.push({
        asset_id: assetId,
        path: observed.path,
        sha256: observed.file_sha256,
        byte_length: observed.byte_length,
        ffprobe: {
          duration_seconds: probedDuration,
          video_stream_count: Number(probe.video_stream_count),
          audio_stream_count: Number(probe.audio_stream_count),
          width: finiteNumber(probe.width),
          height: finiteNumber(probe.height),
          format_name: text(probe.format_name),
        },
      });
    }
  }
  if (
    matchedReceiptSegmentIndexes.size !== receiptSegments.length
  ) {
    blockers.push(
      "motion_completion_materialisation_segment_inventory_mismatch",
    );
  }
  const expectedAmendedItemIds = [
    ...baselineRawItems.map((item) => text(item?.item_id)),
    ...segments.map((segment) => text(segment?.asset_id)),
  ].sort();
  const actualAmendedItemIds = amendedItems
    .map((item) => text(item?.item_id))
    .sort();
  if (
    JSON.stringify(actualAmendedItemIds) !==
    JSON.stringify(expectedAmendedItemIds)
  ) {
    blockers.push(
      "motion_completion_amended_item_inventory_mismatch",
    );
  }
  const amendedLedgerDir = amendedObserved.path
    ? path.dirname(amendedObserved.path)
    : manifestDir;
  for (const segmentValue of segments) {
    const segment = object(segmentValue);
    const amendedItem = object(
      amendedItemsById.get(text(segment.asset_id)),
    );
    const segmentRightsEvidence = object(segment.rights_evidence);
    const amendedRightsEvidence = object(
      amendedItem.rights_evidence,
    );
    const amendedSourceSegment = object(
      amendedItem.source_segment,
    );
    const amendedItemPath = resolveLocalPath(
      amendedItem.local_path ||
        amendedItem.asset_path ||
        amendedItem.materialised_path ||
        amendedItem.path,
      amendedLedgerDir,
    );
    const segmentPath = resolveLocalPath(
      segment.local_path,
      manifestDir,
    );
    const matchesSegment =
      text(amendedItem.item_id) === text(segment.asset_id) &&
      text(amendedItem.source_url) === mediaUrl &&
      amendedItemPath === segmentPath &&
      normaliseSha256(amendedItem.asset_sha256) ===
        normaliseSha256(segment.asset_sha256) &&
      amendedItem.included_in_final === true &&
      text(amendedItem.rights_decision).toUpperCase() ===
        "CLEARED" &&
      text(amendedItem.rights_basis).toUpperCase() ===
        text(segment.rights_basis).toUpperCase() &&
      text(amendedRightsEvidence.reference) ===
        text(segmentRightsEvidence.reference) &&
      normaliseSha256(amendedRightsEvidence.sha256) ===
        normaliseSha256(segmentRightsEvidence.sha256) &&
      text(amendedItem.attribution_decision).toUpperCase() ===
        text(segment.attribution_decision).toUpperCase() &&
      text(amendedItem.attribution_text) ===
        text(segment.attribution_text) &&
      text(amendedItem.owner) === text(segment.owner) &&
      text(amendedItem.usage) === text(segment.usage) &&
      text(amendedItem.motion_family) ===
        text(segment.motion_family) &&
      sameMillisecondValue(
        amendedItem.exact_subject_motion_seconds,
        segment.exact_subject_motion_seconds,
      ) &&
      sameMillisecondValue(
        amendedSourceSegment.start_seconds,
        segment.source_start_seconds,
      ) &&
      sameMillisecondValue(
        amendedSourceSegment.end_seconds,
        segment.source_end_seconds,
      ) &&
      sameMillisecondValue(
        amendedSourceSegment.source_duration_seconds,
        segment.source_duration_seconds,
      );
    if (!matchesSegment) {
      blockers.push(
        "motion_completion_amended_segment_item_mismatch",
      );
    }
  }
  const amendedIncludedItems = amendedItems.filter(
    (item) => item?.included_in_final === true,
  );
  const amendedItemMotionSeconds = amendedIncludedItems.reduce(
    (total, item) =>
      total +
      (finiteNumber(item?.exact_subject_motion_seconds) || 0),
    0,
  );
  const amendedMotionFamilies = new Set(
    amendedIncludedItems
      .map((item) => text(item?.motion_family))
      .filter(Boolean),
  );
  const amendedMediaPlan = object(amendedLedger.media_plan);
  const amendedDeclaredMotionSeconds = finiteNumber(
    amendedMediaPlan.exact_subject_motion_seconds,
  );
  const amendedDeclaredClipCount = finiteNumber(
    amendedMediaPlan.clip_count,
  );
  const amendedDeclaredMotionFamilyCount = finiteNumber(
    amendedMediaPlan.distinct_motion_families,
  );
  if (
    amendedMediaPlan.unknown_reuploads !== 0 ||
    amendedMediaPlan.third_party_music !== false ||
    amendedIncludedItems.some(
      (item) =>
        finiteNumber(item?.exact_subject_motion_seconds) === null ||
        finiteNumber(item?.exact_subject_motion_seconds) <= 0 ||
        !text(item?.motion_family),
    ) ||
    amendedDeclaredMotionSeconds === null ||
    Math.abs(
      amendedDeclaredMotionSeconds - amendedItemMotionSeconds,
    ) > DURATION_TOLERANCE_SECONDS ||
    !Number.isInteger(amendedDeclaredClipCount) ||
    amendedDeclaredClipCount !== amendedIncludedItems.length ||
    !Number.isInteger(amendedDeclaredMotionFamilyCount) ||
    amendedDeclaredMotionFamilyCount !== amendedMotionFamilies.size
  ) {
    blockers.push(
      "motion_completion_amended_media_plan_mismatch",
    );
  }
  if (
    verifiedMotionSeconds > MAXIMUM_TOTAL_COMPLETION_SECONDS
  ) {
    blockers.push("motion_completion_total_motion_seconds_excessive");
  }
  const minimumAdditional = requiredAdditionalSeconds(workOrder);
  if (
    minimumAdditional === null ||
    verifiedMotionSeconds + DURATION_TOLERANCE_SECONDS <
      minimumAdditional
  ) {
    blockers.push(
      "motion_completion_additional_motion_seconds_insufficient",
    );
  }
  const baselineItemMotionSeconds = baselineItems.reduce(
    (total, item) =>
      total +
      (finiteNumber(item?.exact_subject_motion_seconds) || 0),
    0,
  );
  const declaredBaselineMotionSeconds = finiteNumber(
    baselineLedger?.media_plan?.exact_subject_motion_seconds,
  );
  if (
    declaredBaselineMotionSeconds !== null &&
    Math.abs(
      declaredBaselineMotionSeconds - baselineItemMotionSeconds,
    ) > DURATION_TOLERANCE_SECONDS
  ) {
    blockers.push(
      "motion_completion_baseline_motion_seconds_inconsistent",
    );
  }
  const baselineMotionSeconds =
    declaredBaselineMotionSeconds ?? baselineItemMotionSeconds;
  const minimumTotal = requiredTotalSeconds(workOrder);
  if (
    baselineMotionSeconds === null ||
    minimumTotal === null ||
    baselineMotionSeconds +
      verifiedMotionSeconds +
      DURATION_TOLERANCE_SECONDS <
      minimumTotal
  ) {
    blockers.push(
      "motion_completion_total_motion_seconds_insufficient",
    );
  }

  const finalBlockers = unique(blockers).sort();
  return {
    schema_version: COMPLETION_SCHEMA_VERSION,
    verdict: finalBlockers.length ? "HOLD" : "READY",
    blockers: finalBlockers,
    story_id: storyId || null,
    candidate_id: candidateId || null,
    manifest_path: manifestObserved.path,
    manifest_file_sha256: manifestObserved.file_sha256,
    manifest_sha256: declaredManifestSha256,
    work_order_path: workOrderObserved.path,
    work_order_file_sha256: workOrderObserved.file_sha256,
    work_order_sha256: declaredWorkOrderSha256,
    materialisation_receipt_path: receiptObserved.path,
    materialisation_receipt_file_sha256:
      receiptObserved.file_sha256,
    materialisation_source_path: materialisationSourceObserved.path,
    materialisation_source_sha256:
      materialisationSourceObserved.file_sha256,
    materialisation_source_media_url: mediaUrl || null,
    source_evidence_path: sourceObserved.path,
    source_evidence_file_sha256: sourceObserved.file_sha256,
    source_evidence_packet_sha256: sourcePacketSha256,
    source_archive_path: archiveObserved.path,
    source_archive_sha256: archiveObserved.file_sha256,
    baseline_rights_ledger_path: baselineObserved.path,
    baseline_rights_ledger_file_sha256:
      baselineObserved.file_sha256,
    baseline_rights_ledger_sha256: baselineLedgerSha256,
    amended_rights_ledger_path: amendedObserved.path,
    amended_rights_ledger_file_sha256:
      amendedObserved.file_sha256,
    amended_rights_ledger_sha256:
      finalBlockers.length ? null : amendedLedgerSha256,
    verified_exact_subject_motion_seconds:
      finalBlockers.length ? 0 : verifiedMotionSeconds,
    rights_records: finalBlockers.length ? [] : rightsRecords,
    asset_provenance: finalBlockers.length ? [] : assetProvenance,
    safety: completionSafety(),
  };
}

async function materializeEvergreenMotionCoverageCompletion({
  request = {},
  output_path: outputPathInput,
  expected_story_id: expectedStoryId,
  expected_source_packet_sha256: expectedSourcePacketSha256,
  expected_baseline_rights_ledger_sha256:
    expectedBaselineRightsLedgerSha256,
  root_dir: rootDir = process.cwd(),
  ffprobe_path: ffprobePath = "ffprobe",
  probe_video: probeVideo = probeVideoFile,
} = {}) {
  const root = path.resolve(rootDir);
  const outputPath = resolveLocalPath(outputPathInput, root);
  if (!outputPath) {
    throw new Error("motion_completion_output_path_required");
  }
  if (path.basename(outputPath) !== COMPLETION_FILENAME) {
    throw new Error("motion_completion_output_filename_invalid");
  }
  const manifest =
    buildEvergreenMotionCoverageCompletionManifest(request);
  const bytes = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const fileSha256 = sha256(bytes);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  let existingBytes = null;
  try {
    existingBytes = await fs.readFile(outputPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existingBytes) {
    if (
      existingBytes.length !== bytes.length ||
      !crypto.timingSafeEqual(existingBytes, bytes)
    ) {
      throw new Error(
        "motion_completion_immutable_output_conflict",
      );
    }
    const validation =
      await validateEvergreenMotionCoverageCompletion({
        reference: {
          path: outputPath,
          file_sha256: fileSha256,
        },
        expected_story_id: expectedStoryId,
        expected_source_packet_sha256: expectedSourcePacketSha256,
        expected_baseline_rights_ledger_sha256:
          expectedBaselineRightsLedgerSha256,
        root_dir: root,
        ffprobe_path: ffprobePath,
        probe_video: probeVideo,
      });
    return {
      ...validation,
      created: false,
      immutable_replay: true,
      output_path: outputPath,
      output_file_sha256: fileSha256,
    };
  }

  const stagingPath = path.join(
    path.dirname(outputPath),
    `.${COMPLETION_FILENAME}.staging-${process.pid}-${crypto.randomUUID()}`,
  );
  let staged = false;
  try {
    const handle = await fs.open(stagingPath, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    staged = true;
    const validation =
      await validateEvergreenMotionCoverageCompletion({
        reference: {
          path: stagingPath,
          file_sha256: fileSha256,
        },
        expected_story_id: expectedStoryId,
        expected_source_packet_sha256: expectedSourcePacketSha256,
        expected_baseline_rights_ledger_sha256:
          expectedBaselineRightsLedgerSha256,
        root_dir: root,
        ffprobe_path: ffprobePath,
        probe_video: probeVideo,
      });
    if (validation.verdict !== "READY") {
      return {
        ...validation,
        created: false,
        immutable_replay: false,
        output_path: null,
        requested_output_path: outputPath,
        output_file_sha256: null,
      };
    }
    try {
      await fs.rename(stagingPath, outputPath);
      staged = false;
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      const racedBytes = await fs.readFile(outputPath);
      if (
        racedBytes.length !== bytes.length ||
        !crypto.timingSafeEqual(racedBytes, bytes)
      ) {
        throw new Error(
          "motion_completion_immutable_output_conflict",
        );
      }
    }
    return {
      ...validation,
      manifest_path: outputPath,
      manifest_file_sha256: fileSha256,
      created: true,
      immutable_replay: false,
      output_path: outputPath,
      output_file_sha256: fileSha256,
    };
  } finally {
    if (staged) {
      await fs.rm(stagingPath, { force: true }).catch(() => {});
    }
  }
}

module.exports = {
  COMPLETION_FILENAME,
  COMPLETION_SCHEMA_VERSION,
  DURATION_TOLERANCE_SECONDS,
  MAXIMUM_SEGMENT_SECONDS,
  MAXIMUM_SEGMENTS,
  MODE,
  WORK_ORDER_SCHEMA_VERSION,
  buildEvergreenMotionCoverageCompletionManifest,
  findEvergreenMotionCoverageCompletionReference,
  hashEvergreenMotionCoverageCompletion,
  materializeEvergreenMotionCoverageCompletion,
  probeVideoFile,
  validateEvergreenMotionCoverageCompletion,
};
