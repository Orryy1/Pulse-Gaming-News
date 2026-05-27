"use strict";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanKey(value) {
  return cleanText(value).toLowerCase();
}

function normaliseMatchText(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsNormalisedTerm(haystack, needle) {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function fullStoryText(story = {}) {
  return [
    story.title,
    story.hook,
    story.body,
    story.full_script,
    story.tts_script,
    story.source_name,
  ]
    .filter(Boolean)
    .join(". ");
}

function storyIdentityText(story = {}) {
  return [
    story.canonical_subject,
    story.canonical_game,
    story.title,
    story.suggested_title,
    story.short_title,
    story.suggested_thumbnail_text,
    story.source_card_label,
  ]
    .filter(Boolean)
    .join(". ");
}

function sourceEntities(source = {}) {
  return [
    cleanText(source.entity),
    ...asArray(source.entities).map(cleanText),
    cleanText(source.provenance?.entity),
  ].filter(Boolean);
}

function sourceText(source = {}) {
  return [
    source.display_name,
    source.source_family,
    source.source_id,
    source.reference_url,
    source.canonical_source_url,
    source.provenance?.official_evidence,
  ]
    .filter(Boolean)
    .join(" ");
}

function storyKeywordMatch(source = {}, story = {}) {
  const titleTokens = normaliseMatchText(storyIdentityText(story))
    .split(" ")
    .filter((token) => token.length > 3 && !["says", "with", "from", "into", "style"].includes(token));
  if (!titleTokens.length) return false;
  const sourceBlob = normaliseMatchText(sourceText(source));
  const matches = titleTokens.filter((token) => containsNormalisedTerm(sourceBlob, token));
  return matches.length >= Math.min(2, titleTokens.length);
}

function sourceMatchesStory(source = {}, story = {}) {
  const storyBlob = normaliseMatchText(storyIdentityText(story));
  const entities = sourceEntities(source).map(normaliseMatchText).filter(Boolean);
  if (entities.some((entity) => containsNormalisedTerm(storyBlob, entity))) return true;
  if (storyKeywordMatch(source, story)) return true;
  return false;
}

function isSteamMetricStory(story = {}) {
  const text = fullStoryText(story);
  return (
    /\b(?:steam|steamdb)\b/i.test(text) &&
    (/\b\d{1,3}(?:,\d{3})+\b/.test(text) || /\b\d{2,3}(?:\.\d+)?\s*k\b/i.test(text))
  );
}

function isReviewScoreStory(story = {}) {
  return /\b(?:metacritic|critic score|review score|aggregate)\b/i.test(
    fullStoryText(story),
  );
}

function sourceFamilyFor(source = {}) {
  return (
    cleanText(source.source_family) ||
    cleanText(source.trusted_footage_source_id) ||
    cleanText(source.source_id) ||
    cleanText(source.movie_id) ||
    cleanText(source.provider) ||
    "unknown"
  );
}

function storyId(story = {}) {
  return cleanText(story.id || story.story_id);
}

function trustedCandidatesForStory(report = {}, story = {}) {
  const wantedStoryId = storyId(story);
  return asArray(report.story_candidates)
    .filter((candidate) => {
      const candidateStoryId = cleanText(candidate.story_id);
      return !wantedStoryId || !candidateStoryId || candidateStoryId === wantedStoryId;
    })
    .filter((candidate) => sourceMatchesStory(candidate, story))
    .map((candidate) => ({
      source_id: cleanText(candidate.source_id),
      display_name: cleanText(candidate.display_name),
      entity: cleanText(candidate.entity),
      entities: sourceEntities(candidate),
      source_tier: cleanText(candidate.source_tier) || "unknown",
      source_family: sourceFamilyFor(candidate),
      reference_url: cleanText(candidate.reference_url),
      source_url_kind: cleanText(candidate.source_url_kind) || "unknown",
      segment_validation_eligible: candidate.segment_validation_eligible === true,
      autonomous_motion_candidate: candidate.autonomous_motion_candidate !== false,
      allowed_render_use:
        cleanText(candidate.allowed_render_use) || "reference_only_by_default",
      rights_risk_class:
        cleanText(candidate.rights_risk_class) || "official_reference_only",
      downloads_started: false,
    }))
    .filter((candidate) => candidate.source_family !== "unknown");
}

function acceptedSourcesForStory(report = {}, story = {}) {
  const candidates = trustedCandidatesForStory(report, story);
  if (candidates.length) return candidates;

  return asArray(report.accepted_sources)
    .filter((source) => sourceMatchesStory(source, story))
    .map((source) => ({
      source_id: cleanText(source.source_id),
      display_name: cleanText(source.display_name),
      entity: cleanText(asArray(source.entities)[0]),
      entities: sourceEntities(source),
      source_tier: cleanText(source.source_tier) || "unknown",
      source_family: sourceFamilyFor(source),
      reference_url: cleanText(source.reference_url),
      source_url_kind: cleanText(source.source_url_kind) || "unknown",
      segment_validation_eligible: source.segment_validation_eligible === true,
      autonomous_motion_candidate: source.autonomous_motion_candidate !== false,
      allowed_render_use:
        cleanText(source.allowed_render_use) || "reference_only_by_default",
      rights_risk_class:
        cleanText(source.rights_risk_class) || "official_reference_only",
      downloads_started: false,
    }))
    .filter((source) => source.source_family !== "unknown");
}

function localClipType(asset = {}) {
  return cleanKey(asset.type || asset.sceneType || asset.kind || "clip");
}

function looksLikeVideoPath(value) {
  return /\.(?:mp4|mov|m4v|webm|mkv|avi)(?:$|[?#])/i.test(cleanText(value));
}

function motionSourceKind(value) {
  const text = cleanText(value);
  if (/\.m3u8(?:$|\?)/i.test(text)) return "hls_manifest";
  if (looksLikeVideoPath(text)) return "video_file";
  return "unknown";
}

function validatedLocalMotionTrustEvidence(asset = {}) {
  const sourceType = normaliseMatchText(asset.source_type || asset.sourceType || asset.provider);
  const rightsRiskClass = normaliseMatchText(asset.rights_risk_class || asset.rightsRiskClass);
  const allowedRenderUse = normaliseMatchText(asset.allowed_render_use || asset.allowedRenderUse);
  const provider = normaliseMatchText(asset.provider || asset.source_family || asset.sourceFamily);

  const officialLikeSource =
    /\b(?:official|publisher|studio|storefront|game page|platform|steam|xbox|playstation|nintendo|epic|gog)\b/.test(
      [sourceType, provider].join(" "),
    );
  const rightsSafe =
    /\bofficial reference only\b/.test(rightsRiskClass) ||
    /\bofficial\b/.test(rightsRiskClass) ||
    /\breference only by default\b/.test(allowedRenderUse);

  if (!officialLikeSource || !rightsSafe) return null;
  return {
    trusted: true,
    source: "validated_official_local_motion",
  };
}

function validateLocalMotionAsset(asset = {}) {
  if (asset.validated === false) return "clip_not_validated";
  const type = localClipType(asset);
  if (["still", "image", "card", "card.stat", "card.timeline", "clip.frame"].includes(type)) {
    return "not_motion_video";
  }
  const kind = motionSourceKind(asset.path || asset.source || asset.file);
  if (kind === "unknown") {
    return "not_motion_video";
  }
  const duration = Number(asset.durationS ?? asset.duration_s ?? asset.duration);
  if (!Number.isFinite(duration) || duration < 1.2) return "clip_too_short";
  return null;
}

function localMotionInventory(localMotionClips = []) {
  const accepted = [];
  const rejected = [];

  for (const [index, rawAsset] of asArray(localMotionClips).entries()) {
    const asset = rawAsset && typeof rawAsset === "object" ? rawAsset : {};
    const reason = validateLocalMotionAsset(asset);
    const normalised = {
      id: cleanText(asset.id || asset.clip_id || `local_clip_${index + 1}`),
      source_family: sourceFamilyFor(asset),
      path: cleanText(asset.path || asset.source || asset.file),
      durationS: Number(asset.durationS ?? asset.duration_s ?? asset.duration) || null,
      validated: asset.validated !== false,
      type: localClipType(asset),
      source_type: cleanText(asset.source_type || asset.sourceType),
      provider: cleanText(asset.provider),
      allowed_render_use: cleanText(asset.allowed_render_use || asset.allowedRenderUse),
      rights_risk_class: cleanText(asset.rights_risk_class || asset.rightsRiskClass),
      source_kind: motionSourceKind(asset.path || asset.source || asset.file),
    };
    if (reason) {
      rejected.push({ ...normalised, reason });
      continue;
    }
    const trustEvidence = validatedLocalMotionTrustEvidence(asset);
    if (trustEvidence) {
      normalised.trust_evidence_source = trustEvidence.source;
      normalised.trusted_source_evidence = true;
    }
    accepted.push(normalised);
  }

  const familySet = new Set();
  for (const asset of accepted) familySet.add(asset.source_family);
  const trustedFamilySet = new Set();
  for (const asset of accepted) {
    if (asset.trusted_source_evidence) trustedFamilySet.add(asset.source_family);
  }

  return {
    accepted_local_clips: accepted,
    rejected_local_assets: rejected,
    distinct_source_families: [...familySet].filter(Boolean).sort(),
    trusted_local_source_families: [...trustedFamilySet].filter(Boolean).sort(),
  };
}

function priorityForSource(source = {}) {
  let score = 0;
  if (source.segment_validation_eligible) score += 80;
  if (source.source_url_kind === "hls_manifest" || source.source_url_kind === "direct_video") {
    score += 40;
  }
  if (source.source_tier === "licensed_creator") score += 38;
  if (source.source_tier === "official") score += 24;
  if (source.autonomous_motion_candidate) score += 12;
  if (/steam/i.test(source.source_family)) score += 8;
  return score;
}

function buildIntakeQueue(sources = []) {
  const seen = new Set();
  return asArray(sources)
    .filter((source) => {
      const family = sourceFamilyFor(source);
      if (seen.has(family)) return false;
      seen.add(family);
      return true;
    })
    .map((source) => ({
      source_id: source.source_id || null,
      display_name: source.display_name || source.source_family || "trusted source",
      entity: source.entity || null,
      entities: asArray(source.entities),
      source_family: sourceFamilyFor(source),
      source_tier: source.source_tier || "unknown",
      reference_url: source.reference_url || null,
      source_url_kind: source.source_url_kind || "unknown",
      segment_validation_eligible: source.segment_validation_eligible === true,
      autonomous_motion_candidate: source.autonomous_motion_candidate !== false,
      allowed_render_use: source.allowed_render_use || "reference_only_by_default",
      rights_risk_class: source.rights_risk_class || "official_reference_only",
      priority_score: priorityForSource(source),
      intake_mode: "local_reference_to_motion_pack",
      downloads_started: false,
      required_artifacts: [
        "local_transcript_pack",
        "timeline_contact_sheet",
        "motion_edl",
        "cut_boundary_self_eval",
      ],
    }))
    .sort((a, b) => b.priority_score - a.priority_score || a.source_family.localeCompare(b.source_family));
}

function requirementsForStory(story = {}) {
  const steamMetric = isSteamMetricStory(story);
  const reviewScore = isReviewScoreStory(story);
  const requiredDistinctFamilies = steamMetric ? 6 : reviewScore ? 5 : 4;
  const requiredMotionScenes = steamMetric ? 7 : reviewScore ? 6 : 5;
  return {
    steam_metric_story: steamMetric,
    review_score_story: reviewScore,
    required_distinct_families: requiredDistinctFamilies,
    required_motion_scenes: requiredMotionScenes,
    max_static_card_ratio: steamMetric || reviewScore ? 0.22 : 0.28,
    max_static_card_seconds: steamMetric || reviewScore ? 11 : 14,
    target_motion_ratio: steamMetric || reviewScore ? 0.72 : 0.64,
  };
}

function buildReadiness({ requirements, inventory, trustedSources }) {
  const blockers = [];
  const warnings = [];
  const availableMotionClips = inventory.accepted_local_clips.length;
  const availableDistinctFamilies = inventory.distinct_source_families.length;
  const trustedEvidenceCount =
    trustedSources.length + inventory.trusted_local_source_families.length;

  if (availableMotionClips < requirements.required_motion_scenes) {
    blockers.push("actual_motion_clip_minimum_not_met");
  }
  if (availableDistinctFamilies < requirements.required_distinct_families) {
    blockers.push("distinct_motion_families_minimum_not_met");
  }
  if (!trustedEvidenceCount) blockers.push("no_trusted_footage_references_for_story");
  if (!trustedSources.length && inventory.trusted_local_source_families.length) {
    warnings.push("trusted_registry_missing_but_validated_official_local_motion_present");
  }
  if (trustedSources.length > availableDistinctFamilies && availableMotionClips > 0) {
    warnings.push("trusted_sources_available_but_not_yet_local_motion");
  }
  if (inventory.rejected_local_assets.length) {
    warnings.push("local_motion_assets_rejected");
  }

  return {
    status: blockers.length ? "v4_motion_blocked" : "v4_motion_ready",
    blockers,
    warnings,
  };
}

function buildNextActions(readiness) {
  const actions = [];
  if (
    readiness.blockers.includes("actual_motion_clip_minimum_not_met") ||
    readiness.blockers.includes("distinct_motion_families_minimum_not_met")
  ) {
    actions.push({
      id: "queue_local_motion_intake_for_trusted_sources",
      label: "Queue local motion intake for trusted sources",
      mode: "planner_only",
      starts_downloads: false,
    });
  }
  if (readiness.blockers.includes("no_trusted_footage_references_for_story")) {
    actions.push({
      id: "expand_trusted_registry_for_story_entity",
      label: "Expand the trusted registry for this entity",
      mode: "registry_research_plan",
      starts_downloads: false,
    });
  }
  if (readiness.warnings.includes("local_motion_assets_rejected")) {
    actions.push({
      id: "repair_or_replace_rejected_motion_assets",
      label: "Repair or replace rejected local motion assets",
      mode: "local_media_hygiene",
      starts_downloads: false,
    });
  }
  return actions;
}

function buildFootageEmpirePlan({
  story = {},
  trustedFootageReport = {},
  localMotionClips = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const trustedSources = acceptedSourcesForStory(trustedFootageReport, story);
  const inventory = localMotionInventory(localMotionClips);
  const requirements = requirementsForStory(story);
  const readiness = buildReadiness({
    requirements,
    inventory,
    trustedSources,
  });
  const intakeQueue = buildIntakeQueue(trustedSources);
  const validatedLocalTrustSources = inventory.trusted_local_source_families.map((family) => ({
    source_family: family,
    source_tier: "official",
    source: "validated_official_local_motion",
  }));
  const trustEvidenceSource = trustedSources.length
    ? "trusted_registry"
    : validatedLocalTrustSources.length
      ? "validated_official_local_motion"
      : "none";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "footage_empire_v1",
    local_only: true,
    story_id: storyId(story) || null,
    title: story.title || null,
    readiness,
    motion_budget: {
      required_motion_scenes: requirements.required_motion_scenes,
      available_motion_clips: inventory.accepted_local_clips.length,
      required_distinct_families: requirements.required_distinct_families,
      available_distinct_families: inventory.distinct_source_families.length,
      max_static_card_ratio: requirements.max_static_card_ratio,
      max_static_card_seconds: requirements.max_static_card_seconds,
      target_motion_ratio: requirements.target_motion_ratio,
      steam_metric_story: requirements.steam_metric_story,
      review_score_story: requirements.review_score_story,
    },
    clip_reuse_policy: {
      max_uses_per_source_family: 2,
      allow_repeated_clip_windows: false,
      repeated_family_counts_as_fresh_motion: false,
      minimum_gap_between_same_family_s: 1,
    },
    trusted_source_pipeline: {
      references_found: trustedSources.length || validatedLocalTrustSources.length,
      registry_references_found: trustedSources.length,
      validated_local_motion_trust_references: validatedLocalTrustSources.length,
      trust_evidence_source: trustEvidenceSource,
      distinct_reference_families: [
        ...new Set(
          trustedSources.length
            ? trustedSources.map((source) => sourceFamilyFor(source))
            : validatedLocalTrustSources.map((source) => sourceFamilyFor(source)),
        ),
      ].sort(),
      intake_queue: intakeQueue,
    },
    motion_inventory: inventory,
    next_actions: buildNextActions(readiness),
    safety: {
      local_only: true,
      planner_only: true,
      video_downloads_started: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
      elevenlabs_required: false,
    },
  };
}

module.exports = {
  buildFootageEmpirePlan,
};
