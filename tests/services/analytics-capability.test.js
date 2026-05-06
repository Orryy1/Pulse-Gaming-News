"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  inspectYouTubeTokenShape,
  buildAnalyticsCapabilityReport,
  renderAnalyticsCapabilityMarkdown,
} = require("../../lib/intelligence/analytics-capability");

test("inspectYouTubeTokenShape: reports granted analytics scope without leaking token values", () => {
  const status = inspectYouTubeTokenShape({
    access_token: "secret-access-token",
    refresh_token: "secret-refresh-token",
    expiry_date: Date.now() + 3600_000,
    scope:
      "https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/yt-analytics.readonly",
  });

  assert.equal(status.exists, true);
  assert.equal(status.has_access_token, true);
  assert.equal(status.has_refresh_token, true);
  assert.equal(status.expiry_status, "fresh");
  assert.equal(status.yt_analytics_scope, "granted");
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("inspectYouTubeTokenShape: distinguishes missing and unknown analytics scope", () => {
  assert.equal(
    inspectYouTubeTokenShape({
      access_token: "x",
      scope: "https://www.googleapis.com/auth/youtube",
    }).yt_analytics_scope,
    "missing",
  );
  assert.equal(
    inspectYouTubeTokenShape({ access_token: "x" }).yt_analytics_scope,
    "unknown",
  );
});

test("buildAnalyticsCapabilityReport: shallow live counters are not sold as deep learning", () => {
  const report = buildAnalyticsCapabilityReport({
    env: {
      YOUTUBE_API_KEY: "set",
      INTELLIGENCE_ANALYTICS_MODE: "fixture",
      INTELLIGENCE_REAL_MODE: "false",
    },
    tokenStatus: {
      exists: true,
      has_refresh_token: true,
      yt_analytics_scope: "missing",
    },
    dbSignals: {
      platform_metric_rows: 23,
      rich_retention_rows: 0,
      video_performance_rows: 0,
    },
    uploadScopeRequested: true,
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.capabilities.public_youtube_counters.status, "active");
  assert.equal(
    report.capabilities.detailed_youtube_analytics.status,
    "requires_youtube_scope_reauth",
  );
  assert.equal(report.capabilities.scheduled_learning_loop.mode, "public_counts_only");
  assert.match(report.plain_english_summary, /not yet a true Creator Studio analytics loop/i);
});

test("buildAnalyticsCapabilityReport: real mode with granted scope is still honest about data depth", () => {
  const report = buildAnalyticsCapabilityReport({
    env: {
      YOUTUBE_API_KEY: "set",
      INTELLIGENCE_ANALYTICS_MODE: "real",
      INTELLIGENCE_REAL_MODE: "true",
    },
    tokenStatus: {
      exists: true,
      has_refresh_token: true,
      yt_analytics_scope: "granted",
    },
    dbSignals: {
      platform_metric_rows: 40,
      rich_retention_rows: 12,
      video_performance_rows: 12,
    },
    uploadScopeRequested: true,
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.capabilities.detailed_youtube_analytics.status, "ready");
  assert.equal(report.capabilities.learning_dataset.status, "rich_signals_present");
});

test("renderAnalyticsCapabilityMarkdown: gives the operator concrete next steps", () => {
  const report = buildAnalyticsCapabilityReport({
    env: {},
    tokenStatus: { exists: false, yt_analytics_scope: "unknown" },
    dbSignals: {},
    uploadScopeRequested: false,
  });
  const md = renderAnalyticsCapabilityMarkdown(report);
  assert.match(md, /# Pulse Analytics Capability Doctor/);
  assert.match(md, /Verdict:/);
  assert.match(md, /Next actions/);
  assert.equal(md.includes("access_token"), false);
});
