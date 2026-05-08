"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..", "..");

const FIXTURE_MONETISATION_STATE = {
  subscribers: 320,
  shorts_views_90d: 28_000,
  longform_watch_hours_12m: 4,
  valid_public_uploads_90d: 1,
  amazon_affiliate_tag: "pulsegaming-21",
  beehiiv_subscribers: 12,
  substack_subscribers: 0,
  indexed_pages: 5,
  blog_monthly_pageviews: 230,
  avd_seconds_shorts: 23,
  average_view_duration_seconds: 23,
  average_view_percentage: 42,
  comments_per_view: 0.002,
  tiktok_followers: 0,
  tiktok_views_30d: 0,
  tiktok_account_type: "unknown",
  tiktok_eligible_region: false,
  tiktok_good_standing: false,
  tiktok_payment_tax_setup: false,
  tiktok_original_content_ready: false,
  tiktok_has_eligible_60s_video: false,
};

const NUMERIC_FIELDS = [
  "subscribers",
  "shorts_views_90d",
  "longform_watch_hours_12m",
  "valid_public_uploads_90d",
  "beehiiv_subscribers",
  "substack_subscribers",
  "indexed_pages",
  "blog_monthly_pageviews",
  "avd_seconds_shorts",
  "average_view_duration_seconds",
  "average_view_percentage",
  "comments_per_view",
  "tiktok_followers",
  "tiktok_views_30d",
  "tiktok_latest_video_duration_seconds",
];

const BOOLEAN_FIELDS = [
  "tiktok_eligible_region",
  "tiktok_good_standing",
  "tiktok_payment_tax_setup",
  "tiktok_original_content_ready",
  "tiktok_has_eligible_60s_video",
  "tiktok_personal_account",
];

const STRING_FIELDS = ["amazon_affiliate_tag", "tiktok_account_type"];

const ENV_FIELD_MAP = {
  subscribers: ["PULSE_YOUTUBE_SUBSCRIBERS", "YOUTUBE_SUBSCRIBERS"],
  shorts_views_90d: ["PULSE_SHORTS_VIEWS_90D", "YOUTUBE_SHORTS_VIEWS_90D"],
  longform_watch_hours_12m: [
    "PULSE_LONGFORM_WATCH_HOURS_12M",
    "YOUTUBE_LONGFORM_WATCH_HOURS_12M",
  ],
  valid_public_uploads_90d: ["PULSE_VALID_PUBLIC_UPLOADS_90D"],
  beehiiv_subscribers: ["PULSE_BEEHIIV_SUBSCRIBERS", "BEEHIIV_SUBSCRIBERS"],
  substack_subscribers: ["PULSE_SUBSTACK_SUBSCRIBERS", "SUBSTACK_SUBSCRIBERS"],
  indexed_pages: ["PULSE_BLOG_INDEXED_PAGES", "BLOG_INDEXED_PAGES"],
  blog_monthly_pageviews: ["PULSE_BLOG_MONTHLY_PAGEVIEWS", "BLOG_MONTHLY_PAGEVIEWS"],
  avd_seconds_shorts: ["PULSE_SHORTS_AVD_SECONDS", "YOUTUBE_SHORTS_AVD_SECONDS"],
  average_view_duration_seconds: [
    "PULSE_AVERAGE_VIEW_DURATION_SECONDS",
    "YOUTUBE_AVERAGE_VIEW_DURATION_SECONDS",
  ],
  average_view_percentage: [
    "PULSE_AVERAGE_VIEW_PERCENTAGE",
    "YOUTUBE_AVERAGE_VIEW_PERCENTAGE",
  ],
  comments_per_view: ["PULSE_COMMENTS_PER_VIEW", "YOUTUBE_COMMENTS_PER_VIEW"],
  tiktok_followers: ["PULSE_TIKTOK_FOLLOWERS", "TIKTOK_FOLLOWERS"],
  tiktok_views_30d: ["PULSE_TIKTOK_VIEWS_30D", "TIKTOK_VIEWS_30D"],
  tiktok_latest_video_duration_seconds: [
    "PULSE_TIKTOK_LATEST_VIDEO_DURATION_SECONDS",
    "TIKTOK_LATEST_VIDEO_DURATION_SECONDS",
  ],
  tiktok_account_type: ["PULSE_TIKTOK_ACCOUNT_TYPE", "TIKTOK_ACCOUNT_TYPE"],
  tiktok_eligible_region: ["PULSE_TIKTOK_ELIGIBLE_REGION", "TIKTOK_ELIGIBLE_REGION"],
  tiktok_good_standing: ["PULSE_TIKTOK_GOOD_STANDING", "TIKTOK_GOOD_STANDING"],
  tiktok_payment_tax_setup: [
    "PULSE_TIKTOK_PAYMENT_TAX_SETUP",
    "TIKTOK_PAYMENT_TAX_SETUP",
  ],
  tiktok_original_content_ready: [
    "PULSE_TIKTOK_ORIGINAL_CONTENT_READY",
    "TIKTOK_ORIGINAL_CONTENT_READY",
  ],
  tiktok_has_eligible_60s_video: [
    "PULSE_TIKTOK_HAS_ELIGIBLE_60S_VIDEO",
    "TIKTOK_HAS_ELIGIBLE_60S_VIDEO",
  ],
  amazon_affiliate_tag: ["AMAZON_AFFILIATE_TAG"],
};

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function numberOrZero(value) {
  if (!isPresent(value)) return 0;
  const cleaned = String(value).replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on", "personal"].includes(text);
}

function publicFieldValue(key, value) {
  if (key === "amazon_affiliate_tag" && isPresent(value)) {
    const text = String(value);
    return `${text.slice(0, 4)}...${text.slice(-2)}`;
  }
  return value;
}

function normaliseMonetisationState(raw = {}, options = {}) {
  const source = options.source || "unknown";
  const fieldSources = options.fieldSources || {};
  const warnings = [...(options.warnings || [])];
  const state = {};
  const fields = {};

  for (const key of NUMERIC_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(raw, key) && isPresent(raw[key]);
    state[key] = numberOrZero(raw[key]);
    fields[key] = {
      source: present ? fieldSources[key] || source : "missing_default_zero",
      present,
      public_value: present ? state[key] : 0,
    };
    if (!present && options.warnMissing !== false) warnings.push(`missing:${key}`);
  }

  for (const key of BOOLEAN_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(raw, key) && isPresent(raw[key]);
    state[key] = present ? booleanValue(raw[key]) : false;
    fields[key] = {
      source: present ? fieldSources[key] || source : "missing_default_false",
      present,
      public_value: state[key],
    };
  }

  for (const key of STRING_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(raw, key) && isPresent(raw[key]);
    state[key] = present ? String(raw[key]).trim() : "";
    fields[key] = {
      source: present ? fieldSources[key] || source : "missing_default_empty",
      present,
      public_value: publicFieldValue(key, state[key]),
    };
  }

  if (!state.tiktok_personal_account && state.tiktok_account_type.toLowerCase() === "personal") {
    state.tiktok_personal_account = true;
    fields.tiktok_personal_account = {
      source: fields.tiktok_account_type.source,
      present: true,
      public_value: true,
    };
  }

  return {
    state,
    provenance: {
      mode: options.mode || source,
      source,
      generated_at: options.generatedAt || new Date().toISOString(),
      fields,
      warnings: [...new Set(warnings)].sort(),
    },
  };
}

function firstEnvValue(env, names) {
  for (const name of names) {
    if (isPresent(env[name])) return { name, value: env[name] };
  }
  return null;
}

function collectEnvMonetisationState(env = process.env) {
  const raw = {};
  const fieldSources = {};
  for (const [field, names] of Object.entries(ENV_FIELD_MAP)) {
    const hit = firstEnvValue(env, names);
    if (!hit) continue;
    raw[field] = hit.value;
    fieldSources[field] = `env:${hit.name}`;
  }
  return { raw, fieldSources };
}

function defaultDbPath(env = process.env) {
  const configured = String(env.SQLITE_DB_PATH || "").trim();
  if (!configured) return path.join(ROOT, "data", "pulse.db");
  return path.isAbsolute(configured) ? configured : path.resolve(ROOT, configured);
}

function getOptional(db, sql, params = []) {
  try {
    return { row: db.prepare(sql).get(...params) || null };
  } catch (err) {
    return { row: null, warning: err.message };
  }
}

function collectLocalDbMonetisationSignals({ dbPath = defaultDbPath(), now = new Date() } = {}) {
  const values = {};
  const fieldSources = {};
  const warnings = [];
  if (!dbPath || !fs.existsSync(dbPath)) {
    return {
      values,
      fieldSources,
      warnings: ["local_db_missing"],
    };
  }

  let db;
  try {
    const Database = require("better-sqlite3");
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const recentUploads = getOptional(
      db,
      `SELECT
         COUNT(*) AS uploads,
         COALESCE(SUM(COALESCE(youtube_views, 0)), 0) AS views,
         COALESCE(SUM(COALESCE(youtube_comments, 0)), 0) AS comments
       FROM stories
       WHERE youtube_post_id IS NOT NULL
         AND youtube_post_id != ''
         AND youtube_post_id NOT LIKE 'DUPE_%'
         AND datetime(COALESCE(youtube_published_at, published_at, created_at, timestamp)) >= datetime(?)`,
      [cutoff90],
    );
    if (recentUploads.row) {
      values.valid_public_uploads_90d = Number(recentUploads.row.uploads || 0);
      values.shorts_views_90d = Number(recentUploads.row.views || 0);
      const comments = Number(recentUploads.row.comments || 0);
      values.comments_per_view =
        values.shorts_views_90d > 0 ? comments / values.shorts_views_90d : 0;
      fieldSources.valid_public_uploads_90d = "local_db:stories.youtube_posts_90d";
      fieldSources.shorts_views_90d = "local_db:stories.youtube_views_90d";
      fieldSources.comments_per_view = "local_db:stories.youtube_comments_per_view";
    } else if (recentUploads.warning) {
      warnings.push(`db_recent_uploads:${recentUploads.warning}`);
    }

    const perf = getOptional(
      db,
      `SELECT
         AVG(average_view_duration_seconds) AS avd,
         AVG(average_percentage_viewed) AS avp
       FROM video_performance_snapshots
       WHERE datetime(snapshot_at) >= datetime(?)
         AND (average_view_duration_seconds IS NOT NULL
              OR average_percentage_viewed IS NOT NULL)`,
      [cutoff90],
    );
    if (perf.row) {
      if (perf.row.avd !== null && perf.row.avd !== undefined) {
        values.average_view_duration_seconds = Number(perf.row.avd || 0);
        values.avd_seconds_shorts = Number(perf.row.avd || 0);
        fieldSources.average_view_duration_seconds =
          "local_db:video_performance_snapshots.avg_avd_90d";
        fieldSources.avd_seconds_shorts =
          "local_db:video_performance_snapshots.avg_avd_90d";
      }
      if (perf.row.avp !== null && perf.row.avp !== undefined) {
        values.average_view_percentage = Number(perf.row.avp || 0);
        fieldSources.average_view_percentage =
          "local_db:video_performance_snapshots.avg_avp_90d";
      }
    } else if (perf.warning) {
      warnings.push(`db_performance_snapshots:${perf.warning}`);
    }
  } catch (err) {
    warnings.push(`db_open:${err.message}`);
  } finally {
    if (db) db.close();
  }

  return { values, fieldSources, warnings };
}

function mergeMissing(target, sources, patch, patchSources) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (!isPresent(target[key])) {
      target[key] = value;
      sources[key] = patchSources?.[key] || "local";
    }
  }
}

async function readJsonState(filePath) {
  const raw = await fs.readJson(filePath);
  return raw && raw.state && typeof raw.state === "object" ? raw.state : raw;
}

async function readMonetisationState(options = {}) {
  const mode = options.mode || "fixture";
  const generatedAt = options.generatedAt || new Date().toISOString();

  if (mode === "fixture") {
    return normaliseMonetisationState(FIXTURE_MONETISATION_STATE, {
      source: "fixture",
      mode,
      generatedAt,
      fieldSources: Object.fromEntries(
        Object.keys(FIXTURE_MONETISATION_STATE).map((key) => [key, "fixture"]),
      ),
      warnMissing: false,
    });
  }

  if (mode === "file") {
    const filePath = path.resolve(options.statePath || "");
    const raw = await readJsonState(filePath);
    return normaliseMonetisationState(raw, {
      source: `file:${filePath}`,
      mode,
      generatedAt,
      warnMissing: true,
    });
  }

  if (mode === "local") {
    const envState = collectEnvMonetisationState(options.env || process.env);
    const raw = { ...envState.raw };
    const fieldSources = { ...envState.fieldSources };
    const dbSignals = collectLocalDbMonetisationSignals({
      dbPath: options.dbPath || defaultDbPath(options.env || process.env),
      now: options.now || new Date(),
    });
    mergeMissing(raw, fieldSources, dbSignals.values, dbSignals.fieldSources);
    return normaliseMonetisationState(raw, {
      source: "local_readonly",
      mode,
      generatedAt,
      fieldSources,
      warnings: dbSignals.warnings,
      warnMissing: true,
    });
  }

  throw new Error(`Unknown monetisation state mode: ${mode}`);
}

module.exports = {
  FIXTURE_MONETISATION_STATE,
  NUMERIC_FIELDS,
  BOOLEAN_FIELDS,
  STRING_FIELDS,
  ENV_FIELD_MAP,
  booleanValue,
  collectEnvMonetisationState,
  collectLocalDbMonetisationSignals,
  defaultDbPath,
  normaliseMonetisationState,
  readMonetisationState,
};
