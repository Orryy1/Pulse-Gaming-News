"use strict";

const crypto = require("node:crypto");
const {
  BREAKING_SOURCE_POLICY,
} = require("./breaking-source-policy");

const EDITORIAL_EVIDENCE_JOB_KIND =
  "governed_editorial_evidence_discovery";
const INGRESS_SCHEMA =
  "pulse-governed-editorial-evidence-ingress-v1";
const DEFAULT_MAX_AGE_HOURS = 7 * 24;
const MAXIMUM_OFFICIAL_BACKFILL_STORIES = 6;

function text(value) {
  return String(value ?? "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function isoTimestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : null;
}

function parseArrayEvidence(value) {
  if (Array.isArray(value)) {
    return { valid: true, value };
  }
  try {
    const parsed = JSON.parse(text(value));
    return Array.isArray(parsed)
      ? { valid: true, value: parsed }
      : { valid: false, value: [] };
  } catch {
    return { valid: false, value: [] };
  }
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(text(value) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function sourceUrl(story = {}) {
  return text(
    story.source_url ||
      story.primary_source_url ||
      story.article_url ||
      story.url,
  );
}

function hostMatches(hostname, configuredHost) {
  const candidate = text(hostname).toLowerCase();
  const configured = text(configuredHost)
    .toLowerCase()
    .replace(/^\.+/, "");
  return (
    Boolean(candidate && configured) &&
    (candidate === configured ||
      candidate.endsWith(`.${configured}`))
  );
}

function classifyGovernedSource(url, sourcePolicy = {}) {
  let hostname = "";
  try {
    const parsed = new URL(text(url));
    if (parsed.protocol !== "https:") return null;
    hostname = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const policy of sourcePolicy.official_first_party || []) {
    if (
      (policy.hosts || []).some((host) =>
        hostMatches(hostname, host),
      )
    ) {
      return {
        source_class: "OFFICIAL_FIRST_PARTY",
        source_id: text(policy.source_id) || null,
        hostname,
      };
    }
  }
  for (const policy of sourcePolicy.trusted_editorial || []) {
    if (
      (policy.hosts || []).some((host) =>
        hostMatches(hostname, host),
      )
    ) {
      return {
        source_class: "TRUSTED_EDITORIAL",
        source_id: text(policy.source_id) || null,
        hostname,
      };
    }
  }
  return null;
}

function sanitiseStory(story = {}) {
  return {
    id: text(story.id || story.story_id),
    title: text(story.title),
    source_url: sourceUrl(story),
    source_type: text(story.source_type).toLowerCase() || null,
    source_name:
      text(story.subreddit || story.source_name) || null,
    published_at: isoTimestamp(
      story.published_at ||
        story.timestamp ||
        story.created_at,
    ),
    channel_id:
      text(story.channel_id || "pulse-gaming") ||
      "pulse-gaming",
    franchise:
      text(story.franchise || story.game_name || story.game_title) ||
      null,
    platform:
      text(story.platform || story.target_platform) || null,
    topic_key: text(story.topic_key) || null,
    subject_ids: [
      ...new Set(
        (Array.isArray(story.subject_ids)
          ? story.subject_ids
          : [])
          .map((value) => text(value).toLowerCase())
          .filter(Boolean),
      ),
    ].slice(0, 12),
  };
}

function governedEditorialEvidenceFingerprint({
  story,
  latest_decision: latestDecision,
} = {}) {
  return sha256({
    story,
    latest_decision: latestDecision,
  });
}

function normaliseDecision(latestDecision = {}) {
  const source =
    latestDecision &&
    typeof latestDecision === "object" &&
    !Array.isArray(latestDecision)
      ? latestDecision
      : {};
  const inputs = parseObject(source.inputs);
  const hardStops = parseArrayEvidence(source.hard_stops);
  return {
    story_id: text(source.story_id),
    channel_id:
      text(source.channel_id || "pulse-gaming") ||
      "pulse-gaming",
    decision: text(source.decision).toLowerCase(),
    total: Number.isFinite(Number(source.total))
      ? Number(source.total)
      : null,
    hard_stops: hardStops.value
      .map(text)
      .filter(Boolean),
    hard_stops_valid: hardStops.valid,
    topicality_decision: text(
      inputs.topicality_decision ||
        source.topicality_decision ||
        source.topicality?.decision,
    ).toLowerCase(),
    scored_at: isoTimestamp(source.scored_at),
    scorer_version: text(source.scorer_version) || null,
  };
}

function assessGovernedEditorialEvidenceCandidate({
  story,
  latestDecision,
  now = new Date().toISOString(),
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  sourcePolicy = BREAKING_SOURCE_POLICY,
} = {}) {
  const generatedAt = isoTimestamp(now);
  if (!generatedAt) {
    throw new Error("governed_editorial_evidence_time_invalid");
  }
  const cleanStory = sanitiseStory(story);
  const decision = normaliseDecision(latestDecision);
  const source = classifyGovernedSource(
    cleanStory.source_url,
    sourcePolicy,
  );
  const blockers = [];
  if (!cleanStory.id) blockers.push("editorial_story_id_required");
  if (!cleanStory.title) blockers.push("editorial_story_title_required");
  if (!/^https:\/\//i.test(cleanStory.source_url)) {
    blockers.push("editorial_source_https_url_required");
  }
  if (!source) {
    blockers.push(
      "governed_editorial_source_policy_match_required",
    );
  }
  if (!cleanStory.published_at) {
    blockers.push("editorial_story_published_at_required");
  } else {
    const ageMs =
      Date.parse(generatedAt) - Date.parse(cleanStory.published_at);
    const maximumMs =
      Math.max(1, Number(maxAgeHours) || DEFAULT_MAX_AGE_HOURS) *
      3_600_000;
    if (ageMs < -5 * 60_000) {
      blockers.push("editorial_story_future_timestamp_forbidden");
    } else if (ageMs > maximumMs) {
      blockers.push("editorial_story_outside_current_window");
    }
  }
  if (decision.story_id !== cleanStory.id) {
    blockers.push("governed_decision_story_id_mismatch");
  }
  if (!["auto", "review"].includes(decision.decision)) {
    blockers.push("governed_decision_auto_or_review_required");
  }
  if (decision.hard_stops.length > 0) {
    blockers.push("governed_decision_hard_stops_must_be_clear");
  }
  if (decision.hard_stops_valid !== true) {
    blockers.push("governed_decision_hard_stops_invalid");
  }
  if (decision.topicality_decision !== "accept") {
    blockers.push("governed_gaming_topicality_acceptance_required");
  }
  if (!decision.scored_at || !decision.scorer_version) {
    blockers.push("latest_governed_decision_evidence_required");
  }
  return {
    schema_version: INGRESS_SCHEMA,
    generated_at: generatedAt,
    eligible: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
    story: cleanStory,
    source,
    latest_decision: decision,
    safety: {
      breaking_classification_created: false,
      publish_authority_created: false,
      external_posting_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
}

function enqueueGovernedEditorialEvidence({
  story,
  latestDecision,
  jobs,
  now = new Date().toISOString(),
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  sourcePolicy = BREAKING_SOURCE_POLICY,
} = {}) {
  if (!jobs || typeof jobs.enqueue !== "function") {
    throw new Error(
      "governed_editorial_evidence_jobs_repository_required",
    );
  }
  const assessment = assessGovernedEditorialEvidenceCandidate({
    story,
    latestDecision,
    now,
    maxAgeHours,
    sourcePolicy,
  });
  if (!assessment.eligible) {
    return {
      queued: false,
      reason: "governed_editorial_evidence_candidate_held",
      assessment,
      job: null,
    };
  }
  const fingerprint = governedEditorialEvidenceFingerprint({
    story: assessment.story,
    latest_decision: assessment.latest_decision,
  });
  const payload = {
    schema_version: INGRESS_SCHEMA,
    generated_at: assessment.generated_at,
    scope: "governed_editorial_inventory_supply",
    story: assessment.story,
    latest_governed_decision: assessment.latest_decision,
    evidence_fingerprint_sha256: fingerprint,
    requested_action: "capture_governed_editorial_evidence",
    publish_authority: false,
    external_posting_authorised: false,
    oauth_mutation_authorised: false,
    human_review_required: true,
  };
  const request = {
    kind: EDITORIAL_EVIDENCE_JOB_KIND,
    channel_id: assessment.story.channel_id,
    story_id: assessment.story.id,
    payload,
    priority: 14,
    requires_gpu: false,
    max_attempts: 3,
    idempotency_key:
      `governed-editorial-evidence:${assessment.story.id}:` +
      fingerprint,
  };
  let job;
  try {
    job = jobs.enqueue(request);
  } catch (error) {
    if (
      text(error?.code) !== "job_idempotency_conflict" &&
      text(error?.message) !== "job_idempotency_conflict"
    ) {
      throw error;
    }
    return {
      queued: false,
      reason: "governed_editorial_evidence_already_scheduled",
      assessment,
      fingerprint_sha256: fingerprint,
      job: null,
    };
  }
  return {
    queued: true,
    reason: "governed_editorial_evidence_enqueued",
    assessment,
    fingerprint_sha256: fingerprint,
    job,
  };
}

function decisionIndex(latestDecisions) {
  if (latestDecisions instanceof Map) {
    return new Map(latestDecisions);
  }
  if (
    latestDecisions &&
    typeof latestDecisions === "object" &&
    !Array.isArray(latestDecisions)
  ) {
    return new Map(Object.entries(latestDecisions));
  }
  const indexed = new Map();
  for (const decision of latestDecisions || []) {
    const storyId = text(decision?.story_id);
    if (!storyId) continue;
    const existing = indexed.get(storyId);
    const candidateTime = Date.parse(
      text(decision?.scored_at),
    );
    const existingTime = Date.parse(
      text(existing?.scored_at),
    );
    if (
      !existing ||
      (Number.isFinite(candidateTime) &&
        (!Number.isFinite(existingTime) ||
          candidateTime >= existingTime))
    ) {
      indexed.set(storyId, decision);
    }
  }
  return indexed;
}

function backfillOrder(left, right) {
  const leftAuto =
    left.assessment.latest_decision.decision === "auto" ? 1 : 0;
  const rightAuto =
    right.assessment.latest_decision.decision === "auto" ? 1 : 0;
  if (leftAuto !== rightAuto) return rightAuto - leftAuto;
  const scoreDelta =
    Number(right.assessment.latest_decision.total || 0) -
    Number(left.assessment.latest_decision.total || 0);
  if (scoreDelta) return scoreDelta;
  const timeDelta =
    Date.parse(right.assessment.story.published_at || "") -
    Date.parse(left.assessment.story.published_at || "");
  if (Number.isFinite(timeDelta) && timeDelta) return timeDelta;
  return left.assessment.story.id.localeCompare(
    right.assessment.story.id,
  );
}

function selectGovernedEditorialEvidenceBackfill({
  stories = [],
  latestDecisions = [],
  recentAttemptedStoryIds = [],
  requestedLimit = MAXIMUM_OFFICIAL_BACKFILL_STORIES,
  now = new Date().toISOString(),
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  sourcePolicy = BREAKING_SOURCE_POLICY,
} = {}) {
  const decisions = decisionIndex(latestDecisions);
  const recentAttempts = new Set(
    (Array.isArray(recentAttemptedStoryIds) ||
    recentAttemptedStoryIds instanceof Set
      ? [...recentAttemptedStoryIds]
      : []
    )
      .map(text)
      .filter(Boolean),
  );
  const numericLimit = Number(requestedLimit);
  const limit = Math.max(
    1,
    Math.min(
      MAXIMUM_OFFICIAL_BACKFILL_STORIES,
      Number.isInteger(numericLimit)
        ? numericLimit
        : MAXIMUM_OFFICIAL_BACKFILL_STORIES,
    ),
  );
  const accepted = [];
  const rejected = [];
  const seenStoryIds = new Set();
  for (const inputStory of stories) {
    const storyId = text(inputStory?.id || inputStory?.story_id);
    if (!storyId || seenStoryIds.has(storyId)) {
      rejected.push({
        story_id: storyId || null,
        blockers: [
          storyId
            ? "editorial_backfill_story_duplicate"
            : "editorial_story_id_required",
        ],
      });
      continue;
    }
    seenStoryIds.add(storyId);
    const assessment = assessGovernedEditorialEvidenceCandidate({
      story: inputStory,
      latestDecision: decisions.get(storyId) || {},
      now,
      maxAgeHours,
      sourcePolicy,
    });
    const source = assessment.source;
    const blockers = [...assessment.blockers];
    if (source?.source_class !== "OFFICIAL_FIRST_PARTY") {
      blockers.push("editorial_official_source_required");
    }
    if (recentAttempts.has(storyId)) {
      blockers.push("editorial_backfill_story_recently_attempted");
    }
    if (blockers.length > 0) {
      rejected.push({
        story_id: storyId,
        blockers: [...new Set(blockers)].sort(),
      });
      continue;
    }
    accepted.push({ assessment, source });
  }
  accepted.sort(backfillOrder);
  const selected = accepted.slice(0, limit).map((item) => ({
    story: item.assessment.story,
    latest_decision: item.assessment.latest_decision,
    source_class: item.source.source_class,
    source_id: item.source.source_id,
  }));
  const deferred = accepted.slice(limit).map((item) => ({
    story_id: item.assessment.story.id,
    blocker: "editorial_backfill_capacity_reached",
  }));
  return {
    schema_version:
      "pulse-governed-editorial-evidence-backfill-selection-v1",
    generated_at: isoTimestamp(now),
    mode: "LOCAL_PROOF",
    limit,
    selected,
    deferred,
    rejected,
    summary: {
      input_count: stories.length,
      eligible_count: accepted.length,
      selected_count: selected.length,
      deferred_count: deferred.length,
      rejected_count: rejected.length,
    },
    safety: {
      official_source_only: true,
      breaking_classification_created: false,
      publish_authority_created: false,
      external_posting_authorised: false,
      oauth_mutation_authorised: false,
    },
  };
}

module.exports = {
  DEFAULT_MAX_AGE_HOURS,
  EDITORIAL_EVIDENCE_JOB_KIND,
  INGRESS_SCHEMA,
  MAXIMUM_OFFICIAL_BACKFILL_STORIES,
  assessGovernedEditorialEvidenceCandidate,
  classifyGovernedSource,
  enqueueGovernedEditorialEvidence,
  governedEditorialEvidenceFingerprint,
  selectGovernedEditorialEvidenceBackfill,
};
