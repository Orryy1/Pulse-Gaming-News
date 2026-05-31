"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildStoryManifest,
  runPublicOutputCoherenceGate,
} = require("./public-output-manifest");

const GOVERNANCE_VERSION = "studio_governance_v1";
const DEFAULT_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook"];

const INTERNAL_QA_CODE_RE = /^public_output:internal_qa_phrase:/;

const FINANCE_CRYPTO_PROMO_RE =
  /\b(?:buy now|sell now|hold now|pump|moon|guaranteed|guarantee|leverage|price prediction|trading signal|exchange referral|referral bonus|100x|risk[-\s]?free|sure thing|will explode|huge upside)\b/i;

const FINANCE_CRYPTO_RE =
  /\b(?:crypto|bitcoin|ethereum|blockchain|token|wallet|exchange|leverage|web3|stock|stocks|shares|market|invest|investment|trading|pension|isa|mortgage|saver|budgeting|finance)\b/i;

const BAD_SOURCE_RE =
  /\b(?:fan[_\s-]?reupload|random[_\s-]?youtube|youtube[_\s-]?compilation|reaction[_\s-]?video|social[_\s-]?media[_\s-]?repost|browser[_\s-]?scrape|unofficial[_\s-]?mirror)\b/i;

const DISCLOSURE_RE = /\b(?:affiliate|commission|#ad|advert|advertising|paid promotion|sponsored)\b/i;

function cleanText(value) {
  return String(value || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseText(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return asArray(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return [trimmed];
  }
  if (typeof value === "object") return [value];
  return [];
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function stableId(value, fallback = "asset") {
  const text = cleanText(value)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function lowerPlatformList(value) {
  return asArray(value).map((item) => normalisePlatformKey(item)).filter(Boolean);
}

function normalisePlatformKey(value) {
  const key = String(value || "").toLowerCase().trim();
  if (key === "youtube_shorts" || key === "youtube_short" || key === "yt_shorts") return "youtube";
  if (key === "instagram_reels" || key === "instagram_reel" || key === "ig_reels" || key === "ig_reel") {
    return "instagram";
  }
  if (key === "facebook_reels" || key === "facebook_reel" || key === "fb_reels" || key === "fb_reel") {
    return "facebook";
  }
  if (key === "twitter") return "x";
  return key;
}

function assetPath(asset = {}) {
  return cleanText(
    asset.path ||
      asset.local_path ||
      asset.file ||
      asset.audio_path ||
      asset.image_path ||
      asset.exported_path ||
      "",
  );
}

function assetUrl(asset = {}) {
  return cleanText(
    asset.source_url ||
      asset.url ||
      asset.reference_url ||
      asset.official_source_url ||
      asset.direct_media_url_if_available ||
      "",
  );
}

function normaliseAsset(raw, index, kind) {
  if (typeof raw === "string") {
    return {
      asset_id: stableId(raw, `${kind}_${index + 1}`),
      kind,
      path: raw,
      source_url: "",
      source_type: kind,
      rights_risk_class: null,
      source_family: null,
    };
  }
  const asset = raw && typeof raw === "object" ? raw : {};
  const p = assetPath(asset);
  const url = assetUrl(asset);
  return {
    ...asset,
    asset_id: cleanText(asset.asset_id || asset.id || asset.clip_id || asset.image_id) ||
      stableId(p || url || `${kind}_${index + 1}`, `${kind}_${index + 1}`),
    kind,
    path: p,
    source_url: url,
    source_type: cleanText(asset.source_type || asset.type || asset.source || kind),
    rights_risk_class: cleanText(asset.rights_risk_class || asset.rights_status || ""),
    source_family: cleanText(asset.source_family || asset.trusted_footage_source_id || asset.source_id || ""),
  };
}

function planArrays(plan = {}) {
  return [
    ...asArray(plan.shot_plan),
    ...asArray(plan.timeline),
    ...asArray(plan.beats),
    ...asArray(plan.director_timeline),
    ...asArray(plan.beat_map),
    ...asArray(plan.render_assets),
    ...asArray(plan.selected_assets),
  ];
}

function collectFinalRenderVideoSelectors(story = {}) {
  const selectors = {
    ids: new Set(),
    paths: new Set(),
    source_urls: new Set(),
  };
  const plans = [
    asObject(story.visual_v4_director_plan),
    asObject(story.director_plan),
    asObject(story.director_beat_map),
    asObject(story.timeline_plan),
  ].filter((plan) => Object.keys(plan).length > 0);

  for (const plan of plans) {
    for (const item of planArrays(plan)) {
      if (!item || typeof item !== "object") continue;
      for (const id of [
        item.motion_pack_clip_id,
        item.asset_id,
        item.clip_id,
        item.media_id,
      ]) {
        const key = normaliseText(id);
        if (key) selectors.ids.add(key);
      }
      for (const itemPath of [
        item.media_path,
        item.asset_path,
        item.clip_path,
        item.video_path,
        item.local_materialized_path,
        item.local_materialised_path,
        item.path,
        item.local_path,
        item.file,
      ]) {
        const key = normaliseText(itemPath);
        if (key) selectors.paths.add(key);
      }
      const urlKey = normaliseText(assetUrl(item));
      if (urlKey) selectors.source_urls.add(urlKey);
    }
  }

  return selectors;
}

function hasFinalRenderVideoSelectors(selectors = {}) {
  return (
    selectors.ids?.size > 0 ||
    selectors.paths?.size > 0 ||
    selectors.source_urls?.size > 0
  );
}

function selectedFinalVideoAsset(asset = {}, selectors = {}) {
  if (!hasFinalRenderVideoSelectors(selectors)) return true;
  const idKey = normaliseText(asset.asset_id);
  const pathKey = normaliseText(asset.path);
  if (selectors.paths.size > 0) return Boolean(pathKey && selectors.paths.has(pathKey));
  if (idKey && selectors.ids.has(idKey)) return true;

  const hasPreciseSelector = selectors.ids.size > 0;
  if (hasPreciseSelector) return false;

  const sourceUrlKey = normaliseText(asset.source_url);
  return Boolean(sourceUrlKey && selectors.source_urls.has(sourceUrlKey));
}

function collectPublishAssets(story = {}) {
  const assets = [];
  const finalRenderVideoSelectors = collectFinalRenderVideoSelectors(story);
  const finalRenderScopedAssets = hasFinalRenderVideoSelectors(finalRenderVideoSelectors);
  const visualV4Bridge = asObject(story.visual_v4_render_bridge);
  for (const item of [
    ...asArray(story.visual_v4_bridge_video_clips),
    ...asArray(visualV4Bridge.video_clips),
  ]) {
    assets.push(normaliseAsset(item, assets.length, "video"));
  }

  for (const [field, kind] of [
    ["downloaded_images", "visual"],
    ["game_images", "visual"],
    ["video_clips", "video"],
    ["local_motion_clips", "video"],
    ["motion_clips", "video"],
    ["downloaded_videos", "video"],
    ["sfx_assets", "audio"],
    ["sound_effects", "audio"],
    ["music_assets", "audio"],
  ]) {
    for (const item of asArray(story[field])) {
      if (
        finalRenderScopedAssets &&
        (field === "downloaded_images" || field === "game_images") &&
        item?.used_in_final_render !== true &&
        item?.selected_for_render !== true &&
        item?.final_render_asset !== true
      ) {
        continue;
      }
      assets.push(normaliseAsset(item, assets.length, kind));
    }
  }

  for (const [field, kind, type] of [
    ["audio_path", "audio", "narration_audio"],
    ["music_path", "audio", "music"],
    ["sfx_path", "audio", "sound_effect"],
    ["image_path", "visual", "rendered_story_card"],
    ["thumbnail_candidate_path", "visual", "thumbnail"],
    ["hf_thumbnail_path", "visual", "thumbnail"],
  ]) {
    if (story[field]) {
      assets.push(
        normaliseAsset(
          {
            id: `${story.id || "story"}_${field}`,
            path: story[field],
            source_type: type,
            rights_risk_class: story[`${field}_rights_risk_class`] || null,
          },
          assets.length,
          kind,
        ),
      );
    }
  }

  const enrichedVideoPaths = new Set(
    assets
      .filter(
        (asset) =>
          asset.kind === "video" &&
          asset.path &&
          (asset.source_url || asset.source_family || asset.rights_risk_class),
      )
      .map((asset) => normaliseText(asset.path)),
  );

  const seen = new Set();
  return assets.filter((asset) => {
    if (asset.kind === "video" && !selectedFinalVideoAsset(asset, finalRenderVideoSelectors)) {
      return false;
    }
    if (
      asset.kind === "video" &&
      asset.path &&
      !asset.source_url &&
      !asset.source_family &&
      !asset.rights_risk_class &&
      enrichedVideoPaths.has(normaliseText(asset.path))
    ) {
      return false;
    }
    const key = `${asset.asset_id}|${asset.path}|${asset.source_url}|${asset.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return asset.path || asset.source_url || asset.asset_id;
  });
}

function ledgerEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return ledgerEntries(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return [];
  }
  if (typeof value !== "object") return [];
  const nested = [
    ...asArray(value.assets),
    ...asArray(value.records),
    ...asArray(value.rights_ledger),
  ];
  return nested.length ? nested : [value];
}

function collectRightsLedger(story = {}, options = {}) {
  return [
    ...ledgerEntries(options.rightsLedger),
    ...ledgerEntries(story.rights_ledger),
    ...ledgerEntries(story.rights_records),
    ...ledgerEntries(story.provenance_ledger),
    ...ledgerEntries(story.media_provenance),
  ].map((entry, index) => {
    const record = entry && typeof entry === "object" ? entry : {};
    return {
      ...record,
      asset_id: cleanText(record.asset_id || record.id || record.source_id || record.path) ||
        `rights_record_${index + 1}`,
      path: cleanText(record.path || record.local_path || record.file || ""),
      source_url: assetUrl(record),
      source_type: cleanText(record.source_type || record.type || record.source || ""),
      licence_basis: cleanText(record.licence_basis || record.license_basis || record.licence_scope || ""),
      allowed_platforms: lowerPlatformList(record.allowed_platforms || record.platforms),
      expiry: record.expiry || record.expires_at || record.licence_expires_at || null,
      credit_required: record.credit_required === true,
      commercial_use_allowed: record.commercial_use_allowed !== false,
      risk_score: Number.isFinite(Number(record.risk_score)) ? Number(record.risk_score) : null,
      evidence_file: cleanText(record.evidence_file || record.licence_evidence || record.permission_evidence || ""),
    };
  });
}

function rightsRecordMatchesAsset(record = {}, asset = {}) {
  if (record.asset_id && asset.asset_id && normaliseText(record.asset_id) === normaliseText(asset.asset_id)) {
    return true;
  }
  if (record.path && asset.path && normaliseText(record.path) === normaliseText(asset.path)) return true;
  if (record.source_url && asset.source_url && normaliseText(record.source_url) === normaliseText(asset.source_url)) return true;
  return false;
}

function isExpired(expiry, generatedAt) {
  if (!expiry) return false;
  const expiryMs = Date.parse(expiry);
  const nowMs = Date.parse(generatedAt);
  return Number.isFinite(expiryMs) && Number.isFinite(nowMs) && expiryMs < nowMs;
}

function runRightsLedgerGate(story = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const platforms = lowerPlatformList(options.platforms || DEFAULT_PLATFORMS);
  const assets = collectPublishAssets(story);
  const records = collectRightsLedger(story, options);
  const failures = [];
  const warnings = [];
  const matched = [];
  const missing = [];

  for (const asset of assets) {
    const record = records.find((candidate) => rightsRecordMatchesAsset(candidate, asset));
    if (!record) {
      missing.push(asset);
      continue;
    }
    matched.push({ asset, record });
    if (!record.licence_basis) failures.push("rights:licence_basis_missing");
    if (record.commercial_use_allowed === false) failures.push("rights:commercial_use_not_allowed");
    if (isExpired(record.expiry, generatedAt)) failures.push("rights:licence_expired");
    if (record.allowed_platforms.length > 0) {
      const missingPlatform = platforms.find((platform) => !record.allowed_platforms.includes(platform));
      if (missingPlatform) failures.push("rights:platform_not_allowed");
    }
    if (Number(record.risk_score) >= 0.65) warnings.push("rights:risk_score_high");
  }

  if (missing.length > 0) failures.push("rights:no_rights_record");

  return {
    verdict: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures: unique(failures),
    warnings: unique(warnings),
    assets,
    records,
    matched_assets: matched.map(({ asset, record }) => ({
      asset_id: asset.asset_id,
      kind: asset.kind,
      path: asset.path || null,
      source_url: asset.source_url || null,
      rights_record_id: record.asset_id,
      licence_basis: record.licence_basis || null,
      risk_score: record.risk_score,
    })),
    missing_assets: missing.map((asset) => ({
      asset_id: asset.asset_id,
      kind: asset.kind,
      path: asset.path || null,
      source_url: asset.source_url || null,
      source_type: asset.source_type || null,
    })),
    metrics: {
      asset_count: assets.length,
      rights_record_count: records.length,
      missing_asset_count: missing.length,
    },
  };
}

function manifestDescriptionText(story = {}, manifest = {}) {
  return cleanText(story.description || story.youtube_description || manifest.description || "");
}

function sourceLabelMatchesDescription(story = {}, manifest = {}) {
  const source = normaliseText(manifest.primary_source);
  const description = normaliseText(manifestDescriptionText(story, manifest));
  if (!source || source === "unknown source" || !description) return true;
  return description.includes(source) || description.includes("source");
}

function textContainsSubject(value, subject) {
  const haystack = normaliseText(value);
  const needle = normaliseText(subject);
  if (!needle || needle === "this story") return true;
  if (haystack.includes(needle)) return true;
  const token = needle.split(/\s+/).find((part) => part.length >= 5);
  return Boolean(token && haystack.includes(token));
}

function mapPublicOutputReason(code) {
  if (code === "public_output:placeholder_title") return "public_output:generic_title";
  if (code === "public_output:title_missing_canonical_subject") {
    return "public_output:canonical_subject_missing_from_title";
  }
  if (code === "public_output:first_five_seconds_missing_subject") {
    return "public_output:canonical_subject_missing_from_first_3_seconds";
  }
  if (code === "public_output:manual_captions_missing") return "captions:missing_or_messy";
  if (code === "public_output:thumbnail_source_mismatch") return "public_output:thumbnail_source_mismatch";
  if (code === "public_output:reddit_primary_source_conflict") return "public_output:thumbnail_source_mismatch";
  if (INTERNAL_QA_CODE_RE.test(code)) return "public_output:internal_qa_language";
  return code;
}

function runGovernancePublicOutputGate(story = {}, manifest = {}, options = {}) {
  const gate = runPublicOutputCoherenceGate({
    story,
    manifest,
    publicTitle: story.public_title || story.upload_title || story.suggested_title || story.title,
    script: story.full_script || story.tts_script || "",
    thumbnailText: story.suggested_thumbnail_text || story.thumbnail_text || "",
    thumbnailSourceLabel: story.thumbnail_source_label,
    sourceCardLabel: story.source_card_label,
    requireCaptionEvidence: true,
    captionFileExists: options.captionFileExists,
    captionPath: options.captionPath,
  });
  const failures = gate.failures.map(mapPublicOutputReason);
  const warnings = [...gate.warnings];

  const description = manifestDescriptionText(story, manifest);
  if (description && manifest.canonical_subject && !textContainsSubject(description, manifest.canonical_subject)) {
    failures.push("public_output:description_missing_canonical_subject");
  }
  if (!sourceLabelMatchesDescription(story, manifest)) {
    warnings.push("public_output:description_source_not_explicit");
  }

  return {
    ...gate,
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures: unique(failures),
    raw_failures: gate.failures,
    warnings: unique(warnings),
  };
}

function disclosureObject(story = {}, platform) {
  const platformDisclosures = story.platform_disclosures || {};
  return platformDisclosures[platform] || {};
}

function commercialManifestFor(story = {}, options = {}) {
  return (
    options.commercialManifest ||
    story.affiliate_link_manifest ||
    story.commercial_intelligence ||
    null
  );
}

function hasAffiliateLinks(manifest = null) {
  if (!manifest || typeof manifest !== "object") return false;
  if (manifest.primary_link) return true;
  if (asArray(manifest.fallback_links).length > 0) return true;
  if (asArray(manifest.candidate_links).some((link) => link && link.url && !asArray(link.rejection_reasons).length)) {
    return true;
  }
  return false;
}

function runAffiliateDisclosureGate(story = {}, options = {}) {
  const manifest = commercialManifestFor(story, options);
  const needsDisclosure = Boolean(
    manifest?.disclosure_required ||
      hasAffiliateLinks(manifest) ||
      story.affiliate_url ||
      asArray(story.affiliate_links).length,
  );
  const failures = [];
  const warnings = [];
  const disclosureText = [
    manifest?.disclosure_copy?.short,
    manifest?.disclosure_copy?.landing,
    manifest?.disclosure_copy?.video,
    story.affiliate_disclosure,
    story.description,
    story.pinned_comment,
  ]
    .filter(Boolean)
    .join(" ");

  if (needsDisclosure && !DISCLOSURE_RE.test(disclosureText)) {
    failures.push("commercial:affiliate_disclosure_required_missing");
  }

  if (needsDisclosure) {
    const platformDisclosure = manifest?.platform_disclosure || {};
    const hasPlatformCaption = Object.values(platformDisclosure).some((item) =>
      DISCLOSURE_RE.test([item?.caption_copy, item?.disclosure_copy, item?.label].filter(Boolean).join(" ")),
    );
    if (!hasPlatformCaption && !DISCLOSURE_RE.test(disclosureText)) {
      failures.push("commercial:affiliate_disclosure_required_missing");
    }
  }

  if (manifest?.compliance?.finance_or_crypto && manifest.compliance.review_required) {
    warnings.push("commercial:finance_or_crypto_review_required");
  }

  return {
    verdict: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures: unique(failures),
    warnings: unique(warnings),
    disclosure_required: needsDisclosure,
    manifest: manifest || null,
  };
}

function runAiDisclosureGate(story = {}) {
  const aiUsage = story.ai_usage || {};
  const required = Boolean(
    aiUsage.label_required ||
      aiUsage.realistic_altered_or_synthetic ||
      story.ai_disclosure_required === true ||
      story.realistic_synthetic_media === true ||
      story.synthetic_media_realistic === true,
  );
  const youtube = disclosureObject(story, "youtube");
  const tiktok = disclosureObject(story, "tiktok");
  const disclosed = Boolean(
    youtube.altered_or_synthetic ||
      youtube.ai_disclosure ||
      youtube.synthetic_media_disclosure ||
      tiktok.ai_generated_content_label ||
      story.ai_disclosure_applied === true,
  );
  const failures = required && !disclosed ? ["policy:ai_disclosure_required_missing"] : [];
  return {
    verdict: failures.length ? "fail" : "pass",
    failures,
    warnings: [],
    disclosure_required: required,
    disclosure_present: disclosed,
  };
}

function runPlatformPolicyGate(story = {}) {
  const failures = [];
  const warnings = [];
  const youtube = disclosureObject(story, "youtube");
  const needsPaidPromotionToggle = Boolean(
    youtube.paid_promotion === true ||
      story.paid_promotion_required === true ||
      story.sponsorship_required === true ||
      story.commercial_relationship_required === true,
  );
  const paidPromotionDisclosed = Boolean(
    youtube.paid_promotion_toggle ||
      youtube.paid_promotion_disclosed ||
      story.youtube_paid_promotion_disclosed === true,
  );
  if (needsPaidPromotionToggle && !paidPromotionDisclosed) {
    failures.push("policy:youtube_paid_promotion_disclosure_missing");
  }

  const publicText = [
    story.public_title,
    story.suggested_title,
    story.suggested_thumbnail_text,
    story.description,
    story.full_script,
  ]
    .filter(Boolean)
    .join(" ");
  if (/\b(?:get rich quick|guaranteed return|free money|miracle cure|sub4sub)\b/i.test(publicText)) {
    failures.push("policy:spam_or_deceptive_claim_risk");
  }
  if (/\b(?:click my bio|leave youtube now|only link that matters)\b/i.test(publicText)) {
    warnings.push("policy:off_platform_link_pressure_review");
  }

  return {
    verdict: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures: unique(failures),
    warnings: unique(warnings),
  };
}

function runReusedContentRiskGate(story = {}, rightsGate = {}) {
  const failures = [];
  const warnings = [];
  const assets = asArray(rightsGate.assets);
  const riskyAssets = assets.filter((asset) =>
    BAD_SOURCE_RE.test(
      [
        asset.source_type,
        asset.rights_risk_class,
        asset.source_url,
        asset.source_family,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (riskyAssets.length > 0) failures.push("policy:reused_content_risk_high");

  const clipCount = assets.filter((asset) => asset.kind === "video").length;
  const scriptWords = cleanText(story.full_script || story.tts_script || "").split(/\s+/).filter(Boolean).length;
  if (clipCount >= 2 && scriptWords < 60 && story.transformative_edit_evidence !== true) {
    failures.push("policy:reused_content_risk_high");
  }
  if (clipCount >= 3 && scriptWords < 80 && !story.transformative_edit_evidence) {
    warnings.push("policy:transformative_edit_evidence_not_explicit");
  }

  return {
    verdict: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures: unique(failures),
    warnings: unique(warnings),
    risky_assets: riskyAssets.map((asset) => asset.asset_id),
  };
}

function textTokens(value) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "just",
    "new",
    "game",
    "gaming",
    "story",
    "news",
  ]);
  return normaliseText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function similarity(a, b) {
  const left = textTokens(a);
  const right = textTokens(b);
  if (!left.length || !right.length) return 0;
  const bSet = new Set(right);
  const intersection = left.filter((token) => bSet.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function footageFamiliesForStory(story = {}) {
  return unique(
    collectPublishAssets(story)
      .filter((asset) => asset.kind === "video")
      .map((asset) => asset.source_family || asset.asset_id || asset.source_url),
  );
}

function runAntiSpamUniquenessGate(story = {}, options = {}) {
  const recent = asArray(options.recentVideos || options.recentStories);
  const title = story.public_title || story.upload_title || story.suggested_title || story.title;
  const cta = cleanText(story.cta || story.pinned_comment || "");
  const families = new Set(footageFamiliesForStory(story).map(normaliseText));
  const failures = [];
  const warnings = [];
  const matches = [];

  for (const item of recent) {
    const titleScore = similarity(title, item.title || item.public_title || item.suggested_title || "");
    const ctaScore = cta ? similarity(cta, item.cta || item.pinned_comment || "") : 0;
    const itemFamilies = new Set(asArray(item.footage_families || item.source_families).map(normaliseText));
    const sharedFamilies = [...families].filter((family) => itemFamilies.has(family));
    const familyScore =
      families.size && itemFamilies.size ? sharedFamilies.length / Math.max(families.size, itemFamilies.size) : 0;

    if (titleScore >= 0.72 || familyScore >= 0.8 || (titleScore >= 0.55 && ctaScore >= 0.7)) {
      failures.push("uniqueness:too_similar_recent_output");
      matches.push({
        story_id: item.id || null,
        title: item.title || item.public_title || null,
        title_similarity: Number(titleScore.toFixed(3)),
        cta_similarity: Number(ctaScore.toFixed(3)),
        footage_family_similarity: Number(familyScore.toFixed(3)),
      });
    } else if (ctaScore >= 0.85) {
      warnings.push("uniqueness:cta_reused_recently");
    }
  }

  return {
    verdict: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures: unique(failures),
    warnings: unique(warnings),
    matches,
  };
}

function classifyFinanceOrCrypto(story = {}, commercial = null) {
  const explicit = normaliseText(
    commercial?.vertical ||
      story.vertical ||
      story.channel_id ||
      story.channel ||
      "",
  );
  const text = [
    story.title,
    story.public_title,
    story.suggested_title,
    story.full_script,
    story.description,
  ]
    .filter(Boolean)
    .join(" ");
  if (explicit.includes("crypto") || /\b(?:crypto|bitcoin|ethereum|token|exchange|wallet|leverage)\b/i.test(text)) return "crypto";
  if (explicit.includes("finance") || explicit.includes("stacked") || FINANCE_CRYPTO_RE.test(text)) return "finance";
  return "non_financial";
}

function runFinanceCryptoFirewall(story = {}, options = {}) {
  const commercial = commercialManifestFor(story, options);
  const vertical = classifyFinanceOrCrypto(story, commercial);
  const text = [
    story.title,
    story.public_title,
    story.suggested_title,
    story.full_script,
    story.description,
    commercial?.platform_specific_ctas?.youtube,
  ]
    .filter(Boolean)
    .join(" ");
  const approved = Boolean(
    story.compliance_approved ||
      story.financial_promotion_approved ||
      story.crypto_promotion_approved ||
      commercial?.compliance?.approval_reference,
  );
  const promotional = vertical !== "non_financial" && FINANCE_CRYPTO_PROMO_RE.test(text);
  const failures = promotional && !approved ? ["finance_crypto:promotion_without_approval"] : [];
  return {
    verdict: failures.length ? "fail" : "pass",
    failures,
    warnings: [],
    vertical,
    promotional_language_detected: promotional,
    approval_present: approved,
  };
}

function severityForGate(gate = {}) {
  if (gate.failures?.length) return "RED";
  if (gate.warnings?.length) return "AMBER";
  return "GREEN";
}

function buildRiskReport(gates = {}) {
  const gateReports = Object.entries(gates).map(([name, gate]) => ({
    gate: name,
    verdict: gate.result || gate.verdict || "unknown",
    severity: severityForGate(gate),
    failures: gate.failures || [],
    warnings: gate.warnings || [],
    metrics: gate.metrics || null,
  }));
  return {
    schema_version: 1,
    overall_risk: gateReports.some((gate) => gate.severity === "RED")
      ? "high"
      : gateReports.some((gate) => gate.severity === "AMBER")
        ? "medium"
        : "low",
    gates: gateReports,
  };
}

function correctionActionFor(reason) {
  if (reason.includes("generic_title")) return "Regenerate a named-entity title with consequence and tension.";
  if (reason.includes("canonical_subject_missing")) return "Rewrite title, hook and captions from the locked canonical subject.";
  if (reason.includes("thumbnail_source_mismatch")) return "Align thumbnail/source card labels to the primary source, not the discovery source.";
  if (reason.includes("internal_qa_language")) return "Replace internal verification language with viewer-facing editorial copy.";
  if (reason.startsWith("rights:")) return "Add a rights-ledger record with source URL, licence basis, platform scope and evidence.";
  if (reason.includes("ai_disclosure")) return "Apply the required AI/synthetic media disclosure before platform upload.";
  if (reason.includes("paid_promotion")) return "Set the paid-promotion disclosure field and include the required public label.";
  if (reason.includes("affiliate_disclosure")) return "Add upfront affiliate disclosure to the landing page, caption and link pack.";
  if (reason.includes("finance_crypto")) return "Remove promotional finance/crypto language or obtain documented compliance approval.";
  if (reason.includes("uniqueness")) return "Rebuild the title, CTA, layout and footage choices to avoid recent-output duplication.";
  if (reason.includes("captions")) return "Generate clean manual captions from trusted word or phrase timestamps.";
  return "Review and repair this governance failure before queueing or publishing.";
}

function buildCorrectionPlan(reasonCodes = [], story = {}) {
  const actions = unique(reasonCodes.map(correctionActionFor));
  return {
    schema_version: 1,
    story_id: story.id || null,
    status: actions.length ? "correction_required" : "no_correction_required",
    actions,
    rollback: {
      unlist_recommendation: reasonCodes.length > 0 && story.youtube_post_id ? "review_unlist_if_live" : "not_applicable",
      description_update_pack_required: reasonCodes.some((reason) => /source|disclosure|finance|crypto/.test(reason)),
      pinned_comment_correction_required: reasonCodes.some((reason) => /source|disclosure|finance|crypto/.test(reason)),
      rights_takedown_response_log_required: reasonCodes.some((reason) => reason.startsWith("rights:")),
    },
  };
}

function buildAuditLog({ story, generatedAt, gates, publishStatus, reasonCodes }) {
  const events = [
    {
      at: generatedAt,
      event: "studio_governance_started",
      story_id: story.id || null,
      engine_version: GOVERNANCE_VERSION,
    },
  ];
  for (const [name, gate] of Object.entries(gates)) {
    events.push({
      at: generatedAt,
      event: `${name}:${gate.result || gate.verdict || "unknown"}`,
      failures: gate.failures || [],
      warnings: gate.warnings || [],
    });
  }
  events.push({
    at: generatedAt,
    event: `publish_control_tower:${publishStatus}`,
    reason_codes: reasonCodes,
  });
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: story.id || null,
    immutable_inputs: {
      title: story.public_title || story.upload_title || story.suggested_title || story.title || null,
      exported_path: story.exported_path || null,
      audio_path: story.audio_path || null,
      caption_path: story.caption_path || story.manual_caption_path || null,
    },
    events,
  };
}

function buildPublishManifest({ story, manifest, publishStatus, reasonCodes, warnings, generatedAt, gates }) {
  return {
    schema_version: 1,
    engine_version: GOVERNANCE_VERSION,
    generated_at: generatedAt,
    story_id: story.id || null,
    canonical_subject: manifest.canonical_subject,
    title: manifest.short_title,
    publish_status: publishStatus,
    can_render: publishStatus !== "RED",
    can_queue: publishStatus !== "RED",
    can_auto_publish: publishStatus === "GREEN",
    reason_codes: reasonCodes,
    warnings,
    required_outputs: {
      publish_manifest: "publish_manifest.json",
      risk_report: "risk_report.json",
      rejection_reasons: "rejection_reasons.json",
      correction_plan: "correction_plan.json",
      audit_log: "audit_log.json",
    },
    gates: Object.fromEntries(
      Object.entries(gates).map(([name, gate]) => [
        name,
        {
          verdict: gate.result || gate.verdict || "unknown",
          failures: gate.failures || [],
          warnings: gate.warnings || [],
        },
      ]),
    ),
  };
}

function buildStudioGovernanceReport({
  story = {},
  rightsLedger,
  commercialManifest,
  recentVideos = [],
  recentStories = [],
  platforms = DEFAULT_PLATFORMS,
  generatedAt = new Date().toISOString(),
  captionFileExists,
  captionPath,
} = {}) {
  const canonicalStoryManifest = buildStoryManifest(story, {
    commercialIntelligence: commercialManifest || story.affiliate_link_manifest || story.commercial_intelligence || null,
  });
  const publicOutputGate = runGovernancePublicOutputGate(story, canonicalStoryManifest, {
    captionFileExists,
    captionPath,
  });
  const rightsGate = runRightsLedgerGate(story, {
    rightsLedger,
    platforms,
    generatedAt,
  });
  const platformPolicyGate = runPlatformPolicyGate(story);
  const affiliateDisclosureGate = runAffiliateDisclosureGate(story, { commercialManifest });
  const aiDisclosureGate = runAiDisclosureGate(story);
  const reusedContentRiskGate = runReusedContentRiskGate(story, rightsGate);
  const antiSpamUniquenessGate = runAntiSpamUniquenessGate(story, {
    recentVideos,
    recentStories,
  });
  const financeCryptoFirewall = runFinanceCryptoFirewall(story, { commercialManifest });

  const gates = {
    public_output_coherence_gate: publicOutputGate,
    rights_ledger: rightsGate,
    platform_policy_gate: platformPolicyGate,
    affiliate_disclosure_gate: affiliateDisclosureGate,
    ai_disclosure_gate: aiDisclosureGate,
    reused_content_risk_gate: reusedContentRiskGate,
    anti_spam_uniqueness_gate: antiSpamUniquenessGate,
    finance_crypto_firewall: financeCryptoFirewall,
  };
  const reasonCodes = unique(
    Object.values(gates).flatMap((gate) => asArray(gate.failures)),
  );
  const warnings = unique(
    Object.values(gates).flatMap((gate) => asArray(gate.warnings)),
  );
  const publishStatus = reasonCodes.length > 0 ? "RED" : warnings.length > 0 ? "AMBER" : "GREEN";
  const publishControlTower = {
    verdict: publishStatus,
    can_auto_publish: publishStatus === "GREEN",
    reason_codes: reasonCodes,
    warnings,
  };
  const riskReport = buildRiskReport(gates);
  const rejectionReasons = {
    schema_version: 1,
    story_id: story.id || null,
    reason_codes: reasonCodes,
    warnings,
    hard_fail: publishStatus === "RED",
  };
  const correctionPlan = buildCorrectionPlan(reasonCodes, story);
  const auditLog = buildAuditLog({
    story,
    generatedAt,
    gates,
    publishStatus,
    reasonCodes,
  });
  const publishManifest = buildPublishManifest({
    story,
    manifest: canonicalStoryManifest,
    publishStatus,
    reasonCodes,
    warnings,
    generatedAt,
    gates,
  });

  return {
    schema_version: 1,
    engine_version: GOVERNANCE_VERSION,
    generated_at: generatedAt,
    story_id: story.id || null,
    canonical_story_manifest: canonicalStoryManifest,
    public_output_coherence_gate: publicOutputGate,
    rights_ledger: rightsGate,
    platform_policy_gate: platformPolicyGate,
    affiliate_disclosure_gate: affiliateDisclosureGate,
    ai_disclosure_gate: aiDisclosureGate,
    reused_content_risk_gate: reusedContentRiskGate,
    anti_spam_uniqueness_gate: antiSpamUniquenessGate,
    finance_crypto_firewall: financeCryptoFirewall,
    publish_control_tower: publishControlTower,
    publish_manifest: publishManifest,
    risk_report: riskReport,
    rejection_reasons: rejectionReasons,
    correction_plan: correctionPlan,
    audit_log: auditLog,
    safety: {
      local_only: true,
      db_mutation: false,
      oauth: false,
      posting: false,
      token_access: false,
    },
  };
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildSourceManifest(report = {}) {
  const manifest = report.canonical_story_manifest || {};
  return {
    schema_version: 1,
    story_id: report.story_id || manifest.story_id || null,
    primary_source: manifest.primary_source || null,
    primary_source_url: manifest.primary_source_url || null,
    discovery_source: manifest.discovery_source || null,
    official_confirmation_source: manifest.official_confirmation_source || null,
    source_card_label: manifest.source_card_label || null,
    source_confidence_score: manifest.primary_source && manifest.primary_source !== "Unknown source" ? 0.86 : 0,
    source_lock_quality_score:
      report.public_output_coherence_gate?.failures?.some((reason) => /source/i.test(reason))
        ? 0
        : 0.9,
  };
}

function buildClaimInventory(report = {}) {
  const manifest = report.canonical_story_manifest || {};
  const reasonCodes = asArray(report.rejection_reasons?.reason_codes);
  return {
    schema_version: 1,
    story_id: report.story_id || manifest.story_id || null,
    claim_inventory: [
      manifest.canonical_angle
        ? {
            claim: manifest.canonical_angle,
            status: "confirmed_from_manifest",
            source: manifest.primary_source || null,
          }
        : null,
    ].filter(Boolean),
    confirmed_claims: manifest.canonical_angle ? [manifest.canonical_angle] : [],
    unconfirmed_claims: [],
    prohibited_claims: reasonCodes.filter((reason) =>
      /internal_qa|finance_crypto|policy|source_mismatch|overclaim/i.test(reason),
    ),
    allowed_public_wording: {
      title: manifest.short_title || null,
      thumbnail: manifest.thumbnail_text || null,
      opening_line: manifest.narration_hook || null,
    },
  };
}

function buildPlatformPolicyReport(report = {}) {
  return {
    schema_version: 1,
    story_id: report.story_id || null,
    platform_policy_gate: report.platform_policy_gate || {},
    affiliate_disclosure_gate: report.affiliate_disclosure_gate || {},
    ai_disclosure_gate: report.ai_disclosure_gate || {},
    reused_content_risk_gate: report.reused_content_risk_gate || {},
    finance_crypto_firewall: report.finance_crypto_firewall || {},
    publish_blockers: asArray(report.rejection_reasons?.reason_codes).filter((reason) =>
      /policy|commercial|finance_crypto|reused_content|rights/i.test(reason),
    ),
  };
}

function buildCorrectionQueue(report = {}) {
  const actions = asArray(report.correction_plan?.actions);
  return {
    schema_version: 1,
    story_id: report.story_id || null,
    status: actions.length ? "needs_review" : "clear",
    items: actions.map((action, index) => ({
      id: `${report.story_id || "story"}_correction_${index + 1}`,
      action,
      priority: index === 0 ? "P0" : "P1",
      source: "studio_governance_engine",
    })),
  };
}

async function writeStudioGovernanceArtifacts(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeStudioGovernanceArtifacts requires outputDir");
  const outDir = path.resolve(outputDir);
  const files = {
    canonical_story_manifest: path.join(outDir, "canonical_story_manifest.json"),
    source_manifest: path.join(outDir, "source_manifest.json"),
    claim_inventory: path.join(outDir, "claim_inventory.json"),
    coherence_report: path.join(outDir, "coherence_report.json"),
    rights_ledger: path.join(outDir, "rights_ledger.json"),
    platform_policy_report: path.join(outDir, "platform_policy_report.json"),
    publish_manifest: path.join(outDir, "publish_manifest.json"),
    publish_verdict: path.join(outDir, "publish_verdict.json"),
    risk_report: path.join(outDir, "risk_report.json"),
    rejection_reasons: path.join(outDir, "rejection_reasons.json"),
    correction_plan: path.join(outDir, "correction_plan.json"),
    correction_queue: path.join(outDir, "correction_queue.json"),
    audit_log: path.join(outDir, "audit_log.json"),
  };
  await writeJson(files.canonical_story_manifest, report.canonical_story_manifest || {});
  await writeJson(files.source_manifest, buildSourceManifest(report));
  await writeJson(files.claim_inventory, buildClaimInventory(report));
  await writeJson(files.coherence_report, report.public_output_coherence_gate || {});
  await writeJson(files.rights_ledger, report.rights_ledger || {});
  await writeJson(files.platform_policy_report, buildPlatformPolicyReport(report));
  await writeJson(files.publish_manifest, report.publish_manifest || {});
  await writeJson(files.publish_verdict, report.publish_control_tower || {});
  await writeJson(files.risk_report, report.risk_report || {});
  await writeJson(files.rejection_reasons, report.rejection_reasons || {});
  await writeJson(files.correction_plan, report.correction_plan || {});
  await writeJson(files.correction_queue, buildCorrectionQueue(report));
  await writeJson(files.audit_log, report.audit_log || {});
  return files;
}

module.exports = {
  GOVERNANCE_VERSION,
  buildStudioGovernanceReport,
  writeStudioGovernanceArtifacts,
  runRightsLedgerGate,
  collectPublishAssets,
  collectRightsLedger,
  runAffiliateDisclosureGate,
  runAiDisclosureGate,
  runPlatformPolicyGate,
  runReusedContentRiskGate,
  runAntiSpamUniquenessGate,
  runFinanceCryptoFirewall,
};
