/**
 * lib/services/news-mirror.js
 *
 * Pure helper used by server.js::writeNews to decide what to do with a
 * stories array. Extracted so the "skip the JSON mirror under SQLite"
 * fix (which is what prevents the 17/18-Apr "Invalid string length"
 * hunt failures) has a unit-testable surface without spinning up the
 * full Express server.
 *
 * The decision is intentionally boring:
 *
 *   - USE_SQLITE=true  -> SQLite is canonical, skip JSON mirror.
 *                         Large story sets never hit JSON.stringify
 *                         so V8's String::kMaxLength can't trip.
 *   - USE_SQLITE=false -> JSON file IS canonical (dev), write it.
 *
 * The actual fs / db calls stay in server.js where their lifecycle
 * matches the running process. This module is just the logic.
 */

"use strict";

/**
 * @param {Array} data   stories array to write
 * @param {Object} opts
 * @param {boolean} opts.useSqlite  is SQLite the canonical store right now?
 * @returns {{ strategy: 'sqlite-only' | 'json-mirror', reason: string }}
 */
function decideMirrorStrategy(data, { useSqlite } = {}) {
  if (useSqlite) {
    return {
      strategy: "sqlite-only",
      reason: "sqlite_canonical_skip_json_mirror",
    };
  }
  return {
    strategy: "json-mirror",
    reason: "sqlite_off_json_is_canonical",
  };
}

/**
 * Best-effort JSON.stringify with RangeError capture. Returns
 *   { ok: true,  serialised: string }
 *   { ok: false, reason: string, rowCount: number }
 *
 * Never throws — callers should always fall through to whatever their
 * non-JSON canonical path is (SQLite under prod, or just "lost this
 * cycle" under dev JSON mode).
 */
function tryStringify(data, { indent = 2 } = {}) {
  const rowCount = Array.isArray(data) ? data.length : -1;
  try {
    const serialised = JSON.stringify(data, null, indent);
    return { ok: true, serialised, rowCount };
  } catch (err) {
    // RangeError("Invalid string length") is the specific V8 error we
    // care about, but any throw here is treated equivalently.
    return {
      ok: false,
      rowCount,
      reason: `${err.name}: ${err.message}`,
    };
  }
}

module.exports = {
  decideMirrorStrategy,
  tryStringify,
};
