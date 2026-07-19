"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const SCHEMA_VERSION = 1;
const DEFAULT_TTL_HOURS = 12;
const TRACKING_QUERY_RE = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;
const LEGACY_EMPTY_SOURCE_FINGERPRINT = crypto
  .createHash("sha256")
  .update("fallback:|")
  .digest("hex");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueClean(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function storyId(story = {}) {
  return clean(story.id || story.story_id);
}

function canonicalSourceUrl(story = {}) {
  const raw = clean(
    story.primary_source_url ||
      story.article_url ||
      story.url ||
      story.source_url,
  );
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_QUERY_RE.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function buildSourceFingerprint(story = {}) {
  const sourceUrl = canonicalSourceUrl(story);
  const sourceName = clean(
    story.source_name || story.primary_source || story.subreddit,
  ).toLowerCase();
  const subject = clean(
    story.canonical_subject || story.canonical_game || story.title,
  ).toLowerCase();
  let identity = "";
  if (sourceUrl) {
    identity = `url:${sourceUrl}`;
  } else if (sourceName || subject) {
    identity = `fallback:${sourceName}|${subject}`;
  } else {
    const id = storyId(story).toLowerCase();
    if (!id) return "";
    identity = `story:${id}`;
  }
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function timestampMs(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normaliseDocument(document = null) {
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: clean(document?.generated_at) || null,
    entries: Array.isArray(document?.entries) ? document.entries : [],
  };
}

function pruneZeroYieldQuarantine(document = null, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  const source = normaliseDocument(document);
  const entries = source.entries
    .filter((entry) => {
      const expiresAtMs = timestampMs(entry?.expires_at);
      const fingerprint = clean(entry?.source_fingerprint);
      return (
        fingerprint &&
        fingerprint !== LEGACY_EMPTY_SOURCE_FINGERPRINT &&
        expiresAtMs > nowMs
      );
    })
    .map((entry) => ({
      source_fingerprint: clean(entry.source_fingerprint),
      story_ids: uniqueClean(entry.story_ids || []),
      source_name: clean(entry.source_name) || null,
      source_url: clean(entry.source_url) || null,
      first_failed_at: clean(entry.first_failed_at) || null,
      last_failed_at: clean(entry.last_failed_at) || null,
      expires_at: clean(entry.expires_at),
      failure_count: Math.max(1, Number(entry.failure_count || 1)),
    }))
    .sort((a, b) => a.source_fingerprint.localeCompare(b.source_fingerprint));
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date(now).toISOString(),
    entries,
  };
}

function recordZeroYieldCohort(document = null, {
  stories = [],
  now = new Date(),
  ttlHours = DEFAULT_TTL_HOURS,
} = {}) {
  const at = new Date(now);
  const ttlMs = Math.max(1, Number(ttlHours || DEFAULT_TTL_HOURS)) * 60 * 60 * 1000;
  const current = pruneZeroYieldQuarantine(document, { now: at });
  const byFingerprint = new Map(
    current.entries.map((entry) => [entry.source_fingerprint, { ...entry }]),
  );
  const cohort = new Map();
  for (const story of Array.isArray(stories) ? stories : []) {
    const sourceFingerprint = buildSourceFingerprint(story);
    if (!sourceFingerprint) continue;
    const row = cohort.get(sourceFingerprint) || {
      source_fingerprint: sourceFingerprint,
      story_ids: [],
      source_name: clean(story.source_name || story.primary_source || story.subreddit) || null,
      source_url: canonicalSourceUrl(story) || null,
    };
    row.story_ids = uniqueClean([...row.story_ids, storyId(story)]);
    cohort.set(sourceFingerprint, row);
  }
  for (const [sourceFingerprint, row] of cohort) {
    const previous = byFingerprint.get(sourceFingerprint);
    byFingerprint.set(sourceFingerprint, {
      source_fingerprint: sourceFingerprint,
      story_ids: uniqueClean([
        ...(previous?.story_ids || []),
        ...row.story_ids,
      ]),
      source_name: row.source_name || previous?.source_name || null,
      source_url: row.source_url || previous?.source_url || null,
      first_failed_at: previous?.first_failed_at || at.toISOString(),
      last_failed_at: at.toISOString(),
      expires_at: new Date(at.getTime() + ttlMs).toISOString(),
      failure_count: Math.max(0, Number(previous?.failure_count || 0)) + 1,
    });
  }
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: at.toISOString(),
    entries: [...byFingerprint.values()].sort((a, b) =>
      a.source_fingerprint.localeCompare(b.source_fingerprint)),
  };
}

function buildZeroYieldExclusions(document = null, { now = new Date() } = {}) {
  const active = pruneZeroYieldQuarantine(document, { now });
  return {
    story_ids: uniqueClean(active.entries.flatMap((entry) => entry.story_ids || [])),
    source_fingerprints: uniqueClean(
      active.entries.map((entry) => entry.source_fingerprint),
    ),
    rss_offset_per_feed: 0,
    active_entry_count: active.entries.length,
  };
}

async function readZeroYieldQuarantine(filePath, { now = new Date() } = {}) {
  const resolved = path.resolve(filePath || "");
  if (!filePath || !(await fs.pathExists(resolved))) {
    return pruneZeroYieldQuarantine(null, { now });
  }
  return pruneZeroYieldQuarantine(await fs.readJson(resolved), { now });
}

async function writeZeroYieldQuarantine(filePath, document) {
  const resolved = path.resolve(filePath || "");
  if (!filePath) throw new Error("zero_yield_quarantine_path_missing");
  await fs.ensureDir(path.dirname(resolved));
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeJson(temporary, normaliseDocument(document), { spaces: 2 });
  await fs.move(temporary, resolved, { overwrite: true });
  return resolved;
}

module.exports = {
  DEFAULT_TTL_HOURS,
  buildSourceFingerprint,
  buildZeroYieldExclusions,
  canonicalSourceUrl,
  pruneZeroYieldQuarantine,
  readZeroYieldQuarantine,
  recordZeroYieldCohort,
  writeZeroYieldQuarantine,
};
