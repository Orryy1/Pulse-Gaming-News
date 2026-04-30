"use strict";

/**
 * lib/deployment-mode.js — railway / local deployment-mode switch.
 *
 * 2026-04-30 mission: Pulse Gaming should run on a home PC for free
 * while the channel is unmonetised, with a one-flag switch back to
 * Railway when revenue justifies the cost. This module is the single
 * place every other component reads to figure out:
 *
 *   - which deployment mode are we in?
 *   - what's the public URL for OAuth callbacks + IG/FB media fetch?
 *   - is THIS instance the primary scheduler runner, or a mirror?
 *   - where do persistent files live?
 *
 * Design:
 *   DEPLOYMENT_MODE         "railway" (default) | "local"
 *   PULSE_PRIMARY_INSTANCE  "true" (default)    | "false"
 *
 * Why two flags:
 *   The mode flag tells everything WHERE we're running. The primary
 *   flag tells the scheduler whether to fire jobs. During migration
 *   you can run BOTH instances in parallel with one as primary and
 *   the other as observation-only — no double-publishes.
 *
 * Public URL resolution (used by upload_instagram, upload_facebook,
 * server.js OAuth callbacks, server.js media routes):
 *   1. PULSE_PUBLIC_URL  — explicit override, wins always
 *   2. RAILWAY_PUBLIC_URL — current Railway-injected URL (still works)
 *   3. LOCAL_PUBLIC_URL  — Cloudflare Tunnel URL when on local
 *   4. http://localhost:PORT — last-resort dev fallback
 *
 * Pure / synchronous. No I/O, no side effects. Safe to require()
 * from anywhere including hot paths.
 */

const VALID_MODES = ["railway", "local"];

function getMode(env = process.env) {
  const raw = String(env.DEPLOYMENT_MODE || "")
    .toLowerCase()
    .trim();
  if (VALID_MODES.includes(raw)) return raw;
  // Heuristic: if RAILWAY_* vars exist, we're on Railway by default.
  if (
    env.RAILWAY_PUBLIC_URL ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_ENVIRONMENT
  ) {
    return "railway";
  }
  return "local";
}

function isLocal(env = process.env) {
  return getMode(env) === "local";
}

function isRailway(env = process.env) {
  return getMode(env) === "railway";
}

/**
 * Whether THIS instance should run the scheduler / fire jobs / post
 * to platforms. Defaults to true so the existing Railway behaviour
 * is unchanged. Operator sets PULSE_PRIMARY_INSTANCE=false on the
 * "mirror" instance during migration so both can run side-by-side
 * for verification without double-publishing.
 */
function isPrimary(env = process.env) {
  const v = String(env.PULSE_PRIMARY_INSTANCE || "")
    .toLowerCase()
    .trim();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

/**
 * Resolve the canonical public URL for OAuth callbacks + media-host
 * URLs. See module header for resolution order.
 */
function getPublicUrl(env = process.env) {
  if (env.PULSE_PUBLIC_URL) return env.PULSE_PUBLIC_URL.replace(/\/+$/, "");
  if (env.RAILWAY_PUBLIC_URL) return env.RAILWAY_PUBLIC_URL.replace(/\/+$/, "");
  if (env.LOCAL_PUBLIC_URL) return env.LOCAL_PUBLIC_URL.replace(/\/+$/, "");
  const port = env.PORT || 3001;
  return `http://localhost:${port}`;
}

/**
 * Where should persistent files live? Caller checks via
 * mediaPaths/db modules; this is just the env preference.
 */
function getMediaRoot(env = process.env) {
  if (env.MEDIA_ROOT) return env.MEDIA_ROOT;
  if (isRailway(env)) return "/data/media";
  return null; // null → repo-root fallback (existing behaviour)
}

function getSqliteDbPath(env = process.env) {
  if (env.SQLITE_DB_PATH) return env.SQLITE_DB_PATH;
  if (isRailway(env)) return "/data/pulse.db";
  return null; // → ./data/pulse.db
}

/**
 * Compact summary used by the health endpoint and Discord summary
 * prefix. Never includes secret values — only mode metadata.
 */
function summary(env = process.env) {
  const mode = getMode(env);
  const primary = isPrimary(env);
  const publicUrl = getPublicUrl(env);
  return {
    mode,
    primary,
    public_url: publicUrl,
    media_root: getMediaRoot(env) || "(repo-root fallback)",
    sqlite_db_path: getSqliteDbPath(env) || "(repo-root data/pulse.db)",
  };
}

/**
 * Discord/log prefix that makes it visible at a glance which
 * instance posted a given message. Empty string for the primary
 * Railway instance (so existing Discord posts read identically),
 * "[LOCAL] " for a local primary, "[MIRROR] " for a non-primary.
 */
function prefix(env = process.env) {
  const primary = isPrimary(env);
  const mode = getMode(env);
  if (!primary) return "[MIRROR] ";
  if (mode === "local") return "[LOCAL] ";
  return ""; // railway primary = current behaviour
}

module.exports = {
  getMode,
  isLocal,
  isRailway,
  isPrimary,
  getPublicUrl,
  getMediaRoot,
  getSqliteDbPath,
  summary,
  prefix,
  VALID_MODES,
};
