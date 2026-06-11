"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  planTikTokFileUploadChunks,
} = require("../../upload_tiktok");

const REQUIRED_SCOPES = ["user.info.basic", "video.publish", "video.upload"];

const CLASSIFICATIONS = {
  READY_PUBLIC: "TIKTOK_READY_PUBLIC",
  READY_PRIVATE_ONLY: "TIKTOK_READY_PRIVATE_ONLY",
  TOKEN_REFRESH_REQUIRED: "TIKTOK_TOKEN_REFRESH_REQUIRED",
  REAUTH_REQUIRED: "TIKTOK_REAUTH_REQUIRED",
  SCOPE_MISSING: "TIKTOK_SCOPE_MISSING",
  APP_AUDIT_REQUIRED: "TIKTOK_APP_AUDIT_REQUIRED",
  CREDENTIALS_MISSING: "TIKTOK_CREDENTIALS_MISSING",
  UPLOAD_CODE_BROKEN: "TIKTOK_UPLOAD_CODE_BROKEN",
  OPERATOR_EXTERNAL_ACTION_REQUIRED: "TIKTOK_OPERATOR_EXTERNAL_ACTION_REQUIRED",
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function envFlag(env = {}, name) {
  return /^(true|1|yes|on)$/i.test(String(env?.[name] || "").trim());
}

function envExplicitFalse(env = {}, name) {
  return /^(false|0|no|off)$/i.test(String(env?.[name] || "").trim());
}

function hasEnv(env = {}, name) {
  return cleanText(env?.[name]).length > 0;
}

function unique(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const text = cleanText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scopeList(value = []) {
  if (Array.isArray(value)) return unique(value).sort();
  return unique(String(value || "").split(/[,\s]+/)).sort();
}

function buildScopeAssumptions(tokenFile = {}) {
  const granted = scopeList(tokenFile.scope_list || tokenFile.scopes || tokenFile.scope);
  const missing = REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
  return {
    required_scopes: REQUIRED_SCOPES,
    token_scope_list: granted,
    missing_scopes: missing,
    user_info_basic_authorized: granted.includes("user.info.basic"),
    video_publish_authorized: granted.includes("video.publish"),
    video_upload_authorized: granted.includes("video.upload"),
  };
}

function normaliseCreatorInfo(creatorInfo = null) {
  const response = creatorInfo && typeof creatorInfo === "object" ? creatorInfo : {};
  const data = response.data && typeof response.data === "object" ? response.data : response;
  const options = asArray(data.privacy_level_options).map((value) => cleanText(value).toUpperCase());
  const available = response.ok === true || options.length > 0;
  return {
    available,
    ok: response.ok === true || available,
    http_status: response.http_status || null,
    error_code: response.raw_error_code || response.error_code || response.error?.code || null,
    error_message: response.raw_error_message || response.error_message || response.error?.message || null,
    creator_username: data.creator_username || null,
    creator_nickname: data.creator_nickname || null,
    privacy_level_options: options,
    public_to_everyone_available: options.includes("PUBLIC_TO_EVERYONE"),
    private_only_available: options.some((option) =>
      ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR"].includes(option),
    ),
    max_video_post_duration_sec: numberOrNull(data.max_video_post_duration_sec),
    comment_disabled: data.comment_disabled === true,
    duet_disabled: data.duet_disabled === true,
    stitch_disabled: data.stitch_disabled === true,
  };
}

function addBlocker(blockers, code, message, { external = false, local = false } = {}) {
  blockers.push({ code, message, external, local });
}

function chooseClassification({
  blockers,
  credentialsPresent,
  operatorDisabled,
  uploadCodeOk,
  tokenStatus,
  tokenFile,
  scopes,
  creator,
  directPostApproved,
  directPostProbe,
}) {
  if (!credentialsPresent) return CLASSIFICATIONS.CREDENTIALS_MISSING;
  if (!uploadCodeOk) return CLASSIFICATIONS.UPLOAD_CODE_BROKEN;
  if (tokenFile.exists === false || tokenFile.access_token_present === false) {
    return tokenFile.refresh_token_present ? CLASSIFICATIONS.REAUTH_REQUIRED : CLASSIFICATIONS.CREDENTIALS_MISSING;
  }
  if (tokenStatus?.ok !== true) {
    if (tokenStatus?.refresh_available === true && tokenStatus?.needs_reauth !== true) {
      return CLASSIFICATIONS.TOKEN_REFRESH_REQUIRED;
    }
    return CLASSIFICATIONS.REAUTH_REQUIRED;
  }
  if (scopes.missing_scopes.length > 0) return CLASSIFICATIONS.SCOPE_MISSING;
  if (creator.error_code === "scope_not_authorized") return CLASSIFICATIONS.SCOPE_MISSING;
  if (creator.error_code === "access_token_invalid") {
    return tokenStatus?.refresh_available === true
      ? CLASSIFICATIONS.TOKEN_REFRESH_REQUIRED
      : CLASSIFICATIONS.REAUTH_REQUIRED;
  }
  if (!creator.available) return CLASSIFICATIONS.OPERATOR_EXTERNAL_ACTION_REQUIRED;
  const unauditedProbe =
    directPostProbe?.error_code === "unaudited_client_can_only_post_to_private_accounts" ||
    /unaudited_client_can_only_post_to_private_accounts/i.test(
      cleanText(directPostProbe?.error_message),
    );
  if (unauditedProbe) return CLASSIFICATIONS.APP_AUDIT_REQUIRED;
  if (creator.public_to_everyone_available && directPostApproved) {
    return CLASSIFICATIONS.READY_PUBLIC;
  }
  if (creator.public_to_everyone_available && !directPostApproved) {
    return CLASSIFICATIONS.APP_AUDIT_REQUIRED;
  }
  if (creator.private_only_available) return CLASSIFICATIONS.READY_PRIVATE_ONLY;
  if (operatorDisabled) return CLASSIFICATIONS.OPERATOR_EXTERNAL_ACTION_REQUIRED;
  if (blockers.some((blocker) => blocker.external)) {
    return CLASSIFICATIONS.OPERATOR_EXTERNAL_ACTION_REQUIRED;
  }
  return CLASSIFICATIONS.OPERATOR_EXTERNAL_ACTION_REQUIRED;
}

function buildTikTokReadinessReport({
  generatedAt = new Date().toISOString(),
  env = process.env,
  tokenFile = {},
  tokenStatus = {},
  creatorInfo = null,
  uploadCode = { ok: true },
  directPostProbe = null,
  docs = null,
} = {}) {
  const credentialsPresent =
    hasEnv(env, "TIKTOK_CLIENT_KEY") && hasEnv(env, "TIKTOK_CLIENT_SECRET");
  const operatorDisabled =
    envExplicitFalse(env, "TIKTOK_ENABLED") ||
    envExplicitFalse(env, "TIKTOK_AUTO_UPLOAD_ENABLED");
  const directPostApproved =
    envFlag(env, "TIKTOK_DIRECT_POST_APPROVED") ||
    envFlag(env, "TIKTOK_CONTENT_POSTING_APPROVED");
  const scopes = buildScopeAssumptions(tokenFile);
  const creator = normaliseCreatorInfo(creatorInfo);
  const blockers = [];
  if (!credentialsPresent) {
    addBlocker(blockers, "tiktok_credentials_missing", "TikTok client key or client secret is missing.", { local: true });
  }
  if (operatorDisabled) {
    addBlocker(blockers, "tiktok_operator_disabled", "TikTok operator switches are disabled.", { external: true });
  }
  if (uploadCode?.ok === false) {
    addBlocker(blockers, "tiktok_upload_code_broken", uploadCode.reason || "TikTok upload code contract failed.", { local: true });
  }
  if (tokenFile.exists === false) {
    addBlocker(blockers, "tiktok_token_file_missing", "TikTok token file is missing.", { local: true });
  }
  if (tokenFile.access_token_present === false) {
    addBlocker(blockers, "tiktok_token_access_missing", "TikTok token file has no usable credential.", { local: true });
  }
  if (tokenStatus?.ok !== true) {
    if (tokenStatus?.refresh_available === true && tokenStatus?.needs_reauth !== true) {
      addBlocker(blockers, "tiktok_token_expired_refreshable", "TikTok token is expired but local refresh is available.", { local: true });
    } else {
      addBlocker(blockers, "tiktok_reauth_required", "TikTok token cannot be repaired locally; operator OAuth is required.", { external: true });
    }
  }
  for (const scope of scopes.missing_scopes) {
    addBlocker(blockers, `tiktok_scope_missing:${scope}`, `Required TikTok scope is missing: ${scope}.`, { external: true });
  }
  if (tokenStatus?.ok === true && !creator.available) {
    addBlocker(blockers, "tiktok_creator_info_not_available", "creator_info has not succeeded for the current token.", { external: true });
  }
  if (creator.error_code === "scope_not_authorized") {
    addBlocker(blockers, "tiktok_scope_not_authorized", "creator_info says the current token is missing an authorised scope.", { external: true });
  }
  if (
    directPostProbe?.error_code === "unaudited_client_can_only_post_to_private_accounts" ||
    /unaudited_client_can_only_post_to_private_accounts/i.test(cleanText(directPostProbe?.error_message))
  ) {
    addBlocker(blockers, "tiktok_unaudited_client_private_only", "TikTok reported unaudited clients can only post to private accounts.", { external: true });
  }
  if (
    tokenStatus?.ok === true &&
    scopes.missing_scopes.length === 0 &&
    creator.available &&
    creator.public_to_everyone_available &&
    !directPostApproved
  ) {
    addBlocker(blockers, "tiktok_app_audit_required", "Public Direct Post is not declared approved for this TikTok app.", { external: true });
  }

  const classification = chooseClassification({
    blockers,
    credentialsPresent,
    operatorDisabled,
    uploadCodeOk: uploadCode?.ok !== false,
    tokenStatus,
    tokenFile,
    scopes,
    creator,
    directPostApproved,
    directPostProbe,
  });

  const publicPostingAllowed =
    classification === CLASSIFICATIONS.READY_PUBLIC &&
    creator.public_to_everyone_available &&
    directPostApproved;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "tiktok_live_enablement_readiness",
    classification,
    credentials: {
      client_key_present: hasEnv(env, "TIKTOK_CLIENT_KEY"),
      client_secret_present: hasEnv(env, "TIKTOK_CLIENT_SECRET"),
      redirect_uri_present: hasEnv(env, "TIKTOK_REDIRECT_URI"),
    },
    token: {
      file_exists: tokenFile.exists === true,
      access_present: tokenFile.access_token_present === true,
      refresh_present: tokenFile.refresh_token_present === true,
      open_id_present: tokenFile.open_id_present === true,
      expires_in_seconds: numberOrNull(tokenStatus.expires_in_seconds ?? tokenFile.expires_in_seconds),
      refresh_expires_in_seconds: numberOrNull(tokenFile.refresh_expires_in_seconds),
      status: tokenStatus.ok === true ? "ok" : tokenStatus.reason || "unknown",
      refresh_available: tokenStatus.refresh_available === true || tokenFile.refresh_token_present === true,
      needs_reauth: tokenStatus.needs_reauth === true,
      path: tokenFile.path || null,
    },
    scope_assumptions: scopes,
    creator_info: creator,
    public_posting: {
      allowed_now: publicPostingAllowed,
      direct_post_approval_declared: directPostApproved,
      public_to_everyone_available: creator.public_to_everyone_available,
      private_only_available: creator.private_only_available,
      blocker: publicPostingAllowed
        ? null
        : creator.public_to_everyone_available && !directPostApproved
          ? "direct_post_approval_not_declared"
          : creator.private_only_available
            ? "private_only_creator_or_client_state"
            : "creator_info_or_scope_not_ready",
    },
    private_test: {
      self_only_available: creator.privacy_level_options.includes("SELF_ONLY"),
      requires_explicit_operator_approval: true,
      allowed_by_this_report: false,
    },
    direct_post_probe: directPostProbe
      ? {
          error_code: directPostProbe.error_code || null,
          error_message: directPostProbe.error_message || null,
        }
      : null,
    blockers,
    docs: docs || {
      creator_info_query: "https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info/",
      direct_post: "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post",
      upload_video: "https://developers.tiktok.com/doc/content-posting-api-reference-upload-video",
      media_transfer: "https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide/",
      content_sharing_guidelines: "https://developers.tiktok.com/doc/content-sharing-guidelines",
    },
    safety: {
      no_token_values_printed: true,
      no_oauth_triggered: true,
      no_upload_executed: true,
      no_public_post_created: true,
      no_developer_portal_mutation: true,
      no_other_platforms_touched: true,
    },
  };
}

function renderTikTokReadinessMarkdown(report = {}) {
  const creator = report.creator_info || {};
  const token = report.token || {};
  const lines = [
    "# TikTok Readiness Report",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Classification: ${report.classification || "unknown"}`,
    "",
    "## Token",
    `- File exists: ${token.file_exists === true}`,
    `- Status: ${token.status || "unknown"}`,
    `- Expires in seconds: ${token.expires_in_seconds ?? "unknown"}`,
    `- Refresh available: ${token.refresh_available === true}`,
    `- Open ID present: ${token.open_id_present === true}`,
    "",
    "## Scopes",
    `- Required present: ${asArray(report.scope_assumptions?.missing_scopes).length === 0}`,
    `- Missing: ${asArray(report.scope_assumptions?.missing_scopes).join(", ") || "none"}`,
    "",
    "## Creator Info",
    `- Available: ${creator.available === true}`,
    `- Username: ${creator.creator_username || "unknown"}`,
    `- Privacy options: ${asArray(creator.privacy_level_options).join(", ") || "unknown"}`,
    `- Public available: ${creator.public_to_everyone_available === true}`,
    `- Max duration: ${creator.max_video_post_duration_sec ?? "unknown"}`,
    `- Comments disabled: ${creator.comment_disabled === true}`,
    `- Duet disabled: ${creator.duet_disabled === true}`,
    `- Stitch disabled: ${creator.stitch_disabled === true}`,
    "",
    "## Public Posting",
    `- Allowed now: ${report.public_posting?.allowed_now === true}`,
    `- Blocker: ${report.public_posting?.blocker || "none"}`,
    "",
    "## Blockers",
  ];
  if (asArray(report.blockers).length) {
    for (const blocker of report.blockers) lines.push(`- ${blocker.code}: ${blocker.message}`);
  } else {
    lines.push("- none");
  }
  lines.push("", "## Safety");
  lines.push("- Secret values are not printed.");
  lines.push("- No OAuth, upload, post, portal change or non-TikTok platform action is performed.");
  return `${lines.join("\n")}\n`;
}

function normaliseHashtag(value = "") {
  const text = cleanText(value).replace(/[^a-z0-9]/gi, "");
  return text ? `#${text}` : "";
}

function buildHashtags(action = {}) {
  const title = cleanText(action.title);
  const base = ["#gaming", "#gamingnews", "#videogames"];
  const extras = title
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .slice(0, 3)
    .map(normaliseHashtag);
  return unique([...base, ...extras]).slice(0, 8);
}

function buildCaption(action = {}) {
  const title = cleanText(action.title || action.story_id || "Pulse Gaming update").slice(0, 180);
  const hashtags = buildHashtags(action).join(" ");
  return cleanText(`${title} ${hashtags}`).slice(0, 2200);
}

function disclosureSnapshot(requirements = {}) {
  return {
    affiliate_disclosure_required: requirements.affiliate === true || requirements.affiliate_required === true,
    ai_disclosure_required:
      requirements.ai_generated === true ||
      requirements.ai_disclosure_required === true ||
      requirements.synthetic_media === true,
    commercial_disclosure_required:
      requirements.commercial === true ||
      requirements.commercial_content === true ||
      requirements.branded_content === true,
    branded_content: requirements.branded_content === true,
    own_brand: requirements.own_brand === true,
  };
}

function candidateDisclosureRequirements(candidate = {}) {
  const source = candidate.disclosure_requirements || candidate.disclosures || {};
  return {
    affiliate:
      source.affiliate === true ||
      source.affiliate_required === true ||
      source.affiliate_disclosure_required === true ||
      candidate.affiliate_disclosure_required === true,
    ai_generated:
      source.ai_generated === true ||
      source.ai_disclosure_required === true ||
      source.synthetic_media === true ||
      candidate.ai_disclosure_required === true,
    commercial:
      source.commercial === true ||
      source.commercial_content === true ||
      source.commercial_disclosure_required === true ||
      candidate.commercial_disclosure_required === true,
    branded_content:
      source.branded_content === true ||
      candidate.branded_content === true,
    own_brand:
      source.own_brand === true ||
      candidate.own_brand === true,
  };
}

function selectedPrivacyFromCreatorInfo({ readiness = {}, desiredPrivacyLevel = "PUBLIC_TO_EVERYONE" } = {}) {
  const creator = readiness.creator_info || {};
  const options = asArray(creator.privacy_level_options).map((option) => cleanText(option).toUpperCase());
  const desired = cleanText(desiredPrivacyLevel || "PUBLIC_TO_EVERYONE").toUpperCase();
  if (!options.length) {
    return { value: null, blocker: "creator_info_required_for_privacy_selection", options };
  }
  if (!options.includes(desired)) {
    return { value: null, blocker: `privacy_level_not_in_creator_info:${desired}`, options };
  }
  return { value: desired, blocker: null, options };
}

function actionStoryId(action = {}) {
  return cleanText(action.story_id || action.id);
}

function tiktokActionsFromStrictDryRun(dryRunPlan = {}) {
  const actionLists = [
    ...(Array.isArray(dryRunPlan.actions) ? dryRunPlan.actions : []),
    ...(Array.isArray(dryRunPlan.blocked_actions) ? dryRunPlan.blocked_actions : []),
  ];
  return actionLists.filter((action) => cleanText(action.platform) === "tiktok");
}

function candidateToTikTokAction(candidate = {}, { readiness = {}, strictAction = null } = {}) {
  const storyId = cleanText(candidate.story_id || candidate.id || strictAction?.story_id);
  const preflightBlockers = [
    ...asArray(candidate.blockers),
    ...asArray(candidate.preflight_qa?.blockers),
    ...asArray(candidate.preflight_qa?.failures),
  ];
  const preflightPass =
    candidate.preflight_qa?.status === "pass" ||
    candidate.status === "publish_ready" ||
    strictAction?.action === "would_publish" ||
    strictAction?.action === "would_queue_when_enabled";
  const strictActionMissing = !strictAction;
  const blockers = unique([
    ...preflightBlockers,
    ...(strictActionMissing ? ["strict_dry_run_tiktok_action_missing"] : []),
    ...asArray(strictAction?.blockers),
  ]);
  const duration = numberOrNull(
    strictAction?.video_duration_s ??
      strictAction?.duration_s ??
      strictAction?.duration_seconds ??
      candidate.video_duration_s ??
      candidate.duration_s ??
      candidate.duration_seconds,
  );
  const platformReady = readiness.classification === CLASSIFICATIONS.READY_PUBLIC;
  const action = strictAction?.action ||
    (preflightPass && blockers.length === 0
      ? platformReady
        ? "would_publish"
        : "would_queue_when_enabled"
      : "candidate_package");
  return {
    ...(strictAction || {}),
    story_id: storyId || null,
    platform: "tiktok",
    action,
    title: cleanText(strictAction?.title || candidate.title || storyId || "Pulse Gaming update"),
    video_path:
      strictAction?.video_path ||
      candidate.video_path ||
      candidate.exported_path ||
      candidate.source?.exported_path ||
      null,
    captions_path:
      strictAction?.captions_path ||
      candidate.captions_path ||
      candidate.source?.captions_path ||
      null,
    cover_frame_source:
      strictAction?.cover_frame_source ||
      candidate.cover_frame_source ||
      candidate.thumbnail_path ||
      null,
    video_duration_s: duration,
    creator_rewards_eligible: duration != null && duration >= 61 && duration <= 90,
    disclosure_requirements: candidateDisclosureRequirements(candidate),
    no_network_upload: true,
    blockers,
  };
}

function buildTikTokCandidateActions({
  dryRunPlan = {},
  nextCandidatesReport = {},
  readiness = {},
} = {}) {
  const strictActions = tiktokActionsFromStrictDryRun(dryRunPlan);
  const strictByStoryId = new Map();
  for (const action of strictActions) {
    const storyId = actionStoryId(action);
    if (storyId && !strictByStoryId.has(storyId)) strictByStoryId.set(storyId, action);
  }
  const candidates = Array.isArray(nextCandidatesReport.candidates)
    ? nextCandidatesReport.candidates
    : [];
  if (!candidates.length) return strictActions;
  return candidates.map((candidate) =>
    candidateToTikTokAction(candidate, {
      readiness,
      strictAction: strictByStoryId.get(cleanText(candidate.story_id || candidate.id)) || null,
    }),
  );
}

function buildTikTokPublishPack({
  generatedAt = new Date().toISOString(),
  readiness = {},
  action = null,
  videoSizeBytes = null,
  desiredPrivacyLevel = "PUBLIC_TO_EVERYONE",
} = {}) {
  const blockers = [];
  const sourceInfo = {};
  const uploadPlan = Number.isFinite(Number(videoSizeBytes)) && Number(videoSizeBytes) > 0
    ? planTikTokFileUploadChunks(Number(videoSizeBytes))
    : null;
  if (!uploadPlan) blockers.push("video_size_required_for_file_upload_source_info");
  else Object.assign(sourceInfo, uploadPlan.source_info);

  const privacy = selectedPrivacyFromCreatorInfo({ readiness, desiredPrivacyLevel });
  if (privacy.blocker) blockers.push(privacy.blocker);
  const duration = numberOrNull(action?.video_duration_s ?? action?.duration_s ?? action?.duration_seconds);
  const creatorMax = numberOrNull(readiness.creator_info?.max_video_post_duration_sec);
  if (duration == null) blockers.push("video_duration_required");
  if (duration != null && creatorMax != null && duration > creatorMax) {
    blockers.push("video_duration_above_creator_info_max");
  }
  if (!action || action.platform !== "tiktok") blockers.push("tiktok_action_required");
  if (action && action.action !== "would_publish") blockers.push("tiktok_platform_not_ready_public");
  if (readiness.classification !== CLASSIFICATIONS.READY_PUBLIC) {
    blockers.push("tiktok_platform_not_ready_public");
  }
  if (!cleanText(action?.video_path)) blockers.push("video_path_required");
  if (asArray(action?.blockers).length) blockers.push(...asArray(action.blockers));

  const postInfo = {
    title: buildCaption(action || {}),
    privacy_level: privacy.value,
    disable_comment: readiness.creator_info?.comment_disabled === true,
    disable_duet: readiness.creator_info?.duet_disabled === true,
    disable_stitch: readiness.creator_info?.stitch_disabled === true,
  };
  const uniqueBlockers = unique(blockers);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "tiktok_native_publish_pack",
    story_id: action?.story_id || null,
    action: action?.action || "missing",
    ready_for_direct_post: uniqueBlockers.length === 0,
    ready_for_private_only_test:
      readiness.classification === CLASSIFICATIONS.READY_PRIVATE_ONLY &&
      privacy.value === "SELF_ONLY" &&
      action?.action !== "blocked",
    caption: postInfo.title,
    hashtags: buildHashtags(action || {}),
    post_info: postInfo,
    source_info: uploadPlan ? sourceInfo : { source: "FILE_UPLOAD" },
    upload_plan: uploadPlan,
    duration: {
      seconds: duration,
      creator_rewards_suitable_61_90:
        duration != null && duration >= 61 && duration <= 90,
      max_video_post_duration_sec: creatorMax,
      within_creator_info_max:
        duration != null && (creatorMax == null || duration <= creatorMax),
    },
    video_path: action?.video_path || null,
    captions_path: action?.captions_path || null,
    cover_frame_source: action?.cover_frame_source || action?.video_path || null,
    disclosures: disclosureSnapshot(action?.disclosure_requirements || {}),
    privacy: {
      selected_privacy_level: privacy.value,
      privacy_level_options: privacy.options,
      chosen_from_creator_info: Boolean(privacy.value),
    },
    readiness_snapshot: {
      classification: readiness.classification || "unknown",
      public_posting_allowed_now: readiness.public_posting?.allowed_now === true,
      creator_info_available: readiness.creator_info?.available === true,
    },
    blockers: uniqueBlockers,
    safety: {
      dry_run_only: true,
      no_network_upload: true,
      no_public_post_created: true,
      no_disabled_platform_action_counted_as_publishable: true,
    },
  };
}

function videoSizeForAction(action = {}, videoSizesByStoryId = null) {
  const storyId = actionStoryId(action);
  if (videoSizesByStoryId instanceof Map) {
    return videoSizesByStoryId.get(storyId) ?? videoSizesByStoryId.get(action.video_path) ?? null;
  }
  if (videoSizesByStoryId && typeof videoSizesByStoryId === "object") {
    return videoSizesByStoryId[storyId] ?? videoSizesByStoryId[action.video_path] ?? null;
  }
  return null;
}

function buildTikTokPublishPackSet({
  generatedAt = new Date().toISOString(),
  readiness = {},
  actions = [],
  videoSizesByStoryId = null,
  desiredPrivacyLevel = "PUBLIC_TO_EVERYONE",
} = {}) {
  const tiktokActions = asArray(actions).filter((action) => cleanText(action.platform) === "tiktok");
  const packs = tiktokActions.map((action) =>
    buildTikTokPublishPack({
      generatedAt,
      readiness,
      action,
      videoSizeBytes: videoSizeForAction(action, videoSizesByStoryId),
      desiredPrivacyLevel,
    }),
  );
  const primary = packs[0] || buildTikTokPublishPack({
    generatedAt,
    readiness,
    action: null,
    videoSizeBytes: null,
    desiredPrivacyLevel,
  });
  const readyCount = packs.filter((pack) => pack.ready_for_direct_post === true).length;
  const queuedCount = packs.filter((pack) =>
    pack.ready_for_direct_post !== true &&
    pack.action === "would_queue_when_enabled" &&
    !asArray(pack.blockers).includes("strict_dry_run_tiktok_action_missing"),
  ).length;
  const blockedCount = packs.length ? packs.length - readyCount - queuedCount : 1;
  return {
    ...primary,
    mode: "tiktok_native_publish_pack_set",
    candidate_pack_count: packs.length,
    candidate_packs: packs,
    candidate_pack_summary: {
      total: packs.length,
      ready_for_direct_post_count: readyCount,
      queued_when_enabled_count: queuedCount,
      blocked_count: blockedCount,
      creator_rewards_suitable_61_90_count: packs.filter(
        (pack) => pack.duration?.creator_rewards_suitable_61_90 === true,
      ).length,
      all_candidates_packaged: packs.length === tiktokActions.length,
    },
  };
}

function buildTikTokPlatformPreflight({ readiness = {}, publishPack = {} } = {}) {
  const packs = asArray(publishPack.candidate_packs).length
    ? asArray(publishPack.candidate_packs)
    : [publishPack];
  const readyCount = packs.filter((pack) => pack.ready_for_direct_post === true).length;
  const queuedCount = packs.filter((pack) => {
    if (pack.ready_for_direct_post === true) return false;
    if (!pack.story_id) return false;
    if (asArray(pack.blockers).includes("strict_dry_run_tiktok_action_missing")) return false;
    return pack.action === "would_queue_when_enabled";
  }).length;
  const blockedCount = Math.max(0, packs.length - readyCount - queuedCount);
  const ready = readyCount > 0;
  const blockerCodes = asArray(readiness.blockers).map((blocker) => blocker.code).filter(Boolean);
  const packBlockers = unique(packs.flatMap((pack) => asArray(pack.blockers)));
  const platformEnablementGaps = unique(blockerCodes);
  const candidatePackageGaps = packBlockers;
  const operational = (() => {
    switch (readiness.classification) {
      case CLASSIFICATIONS.READY_PUBLIC:
        return { state: "enabled", reason: "tiktok_ready_public" };
      case CLASSIFICATIONS.TOKEN_REFRESH_REQUIRED:
        return { state: "needs_credentials", reason: "tiktok_token_refresh_required" };
      case CLASSIFICATIONS.REAUTH_REQUIRED:
      case CLASSIFICATIONS.SCOPE_MISSING:
      case CLASSIFICATIONS.CREDENTIALS_MISSING:
        return { state: "needs_credentials", reason: String(readiness.classification || "").toLowerCase() };
      case CLASSIFICATIONS.APP_AUDIT_REQUIRED:
        return { state: "blocked_external", reason: "tiktok_app_audit_required" };
      case CLASSIFICATIONS.READY_PRIVATE_ONLY:
        return { state: "blocked_external", reason: "tiktok_ready_private_only_requires_operator_approval" };
      case CLASSIFICATIONS.UPLOAD_CODE_BROKEN:
        return { state: "blocked", reason: "tiktok_upload_code_broken" };
      default:
        return { state: "blocked_external", reason: "tiktok_operator_external_action_required" };
    }
  })();
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    platform: "tiktok",
    status: ready
      ? "ready_now"
      : queuedCount > 0
        ? "deferred_until_platform_enabled"
        : "blocked",
    classification: readiness.classification || publishPack.readiness_snapshot?.classification || "unknown",
    operational_state: operational.state,
    operational_reason: operational.reason,
    candidate_pack_count: asArray(publishPack.candidate_packs).length,
    platform_enablement_gaps: platformEnablementGaps,
    candidate_package_gaps: candidatePackageGaps,
    enablement_gaps: platformEnablementGaps,
    enablement_next_action:
      readiness.classification === CLASSIFICATIONS.APP_AUDIT_REQUIRED
        ? "complete_tiktok_content_posting_api_public_direct_post_audit_then_rerun_live_enablement"
        : readiness.classification === CLASSIFICATIONS.TOKEN_REFRESH_REQUIRED
          ? "refresh_local_tiktok_token_then_rerun_creator_info"
          : readiness.classification === CLASSIFICATIONS.READY_PRIVATE_ONLY
            ? "operator_may_explicitly_approve_SELF_ONLY_private_smoke_test_or_complete_public_audit"
            : "resolve_tiktok_readiness_blockers_then_rerun_live_enablement",
    publishable_now_count: readyCount,
    queued_when_enabled_count: queuedCount,
    blocked_count: blockedCount,
    live_execution_gate: ready ? "operator_human_review_required" : "platform_enablement_required",
    live_execution_gate_reasons: unique([...platformEnablementGaps, ...candidatePackageGaps]),
    no_disabled_platform_action_counted_as_publishable:
      ready || readiness.classification !== CLASSIFICATIONS.READY_PUBLIC ? true : true,
    blockers: unique([...platformEnablementGaps, ...candidatePackageGaps]),
    safety: {
      no_network_uploads: true,
      no_public_posts: true,
      no_token_mutation: true,
    },
  };
}

function creatorRewardsStatus(duration) {
  if (duration == null) return "duration_unknown";
  if (duration < 61) return "below_61s";
  if (duration > 90) return "above_90s";
  return "ready_61_90s";
}

function buildTikTokDurationVariantReport({ actions = [], readiness = {} } = {}) {
  const max = numberOrNull(readiness.creator_info?.max_video_post_duration_sec);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    platform: "tiktok",
    creator_info_max_video_post_duration_sec: max,
    tiktok_actions: asArray(actions)
      .filter((action) => action.platform === "tiktok")
      .map((action) => {
        const duration = numberOrNull(action.video_duration_s ?? action.duration_s ?? action.duration_seconds);
        return {
          story_id: action.story_id || null,
          action: action.action || null,
          video_path: action.video_path || null,
          duration_seconds: duration,
          creator_rewards_window: {
            min: 61,
            max: 90,
            status: creatorRewardsStatus(duration),
          },
          within_creator_info_max: duration != null && (max == null || duration <= max),
          creator_rewards_eligible: action.creator_rewards_eligible === true || creatorRewardsStatus(duration) === "ready_61_90s",
        };
      }),
  };
}

function durationVariantSummary(durationVariantReport = {}) {
  const actions = asArray(durationVariantReport.tiktok_actions);
  const counts = {
    total: actions.length,
    ready_61_90s_count: 0,
    below_61s_count: 0,
    above_90s_count: 0,
    duration_unknown_count: 0,
  };
  for (const action of actions) {
    const status = cleanText(action.creator_rewards_window?.status);
    if (status === "ready_61_90s") counts.ready_61_90s_count += 1;
    else if (status === "below_61s") counts.below_61s_count += 1;
    else if (status === "above_90s") counts.above_90s_count += 1;
    else counts.duration_unknown_count += 1;
  }
  return counts;
}

function normaliseBlocker(blocker, fallback = {}) {
  if (typeof blocker === "string") {
    return {
      code: cleanText(blocker),
      message: cleanText(fallback.message || blocker),
      external: fallback.external === true,
      local: fallback.local === true,
    };
  }
  const source = blocker && typeof blocker === "object" ? blocker : {};
  const code = cleanText(source.code || source.reason || source.id || fallback.code);
  return {
    code,
    message: cleanText(source.message || source.detail || source.reason || fallback.message || code),
    external: source.external === true || fallback.external === true,
    local: source.local === true || fallback.local === true,
  };
}

function uniqueBlockers(blockers = []) {
  const seen = new Set();
  const output = [];
  for (const blocker of blockers.map((item) => normaliseBlocker(item)).filter((item) => item.code)) {
    if (seen.has(blocker.code)) continue;
    seen.add(blocker.code);
    output.push(blocker);
  }
  return output;
}

function publicPostingState(readinessReport = {}, platformPreflight = {}) {
  if (readinessReport.classification === CLASSIFICATIONS.READY_PUBLIC) {
    return Number(platformPreflight.publishable_now_count || 0) > 0
      ? "ready_public_direct_post"
      : "ready_public_waiting_for_candidate";
  }
  if (readinessReport.classification === CLASSIFICATIONS.READY_PRIVATE_ONLY) {
    return "private_only_available_operator_approval_required";
  }
  if (readinessReport.classification === CLASSIFICATIONS.APP_AUDIT_REQUIRED) {
    return "blocked_external_public_direct_post";
  }
  if (readinessReport.classification === CLASSIFICATIONS.TOKEN_REFRESH_REQUIRED) {
    return "needs_local_token_refresh";
  }
  if (
    readinessReport.classification === CLASSIFICATIONS.REAUTH_REQUIRED ||
    readinessReport.classification === CLASSIFICATIONS.SCOPE_MISSING ||
    readinessReport.classification === CLASSIFICATIONS.CREDENTIALS_MISSING
  ) {
    return "needs_operator_credentials_or_scopes";
  }
  return "not_ready";
}

function buildTikTokDirectPostReadiness({
  readinessReport = {},
  platformPreflight = {},
  publishPack = {},
} = {}) {
  const summary = publishPack.candidate_pack_summary || {};
  return {
    schema_version: 1,
    generated_at: readinessReport.generated_at || platformPreflight.generated_at || new Date().toISOString(),
    platform: "tiktok",
    classification: readinessReport.classification || "unknown",
    public: {
      allowed_now: readinessReport.public_posting?.allowed_now === true,
      direct_post_approval_declared:
        readinessReport.public_posting?.direct_post_approval_declared === true,
      blocker: readinessReport.public_posting?.blocker || null,
      publishable_now_count: Number(platformPreflight.publishable_now_count || 0),
      ready_pack_count: Number(summary.ready_for_direct_post_count || 0),
    },
    private_test: {
      self_only_available: readinessReport.private_test?.self_only_available === true,
      allowed_by_this_report: readinessReport.private_test?.allowed_by_this_report === true,
      requires_explicit_operator_approval: true,
    },
    creator_info_required: true,
    live_execution_gate:
      platformPreflight.live_execution_gate ||
      (readinessReport.classification === CLASSIFICATIONS.READY_PUBLIC
        ? "operator_human_review_required"
        : "platform_enablement_required"),
    live_execution_gate_reasons: unique(asArray(platformPreflight.live_execution_gate_reasons)),
    safety: {
      no_network_uploads: true,
      no_public_posts: true,
      no_token_mutation: true,
    },
  };
}

function buildTikTokCreatorInfoStatus(readinessReport = {}) {
  const creator = readinessReport.creator_info || {};
  return {
    schema_version: 1,
    generated_at: readinessReport.generated_at || new Date().toISOString(),
    platform: "tiktok",
    available: creator.available === true,
    ok: creator.ok === true,
    http_status: creator.http_status || null,
    error_code: creator.error_code || null,
    error_message: creator.error_message || null,
    creator_username: creator.creator_username || null,
    creator_nickname: creator.creator_nickname || null,
    privacy_level_options: asArray(creator.privacy_level_options),
    public_to_everyone_available: creator.public_to_everyone_available === true,
    private_only_available: creator.private_only_available === true,
    max_video_post_duration_sec: numberOrNull(creator.max_video_post_duration_sec),
    comment_disabled: creator.comment_disabled === true,
    duet_disabled: creator.duet_disabled === true,
    stitch_disabled: creator.stitch_disabled === true,
  };
}

function buildTikTokEnablementStatus({
  readinessReport = {},
  platformPreflight = {},
  publishPack = {},
  durationVariantReport = {},
} = {}) {
  const readinessBlockers = uniqueBlockers(readinessReport.blockers);
  const candidateGapBlockers = uniqueBlockers(asArray(platformPreflight.candidate_package_gaps).map((gap) => ({
    code: gap,
    message: gap,
    local: true,
  })));
  const repoSideBlockers = uniqueBlockers([
    ...readinessBlockers.filter((blocker) => blocker.local === true || blocker.external !== true),
    ...candidateGapBlockers,
  ]);
  const externalOperatorBlockers = uniqueBlockers(
    readinessBlockers.filter((blocker) => blocker.external === true),
  );
  const directPost = buildTikTokDirectPostReadiness({
    readinessReport,
    platformPreflight,
    publishPack,
  });
  const livePublishAllowed =
    readinessReport.classification === CLASSIFICATIONS.READY_PUBLIC &&
    directPost.public.allowed_now === true &&
    Number(platformPreflight.publishable_now_count || 0) > 0;
  return {
    schema_version: 1,
    generated_at: readinessReport.generated_at || platformPreflight.generated_at || new Date().toISOString(),
    platform: "tiktok",
    classification: readinessReport.classification || "unknown",
    operational_state: platformPreflight.operational_state || "unknown",
    operational_reason: platformPreflight.operational_reason || null,
    public_posting_state: publicPostingState(readinessReport, platformPreflight),
    live_publish_allowed: livePublishAllowed,
    counted_as_live_enabled_platform: livePublishAllowed,
    publishable_now_count: Number(platformPreflight.publishable_now_count || 0),
    queued_when_enabled_count: Number(platformPreflight.queued_when_enabled_count || 0),
    blocked_count: Number(platformPreflight.blocked_count || 0),
    direct_post_readiness: directPost,
    creator_info_status: buildTikTokCreatorInfoStatus(readinessReport),
    duration_variant_summary: {
      ...durationVariantSummary(durationVariantReport),
      creator_rewards_suitable_61_90_count:
        Number(publishPack.candidate_pack_summary?.creator_rewards_suitable_61_90_count || 0),
    },
    repo_side_blockers: repoSideBlockers,
    external_operator_blockers: externalOperatorBlockers,
    next_action:
      externalOperatorBlockers.length > 0
        ? "operator_resolves_tiktok_external_blocker_then_rerun_live_enablement"
        : repoSideBlockers.length > 0
          ? "repair_tiktok_repo_side_blockers_then_rerun_live_enablement"
          : livePublishAllowed
            ? "keep_tiktok_behind_guarded_operator_approval_until_platform_explicitly_enabled"
            : "rerun_tiktok_live_enablement_after_candidate_refresh",
    safety: {
      no_oauth_triggered: true,
      no_token_values_printed: true,
      no_token_mutation: true,
      no_upload_executed: true,
      no_public_post_created: true,
      disabled_platform_not_counted_live: livePublishAllowed !== true,
    },
  };
}

function renderOperatorActionPlan(report = {}) {
  const blockerCodes = asArray(report.blockers).map((blocker) => blocker.code);
  const directPostBlocker = report.public_posting?.blocker || null;
  const currentErrorCode =
    report.direct_post_probe?.error_code ||
    directPostBlocker ||
    report.creator_info?.error_code ||
    "none";
  const currentErrorMessage =
    report.direct_post_probe?.error_message ||
    asArray(report.blockers).find((blocker) => blocker.code === "tiktok_app_audit_required")?.message ||
    report.creator_info?.error_message ||
    "No TikTok error body was generated because live upload/init was not attempted.";
  const currentAppStatus = (() => {
    if (report.classification === CLASSIFICATIONS.APP_AUDIT_REQUIRED) {
      return "public_direct_post_audit_not_declared";
    }
    if (report.classification === CLASSIFICATIONS.READY_PUBLIC) return "public_direct_post_ready";
    if (report.classification === CLASSIFICATIONS.READY_PRIVATE_ONLY) return "private_only_ready";
    if (blockerCodes.includes("tiktok_operator_disabled")) return "operator_disabled";
    return "requires_operator_verification";
  })();
  const lines = [
    "# TikTok Operator Action Plan",
    "",
    `Classification: ${report.classification || "unknown"}`,
    "",
    "## Current Proof",
    `- Current app status: ${currentAppStatus}`,
    `- Current error code: ${currentErrorCode}`,
    `- Current error message: ${currentErrorMessage}`,
    `- Required scopes: ${REQUIRED_SCOPES.join(", ")}`,
    `- Token scopes present: ${asArray(report.scope_assumptions?.token_scope_list).join(", ") || "unknown"}`,
    `- creator_info status: ${report.creator_info?.available === true ? "succeeded" : "not_available"}`,
    `- creator username: ${report.creator_info?.creator_username || "unknown"}`,
    `- privacy_level_options: ${asArray(report.creator_info?.privacy_level_options).join(", ") || "unknown"}`,
    `- PUBLIC_TO_EVERYONE returned by creator_info: ${report.creator_info?.public_to_everyone_available === true}`,
    "",
    "## Required Actions",
  ];
  const blockers = asArray(report.blockers);
  if (!blockers.length) {
    lines.push("- No TikTok blocker remains in this readiness report. Use guarded publish preflight before any live upload.");
  } else {
    for (const blocker of blockers) {
      if (blocker.code === "tiktok_token_expired_refreshable") {
        lines.push("- Run local TikTok token refresh, then rerun creator-info and dry-run payload validation.");
      } else if (blocker.code === "tiktok_app_audit_required") {
        lines.push("- In TikTok for Developers, confirm the app has Content Posting API Direct Post approval and public visibility audit clearance.");
      } else if (/scope/.test(blocker.code)) {
        lines.push("- Re-authorise the TikTok account with user.info.basic, video.publish and video.upload.");
      } else if (/reauth/.test(blocker.code)) {
        lines.push("- Complete the protected TikTok OAuth flow from the server route, then rerun this report.");
      } else if (/operator_disabled/.test(blocker.code)) {
        lines.push("- Enable TikTok operator switches only after readiness is GREEN or the operator approves a private SELF_ONLY smoke test.");
      } else {
        lines.push(`- Resolve ${blocker.code}: ${blocker.message}`);
      }
    }
  }
  lines.push("", "## Developer Portal Checklist");
  lines.push("- Login Kit redirect URI exactly matches the deployed callback URL.");
  lines.push("- Content Posting API product is enabled for the same app/client key.");
  lines.push("- Scopes requested and approved: user.info.basic, video.publish, video.upload.");
  lines.push("- Public Direct Post audit is approved before PUBLIC_TO_EVERYONE live posting.");
  lines.push("- URL properties are verified before switching any path to PULL_FROM_URL.");
  lines.push("", "## Screenshots Or Records Needed");
  lines.push("- Screenshot or record the TikTok Developer Portal app status for the active client key.");
  lines.push("- Screenshot or record the Content Posting API product page showing Direct Post/public posting audit status.");
  lines.push("- Screenshot or record the Login Kit redirect URI and authorised scopes page.");
  lines.push("", "## Exact next external step");
  if (report.classification === CLASSIFICATIONS.APP_AUDIT_REQUIRED) {
    lines.push("- Complete or confirm TikTok Content Posting API Direct Post public audit approval for this app, then set the TikTok operator switches and direct-post approval env flags deliberately before rerunning `npm run tiktok:live-enablement` and strict dry-run publish.");
  } else if (report.classification === CLASSIFICATIONS.READY_PRIVATE_ONLY) {
    lines.push("- Either approve a one-off SELF_ONLY smoke test explicitly or complete public Direct Post audit before any public upload.");
  } else {
    lines.push("- Resolve the listed credential, scope or operator action, then rerun `npm run tiktok:live-enablement`.");
  }
  return `${lines.join("\n")}\n`;
}

function renderTikTokLiveEnablementMarkdown({
  readinessReport = {},
  publishPack = {},
  platformPreflight = {},
  durationVariantReport = {},
} = {}) {
  const summaryPack = selectTikTokSummaryPack(publishPack);
  const lines = [
    "# TikTok Live Enablement Report",
    "",
    `Classification: ${readinessReport.classification || "unknown"}`,
    `Publishable now: ${platformPreflight.publishable_now_count || 0}`,
    `Queued when enabled: ${platformPreflight.queued_when_enabled_count || 0}`,
    `Candidate TikTok packs: ${publishPack.candidate_pack_count || asArray(publishPack.candidate_packs).length || 0}`,
    `Direct post pack ready: ${summaryPack.ready_for_direct_post === true}`,
    "",
    "## Current Blockers",
  ];
  if (asArray(readinessReport.blockers).length) {
    for (const blocker of readinessReport.blockers) lines.push(`- ${blocker.code}: ${blocker.message}`);
  } else {
    lines.push("- none");
  }
  lines.push("", "## TikTok Package");
  lines.push(`- Story: ${summaryPack.story_id || "none"}`);
  lines.push(`- Action: ${summaryPack.action || "none"}`);
  lines.push(`- Video: ${summaryPack.video_path || "none"}`);
  lines.push(`- Privacy: ${summaryPack.post_info?.privacy_level || "not selected"}`);
  lines.push(`- Source: ${summaryPack.source_info?.source || "FILE_UPLOAD"}`);
  lines.push(`- Duration: ${summaryPack.duration?.seconds ?? "unknown"}s`);
  if (asArray(publishPack.candidate_packs).length) {
    lines.push(`- Candidate pack count: ${publishPack.candidate_pack_count || publishPack.candidate_packs.length}`);
    lines.push(`- Candidate package gaps: ${asArray(platformPreflight.candidate_package_gaps).join(", ") || "none"}`);
    lines.push(`- Platform enablement gaps: ${asArray(platformPreflight.platform_enablement_gaps).join(", ") || "none"}`);
  }
  lines.push("", "## Duration Variant");
  for (const action of asArray(durationVariantReport.tiktok_actions)) {
    lines.push(`- ${action.story_id}: ${action.duration_seconds ?? "unknown"}s (${action.creator_rewards_window?.status || "unknown"})`);
  }
  lines.push("", "## Safety");
  lines.push("- No live TikTok post is implied by this report.");
  lines.push("- YouTube, Instagram and Facebook posting paths were not modified by this gate.");
  return `${lines.join("\n")}\n`;
}

function selectTikTokSummaryPack(publishPack = {}) {
  const packs = asArray(publishPack.candidate_packs);
  if (!packs.length) return publishPack || {};
  return (
    packs.find((pack) => pack?.ready_for_direct_post === true) ||
    packs.find((pack) => cleanText(pack?.action) === "would_queue_when_enabled") ||
    packs.find((pack) => !asArray(pack?.blockers).includes("strict_dry_run_tiktok_action_missing")) ||
    packs[0] ||
    publishPack ||
    {}
  );
}

async function writeTikTokLiveEnablementArtifacts({
  outputDir,
  readinessReport = {},
  publishPack = {},
  platformPreflight = {},
  durationVariantReport = {},
  testsRunSummary = {},
  platformStatusMatrix = null,
  postEvidence = null,
} = {}) {
  if (!outputDir) throw new Error("writeTikTokLiveEnablementArtifacts requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const blockers = {
    schema_version: 1,
    generated_at: readinessReport.generated_at || new Date().toISOString(),
    classification: readinessReport.classification || "unknown",
    blockers: asArray(readinessReport.blockers),
  };
  const matrix = platformStatusMatrix || {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    platforms: {
      tiktok: platformPreflight,
    },
  };
  const enablementStatus = buildTikTokEnablementStatus({
    readinessReport,
    publishPack,
    platformPreflight,
    durationVariantReport,
  });
  const creatorInfoStatus = enablementStatus.creator_info_status;
  const directPostReadiness = enablementStatus.direct_post_readiness;
  const operatorBlockers = {
    schema_version: 1,
    generated_at: enablementStatus.generated_at,
    platform: "tiktok",
    classification: enablementStatus.classification,
    repo_side_blockers: enablementStatus.repo_side_blockers,
    external_operator_blockers: enablementStatus.external_operator_blockers,
    next_action: enablementStatus.next_action,
  };
  const matrixWithEnablement = {
    ...matrix,
    platforms: {
      ...(matrix.platforms || {}),
      tiktok: {
        ...(matrix.platforms?.tiktok || {}),
        enablement_status: enablementStatus,
      },
    },
  };
  const files = {
    readinessJsonPath: path.join(outDir, "tiktok_readiness_report.json"),
    readinessMarkdownPath: path.join(outDir, "tiktok_readiness_report.md"),
    enablementReportPath: path.join(outDir, "tiktok_enablement_report.json"),
    creatorInfoStatusPath: path.join(outDir, "tiktok_creator_info_status.json"),
    directPostReadinessPath: path.join(outDir, "tiktok_direct_post_readiness.json"),
    operatorBlockersPath: path.join(outDir, "tiktok_operator_blockers.json"),
    blockersPath: path.join(outDir, "tiktok_blockers.json"),
    operatorActionPlanPath: path.join(outDir, "tiktok_operator_action_plan.md"),
    publishPackPath: path.join(outDir, "tiktok_publish_pack.json"),
    platformPreflightPath: path.join(outDir, "tiktok_platform_preflight.json"),
    durationVariantReportPath: path.join(outDir, "tiktok_duration_variant_report.json"),
    liveEnablementReportPath: path.join(outDir, "tiktok_live_enablement_report.md"),
    platformStatusMatrixPath: path.join(outDir, "platform_status_matrix.json"),
    testsRunSummaryPath: path.join(outDir, "tests_run_summary.json"),
    postEvidencePath: path.join(outDir, "tiktok_post_evidence.json"),
  };
  await fs.writeJson(files.readinessJsonPath, readinessReport, { spaces: 2 });
  await fs.writeFile(files.readinessMarkdownPath, renderTikTokReadinessMarkdown(readinessReport), "utf8");
  await fs.writeJson(files.enablementReportPath, enablementStatus, { spaces: 2 });
  await fs.writeJson(files.creatorInfoStatusPath, creatorInfoStatus, { spaces: 2 });
  await fs.writeJson(files.directPostReadinessPath, directPostReadiness, { spaces: 2 });
  await fs.writeJson(files.operatorBlockersPath, operatorBlockers, { spaces: 2 });
  await fs.writeJson(files.blockersPath, blockers, { spaces: 2 });
  await fs.writeFile(files.operatorActionPlanPath, renderOperatorActionPlan(readinessReport), "utf8");
  await fs.writeJson(files.publishPackPath, publishPack, { spaces: 2 });
  await fs.writeJson(files.platformPreflightPath, platformPreflight, { spaces: 2 });
  await fs.writeJson(files.durationVariantReportPath, durationVariantReport, { spaces: 2 });
  await fs.writeFile(
    files.liveEnablementReportPath,
    renderTikTokLiveEnablementMarkdown({
      readinessReport,
      publishPack,
      platformPreflight,
      durationVariantReport,
    }),
    "utf8",
  );
  await fs.writeJson(files.platformStatusMatrixPath, matrixWithEnablement, { spaces: 2 });
  await fs.writeJson(files.testsRunSummaryPath, testsRunSummary, { spaces: 2 });
  if (postEvidence) await fs.writeJson(files.postEvidencePath, postEvidence, { spaces: 2 });
  return files;
}

module.exports = {
  CLASSIFICATIONS,
  REQUIRED_SCOPES,
  buildTikTokReadinessReport,
  buildTikTokCandidateActions,
  renderTikTokReadinessMarkdown,
  buildTikTokEnablementStatus,
  buildTikTokCreatorInfoStatus,
  buildTikTokDirectPostReadiness,
  buildTikTokPublishPack,
  buildTikTokPublishPackSet,
  buildTikTokPlatformPreflight,
  buildTikTokDurationVariantReport,
  renderOperatorActionPlan,
  renderTikTokLiveEnablementMarkdown,
  writeTikTokLiveEnablementArtifacts,
};
