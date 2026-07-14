"use strict";

const crypto = require("node:crypto");

const MONTHS = new Map([
  ["january", 0], ["february", 1], ["march", 2], ["april", 3],
  ["may", 4], ["june", 5], ["july", 6], ["august", 7],
  ["september", 8], ["october", 9], ["november", 10], ["december", 11],
]);
const WEEKDAY = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";
const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
const DATE_PART = `${WEEKDAY},?\\s+${MONTH}\\s+\\d{1,2}(?:,\\s*\\d{4})?|${MONTH}\\s+\\d{1,2}(?:,\\s*\\d{4})?`;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&hellip;/gi, "...");
}

function textFromHtmlFragment(fragment = "") {
  return cleanText(
    decodeHtml(
      String(fragment || "")
        .replace(/<(?:script|style|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript)>/gi, " ")
        .replace(/<br\s*\/?>|<\/(?:p|h[1-6]|li|div|section|blockquote)>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function jsonLdArticleBody(html = "") {
  const scripts = String(html || "").matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const queue = [];
  for (const match of scripts) {
    try {
      queue.push(JSON.parse(decodeHtml(match[1])));
    } catch {
      // Malformed third-party JSON-LD is ignored; the article element remains available.
    }
  }
  while (queue.length) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (cleanText(value.articleBody)) return cleanText(value.articleBody);
    if (Array.isArray(value["@graph"])) queue.push(...value["@graph"]);
  }
  return "";
}

function headlineFromHtml(html = "") {
  const source = String(html || "");
  const patterns = [
    /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    /<title\b[^>]*>([\s\S]*?)<\/title>/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return textFromHtmlFragment(match[1]);
  }
  return "";
}

function articleTextFromHtml(html = "") {
  const source = String(html || "");
  const article = source.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const visibleArticle = article ? textFromHtmlFragment(article[1]) : "";
  if (visibleArticle) return visibleArticle;
  const structured = jsonLdArticleBody(source);
  return structured || textFromHtmlFragment(source);
}

function sourceYear(publishedAt) {
  const parsed = Date.parse(String(publishedAt || ""));
  return Number.isFinite(parsed) ? new Date(parsed).getUTCFullYear() : new Date().getUTCFullYear();
}

function parseDatePart(value, { year, endOfDay = false, utcTime = "" } = {}) {
  const text = cleanText(value).replace(new RegExp(`^${WEEKDAY},?\\s+`, "i"), "");
  const match = text.match(new RegExp(`^(${MONTH})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?$`, "i"));
  if (!match) return null;
  const month = MONTHS.get(match[1].toLowerCase());
  const day = Number(match[2]);
  const resolvedYear = Number(match[3] || year);
  let hour = endOfDay ? 23 : 0;
  let minute = endOfDay ? 59 : 0;
  let second = endOfDay ? 59 : 0;
  let millisecond = endOfDay ? 999 : 0;
  const time = cleanText(utcTime).match(/^(\d{1,2}):(\d{2})$/);
  if (time) {
    hour = Number(time[1]);
    minute = Number(time[2]);
    second = 0;
    millisecond = 0;
  }
  const date = new Date(Date.UTC(resolvedYear, month, day, hour, minute, second, millisecond));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function confirmedEventWindowFromText(text = "", { url = "", publishedAt = "" } = {}) {
  const source = cleanText(text);
  const year = sourceYear(publishedAt);
  const labelled = {};
  for (const label of ["Start", "End"]) {
    const match = source.match(
      new RegExp(`\\b${label}:\\s*(${DATE_PART})(?:\\s+at[^()]{0,80})?(?:\\((\\d{1,2}:\\d{2})\\s*UTC\\))?`, "i"),
    );
    if (match) {
      labelled[label.toLowerCase()] = {
        text: cleanText(match[1]),
        utcTime: cleanText(match[2]),
        evidence: cleanText(match[0]),
      };
    }
  }
  if (labelled.end) {
    const startsAt = labelled.start
      ? parseDatePart(labelled.start.text, { year, utcTime: labelled.start.utcTime })
      : null;
    const endsAt = parseDatePart(labelled.end.text, {
      year,
      endOfDay: !labelled.end.utcTime,
      utcTime: labelled.end.utcTime,
    });
    if (endsAt) {
      return {
        status: "confirmed",
        starts_at: startsAt,
        ends_at: endsAt,
        source_url: cleanText(url) || null,
        evidence_text: cleanText([labelled.start?.evidence, labelled.end.evidence].filter(Boolean).join(" ")),
      };
    }
  }

  const range = source.match(
    new RegExp(`\\b(from)\\s+(${DATE_PART})\\s+(?:until|through)\\s+(${DATE_PART})`, "i"),
  );
  if (!range) return null;
  const startsAt = parseDatePart(range[2], { year });
  const endsAt = parseDatePart(range[3], { year, endOfDay: true });
  if (!startsAt || !endsAt) return null;
  return {
    status: "confirmed",
    starts_at: startsAt,
    ends_at: endsAt,
    source_url: cleanText(url) || null,
    evidence_text: cleanText(range[0]),
  };
}

function sourceClaimsFromText(sourceText = "", sourceUrl = "") {
  return cleanText(sourceText)
    .split(/(?<=[.!?])\s+/)
    .map(cleanText)
    .filter((sentence) => sentence.length >= 24 && sentence.length <= 600)
    .slice(0, 120)
    .map((sentence) => ({
      text: sentence,
      source_url: cleanText(sourceUrl),
      evidence_text: sentence,
      origin: "source_body",
    }));
}

function extractOfficialSourcePageEvidence({ html = "", url = "", publishedAt = "" } = {}) {
  const sourceText = articleTextFromHtml(html);
  if (!sourceText) {
    return {
      status: "blocked",
      reason: "official_source_article_text_missing",
      source_url: cleanText(url),
      headline: headlineFromHtml(html),
      source_text: "",
      source_text_sha256: null,
      claims: [],
      confirmed_event_window: null,
    };
  }
  return {
    status: "pass",
    source_url: cleanText(url),
    headline: headlineFromHtml(html),
    source_text: sourceText,
    source_text_sha256: crypto.createHash("sha256").update(sourceText).digest("hex"),
    claims: sourceClaimsFromText(sourceText, url),
    confirmed_event_window: confirmedEventWindowFromText(sourceText, { url, publishedAt }),
  };
}

async function fetchOfficialSourcePageEvidence({
  url = "",
  publishedAt = "",
  fetchImpl = global.fetch,
  timeoutMs = 10_000,
} = {}) {
  if (!cleanText(url)) throw new Error("official_source_url_required");
  if (typeof fetchImpl !== "function") throw new Error("official_source_fetch_unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 10_000));
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "user-agent": "PulseGamingSourceEvidence/1.0" },
    });
    if (!response?.ok) throw new Error(`official_source_http_${response?.status || "unknown"}`);
    const html = await response.text();
    return extractOfficialSourcePageEvidence({ html, url, publishedAt });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  articleTextFromHtml,
  confirmedEventWindowFromText,
  extractOfficialSourcePageEvidence,
  fetchOfficialSourcePageEvidence,
  sourceClaimsFromText,
};
