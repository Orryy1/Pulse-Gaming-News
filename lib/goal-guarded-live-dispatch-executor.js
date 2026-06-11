"use strict";

const path = require("node:path");
const fs = require("fs-extra");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sourceLabel(value) {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  return clean(value.name || value.source_name || value.label || value.title || value.url);
}

function sourceUrl(value) {
  if (!value || typeof value === "string") return "";
  return clean(value.url || value.source_url || value.href);
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
    structuredPlatform: "youtube",
    mediaKind: "video",
    uploadMethod: "uploadShort",
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
    structuredPlatform: "instagram_reel",
    mediaKind: "video",
    uploadMethod: "uploadShort",
    idField: "instagram_media_id",
    errorField: "instagram_error",
    publishedAtField: "instagram_published_at",
    resultId(result = {}) {
      return clean(result.mediaId);
    },
  },
  facebook_reels: {
    publicName: "facebook",
    structuredPlatform: "facebook_reel",
    mediaKind: "video",
    uploadMethod: "uploadShort",
    idField: "facebook_post_id",
    errorField: "facebook_error",
    publishedAtField: "facebook_published_at",
    resultId(result = {}) {
      return clean(result.videoId);
    },
  },
  instagram_story: {
    publicName: "instagram_story",
    structuredPlatform: "instagram_story",
    mediaKind: "story_image",
    uploadMethod: "uploadStoryImage",
    idField: "instagram_story_id",
    errorField: "instagram_story_error",
    publishedAtField: "instagram_story_published_at",
    resultId(result = {}) {
      return clean(result.mediaId);
    },
  },
  facebook_story: {
    publicName: "facebook_story",
    structuredPlatform: "facebook_story",
    mediaKind: "story_image",
    uploadMethod: "uploadStoryImage",
    idField: "facebook_story_id",
    errorField: "facebook_story_error",
    publishedAtField: "facebook_story_published_at",
    resultId(result = {}) {
      return clean(result.storyId || result.postId || result.id);
    },
  },
};

function defaultUploaders() {
  return {
    youtube_shorts: require("../upload_youtube"),
    instagram_reels: require("../upload_instagram"),
    facebook_reels: require("../upload_facebook"),
    instagram_story: require("../upload_instagram"),
    facebook_story: require("../upload_facebook"),
  };
}

function defaultDb() {
  return require("./db");
}

function defaultPlatformPosts(db) {
  if (!db || typeof db.getDb !== "function") return null;
  try {
    return require("./repositories/platform_posts").bind(db.getDb());
  } catch {
    return null;
  }
}

function defaultDiscordPoster(db) {
  if (!db || typeof db.getDb !== "function") return null;
  return require("../discord/auto_post");
}

function defaultDiscordGate(db) {
  if (!db || typeof db.getDb !== "function") return null;
  return require("./services/discord-post-gate");
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

function actionSafetyBlockers(action = {}, config = null) {
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
  if (config?.mediaKind === "story_image") {
    if (!clean(action.story_image_path || action.image_path)) {
      blockers.push("action_story_image_path_missing");
    }
  } else if (!clean(action.video_path)) {
    blockers.push("action_video_path_missing");
  }
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
    const primarySource = sourceLabel(
      manifest.primary_source ||
        manifest.source_card_label ||
        manifest.official_source ||
        manifest.official_confirmation_source,
    );
    const sourceCardLabel = sourceLabel(manifest.source_card_label || manifest.primary_source || primarySource);
    const primarySourceUrl = clean(
      manifest.primary_source_url ||
        manifest.article_url ||
        manifest.source_url ||
        sourceUrl(manifest.primary_source) ||
        manifest.url,
    );
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
        selected_title: title,
        short_title: clean(manifest.short_title || title),
        canonical_title: clean(manifest.canonical_title || title),
        suggested_title: title,
        url: primarySourceUrl,
        article_url: primarySourceUrl,
        source_url: primarySourceUrl,
        primary_source_url: primarySourceUrl,
        primary_source: primarySource,
        primary_source_name: primarySource,
        source_card_label: sourceCardLabel || primarySource,
        thumbnail_source_label: sourceCardLabel || primarySource,
        discovery_source: clean(manifest.discovery_source),
        official_source: sourceLabel(manifest.official_source),
        official_confirmation_source: sourceLabel(manifest.official_confirmation_source),
        source_type: clean(manifest.discovery_source || "canonical_manifest"),
        canonical_subject: clean(manifest.canonical_subject || manifest.canonical_game),
        canonical_game: clean(manifest.canonical_game || manifest.canonical_subject),
        canonical_company: clean(manifest.canonical_company),
        flair: clean(manifest.canonical_angle || manifest.content_pillar || "News"),
        classification: clean(manifest.canonical_angle || manifest.content_pillar || "Confirmed Drop"),
        content_pillar: clean(manifest.canonical_angle || manifest.content_pillar || "Confirmed Drop"),
        full_script: script,
        narration_script: script,
        tts_script: clean(manifest.tts_script || script),
        first_spoken_line: clean(manifest.first_spoken_line || manifest.narration_hook),
        narration_hook: clean(manifest.narration_hook || manifest.first_spoken_line),
        suggested_thumbnail_text: clean(
          manifest.thumbnail_text ||
            manifest.thumbnail_headline ||
            manifest.suggested_thumbnail_text ||
            title,
        ),
        thumbnail_text: clean(manifest.thumbnail_text || manifest.thumbnail_headline),
        thumbnail_headline: clean(manifest.thumbnail_headline || manifest.thumbnail_text),
        description: clean(manifest.description),
        pinned_comment: clean(manifest.pinned_comment),
        approved: true,
        auto_approved: true,
        exported_path: clean(action.video_path),
        story_image_path: clean(action.story_image_path || action.image_path),
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

const CANONICAL_OVERRIDE_FIELDS = [
  "primary_source",
  "primary_source_name",
  "source_card_label",
  "thumbnail_source_label",
  "selected_title",
  "short_title",
  "canonical_title",
  "suggested_title",
  "description",
  "pinned_comment",
];

const CANONICAL_BACKFILL_FIELDS = [
  "title",
  "url",
  "article_url",
  "source_url",
  "primary_source_url",
  "discovery_source",
  "official_source",
  "official_confirmation_source",
  "canonical_subject",
  "canonical_game",
  "canonical_company",
  "flair",
  "classification",
  "content_pillar",
  "full_script",
  "narration_script",
  "tts_script",
  "first_spoken_line",
  "narration_hook",
  "suggested_thumbnail_text",
  "thumbnail_text",
  "thumbnail_headline",
  "canonical_manifest_path",
  "platform_publish_manifest_path",
];

function supplementDbStoryWithCanonicalManifest(dbStory = {}, canonicalStory = null) {
  if (!canonicalStory) {
    return {
      ...dbStory,
      _guarded_story_source: dbStory._guarded_story_source || "db",
    };
  }

  const merged = {
    ...dbStory,
    _guarded_story_source: "db+canonical_manifest",
  };

  for (const field of CANONICAL_OVERRIDE_FIELDS) {
    if (clean(canonicalStory[field])) merged[field] = canonicalStory[field];
  }
  for (const field of CANONICAL_BACKFILL_FIELDS) {
    if (!clean(merged[field]) && clean(canonicalStory[field])) merged[field] = canonicalStory[field];
  }

  return merged;
}

async function loadStoryForAction(stories = [], action = {}) {
  const story = findStory(stories, action.story_id);
  if (story) {
    const canonicalLoad = await readCanonicalManifestStory(action);
    return {
      story: supplementDbStoryWithCanonicalManifest(story, canonicalLoad.story),
      blockers: [],
    };
  }
  return readCanonicalManifestStory(action);
}

function storyForAction(story = {}, action = {}) {
  return {
    ...story,
    exported_path: clean(action.video_path) || story.exported_path,
    story_image_path: clean(action.story_image_path || action.image_path) || story.story_image_path,
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

function platformPreviousHardFailure(story = {}, config = {}) {
  const errorText = clean(story[config.errorField]);
  if (!errorText) return null;
  if (platformDuplicateBlocked(story, config)) return null;
  if (/\b(?:pending_processing_timeout|accepted_processing|processing_pending)\b/i.test(errorText)) {
    return null;
  }
  return errorText;
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

    const previousHardFailure = platformPreviousHardFailure(loaded.story, config);
    if (previousHardFailure) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "previous_platform_failure",
        error: previousHardFailure.slice(0, 240),
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

function recordPublishedPlatformPost({
  platformPosts,
  story,
  action,
  config,
  externalId,
  externalUrl,
} = {}) {
  if (
    !platformPosts ||
    typeof platformPosts.ensurePending !== "function" ||
    typeof platformPosts.markPublished !== "function"
  ) {
    return false;
  }
  const storyId = clean(story.id || action.story_id);
  const platform = clean(config.structuredPlatform);
  if (!storyId || !platform || !clean(externalId)) return false;
  const row = platformPosts.ensurePending(storyId, platform, {
    channelId: clean(story.channel_id) || null,
    idempotencyKey: actionId(action),
  });
  platformPosts.markPublished(row.id, {
    externalId,
    externalUrl: clean(externalUrl) || null,
  });
  return true;
}

async function runDiscordPostHandoff({
  story,
  db,
  apply,
  discordPoster,
  discordGate,
  generatedAt,
} = {}) {
  const alerts = [];
  if (!apply || !story || !discordPoster || !discordGate) {
    return { alerts, dbMutated: false };
  }

  async function attemptAlert({
    kind,
    shouldPost,
    post,
    mark,
  }) {
    if (typeof shouldPost !== "function" || typeof post !== "function") return;
    if (!shouldPost(story)) return;

    try {
      const posted = await post(story);
      if (!posted) {
        alerts.push({ kind, outcome: "skipped_or_failed", db_mutated: false });
        return;
      }

      if (typeof mark === "function") mark(story, new Date(generatedAt));
      else if (kind === "video_drop") story.discord_video_drop_posted_at = generatedAt;
      else if (kind === "story_poll") story.discord_story_poll_posted_at = generatedAt;

      await persistStory({ db, story, apply });
      alerts.push({ kind, outcome: "posted", db_mutated: true });
    } catch (err) {
      alerts.push({
        kind,
        outcome: "failed",
        db_mutated: false,
        error: clean(err && err.message),
      });
    }
  }

  await attemptAlert({
    kind: "video_drop",
    shouldPost: discordGate.shouldPostVideoDrop,
    post: discordPoster.postVideoUpload,
    mark: discordGate.markVideoDropPosted,
  });
  await attemptAlert({
    kind: "story_poll",
    shouldPost: discordGate.shouldPostStoryPoll,
    post: discordPoster.postStoryPoll,
    mark: discordGate.markStoryPollPosted,
  });

  return {
    alerts,
    dbMutated: alerts.some((alert) => alert.db_mutated === true),
  };
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
  platformPosts,
  discordPoster,
  discordGate,
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
      story_image_path: hydrated.story_image_path,
      story_source: clean(hydrated._guarded_story_source || "db"),
      uploaded: false,
      db_mutated: false,
    };
  }

  const uploadMethod = clean(config.uploadMethod) || "uploadShort";
  if (!uploader || typeof uploader[uploadMethod] !== "function") {
    return buildBlockedAction({
      action,
      blockers: [`uploader_missing:${clean(action.platform)}`],
    });
  }

  try {
    let preUploadDbMutated = false;
    if (config.mediaKind === "story_image") {
      preUploadDbMutated = await persistStory({ db, story: hydrated, apply });
    }
    const result = await uploader[uploadMethod](hydrated);
    if (result && result.blocked === true) {
      hydrated[config.errorField] = `duplicate_blocked: ${clean(result.reason || "blocked")}`;
      const dbMutated = (await persistStory({ db, story: hydrated, apply })) || preUploadDbMutated;
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
    const externalUrl = config.urlField ? config.resultUrl(result || {}) : null;

    hydrated[config.idField] = externalId;
    if (config.urlField) hydrated[config.urlField] = externalUrl || hydrated[config.urlField] || null;
    hydrated[config.errorField] = null;
    hydrated[config.publishedAtField] = generatedAt;
    if (!hydrated.published_at) hydrated.published_at = generatedAt;
    const platformPostRecorded = recordPublishedPlatformPost({
      platformPosts,
      story: hydrated,
      action,
      config,
      externalId,
      externalUrl,
    });
    const persistedAfterUpload = await persistStory({ db, story: hydrated, apply });
    const discordHandoff = await runDiscordPostHandoff({
      story: hydrated,
      db,
      apply,
      discordPoster,
      discordGate,
      generatedAt,
    });
    const dbMutated = persistedAfterUpload || preUploadDbMutated || discordHandoff.dbMutated;
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
      platform_post_recorded: platformPostRecorded,
      discord_alerts: discordHandoff.alerts,
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
  platformPosts = null,
  discordPoster = undefined,
  discordGate = undefined,
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
  const runtimePlatformPosts = platformPosts || (apply ? defaultPlatformPosts(runtimeDb) : null);
  const runtimeDiscordPoster = discordPoster !== undefined
    ? discordPoster
    : (apply ? defaultDiscordPoster(runtimeDb) : null);
  const runtimeDiscordGate = discordGate !== undefined
    ? discordGate
    : (apply ? defaultDiscordGate(runtimeDb) : null);
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
      ...actionSafetyBlockers(action, config),
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
      platformPosts: runtimePlatformPosts,
      discordPoster: runtimeDiscordPoster,
      discordGate: runtimeDiscordGate,
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
  const discordAlerts = actions.flatMap((item) => asArray(item.discord_alerts));
  const discordAlertPostCount = discordAlerts.filter((item) => item.outcome === "posted").length;
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
      discord_alert_attempt_count: discordAlerts.length,
      discord_alert_post_count: discordAlertPostCount,
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
    `Discord alert attempts: ${report.summary?.discord_alert_attempt_count || 0}`,
    `Discord alerts posted: ${report.summary?.discord_alert_post_count || 0}`,
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
