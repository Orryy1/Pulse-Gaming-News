"use strict";

const { buildAssetAcquisitionPlan } = require("./asset-acquisition-pro");
const { buildSubjectGraph } = require("./exact-subject-matching");
const {
  DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD,
  filterExhaustedSourceFamilyClipRefs,
} = require("./studio/v2/official-trailer-segment-validator");
const {
  officialMediaReferenceRejectReason,
} = require("./official-media-reference-preflight");
const {
  mediaSourceUrlKindFields,
} = require("./media-source-url-kind");
const {
  trustedFootageReferencesForStory,
} = require("./trusted-footage-registry");

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function sourceAssets(story) {
  return [
    ...asArray(story?.downloaded_images),
    ...asArray(story?.game_images),
    ...asArray(story?.media_candidates),
    ...asArray(story?.igdb_assets),
    ...asArray(story?._verified_store_assets),
    ...asArray(story?.rights_ledger),
    ...asArray(story?.rights_records),
    ...asArray(story?.footage_inventory?.motion_inventory?.accepted_local_clips),
    ...asArray(story?.footage_inventory?.motion_inventory?.production_motion_clips),
    ...asArray(story?.visual_v4_bridge_video_clips),
  ].filter(Boolean);
}

function extractSteamAppId(value) {
  const text = String(value || "");
  const match =
    text.match(/\/steam\/apps\/(\d+)\//i) ||
    text.match(/\/store_item_assets\/steam\/apps\/(\d+)\//i) ||
    text.match(/[?&]appids=(\d+)/i) ||
    text.match(/store\.steampowered\.com\/app\/(\d+)/i);
  return match ? match[1] : null;
}

function isExactSubjectSteamStorefrontAsset(asset) {
  const sourceType = String(asset?.source_type || asset?.type || "").toLowerCase();
  const sourceUrl = asset?.source_url || asset?.url || asset?.path || asset?.local_path || "";
  const subjectMatch = String(asset?.subject_match_quality || "").toLowerCase();
  return (
    sourceType.startsWith("steam_") &&
    Boolean(extractSteamAppId(sourceUrl) || asset?.store_app_id) &&
    Boolean(asset?.exact_subject_group) &&
    (subjectMatch === "exact_game_match" || subjectMatch === "exact_franchise_match") &&
    asset?.subject_match_quality !== "generic_store_asset"
  );
}

function isVerifiedSteamAsset(asset) {
  const source = String(asset?.store_asset_source || asset?.source || asset?.source_type || asset?.type || "")
    .toLowerCase();
  const sourceUrl = asset?.source_url || asset?.url || asset?.path || asset?.local_path || "";
  const hasSteamAppEvidence = Boolean(extractSteamAppId(sourceUrl) || asset?.store_app_id);
  const approvedEvidence = /approved|source_documented_transformative_editorial_use|screenshot_derived/i.test(
    String(
      `${asset?.approval_status || ""} ${asset?.licence_basis || ""} ${asset?.license_basis || ""} ${asset?.asset_type || ""} ${asset?.allowed_use || ""}`,
    ).toLowerCase(),
  );
  return (
    (source === "steam" || source.startsWith("steam_")) &&
    (
      (Boolean(asset?.store_app_id) &&
        Boolean(asset?.store_app_title || asset?.store_app_slug) &&
        asset?.store_match_verified === true) ||
      isExactSubjectSteamStorefrontAsset(asset) ||
      (
        hasSteamAppEvidence &&
        /steamstatic\.com|cdn\.akamai\.steamstatic\.com|store_item_assets\/steam\/apps|\/steam\/apps\//i.test(String(sourceUrl))
      )
    )
  ) || (
    hasSteamAppEvidence &&
    approvedEvidence &&
    /steamstatic\.com|cdn\.akamai\.steamstatic\.com|store_item_assets\/steam\/apps|\/steam\/apps\//i.test(String(sourceUrl))
  );
}

function inferredStoryEntity(story) {
  return (
    story?.canonical_game ||
    story?.canonical_subject ||
    story?.game_title ||
    story?.primary_entity ||
    null
  );
}

function buildSteamTargets(story) {
  const seen = new Set();
  const targets = [];
  for (const asset of sourceAssets(story)) {
    if (!isVerifiedSteamAsset(asset)) continue;
    const appId = String(
      asset.store_app_id ||
      extractSteamAppId(asset.source_url || asset.url || asset.path || asset.local_path),
    );
    if (!appId || appId === "null" || appId === "undefined") continue;
    const key = appId;
    if (seen.has(key)) continue;
    seen.add(key);
    const exactSubject = asset.exact_subject_group || null;
    const entity =
      exactSubject ||
      (/^steam$/i.test(String(asset.entity || "")) ? null : asset.entity) ||
      asset.store_app_title ||
      inferredStoryEntity(story) ||
      null;
    targets.push({
      provider: "steam",
      story_id: story?.id || null,
      entity,
      store_app_id: appId,
      store_app_title: asset.store_app_title || exactSubject || inferredStoryEntity(story) || null,
      store_app_slug: asset.store_app_slug || null,
      store_matched_query: asset.store_matched_query || null,
      provenance_source_type: asset.source_type || asset.type || null,
    });
  }
  return targets;
}

function normaliseLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const label = String(value || "").trim();
    const key = normaliseLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function storyComparisonText(story) {
  return normaliseLabel(
    [
      story?.title,
      story?.hook,
      story?.body,
      story?.loop,
      story?.full_script,
      story?.tts_script,
      story?.description,
      story?.top_comment,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isRankComparisonOnlyTarget(story, entity) {
  const entityKey = normaliseLabel(entity);
  if (!entityKey) return false;
  const titleKey = normaliseLabel(story?.title);
  if (titleKey.includes(entityKey)) return false;
  const text = storyComparisonText(story);
  if (!text) return false;
  const cue = [
    "ahead of",
    "behind",
    "above",
    "below",
    "beating out",
    "beat out",
    "beats",
    "beat",
    "outscored",
    "outscoring",
    "ranked ahead of",
    "ranked above",
    "rated ahead of",
    "rated above",
  ].join("|");
  const pattern = new RegExp(`\\b(?:${cue})\\s+(?:[a-z0-9]+\\s+){0,5}${escapeRegExp(entityKey)}\\b`);
  return pattern.test(text);
}

function isNestedTargetEntity(shorter, longer) {
  const shorterKey = normaliseLabel(shorter);
  const longerKey = normaliseLabel(longer);
  if (!shorterKey || !longerKey || shorterKey === longerKey) return false;
  return new RegExp(`\\b${escapeRegExp(shorterKey)}\\b`).test(longerKey);
}

function collapseNestedTargetEntities(entities = []) {
  return uniqueStrings(entities).filter((entity) =>
    !entities.some((other) => other !== entity && isNestedTargetEntity(entity, other)),
  );
}

function storyTargetEntities(story) {
  return collapseNestedTargetEntities(buildSubjectGraph(story).required_subject_groups).filter(
    (entity) => !isRankComparisonOnlyTarget(story, entity),
  );
}

function movieUrl(movie) {
  return (
    movie?.mp4?.max ||
    movie?.mp4?.["480"] ||
    movie?.hls_h264 ||
    movie?.dash_h264 ||
    movie?.dash_av1 ||
    movie?.webm?.max ||
    movie?.webm?.["480"] ||
    movie?.url ||
    null
  );
}

function parseSteamTrailerUrl(sourceUrl) {
  const text = String(sourceUrl || "");
  const match = text.match(/store_trailers\/(\d+)\/(\d+)\//i);
  if (!match) return null;
  return {
    store_app_id: match[1],
    movie_id: match[2],
  };
}

function ratingBoardRejectReason(movie) {
  return officialMediaReferenceRejectReason(movie);
}

function normaliseSteamLookupResult(appId, result) {
  if (!result) {
    return { appId, success: false, title: null, movies: [], reason: "lookup_missing" };
  }
  if (result.data || result[String(appId)]) {
    const node = result[String(appId)] || result;
    const data = node.data || {};
    return {
      appId,
      success: node.success !== false,
      title: data.name || result.title || null,
      movies: Array.isArray(data.movies) ? data.movies : [],
      reason: node.success === false ? "steam_lookup_unsuccessful" : null,
    };
  }
  return {
    appId,
    success: result.success !== false,
    title: result.title || null,
    movies: Array.isArray(result.movies) ? result.movies : [],
    reason: result.success === false ? "steam_lookup_unsuccessful" : null,
  };
}

function steamReferenceFromMovie(target, movie, index) {
  const sourceUrl = movieUrl(movie);
  if (!sourceUrl) return null;
  const sourceFamily = parseSteamTrailerUrl(sourceUrl);
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  return {
    source_type: "steam_movie",
    provider: "steam",
    story_id: target.story_id || null,
    source_url: sourceUrl,
    ...urlKind,
    thumbnail_url: movie.thumbnail || null,
    movie_id: sourceFamily?.movie_id || movie.id || null,
    steam_movie_id: movie.id || null,
    movie_name: movie.name || `Steam movie ${index + 1}`,
    entity: target.entity,
    store_app_id: target.store_app_id,
    store_app_title: target.store_app_title,
    store_app_slug: target.store_app_slug,
    store_matched_query: target.store_matched_query,
    source_verified: true,
    downloads_allowed: false,
    allowed_render_use: "reference_only_by_default",
    rights_risk_class: "storefront_promotional_video",
    provenance: {
      source: "steam_appdetails.movies",
      story_id: target.story_id || null,
      app_id: target.store_app_id,
      app_title: target.store_app_title,
      provenance_source_type: target.provenance_source_type,
      source_url_kind: urlKind.source_url_kind,
      segment_validation_eligible: urlKind.segment_validation_eligible,
      segment_validation_ineligible_reason: urlKind.segment_validation_ineligible_reason,
    },
  };
}

function isIgdbVideoAsset(asset) {
  return (
    /igdb_video|video/i.test(String(asset?.type || asset?.source_type || "")) &&
    Boolean(asset?.video_id || asset?.youtube_id || asset?.source_url || asset?.url)
  );
}

function igdbReferenceFromAsset(asset) {
  const videoId = asset.video_id || asset.youtube_id || null;
  const sourceUrl =
    asset.source_url || asset.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
  if (!sourceUrl) return null;
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  return {
    source_type: "igdb_video",
    provider: "igdb",
    source_url: sourceUrl,
    ...urlKind,
    thumbnail_url: asset.thumbnail_url || null,
    movie_id: videoId,
    movie_name: asset.name || asset.title || "IGDB video reference",
    entity: asset.entity || asset.exact_subject_group || null,
    source_verified: asset.store_match_verified === true || asset.subject_match_quality === "exact_game_match",
    downloads_allowed: false,
    allowed_render_use: "reference_only_by_default",
    rights_risk_class: "igdb_metadata_reference",
    provenance: {
      source: "igdb.video_reference",
      igdb_id: asset.igdb_id || null,
      igdb_title: asset.igdb_title || null,
      subject_match_quality: asset.subject_match_quality || null,
      source_url_kind: urlKind.source_url_kind,
      segment_validation_eligible: urlKind.segment_validation_eligible,
      segment_validation_ineligible_reason: urlKind.segment_validation_ineligible_reason,
    },
  };
}

async function resolveSteamReferences(targets, steamLookup) {
  const references = [];
  const lookup_results = [];
  if (typeof steamLookup !== "function") {
    for (const target of targets) {
      lookup_results.push({
        provider: "steam",
        store_app_id: target.store_app_id,
        status: "lookup_not_configured",
        movies_found: 0,
      });
    }
    return { references, lookup_results };
  }

  for (const target of targets.slice(0, 8)) {
    try {
      const raw = await steamLookup(target.store_app_id, target);
      const result = normaliseSteamLookupResult(target.store_app_id, raw);
      const rejectedMovieReasons = [];
      const acceptedMovies = [];
      for (const [index, movie] of result.movies.entries()) {
        const rejectReason = ratingBoardRejectReason(movie);
        if (rejectReason) {
          rejectedMovieReasons.push({
            index,
            movie_id: movie?.id || null,
            movie_name: movie?.name || movie?.title || `Steam movie ${index + 1}`,
            reason: rejectReason,
          });
          continue;
        }
        acceptedMovies.push({ movie, index });
      }
      const movieRefs = acceptedMovies
        .map(({ movie, index }) => steamReferenceFromMovie(target, movie, index))
        .filter(Boolean);
      references.push(...movieRefs);
      lookup_results.push({
        provider: "steam",
        store_app_id: target.store_app_id,
        store_app_title: target.store_app_title,
        status: result.success ? "ok" : "failed",
        movies_found: movieRefs.length,
        movies_rejected: rejectedMovieReasons.length,
        rejected_movie_reasons: rejectedMovieReasons,
        reason: result.reason,
      });
    } catch (err) {
      lookup_results.push({
        provider: "steam",
        store_app_id: target.store_app_id,
        store_app_title: target.store_app_title,
        status: "error",
        movies_found: 0,
        reason: err.message,
      });
    }
  }
  return { references, lookup_results };
}

function referenceEntity(reference) {
  return reference?.entity || reference?.exact_subject_group || reference?.game || reference?.franchise || null;
}

function referenceMatchesTargetEntities(reference, targetEntities = []) {
  const targetKeys = (Array.isArray(targetEntities) ? targetEntities : [])
    .map(normaliseLabel)
    .filter(Boolean);
  if (targetKeys.length === 0) return true;
  const entityKey = normaliseLabel(referenceEntity(reference));
  if (entityKey && targetKeys.includes(entityKey)) return true;
  const referenceText = normaliseLabel(
    [
      reference?.source_family,
      reference?.movie_name,
      reference?.reference_title,
      reference?.source_owner,
      reference?.display_name,
      reference?.source_url,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return targetKeys.some((targetKey) => referenceText.includes(targetKey));
}

function targetReferenceCoverage(targetEntities, references) {
  const covered = [];
  const missing = [];
  const referenceEntitySet = new Set(
    (Array.isArray(references) ? references : [])
      .map(referenceEntity)
      .map(normaliseLabel)
      .filter(Boolean),
  );
  for (const entity of targetEntities) {
    if (
      referenceEntitySet.has(normaliseLabel(entity)) ||
      (Array.isArray(references) && references.some((reference) => referenceMatchesTargetEntities(reference, [entity])))
    ) {
      covered.push(entity);
    }
    else missing.push(entity);
  }
  return { covered, missing };
}

function alternateReferenceRequiredEntities(missingTargetEntities, excludedReferences) {
  const excludedEntitySet = new Set(
    (Array.isArray(excludedReferences) ? excludedReferences : [])
      .map(referenceEntity)
      .map(normaliseLabel)
      .filter(Boolean),
  );
  return (Array.isArray(missingTargetEntities) ? missingTargetEntities : []).filter((entity) =>
    excludedEntitySet.has(normaliseLabel(entity)),
  );
}

function buildSearchQueries(story, acquisitionPlan, searchTargetEntities = [], allowedTargetEntities = searchTargetEntities) {
  const existing = acquisitionPlan?.search_queries || [];
  const title = String(story?.title || "").trim();
  const hasSearchTargets = Array.isArray(searchTargetEntities) && searchTargetEntities.length > 0;
  const hasAllowedTargets = Array.isArray(allowedTargetEntities) && allowedTargetEntities.length > 0;
  const queryTargetEntities = hasSearchTargets ? searchTargetEntities : allowedTargetEntities;
  const titleWords = normaliseLabel(title).split(" ").filter(Boolean);
  const looksTitleFragmentLed = (query) => {
    if (!hasAllowedTargets || titleWords.length < 3) return false;
    const queryWords = normaliseLabel(query).split(" ").filter(Boolean);
    return titleWords.slice(0, 3).every((word, index) => queryWords[index] === word);
  };
  const entityQuery = (query) => {
    if (!hasAllowedTargets) return true;
    if (looksTitleFragmentLed(query)) return false;
    const queryKey = normaliseLabel(query);
    return queryTargetEntities.some((entity) => queryKey.startsWith(`${normaliseLabel(entity)} `));
  };
  return Array.from(
    new Set(
      [
        ...searchTargetEntities.flatMap((entity) => [
          `${entity} official trailer`,
          `${entity} gameplay trailer`,
          `${entity} Steam trailer`,
        ]),
        ...existing.filter((query) => /official trailer|gameplay/i.test(query) && entityQuery(query)),
        !hasSearchTargets && !hasAllowedTargets && title ? `${title} official trailer` : null,
        !hasSearchTargets && !hasAllowedTargets && title ? `${title} gameplay trailer` : null,
      ].filter(Boolean),
    ),
  ).slice(0, 18);
}

function plannedSearches(searchQueries, targetEntities = []) {
  return searchQueries.map((query) => {
    const queryKey = normaliseLabel(query);
    const entity = targetEntities.find((candidate) => queryKey.startsWith(`${normaliseLabel(candidate)} `)) || null;
    return {
      query,
      entity,
      accepted_sources: ["Steam", "IGDB", "official publisher channel", "platform storefront"],
      will_download: false,
      mutates: false,
    };
  });
}

function readinessFor({
  topicality,
  references,
  targets,
  searchQueries,
  targetEntities,
  missingTargetEntities,
  excludedReferenceCount = 0,
}) {
  if (topicality === "reject") return "reject";
  if (references.length === 0 && excludedReferenceCount > 0 && targetEntities.length > 0 && searchQueries.length > 0) {
    return "alternate_official_reference_required";
  }
  if (references.length > 0 && targetEntities.length >= 2 && missingTargetEntities.length > 0) {
    return "partial_official_reference_found";
  }
  if (references.length > 0) return "official_reference_found";
  if (targets.length > 0) return "verified_store_lookup_pending";
  if (searchQueries.length > 0) return "official_search_required";
  return "no_reference_path";
}

function filterResolvedReferences(references, options = {}) {
  const segmentValidationReport = options.segmentValidationReport || null;
  if (!segmentValidationReport || options.excludeExhaustedSourceFamilies === false) {
    return {
      references: Array.isArray(references) ? references : [],
      excluded_references: [],
      exhausted_source_families: [],
      exhausted_source_family_filter: {
        enabled: false,
        threshold: Math.max(
          1,
          Number(options.exhaustedSourceFamilyThreshold || DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD),
        ),
        excluded_references: 0,
      },
    };
  }

  const threshold = Math.max(
    1,
    Number(options.exhaustedSourceFamilyThreshold || DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD),
  );
  const filtered = filterExhaustedSourceFamilyClipRefs(references, segmentValidationReport, { threshold });

  return {
    references: filtered.clipRefs,
    excluded_references: filtered.skipped,
    exhausted_source_families: filtered.exhausted_source_families,
    exhausted_source_family_filter: {
      enabled: true,
      threshold,
      exhausted_source_families: filtered.exhausted_source_families,
      excluded_references: filtered.skipped.length,
    },
  };
}

function officialIntakeReferencesForStory(report, story) {
  const storyId = String(story?.id || "").trim();
  if (!storyId || !report || typeof report !== "object") return [];
  return (Array.isArray(report.accepted_references) ? report.accepted_references : [])
    .filter((reference) => String(reference?.story_id || "").trim() === storyId)
    .map((reference) => {
      const urlKind = mediaSourceUrlKindFields(reference.source_url || reference.sourceUrl || reference.official_source_url);
      return {
        ...reference,
        ...urlKind,
        provider: "official_intake",
        source_verified: reference.source_verified !== false,
        downloads_allowed: false,
        allowed_render_use: reference.allowed_render_use || "reference_only_by_default",
        rights_risk_class: reference.rights_risk_class || "official_reference_only",
        provenance: {
          ...(reference.provenance || {}),
          source: reference.provenance?.source || "operator_official_source_intake",
          source_url_kind: urlKind.source_url_kind,
          segment_validation_eligible: urlKind.segment_validation_eligible,
          segment_validation_ineligible_reason: urlKind.segment_validation_ineligible_reason,
        },
      };
    });
}

async function buildOfficialTrailerReferencePlan(story, options = {}) {
  const acquisitionPlan = buildAssetAcquisitionPlan(story, options);
  const targetEntities = storyTargetEntities(story);
  const verifiedStoreTargets = buildSteamTargets(story);
  const { references: steamReferences, lookup_results } = await resolveSteamReferences(
    verifiedStoreTargets,
    options.steamLookup,
  );
  const igdbReferences = sourceAssets(story)
    .filter(isIgdbVideoAsset)
    .map(igdbReferenceFromAsset)
    .filter(Boolean);
  const officialIntakeReferences = officialIntakeReferencesForStory(
    options.officialSourceIntakeReport,
    story,
  );
  const trustedFootageReferences = trustedFootageReferencesForStory(
    options.trustedFootageRegistryReport,
    story,
  );
  const hasTrustedFootageTargetEntities = targetEntities.length > 0;
  const filteredTrustedFootageReferences = trustedFootageReferences.filter((reference) =>
    hasTrustedFootageTargetEntities && referenceMatchesTargetEntities(reference, targetEntities),
  );
  const rawResolvedReferences = [
    ...steamReferences,
    ...igdbReferences,
    ...officialIntakeReferences,
    ...filteredTrustedFootageReferences,
  ];
  const resolvedReferences = rawResolvedReferences;
  const referenceFilter = filterResolvedReferences(resolvedReferences, options);
  const references = referenceFilter.references;
  const segmentEligibleReferences = references.filter((reference) => reference.segment_validation_eligible === true);
  const {
    covered: sourceProofCoveredTargetEntities,
    missing: sourceProofMissingTargetEntities,
  } = targetReferenceCoverage(targetEntities, references);
  const { covered: coveredTargetEntities, missing: missingTargetEntities } = targetReferenceCoverage(
    targetEntities,
    segmentEligibleReferences,
  );
  const alternateRequiredEntities = alternateReferenceRequiredEntities(
    missingTargetEntities,
    referenceFilter.excluded_references,
  );
  const searchQueries = buildSearchQueries(story, acquisitionPlan, missingTargetEntities, targetEntities);
  const motionReferenceReadiness = readinessFor({
    topicality: acquisitionPlan.topicality_verdict,
    references: segmentEligibleReferences,
    targets: verifiedStoreTargets,
    searchQueries,
    targetEntities,
    missingTargetEntities,
    excludedReferenceCount: referenceFilter.excluded_references.length,
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "report_only",
    will_download: false,
    will_mutate_story: false,
    story_id: story?.id || acquisitionPlan.story_id,
    title: story?.title || acquisitionPlan.title,
    topicality_verdict: acquisitionPlan.topicality_verdict,
    motion_reference_readiness: motionReferenceReadiness,
    target_entities: targetEntities,
    source_proof_covered_target_entities: sourceProofCoveredTargetEntities,
    source_proof_missing_target_entities: sourceProofMissingTargetEntities,
    covered_target_entities: coveredTargetEntities,
    missing_target_entities: missingTargetEntities,
    alternate_reference_required_entities: alternateRequiredEntities,
    verified_store_targets: verifiedStoreTargets,
    resolved_reference_count: resolvedReferences.length,
    filtered_target_mismatch_reference_count:
      trustedFootageReferences.length - filteredTrustedFootageReferences.length,
    references,
    excluded_references: referenceFilter.excluded_references,
    exhausted_source_family_filter: referenceFilter.exhausted_source_family_filter,
    lookup_results,
    summary_accepted_official_intake_references: officialIntakeReferences.length,
    summary_accepted_trusted_footage_references: trustedFootageReferences.length,
    segment_validation_reference_counts: {
      eligible: references.filter((reference) => reference.segment_validation_eligible === true).length,
      ineligible: references.filter((reference) => reference.segment_validation_eligible !== true).length,
      by_source_url_kind: references.reduce((acc, reference) => {
        const key = reference.source_url_kind || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
    planned_searches: plannedSearches(searchQueries, missingTargetEntities),
    search_queries: searchQueries,
    provenance_ledger: references.map((reference) => ({
      source_url: reference.source_url,
      source_type: reference.source_type,
      provider: reference.provider,
      entity: reference.entity,
      rights_risk_class: reference.rights_risk_class,
      allowed_render_use: reference.allowed_render_use,
      source_url_kind: reference.source_url_kind,
      segment_validation_eligible: reference.segment_validation_eligible,
      segment_validation_ineligible_reason: reference.segment_validation_ineligible_reason,
      downloads_allowed: false,
      provenance: reference.provenance,
    })),
    blockers:
      motionReferenceReadiness === "official_reference_found"
        ? []
        : [
            sourceProofMissingTargetEntities.length > 0 ? "missing_official_reference_entities" : null,
            alternateRequiredEntities.length > 0 ? "alternate_official_reference_required" : null,
            references.length === 0 ? "no_official_reference_resolved" : null,
            references.length > 0 && segmentEligibleReferences.length === 0
              ? "no_segment_validation_eligible_reference_resolved"
              : null,
            referenceFilter.excluded_references.length > 0 ? "resolved_references_exhausted" : null,
            verifiedStoreTargets.length === 0 ? "no_verified_store_motion_target" : null,
          ].filter(Boolean),
    warnings: [
      referenceFilter.excluded_references.length > 0 ? "some_resolved_references_were_exhausted_locally" : null,
      alternateRequiredEntities.length > 0 ? "alternate_source_needed_for_missing_entities" : null,
      references.some((reference) => reference.segment_validation_eligible !== true)
        ? "some_references_are_provenance_only_not_direct_media"
        : null,
    ].filter(Boolean),
    safety: {
      local_only: true,
      video_downloads: false,
      frame_extraction: false,
      clip_slicing: false,
      yt_dlp: false,
      browser_scraping: false,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      production_render_default_changed: false,
    },
  };
}

async function buildOfficialTrailerReferenceReport(stories = [], options = {}) {
  const plans = [];
  for (const story of Array.isArray(stories) ? stories : []) {
    plans.push(await buildOfficialTrailerReferencePlan(story, options));
  }
  const byReadiness = plans.reduce((acc, plan) => {
    acc[plan.motion_reference_readiness] = (acc[plan.motion_reference_readiness] || 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    execution_mode: "report_only",
    will_download: false,
    summary: {
      stories: plans.length,
      official_reference_found: byReadiness.official_reference_found || 0,
      partial_official_reference_found: byReadiness.partial_official_reference_found || 0,
      verified_store_lookup_pending: byReadiness.verified_store_lookup_pending || 0,
      official_search_required: byReadiness.official_search_required || 0,
      alternate_official_reference_required: plans.filter(
        (plan) =>
          plan.motion_reference_readiness === "alternate_official_reference_required" ||
          (plan.alternate_reference_required_entities || []).length > 0,
      ).length,
      alternate_official_reference_required_entities: plans.reduce(
        (sum, plan) => sum + (plan.alternate_reference_required_entities || []).length,
        0,
      ),
      no_reference_path: byReadiness.no_reference_path || 0,
      reject: byReadiness.reject || 0,
      total_references: plans.reduce((sum, plan) => sum + plan.references.length, 0),
      excluded_references: plans.reduce((sum, plan) => sum + (plan.excluded_references || []).length, 0),
      steam_references: plans.reduce(
        (sum, plan) => sum + plan.references.filter((ref) => ref.provider === "steam").length,
        0,
      ),
      igdb_references: plans.reduce(
        (sum, plan) => sum + plan.references.filter((ref) => ref.provider === "igdb").length,
        0,
      ),
      official_intake_references: plans.reduce(
        (sum, plan) => sum + plan.references.filter((ref) => ref.provider === "official_intake").length,
        0,
      ),
      trusted_footage_registry_references: plans.reduce(
        (sum, plan) =>
          sum + plan.references.filter((ref) => ref.provider === "trusted_footage_registry").length,
        0,
      ),
      segment_validation_eligible_references: plans.reduce(
        (sum, plan) => sum + (plan.segment_validation_reference_counts?.eligible || 0),
        0,
      ),
      segment_validation_ineligible_references: plans.reduce(
        (sum, plan) => sum + (plan.segment_validation_reference_counts?.ineligible || 0),
        0,
      ),
    },
    plans,
    safety: {
      report_only: true,
      video_downloads: false,
      frame_extraction: false,
      clip_slicing: false,
      yt_dlp: false,
      browser_scraping: false,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
    },
  };
}

function renderOfficialTrailerReferenceMarkdown(report) {
  const lines = [];
  lines.push("# Official Trailer Reference Resolver v1");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Execution mode: ${report.execution_mode}`);
  lines.push(`Will download: ${report.will_download}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- stories: ${report.summary.stories}`);
  lines.push(`- official references found: ${report.summary.official_reference_found}`);
  lines.push(`- partial references found: ${report.summary.partial_official_reference_found || 0}`);
  lines.push(`- Steam references: ${report.summary.steam_references}`);
  lines.push(`- IGDB references: ${report.summary.igdb_references}`);
  lines.push(`- official intake references: ${report.summary.official_intake_references || 0}`);
  lines.push(`- trusted footage registry references: ${report.summary.trusted_footage_registry_references || 0}`);
  lines.push(`- segment-validation eligible references: ${report.summary.segment_validation_eligible_references || 0}`);
  lines.push(`- reference-only/non-playable references: ${report.summary.segment_validation_ineligible_references || 0}`);
  lines.push(`- official search required: ${report.summary.official_search_required}`);
  lines.push(`- alternate official reference required: ${report.summary.alternate_official_reference_required || 0}`);
  lines.push(
    `- alternate-source entities required: ${report.summary.alternate_official_reference_required_entities || 0}`,
  );
  lines.push(`- exhausted references excluded: ${report.summary.excluded_references || 0}`);
  lines.push("");
  lines.push(
    "| story | readiness | targets | missing targets | alternate-source targets | refs | excluded | searches | blockers | warnings |",
  );
  lines.push("| --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- |");
  for (const plan of report.plans) {
    lines.push(
      [
        plan.story_id,
        plan.motion_reference_readiness,
        plan.target_entities?.length || 0,
        (plan.missing_target_entities || []).join(", ") || "none",
        (plan.alternate_reference_required_entities || []).join(", ") || "none",
        plan.references.length,
        (plan.excluded_references || []).length,
        plan.planned_searches.length,
        plan.blockers.join(", ") || "clear",
        (plan.warnings || []).join(", ") || "none",
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Report-only.");
  lines.push("- Video references only; no trailer/video downloads.");
  lines.push("- No frame extraction or clip slicing.");
  lines.push("- No yt-dlp, browser scraping, Railway changes, OAuth, production DB mutation or posting.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildOfficialTrailerReferencePlan,
  buildOfficialTrailerReferenceReport,
  filterResolvedReferences,
  renderOfficialTrailerReferenceMarkdown,
};
