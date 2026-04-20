/**
 * lib/safe-url.js — tiny guard for outbound URL fetches against the
 * obvious SSRF-adjacent mistakes.
 *
 * Scope:
 *   - Reject non-http(s) schemes (`file:`, `gopher:`, `javascript:`,
 *     `data:` images embedded in HTML, `ftp:`, etc.)
 *   - Reject hostnames that are a literal private / link-local /
 *     loopback IP (IPv4 + IPv6 commons)
 *   - Reject obviously-local hostnames (`localhost`, `localhost.*`)
 *   - Cap URL length to a sane maximum so a pathologically long
 *     URL can't melt the axios internals
 *
 * Out of scope (deliberate):
 *   - DNS resolution. A malicious host could CNAME to an internal
 *     IP and this helper wouldn't catch it. Adding a DNS probe
 *     per fetch is its own engineering project — latency, caching,
 *     IPv6 resolution, races between probe and actual fetch. Out
 *     of scope for the overnight audit per the brief.
 *   - Redirect following. axios follows 3xx by default. A remote
 *     server could 302 to an internal IP. Callers who care should
 *     pass `maxRedirects: 0` or validate the final `.request.path`.
 *
 * Usage:
 *   const { assertSafeOutboundUrl } = require('./lib/safe-url');
 *   assertSafeOutboundUrl(story.article_image);
 *   // throws on failure — callers decide whether to catch or let
 *   // it propagate
 *
 * Or non-throwing:
 *   if (!isSafeOutboundUrl(someUrl)) return null;
 */

const MAX_URL_LENGTH = 2048;

// Private / loopback / link-local / CGNAT IPv4 ranges.
// Matched against the raw hostname (as a literal IP) — we do NOT
// resolve DNS here, just reject obvious IP-literal SSRF vectors.
const IPV4_BLOCK_RE = [
  /^127\./, // 127.0.0.0/8  loopback
  /^10\./, // 10.0.0.0/8   private
  /^192\.168\./, // 192.168.0.0/16 private
  /^169\.254\./, // 169.254.0.0/16 link-local (GCP/AWS/Azure metadata)
  /^0\./, // 0.0.0.0/8    "this network"
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 CGNAT
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12 private
  /^22[4-9]\.|^23[0-9]\./, // multicast
  /^24[0-9]\.|^25[0-5]\./, // reserved
];

// Common IPv6 blocks we reject as literal hosts.
// ::1 loopback, fe80::/10 link-local, fc00::/7 unique-local,
// fec0::/10 deprecated site-local, ::0 unspecified.
const IPV6_BLOCK_RE = [
  /^\[?::1\]?$/i,
  /^\[?::\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // fc00::/7
  /^\[?fe[89ab][0-9a-f]:/i, // fe80::/10
  /^\[?fec[0-9a-f]:/i, // fec0::/10
];

function isIpv4Literal(host) {
  // Matches `1.2.3.4` — four decimal octets. Doesn't try to
  // validate range (we let the block-regex handle that) — just
  // "is this a dotted quad?"
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isIpv6Literal(host) {
  // URL hostnames wrap IPv6 in brackets. Strip and check.
  const stripped = host.replace(/^\[|\]$/g, "");
  // Crude: at least one colon and only hex-ish chars.
  return /:/.test(stripped) && /^[0-9a-f:]+$/i.test(stripped);
}

/**
 * Non-throwing variant. Returns { ok: true } or
 * { ok: false, reason: string } so callers can log a specific
 * failure reason without re-parsing the URL themselves.
 */
function classifyOutboundUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "empty_or_non_string" };
  }
  if (raw.length > MAX_URL_LENGTH) {
    return { ok: false, reason: "url_too_long" };
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "url_parse_failed" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `scheme_${u.protocol.replace(/:$/, "")}` };
  }
  // Pull a clean hostname — for IPv6 this is bracket-wrapped via URL.
  const host = u.hostname || "";
  if (!host) {
    return { ok: false, reason: "missing_host" };
  }
  const lowerHost = host.toLowerCase();
  if (
    lowerHost === "localhost" ||
    lowerHost.endsWith(".localhost") ||
    lowerHost === "ip6-localhost" ||
    lowerHost === "ip6-loopback"
  ) {
    return { ok: false, reason: "localhost" };
  }
  if (isIpv4Literal(host)) {
    for (const re of IPV4_BLOCK_RE) {
      if (re.test(host)) {
        return { ok: false, reason: "ipv4_private_or_reserved" };
      }
    }
  }
  if (isIpv6Literal(host)) {
    for (const re of IPV6_BLOCK_RE) {
      if (re.test(host)) {
        return { ok: false, reason: "ipv6_private_or_reserved" };
      }
    }
  }
  return { ok: true };
}

function isSafeOutboundUrl(raw) {
  return classifyOutboundUrl(raw).ok;
}

function assertSafeOutboundUrl(raw) {
  const c = classifyOutboundUrl(raw);
  if (!c.ok) {
    throw new Error(`unsafe outbound URL rejected (${c.reason})`);
  }
}

module.exports = {
  MAX_URL_LENGTH,
  classifyOutboundUrl,
  isSafeOutboundUrl,
  assertSafeOutboundUrl,
};
