/**
 * lib/services/url-canonical.js — URL normalisation + hashing for
 * duplicate-detection identity.
 *
 * Context: the Phase 2 dedupe cutover needs an identity stronger than
 * fuzzy title matching. The 17 April 2026 Pragmata incident (same
 * article re-hunted, Instagram re-posted) proved that Jaccard title
 * similarity is not sufficient — a source domain that tweaks the
 * headline on republish can slip past a 0.5 word-overlap threshold.
 *
 * This module provides:
 *   canonicalUrl(url)      -> normalised form suitable for comparison
 *   canonicalHash(url)     -> short stable hash of the normalised form
 *
 * What we strip / normalise:
 *   - protocol (http:// and https:// treated as equivalent)
 *   - lowercase host
 *   - strip www. prefix
 *   - trim trailing slash on the path
 *   - drop common tracking params (utm_*, fbclid, gclid, mc_cid, mc_eid,
 *     ref, ref_src, ref_url, igshid, sh)
 *   - sort remaining query params deterministically
 *   - drop fragment (#...)
 *   - collapse consecutive slashes in the path
 *
 * What we DON'T do:
 *   - resolve redirects (the hunter already follows them)
 *   - canonicalise the <link rel="canonical"> tag (that's a scraper job)
 *   - strip path segments (e.g. /article/123 vs /story/123 stay distinct
 *     because they usually represent different content)
 *
 * The hash is a 12-char hex prefix of a SHA-1 — long enough to be unique
 * within our corpus (millions of URLs would be needed for a collision)
 * and short enough to be logged/indexed cheaply.
 *
 * Input safety: malformed URLs return null from canonicalUrl and a
 * sentinel "invalid-url" hash from canonicalHash. Callers should treat
 * null as "cannot dedup by URL, fall back to alternative identity".
 */

const crypto = require("crypto");

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "ref_url",
  "igshid",
  "sh",
  "si",
  "feature",
  "share_source",
]);

/**
 * Normalise a URL to a canonical string form. Returns null if the input
 * cannot be parsed.
 */
function canonicalUrl(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }

  // Only http/https are meaningful here. Other schemes (ftp://, mailto:,
  // javascript:) have no canonical news-article semantics — treat as
  // unparseable so callers fall back to alternative identity.
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  // Collapse repeated slashes and strip trailing slash on the path,
  // except the root path itself which stays as "/".
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  // Filter + sort query params.
  const params = [];
  for (const [k, v] of u.searchParams.entries()) {
    const lk = k.toLowerCase();
    if (TRACKING_PARAMS.has(lk)) continue;
    if (TRACKING_PARAM_PREFIXES.some((p) => lk.startsWith(p))) continue;
    params.push([lk, v]);
  }
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length
    ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&")
    : "";

  // Drop fragment. "https://site.com/x#section" is the same article as
  // "https://site.com/x".
  return `${host}${path}${query}`;
}

/**
 * 12-char hex hash of canonicalUrl(input). Deterministic + stable across
 * processes. Returns the sentinel "invalid-url" when the URL could not
 * be normalised — callers check for that and fall back.
 */
function canonicalHash(input) {
  const norm = canonicalUrl(input);
  if (!norm) return "invalid-url";
  return crypto.createHash("sha1").update(norm).digest("hex").slice(0, 12);
}

module.exports = {
  canonicalUrl,
  canonicalHash,
  // Exported for tests + future callers that need to check their own
  // filter policy.
  TRACKING_PARAMS,
  TRACKING_PARAM_PREFIXES,
};
