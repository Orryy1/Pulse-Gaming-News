"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("fs-extra");
const {
  validateTemporalVideoQaReport,
} = require("./services/video-qa");

const execFileAsync = promisify(execFile);
const AUTHORITY_FILES = [
  "goal_package_summary.json",
  "platform_publish_manifest.json",
  "publish_verdict.json",
];
const ENABLED_PLATFORMS = [
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
];
const GREEN_STATUSES = new Set([
  "GREEN",
  "PASS",
  "PASSED",
  "READY",
  "APPROVED",
  "POST_RENDER_FORENSICS_PASSED",
]);
const AMBER_STATUSES = new Set([
  "AMBER",
  "WARN",
  "WARNING",
  "ADVISORY",
]);
const RED_STATUSES = new Set([
  "RED",
  "FAIL",
  "FAILED",
  "BLOCKED",
  "HARD_STOP",
  "HELD",
  "HOLD",
  "REJECTED",
  "PENDING",
  "UNKNOWN",
]);
const AFFIRMATIVE_RIGHTS_APPROVAL_RE =
  /^(?:APPROVED(?:_|$)|CLEARED(?:_|$)|GREEN$|PASS(?:ED)?$)/;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function normaliseSha256(value) {
  return clean(value).replace(/^sha256:/i, "").toLowerCase();
}

function normaliseStatus(value) {
  return clean(value).replace(/[\s-]+/g, "_").toUpperCase();
}

function resolveLocalPath(value, artifactDir) {
  const text = clean(value);
  if (!text || /^[a-z]+:\/\//i.test(text) && !/^file:\/\//i.test(text)) return "";
  const local = /^file:\/\//i.test(text)
    ? decodeURIComponent(text.replace(/^file:\/\//i, ""))
    : text;
  return path.resolve(path.isAbsolute(local) ? local : path.join(artifactDir, local));
}

async function fingerprintFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return {
    path: path.resolve(filePath),
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    size_bytes: buffer.length,
  };
}

async function readJsonEvidence(filePath) {
  if (!(await fs.pathExists(filePath))) {
    return { present: false, valid: false, value: null, error: "missing" };
  }
  try {
    const value = await fs.readJson(filePath);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { present: true, valid: false, value: null, error: "unreadable" };
    }
    return {
      present: true,
      valid: true,
      value,
      error: null,
    };
  } catch {
    return { present: true, valid: false, value: null, error: "unreadable" };
  }
}

function evidenceStatuses(document = {}) {
  return unique([
    document.verdict,
    document.final_verdict,
    document.status,
    document.result,
    document.quality_gate_status,
  ]).map(normaliseStatus);
}

function evidenceFailures(document = {}) {
  return unique([
    ...asArray(document.blockers),
    ...asArray(document.hard_blockers),
    ...asArray(document.failures),
    ...asArray(document.errors),
    ...asArray(document.reason_codes),
    ...asArray(document.rejection_reasons),
  ]);
}

function evidenceWarnings(document = {}) {
  return unique([
    ...asArray(document.warnings),
    ...asArray(document.advisories),
  ]);
}

function classifyEvidence(document = {}) {
  const statuses = evidenceStatuses(document);
  if (evidenceFailures(document).length || statuses.some((status) => RED_STATUSES.has(status))) {
    return "RED";
  }
  if (evidenceWarnings(document).length || statuses.some((status) => AMBER_STATUSES.has(status))) {
    return "AMBER";
  }
  return statuses.some((status) => GREEN_STATUSES.has(status)) ? "GREEN" : "RED";
}

function hasExplicitEvidenceSignal(document = {}) {
  return evidenceStatuses(document).length > 0 ||
    evidenceFailures(document).length > 0 ||
    evidenceWarnings(document).length > 0;
}

async function defaultProbeMedia(filePath, { kind = "render" } = {}) {
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || "ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name",
      "-of", "json",
      filePath,
    ], {
      timeout: 30_000,
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout || "{}");
    const duration = Number(parsed.format?.duration);
    const streams = asArray(parsed.streams);
    const hasAudio = streams.some((stream) => stream.codec_type === "audio");
    const hasVideo = streams.some((stream) => stream.codec_type === "video");
    return {
      decodable: Number.isFinite(duration) && duration > 0 &&
        (kind === "audio" ? hasAudio : hasAudio && hasVideo),
      duration_seconds: Number.isFinite(duration) ? duration : null,
    };
  } catch (error) {
    return { decodable: false, error: clean(error.message) };
  }
}

function requiredRightsFields(record = {}) {
  const allowedPlatforms = asArray(record.allowed_platforms || record.platforms)
    .map((value) => clean(value).toLowerCase());
  return {
    asset_id: clean(record.asset_id || record.id),
    kind: clean(record.kind || record.asset_type),
    path: clean(record.path || record.local_materialized_path || record.local_materialised_path),
    asset_sha256: normaliseSha256(record.asset_sha256 || record.sha256),
    asset_size_bytes: Number(record.asset_size_bytes || record.size_bytes),
    source_url: clean(record.source_url || record.evidence_reference),
    source_type: clean(record.source_type),
    source_owner: clean(record.source_owner || record.creator || record.provider_id),
    licence_basis: clean(record.licence_basis || record.rights_basis),
    allowed_use: clean(record.allowed_use || record.usage_scope),
    allowed_platforms: allowedPlatforms,
    commercial_use_allowed: record.commercial_use_allowed,
    credit_required: record.credit_required,
    approval_status: clean(record.approval_status || record.rights_status || record.rights_verdict),
    evidence_file: clean(record.evidence_file || record.evidence_reference),
  };
}

async function inspectRightsLedger({ artifactDir, storyId, rightsEvidence }) {
  const blockers = [];
  if (!rightsEvidence.present) blockers.push("rights_ledger_missing");
  else if (!rightsEvidence.valid) blockers.push("rights_ledger_unreadable");
  if (blockers.length) {
    return { verdict: "RED", blockers, warnings: [], used_asset_count: 0, record_count: 0 };
  }

  const ledger = rightsEvidence.value;
  const warnings = evidenceWarnings(ledger);
  if (clean(ledger.story_id) && clean(ledger.story_id) !== storyId) {
    blockers.push("rights_ledger_story_id_mismatch");
  }
  const ledgerClassification = classifyEvidence(ledger);
  if (ledgerClassification === "RED") blockers.push("rights_ledger_not_green");
  else if (ledgerClassification === "AMBER" &&
    warnings.length === 0 &&
    evidenceStatuses(ledger).some((status) => AMBER_STATUSES.has(status))) {
    warnings.push("critical_status_amber");
  }
  const usedAssets = asArray(ledger.used_assets);
  const records = asArray(ledger.records || ledger.rights_ledger);
  if (!usedAssets.length) blockers.push("rights_used_asset_inventory_empty");
  if (!records.length) blockers.push("rights_records_empty");

  const recordGroups = new Map();
  for (const record of records) {
    const assetId = clean(record.asset_id || record.id);
    if (!assetId) {
      blockers.push("rights_record_asset_id_missing");
      continue;
    }
    const group = recordGroups.get(assetId) || [];
    group.push(record);
    recordGroups.set(assetId, group);
  }

  for (const used of usedAssets) {
    const assetId = clean(used.asset_id || used.id);
    if (!assetId) {
      blockers.push("rights_used_asset_id_missing");
      continue;
    }
    const matches = recordGroups.get(assetId) || [];
    if (matches.length !== 1) {
      blockers.push(matches.length
        ? `rights_record_duplicate:${assetId}`
        : `rights_record_missing:${assetId}`);
      continue;
    }
    const record = matches[0];
    const fields = requiredRightsFields(record);
    for (const field of [
      "kind",
      "path",
      "asset_sha256",
      "source_url",
      "source_type",
      "source_owner",
      "licence_basis",
      "allowed_use",
      "approval_status",
      "evidence_file",
    ]) {
      if (!fields[field]) blockers.push(`rights_record_field_missing:${assetId}:${field}`);
    }
    if (!Number.isFinite(fields.asset_size_bytes) || fields.asset_size_bytes <= 0) {
      blockers.push(`rights_record_field_missing:${assetId}:asset_size_bytes`);
    }
    if (fields.approval_status &&
      !AFFIRMATIVE_RIGHTS_APPROVAL_RE.test(normaliseStatus(fields.approval_status))) {
      blockers.push(`rights_record_approval_not_affirmative:${assetId}`);
    }
    if (fields.commercial_use_allowed !== true) {
      blockers.push(`rights_record_commercial_use_not_allowed:${assetId}`);
    }
    if (typeof fields.credit_required !== "boolean") {
      blockers.push(`rights_record_credit_requirement_missing:${assetId}`);
    }
    if (fields.evidence_file) {
      const evidencePath = resolveLocalPath(fields.evidence_file, artifactDir);
      try {
        const evidenceStat = evidencePath ? await fs.stat(evidencePath) : null;
        if (!evidenceStat?.isFile() || evidenceStat.size <= 0) {
          blockers.push(`rights_record_evidence_unreadable:${assetId}`);
        } else {
          await fs.readFile(evidencePath);
        }
      } catch {
        blockers.push(`rights_record_evidence_unreadable:${assetId}`);
      }
    }
    for (const platform of ENABLED_PLATFORMS) {
      if (!fields.allowed_platforms.includes(platform)) {
        blockers.push(`rights_record_platform_missing:${assetId}:${platform}`);
      }
    }

    const usedPath = resolveLocalPath(used.path, artifactDir);
    const recordPath = resolveLocalPath(fields.path, artifactDir);
    if (!usedPath || !recordPath || usedPath !== recordPath) {
      blockers.push(`rights_record_path_mismatch:${assetId}`);
      continue;
    }
    try {
      const actual = await fingerprintFile(usedPath);
      const usedSha = normaliseSha256(used.asset_sha256 || used.sha256);
      const usedSize = Number(used.asset_size_bytes || used.size_bytes);
      if (!usedSha || usedSha !== actual.sha256) {
        blockers.push(`rights_used_asset_hash_mismatch:${assetId}`);
      }
      if (!Number.isFinite(usedSize) || usedSize !== actual.size_bytes) {
        blockers.push(`rights_used_asset_size_mismatch:${assetId}`);
      }
      if (fields.asset_sha256 !== actual.sha256) {
        blockers.push(`rights_record_hash_mismatch:${assetId}`);
      }
      if (fields.asset_size_bytes !== actual.size_bytes) {
        blockers.push(`rights_record_size_mismatch:${assetId}`);
      }
    } catch {
      blockers.push(`rights_used_asset_unreadable:${assetId}`);
    }
  }

  if (records.length !== usedAssets.length) blockers.push("rights_used_asset_coverage_incomplete");
  return {
    verdict: blockers.length ? "RED" : warnings.length ? "AMBER" : "GREEN",
    blockers: unique(blockers),
    warnings: unique(warnings),
    used_asset_count: usedAssets.length,
    record_count: records.length,
  };
}

function checkDeclaredHash(blockers, label, declared, actual) {
  const hash = normaliseSha256(declared);
  if (!hash) blockers.push(`${label}_hash_missing`);
  else if (!actual || hash !== actual.sha256) blockers.push(`${label}_hash_mismatch`);
}

function finalReviewBlockers(review = {}, actualRender) {
  const blockers = [];
  if (classifyEvidence(review) === "RED") blockers.push("independent_final_av_review_not_green");
  if (review.reviewer?.independent !== true || !clean(review.reviewer?.id)) {
    blockers.push("independent_final_av_reviewer_missing");
  }
  if (!clean(review.signoff) || !review.reviewed_at || !review.signed_at) {
    blockers.push("independent_final_av_signoff_missing");
  }
  for (const attestation of [
    "full_watch",
    "full_listen",
    "av_sync",
    "caption_readability",
    "subject_match",
  ]) {
    if (review.attestations?.[attestation] !== true) {
      blockers.push(`independent_final_av_attestation_missing:${attestation}`);
    }
  }
  if (!Array.isArray(review.defects)) blockers.push("independent_final_av_defects_unrecorded");
  else if (review.defects.some((defect) => {
    const severity = normaliseStatus(defect?.severity || defect?.level);
    return severity === "CRITICAL" || severity === "HIGH";
  })) blockers.push("independent_final_av_critical_defect");
  checkDeclaredHash(
    blockers,
    "independent_final_av_render",
    review.reviewed_artefact_fingerprints?.final_mp4 ||
      review.contact_sheet_binding?.final_mp4_sha256,
    actualRender,
  );
  if (review.publish_ready !== true || review.can_auto_publish !== true) {
    blockers.push("independent_final_av_not_publish_ready");
  }
  return unique(blockers);
}

async function inspectCandidateEvidence({
  artifactDir,
  storyId,
  probeMedia = defaultProbeMedia,
}) {
  const evidenceFiles = {
    render_manifest: "render_manifest.json",
    audio_manifest: "audio_manifest.json",
    narration_manifest: "narration_manifest.json",
    caption_manifest: "caption_manifest.json",
    decoded_forensic_report: "decoded_forensic_report.json",
    temporal_video_qa_report: "temporal_video_qa_report.json",
    final_av_review: "final_av_review.json",
    rights_ledger: "rights_ledger.json",
  };
  const evidence = {};
  for (const [key, fileName] of Object.entries(evidenceFiles)) {
    evidence[key] = await readJsonEvidence(path.join(artifactDir, fileName));
  }
  const blockers = [];
  const warnings = [];
  for (const [key, item] of Object.entries(evidence)) {
    if (!item.present) blockers.push(`${key}_missing`);
    else if (!item.valid) blockers.push(`${key}_unreadable`);
  }

  const renderManifest = evidence.render_manifest.value || {};
  const audioManifest = evidence.audio_manifest.value || {};
  const narrationManifest = evidence.narration_manifest.value || {};
  const captionManifest = evidence.caption_manifest.value || {};
  const decodedForensic = evidence.decoded_forensic_report.value || {};
  const temporalVideoQa = evidence.temporal_video_qa_report.value || {};
  const finalAvReview = evidence.final_av_review.value || {};
  for (const [key, document] of [
    ["render", renderManifest],
    ["audio", audioManifest],
    ["narration", narrationManifest],
    ["captions", captionManifest],
    ["decoded_forensic", decodedForensic],
    ["temporal_video_qa", temporalVideoQa],
    ["final_av_review", finalAvReview],
  ]) {
    if (hasExplicitEvidenceSignal(document)) {
      const classification = classifyEvidence(document);
      if (classification === "RED") blockers.push(`${key}_critical_status_red`);
      else if (classification === "AMBER" &&
        evidenceWarnings(document).length === 0 &&
        evidenceStatuses(document).some((status) => AMBER_STATUSES.has(status))) {
        warnings.push(`${key}:critical_status_amber`);
      }
    }
    warnings.push(...evidenceWarnings(document).map((warning) => `${key}:${warning}`));
  }

  for (const [key, document] of Object.entries(evidence)) {
    if (document.valid && clean(document.value?.story_id) &&
      clean(document.value.story_id) !== storyId) {
      blockers.push(`${key}_story_id_mismatch`);
    }
  }

  const criticalPaths = {
    render: resolveLocalPath(
      renderManifest.output_path || renderManifest.output || "visual_v4_render.mp4",
      artifactDir,
    ),
    audio: resolveLocalPath(
      audioManifest.resolved_narration_audio_path || audioManifest.narration_audio_path,
      artifactDir,
    ),
    timestamps: resolveLocalPath(
      audioManifest.resolved_word_timestamps_path || audioManifest.word_timestamps_path,
      artifactDir,
    ),
    rights: path.join(artifactDir, "rights_ledger.json"),
    temporal_qa_report: path.join(artifactDir, "temporal_video_qa_report.json"),
  };
  criticalPaths.caption_timestamps = resolveLocalPath(
    captionManifest.resolved_word_timestamps_path ||
      captionManifest.word_timestamps_path,
    artifactDir,
  ) || criticalPaths.timestamps;
  const fingerprints = {};
  for (const [key, filePath] of Object.entries(criticalPaths)) {
    if (!filePath || !(await fs.pathExists(filePath))) {
      blockers.push(`${key}_file_missing`);
      fingerprints[key] = { path: filePath || null, sha256: null, size_bytes: 0 };
      continue;
    }
    try {
      fingerprints[key] = await fingerprintFile(filePath);
      if (fingerprints[key].size_bytes <= 0) blockers.push(`${key}_file_empty`);
    } catch {
      blockers.push(`${key}_file_unreadable`);
      fingerprints[key] = { path: filePath, sha256: null, size_bytes: 0 };
    }
  }

  if (fingerprints.render?.sha256) {
    const probe = await probeMedia(criticalPaths.render, { kind: "render" });
    if (probe?.decodable !== true) blockers.push("render_file_not_decodable");
  }
  const temporalVideoQaValidation = validateTemporalVideoQaReport(
    temporalVideoQa,
    {
      storyId,
      renderSha256: fingerprints.render?.sha256 || "",
      renderSizeBytes: fingerprints.render?.size_bytes ?? null,
    },
  );
  blockers.push(...temporalVideoQaValidation.blockers);
  warnings.push(...temporalVideoQaValidation.warnings);
  if (fingerprints.audio?.sha256) {
    const probe = await probeMedia(criticalPaths.audio, { kind: "audio" });
    if (probe?.decodable !== true) blockers.push("audio_file_not_decodable");
  }
  for (const timestampKey of ["timestamps", "caption_timestamps"]) {
    if (!fingerprints[timestampKey]?.sha256) continue;
    try {
      const timestampDocument = await fs.readJson(criticalPaths[timestampKey]);
      const rows = Array.isArray(timestampDocument)
        ? timestampDocument
        : asArray(
          timestampDocument.words ||
          timestampDocument.timestamps ||
          timestampDocument.word_timestamps,
        );
      if (!rows.length || rows.some((row) => (
        !clean(row?.word || row?.text) ||
        !Number.isFinite(Number(row?.start ?? row?.start_time ?? row?.start_s)) ||
        !Number.isFinite(Number(row?.end ?? row?.end_time ?? row?.end_s))
      ))) {
        blockers.push(`${timestampKey}_file_invalid`);
      }
    } catch {
      blockers.push(`${timestampKey}_file_unreadable`);
    }
  }
  if (renderManifest.final_publish_render !== true) blockers.push("render_not_final_publish");
  if (classifyEvidence({ verdict: renderManifest.quality_gate_status }) === "RED") {
    blockers.push("render_quality_gate_not_green");
  }
  checkDeclaredHash(
    blockers,
    "decoded_forensic_render",
    decodedForensic.final_media?.sha256,
    fingerprints.render,
  );
  if (decodedForensic.decoded !== true || decodedForensic.full_duration_decoded !== true ||
    decodedForensic.publish_ready !== true || decodedForensic.can_auto_publish !== true ||
    classifyEvidence(decodedForensic) === "RED") {
    blockers.push("decoded_forensic_not_green");
  }
  blockers.push(...finalReviewBlockers(finalAvReview, fingerprints.render));

  checkDeclaredHash(
    blockers,
    "audio_manifest_audio",
    audioManifest.narration_audio_sha256,
    fingerprints.audio,
  );
  checkDeclaredHash(
    blockers,
    "render_input_audio",
    renderManifest.input_fingerprint?.audio_sha256,
    fingerprints.audio,
  );
  checkDeclaredHash(
    blockers,
    "narration_audio",
    narrationManifest.audio_sha256,
    fingerprints.audio,
  );
  if (classifyEvidence(narrationManifest) === "RED") blockers.push("narration_not_green");

  checkDeclaredHash(
    blockers,
    "audio_manifest_timestamps",
    audioManifest.word_timestamps_sha256,
    fingerprints.timestamps,
  );
  checkDeclaredHash(
    blockers,
    "render_input_timestamps",
    renderManifest.input_fingerprint?.word_timestamps_sha256,
    fingerprints.timestamps,
  );
  checkDeclaredHash(
    blockers,
    "caption_timestamps",
    captionManifest.word_timestamps_sha256 ||
      captionManifest.lineage?.frozen_word_timestamps_sha256,
    fingerprints.caption_timestamps,
  );
  if (classifyEvidence(captionManifest) === "RED") blockers.push("captions_not_green");

  const rights = await inspectRightsLedger({
    artifactDir,
    storyId,
    rightsEvidence: evidence.rights_ledger,
  });
  blockers.push(...rights.blockers);
  warnings.push(...rights.warnings.map((warning) => `rights:${warning}`));

  const uniqueBlockers = unique(blockers);
  const uniqueWarnings = unique(warnings);
  return {
    verdict: uniqueBlockers.length ? "RED" : uniqueWarnings.length ? "AMBER" : "GREEN",
    can_auto_publish: !uniqueBlockers.length && !uniqueWarnings.length,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    fingerprints,
    critical_paths: criticalPaths,
    temporal_video_qa: temporalVideoQaValidation,
    rights,
  };
}

function authorityDocuments({ current, storyId, generatedAt, inspection }) {
  const verdict = inspection.verdict;
  const canAutoPublish = verdict === "GREEN";
  const blockers = verdict === "RED" ? inspection.blockers : [];
  const reasonCodes = verdict === "RED"
    ? inspection.blockers
    : verdict === "AMBER"
      ? inspection.warnings
      : [];
  const authorityRefresh = {
    schema_version: 1,
    refreshed_at: generatedAt,
    source: "current_independently_verified_artifact_evidence",
    frozen_hashes: inspection.fingerprints,
    monotonic_verdict: true,
  };
  const refreshAuthorityState = (value, { publishStatus = false } = {}) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const next = {
      ...value,
      verdict,
      can_auto_publish: canAutoPublish,
      blockers,
      reason_codes: reasonCodes,
      warnings: inspection.warnings,
    };
    for (const field of ["status", "final_verdict", "result", "quality_gate_status"]) {
      if (Object.prototype.hasOwnProperty.call(value, field)) next[field] = verdict;
    }
    for (const field of [
      "hard_blockers",
      "failures",
      "errors",
      "rejection_reasons",
    ]) {
      if (Object.prototype.hasOwnProperty.call(value, field)) next[field] = blockers;
    }
    if (Object.prototype.hasOwnProperty.call(value, "advisories")) {
      next.advisories = inspection.warnings;
    }
    if (publishStatus || Object.prototype.hasOwnProperty.call(value, "publish_status")) {
      next.publish_status = verdict;
    }
    return next;
  };
  const currentSummary = current.goal_package_summary || {};
  const currentPlatform = current.platform_publish_manifest || {};
  const currentVerdict = current.publish_verdict || {};
  return {
    goal_package_summary: {
      ...refreshAuthorityState(currentSummary),
      story_id: storyId,
      authority_refresh: authorityRefresh,
      ...(currentSummary.publish_verdict
        ? { publish_verdict: refreshAuthorityState(currentSummary.publish_verdict) }
        : {}),
      ...(currentSummary.package_verdict
        ? { package_verdict: refreshAuthorityState(currentSummary.package_verdict) }
        : {}),
      ...(currentSummary.control_tower
        ? { control_tower: refreshAuthorityState(currentSummary.control_tower) }
        : {}),
      ...(currentSummary.readiness
        ? { readiness: refreshAuthorityState(currentSummary.readiness) }
        : {}),
    },
    platform_publish_manifest: {
      ...refreshAuthorityState(currentPlatform, { publishStatus: true }),
      story_id: storyId,
      authority_refresh: authorityRefresh,
    },
    publish_verdict: {
      ...refreshAuthorityState(currentVerdict),
      story_id: storyId,
      authority_refresh: authorityRefresh,
      ...(currentVerdict.package_quality_gate
        ? { package_quality_gate: refreshAuthorityState(currentVerdict.package_quality_gate) }
        : {}),
    },
  };
}

function storyIdFromAggregateRow(row = {}) {
  return clean(row.story_id || row.id);
}

function aggregateAuthorityStory({
  row = {},
  storyId,
  inspection,
  proposed,
} = {}) {
  const verdict = inspection.verdict;
  const blockers = verdict === "RED" ? inspection.blockers : [];
  const reasonCodes = verdict === "RED"
    ? inspection.blockers
    : verdict === "AMBER"
      ? inspection.warnings
      : [];
  const next = {
    ...row,
    story_id: clean(row.story_id) || storyId,
    verdict,
    can_auto_publish: verdict === "GREEN",
    blockers,
    reason_codes: reasonCodes,
    warnings: inspection.warnings,
    authority_refresh: proposed.goal_package_summary.authority_refresh,
  };
  for (const field of ["status", "final_verdict", "result", "quality_gate_status"]) {
    if (Object.prototype.hasOwnProperty.call(row, field)) next[field] = verdict;
  }
  for (const field of ["hard_blockers", "failures", "errors", "rejection_reasons"]) {
    if (Object.prototype.hasOwnProperty.call(row, field)) next[field] = blockers;
  }
  if (Object.prototype.hasOwnProperty.call(row, "advisories")) {
    next.advisories = inspection.warnings;
  }
  if (Object.prototype.hasOwnProperty.call(row, "publish_status")) {
    next.publish_status = verdict;
  }
  if (row.publish_verdict && typeof row.publish_verdict === "object") {
    next.publish_verdict = proposed.publish_verdict;
  }
  if (row.goal_package_summary && typeof row.goal_package_summary === "object") {
    next.goal_package_summary = proposed.goal_package_summary;
  }
  if (row.platform_publish_manifest && typeof row.platform_publish_manifest === "object") {
    next.platform_publish_manifest = proposed.platform_publish_manifest;
  }
  return next;
}

async function inspectAggregateTargets(aggregatePaths = [], storyId = "") {
  const targets = [];
  const blockers = [];
  for (const aggregatePath of unique(aggregatePaths)) {
    const resolved = path.resolve(aggregatePath);
    if (!(await fs.pathExists(resolved))) {
      blockers.push(`authority_aggregate_missing:${resolved}`);
      continue;
    }
    let rows;
    try {
      rows = await fs.readJson(resolved);
    } catch {
      blockers.push(`authority_aggregate_unreadable:${resolved}`);
      continue;
    }
    if (!Array.isArray(rows)) {
      blockers.push(`authority_aggregate_not_array:${resolved}`);
      continue;
    }
    const matchingIndexes = [];
    rows.forEach((row, index) => {
      if (storyIdFromAggregateRow(row) === storyId) matchingIndexes.push(index);
    });
    if (matchingIndexes.length !== 1) {
      blockers.push(
        matchingIndexes.length
          ? `authority_aggregate_story_duplicate:${resolved}:${storyId}`
          : `authority_aggregate_story_missing:${resolved}:${storyId}`,
      );
      continue;
    }
    targets.push({
      path: resolved,
      rows,
      matched_index: matchingIndexes[0],
      matched_count: matchingIndexes.length,
    });
  }
  return {
    targets,
    blockers: unique(blockers),
  };
}

function buildAggregateUpdates({
  aggregateTargets = [],
  storyId,
  inspection,
  proposed,
} = {}) {
  return aggregateTargets.map((target) => {
    const proposedRows = target.rows.map((row, index) => (
      index === target.matched_index
        ? aggregateAuthorityStory({ row, storyId, inspection, proposed })
        : row
    ));
    return {
      path: target.path,
      matched_count: target.matched_count,
      matched_index: target.matched_index,
      proposed_story: proposedRows[target.matched_index],
      proposed_rows: proposedRows,
    };
  });
}

async function readAuthorityDocuments(artifactDir) {
  const current = {};
  for (const fileName of AUTHORITY_FILES) {
    const key = fileName.replace(/\.json$/, "");
    const item = await readJsonEvidence(path.join(artifactDir, fileName));
    current[key] = item.valid ? item.value : {};
  }
  return current;
}

async function fingerprintCriticalPaths(criticalPaths) {
  const output = {};
  for (const [key, filePath] of Object.entries(criticalPaths)) {
    if (!filePath || !(await fs.pathExists(filePath))) {
      output[key] = { path: filePath || null, sha256: null, size_bytes: 0 };
      continue;
    }
    try {
      output[key] = await fingerprintFile(filePath);
    } catch {
      output[key] = { path: filePath, sha256: null, size_bytes: 0 };
    }
  }
  return output;
}

function serialiseJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function transactionTempPath(filePath, purpose) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.candidate-authority-refresh.${purpose}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
}

function fingerprintsEqual(left, right) {
  const keys = unique([
    ...Object.keys(left || {}),
    ...Object.keys(right || {}),
  ]);
  for (const key of keys) {
    if (clean(left?.[key]?.path) !== clean(right?.[key]?.path) ||
      clean(left?.[key]?.sha256) !== clean(right?.[key]?.sha256) ||
      Number(left?.[key]?.size_bytes || 0) !== Number(right?.[key]?.size_bytes || 0)) {
      return false;
    }
  }
  return true;
}

async function restoreAuthorityFile(filePath, original, mode) {
  const tempPath = transactionTempPath(filePath, "rollback");
  try {
    await fs.writeFile(tempPath, original, { flag: "wx", mode: mode & 0o777 });
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, mode & 0o777).catch(() => {});
  } finally {
    await fs.remove(tempPath).catch(() => {});
  }
}

async function applyAuthorityTransaction({
  artifactDir,
  generatedAt,
  proposed,
  aggregateUpdates = [],
  criticalPaths,
  frozenBefore,
}) {
  const stamp = generatedAt.replace(/[^0-9]/g, "") || Date.now().toString();
  const backupDir = path.join(
    artifactDir,
    ".candidate-authority-refresh-backups",
    `${stamp}-${crypto.randomUUID()}`,
  );
  const entries = [];
  const committed = [];
  await fs.ensureDir(backupDir);
  try {
    const writeSpecs = [
      ...AUTHORITY_FILES.map((fileName) => ({
        fileName,
        backupName: fileName,
        filePath: path.join(artifactDir, fileName),
        value: proposed[fileName.replace(/\.json$/, "")],
      })),
      ...aggregateUpdates.map((update, index) => ({
        fileName: path.basename(update.path),
        backupName: `aggregate-${index + 1}-${path.basename(update.path)}`,
        filePath: update.path,
        value: update.proposed_rows,
      })),
    ];
    for (const spec of writeSpecs) {
      const {
        fileName,
        backupName,
        filePath,
        value,
      } = spec;
      const existed = await fs.pathExists(filePath);
      const stat = existed ? await fs.stat(filePath) : null;
      const original = existed ? await fs.readFile(filePath) : null;
      const backupPath = existed ? path.join(backupDir, backupName) : null;
      const nextTempPath = transactionTempPath(filePath, "next");
      const mode = stat ? stat.mode & 0o777 : 0o666;
      if (existed) {
        const backupTempPath = transactionTempPath(backupPath, "backup");
        try {
          await fs.writeFile(backupTempPath, original, { flag: "wx", mode });
          await fs.rename(backupTempPath, backupPath);
        } finally {
          await fs.remove(backupTempPath).catch(() => {});
        }
      }
      await fs.writeFile(nextTempPath, serialiseJson(value), {
        flag: "wx",
        mode,
      });
      entries.push({
        file_name: fileName,
        path: filePath,
        backup_path: backupPath,
        original,
        mode,
        existed,
        next_temp_path: nextTempPath,
      });
    }

    const immediatelyBeforeCommit = await fingerprintCriticalPaths(criticalPaths);
    if (!fingerprintsEqual(frozenBefore, immediatelyBeforeCommit)) {
      const error = new Error("Critical evidence changed before authority commit");
      error.code = "CRITICAL_EVIDENCE_CHANGED";
      throw error;
    }

    for (const entry of entries) {
      await fs.rename(entry.next_temp_path, entry.path);
      entry.next_temp_path = null;
      committed.push(entry);
    }

    const after = await fingerprintCriticalPaths(criticalPaths);
    if (!fingerprintsEqual(frozenBefore, after)) {
      const error = new Error("Critical evidence changed during authority commit");
      error.code = "CRITICAL_EVIDENCE_CHANGED";
      throw error;
    }
    return {
      applied: true,
      changed_files: entries.map((entry) => entry.path),
      backups: entries
        .filter((entry) => entry.backup_path)
        .map((entry) => ({
          path: entry.path,
          backup_path: entry.backup_path,
        })),
      backup_dir: backupDir,
      after,
    };
  } catch (cause) {
    const rollbackErrors = [];
    for (const entry of committed.reverse()) {
      try {
        if (entry.existed) await restoreAuthorityFile(entry.path, entry.original, entry.mode);
        else await fs.remove(entry.path);
      } catch (error) {
        rollbackErrors.push({ path: entry.path, error: clean(error.message) });
      }
    }
    const error = new Error(`Candidate authority refresh transaction failed: ${clean(cause.message)}`);
    error.code = clean(cause.code) || "AUTHORITY_REFRESH_TRANSACTION_FAILED";
    error.cause = cause;
    error.rollback_errors = rollbackErrors;
    error.backup_dir = backupDir;
    throw error;
  } finally {
    for (const entry of entries) {
      if (entry.next_temp_path) await fs.remove(entry.next_temp_path).catch(() => {});
    }
  }
}

async function refreshCandidateAuthority({
  artifactDir,
  storyId,
  aggregatePaths = [],
  apply = false,
  generatedAt = new Date().toISOString(),
  probeMedia = defaultProbeMedia,
} = {}) {
  const resolvedArtifactDir = path.resolve(clean(artifactDir));
  const resolvedStoryId = clean(storyId);
  if (!artifactDir) throw new Error("artifactDir is required");
  if (!resolvedStoryId) throw new Error("storyId is required");
  if (!(await fs.pathExists(resolvedArtifactDir))) throw new Error(`Artifact directory not found: ${resolvedArtifactDir}`);

  let inspection = await inspectCandidateEvidence({
    artifactDir: resolvedArtifactDir,
    storyId: resolvedStoryId,
    probeMedia,
  });
  const aggregateInspection = await inspectAggregateTargets(
    aggregatePaths,
    resolvedStoryId,
  );
  if (aggregateInspection.blockers.length) {
    inspection = {
      ...inspection,
      verdict: "RED",
      can_auto_publish: false,
      blockers: unique([
        ...inspection.blockers,
        ...aggregateInspection.blockers,
      ]),
    };
  }
  const current = await readAuthorityDocuments(resolvedArtifactDir);
  let proposed = authorityDocuments({
    current,
    storyId: resolvedStoryId,
    generatedAt,
    inspection,
  });
  let aggregateUpdates = buildAggregateUpdates({
    aggregateTargets: aggregateInspection.targets,
    storyId: resolvedStoryId,
    inspection,
    proposed,
  });
  let after = await fingerprintCriticalPaths(inspection.critical_paths);
  const report = {
    schema_version: 1,
    story_id: resolvedStoryId,
    generated_at: generatedAt,
    mode: apply ? "APPLY" : "DRY_RUN",
    applied: false,
    verdict: inspection.verdict,
    can_auto_publish: inspection.can_auto_publish,
    blockers: inspection.blockers,
    warnings: inspection.warnings,
    frozen_hashes: {
      before: inspection.fingerprints,
      after,
      preserved: fingerprintsEqual(inspection.fingerprints, after),
    },
    critical_paths: inspection.critical_paths,
    temporal_video_qa: inspection.temporal_video_qa,
    rights: inspection.rights,
    proposed,
    aggregate_updates: aggregateUpdates.map((update) => ({
      path: update.path,
      matched_count: update.matched_count,
      matched_index: update.matched_index,
      proposed_story: update.proposed_story,
    })),
    changed_files: [],
    backups: [],
    backup_dir: null,
    safety: {
      publishes: false,
      mutates_database: false,
      mutates_oauth_or_tokens: false,
      authority_and_declared_aggregate_files_only: true,
    },
  };
  if (!report.frozen_hashes.preserved) {
    report.verdict = "RED";
    report.can_auto_publish = false;
    report.blockers = unique([...report.blockers, "critical_evidence_changed_during_refresh"]);
    proposed = authorityDocuments({
      current,
      storyId: resolvedStoryId,
      generatedAt,
      inspection: {
        ...inspection,
        verdict: "RED",
        can_auto_publish: false,
        blockers: report.blockers,
      },
    });
    report.proposed = proposed;
    aggregateUpdates = buildAggregateUpdates({
      aggregateTargets: aggregateInspection.targets,
      storyId: resolvedStoryId,
      inspection: {
        ...inspection,
        verdict: "RED",
        can_auto_publish: false,
        blockers: report.blockers,
      },
      proposed,
    });
    report.aggregate_updates = aggregateUpdates.map((update) => ({
      path: update.path,
      matched_count: update.matched_count,
      matched_index: update.matched_index,
      proposed_story: update.proposed_story,
    }));
  }
  if (apply) {
    if (aggregateInspection.blockers.length) {
      const error = new Error(
        `Authority aggregate validation failed: ${aggregateInspection.blockers.join(", ")}`,
      );
      error.code = "AUTHORITY_AGGREGATE_INVALID";
      throw error;
    }
    if (!report.frozen_hashes.preserved) {
      const error = new Error("Critical evidence changed before apply");
      error.code = "CRITICAL_EVIDENCE_CHANGED";
      throw error;
    }
    const transaction = await applyAuthorityTransaction({
      artifactDir: resolvedArtifactDir,
      generatedAt,
      proposed,
      aggregateUpdates,
      criticalPaths: inspection.critical_paths,
      frozenBefore: inspection.fingerprints,
    });
    after = transaction.after;
    report.applied = true;
    report.changed_files = transaction.changed_files;
    report.backups = transaction.backups;
    report.backup_dir = transaction.backup_dir;
    report.frozen_hashes.after = after;
    report.frozen_hashes.preserved = fingerprintsEqual(inspection.fingerprints, after);
  }
  return report;
}

module.exports = {
  AUTHORITY_FILES,
  ENABLED_PLATFORMS,
  defaultProbeMedia,
  inspectCandidateEvidence,
  refreshCandidateAuthority,
};
