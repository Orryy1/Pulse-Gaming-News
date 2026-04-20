/**
 * lib/oauth-state.js — tiny in-memory CSRF nonce store for the
 * operator-initiated OAuth flows (`/auth/tiktok`, `/auth/facebook`).
 *
 * Shape of the problem:
 *   - An operator clicks /auth/tiktok on the server.
 *   - Server redirects their browser to TikTok.
 *   - TikTok redirects back to /auth/tiktok/callback?code=…
 *   - Without state, a third party could trick the operator into
 *     landing on the callback URL with a `code` they control, fooling
 *     our server into saving the attacker's token (account takeover
 *     via OAuth CSRF).
 *
 * What this module provides:
 *   - `createState(provider)`: mint a cryptographically random state
 *     tied to a provider tag, remember it, return the state string.
 *   - `consumeState(state, provider)`: atomically validate and delete.
 *     Requires the state to exist, be for the claimed provider, and
 *     not be expired. Single-use — a second consume always fails.
 *   - `_resetForTests()`: wipe the store; not exported for production.
 *
 * Storage is a plain `Map` kept in the Node process. That's fine
 * because OAuth initiation and callback are both handled by the same
 * Railway instance (operator-scale, not distributed), and the state
 * only needs to survive the ~30s the operator spends on the TikTok /
 * Facebook consent screen. On restart the store is lost, which is
 * correct: any in-flight OAuth dance was abandoned with the old
 * process.
 *
 * Explicitly NOT using SQLite:
 *   - Per-request write on an operator-initiated flow is overkill.
 *   - Survives-restart is an anti-feature here: if the process was
 *     restarted while a state was pending, that state should be dead.
 *   - Keeps the module free of the db-connection import dance, so
 *     the tests run without touching /data/pulse.db.
 */

const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for
// a distracted operator to finish consent, short enough to kill
// anything abandoned.

/** @type {Map<string, { provider: string, createdAt: number }>} */
const store = new Map();

/**
 * Minted tokens use 32 bytes of random → 64 hex chars, which is both
 * URL-safe without encoding and well above the 128-bit threshold
 * recommended for CSRF nonces.
 */
function generateStateValue() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Lazy sweep: called from createState so the store never grows
 * unbounded even if callbacks never arrive. We don't run this on
 * consumeState — consume already removes the exact entry it uses,
 * and we don't want a consume call to be O(store_size).
 *
 * `now` is injectable for deterministic tests.
 */
function sweepExpired(now, ttlMs) {
  for (const [k, v] of store) {
    if (now - v.createdAt > ttlMs) store.delete(k);
  }
}

/**
 * Create and remember a fresh state for an OAuth initiation.
 *
 * @param {string} provider - "tiktok" | "facebook" (free-form tag,
 *   just has to match what the callback passes to consumeState).
 * @param {{ now?: number, ttlMs?: number }} [opts]
 * @returns {string} the state value to embed in the authorise URL.
 */
function createState(provider, opts = {}) {
  if (typeof provider !== "string" || provider.length === 0) {
    throw new Error("oauth-state: provider tag is required");
  }
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const ttlMs = typeof opts.ttlMs === "number" ? opts.ttlMs : DEFAULT_TTL_MS;
  sweepExpired(now, ttlMs);
  const state = generateStateValue();
  store.set(state, { provider, createdAt: now });
  return state;
}

/**
 * Validate a state returned on the OAuth callback and atomically
 * consume it. Returns a result object so callers can render a
 * specific error page ("missing", "expired", "wrong provider")
 * without leaking the state value itself.
 *
 * Failure reasons are deliberately coarse — they tell the operator
 * what to retry without helping a real attacker enumerate the store.
 *
 * @param {unknown} state
 * @param {string} provider
 * @param {{ now?: number, ttlMs?: number }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function consumeState(state, provider, opts = {}) {
  if (typeof state !== "string" || state.length === 0) {
    return { ok: false, reason: "missing_state" };
  }
  if (typeof provider !== "string" || provider.length === 0) {
    return { ok: false, reason: "missing_provider" };
  }
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const ttlMs = typeof opts.ttlMs === "number" ? opts.ttlMs : DEFAULT_TTL_MS;
  const entry = store.get(state);
  if (!entry) {
    // Either a replay of an already-consumed state, a spoofed value,
    // or an expired entry swept out by a later createState call.
    return { ok: false, reason: "unknown_or_expired_state" };
  }
  // Always delete BEFORE checking further so a wrong-provider or
  // expired state can't be replayed with the correct provider later.
  store.delete(state);
  if (now - entry.createdAt > ttlMs) {
    return { ok: false, reason: "unknown_or_expired_state" };
  }
  if (entry.provider !== provider) {
    return { ok: false, reason: "provider_mismatch" };
  }
  return { ok: true };
}

/** Internal: wipe the store. Tests only. */
function _resetForTests() {
  store.clear();
}

/** Internal: read-only size for tests. Never export in production use. */
function _sizeForTests() {
  return store.size;
}

module.exports = {
  createState,
  consumeState,
  DEFAULT_TTL_MS,
  _resetForTests,
  _sizeForTests,
};
