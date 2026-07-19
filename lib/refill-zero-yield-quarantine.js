"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const SCHEMA_VERSION = 1;
const DEFAULT_TTL_HOURS = 12;
const TRACKING_QUERY_RE = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;
const CANONICAL_RSS_STORY_ID_RE = /^rss_[a-f0-9]{16}$/i;
const NON_PRODUCTION_STORY_ID_RE =
  /(?:^|[_-])(?:fixture|synthetic|test|premium[_-]?eval|reference[_-]?only)(?:$|[_-])/i;
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

function quarantineEligibleStoryId(value) {
  const id = clean(value);
  if (!id || NON_PRODUCTION_STORY_ID_RE.test(id)) return false;
  if (/^rss_/i.test(id)) return CANONICAL_RSS_STORY_ID_RE.test(id);
  if (/^fresh_plan_story$/i.test(id)) return false;
  if (/-story$/i.test(id) && !/_(?:19|20)\d{6}$/i.test(id)) return false;
  return true;
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

function resolveZeroYieldQuarantinePath({
  root = process.cwd(),
  explicitPath = "",
  nodeTestContext = process.env.NODE_TEST_CONTEXT,
  processId = process.pid,
} = {}) {
  const resolvedRoot = path.resolve(root || process.cwd());
  const requestedPath = clean(explicitPath);
  if (requestedPath) {
    return path.isAbsolute(requestedPath)
      ? path.normalize(requestedPath)
      : path.resolve(resolvedRoot, requestedPath);
  }
  const testWorker = Boolean(clean(nodeTestContext));
  const pid = Math.max(1, Math.floor(Number(processId || process.pid) || process.pid));
  return path.resolve(
    resolvedRoot,
    testWorker
      ? path.join(
          "test",
          "output",
          "runtime",
          `refill-zero-yield-quarantine-${pid}.json`,
        )
      : path.join(
          "output",
          "runtime",
          "refill-zero-yield-quarantine.json",
        ),
  );
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
    .map((entry) => {
      const sourceName = clean(entry.source_name) || null;
      const sourceUrl = clean(entry.source_url) || null;
      const hasSourceIdentity = Boolean(sourceName || sourceUrl);
      return {
        source_fingerprint: clean(entry.source_fingerprint),
        story_ids: uniqueClean(entry.story_ids || []).filter(
          (id) => quarantineEligibleStoryId(id) || hasSourceIdentity,
        ),
        source_name: sourceName,
        source_url: sourceUrl,
        first_failed_at: clean(entry.first_failed_at) || null,
        last_failed_at: clean(entry.last_failed_at) || null,
        expires_at: clean(entry.expires_at),
        failure_count: Math.max(1, Number(entry.failure_count || 1)),
      };
    })
    .filter(
      (entry) =>
        entry.story_ids.length > 0 ||
        Boolean(entry.source_url) ||
        Boolean(entry.source_name),
    )
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
    const id = storyId(story);
    const sourceUrl = canonicalSourceUrl(story);
    const sourceName =
      clean(story.source_name || story.primary_source || story.subreddit) ||
      null;
    if (!quarantineEligibleStoryId(id) && !sourceUrl && !sourceName) continue;
    const sourceFingerprint = buildSourceFingerprint(story);
    if (!sourceFingerprint) continue;
    const row = cohort.get(sourceFingerprint) || {
      source_fingerprint: sourceFingerprint,
      story_ids: [],
      source_name: sourceName,
      source_url: sourceUrl || null,
    };
    row.story_ids = uniqueClean([
      ...row.story_ids,
      ...(quarantineEligibleStoryId(id) || sourceUrl || sourceName ? [id] : []),
    ]);
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
  quarantineEligibleStoryId,
  pruneZeroYieldQuarantine,
  readZeroYieldQuarantine,
  recordZeroYieldCohort,
  resolveZeroYieldQuarantinePath,
  writeZeroYieldQuarantine,
};
