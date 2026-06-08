"use strict";

const path = require("node:path");
const fs = require("fs-extra");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(clean(value));
}

function unique(values = []) {
  return Array.from(new Set(asArray(values).map(clean).filter(Boolean)));
}

function actionId(action = {}) {
  return clean(action.action_id) || `${clean(action.story_id)}:${clean(action.platform)}`;
}

function isRealPlatformValue(value) {
  const text = clean(value);
  return !!text && !/^DUPE_/i.test(text);
}

function executorState(env = {}) {
  const enabled = truthy(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED);
  const killSwitch = clean(env.PULSE_EMERGENCY_KILL_SWITCH || env.PULSE_KILL_SWITCH || "unknown").toLowerCase();
  return {
    guarded_live_dispatch_enabled: enabled,
    emergency_kill_switch_state: killSwitch,
  };
}

const PLATFORM_CONFIG = {
  youtube_shorts: {
    publicName: "youtube",
    idField: "youtube_post_id",
    urlField: "youtube_url",
    errorField: "youtube_error",
    publishedAtField: "youtube_published_at",
    resultId(result = {}) {
      return clean(result.videoId);
    },
    resultUrl(result = {}) {
      return clean(result.url);
    },
  },
  instagram_reels: {
    publicName: "instagram",
    idField: "instagram_media_id",
    errorField: "instagram_error",
    publishedAtField: "instagram_published_at",
    resultId(result = {}) {
      return clean(result.mediaId);
    },
  },
  facebook_reels: {
    publicName: "facebook",
    idField: "facebook_post_id",
    errorField: "facebook_error",
    publishedAtField: "facebook_published_at",
    resultId(result = {}) {
      return clean(result.videoId);
    },
  },
};

function defaultUploaders() {
  return {
    youtube_shorts: require("../upload_youtube"),
    instagram_reels: require("../upload_instagram"),
    facebook_reels: require("../upload_facebook"),
  };
}

function defaultDb() {
  return require("./db");
}

function planSafetyBlockers(executorPlan = {}) {
  const blockers = [];
  const safety = executorPlan.safety || {};
  if (clean(executorPlan.mode) !== "GUARDED_DISPATCH_EXECUTOR_PREFLIGHT") {
    blockers.push("executor_plan_mode_not_preflight");
  }
  if (executorPlan.ready_for_live_executor_handoff !== true) {
    blockers.push("executor_plan_not_ready_for_handoff");
  }
  if (executorPlan.live_publish_allowed_from_this_tool !== false) {
    blockers.push("executor_plan_live_publish_flag_not_false");
  }
  if (Number(executorPlan.blocked_selected_action_count || 0) > 0) {
    blockers.push("executor_plan_has_blocked_selected_actions");
  }
  if (clean(executorPlan.required_next_step) !== "run_guarded_live_dispatch_executor") {
    blockers.push("executor_plan_wrong_next_step");
  }
  if (safety.no_publish_triggered !== true) blockers.push("executor_plan_publish_safety_missing");
  if (safety.no_network_uploads !== true) blockers.push("executor_plan_network_safety_missing");
  if (safety.no_db_mutation !== true) blockers.push("executor_plan_db_safety_missing");
  if (safety.no_oauth_or_token_change !== true) blockers.push("executor_plan_oauth_safety_missing");
  return unique(blockers);
}

function actionSafetyBlockers(action = {}) {
  const blockers = [];
  if (action.live_publish_allowed_from_preflight_only !== false) {
    blockers.push("action_preflight_live_publish_flag_not_false");
  }
  if (action.requires_live_executor_command !== true) {
    blockers.push("action_missing_live_executor_requirement");
  }
  if (action.requires_last_second_kill_switch_check !== true) {
    blockers.push("action_missing_kill_switch_requirement");
  }
  if (action.requires_last_second_platform_recheck !== true) {
    blockers.push("action_missing_platform_recheck_requirement");
  }
  if (!clean(action.story_id)) blockers.push("action_story_id_missing");
  if (!clean(action.platform)) blockers.push("action_platform_missing");
  if (!clean(action.video_path)) blockers.push("action_video_path_missing");
  return unique(blockers);
}

function applyStateBlockers({ apply = false, env = {} } = {}) {
  if (!apply) return [];
  const state = executorState(env);
  const blockers = [];
  if (state.guarded_live_dispatch_enabled !== true) blockers.push("guarded_live_dispatch_not_armed");
  if (state.emergency_kill_switch_state !== "clear") blockers.push("emergency_kill_switch_not_clear");
  return blockers;
}

function findStory(stories = [], storyId) {
  const id = clean(storyId);
  return asArray(stories).find((story) => clean(story.id) === id) || null;
}

async function readCanonicalManifestStory(action = {}) {
  const manifestPath = clean(action.canonical_manifest_path);
  if (!manifestPath) {
    return {
      story: null,
      blockers: [`story_not_found:${clean(action.story_id)}`],
    };
  }
  if (!await fs.pathExists(manifestPath)) {
    return {
      story: null,
      blockers: [
        `story_not_found:${clean(action.story_id)}`,
        "canonical_manifest_missing",
      ],
    };
  }
  try {
    const manifest = await fs.readJson(manifestPath);
    const title = clean(
      manifest.selected_title ||
        manifest.short_title ||
        manifest.canonical_title ||
        action.title,
    );
    const script = clean(
      manifest.narration_script ||
        manifest.full_script ||
        manifest.tts_script ||
        manifest.first_spoken_line,
    );
    return {
      story: {
        id: clean(manifest.story_id || manifest.id || action.story_id),
        title,
        suggested_title: title,
        url: clean(manifest.primary_source_url || manifest.source_url || manifest.url),
        source_type: clean(manifest.discovery_source || manifest.primary_source || "canonical_manifest"),
        flair: clean(manifest.canonical_angle || manifest.content_pillar || "News"),
        classification: clean(manifest.canonical_angle || manifest.content_pillar || "Confirmed Drop"),
        content_pillar: clean(manifest.canonical_angle || manifest.content_pillar || "Confirmed Drop"),
        full_script: script,
        tts_script: clean(manifest.tts_script || script),
        suggested_thumbnail_text: clean(
          manifest.thumbnail_text ||
            manifest.thumbnail_headline ||
            manifest.suggested_thumbnail_text ||
            title,
        ),
        pinned_comment: clean(manifest.pinned_comment),
        approved: true,
        auto_approved: true,
        exported_path: clean(action.video_path),
        canonical_manifest_path: manifestPath,
        platform_publish_manifest_path: clean(action.platform_publish_manifest_path),
        _guarded_story_source: "canonical_manifest",
      },
      blockers: [],
    };
  } catch (err) {
    return {
      story: null,
      blockers: [
        `story_not_found:${clean(action.story_id)}`,
        `canonical_manifest_unreadable:${clean(err.message)}`,
      ],
    };
  }
}

async function loadStoryForAction(stories = [], action = {}) {
  const story = findStory(stories, action.story_id);
  if (story) {
    return {
      story: {
        ...story,
        _guarded_story_source: story._guarded_story_source || "db",
      },
      blockers: [],
    };
  }
  return readCanonicalManifestStory(action);
}

function storyForAction(story = {}, action = {}) {
  return {
    ...story,
    exported_path: clean(action.video_path) || story.exported_path,
    captions_path: clean(action.captions_path) || story.captions_path,
    guarded_dispatch_action_id: actionId(action),
    guarded_dispatch_platform: clean(action.platform),
    guarded_dispatch_preflight_generated_at: clean(action.generated_at),
    first_frame_source: clean(action.first_frame_source) || story.first_frame_source,
    canonical_manifest_path: clean(action.canonical_manifest_path) || story.canonical_manifest_path,
    platform_publish_manifest_path:
      clean(action.platform_publish_manifest_path) || story.platform_publish_manifest_path,
  };
}

function loadStories({ stories, db } = {}) {
  if (Array.isArray(stories)) return Promise.resolve(stories);
  if (!db || typeof db.getStories !== "function") {
    throw new Error("runGuardedLiveDispatchExecutor requires stories or db.getStories()");
  }
  return db.getStories();
}

function platformAlreadyPublished(story = {}, config = {}) {
  const value = story[config.idField];
  if (!isRealPlatformValue(value)) return null;
  return clean(value);
}

function platformDuplicateBlocked(story = {}, config = {}) {
  const errorText = clean(story[config.errorField]);
  return /\b(?:duplicate_blocked|dupe-blocked)\b/i.test(errorText);
}

async function selectNextGuardedLiveAction({
  executorPlan = {},
  stories = [],
  allowedPlatforms = Object.keys(PLATFORM_CONFIG),
} = {}) {
  const allowed = new Set(asArray(allowedPlatforms).map(clean).filter(Boolean));
  const skippedActions = [];

  for (const action of asArray(executorPlan.handoff_ready_actions)) {
    const id = actionId(action);
    const platform = clean(action.platform);
    const config = PLATFORM_CONFIG[platform];
    if (!config || !allowed.has(platform)) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "unsupported_or_disabled_platform",
      });
      continue;
    }

    const loaded = await loadStoryForAction(stories, action);
    if (!loaded.story) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "story_not_found",
        blockers: asArray(loaded.blockers),
      });
      continue;
    }

    const existingId = platformAlreadyPublished(loaded.story, config);
    if (existingId) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "already_published",
        external_id: existingId,
      });
      continue;
    }

    if (platformDuplicateBlocked(loaded.story, config)) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "duplicate_blocked",
      });
      continue;
    }

    return {
      exhausted: false,
      action_id: id,
      action,
      story_source: clean(loaded.story._guarded_story_source || "db"),
      skipped_actions: skippedActions,
    };
  }

  return {
    exhausted: true,
    action_id: null,
    action: null,
    reason: "no_unpublished_guarded_actions",
    skipped_actions: skippedActions,
  };
}

function isInstagramPendingProcessingTimeout(err, uploaders = {}) {
  const checker = uploaders.instagram_reels && uploaders.instagram_reels.isInstagramPendingProcessingTimeout;
  if (typeof checker === "function" && checker(err)) return true;
  return !!(
    err &&
    (err.pendingProcessing === true ||
      err.code === "pending_processing_timeout" ||
      /\bpending_processing_timeout\b/.test(String(err.message || "")))
  );
}

async function persistStory({ db, story, apply }) {
  if (!apply) return false;
  if (!db || typeof db.upsertStory !== "function") {
    throw new Error("live guarded dispatch apply requires db.upsertStory()");
  }
  await db.upsertStory(story);
  return true;
}

function buildBlockedAction({ actionIdValue, action, blockers }) {
  return {
    action_id: clean(actionIdValue) || actionId(action),
    story_id: clean(action?.story_id || clean(actionIdValue).split(":")[0]),
    platform: clean(action?.platform || clean(actionIdValue).split(":").slice(1).join(":")),
    title: clean(action?.title),
    outcome: "blocked",
    blockers: unique(blockers),
  };
}

async function executeAction({
  action,
  story,
  config,
  uploader,
  uploaders,
  db,
  apply,
  generatedAt,
} = {}) {
  const hydrated = storyForAction(story, action);
  const existingId = platformAlreadyPublished(hydrated, config);
  if (existingId) {
    return {
      action_id: actionId(action),
      story_id: clean(action.story_id),
      platform: clean(action.platform),
      title: clean(action.title || hydrated.title),
      outcome: "already_published",
      external_id: existingId,
      story_source: clean(hydrated._guarded_story_source || "db"),
      uploaded: false,
      db_mutated: false,
    };
  }

  if (!apply) {
    return {
      action_id: actionId(action),
      story_id: clean(action.story_id),
      platform: clean(action.platform),
      title: clean(action.title || hydrated.title),
      outcome: "dry_run_ready",
      video_path: hydrated.exported_path,
      story_source: clean(hydrated._guarded_story_source || "db"),
      uploaded: false,
      db_mutated: false,
    };
  }

  if (!uploader || typeof uploader.uploadShort !== "function") {
    return buildBlockedAction({
      action,
      blockers: [`uploader_missing:${clean(action.platform)}`],
    });
  }

  try {
    const result = await uploader.uploadShort(hydrated);
    if (result && result.blocked === true) {
      hydrated[config.errorField] = `duplicate_blocked: ${clean(result.reason || "blocked")}`;
      const dbMutated = await persistStory({ db, story: hydrated, apply });
      return {
        action_id: actionId(action),
        story_id: clean(action.story_id),
        platform: clean(action.platform),
        title: clean(action.title || hydrated.title),
        outcome: "duplicate_blocked",
        uploaded: false,
        db_mutated: dbMutated,
        story_source: clean(hydrated._guarded_story_source || "db"),
        error: hydrated[config.errorField],
      };
    }

    const externalId = config.resultId(result || {});
    if (!externalId) {
      throw new Error(`${config.publicName} uploader returned no external id`);
    }

    hydrated[config.idField] = externalId;
    if (config.urlField) hydrated[config.urlField] = config.resultUrl(result || {}) || hydrated[config.urlField] || null;
    hydrated[config.errorField] = null;
    hydrated[config.publishedAtField] = generatedAt;
    if (!hydrated.published_at) hydrated.published_at = generatedAt;
    const dbMutated = await persistStory({ db, story: hydrated, apply });
    return {
      action_id: actionId(action),
      story_id: clean(action.story_id),
      platform: clean(action.platform),
      title: clean(action.title || hydrated.title),
      outcome: "new_upload",
      external_id: externalId,
      url: config.urlField ? hydrated[config.urlField] || null : null,
      story_source: clean(hydrated._guarded_story_source || "db"),
      uploaded: true,
      db_mutated: dbMutated,
    };
  } catch (err) {
    if (clean(action.platform) === "instagram_reels" && isInstagramPendingProcessingTimeout(err, uploaders)) {
      hydrated[config.errorField] = err.message;
      const dbMutated = await persistStory({ db, story: hydrated, apply });
      return {
        action_id: actionId(action),
        story_id: clean(action.story_id),
        platform: clean(action.platform),
        title: clean(action.title || hydrated.title),
        outcome: "accepted_processing",
        uploaded: true,
        db_mutated: dbMutated,
        story_source: clean(hydrated._guarded_story_source || "db"),
        error: err.message,
      };
    }

    hydrated[config.errorField] = err.message;
    const dbMutated = await persistStory({ db, story: hydrated, apply });
    return {
      action_id: actionId(action),
      story_id: clean(action.story_id),
      platform: clean(action.platform),
      title: clean(action.title || hydrated.title),
      outcome: "failed",
      uploaded: false,
      db_mutated: dbMutated,
      story_source: clean(hydrated._guarded_story_source || "db"),
      error: err.message,
    };
  }
}

async function runGuardedLiveDispatchExecutor({
  executorPlan = {},
  stories = null,
  actionIds = [],
  apply = false,
  maxActions = apply ? 1 : Infinity,
  env = process.env,
  uploaders = null,
  db = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const selectedActionIds = unique(actionIds);
  const state = executorState(env);
  const planBlockers = planSafetyBlockers(executorPlan);
  const globalBlockers = [...planBlockers, ...applyStateBlockers({ apply, env })];
  const advisory = [];
  const allActions = asArray(executorPlan.handoff_ready_actions);
  const actionById = new Map(allActions.map((action) => [actionId(action), action]));

  if (!selectedActionIds.length) advisory.push("explicit_action_ids_required");
  if (apply && Number.isFinite(maxActions) && selectedActionIds.length > maxActions) {
    globalBlockers.push(`selected_action_count_exceeds_apply_max:${maxActions}`);
  }

  const runtimeDb = db || (apply || !Array.isArray(stories) ? defaultDb() : null);
  const runtimeUploaders = uploaders || (apply ? defaultUploaders() : {});
  const storyRows = await loadStories({ stories, db: runtimeDb });
  const actions = [];
  const blockedActions = [];

  for (const selectedId of selectedActionIds) {
    const action = actionById.get(selectedId);
    if (!action) {
      blockedActions.push(buildBlockedAction({
        actionIdValue: selectedId,
        blockers: ["selected_action_not_in_executor_plan"],
      }));
      continue;
    }

    const platform = clean(action.platform);
    const config = PLATFORM_CONFIG[platform];
    const storyLoad = await loadStoryForAction(storyRows, action);
    const story = storyLoad.story;
    const blockers = [
      ...globalBlockers,
      ...actionSafetyBlockers(action),
      ...(config ? [] : [`unsupported_or_disabled_platform:${platform || "missing"}`]),
      ...asArray(storyLoad.blockers),
    ];

    if (blockers.length) {
      blockedActions.push(buildBlockedAction({ action, blockers }));
      continue;
    }

    const result = await executeAction({
      action,
      story,
      config,
      uploader: runtimeUploaders[platform],
      uploaders: runtimeUploaders,
      db: runtimeDb,
      apply,
      generatedAt,
    });
    if (result.outcome === "blocked") blockedActions.push(result);
    else actions.push(result);
  }

  const uploadAttemptCount = actions.filter((item) => item.uploaded === true).length;
  const dbMutationCount = actions.filter((item) => item.db_mutated === true).length;
  const failedCount = actions.filter((item) => item.outcome === "failed").length;
  const verdict = blockedActions.length || failedCount
    ? "RED"
    : actions.length
      ? "GREEN"
      : "AMBER";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_LIVE_DISPATCH_EXECUTOR",
    verdict,
    apply: apply === true,
    live_publish_applied: apply === true && uploadAttemptCount > 0,
    ready_for_live_dispatch_boolean: verdict === "GREEN",
    executor_state: state,
    summary: {
      selected_action_count: selectedActionIds.length,
      completed_action_count: actions.length,
      blocked_action_count: blockedActions.length,
      upload_attempt_count: uploadAttemptCount,
      db_mutation_count: dbMutationCount,
      failed_action_count: failedCount,
    },
    actions,
    blocked_actions: blockedActions,
    advisory,
    safety: {
      no_oauth_or_token_change: true,
      no_network_uploads: apply !== true,
      no_public_posts: apply !== true,
      no_db_mutation: apply !== true || dbMutationCount === 0,
      live_network_uploads: apply === true && uploadAttemptCount > 0,
      db_mutation_count: dbMutationCount,
    },
    required_next_step: verdict === "GREEN"
      ? apply
        ? "verify_platform_posts_and_discord_alerts"
        : "rerun_with_apply_after_operator_confirms_exact_action_ids"
      : blockedActions.length
        ? "repair_guarded_live_dispatch_blockers"
        : "select_explicit_dispatch_action_ids",
  };
}

function renderGuardedLiveDispatchExecutorMarkdown(report = {}) {
  const lines = [
    "# Guarded Live Dispatch Executor",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Apply: ${report.apply === true ? "true" : "false"}`,
    `Selected actions: ${report.summary?.selected_action_count || 0}`,
    `Completed actions: ${report.summary?.completed_action_count || 0}`,
    `Blocked actions: ${report.summary?.blocked_action_count || 0}`,
    `Upload attempts: ${report.summary?.upload_attempt_count || 0}`,
    `DB mutations: ${report.summary?.db_mutation_count || 0}`,
    "",
  ];

  if (asArray(report.actions).length) {
    lines.push("## Actions", "");
    for (const action of asArray(report.actions)) {
      const external = action.external_id ? ` (${action.external_id})` : "";
      lines.push(`- ${action.action_id}: ${action.outcome}${external}`);
    }
    lines.push("");
  }

  if (asArray(report.blocked_actions).length) {
    lines.push("## Blocked", "");
    for (const action of asArray(report.blocked_actions)) {
      lines.push(`- ${action.action_id || "unknown"}: ${asArray(action.blockers).join(", ")}`);
    }
    lines.push("");
  }

  if (asArray(report.advisory).length) {
    lines.push("## Advisory", "");
    for (const item of asArray(report.advisory)) lines.push(`- ${item}`);
    lines.push("");
  }

  if (report.apply !== true) {
    lines.push("No uploads were triggered. No database rows, OAuth settings or token files were changed.", "");
  } else {
    lines.push("Live uploads were allowed only for the selected handoff actions. OAuth settings and token files were not changed.", "");
  }
  return lines.join("\n");
}

async function writeGuardedLiveDispatchExecutorReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGuardedLiveDispatchExecutorReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const reportPath = path.join(outDir, "guarded_live_dispatch_executor_report.json");
  const markdownPath = path.join(outDir, "guarded_live_dispatch_executor.md");
  await fs.writeJson(reportPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGuardedLiveDispatchExecutorMarkdown(report), "utf8");
  return { outputDir: outDir, reportPath, markdownPath };
}

module.exports = {
  PLATFORM_CONFIG,
  selectNextGuardedLiveAction,
  runGuardedLiveDispatchExecutor,
  renderGuardedLiveDispatchExecutorMarkdown,
  writeGuardedLiveDispatchExecutorReport,
};
