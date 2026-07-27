"use strict";

const STALE_REPORT_BANNER =
  "STALE HISTORICAL EVIDENCE: DO NOT USE FOR CURRENT RELEASE DECISIONS";

const REQUIRED_FIELDS = [
  "generated_at",
  "source_commit_sha",
  "runtime_commit_sha",
  "environment",
  "scope",
  "expires_at",
  "supersedes",
  "superseded_by",
  "authoritative",
];

function asIso(value) {
  const text = String(value || "").trim();
  if (!text || !Number.isFinite(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function asCommitSha(value) {
  const text = String(value || "").trim();
  return /^[a-f0-9]{7,64}$/i.test(text) ? text.toLowerCase() : null;
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function createReportMetadata({
  generatedAt,
  sourceCommitSha,
  runtimeCommitSha,
  environment,
  scope,
  expiresAt,
  supersedes = [],
  supersededBy = [],
  authoritative = false,
} = {}) {
  return {
    generated_at: asIso(generatedAt),
    source_commit_sha: asCommitSha(sourceCommitSha),
    runtime_commit_sha: asCommitSha(runtimeCommitSha),
    environment: String(environment || "").trim(),
    scope: String(scope || "").trim(),
    expires_at: asIso(expiresAt),
    supersedes: asStringList(supersedes),
    superseded_by: asStringList(supersededBy),
    authoritative: authoritative === true,
  };
}

function validateReportMetadata(metadata = {}) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(metadata, field)) {
      errors.push(`${field} is required`);
    }
  }

  if (!asIso(metadata.generated_at)) {
    errors.push("generated_at must be an ISO-8601 timestamp");
  }
  if (!asCommitSha(metadata.source_commit_sha)) {
    errors.push("source_commit_sha must be an exact git commit SHA");
  }
  if (!asCommitSha(metadata.runtime_commit_sha)) {
    errors.push("runtime_commit_sha must be an exact git commit SHA");
  }
  if (!String(metadata.environment || "").trim()) {
    errors.push("environment must identify the observed environment");
  }
  if (!String(metadata.scope || "").trim()) {
    errors.push("scope must describe the evidence boundary");
  }
  if (!asIso(metadata.expires_at)) {
    errors.push("expires_at must be an ISO-8601 timestamp");
  }
  if (!Array.isArray(metadata.supersedes)) {
    errors.push("supersedes must be an array");
  }
  if (!Array.isArray(metadata.superseded_by)) {
    errors.push("superseded_by must be an array");
  }
  if (typeof metadata.authoritative !== "boolean") {
    errors.push("authoritative must be boolean");
  }
  if (
    asIso(metadata.generated_at) &&
    asIso(metadata.expires_at) &&
    Date.parse(metadata.expires_at) <= Date.parse(metadata.generated_at)
  ) {
    errors.push("expires_at must be after generated_at");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function assessReportAuthority(metadata = {}, { at = new Date().toISOString() } = {}) {
  const validation = validateReportMetadata(metadata);
  const reasons = [];
  if (!validation.valid) reasons.push("invalid_metadata");
  if (Array.isArray(metadata.superseded_by) && metadata.superseded_by.length > 0) {
    reasons.push("superseded");
  }
  const expiresAt = asIso(metadata.expires_at);
  const observedAt = asIso(at);
  if (expiresAt && observedAt && Date.parse(observedAt) >= Date.parse(expiresAt)) {
    reasons.push("expired");
  }
  if (metadata.authoritative !== true) reasons.push("declared_non_authoritative");

  const authoritative = reasons.length === 0;
  const stale = reasons.some((reason) =>
    ["invalid_metadata", "superseded", "expired"].includes(reason),
  );
  return {
    authoritative,
    stale,
    reasons,
    banner: stale ? STALE_REPORT_BANNER : null,
  };
}

function tableValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (value === null || value === undefined || value === "") return "unavailable";
  return String(value).replace(/\|/g, "\\|");
}

function decorateMarkdownReport({
  title,
  metadata,
  body = "",
  at = new Date().toISOString(),
} = {}) {
  const authority = assessReportAuthority(metadata, { at });
  const lines = [`# ${String(title || "Untitled report").trim()}`, ""];
  if (authority.banner) {
    lines.push(`> **${authority.banner}**`, "");
  }
  lines.push("| Metadata | Value |", "| --- | --- |");
  for (const field of REQUIRED_FIELDS) {
    lines.push(`| ${field} | ${tableValue(metadata?.[field])} |`);
  }
  lines.push("", String(body || "").trim(), "");
  return lines.join("\n");
}

module.exports = {
  REQUIRED_FIELDS,
  STALE_REPORT_BANNER,
  assessReportAuthority,
  createReportMetadata,
  decorateMarkdownReport,
  validateReportMetadata,
};
