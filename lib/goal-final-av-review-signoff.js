"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  DEFAULT_TRUSTED_FINAL_AV_REVIEWER_IDS,
  validateFinalAvReviewFile,
} = require("./goal-final-av-review");

const REQUIRED_OBSERVATIONS = Object.freeze([
  "full_watch",
  "full_listen",
  "av_sync",
  "caption_readability",
  "subject_match",
  "no_freeze",
  "no_black",
  "no_blur",
  "no_repetition",
]);

const SEMANTIC_CHECK_OBSERVATIONS = Object.freeze({
  captions: "caption_readability",
  av_sync: "av_sync",
  freeze: "no_freeze",
  black: "no_black",
  blur: "no_blur",
  repetition: "no_repetition",
});

class FinalAvReviewSignoffError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FinalAvReviewSignoffError";
    this.code = code;
    this.details = details;
  }
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validIso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed);
}

function pathIsWithin(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertCleanApproval({
  reviewerId,
  reviewedAt,
  signedAt,
  observations,
  defects,
  operatorConfirmed,
  apply,
}) {
  if (apply !== true) {
    throw new FinalAvReviewSignoffError(
      "apply_required",
      "apply=true is required to write a final AV sign-off",
    );
  }
  if (operatorConfirmed !== true) {
    throw new FinalAvReviewSignoffError(
      "operator_confirmation_required",
      "explicit operator confirmation is required",
    );
  }
  if (!DEFAULT_TRUSTED_FINAL_AV_REVIEWER_IDS.includes(clean(reviewerId))) {
    throw new FinalAvReviewSignoffError(
      "reviewer_not_trusted",
      "reviewerId is not in the trusted final AV reviewer registry",
    );
  }
  if (!validIso(reviewedAt) || !validIso(signedAt)) {
    throw new FinalAvReviewSignoffError(
      "review_timestamp_invalid",
      "reviewedAt and signedAt must be valid ISO timestamps",
    );
  }
  if (Date.parse(signedAt) < Date.parse(reviewedAt)) {
    throw new FinalAvReviewSignoffError(
      "review_timestamp_order_invalid",
      "signedAt cannot be earlier than reviewedAt",
    );
  }
  const missing = REQUIRED_OBSERVATIONS.filter((key) => observations?.[key] !== true);
  if (missing.length) {
    throw new FinalAvReviewSignoffError(
      "observations_incomplete",
      `clean approval requires explicit true observations: ${missing.join(", ")}`,
      { missing },
    );
  }
  if (!Array.isArray(defects) || defects.length > 0) {
    throw new FinalAvReviewSignoffError(
      "clean_approval_defects_present",
      "clean approval requires an explicit empty defects array",
    );
  }
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

async function atomicWrite(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: "wx" });
    await fs.move(temporaryPath, filePath, { overwrite: true });
  } finally {
    await fs.remove(temporaryPath).catch(() => {});
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function signOffFinalAvReview({
  storyId,
  artifactDir,
  finalMp4Path,
  reviewerId,
  reviewedAt,
  signedAt,
  observations,
  defects,
  operatorConfirmed = false,
  apply = false,
} = {}) {
  assertCleanApproval({
    reviewerId,
    reviewedAt,
    signedAt,
    observations,
    defects,
    operatorConfirmed,
    apply,
  });

  const canonicalArtifactDir = await fs.realpath(path.resolve(artifactDir || ""));
  const canonicalFinalMp4Path = await fs.realpath(path.resolve(finalMp4Path || ""));
  if (!pathIsWithin(canonicalFinalMp4Path, canonicalArtifactDir)) {
    throw new FinalAvReviewSignoffError(
      "final_mp4_outside_story_dir",
      "finalMp4Path must resolve inside artifactDir",
    );
  }
  const reviewPath = path.join(canonicalArtifactDir, "final_av_review.json");
  const forensicPath = path.join(canonicalArtifactDir, "decoded_forensic_report.json");
  const [reviewBytes, forensicBytes] = await Promise.all([
    fs.readFile(reviewPath),
    fs.readFile(forensicPath),
  ]);
  const review = JSON.parse(reviewBytes.toString("utf8"));
  const forensic = JSON.parse(forensicBytes.toString("utf8"));
  const resolvedStoryId = clean(storyId) || clean(review.story_id);
  if (!resolvedStoryId || clean(review.story_id) !== resolvedStoryId) {
    throw new FinalAvReviewSignoffError(
      "story_id_mismatch",
      "storyId must match the pending final AV review",
    );
  }

  const reviewedBy = clean(reviewerId);
  for (const [checkName, observationName] of Object.entries(SEMANTIC_CHECK_OBSERVATIONS)) {
    if (!forensic.checks?.[checkName]) {
      throw new FinalAvReviewSignoffError(
        "semantic_check_missing",
        `decoded forensic report is missing ${checkName}`,
      );
    }
    Object.assign(forensic.checks[checkName], {
      checked: true,
      verdict: "pass",
      independent_review_required: false,
      reviewed_at: reviewedAt,
      reviewer_id: reviewedBy,
      observed_condition: observationName,
    });
  }
  forensic.status = "pass";
  forensic.verdict = "pass";
  forensic.publish_ready = true;
  forensic.can_auto_publish = true;
  forensic.independent_review_required = false;
  forensic.analysis_scope = {
    ...(forensic.analysis_scope || {}),
    semantic_av_acceptance: "INDEPENDENT_REVIEW_COMPLETE",
  };
  forensic.critical_defects = [];
  forensic.blockers = [];
  forensic.failures = [];
  forensic.errors = [];

  const nextForensicBytes = jsonBytes(forensic);
  await atomicWrite(forensicPath, nextForensicBytes);
  try {
    const forensicHash = await sha256(forensicPath);
    review.reviewed_at = reviewedAt;
    review.signed_at = signedAt;
    review.reviewer = {
      id: reviewedBy,
      independent: true,
    };
    review.signoff = {
      reviewer_id: reviewedBy,
      signed_at: signedAt,
    };
    review.status = "GREEN";
    review.verdict = "GREEN";
    review.final_verdict = "GREEN";
    review.publish_ready = true;
    review.can_auto_publish = true;
    review.attestations = {
      full_watch: true,
      full_listen: true,
      av_sync: true,
      caption_readability: true,
      subject_match: true,
    };
    review.defects = [];
    review.blockers = [];
    review.failures = [];
    review.errors = [];
    review.reviewed_artefact_fingerprints = {
      ...(review.reviewed_artefact_fingerprints || {}),
      decoded_forensic_report: forensicHash,
    };
    review.contact_sheet_binding = {
      ...(review.contact_sheet_binding || {}),
      decoded_forensic_report_sha256: forensicHash,
    };
    delete review.required_reviewer_actions;

    await atomicWrite(reviewPath, jsonBytes(review));
    const validation = await validateFinalAvReviewFile(reviewPath, {
      storyId: resolvedStoryId,
      artifactDir: canonicalArtifactDir,
      finalMp4Path: canonicalFinalMp4Path,
    });
    if (!validation.valid || validation.verdict !== "GREEN") {
      throw new FinalAvReviewSignoffError(
        "authoritative_validation_failed",
        `authoritative final AV validation failed: ${validation.blockers.join(", ")}`,
        { validation },
      );
    }
    return {
      schema_version: 1,
      story_id: resolvedStoryId,
      applied: true,
      verdict: validation.verdict,
      can_auto_publish: validation.can_auto_publish,
      reviewer_id: reviewedBy,
      reviewed_at: reviewedAt,
      signed_at: signedAt,
      paths: {
        final_av_review: reviewPath,
        decoded_forensic_report: forensicPath,
      },
      validation,
    };
  } catch (error) {
    await atomicWrite(forensicPath, forensicBytes);
    await atomicWrite(reviewPath, reviewBytes);
    throw error;
  }
}

module.exports = {
  FinalAvReviewSignoffError,
  REQUIRED_OBSERVATIONS,
  SEMANTIC_CHECK_OBSERVATIONS,
  signOffFinalAvReview,
};
