"use strict";

const crypto = require("node:crypto");
const net = require("node:net");

const DISCOVERY_SCHEMA_VERSION =
  "pulse-breaking-corroborator-discovery-v1";
const SEARCH_REQUEST_SCHEMA_VERSION =
  "pulse-breaking-corroborator-search-request-v1";
const DEFAULT_MAX_CANDIDATES = 6;
const DEFAULT_MAX_SEARCH_RESULTS = 20;
const HARD_MAX_CANDIDATES = 8;
const HARD_MAX_SEARCH_RESULTS = 40;

function text(value, maximum = 10_000) {
  return String(value || "").trim().slice(0, maximum);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hostMatches(hostname, allowedHost) {
  const allowed = text(allowedHost).toLowerCase().replace(/\.$/, "");
  return Boolean(
    allowed &&
      (hostname === allowed || hostname.endsWith(`.${allowed}`)),
  );
}

function officialSubjectMatches(story, source) {
  const storySubjects = new Set(
    (Array.isArray(story?.subject_ids) ? story.subject_ids : []).map(
      (value) => text(value).toLowerCase(),
    ),
  );
  const sourceSubjects = (
    Array.isArray(source?.subject_ids) ? source.subject_ids : []
  ).map((value) => text(value).toLowerCase());
  return (
    sourceSubjects.includes("*") ||
    sourceSubjects.some((subject) => storySubjects.has(subject))
  );
}

function inspectAllowlistedUrl({ rawUrl, story, sourcePolicy }) {
  let parsed;
  try {
    parsed = new URL(text(rawUrl));
  } catch {
    return {
      classification: null,
      reason: "candidate_url_invalid",
    };
  }
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (parsed.protocol !== "https:") {
    return {
      classification: null,
      reason: "candidate_url_https_required",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      classification: null,
      reason: "candidate_url_credentials_forbidden",
    };
  }
  if (parsed.port && parsed.port !== "443") {
    return {
      classification: null,
      reason: "candidate_url_nonstandard_port_forbidden",
    };
  }
  if (
    net.isIP(hostname) !== 0 ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    /\.(?:localhost|local|internal|lan|home)$/i.test(hostname)
  ) {
    return {
      classification: null,
      reason: "candidate_url_public_hostname_required",
    };
  }

  const official = Array.isArray(sourcePolicy?.official_first_party)
    ? sourcePolicy.official_first_party
    : [];
  for (const source of official) {
    const sourceId = text(source?.source_id);
    const publisher = text(source?.owner);
    if (
      sourceId &&
      publisher &&
      officialSubjectMatches(story, source) &&
      (Array.isArray(source?.hosts) ? source.hosts : []).some((host) =>
        hostMatches(hostname, host),
      )
    ) {
      parsed.hostname = hostname;
      parsed.hash = "";
      return {
        classification: {
          url: parsed.toString(),
          source_id: sourceId,
          source_class: "OFFICIAL_FIRST_PARTY",
          publisher,
        },
        reason: null,
      };
    }
  }

  const editorial = Array.isArray(sourcePolicy?.trusted_editorial)
    ? sourcePolicy.trusted_editorial
    : [];
  for (const source of editorial) {
    const sourceId = text(source?.source_id);
    const publisher = text(source?.outlet);
    if (
      sourceId &&
      publisher &&
      (Array.isArray(source?.hosts) ? source.hosts : []).some((host) =>
        hostMatches(hostname, host),
      )
    ) {
      parsed.hostname = hostname;
      parsed.hash = "";
      return {
        classification: {
          url: parsed.toString(),
          source_id: sourceId,
          source_class: "TRUSTED_EDITORIAL",
          publisher,
        },
        reason: null,
      };
    }
  }
  return {
    classification: null,
    reason: "candidate_source_not_allowlisted",
  };
}

function classifyAllowlistedUrl(input) {
  return inspectAllowlistedUrl(input).classification;
}

function adapterIdentity(searchIndex) {
  const identity = {
    id: text(searchIndex?.identity?.id, 160),
    version: text(searchIndex?.identity?.version, 80),
  };
  if (!identity.id || !identity.version) {
    throw new Error("breaking_corroborator_search_identity_required");
  }
  return identity;
}

function searchableSources(sourcePolicy, story) {
  return [
    ...(Array.isArray(sourcePolicy?.official_first_party)
      ? sourcePolicy.official_first_party
          .filter((source) => officialSubjectMatches(story, source))
          .map((source) => ({
            source_id: text(source.source_id),
            source_class: "OFFICIAL_FIRST_PARTY",
            hosts: (Array.isArray(source.hosts) ? source.hosts : []).map(
              (host) => text(host).toLowerCase(),
            ),
          }))
      : []),
    ...(Array.isArray(sourcePolicy?.trusted_editorial)
      ? sourcePolicy.trusted_editorial.map((source) => ({
          source_id: text(source.source_id),
          source_class: "TRUSTED_EDITORIAL",
          hosts: (Array.isArray(source.hosts) ? source.hosts : []).map(
            (host) => text(host).toLowerCase(),
          ),
        }))
      : []),
  ].filter(
    (source) => source.source_id && source.hosts.length > 0,
  );
}

function storySourceIds({ story, sourcePolicy }) {
  const explicit = Array.isArray(story?.source_candidates)
    ? story.source_candidates
    : [];
  const urls = [
    ...explicit.map((candidate) =>
      typeof candidate === "string" ? candidate : candidate?.url,
    ),
    story?.primary_source_url,
    story?.article_url,
    story?.url,
  ].filter((value) => text(value));
  return new Set(
    urls
      .map((rawUrl) =>
        classifyAllowlistedUrl({
          rawUrl,
          story,
          sourcePolicy,
        }),
      )
      .filter(Boolean)
      .map((source) => source.source_id),
  );
}

function indexMetadata(row, classified = null) {
  return {
    url: classified?.url || text(row?.url, 4_000),
    claimed_source_id: text(row?.source_id, 160),
    title_sha256: sha256(text(row?.title, 2_000)),
    snippet_sha256: sha256(text(row?.snippet, 8_000)),
  };
}

function boundedLimit(value, fallback, hardMaximum, errorCode) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    number > hardMaximum
  ) {
    throw new Error(errorCode);
  }
  return number;
}

async function discoverBreakingCorroborators({
  story = {},
  sourcePolicy = {},
  searchIndex,
  now = new Date().toISOString(),
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  maxSearchResults = DEFAULT_MAX_SEARCH_RESULTS,
} = {}) {
  if (typeof searchIndex?.search !== "function") {
    throw new Error("breaking_corroborator_search_adapter_required");
  }
  const identity = adapterIdentity(searchIndex);
  if (
    !story ||
    typeof story !== "object" ||
    Array.isArray(story) ||
    !text(story.id, 200) ||
    !text(story.title, 280)
  ) {
    throw new Error("breaking_corroborator_story_identity_required");
  }
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("breaking_corroborator_discovery_time_invalid");
  }
  maxCandidates = boundedLimit(
    maxCandidates,
    DEFAULT_MAX_CANDIDATES,
    HARD_MAX_CANDIDATES,
    "breaking_corroborator_candidate_limit_invalid",
  );
  maxSearchResults = boundedLimit(
    maxSearchResults,
    DEFAULT_MAX_SEARCH_RESULTS,
    HARD_MAX_SEARCH_RESULTS,
    "breaking_corroborator_search_limit_invalid",
  );
  const subjectIds = (
    Array.isArray(story?.subject_ids) ? story.subject_ids : []
  )
    .map((value) => text(value).toLowerCase())
    .filter(Boolean);
  const query = [text(story?.title, 280), ...subjectIds]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 320);
  const queryBinding = {
    schema_version: SEARCH_REQUEST_SCHEMA_VERSION,
    story_id: text(story?.id, 200),
    discovered_proposition: text(story?.title, 280),
    subject_ids: subjectIds,
    query,
  };
  const querySha256 = sha256(stableJson(queryBinding));
  const allowedSources = searchableSources(sourcePolicy, story);
  const request = {
    schema_version: SEARCH_REQUEST_SCHEMA_VERSION,
    story_identity: {
      id: queryBinding.story_id,
      subject_ids: subjectIds,
    },
    discovered_proposition: queryBinding.discovered_proposition,
    query,
    query_sha256: querySha256,
    allowed_sources: allowedSources,
    limit: maxSearchResults,
  };
  const response = await searchIndex.search(deepFreeze(request));
  const rawRows = Array.isArray(response?.results)
    ? response.results
    : [];
  const rows = rawRows.slice(0, request.limit);
  const responseTruncated = rawRows.length > rows.length;
  const searchResponseBinding = {
    schema_version:
      "pulse-breaking-corroborator-search-response-v1",
    query_sha256: querySha256,
    adapter: identity,
    requested_limit: request.limit,
    result_count: rows.length,
    truncated: responseTruncated,
    results: rows.map((row, index) => ({
      search_rank: index + 1,
      index_result_sha256: sha256(
        stableJson(indexMetadata(row)),
      ),
    })),
  };
  const searchResponseSha256 = sha256(
    stableJson(searchResponseBinding),
  );
  const candidates = [];
  const rejections = [];
  const originSourceIds = storySourceIds({ story, sourcePolicy });
  const acceptedSourceIds = new Set();
  const acceptedUrls = new Set();
  for (const [index, row] of rows.entries()) {
    const inspected = inspectAllowlistedUrl({
      rawUrl: row?.url,
      story,
      sourcePolicy,
    });
    const unsafeMetadataSha256 = sha256(
      stableJson(indexMetadata(row)),
    );
    if (!inspected.classification) {
      rejections.push({
        search_rank: index + 1,
        source_id: null,
        reason: inspected.reason,
        index_result_sha256: unsafeMetadataSha256,
      });
      continue;
    }
    const classified = inspected.classification;
    const metadataSha256 = sha256(
      stableJson(indexMetadata(row, classified)),
    );
    const rejected = (reason) => {
      rejections.push({
        search_rank: index + 1,
        source_id: classified.source_id,
        reason,
        index_result_sha256: metadataSha256,
      });
    };
    const claimedSourceId = text(row?.source_id, 160);
    if (
      claimedSourceId &&
      claimedSourceId.toLowerCase() !==
        classified.source_id.toLowerCase()
    ) {
      rejected("candidate_claimed_source_id_mismatch");
      continue;
    }
    if (originSourceIds.has(classified.source_id)) {
      rejected("origin_source_not_independent");
      continue;
    }
    if (acceptedUrls.has(classified.url)) {
      rejected("duplicate_url");
      continue;
    }
    if (acceptedSourceIds.has(classified.source_id)) {
      rejected("duplicate_source_not_independent");
      continue;
    }
    if (candidates.length >= maxCandidates) {
      rejected("candidate_limit_reached");
      continue;
    }
    const provenance = {
      schema_version:
        "pulse-breaking-corroborator-provenance-v1",
      query_sha256: querySha256,
      search_response_sha256: searchResponseSha256,
      adapter: identity,
      result_rank: index + 1,
      source_id: classified.source_id,
      source_class: classified.source_class,
      url: classified.url,
      index_result_sha256: metadataSha256,
    };
    candidates.push({
      ...classified,
      search_rank: index + 1,
      verification_status: "UNVERIFIED_CANDIDATE",
      confirmation_authority: false,
      body_evidence_captured: false,
      index_metadata_sha256: metadataSha256,
      provenance_sha256: sha256(stableJson(provenance)),
    });
    acceptedSourceIds.add(classified.source_id);
    acceptedUrls.add(classified.url);
  }
  const base = {
    schema_version: DISCOVERY_SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    story_id: queryBinding.story_id,
    query_sha256: querySha256,
    search_response_sha256: searchResponseSha256,
    search_adapter: identity,
    candidate_urls: candidates.map((candidate) => candidate.url),
    candidates,
    rejections,
    search_result_count: rows.length,
    search_response_truncated: responseTruncated,
    verified_for_planning: false,
    confirmation_authority: false,
    publish_authority: false,
    database_mutation_authority: false,
    oauth_authority: false,
    safety: {
      titles_and_snippets_are_not_confirmation: true,
      body_evidence_capture_required: true,
      no_external_posting_authority: true,
    },
  };
  return deepFreeze({
    ...base,
    discovery_sha256: sha256(stableJson(base)),
  });
}

module.exports = {
  DISCOVERY_SCHEMA_VERSION,
  SEARCH_REQUEST_SCHEMA_VERSION,
  discoverBreakingCorroborators,
};
