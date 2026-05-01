"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ALLOWED_STILL_SOURCE_TYPES = new Set([
  "article_hero",
  "article_inline",
  "igdb_cover",
  "igdb_screenshot",
  "official_developer_image",
  "official_publisher_image",
  "platform_logo",
  "platform_ui",
  "steam_capsule",
  "steam_header",
  "steam_hero",
  "steam_library",
  "steam_screenshot",
]);

const ALLOWED_FRAME_SOURCE_TYPES = new Set([
  "official_trailer_frame",
  "official_trailer_reference",
  "steam_movie",
  "steam_trailer_frame",
  "igdb_video_reference",
]);

const WRONG_STORY_HINTS = [
  "metro",
  "metro 2039",
  "pokemon",
  "pokémon",
  "mewtwo",
  "gta",
  "grand theft auto",
  "red dead",
  "bioshock",
  "marathon",
  "division",
  "tales",
];

const UNSAFE_ASSET_RE = /\b(author|avatar|byline|face|headshot|human|mugshot|people|person|portrait|profile|selfie|userpic)\b/i;
const GENERIC_ENTITY_RE = /^(steam|playstation|xbox|pc|nintendo|switch|article|official|platform)$/i;

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9é ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function storyText(story) {
  return normaliseText(
    [
      story?.id,
      story?.title,
      story?.hook,
      story?.body,
      story?.loop,
      story?.full_script,
      story?.tts_script,
      story?.company_name,
      story?.publisher,
      story?.developer,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function assetBlob(asset) {
  return normaliseText(
    [
      asset?.local_path,
      asset?.path,
      asset?.source_url,
      asset?.url,
      asset?.source_type,
      asset?.entity,
      asset?.title,
      asset?.label,
      asset?.role,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function assetKey(asset) {
  return String(
    asset?.duplicate_hash ||
      asset?.content_hash ||
      asset?.local_path ||
      asset?.path ||
      asset?.source_url ||
      asset?.url ||
      "",
  ).trim();
}

function basenameKey(asset) {
  return path.resolve(String(asset?.local_path || asset?.path || ""));
}

function isStoreSourceType(sourceType) {
  return /^(steam|igdb)_/.test(String(sourceType || ""));
}

function isVerifiedExactSubjectAsset(asset) {
  const quality = String(asset?.subject_match_quality || "");
  const isExactSubject =
    quality === "exact_game_match" ||
    quality === "exact_franchise_match" ||
    quality === "exact_platform_match";
  if (!isExactSubject) return false;
  if (asset.counted_for_premium !== true && asset.counted_for_standard !== true) return false;
  const group = normaliseText(asset.exact_subject_group || "");
  const entity = normaliseText(asset.entity || "");
  if (group && entity && group !== entity) return false;
  if (isStoreSourceType(asset.source_type) && asset.store_match_verified !== true) return false;
  return true;
}

function unsafeReason(asset) {
  if (!ALLOWED_STILL_SOURCE_TYPES.has(asset.source_type)) {
    return "source_type_not_allowed";
  }
  const verdict = asset.thumbnail_safety_verdict || {};
  if (verdict.safeForThumbnail === false || verdict.isLikelyHuman === true) {
    return "unsafe_portrait_or_author_asset";
  }
  if (UNSAFE_ASSET_RE.test(assetBlob(asset))) {
    return "unsafe_portrait_or_author_asset";
  }
  if (/^(steam|igdb)_/.test(String(asset.source_type || "")) && GENERIC_ENTITY_RE.test(String(asset.entity || ""))) {
    return "generic_store_asset_without_game_entity";
  }
  if (
    /^article_/.test(String(asset.source_type || "")) &&
    verdict.decision === "review" &&
    Number(verdict.score || 0) < 60
  ) {
    return "low_confidence_article_asset";
  }
  return null;
}

function wrongStoryReason(story, asset) {
  if (isVerifiedExactSubjectAsset(asset)) return null;

  const text = storyText(story);
  const blob = assetBlob(asset);
  for (const hint of WRONG_STORY_HINTS) {
    const n = normaliseText(hint);
    if (!n || !blob.includes(n)) continue;
    if (!text.includes(n)) return "wrong_story_asset_hint";
  }
  const entity = normaliseText(asset.entity);
  if (entity.length >= 4 && !text.includes(entity)) {
    const platformOrGeneric =
      /^(steam|playstation|xbox|pc|nintendo|switch|article|official|platform)$/.test(entity);
    if (!platformOrGeneric) return "low_story_relevance";
  }
  return null;
}

function provenanceMap(plan) {
  const map = new Map();
  for (const item of Array.isArray(plan?.provenance) ? plan.provenance : []) {
    for (const key of [
      item.duplicate_hash,
      item.local_path,
      item.source_url,
      `${item.source_type}:${item.entity}`,
    ]) {
      if (key && !map.has(String(key))) map.set(String(key), item);
    }
  }
  return map;
}

function sourceAssetsFromPlan(plan) {
  const assets = Array.isArray(plan?.applied_assets) && plan.applied_assets.length
    ? plan.applied_assets
    : Array.isArray(plan?.would_fetch)
      ? plan.would_fetch
      : [];
  const provenance = provenanceMap(plan);
  return assets.map((asset) => {
    const key =
      asset.duplicate_hash ||
      asset.local_path ||
      asset.source_url ||
      `${asset.source_type}:${asset.entity}`;
    const prov = provenance.get(String(key)) || provenance.get(String(asset.source_url)) || null;
    const mergedProvenance = {
      ...(prov || {}),
      source_url: prov?.source_url || asset.source_url || asset.url || null,
      source_type: prov?.source_type || asset.source_type || null,
      entity: prov?.entity || asset.entity || null,
      duplicate_hash: prov?.duplicate_hash || asset.duplicate_hash || null,
      store_asset_source: prov?.store_asset_source || asset.store_asset_source || null,
      store_app_id: prov?.store_app_id || asset.store_app_id || null,
      store_app_title: prov?.store_app_title || asset.store_app_title || null,
      store_app_slug: prov?.store_app_slug || asset.store_app_slug || null,
      store_matched_query: prov?.store_matched_query || asset.store_matched_query || null,
      store_match_status: prov?.store_match_status || asset.store_match_status || null,
      store_match_verified:
        prov?.store_match_verified ?? asset.store_match_verified ?? null,
      subject_match_quality:
        prov?.subject_match_quality || asset.subject_match_quality || null,
      subject_match_reason:
        prov?.subject_match_reason || asset.subject_match_reason || null,
      exact_subject_group: prov?.exact_subject_group || asset.exact_subject_group || null,
      counted_for_premium:
        prov?.counted_for_premium ?? asset.counted_for_premium ?? null,
      counted_for_standard:
        prov?.counted_for_standard ?? asset.counted_for_standard ?? null,
    };
    return {
      ...asset,
      local_path: asset.local_path || asset.path || prov?.local_path || null,
      duplicate_hash: asset.duplicate_hash || prov?.duplicate_hash || null,
      rights_risk_class: asset.rights_risk_class || prov?.rights_risk_class || null,
      thumbnail_safety_verdict:
        asset.thumbnail_safety_verdict || prov?.thumbnail_safety_verdict || null,
      provenance: mergedProvenance,
    };
  });
}

function reject(asset, reason) {
  return {
    local_path: asset.local_path || asset.path || null,
    source_url: asset.source_url || asset.url || null,
    source_type: asset.source_type || null,
    entity: asset.entity || null,
    duplicate_hash: asset.duplicate_hash || null,
    reason,
  };
}

function rejectFrame(frame, reason) {
  return {
    local_path: frame.local_path || frame.path || null,
    source_url: frame.source_url || frame.url || null,
    source_type: "official_trailer_frame",
    original_source_type: frame.source_type || null,
    entity: frame.entity || null,
    duplicate_hash: frame.duplicate_hash || frame.qa?.content_hash || null,
    reason,
  };
}

function framesFromReport(frameReport, storyId) {
  const frames = [];
  for (const plan of Array.isArray(frameReport?.plans) ? frameReport.plans : []) {
    if (plan?.story_id !== storyId) continue;
    for (const frame of Array.isArray(plan.frames) ? plan.frames : []) {
      if (frame?.story_id && frame.story_id !== storyId) {
        frames.push({ ...frame, __frameRejectReason: "wrong_story_frame" });
        continue;
      }
      frames.push(frame);
    }
  }
  return frames;
}

function frameUnsafeReason(frame) {
  if (frame.__frameRejectReason) return frame.__frameRejectReason;
  if (!ALLOWED_FRAME_SOURCE_TYPES.has(frame.source_type)) return "source_type_not_allowed";
  if (String(frame.status || "") !== "accepted") return "frame_not_accepted";
  const qa = frame.qa || {};
  if (
    qa.verdict !== "pass" ||
    qa.thumbnail_safe === false ||
    qa.likely_has_face === true ||
    qa.black_frame === true ||
    (Array.isArray(qa.failures) && qa.failures.length > 0)
  ) {
    return "unsafe_or_failed_frame";
  }
  if (UNSAFE_ASSET_RE.test(assetBlob(frame))) return "unsafe_or_failed_frame";
  return null;
}

function buildFrameAsset(frame, resolved, order) {
  const contentHash = frame.qa?.content_hash || frame.duplicate_hash || null;
  const provenance = {
    source_url: frame.source_url || frame.url || null,
    source_type: "official_trailer_frame",
    original_source_type: frame.source_type || null,
    entity: frame.entity || null,
    local_path: resolved,
    duplicate_hash: contentHash,
    content_hash: contentHash,
    acquired_at: frame.acquired_at || null,
    rights_risk_class: "official_store_trailer_frame",
    relevance_score: Number(frame.relevance_score || frame.score || 96),
    target_time_percent: frame.target_time_percent ?? null,
    target_time_seconds: frame.target_time_seconds ?? null,
    extraction_mode: frame.extraction_mode || null,
    qa: frame.qa || null,
  };
  return {
    path: resolved,
    kind: "trailer-frame",
    sourceType: "official_trailer_frame",
    source: "official-trailer-frame",
    entity: frame.entity || null,
    score: Number(frame.score || 115 - order),
    sourceUrl: frame.source_url || frame.url || null,
    rightsRiskClass: provenance.rights_risk_class,
    subjectMatchQuality: "exact_subject_frame",
    exactSubjectGroup: frame.entity || null,
    countedForPremium: true,
    countedForStandard: true,
    provenance,
  };
}

async function buildStillDeckMediaPackage({ story, plan, frameReport = null, maxRepeatPerAsset = 1 } = {}) {
  if (!story?.id) throw new Error("story.id is required");
  if (!plan) throw new Error("still-deck plan is required");
  if (plan.story_id && plan.story_id !== story.id) {
    throw new Error(`still-deck plan story mismatch: ${plan.story_id} !== ${story.id}`);
  }

  const seen = new Set();
  const pathUse = new Map();
  const assets = [];
  const rejected = [];
  let acceptedFrameCount = 0;
  let rejectedFrameCount = 0;

  for (const rawAsset of sourceAssetsFromPlan(plan)) {
    const localPath = rawAsset.local_path || rawAsset.path;
    const safeReason = unsafeReason(rawAsset);
    if (safeReason) {
      rejected.push(reject(rawAsset, safeReason));
      continue;
    }
    if (!localPath || !(await fs.pathExists(localPath))) {
      rejected.push(reject(rawAsset, "missing_local_asset"));
      continue;
    }
    const wrongReason = wrongStoryReason(story, rawAsset);
    if (wrongReason) {
      rejected.push(reject(rawAsset, wrongReason));
      continue;
    }
    const key = assetKey(rawAsset);
    const resolved = basenameKey(rawAsset);
    const sourceKey = key || resolved;
    if (sourceKey && seen.has(sourceKey)) {
      rejected.push(reject(rawAsset, "duplicate_asset"));
      continue;
    }
    const useCount = pathUse.get(resolved) || 0;
    if (useCount >= maxRepeatPerAsset) {
      rejected.push(reject(rawAsset, "asset_repeat_cap_reached"));
      continue;
    }
    seen.add(sourceKey);
    pathUse.set(resolved, useCount + 1);
    assets.push({
      path: resolved,
      kind: "enriched-still",
      sourceType: rawAsset.source_type,
      source: rawAsset.source_type?.startsWith("steam")
        ? "steam"
        : rawAsset.source_type?.startsWith("igdb")
          ? "igdb"
          : rawAsset.source_type?.startsWith("article")
            ? "article"
            : "official",
      entity: rawAsset.entity || null,
      score: Number(rawAsset.score || rawAsset.relevance_score || 0),
      sourceUrl: rawAsset.source_url || rawAsset.url || null,
      rightsRiskClass: rawAsset.rights_risk_class || rawAsset.provenance?.rights_risk_class || null,
      subjectMatchQuality: rawAsset.subject_match_quality || rawAsset.provenance?.subject_match_quality || null,
      exactSubjectGroup: rawAsset.exact_subject_group || rawAsset.provenance?.exact_subject_group || null,
      countedForPremium: rawAsset.counted_for_premium ?? rawAsset.provenance?.counted_for_premium ?? null,
      countedForStandard: rawAsset.counted_for_standard ?? rawAsset.provenance?.counted_for_standard ?? null,
      storeAssetSource: rawAsset.store_asset_source || rawAsset.provenance?.store_asset_source || null,
      storeAppId: rawAsset.store_app_id || rawAsset.provenance?.store_app_id || null,
      storeAppTitle: rawAsset.store_app_title || rawAsset.provenance?.store_app_title || null,
      storeAppSlug: rawAsset.store_app_slug || rawAsset.provenance?.store_app_slug || null,
      storeMatchedQuery: rawAsset.store_matched_query || rawAsset.provenance?.store_matched_query || null,
      storeMatchStatus: rawAsset.store_match_status || rawAsset.provenance?.store_match_status || null,
      storeMatchVerified: rawAsset.store_match_verified ?? rawAsset.provenance?.store_match_verified ?? null,
      provenance: rawAsset.provenance,
    });
  }

  const frameSeen = new Set();
  let frameOrder = 0;
  for (const frame of framesFromReport(frameReport, story.id)) {
    frameOrder += 1;
    const safeReason = frameUnsafeReason(frame);
    if (safeReason) {
      rejected.push(rejectFrame(frame, safeReason));
      rejectedFrameCount += 1;
      continue;
    }
    const localPath = frame.local_path || frame.path;
    if (!localPath || !(await fs.pathExists(localPath))) {
      rejected.push(rejectFrame(frame, "missing_local_frame"));
      rejectedFrameCount += 1;
      continue;
    }
    const resolved = path.resolve(String(localPath));
    const key = String(frame.qa?.content_hash || frame.duplicate_hash || frame.source_url || resolved);
    if (frameSeen.has(key)) {
      rejected.push(rejectFrame(frame, "duplicate_frame"));
      rejectedFrameCount += 1;
      continue;
    }
    const useCount = pathUse.get(resolved) || 0;
    if (useCount >= maxRepeatPerAsset) {
      rejected.push(rejectFrame(frame, "asset_repeat_cap_reached"));
      rejectedFrameCount += 1;
      continue;
    }
    frameSeen.add(key);
    pathUse.set(resolved, useCount + 1);
    assets.push(buildFrameAsset(frame, resolved, frameOrder));
    acceptedFrameCount += 1;
  }

  const maxAssetRepeat = Math.max(0, ...pathUse.values());
  const stillAssets = assets.filter((asset) => asset.kind !== "trailer-frame");
  const frameAssets = assets.filter((asset) => asset.kind === "trailer-frame");
  return {
    schemaVersion: 1,
    storyId: story.id,
    title: story.title || "",
    source: acceptedFrameCount
      ? "asset_acquisition_still_deck_plus_local_official_frames"
      : "asset_acquisition_v11_still_deck",
    assets,
    rejected,
    provenance: assets.map((asset) => asset.provenance),
    metrics: {
      acceptedCount: stillAssets.length,
      rejectedCount: rejected.length,
      distinctEntities: new Set(assets.map((asset) => asset.entity).filter(Boolean)).size,
      distinctSourceTypes: new Set(assets.map((asset) => asset.sourceType).filter(Boolean)).size,
      maxAssetRepeat,
      acceptedFrameCount,
      rejectedFrameCount,
      distinctFrameEntities: new Set(frameAssets.map((asset) => asset.entity).filter(Boolean)).size,
    },
    media: {
      clips: [],
      trailerFrames: frameAssets.map((asset) => ({
        path: asset.path,
        kind: "trailer-frame",
        source: asset.source,
        sourceType: asset.sourceType,
        entity: asset.entity,
        score: asset.score,
        provenance: asset.provenance,
      })),
      articleHeroes: stillAssets.map((asset) => ({
        path: asset.path,
        kind: "enriched-still",
        source: asset.source,
        sourceType: asset.sourceType,
        entity: asset.entity,
        score: asset.score,
        provenance: asset.provenance,
      })),
      publisherAssets: [],
      stockFillers: [],
    },
  };
}

function planCandidateScore(plan, preferredStoryIds = []) {
  const preferredRank = preferredStoryIds.indexOf(plan.story_id);
  const preferredScore = preferredRank >= 0 ? 1000 - preferredRank * 10 : 0;
  const improvementScore = plan.would_improve_readiness ? 100 : 0;
  const fetchCount = (plan.applied_assets || plan.would_fetch || []).length;
  const rejectedPenalty = (plan.would_reject || []).length;
  return preferredScore + improvementScore + fetchCount * 2 - rejectedPenalty;
}

function selectStillDeckPlan(report, options = {}) {
  const plans = Array.isArray(report?.plans) ? report.plans : [];
  const preferredStoryIds = options.preferredStoryIds || [];
  if (!plans.length) return null;
  if (options.storyId) {
    return plans.find((plan) => plan.story_id === options.storyId) || null;
  }
  const eligible = plans.filter((plan) => {
    const count = (plan.applied_assets || plan.would_fetch || []).length;
    return count > 0 || plan.would_change_visual_deck === true;
  });
  const pool = eligible.length ? eligible : plans;
  return pool
    .slice()
    .sort(
      (a, b) =>
        planCandidateScore(b, preferredStoryIds) - planCandidateScore(a, preferredStoryIds),
    )[0];
}

function uniquePlanEntities(plan) {
  const entities = [];
  const add = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    if (!entities.some((item) => normaliseText(item) === normaliseText(text))) {
      entities.push(text);
    }
  };

  for (const entity of Array.isArray(plan?.diversity_delta?.added_entities)
    ? plan.diversity_delta.added_entities
    : []) {
    add(entity);
  }
  for (const asset of sourceAssetsFromPlan(plan)) {
    add(asset.exact_subject_group);
    add(asset.entity);
  }
  return entities;
}

function buildStoryFromStillDeckPlan(plan = {}) {
  const title = String(plan.title || plan.story_id || "Local still-deck proof").trim();
  const entities = uniquePlanEntities(plan);
  const entitySentence = entities.length
    ? `The verified still deck covers ${entities.join(", ")}.`
    : "The verified still deck covers the story subjects recorded in the acquisition report.";
  const script = [title, entitySentence, "This is a local visual proof only."]
    .filter(Boolean)
    .join(" ");

  return {
    id: String(plan.story_id || "local_still_deck_story"),
    title,
    hook: title,
    body: entitySentence,
    loop: "Follow Pulse Gaming so you never miss a beat.",
    full_script: script,
    source_type: "asset_acquisition_report",
    subreddit: "Asset Acquisition Pro",
    score: 0,
    approved: false,
    auto_approved: false,
  };
}

function buildStillDeckMarkdown({ packageResult, title = "Studio V2 Still-Deck Ingestion" }) {
  const lines = [`# ${title}`, ""];
  lines.push(`Story: ${packageResult.storyId}`);
  lines.push(`Accepted stills: ${packageResult.metrics.acceptedCount}`);
  lines.push(`Accepted trailer frames: ${packageResult.metrics.acceptedFrameCount || 0}`);
  lines.push(`Rejected stills: ${packageResult.metrics.rejectedCount}`);
  lines.push(`Rejected trailer frames: ${packageResult.metrics.rejectedFrameCount || 0}`);
  lines.push(`Distinct entities: ${packageResult.metrics.distinctEntities}`);
  lines.push(`Distinct frame entities: ${packageResult.metrics.distinctFrameEntities || 0}`);
  lines.push(`Distinct source types: ${packageResult.metrics.distinctSourceTypes}`);
  lines.push("");
  lines.push("| asset | entity | source | risk |");
  lines.push("| --- | --- | --- | --- |");
  for (const asset of packageResult.assets) {
    lines.push(
      `| ${path.basename(asset.path)} | ${asset.entity || ""} | ${asset.sourceType || ""} | ${asset.rightsRiskClass || ""} |`,
    );
  }
  if (!packageResult.assets.length) lines.push("| none | | | |");
  if (packageResult.rejected.length) {
    lines.push("", "## Rejected", "", "| asset | reason |", "| --- | --- |");
    for (const item of packageResult.rejected) {
      lines.push(`| ${path.basename(item.local_path || item.source_url || "asset")} | ${item.reason} |`);
    }
  }
  return lines.join("\n") + "\n";
}

module.exports = {
  ALLOWED_STILL_SOURCE_TYPES,
  buildStillDeckMarkdown,
  buildStillDeckMediaPackage,
  buildStoryFromStillDeckPlan,
  selectStillDeckPlan,
};
