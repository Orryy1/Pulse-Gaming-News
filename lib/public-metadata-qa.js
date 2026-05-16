"use strict";

const { shouldRejectGeneralRedditForNews } = require("./community-discussion-gate");
const { runScriptCoherenceQa } = require("./script-coherence-qa");

const SCRIPT_VALIDATION_FAILURE_RE =
  /\b(?:script validation failed|script_validation_failed|manual review required before production|script_generation_review|review_required)\b/i;

class PublicMetadataQaError extends Error {
  constructor(surface, failures) {
    super(`Public metadata QA failed for ${surface || "unknown"}: ${failures.join(", ")}`);
    this.name = "PublicMetadataQaError";
    this.code = "public_metadata_qa_failed";
    this.surface = surface || "unknown";
    this.failures = failures;
  }
}

function cleanPublicScriptText(value) {
  return String(value || "")
    .replace(/\[PAUSE\]/gi, "")
    .replace(/\[VISUAL:[^\]]*\]/gi, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safePublicExcerpt(value, maxChars = 300) {
  const clean = cleanPublicScriptText(value);
  if (!clean) return "";

  const limit = Math.max(1, Number(maxChars) || 300);
  const cutoff = clean.substring(0, limit);
  let lastSentence = -1;
  const re = /[.!?]\s+(?=[A-Z0-9])/g;
  let match;
  while ((match = re.exec(cutoff)) !== null) lastSentence = match.index;

  if (lastSentence >= 25) return cutoff.substring(0, lastSentence + 1).trim();

  const lastSpace = cutoff.lastIndexOf(" ");
  if (lastSpace > 80) return cutoff.substring(0, lastSpace).trim();
  return cutoff.trim();
}

function collectPublicMetadataFailures(story = {}, { extraText = "" } = {}) {
  const failures = [];
  const status = String(story.script_generation_status || "");
  const reviewReason = String(story.script_review_reason || story.publish_error || "");
  const canonicalScript = story.full_script || story.tts_script || "";
  const publicText = [
    story.title,
    story.suggested_title,
    story.suggested_thumbnail_text,
    canonicalScript,
    extraText,
  ]
    .filter(Boolean)
    .join("\n");

  if (SCRIPT_VALIDATION_FAILURE_RE.test(`${status}\n${reviewReason}\n${publicText}`)) {
    failures.push("script_validation_review_required");
  }

  if (shouldRejectGeneralRedditForNews(story)) {
    failures.push("community_reddit_media_not_news");
  }

  const coherence = runScriptCoherenceQa(
    {
      ...story,
      full_script: canonicalScript,
      tts_script: "",
      cta: "",
    },
    {
      requireCtaField: false,
      requireFullScriptCta: false,
    },
  );
  failures.push(...coherence.failures);

  return [...new Set(failures)];
}

function assertPublicMetadataSafe(story = {}, opts = {}) {
  const surface = opts.surface || "unknown";
  const failures = collectPublicMetadataFailures(story, opts);
  if (failures.length > 0) throw new PublicMetadataQaError(surface, failures);
  return true;
}

module.exports = {
  PublicMetadataQaError,
  SCRIPT_VALIDATION_FAILURE_RE,
  assertPublicMetadataSafe,
  cleanPublicScriptText,
  collectPublicMetadataFailures,
  safePublicExcerpt,
};
