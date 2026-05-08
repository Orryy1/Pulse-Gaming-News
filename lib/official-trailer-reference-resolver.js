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
  ].filter(Boolean);
}

function isVerifiedSteamAsset(asset) {
  const source = String(asset?.store_asset_source || asset?.source || asset?.source_type || asset?.type || "")
    .toLowerCase();
  return (
    (source === "steam" || source.startsWith("steam_")) &&
    Boolean(asset?.store_app_id) &&
    Boolean(asset?.store_app_title || asset?.store_app_slug) &&
    asset?.store_match_verified === true
  );
}

function buildSteamTargets(story) {
  const seen = new Set();
  const targets = [];
  for (const asset of sourceAssets(story)) {
    if (!isVerifiedSteamAsset(asset)) continue;
    const key = String(asset.store_app_id);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      provider: "steam",
      story_id: story?.id || null,
      entity: asset.entity || asset.exact_subject_group || null,
      store_app_id: String(asset.store_app_id),
      store_app_title: asset.store_app_title || null,
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

function storyTargetEntities(story) {
  return uniqueStrings(buildSubjectGraph(story).required_subject_groups);
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
  return {
    source_type: "steam_movie",
    provider: "steam",
    story_id: target.story_id || null,
    source_url: sourceUrl,
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
  return {
    source_type: "igdb_video",
    provider: "igdb",
    source_url: sourceUrl,
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
    if (referenceEntitySet.has(normaliseLabel(entity))) covered.push(entity);
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

function buildSearchQueries(story, acquisitionPlan, targetEntities = []) {
  const existing = acquisitionPlan?.search_queries || [];
  const title = String(story?.title || "").trim();
  return Array.from(
    new Set(
      [
        ...targetEntities.flatMap((entity) => [
          `${entity} official trailer`,
          `${entity} gameplay trailer`,
          `${entity} Steam trailer`,
        ]),
        ...existing.filter((query) => /official trailer|gameplay/i.test(query)),
        title ? `${title} official trailer` : null,
        title ? `${title} gameplay trailer` : null,
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
    .map((reference) => ({
      ...reference,
      provider: "official_intake",
      source_verified: reference.source_verified !== false,
      downloads_allowed: false,
      allowed_render_use: reference.allowed_render_use || "reference_only_by_default",
      rights_risk_class: reference.rights_risk_class || "official_reference_only",
      provenance: {
        ...(reference.provenance || {}),
        source: reference.provenance?.source || "operator_official_source_intake",
      },
    }));
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
  const resolvedReferences = [...steamReferences, ...igdbReferences, ...officialIntakeReferences];
  const referenceFilter = filterResolvedReferences(resolvedReferences, options);
  const references = referenceFilter.references;
  const { covered: coveredTargetEntities, missing: missingTargetEntities } = targetReferenceCoverage(
    targetEntities,
    references,
  );
  const alternateRequiredEntities = alternateReferenceRequiredEntities(
    missingTargetEntities,
    referenceFilter.excluded_references,
  );
  const searchQueries = buildSearchQueries(story, acquisitionPlan, missingTargetEntities);
  const motionReferenceReadiness = readinessFor({
    topicality: acquisitionPlan.topicality_verdict,
    references,
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
    covered_target_entities: coveredTargetEntities,
    missing_target_entities: missingTargetEntities,
    alternate_reference_required_entities: alternateRequiredEntities,
    verified_store_targets: verifiedStoreTargets,
    resolved_reference_count: resolvedReferences.length,
    references,
    excluded_references: referenceFilter.excluded_references,
    exhausted_source_family_filter: referenceFilter.exhausted_source_family_filter,
    lookup_results,
    summary_accepted_official_intake_references: officialIntakeReferences.length,
    planned_searches: plannedSearches(searchQueries, missingTargetEntities),
    search_queries: searchQueries,
    provenance_ledger: references.map((reference) => ({
      source_url: reference.source_url,
      source_type: reference.source_type,
      provider: reference.provider,
      entity: reference.entity,
      rights_risk_class: reference.rights_risk_class,
      allowed_render_use: reference.allowed_render_use,
      downloads_allowed: false,
      provenance: reference.provenance,
    })),
    blockers:
      motionReferenceReadiness === "official_reference_found"
        ? []
        : [
            missingTargetEntities.length > 0 ? "missing_official_reference_entities" : null,
            alternateRequiredEntities.length > 0 ? "alternate_official_reference_required" : null,
            references.length === 0 ? "no_official_reference_resolved" : null,
            referenceFilter.excluded_references.length > 0 ? "resolved_references_exhausted" : null,
            verifiedStoreTargets.length === 0 ? "no_verified_store_motion_target" : null,
          ].filter(Boolean),
    warnings: [
      referenceFilter.excluded_references.length > 0 ? "some_resolved_references_were_exhausted_locally" : null,
      alternateRequiredEntities.length > 0 ? "alternate_source_needed_for_missing_entities" : null,
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
