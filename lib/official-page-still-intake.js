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

function normaliseExtractedUrl(value) {
  let text = cleanText(value)
    .replace(/[\\'"),.;\]}]+$/g, "")
    .replace(/^["'(]+/g, "");
  try {
    const parsed = new URL(text);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
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
  const matches = [...normalisedHtml.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)]
    .map((match) => normaliseExtractedUrl(match[0]))
    .filter(Boolean);
  const byUrl = new Map();
  for (const url of matches) {
    if (!/\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url)) continue;
    if (!classifyOutboundUrl(url).ok) continue;
    if (!isAllowedOfficialImageHost(url, pageUrl)) continue;
    if (!byUrl.has(url)) byUrl.set(url, {
      url,
      descriptor: descriptorForImageUrl(url),
    });
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
  const candidates = imageUrlsFromOfficialPageHtml({ html, pageUrl });
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
  return cleanText(`${entity} official product image${descriptor ? `: ${descriptor}` : ""}`);
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
        `Image is linked from the official product page: ${cleanText(pageUrl)}.`,
      entity_match_notes:
        `Official page image set is for ${entity}; selected title is ${cleanText(story.selected_title || story.title)}.`,
      reference_page_url: cleanText(pageUrl),
      downloads_allowed: false,
      generated_at: generatedAt,
      discovery_source: "official_product_page_html_scan",
      image_descriptor: candidate.descriptor,
      image_dimensions: candidate.dimensions,
      image_score: Number(candidate.score.toFixed(2)),
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
  buildOfficialPageStillIntakeEntries,
  fetchOfficialPageHtml,
  imageUrlsFromOfficialPageHtml,
  rankedOfficialPageStillCandidates,
};
