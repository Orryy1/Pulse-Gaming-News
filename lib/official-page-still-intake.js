"use strict";

const axios = require("axios");
const { classifyOutboundUrl, safeRedirectConfig } = require("./safe-url");

const DEFAULT_MAX_ASSETS = 6;

const XBOX_OFFICIAL_IMAGE_HOSTS = new Set([
  "assets.xboxservices.com",
  "cms-assets.xboxservices.com",
  "compass-ssl.xbox.com",
  "store-images.microsoft.com",
  "store-images.s-microsoft.com",
]);

const LOW_VALUE_IMAGE_RE =
  /(?:share[-_ ]?image|cross[-_ ]?sell|accessories[-_ ]?panes|triptic|xgp[-_ ]?cross[-_ ]?sell|favicon|logo)/i;
const HIGH_VALUE_IMAGE_RE =
  /\b(?:hero|gallery|content[-_ ]?placement|character[-_ ]?rotator|still|screenshot|feature)\b/i;
const XBOX_PRELOADED_STATE_MARKER = "window.__PRELOADED_STATE__";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeStem(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "asset";
}

function storyId(story = {}) {
  return cleanText(story.story_id || story.id || story.storyId);
}

function storyEntity(story = {}) {
  return cleanText(story.canonical_subject || story.canonical_game || story.selected_title || story.title);
}

function pageHost(value) {
  try {
    return new URL(cleanText(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function htmlForUrlExtraction(html = "") {
  return String(html || "")
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&quot;/g, '"');
}

function normaliseExtractedUrl(value, baseUrl = "") {
  let text = cleanText(value)
    .replace(/[\\'"),.;\]}]+$/g, "")
    .replace(/^["'(]+/g, "");
  try {
    const parsed = baseUrl ? new URL(text, baseUrl) : new URL(text);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function parseJsonObjectAfterMarker(html = "", marker = "") {
  const source = String(html || "");
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const objectStart = source.indexOf("{", markerIndex + marker.length);
  if (objectStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(objectStart, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function xboxStoreProductId(pageUrl = "") {
  try {
    const parsed = new URL(cleanText(pageUrl));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.endsWith("xbox.com") || !/\/games\/store\//i.test(parsed.pathname)) return "";
    const segments = parsed.pathname.split("/").filter(Boolean);
    const productId = cleanText(segments[segments.length - 1]).toUpperCase();
    return /^[A-Z0-9]{8,}$/.test(productId) ? productId : "";
  } catch {
    return "";
  }
}

function canonicalReferencePageUrl(value = "") {
  try {
    const parsed = new URL(cleanText(value));
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return parsed.toString();
  } catch {
    return "";
  }
}

function heldRightsTemplateBlockers(template = {}) {
  const blockers = [];
  if (!cleanText(template.licence_basis || template.license_basis)) blockers.push("licence_basis_missing");
  if (!cleanText(template.allowed_use)) blockers.push("allowed_use_missing");
  if (!Array.isArray(template.allowed_platforms) || !template.allowed_platforms.length) {
    blockers.push("allowed_platforms_missing");
  }
  if (template.local_materialization_allowed !== true) blockers.push("local_materialization_not_allowed");
  if (template.live_publish_allowed !== false) blockers.push("held_live_publish_decision_required");
  if (template.requires_human_legal_review_before_publish !== true) {
    blockers.push("human_legal_review_hold_required");
  }
  if (!cleanText(template.approval_status)) blockers.push("approval_status_missing");
  if (!cleanText(template.rights_status)) blockers.push("rights_status_missing");
  if (!cleanText(template.required_rules_link)) blockers.push("required_rules_link_missing");
  for (const prefix of ["product_page_evidence", "policy_evidence"]) {
    if (!cleanText(template[`${prefix}_path`])) blockers.push(`${prefix}_path_missing`);
    if (!/^[a-f0-9]{64}$/i.test(cleanText(template[`${prefix}_sha256`]))) {
      blockers.push(`${prefix}_sha256_missing`);
    }
    if (!(Number(template[`${prefix}_size_bytes`]) > 0)) blockers.push(`${prefix}_size_bytes_missing`);
  }
  return blockers;
}

function bindOfficialPageStillRightsDecisions({
  entries = [],
  rightsTemplates = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const templates = Array.isArray(rightsTemplates) ? rightsTemplates : [];
  const boundEntries = [];
  const rejectedEntries = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const storyId = storyIdFromEntry(entry);
    const referencePageUrl = canonicalReferencePageUrl(entry.reference_page_url);
    const candidates = templates.filter((template) => (
      storyIdFromEntry(template) === storyId &&
      canonicalReferencePageUrl(template.reference_page_url) === referencePageUrl
    ));
    const template = candidates.find((row) => heldRightsTemplateBlockers(row).length === 0);
    const blockers = [];
    if (entry.scoped_product_payload !== true) blockers.push("scoped_product_payload_required");
    if (entry.downloads_allowed !== false) blockers.push("reference_only_discovery_required");
    if (!storyId) blockers.push("story_id_missing");
    if (!referencePageUrl) blockers.push("reference_page_url_missing");
    if (!template) {
      blockers.push(
        candidates.length ? "safe_held_rights_template_missing" : "matching_rights_template_missing",
      );
    }
    if (blockers.length) {
      rejectedEntries.push({
        story_id: storyId || null,
        official_source_url: cleanText(entry.official_source_url) || null,
        reference_page_url: cleanText(entry.reference_page_url) || null,
        blockers,
      });
      continue;
    }

    boundEntries.push({
      ...entry,
      source_owner: cleanText(template.source_owner) || entry.source_owner,
      licence_basis: cleanText(template.licence_basis || template.license_basis),
      allowed_use: cleanText(template.allowed_use),
      allowed_platforms: [...template.allowed_platforms],
      restricted_platforms: Array.isArray(template.restricted_platforms)
        ? [...template.restricted_platforms]
        : [],
      commercial_use_allowed: template.commercial_use_allowed === true,
      local_materialization_allowed: true,
      live_publish_allowed: false,
      requires_human_legal_review_before_publish: true,
      approval_status: cleanText(template.approval_status),
      rights_status: cleanText(template.rights_status),
      risk_score: Number.isFinite(Number(template.risk_score)) ? Number(template.risk_score) : 0.45,
      required_rules_link: cleanText(template.required_rules_link),
      required_public_notice: cleanText(template.required_public_notice) || undefined,
      product_page_evidence_path: cleanText(template.product_page_evidence_path),
      product_page_evidence_sha256: cleanText(template.product_page_evidence_sha256).toLowerCase(),
      product_page_evidence_size_bytes: Number(template.product_page_evidence_size_bytes),
      policy_evidence_path: cleanText(template.policy_evidence_path),
      policy_evidence_sha256: cleanText(template.policy_evidence_sha256).toLowerCase(),
      policy_evidence_size_bytes: Number(template.policy_evidence_size_bytes),
      rights_binding_status: "held_decision_hash_bound",
      rights_binding_generated_at: generatedAt,
      rights_binding_template_source_url: cleanText(
        template.source_url || template.official_source_url,
      ) || null,
    });
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "OFFICIAL_PAGE_STILL_HELD_RIGHTS_BINDING",
    summary: {
      entries: Array.isArray(entries) ? entries.length : 0,
      bound: boundEntries.length,
      rejected: rejectedEntries.length,
    },
    bound_entries: boundEntries,
    rejected_entries: rejectedEntries,
    safety: {
      live_publish_allowed: false,
      human_legal_review_required: true,
      stale_asset_paths_or_hashes_inherited: false,
      no_download_triggered: true,
      no_db_mutation: true,
      no_publish_triggered: true,
    },
  };
}

function storyIdFromEntry(entry = {}) {
  return cleanText(entry.story_id || entry.id || entry.storyId);
}

function xboxStoreProductStillCandidates({ html = "", pageUrl = "" } = {}) {
  const productId = xboxStoreProductId(pageUrl);
  if (!productId) return [];
  const state = parseJsonObjectAfterMarker(html, XBOX_PRELOADED_STATE_MARKER);
  const summaries = state?.core2?.products?.productSummaries;
  if (!summaries || typeof summaries !== "object") return [];
  const summaryKey = Object.keys(summaries).find((key) => key.toUpperCase() === productId);
  const product = summaryKey ? summaries[summaryKey] : null;
  if (!product?.images || typeof product.images !== "object") return [];

  const rows = [];
  const addImage = (kind, image, index = 0) => {
    const url = normaliseExtractedUrl(image?.url, pageUrl);
    if (!url || !classifyOutboundUrl(url).ok || !isAllowedOfficialImageHost(url, pageUrl)) return;
    const width = Math.max(0, Number(image?.width || 0));
    const height = Math.max(0, Number(image?.height || 0));
    const ordinal = String(index + 1).padStart(2, "0");
    rows.push({
      url,
      descriptor: `${productId}_${kind}_${ordinal}_${width}x${height}.jpg`,
      product_id: productId,
      product_title: cleanText(product.title),
      product_image_kind: kind,
      scoped_product_payload: true,
    });
  };

  (Array.isArray(product.images.screenshots) ? product.images.screenshots : [])
    .forEach((image, index) => addImage("screenshot", image, index));
  addImage("super_hero", product.images.superHeroArt);
  addImage("poster", product.images.poster);
  addImage("box_art", product.images.boxArt);

  const unique = new Map();
  for (const row of rows) {
    if (!unique.has(row.url)) unique.set(row.url, row);
  }
  return [...unique.values()];
}

function descriptorForImageUrl(value) {
  try {
    const parsed = new URL(value);
    const nParam = parsed.searchParams.get("n");
    if (nParam) return cleanText(nParam);
    return decodeURIComponent(parsed.pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function imageVariantKey(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`.toLowerCase();
  } catch {
    return cleanText(value).toLowerCase();
  }
}

function responsiveImageWidth(value) {
  try {
    const parsed = new URL(value);
    return Number(
      parsed.searchParams.get("imwidth") ||
        parsed.searchParams.get("width") ||
        parsed.searchParams.get("w") ||
        0,
    ) || 0;
  } catch {
    return 0;
  }
}

function betterImageVariant(candidate, existing) {
  if (!existing) return candidate;
  const candidateWidth = responsiveImageWidth(candidate.url);
  const existingWidth = responsiveImageWidth(existing.url);
  if (candidateWidth !== existingWidth) return candidateWidth > existingWidth ? candidate : existing;
  return candidate.url.length > existing.url.length ? candidate : existing;
}

function dimensionsFromDescriptor(descriptor = "") {
  const matches = [...cleanText(descriptor).matchAll(/(\d{3,4})x(\d{3,4})/g)];
  if (!matches.length) return { width: 0, height: 0, area: 0 };
  const [width, height] = matches
    .map((match) => [Number(match[1]), Number(match[2])])
    .sort((a, b) => b[0] * b[1] - a[0] * a[1])[0];
  return { width, height, area: width * height };
}

function assetPrefix(descriptor = "") {
  const match = cleanText(descriptor).match(/^([a-z0-9]{5,})_/i);
  return match ? match[1].toLowerCase() : "";
}

function officialImageHostsForPage(url) {
  const host = pageHost(url);
  if (host.endsWith("xbox.com") || host.endsWith("microsoft.com")) return XBOX_OFFICIAL_IMAGE_HOSTS;
  return new Set([host]);
}

function isAllowedOfficialImageHost(imageUrl, pageUrl) {
  const host = pageHost(imageUrl);
  if (!host) return false;
  const allowed = officialImageHostsForPage(pageUrl);
  if (allowed.has(host)) return true;
  return host === pageHost(pageUrl) || host.endsWith(`.${pageHost(pageUrl)}`);
}

function imageUrlsFromOfficialPageHtml({ html = "", pageUrl = "" } = {}) {
  const normalisedHtml = htmlForUrlExtraction(html);
  const absoluteMatches = [...normalisedHtml.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)].map((match) => match[0]);
  const relativeMatches = [...normalisedHtml.matchAll(/(?:["'=(:\[,]\s*)(\/[^"'<>\\\])\s]+\.(?:jpe?g|png|webp)(?:\?[^"'<>\\\])\s]*)?)/gi)]
    .map((match) => match[1]);
  const matches = [...absoluteMatches, ...relativeMatches]
    .map((match) => normaliseExtractedUrl(match, pageUrl))
    .filter(Boolean);
  const byUrl = new Map();
  for (const url of matches) {
    if (!/\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url)) continue;
    if (!classifyOutboundUrl(url).ok) continue;
    if (!isAllowedOfficialImageHost(url, pageUrl)) continue;
    const variantKey = imageVariantKey(url);
    byUrl.set(variantKey, betterImageVariant({
      url,
      descriptor: descriptorForImageUrl(url),
    }, byUrl.get(variantKey)));
  }
  return [...byUrl.values()];
}

function dominantAssetPrefix(candidates = []) {
  const counts = new Map();
  for (const candidate of candidates) {
    if (LOW_VALUE_IMAGE_RE.test(candidate.descriptor)) continue;
    const prefix = assetPrefix(candidate.descriptor);
    if (prefix) counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function scoreCandidate(candidate = {}, dominantPrefix = "") {
  const descriptor = cleanText(candidate.descriptor);
  const dimensions = dimensionsFromDescriptor(descriptor);
  let score = Math.min(35, dimensions.area / 50000);
  if (HIGH_VALUE_IMAGE_RE.test(descriptor)) score += 35;
  if (dominantPrefix && assetPrefix(descriptor) === dominantPrefix) score += 30;
  if (LOW_VALUE_IMAGE_RE.test(descriptor)) score -= 100;
  if (!dimensions.area) score -= 10;
  return score;
}

function rankedOfficialPageStillCandidates({ html = "", pageUrl = "", maxAssets = DEFAULT_MAX_ASSETS } = {}) {
  const scopedXboxProductCandidates = xboxStoreProductStillCandidates({ html, pageUrl });
  const candidates = scopedXboxProductCandidates.length
    ? scopedXboxProductCandidates
    : imageUrlsFromOfficialPageHtml({ html, pageUrl });
  const dominantPrefix = dominantAssetPrefix(candidates);
  return candidates
    .map((candidate) => ({
      ...candidate,
      dimensions: dimensionsFromDescriptor(candidate.descriptor),
      score: scoreCandidate(candidate, dominantPrefix),
      dominant_asset_prefix: dominantPrefix || null,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.dimensions.area - a.dimensions.area;
    })
    .slice(0, Math.max(0, Number(maxAssets || DEFAULT_MAX_ASSETS)));
}

function sourceTitleForCandidate(candidate = {}, entity = "") {
  const descriptor = cleanText(candidate.descriptor)
    .replace(/\.(?:jpe?g|png|webp)$/i, "")
    .replace(/^[a-z0-9]{5,}_/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return cleanText(`${candidate.product_title || entity} official product image${descriptor ? `: ${descriptor}` : ""}`);
}

function buildOfficialPageStillIntakeEntries({
  story = {},
  pageUrl = "",
  html = "",
  maxAssets = DEFAULT_MAX_ASSETS,
  generatedAt = new Date().toISOString(),
} = {}) {
  const id = storyId(story);
  const entity = storyEntity(story);
  const sourceOwner = /xbox\.com|microsoft\.com/i.test(cleanText(pageUrl))
    ? "Xbox official product page"
    : `${entity || "Official"} product page`;
  return rankedOfficialPageStillCandidates({ html, pageUrl, maxAssets }).map((candidate, index) => {
    const title = sourceTitleForCandidate(candidate, entity);
    return {
      story_id: id,
      entity,
      source_type: "official_press_kit_stills",
      source_owner: sourceOwner,
      source_family: safeStem(`${id}_${candidate.descriptor || `official_product_image_${index + 1}`}`).toLowerCase(),
      official_source_url: candidate.url,
      source_title: title,
      evidence_of_officialness:
        candidate.scoped_product_payload === true
          ? `Image is declared in the hash-bound product payload for ${candidate.product_title}: ${cleanText(pageUrl)}.`
          : `Image is linked from the official product page: ${cleanText(pageUrl)}.`,
      entity_match_notes:
        candidate.scoped_product_payload === true
          ? `Official Xbox Store product payload is for ${candidate.product_title}; selected story is ${cleanText(story.selected_title || story.title)}.`
          : `Official page image set is for ${entity}; selected title is ${cleanText(story.selected_title || story.title)}.`,
      reference_page_url: cleanText(pageUrl),
      downloads_allowed: false,
      generated_at: generatedAt,
      discovery_source: "official_product_page_html_scan",
      image_descriptor: candidate.descriptor,
      image_dimensions: candidate.dimensions,
      image_score: Number(candidate.score.toFixed(2)),
      ...(candidate.scoped_product_payload === true
        ? {
            product_id: candidate.product_id,
            product_title: candidate.product_title,
            product_image_kind: candidate.product_image_kind,
            scoped_product_payload: true,
          }
        : {}),
    };
  });
}

async function fetchOfficialPageHtml(pageUrl) {
  const url = cleanText(pageUrl);
  if (!classifyOutboundUrl(url).ok) throw new Error("unsafe_official_page_url");
  const response = await axios.get(url, {
    timeout: 30000,
    responseType: "text",
    ...safeRedirectConfig(4),
    headers: {
      "User-Agent": "PulseGamingLocalProof/1.0 (+source-intake; no posting)",
    },
    validateStatus: (status) => status >= 200 && status < 300,
  });
  return String(response.data || "");
}

module.exports = {
  bindOfficialPageStillRightsDecisions,
  buildOfficialPageStillIntakeEntries,
  fetchOfficialPageHtml,
  imageUrlsFromOfficialPageHtml,
  rankedOfficialPageStillCandidates,
};
