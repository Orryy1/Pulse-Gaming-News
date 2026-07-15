"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const REQUIRED_CHECKS = Object.freeze([
  "audio",
  "video",
  "captions",
  "av_sync",
  "freeze",
  "black",
  "blur",
  "repetition",
]);

async function fingerprintFile(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
  };
}

function frameTime(frame = {}) {
  const value = Number(frame.time_seconds);
  return Number.isFinite(value) ? value : null;
}

function normaliseSha256(value) {
  return String(value || "").trim().replace(/^sha256:/i, "").toLowerCase();
}

function isStrictSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || "").trim());
}

function hasDeclaredIssues(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function findNotCheckedFields(value, prefix = "", seen = new WeakSet()) {
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "not_checked" ? [prefix] : [];
  }
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const fields = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    fields.push(...findNotCheckedFields(child, childPath, seen));
  }
  return fields;
}

function probeHasStream(probe = {}, type) {
  if (!probe || typeof probe !== "object") return false;
  if (
    Array.isArray(probe.streams) &&
    probe.streams.some((stream) => String(stream?.codec_type || "").toLowerCase() === type)
  ) {
    return true;
  }
  return probe[`${type}_stream_count`] > 0 || probe[`has_${type}`] === true;
}

function timelineCoverage(frames = [], durationSeconds = 0) {
  const times = frames.map(frameTime).filter((value) => value !== null).sort((a, b) => a - b);
  const durationValid = Number.isFinite(durationSeconds) && durationSeconds > 0;
  const boundaryTolerance = durationValid ? Math.max(0.5, durationSeconds * 0.05) : 0;
  const maxAllowedGapSeconds = durationValid ? durationSeconds / 3 : 0;
  let maxGapSeconds = null;
  if (times.length > 1) {
    maxGapSeconds = Math.max(...times.slice(1).map((value, index) => value - times[index]));
  }
  const timestampsValid =
    times.length === frames.length &&
    times.every((value) => value >= 0 && value <= durationSeconds + 0.25);
  return {
    covered:
      durationValid &&
      timestampsValid &&
      times.length >= 4 &&
      times[0] <= boundaryTolerance &&
      times[times.length - 1] >= durationSeconds - boundaryTolerance &&
      maxGapSeconds <= maxAllowedGapSeconds + 0.25,
    first_sample_seconds: times[0] ?? null,
    last_sample_seconds: times[times.length - 1] ?? null,
    duration_seconds: durationSeconds,
    sample_count: times.length,
    max_gap_seconds: maxGapSeconds,
    max_allowed_gap_seconds: maxAllowedGapSeconds || null,
  };
}

function emptyTimelineCoverage(durationSeconds = null) {
  return {
    covered: false,
    first_sample_seconds: null,
    last_sample_seconds: null,
    duration_seconds: durationSeconds,
    sample_count: 0,
    max_gap_seconds: null,
    max_allowed_gap_seconds: null,
  };
}

function failedValidation({
  blocker,
  filePath = null,
  exists = false,
  fingerprint = null,
  probe = null,
  probeError = null,
  decodeError = null,
}) {
  const probedDuration = Number(probe?.duration_seconds);
  return {
    schema_version: 1,
    verdict: "fail",
    valid: false,
    blockers: [blocker],
    final_media: {
      path: filePath,
      exists,
      sha256: fingerprint?.sha256 || null,
      size_bytes: fingerprint?.size_bytes ?? null,
    },
    decode_evidence: {
      probe,
      decode: null,
      ...(probeError ? { probe_error: String(probeError?.message || probeError) } : {}),
      ...(decodeError ? { decode_error: String(decodeError?.message || decodeError) } : {}),
    },
    report_binding: {
      bound_to_current_mp4: false,
      reported_sha256: null,
      reported_size_bytes: null,
    },
    fingerprint_stability: {
      stable: false,
      before: fingerprint,
      after: null,
    },
    frame_hash_verification: {
      performed: false,
      checked: false,
      verified: false,
      mismatch_indices: [],
    },
    critical_defects: null,
    not_checked_fields: [],
    timeline_coverage: emptyTimelineCoverage(
      Number.isFinite(probedDuration) && probedDuration > 0 ? probedDuration : null,
    ),
  };
}

/**
 * Validate one final MP4 against a decoded forensic report. The injected
 * probe and decoder must inspect the supplied current file and return the
 * explicit evidence consumed below. An optional frame verifier independently
 * extracts the reported sample times and returns strict SHA-256 values; no
 * top-level pass label is trusted.
 */
async function validateFinalMediaForensics({
  finalMp4Path,
  forensicReport = {},
  probeMedia,
  decodeMedia,
  verifySampledFrameHashes,
} = {}) {
  if (typeof finalMp4Path !== "string" || !finalMp4Path.trim()) {
    return failedValidation({ blocker: "final_mp4_path_missing" });
  }
  const resolvedPath = path.resolve(finalMp4Path);
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) throw Object.assign(new Error("not a file"), { code: "ENOTFILE" });
  } catch (error) {
    const blocker = error?.code === "ENOENT" ? "final_mp4_missing" : "final_mp4_unusable";
    return failedValidation({ blocker, filePath: resolvedPath });
  }
  const fingerprint = await fingerprintFile(resolvedPath);
  let probe;
  try {
    if (typeof probeMedia !== "function") throw new TypeError("probeMedia is required");
    probe = await probeMedia(resolvedPath);
  } catch (error) {
    return failedValidation({
      blocker: "final_mp4_probe_failed",
      filePath: resolvedPath,
      exists: true,
      fingerprint,
      probeError: error,
    });
  }
  let decode;
  try {
    if (typeof decodeMedia !== "function") throw new TypeError("decodeMedia is required");
    decode = await decodeMedia(resolvedPath);
  } catch (error) {
    return failedValidation({
      blocker: "final_mp4_decode_failed",
      filePath: resolvedPath,
      exists: true,
      fingerprint,
      probe,
      decodeError: error,
    });
  }
  const sampledFrames = Array.isArray(forensicReport?.sampled_frames)
    ? forensicReport.sampled_frames
    : [];
  const expectedSampledFrames = sampledFrames.map((frame) => ({
    time_seconds: frame?.time_seconds,
    hash: frame?.hash,
  }));
  let frameHashVerification = {
    performed: false,
    checked: false,
    verified: null,
    mismatch_indices: [],
  };
  if (typeof verifySampledFrameHashes === "function") {
    try {
      const verification = await verifySampledFrameHashes({
        finalMp4Path: resolvedPath,
        sampledFrames: sampledFrames.map((frame) => ({ ...frame })),
      });
      const extractedFrames = Array.isArray(verification?.sampled_frames)
        ? verification.sampled_frames
        : [];
      const mismatchIndices = expectedSampledFrames.flatMap((frame, index) => {
        const extracted = extractedFrames[index];
        const expectedTime = frameTime(frame);
        const extractedTime = frameTime(extracted);
        const expectedHash = String(frame?.hash || "").trim().toLowerCase();
        const extractedHash = String(extracted?.sha256 || "").trim().toLowerCase();
        const matches =
          expectedTime !== null &&
          extractedTime !== null &&
          Math.abs(expectedTime - extractedTime) <= 0.001 &&
          isStrictSha256(extractedHash) &&
          extractedHash === expectedHash;
        return matches ? [] : [index];
      });
      const checked = verification?.checked === true;
      const verified =
        checked &&
        extractedFrames.length === expectedSampledFrames.length &&
        mismatchIndices.length === 0;
      frameHashVerification = {
        performed: true,
        checked,
        verified,
        mismatch_indices: mismatchIndices,
        expected_count: expectedSampledFrames.length,
        extracted_count: extractedFrames.length,
      };
    } catch (error) {
      frameHashVerification = {
        performed: true,
        checked: false,
        verified: false,
        mismatch_indices: [],
        error: String(error?.message || error),
      };
    }
  }
  let postDecodeFingerprint = null;
  let postDecodeFingerprintError = null;
  try {
    postDecodeFingerprint = await fingerprintFile(resolvedPath);
  } catch (error) {
    postDecodeFingerprintError = error;
  }
  const fingerprintStable =
    postDecodeFingerprint !== null &&
    postDecodeFingerprint.sha256 === fingerprint.sha256 &&
    postDecodeFingerprint.size_bytes === fingerprint.size_bytes;
  const currentFingerprint = postDecodeFingerprint || fingerprint;
  const blockers = [];
  const reportVerdict = String(forensicReport?.verdict || "").trim().toLowerCase();
  const reportStatus = String(forensicReport?.status || "").trim().toLowerCase();
  const hasSubstantiveEvidence =
    forensicReport?.final_media &&
    forensicReport?.checks &&
    Array.isArray(forensicReport?.sampled_frames) &&
    Array.isArray(forensicReport?.critical_defects);
  if (reportVerdict === "pass" && !hasSubstantiveEvidence) {
    blockers.push("forensic_report_bare_pass");
  }
  if (reportVerdict !== "pass") blockers.push("forensic_report_verdict_not_pass");
  if (reportStatus && !["pass", "green"].includes(reportStatus)) {
    blockers.push("forensic_report_status_not_pass");
  }
  for (const field of ["blockers", "failures", "errors"]) {
    if (hasDeclaredIssues(forensicReport?.[field])) {
      blockers.push(`forensic_report_${field}_present`);
    }
  }
  if (!probeHasStream(probe, "audio")) blockers.push("probe_audio_stream_missing");
  if (!probeHasStream(probe, "video")) blockers.push("probe_video_stream_missing");
  if (decode?.fully_decoded !== true) blockers.push("final_mp4_full_decode_failed");
  if (decode?.audio_checked !== true) blockers.push("decoded_audio_not_checked");
  if (decode?.video_checked !== true) blockers.push("decoded_video_not_checked");
  if (!Array.isArray(decode?.errors)) blockers.push("final_mp4_decode_errors_not_reported");
  else if (decode.errors.length > 0) blockers.push("final_mp4_decode_errors_present");
  if (postDecodeFingerprintError) blockers.push("final_mp4_post_decode_fingerprint_failed");
  else if (!fingerprintStable) blockers.push("final_mp4_changed_during_validation");
  if (frameHashVerification.performed && !frameHashVerification.verified) {
    blockers.push("sampled_frame_hash_verification_failed");
  }
  const probedDuration = Number(probe?.duration_seconds);
  const decodedDuration = Number(decode?.decoded_duration_seconds);
  if (
    !Number.isFinite(probedDuration) ||
    probedDuration <= 0 ||
    !Number.isFinite(decodedDuration) ||
    decodedDuration + 0.25 < probedDuration
  ) {
    blockers.push("final_mp4_decode_duration_incomplete");
  }
  const reportedHash = normaliseSha256(forensicReport?.final_media?.sha256);
  const reportedSize = Number(forensicReport?.final_media?.size_bytes);
  if (!reportedHash) blockers.push("forensic_report_mp4_hash_missing");
  else if (reportedHash !== currentFingerprint.sha256) {
    blockers.push("forensic_report_mp4_hash_mismatch");
  }
  if (!Number.isFinite(reportedSize) || reportedSize <= 0) {
    blockers.push("forensic_report_mp4_size_missing");
  } else if (reportedSize !== currentFingerprint.size_bytes) {
    blockers.push("forensic_report_mp4_size_mismatch");
  }
  for (const checkName of REQUIRED_CHECKS) {
    const check = forensicReport?.checks?.[checkName];
    if (check?.checked !== true) blockers.push(`forensic_${checkName}_not_checked`);
    const verdict = String(check?.verdict || "")
      .trim()
      .toLowerCase();
    if (verdict !== "pass") blockers.push(`forensic_${checkName}_not_pass`);
  }
  if (!sampledFrames.length) blockers.push("sampled_frames_missing");
  if (
    sampledFrames.some((frame) => {
      const hash = String(frame?.hash || "").trim().toLowerCase();
      return !hash || hash === "null" || hash === "not_checked";
    })
  ) {
    blockers.push("sampled_frame_hash_missing");
  }
  if (
    sampledFrames.some((frame) => {
      const hash = String(frame?.hash || "").trim();
      return hash && hash.toLowerCase() !== "null" && hash.toLowerCase() !== "not_checked" &&
        !isStrictSha256(hash);
    })
  ) {
    blockers.push("sampled_frame_hash_invalid");
  }
  const criticalDefects = forensicReport?.critical_defects;
  if (!Array.isArray(criticalDefects)) blockers.push("critical_defects_missing");
  else if (criticalDefects.length > 0) blockers.push("critical_defects_present");
  const notCheckedFields = findNotCheckedFields(forensicReport);
  if (notCheckedFields.length) blockers.push("production_not_checked_fields_present");
  const coverage = timelineCoverage(
    sampledFrames,
    probedDuration,
  );
  if (!coverage.covered) blockers.push("sampled_frames_timeline_not_covered");

  return {
    schema_version: 1,
    verdict: blockers.length ? "fail" : "pass",
    valid: blockers.length === 0,
    blockers,
    final_media: {
      path: resolvedPath,
      exists: true,
      ...currentFingerprint,
    },
    decode_evidence: {
      probe,
      decode,
    },
    report_binding: {
      bound_to_current_mp4:
        fingerprintStable &&
        reportedHash === currentFingerprint.sha256 &&
        reportedSize === currentFingerprint.size_bytes,
      reported_sha256: reportedHash || null,
      reported_size_bytes: Number.isFinite(reportedSize) ? reportedSize : null,
    },
    fingerprint_stability: {
      stable: fingerprintStable,
      before: fingerprint,
      after: postDecodeFingerprint,
      ...(postDecodeFingerprintError
        ? { error: String(postDecodeFingerprintError?.message || postDecodeFingerprintError) }
        : {}),
    },
    frame_hash_verification: frameHashVerification,
    critical_defects: Array.isArray(criticalDefects) ? criticalDefects : null,
    not_checked_fields: notCheckedFields,
    timeline_coverage: coverage,
  };
}

module.exports = {
  REQUIRED_CHECKS,
  validateFinalMediaForensics,
};
