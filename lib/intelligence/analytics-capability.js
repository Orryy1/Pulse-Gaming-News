"use strict";

const REQUIRED_YT_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";

function envIsSet(value) {
  return typeof value === "string" && value.trim() && value !== "placeholder";
}

function inspectYouTubeTokenShape(token, now = Date.now()) {
  if (!token || typeof token !== "object") {
    return {
      exists: false,
      has_access_token: false,
      has_refresh_token: false,
      expiry_status: "missing",
      yt_analytics_scope: "unknown",
    };
  }

  let expiryStatus = "unknown";
  const expiry = Number(token.expiry_date);
  if (Number.isFinite(expiry)) {
    expiryStatus = expiry <= now ? "expired" : "fresh";
  }

  let scopeStatus = "unknown";
  if (typeof token.scope === "string" && token.scope.trim()) {
    const scopes = token.scope.split(/\s+/);
    scopeStatus = scopes.includes(REQUIRED_YT_ANALYTICS_SCOPE)
      ? "granted"
      : "missing";
  }

  return {
    exists: true,
    has_access_token: typeof token.access_token === "string" && !!token.access_token,
    has_refresh_token:
      typeof token.refresh_token === "string" && !!token.refresh_token,
    expiry_status: expiryStatus,
    yt_analytics_scope: scopeStatus,
  };
}

function buildAnalyticsCapabilityReport({
  env = process.env,
  tokenStatus = {},
  dbSignals = {},
  uploadScopeRequested = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const publicCountersActive = envIsSet(env.YOUTUBE_API_KEY);
  const realMode =
    String(env.INTELLIGENCE_ANALYTICS_MODE || "").toLowerCase() === "real" &&
    String(env.INTELLIGENCE_REAL_MODE || "").toLowerCase() === "true";
  const scope = tokenStatus.yt_analytics_scope || "unknown";

  let detailedStatus = "blocked";
  if (scope === "granted" && realMode) detailedStatus = "ready";
  else if (scope === "granted") detailedStatus = "real_mode_disabled";
  else if (scope === "missing") detailedStatus = "requires_youtube_scope_reauth";
  else if (tokenStatus.exists) detailedStatus = "scope_unknown";
  else detailedStatus = "youtube_token_missing";

  const richRows =
    Number(dbSignals.rich_retention_rows || 0) +
    Number(dbSignals.video_performance_rows || 0);
  const learningDatasetStatus =
    richRows > 0
      ? "rich_signals_present"
      : Number(dbSignals.platform_metric_rows || 0) > 0
        ? "public_counter_history_only"
        : "no_snapshot_history";

  let verdict = "AMBER";
  if (!publicCountersActive && !tokenStatus.exists) verdict = "RED";
  if (detailedStatus === "ready" && learningDatasetStatus === "rich_signals_present") {
    verdict = "GREEN";
  }

  const nextActions = [];
  if (!uploadScopeRequested) {
    nextActions.push(
      "Add yt-analytics.readonly to the YouTube auth scope list before any future re-auth.",
    );
  }
  if (detailedStatus === "requires_youtube_scope_reauth") {
    nextActions.push(
      "Run a YouTube OAuth re-auth when you are ready so the token grants Creator Studio analytics read access.",
    );
  } else if (detailedStatus === "scope_unknown") {
    nextActions.push(
      "Confirm the current YouTube token scopes with a read-only tokeninfo check or re-auth with the expanded scope.",
    );
  } else if (detailedStatus === "real_mode_disabled") {
    nextActions.push(
      "Set INTELLIGENCE_ANALYTICS_MODE=real and INTELLIGENCE_REAL_MODE=true only after confirming the token scope.",
    );
  } else if (detailedStatus === "ready" && learningDatasetStatus !== "rich_signals_present") {
    nextActions.push(
      "Run a read-only YouTube Analytics ingestion pass to populate retention, watch time and subscribers gained.",
    );
  }
  if (!publicCountersActive) {
    nextActions.push(
      "Set a valid YOUTUBE_API_KEY if you want public view, like and comment counters to keep updating.",
    );
  }
  if (!nextActions.length) {
    nextActions.push(
      "Keep collecting snapshots and use recommendations as review signals, not automatic scoring changes.",
    );
  }

  const plain =
    detailedStatus === "ready" && learningDatasetStatus === "rich_signals_present"
      ? "Pulse has the pieces for a real Creator Studio analytics loop: public counters plus detailed retention/watch-time rows are present."
      : "Pulse is not yet a true Creator Studio analytics loop. It is mainly using public counters and local/fixture learning until YouTube Analytics scope and rich snapshot ingestion are active.";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    verdict,
    plain_english_summary: plain,
    capabilities: {
      public_youtube_counters: {
        status: publicCountersActive ? "active" : "missing_api_key",
        source: "YouTube Data API videos.list statistics",
        metrics: ["views", "likes", "comments"],
      },
      detailed_youtube_analytics: {
        status: detailedStatus,
        scope_requested_in_auth_url: !!uploadScopeRequested,
        token_scope_status: scope,
        real_mode_enabled: realMode,
        source: "YouTube Analytics reports.query",
        target_metrics: [
          "estimatedMinutesWatched",
          "averageViewDuration",
          "averageViewPercentage",
          "subscribersGained",
          "trafficSource",
        ],
      },
      scheduled_learning_loop: {
        mode: "public_counts_only",
        note:
          "The scheduled analytics pass writes views, likes and comments. Detailed YouTube Analytics ingestion remains operator-gated.",
      },
      learning_dataset: {
        status: learningDatasetStatus,
        platform_metric_rows: Number(dbSignals.platform_metric_rows || 0),
        rich_retention_rows: Number(dbSignals.rich_retention_rows || 0),
        video_performance_rows: Number(dbSignals.video_performance_rows || 0),
      },
    },
    safety: {
      oauth_triggered: false,
      token_values_printed: false,
      production_db_mutated: false,
      scoring_weights_changed: false,
      auto_learning_enabled: false,
    },
    next_actions: nextActions,
  };
}

function renderAnalyticsCapabilityMarkdown(report) {
  const lines = [];
  lines.push("# Pulse Analytics Capability Doctor");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push("");
  lines.push("## Plain English");
  lines.push(report.plain_english_summary);
  lines.push("");
  lines.push("## Current Capabilities");
  lines.push(
    `- Public YouTube counters: ${report.capabilities.public_youtube_counters.status}`,
  );
  lines.push(
    `- Detailed YouTube Analytics: ${report.capabilities.detailed_youtube_analytics.status}`,
  );
  lines.push(
    `- Scheduled learning loop: ${report.capabilities.scheduled_learning_loop.mode}`,
  );
  lines.push(
    `- Learning dataset: ${report.capabilities.learning_dataset.status}`,
  );
  lines.push("");
  lines.push("## Data Depth");
  lines.push(
    `- Platform metric rows: ${report.capabilities.learning_dataset.platform_metric_rows}`,
  );
  lines.push(
    `- Rich retention rows: ${report.capabilities.learning_dataset.rich_retention_rows}`,
  );
  lines.push(
    `- Video performance rows: ${report.capabilities.learning_dataset.video_performance_rows}`,
  );
  lines.push("");
  lines.push("## Safety");
  lines.push("- No OAuth was triggered.");
  lines.push("- No token values were printed.");
  lines.push("- No production DB rows were mutated.");
  lines.push("- No scoring weights were changed.");
  lines.push("");
  lines.push("## Next actions");
  for (const action of report.next_actions) {
    lines.push(`- ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  REQUIRED_YT_ANALYTICS_SCOPE,
  inspectYouTubeTokenShape,
  buildAnalyticsCapabilityReport,
  renderAnalyticsCapabilityMarkdown,
};
