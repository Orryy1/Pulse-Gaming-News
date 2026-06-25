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
    source.title,
    source.source_family,
    source.source_id,
    source.source_owner,
    source.reference_url,
    source.canonical_source_url,
    source.official_source_url,
    source.approved_media_url,
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

function isHardwareAccessoryProductStory(story = {}) {
  const identity = normaliseMatchText([
    story.vertical,
    story.story_type,
    story.canonical_subject,
    story.canonical_game,
    story.canonical_company,
    story.title,
    story.suggested_title,
    story.short_title,
    story.suggested_thumbnail_text,
  ].filter(Boolean).join(" "));
  const storyText = normaliseMatchText(fullStoryText(story));
  const text = `${identity} ${storyText}`;
  const strongProductTerm =
    /\b(?:controller|headset|headphones|dualsense|accessory|accessories|peripheral|keyboard|mouse|monitor|storage|ssd|capture card|racing wheel|wheel|steam deck|playstation portal|handheld|hardware)\b/.test(text);
  const consoleProductContext =
    /\b(?:ps5|playstation 5|xbox series|switch 2|console)\b/.test(identity) &&
    /\b(?:price|deal|discount|bundle|edition|preorder|pre order|accessory|accessories|stock|retail|hardware|product|upgrade)\b/.test(text);
  return strongProductTerm || consoleProductContext;
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

function sourceUrlFor(source = {}) {
  return cleanText(
    source.reference_url ||
      source.canonical_source_url ||
      source.official_source_url ||
      source.approved_media_url ||
      source.source_url ||
      source.url,
  );
}

function trustedReportRowUsable(row = {}) {
  const status = cleanKey(row.status || row.verdict || row.readiness_status);
  const blocker = cleanText(row.blocking_reason || row.blocker || row.reason);
  if (blocker) return false;
  if (status && /(?:^|[_\s-])(?:blocked|reject|rejected|failed|fail|unsafe|red)(?:$|[_\s-])/.test(status)) {
    return false;
  }
  if (
    status &&
    !/(?:^|[_\s-])(?:ready|accepted|approved|validated|green|pass|passed|publishable)(?:$|[_\s-])/.test(status)
  ) {
    return false;
  }
  const rightsGate = cleanKey(row.rights_gate || row.rightsGate);
  const sourceTier = cleanKey(row.source_tier || row.sourceTier);
  const accessMode = cleanKey(row.access_mode || row.accessMode);
  const rightsRisk = cleanKey(row.rights_risk_class || row.rightsRiskClass);
  const allowedRenderUse = cleanKey(row.allowed_render_use || row.allowedRenderUse);
  const sourceType = cleanKey(row.source_type || row.sourceType);
  const officialReferenceSignal =
    /\bofficial\b/.test(rightsRisk) ||
    /\bstorefront_promotional_video\b/.test(rightsRisk) ||
    /\b(?:steam_movie|platform_storefront|licensed_direct_media_url)\b/.test(sourceType);
  const renderUseBlocked =
    /\b(?:blocked|forbidden|disallowed|unsafe|not_allowed|do_not_render)\b/.test(allowedRenderUse);
  const verifiedOfficialReference =
    row.source_verified !== false &&
    row.segment_validation_eligible !== false &&
    !renderUseBlocked &&
    officialReferenceSignal;
  return (
    rightsGate === "official_source" ||
    /\bofficial\b/.test(sourceTier) ||
    /\bapproved_direct_media_url\b/.test(accessMode) ||
    verifiedOfficialReference
  );
}

function normaliseTrustedReportRow(row = {}) {
  if (!row || typeof row !== "object") return null;
  if (!trustedReportRowUsable(row)) return null;
  const referenceUrl = sourceUrlFor(row);
  const family = sourceFamilyFor(row);
  if (family === "unknown" && !referenceUrl) return null;
  return {
    ...row,
    source_id: cleanText(row.source_id || row.id || row.approved_media_url || family),
    display_name: cleanText(row.display_name || row.title || row.entity || row.source_owner),
    entity: cleanText(row.entity),
    entities: sourceEntities(row),
    source_tier: cleanText(row.source_tier || "official"),
    source_family: family,
    reference_url: referenceUrl,
    canonical_source_url: cleanText(row.canonical_source_url || row.official_source_url),
    source_url_kind: cleanText(row.source_url_kind) || "unknown",
    segment_validation_eligible: row.segment_validation_eligible === true,
    autonomous_motion_candidate: row.autonomous_motion_candidate !== false,
    allowed_render_use:
      cleanText(row.allowed_render_use || row.allowedRenderUse) || "reference_only_by_default",
    rights_risk_class:
      cleanText(row.rights_risk_class || row.rightsRiskClass) || "official_reference_only",
    downloads_started: false,
  };
}

function trustedReportCandidates(report = {}) {
  return [
    ...asArray(report.story_candidates),
    ...asArray(report.rows).map(normaliseTrustedReportRow).filter(Boolean),
    ...asArray(report.accepted_references).map(normaliseTrustedReportRow).filter(Boolean),
    ...asArray(report.render_ready_sources).map(normaliseTrustedReportRow).filter(Boolean),
    ...asArray(report.plans)
      .flatMap((plan) =>
        asArray(plan.references).map((reference) => ({
          ...reference,
          story_id: reference.story_id || plan.story_id || plan.storyId || null,
        })),
      )
      .map(normaliseTrustedReportRow)
      .filter(Boolean),
  ];
}

function storyId(story = {}) {
  return cleanText(story.id || story.story_id);
}

function trustedCandidatesForStory(report = {}, story = {}) {
  const wantedStoryId = storyId(story);
  return trustedReportCandidates(report)
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
  if (/\.mpd(?:$|\?)/i.test(text)) return "dash_manifest";
  if (looksLikeVideoPath(text)) return "video_file";
  return "unknown";
}

function sourceAssetKeyFromUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  const steam = text.match(/store_trailers\/(\d+)\/(\d+)/i);
  if (steam) return `steam:${steam[1]}:${steam[2]}`;
  try {
    const parsed = new URL(text);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.toLowerCase();
  } catch {
    return text.replace(/[?#].*$/, "").toLowerCase();
  }
}

function sampleContentHash(sample = {}) {
  return cleanText(
    sample.qa?.content_hash ||
      sample.qa?.contentHash ||
      sample.content_hash ||
      sample.contentHash ||
      sample.hash ||
      sample.frame_hash ||
      sample.frameHash,
  );
}

function materializedWindowHashSurrogates(asset = {}) {
  const family = sourceFamilyFor(asset);
  const reason = normaliseMatchText(
    asset.validation_reason ||
      asset.validationReason ||
      asset.provenance?.validation_reason ||
      asset.provenance?.validationReason,
  );
  const sourceType = normaliseMatchText(asset.source_type || asset.sourceType || asset.provider);
  const windowBacked =
    family.includes("_window_") ||
    Number.isFinite(Number(asset.mediaStartS ?? asset.media_start_s ?? asset.start_s ?? asset.startS));
  const officialMotion =
    reason.includes("official storefront") ||
    reason.includes("segment samples passed") ||
    reason.includes("official product motion samples passed");
  const officialSource =
    sourceType.includes("steam movie") ||
    sourceType.includes("licensed direct media") ||
    sourceType.includes("platform storefront") ||
    sourceType.includes("official platform product page");
  if (!windowBacked || !officialMotion || !officialSource) return [];
  return [`${family}:window-start`, `${family}:window-end`];
}

function sampleContentHashesForAsset(asset = {}) {
  const explicitHashes = [
    ...asArray(asset.sample_content_hashes),
    ...asArray(asset.sampleContentHashes),
    ...asArray(asset.provenance?.sample_content_hashes),
    ...asArray(asset.provenance?.sampleContentHashes),
    ...asArray(asset.samples).map(sampleContentHash),
  ]
    .map(cleanText)
    .filter(Boolean);
  if (explicitHashes.length) return explicitHashes;
  return materializedWindowHashSurrogates(asset);
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

function isHashDistinctOfficialMotionWindow(asset = {}) {
  const reason = normaliseMatchText(asset.validation_reason);
  const motionClass = normaliseMatchText(asset.segment_motion_class);
  const officialMotion =
    motionClass.includes("gameplay action") ||
    reason.includes("official product motion samples passed") ||
    reason.includes("official storefront") ||
    reason.includes("segment samples passed");
  return (
    asset.trusted_source_evidence === true &&
    asset.source_asset_key &&
    Number.isFinite(asset.mediaStartS) &&
    asset.sample_content_hashes.length >= 2 &&
    officialMotion
  );
}

function hashDistinctOfficialMotionWindowStats(accepted = []) {
  const acceptedWindows = [];
  const sourceAssets = new Set();
  const families = new Set();
  for (const asset of accepted) {
    if (!isHashDistinctOfficialMotionWindow(asset)) continue;
    const hashes = new Set(asset.sample_content_hashes);
    const repeatsPriorHash = acceptedWindows.some((window) => {
      if (window.source_asset_key !== asset.source_asset_key) return false;
      for (const hash of hashes) {
        if (window.hashes.has(hash)) return true;
      }
      return false;
    });
    if (repeatsPriorHash) continue;
    acceptedWindows.push({
      source_asset_key: asset.source_asset_key,
      family: asset.source_family,
      hashes,
    });
    sourceAssets.add(asset.source_asset_key);
    if (asset.source_family) families.add(asset.source_family);
  }
  return {
    hash_distinct_official_motion_windows: acceptedWindows.length,
    hash_distinct_official_source_assets: sourceAssets.size,
    hash_distinct_official_source_families: families.size,
  };
}

function countsAsOfficialProductMotion(asset = {}) {
  const sourceType = normaliseMatchText(asset.source_type || asset.provider);
  const motionClass = normaliseMatchText(asset.segment_motion_class);
  const reason = normaliseMatchText(asset.validation_reason);
  const rights = normaliseMatchText(asset.rights_risk_class || asset.allowed_render_use);
  const rightsSafe =
    rights.includes("official reference only") ||
    rights.includes("reference only by default");
  const legacyProductMotion =
    sourceType.includes("official platform product page") &&
    motionClass.includes("official product motion") &&
    reason.includes("official product motion samples passed");
  const officialStorefrontTrailerMotion =
    asset.trusted_source_evidence === true &&
    asset.source_asset_key &&
    asset.sample_content_hashes.length >= 2 &&
    (
      sourceType.includes("steam movie") ||
      sourceType.includes("licensed direct media") ||
      sourceType.includes("platform storefront")
    ) &&
    (
      motionClass.includes("gameplay action") ||
      motionClass.includes("official storefront") ||
      motionClass.includes("official product motion") ||
      reason.includes("official storefront")
    ) &&
    (
      reason.includes("official storefront") ||
      reason.includes("segment samples passed") ||
      reason.includes("official product motion samples passed")
    );
  return rightsSafe && (legacyProductMotion || officialStorefrontTrailerMotion);
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
    const pathValue = cleanText(asset.path || asset.source || asset.file);
    const sourceUrl = cleanText(asset.source_url || asset.sourceUrl || asset.url);
    const sampleHashes = [...new Set(sampleContentHashesForAsset(asset))];
    const normalised = {
      id: cleanText(asset.id || asset.clip_id || `local_clip_${index + 1}`),
      source_family: sourceFamilyFor(asset),
      path: pathValue,
      source_url: sourceUrl,
      source_asset_key: sourceAssetKeyFromUrl(sourceUrl || pathValue),
      mediaStartS: Number(asset.mediaStartS ?? asset.media_start_s ?? asset.start_s ?? asset.startS),
      durationS: Number(asset.durationS ?? asset.duration_s ?? asset.duration) || null,
      validated: asset.validated !== false,
      type: localClipType(asset),
      source_type: cleanText(asset.source_type || asset.sourceType),
      provider: cleanText(asset.provider),
      allowed_render_use: cleanText(asset.allowed_render_use || asset.allowedRenderUse),
      rights_risk_class: cleanText(asset.rights_risk_class || asset.rightsRiskClass),
      segment_motion_class: cleanText(
        asset.segment_motion_class ||
          asset.segmentMotionClass ||
          asset.provenance?.segment_motion_class ||
          asset.provenance?.segmentMotionClass,
      ),
      validation_reason: cleanText(
        asset.validation_reason ||
          asset.validationReason ||
          asset.provenance?.validation_reason ||
          asset.provenance?.validationReason,
      ),
      source_kind: motionSourceKind(asset.path || asset.source || asset.file),
      sample_content_hashes: sampleHashes,
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
  const sourceAssetSet = new Set();
  for (const asset of accepted) {
    sourceAssetSet.add(asset.source_asset_key || asset.source_family);
  }
  const trustedFamilySet = new Set();
  for (const asset of accepted) {
    if (asset.trusted_source_evidence) trustedFamilySet.add(asset.source_family);
  }
  const officialProductMotionClips = accepted.filter(countsAsOfficialProductMotion);
  const officialProductFamilySet = new Set(
    officialProductMotionClips.map((asset) => asset.source_family).filter(Boolean),
  );
  const hashDistinctOfficialStats = hashDistinctOfficialMotionWindowStats(accepted);

  return {
    accepted_local_clips: accepted,
    rejected_local_assets: rejected,
    distinct_source_families: [...familySet].filter(Boolean).sort(),
    distinct_source_assets: [...sourceAssetSet].filter(Boolean).sort(),
    trusted_local_source_families: [...trustedFamilySet].filter(Boolean).sort(),
    official_product_motion_clips: officialProductMotionClips,
    official_product_motion_families: [...officialProductFamilySet].sort(),
    ...hashDistinctOfficialStats,
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
  const productMotion = !steamMetric && !reviewScore && isHardwareAccessoryProductStory(story);
  const requiredDistinctFamilies = productMotion ? 2 : steamMetric ? 6 : reviewScore ? 5 : 4;
  const requiredMotionScenes = productMotion ? 2 : steamMetric ? 7 : reviewScore ? 6 : 5;
  return {
    steam_metric_story: steamMetric,
    review_score_story: reviewScore,
    product_motion_story: productMotion,
    required_distinct_families: requiredDistinctFamilies,
    required_motion_scenes: requiredMotionScenes,
    required_official_product_motion_scenes: productMotion ? 2 : 0,
    required_official_product_motion_families: productMotion ? 2 : 0,
    requires_premium_owned_motion: productMotion,
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
  const availableDistinctSourceAssets = inventory.distinct_source_assets.length;
  const trustedEvidenceCount =
    trustedSources.length + inventory.trusted_local_source_families.length;
  const hashDistinctWindowFamilyShortfall =
    availableMotionClips >= requirements.required_motion_scenes &&
    Number(inventory.hash_distinct_official_motion_windows || 0) >= requirements.required_motion_scenes &&
    trustedEvidenceCount > 0 &&
    availableDistinctFamilies < requirements.required_distinct_families;

  if (availableMotionClips < requirements.required_motion_scenes) {
    blockers.push("actual_motion_clip_minimum_not_met");
  }
  if (availableDistinctFamilies < requirements.required_distinct_families) {
    blockers.push("distinct_motion_families_minimum_not_met");
  }
  if (availableDistinctSourceAssets < requirements.required_distinct_families) {
    blockers.push("distinct_motion_source_assets_minimum_not_met");
  }
  if (
    requirements.product_motion_story &&
    inventory.official_product_motion_clips.length <
      requirements.required_official_product_motion_scenes
  ) {
    blockers.push("official_product_motion_clip_minimum_not_met");
  }
  if (
    requirements.product_motion_story &&
    inventory.official_product_motion_families.length <
      requirements.required_official_product_motion_families
  ) {
    blockers.push("official_product_motion_family_minimum_not_met");
  }
  if (!trustedEvidenceCount) blockers.push("no_trusted_footage_references_for_story");
  if (hashDistinctWindowFamilyShortfall) {
    warnings.push("hash_distinct_official_windows_do_not_replace_source_family_diversity");
  }
  if (requirements.product_motion_story) {
    warnings.push("product_story_limited_motion_budget_requires_premium_owned_motion");
  }
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
    evidence: {
      distinct_family_requirement_satisfied_by_hash_distinct_official_windows:
        false,
      hash_distinct_official_motion_windows:
        Number(inventory.hash_distinct_official_motion_windows || 0),
      distinct_motion_source_assets:
        Number(inventory.distinct_source_assets.length || 0),
    },
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
      available_distinct_source_assets: inventory.distinct_source_assets.length,
      required_official_product_motion_scenes:
        requirements.required_official_product_motion_scenes,
      available_official_product_motion_clips:
        inventory.official_product_motion_clips.length,
      required_official_product_motion_families:
        requirements.required_official_product_motion_families,
      available_official_product_motion_families:
        inventory.official_product_motion_families.length,
      hash_distinct_official_motion_windows:
        Number(inventory.hash_distinct_official_motion_windows || 0),
      hash_distinct_official_source_assets:
        Number(inventory.hash_distinct_official_source_assets || 0),
      hash_distinct_official_source_families:
        Number(inventory.hash_distinct_official_source_families || 0),
      distinct_family_requirement_satisfied_by_hash_distinct_official_windows:
        readiness.evidence?.distinct_family_requirement_satisfied_by_hash_distinct_official_windows === true,
      max_static_card_ratio: requirements.max_static_card_ratio,
      max_static_card_seconds: requirements.max_static_card_seconds,
      target_motion_ratio: requirements.target_motion_ratio,
      steam_metric_story: requirements.steam_metric_story,
      review_score_story: requirements.review_score_story,
      product_motion_story: requirements.product_motion_story,
      requires_premium_owned_motion: requirements.requires_premium_owned_motion,
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
