"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const {
  evaluateApplyGates,
  scriptSha256,
} = require("./governed-story-intake");
const {
  assessPublicationEvidence,
  hashRightsLedger,
} = require("./publication-evidence-gates");
const {
  classifyPlatformVideoQa,
  parseFfprobeJson,
} = require("./platform-video-qa");
const {
  evaluateRendererManifest,
  fingerprintRendererManifest,
} = require("../stabilisation/renderer-governance");

const execFileAsync = promisify(execFile);
const REVIEW_SCHEMA_VERSION = "pulse-governed-publication-review-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-governed-publication-review-result-v1";
const SOURCE_SCHEMA_VERSION = "pulse-source-evidence-v1";
const QA_SCHEMA_VERSION = "pulse-final-render-qa-v1";
const TRANSFORMATION_SCHEMA_VERSION =
  "pulse-transformation-evidence-v1";
const OWNED_MOTION_SCHEMA_VERSION = "pulse-owned-motion-manifest-v1";
const TIMESTAMPS_SCHEMA_VERSION = "pulse-word-timestamps-v1";
const MIN_DURATION_SECONDS = 25;
const MAX_DURATION_SECONDS = 32;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const EMBEDDED_ROLES = new Set(["motion", "narration", "music", "sfx"]);
const NON_EMBEDDED_ROLES = new Set(["word_timestamps"]);

class GovernedPublicationReviewError extends Error {
  constructor(
    codes,
    message = "governed_publication_review_validation_failed",
  ) {
    const normalised = unique(Array.isArray(codes) ? codes : [codes]);
    super(`${message}: ${normalised.join(", ")}`);
    this.name = "GovernedPublicationReviewError";
    this.codes = normalised;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function text(value) {
  return String(value || "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function parseJsonBytes(bytes, invalidCode) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new GovernedPublicationReviewError(invalidCode);
  }
}

function resolveBoundFile({
  baseDir,
  record,
  prefix,
  requireJson = false,
} = {}) {
  const errors = [];
  const declaredPath = text(record?.path);
  const declaredSha = text(record?.sha256).toLowerCase();
  const resolvedPath = declaredPath
    ? path.resolve(baseDir, declaredPath)
    : null;
  if (!declaredPath) errors.push(`${prefix}_path_required`);
  if (!SHA256_PATTERN.test(declaredSha)) {
    errors.push(`${prefix}_sha256_required`);
  }
  if (
    !resolvedPath ||
    !fs.existsSync(resolvedPath) ||
    !fs.statSync(resolvedPath).isFile()
  ) {
    errors.push(`${prefix}_file_not_found`);
  }
  let bytes = null;
  let value = null;
  if (resolvedPath && fs.existsSync(resolvedPath)) {
    bytes = fs.readFileSync(resolvedPath);
    if (bytes.length === 0) errors.push(`${prefix}_file_empty`);
    if (
      SHA256_PATTERN.test(declaredSha) &&
      sha256Bytes(bytes) !== declaredSha
    ) {
      errors.push(`${prefix}_sha256_mismatch`);
    }
    if (requireJson) {
      try {
        value = JSON.parse(bytes.toString("utf8"));
      } catch {
        errors.push(`${prefix}_invalid_json`);
      }
    }
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);
  return {
    declaredPath,
    path: resolvedPath,
    sha256: declaredSha,
    bytes,
    value,
  };
}

function resolveBoundJson({ baseDir, record, prefix } = {}) {
  return resolveBoundFile({
    baseDir,
    record,
    prefix,
    requireJson: true,
  });
}

function normaliseInput(input) {
  return {
    component_id: text(input?.component_id),
    role: text(input?.role).toLowerCase(),
    path: text(input?.path).replace(/\\/g, "/"),
    sha256: text(input?.sha256).toLowerCase(),
    embedded_in_final: input?.embedded_in_final === true,
  };
}

function normaliseInputList(value) {
  return (Array.isArray(value) ? value : [])
    .map(normaliseInput)
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
}

async function defaultProbe(filePath, options = {}) {
  const result = await execFileAsync(
    options.ffprobePath || "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    {
      timeout: options.probeTimeoutMs || 15000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const parsed = parseFfprobeJson(result.stdout);
  if (!parsed) {
    throw new GovernedPublicationReviewError(
      "final_mp4_ffprobe_output_invalid",
    );
  }
  return parsed;
}

async function inspectFinalMedia({
  filePath,
  probe = defaultProbe,
  ffprobePath,
  probeTimeoutMs,
} = {}) {
  let raw;
  try {
    raw = await probe(filePath, { ffprobePath, probeTimeoutMs });
  } catch (error) {
    if (error instanceof GovernedPublicationReviewError) throw error;
    throw new GovernedPublicationReviewError(
      "final_mp4_ffprobe_failed",
    );
  }
  if (typeof raw === "string") raw = parseFfprobeJson(raw);
  if (raw?.stdout !== undefined) raw = parseFfprobeJson(raw.stdout);
  const qa = classifyPlatformVideoQa(raw, { platform: "youtube_shorts" });
  const technical = qa.technical || {};
  const blockers = [];
  if (qa.result !== "pass") blockers.push("final_mp4_platform_qa_failed");
  if (
    technical.width !== 1080 ||
    technical.height !== 1920
  ) {
    blockers.push("final_mp4_dimensions_must_be_1080x1920");
  }
  if (text(technical.video_codec).toLowerCase() !== "h264") {
    blockers.push("final_mp4_video_codec_must_be_h264");
  }
  if (text(technical.audio_codec).toLowerCase() !== "aac") {
    blockers.push("final_mp4_audio_codec_must_be_aac");
  }
  if (technical.audio_sample_rate_hz !== 48000) {
    blockers.push("final_mp4_audio_sample_rate_must_be_48000");
  }
  if (technical.has_audio !== true) {
    blockers.push("final_mp4_audio_stream_required");
  }
  if (
    !Number.isFinite(technical.duration_seconds) ||
    technical.duration_seconds < MIN_DURATION_SECONDS ||
    technical.duration_seconds > MAX_DURATION_SECONDS
  ) {
    blockers.push("final_mp4_duration_must_be_25_to_32_seconds");
  }
  if (blockers.length) {
    throw new GovernedPublicationReviewError(blockers);
  }
  return { qa, probe: raw, technical };
}

function validateOwnedMotion({
  bound,
  storyId,
} = {}) {
  const manifest = bound.value;
  const errors = [];
  if (manifest?.schema_version !== OWNED_MOTION_SCHEMA_VERSION) {
    errors.push("owned_motion_manifest_schema_invalid");
  }
  if (text(manifest?.story_id) !== storyId) {
    errors.push("owned_motion_story_id_mismatch");
  }
  const rawAssets = Array.isArray(manifest?.assets)
    ? manifest.assets
    : [];
  if (!rawAssets.length) errors.push("owned_motion_assets_required");
  const assets = [];
  for (const [index, raw] of rawAssets.entries()) {
    const prefix = `owned_motion_asset_${index}`;
    let file;
    try {
      file = resolveBoundFile({
        baseDir: path.dirname(bound.path),
        record: raw,
        prefix,
      });
    } catch (error) {
      if (error instanceof GovernedPublicationReviewError) {
        errors.push(...error.codes);
        continue;
      }
      throw error;
    }
    const mediaType = text(raw?.media_type).toLowerCase();
    if (!["image", "video"].includes(mediaType)) {
      errors.push(`${prefix}_media_type_invalid`);
    }
    if (text(raw?.ownership).toLowerCase() !== "owned") {
      errors.push(`${prefix}_ownership_must_be_owned`);
    }
    assets.push({
      path: file.path,
      sha256: file.sha256,
      media_type: mediaType,
      role: text(raw?.role),
      ownership: text(raw?.ownership).toLowerCase(),
    });
  }
  if (!assets.some((asset) => asset.media_type === "video")) {
    errors.push("owned_motion_video_required");
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);
  return { manifest, assets };
}

function validateTimestamps({ bound, storyId, maxDuration } = {}) {
  const input = bound.value;
  const errors = [];
  if (input?.schema_version !== TIMESTAMPS_SCHEMA_VERSION) {
    errors.push("word_timestamps_schema_invalid");
  }
  if (text(input?.story_id) !== storyId) {
    errors.push("word_timestamps_story_id_mismatch");
  }
  if (!Array.isArray(input?.words) || input.words.length === 0) {
    errors.push("word_timestamps_words_required");
  } else {
    let lastEnd = 0;
    for (const word of input.words) {
      const start = Number(word?.start_seconds);
      const end = Number(word?.end_seconds);
      if (
        !text(word?.text) ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < lastEnd ||
        end <= start
      ) {
        errors.push("word_timestamps_sequence_invalid");
        break;
      }
      lastEnd = end;
    }
    if (lastEnd > maxDuration) {
      errors.push("word_timestamps_exceed_final_duration");
    }
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);
}

function validateRendererInputs({
  manifestDir,
  reviewInputs,
  rendererInputs,
  narration,
  timestamps,
  ownedMotion,
  rightsLedger,
  rightsLedgerPath,
} = {}) {
  const errors = [];
  const normalisedReview = normaliseInputList(reviewInputs);
  const normalisedRenderer = normaliseInputList(rendererInputs);
  if (!normalisedReview.length) errors.push("renderer_inputs_required");
  if (stableJson(normalisedReview) !== stableJson(normalisedRenderer)) {
    errors.push("renderer_inputs_manifest_mismatch");
  }
  const ids = new Set();
  const resolvedInputs = [];
  for (const input of normalisedReview) {
    if (!input.component_id) errors.push("renderer_input_component_id_required");
    if (ids.has(input.component_id)) {
      errors.push("renderer_input_component_id_duplicate");
    }
    ids.add(input.component_id);
    if (
      !EMBEDDED_ROLES.has(input.role) &&
      !NON_EMBEDDED_ROLES.has(input.role)
    ) {
      errors.push("renderer_input_role_invalid");
    }
    if (
      EMBEDDED_ROLES.has(input.role) &&
      input.embedded_in_final !== true
    ) {
      errors.push("renderer_embedded_input_flag_required");
    }
    if (
      NON_EMBEDDED_ROLES.has(input.role) &&
      input.embedded_in_final !== false
    ) {
      errors.push("renderer_non_embedded_input_flag_required");
    }
    try {
      const file = resolveBoundFile({
        baseDir: manifestDir,
        record: input,
        prefix: `renderer_input_${input.component_id || "unknown"}`,
      });
      resolvedInputs.push({ ...input, absolutePath: file.path });
    } catch (error) {
      if (error instanceof GovernedPublicationReviewError) {
        errors.push(...error.codes);
      } else {
        throw error;
      }
    }
  }

  const narrationInput = resolvedInputs.find(
    (input) => input.role === "narration",
  );
  if (
    !narrationInput ||
    narrationInput.component_id !== text(narration.component_id) ||
    narrationInput.absolutePath !== narration.path ||
    narrationInput.sha256 !== narration.sha256
  ) {
    errors.push("narration_renderer_input_mismatch");
  }
  const timestampsInput = resolvedInputs.find(
    (input) => input.role === "word_timestamps",
  );
  if (
    !timestampsInput ||
    timestampsInput.component_id !== text(timestamps.component_id) ||
    timestampsInput.absolutePath !== timestamps.path ||
    timestampsInput.sha256 !== timestamps.sha256
  ) {
    errors.push("word_timestamps_renderer_input_mismatch");
  }
  const motionInputs = resolvedInputs.filter(
    (input) => input.role === "motion",
  );
  if (!motionInputs.length) errors.push("owned_motion_renderer_input_required");
  for (const input of motionInputs) {
    if (
      !ownedMotion.assets.some(
        (asset) =>
          asset.path === input.absolutePath &&
          asset.sha256 === input.sha256 &&
          asset.media_type === "video",
      )
    ) {
      errors.push("owned_motion_renderer_input_mismatch");
    }
  }

  const includedItems = Array.isArray(rightsLedger?.items)
    ? rightsLedger.items.filter((item) => item?.included_in_final === true)
    : [];
  const embeddedInputs = resolvedInputs.filter(
    (input) => input.embedded_in_final,
  );
  const includedIds = includedItems
    .map((item) => text(item?.item_id))
    .sort();
  const embeddedIds = embeddedInputs
    .map((input) => input.component_id)
    .sort();
  if (stableJson(includedIds) !== stableJson(embeddedIds)) {
    errors.push("rights_ledger_renderer_component_coverage_mismatch");
  }
  for (const item of includedItems) {
    const itemId = text(item?.item_id);
    const input = embeddedInputs.find(
      (candidate) => candidate.component_id === itemId,
    );
    const assetPath = text(item?.asset_path)
      ? path.resolve(path.dirname(rightsLedgerPath), item.asset_path)
      : null;
    if (
      !input ||
      !assetPath ||
      input.absolutePath !== assetPath ||
      input.sha256 !== text(item?.asset_sha256).toLowerCase()
    ) {
      errors.push("rights_ledger_component_asset_mismatch");
    }
    const rightsEvidence = item?.rights_evidence || {};
    try {
      resolveBoundFile({
        baseDir: path.dirname(rightsLedgerPath),
        record: {
          path: rightsEvidence.reference,
          sha256: rightsEvidence.sha256,
        },
        prefix: `rights_evidence_${itemId || "unknown"}`,
      });
    } catch (error) {
      if (error instanceof GovernedPublicationReviewError) {
        errors.push(...error.codes);
      } else {
        throw error;
      }
    }
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);
  return resolvedInputs;
}

async function validatePublicationReviewManifest({
  manifestPath,
  probe,
  ffprobePath,
  probeTimeoutMs,
} = {}) {
  const resolvedManifestPath = path.resolve(text(manifestPath));
  if (
    !manifestPath ||
    !fs.existsSync(resolvedManifestPath) ||
    !fs.statSync(resolvedManifestPath).isFile()
  ) {
    throw new GovernedPublicationReviewError(
      "publication_review_manifest_file_required",
    );
  }
  const manifestBytes = fs.readFileSync(resolvedManifestPath);
  const manifest = parseJsonBytes(
    manifestBytes,
    "publication_review_manifest_invalid_json",
  );
  const manifestDir = path.dirname(resolvedManifestPath);
  const errors = [];
  if (manifest?.schema_version !== REVIEW_SCHEMA_VERSION) {
    errors.push("publication_review_manifest_schema_invalid");
  }
  const storyId = text(manifest?.story_id);
  const channelId = text(manifest?.channel_id);
  const expectedScriptSha = text(manifest?.script_sha256).toLowerCase();
  if (!storyId) errors.push("publication_review_story_id_required");
  if (!channelId) errors.push("publication_review_channel_id_required");
  if (!SHA256_PATTERN.test(expectedScriptSha)) {
    errors.push("publication_review_script_sha256_required");
  }
  if (errors.length) throw new GovernedPublicationReviewError(errors);

  const finalMp4 = resolveBoundFile({
    baseDir: manifestDir,
    record: manifest.final_mp4,
    prefix: "final_mp4",
  });
  const narration = {
    ...resolveBoundFile({
      baseDir: manifestDir,
      record: manifest.narration_audio,
      prefix: "narration_audio",
    }),
    component_id: text(manifest?.narration_audio?.component_id),
  };
  const timestamps = {
    ...resolveBoundJson({
      baseDir: manifestDir,
      record: manifest.word_timestamps,
      prefix: "word_timestamps",
    }),
    component_id: text(manifest?.word_timestamps?.component_id),
  };
  const ownedMotionBound = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.owned_motion_manifest,
    prefix: "owned_motion_manifest",
  });
  const source = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.source_evidence,
    prefix: "source_evidence",
  });
  const qaReport = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.qa_report,
    prefix: "qa_report",
  });
  const transformation = resolveBoundJson({
    baseDir: manifestDir,
    record: manifest.transformation_evidence,
    prefix: "transformation_evidence",
  });

  const rightsRecord = {
    path: manifest?.rights_ledger?.path,
    sha256: manifest?.rights_ledger?.file_sha256,
  };
  const rights = resolveBoundJson({
    baseDir: manifestDir,
    record: rightsRecord,
    prefix: "rights_ledger",
  });
  const rendererRecord = {
    path: manifest?.renderer_manifest?.path,
    sha256: manifest?.renderer_manifest?.file_sha256,
  };
  const renderer = resolveBoundJson({
    baseDir: manifestDir,
    record: rendererRecord,
    prefix: "renderer_manifest",
  });

  const mediaInspection = await inspectFinalMedia({
    filePath: finalMp4.path,
    probe,
    ffprobePath,
    probeTimeoutMs,
  });
  const validationErrors = [];
  if (
    source.value?.schema_version !== SOURCE_SCHEMA_VERSION ||
    source.value?.source_type !== "official"
  ) {
    validationErrors.push("official_source_evidence_required");
  }
  if (
    qaReport.value?.schema_version !== QA_SCHEMA_VERSION ||
    text(qaReport.value?.verdict).toUpperCase() !== "PASS"
  ) {
    validationErrors.push("qa_pass_report_required");
  }
  if (text(qaReport.value?.story_id) !== storyId) {
    validationErrors.push("qa_report_story_id_mismatch");
  }
  if (text(qaReport.value?.channel_id) !== channelId) {
    validationErrors.push("qa_report_channel_id_mismatch");
  }
  if (text(qaReport.value?.media_sha256).toLowerCase() !== finalMp4.sha256) {
    validationErrors.push("qa_report_media_sha256_mismatch");
  }
  if (
    text(qaReport.value?.script_sha256).toLowerCase() !==
    expectedScriptSha
  ) {
    validationErrors.push("qa_report_script_sha256_mismatch");
  }
  if (
    transformation.value?.schema_version !==
      TRANSFORMATION_SCHEMA_VERSION
  ) {
    validationErrors.push("transformation_evidence_schema_invalid");
  }
  if (text(transformation.value?.story_id) !== storyId) {
    validationErrors.push("transformation_evidence_story_id_mismatch");
  }
  const canonicalRightsSha = hashRightsLedger(rights.value);
  if (
    text(manifest?.rights_ledger?.canonical_sha256).toLowerCase() !==
    canonicalRightsSha
  ) {
    validationErrors.push("rights_ledger_canonical_sha256_mismatch");
  }
  if (text(rights.value?.story_id) !== storyId) {
    validationErrors.push("rights_ledger_story_id_mismatch");
  }
  const canonicalRendererSha = fingerprintRendererManifest(renderer.value);
  if (
    text(manifest?.renderer_manifest?.canonical_sha256).toLowerCase() !==
    canonicalRendererSha
  ) {
    validationErrors.push("renderer_manifest_canonical_sha256_mismatch");
  }
  if (
    text(qaReport.value?.renderer_manifest_sha256).toLowerCase() !==
    canonicalRendererSha
  ) {
    validationErrors.push("qa_report_renderer_manifest_sha256_mismatch");
  }
  if (text(renderer.value?.story_id) !== storyId) {
    validationErrors.push("renderer_manifest_story_id_mismatch");
  }
  if (text(renderer.value?.channel_id) !== channelId) {
    validationErrors.push("renderer_manifest_channel_id_mismatch");
  }
  if (
    text(renderer.value?.output?.sha256).toLowerCase() !== finalMp4.sha256
  ) {
    validationErrors.push("renderer_output_media_sha256_mismatch");
  }
  const technical = mediaInspection.technical;
  for (const [key, actual] of [
    ["width", technical.width],
    ["height", technical.height],
    ["video_codec", technical.video_codec],
    ["audio_codec", technical.audio_codec],
    ["audio_sample_rate_hz", technical.audio_sample_rate_hz],
    ["has_audio", technical.has_audio],
    ["duration_seconds", technical.duration_seconds],
  ]) {
    const declared = renderer.value?.output?.[key];
    const matches =
      key === "duration_seconds"
        ? Math.abs(Number(declared) - Number(actual)) <= 0.05
        : String(declared) === String(actual);
    if (!matches) validationErrors.push(`renderer_output_${key}_mismatch`);
  }

  const rendererEvaluation = evaluateRendererManifest(renderer.value, {
    operatingMode: "HUMAN_REVIEW",
  });
  if (
    rendererEvaluation.verdict !== "PASS" ||
    rendererEvaluation.publishable !== true
  ) {
    validationErrors.push(...rendererEvaluation.blockers);
    validationErrors.push("renderer_not_publishable_under_human_review");
  }
  const ownedMotion = validateOwnedMotion({
    bound: ownedMotionBound,
    storyId,
  });
  validateTimestamps({
    bound: timestamps,
    storyId,
    maxDuration: technical.duration_seconds,
  });
  const resolvedInputs = validateRendererInputs({
    manifestDir,
    reviewInputs: manifest.renderer_inputs,
    rendererInputs: renderer.value?.inputs,
    narration,
    timestamps,
    ownedMotion,
    rightsLedger: rights.value,
    rightsLedgerPath: rights.path,
  });

  const preflightEvidence = {
    schema_version: "pulse-publication-review-evidence-v1",
    story_id: storyId,
    channel_id: channelId,
    script_sha256: expectedScriptSha,
    media_sha256: finalMp4.sha256,
    source_evidence_sha256: source.sha256,
    qa_report_sha256: qaReport.sha256,
    originality_transformation: {
      verdict: text(transformation.value?.verdict).toUpperCase(),
      rationale: text(transformation.value?.rationale),
      evidence_ref: transformation.path,
      evidence_sha256: transformation.sha256,
    },
    rights_ledger: rights.value,
    rights_ledger_sha256: canonicalRightsSha,
    synthetic_media_disclosure:
      manifest.synthetic_media_disclosure,
    renderer_manifest: renderer.value,
    renderer_manifest_sha256: canonicalRendererSha,
    artifact_evidence: {
      final_mp4_exists: true,
      narration_audio_exists: true,
      word_timestamps_exist: true,
      motion_materialised: true,
      hashes_verified: true,
    },
  };
  const publicationAssessment =
    assessPublicationEvidence(preflightEvidence);
  if (!publicationAssessment.eligible) {
    validationErrors.push(...publicationAssessment.blockers);
  }
  if (validationErrors.length) {
    throw new GovernedPublicationReviewError(validationErrors);
  }
  return {
    manifest,
    manifestPath: resolvedManifestPath,
    manifestSha256: sha256Bytes(manifestBytes),
    storyId,
    channelId,
    scriptSha256: expectedScriptSha,
    mediaSha256: finalMp4.sha256,
    finalMp4,
    narration,
    timestamps,
    ownedMotion: {
      ...ownedMotion,
      path: ownedMotionBound.path,
      sha256: ownedMotionBound.sha256,
    },
    source,
    qaReport,
    transformation,
    rights: {
      ...rights,
      canonicalSha256: canonicalRightsSha,
    },
    renderer: {
      ...renderer,
      canonicalSha256: canonicalRendererSha,
      evaluation: rendererEvaluation,
    },
    rendererInputs: resolvedInputs,
    mediaInspection,
    preflightEvidence,
  };
}

function buildResult({
  validation,
  generatedAt,
  mode,
  verdict,
  mutated = false,
  idempotent = false,
  blockers = [],
  backup = null,
  inspection = null,
} = {}) {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    generated_at: generatedAt,
    mode,
    verdict,
    mutated,
    idempotent,
    story_id: validation?.storyId || null,
    channel_id: validation?.channelId || null,
    script_sha256: validation?.scriptSha256 || null,
    media_sha256: validation?.mediaSha256 || null,
    review_manifest_sha256: validation?.manifestSha256 || null,
    preflight_evidence: validation?.preflightEvidence || null,
    blockers: unique(blockers),
    backup_evidence: backup,
    database_inspection: inspection,
    safety: {
      lifecycle_admission_performed: false,
      external_calls: [],
      uploads_performed: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
    },
  };
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function tableExists(db, tableName) {
  return !!db
    .prepare(
      `SELECT 1 FROM sqlite_master
       WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(tableName);
}

function inspectStoppedRuntime(db, generatedAt) {
  const blockers = [];
  if (
    tableExists(db, "runtime_leases") &&
    db
      .prepare(
        `SELECT 1 FROM runtime_leases
         WHERE julianday(expires_at) > julianday(?) LIMIT 1`,
      )
      .get(generatedAt)
  ) {
    blockers.push("active_runtime_leases_present");
  }
  if (
    tableExists(db, "jobs") &&
    db
      .prepare(
        `SELECT 1 FROM jobs
         WHERE status IN ('claimed', 'running') LIMIT 1`,
      )
      .get()
  ) {
    blockers.push("running_jobs_present");
  }
  if (
    tableExists(db, "workers") &&
    db
      .prepare(
        `SELECT 1 FROM workers
         WHERE COALESCE(status, '') NOT IN ('offline', 'locked') LIMIT 1`,
      )
      .get()
  ) {
    blockers.push("active_workers_present");
  }
  return blockers;
}

function applyCommandBlockers(options, validation) {
  const blockers = [];
  if (text(options.confirmStoryId) !== validation.storyId) {
    blockers.push("exact_story_confirmation_required");
  }
  const confirmedMedia = text(
    options.confirmMediaSha256,
  ).toLowerCase();
  if (!SHA256_PATTERN.test(confirmedMedia)) {
    blockers.push("exact_media_sha256_confirmation_required");
  } else if (confirmedMedia !== validation.mediaSha256) {
    blockers.push("exact_media_sha256_confirmation_mismatch");
  }
  const confirmedScript = text(
    options.confirmScriptSha256,
  ).toLowerCase();
  if (!SHA256_PATTERN.test(confirmedScript)) {
    blockers.push("exact_script_sha256_confirmation_required");
  } else if (confirmedScript !== validation.scriptSha256) {
    blockers.push("exact_script_sha256_confirmation_mismatch");
  }
  if (!text(options.actorId)) blockers.push("operator_actor_required");
  if (!text(options.reason)) blockers.push("operator_reason_required");
  return blockers;
}

function buildReviewProvenance({
  validation,
  actorId,
  reason,
  generatedAt,
} = {}) {
  return {
    schema_version: "pulse-final-publication-review-v1",
    story_id: validation.storyId,
    channel_id: validation.channelId,
    review_manifest_path: validation.manifestPath,
    review_manifest_sha256: validation.manifestSha256,
    script_sha256: validation.scriptSha256,
    media_sha256: validation.mediaSha256,
    source_evidence: {
      path: validation.source.path,
      sha256: validation.source.sha256,
    },
    qa_report: {
      path: validation.qaReport.path,
      sha256: validation.qaReport.sha256,
      verdict: "PASS",
    },
    transformation_evidence: {
      path: validation.transformation.path,
      sha256: validation.transformation.sha256,
      verdict:
        validation.preflightEvidence.originality_transformation.verdict,
      rationale:
        validation.preflightEvidence.originality_transformation.rationale,
    },
    rights_ledger: {
      path: validation.rights.path,
      file_sha256: validation.rights.sha256,
      canonical_sha256: validation.rights.canonicalSha256,
    },
    renderer_manifest: {
      path: validation.renderer.path,
      file_sha256: validation.renderer.sha256,
      canonical_sha256: validation.renderer.canonicalSha256,
      verdict: validation.renderer.evaluation.verdict,
      publishable_under_human_review:
        validation.renderer.evaluation.publishable === true,
    },
    final_mp4: {
      path: validation.finalMp4.path,
      sha256: validation.finalMp4.sha256,
    },
    narration_audio: {
      path: validation.narration.path,
      sha256: validation.narration.sha256,
      component_id: validation.narration.component_id,
    },
    word_timestamps: {
      path: validation.timestamps.path,
      sha256: validation.timestamps.sha256,
      component_id: validation.timestamps.component_id,
    },
    owned_motion_manifest: {
      path: validation.ownedMotion.path,
      sha256: validation.ownedMotion.sha256,
    },
    renderer_inputs: validation.rendererInputs.map((input) => ({
      component_id: input.component_id,
      role: input.role,
      path: input.absolutePath,
      sha256: input.sha256,
      embedded_in_final: input.embedded_in_final,
    })),
    ffprobe: validation.mediaInspection.technical,
    reviewed_by: actorId,
    review_reason: reason,
    reviewed_at: generatedAt,
  };
}

function insertAuditIdempotently(db, audit) {
  db.prepare(
    `INSERT OR IGNORE INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision, reason,
        evidence_json, idempotency_key)
     VALUES (?, 'governed_publication_review', 'story', ?,
             'HUMAN_RENDER_APPROVED', ?, ?, ?)`,
  ).run(
    audit.actorId,
    audit.storyId,
    audit.reason,
    JSON.stringify(audit.evidence),
    audit.idempotencyKey,
  );
  return db
    .prepare(
      "SELECT * FROM operator_audit_log WHERE idempotency_key = ?",
    )
    .get(audit.idempotencyKey);
}

function applyReviewTransaction({
  db,
  validation,
  actorId,
  reason,
  generatedAt,
} = {}) {
  const idempotencyKey =
    `governed-publication-review:${validation.storyId}:` +
    `${validation.mediaSha256}:${validation.scriptSha256}:` +
    validation.manifestSha256;
  const story = db
    .prepare("SELECT * FROM stories WHERE id = ?")
    .get(validation.storyId);
  if (!story) {
    throw new GovernedPublicationReviewError("story_not_found");
  }
  const extra = parseJsonObject(story._extra);
  const blockers = [];
  if (text(story.channel_id || "pulse-gaming") !== validation.channelId) {
    blockers.push("story_channel_id_mismatch");
  }
  if (story.approved !== 1 && story.approved !== true) {
    blockers.push("human_script_approval_required");
  }
  if (story.auto_approved !== 0 && story.auto_approved !== false) {
    blockers.push("auto_approved_story_forbidden");
  }
  const actualScriptSha = scriptSha256(story.full_script);
  if (actualScriptSha !== validation.scriptSha256) {
    blockers.push("story_script_sha256_mismatch");
  }
  if (
    text(extra.script_approved_sha256).toLowerCase() !==
    validation.scriptSha256
  ) {
    blockers.push("human_script_approval_hash_mismatch");
  }
  if (
    text(extra.operator_review_status).toLowerCase() !==
    "script_approved"
  ) {
    blockers.push("human_script_approval_evidence_required");
  }
  if (
    !text(extra.script_approved_by) ||
    !text(extra.script_approved_at)
  ) {
    blockers.push("human_script_approval_provenance_required");
  }
  if (
    text(extra.source_evidence_sha256).toLowerCase() !==
    validation.source.sha256
  ) {
    blockers.push("source_evidence_intake_hash_mismatch");
  }
  if (
    text(extra.owned_asset_manifest_sha256).toLowerCase() !==
    validation.ownedMotion.sha256
  ) {
    blockers.push("owned_motion_intake_hash_mismatch");
  }
  if (blockers.length) {
    throw new GovernedPublicationReviewError(blockers);
  }

  const existingAudit = db
    .prepare(
      "SELECT * FROM operator_audit_log WHERE idempotency_key = ?",
    )
    .get(idempotencyKey);
  const existingReview = parseJsonObject(
    extra.final_publication_review,
  );
  if (existingAudit) {
    if (
      extra.render_review_status === "approved" &&
      extra.preflight_evidence?.media_sha256 ===
        validation.mediaSha256 &&
      existingReview.review_manifest_sha256 ===
        validation.manifestSha256 &&
      story.exported_path === validation.finalMp4.path &&
      story.audio_path === validation.narration.path
    ) {
      return { mutated: false, idempotent: true };
    }
    throw new GovernedPublicationReviewError(
      "publication_review_idempotency_conflict",
    );
  }
  if (
    text(story.exported_path) &&
    story.exported_path !== validation.finalMp4.path
  ) {
    throw new GovernedPublicationReviewError(
      "existing_final_render_conflict",
    );
  }
  const provenance = buildReviewProvenance({
    validation,
    actorId,
    reason,
    generatedAt,
  });
  const nextExtra = {
    ...extra,
    render_review_status: "approved",
    preflight_evidence: validation.preflightEvidence,
    final_publication_review: provenance,
  };
  db.prepare(
    `UPDATE stories
     SET exported_path = ?, audio_path = ?, updated_at = ?, _extra = ?
     WHERE id = ?`,
  ).run(
    validation.finalMp4.path,
    validation.narration.path,
    generatedAt,
    JSON.stringify(nextExtra),
    validation.storyId,
  );
  insertAuditIdempotently(db, {
    actorId,
    storyId: validation.storyId,
    reason,
    idempotencyKey,
    evidence: provenance,
  });
  return { mutated: true, idempotent: false };
}

async function executeGovernedPublicationReview(options = {}) {
  const generatedAt = new Date(
    options.generatedAt || new Date(),
  ).toISOString();
  const validation = await validatePublicationReviewManifest({
    manifestPath: options.manifestPath,
    probe: options.probe,
    ffprobePath: options.ffprobePath,
    probeTimeoutMs: options.probeTimeoutMs,
  });
  if (options.apply !== true) {
    return buildResult({
      validation,
      generatedAt,
      mode: "DRY_RUN",
      verdict: "VALID",
    });
  }
  const commandBlockers = applyCommandBlockers(options, validation);
  const gates = evaluateApplyGates({
    databasePath: options.databasePath,
    backupEvidencePath: options.backupEvidencePath,
    generatedAt,
    env: options.env || process.env,
    DatabaseImpl: options.DatabaseImpl,
  });
  const blockers = unique([...commandBlockers, ...gates.blockers]);
  if (blockers.length) {
    return buildResult({
      validation,
      generatedAt,
      mode: "APPLY",
      verdict: "HOLD",
      blockers,
      backup: gates.backup,
      inspection: gates.inspection,
    });
  }
  const Database = options.DatabaseImpl || require("better-sqlite3");
  const db = new Database(path.resolve(options.databasePath), {
    fileMustExist: true,
  });
  let transactionResult;
  try {
    transactionResult = db.transaction(() => {
      const runtimeBlockers = inspectStoppedRuntime(db, generatedAt);
      if (runtimeBlockers.length) {
        throw new GovernedPublicationReviewError(runtimeBlockers);
      }
      return applyReviewTransaction({
        db,
        validation,
        actorId: text(options.actorId),
        reason: text(options.reason),
        generatedAt,
      });
    }).immediate();
  } catch (error) {
    if (error instanceof GovernedPublicationReviewError) {
      return buildResult({
        validation,
        generatedAt,
        mode: "APPLY",
        verdict: "HOLD",
        blockers: error.codes,
        backup: gates.backup,
        inspection: gates.inspection,
      });
    }
    throw error;
  } finally {
    db.close();
  }
  return buildResult({
    validation,
    generatedAt,
    mode: "APPLY",
    verdict: transactionResult.idempotent
      ? "IDEMPOTENT"
      : "APPLIED",
    mutated: transactionResult.mutated,
    idempotent: transactionResult.idempotent,
    backup: gates.backup,
    inspection: gates.inspection,
  });
}

module.exports = {
  GovernedPublicationReviewError,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  REVIEW_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  executeGovernedPublicationReview,
  hashFile,
  inspectFinalMedia,
  sha256Bytes,
  stableJson,
  validatePublicationReviewManifest,
};
