"use strict";

const crypto = require("node:crypto");
const {
  buildSourceFingerprint,
} = require("../refill-zero-yield-quarantine");

function clean(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function storyId(candidate = {}) {
  return clean(candidate.story_id || candidate.id || candidate.storyId);
}

function sourceUrl(candidate = {}) {
  const value = clean(
    candidate.source_url ||
      candidate.primary_source_url ||
      candidate.primary_source?.url ||
      candidate.article_url ||
      candidate.url,
  );
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

function isSameRssRetry(candidate = {}, attemptedIds = new Set()) {
  const retryOf = clean(
    candidate.retry_of_story_id ||
      candidate.retry_of ||
      candidate.primary_attempt_story_id,
  );
  const origin = clean(
    candidate.cohort_origin ||
      candidate.candidate_origin ||
      candidate.selection_origin,
  ).toLowerCase();
  return (
    origin === "same_rss_retry" ||
    origin === "primary_rss_retry" ||
    (retryOf && attemptedIds.has(retryOf))
  );
}

function hasAlternateCohortProvenance(candidate = {}) {
  const cohort = clean(
    candidate.cohort_kind ||
      candidate.cohort_type ||
      candidate.candidate_cohort,
  ).toLowerCase();
  return (
    candidate.local_promotion_intake_only === true ||
    candidate.local_promotion_only === true ||
    candidate.motion_capacity_intake_only === true ||
    candidate.review_candidate === true ||
    candidate.human_review_candidate === true ||
    [
      "review",
      "human_review",
      "review_local_promotion",
      "local_promotion",
    ].includes(cohort)
  );
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourcePublishedAt(candidate = {}) {
  return clean(
    candidate.source_published_at ||
      candidate.primary_source?.published_at ||
      candidate.source_manifest?.source_published_at ||
      candidate.source_manifest?.primary_source?.published_at,
  );
}

function sourceAgeMetadata(candidate = {}, now = null) {
  const sourceAge = candidate.source_age || {};
  const preflight = candidate.preflight_qa?.checks?.source_age || {};
  const policyHours =
    numberOrNull(candidate.source_age_policy_hours) ??
    numberOrNull(sourceAge.policy_hours) ??
    numberOrNull(preflight.evidence?.policy_hours) ??
    168;
  let ageHours =
      numberOrNull(candidate.source_age_hours) ??
      numberOrNull(candidate.age_hours) ??
      numberOrNull(sourceAge.age_hours) ??
      numberOrNull(preflight.evidence?.age_hours);
  if (ageHours === null && now) {
    const publishedAt = Date.parse(sourcePublishedAt(candidate));
    const selectedAt = now instanceof Date
      ? now.getTime()
      : Date.parse(clean(now));
    if (Number.isFinite(publishedAt) && Number.isFinite(selectedAt)) {
      ageHours = Math.max(0, (selectedAt - publishedAt) / 3_600_000);
    }
  }
  let state = clean(
    candidate.source_age_state ||
      sourceAge.state ||
      preflight.evidence?.state ||
      preflight.result,
  ).toLowerCase();
  if (!state && ageHours !== null) {
    state = ageHours > policyHours
      ? "expired"
      : policyHours - ageHours <= 24
        ? "expiring_within_24h"
        : "fresh";
  }
  return {
    state,
    age_hours: ageHours === null
      ? null
      : Math.round(ageHours * 1000) / 1000,
    policy_hours: policyHours,
  };
}

function sourceAgeIsExpired(candidate = {}, now = null) {
  const metadata = sourceAgeMetadata(candidate, now);
  if (["expired", "stale", "fail", "failed", "blocked", "red"].includes(metadata.state)) {
    return true;
  }
  return (
    metadata.age_hours !== null &&
    metadata.policy_hours !== null &&
    metadata.age_hours > metadata.policy_hours
  );
}

function sourceAgeIsUnknown(candidate = {}, now = null) {
  const metadata = sourceAgeMetadata(candidate, now);
  return !metadata.state || metadata.age_hours === null;
}

function upstreamBlockers(candidate = {}) {
  return unique([
    ...asArray(candidate.blockers),
    ...asArray(candidate.failures),
    ...asArray(candidate.quality_failures),
    ...asArray(candidate.preflight_qa?.blockers),
    ...asArray(candidate.preflight_qa?.failures),
  ]).sort();
}

function explicitEligibilityBlockers(metadata = {}) {
  return unique([
    ...asArray(metadata.blockers),
    ...asArray(metadata.failures),
    ...asArray(metadata.reason_codes),
  ]).sort();
}

function isExplicitlyIneligible(metadata = {}) {
  const status = clean(
    metadata.status || metadata.state || metadata.verdict || metadata.result,
  ).toLowerCase();
  return (
    metadata.eligible === false ||
    metadata.blocked === true ||
    ["red", "fail", "failed", "blocked", "ineligible", "reject", "rejected"].includes(status)
  );
}

function blockedDecision(candidate = {}) {
  const blockers = upstreamBlockers(candidate);
  const status = clean(
    candidate.status || candidate.verdict || candidate.result,
  ).toLowerCase();
  if (
    blockers.length ||
    candidate.blocked === true ||
    candidate.eligible === false ||
    ["red", "fail", "failed", "blocked", "reject", "rejected", "hard_stop"].includes(status)
  ) {
    return {
      reason_codes: ["candidate_blocked"],
      blockers: blockers.length ? blockers : [`candidate_status:${status || "blocked"}`],
    };
  }

  if (isExplicitlyIneligible(candidate.rights_eligibility || {})) {
    const rightsBlockers = explicitEligibilityBlockers(
      candidate.rights_eligibility,
    );
    return {
      reason_codes: ["rights_ineligible"],
      blockers: rightsBlockers.length
        ? rightsBlockers
        : ["rights_eligibility:false"],
    };
  }

  if (isExplicitlyIneligible(candidate.motion_eligibility || {})) {
    const motionBlockers = explicitEligibilityBlockers(
      candidate.motion_eligibility,
    );
    return {
      reason_codes: ["motion_ineligible"],
      blockers: motionBlockers.length
        ? motionBlockers
        : ["motion_eligibility:false"],
    };
  }
  return null;
}

const MEDIA_IDENTITY_STOPWORDS = new Set([
  "1080",
  "1080p",
  "2160",
  "264",
  "720",
  "720p",
  "animation",
  "art",
  "asset",
  "assets",
  "avc1",
  "cinematic",
  "clip",
  "cover",
  "direct",
  "download",
  "downloads",
  "detail",
  "file",
  "first",
  "footage",
  "fresh",
  "game",
  "gameplay",
  "gets",
  "h264",
  "has",
  "hls",
  "keyart",
  "latest",
  "launch",
  "manifest",
  "master",
  "media",
  "m4v",
  "m3u8",
  "mov",
  "mp4",
  "mpd",
  "motion",
  "official",
  "page",
  "primary",
  "real",
  "release",
  "reveal",
  "roster",
  "shows",
  "source",
  "static",
  "store",
  "storefront",
  "teaser",
  "timing",
  "trailer",
  "upload",
  "uploads",
  "update",
  "video",
  "web",
  "webm",
  "window",
]);

const MEDIA_PROVIDER_TOKENS = new Set([
  "epic",
  "gamespot",
  "ign",
  "microsoft",
  "nintendo",
  "playstation",
  "rockstar",
  "sony",
  "steam",
  "valve",
  "xbox",
]);

const DIRECT_MEDIA_URL_RE = /\.(?:m4v|m3u8|mov|mp4|mpd|webm)(?:[?#].*)?$/i;
const DIRECT_MEDIA_KINDS = new Set([
  "dash_manifest",
  "direct_video",
  "hls_manifest",
  "local_video_file",
]);

function normaliseIdentityText(value = "") {
  let text = clean(value);
  try {
    text = decodeURIComponent(text);
  } catch {}
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bgrand\s+theft\s+auto\s+(?:6|vi)\b/g, "grand theft auto 6")
    .replace(/\bgta\s*(?:6|vi)\b/g, "grand theft auto 6")
    .replace(/\bfh\s*6\b/g, "forza horizon 6")
    .replace(/\s+/g, " ")
    .trim();
}

function identityTokens(value = "") {
  return normaliseIdentityText(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !MEDIA_IDENTITY_STOPWORDS.has(token))
    .filter((token) => !/^[a-f0-9]{6,}$/i.test(token))
    .filter((token) => token.length > 1 || /^\d+$/.test(token));
}

function uniqueTokens(values = []) {
  return unique(asArray(values).flatMap(identityTokens));
}

function directMediaUrl(media = {}) {
  if (typeof media === "string") return clean(media);
  return clean(
    media.direct_media_url ||
      media.approved_direct_media_url ||
      media.direct_media_url_if_available ||
      media.media_url ||
      media.video_url ||
      media.file_path ||
      media.path ||
      media.url ||
      media.source_url,
  );
}

function isDirectMediaRow(media = {}) {
  if (typeof media === "string") return DIRECT_MEDIA_URL_RE.test(clean(media));
  const explicitDirectUrl = clean(
    media.direct_media_url ||
      media.approved_direct_media_url ||
      media.direct_media_url_if_available ||
      media.media_url ||
      media.video_url,
  );
  const url = directMediaUrl(media);
  const kind = clean(media.source_url_kind || media.url_kind).toLowerCase();
  return Boolean(
    explicitDirectUrl ||
      DIRECT_MEDIA_URL_RE.test(url) ||
      DIRECT_MEDIA_KINDS.has(kind) ||
      media.segment_validation_eligible === true,
  );
}

function collectDirectMedia(candidate = {}) {
  const scalarKeys = [
    "approved_direct_media_url",
    "direct_media_url",
    "direct_media_url_if_available",
    "official_direct_media_url",
    "media_url",
    "video_url",
  ];
  const scalarRows = scalarKeys
    .map((key) => clean(candidate[key]))
    .filter(Boolean)
    .map((url) => ({ direct_media_url: url }));
  const sourceManifest = candidate.source_manifest || {};
  const primarySource = candidate.primary_source || {};
  const buckets = [
    scalarRows,
    candidate.direct_media_candidates,
    candidate.official_direct_media_candidates,
    candidate.media_candidates,
    candidate.motion_clips,
    candidate.video_clips,
    candidate.motion_capacity?.clips,
    candidate.motion_eligibility?.clips,
    candidate.trusted_footage_references,
    candidate.footage_references,
    primarySource.direct_media_candidates,
    primarySource.official_direct_media_candidates,
    sourceManifest.direct_media_candidates,
    sourceManifest.official_direct_media_candidates,
    sourceManifest.approved_direct_media,
    sourceManifest.media_manifest?.direct_media_candidates,
  ];
  const seen = new Set();
  const rows = [];
  for (const value of buckets.flatMap(asArray)) {
    const row = typeof value === "string"
      ? { direct_media_url: value }
      : value;
    if (!row || typeof row !== "object" || !isDirectMediaRow(row)) continue;
    const url = directMediaUrl(row);
    const key = clean(
      url ||
        `${row.source_family || row.motion_family || ""}|${row.label || row.title || ""}`,
    ).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

function storySubjectValues(candidate = {}) {
  const canonical = candidate.canonical_story_manifest || {};
  const values = unique([
    candidate.canonical_subject,
    candidate.canonical_game,
    candidate.primary_story_entity,
    candidate.game_title,
    candidate.game,
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.primary_story_entity,
  ]);
  if (values.length) return values;
  return unique([
    candidate.selected_title,
    candidate.public_title,
    candidate.title,
  ]).slice(0, 1);
}

function urlIdentityText(value = "") {
  const text = clean(value);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return `${parsed.pathname} ${parsed.searchParams.get("title") || ""} ${
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("fileName") ||
      ""
    }`;
  } catch {
    return text;
  }
}

function mediaIdentity(media = {}, subjectTokens = []) {
  const namedText = [
    media.entity,
    media.game,
    media.game_title,
    media.canonical_game,
    media.exact_subject_group,
    media.matched_subject,
    media.subject,
    media.label,
    media.title,
    media.source_title,
    media.display_name,
    media.name,
  ];
  const familyText = [
    media.source_family,
    media.motion_family,
    media.family,
    media.source_id,
  ];
  const urlText = urlIdentityText(directMediaUrl(media));
  const namedTokens = uniqueTokens(namedText);
  const familyTokens = uniqueTokens(familyText);
  const pathTokens = uniqueTokens([urlText]);
  const allSubjectTokens = new Set(subjectTokens);
  const tokens = unique([...namedTokens, ...familyTokens, ...pathTokens])
    .filter((token) =>
      !MEDIA_PROVIDER_TOKENS.has(token) || allSubjectTokens.has(token));
  const reliableTokens = unique([
    ...(namedTokens.length >= 2 ? namedTokens : []),
    ...(familyTokens.length >= 2 ? familyTokens : []),
    ...(pathTokens.length >= 2 ? pathTokens : []),
  ]).filter((token) =>
    !MEDIA_PROVIDER_TOKENS.has(token) || allSubjectTokens.has(token));
  return { tokens, reliableTokens };
}

function tokensEstablishMatch(subjectTokens = [], mediaTokens = []) {
  if (!subjectTokens.length || !mediaTokens.length) return false;
  const mediaSet = new Set(mediaTokens);
  const overlap = subjectTokens.filter((token) => mediaSet.has(token));
  if (subjectTokens.length === 1) {
    return overlap.some((token) => token.length >= 4);
  }
  if (mediaTokens.length === 1) return false;
  return (
    overlap.length >= 2 ||
    overlap.length / subjectTokens.length >= 0.5 ||
    overlap.length / mediaTokens.length >= 0.5
  );
}

function mediaEvidenceRow(media = {}, subjectEntries = [], allSubjectTokens = []) {
  const identity = mediaIdentity(media, allSubjectTokens);
  const matched = subjectEntries.find((subject) =>
    tokensEstablishMatch(subject.tokens, identity.tokens));
  const verdict = matched
    ? "matched"
    : identity.reliableTokens.length
      ? "unrelated"
      : "unproven";
  return {
    label: clean(
      media.label ||
        media.title ||
        media.source_title ||
        media.display_name,
    ),
    source_family: clean(
      media.source_family ||
        media.motion_family ||
        media.family ||
        media.source_id,
    ),
    direct_media_url: directMediaUrl(media),
    verdict,
    matched_subject: matched ? matched.value : null,
    identity_tokens: identity.tokens,
  };
}

function sourceMotionCoherence(candidate = {}) {
  const subjectValues = storySubjectValues(candidate);
  const subjectEntries = subjectValues.map((value) => ({
    value,
    tokens: identityTokens(value),
  }));
  const allSubjectTokens = unique(
    subjectEntries.flatMap((subject) => subject.tokens),
  );
  const mediaEvidence = collectDirectMedia(candidate).map((media) =>
    mediaEvidenceRow(media, subjectEntries, allSubjectTokens));
  const matchedCount = mediaEvidence.filter(
    (media) => media.verdict === "matched",
  ).length;
  const unrelatedCount = mediaEvidence.filter(
    (media) => media.verdict === "unrelated",
  ).length;
  const unprovenCount = mediaEvidence.filter(
    (media) => media.verdict === "unproven",
  ).length;
  const storyIdentityConflicts = [];
  let reasonCodes = [];
  if (unrelatedCount && matchedCount) {
    reasonCodes = ["source_motion_coherence:cross_title_contamination"];
  } else if (unrelatedCount) {
    reasonCodes = ["source_motion_coherence:unrelated_media"];
  } else if (!mediaEvidence.length || !matchedCount || unprovenCount) {
    reasonCodes = ["source_motion_coherence:subject_match_unproven"];
  }
  return {
    status: reasonCodes.length ? "blocked" : "pass",
    subject_values: subjectValues,
    direct_media_count: mediaEvidence.length,
    matched_media_count: matchedCount,
    unrelated_media_count: unrelatedCount,
    unproven_media_count: unprovenCount,
    story_identity_conflicts: storyIdentityConflicts,
    media_evidence: mediaEvidence,
    rights_inference: "not_assessed",
    host_or_official_status_used_as_proof: false,
    reason_codes: reasonCodes,
  };
}

function coherenceDecision(candidate = {}) {
  const evaluated = sourceMotionCoherence(candidate);
  const { reason_codes: reasonCodes, ...evidence } = evaluated;
  return {
    reason_codes: reasonCodes,
    evidence,
  };
}

function eligibilityRank(metadata = {}) {
  if (metadata.eligible === true) return 0;
  return 1;
}

function candidatePriority(left = {}, right = {}, now = null) {
  const leftRights = eligibilityRank(left.rights_eligibility || {});
  const rightRights = eligibilityRank(right.rights_eligibility || {});
  if (leftRights !== rightRights) return leftRights - rightRights;

  const leftMotion = eligibilityRank(left.motion_eligibility || {});
  const rightMotion = eligibilityRank(right.motion_eligibility || {});
  if (leftMotion !== rightMotion) return leftMotion - rightMotion;

  const leftAge = sourceAgeMetadata(left, now).age_hours ?? Number.POSITIVE_INFINITY;
  const rightAge = sourceAgeMetadata(right, now).age_hours ?? Number.POSITIVE_INFINITY;
  if (leftAge !== rightAge) return leftAge - rightAge;

  const leftScore = numberOrNull(
    left.priority_score || left.breaking_score || left.score,
  ) ?? 0;
  const rightScore = numberOrNull(
    right.priority_score || right.breaking_score || right.score,
  ) ?? 0;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return storyId(left).localeCompare(storyId(right));
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

function selectionFingerprint({
  attemptedIds = [],
  candidates = [],
  excluded = [],
  selectionLimit = 6,
  now = null,
} = {}) {
  const payload = stableValue({
    attempted_story_ids: unique(attemptedIds).sort(),
    selection_limit: selectionLimit,
    candidates: asArray(candidates).map((candidate) => ({
      story_id: storyId(candidate),
      source_url: sourceUrl(candidate),
      source_age: sourceAgeMetadata(candidate, now),
      rights_eligibility: candidate.rights_eligibility || null,
      motion_eligibility: candidate.motion_eligibility || null,
      source_motion_coherence: candidate.source_motion_coherence || null,
    })),
    excluded: asArray(excluded).map((candidate) => ({
      story_id: storyId(candidate),
      reason_codes: unique(candidate.reason_codes).sort(),
      blockers: unique(candidate.blockers).sort(),
      duplicate_of_story_id: clean(candidate.duplicate_of_story_id) || null,
      source_motion_coherence: candidate.source_motion_coherence || null,
    })),
  });
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function selectAlternateCohortCandidates({
  primaryAttemptedStoryIds = [],
  reviewLocalPromotionCandidates = [],
  excludedStoryIds = [],
  excludedSourceFingerprints = [],
  maxCandidates = 6,
  now = new Date(),
} = {}) {
  const generatedAt = now instanceof Date ? now : new Date(now);
  const requestedLimit = Math.floor(Number(maxCandidates || 6) || 6);
  const selectionLimit = Math.min(6, Math.max(1, requestedLimit));
  const attemptedIds = new Set(
    asArray(primaryAttemptedStoryIds).map(clean).filter(Boolean),
  );
  const quarantinedStoryIds = new Set(
    asArray(excludedStoryIds).map(clean).filter(Boolean),
  );
  const quarantinedSourceFingerprints = new Set(
    asArray(excludedSourceFingerprints).map(clean).filter(Boolean),
  );
  const candidates = [];
  const excluded = [];
  const selectedIds = new Map();
  const selectedSourceUrls = new Map();
  const inputCandidates = [...asArray(reviewLocalPromotionCandidates)]
    .sort((left, right) => candidatePriority(left, right, generatedAt));

  for (const candidate of inputCandidates) {
    const id = storyId(candidate);
    let reasonCodes = [];
    let blockers = [];
    let duplicateOfStoryId = "";
    let coherence = null;
    if (!id) {
      reasonCodes = ["candidate_identity_missing"];
    } else if (attemptedIds.has(id)) {
      reasonCodes = ["primary_attempted_story_id"];
    } else if (quarantinedStoryIds.has(id)) {
      reasonCodes = ["zero_yield_quarantine:story_id"];
    } else if (
      quarantinedSourceFingerprints.has(buildSourceFingerprint(candidate))
    ) {
      reasonCodes = ["zero_yield_quarantine:source"];
    } else if (isSameRssRetry(candidate, attemptedIds)) {
      reasonCodes = ["not_alternate_cohort:same_rss_retry"];
    } else if (!hasAlternateCohortProvenance(candidate)) {
      reasonCodes = [
        "not_alternate_cohort:review_local_promotion_provenance_missing",
      ];
    } else if (sourceAgeIsUnknown(candidate, generatedAt)) {
      reasonCodes = ["source_age_unknown"];
    } else if (sourceAgeIsExpired(candidate, generatedAt)) {
      reasonCodes = ["source_age_expired"];
    } else {
      const blocked = blockedDecision(candidate);
      if (blocked) {
        reasonCodes = blocked.reason_codes;
        blockers = blocked.blockers;
      } else {
        const coherenceResult = coherenceDecision(candidate);
        coherence = coherenceResult.evidence;
        if (coherence.status !== "pass") {
          reasonCodes = coherenceResult.reason_codes;
        }
      }
    }

    const explicitDuplicateOf = clean(
      candidate.duplicate_of_story_id || candidate.duplicate_of,
    );
    const candidateSourceUrl = sourceUrl(candidate);
    if (!reasonCodes.length && explicitDuplicateOf) {
      reasonCodes = ["duplicate_candidate:explicit"];
      duplicateOfStoryId = explicitDuplicateOf;
    } else if (!reasonCodes.length && selectedIds.has(id)) {
      reasonCodes = ["duplicate_candidate:story_id"];
      duplicateOfStoryId = selectedIds.get(id);
    } else if (
      !reasonCodes.length &&
      candidateSourceUrl &&
      selectedSourceUrls.has(candidateSourceUrl)
    ) {
      reasonCodes = ["duplicate_candidate:source_url"];
      duplicateOfStoryId = selectedSourceUrls.get(candidateSourceUrl);
    }

    if (reasonCodes.length) {
      excluded.push({
        story_id: id,
        reason_codes: reasonCodes,
        ...(blockers.length ? { blockers } : {}),
        ...(duplicateOfStoryId
          ? { duplicate_of_story_id: duplicateOfStoryId }
          : {}),
        ...(coherence &&
        reasonCodes.some((reason) =>
          reason.startsWith("source_motion_coherence:"))
          ? { source_motion_coherence: coherence }
          : {}),
      });
    } else {
      const sourceAge = sourceAgeMetadata(candidate, generatedAt);
      coherence = coherence || coherenceDecision(candidate).evidence;
      candidates.push({
        ...candidate,
        story_id: id,
        source_motion_coherence: coherence,
        alternate_cohort_eligibility: {
          source_age: {
            ...sourceAge,
            eligible:
              Boolean(sourceAge.state) &&
              !["expired", "stale", "fail", "failed", "blocked", "red"]
                .includes(sourceAge.state),
          },
          rights: candidate.rights_eligibility || null,
          motion: candidate.motion_eligibility || null,
          source_to_motion: coherence,
        },
      });
      selectedIds.set(id, id);
      if (candidateSourceUrl) selectedSourceUrls.set(candidateSourceUrl, id);
    }
  }

  candidates.sort((left, right) =>
    candidatePriority(left, right, generatedAt));
  const overflow = candidates.splice(selectionLimit);
  for (const candidate of overflow) {
    excluded.push({
      story_id: storyId(candidate),
      reason_codes: ["selection_limit_exceeded"],
    });
  }
  excluded.sort((left, right) =>
    storyId(left).localeCompare(storyId(right)));

  const report = {
    schema_version: 1,
    mode: "ALTERNATE_COHORT_CANDIDATE_SELECTION",
    generated_at: generatedAt.toISOString(),
    candidates,
    excluded,
    summary: {
      input_count: asArray(reviewLocalPromotionCandidates).length,
      selected_count: candidates.length,
      excluded_count: excluded.length,
      selection_limit: selectionLimit,
      same_rss_retry_count: excluded.filter((row) =>
        row.reason_codes.includes("not_alternate_cohort:same_rss_retry"))
        .length,
      duplicate_count: excluded.filter((row) =>
        row.reason_codes.some((reason) => reason.startsWith("duplicate_candidate:")))
        .length,
      zero_yield_quarantine_count: excluded.filter((row) =>
        row.reason_codes.some((reason) =>
          reason.startsWith("zero_yield_quarantine:")))
        .length,
      source_motion_coherence_rejection_count: excluded.filter((row) =>
        row.reason_codes.some((reason) =>
          reason.startsWith("source_motion_coherence:")))
        .length,
    },
    safety: {
      read_only: true,
      publish_authorised: false,
      no_db_mutation: true,
      no_network_request: true,
    },
  };
  report.selection_fingerprint = selectionFingerprint({
    attemptedIds: [...attemptedIds],
    candidates,
    excluded,
    selectionLimit,
    now: generatedAt,
  });
  report.stable_fingerprint = report.selection_fingerprint;
  return report;
}

module.exports = {
  selectAlternateCohortCandidates,
  selectionFingerprint,
  sourceMotionCoherence,
};
