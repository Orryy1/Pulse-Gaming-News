"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildAnalyticsCapabilityReport,
  inspectYouTubeTokenShape,
} = require("./analytics-capability");
const {
  buildYouTubeAnalyticsIngestionPacket,
} = require("./youtube-analytics-ingestion-packet");
const {
  buildRetentionIntelligence,
  renderRetentionIntelligenceMarkdown,
} = require("./retention-intelligence");
const { buildAnalyticsClient } = require("./analytics-client");
const { runLiveAnalystPass } = require("./live-performance-analyst");
const { recordSnapshot } = require("../repositories/platform_metric_snapshots");

function cleanEnvValue(value) {
  const text = String(value || "").trim();
  return text && text !== "placeholder" ? text : "";
}

function resolvePathMaybe(value, cwd) {
  const clean = cleanEnvValue(value);
  if (!clean) return null;
  return path.isAbsolute(clean) ? clean : path.resolve(cwd, clean);
}

function resolveLearningPaths({
  env = process.env,
  cwd = process.cwd(),
  resolveDbPath,
} = {}) {
  const dbPath =
    typeof resolveDbPath === "function"
      ? resolveDbPath()
      : require("../db").resolveDbPath();
  const root =
    resolvePathMaybe(env.PULSE_LEARNING_DIR, cwd) ||
    path.join(path.dirname(dbPath), "learning");
  const retentionDir =
    resolvePathMaybe(env.PULSE_RETENTION_INTELLIGENCE_DIR, cwd) ||
    path.join(root, "retention-intelligence");
  return {
    root,
    reportsDir: path.join(root, "reports"),
    retentionDir,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function publishedTimestamp(story = {}) {
  const value =
    story.youtube_published_at ||
    story.published_at ||
    story.publish_at ||
    story.timestamp ||
    story.created_at ||
    "";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function selectPublishedVideoTargets(
  stories = [],
  { now = Date.now(), maxAgeDays = 45, limit = 12 } = {},
) {
  const since = Number(now) - Number(maxAgeDays || 45) * 86400000;
  return asArray(stories)
    .filter((story) => story && story.id && story.youtube_post_id)
    .filter((story) => !String(story.youtube_post_id).startsWith("DUPE_"))
    .map((story) => {
      const publishedMs = publishedTimestamp(story);
      return {
        story_id: story.id,
        video_id: String(story.youtube_post_id),
        title: story.title || "(untitled)",
        published_at: publishedMs
          ? new Date(publishedMs).toISOString()
          : story.youtube_published_at || story.published_at || null,
        published_ms: publishedMs,
        durationS: Number(story.duration_seconds || story.runtime_seconds || 60),
        story,
      };
    })
    .filter((target) => !target.published_ms || target.published_ms >= since)
    .sort((a, b) => b.published_ms - a.published_ms)
    .slice(0, Math.max(1, Number(limit) || 12));
}

function realModeEnabled(env = process.env) {
  return (
    String(env.INTELLIGENCE_ANALYTICS_MODE || "").toLowerCase() === "real" &&
    String(env.INTELLIGENCE_REAL_MODE || "").toLowerCase() === "true"
  );
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentForSnapshot(value) {
  const n = numberOrNull(value);
  if (n === null) return null;
  return Math.abs(n) <= 1 ? Number((n * 100).toFixed(4)) : n;
}

function trafficSummaryForSnapshot(rows = []) {
  const safeRows = asArray(rows);
  if (!safeRows.length) {
    return {
      views: null,
      watch_time_seconds: null,
      retention_percent: null,
    };
  }
  let viewTotal = 0;
  let watchSeconds = 0;
  let pctWeighted = 0;
  let pctWeight = 0;

  for (const row of safeRows) {
    const views = numberOrNull(row.views) || 0;
    const estimatedMinutes = numberOrNull(row.estimated_minutes_watched);
    const avgDuration = numberOrNull(row.average_view_duration_seconds);
    const pct = percentForSnapshot(row.average_percentage_viewed);
    viewTotal += views;
    if (estimatedMinutes !== null) watchSeconds += estimatedMinutes * 60;
    else if (avgDuration !== null && views > 0) watchSeconds += avgDuration * views;
    if (pct !== null) {
      const weight = views || 1;
      pctWeighted += pct * weight;
      pctWeight += weight;
    }
  }

  return {
    views: viewTotal || null,
    watch_time_seconds: watchSeconds ? Number(watchSeconds.toFixed(3)) : null,
    retention_percent: pctWeight
      ? Number((pctWeighted / pctWeight).toFixed(4))
      : null,
  };
}

function buildCreatorStudioMetricSnapshotRows({
  targets = [],
  retentionInputsByVideo = new Map(),
  generatedAt = new Date().toISOString(),
} = {}) {
  const rows = [];
  for (const target of asArray(targets)) {
    const input =
      retentionInputsByVideo instanceof Map
        ? retentionInputsByVideo.get(target.video_id)
        : retentionInputsByVideo[target.video_id];
    if (!input || input.error) continue;
    const traffic = trafficSummaryForSnapshot(input.trafficRows || []);
    rows.push({
      story_id: target.story_id,
      platform: "youtube",
      external_id: target.video_id,
      snapshot_at: generatedAt,
      channel_id: target.story?.channel_id || "pulse-gaming",
      views: traffic.views,
      likes: null,
      comments: null,
      shares: null,
      watch_time_seconds: traffic.watch_time_seconds,
      retention_percent: traffic.retention_percent,
      raw_json: {
        source: "youtube_analytics_reports.query",
        video_id: target.video_id,
        retention_rows: asArray(input.retentionRows).length,
        traffic_rows: asArray(input.trafficRows).length,
        fixture: input.fixture === true,
      },
    });
  }
  return rows;
}

function persistCreatorStudioMetricSnapshots({ repos, rows = [] } = {}) {
  if (!repos || !repos.db || !asArray(rows).length) {
    return { persisted: 0, skipped: repos && repos.db ? null : "no_repos" };
  }
  let persisted = 0;
  for (const row of rows) {
    recordSnapshot(repos.db, row);
    persisted++;
  }
  return { persisted, skipped: null };
}

function buildContinuousLearningSummary({
  generatedAt = new Date().toISOString(),
  targets = [],
  tokenStatus = {},
  env = process.env,
  capabilityReport = null,
  ingestionPacket = null,
  liveSummary = null,
  retentionOutputs = [],
  snapshotRowsPersisted = 0,
  extraBlockers = [],
  paths = null,
} = {}) {
  const targetCount = asArray(targets).length;
  const retentionCount = asArray(retentionOutputs).length;
  const scope = tokenStatus.yt_analytics_scope || "unknown";
  const realMode = realModeEnabled(env);
  const liveEnabled = !!liveSummary?.enabled;
  const liveAnalysed = Number(liveSummary?.analysed || 0);
  const blockers = [];

  if (!targetCount) blockers.push("no_recent_published_youtube_videos");
  if (scope !== "granted") blockers.push("youtube_analytics_scope_not_granted");
  if (scope === "granted" && !realMode) {
    blockers.push("creator_studio_real_mode_disabled");
  }
  if (scope === "granted" && realMode && !retentionCount) {
    blockers.push("creator_studio_retention_not_ingested_this_pass");
  }
  for (const blocker of asArray(extraBlockers)) {
    if (blocker && !blockers.includes(blocker)) blockers.push(blocker);
  }

  let status = "learning_ready_no_snapshots";
  if (!targetCount) status = "no_published_youtube_targets";
  else if (scope === "granted" && realMode && retentionCount) {
    status = "creator_studio_retention_learning_active";
  } else if (liveEnabled) {
    status = "public_counter_learning_active";
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    status,
    target_count: targetCount,
    targets: asArray(targets).map((target) => ({
      story_id: target.story_id,
      video_id: target.video_id,
      title: target.title,
      published_at: target.published_at || null,
    })),
    learning_surfaces: {
      public_counter_model: {
        enabled: liveEnabled,
        analysed: liveAnalysed,
        updates_persisted: Number(liveSummary?.updates_persisted || 0),
        signals_logged: Number(liveSummary?.signals_logged || 0),
        errors: asArray(liveSummary?.errors),
      },
      youtube_analytics_ingestion: {
        verdict: ingestionPacket?.verdict || "not_run",
        status: ingestionPacket?.status || "not_run",
        required_scope:
          ingestionPacket?.required_scope ||
          "https://www.googleapis.com/auth/yt-analytics.readonly",
        real_mode_enabled: realMode,
      },
      capability: {
        verdict: capabilityReport?.verdict || "unknown",
        detailed_youtube_analytics:
          capabilityReport?.capabilities?.detailed_youtube_analytics?.status ||
          "unknown",
        learning_dataset:
          capabilityReport?.capabilities?.learning_dataset?.status ||
          "unknown",
      },
      visual_v3_feedback: {
        enabled: retentionCount > 0,
        retention_files_written: retentionCount,
        retention_dir: paths?.retentionDir || null,
      },
      creator_studio_snapshots: {
        persisted: Number(snapshotRowsPersisted || 0),
        table: "platform_metric_snapshots",
      },
    },
    automatic_adjustments: {
      script_hooks: true,
      story_scoring_signals: true,
      visual_v3_retention_beats: retentionCount > 0,
      scoring_weights: false,
      public_posting: false,
    },
    blockers,
    safety: {
      oauth_triggered: false,
      network_called: retentionCount > 0 && realMode,
      token_values_printed: false,
      story_rows_mutated: false,
      derived_learning_tables_mutated:
        Number(liveSummary?.updates_persisted || 0) > 0 ||
        Number(liveSummary?.signals_logged || 0) > 0 ||
        Number(snapshotRowsPersisted || 0) > 0,
      social_posting_triggered: false,
    },
  };
}

function renderContinuousLearningMarkdown(summary = {}) {
  const lines = [];
  lines.push("# Pulse Continuous Learning Loop");
  lines.push("");
  lines.push(`Generated: ${summary.generated_at || ""}`);
  lines.push(`Status: ${summary.status || "unknown"}`);
  lines.push(`Targets: ${summary.target_count || 0}`);
  lines.push("");
  lines.push("## Learning surfaces");
  lines.push(
    `- Public counter model: ${
      summary.learning_surfaces?.public_counter_model?.enabled ? "enabled" : "off"
    } (${summary.learning_surfaces?.public_counter_model?.analysed || 0} analysed)`,
  );
  lines.push(
    `- YouTube Analytics: ${
      summary.learning_surfaces?.youtube_analytics_ingestion?.status || "not_run"
    }`,
  );
  lines.push(
    `- Visual V3 feedback files: ${
      summary.learning_surfaces?.visual_v3_feedback?.retention_files_written || 0
    }`,
  );
  lines.push("");
  lines.push("## Automatic adjustments");
  lines.push(
    `- Script hooks: ${summary.automatic_adjustments?.script_hooks === true}`,
  );
  lines.push(
    `- Visual V3 retention beats: ${
      summary.automatic_adjustments?.visual_v3_retention_beats === true
    }`,
  );
  lines.push("- Scoring weights: false");
  lines.push("- Public posting: false");
  lines.push("");
  lines.push("## Blockers");
  if (!asArray(summary.blockers).length) lines.push("- none");
  for (const blocker of asArray(summary.blockers)) lines.push(`- ${blocker}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- No OAuth was triggered.");
  lines.push("- No token values were printed.");
  lines.push("- No story rows were mutated.");
  lines.push("- No social posting was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeRetentionIntelligenceOutputs({
  targets = [],
  retentionInputsByVideo = new Map(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("outputDir is required");
  await fs.ensureDir(outputDir);
  const entries = [];
  for (const target of asArray(targets)) {
    const input =
      retentionInputsByVideo instanceof Map
        ? retentionInputsByVideo.get(target.video_id)
        : retentionInputsByVideo[target.video_id];
    if (!input || input.error) continue;
    const story = {
      ...(target.story || {}),
      id: target.story_id,
      title: target.title || target.story?.title,
    };
    const intelligence = buildRetentionIntelligence({
      story,
      videoId: target.video_id,
      durationS: target.durationS || 60,
      retentionRows: input.retentionRows || [],
      trafficRows: input.trafficRows || [],
      generatedAt,
    });
    const jsonPath = path.join(outputDir, `${target.story_id}.json`);
    const mdPath = path.join(outputDir, `${target.story_id}.md`);
    await fs.writeJson(jsonPath, intelligence, { spaces: 2 });
    await fs.writeFile(
      mdPath,
      renderRetentionIntelligenceMarkdown(intelligence),
      "utf8",
    );
    entries.push({
      story_id: target.story_id,
      video_id: target.video_id,
      verdict: intelligence.verdict,
      recommendations: intelligence.recommendations.length,
      fixture: input.fixture === true,
      json_path: jsonPath,
      md_path: mdPath,
    });
  }
  await fs.writeJson(
    path.join(outputDir, "index.json"),
    {
      schema_version: 1,
      generated_at: generatedAt,
      entries,
    },
    { spaces: 2 },
  );
  return entries;
}

async function defaultReadTokenStatus() {
  try {
    const doctor = require("../../tools/analytics-capability-doctor");
    return await doctor.readTokenStatus();
  } catch {
    return inspectYouTubeTokenShape(null);
  }
}

async function buildFreshReadOnlyYouTubeAuthClient({
  env = process.env,
  now = Date.now(),
  tokenPath = path.join(__dirname, "..", "..", "tokens", "youtube_token.json"),
  credentialsPath = path.join(
    __dirname,
    "..",
    "..",
    "tokens",
    "youtube_credentials.json",
  ),
} = {}) {
  if (!(await fs.pathExists(tokenPath))) {
    return { authClient: null, skipped: "youtube_token_file_missing" };
  }
  let token;
  try {
    token = await fs.readJson(tokenPath);
  } catch {
    return { authClient: null, skipped: "youtube_token_unreadable" };
  }
  if (!token || typeof token.access_token !== "string") {
    return { authClient: null, skipped: "youtube_access_token_missing" };
  }
  const expiry = Number(token.expiry_date);
  if (!Number.isFinite(expiry) || expiry <= Number(now) + 5 * 60 * 1000) {
    return { authClient: null, skipped: "youtube_access_token_not_fresh" };
  }

  let clientId = cleanEnvValue(env.YOUTUBE_CLIENT_ID);
  let clientSecret = cleanEnvValue(env.YOUTUBE_CLIENT_SECRET);
  let redirectUri = "http://localhost";
  if (await fs.pathExists(credentialsPath)) {
    try {
      const credentials = await fs.readJson(credentialsPath);
      const installed = credentials.installed || credentials.web || {};
      clientId = installed.client_id || clientId;
      clientSecret = installed.client_secret || clientSecret;
      redirectUri = installed.redirect_uris?.[0] || redirectUri;
    } catch {
      return { authClient: null, skipped: "youtube_credentials_unreadable" };
    }
  }
  if (!clientId || !clientSecret) {
    return { authClient: null, skipped: "youtube_credentials_missing" };
  }

  const { google } = require("googleapis");
  const authClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  authClient.setCredentials(token);
  return { authClient, skipped: null };
}

function fixtureStories() {
  const published = new Date().toISOString();
  return [
    {
      id: "fixture-learning-forza",
      title: "Forza Horizon 6 hits 130,000 concurrent players on Steam",
      youtube_post_id: "fixture-yt-forza",
      youtube_published_at: published,
      full_script:
        "GamesRadar reports Forza Horizon 6 hit 130,000 concurrent players on Steam.",
      duration_seconds: 60,
    },
  ];
}

async function runContinuousLearningLoop({
  stories = null,
  env = process.env,
  fixture = false,
  dry = false,
  limit = 12,
  maxAgeDays = 45,
  now = Date.now(),
  paths = null,
  readTokenStatus = defaultReadTokenStatus,
  readDbSignals = null,
  uploadScopeRequested = null,
  runLiveModel = runLiveAnalystPass,
  authClientProvider = buildFreshReadOnlyYouTubeAuthClient,
  analyticsClientFactory = buildAnalyticsClient,
  repos = null,
  log = console.log,
} = {}) {
  const learningPaths =
    paths ||
    resolveLearningPaths({
      env,
      resolveDbPath: () => {
        try {
          return require("../db").resolveDbPath();
        } catch {
          return path.join(process.cwd(), "data", "pulse.db");
        }
      },
    });

  let allStories = stories;
  if (!allStories) {
    if (fixture) allStories = fixtureStories();
    else {
      try {
        allStories = await require("../db").getStories();
      } catch (err) {
        log(`[continuous-learning] story read failed: ${err.message}`);
        allStories = [];
      }
    }
  }

  const targets = selectPublishedVideoTargets(allStories, {
    now,
    maxAgeDays,
    limit,
  });
  const tokenStatus = fixture
    ? { exists: true, yt_analytics_scope: "granted" }
    : await readTokenStatus();

  const scopeRequested =
    typeof uploadScopeRequested === "function"
      ? await uploadScopeRequested()
      : true;
  const ingestionPacket = buildYouTubeAnalyticsIngestionPacket({
    videoIds: targets.map((target) => target.video_id),
    tokenStatus,
    env,
  });

  let liveSummary = { enabled: false, analysed: 0, errors: [] };
  if (!dry) {
    try {
      liveSummary = await runLiveModel({
        forceEnabled: true,
        env,
        log,
      });
    } catch (err) {
      liveSummary = {
        enabled: true,
        analysed: 0,
        updates_persisted: 0,
        signals_logged: 0,
        errors: [err.message],
      };
    }
  }

  let retentionOutputs = [];
  let snapshotRowsPersisted = 0;
  const extraBlockers = [];
  let retentionInputsByVideo = new Map();
  if (fixture && targets.length) {
    const client = analyticsClientFactory({ mode: "fixture" });
    const inputs = await client.pullRetentionIntelligenceInputsForVideos(
      targets.map((target) => target.video_id),
    );
    retentionInputsByVideo = new Map(inputs.map((input) => [input.videoId, input]));
    retentionOutputs = await writeRetentionIntelligenceOutputs({
      outputDir: learningPaths.retentionDir,
      targets,
      retentionInputsByVideo,
    });
  } else if (
    targets.length &&
    tokenStatus.yt_analytics_scope === "granted" &&
    realModeEnabled(env)
  ) {
    const authResult = await authClientProvider({ env, log });
    if (!authResult || !authResult.authClient) {
      extraBlockers.push(authResult?.skipped || "youtube_readonly_auth_unavailable");
    } else {
      const client = analyticsClientFactory({ mode: "real" });
      const inputs = await client.pullRetentionIntelligenceInputsForVideos(
        targets.map((target) => target.video_id),
        { authClient: authResult.authClient },
      );
      retentionInputsByVideo = new Map(inputs.map((input) => [input.videoId, input]));
      retentionOutputs = await writeRetentionIntelligenceOutputs({
        outputDir: learningPaths.retentionDir,
        targets,
        retentionInputsByVideo,
      });
    }
  }

  if (!dry && retentionInputsByVideo.size) {
    const snapshotRows = buildCreatorStudioMetricSnapshotRows({
      targets,
      retentionInputsByVideo,
    });
    let activeRepos = repos;
    if (!activeRepos) {
      try {
        activeRepos = require("../repositories").getRepos();
      } catch (err) {
        extraBlockers.push(`creator_studio_snapshot_persist_skipped:${err.message}`);
      }
    }
    if (activeRepos) {
      try {
        snapshotRowsPersisted = persistCreatorStudioMetricSnapshots({
          repos: activeRepos,
          rows: snapshotRows,
        }).persisted;
      } catch (err) {
        extraBlockers.push(`creator_studio_snapshot_persist_failed:${err.message}`);
      }
    }
  }

  const dbSignals =
    typeof readDbSignals === "function" ? readDbSignals() : {};
  const capabilityReport = buildAnalyticsCapabilityReport({
    env,
    tokenStatus,
    dbSignals,
    uploadScopeRequested: scopeRequested,
  });

  const summary = buildContinuousLearningSummary({
    targets,
    tokenStatus,
    env,
    capabilityReport,
    ingestionPacket,
    liveSummary,
    retentionOutputs,
    snapshotRowsPersisted,
    extraBlockers,
    paths: learningPaths,
  });

  await fs.ensureDir(learningPaths.reportsDir);
  const jsonPath = path.join(learningPaths.reportsDir, "continuous_learning_loop.json");
  const mdPath = path.join(learningPaths.reportsDir, "continuous_learning_loop.md");
  await fs.writeJson(jsonPath, summary, { spaces: 2 });
  await fs.writeFile(mdPath, renderContinuousLearningMarkdown(summary), "utf8");

  return {
    summary,
    artefacts: {
      jsonPath,
      mdPath,
      retentionDir: learningPaths.retentionDir,
    },
  };
}

module.exports = {
  buildFreshReadOnlyYouTubeAuthClient,
  buildContinuousLearningSummary,
  buildCreatorStudioMetricSnapshotRows,
  persistCreatorStudioMetricSnapshots,
  renderContinuousLearningMarkdown,
  resolveLearningPaths,
  runContinuousLearningLoop,
  selectPublishedVideoTargets,
  writeRetentionIntelligenceOutputs,
};
