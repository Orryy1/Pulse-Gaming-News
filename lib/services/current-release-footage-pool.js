"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

function parseJsonFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function stableJitter(seed, candidateId) {
  const digest = crypto.createHash("sha256").update(`${seed}:${candidateId}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function daysBetween(earlier, later) {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 86400000);
}

function asStringSet(values) {
  return new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
}

function validatePool(pool) {
  if (!pool || pool.schema_version !== "pulse-current-release-footage-pool-v1") {
    throw new Error("invalid current-release footage pool schema");
  }
  if (!Array.isArray(pool.candidates) || pool.candidates.length < 1) {
    throw new Error("current-release footage pool is empty");
  }
  if (!pool.generated_at || !Number.isFinite(Date.parse(pool.generated_at))) {
    throw new Error("current-release footage pool lacks a valid generated_at");
  }
  const policy = pool.selection_policy || {};
  const maxSnapshotAge = Number(policy.max_snapshot_age_hours);
  if (!Number.isFinite(maxSnapshotAge) || maxSnapshotAge <= 0) {
    throw new Error("current-release footage pool lacks max_snapshot_age_hours");
  }
  const scoreGap = Number(policy.top_band_max_score_gap);
  if (!Number.isFinite(scoreGap) || scoreGap < 0) {
    throw new Error("current-release footage pool lacks top_band_max_score_gap");
  }

  const allow = new Set(pool.official_channel_allowlist || []);
  const ids = new Set();
  for (const candidate of pool.candidates) {
    if (!candidate.id || ids.has(candidate.id)) {
      throw new Error(`duplicate or missing candidate id: ${candidate.id}`);
    }
    ids.add(candidate.id);
    if (!candidate.youtube_video_id || !candidate.official_channel_id) {
      throw new Error(`candidate ${candidate.id} lacks source identity`);
    }
    if (!allow.has(candidate.official_channel_id)) {
      throw new Error(`candidate ${candidate.id} uses a non-allowlisted channel`);
    }
    if (!candidate.current_until || !Number.isFinite(Date.parse(candidate.current_until))) {
      throw new Error(`candidate ${candidate.id} lacks current_until`);
    }
    if (!Array.isArray(candidate.topic_tags) || candidate.topic_tags.length < 1) {
      throw new Error(`candidate ${candidate.id} lacks topic tags`);
    }
    if (!candidate.content_type) {
      throw new Error(`candidate ${candidate.id} lacks content_type`);
    }
    if (!Array.isArray(candidate.visual_traits) || candidate.visual_traits.length < 1) {
      throw new Error(`candidate ${candidate.id} lacks visual_traits`);
    }
    if (!Array.isArray(candidate.approved_story_ids) || candidate.approved_story_ids.length < 1) {
      throw new Error(`candidate ${candidate.id} lacks approved_story_ids`);
    }
  }
  return pool;
}

function loadPool(filePath) {
  return validatePool(parseJsonFile(filePath));
}

function isPoolSnapshotFresh(pool, options = {}) {
  validatePool(pool);
  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now || Date.now());
  const generatedAt = new Date(pool.generated_at);
  const ageHours = (now.getTime() - generatedAt.getTime()) / 3600000;
  const maxAgeHours = Number(pool.selection_policy.max_snapshot_age_hours);
  return {
    fresh: ageHours >= -0.25 && ageHours <= maxAgeHours,
    ageHours: Number(ageHours.toFixed(6)),
    maxAgeHours,
  };
}

function currentViews(candidate, statsByVideoId) {
  const remote = statsByVideoId?.[candidate.youtube_video_id];
  if (remote && Number.isFinite(Number(remote.views))) return Number(remote.views);
  return Number(candidate.snapshot?.views || 0);
}

function isCandidateEligible(candidate, pool, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const allow = new Set(pool.official_channel_allowlist || []);
  if (!allow.has(candidate.official_channel_id)) {
    return { eligible: false, reason: "channel_not_allowlisted" };
  }
  if (new Date(candidate.current_until).getTime() < now.getTime()) {
    return { eligible: false, reason: "market_window_expired" };
  }
  if (candidate.rights_class !== "official-source-editorial-private-review") {
    return { eligible: false, reason: "rights_class_not_private_review" };
  }
  const remote = options.statsByVideoId?.[candidate.youtube_video_id];
  const snapshot = candidate.snapshot || {};
  if (snapshot.channel_id && snapshot.channel_id !== candidate.official_channel_id) {
    return { eligible: false, reason: "snapshot_channel_mismatch" };
  }
  if (snapshot.privacy_status && snapshot.privacy_status !== "public") {
    return { eligible: false, reason: "snapshot_source_not_public" };
  }
  if (remote && remote.channelId && remote.channelId !== candidate.official_channel_id) {
    return { eligible: false, reason: "remote_channel_mismatch" };
  }
  if (remote && remote.privacyStatus && remote.privacyStatus !== "public") {
    return { eligible: false, reason: "source_not_public" };
  }
  const views = currentViews(candidate, options.statsByVideoId);
  const policy = pool.selection_policy;
  const ageDays = daysBetween(new Date(candidate.published_at), now);
  const popularEnough = views >= policy.minimum_views;
  const freshEnough = ageDays <= policy.recent_upload_days && views >= policy.recent_minimum_views;
  if (!popularEnough && !freshEnough) {
    return { eligible: false, reason: "insufficient_heat" };
  }
  return { eligible: true, views, ageDays };
}

function evaluateSemanticFit(candidate, options = {}) {
  const storyId = options.storyId ? String(options.storyId) : null;
  const approvedStories = asStringSet(candidate.approved_story_ids);
  if (storyId && !approvedStories.has(storyId)) {
    return { fit: false, reason: "story_not_approved", storyId };
  }

  const topicTags = asStringSet(options.topicTags);
  const matchedTags = candidate.topic_tags.filter((tag) => topicTags.has(tag));
  const minimumTopicMatches = Number.isFinite(Number(options.minimumTopicMatches))
    ? Math.max(0, Number(options.minimumTopicMatches))
    : topicTags.size > 0
      ? 1
      : 0;
  if (matchedTags.length < minimumTopicMatches) {
    return {
      fit: false,
      reason: "insufficient_topic_fit",
      matchedTags,
      minimumTopicMatches,
    };
  }

  const allowedContentTypes = asStringSet(options.allowedContentTypes);
  if (allowedContentTypes.size > 0 && !allowedContentTypes.has(candidate.content_type)) {
    return {
      fit: false,
      reason: "content_type_not_allowed",
      contentType: candidate.content_type,
    };
  }

  const candidateTraits = asStringSet(candidate.visual_traits);
  const requiredTraits = [...asStringSet(options.requiredVisualTraits)];
  const missingTraits = requiredTraits.filter((trait) => !candidateTraits.has(trait));
  if (missingTraits.length > 0) {
    return { fit: false, reason: "required_visual_traits_missing", missingTraits };
  }

  const forbiddenTraits = [...asStringSet(options.forbiddenVisualTraits)];
  const blockedTraits = forbiddenTraits.filter((trait) => candidateTraits.has(trait));
  if (blockedTraits.length > 0) {
    return { fit: false, reason: "forbidden_visual_traits_present", blockedTraits };
  }

  return {
    fit: true,
    storyId,
    matchedTags,
    minimumTopicMatches,
    contentType: candidate.content_type,
    matchedRequiredTraits: requiredTraits,
  };
}

function scoreCandidate(candidate, pool, options = {}) {
  const eligibility = isCandidateEligible(candidate, pool, options);
  if (!eligibility.eligible) return { ...eligibility, score: -Infinity };
  const semantic = evaluateSemanticFit(candidate, options);
  if (!semantic.fit) return { eligible: false, ...semantic, score: -Infinity };

  const viewsScore = Math.log10(Math.max(1, eligibility.views)) * 10;
  const freshnessScore = Math.max(0, 45 - Math.min(45, eligibility.ageDays)) * 0.25;
  const topicScore = semantic.matchedTags.length * 24;
  const traitScore = semantic.matchedRequiredTraits.length * 4;
  const jitter = stableJitter(options.seed || "pulse", candidate.id) * 4;
  return {
    eligible: true,
    score: Number((viewsScore + freshnessScore + topicScore + traitScore + jitter).toFixed(6)),
    views: eligibility.views,
    ageDays: Number(eligibility.ageDays.toFixed(3)),
    matchedTags: semantic.matchedTags,
    matchedRequiredTraits: semantic.matchedRequiredTraits,
    contentType: semantic.contentType,
    jitter: Number(jitter.toFixed(6)),
  };
}

function selectCurrentReleaseFootage(pool, options = {}) {
  validatePool(pool);
  const usedIds = new Set(options.usedIds || []);
  const scored = pool.candidates
    .map((candidate) => ({ candidate, evaluation: scoreCandidate(candidate, pool, options) }))
    .filter((row) => row.evaluation.eligible && !usedIds.has(row.candidate.id))
    .sort((a, b) => b.evaluation.score - a.evaluation.score || a.candidate.id.localeCompare(b.candidate.id));
  if (!scored.length) {
    throw new Error("no eligible current-release footage candidate remains after semantic fit and cooldown");
  }

  const topBandSize = Math.max(1, Number(pool.selection_policy.top_band_size || 1));
  const maxScoreGap = Math.max(0, Number(pool.selection_policy.top_band_max_score_gap || 0));
  const bestScore = scored[0].evaluation.score;
  const topBand = scored
    .filter((row) => bestScore - row.evaluation.score <= maxScoreGap)
    .slice(0, topBandSize);
  const choiceIndex = Math.floor(
    stableJitter(`${options.seed || "pulse"}:choice`, options.storyId || "story") * topBand.length,
  );
  const selected = topBand[Math.min(choiceIndex, topBand.length - 1)];
  return {
    story_id: options.storyId || null,
    selected: selected.candidate,
    evaluation: selected.evaluation,
    top_band: topBand.map((row) => ({
      id: row.candidate.id,
      game: row.candidate.game,
      score: row.evaluation.score,
      matched_tags: row.evaluation.matchedTags,
      content_type: row.candidate.content_type,
    })),
  };
}

function assignCurrentReleaseFootage(pool, storySpecs, options = {}) {
  const assignments = [];
  const recent = [];
  const cooldown = Math.max(0, Number(pool.selection_policy.cooldown_slots || 0));
  for (const story of storySpecs) {
    const usedIds = recent.slice(-cooldown);
    const result = selectCurrentReleaseFootage(pool, {
      ...options,
      storyId: story.story_id,
      topicTags: story.topic_tags,
      minimumTopicMatches: story.minimum_topic_matches,
      allowedContentTypes: story.allowed_content_types,
      requiredVisualTraits: story.required_visual_traits,
      forbiddenVisualTraits: story.forbidden_visual_traits,
      seed: `${options.seed || "pulse"}:${story.story_id}`,
      usedIds,
    });
    recent.push(result.selected.id);
    assignments.push({
      ...result,
      topic_tags: story.topic_tags,
      semantic_requirements: {
        minimum_topic_matches: story.minimum_topic_matches,
        allowed_content_types: story.allowed_content_types,
        required_visual_traits: story.required_visual_traits,
        forbidden_visual_traits: story.forbidden_visual_traits,
      },
    });
  }
  return assignments;
}

module.exports = {
  assignCurrentReleaseFootage,
  evaluateSemanticFit,
  isCandidateEligible,
  isPoolSnapshotFresh,
  loadPool,
  scoreCandidate,
  selectCurrentReleaseFootage,
  validatePool,
};
