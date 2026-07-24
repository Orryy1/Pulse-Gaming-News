"use strict";

const { createHash } = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const {
  DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
  DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS,
  NORMAL_PRODUCTION_DURATION_LANE,
} = require("./services/short-duration-contract");
const {
  requiresTitleColonPauseProfile,
  TTS_PRONUNCIATION_PROFILE_VERSION,
} = require("./tts-pronunciation");
const {
  evaluateManagedTtsRateAdjustment,
  hasMalformedGtaViSpokenStutter,
  hasRiskyGtaViOpening,
  hasSplitGtaViRomanNarration,
} = require("./studio/v2/approved-voice-path");

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

function killSwitchState(env = {}) {
  const explicit = clean(env.PULSE_EMERGENCY_KILL_SWITCH || env.PULSE_KILL_SWITCH);
  if (explicit) return explicit.toLowerCase();
  if (truthy(env.PULSE_EMERGENCY_KILL_SWITCH_CLEAR)) return "clear";
  return "unknown";
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

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function executorState(env = {}) {
  const enabled = truthy(env.PULSE_GUARDED_LIVE_DISPATCH_ENABLED);
  const killSwitch = killSwitchState(env);
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
    resultUrl(result = {}) {
      return clean(result.url || result.permalinkUrl);
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
  tiktok: {
    publicName: "tiktok",
    structuredPlatform: "tiktok",
    mediaKind: "video",
    uploadMethod: "uploadShort",
    idField: "tiktok_post_id",
    errorField: "tiktok_error",
    publishedAtField: "tiktok_published_at",
    resultId(result = {}) {
      return clean(result.publishId);
    },
  },
  x: {
    publicName: "x",
    structuredPlatform: "twitter_video",
    mediaKind: "video",
    uploadMethod: "uploadShort",
    idField: "twitter_post_id",
    errorField: "twitter_error",
    publishedAtField: "twitter_published_at",
    resultId(result = {}) {
      return clean(result.tweetId);
    },
    resultUrl(result = {}) {
      const tweetId = clean(result.tweetId);
      return clean(result.url) || (tweetId ? `https://x.com/i/web/status/${tweetId}` : "");
    },
  },
};

const DEFAULT_MAX_SOURCE_AGE_HOURS = 168;

const GOVERNED_DERIVED_VIDEO_VARIANT_PROFILES = Object.freeze({
  instagram_reels: {
    encoder_profile: "instagram_reels_meta_safe_h264_aac_v3",
    min_duration_s: 15,
    max_duration_s: 59,
  },
  facebook_reels: {
    encoder_profile: "facebook_reels_meta_safe_h264_aac_v1",
    min_duration_s: 15,
    max_duration_s: 90,
  },
});

function defaultUploaders() {
  return {
    youtube_shorts: require("../upload_youtube"),
    instagram_reels: require("../upload_instagram"),
    facebook_reels: require("../upload_facebook"),
    instagram_story: require("../upload_instagram"),
    facebook_story: require("../upload_facebook"),
    tiktok: require("../upload_tiktok"),
    x: require("../upload_twitter"),
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
  if (
    action.unsafe_override === true ||
    action.bypass_platform_gate === true ||
    action.bypass_safety_gate === true ||
    action.ignore_publish_gates === true
  ) {
    blockers.push("unsafe_override_not_supported");
  }
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

function platformLiveApplyBlockers({
  apply = false,
  platform = "",
  action = {},
  story = {},
  env = {},
} = {}) {
  if (!apply) return [];
  const blockers = [];
  if (clean(platform) === "tiktok") {
    if (!truthy(env.TIKTOK_ENABLED) || !truthy(env.TIKTOK_AUTO_UPLOAD_ENABLED)) {
      blockers.push("tiktok_operator_enablement_missing");
    }
    if (!clean(env.TIKTOK_CLIENT_KEY) || !clean(env.TIKTOK_CLIENT_SECRET)) {
      blockers.push("tiktok_credentials_missing");
    }
    if (
      !truthy(env.TIKTOK_DIRECT_POST_APPROVED) &&
      !truthy(env.TIKTOK_CONTENT_POSTING_APPROVED)
    ) {
      blockers.push("tiktok_public_direct_post_approval_missing");
    }
    const actionPrivacy = clean(action.privacy_level).toUpperCase();
    const effectivePrivacy = clean(
      env.TIKTOK_PRIVACY_LEVEL || actionPrivacy || "PUBLIC_TO_EVERYONE",
    ).toUpperCase();
    if (effectivePrivacy !== "PUBLIC_TO_EVERYONE") {
      blockers.push(`tiktok_public_privacy_required:${effectivePrivacy || "missing"}`);
    }
    if (actionPrivacy && actionPrivacy !== effectivePrivacy) {
      blockers.push("tiktok_action_privacy_does_not_match_runtime");
    }
    const duration = finiteNumberOrNull(
      action.video_duration_s ??
        action.video_duration_seconds ??
        action.duration_seconds ??
        action.duration_s ??
        story.duration_seconds ??
        story.runtime_seconds,
    );
    if (duration === null || duration <= 0) {
      blockers.push("tiktok_video_duration_missing");
    } else {
      const creatorInfoMax = finiteNumberOrNull(
        action.creator_info_max_video_post_duration_sec ??
          action.tiktok_creator_info?.max_video_post_duration_sec,
      );
      if (creatorInfoMax !== null && duration > creatorInfoMax) {
        blockers.push(
          `tiktok_video_duration_above_creator_info_max:${duration}:${creatorInfoMax}`,
        );
      }
    }
    if (
      action.disclosure_requirements_resolved !== true &&
      action.disclosures?.requirements_resolved !== true
    ) {
      blockers.push("tiktok_disclosure_requirements_unresolved");
    }
    const requirements = action.disclosure_requirements || {};
    const disclosures = action.disclosures || {};
    if (
      (
        requirements.affiliate_disclosure_required === true ||
        requirements.affiliate_required === true
      ) &&
      disclosures.affiliate_disclosure_present !== true
    ) {
      blockers.push("tiktok_affiliate_disclosure_missing");
    }
    if (
      (
        requirements.ai_disclosure_required === true ||
        requirements.ai_generated_content === true
      ) &&
      disclosures.ai_disclosure_present !== true &&
      disclosures.ai_generated_content_disclosed !== true
    ) {
      blockers.push("tiktok_ai_disclosure_missing");
    }
    if (
      (
        requirements.commercial_disclosure_required === true ||
        requirements.commercial_content === true
      ) &&
      disclosures.commercial_disclosure_present !== true &&
      disclosures.commercial_content_disclosed !== true &&
      disclosures.brand_content_toggle_enabled !== true
    ) {
      blockers.push("tiktok_commercial_disclosure_missing");
    }
  }
  if (clean(platform) === "x") {
    if (!truthy(env.TWITTER_ENABLED)) {
      blockers.push("x_operator_enablement_missing");
    }
    if (
      !clean(env.TWITTER_API_KEY) ||
      !clean(env.TWITTER_API_SECRET) ||
      !clean(env.TWITTER_ACCESS_TOKEN) ||
      !clean(env.TWITTER_ACCESS_SECRET)
    ) {
      blockers.push("x_credentials_missing");
    }
    if (
      !truthy(env.TWITTER_API_BILLING_CONFIRMED) &&
      !truthy(env.X_API_BILLING_CONFIRMED)
    ) {
      blockers.push("x_api_billing_not_confirmed");
    }
    if (
      !truthy(env.TWITTER_DIRECT_POST_APPROVED) &&
      !truthy(env.X_DIRECT_POST_APPROVED)
    ) {
      blockers.push("x_direct_post_approval_missing");
    }
  }
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
        source_timestamp: clean(
          manifest.source_published_at ||
            manifest.primary_source_published_at ||
            manifest.source_timestamp,
        ),
        source_published_at: clean(
          manifest.source_published_at ||
            manifest.primary_source_published_at ||
            manifest.source_timestamp,
        ),
        primary_source_published_at: clean(
          manifest.primary_source_published_at ||
            manifest.source_published_at ||
            manifest.source_timestamp,
        ),
        source_age_policy_hours: manifest.source_age_policy_hours,
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
        claim_inventory:
          manifest.claim_inventory && typeof manifest.claim_inventory === "object"
            ? manifest.claim_inventory
            : undefined,
        duration_lane: clean(manifest.duration_lane) ||
          (clean(manifest.duration_variant_repair_strategy).toLowerCase().includes(NORMAL_PRODUCTION_DURATION_LANE)
            ? NORMAL_PRODUCTION_DURATION_LANE
            : ""),
        duration_strategy: clean(manifest.duration_strategy || manifest.duration_variant_repair_strategy),
        duration_contract_strategy: clean(
          manifest.duration_contract_strategy ||
            manifest.duration_strategy ||
            manifest.duration_variant_repair_strategy,
        ),
        duration_variant_repair_strategy: clean(manifest.duration_variant_repair_strategy),
        duration_variant_target_duration_seconds:
          manifest.duration_variant_target_duration_seconds &&
          typeof manifest.duration_variant_target_duration_seconds === "object"
            ? manifest.duration_variant_target_duration_seconds
            : undefined,
        confirmed_claims: asArray(manifest.confirmed_claims),
        unconfirmed_claims: asArray(manifest.unconfirmed_claims),
        prohibited_claims: asArray(manifest.prohibited_claims),
        allowed_public_wording: asArray(manifest.allowed_public_wording),
        script_generation_status: clean(manifest.script_generation_status) || "approved",
        script_review_reason: clean(manifest.script_review_reason),
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
  "title",
  "primary_source",
  "primary_source_name",
  "source_card_label",
  "thumbnail_source_label",
  "source_timestamp",
  "source_published_at",
  "primary_source_published_at",
  "source_age_policy_hours",
  "selected_title",
  "short_title",
  "canonical_title",
  "suggested_title",
  "canonical_subject",
  "canonical_game",
  "canonical_company",
  "full_script",
  "narration_script",
  "tts_script",
  "first_spoken_line",
  "narration_hook",
  "suggested_thumbnail_text",
  "thumbnail_text",
  "thumbnail_headline",
  "description",
  "pinned_comment",
  "claim_inventory",
  "duration_lane",
  "duration_strategy",
  "duration_contract_strategy",
  "duration_variant_repair_strategy",
  "duration_variant_target_duration_seconds",
  "confirmed_claims",
  "unconfirmed_claims",
  "prohibited_claims",
  "allowed_public_wording",
  "script_generation_status",
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
  "duration_lane",
  "duration_strategy",
  "duration_contract_strategy",
  "duration_variant_repair_strategy",
  "duration_variant_target_duration_seconds",
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

  return clearStaleScriptReviewStateFromCanonicalPackage(merged, canonicalStory);
}

function canonicalHasApprovedScript(canonicalStory = {}) {
  const script = clean(
    canonicalStory.full_script ||
      canonicalStory.narration_script ||
      canonicalStory.tts_script ||
      canonicalStory.first_spoken_line,
  );
  if (!script) return false;
  const status = clean(canonicalStory.script_generation_status);
  return status !== "review_required";
}

function clearStaleScriptReviewStateFromCanonicalPackage(merged = {}, canonicalStory = {}) {
  if (!canonicalHasApprovedScript(canonicalStory)) return merged;

  const canonicalStatus = clean(canonicalStory.script_generation_status);
  if (canonicalStatus) {
    merged.script_generation_status = canonicalStatus;
  } else if (clean(merged.script_generation_status) === "review_required") {
    merged.script_generation_status = "approved";
  }

  const canonicalReviewReason = clean(canonicalStory.script_review_reason);
  if (canonicalReviewReason) {
    merged.script_review_reason = canonicalReviewReason;
  } else {
    merged.script_review_reason = "";
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
  const actionDescription = clean(action.description);
  const actionCaption = clean(action.caption || action.page_caption || action.description);
  const actionPageCaption = clean(action.page_caption || action.caption || action.description);
  const actionCoverHeadline = clean(action.cover_headline || action.thumbnail_headline || action.first_frame_text);
  const storyDurationTarget =
    story.duration_variant_target_duration_seconds &&
    typeof story.duration_variant_target_duration_seconds === "object"
      ? story.duration_variant_target_duration_seconds
      : {};
  const actionDuration = finiteNumberOrNull(
    action.video_duration_s ?? action.video_duration_seconds ?? action.duration_seconds ?? action.duration_s,
  );
  const actionDurationText = [
    action.duration_lane,
    action.duration_strategy,
    action.render_lane,
    action.format_lane,
  ].map(clean).join(" ");
  const actionDurationLane =
    clean(action.duration_lane) ||
    (actionDurationText.toLowerCase().includes(NORMAL_PRODUCTION_DURATION_LANE)
      ? NORMAL_PRODUCTION_DURATION_LANE
      : "");
  const normalProductionLane =
    actionDurationLane === NORMAL_PRODUCTION_DURATION_LANE ||
    clean(story.duration_lane) === NORMAL_PRODUCTION_DURATION_LANE;
  const actionForbidsAffiliateLinks =
    action.suppress_affiliate_links === true ||
    action.affiliate_links_allowed === false ||
    (
      action.commercial_promotion === false &&
      action.disclosure_status?.required === false
    );
  return {
    ...story,
    exported_path: clean(action.video_path) || story.exported_path,
    story_image_path: clean(action.story_image_path || action.image_path) || story.story_image_path,
    captions_path: clean(action.captions_path) || story.captions_path,
    duration_seconds: actionDuration ?? story.duration_seconds,
    runtime_seconds: actionDuration ?? story.runtime_seconds,
    duration_lane: actionDurationLane || story.duration_lane,
    min_video_duration_seconds:
      finiteNumberOrNull(action.min_video_duration_seconds) ??
      finiteNumberOrNull(action.target_video_duration_seconds_min) ??
      finiteNumberOrNull(story.min_video_duration_seconds) ??
      finiteNumberOrNull(story.target_video_duration_seconds_min) ??
      finiteNumberOrNull(storyDurationTarget.min) ??
      (normalProductionLane ? DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS : story.min_video_duration_seconds),
    target_video_duration_seconds_min:
      finiteNumberOrNull(action.target_video_duration_seconds_min) ??
      finiteNumberOrNull(story.target_video_duration_seconds_min) ??
      finiteNumberOrNull(storyDurationTarget.min) ??
      (normalProductionLane ? DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS : story.target_video_duration_seconds_min),
    target_video_duration_seconds_max:
      finiteNumberOrNull(action.target_video_duration_seconds_max) ??
      finiteNumberOrNull(story.target_video_duration_seconds_max) ??
      finiteNumberOrNull(storyDurationTarget.max) ??
      (normalProductionLane ? DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS : story.target_video_duration_seconds_max),
    max_video_duration_seconds:
      finiteNumberOrNull(action.max_video_duration_seconds) ??
      finiteNumberOrNull(action.target_video_duration_seconds_max) ??
      finiteNumberOrNull(story.max_video_duration_seconds) ??
      finiteNumberOrNull(story.target_video_duration_seconds_max) ??
      finiteNumberOrNull(storyDurationTarget.max) ??
      (normalProductionLane ? DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS : story.max_video_duration_seconds),
    description: actionDescription || story.description,
    platform_caption: actionCaption || story.platform_caption,
    youtube_description: actionDescription || story.youtube_description,
    instagram_caption: clean(action.caption) || story.instagram_caption,
    facebook_page_caption: actionPageCaption || story.facebook_page_caption,
    suggested_thumbnail_text: actionCoverHeadline || story.suggested_thumbnail_text,
    thumbnail_text: actionCoverHeadline || story.thumbnail_text,
    thumbnail_headline: actionCoverHeadline || story.thumbnail_headline,
    suppress_affiliate_links:
      actionForbidsAffiliateLinks === true
        ? true
        : story.suppress_affiliate_links,
    affiliate_links_allowed:
      actionForbidsAffiliateLinks === true
        ? false
        : story.affiliate_links_allowed,
    commercial_promotion:
      typeof action.commercial_promotion === "boolean"
        ? action.commercial_promotion
        : story.commercial_promotion,
    disclosure_status:
      action.disclosure_status &&
      typeof action.disclosure_status === "object"
        ? action.disclosure_status
        : story.disclosure_status,
    guarded_dispatch_action_id: actionId(action),
    guarded_dispatch_platform: clean(action.platform),
    guarded_dispatch_preflight_generated_at: clean(action.generated_at),
    first_frame_source: clean(action.first_frame_source) || story.first_frame_source,
    canonical_manifest_path: clean(action.canonical_manifest_path) || story.canonical_manifest_path,
    platform_publish_manifest_path:
      clean(action.platform_publish_manifest_path) || story.platform_publish_manifest_path,
  };
}

function resolveMaybeRelative(filePath) {
  const text = clean(filePath);
  if (!text) return "";
  return path.isAbsolute(text) ? text : path.resolve(process.cwd(), text);
}

function renderManifestCandidatesForAction(action = {}) {
  const candidates = [];
  if (clean(action.render_manifest_path)) candidates.push(action.render_manifest_path);
  for (const filePath of [
    action.canonical_manifest_path,
    action.platform_publish_manifest_path,
    action.video_path,
  ]) {
    const resolved = resolveMaybeRelative(filePath);
    if (resolved) candidates.push(path.join(path.dirname(resolved), "render_manifest.json"));
  }
  return unique(candidates.map(resolveMaybeRelative));
}

async function readRenderManifestForAction(action = {}) {
  for (const candidate of renderManifestCandidatesForAction(action)) {
    if (!candidate) continue;
    try {
      if (!await fs.pathExists(candidate)) continue;
      return {
        path: candidate,
        manifest: await fs.readJson(candidate),
      };
    } catch {
      return { path: candidate, manifest: null };
    }
  }
  return { path: "", manifest: null };
}

async function readJsonIfExists(filePath) {
  const resolved = resolveMaybeRelative(filePath);
  if (!resolved) return null;
  try {
    if (!await fs.pathExists(resolved)) return null;
    return await fs.readJson(resolved);
  } catch {
    return null;
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normaliseSha256(value = "") {
  return clean(value).replace(/^sha256:/i, "").toLowerCase();
}

function passEvidenceVerdict(value = "") {
  return ["green", "pass", "passed", "ready", "ok"].includes(
    clean(value).toLowerCase(),
  );
}

function artifactIssueList(value = {}) {
  return unique([
    ...asArray(value.blockers),
    ...asArray(value.failures),
    ...asArray(value.errors),
  ]);
}

function normalisePathKey(value = "") {
  const text = clean(value);
  return text ? path.resolve(text).replace(/\\/g, "/").toLowerCase() : "";
}

function resolvePackageEvidencePath(artifactDir = "", value = "") {
  const text = clean(value);
  if (!text) return "";
  return path.resolve(path.isAbsolute(text) ? text : path.join(artifactDir, text));
}

async function exactFileFingerprint(filePath = "", cache = new Map()) {
  const resolved = resolveMaybeRelative(filePath);
  if (!resolved) return null;
  const key = normalisePathKey(resolved);
  if (cache.has(key)) return cache.get(key);
  const fingerprintPromise = (async () => {
    try {
      if (!await fs.pathExists(resolved)) return null;
      const bytes = await fs.readFile(resolved);
      return {
        path: path.resolve(resolved),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size_bytes: bytes.length,
      };
    } catch {
      return null;
    }
  })();
  cache.set(key, fingerprintPromise);
  return fingerprintPromise;
}

function platformRightsAliases(platform = "") {
  const key = clean(platform);
  const aliases = {
    youtube_shorts: ["youtube_shorts", "youtube"],
    instagram_reels: ["instagram_reels", "instagram_reel", "instagram"],
    facebook_reels: ["facebook_reels", "facebook_reel", "facebook"],
    tiktok: ["tiktok"],
    x: ["x", "twitter", "twitter_video"],
  };
  return new Set(
    asArray(aliases[key] || [key]).map((value) => clean(value).toLowerCase()),
  );
}

function rightsLedgerRecords(value = {}) {
  if (Array.isArray(value)) return value.filter(Boolean);
  const ledger = objectValue(value);
  return [
    ...asArray(ledger.records),
    ...asArray(ledger.assets),
    ...asArray(ledger.rights_ledger),
  ];
}

function visualSelectedInputAsset(asset = {}) {
  return /(?:image|screenshot|still|visual|artwork|photo)/i.test(
    clean(asset.kind || asset.asset_type || asset.role),
  );
}

function selectedInputRightsRecordValid({
  record = {},
  asset = {},
  platform = "",
} = {}) {
  const allowedPlatforms = new Set(
    asArray(record.allowed_platforms).map((value) => clean(value).toLowerCase()),
  );
  const targetAliases = platformRightsAliases(platform);
  const platformAllowed = [...targetAliases].some((value) => allowedPlatforms.has(value));
  return Boolean(
    clean(record.asset_id || record.id) === clean(asset.asset_id || asset.id) &&
      normaliseSha256(record.asset_sha256) === normaliseSha256(asset.asset_sha256) &&
      Number(record.asset_size_bytes || 0) === Number(asset.asset_size_bytes || 0) &&
      record.commercial_use_allowed === true &&
      record.rights_grant === true &&
      record.live_publish_allowed === true &&
      record.requires_human_review_before_live_publish !== true &&
      /approved|green|pass/i.test(
        clean(record.approval_status || record.verdict || record.status),
      ) &&
      platformAllowed
  );
}

function exactTemporalValidationBlockers({
  temporal = {},
  storyId = "",
  renderFingerprint = null,
} = {}) {
  const blockers = [];
  const validation = objectValue(temporal.validation);
  const reconciliation = objectValue(validation.repeat_reconciliation);
  if (clean(temporal.story_id) !== clean(storyId)) {
    blockers.push("exact_temporal_story_id_mismatch");
  }
  if (
    !passEvidenceVerdict(temporal.verdict || temporal.status) ||
    temporal.can_publish !== true ||
    artifactIssueList(temporal).length
  ) {
    blockers.push("exact_temporal_verdict_not_green");
  }
  if (
    !renderFingerprint ||
    normaliseSha256(temporal.final_media?.sha256) !== renderFingerprint.sha256 ||
    Number(temporal.final_media?.size_bytes || 0) !== renderFingerprint.size_bytes
  ) {
    blockers.push("exact_temporal_render_fingerprint_mismatch");
  }
  for (const [field, expected] of Object.entries({
    present: true,
    render_hash_matches: true,
    render_size_matches: true,
    decode_complete: true,
    video_stream_decoded: true,
    audio_stream_decoded: true,
    temporal_scan_complete: true,
    choppy_cadence: false,
    local_stall_detected: false,
    center_crop_scan_complete: true,
    center_crop_choppy_cadence: false,
    center_crop_local_stall_detected: false,
  })) {
    if (validation[field] !== expected) {
      blockers.push(`exact_temporal_validation_${field}_invalid`);
    }
  }
  if (
    Number(temporal.evidence?.temporal?.sample_fps || 0) < 2 ||
    Number(validation.sampled_frame_count || 0) <= 0 ||
    Number(validation.temporal_coverage_ratio || 0) < 0.95 ||
    Number(validation.center_crop_coverage_ratio || 0) < 0.95 ||
    Number(validation.repeated_motion_sequence_count || 0) !== 0 ||
    Number(validation.center_crop_repeated_motion_sequence_count || 0) !== 0 ||
    reconciliation.clean_cadence !== true ||
    reconciliation.blocking_repeat_detected === true
  ) {
    blockers.push("exact_temporal_coverage_or_repeat_invalid");
  }
  return unique(blockers);
}

async function exactCurrentActionQualityAuthority({
  story = {},
  action = {},
  options = {},
} = {}) {
  const blockers = [];
  const videoPath = resolveMaybeRelative(action.video_path || story.exported_path);
  const platformPublishManifestPath = resolveMaybeRelative(
    action.platform_publish_manifest_path || story.platform_publish_manifest_path,
  );
  const artifactDir = platformPublishManifestPath
    ? path.dirname(platformPublishManifestPath)
    : videoPath
      ? path.dirname(videoPath)
      : "";
  const storyId = clean(action.story_id || story.id || story.story_id);
  const platform = clean(action.platform);
  const fingerprintCache = new Map();
  if (!videoPath) blockers.push("exact_authority_video_path_missing");
  if (!artifactDir) blockers.push("exact_authority_artifact_dir_missing");
  if (!storyId) blockers.push("exact_authority_story_id_missing");
  if (!platform) blockers.push("exact_authority_platform_missing");

  const invalidResult = () => {
    const uniqueBlockers = unique(blockers);
    return {
      valid: false,
      blockers: uniqueBlockers,
      selected_visual_deck: [],
      evidence: { valid: false, blockers: uniqueBlockers },
    };
  };
  if (blockers.length) return invalidResult();

  const [publishVerdict, renderManifest, rightsLedger, temporal, platformPublishManifest] =
    await Promise.all([
      readJsonIfExists(path.join(artifactDir, "publish_verdict.json")),
      readJsonIfExists(path.join(artifactDir, "render_manifest.json")),
      readJsonIfExists(path.join(artifactDir, "rights_ledger.json")),
      readJsonIfExists(path.join(artifactDir, "temporal_video_qa_report.json")),
      readJsonIfExists(
        platformPublishManifestPath ||
          path.join(artifactDir, "platform_publish_manifest.json"),
      ),
    ]);
  if (!publishVerdict) blockers.push("exact_authority_publish_verdict_missing");
  if (!renderManifest) blockers.push("exact_authority_render_manifest_missing");
  if (!rightsLedger) blockers.push("exact_authority_rights_ledger_missing");
  if (!temporal) blockers.push("exact_authority_temporal_report_missing");
  if (blockers.length) return invalidResult();

  const authority = objectValue(publishVerdict.authority_refresh);
  const frozen = objectValue(authority.frozen_hashes);
  if (
    clean(publishVerdict.story_id) !== storyId ||
    !passEvidenceVerdict(publishVerdict.verdict || publishVerdict.status) ||
    publishVerdict.can_auto_publish !== true ||
    artifactIssueList(publishVerdict).length ||
    authority.source !== "current_independently_verified_artifact_evidence" ||
    authority.monotonic_verdict !== true
  ) {
    blockers.push("exact_authority_publish_verdict_invalid");
  }
  const platformScope = objectValue(authority.platform_scope);
  const enabledPlatforms = new Set(
    asArray(platformScope.enabled_platforms).map((value) => clean(value).toLowerCase()),
  );
  if (!enabledPlatforms.has(platform.toLowerCase())) {
    blockers.push("exact_authority_platform_not_enabled");
  }
  if (
    asArray(platformScope.disabled_platforms)
      .map((value) => clean(value).toLowerCase())
      .includes(platform.toLowerCase())
  ) {
    blockers.push("exact_authority_platform_explicitly_disabled");
  }

  const exactFingerprints = {};
  for (const key of ["render", "audio", "timestamps", "rights", "temporal_qa_report"]) {
    const expected = objectValue(frozen[key]);
    const expectedPath = resolvePackageEvidencePath(artifactDir, expected.path);
    const actual = await exactFileFingerprint(expectedPath, fingerprintCache);
    exactFingerprints[key] = actual;
    if (
      !actual ||
      normaliseSha256(expected.sha256) !== actual.sha256 ||
      Number(expected.size_bytes || 0) !== actual.size_bytes
    ) {
      blockers.push(`exact_authority_fingerprint_mismatch:${key}`);
    }
  }

  const renderFingerprint = exactFingerprints.render;
  const actionVideoFingerprint = await exactFileFingerprint(videoPath, fingerprintCache);
  const actionUsesApprovedMaster =
    Boolean(renderFingerprint && actionVideoFingerprint) &&
    normalisePathKey(renderFingerprint.path) === normalisePathKey(actionVideoFingerprint.path);
  let derivedPlatformVariant = {
    applicable: false,
    valid: false,
    platform,
  };

  if (actionUsesApprovedMaster) {
    if (
      clean(action.video_sha256) &&
      normaliseSha256(action.video_sha256) !== renderFingerprint?.sha256
    ) {
      blockers.push("exact_authority_action_render_sha256_mismatch");
    }
    if (
      finiteNumberOrNull(action.video_size_bytes) !== null &&
      finiteNumberOrNull(action.video_size_bytes) !== renderFingerprint?.size_bytes
    ) {
      blockers.push("exact_authority_action_render_size_mismatch");
    }
  } else {
    const variantPolicy = GOVERNED_DERIVED_VIDEO_VARIANT_PROFILES[platform];
    const platformOutput = objectValue(platformPublishManifest?.outputs?.[platform]);
    const receipt = objectValue(platformOutput.platform_variant_render);
    const receiptSourcePath = resolvePackageEvidencePath(
      artifactDir,
      receipt.source_video_path,
    );
    const receiptOutputPath = resolvePackageEvidencePath(
      artifactDir,
      receipt.output_path,
    );
    const outputVariantPath = resolvePackageEvidencePath(
      artifactDir,
      platformOutput.variant_video_path,
    );
    const receiptCaptionsPath = resolvePackageEvidencePath(
      artifactDir,
      receipt.captions_path,
    );
    const outputCaptionsPath = resolvePackageEvidencePath(
      artifactDir,
      platformOutput.variant_captions_path,
    );
    const actionCaptionsPath = resolveMaybeRelative(action.captions_path);
    const actionCaptionsFingerprint = await exactFileFingerprint(
      actionCaptionsPath,
      fingerprintCache,
    );
    const sourceDuration = finiteNumberOrNull(receipt.source_duration_s);
    const outputDuration = finiteNumberOrNull(receipt.duration_s);
    const approvedMasterDuration = finiteNumberOrNull(
      renderManifest.rendered_duration_s || renderManifest.duration_seconds,
    );
    const variantBlockers = [];

    if (!variantPolicy) {
      variantBlockers.push("platform_not_governed_for_derived_variant");
    }
    if (
      clean(platformPublishManifest?.story_id) !== storyId ||
      clean(receipt.story_id) !== storyId ||
      clean(receipt.platform) !== platform
    ) {
      variantBlockers.push("story_or_platform_mismatch");
    }
    if (
      !passEvidenceVerdict(receipt.status) ||
      clean(receipt.producer_id) !== "pulse-goal-platform-variant-materializer" ||
      clean(receipt.transformation_mode) !== "transcode" ||
      receipt.passthrough_approved !== false
    ) {
      variantBlockers.push("producer_or_transformation_invalid");
    }
    if (
      !variantPolicy ||
      clean(receipt.encoder_profile) !== variantPolicy.encoder_profile
    ) {
      variantBlockers.push("encoder_profile_invalid");
    }
    if (
      !renderFingerprint ||
      normalisePathKey(receiptSourcePath) !== normalisePathKey(renderFingerprint.path) ||
      normaliseSha256(receipt.source_video_sha256) !== renderFingerprint?.sha256 ||
      finiteNumberOrNull(receipt.source_video_size_bytes) !== renderFingerprint?.size_bytes
    ) {
      variantBlockers.push("approved_master_binding_invalid");
    }
    if (
      !actionVideoFingerprint ||
      normalisePathKey(receiptOutputPath) !== normalisePathKey(actionVideoFingerprint?.path) ||
      normalisePathKey(outputVariantPath) !== normalisePathKey(actionVideoFingerprint?.path) ||
      normaliseSha256(receipt.output_sha256) !== actionVideoFingerprint?.sha256 ||
      finiteNumberOrNull(receipt.output_size_bytes) !== actionVideoFingerprint?.size_bytes ||
      (
        clean(action.video_sha256) &&
        normaliseSha256(action.video_sha256) !== actionVideoFingerprint?.sha256
      ) ||
      (
        finiteNumberOrNull(action.video_size_bytes) !== null &&
        finiteNumberOrNull(action.video_size_bytes) !== actionVideoFingerprint?.size_bytes
      )
    ) {
      variantBlockers.push("derived_output_fingerprint_invalid");
    }
    if (
      !actionCaptionsFingerprint ||
      normalisePathKey(receiptCaptionsPath) !== normalisePathKey(actionCaptionsPath) ||
      normalisePathKey(outputCaptionsPath) !== normalisePathKey(actionCaptionsPath)
    ) {
      variantBlockers.push("derived_captions_binding_invalid");
    }
    if (
      approvedMasterDuration === null ||
      sourceDuration === null ||
      outputDuration === null ||
      Math.abs(sourceDuration - approvedMasterDuration) > 0.25 ||
      outputDuration < (variantPolicy?.min_duration_s || Number.POSITIVE_INFINITY) ||
      outputDuration > (variantPolicy?.max_duration_s || Number.NEGATIVE_INFINITY) ||
      Math.abs(outputDuration - sourceDuration) > 1
    ) {
      variantBlockers.push("derived_duration_invalid");
    }

    derivedPlatformVariant = {
      applicable: true,
      valid: variantBlockers.length === 0,
      platform,
      blockers: unique(variantBlockers),
      producer_id: clean(receipt.producer_id) || null,
      encoder_profile: clean(receipt.encoder_profile) || null,
      approved_master_sha256: renderFingerprint?.sha256 || null,
      output_sha256: actionVideoFingerprint?.sha256 || null,
      output_size_bytes: actionVideoFingerprint?.size_bytes || null,
      captions_size_bytes: actionCaptionsFingerprint?.size_bytes || null,
      source_duration_s: sourceDuration,
      duration_s: outputDuration,
    };
    if (variantBlockers.length) {
      blockers.push(
        ...variantBlockers.map(
          (blocker) => `exact_authority_derived_platform_variant_invalid:${blocker}`,
        ),
      );
    }
  }

  const renderOutputPath = resolvePackageEvidencePath(
    artifactDir,
    renderManifest.output_path ||
      renderManifest.final_mp4_path ||
      renderManifest.exported_path ||
      renderManifest.output,
  );
  if (
    clean(renderManifest.story_id) !== storyId ||
    renderManifest.final_publish_render !== true ||
    !/hyperframes/i.test(
      clean(
        renderManifest.renderer ||
          renderManifest.engine ||
          renderManifest.source_renderer_engine,
      ),
    ) ||
    !renderOutputPath ||
    normalisePathKey(renderOutputPath) !== normalisePathKey(renderFingerprint?.path)
  ) {
    blockers.push("exact_authority_final_render_manifest_invalid");
  }

  const selected = objectValue(renderManifest.selected_input_assets);
  const selectedAssets = asArray(selected.assets);
  const visualAssets = selectedAssets.filter(visualSelectedInputAsset);
  if (
    selected.authoritative !== true ||
    selected.complete !== true ||
    artifactIssueList(selected).length ||
    Number(selected.asset_count || 0) !== selectedAssets.length ||
    visualAssets.length < 4
  ) {
    blockers.push("exact_authority_selected_inputs_invalid");
  }

  const selectedVisualDeck = [];
  const rightsRecords = rightsLedgerRecords(rightsLedger);
  const canonicalVisualIds = new Set(
    asArray(renderManifest.input_evidence?.hyperframes?.canonical_visual_asset_ids)
      .map((value) => clean(value)),
  );
  for (const asset of visualAssets) {
    const assetId = clean(asset.asset_id || asset.id);
    const assetPath = resolvePackageEvidencePath(artifactDir, asset.path || asset.local_path);
    const fingerprint = await exactFileFingerprint(assetPath, fingerprintCache);
    const matchingRightsRecords = rightsRecords.filter(
      (record) => clean(record.asset_id || record.id) === assetId,
    );
    if (
      !assetId ||
      asset.subject_match !== true ||
      !fingerprint ||
      normaliseSha256(asset.asset_sha256) !== fingerprint?.sha256 ||
      Number(asset.asset_size_bytes || 0) !== fingerprint?.size_bytes ||
      !canonicalVisualIds.has(assetId) ||
      matchingRightsRecords.length !== 1 ||
      !selectedInputRightsRecordValid({
        record: matchingRightsRecords[0],
        asset,
        platform,
      })
    ) {
      blockers.push(`exact_authority_selected_visual_invalid:${assetId || "missing"}`);
      continue;
    }
    selectedVisualDeck.push({
      path: fingerprint.path,
      type: clean(asset.kind || asset.asset_type || "screenshot"),
      source: "authoritative_final_render_input",
      source_type: clean(asset.kind || asset.asset_type || "screenshot"),
      asset_id: assetId,
      asset_sha256: fingerprint.sha256,
      asset_size_bytes: fingerprint.size_bytes,
      source_url: clean(asset.source_url),
      subject_match: true,
      thumbnail_safety_warnings: [],
    });
  }
  if (
    !passEvidenceVerdict(rightsLedger.verdict || rightsLedger.status) ||
    rightsLedger.can_auto_publish !== true ||
    clean(rightsLedger.story_id) !== storyId ||
    artifactIssueList(rightsLedger).length ||
    selectedVisualDeck.length !== visualAssets.length
  ) {
    blockers.push("exact_authority_selected_visual_rights_invalid");
  }

  const scenePlan = objectValue(renderManifest.clip_scene_plan);
  const decodedGate = objectValue(renderManifest.decoded_visual_gate);
  const hyperframesInput = objectValue(renderManifest.input_evidence?.hyperframes);
  const adoption = objectValue(renderManifest.hyperframes_adoption_evidence);
  if (
    !/hyperframes/i.test(clean(scenePlan.renderer)) ||
    scenePlan.repeat_free !== true ||
    Number(scenePlan.scene_count || 0) < 4 ||
    Number(scenePlan.placement_count || 0) <= 0 ||
    Number(scenePlan.placement_count || 0) !==
      Number(scenePlan.verified_placement_count || -1) ||
    Number(scenePlan.unique_visual_asset_count || 0) !== visualAssets.length ||
    !passEvidenceVerdict(scenePlan.temporal_qa_verdict)
  ) {
    blockers.push("exact_authority_hyperframes_scene_plan_invalid");
  }
  if (
    !passEvidenceVerdict(decodedGate.verdict || decodedGate.status) ||
    decodedGate.can_publish !== true ||
    normaliseSha256(decodedGate.render_sha256) !== renderFingerprint?.sha256 ||
    Number(decodedGate.render_size_bytes || 0) !== renderFingerprint?.size_bytes
  ) {
    blockers.push("exact_authority_decoded_visual_gate_invalid");
  }
  if (
    !/^[a-f0-9]{64}$/i.test(normaliseSha256(hyperframesInput.composition_sha256)) ||
    !passEvidenceVerdict(hyperframesInput.rights_sidecar_verdict)
  ) {
    blockers.push("exact_authority_hyperframes_composition_or_rights_invalid");
  }
  const adoptionPlatforms = new Set(
    asArray(adoption.enabled_platforms).map((value) => clean(value).toLowerCase()),
  );
  if (
    normaliseSha256(adoption.final_render_sha256) !== renderFingerprint?.sha256 ||
    Number(adoption.final_render_size_bytes || 0) !== renderFingerprint?.size_bytes ||
    !passEvidenceVerdict(adoption.human_av_review_verdict) ||
    !passEvidenceVerdict(adoption.temporal_video_qa_verdict) ||
    !passEvidenceVerdict(adoption.rights_placement_verdict) ||
    !adoptionPlatforms.has(platform.toLowerCase())
  ) {
    blockers.push("exact_authority_hyperframes_adoption_invalid");
  }

  blockers.push(
    ...exactTemporalValidationBlockers({
      temporal,
      storyId,
      renderFingerprint,
    }),
  );

  const validateFinalAvReviewFile =
    options.validateFinalAvReviewFile ||
    require("./goal-final-av-review").validateFinalAvReviewFile;
  try {
    const finalAv = await validateFinalAvReviewFile(
      path.join(artifactDir, "final_av_review.json"),
      {
        storyId,
        artifactDir,
        finalMp4Path: renderFingerprint?.path,
      },
    );
    const finalAvEvidence = objectValue(finalAv.evidence);
    if (
      finalAv.valid !== true ||
      !passEvidenceVerdict(finalAv.verdict || finalAv.status) ||
      finalAv.can_auto_publish !== true ||
      artifactIssueList(finalAv).length ||
      finalAvEvidence.fingerprints_verified !== true ||
      finalAvEvidence.final_mp4_matches_current_render !== true ||
      finalAvEvidence.contact_sheet_binding?.bound_to_current_media !== true ||
      finalAvEvidence.decoded_forensic_report_valid !== true ||
      finalAvEvidence.reviewer_independent !== true ||
      finalAvEvidence.reviewer_trusted !== true ||
      !["full_watch", "full_listen", "av_sync", "caption_readability", "subject_match"]
        .every((field) => finalAvEvidence.attestations?.[field] === true)
    ) {
      blockers.push("exact_authority_final_av_review_invalid");
    }
  } catch {
    blockers.push("exact_authority_final_av_review_invalid");
  }

  const uniqueBlockers = unique(blockers);
  return {
    valid: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    selected_visual_deck: uniqueBlockers.length ? [] : selectedVisualDeck,
    evidence: {
      valid: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      render_sha256: renderFingerprint?.sha256 || null,
      render_size_bytes: renderFingerprint?.size_bytes || null,
      temporal_report_sha256: exactFingerprints.temporal_qa_report?.sha256 || null,
      rights_ledger_sha256: exactFingerprints.rights?.sha256 || null,
      selected_visual_asset_count: visualAssets.length,
      selected_visual_rights_count: selectedVisualDeck.length,
      temporal_sample_fps: temporal.evidence?.temporal?.sample_fps ?? null,
      final_av_review: uniqueBlockers.includes("exact_authority_final_av_review_invalid")
        ? "invalid"
        : "GREEN",
      platform,
      derived_platform_variant: derivedPlatformVariant,
    },
  };
}

function reconcileQualityResultAliases(result = {}, pattern, authorityEvidence = {}) {
  const sourceFailures = asArray(result.failures || result.blockers)
    .map(clean)
    .filter(Boolean);
  const superseded = sourceFailures.filter((failure) => pattern.test(failure));
  if (!superseded.length) return result;
  const supersededSet = new Set(superseded);
  const remaining = sourceFailures.filter((failure) => !supersededSet.has(failure));
  return {
    ...result,
    result: remaining.length ? "fail" : "pass",
    failures: remaining,
    blockers: remaining,
    evidence: {
      ...(result.evidence || {}),
      reconciliation: "exact_hash_bound_current_final_authority",
      superseded_stale_alias_failures: superseded,
      exact_current_quality_authority: authorityEvidence,
    },
  };
}

function packageDirsForAction(action = {}, renderManifestPath = "") {
  const dirs = [];
  for (const filePath of [
    renderManifestPath,
    action.video_path,
    action.captions_path,
    action.canonical_manifest_path,
    action.platform_publish_manifest_path,
  ]) {
    const resolved = resolveMaybeRelative(filePath);
    if (resolved) dirs.push(path.dirname(resolved));
  }
  return unique(dirs);
}

async function readCurrentPackageEvidence(action = {}, renderManifestPath = "") {
  const dirs = packageDirsForAction(action, renderManifestPath);
  let captionManifest = null;
  let captionManifestPath = "";
  let platformPublishManifest = null;
  let platformPublishManifestPath = clean(action.platform_publish_manifest_path);

  for (const dir of dirs) {
    if (!captionManifest) {
      const candidate = path.join(dir, "caption_manifest.json");
      captionManifest = await readJsonIfExists(candidate);
      if (captionManifest) captionManifestPath = candidate;
    }
    if (!platformPublishManifest) {
      const candidate = path.join(dir, "platform_publish_manifest.json");
      platformPublishManifest = await readJsonIfExists(candidate);
      if (platformPublishManifest) platformPublishManifestPath = candidate;
    }
  }

  if (!platformPublishManifest && platformPublishManifestPath) {
    platformPublishManifest = await readJsonIfExists(platformPublishManifestPath);
  }

  return {
    captionManifest,
    captionManifestPath,
    platformPublishManifest,
    platformPublishManifestPath,
  };
}

async function readPackageJsonEvidence(action = {}, renderManifestPath = "", fileName = "") {
  const cleanFileName = clean(fileName);
  if (!cleanFileName) return null;
  for (const dir of packageDirsForAction(action, renderManifestPath)) {
    const candidate = path.join(dir, cleanFileName);
    const evidence = await readJsonIfExists(candidate);
    if (evidence && typeof evidence === "object") return evidence;
  }
  return null;
}

function visualCadenceClipEvidence(...clipLists) {
  return clipLists.flatMap((list) => asArray(list));
}

async function defaultVisualCadenceQa(story = {}, action = {}) {
  const {
    clipScenePlanVisualCadenceEvidence,
    directMotionBaseSourceOveruseEvidence,
    directMotionSubjectMismatchEvidence,
    finalRenderVisualReuseEvidence,
    hyperframesReadableDwellEvidence,
    repeatedDirectMotionSegmentBlockers,
    repeatedDirectMotionSegmentEvidence,
  } = require("./goal-dry-run-publisher");

  const renderManifest = story.render_manifest && typeof story.render_manifest === "object"
    ? story.render_manifest
    : {};
  const renderManifestPath = clean(story.render_manifest_path);
  const [
    canonicalArtifact,
    renderStoryArtifact,
    directorArtifact,
    ownedMotionArtifact,
    materialisedMotionArtifact,
  ] = await Promise.all([
    readJsonIfExists(action.canonical_manifest_path),
    readPackageJsonEvidence(action, renderManifestPath, "visual_v4_render_story.json"),
    readPackageJsonEvidence(action, renderManifestPath, "director_beat_map.json"),
    readPackageJsonEvidence(action, renderManifestPath, "owned_motion_manifest.json"),
    readPackageJsonEvidence(action, renderManifestPath, "materialised_motion_clips.json"),
  ]);
  const canonicalStory = canonicalArtifact && typeof canonicalArtifact === "object"
    ? { ...canonicalArtifact, ...story }
    : story;

  const renderStory = renderStoryArtifact && typeof renderStoryArtifact === "object"
    ? renderStoryArtifact
    : {
        video_clips: story.video_clips,
        visual_v4_bridge_video_clips: story.visual_v4_bridge_video_clips,
        clips: story.clips,
      };
  const directorBeatMap = directorArtifact && typeof directorArtifact === "object"
    ? directorArtifact
    : story.director_beat_map || story.visual_v4_director_plan || story.director_plan || {};
  const materialisedMotion = visualCadenceClipEvidence(
    story.materialised_motion_clips,
    story.motion_clips,
    ownedMotionArtifact?.materialised_clips,
    ownedMotionArtifact?.clips,
    ownedMotionArtifact?.assets,
    Array.isArray(materialisedMotionArtifact)
      ? materialisedMotionArtifact
      : materialisedMotionArtifact?.clips,
    materialisedMotionArtifact?.materialised_clips,
  );
  const finalRenderMotionEvidence = visualCadenceClipEvidence(
    renderStory.visual_v4_bridge_video_clips,
    renderStory.video_clips,
    renderStory.clips,
  );
  const directMotionSegmentEvidenceSource = finalRenderMotionEvidence.length >= 2
    ? finalRenderMotionEvidence
    : visualCadenceClipEvidence(materialisedMotion, finalRenderMotionEvidence);

  const finalRenderVisualReuse = finalRenderVisualReuseEvidence({ renderManifest, renderStory });
  const hyperframesReadableDwell = hyperframesReadableDwellEvidence({
    renderManifest,
    renderStory,
    directorBeatMap,
  });
  const clipScenePlanVisualCadence = clipScenePlanVisualCadenceEvidence(renderManifest);
  const repeatedDirectMotionSegments = repeatedDirectMotionSegmentEvidence(directMotionSegmentEvidenceSource);
  const directMotionBaseSourceOveruse = directMotionBaseSourceOveruseEvidence(directMotionSegmentEvidenceSource);
  const directMotionSubjectMismatch = directMotionSubjectMismatchEvidence(directMotionSegmentEvidenceSource, {
    story: canonicalStory,
    action,
    renderManifest,
    renderStory,
  });
  const blockers = unique([
    ...asArray(finalRenderVisualReuse.blockers),
    ...asArray(hyperframesReadableDwell.blockers),
    ...asArray(clipScenePlanVisualCadence.blockers),
    ...asArray(repeatedDirectMotionSegmentBlockers(directMotionSegmentEvidenceSource)),
    ...asArray(directMotionBaseSourceOveruse.blockers),
    ...asArray(directMotionSubjectMismatch.blockers),
  ]);

  return {
    result: blockers.length ? "fail" : "pass",
    failures: blockers,
    warnings: [],
    evidence: {
      ...(finalRenderVisualReuse.evidence || {}),
      ...(hyperframesReadableDwell.evidence || {}),
      ...(clipScenePlanVisualCadence.evidence || {}),
      repeated_direct_motion_segment_count: repeatedDirectMotionSegments.length,
      repeated_direct_motion_segments: repeatedDirectMotionSegments,
      ...(directMotionBaseSourceOveruse.evidence || {}),
      ...(directMotionSubjectMismatch.evidence || {}),
    },
  };
}

function normaliseTextKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textContainsSubject(text, subject) {
  const haystack = normaliseTextKey(text);
  const needle = normaliseTextKey(subject);
  if (!needle || needle === "this story") return true;
  if (!haystack) return false;
  if (haystack.includes(needle)) return true;
  return needle
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !["the", "and", "with"].includes(token))
    .some((token) => haystack.includes(token));
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function platformOutputForAction(platformPublishManifest = {}, action = {}) {
  const platform = clean(action.platform);
  const manifest =
    platformPublishManifest && typeof platformPublishManifest === "object"
      ? platformPublishManifest
      : {};
  const outputs = manifest.outputs || {};
  if (platform && outputs[platform]) return outputs[platform];
  return {};
}

function subjectRichThumbnailText({
  story = {},
  action = {},
  snapshot = {},
  platformPublishManifest = {},
} = {}) {
  const canonicalSubject = clean(
    story.canonical_subject ||
      story.canonical_game ||
      snapshot.canonical_subject ||
      snapshot.canonical_game,
  );
  const platformOutput = platformOutputForAction(platformPublishManifest, action);
  const cover = platformOutput.cover_frame || {};
  const coverSubject = clean(cover.subject || canonicalSubject);
  const coverHeadline = clean(cover.headline || cover.thumbnail_headline);
  const existing = clean(story.suggested_thumbnail_text || story.thumbnail_text || story.thumbnail_headline);
  const snapshotText = clean(snapshot.thumbnail_headline || snapshot.thumbnail_text);

  const candidates = [];
  if (coverSubject && coverHeadline && !textContainsSubject(coverHeadline, coverSubject)) {
    candidates.push(`${coverSubject} ${coverHeadline}`);
  }
  if (canonicalSubject && existing && !textContainsSubject(existing, canonicalSubject)) {
    candidates.push(`${canonicalSubject} ${existing}`);
  }
  if (canonicalSubject && snapshotText && !textContainsSubject(snapshotText, canonicalSubject)) {
    candidates.push(`${canonicalSubject} ${snapshotText}`);
  }
  candidates.push(existing, snapshotText, coverHeadline);

  const subject = canonicalSubject || coverSubject;
  const subjectRich = candidates
    .map(clean)
    .filter(Boolean)
    .filter((candidate) => wordCount(candidate) <= 8)
    .find((candidate) => textContainsSubject(candidate, subject));
  if (subjectRich) return subjectRich;
  const compact = candidates
    .map(clean)
    .filter(Boolean)
    .find((candidate) => wordCount(candidate) <= 8);
  return compact || candidates.map(clean).find(Boolean) || "";
}

function captionManifestIsClean(captionManifest = {}) {
  if (!captionManifest || typeof captionManifest !== "object") return false;
  if (asArray(captionManifest.blockers).length > 0) return false;
  const status = clean(captionManifest.status || captionManifest.verdict || "ready").toLowerCase();
  if (["blocked", "fail", "failed", "red"].includes(status)) return false;
  const checks = captionManifest.checks || {};
  if (checks.caption_file_present === false || checks.captions_well_formed === false) return false;
  if (checks.caption_word_count_available === false) return false;
  const alignment = captionManifest.timestamp_whisper_alignment || {};
  if (finiteNumberOrNull(alignment.script_inserted_actual_word_count) > 0) return false;
  if (finiteNumberOrNull(alignment.script_trailing_actual_word_count) > 0) return false;
  return Boolean(
    clean(captionManifest.resolved_caption_srt_path || captionManifest.caption_srt_path) ||
      clean(captionManifest.caption_path || captionManifest.captions_path),
  );
}

function applyCaptionManifestEvidence(story = {}, captionManifest = {}, captionManifestPath = "") {
  if (!captionManifestIsClean(captionManifest)) return story;
  const captionPath = clean(
    captionManifest.resolved_caption_srt_path ||
      captionManifest.caption_srt_path ||
      captionManifest.caption_path ||
      captionManifest.captions_path,
  );
  const captionWordCount = finiteNumberOrNull(captionManifest.word_count);
  return {
    ...story,
    caption_manifest: captionManifest,
    caption_manifest_path: clean(captionManifestPath) || story.caption_manifest_path,
    manual_caption_path: captionPath || story.manual_caption_path,
    caption_path: captionPath || story.caption_path,
    captions_path: captionPath || story.captions_path,
    clean_manual_captions: true,
    manual_caption_generated: true,
    subtitle_timing_source: "timestamps",
    subtitle_timing_inspection: {
      ...(story.subtitle_timing_inspection && typeof story.subtitle_timing_inspection === "object"
        ? story.subtitle_timing_inspection
        : {}),
      usable: true,
      reason: "current_caption_manifest",
      word_count: captionWordCount,
      source: "caption_manifest",
    },
  };
}

function renderManifestSupportsNormalProductionLane(renderManifest = {}, duration = null) {
  if (!renderManifest || typeof renderManifest !== "object") return false;
  if (renderManifest.final_publish_render !== true) return false;
  const quality = clean(renderManifest.post_render_forensic_result || renderManifest.quality_gate_status).toLowerCase();
  if (quality && !/pass|passed|green|post_render_forensics_passed/.test(quality)) return false;
  const seconds = finiteNumberOrNull(duration);
  return (
    seconds !== null &&
    seconds >= DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS &&
    seconds <= DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS
  );
}

function applyRenderManifestEvidence(story = {}, renderManifest = {}, renderManifestPath = "") {
  if (!renderManifest || typeof renderManifest !== "object") return story;
  const input = renderManifest.input_evidence || {};
  const snapshot = renderManifest.input_fingerprint?.canonical_snapshot || {};
  const duration = Number(renderManifest.rendered_duration_s || renderManifest.duration_seconds || 0);
  const normalProductionPackage = renderManifestSupportsNormalProductionLane(renderManifest, duration);
  const renderLane = clean(
    renderManifest.render_lane ||
      renderManifest.lane ||
      renderManifest.visual_tier ||
      renderManifest.renderer,
  );
  const renderQualityClass = clean(
    renderManifest.render_quality_class ||
      renderManifest.quality_class ||
      renderManifest.visual_tier ||
      (renderManifest.final_publish_render === true ? "production_v4_motion" : ""),
  );
  const audioPath = clean(
    input.narration_audio_path ||
      input.resolved_narration_audio_path ||
      story.audio_path,
  );
  const wordTimestampsPath = clean(
    input.word_timestamps_path ||
      input.resolved_word_timestamps_path ||
      story.word_timestamps_path ||
      story.timestamps_path,
  );

  return {
    ...story,
    render_manifest: renderManifest,
    render_manifest_path: clean(renderManifestPath) || story.render_manifest_path,
    render_lane: renderLane || story.render_lane,
    render_quality_class: renderQualityClass || story.render_quality_class,
    final_publish_render:
      renderManifest.final_publish_render === true || story.final_publish_render === true,
    audio_path: audioPath || story.audio_path,
    word_timestamps_path: wordTimestampsPath || story.word_timestamps_path,
    timestamps_path: wordTimestampsPath || story.timestamps_path,
    subtitle_timing_source: wordTimestampsPath ? "timestamps" : story.subtitle_timing_source,
    duration_seconds: duration || story.duration_seconds,
    runtime_seconds: duration || story.runtime_seconds,
    duration_lane:
      normalProductionPackage
        ? NORMAL_PRODUCTION_DURATION_LANE
        : story.duration_lane,
    min_video_duration_seconds:
      normalProductionPackage &&
      (
        finiteNumberOrNull(story.min_video_duration_seconds) === null ||
        finiteNumberOrNull(story.min_video_duration_seconds) > duration
      )
        ? DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS
        : story.min_video_duration_seconds,
    target_video_duration_seconds_min:
      normalProductionPackage &&
      (
        finiteNumberOrNull(story.target_video_duration_seconds_min) === null ||
        finiteNumberOrNull(story.target_video_duration_seconds_min) > duration
      )
        ? DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS
        : story.target_video_duration_seconds_min,
    target_video_duration_seconds_max:
      normalProductionPackage &&
      (
        finiteNumberOrNull(story.target_video_duration_seconds_max) === null ||
        finiteNumberOrNull(story.target_video_duration_seconds_max) > DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS
      )
        ? DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS
        : story.target_video_duration_seconds_max,
    max_video_duration_seconds:
      normalProductionPackage &&
      (
        finiteNumberOrNull(story.max_video_duration_seconds) === null ||
        finiteNumberOrNull(story.max_video_duration_seconds) > DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS
      )
        ? DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS
        : story.max_video_duration_seconds,
    full_script: clean(snapshot.narration_script) || clean(story.full_script),
    narration_script: clean(snapshot.narration_script) || clean(story.narration_script),
    tts_script: clean(snapshot.narration_script) || clean(story.tts_script),
    suggested_thumbnail_text:
      subjectRichThumbnailText({ story, snapshot }) ||
      clean(story.suggested_thumbnail_text),
    thumbnail_text:
      subjectRichThumbnailText({ story, snapshot }) ||
      clean(story.thumbnail_text),
    thumbnail_headline:
      subjectRichThumbnailText({ story, snapshot }) ||
      clean(story.thumbnail_headline),
  };
}

async function hydrateActionQualityStory(story = {}, action = {}) {
  const hydrated = storyForAction(story, action);
  const canonicalManifest = await readJsonIfExists(action.canonical_manifest_path);
  const canonicalHydrated = canonicalManifest && typeof canonicalManifest === "object"
    ? {
        ...hydrated,
        ...canonicalManifest,
        id: clean(hydrated.id) || clean(canonicalManifest.id || canonicalManifest.story_id),
      }
    : hydrated;
  const renderLoad = await readRenderManifestForAction(action);
  const renderHydrated = applyRenderManifestEvidence(canonicalHydrated, renderLoad.manifest, renderLoad.path);
  const currentPackage = await readCurrentPackageEvidence(action, renderLoad.path);
  const captionHydrated = applyCaptionManifestEvidence(
    renderHydrated,
    currentPackage.captionManifest,
    currentPackage.captionManifestPath,
  );
  const thumbnail = subjectRichThumbnailText({
    story: captionHydrated,
    action,
    snapshot: renderLoad.manifest?.input_fingerprint?.canonical_snapshot || {},
    platformPublishManifest: currentPackage.platformPublishManifest,
  });
  if (!thumbnail) return captionHydrated;
  return {
    ...captionHydrated,
    suggested_thumbnail_text: thumbnail,
    thumbnail_text: thumbnail,
    thumbnail_headline: thumbnail,
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

async function structuredPlatformPostState({ platformPosts = null, storyId = "", config = {} } = {}) {
  const id = clean(storyId);
  const platform = clean(config.structuredPlatform);
  if (!platformPosts || !id || !platform) return null;
  try {
    let row = null;
    if (typeof platformPosts.getByStoryPlatform === "function") {
      row = await platformPosts.getByStoryPlatform(id, platform);
    } else if (Array.isArray(platformPosts)) {
      row = platformPosts.find((item) =>
        clean(item.story_id) === id && clean(item.platform) === platform,
      ) || null;
    }
    if (!row) return null;
    const status = clean(row.status).toLowerCase();
    const externalId = clean(row.external_id);
    const errorText = clean(row.error_message || row.block_reason);
    if (status === "published") {
      return {
        status,
        already_published: true,
        external_id: isRealPlatformValue(externalId) ? externalId : null,
        external_url: clean(row.external_url) || null,
        evidence_source: "platform_posts",
      };
    }
    if (status === "pending") {
      return {
        status,
        pending_processing: true,
        idempotency_key: clean(row.idempotency_key) || null,
        evidence_source: "platform_posts",
      };
    }
    if (status === "blocked" && /\b(?:duplicate_blocked|dupe-blocked|duplicate|already)\b/i.test(errorText)) {
      return {
        status,
        duplicate_blocked: true,
        error: errorText,
        evidence_source: "platform_posts",
      };
    }
    if (["failed", "blocked"].includes(status) && errorText && !isTransientPlatformErrorText(errorText)) {
      return {
        status,
        previous_hard_failure: true,
        error: errorText,
        evidence_source: "platform_posts",
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function storyPublishedPlatformCount({
  story = {},
  storyId = "",
  platformPosts = null,
  allowedPlatforms = [],
} = {}) {
  let count = 0;
  for (const platform of asArray(allowedPlatforms)) {
    const config = PLATFORM_CONFIG[clean(platform)];
    if (!config) continue;
    if (platformAlreadyPublished(story, config)) {
      count += 1;
      continue;
    }
    const structuredState = await structuredPlatformPostState({
      platformPosts,
      storyId,
      config,
    });
    if (structuredState?.already_published) count += 1;
  }
  return count;
}

function guardedPlatformPriority(platform) {
  const order = {
    youtube_shorts: 0,
    instagram_reels: 1,
    facebook_reels: 2,
    instagram_story: 3,
    facebook_story: 4,
  };
  return order[clean(platform)] ?? 10;
}

async function guardedActionPriority({
  story = {},
  action = {},
  platformPosts = null,
  allowedPlatforms = [],
  index = 0,
} = {}) {
  const storyId = clean(action.story_id || story.id);
  const platform = clean(action.platform);
  const publishedCount = await storyPublishedPlatformCount({
    story,
    storyId,
    platformPosts,
    allowedPlatforms,
  });
  const freshStory = publishedCount === 0;
  const platformRank = guardedPlatformPriority(platform);
  return {
    rank: freshStory ? 0 : 1,
    platform_rank: platformRank,
    index,
    published_enabled_platform_count: publishedCount,
    reason: freshStory && platformRank === 0
      ? "fresh_story_youtube_first"
      : freshStory
        ? "fresh_story_before_crosspost_catchup"
        : "residual_crosspost_catchup",
  };
}

function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseTimeMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  const text = clean(value);
  if (!text) return 0;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : 0;
}

function firstSourceTimestamp(story = {}, action = {}) {
  const fields = [
    action.source_timestamp,
    action.source_published_at,
    action.story_timestamp,
    action.published_source_at,
    story.source_timestamp,
    story.source_published_at,
    story.article_published_at,
    story.timestamp,
    story.created_at,
  ];
  for (const value of fields) {
    if (parseTimeMs(value)) return clean(value);
  }
  return "";
}

function sourceFreshnessGate({ story = {}, action = {}, options = {} } = {}) {
  const maxAgeHours = finiteNumber(
    options.maxSourceAgeHours ?? process.env.PULSE_GUARDED_MAX_SOURCE_AGE_HOURS,
    DEFAULT_MAX_SOURCE_AGE_HOURS,
  );
  if (!maxAgeHours || maxAgeHours <= 0) {
    return {
      result: "pass",
      blockers: [],
      checks: { enabled: false, max_age_hours: maxAgeHours },
    };
  }

  const timestamp = firstSourceTimestamp(story, action);
  if (!timestamp) {
    return {
      result: "pass",
      blockers: [],
      checks: {
        enabled: true,
        source_timestamp: null,
        source_timestamp_present: false,
        max_age_hours: maxAgeHours,
      },
    };
  }

  const sourceMs = parseTimeMs(timestamp);
  if (!sourceMs) {
    return {
      result: "fail",
      blockers: ["source_timestamp_invalid"],
      checks: {
        enabled: true,
        source_timestamp: timestamp,
        max_age_hours: maxAgeHours,
      },
    };
  }

  const nowMs = parseTimeMs(options.now || options.generatedAt || options.currentTime) || Date.now();
  const ageHours = Math.max(0, (nowMs - sourceMs) / 3_600_000);
  const ageHoursRounded = Math.round(ageHours * 10) / 10;
  const failed = ageHours > maxAgeHours;
  return {
    result: failed ? "fail" : "pass",
    blockers: failed ? ["source_age_exceeds_limit"] : [],
    checks: {
      enabled: true,
      source_timestamp: timestamp,
      age_hours: ageHoursRounded,
      max_age_hours: maxAgeHours,
      stale: failed,
    },
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ttsSpeakingRateForPayload(payload = {}) {
  const meta = payload?.meta || payload?.alignment?.meta || {};
  const localTts = payload?.localTts || payload?.local_tts || meta?.localTts || meta?.local_tts || {};
  const elevenlabs = payload?.elevenlabs || payload?.elevenLabs || meta?.elevenlabs || meta?.elevenLabs || {};
  const diagnostics =
    payload?.voiceDiagnostics ||
    payload?.voice_diagnostics ||
    meta?.voiceDiagnostics ||
    meta?.voice_diagnostics ||
    {};
  const values = [
    localTts.speakingRate,
    localTts.speaking_rate,
    diagnostics.effective_rate,
    diagnostics.effectiveRate,
    elevenlabs.speakingRate,
    elevenlabs.speaking_rate,
    meta.speakingRate,
    meta.speaking_rate,
    payload.speakingRate,
    payload.speaking_rate,
    payload.effective_rate,
    payload.effectiveRate,
  ];
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null) return number;
  }
  return null;
}

function timestampPronunciationProfile(payload = {}) {
  const meta = payload?.meta || payload?.alignment?.meta || {};
  return clean(
    meta.ttsPronunciationProfileVersion ||
      meta.tts_pronunciation_profile_version ||
      payload.ttsPronunciationProfileVersion ||
      payload.tts_pronunciation_profile_version,
  );
}

function comparableVoiceText(value = "") {
  return clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function timestampWordText(payload = {}) {
  const words = Array.isArray(payload.words)
    ? payload.words
    : Array.isArray(payload.alignment?.words)
      ? payload.alignment.words
      : [];
  return clean(
    words
      .map((word) => word?.word || word?.text || word?.token || "")
      .filter(Boolean)
      .join(" "),
  );
}

function timestampVoiceTexts(payload = {}) {
  const meta = payload?.meta || payload?.alignment?.meta || {};
  return [
    ["recorded_spoken_text", meta.spoken_text],
    ["recorded_transcript", meta.transcript],
    ["recorded_text", meta.text],
    ["payload_transcript", payload.transcript],
    ["payload_text", payload.text],
    ["recorded_word_text", timestampWordText(payload)],
  ]
    .map(([label, value]) => [label, clean(value)])
    .filter(([, value]) => Boolean(value));
}

function hasGtaViSpokenSix(value = "") {
  return /\b(?:g\s+t\s+a|gta|grand\s+theft\s+auto)\s+(?:6|six)\b/.test(
    comparableVoiceText(value),
  );
}

function hasGtaViPronunciationContext(value = "") {
  const text = comparableVoiceText(value);
  if (!text) return false;
  return (
    /\bgtavi\b/.test(text) ||
    /\bg\s+t\s+a\s+(?:6|six|v\s+i|vi)\b/.test(text) ||
    /\bgta\s+(?:6|six|v\s+i|vi)\b/.test(text) ||
    /\bgrand\s+theft\s+auto\s+(?:6|six|v\s+i|vi)\b/.test(text) ||
    /\brockstars\s+next\s+grand\s+theft\s+auto\b/.test(text) ||
    /\bthe\s+next\s+grand\s+theft\s+auto\b/.test(text)
  );
}

function gtaViPronunciationContextForStory(story = {}, action = {}) {
  return [
    story.title,
    story.public_title,
    story.upload_title,
    story.selected_title,
    story.canonical_subject,
    story.canonical_game,
    story.full_script,
    story.narration_script,
    story.tts_script,
    action.title,
  ].some(hasGtaViPronunciationContext);
}

function titleColonPronunciationContextForStory(story = {}, action = {}) {
  return [
    story.title,
    story.public_title,
    story.upload_title,
    story.selected_title,
    story.short_title,
    story.canonical_subject,
    story.canonical_game,
    story.game_title,
    story.full_script,
    story.narration_script,
    story.spoken_narration_script,
    story.tts_script,
    action.title,
  ].some(requiresTitleColonPauseProfile);
}

function staleGtaViTtsScriptBlockersForStory(story = {}) {
  const ttsInputs = [
    ["spoken_narration_script", story.spoken_narration_script],
    ["tts_script", story.tts_script],
  ]
    .map(([label, value]) => [label, clean(value)])
    .filter(([, value]) => Boolean(value));

  if (!ttsInputs.length && !clean(story.tts_script)) {
    const fallback = clean(story.full_script || story.narration_script);
    if (fallback) ttsInputs.push(["fallback_script", fallback]);
  }

  const blockers = [];
  for (const [label, value] of ttsInputs) {
    if (hasMalformedGtaViSpokenStutter(value)) blockers.push(`gta_vi_stale_${label}`);
    if (hasRiskyGtaViOpening(value)) blockers.push(`gta_vi_stale_${label}`);
    if (hasSplitGtaViRomanNarration(value)) blockers.push(`gta_vi_stale_${label}`);
    if (hasGtaViSpokenSix(value)) blockers.push(`gta_vi_stale_${label}`);
  }
  return unique(blockers);
}

function gtaViPronunciationBlockersForPayload({ story = {}, action = {}, payload = {} } = {}) {
  const blockers = [];
  const profile = timestampPronunciationProfile(payload);
  const storyHasGtaContext = gtaViPronunciationContextForStory(story, action);
  const storyHasTitleColonContext = titleColonPronunciationContextForStory(story, action);
  const voiceTexts = timestampVoiceTexts(payload);
  const voiceHasGtaContext = voiceTexts.some(([, value]) => hasGtaViPronunciationContext(value));

  if (
    (storyHasGtaContext || voiceHasGtaContext) &&
    profile !== TTS_PRONUNCIATION_PROFILE_VERSION
  ) {
    blockers.push("gta_vi_timestamp_profile_stale");
  }
  if (storyHasTitleColonContext && profile !== TTS_PRONUNCIATION_PROFILE_VERSION) {
    blockers.push("title_colon_timestamp_profile_stale");
  }

  for (const [, value] of voiceTexts) {
    if (hasMalformedGtaViSpokenStutter(value)) blockers.push("gta_vi_spoken_stutter");
    if (hasRiskyGtaViOpening(value)) blockers.push("gta_vi_opening_spoken_six_risk");
    if (hasSplitGtaViRomanNarration(value)) blockers.push("gta_vi_spoken_roman_split");
    if (hasGtaViSpokenSix(value)) blockers.push("gta_vi_spoken_six");
  }

  blockers.push(...staleGtaViTtsScriptBlockersForStory(story));

  return unique(blockers);
}

function formatRateForBlocker(value) {
  return Number(value).toFixed(2);
}

function guardedDataRootCandidates() {
  const roots = [
    process.env.PULSE_MEDIA_ROOT,
    process.env.PULSE_DATA_MEDIA_ROOT,
    process.env.PULSE_DATA_ROOT ? path.join(process.env.PULSE_DATA_ROOT, "media") : "",
    "D:\\pulse-data\\media",
  ];
  return unique(roots.map(clean).filter(Boolean));
}

function timestampCandidatesForAction(story = {}, action = {}) {
  const storyId = clean(action.story_id || story.id);
  const candidates = [
    action.word_timestamps_path,
    action.word_timestamp_path,
    action.timestamps_path,
    action.timestamp_path,
    action.subtitle_timestamps_path,
    action.alignment_path,
    story.word_timestamps_path,
    story.word_timestamp_path,
    story.timestamps_path,
    story.timestamp_path,
    story.subtitle_timestamps_path,
    story.alignment_path,
  ];

  const dirs = [];
  for (const filePath of [
    action.video_path,
    action.captions_path,
    action.canonical_manifest_path,
    action.platform_publish_manifest_path,
    story.exported_path,
    story.captions_path,
    story.canonical_manifest_path,
    story.platform_publish_manifest_path,
  ]) {
    const resolved = resolveMaybeRelative(filePath);
    if (resolved) dirs.push(path.dirname(resolved));
  }

  for (const dir of unique(dirs)) {
    candidates.push(
      path.join(dir, "word_timestamps.json"),
      path.join(dir, "timestamps.json"),
      path.join(dir, "audio_timestamps.json"),
      path.join(dir, "narration_timestamps.json"),
    );
    if (storyId) candidates.push(path.join(dir, `${storyId}_timestamps.json`));
  }

  if (storyId) {
    candidates.push(path.join(process.cwd(), "output", "audio", `${storyId}_timestamps.json`));
    for (const root of guardedDataRootCandidates()) {
      candidates.push(path.join(root, "output", "audio", `${storyId}_timestamps.json`));
    }
  }

  return unique(candidates.map(resolveMaybeRelative).filter(Boolean));
}

async function readTimestampPayloadForAction(story = {}, action = {}) {
  for (const candidate of timestampCandidatesForAction(story, action)) {
    try {
      if (!await fs.pathExists(candidate)) continue;
      return {
        loaded: true,
        path: candidate,
        payload: await fs.readJson(candidate),
      };
    } catch (err) {
      return {
        loaded: false,
        path: candidate,
        error: clean(err.message),
      };
    }
  }
  return { loaded: false, path: "", payload: null };
}

async function localTtsSpeedGate({ story = {}, action = {}, options = {} } = {}) {
  const minNativeRate = finiteNumber(
    options.minNativeLocalTtsRate ?? process.env.PULSE_LOCAL_TTS_MIN_NATIVE_RATE,
    0.9,
  );
  if (!minNativeRate || minNativeRate <= 0) {
    return {
      result: "pass",
      blockers: [],
      checks: { enabled: false, min_native_rate: minNativeRate },
    };
  }

  const hydrated = await hydrateActionQualityStory(story, action);
  const timestampEvidence = await readTimestampPayloadForAction(hydrated, action);
  if (!timestampEvidence.loaded) {
    return {
      result: "pass",
      blockers: [],
      checks: {
        enabled: true,
        timestamp_payload_present: false,
        word_timestamps_path: timestampEvidence.path || null,
        min_native_rate: minNativeRate,
      },
    };
  }

  const rate = ttsSpeakingRateForPayload(timestampEvidence.payload || {});
  if (rate != null && rate < minNativeRate) {
    return {
      result: "fail",
      blockers: [`local_tts_speaking_rate_below_native:${formatRateForBlocker(rate)}`],
      checks: {
        enabled: true,
        word_timestamps_path: timestampEvidence.path,
        local_tts_speaking_rate: rate,
        local_tts_min_native_rate: minNativeRate,
      },
    };
  }
  if (rate != null && Math.abs(rate - 1.0) > 0.01) {
    const payload = timestampEvidence.payload || {};
    const meta = payload?.meta || payload?.alignment?.meta || {};
    const managedRatePolicy = evaluateManagedTtsRateAdjustment(
      {
        provider: meta.provider,
        source: meta.source,
        audioPath: hydrated.audio_path || hydrated.narration_audio_path,
        meta,
        elevenlabs: meta.elevenlabs || meta.elevenLabs,
      },
      { requireAudioHashMatch: true },
    );
    if (managedRatePolicy.allowed) {
      return {
        result: "pass",
        blockers: [],
        checks: {
          enabled: true,
          word_timestamps_path: timestampEvidence.path,
          local_tts_speaking_rate: rate,
          local_tts_min_native_rate: minNativeRate,
          managed_tts_provider_native_rate_verified: true,
          managed_tts_rate_policy: managedRatePolicy,
        },
      };
    }
    return {
      result: "fail",
      blockers: [`tts_speaking_rate_non_native:${formatRateForBlocker(rate)}`],
      checks: {
        enabled: true,
        word_timestamps_path: timestampEvidence.path,
        local_tts_speaking_rate: rate,
        local_tts_min_native_rate: minNativeRate,
        managed_tts_provider_native_rate_verified: false,
        managed_tts_rate_policy: managedRatePolicy,
      },
    };
  }

  return {
    result: "pass",
    blockers: [],
    checks: {
      enabled: true,
      word_timestamps_path: timestampEvidence.path,
      local_tts_speaking_rate: rate,
      local_tts_min_native_rate: minNativeRate,
    },
  };
}

async function gtaViPronunciationGate({ story = {}, action = {} } = {}) {
  const hydrated = await hydrateActionQualityStory(story, action);
  const timestampEvidence = await readTimestampPayloadForAction(hydrated, action);
  if (!timestampEvidence.loaded) {
    const missingEvidenceBlockers = gtaViPronunciationContextForStory(hydrated, action)
      ? ["gta_vi_pronunciation_evidence_missing"]
      : [];
    return {
      result: missingEvidenceBlockers.length ? "fail" : "pass",
      blockers: missingEvidenceBlockers,
      checks: {
        enabled: true,
        timestamp_payload_present: false,
        word_timestamps_path: timestampEvidence.path || null,
      },
    };
  }

  const blockers = gtaViPronunciationBlockersForPayload({
    story: hydrated,
    action,
    payload: timestampEvidence.payload || {},
  });
  return {
    result: blockers.length ? "fail" : "pass",
    blockers,
    checks: {
      enabled: true,
      word_timestamps_path: timestampEvidence.path,
      profile: timestampPronunciationProfile(timestampEvidence.payload || {}) || null,
    },
  };
}

function isTransientPlatformErrorText(errorText) {
  return /\b(?:pending_processing_timeout|accepted_processing|processing_pending)\b/i.test(clean(errorText));
}

function classifyPlatformFailure(error, platform = "") {
  const text = clean(error?.message || error).toLowerCase();
  const status = Number(error?.response?.status || error?.status || error?.statusCode || 0);
  if (
    /unaudited_client|direct[ -]?post.*(?:approval|audit)|app.*audit/.test(text)
  ) {
    return { classification: "direct_post_approval_required", retryable: false };
  }
  if (/privacy_level|privacy level|private account/.test(text)) {
    return { classification: "privacy_policy_failure", retryable: false };
  }
  if (/duration|too long|max_video_post_duration/.test(text)) {
    return { classification: "duration_policy_failure", retryable: false };
  }
  if (/disclosure|commercial content|branded content/.test(text)) {
    return { classification: "disclosure_policy_failure", retryable: false };
  }
  if (status === 402 || /payment required|billing|credits? exhausted/.test(text)) {
    return { classification: "billing_required", retryable: false };
  }
  if (
    status === 401 ||
    /oauth|access token|refresh token|credentials? (?:missing|invalid|not configured)|unauthori[sz]ed/.test(text)
  ) {
    return { classification: "authentication_required", retryable: false };
  }
  if (status === 403 || /forbidden|scope missing|not permitted/.test(text)) {
    return { classification: "platform_permission_denied", retryable: false };
  }
  if (status === 429 || /rate.?limit|too many requests/.test(text)) {
    return { classification: "rate_limited", retryable: true };
  }
  if (
    status >= 500 ||
    /timeout|timed out|econnreset|enotfound|network|socket hang up/.test(text)
  ) {
    return { classification: "transient_network_failure", retryable: true };
  }
  if (/processing failed|publish(?:ing)? failed|media processing/.test(text)) {
    return { classification: "platform_processing_failed", retryable: false };
  }
  if (/returned no external id|uploader.*contract|skipped/.test(text)) {
    return { classification: "uploader_contract_failure", retryable: false };
  }
  return {
    classification: `${clean(platform) || "platform"}_unknown_failure`,
    retryable: false,
  };
}

const STORY_LEVEL_PUBLIC_COPY_FAILURE_PATTERN =
  /\b(?:Public metadata QA failed|Public copy QA failed|script_coherence:|public_copy:|render_story_public_copy_failed)\b/i;

function storyPreviousPublicCopyFailure(story = {}) {
  for (const config of Object.values(PLATFORM_CONFIG)) {
    const errorText = clean(story[config.errorField]);
    if (!errorText) continue;
    if (/\b(?:duplicate_blocked|dupe-blocked)\b/i.test(errorText)) continue;
    if (isTransientPlatformErrorText(errorText)) continue;
    if (STORY_LEVEL_PUBLIC_COPY_FAILURE_PATTERN.test(errorText)) return errorText;
  }
  return null;
}

function platformPreviousHardFailure(story = {}, config = {}) {
  const errorText = clean(story[config.errorField]);
  if (!errorText) return null;
  if (platformDuplicateBlocked(story, config)) return null;
  if (isTransientPlatformErrorText(errorText)) return null;
  return errorText;
}

function qaFailureBlockers(prefix, result = {}) {
  const failures = asArray(result.failures || result.blockers)
    .map(clean)
    .filter(Boolean)
    .map((item) => `${prefix}:${item}`);
  const status = clean(result.result || result.status).toLowerCase();
  if (failures.length) return failures;
  if (status && !["pass", "warn"].includes(status)) return [`${prefix}:qa_${status}`];
  return [];
}

function summariseActionQualityGateResult(result = {}) {
  const status = clean(result.result || result.status || "pass").toLowerCase();
  const blockers = unique(asArray(result.blockers || result.failures).map(clean).filter(Boolean));
  const failed = blockers.length > 0 || (status && !["pass", "warn"].includes(status));
  return {
    result: failed ? "fail" : "pass",
    blockers: failed && !blockers.length ? [`quality_gate_${status}`] : blockers,
    checks: result.checks || {},
  };
}

async function defaultActionQualityGate({
  story = {},
  action = {},
  config = null,
  options = {},
} = {}) {
  const checks = {};
  const blockers = [];
  try {
    const runContentQa = options.runContentQa || require("./services/content-qa").runContentQa;
    const runPublicMetadataQa =
      options.runPublicMetadataQa ||
      ((qaStory, qaOptions = {}) => {
        const { collectPublicMetadataFailures } = require("./public-metadata-qa");
        const failures = collectPublicMetadataFailures(qaStory, qaOptions);
        return {
          result: failures.length ? "fail" : "pass",
          failures,
          warnings: [],
        };
      });
    const videoQa = require("./services/video-qa");
    const runVideoQa = options.runVideoQa || videoQa.runVideoQa;
    const buildVideoQaOptionsForStory =
      options.buildVideoQaOptionsForStory || videoQa.buildVideoQaOptionsForStory;
    const hydrated = await hydrateActionQualityStory(story, action);
    const exactAuthority = config?.mediaKind === "video"
      ? await exactCurrentActionQualityAuthority({
          story: hydrated,
          action,
          options,
        })
      : {
          valid: false,
          blockers: ["exact_authority_not_applicable"],
          selected_visual_deck: [],
          evidence: {
            valid: false,
            blockers: ["exact_authority_not_applicable"],
          },
        };
    checks.exact_current_quality_authority = exactAuthority.evidence;
    if (
      exactAuthority.evidence?.derived_platform_variant?.applicable === true &&
      exactAuthority.valid !== true
    ) {
      blockers.push(
        ...asArray(exactAuthority.blockers).map(
          (blocker) => `exact_current_quality_authority:${clean(blocker)}`,
        ),
      );
    }
    const effectiveContentStory = exactAuthority.valid
      ? {
          ...hydrated,
          downloaded_images: exactAuthority.selected_visual_deck,
          guarded_dispatch_effective_visual_deck_source:
            "authoritative_hash_bound_final_render_inputs",
        }
      : hydrated;
    const sourceFreshness = sourceFreshnessGate({ story: hydrated, action, options });
    checks.source_freshness = sourceFreshness.checks;
    blockers.push(...sourceFreshness.blockers);
    if (sourceFreshness.result !== "pass") {
      return {
        result: "fail",
        blockers: unique(blockers),
        checks,
      };
    }

    const rawContent = await runContentQa(effectiveContentStory, {
      blockThinVisuals: true,
      ...(options.contentQaOptions || {}),
    });
    const content = exactAuthority.valid
      ? reconcileQualityResultAliases(
          rawContent,
          /^risky_article_context_dominated_deck\b/i,
          exactAuthority.evidence,
        )
      : rawContent;
    checks.content = content;
    blockers.push(...qaFailureBlockers("content", content));

    const publicMetadata = await runPublicMetadataQa(hydrated, {
      surface: config?.publicName || clean(action.platform) || "guarded_dispatch",
      publicTitle: hydrated.suggested_title || hydrated.title,
      action,
      config,
      ...(options.publicMetadataQaOptions || {}),
    });
    checks.public_metadata = publicMetadata;
    blockers.push(...qaFailureBlockers("public_metadata", publicMetadata));

    if (config?.mediaKind === "video") {
      const rawVideo = await runVideoQa(
        hydrated.exported_path,
        buildVideoQaOptionsForStory(hydrated, options.videoQaOptions || {}),
      );
      const video = exactAuthority.valid
        ? reconcileQualityResultAliases(
            rawVideo,
            /^(?:choppy_temporal_cadence|stalled_visual_window(?:_center_crop)?)\b/i,
            exactAuthority.evidence,
          )
        : rawVideo;
      checks.video = video;
      blockers.push(...qaFailureBlockers("video", video));

      const runVisualCadenceQa = options.runVisualCadenceQa || defaultVisualCadenceQa;
      const visualCadence = await runVisualCadenceQa(hydrated, action, options.visualCadenceQaOptions || {});
      if (visualCadence) {
        checks.visual_cadence = visualCadence;
        blockers.push(
          ...asArray(visualCadence.failures || visualCadence.blockers)
            .map(clean)
            .filter(Boolean),
        );
      }
    }

    return {
      result: blockers.length ? "fail" : "pass",
      blockers: unique(blockers),
      checks,
    };
  } catch (err) {
    return {
      result: "fail",
      blockers: [`quality_gate_exception:${clean(err.code || err.name || "unknown")}`],
      checks,
    };
  }
}

async function selectNextGuardedLiveAction({
  executorPlan = {},
  stories = [],
  platformPosts = null,
  allowedPlatforms = Object.keys(PLATFORM_CONFIG),
  runActionQualityGate = defaultActionQualityGate,
  actionQualityGateOptions = {},
} = {}) {
  const allowed = new Set(asArray(allowedPlatforms).map(clean).filter(Boolean));
  const skippedActions = [];
  const viableActions = [];
  let actionIndex = 0;

  for (const action of asArray(executorPlan.handoff_ready_actions)) {
    const id = actionId(action);
    const index = actionIndex;
    actionIndex += 1;
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

    const structuredState = await structuredPlatformPostState({
      platformPosts,
      storyId: clean(action.story_id),
      config,
    });
    if (structuredState?.already_published) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "already_published",
        external_id: structuredState.external_id,
        evidence_source: structuredState.evidence_source,
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

    if (structuredState?.duplicate_blocked) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "duplicate_blocked",
        evidence_source: structuredState.evidence_source,
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

    const storyPublicCopyFailure = storyPreviousPublicCopyFailure(loaded.story);
    if (storyPublicCopyFailure) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "previous_story_public_copy_failure",
        error: storyPublicCopyFailure.slice(0, 240),
      });
      continue;
    }

    if (structuredState?.previous_hard_failure) {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "previous_platform_failure",
        error: structuredState.error.slice(0, 240),
        evidence_source: structuredState.evidence_source,
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

    const qualityStory = await hydrateActionQualityStory(loaded.story, action);

    const sourceFreshness = sourceFreshnessGate({
      story: qualityStory,
      action,
      options: actionQualityGateOptions,
    });
    if (sourceFreshness.result !== "pass") {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "stale_source_age",
        blockers: asArray(sourceFreshness.blockers),
        checks: { source_freshness: sourceFreshness.checks },
      });
      continue;
    }

    const localTtsSpeed = await localTtsSpeedGate({
      story: qualityStory,
      action,
      options: actionQualityGateOptions,
    });
    if (localTtsSpeed.result !== "pass") {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "local_tts_speed_below_native",
        blockers: asArray(localTtsSpeed.blockers),
        evidence: localTtsSpeed.checks,
      });
      continue;
    }

    const gtaViPronunciation = await gtaViPronunciationGate({
      story: qualityStory,
      action,
    });
    if (gtaViPronunciation.result !== "pass") {
      skippedActions.push({
        action_id: id,
        story_id: clean(action.story_id),
        platform,
        reason: "gta_vi_pronunciation_failed",
        blockers: asArray(gtaViPronunciation.blockers),
        evidence: gtaViPronunciation.checks,
      });
      continue;
    }

    if (typeof runActionQualityGate === "function") {
      const qualityGate = summariseActionQualityGateResult(
        await runActionQualityGate({
          story: qualityStory,
          action,
          config,
          platform,
          options: actionQualityGateOptions,
        }),
      );
      if (qualityGate.result !== "pass") {
        skippedActions.push({
          action_id: id,
          story_id: clean(action.story_id),
          platform,
          reason: "last_second_quality_gate_failed",
          blockers: asArray(qualityGate.blockers).slice(0, 8),
          checks: qualityGate.checks,
        });
        continue;
      }
    }

    const priority = await guardedActionPriority({
      story: loaded.story,
      action,
      platformPosts,
      allowedPlatforms: Array.from(allowed),
      index,
    });
    viableActions.push({
      exhausted: false,
      action_id: id,
      action,
      story_source: clean(loaded.story._guarded_story_source || "db"),
      skipped_actions: skippedActions.slice(),
      priority,
    });
  }

  if (viableActions.length) {
    viableActions.sort((left, right) =>
      (left.priority?.rank ?? 99) - (right.priority?.rank ?? 99) ||
      (left.priority?.platform_rank ?? 99) - (right.priority?.platform_rank ?? 99) ||
      (left.priority?.index ?? 0) - (right.priority?.index ?? 0)
    );
    const selected = viableActions[0];
    const selectedStoryId = clean(selected.action?.story_id);
    const selectedStoryActions = viableActions
      .filter((item) => clean(item.action?.story_id) === selectedStoryId)
      .sort((left, right) =>
        (left.priority?.platform_rank ?? 99) - (right.priority?.platform_rank ?? 99) ||
        (left.priority?.index ?? 0) - (right.priority?.index ?? 0)
      );
    return {
      ...selected,
      selected_action_ids: unique(selectedStoryActions.map((item) => clean(item.action_id)).filter(Boolean)),
      selected_actions: selectedStoryActions.map((item) => item.action).filter(Boolean),
      selected_platforms: unique(selectedStoryActions.map((item) => clean(item.action?.platform)).filter(Boolean)),
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

async function uploadWithGuardedPlatformFallback({
  action = {},
  hydrated = {},
  uploader = null,
  uploadMethod = "uploadShort",
  uploaders = {},
  beforeUrlFallback = null,
} = {}) {
  try {
    return await uploader[uploadMethod](hydrated);
  } catch (err) {
    if (clean(action.platform) !== "instagram_reels") throw err;
    if (isInstagramPendingProcessingTimeout(err, uploaders)) throw err;

    const shouldFallback =
      typeof uploader.shouldAttemptInstagramUrlFallback === "function" &&
      uploader.shouldAttemptInstagramUrlFallback(err);
    if (!shouldFallback || typeof uploader.uploadReelViaUrl !== "function") throw err;

    if (typeof beforeUrlFallback === "function") {
      await beforeUrlFallback();
    }
    return await uploader.uploadReelViaUrl(hydrated);
  }
}

function publicPostIdsFromTikTokStatus(status = {}) {
  const value =
    status.publicly_available_post_id ||
    status.publiclyAvailablePostIds ||
    status.public_post_ids ||
    [];
  return unique(Array.isArray(value) ? value : [value]);
}

function tiktokPublicPostUrl(publicPostId, env = {}, result = {}, status = {}) {
  const explicit = clean(
    status.public_url ||
      status.url ||
      result.public_url ||
      result.url,
  );
  if (explicit) return explicit;
  const profile = clean(env.TIKTOK_PUBLIC_PROFILE_URL).replace(/\/+$/, "");
  return profile && clean(publicPostId)
    ? `${profile}/video/${clean(publicPostId)}`
    : null;
}

function classifyInstagramPublicReelVerificationFailure(error) {
  const status = Number(
    error?.response?.status || error?.status || error?.statusCode || 0,
  );
  const graphMessage = clean(
    error?.response?.data?.error?.message || error?.message || error,
  );
  if (
    status === 404 ||
    (status === 400 &&
      /\b(?:does not exist|not available|not visible|unsupported get request|cannot be loaded)\b/i.test(
        graphMessage,
      ))
  ) {
    return {
      classification: "instagram_public_reel_not_visible",
      retryable: true,
    };
  }
  return classifyPlatformFailure(error, "instagram_reels");
}

async function resolvePublicUploadResult({
  action = {},
  config = {},
  result = {},
  uploader = null,
  env = {},
} = {}) {
  const platform = clean(action.platform);
  if (platform === "x") {
    if (result?.skipped === true) {
      const err = new Error(`X uploader skipped: ${clean(result.reason) || "unknown"}`);
      err.code = clean(result.reason) || "x_upload_skipped";
      throw err;
    }
    const postId = clean(result.tweetId);
    let verification = null;
    let verifier = "x_upload_result";
    if (postId && uploader && typeof uploader.verifyPublicPost === "function") {
      verifier = "x_public_post_verifier";
      try {
        verification = await uploader.verifyPublicPost(postId);
      } catch (err) {
        const failure = classifyPlatformFailure(err, "x");
        return {
          externalId: postId,
          externalUrl: null,
          publicVerified: false,
          evidence: {
            platform: "x",
            upload_receipt_id: postId || null,
            media_upload_outcome:
              result.mediaUploaded === true || clean(result.mediaId)
                ? "completed"
                : "completed_by_upload_short_contract",
            media_id: clean(result.mediaId) || null,
            post_create_outcome: postId ? "created" : "missing",
            post_id: postId || null,
            verifier,
            verification_status: "verification_pending",
            public_url: null,
            media_attached_verified: false,
            verifier_error_classification: failure.classification,
            verifier_retryable: failure.retryable,
          },
        };
      }
    }
    const verifiedPostId = clean(verification?.postId || postId);
    const mediaAttachedVerified = verification?.mediaAttached === true;
    const publicVerified =
      verification?.publicVerified === true &&
      Boolean(verifiedPostId) &&
      verification?.mediaAttached !== false;
    const fallbackUrl = typeof config.resultUrl === "function"
      ? config.resultUrl(result)
      : null;
    const publicUrl = clean(verification?.url || result.url || fallbackUrl) || null;
    return {
      externalId: verifiedPostId || postId,
      externalUrl: publicVerified ? publicUrl : null,
      publicVerified,
      evidence: {
        platform: "x",
        upload_receipt_id: postId || null,
        media_upload_outcome:
          result.mediaUploaded === true || clean(result.mediaId)
            ? "completed"
            : "completed_by_upload_short_contract",
        media_id: clean(result.mediaId) || null,
        post_create_outcome: postId ? "created" : "missing",
        post_id: postId || null,
        verifier,
        verification_status: publicVerified
          ? "verified_public"
          : "verification_pending",
        public_url: publicVerified ? publicUrl : null,
        media_attached_verified: mediaAttachedVerified,
      },
    };
  }
  if (platform === "instagram_reels") {
    const uploadReceiptId = clean(config.resultId(result));
    if (!uploadReceiptId) {
      return {
        externalId: "",
        externalUrl: null,
        publicVerified: false,
        evidence: null,
      };
    }

    const verifier = "instagram_public_reel_graph_get";
    if (!uploader || typeof uploader.verifyPublicReel !== "function") {
      return {
        externalId: uploadReceiptId,
        externalUrl: null,
        publicVerified: false,
        evidence: {
          platform,
          upload_receipt_id: uploadReceiptId,
          verifier,
          verification_status: "verification_pending",
          media_id: null,
          media_type: null,
          media_product_type: null,
          permalink: null,
          timestamp: null,
          username: null,
          verifier_error_classification: "uploader_contract_failure",
          verifier_retryable: false,
        },
      };
    }

    let verification;
    try {
      verification = await uploader.verifyPublicReel(uploadReceiptId);
    } catch (err) {
      const failure = classifyInstagramPublicReelVerificationFailure(err);
      return {
        externalId: uploadReceiptId,
        externalUrl: null,
        publicVerified: false,
        evidence: {
          platform,
          upload_receipt_id: uploadReceiptId,
          verifier,
          verification_status: "verification_pending",
          media_id: null,
          media_type: null,
          media_product_type: null,
          permalink: null,
          timestamp: null,
          username: null,
          verifier_error_classification: failure.classification,
          verifier_retryable: failure.retryable,
        },
      };
    }

    const verifiedMediaId = clean(verification?.mediaId || verification?.id);
    const mediaType = clean(
      verification?.mediaType || verification?.media_type,
    ).toUpperCase();
    const mediaProductType = clean(
      verification?.mediaProductType || verification?.media_product_type,
    ).toUpperCase();
    const permalink = clean(verification?.permalink);
    const publicVerified =
      verification?.publicVerified === true &&
      verifiedMediaId === uploadReceiptId &&
      mediaType === "VIDEO" &&
      mediaProductType === "REELS" &&
      Boolean(permalink);

    return {
      externalId: uploadReceiptId,
      externalUrl: publicVerified ? permalink : null,
      publicVerified,
      evidence: {
        platform,
        upload_receipt_id: uploadReceiptId,
        verifier,
        verification_status: publicVerified
          ? "verified_public"
          : "verification_pending",
        media_id: verifiedMediaId || null,
        media_type: mediaType || null,
        media_product_type: mediaProductType || null,
        permalink: permalink || null,
        timestamp: clean(verification?.timestamp) || null,
        username: clean(verification?.username) || null,
      },
    };
  }
  if (platform !== "tiktok") {
    const externalId = config.resultId(result);
    const externalUrl = typeof config.resultUrl === "function"
      ? config.resultUrl(result)
      : null;
    return {
      externalId,
      externalUrl,
      publicVerified: result?.publicVerified === true,
      evidence: null,
    };
  }

  const uploadReceiptId = clean(result.publishId);
  let verifierResult = result;
  let verifier = "tiktok_upload_result";
  if (uploadReceiptId && uploader && typeof uploader.fetchPublishStatus === "function") {
    verifier = "tiktok_publish_status_fetch";
    try {
      verifierResult = await uploader.fetchPublishStatus(uploadReceiptId);
    } catch (err) {
      const failure = classifyPlatformFailure(err, "tiktok");
      return {
        externalId: uploadReceiptId,
        externalUrl: null,
        publicVerified: false,
        evidence: {
          platform: "tiktok",
          upload_receipt_id: uploadReceiptId,
          verifier,
          verification_status: "verification_pending",
          platform_status: clean(result.status).toUpperCase() || "UNKNOWN",
          public_post_id: null,
          public_url: null,
          verifier_error_classification: failure.classification,
          verifier_retryable: failure.retryable,
        },
      };
    }
  }
  const status = clean(verifierResult?.status || result.status).toUpperCase();
  if (status === "FAILED") {
    const err = new Error(
      `TikTok public verification failed: ${clean(verifierResult?.fail_reason) || "platform reported FAILED"}`,
    );
    err.code = "tiktok_publish_failed";
    throw err;
  }
  const publicPostId = publicPostIdsFromTikTokStatus(verifierResult)[0] || "";
  const publicVerified =
    ["PUBLISH_COMPLETE", "SUCCESS", "SUCCEEDED"].includes(status) &&
    Boolean(publicPostId);
  const publicUrl = tiktokPublicPostUrl(
    publicPostId,
    env,
    result,
    verifierResult,
  );
  return {
    externalId: publicVerified ? publicPostId : uploadReceiptId,
    externalUrl: publicVerified ? publicUrl : null,
    publicVerified,
    evidence: {
      platform: "tiktok",
      upload_receipt_id: uploadReceiptId || null,
      verifier,
      verification_status: publicVerified ? "verified_public" : "verification_pending",
      platform_status: status || "UNKNOWN",
      public_post_id: publicPostId || null,
      public_url: publicVerified ? publicUrl : null,
    },
  };
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

function recordPendingPlatformPost({
  platformPosts,
  story,
  action,
  config,
} = {}) {
  if (!platformPosts || typeof platformPosts.ensurePending !== "function") {
    return false;
  }
  const storyId = clean(story.id || action.story_id);
  const platform = clean(config.structuredPlatform);
  if (!storyId || !platform) return false;
  platformPosts.ensurePending(storyId, platform, {
    channelId: clean(story.channel_id) || null,
    idempotencyKey: actionId(action),
  });
  return true;
}

function recordFailedPlatformPost({
  platformPosts,
  story,
  action,
  config,
  error,
} = {}) {
  if (
    !platformPosts ||
    typeof platformPosts.ensurePending !== "function" ||
    typeof platformPosts.markFailed !== "function"
  ) {
    return false;
  }
  const storyId = clean(story.id || action.story_id);
  const platform = clean(config.structuredPlatform);
  if (!storyId || !platform) return false;
  const row = platformPosts.ensurePending(storyId, platform, {
    channelId: clean(story.channel_id) || null,
    idempotencyKey: actionId(action),
  });
  platformPosts.markFailed(row.id, error || new Error("failed"));
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

function buildTerminalBlockedAction(result = {}) {
  return {
    ...result,
    blockers: unique([
      ...asArray(result.blockers),
      clean(result.outcome) || "terminal_platform_block",
    ]),
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
  env,
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
  const structuredState = await structuredPlatformPostState({
    platformPosts,
    storyId: clean(action.story_id),
    config,
  });
  if (structuredState?.pending_processing) {
    return {
      action_id: actionId(action),
      story_id: clean(action.story_id),
      platform: clean(action.platform),
      title: clean(action.title || hydrated.title),
      outcome: "verification_pending",
      evidence_source: structuredState.evidence_source,
      idempotency_key: structuredState.idempotency_key,
      upload_attempted: false,
      network_attempted: false,
      uploaded: false,
      db_mutated: false,
      public_verified: false,
      public_result_evidence: {
        platform: clean(action.platform),
        verifier: "platform_posts",
        verification_status: "verification_pending",
      },
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
    const result = await uploadWithGuardedPlatformFallback({
      action,
      hydrated,
      uploader,
      uploadMethod,
      uploaders,
      beforeUrlFallback: async () => {
        preUploadDbMutated =
          (await persistStory({ db, story: hydrated, apply })) ||
          preUploadDbMutated;
      },
    });
    if (result && result.blocked === true) {
      hydrated[config.errorField] = `duplicate_blocked: ${clean(result.reason || "blocked")}`;
      const dbMutated = (await persistStory({ db, story: hydrated, apply })) || preUploadDbMutated;
      return {
        action_id: actionId(action),
        story_id: clean(action.story_id),
        platform: clean(action.platform),
        title: clean(action.title || hydrated.title),
        outcome: "duplicate_blocked",
        upload_attempted: true,
        network_attempted: result?.networkAttempted === true,
        uploaded: false,
        db_mutated: dbMutated,
        story_source: clean(hydrated._guarded_story_source || "db"),
        error: hydrated[config.errorField],
      };
    }

    const publicResult = await resolvePublicUploadResult({
      action,
      config,
      result: result || {},
      uploader,
      env,
    });
    if (
      publicResult.publicVerified !== true &&
      clean(publicResult.evidence?.verification_status) === "verification_pending"
    ) {
      const uploadReceiptId = clean(publicResult.evidence?.upload_receipt_id);
      hydrated[config.errorField] =
        `accepted_processing: public_verification_pending` +
        (uploadReceiptId ? ` publish_id=${uploadReceiptId}` : "");
      if (clean(action.platform) === "tiktok") {
        hydrated.tiktok_status =
          clean(publicResult.evidence?.platform_status) || "PROCESSING";
      }
      const persisted = await persistStory({ db, story: hydrated, apply });
      const platformPostRecorded = recordPendingPlatformPost({
        platformPosts,
        story: hydrated,
        action,
        config,
      });
      return {
        action_id: actionId(action),
        story_id: clean(action.story_id),
        platform: clean(action.platform),
        title: clean(action.title || hydrated.title),
        outcome: "verification_pending",
        upload_receipt_id: uploadReceiptId || null,
        public_verified: false,
        public_result_evidence: publicResult.evidence,
        story_source: clean(hydrated._guarded_story_source || "db"),
        upload_attempted: true,
        network_attempted: true,
        uploaded: true,
        db_mutated: persisted || platformPostRecorded,
        platform_post_recorded: platformPostRecorded,
      };
    }
    const externalId = clean(publicResult.externalId);
    if (!externalId) {
      throw new Error(`${config.publicName} uploader returned no external id`);
    }
    const externalUrl = clean(publicResult.externalUrl) || null;

    hydrated[config.idField] = externalId;
    if (config.urlField) hydrated[config.urlField] = externalUrl || hydrated[config.urlField] || null;
    hydrated[config.errorField] = null;
    hydrated[config.publishedAtField] = generatedAt;
    if (!hydrated.published_at) hydrated.published_at = generatedAt;
    const persistedForPlatformEvidence = await persistStory({ db, story: hydrated, apply });
    const platformPostRecorded = recordPublishedPlatformPost({
      platformPosts,
      story: hydrated,
      action,
      config,
      externalId,
      externalUrl,
    });
    const discordHandoff = await runDiscordPostHandoff({
      story: hydrated,
      db,
      apply,
      discordPoster,
      discordGate,
      generatedAt,
    });
    const dbMutated = persistedForPlatformEvidence || preUploadDbMutated || discordHandoff.dbMutated;
    return {
      action_id: actionId(action),
      story_id: clean(action.story_id),
      platform: clean(action.platform),
      title: clean(action.title || hydrated.title),
      outcome: "new_upload",
      external_id: externalId,
      url: externalUrl || null,
      public_verified: publicResult.publicVerified === true,
      public_result_evidence: publicResult.evidence,
      story_source: clean(hydrated._guarded_story_source || "db"),
      upload_attempted: true,
      network_attempted: true,
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
        upload_attempted: true,
        network_attempted: true,
        uploaded: true,
        db_mutated: dbMutated,
        story_source: clean(hydrated._guarded_story_source || "db"),
        error: err.message,
      };
    }

    const failure = classifyPlatformFailure(err, action.platform);
    hydrated[config.errorField] = err.message;
    const dbMutated = await persistStory({ db, story: hydrated, apply });
    const platformPostRecorded = recordFailedPlatformPost({
      platformPosts,
      story: hydrated,
      action,
      config,
      error: err,
    });
    return {
      action_id: actionId(action),
      story_id: clean(action.story_id),
      platform: clean(action.platform),
      title: clean(action.title || hydrated.title),
      outcome: "failed",
      upload_attempted: true,
      network_attempted: err?.networkAttempted === true,
      uploaded: false,
      db_mutated: dbMutated || platformPostRecorded,
      story_source: clean(hydrated._guarded_story_source || "db"),
      error: err.message,
      failure_classification: failure.classification,
      retryable: failure.retryable,
      platform_post_recorded: platformPostRecorded,
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
  runActionQualityGate = defaultActionQualityGate,
  actionQualityGateOptions = {},
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
    const sourceFreshness = story
      ? sourceFreshnessGate({
          story,
          action,
          options: {
            generatedAt,
            ...actionQualityGateOptions,
          },
        })
      : { result: "pass", blockers: [] };
    const localTtsSpeed = story
      ? await localTtsSpeedGate({
          story,
          action,
          options: actionQualityGateOptions,
        })
      : { result: "pass", blockers: [] };
    const gtaViPronunciation = story
      ? await gtaViPronunciationGate({
          story,
          action,
        })
      : { result: "pass", blockers: [] };
    const blockers = [
      ...globalBlockers,
      ...actionSafetyBlockers(action, config),
      ...platformLiveApplyBlockers({ apply, platform, action, story, env }),
      ...(config ? [] : [`unsupported_or_disabled_platform:${platform || "missing"}`]),
      ...asArray(storyLoad.blockers),
      ...(sourceFreshness.result === "pass"
        ? []
        : ["last_second_source_freshness_failed", ...asArray(sourceFreshness.blockers)]),
      ...(localTtsSpeed.result === "pass"
        ? []
        : ["last_second_local_tts_speed_failed", ...asArray(localTtsSpeed.blockers)]),
      ...(gtaViPronunciation.result === "pass"
        ? []
        : ["last_second_gta_vi_pronunciation_failed", ...asArray(gtaViPronunciation.blockers)]),
    ];

    if (blockers.length) {
      blockedActions.push(buildBlockedAction({ action, blockers }));
      continue;
    }

    if (apply && typeof runActionQualityGate === "function") {
      const qualityGate = summariseActionQualityGateResult(
        await runActionQualityGate({
          story: storyForAction(story, action),
          action,
          config,
          platform,
          options: actionQualityGateOptions,
        }),
      );
      if (qualityGate.result !== "pass") {
        blockedActions.push(buildBlockedAction({
          action,
          blockers: [
            "last_second_quality_gate_failed",
            ...asArray(qualityGate.blockers).slice(0, 8),
          ],
        }));
        continue;
      }
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
      env,
    });
    if (result.outcome === "blocked") {
      blockedActions.push(result);
    } else if (result.outcome === "duplicate_blocked") {
      blockedActions.push(buildTerminalBlockedAction(result));
    } else {
      actions.push(result);
    }
  }

  const allResults = [...actions, ...blockedActions];
  const uploadAttemptCount = allResults.filter((item) => item.upload_attempted === true).length;
  const uploadSuccessCount = allResults.filter((item) => item.uploaded === true).length;
  const networkAttemptCount = allResults.filter(
    (item) => item.network_attempted === true || item.uploaded === true,
  ).length;
  const dbMutationCount = allResults.filter((item) => item.db_mutated === true).length;
  const failedCount = allResults.filter((item) => item.outcome === "failed").length;
  const verificationPendingCount = allResults.filter(
    (item) => item.outcome === "verification_pending",
  ).length;
  const duplicateBlockedCount = blockedActions.filter((item) => item.outcome === "duplicate_blocked").length;
  const discordAlerts = actions.flatMap((item) => asArray(item.discord_alerts));
  const discordAlertPostCount = discordAlerts.filter((item) => item.outcome === "posted").length;
  if (duplicateBlockedCount > 0) advisory.push("terminal_duplicate_blocked_actions_present");
  const verdict = blockedActions.length || failedCount
    ? "RED"
    : verificationPendingCount
      ? "AMBER"
    : actions.length
      ? "GREEN"
      : "AMBER";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "GUARDED_LIVE_DISPATCH_EXECUTOR",
    verdict,
    apply: apply === true,
    live_publish_applied: apply === true && networkAttemptCount > 0,
    ready_for_live_dispatch_boolean: verdict === "GREEN",
    executor_state: state,
    summary: {
      selected_action_count: selectedActionIds.length,
      completed_action_count: actions.length,
      blocked_action_count: blockedActions.length,
      upload_attempt_count: uploadAttemptCount,
      upload_success_count: uploadSuccessCount,
      network_attempt_count: networkAttemptCount,
      db_mutation_count: dbMutationCount,
      failed_action_count: failedCount,
      verification_pending_action_count: verificationPendingCount,
      duplicate_blocked_action_count: duplicateBlockedCount,
      discord_alert_attempt_count: discordAlerts.length,
      discord_alert_post_count: discordAlertPostCount,
    },
    actions,
    blocked_actions: blockedActions,
    advisory,
    safety: {
      no_oauth_or_token_change: true,
      no_network_uploads: apply !== true || networkAttemptCount === 0,
      no_public_posts: apply !== true || uploadSuccessCount === 0,
      no_db_mutation: apply !== true || dbMutationCount === 0,
      live_network_uploads: apply === true && networkAttemptCount > 0,
      db_mutation_count: dbMutationCount,
    },
    required_next_step: verificationPendingCount
      ? "verify_pending_platform_posts"
      : verdict === "GREEN"
      ? apply
        ? "verify_platform_posts_and_discord_alerts"
        : "rerun_with_apply_after_operator_confirms_exact_action_ids"
      : blockedActions.length
        ? "repair_guarded_live_dispatch_blockers"
        : failedCount
          ? "repair_guarded_live_dispatch_failures"
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
    `Successful uploads: ${report.summary?.upload_success_count || 0}`,
    `Network attempts: ${report.summary?.network_attempt_count || 0}`,
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
  defaultActionQualityGate,
  selectNextGuardedLiveAction,
  runGuardedLiveDispatchExecutor,
  renderGuardedLiveDispatchExecutorMarkdown,
  writeGuardedLiveDispatchExecutorReport,
};
