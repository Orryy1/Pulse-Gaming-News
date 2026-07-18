"use strict";

const GENUINE_BASE_SOURCE_DIVERSITY_VERSION =
  "pulse_genuine_base_source_diversity_v1";
const DEFAULT_MINIMUM_GENUINE_BASE_SOURCES = 3;

const SOURCE_ID_FIELDS = Object.freeze([
  "base_source_id",
  "baseSourceId",
  "base_source_asset_id",
  "baseSourceAssetId",
  "master_source_id",
  "masterSourceId",
  "original_source_id",
  "originalSourceId",
  "source_asset_id",
  "sourceAssetId",
  "source_id",
  "sourceId",
  "youtube_video_id",
  "youtubeVideoId",
  "source_youtube_id",
  "sourceYoutubeId",
]);

const SOURCE_URL_FIELDS = Object.freeze([
  "canonical_source_url",
  "canonicalSourceUrl",
  "master_source_url",
  "masterSourceUrl",
  "original_source_url",
  "originalSourceUrl",
  "reference_url",
  "referenceUrl",
  "source_url",
  "sourceUrl",
  "url",
]);

const SOURCE_HASH_FIELDS = Object.freeze([
  "source_master_sha256",
  "sourceMasterSha256",
  "master_sha256",
  "masterSha256",
  "base_source_sha256",
  "baseSourceSha256",
  "original_source_sha256",
  "originalSourceSha256",
  "master_content_sha256",
  "masterContentSha256",
  "source_hash",
  "sourceHash",
  "content_hash",
  "contentHash",
  "sha256",
  "hash",
  "sampled_visual_fingerprint",
  "sampledVisualFingerprint",
  "master_visual_fingerprint",
  "masterVisualFingerprint",
]);

const NESTED_EVIDENCE_FIELDS = Object.freeze([
  "source_identity",
  "sourceIdentity",
  "motion_source_identity",
  "motionSourceIdentity",
  "provenance",
  "evidence",
]);

const PLACEHOLDER_FLAG_FIELDS = Object.freeze([
  "placeholder",
  "is_placeholder",
  "isPlaceholder",
  "placeholder_source",
  "placeholderSource",
  "is_placeholder_source",
  "isPlaceholderSource",
]);

const SYNTHETIC_STILL_FLAG_FIELDS = Object.freeze([
  "synthetic",
  "is_synthetic",
  "isSynthetic",
  "synthetic_still_loop",
  "syntheticStillLoop",
  "is_synthetic_still_loop",
  "isSyntheticStillLoop",
  "still_loop",
  "stillLoop",
  "is_still_loop",
  "isStillLoop",
  "image_loop",
  "imageLoop",
  "screenshot_loop",
  "screenshotLoop",
  "derived_from_still",
  "derivedFromStill",
  "is_static",
  "isStatic",
]);

const DESCRIPTOR_FIELDS = Object.freeze([
  "source_type",
  "sourceType",
  "media_kind",
  "mediaKind",
  "media_type",
  "mediaType",
  "motion_type",
  "motionType",
  "asset_type",
  "assetType",
  "visual_type",
  "visualType",
  "derivation_method",
  "derivationMethod",
  "generation_method",
  "generationMethod",
  "kind",
  "type",
]);

const URL_NOISE_PARAMETERS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "si",
  "feature",
  "ref",
  "source",
  "t",
  "start",
  "end",
  "offset",
  "duration",
  "clip",
  "window",
  "time_continue",
]);

const DUPLICATE_REASON_BY_KIND = Object.freeze({
  ids: "duplicate_base_source_id_rejected",
  urls: "duplicate_base_source_url_rejected",
  hashes: "duplicate_base_source_hash_rejected",
});

function cleanText(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function unique(values) {
  return [...new Set(values)];
}

function evidenceOwners(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];

  const owners = [];
  const queue = [source];
  const visited = new Set();
  while (queue.length) {
    const owner = queue.shift();
    if (!owner || typeof owner !== "object" || Array.isArray(owner) || visited.has(owner)) {
      continue;
    }
    visited.add(owner);
    owners.push(owner);
    for (const field of NESTED_EVIDENCE_FIELDS) {
      if (owner[field] && typeof owner[field] === "object") queue.push(owner[field]);
    }
  }
  return owners;
}

function fieldValues(source, fields) {
  const values = [];
  for (const owner of evidenceOwners(source)) {
    for (const field of fields) {
      const candidates = Array.isArray(owner[field]) ? owner[field] : [owner[field]];
      for (const candidate of candidates) {
        const value = cleanText(candidate);
        if (value) values.push(value);
      }
    }
  }
  return values;
}

function normaliseToken(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function normaliseSourceId(value) {
  return normaliseToken(value);
}

function youtubeVideoId(parsed) {
  const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
  if (host === "youtu.be") return cleanText(parsed.pathname.split("/").filter(Boolean)[0]);
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return "";
  return cleanText(
    parsed.searchParams.get("v") ||
      parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i)?.[1],
  );
}

function canonicaliseBaseSourceUrl(value) {
  const text = cleanText(value).replace(/^url:/i, "");
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";

    const youtubeId = youtubeVideoId(parsed);
    if (youtubeId) return `youtube:${youtubeId}`;

    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...parsed.searchParams.keys()]) {
      if (URL_NOISE_PARAMETERS.has(key.toLowerCase())) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/$/, "");
    return parsed.toString();
  } catch {
    return "";
  }
}

function normaliseSourceHash(value) {
  return normaliseToken(value)
    .replace(/^sha-?256:/, "")
    .replace(/^fingerprint:/, "");
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  return /^(?:true|yes|1)$/i.test(cleanText(value));
}

function hasTruthyFlag(source, fields) {
  return evidenceOwners(source).some((owner) =>
    fields.some((field) => isTruthyFlag(owner[field])),
  );
}

function isPlaceholderText(value) {
  const text = normaliseToken(value);
  if (!text) return false;
  if (["n/a", "na", "none", "null", "unknown", "missing"].includes(text)) return true;
  const words = text.replace(/[^a-z0-9]+/g, " ").trim();
  return /(?:^| )(?:placeholder|dummy|pending|tbd|todo|unknown|unspecified|missing)(?: |$)/.test(
    words,
  ) || /(?:^| )not (?:provided|available)(?: |$)/.test(words);
}

function isPlaceholderSource(source) {
  if (hasTruthyFlag(source, PLACEHOLDER_FLAG_FIELDS)) return true;
  return fieldValues(source, [
    ...SOURCE_ID_FIELDS,
    ...SOURCE_URL_FIELDS,
    ...SOURCE_HASH_FIELDS,
    ...DESCRIPTOR_FIELDS,
  ]).some(isPlaceholderText);
}

function isSyntheticStillDescriptor(value) {
  const text = normaliseToken(value).replace(/[_-]+/g, " ");
  if (!text) return false;
  return (
    /\b(?:synthetic|generated|animated)\s+(?:still|image|screenshot|key art|poster)\b/.test(text) ||
    /\b(?:still|static image|image|screenshot|key art|poster)\s+(?:loop|animation|motion|video)\b/.test(text) ||
    /\b(?:ken burns|pan and zoom|pan zoom|parallax still)\b/.test(text) ||
    /\bsynthetic still loop\b/.test(text)
  );
}

function isSyntheticStillLoop(source) {
  if (hasTruthyFlag(source, SYNTHETIC_STILL_FLAG_FIELDS)) return true;
  return fieldValues(source, DESCRIPTOR_FIELDS).some(isSyntheticStillDescriptor);
}

function sourceIdentity(source) {
  return {
    ids: unique(fieldValues(source, SOURCE_ID_FIELDS).map(normaliseSourceId).filter(Boolean)),
    urls: unique(
      fieldValues(source, SOURCE_URL_FIELDS).map(canonicaliseBaseSourceUrl).filter(Boolean),
    ),
    hashes: unique(
      fieldValues(source, SOURCE_HASH_FIELDS).map(normaliseSourceHash).filter(Boolean),
    ),
  };
}

function hasIdentity(identity) {
  return identity.ids.length > 0 || identity.urls.length > 0 || identity.hashes.length > 0;
}

function sourceLabel(source) {
  return (
    cleanText(source?.clip_id || source?.clipId || source?.id || source?.name) || null
  );
}

function inspectSource(source, inputIndex) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {
      input_index: inputIndex,
      source_label: null,
      identity: { ids: [], urls: [], hashes: [] },
      reasons: ["base_source_record_invalid"],
    };
  }

  const identity = sourceIdentity(source);
  const reasons = [];
  if (isPlaceholderSource(source)) reasons.push("placeholder_base_source_rejected");
  if (isSyntheticStillLoop(source)) {
    reasons.push("synthetic_still_loop_base_source_rejected");
  }
  if (!hasIdentity(identity)) reasons.push("base_source_identity_missing");

  return {
    input_index: inputIndex,
    source_label: sourceLabel(source),
    identity,
    reasons,
  };
}

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index) {
    if (this.parent[index] !== index) this.parent[index] = this.find(this.parent[index]);
    return this.parent[index];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function identitiesOverlap(left, right, kind) {
  const rightValues = new Set(right[kind]);
  return left[kind].some((value) => rightValues.has(value));
}

function groupDistinctSources(validRows) {
  const sets = new DisjointSet(validRows.length);
  const ownersByKind = {
    ids: new Map(),
    urls: new Map(),
    hashes: new Map(),
  };

  validRows.forEach((row, rowIndex) => {
    for (const kind of Object.keys(ownersByKind)) {
      for (const value of row.identity[kind]) {
        const previousOwner = ownersByKind[kind].get(value);
        if (previousOwner != null) sets.union(rowIndex, previousOwner);
        else ownersByKind[kind].set(value, rowIndex);
      }
    }
  });

  const groupedRows = new Map();
  validRows.forEach((row, rowIndex) => {
    const root = sets.find(rowIndex);
    const group = groupedRows.get(root) || [];
    group.push(row);
    groupedRows.set(root, group);
  });

  const genuineBaseSources = [];
  const duplicateRows = [];
  for (const rows of groupedRows.values()) {
    rows.sort((left, right) => left.input_index - right.input_index);
    const canonical = rows[0];
    const combinedIdentity = {
      ids: unique(rows.flatMap((row) => row.identity.ids)).sort(),
      urls: unique(rows.flatMap((row) => row.identity.urls)).sort(),
      hashes: unique(rows.flatMap((row) => row.identity.hashes)).sort(),
    };
    genuineBaseSources.push({
      base_source_key:
        combinedIdentity.hashes[0] || combinedIdentity.urls[0] || combinedIdentity.ids[0],
      base_source_id: combinedIdentity.ids[0] || null,
      canonical_source_url: combinedIdentity.urls[0] || null,
      source_hash: combinedIdentity.hashes[0] || null,
      identity: combinedIdentity,
      input_indexes: rows.map((row) => row.input_index),
      window_count: rows.length,
    });

    for (const duplicate of rows.slice(1)) {
      const reasons = [];
      for (const kind of Object.keys(DUPLICATE_REASON_BY_KIND)) {
        if (rows.some((row) => row !== duplicate && identitiesOverlap(duplicate.identity, row.identity, kind))) {
          reasons.push(DUPLICATE_REASON_BY_KIND[kind]);
        }
      }
      if (!reasons.length) reasons.push("duplicate_base_source_identity_rejected");
      duplicateRows.push({
        input_index: duplicate.input_index,
        source_label: duplicate.source_label,
        identity: duplicate.identity,
        reasons,
        duplicate_of_input_index: canonical.input_index,
      });
    }
  }

  genuineBaseSources.sort((left, right) => left.input_indexes[0] - right.input_indexes[0]);
  duplicateRows.sort((left, right) => left.input_index - right.input_index);
  return { genuineBaseSources, duplicateRows };
}

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null);
}

function resolveInvocation(input, options) {
  if (Array.isArray(input)) {
    return {
      sources: input,
      inputValid: true,
      configuration: options && typeof options === "object" ? options : {},
    };
  }

  if (input == null) {
    return {
      sources: [],
      inputValid: true,
      configuration: options && typeof options === "object" ? options : {},
    };
  }

  if (typeof input !== "object") {
    return { sources: [], inputValid: false, configuration: {} };
  }

  const declaredSources = firstDefined([
    input.sources,
    input.base_sources,
    input.baseSources,
    input.motion_sources,
    input.motionSources,
    input.clips,
  ]);
  return {
    sources: Array.isArray(declaredSources) ? declaredSources : [],
    inputValid: declaredSources === undefined || Array.isArray(declaredSources),
    configuration: {
      ...input,
      ...(options && typeof options === "object" ? options : {}),
    },
  };
}

function resolveMinimum(configuration) {
  const candidate = firstDefined([
    configuration.minimum,
    configuration.minimum_required,
    configuration.minimumRequired,
    configuration.min_genuine_base_sources,
    configuration.minGenuineBaseSources,
    configuration.required_genuine_base_source_count,
    configuration.requiredGenuineBaseSourceCount,
  ]);
  if (candidate === undefined) {
    return { value: DEFAULT_MINIMUM_GENUINE_BASE_SOURCES, valid: true };
  }

  const numeric = Number(candidate);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return { value: DEFAULT_MINIMUM_GENUINE_BASE_SOURCES, valid: false };
  }
  return { value: numeric, valid: true };
}

function evaluateGenuineBaseSourceDiversity(input = [], options = {}) {
  const invocation = resolveInvocation(input, options);
  const minimum = resolveMinimum(invocation.configuration);
  const inspectedRows = invocation.sources.map(inspectSource);
  const invalidRows = inspectedRows
    .filter((row) => row.reasons.length > 0)
    .map((row) => ({ ...row, duplicate_of_input_index: null }));
  const validRows = inspectedRows.filter((row) => row.reasons.length === 0);
  const { genuineBaseSources, duplicateRows } = groupDistinctSources(validRows);
  const rejectedSources = [...invalidRows, ...duplicateRows].sort(
    (left, right) => left.input_index - right.input_index,
  );
  const observed = genuineBaseSources.length;
  const minimumMet = minimum.valid && observed >= minimum.value;

  const blockers = [];
  if (!invocation.inputValid) blockers.push("genuine_base_source_input_invalid");
  if (!minimum.valid) blockers.push("genuine_base_source_minimum_invalid");
  for (const rejected of rejectedSources) {
    for (const reason of rejected.reasons) {
      if (!blockers.includes(reason)) blockers.push(reason);
    }
  }
  if (!minimumMet) blockers.push("genuine_base_source_minimum_not_met");

  const hardFailure = !invocation.inputValid || !minimum.valid || !minimumMet;
  const verdict = hardFailure ? "RED" : rejectedSources.length ? "AMBER" : "GREEN";
  const sourceIntegrityStatus = !invocation.inputValid
    ? "RED"
    : rejectedSources.length
      ? hardFailure
        ? "RED"
        : "AMBER"
      : "GREEN";

  return {
    schema_version: 1,
    evaluator_version: GENUINE_BASE_SOURCE_DIVERSITY_VERSION,
    verdict,
    status: verdict,
    strict_pass: verdict === "GREEN",
    minimum_met: minimumMet,
    minimum_required_genuine_base_source_count: minimum.value,
    observed_genuine_base_source_count: observed,
    input_source_count: invocation.sources.length,
    accepted_source_count: observed,
    rejected_source_count: rejectedSources.length,
    genuine_base_sources: genuineBaseSources,
    rejected_sources: rejectedSources,
    checks: {
      minimum_genuine_base_sources: {
        status: minimumMet ? "GREEN" : "RED",
        required: minimum.value,
        observed,
        configuration_valid: minimum.valid,
      },
      source_integrity: {
        status: sourceIntegrityStatus,
        input_valid: invocation.inputValid,
        rejected_source_count: rejectedSources.length,
      },
    },
    blockers: unique(blockers),
  };
}

module.exports = {
  GENUINE_BASE_SOURCE_DIVERSITY_VERSION,
  DEFAULT_MINIMUM_GENUINE_BASE_SOURCES,
  canonicaliseBaseSourceUrl,
  evaluateGenuineBaseSourceDiversity,
  assessGenuineBaseSourceDiversity: evaluateGenuineBaseSourceDiversity,
};
