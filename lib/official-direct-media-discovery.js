"use strict";

const { execFile } = require("node:child_process");
const { mediaSourceUrlKindFields } = require("./media-source-url-kind");

const ABSOLUTE_MEDIA_RE =
  /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:mp4|webm|mov|m3u8|mpd)(?:[^\s"'<>\\]*)?/gi;
const ATTR_MEDIA_RE =
  /\b(?:src|href|content|url)\s*=\s*["']([^"']+\.(?:mp4|webm|mov|m3u8|mpd)(?:[^"']*)?)["']/gi;
const LINK_ATTR_RE = /\b(?:href|src|data-href|data-url)\s*=\s*["']([^"']+)["']/gi;
const ABSOLUTE_URL_RE = /https?:\/\/[^\s"'<>\\]+/gi;
const OFFICIAL_MEDIA_PAGE_RE =
  /\b(?:media|press[-_\s]?kit|trailer|trailers|video|videos|assets?|downloads?|gameplay|footage)\b/i;
const STATIC_ASSET_RE = /\.(?:jpe?g|png|webp|gif|avif|svg|css|js|ico|pdf|zip)(?:$|[?#])/i;
const MIN_USABLE_DIRECT_MEDIA_DURATION_SECONDS = 5;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return typeof value === "object" ? [value] : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeEscapedText(value) {
  return String(value || "")
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&amp;/g, "&");
}

function resolveUrl(candidate, baseUrl) {
  const cleaned = cleanText(decodeEscapedText(candidate));
  if (!cleaned) return null;
  try {
    const withProtocol = cleaned.startsWith("//") ? `https:${cleaned}` : cleaned;
    return new URL(withProtocol, baseUrl).href;
  } catch {
    return null;
  }
}

function canonicalUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return cleanText(value);
  }
}

function directMediaCandidate(url, source = "html_scan") {
  const resolved = cleanText(url);
  if (!resolved) return null;
  const kind = mediaSourceUrlKindFields(resolved);
  if (!kind.segment_validation_eligible) return null;
  return {
    url: resolved,
    source_url_kind: kind.source_url_kind,
    segment_validation_eligible: true,
    source,
  };
}

function cloudinaryVideoDerivativeUrl(value = "") {
  const raw = cleanText(value);
  if (!raw || /\.(?:mp4|webm|mov|m3u8|mpd)(?:$|[?#])/i.test(raw)) return "";
  try {
    const parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    const host = parsed.hostname.toLowerCase();
    if (host !== "assets.nintendo.com") return "";
    const decodedPathOriginal = decodeURIComponent(parsed.pathname);
    const decodedPath = decodedPathOriginal.toLowerCase();
    if (!decodedPath.includes("/image/upload/")) return "";

    const storefrontVideoIndex = decodedPath.indexOf("/store/software/");
    if (storefrontVideoIndex >= 0 && decodedPath.includes("/video/")) {
      const storefrontPath = decodedPathOriginal
        .slice(storefrontVideoIndex + 1)
        .replace(/\/+/g, "/")
        .replace(/\.(?:jpe?g|png|webp|gif|avif)$/i, "");
      if (!/\/video\/[a-z0-9_-]+$/i.test(storefrontPath)) return "";
      parsed.pathname = `/video/upload/${storefrontPath}.mp4`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    }

    if (!decodedPath.includes("/posters/")) return "";
    if (!/\b(?:h264|trl|trailer|gameplay|movie|video)\b/i.test(decodedPath.replace(/[^a-z0-9]+/g, " "))) {
      return "";
    }
    parsed.pathname = `${parsed.pathname}.mp4`;
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

function discoverDirectMediaUrlsFromText({ text = "", baseUrl = "" } = {}) {
  const decoded = cleanText(decodeEscapedText(text));
  const found = [];
  const seen = new Set();

  function add(raw, source) {
    const resolved = resolveUrl(raw, baseUrl);
    const candidate = directMediaCandidate(resolved, source);
    if (!candidate) return;
    const key = canonicalUrl(candidate.url);
    if (seen.has(key)) return;
    seen.add(key);
    found.push(candidate);
  }

  for (const match of decoded.matchAll(ABSOLUTE_MEDIA_RE)) add(match[0], "absolute_url");
  for (const match of decoded.matchAll(ATTR_MEDIA_RE)) add(match[1], "html_attribute");
  for (const match of decoded.matchAll(ABSOLUTE_URL_RE)) {
    const derivative = cloudinaryVideoDerivativeUrl(resolveUrl(match[0], baseUrl));
    if (derivative) add(derivative, "cloudinary_video_derivative");
  }

  return found.sort((a, b) => {
    const priority = { direct_video: 0, hls_manifest: 1, dash_manifest: 2 };
    return (priority[a.source_url_kind] ?? 10) - (priority[b.source_url_kind] ?? 10);
  });
}

function sameOriginUrl(url, baseUrl) {
  try {
    const parsed = new URL(url);
    const base = new URL(baseUrl);
    return parsed.origin.toLowerCase() === base.origin.toLowerCase();
  } catch {
    return false;
  }
}

function mediaPageCandidate(url, context) {
  if (!url || STATIC_ASSET_RE.test(url)) return false;
  if (directMediaCandidate(url)) return false;
  const searchable = `${url} ${cleanText(context)}`;
  return OFFICIAL_MEDIA_PAGE_RE.test(searchable);
}

function discoverOfficialMediaPageLinksFromText({ text = "", baseUrl = "", limit = 2 } = {}) {
  const decoded = decodeEscapedText(text);
  const found = [];
  const seen = new Set();

  function add(raw, index = 0) {
    const resolved = resolveUrl(raw, baseUrl);
    if (!resolved || !sameOriginUrl(resolved, baseUrl)) return;
    const key = canonicalUrl(resolved);
    if (!key || seen.has(key) || key === canonicalUrl(baseUrl)) return;
    const context = decoded.slice(Math.max(0, index - 120), index + String(raw || "").length + 180);
    if (!mediaPageCandidate(resolved, context)) return;
    seen.add(key);
    found.push(resolved);
  }

  for (const match of decoded.matchAll(LINK_ATTR_RE)) {
    add(match[1], match.index || 0);
    if (found.length >= limit) return found;
  }
  for (const match of decoded.matchAll(ABSOLUTE_URL_RE)) {
    add(match[0], match.index || 0);
    if (found.length >= limit) return found;
  }
  return found;
}

function directUrlFromEntry(entry = {}) {
  const direct = cleanText(entry.direct_media_url_if_available);
  if (directMediaCandidate(direct)) return direct;
  const source = cleanText(entry.official_source_url);
  if (directMediaCandidate(source)) return source;
  return "";
}

function cleanPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Number(number.toFixed(2)) : null;
}

function normaliseMediaMetadata(metadata = {}) {
  const duration = cleanPositiveNumber(
    metadata.source_duration_s || metadata.duration_seconds || metadata.durationSeconds,
  );
  const width = Number(metadata.width || metadata.media_width);
  const height = Number(metadata.height || metadata.media_height);
  return {
    source_duration_s: duration,
    media_width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
    media_height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
  };
}

function maxCandidatesPerEntry(options = {}) {
  return Math.max(1, Number(options.maxCandidatesPerEntry || 1));
}

function candidateProbeLimit(options = {}) {
  const requested = maxCandidatesPerEntry(options);
  const configured = Number(options.candidateProbeLimit || 0);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(requested, Math.round(configured));
  }
  return Math.max(requested, Math.min(24, requested * 4));
}

function mediaIdentityFromUrl(url, index = 0) {
  const text = cleanText(url);
  const uuids = [...text.matchAll(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)]
    .map((match) => match[0].toLowerCase())
    .filter((uuid) => uuid !== "00000000-0000-0000-0000-000000000000");
  if (uuids.length) return uuids[uuids.length - 1].slice(0, 8);
  try {
    const parsed = new URL(text);
    const basename = parsed.pathname.split("/").filter(Boolean).pop() || "";
    const stem = basename.replace(/\.(?:mp4|webm|mov|m3u8|mpd)$/i, "");
    const cleaned = stem
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24)
      .toLowerCase();
    if (cleaned) return cleaned;
  } catch {}
  return `candidate_${String(index + 1).padStart(2, "0")}`;
}

const GENERIC_MEDIA_TOKENS = new Set([
  "1080",
  "1080p",
  "1280",
  "1920",
  "2160",
  "264",
  "4000",
  "720",
  "720p",
  "aac",
  "announce",
  "avs",
  "avc1",
  "file",
  "filename",
  "gameplay",
  "h264",
  "hd",
  "large",
  "launch",
  "m3u8",
  "media",
  "mov",
  "mp4",
  "mpd",
  "official",
  "sd",
  "source",
  "teaser",
  "trailer",
  "video",
  "web",
  "webm",
]);

function textTokens(value = "") {
  let decoded = cleanText(value).toLowerCase();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {}
  return decoded
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !GENERIC_MEDIA_TOKENS.has(token))
    .filter((token) => !/^[a-f0-9]{4,}$/i.test(token));
}

function mediaTitleTokensFromUrl(value = "") {
  const text = cleanText(value);
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {}
  const pathTitleMatch = decoded.match(/(?:fileName|filename)\/([^/?#]+)/i);
  if (pathTitleMatch) return textTokens(pathTitleMatch[1]);
  try {
    const parsed = new URL(text);
    const paramTitle =
      parsed.searchParams.get("fileName") ||
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("title");
    if (paramTitle) return textTokens(paramTitle);
    if (
      parsed.hostname.toLowerCase() === "assets.nintendo.com" &&
      parsed.pathname.toLowerCase().includes("/image/upload/")
    ) {
      return textTokens(parsed.pathname);
    }
    const basename = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return textTokens(basename);
  } catch {}
  return textTokens(decoded.split(/[/?#]/).filter(Boolean).pop() || decoded);
}

function candidateMatchesEntity(candidate = {}, entity = "") {
  const entityTokens = [...new Set(textTokens(entity))];
  if (!entityTokens.length) return true;
  const mediaTokens = [...new Set(mediaTitleTokensFromUrl(candidate.direct_media_url || candidate.url))];
  if (mediaTokens.length < 4) return true;
  const overlap = entityTokens.filter((token) => mediaTokens.includes(token)).length;
  return overlap / entityTokens.length >= 0.6;
}

function candidateHasUsableMotionDuration(candidate = {}) {
  const duration = Number(candidate.source_duration_s || candidate.duration_seconds || candidate.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return true;
  return duration >= MIN_USABLE_DIRECT_MEDIA_DURATION_SECONDS;
}

function directMediaRankScore(candidate = {}) {
  const width = Number(candidate.media_width || 0);
  const height = Number(candidate.media_height || 0);
  const duration = Number(candidate.source_duration_s || 0);
  const url = cleanText(candidate.direct_media_url || candidate.url).toLowerCase();
  let score = 0;

  if (candidate.source_url_kind === "direct_video") score += 34;
  else if (candidate.source_url_kind === "hls_manifest") score += 30;
  else if (candidate.source_url_kind === "dash_manifest") score += 20;

  if (width >= 1920 && height >= 1080) score += 70;
  else if (width >= 1280 && height >= 720) score += 48;
  else if (width >= 640 && height >= 360) score += 22;
  else if (width > 0 && height > 0) score += 4;

  if (duration >= 20 && duration <= 240) score += 60;
  else if (duration >= 8) score += 30;
  else if (duration > 0 && duration < 5) score -= 55;
  else if (!duration) score -= 8;

  if (/\b(?:gameplay|trailer|launch|announce|reveal|hero)\b/.test(url)) score += 12;
  if (/\b(?:logo|rating|packshot|keyart|thumb|thumbnail|poster|teaser-loop)\b/.test(url)) {
    score -= 25;
  }
  if (/(?:320x180|426x240|480p|small|low)/.test(url)) score -= 18;
  if (/(?:1920x1080|1080p|2560x1440|3840x2160|4k)/.test(url)) score += 10;

  return score;
}

function probeDirectMediaMetadata(url, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!directMediaCandidate(url)) {
      resolve({ source_duration_s: null, media_width: null, media_height: null });
      return;
    }
    execFile(
      "ffprobe",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "format=duration:stream=width,height",
        "-of",
        "json",
        url,
      ],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({ source_duration_s: null, media_width: null, media_height: null });
          return;
        }
        try {
          const parsed = JSON.parse(stdout || "{}");
          const stream = Array.isArray(parsed.streams) ? parsed.streams[0] || {} : {};
          resolve(
            normaliseMediaMetadata({
              duration_seconds: parsed.format?.duration,
              width: stream.width,
              height: stream.height,
            }),
          );
        } catch {
          resolve({ source_duration_s: null, media_width: null, media_height: null });
        }
      },
    );
  });
}

function isVideoPlatformReference(entry = {}) {
  const url = cleanText(entry.official_source_url);
  const kind = mediaSourceUrlKindFields(url);
  return String(kind.source_url_kind || "").startsWith("youtube");
}

async function defaultFetchText(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const commonHeaders = {
      accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
    };
    async function fetchOnce(userAgent, fetchSource) {
      const headers = userAgent
        ? {
            ...commonHeaders,
            "user-agent": userAgent,
          }
        : undefined;
      const response = await fetch(url, { signal: controller.signal, headers });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text, fetch_source: fetchSource };
    }

    const first = await fetchOnce("PulseGamingDirectMediaDiscovery/1.0 report-only", "html_scan");
    if (first.ok || ![403, 406].includes(Number(first.status))) return first;
    return fetchOnce("", "html_scan_neutral_retry");
  } finally {
    clearTimeout(timeout);
  }
}

function templateEntryForCandidate(entry = {}, row = {}, candidate = null, index = 0) {
  const metadata = normaliseMediaMetadata(candidate || row);
  const family = cleanText(entry.source_family);
  const candidateIdentity = cleanText(candidate?.media_identity) || mediaIdentityFromUrl(candidate?.direct_media_url, index);
  const sourceFamily =
    candidate && index > 0
      ? `${family}__media_${String(index + 1).padStart(2, "0")}_${candidateIdentity}`
      : family;
  const out = {
    ...entry,
    source_family: sourceFamily,
    direct_media_url_if_available:
      candidate?.direct_media_url ||
      row.direct_media_url ||
      cleanText(entry.direct_media_url_if_available),
    source_url_kind: candidate?.source_url_kind || row.source_url_kind || entry.source_url_kind,
    discovery_source: candidate?.discovery_source || row.discovery_source || entry.discovery_source,
    media_identity: candidate?.media_identity || row.media_identity || entry.media_identity,
    downloads_allowed: false,
  };
  if (metadata.source_duration_s) out.source_duration_s = metadata.source_duration_s;
  if (metadata.media_width) out.media_width = metadata.media_width;
  if (metadata.media_height) out.media_height = metadata.media_height;
  return out;
}

function templateEntry(entry = {}, row = {}) {
  return templateEntryForCandidate(entry, row, null, 0);
}

function templateEntriesForRow(entry = {}, row = {}, options = {}) {
  const limit = maxCandidatesPerEntry(options);
  const candidates = asArray(row.direct_media_candidates);
  if (limit <= 1 || candidates.length <= 1) return [templateEntry(entry, row)];
  return candidates.slice(0, limit).map((candidate, index) =>
    templateEntryForCandidate(entry, row, candidate, index),
  );
}

async function metadataForDirectUrl(url, options = {}) {
  if (typeof options.probeMedia !== "function" || !url) {
    return { source_duration_s: null, media_width: null, media_height: null };
  }
  try {
    return normaliseMediaMetadata(await options.probeMedia(url, options));
  } catch {
    return { source_duration_s: null, media_width: null, media_height: null };
  }
}

async function enrichDirectMediaCandidates(candidates = [], options = {}) {
  const limit = maxCandidatesPerEntry(options);
  const probeLimit = candidateProbeLimit(options);
  const out = [];
  for (const [index, candidate] of asArray(candidates).slice(0, probeLimit).entries()) {
    const metadata = await metadataForDirectUrl(candidate.url, options);
    out.push({
      source_index: index,
      direct_media_url: cleanText(candidate.url),
      source_url_kind: candidate.source_url_kind || mediaSourceUrlKindFields(candidate.url).source_url_kind,
      discovery_source: candidate.source || "html_scan",
      media_identity: mediaIdentityFromUrl(candidate.url, index),
      ...metadata,
    });
  }
  return out
    .map((candidate) => ({
      ...candidate,
      ranking_score: Number(directMediaRankScore(candidate).toFixed(2)),
    }))
    .sort(
      (a, b) =>
        b.ranking_score - a.ranking_score ||
        Number(a.source_index || 0) - Number(b.source_index || 0),
    )
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, index }));
}

async function rowForEntry(entry = {}, index, options = {}) {
  const officialUrl = cleanText(entry.official_source_url);
  const existingDirect = directUrlFromEntry(entry);
  if (existingDirect) {
    const kind = mediaSourceUrlKindFields(existingDirect);
    const metadata = await metadataForDirectUrl(existingDirect, options);
    const directMediaCandidates = [
      {
        index: 0,
        direct_media_url: existingDirect,
        source_url_kind: kind.source_url_kind,
        discovery_source: "existing_entry",
        media_identity: mediaIdentityFromUrl(existingDirect, 0),
        ...metadata,
      },
    ];
    return {
      index,
      story_id: cleanText(entry.story_id),
      entity: cleanText(entry.entity),
      source_family: cleanText(entry.source_family),
      official_source_url: officialUrl,
      status: "direct_media_found",
      direct_media_url: existingDirect,
      source_url_kind: kind.source_url_kind,
      discovery_source: "existing_entry",
      rejection_reason: null,
      direct_media_candidates: directMediaCandidates,
      ...metadata,
    };
  }
  if (!officialUrl) {
    return {
      index,
      story_id: cleanText(entry.story_id),
      entity: cleanText(entry.entity),
      source_family: cleanText(entry.source_family),
      official_source_url: officialUrl,
      status: "skipped",
      direct_media_url: "",
      source_url_kind: "",
      discovery_source: "none",
      rejection_reason: "missing_official_source_url",
    };
  }
  if (isVideoPlatformReference(entry)) {
    return {
      index,
      story_id: cleanText(entry.story_id),
      entity: cleanText(entry.entity),
      source_family: cleanText(entry.source_family),
      official_source_url: officialUrl,
      status: "no_direct_media_found",
      direct_media_url: "",
      source_url_kind: "",
      discovery_source: "video_platform_reference_skipped",
      rejection_reason: "youtube_reference_requires_separate_licensed_or_direct_media_route",
    };
  }

  try {
    const fetched = await (options.fetchText || defaultFetchText)(officialUrl, options);
    if (!fetched?.ok) {
      return {
        index,
        story_id: cleanText(entry.story_id),
        entity: cleanText(entry.entity),
        source_family: cleanText(entry.source_family),
        official_source_url: officialUrl,
        status: "fetch_failed",
        direct_media_url: "",
        source_url_kind: "",
        discovery_source: "html_scan",
        rejection_reason: `http_${fetched?.status || "unknown"}`,
      };
    }
    const candidates = discoverDirectMediaUrlsFromText({
      baseUrl: officialUrl,
      text: fetched.text,
    });
    let selected = candidates[0] || null;
    let discoverySource = selected ? fetched.fetch_source || selected.source : fetched.fetch_source || "html_scan";
    let discoveredPageUrl = "";

    if (!selected) {
      for (const linkedPageUrl of discoverOfficialMediaPageLinksFromText({
        baseUrl: officialUrl,
        text: fetched.text,
        limit: 2,
      })) {
        const linkedFetched = await (options.fetchText || defaultFetchText)(linkedPageUrl, options);
        if (!linkedFetched?.ok) continue;
        const linkedCandidates = discoverDirectMediaUrlsFromText({
          baseUrl: linkedPageUrl,
          text: linkedFetched.text,
        });
        if (!linkedCandidates.length) continue;
        candidates.push(...linkedCandidates);
        selected = linkedCandidates[0];
        discoverySource = "official_same_origin_media_page";
        discoveredPageUrl = linkedPageUrl;
        break;
      }
    }

    const enrichedCandidates = selected
      ? await enrichDirectMediaCandidates(candidates, options)
      : [];
    const entityMatchedCandidates = enrichedCandidates.filter((candidate) =>
      candidateMatchesEntity(candidate, entry.entity),
    );
    const directMediaCandidates = entityMatchedCandidates.filter(candidateHasUsableMotionDuration);
    const entityMismatchCandidateCount = enrichedCandidates.length - entityMatchedCandidates.length;
    const shortDurationCandidateCount = entityMatchedCandidates.length - directMediaCandidates.length;
    const selectedCandidate = directMediaCandidates[0] || {};
    const selectedDirectMediaUrl = selectedCandidate.direct_media_url || "";
    const directMediaFound = Boolean(selectedDirectMediaUrl);
    const metadata = selected
      ? {
          source_duration_s: selectedCandidate.source_duration_s || null,
          media_width: selectedCandidate.media_width || null,
          media_height: selectedCandidate.media_height || null,
        }
      : {};
    return {
      index,
      story_id: cleanText(entry.story_id),
      entity: cleanText(entry.entity),
      source_family: cleanText(entry.source_family),
      official_source_url: officialUrl,
      status: directMediaFound ? "direct_media_found" : "no_direct_media_found",
      direct_media_url: selectedDirectMediaUrl,
      source_url_kind: selectedCandidate.source_url_kind || "",
      discovery_source: discoverySource,
      discovered_page_url: discoveredPageUrl || null,
      rejection_reason: directMediaFound
        ? null
        : shortDurationCandidateCount > 0
          ? "direct_media_candidates_below_min_duration"
          : entityMismatchCandidateCount > 0
          ? "entity_mismatch_direct_media_candidates"
          : "no_validation_eligible_media_url_found",
      candidate_count: candidates.length,
      entity_mismatch_candidate_count: entityMismatchCandidateCount,
      short_duration_candidate_count: shortDurationCandidateCount,
      direct_media_candidates: directMediaCandidates,
      ...metadata,
    };
  } catch (err) {
    return {
      index,
      story_id: cleanText(entry.story_id),
      entity: cleanText(entry.entity),
      source_family: cleanText(entry.source_family),
      official_source_url: officialUrl,
      status: "fetch_failed",
      direct_media_url: "",
      source_url_kind: "",
      discovery_source: "html_scan",
      rejection_reason: err?.name === "AbortError" ? "fetch_timeout" : cleanText(err.message || "fetch_failed"),
    };
  }
}

async function buildOfficialDirectMediaDiscoveryReport({
  entries = [],
  generatedAt = new Date().toISOString(),
  fetchText = defaultFetchText,
  probeMedia = null,
  timeoutMs = 10000,
  maxCandidatesPerEntry: requestedMaxCandidatesPerEntry = 1,
} = {}) {
  const rows = [];
  const options = {
    fetchText,
    probeMedia,
    timeoutMs,
    maxCandidatesPerEntry: requestedMaxCandidatesPerEntry,
  };
  for (const [index, entry] of asArray(entries).entries()) {
    rows.push(await rowForEntry(entry, index, options));
  }
  const outputEntries = asArray(entries).flatMap((entry, index) =>
    templateEntriesForRow(entry, rows[index] || {}, options),
  );

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "official_direct_media_discovery",
    local_only: true,
    summary: {
      entries: rows.length,
      discovered: rows.filter((row) => row.status === "direct_media_found").length,
      no_direct_media_found: rows.filter((row) => row.status === "no_direct_media_found").length,
      fetch_failed: rows.filter((row) => row.status === "fetch_failed").length,
      skipped: rows.filter((row) => row.status === "skipped").length,
      expanded_template_entries: outputEntries.length,
    },
    safety: {
      local_only: true,
      video_downloads_started: false,
      media_metadata_probes_started: typeof probeMedia === "function",
      retained_video_files: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
    },
    rows,
    output_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: outputEntries,
    },
  };
}

function renderOfficialDirectMediaDiscoveryMarkdown(report = {}) {
  const lines = [];
  lines.push("# Official Direct Media Discovery");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Entries: ${report.summary?.entries ?? 0}`);
  lines.push(`Discovered: ${report.summary?.discovered ?? 0}`);
  lines.push("");
  lines.push("Safety: No videos are downloaded. This only fetches official page text and writes local reports/templates.");
  lines.push("");
  lines.push("| story | family | status | media kind | reason |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of asArray(report.rows)) {
    lines.push(
      `| ${row.story_id || "unknown"} | ${row.source_family || "unknown"} | ${row.status || "unknown"} | ${row.source_url_kind || "none"} | ${row.rejection_reason || "clear"} |`,
    );
  }
  if (!asArray(report.rows).length) lines.push("| none | none | none | none | none |");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildOfficialDirectMediaDiscoveryReport,
  discoverOfficialMediaPageLinksFromText,
  discoverDirectMediaUrlsFromText,
  probeDirectMediaMetadata,
  renderOfficialDirectMediaDiscoveryMarkdown,
};
