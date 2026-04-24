/**
 * lib/media-paths.js — single source of truth for where generated
 * media lives on disk.
 *
 * Problem we're solving (22 April 2026)
 * -------------------------------------
 * SQLite lives on Railway's persistent volume at /data/pulse.db.
 * Generated media (MP4s, PNGs, MP3s) has always lived under a
 * relative `output/…` path — which means `/app/output/…` in the
 * container. `/app` is ephemeral: every redeploy wipes it. So the
 * story row in SQLite survives but the MP4 it points to does not,
 * and publish windows fail with `exported_mp4_not_on_disk`.
 *
 * The fix here is intentionally minimal:
 *
 *   - DB still stores the SAME relative strings it always has
 *     (`output/final/<id>.mp4`, `output/stories/<id>_story.png`,
 *     etc). No migration, no schema change.
 *   - New env var `MEDIA_ROOT` (unset by default). When set — e.g.
 *     `MEDIA_ROOT=/data/media` on Railway — writes go under the
 *     persistent root and reads look there first, falling back to
 *     the legacy repo-root location for old files.
 *   - When `MEDIA_ROOT` is unset (local dev / CI), behaviour is
 *     identical to pre-change: everything resolves under the repo
 *     working directory, just like before.
 *
 * The two critical call shapes are:
 *
 *   const mediaPaths = require('./lib/media-paths');
 *
 *   // When a writer is about to create a new file, ask where to
 *   // put it — the answer respects MEDIA_ROOT if set. Writer then
 *   // persists the ORIGINAL relative path in the DB.
 *   const writeTo = mediaPaths.writePath('output/final/abc.mp4');
 *   await fs.ensureDir(path.dirname(writeTo));
 *   await fs.writeFile(writeTo, buf);
 *   story.exported_path = 'output/final/abc.mp4'; // unchanged
 *
 *   // When a reader has a stored path, resolve it to an absolute
 *   // on-disk location — MEDIA_ROOT first, repo-root fallback.
 *   // Returns the first candidate that exists, or the preferred
 *   // write path if neither exists (so callers can 404 cleanly).
 *   const abs = await mediaPaths.resolveExisting(story.exported_path);
 *   if (!(await fs.pathExists(abs))) throw 'missing';
 *
 * Path-traversal guard: any input containing `..` segments after
 * normalisation is rejected. Callers that legitimately need to
 * read an arbitrary file from disk should not use this helper.
 */

"use strict";

const path = require("node:path");
const fsExtra = require("fs-extra");

const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * Return the configured MEDIA_ROOT or null when unset. Trimming
 * whitespace lets us tolerate `MEDIA_ROOT= ` (blank value) the
 * same as an unset var — a common Railway misconfig.
 */
function getMediaRoot() {
  const raw = process.env.MEDIA_ROOT;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

/**
 * Return the repo-root default when MEDIA_ROOT is unset, or the
 * configured MEDIA_ROOT when set. Used by callers that just want
 * a single canonical base.
 */
function getWriteRoot() {
  return getMediaRoot() || REPO_ROOT;
}

/**
 * Normalise a caller-supplied path relative to a base. Rejects
 * any input that would escape the base via `..` segments — this
 * is our path-traversal guard.
 *
 * Returns null on reject (callers treat null as "illegal input").
 *
 * Accepts absolute paths too: if the input is already absolute
 * we return it as-is (after resolution) without forcing it under
 * the base. This preserves compatibility with old DB rows that
 * might already hold absolute strings.
 */
function _safeJoin(base, relative) {
  if (typeof relative !== "string" || relative.length === 0) return null;
  // Reject NUL bytes and obvious traversal hints early.
  if (relative.includes("\u0000")) return null;

  if (path.isAbsolute(relative)) {
    // Return the absolute input UNCHANGED so legacy DB rows that
    // store an absolute string remain string-stable across
    // platforms (Windows: path.resolve("/tmp/x") -> "C:\tmp\x",
    // which breaks any caller that already handed us that string).
    return relative;
  }

  const joined = path.resolve(base, relative);
  const baseResolved = path.resolve(base);
  // joined must be === base or strictly under it. `startsWith` with
  // a trailing separator is the correct containment check — plain
  // `startsWith(baseResolved)` would accept "/data/media-foo" as
  // "inside /data/media".
  const sep = path.sep;
  if (joined !== baseResolved && !joined.startsWith(baseResolved + sep)) {
    return null;
  }
  return joined;
}

/**
 * Given a relative or absolute path, return the primary target
 * location for a WRITE. If MEDIA_ROOT is set, this is under it;
 * otherwise under the repo working dir. Throws on path-traversal.
 */
function writePath(relOrAbs) {
  const joined = _safeJoin(getWriteRoot(), relOrAbs);
  if (joined === null) {
    throw new Error(
      `media-paths: refused to write to illegal path "${relOrAbs}" (traversal or empty input)`,
    );
  }
  return joined;
}

/**
 * Build the list of candidate absolute paths in priority order:
 *   1. absolute as-given (if input is absolute) — returned
 *      UNCHANGED so a legacy DB row holding /tmp/foo.mp4 stays
 *      /tmp/foo.mp4 instead of being transformed by path.resolve
 *      (important on Windows where `/tmp/x` resolves to
 *      `C:\tmp\x` and breaks callers that passed the path to a
 *      stub fs keyed on the raw string).
 *   2. MEDIA_ROOT + input (if MEDIA_ROOT is set)
 *   3. REPO_ROOT + input (always the legacy fallback)
 *
 * Duplicates are collapsed so a config with MEDIA_ROOT === REPO_ROOT
 * (unusual but legal in dev) doesn't double-check the same file.
 */
function _resolutionCandidates(relOrAbs) {
  if (typeof relOrAbs !== "string" || !relOrAbs) return [];
  if (relOrAbs.includes("\u0000")) return [];

  const candidates = [];
  if (path.isAbsolute(relOrAbs)) {
    // Pass through without path.resolve so legacy absolute paths
    // stay string-stable across platforms.
    candidates.push(relOrAbs);
  }
  const mediaRoot = getMediaRoot();
  if (mediaRoot) {
    const m = _safeJoin(mediaRoot, relOrAbs);
    if (m !== null) candidates.push(m);
  }
  const r = _safeJoin(REPO_ROOT, relOrAbs);
  if (r !== null) candidates.push(r);

  // De-dup preserving order.
  const seen = new Set();
  const uniq = [];
  for (const c of candidates) {
    if (!seen.has(c)) {
      seen.add(c);
      uniq.push(c);
    }
  }
  return uniq;
}

/**
 * Return the first candidate that exists on disk. If none exist,
 * return the PREFERRED write path (so the caller can cleanly
 * detect absence via a later `fs.pathExists`). Async because the
 * whole point is existence-checking.
 *
 * If the input is path-traversal or illegal, returns null — caller
 * treats null as a hard error.
 */
async function resolveExisting(relOrAbs, opts = {}) {
  const fs = opts.fs || fsExtra;
  const candidates = _resolutionCandidates(relOrAbs);
  if (candidates.length === 0) return null;
  for (const c of candidates) {
    try {
      if (await fs.pathExists(c)) return c;
    } catch {
      /* ignore per-candidate errors, try the next */
    }
  }
  // None existed — fall back to the primary write path so the
  // caller's `pathExists(result) === false` is the clean signal.
  return candidates[0];
}

/**
 * Synchronous sibling for hot paths like the content-qa module's
 * existence check when it uses a stubbed-sync fs in tests. Uses
 * `existsSync` on each candidate. Returns the first that exists
 * or the preferred write path.
 */
function resolveExistingSync(relOrAbs, opts = {}) {
  const fs = opts.fs || fsExtra;
  const candidates = _resolutionCandidates(relOrAbs);
  if (candidates.length === 0) return null;
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* try next */
    }
  }
  return candidates[0];
}

/**
 * Convenience: existence check. Matches the common inline pattern
 * `await fs.pathExists(resolveExisting(p))` in one call.
 */
async function pathExists(relOrAbs, opts = {}) {
  const fs = opts.fs || fsExtra;
  const candidates = _resolutionCandidates(relOrAbs);
  for (const c of candidates) {
    try {
      if (await fs.pathExists(c)) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/**
 * Structured "media file must exist here" guard. Designed for
 * uploader call-sites that currently throw a bare ENOENT when
 * `fs.readFile(story.exported_path)` hits a wiped file — which
 * produces a cryptic Discord error containing only the stored
 * relative path.
 *
 * Behaviour:
 *   - If the file exists under ANY candidate (MEDIA_ROOT then
 *     REPO_ROOT), resolves to that absolute path.
 *   - If not, throws a structured Error whose `.message` includes
 *     BOTH the stored path (as-given) AND the full list of
 *     candidate paths we actually checked. That lets operators
 *     diagnose "was it MEDIA_ROOT, was it the old /app tree, was
 *     it both?" from the Discord line alone.
 *   - No secrets land in the message — the candidate paths are
 *     all filesystem paths, not tokens.
 *
 * The error object also carries `.storedPath` + `.attempted` so
 * callers that re-throw can preserve the structured fields.
 */
async function requireExistingMedia(relOrAbs, opts = {}) {
  const fs = opts.fs || fsExtra;
  const candidates = _resolutionCandidates(relOrAbs);
  if (candidates.length === 0) {
    const err = new Error(
      `Media path refused (empty / traversal / NUL): stored=${JSON.stringify(relOrAbs)}`,
    );
    err.storedPath = relOrAbs;
    err.attempted = [];
    throw err;
  }
  for (const c of candidates) {
    try {
      if (await fs.pathExists(c)) return c;
    } catch {
      /* try next */
    }
  }
  // None existed — throw a structured error with both stored +
  // attempted paths so Discord summaries can pinpoint the gap.
  const attempted = candidates.join(" | ");
  const err = new Error(
    `Media file not found: stored=${relOrAbs} attempted=[${attempted}]`,
  );
  err.storedPath = relOrAbs;
  err.attempted = candidates.slice();
  throw err;
}

module.exports = {
  REPO_ROOT,
  getMediaRoot,
  getWriteRoot,
  writePath,
  resolveExisting,
  resolveExistingSync,
  pathExists,
  requireExistingMedia,
  // Exported for tests only — lets them assert traversal rejection
  // without having to go through a writer that throws.
  _safeJoin,
  _resolutionCandidates,
};
