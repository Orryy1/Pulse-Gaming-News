"use strict";

const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { promisify } = require("node:util");
const fs = require("fs-extra");
const sharp = require("sharp");
const {
  fingerprintFile,
  fingerprintValidationBlockers,
  normaliseFingerprint,
} = require("./human-review-artefact-fingerprints");
const { validateFinalMediaForensics } = require("./goal-final-media-forensics");

const execFileAsync = promisify(execFile);

const FINAL_AV_REVIEW_SCHEMA_VERSION = 1;
const FINAL_AV_REVIEW_ARTEFACT_KEYS = Object.freeze([
  "final_mp4",
  "contact_sheet",
  "decoded_forensic_report",
]);
const FINAL_AV_REVIEW_ATTESTATION_KEYS = Object.freeze([
  "full_watch",
  "full_listen",
  "av_sync",
  "caption_readability",
  "subject_match",
]);
const DEFAULT_TRUSTED_FINAL_AV_REVIEWER_IDS = Object.freeze([
  "independent-av-reviewer",
  "independent-final-av-reviewer",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanPath(value) {
  return String(value || "").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasReportedIssues(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return Boolean(clean(value));
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return value === true;
}

function reviewerTrustEvidence(review = {}, trustedReviewerIds) {
  const configured = trustedReviewerIds !== undefined;
  const values = configured ? trustedReviewerIds : DEFAULT_TRUSTED_FINAL_AV_REVIEWER_IDS;
  const ids = values instanceof Set ? [...values] : Array.isArray(values) ? values : [];
  const reviewerId = clean(review?.reviewer?.id);
  return {
    trusted: Boolean(reviewerId && ids.some((value) => clean(value) === reviewerId)),
    source: configured ? "configured_allowlist" : "registered_default_allowlist",
  };
}

function hasParentTraversal(value) {
  return cleanPath(value).split(/[\\/]+/).includes("..");
}

function realpathSync(filePath) {
  return typeof fs.realpathSync.native === "function"
    ? fs.realpathSync.native(filePath)
    : fs.realpathSync(filePath);
}

function canonicalStoryArtifactDir(artifactDir) {
  const declared = cleanPath(artifactDir);
  if (!declared) return { valid: false, path: "" };
  const resolved = path.resolve(declared);
  try {
    if (!fs.statSync(resolved).isDirectory()) throw new Error("not a directory");
    return { valid: true, path: realpathSync(resolved) };
  } catch {
    return { valid: false, path: "" };
  }
}

function pathIsWithin(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function deniedPath(reason, blocker = "") {
  return {
    allowed: false,
    path: "",
    reason,
    blockers: blocker ? [blocker] : [],
  };
}

function scopeDeclaredPath(artifactDir, value, blockerForReason) {
  const declared = cleanPath(value);
  if (!declared) return { allowed: true, path: "", reason: null, blockers: [] };
  if (hasParentTraversal(declared)) {
    return deniedPath("parent_traversal", blockerForReason("parent_traversal"));
  }
  if (!artifactDir) {
    return deniedPath("story_artifact_dir_invalid");
  }
  const resolved = path.isAbsolute(declared)
    ? path.resolve(declared)
    : path.resolve(artifactDir, declared);
  if (!pathIsWithin(resolved, artifactDir)) {
    return deniedPath("outside_story_dir", blockerForReason("outside_story_dir"));
  }
  if (!fs.existsSync(resolved)) {
    return { allowed: true, path: resolved, reason: null, blockers: [] };
  }
  try {
    const canonicalPath = realpathSync(resolved);
    if (!pathIsWithin(canonicalPath, artifactDir)) {
      return deniedPath("symlink_escape", blockerForReason("symlink_escape"));
    }
    return { allowed: true, path: canonicalPath, reason: null, blockers: [] };
  } catch {
    return deniedPath("realpath_failed", blockerForReason("realpath_failed"));
  }
}

function scopeDeclaredArtefactPath(artifactDir, value, key) {
  const blockers = {
    parent_traversal: `final_av_review_artefact_path_traversal:${key}`,
    outside_story_dir: `final_av_review_artefact_path_outside_story_dir:${key}`,
    symlink_escape: `final_av_review_artefact_symlink_escape:${key}`,
    realpath_failed: `final_av_review_artefact_realpath_failed:${key}`,
  };
  return scopeDeclaredPath(artifactDir, value, (reason) => blockers[reason]);
}

function scopeDeclaredReviewPath(artifactDir, value) {
  const blockers = {
    parent_traversal: "final_av_review_path_traversal",
    outside_story_dir: "final_av_review_path_outside_story_dir",
    symlink_escape: "final_av_review_path_symlink_escape",
    realpath_failed: "final_av_review_path_realpath_failed",
  };
  return scopeDeclaredPath(artifactDir, value, (reason) => blockers[reason]);
}

function normaliseComparablePath(value) {
  const target = cleanPath(value);
  return target ? path.resolve(target).replace(/\\/g, "/").toLowerCase() : "";
}

function validReviewTimestamp(value) {
  return typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value));
}

function strictSchemaBlockers(review = {}, expectedStoryId = "") {
  if (!isPlainObject(review)) return ["final_av_review_schema_invalid:object"];
  const blockers = [];
  if (review.schema_version !== FINAL_AV_REVIEW_SCHEMA_VERSION) {
    blockers.push("final_av_review_schema_version_invalid");
  }
  if (!clean(review.story_id)) blockers.push("final_av_review_story_id_missing");
  else if (clean(expectedStoryId) && clean(review.story_id) !== clean(expectedStoryId)) {
    blockers.push("final_av_review_story_id_mismatch");
  }
  if (!validReviewTimestamp(review.reviewed_at)) {
    blockers.push("final_av_review_reviewed_at_invalid");
  }

  if (!isPlainObject(review.reviewer)) {
    blockers.push("final_av_review_reviewer_invalid");
  } else {
    if (!clean(review.reviewer.id)) blockers.push("final_av_review_reviewer_id_missing");
    if (review.reviewer.independent !== true) {
      blockers.push("final_av_review_reviewer_not_independent");
    }
  }

  if (!isPlainObject(review.artefacts)) {
    blockers.push("final_av_review_artefacts_invalid");
  } else {
    for (const key of FINAL_AV_REVIEW_ARTEFACT_KEYS) {
      if (typeof review.artefacts[key] !== "string" || !clean(review.artefacts[key])) {
        blockers.push(`required_artefact_missing:${key}`);
      }
    }
  }

  if (!isPlainObject(review.reviewed_artefact_fingerprints)) {
    blockers.push("final_av_review_fingerprints_invalid");
  } else {
    for (const key of FINAL_AV_REVIEW_ARTEFACT_KEYS) {
      const fingerprint = normaliseFingerprint(review.reviewed_artefact_fingerprints[key]);
      if (!/^sha256:[a-f0-9]{64}$/.test(fingerprint)) {
        blockers.push(`final_av_review_fingerprint_invalid:${key}`);
      }
    }
  }

  if (!isPlainObject(review.contact_sheet_binding)) {
    blockers.push("final_av_review_contact_sheet_binding_invalid");
  }

  if (!isPlainObject(review.attestations)) {
    blockers.push("final_av_review_attestations_invalid");
  }
  for (const key of FINAL_AV_REVIEW_ATTESTATION_KEYS) {
    if (!isPlainObject(review.attestations) || review.attestations[key] !== true) {
      blockers.push(`final_av_review_attestation_not_true:${key}`);
    }
  }

  if (!Array.isArray(review.defects)) blockers.push("final_av_review_defects_invalid");
  else {
    review.defects.forEach((defect, index) => {
      if (
        !isPlainObject(defect) ||
        typeof defect.severity !== "string" ||
        !clean(defect.severity) ||
        typeof defect.code !== "string" ||
        !clean(defect.code)
      ) {
        blockers.push(`final_av_review_defect_invalid:${index}`);
      }
    });
  }
  if (typeof review.verdict !== "string" || clean(review.verdict).toUpperCase() !== "GREEN") {
    blockers.push("final_av_review_verdict_not_green");
  }
  const status = clean(review.status).toUpperCase();
  if (!["GREEN", "APPROVED", "COMPLETE", "COMPLETED", "PASS"].includes(status)) {
    blockers.push("final_av_review_status_not_approved");
  }
  if (["RED", "AMBER"].includes(status)) {
    blockers.push("final_av_review_status_not_green");
  }
  if (clean(review.final_verdict).toUpperCase() !== "GREEN") {
    blockers.push("final_av_review_final_verdict_not_green");
  }

  if (!validReviewTimestamp(review.signed_at)) {
    blockers.push("final_av_review_signed_at_invalid");
  }
  if (!isPlainObject(review.signoff)) {
    blockers.push("final_av_review_signoff_invalid");
  } else {
    const reviewerId = clean(review.reviewer && review.reviewer.id);
    const signoffReviewerId = clean(review.signoff.reviewer_id);
    if (!signoffReviewerId) blockers.push("final_av_review_signoff_reviewer_id_missing");
    else if (signoffReviewerId !== reviewerId) {
      blockers.push("final_av_review_signoff_reviewer_id_mismatch");
    }
    if (!validReviewTimestamp(review.signoff.signed_at)) {
      blockers.push("final_av_review_signoff_signed_at_invalid");
    } else if (clean(review.signoff.signed_at) !== clean(review.signed_at)) {
      blockers.push("final_av_review_signoff_signed_at_mismatch");
    }
  }

  const canPublishConsistent = !Object.prototype.hasOwnProperty.call(review, "can_publish") ||
    review.can_publish === true;
  if (
    review.publish_ready !== true ||
    review.can_auto_publish !== true ||
    !canPublishConsistent
  ) {
    blockers.push("final_av_review_publish_not_approved");
  }
  for (const field of ["blockers", "failures", "errors"]) {
    if (hasReportedIssues(review[field])) {
      blockers.push(`final_av_review_${field}_present`);
    }
  }
  return unique(blockers);
}

function hasCriticalDefect(review = {}) {
  if (review.critical_defect === true) return true;
  if (hasReportedIssues(review.critical_defects)) return true;
  return Array.isArray(review.defects) && review.defects.some((defect) => {
    if (!isPlainObject(defect)) return false;
    const severity = clean(defect.severity || defect.level).toLowerCase();
    return defect.critical === true || defect.blocks_publish === true || severity === "critical" || severity === "fatal";
  });
}

function hasBlockingDefect(review = {}) {
  if (hasCriticalDefect(review)) return true;
  return Array.isArray(review.defects) && review.defects.some((defect) => {
    if (!isPlainObject(defect)) return false;
    return clean(defect.severity || defect.level).toLowerCase() === "high";
  });
}

function fileStartsWith(filePath, signature, offset = 0) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < offset + signature.length) return false;
    return buffer.subarray(offset, offset + signature.length).equals(signature);
  } catch {
    return false;
  }
}

function safeFingerprintFile(filePath) {
  try {
    return { ...fingerprintFile(filePath), readable: true };
  } catch {
    return {
      path: cleanPath(filePath),
      exists: Boolean(cleanPath(filePath) && fs.existsSync(filePath)),
      readable: false,
      sha256: "",
      size_bytes: 0,
    };
  }
}

function reviewedFingerprintBlockers(artefacts = {}, reviewedFingerprints = {}) {
  const blockers = [];
  for (const key of FINAL_AV_REVIEW_ARTEFACT_KEYS) {
    try {
      blockers.push(...fingerprintValidationBlockers({
        artefacts,
        reviewedFingerprints,
        keys: [key],
      }));
    } catch {
      blockers.push(`required_artefact_file_unreadable:${key}`);
    }
  }
  return unique(blockers);
}

function fingerprintMatches(declared, current) {
  const declaredHash = normaliseFingerprint(declared);
  const currentHash = normaliseFingerprint(current);
  return (
    /^sha256:[a-f0-9]{64}$/.test(declaredHash) &&
    /^sha256:[a-f0-9]{64}$/.test(currentHash) &&
    declaredHash === currentHash
  );
}

function sampledFrameBindingsMatch(declaredFrames, reportedFrames) {
  if (
    !Array.isArray(declaredFrames) ||
    !Array.isArray(reportedFrames) ||
    declaredFrames.length < 4 ||
    declaredFrames.length !== reportedFrames.length
  ) {
    return false;
  }
  return declaredFrames.every((declared, index) => {
    const reported = reportedFrames[index];
    const declaredTime = Number(declared?.time_seconds);
    const reportedTime = Number(reported?.time_seconds);
    return (
      Number.isFinite(declaredTime) &&
      Number.isFinite(reportedTime) &&
      Math.abs(declaredTime - reportedTime) <= 0.001 &&
      fingerprintMatches(declared?.hash, reported?.hash)
    );
  });
}

function validMp4(filePath) {
  return path.extname(filePath).toLowerCase() === ".mp4" && fileStartsWith(
    filePath,
    Buffer.from("ftyp", "ascii"),
    4,
  );
}

function validContactSheet(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) return false;
  return (
    fileStartsWith(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
    fileStartsWith(filePath, Buffer.from([0xff, 0xd8, 0xff])) ||
    (
      fileStartsWith(filePath, Buffer.from("RIFF", "ascii")) &&
      fileStartsWith(filePath, Buffer.from("WEBP", "ascii"), 8)
    )
  );
}

async function inspectContactSheetImage(filePath) {
  try {
    const image = sharp(filePath, {
      failOn: "error",
      limitInputPixels: 100_000_000,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const expectedBytes = Number(info.width) * Number(info.height) * Number(info.channels);
    const fullyDecoded =
      data.length > 0 &&
      Number.isFinite(expectedBytes) &&
      expectedBytes > 0 &&
      data.length === expectedBytes;
    return {
      fully_decoded: fullyDecoded,
      format: clean(metadata.format).toLowerCase() || null,
      width: Number(info.width) || null,
      height: Number(info.height) || null,
      channels: Number(info.channels) || null,
      size_bytes: data.length,
      pages: Number(metadata.pages) || 1,
    };
  } catch {
    return {
      fully_decoded: false,
      format: null,
      width: null,
      height: null,
      channels: null,
      size_bytes: 0,
      pages: null,
    };
  }
}

function durationFromProgress(output = "") {
  const lines = String(output).split(/\r?\n/);
  const outTime = lines
    .filter((line) => line.startsWith("out_time="))
    .map((line) => line.slice("out_time=".length))
    .filter(Boolean)
    .at(-1);
  if (outTime) {
    const match = outTime.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (match) {
      return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
    }
  }
  const outTimeUs = lines
    .filter((line) => line.startsWith("out_time_us="))
    .map((line) => Number(line.slice("out_time_us=".length)))
    .filter(Number.isFinite)
    .at(-1);
  return Number.isFinite(outTimeUs) ? outTimeUs / 1_000_000 : null;
}

async function defaultProbeMedia(filePath, {
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  timeoutMs = 30_000,
} = {}) {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,duration",
    "-of", "json",
    filePath,
  ], {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  const metadata = JSON.parse(stdout || "{}");
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const streamDurations = streams
    .map((stream) => Number(stream?.duration))
    .filter((value) => Number.isFinite(value) && value > 0);
  const formatDuration = Number(metadata.format?.duration);
  return {
    duration_seconds: Number.isFinite(formatDuration) && formatDuration > 0
      ? formatDuration
      : Math.max(0, ...streamDurations),
    streams,
  };
}

async function defaultDecodeMedia(filePath, {
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  timeoutMs = 300_000,
} = {}) {
  const nullSink = process.platform === "win32" ? "NUL" : "/dev/null";
  const { stdout, stderr } = await execFileAsync(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-i", filePath,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-progress", "pipe:1",
    "-f", "null",
    nullSink,
  ], {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const errors = clean(stderr) ? String(stderr).split(/\r?\n/).filter(Boolean) : [];
  return {
    fully_decoded: true,
    decoded_duration_seconds: durationFromProgress(stdout),
    audio_checked: true,
    video_checked: true,
    errors,
  };
}

async function verifySampledFrameHashesWithFfmpeg({
  finalMp4Path,
  sampledFrames = [],
} = {}, {
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  timeoutMs = 30_000,
  execFileImpl = execFileAsync,
} = {}) {
  if (!cleanPath(finalMp4Path)) throw new TypeError("finalMp4Path is required");
  if (!Array.isArray(sampledFrames) || sampledFrames.length === 0) {
    return { checked: false, sampled_frames: [] };
  }
  const extracted = [];
  for (const frame of sampledFrames) {
    const timeSeconds = Number(frame?.time_seconds);
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      throw new TypeError("sampled frame time must be a non-negative number");
    }
    const attemptTimes = unique([
      String(timeSeconds),
      String(Number(Math.max(0, timeSeconds - 0.05).toFixed(6))),
    ]);
    let pixels = Buffer.alloc(0);
    for (const attemptTime of attemptTimes) {
      const { stdout } = await execFileImpl(ffmpegPath, [
        "-hide_banner",
        "-nostdin",
        "-v", "error",
        "-xerror",
        "-i", finalMp4Path,
        "-ss", attemptTime,
        "-map", "0:v:0",
        "-frames:v", "1",
        "-an",
        "-sn",
        "-dn",
        "-threads", "1",
        "-pix_fmt", "rgba",
        "-f", "rawvideo",
        "pipe:1",
      ], {
        encoding: null,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 128 * 1024 * 1024,
      });
      pixels = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || "");
      if (pixels.length > 0) break;
    }
    if (pixels.length === 0) throw new Error(`sampled frame extraction empty at ${timeSeconds}s`);
    extracted.push({
      time_seconds: timeSeconds,
      sha256: crypto.createHash("sha256").update(pixels).digest("hex"),
    });
  }
  return { checked: true, sampled_frames: extracted };
}

async function inspectDecodedForensicReport({
  filePath,
  expectedStoryId = "",
  finalMp4Path = "",
  probeMedia,
  decodeMedia,
  verifySampledFrameHashes,
} = {}) {
  try {
    const report = fs.readJsonSync(filePath);
    if (!isPlainObject(report)) return { valid: false, story_id_matches: false };
    const reportStoryId = clean(report.story_id);
    const storyIdMatches = !reportStoryId || !clean(expectedStoryId) || reportStoryId === clean(expectedStoryId);
    const validation = await validateFinalMediaForensics({
      finalMp4Path,
      forensicReport: report,
      probeMedia,
      decodeMedia,
      verifySampledFrameHashes,
    });
    const blockers = storyIdMatches
      ? validation.blockers
      : unique([...(validation.blockers || []), "forensic_report_story_id_mismatch"]);
    return {
      ...validation,
      valid: storyIdMatches && validation.valid === true,
      verdict: storyIdMatches ? validation.verdict : "fail",
      blockers,
      story_id_matches: storyIdMatches,
      binding_evidence: {
        sampled_frames: Array.isArray(report.sampled_frames)
          ? report.sampled_frames.map((frame) => ({
            time_seconds: frame?.time_seconds,
            hash: frame?.hash,
          }))
          : [],
      },
    };
  } catch {
    return {
      valid: false,
      verdict: "fail",
      blockers: ["forensic_report_invalid_json"],
      story_id_matches: false,
    };
  }
}

function baseResult(blockers = [], evidence = {}) {
  const rows = unique(blockers);
  return {
    schema_version: FINAL_AV_REVIEW_SCHEMA_VERSION,
    valid: rows.length === 0,
    status: rows.length === 0 ? "pass" : "fail",
    verdict: rows.length === 0 ? "GREEN" : "RED",
    can_auto_publish: rows.length === 0,
    blockers: rows,
    warnings: [],
    requirement:
      "A current final MP4, bound contact sheet and decoded forensic report must pass a trusted independent review with no high or critical defect.",
    evidence,
  };
}

async function validateFinalAvReview(review = {}, {
  storyId = "",
  artifactDir = "",
  finalMp4Path = "",
  reviewPath = "",
  reviewPathScope = null,
  probeMedia,
  decodeMedia,
  verifySampledFrameHashes,
  inspectContactSheet,
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  probeTimeoutMs = 30_000,
  decodeTimeoutMs = 300_000,
  frameHashTimeoutMs = 30_000,
  frameHashExecFile = execFileAsync,
  trustedReviewerIds,
} = {}) {
  const blockers = strictSchemaBlockers(review, storyId);
  const storyArtifactDir = canonicalStoryArtifactDir(artifactDir);
  if (!storyArtifactDir.valid) blockers.push("final_av_review_story_artifact_dir_invalid");
  const reviewerTrust = reviewerTrustEvidence(review, trustedReviewerIds);
  if (clean(review?.reviewer?.id) && !reviewerTrust.trusted) {
    blockers.push("final_av_review_reviewer_not_trusted");
  }
  const declaredArtefacts = isPlainObject(review.artefacts) ? review.artefacts : {};
  const artefactPathScope = Object.fromEntries(
    FINAL_AV_REVIEW_ARTEFACT_KEYS.map((key) => [
      key,
      scopeDeclaredArtefactPath(storyArtifactDir.path, declaredArtefacts[key], key),
    ]),
  );
  for (const scope of Object.values(artefactPathScope)) blockers.push(...scope.blockers);
  const artefacts = Object.fromEntries(
    FINAL_AV_REVIEW_ARTEFACT_KEYS.map((key) => [
      key,
      artefactPathScope[key].path,
    ]),
  );
  const reviewedFingerprints = isPlainObject(review.reviewed_artefact_fingerprints)
    ? review.reviewed_artefact_fingerprints
    : {};
  const fingerprintBlockers = reviewedFingerprintBlockers(artefacts, reviewedFingerprints);
  blockers.push(...fingerprintBlockers);

  const finalMp4Fingerprint = safeFingerprintFile(artefacts.final_mp4);
  const contactSheetFingerprint = safeFingerprintFile(artefacts.contact_sheet);
  const forensicFingerprint = safeFingerprintFile(artefacts.decoded_forensic_report);
  const declaredContactSheetBinding = isPlainObject(review.contact_sheet_binding)
    ? review.contact_sheet_binding
    : {};
  const contactSheetHashBindingMatches = fingerprintMatches(
    declaredContactSheetBinding.contact_sheet_sha256,
    contactSheetFingerprint.sha256,
  );
  const contactSheetMp4BindingMatches = fingerprintMatches(
    declaredContactSheetBinding.final_mp4_sha256,
    finalMp4Fingerprint.sha256,
  );
  const contactSheetForensicReportBindingMatches = fingerprintMatches(
    declaredContactSheetBinding.decoded_forensic_report_sha256,
    forensicFingerprint.sha256,
  );
  if (!contactSheetHashBindingMatches) {
    blockers.push("final_av_review_contact_sheet_hash_binding_mismatch");
  }
  if (!contactSheetMp4BindingMatches) {
    blockers.push("final_av_review_contact_sheet_mp4_binding_mismatch");
  }
  if (!contactSheetForensicReportBindingMatches) {
    blockers.push("final_av_review_contact_sheet_forensic_report_binding_mismatch");
  }
  const currentRenderPathScope = scopeDeclaredArtefactPath(
    storyArtifactDir.path,
    finalMp4Path,
    "current_render",
  );
  blockers.push(...currentRenderPathScope.blockers);
  const expectedFinalMp4 = currentRenderPathScope.path;
  const finalMp4Declared = Boolean(cleanPath(finalMp4Path));
  const finalMp4Matches = !finalMp4Declared || (
    currentRenderPathScope.allowed &&
    normaliseComparablePath(artefacts.final_mp4) === normaliseComparablePath(expectedFinalMp4)
  );
  if (artefacts.final_mp4 && finalMp4Declared && !finalMp4Matches) {
    blockers.push("final_av_review_final_mp4_not_current_render");
  }
  const mp4Valid = !finalMp4Fingerprint.exists || validMp4(artefacts.final_mp4);
  if (finalMp4Fingerprint.exists && !mp4Valid) {
    blockers.push("final_av_review_final_mp4_invalid");
  }
  const contactSheetValid = !contactSheetFingerprint.exists || validContactSheet(artefacts.contact_sheet);
  if (contactSheetFingerprint.exists && !contactSheetValid) {
    blockers.push("final_av_review_contact_sheet_invalid");
  }
  const decodedContactSheetInspection = contactSheetFingerprint.exists && contactSheetValid
    ? await (typeof inspectContactSheet === "function"
      ? inspectContactSheet(artefacts.contact_sheet)
      : inspectContactSheetImage(artefacts.contact_sheet))
    : { fully_decoded: false };
  const contactSheetDimensionsValid =
    decodedContactSheetInspection?.fully_decoded === true &&
    Number(decodedContactSheetInspection.width) >= 128 &&
    Number(decodedContactSheetInspection.height) >= 128 &&
    Number(decodedContactSheetInspection.width) * Number(decodedContactSheetInspection.height) >= 57_600 &&
    Number(decodedContactSheetInspection.pages || 1) === 1;
  const contactSheetInspection = {
    ...decodedContactSheetInspection,
    dimensions_valid: contactSheetDimensionsValid,
  };
  if (
    contactSheetFingerprint.exists &&
    contactSheetValid &&
    contactSheetInspection?.fully_decoded !== true
  ) {
    blockers.push("final_av_review_contact_sheet_decode_failed");
  }
  if (contactSheetInspection.fully_decoded === true && !contactSheetDimensionsValid) {
    blockers.push("final_av_review_contact_sheet_dimensions_invalid");
  }
  const resolvedProbeMedia = typeof probeMedia === "function"
    ? probeMedia
    : (filePath) => defaultProbeMedia(filePath, {
      ffprobePath,
      timeoutMs: probeTimeoutMs,
    });
  const resolvedDecodeMedia = typeof decodeMedia === "function"
    ? decodeMedia
    : (filePath) => defaultDecodeMedia(filePath, {
      ffmpegPath,
      timeoutMs: decodeTimeoutMs,
    });
  const resolvedFrameHashVerifier = typeof verifySampledFrameHashes === "function"
    ? verifySampledFrameHashes
    : (request) => verifySampledFrameHashesWithFfmpeg(request, {
      ffmpegPath,
      timeoutMs: frameHashTimeoutMs,
      execFileImpl: frameHashExecFile,
    });
  const forensicInspection = forensicFingerprint.exists
    ? await inspectDecodedForensicReport({
      filePath: artefacts.decoded_forensic_report,
      expectedStoryId: storyId,
      finalMp4Path: expectedFinalMp4 || artefacts.final_mp4,
      probeMedia: resolvedProbeMedia,
      decodeMedia: resolvedDecodeMedia,
      verifySampledFrameHashes: resolvedFrameHashVerifier,
    })
    : { valid: false, story_id_matches: false, decoded: false, critical_defect_count: 0 };
  if (forensicFingerprint.exists && !forensicInspection.valid) {
    blockers.push("final_av_review_decoded_forensic_report_invalid");
  }
  const contactSheetSampledFramesBindingMatches = sampledFrameBindingsMatch(
    declaredContactSheetBinding.sampled_frames,
    forensicInspection.binding_evidence?.sampled_frames,
  );
  if (!contactSheetSampledFramesBindingMatches) {
    blockers.push("final_av_review_contact_sheet_sampled_frames_binding_mismatch");
  }
  const contactSheetBoundToCurrentMedia =
    contactSheetHashBindingMatches &&
    contactSheetMp4BindingMatches &&
    contactSheetForensicReportBindingMatches &&
    contactSheetSampledFramesBindingMatches &&
    contactSheetInspection.fully_decoded === true &&
    contactSheetInspection.dimensions_valid === true &&
    forensicInspection.report_binding?.bound_to_current_mp4 === true &&
    forensicInspection.frame_hash_verification?.verified === true;
  if (hasBlockingDefect(review)) blockers.push("final_av_review_blocking_defect");
  if (hasCriticalDefect(review)) blockers.push("final_av_review_critical_defect");

  const invalidFingerprintBlocker = blockers.some((blocker) =>
    blocker.startsWith("final_av_review_fingerprint_invalid:"),
  );
  return baseResult(blockers, {
    review_path: cleanPath(reviewPath) || null,
    review_path_scope: reviewPathScope,
    present: isPlainObject(review) && Object.keys(review).length > 0,
    schema_version: review && review.schema_version,
    story_id: clean(review && review.story_id) || null,
    expected_story_id: clean(storyId) || null,
    reviewed_at: clean(review && review.reviewed_at) || null,
    reviewer_id: clean(review && review.reviewer && review.reviewer.id) || null,
    reviewer_independent: review && review.reviewer && review.reviewer.independent === true,
    reviewer_trusted: reviewerTrust.trusted,
    reviewer_trust_source: reviewerTrust.source,
    attestations: isPlainObject(review.attestations) ? review.attestations : {},
    blocking_defect_present: hasBlockingDefect(review),
    critical_defect_present: hasCriticalDefect(review),
    canonical_story_artifact_dir: storyArtifactDir.path || null,
    artefact_path_scope: artefactPathScope,
    current_render_path_scope: currentRenderPathScope,
    artefacts: {
      final_mp4: finalMp4Fingerprint,
      contact_sheet: contactSheetFingerprint,
      decoded_forensic_report: forensicFingerprint,
    },
    final_mp4_matches_current_render: finalMp4Matches,
    final_mp4_valid: finalMp4Fingerprint.exists && mp4Valid,
    contact_sheet_valid: contactSheetFingerprint.exists && contactSheetValid,
    contact_sheet_inspection: contactSheetInspection,
    contact_sheet_binding: {
      present: isPlainObject(review.contact_sheet_binding),
      contact_sheet_sha256_matches: contactSheetHashBindingMatches,
      final_mp4_sha256_matches: contactSheetMp4BindingMatches,
      decoded_forensic_report_sha256_matches: contactSheetForensicReportBindingMatches,
      sampled_frames_match: contactSheetSampledFramesBindingMatches,
      independently_verified_frame_hashes:
        forensicInspection.frame_hash_verification?.verified === true,
      bound_to_current_media: contactSheetBoundToCurrentMedia,
    },
    decoded_forensic_report_valid: forensicFingerprint.exists && forensicInspection.valid,
    decoded_forensic_report: forensicInspection,
    fingerprint_blockers: fingerprintBlockers,
    fingerprints_verified: fingerprintBlockers.length === 0 && !invalidFingerprintBlocker,
  });
}

async function validateFinalAvReviewFile(reviewPath, options = {}) {
  const storyArtifactDir = canonicalStoryArtifactDir(options.artifactDir);
  if (!storyArtifactDir.valid) {
    return baseResult(["final_av_review_story_artifact_dir_invalid"], {
      review_path: null,
      review_path_scope: {
        allowed: false,
        path: "",
        reason: "story_artifact_dir_invalid",
        blockers: [],
      },
      present: false,
      expected_story_id: clean(options.storyId) || null,
    });
  }
  const reviewPathScope = scopeDeclaredReviewPath(storyArtifactDir.path, reviewPath);
  if (!reviewPathScope.allowed) {
    return baseResult(reviewPathScope.blockers, {
      review_path: null,
      review_path_scope: reviewPathScope,
      present: false,
      expected_story_id: clean(options.storyId) || null,
    });
  }
  const resolvedReviewPath = reviewPathScope.path;
  if (!resolvedReviewPath || !fs.existsSync(resolvedReviewPath)) {
    return baseResult(["final_av_review_missing"], {
      review_path: resolvedReviewPath || null,
      review_path_scope: reviewPathScope,
      present: false,
      expected_story_id: clean(options.storyId) || null,
    });
  }
  let review;
  try {
    review = fs.readJsonSync(resolvedReviewPath);
  } catch {
    return baseResult(["final_av_review_invalid_json"], {
      review_path: resolvedReviewPath,
      review_path_scope: reviewPathScope,
      present: true,
      expected_story_id: clean(options.storyId) || null,
    });
  }
  return await validateFinalAvReview(review, {
    ...options,
    reviewPath: resolvedReviewPath,
    reviewPathScope,
  });
}

module.exports = {
  DEFAULT_TRUSTED_FINAL_AV_REVIEWER_IDS,
  FINAL_AV_REVIEW_ARTEFACT_KEYS,
  FINAL_AV_REVIEW_ATTESTATION_KEYS,
  FINAL_AV_REVIEW_SCHEMA_VERSION,
  validateFinalAvReview,
  validateFinalAvReviewFile,
  inspectContactSheetImage,
  verifySampledFrameHashesWithFfmpeg,
};
