"use strict";

const path = require("node:path");

const GAME_ASSET_TYPES = new Set([
  "capsule",
  "hero",
  "key_art",
  "screenshot",
  "trailer_frame",
  "trailerframe",
  "trailer",
  "steam_header",
  "steam_hero",
  "steam_capsule",
]);

const PLATFORM_ASSET_TYPES = new Set([
  "company_logo",
  "logo",
  "platform_logo",
  "platform_ui",
  "store_asset",
]);

const AUTHOR_PROFILE_RE =
  /\b(author|byline|contributor|staff|profile|avatar|headshot|portrait|userpic|user[_-]?photo|gravatar|mugshot)\b/i;
const HUMAN_HINT_RE =
  /\b(face|faces|headshot|portrait|person|people|human|man|woman|men|women|selfie|streamer|creator|actor|actress|presenter|interview|model)\b/i;
const STOCK_SOURCE_RE =
  /\b(pexels|unsplash|shutterstock|getty|istock|stocksy|adobestock|depositphotos|alamy|bing)\b/i;
const GAME_HINT_RE =
  /\b(steam|xbox|playstation|ps5|ps4|nintendo|switch|eshop|game|games|gaming|screenshot|trailer|gameplay|key[_-]?art|capsule|hero|library[_-]?hero|store|cover|boxart|logo|platform)\b/i;
const LOW_VALUE_IMAGE_RE =
  /\b(ad[_-]?image|tracking|pixel|sprite|badge|icon|thumbnail-small|small[_-]?thumb)\b/i;
const UNTRUSTED_VISUAL_SOURCES = new Set([
  "article",
  "reddit",
  "pexels",
  "unsplash",
  "bing",
  "social",
]);
const TRUSTED_GAME_SOURCES = new Set([
  "steam",
  "igdb",
  "official",
  "publisher",
  "trailer",
  "youtube_trailer",
]);

function textBlob(...values) {
  return values
    .flatMap((v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      if (typeof v === "object") return Object.values(v);
      return [v];
    })
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v))
    .join(" ")
    .toLowerCase();
}

function normalise(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function knownEntityNames(story) {
  const out = new Set();
  const add = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      const n = normalise(value);
      if (n.length >= 3) out.add(n);
      return;
    }
    if (typeof value === "object") {
      add(value.name || value.title || value.label || value.personName);
    }
  };

  for (const key of [
    "people",
    "persons",
    "entities",
    "named_entities",
    "story_entities",
    "mentions",
  ]) {
    const value = story && story[key];
    if (Array.isArray(value)) value.forEach(add);
  }
  if (story && story.company_name) add(story.company_name);
  return out;
}

function isNamedInStory(story, name) {
  const n = normalise(name);
  if (!n || n.length < 3) return false;

  const storyText = normalise(
    textBlob(
      story?.title,
      story?.suggested_title,
      story?.suggested_thumbnail_text,
      story?.full_script,
      story?.tts_script,
      story?.company_name,
    ),
  );
  if (storyText.includes(n)) return true;

  for (const entity of knownEntityNames(story)) {
    if (entity === n || entity.includes(n) || n.includes(entity)) return true;
  }
  return false;
}

function candidatePersonName(image) {
  return (
    image?.personName ||
    image?.person_name ||
    image?.subject_person ||
    image?.person ||
    image?.faceName ||
    image?.name ||
    null
  );
}

function candidateBlob(image) {
  const localName = image?.path ? path.basename(String(image.path)) : null;
  return textBlob(
    localName,
    image?.url,
    image?.source,
    image?.type,
    image?.role,
    image?.kind,
    image?.alt,
    image?.title,
    image?.label,
    image?.credit,
    image?.caption,
    candidatePersonName(image),
  );
}

function candidateGameHintBlob(image) {
  const localName = image?.path ? path.basename(String(image.path)) : null;
  return textBlob(
    localName,
    image?.url,
    image?.alt,
    image?.title,
    image?.label,
    image?.caption,
  );
}

function classifyThumbnailImage(story, image) {
  const blob = candidateBlob(image);
  const gameHintBlob = candidateGameHintBlob(image);
  const type = normalise(image?.type).replace(/\s+/g, "_");
  const source = normalise(image?.source);
  const trustedGameSource = TRUSTED_GAME_SOURCES.has(source);
  const untrustedVisualSource = UNTRUSTED_VISUAL_SOURCES.has(source);
  const reasons = [];
  const warnings = [];
  const isGameAsset =
    trustedGameSource ||
    (GAME_ASSET_TYPES.has(type) && !untrustedVisualSource) ||
    (GAME_HINT_RE.test(gameHintBlob) && !STOCK_SOURCE_RE.test(blob));
  const isPlatformAsset =
    PLATFORM_ASSET_TYPES.has(type) || /logo|platform|store/.test(blob);
  const isStock = STOCK_SOURCE_RE.test(blob) || image?.stock === true;
  const isAuthorProfile =
    AUTHOR_PROFILE_RE.test(blob) ||
    image?.role === "author" ||
    image?.is_author_image === true;
  const hasHumanHint =
    HUMAN_HINT_RE.test(blob) ||
    image?.human === true ||
    image?.hasHuman === true ||
    image?.has_human === true ||
    image?.likelyHuman === true ||
    image?.likely_human === true;
  const personName = candidatePersonName(image);
  const namedPersonAllowed = personName ? isNamedInStory(story, personName) : false;

  let score = 35;
  if (isGameAsset) score += 55;
  if (isPlatformAsset) score += 40;
  if (type === "article_hero") score += 12;
  if (type === "reddit_thumb") score -= 20;
  if (isStock) score -= 35;
  if (LOW_VALUE_IMAGE_RE.test(blob)) score -= 30;

  if (isAuthorProfile && !namedPersonAllowed) {
    reasons.push("article_author_or_profile_image");
  }

  if (hasHumanHint && !namedPersonAllowed) {
    reasons.push("unsafe_thumbnail_face");
  }

  if (isStock && hasHumanHint) {
    reasons.push("generic_stock_person");
  } else if (isStock) {
    warnings.push("stock_source_penalty");
  }

  if ((hasHumanHint || isAuthorProfile) && namedPersonAllowed) {
    warnings.push("entity_matched_face_allowed");
    score = Math.min(score, 62);
  }

  if (!isGameAsset && !isPlatformAsset && source === "article") {
    warnings.push("article_image_relevance_review");
    score -= 5;
  }

  if (reasons.length > 0) {
    score = Math.min(score, 5);
  }

  return {
    image,
    safeForThumbnail: reasons.length === 0,
    decision: reasons.length > 0 ? "reject" : warnings.length > 0 ? "review" : "allow",
    reasons,
    warnings,
    score: Math.max(0, Math.min(100, Math.round(score))),
    isLikelyHuman: hasHumanHint || isAuthorProfile,
    isGameAsset,
    isPlatformAsset,
    isStock,
    namedPersonAllowed,
  };
}

function rankThumbnailCandidates(story, images = [], opts = {}) {
  const includeRejected = opts.includeRejected === true;
  return (Array.isArray(images) ? images : [])
    .map((image) => classifyThumbnailImage(story, image))
    .filter((result) => includeRejected || result.safeForThumbnail)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ap = Number(a.image?.priority || 0);
      const bp = Number(b.image?.priority || 0);
      return bp - ap;
    });
}

function selectThumbnailSubjectImage(story, images = []) {
  const ranked = rankThumbnailCandidates(story, images);
  return ranked.length > 0 ? ranked[0] : null;
}

function filterUnsafeImagesForRender(story, images = []) {
  const evaluated = rankThumbnailCandidates(story, images, {
    includeRejected: true,
  });
  const rejected = evaluated.filter((r) => !r.safeForThumbnail);
  let kept = evaluated.filter((r) => r.safeForThumbnail).map((r) => ({
    ...r.image,
    thumbnail_safety_score: r.score,
    thumbnail_safety_warnings: r.warnings,
  }));

  const hasNonStockUseful = kept.some((img) => {
    const r = classifyThumbnailImage(story, img);
    return (r.isGameAsset || r.isPlatformAsset) && !r.isStock;
  });
  if (hasNonStockUseful) {
    kept = kept.filter((img) => !classifyThumbnailImage(story, img).isStock);
  }

  return {
    images: kept,
    rejected,
    evaluated,
    warnings: evaluated.flatMap((r) => r.warnings),
  };
}

function hasReadableTitleText(story) {
  const t = String(
    story?.suggested_thumbnail_text || story?.suggested_title || story?.title || "",
  ).trim();
  return t.length >= 3;
}

function thumbnailTextWarnings(story) {
  const warnings = [];
  const t = String(
    story?.suggested_thumbnail_text || story?.suggested_title || story?.title || "",
  ).trim();
  if (!t) return warnings;
  if (t.length > 72) warnings.push("thumbnail_text_too_long");
  if (t.split(/\s+/).some((w) => w.length > 18)) {
    warnings.push("thumbnail_text_long_word_risk");
  }
  return warnings;
}

async function imageLooksBlack(absPath) {
  if (!absPath) return false;
  try {
    const sharp = require("sharp");
    const stats = await sharp(absPath).stats();
    const means = (stats.channels || []).slice(0, 3).map((c) => c.mean || 0);
    if (means.length < 3) return false;
    const luma = means.reduce((sum, v) => sum + v, 0) / means.length;
    return luma < 8;
  } catch {
    return false;
  }
}

async function runThumbnailPreUploadQa(story, opts = {}) {
  const failures = [];
  const warnings = [];
  const candidates = Array.isArray(opts.images)
    ? opts.images
    : Array.isArray(story?.downloaded_images)
      ? story.downloaded_images
      : [];

  const evaluated = rankThumbnailCandidates(story, candidates, {
    includeRejected: true,
  });
  const rejected = evaluated.filter((r) => !r.safeForThumbnail);
  if (rejected.length > 0) {
    warnings.push(
      ...rejected.flatMap((r) => r.reasons.map((reason) => `${reason}:${r.image?.path || "unknown"}`)),
    );
  }

  const safeRanked = evaluated.filter((r) => r.safeForThumbnail);
  if (!hasReadableTitleText(story)) failures.push("thumbnail_title_text_missing");
  warnings.push(...thumbnailTextWarnings(story));

  if (safeRanked.length === 0 && candidates.length > 0) {
    failures.push("no_thumbnail_safe_subject_image");
  }

  if (opts.selectedImage) {
    const selected = classifyThumbnailImage(story, opts.selectedImage);
    if (!selected.safeForThumbnail) {
      failures.push(`selected_thumbnail_unsafe:${selected.reasons.join("+")}`);
    }
  }

  if (opts.selectedPath && (await imageLooksBlack(opts.selectedPath))) {
    failures.push("thumbnail_black_frame");
  }

  return {
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures,
    warnings: Array.from(new Set(warnings)),
    selected: safeRanked[0] || null,
    rejected,
  };
}

module.exports = {
  classifyThumbnailImage,
  rankThumbnailCandidates,
  selectThumbnailSubjectImage,
  filterUnsafeImagesForRender,
  runThumbnailPreUploadQa,
  imageLooksBlack,
};
