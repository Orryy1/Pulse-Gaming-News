"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const axios = require("axios");
const fs = require("fs-extra");
const {
  officialTrailerFrameRejectReason,
} = require("../../controlled-frame-extraction-worker");
const { prescanImage } = require("../../visual-content-prescan");
const mediaPaths = require("../../media-paths");
const { classifyOutboundUrl, safeRedirectConfig } = require("../../safe-url");

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
  "steam_storefront_video_reference",
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
const LOW_DETAIL_TASTE_REASONS = new Set([
  "dead_dark_frame",
  "washed_low_detail_frame",
  "blurred_low_detail_frame",
  "low_visual_information_frame",
  "muddy_dark_low_energy_frame",
]);
const TITLE_CARD_TASTE_REASONS = new Set([
  "white_text_on_dark_card",
  "logo_or_rating_card",
  "text_card_frame",
  "high_contrast_card_frame",
  "promotional_store_slate_frame",
  "rating_board_text_frame",
  "legal_slate_text_frame",
  "logo_only_text_frame",
  "title_slate_text_frame",
]);

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

function isUnder(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function safeName(value, fallback = "asset") {
  const out = String(value || fallback)
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return out || fallback;
}

function extensionFor(contentType, url) {
  const fromType = String(contentType || "").toLowerCase();
  if (fromType.includes("png")) return ".png";
  if (fromType.includes("webp")) return ".webp";
  if (fromType.includes("gif")) return ".gif";
  if (fromType.includes("svg")) return ".svg";
  try {
    const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"].includes(fromUrl)) return fromUrl;
  } catch {}
  return ".jpg";
}

async function defaultFetchStillDeckImage(url) {
  const safe = classifyOutboundUrl(url);
  if (!safe.ok) throw new Error(`unsafe_url:${safe.reason}`);
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: { "User-Agent": "PulseGamingStillDeck/1.0" },
    ...safeRedirectConfig(3),
    maxContentLength: 20 * 1024 * 1024,
  });
  const contentType = String(response.headers?.["content-type"] || "");
  if (!/^image\//i.test(contentType)) {
    throw new Error(`non_image_content_type:${contentType || "unknown"}`);
  }
  return {
    buffer: Buffer.from(response.data),
    contentType,
  };
}

async function resolveLocalAssetPath(localPath) {
  if (!localPath) return null;
  if (await fs.pathExists(localPath)) return path.resolve(String(localPath));
  const mediaResolved = await mediaPaths.resolveExisting(String(localPath));
  if (mediaResolved && (await fs.pathExists(mediaResolved))) return mediaResolved;
  const absolute = path.resolve(String(localPath));
  if (await fs.pathExists(absolute)) return absolute;
  return null;
}

async function materialiseMissingStillDeckAssets({
  plan,
  storyId = null,
  outputRoot,
  fetchImage = defaultFetchStillDeckImage,
  maxAssets = 12,
} = {}) {
  if (!plan?.visual_deck || !Array.isArray(plan.visual_deck.items)) return plan;
  if (!outputRoot) throw new Error("outputRoot is required to materialise still-deck assets");

  const resolvedOutputRoot = path.resolve(outputRoot);
  const storyDir = path.join(resolvedOutputRoot, safeName(storyId || plan.story_id || "story"));
  if (!isUnder(resolvedOutputRoot, storyDir)) {
    throw new Error("still-deck materialisation target escaped output root");
  }
  await fs.ensureDir(storyDir);

  const applied = [];
  const provenance = [];
  let fetchedCount = 0;
  const items = [];
  for (const item of plan.visual_deck.items) {
    const next = { ...item };
    const sourceType = next.source_type || next.provenance?.source_type || null;
    const sourceUrl = next.source_url || next.url || next.provenance?.source_url || null;
    if (
      fetchedCount < maxAssets &&
      !next.local_path &&
      !next.path &&
      sourceUrl &&
      ALLOWED_STILL_SOURCE_TYPES.has(sourceType)
    ) {
      try {
        const fetched = await fetchImage(sourceUrl, next);
        const contentHash = crypto.createHash("sha256").update(fetched.buffer).digest("hex");
        const duplicateHash = next.duplicate_hash || contentHash.slice(0, 16);
        const ext = extensionFor(fetched.contentType, sourceUrl);
        const fileName = `${safeName(next.entity || "asset")}_${safeName(sourceType)}_${duplicateHash}${ext}`;
        const target = path.join(storyDir, fileName);
        if (!isUnder(storyDir, target)) {
          throw new Error("materialised_asset_path_escape");
        }
        await fs.writeFile(target, fetched.buffer);
        next.local_path = target;
        next.path = target;
        next.duplicate_hash = duplicateHash;
        next.content_hash = contentHash;
        fetchedCount += 1;
        const materialised = {
          ...next,
          source_url: sourceUrl,
          source_type: sourceType,
          local_path: target,
          path: target,
          duplicate_hash: duplicateHash,
          content_hash: contentHash,
        };
        applied.push(materialised);
        provenance.push({
          source_url: sourceUrl,
          source_type: sourceType,
          entity: next.entity || null,
          action: "materialised_visual_deck_asset",
          local_path: target,
          duplicate_hash: duplicateHash,
          content_hash: contentHash,
          rights_risk_class: next.rights_risk_class || "storefront_promotional",
        });
      } catch (err) {
        provenance.push({
          source_url: sourceUrl,
          source_type: sourceType,
          entity: next.entity || null,
          action: "materialise_visual_deck_asset_failed",
          reason: err?.message || "fetch_failed",
        });
      }
    }
    items.push(next);
  }

  return {
    ...plan,
    visual_deck: {
      ...plan.visual_deck,
      items,
    },
    applied_assets: [
      ...(Array.isArray(plan.applied_assets) ? plan.applied_assets : []),
      ...applied,
    ],
    provenance: [
      ...(Array.isArray(plan.provenance) ? plan.provenance : []),
      ...provenance,
    ],
    materialised_visual_deck_assets: {
      attempted: provenance.length,
      applied: applied.length,
      output_root: resolvedOutputRoot,
    },
  };
}

function isStoreSourceType(sourceType) {
  return /^(steam|igdb)_/.test(String(sourceType || ""));
}

function isGenericEntity(value) {
  return GENERIC_ENTITY_RE.test(String(value || ""));
}

function isVerifiedExactSubjectAsset(asset) {
  const quality = String(asset?.subject_match_quality || asset?.provenance?.subject_match_quality || "");
  const isExactSubject =
    quality === "exact_game_match" ||
    quality === "exact_franchise_match" ||
    quality === "exact_platform_match";
  if (!isExactSubject) return false;
  const countedForPremium = asset.counted_for_premium ?? asset?.provenance?.counted_for_premium;
  const countedForStandard = asset.counted_for_standard ?? asset?.provenance?.counted_for_standard;
  if (countedForPremium !== true && countedForStandard !== true) return false;
  const group = normaliseText(asset.exact_subject_group || asset?.provenance?.exact_subject_group || "");
  const entity = normaliseText(asset.entity || "");
  if (group && entity && group !== entity && !isGenericEntity(entity)) return false;
  const sourceType = asset.source_type || asset?.provenance?.source_type;
  const storeMatchVerified = asset.store_match_verified ?? asset?.provenance?.store_match_verified;
  if (isStoreSourceType(sourceType) && storeMatchVerified !== true) return false;
  return true;
}

function effectiveAssetEntity(asset) {
  const entity = String(asset?.entity || "").trim();
  const group = String(asset?.exact_subject_group || asset?.provenance?.exact_subject_group || "").trim();
  if (group && (!entity || isGenericEntity(entity)) && isVerifiedExactSubjectAsset(asset)) {
    return group;
  }
  return entity || group || null;
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
  if (
    /^(steam|igdb)_/.test(String(asset.source_type || "")) &&
    isGenericEntity(asset.entity) &&
    !isVerifiedExactSubjectAsset(asset)
  ) {
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

function firstTasteObject(...items) {
  for (const item of items) {
    const candidates = [
      item?.visual_taste,
      item?.visualTaste,
      item?.trailer_frame_taste,
      item?.frame_taste,
      item?.taste,
      item?.prescan?.trailer_frame_taste,
      item?.thumbnail_safety_verdict?.visual_taste,
      item?.provenance?.visual_taste,
      item?.provenance?.visualTaste,
      item?.provenance?.trailer_frame_taste,
      item?.provenance?.frame_taste,
      item?.provenance?.taste,
      item?.provenance?.prescan?.trailer_frame_taste,
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object") return candidate;
    }
  }
  return null;
}

function stillTasteRejectReasonFromTaste(taste = {}) {
  const verdict = String(taste?.verdict || "").toLowerCase();
  if (verdict !== "fail" && verdict !== "reject") return null;
  const reason = String(taste?.reason || "").trim();
  if (TITLE_CARD_TASTE_REASONS.has(reason)) return "title_or_rating_card_still";
  if (LOW_DETAIL_TASTE_REASONS.has(reason)) return "low_detail_still_frame";
  return "low_detail_still_frame";
}

async function stillVisualTasteRejectReason(asset, resolvedPath) {
  const explicit = stillTasteRejectReasonFromTaste(firstTasteObject(asset));
  if (explicit) return explicit;
  const sourceType = String(asset?.source_type || asset?.provenance?.source_type || "");
  if (!/^(steam|igdb|official)_/.test(sourceType)) return null;
  const prescan = await prescanImage(resolvedPath, { sourceTypeHint: sourceType }).catch(() => null);
  return stillTasteRejectReasonFromTaste(prescan?.trailer_frame_taste);
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
  const sourceAssets = [
    ...(Array.isArray(plan?.applied_assets) ? plan.applied_assets : []),
    ...(Array.isArray(plan?.would_fetch) ? plan.would_fetch : []),
    ...(Array.isArray(plan?.visual_deck?.items) ? plan.visual_deck.items : []),
  ];
  const provenance = provenanceMap(plan);
  return sourceAssets.map((asset) => {
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
    const mergedAsset = {
      ...asset,
      local_path: asset.local_path || asset.path || prov?.local_path || null,
      duplicate_hash: asset.duplicate_hash || prov?.duplicate_hash || null,
      rights_risk_class: asset.rights_risk_class || prov?.rights_risk_class || null,
      thumbnail_safety_verdict:
        asset.thumbnail_safety_verdict || prov?.thumbnail_safety_verdict || null,
      provenance: mergedProvenance,
    };
    return {
      ...mergedAsset,
      entity: effectiveAssetEntity(mergedAsset),
    };
  });
}

function mergeStillDeckApplyLocalPlan(basePlan = {}, applyPlan = {}) {
  const baseVisualDeck = basePlan?.visual_deck || null;
  const applyVisualDeck = applyPlan?.visual_deck || null;
  const appliedAssets = [
    ...(Array.isArray(applyPlan?.applied_assets) ? applyPlan.applied_assets : []),
    ...(Array.isArray(basePlan?.applied_assets) ? basePlan.applied_assets : []),
  ];
  const visualDeckItems = [
    ...(Array.isArray(applyVisualDeck?.items) ? applyVisualDeck.items : []),
    ...(Array.isArray(baseVisualDeck?.items) ? baseVisualDeck.items : []),
  ];
  const provenance = [
    ...(Array.isArray(basePlan?.provenance) ? basePlan.provenance : []),
    ...(Array.isArray(applyPlan?.provenance) ? applyPlan.provenance : []),
  ];

  return {
    ...(basePlan || {}),
    ...(applyPlan || {}),
    story_id: applyPlan?.story_id || basePlan?.story_id || null,
    title: applyPlan?.title || basePlan?.title || null,
    applied_assets: appliedAssets,
    visual_deck: visualDeckItems.length
      ? {
          ...(baseVisualDeck || {}),
          ...(applyVisualDeck || {}),
          items: visualDeckItems,
        }
      : applyVisualDeck || baseVisualDeck || null,
    provenance,
  };
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
    original_source_type: frame.original_source_type || frame.source_type || null,
    entity: frame.entity || null,
    duplicate_hash: frame.duplicate_hash || frame.qa?.content_hash || null,
    reason,
  };
}

function countAppliedStillCandidates(plan = {}) {
  return [
    ...(Array.isArray(plan.applied_assets) ? plan.applied_assets : []),
    ...(Array.isArray(plan.visual_deck?.items) ? plan.visual_deck.items : []),
  ].filter((asset) => asset && !String(asset.source_type || "").includes("trailer")).length;
}

function stillRejectionReasons(packageResult = {}) {
  const reasons = [];
  for (const row of Array.isArray(packageResult.rejected) ? packageResult.rejected : []) {
    if (String(row?.source_type || "").includes("official_trailer_frame")) continue;
    if (row?.reason && !reasons.includes(row.reason)) reasons.push(row.reason);
    if (reasons.length >= 4) break;
  }
  return reasons;
}

function assertStillDeckPlanMaterialised({
  plan,
  packageResult,
  reportPath = "selected still-deck report",
} = {}) {
  const expectedStillCount = countAppliedStillCandidates(plan);
  const acceptedStillCount = Number(packageResult?.metrics?.acceptedCount || 0);
  if (expectedStillCount <= 0 || acceptedStillCount > 0) {
    return {
      ok: true,
      expectedStillCount,
      acceptedStillCount,
    };
  }
  const reasons = stillRejectionReasons(packageResult);
  const reasonText = reasons.length ? reasons.join(", ") : "no still rejection reasons recorded";
  throw new Error(
    `still_deck_applied_stills_dropped: expected ${expectedStillCount} applied stills from ${reportPath} ` +
      `but package accepted ${acceptedStillCount} stills (${reasonText})`,
  );
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

function segmentStoryId(segment) {
  const sample = (Array.isArray(segment?.samples) ? segment.samples : [])[0];
  const localPath = String(sample?.local_path || sample?.planned_local_path || "");
  const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
  return match ? match[1] : null;
}

function segmentSampleScore(sample = {}, segment = {}) {
  const qa = sample.qa || {};
  let score = Number(sample.score || sample.relevance_score || 0);
  if (sample.status === "accepted") score += 20;
  if (qa.verdict === "pass") score += 15;
  if (qa.thumbnail_safe === true) score += 5;
  if (Array.isArray(qa.failures) && qa.failures.length === 0) score += 3;
  score += Number(segment.action_score || segment.segment_quality_score || 0) / 100;
  return score;
}

function bestSegmentValidationSample(segment = {}) {
  const samples = Array.isArray(segment.samples) ? segment.samples : [];
  if (!samples.length) return null;
  return [...samples].sort(
    (a, b) => segmentSampleScore(b, segment) - segmentSampleScore(a, segment),
  )[0];
}

function framesFromSegmentValidationReport(segmentValidationReport, storyId) {
  const frames = [];
  for (const segment of Array.isArray(segmentValidationReport?.segments)
    ? segmentValidationReport.segments
    : []) {
    const resolvedStoryId = segment.story_id || segmentStoryId(segment);
    if (storyId && resolvedStoryId && resolvedStoryId !== storyId) continue;
    const sample = bestSegmentValidationSample(segment);
    if (sample) {
      frames.push({
        ...sample,
        story_id: resolvedStoryId || storyId || null,
        source_url: sample.source_url || segment.source_url || null,
        source_type: "official_trailer_frame",
        original_source_type: segment.source_type || sample.source_type || null,
        entity: sample.entity || segment.entity || null,
        status: sample.status || (sample.qa?.verdict === "pass" ? "accepted" : "rejected"),
        score: Number(sample.score || segment.action_score || segment.segment_quality_score || 110),
        relevance_score: Number(sample.relevance_score || segment.action_score || 96),
        acquired_at: segment.generated_at || segmentValidationReport?.generated_at || null,
        extraction_mode: "segment_validation_sample",
      });
    }
  }
  return frames;
}

function frameUnsafeReason(frame) {
  if (frame.__frameRejectReason) return frame.__frameRejectReason;
  if (!ALLOWED_FRAME_SOURCE_TYPES.has(frame.source_type)) return "source_type_not_allowed";
  const qa = frame.qa || {};
  const failureReasons = Array.isArray(qa.failures) ? qa.failures : [];
  if (failureReasons.includes("title_or_rating_card_frame")) return "title_or_rating_card_frame";
  if (failureReasons.includes("low_detail_official_frame")) return "low_detail_official_frame";
  const officialFrameReason = officialTrailerFrameRejectReason(frame, qa);
  if (officialFrameReason) return officialFrameReason;
  if (String(frame.status || "") !== "accepted") return "frame_not_accepted";
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
    original_source_type: frame.original_source_type || frame.source_type || null,
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
    perceptual_hash: frame.__perceptual_hash || null,
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

async function framePerceptualHash(filePath) {
  try {
    const sharp = require("sharp");
    const width = 9;
    const height = 8;
    const data = await sharp(filePath)
      .resize(width, height, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    let bits = "";
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width - 1; col += 1) {
        const left = data[row * width + col];
        const right = data[row * width + col + 1];
        bits += left > right ? "1" : "0";
      }
    }
    return bits;
  } catch (_) {
    return null;
  }
}

function hammingDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const len = Math.min(left.length, right.length);
  let dist = Math.abs(left.length - right.length);
  for (let i = 0; i < len; i += 1) {
    if (left[i] !== right[i]) dist += 1;
  }
  return dist;
}

async function buildStillDeckMediaPackage({
  story,
  plan,
  frameReport = null,
  segmentValidationReport = null,
  maxRepeatPerAsset = 1,
} = {}) {
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
  const frameVisualHashes = [];

  for (const rawAsset of sourceAssetsFromPlan(plan)) {
    const localPath = rawAsset.local_path || rawAsset.path;
    const safeReason = unsafeReason(rawAsset);
    if (safeReason) {
      rejected.push(reject(rawAsset, safeReason));
      continue;
    }
    const resolvedLocalPath = await resolveLocalAssetPath(localPath);
    if (!resolvedLocalPath) {
      rejected.push(reject(rawAsset, "missing_local_asset"));
      continue;
    }
    const asset = {
      ...rawAsset,
      local_path: resolvedLocalPath,
      path: resolvedLocalPath,
    };
    const tasteReason = await stillVisualTasteRejectReason(asset, resolvedLocalPath);
    if (tasteReason) {
      rejected.push(reject(asset, tasteReason));
      continue;
    }
    const wrongReason = wrongStoryReason(story, asset);
    if (wrongReason) {
      rejected.push(reject(asset, wrongReason));
      continue;
    }
    const key = assetKey(asset);
    const resolved = basenameKey(asset);
    const sourceKey = key || resolved;
    if (sourceKey && seen.has(sourceKey)) {
      rejected.push(reject(asset, "duplicate_asset"));
      continue;
    }
    const useCount = pathUse.get(resolved) || 0;
    if (useCount >= maxRepeatPerAsset) {
      rejected.push(reject(asset, "asset_repeat_cap_reached"));
      continue;
    }
    seen.add(sourceKey);
    pathUse.set(resolved, useCount + 1);
    assets.push({
      path: resolved,
      kind: "enriched-still",
      sourceType: asset.source_type,
      source: asset.source_type?.startsWith("steam")
        ? "steam"
        : asset.source_type?.startsWith("igdb")
          ? "igdb"
          : asset.source_type?.startsWith("article")
            ? "article"
            : "official",
      entity: asset.entity || null,
      score: Number(asset.score || asset.relevance_score || 0),
      sourceUrl: asset.source_url || asset.url || null,
      rightsRiskClass: asset.rights_risk_class || asset.provenance?.rights_risk_class || null,
      subjectMatchQuality: asset.subject_match_quality || asset.provenance?.subject_match_quality || null,
      exactSubjectGroup: asset.exact_subject_group || asset.provenance?.exact_subject_group || null,
      countedForPremium: asset.counted_for_premium ?? asset.provenance?.counted_for_premium ?? null,
      countedForStandard: asset.counted_for_standard ?? asset.provenance?.counted_for_standard ?? null,
      storeAssetSource: asset.store_asset_source || asset.provenance?.store_asset_source || null,
      storeAppId: asset.store_app_id || asset.provenance?.store_app_id || null,
      storeAppTitle: asset.store_app_title || asset.provenance?.store_app_title || null,
      storeAppSlug: asset.store_app_slug || asset.provenance?.store_app_slug || null,
      storeMatchedQuery: asset.store_matched_query || asset.provenance?.store_matched_query || null,
      storeMatchStatus: asset.store_match_status || asset.provenance?.store_match_status || null,
      storeMatchVerified: asset.store_match_verified ?? asset.provenance?.store_match_verified ?? null,
      provenance: asset.provenance,
    });
  }

  const frameSeen = new Set();
  let frameOrder = 0;
  const candidateFrames = [
    ...framesFromReport(frameReport, story.id),
    ...framesFromSegmentValidationReport(segmentValidationReport, story.id),
  ];
  for (const frame of candidateFrames) {
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
    const perceptualHash = await framePerceptualHash(resolved);
    if (
      perceptualHash &&
      frameVisualHashes.some((hash) => hammingDistance(hash, perceptualHash) <= 6)
    ) {
      rejected.push(rejectFrame(frame, "near_duplicate_frame"));
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
    if (perceptualHash) {
      frame.__perceptual_hash = perceptualHash;
      frameVisualHashes.push(perceptualHash);
    }
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
  assertStillDeckPlanMaterialised,
  buildStillDeckMarkdown,
  buildStillDeckMediaPackage,
  buildStoryFromStillDeckPlan,
  materialiseMissingStillDeckAssets,
  mergeStillDeckApplyLocalPlan,
  selectStillDeckPlan,
};
