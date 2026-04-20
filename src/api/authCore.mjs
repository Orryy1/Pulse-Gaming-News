// @ts-check
/**
 * Pure auth helpers shared between the browser `auth.ts` module and the
 * Node test suite. Kept as plain JS so `node --test` can import it
 * without a TypeScript loader, and free of any `window`/`document`
 * references so it's safely importable in both environments.
 *
 * Nothing in here speaks to localStorage or fetch directly — those
 * live in auth.ts / http.ts so the browser-only bits stay out of the
 * test import graph.
 */

/**
 * Trim and sanity-check an operator-supplied API token. Returns null
 * for anything that obviously isn't a token (empty, whitespace, short
 * garbage, accidentally-pasted "Bearer …" prefix still attached).
 * Never logs the input.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normaliseToken(raw) {
  if (typeof raw !== "string") return null;
  let t = raw.trim();
  if (!t) return null;
  // Tolerate operators who copy the whole "Authorization: Bearer …"
  // header — strip the prefix instead of storing garbage.
  if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, "").trim();
  if (/^authorization:\s*/i.test(t)) {
    t = t.replace(/^authorization:\s*/i, "").trim();
    if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, "").trim();
  }
  if (t.length < 8) return null;
  return t;
}

/**
 * Build the headers object for a mutating request. When a token is
 * present, adds `Authorization: Bearer <token>`. Never mutates the
 * caller's headers object.
 *
 * @param {Record<string, string> | undefined} baseHeaders
 * @param {string | null | undefined} token
 * @returns {Record<string, string>}
 */
export function buildAuthHeaders(baseHeaders, token) {
  /** @type {Record<string, string>} */
  const out = {};
  if (baseHeaders) {
    for (const [k, v] of Object.entries(baseHeaders)) out[k] = v;
  }
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

/**
 * Strip any token-like substring out of a message before it's shown to
 * the operator or logged. Belt-and-braces — our own code paths don't
 * embed the token in errors, but a fetch failure / third-party lib
 * might. We redact:
 *   - "Bearer <token>" sequences
 *   - a bare copy of the token we currently hold (passed in `token`)
 *
 * @param {string} message
 * @param {string | null | undefined} token
 * @returns {string}
 */
export function redactToken(message, token) {
  if (typeof message !== "string") return "";
  let out = message.replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>");
  if (token && token.length >= 8) {
    // Escape regex metachars in the token before substitution.
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), "<redacted>");
  }
  return out;
}

/**
 * Discord approval links and one-shot operator bookmarks deep-link
 * into the SPA with `?token=…`. If present on the current URL, hand
 * the cleaned token back so the caller can persist it. Returns null
 * when no token is in the URL.
 *
 * Accepts the raw location string (or URL object) rather than reading
 * `window.location` directly so this function stays Node-testable.
 *
 * @param {string} locationHref
 * @returns {string | null}
 */
export function parseTokenFromUrl(locationHref) {
  if (typeof locationHref !== "string" || !locationHref) return null;
  try {
    const u = new URL(locationHref);
    const raw = u.searchParams.get("token");
    return normaliseToken(raw);
  } catch {
    return null;
  }
}

/**
 * Given an HTTP response shape, decide whether this represents an auth
 * failure we should react to by clearing the stored token and
 * prompting. Accepts a duck-typed response so tests don't need a real
 * Response instance.
 *
 * @param {{ status?: number } | null | undefined} res
 * @returns {boolean}
 */
export function isAuthError(res) {
  return !!(res && res.status === 401);
}
