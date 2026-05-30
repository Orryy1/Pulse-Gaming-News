"use strict";

const path = require("node:path");
const fs = require("fs-extra");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalisePublicCopy(value) {
  return clean(value)
    .replace(/&amp;/gi, "&")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'");
}

function passLike(value) {
  const text = clean(value).toLowerCase();
  return ["pass", "passed", "green", "ok"].includes(text);
}

function firstClean(values = []) {
  for (const value of asArray(values)) {
    const text = normalisePublicCopy(value);
    if (text) return text;
  }
  return "";
}

async function readJsonIfPresent(filePath, fallback = null) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

const PUBLIC_COPY_FIELDS = [
  {
    field: "selected_title",
    canonical: ["selected_title", "short_title", "title"],
    report: ["selected_title", "short_title", "title"],
  },
  {
    field: "thumbnail_headline",
    canonical: ["thumbnail_headline", "thumbnail_text", "cover_headline"],
    report: ["thumbnail_headline", "thumbnail_text", "cover_headline"],
  },
  {
    field: "first_spoken_line",
    canonical: ["first_spoken_line", "narration_hook", "hook"],
    report: ["first_spoken_line", "narration_hook", "hook"],
  },
  {
    field: "narration_script",
    canonical: ["narration_script", "full_script", "tts_script", "script"],
    report: ["narration_script", "full_script", "tts_script", "script"],
  },
  {
    field: "description",
    canonical: ["description"],
    report: ["description"],
  },
  {
    field: "source_card_label",
    canonical: ["source_card_label"],
    report: ["source_card_label"],
  },
];

function valuesForKeys(object = {}, keys = []) {
  return asArray(keys).map((key) => object?.[key]);
}

function reportManifest(coherenceReport = {}) {
  if (coherenceReport.manifest && typeof coherenceReport.manifest === "object") {
    return coherenceReport.manifest;
  }
  if (coherenceReport.public_copy && typeof coherenceReport.public_copy === "object") {
    return coherenceReport.public_copy;
  }
  if (coherenceReport.canonical_story_manifest && typeof coherenceReport.canonical_story_manifest === "object") {
    return coherenceReport.canonical_story_manifest;
  }
  return null;
}

async function auditPublicOutputCoherenceArtifact({
  artifactDir = "",
  canonical = {},
  coherenceReport = null,
} = {}) {
  const reportPath = artifactDir ? path.join(artifactDir, "coherence_report.json") : "";
  const report = coherenceReport || await readJsonIfPresent(reportPath, null);
  const blockers = [];
  const warnings = [];
  const mismatchedFields = [];
  const missingFields = [];

  if (!report || typeof report !== "object") {
    blockers.push("missing_artefact:coherence_report.json");
    return {
      status: "blocked",
      report_path: reportPath || null,
      report_present: false,
      blockers,
      warnings,
      mismatched_fields: mismatchedFields,
      missing_fields: missingFields,
    };
  }

  const result = clean(report.result || report.verdict || report.status);
  const failures = [
    ...asArray(report.failures),
    ...asArray(report.blockers),
    ...asArray(report.raw_failures),
  ].map(clean).filter(Boolean);
  if (!passLike(result) || failures.length > 0) {
    blockers.push("coherence_report_not_pass");
    for (const failure of failures) blockers.push(`coherence_report_failure:${failure}`);
  }

  const manifest = reportManifest(report);
  if (!manifest) {
    blockers.push("coherence_report_missing_public_copy_manifest");
  } else {
    for (const spec of PUBLIC_COPY_FIELDS) {
      const current = firstClean(valuesForKeys(canonical, spec.canonical));
      if (!current) continue;
      const reported = firstClean(valuesForKeys(manifest, spec.report));
      if (!reported) {
        missingFields.push(spec.field);
        blockers.push(`coherence_report_missing_manifest_field:${spec.field}`);
        continue;
      }
      if (current !== reported) {
        mismatchedFields.push(spec.field);
      }
    }
  }

  if (mismatchedFields.length > 0) {
    blockers.push("stale_public_output_coherence_report");
    for (const field of mismatchedFields) {
      blockers.push(`stale_public_output_coherence_field:${field}`);
    }
  }

  return {
    status: blockers.length ? "blocked" : "fresh",
    report_path: reportPath || null,
    report_present: true,
    result: result || null,
    blockers: Array.from(new Set(blockers)),
    warnings,
    mismatched_fields: mismatchedFields,
    missing_fields: missingFields,
  };
}

module.exports = {
  auditPublicOutputCoherenceArtifact,
  normalisePublicCopy,
};
