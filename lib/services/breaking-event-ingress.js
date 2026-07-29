"use strict";

const crypto = require("node:crypto");

const BREAKING_SCORE_FLOOR = 80;

function text(value) {
  return String(value || "").trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function safeTimestamp(value, fallback) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : fallback;
}

function inferSubjectIds(story = {}) {
  const explicit = Array.isArray(story.subject_ids)
    ? story.subject_ids
    : [];
  const haystack = [
    story.title,
    story.subreddit,
    story.source_name,
    story.url,
    story.article_url,
    story.primary_source_url,
  ]
    .map(text)
    .join(" ")
    .toLowerCase();
  const inferred = [
    [/\b(?:xbox|microsoft gaming|game pass)\b/i, "xbox"],
    [/\b(?:playstation|ps4|ps5|sony interactive)\b/i, "playstation"],
    [/\b(?:nintendo|switch)\b/i, "nintendo"],
    [/\b(?:steam|valve)\b/i, "steam"],
    [/\b(?:electronic arts|\bea\b)\b/i, "ea"],
    [/\bubisoft\b/i, "ubisoft"],
    [/\b(?:bethesda|elder scrolls|fallout)\b/i, "bethesda"],
  ]
    .filter(([pattern]) => pattern.test(haystack))
    .map(([, id]) => id);
  return Object.freeze(
    [...new Set([...explicit, ...inferred].map(text).filter(Boolean))]
      .map((value) => value.toLowerCase())
      .slice(0, 12),
  );
}

function sourceCandidates(story = {}) {
  const explicit = Array.isArray(story.source_candidates)
    ? story.source_candidates.map((candidate) =>
        typeof candidate === "string" ? candidate : candidate?.url,
      )
    : [];
  return Object.freeze(
    [
      ...new Set(
        [
          ...explicit,
          story.primary_source_url,
          story.article_url,
          story.url,
        ]
          .map(text)
          .filter(Boolean),
      ),
    ].slice(0, 8),
  );
}

function sanitiseStory(story = {}, generatedAt) {
  const articleUrl = text(story.article_url || story.url);
  return Object.freeze({
    id: text(story.id),
    title: text(story.title),
    discovery_url: text(story.url || articleUrl),
    article_url: articleUrl,
    source_type: text(story.source_type).toLowerCase() || "unknown",
    source_name: text(story.subreddit || story.source_name),
    breaking_score: number(story.breaking_score),
    breaking_trigger: text(story.breaking_trigger),
    discovered_at: safeTimestamp(story.timestamp, generatedAt),
    primary_source_url: text(story.primary_source_url),
    verification_status: text(story.verification_status).toUpperCase(),
    source_evidence_sha256: text(
      story.source_evidence_sha256,
    ).toLowerCase(),
    subject_ids: inferSubjectIds(story),
    source_candidates: sourceCandidates(story),
  });
}

function buildBreakingEventEnvelope({
  story = {},
  now = new Date().toISOString(),
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("breaking_event_time_invalid");
  }
  const generatedAtIso = generatedAt.toISOString();
  const cleanStory = sanitiseStory(story, generatedAtIso);
  const blockers = [];

  if (!cleanStory.id) blockers.push("story_id_required");
  if (!cleanStory.title) blockers.push("story_title_required");
  if (cleanStory.breaking_score < BREAKING_SCORE_FLOOR) {
    blockers.push("breaking_score_below_80");
  }

  const explicitlyConfirmed =
    cleanStory.verification_status === "CONFIRMED";
  const validPrimarySource =
    /^https?:\/\//i.test(cleanStory.primary_source_url);
  const validSourceEvidence =
    /^[a-f0-9]{64}$/.test(cleanStory.source_evidence_sha256);
  if (!explicitlyConfirmed || !validPrimarySource) {
    blockers.push("primary_source_verification_required");
  } else if (!validSourceEvidence) {
    blockers.push("source_evidence_sha256_required");
  }

  const hardBlockers = blockers.filter(
    (code) => code !== "primary_source_verification_required",
  );
  const verifiedForProduction =
    explicitlyConfirmed &&
    validPrimarySource &&
    validSourceEvidence &&
    hardBlockers.length === 0;
  const verdict =
    hardBlockers.length > 0
      ? "HOLD"
      : verifiedForProduction
        ? "READY_FOR_PLANNING"
        : "DISCOVERY_ONLY";
  const fingerprintInput = {
    id: cleanStory.id,
    title: cleanStory.title,
    article_url: cleanStory.article_url,
    primary_source_url: cleanStory.primary_source_url,
    source_evidence_sha256: cleanStory.source_evidence_sha256,
    subject_ids: cleanStory.subject_ids,
    source_candidates: cleanStory.source_candidates,
  };

  return Object.freeze({
    schema_version: "pulse-breaking-event-envelope-v1",
    generated_at: generatedAtIso,
    verdict,
    blockers: Object.freeze(blockers),
    story: cleanStory,
    lane_id: "breaking_short",
    priority: "CRITICAL",
    service_level_minutes: 30,
    verified_for_production: verifiedForProduction,
    publish_authority: false,
    auto_approved: false,
    fingerprint_sha256: sha256(stableJson(fingerprintInput)),
    safety: Object.freeze({
      discovery_is_not_verification: true,
      no_script_generation_authority: true,
      no_external_posting_authority: true,
      human_admission_required: true,
    }),
  });
}

function isJobIdempotencyConflict(error) {
  return (
    text(error?.code) === "job_idempotency_conflict" ||
    text(error?.message) === "job_idempotency_conflict"
  );
}

function breakingDiscoveryRequestIdentity(request = {}) {
  const payload =
    request.payload &&
    typeof request.payload === "object" &&
    !Array.isArray(request.payload)
      ? request.payload
      : {};
  const {
    generated_at: observationTime,
    ...stablePayload
  } = payload;
  const story =
    stablePayload.story &&
    typeof stablePayload.story === "object" &&
    !Array.isArray(stablePayload.story)
      ? { ...stablePayload.story }
      : null;
  if (
    story &&
    text(story.discovered_at) === text(observationTime)
  ) {
    delete story.discovered_at;
    stablePayload.story = story;
  }
  return stableJson({
    kind: text(request.kind),
    channel_id: text(request.channel_id) || null,
    story_id: text(request.story_id) || null,
    payload: stablePayload,
    priority: number(request.priority, 50),
    max_attempts: number(request.max_attempts, 3),
    requires_gpu:
      request.requires_gpu === true ||
      number(request.requires_gpu, 0) === 1,
  });
}

function sameBreakingDiscoveryWork(existing, request) {
  return (
    existing &&
    breakingDiscoveryRequestIdentity(existing) ===
      breakingDiscoveryRequestIdentity(request)
  );
}

function enqueueBreakingEvent({
  story,
  jobs,
  now = new Date().toISOString(),
  channelId = "pulse-gaming",
} = {}) {
  if (!jobs || typeof jobs.enqueue !== "function") {
    throw new Error("breaking_event_jobs_repository_required");
  }
  const envelope = buildBreakingEventEnvelope({ story, now });
  if (envelope.verdict === "HOLD") {
    return Object.freeze({
      queued: false,
      reason: "breaking_event_held",
      envelope,
      job: null,
    });
  }
  const request = {
    kind: "breaking_story_discovery",
    channel_id: channelId,
    payload: {
      ...envelope,
      requested_action: "verify_and_plan",
    },
    priority: 5,
    requires_gpu: false,
    max_attempts: 3,
    idempotency_key:
      `breaking-discovery:${envelope.story.id}:` +
      envelope.fingerprint_sha256,
  };
  let job;
  try {
    job = jobs.enqueue(request);
  } catch (error) {
    if (
      !isJobIdempotencyConflict(error) ||
      typeof jobs.getByIdempotencyKey !== "function"
    ) {
      throw error;
    }
    const existing = jobs.getByIdempotencyKey(
      request.idempotency_key,
    );
    if (!sameBreakingDiscoveryWork(existing, request)) {
      throw error;
    }
    return Object.freeze({
      queued: false,
      reason: "durable_breaking_discovery_already_enqueued",
      envelope,
      job: existing,
    });
  }
  return Object.freeze({
    queued: true,
    reason: "durable_breaking_discovery_enqueued",
    envelope,
    job,
  });
}

module.exports = {
  BREAKING_SCORE_FLOOR,
  buildBreakingEventEnvelope,
  enqueueBreakingEvent,
};
