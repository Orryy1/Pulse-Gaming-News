"use strict";

const { hasApprovedPulseCta } = require("../pulse-cta");
const {
  shouldRejectGeneralRedditForNews,
} = require("../community-discussion-gate");

const DEFAULT_LIMIT = 30;

const AUTO_REPAIR_LANES = new Set([
  "audio_regeneration",
  "script_runtime_rewrite",
  "canonical_script_rewrite",
  "stale_script_qa_recheck",
  "script_generation_retry",
  "visual_v4_motion_enrichment",
  "platform_media_repair",
  "produce_or_render",
  "stale_story_refresh",
]);

const PUBLIC_PLATFORM_FIELDS = [
  "youtube_post_id",
  "youtube_url",
  "tiktok_post_id",
  "instagram_media_id",
  "facebook_post_id",
  "twitter_post_id",
  "x_post_id",
];

const PROMOTION_COPY_FIELDS = [
  "canonical_subject",
  "primary_story_entity",
  "canonical_angle",
  "flair",
  "classification",
  "subreddit",
  "primary_source",
  "discovery_source",
  "short_title",
  "suggested_title",
  "suggested_thumbnail_text",
  "thumbnail_headline",
  "first_frame_text",
  "description",
  "pinned_comment",
  "full_script",
  "tts_script",
  "hook",
  "body",
  "loop",
  "sources",
  "source_type",
  "audio_path",
  "audio_duration",
  "duration_seconds",
  "timestamps_path",
  "video_clips",
  "visual_v4_motion_pack",
  "visual_v4_director_plan",
  "visual_v4_render_bridge_status",
  "visual_v4_render_bridge_clip_count",
  "visual_v4_bridge_video_clips",
  "visual_v4_clip_materialization",
  "rights_ledger",
  "render_lane",
  "render_quality_class",
  "qa_visual_count",
  "manual_caption_generated",
  "clean_manual_captions",
  "subtitle_timing_source",
  "word_count",
];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function countWords(value) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  return words.length;
}

function normaliseSearchText(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstSubjectToken(subject = "") {
  const stopWords = new Set(["the", "a", "an", "of", "and", "for", "with"]);
  return (
    normaliseSearchText(subject)
      .split(/\s+/)
      .find((token) => token.length >= 3 && !stopWords.has(token)) || ""
  );
}

function textHasSubjectToken(text = "", subject = "") {
  const token = firstSubjectToken(subject);
  if (!token) return true;
  return normaliseSearchText(text).split(/\s+/).includes(token);
}

function buildSubjectAwareThumbnailText({ current = "", subject = "", title = "" } = {}) {
  const existing = cleanText(current).toUpperCase();
  const subjectToken = firstSubjectToken(subject).toUpperCase();
  if (!subjectToken) return existing;
  if (textHasSubjectToken(existing, subject)) return existing;

  const prefixed = cleanText(`${subjectToken} ${existing}`).toUpperCase();
  if (existing && countWords(prefixed) <= 7 && prefixed.length <= 42) return prefixed;

  const titleTokens = normaliseSearchText(title)
    .split(/\s+/)
    .filter((token) => token && token !== subjectToken.toLowerCase());
  const priority = titleTokens.filter((token) =>
    ["steam", "xbox", "switch", "playstation", "record", "broke", "deal", "price", "launch"].includes(token),
  );
  const filler = priority.length ? priority : titleTokens;
  const compact = [subjectToken, ...filler.slice(0, 3).map((token) => token.toUpperCase())]
    .join(" ")
    .trim();
  return compact || subjectToken;
}

function finiteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.filter(Boolean).map(String));
  return new Set();
}

function normaliseReason(value) {
  return cleanText(value).toLowerCase();
}

function storyScore(story = {}) {
  const score = Number(story.breaking_score ?? story.score ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function storyPublicScriptText(story = {}) {
  return [
    story.full_script,
    story.tts_script,
    story.hook,
    story.body,
    story.loop,
    story.cta,
  ]
    .filter(Boolean)
    .join("\n");
}

function stringListText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value || "");
}

function storyRequiresCanonicalRewriteBeforeCtaRecheck(reason = "", story = {}) {
  const knownFailures = [
    reason,
    story.script_review_reason,
    story.publish_error,
    stringListText(story.qa_failures),
    stringListText(story.content_qa_failures),
    stringListText(story.preflight_blockers),
    storyPublicScriptText(story),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (
    /general_reddit_thread_as_news|community_reddit_media_not_news|top_comment_used_as_fact|placeholder_title|source backed|internal_qa|unsupported_verified_insider_framing|general_reddit_verified_insider_claim|\bverified insider claims\b|\binsiders?\s+(?:claim|claims|say|says|suggest|report|reports)\b/.test(
      knownFailures,
    )
  ) {
    return true;
  }

  return shouldRejectGeneralRedditForNews(story);
}

function hasNonRedditArticleSource(story = {}) {
  const url = cleanText(story.article_url || story.source_url || story.url);
  if (!/^https?:\/\//i.test(url) || /reddit\.com/i.test(url)) return false;
  if (/\b(?:i|preview)\.redd\.it\b/i.test(url)) return false;
  if (/\bv\.redd\.it\b/i.test(url)) return false;
  if (/\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return false;
  return true;
}

function isTrustedLeakSource(story = {}) {
  const subreddit = cleanText(story.subreddit || story.source_name)
    .toLowerCase()
    .replace(/^r\//, "");
  return subreddit === "gamingleaksandrumours";
}

function isSourceBackedCanonicalRepair(story = {}) {
  const sourceType = cleanText(story.source_type).toLowerCase();
  return sourceType === "rss" || hasNonRedditArticleSource(story) || isTrustedLeakSource(story);
}

function canonicalRewriteCanBeAutomated(reason = "", story = {}) {
  const lower = normaliseReason(reason);
  if (/general_reddit_thread_as_news|vague_sources_on_general_reddit/.test(lower)) {
    return false;
  }
  if (/top_comment_used_as_fact/.test(lower)) {
    return cleanText(story.source_type).toLowerCase() === "rss" || hasNonRedditArticleSource(story);
  }
  return isSourceBackedCanonicalRepair(story);
}

function staleExactCtaFailureCanBeRechecked(reason = "", story = {}) {
  return (
    /missing_exact_cta_in_script/.test(normaliseReason(reason)) &&
    hasApprovedPulseCta(storyPublicScriptText(story)) &&
    !storyRequiresCanonicalRewriteBeforeCtaRecheck(reason, story)
  );
}

function hasRealValue(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/^(none|null|undefined|false|0)$/i.test(text);
}

function existingPublicPlatformFields(story = {}) {
  return PUBLIC_PLATFORM_FIELDS.filter((field) => hasRealValue(story[field]));
}

function uniqueMotionFamilies(story = {}) {
  const clips = Array.isArray(story.visual_v4_bridge_video_clips)
    ? story.visual_v4_bridge_video_clips
    : Array.isArray(story.video_clips)
      ? story.video_clips
      : [];
  const families = new Set();
  for (const clip of clips) {
    if (clip && typeof clip === "object" && clip.source_family) {
      families.add(String(clip.source_family));
    }
  }
  return families;
}

function fileExistsSafe(filePath, fileExists) {
  if (!filePath) return false;
  if (typeof fileExists !== "function") return true;
  try {
    return fileExists(filePath) === true;
  } catch {
    return false;
  }
}

function renderHasAudioSafe(renderPath, renderHasAudio) {
  if (typeof renderHasAudio !== "function") return false;
  try {
    return renderHasAudio(renderPath) === true;
  } catch {
    return false;
  }
}

function isSteamStorefrontVisual(asset = {}) {
  const source = cleanText(asset.source).toLowerCase();
  const url = cleanText(asset.url || asset.source_url).toLowerCase();
  return (
    source === "steam" ||
    /(?:cdn|shared)\.akamai\.steamstatic\.com\/(?:steam|store_item_assets)\//.test(url)
  );
}

function buildSteamVisualRightsRecord(asset = {}, storyId = "", index = 0) {
  const sourceUrl = cleanText(asset.url || asset.source_url);
  if (!sourceUrl || !isSteamStorefrontVisual(asset)) return null;
  return {
    asset_id: `${storyId || "story"}_steam_visual_${index + 1}`,
    source_url: sourceUrl,
    source_type: "steam_storefront_promotional_visual",
    licence_basis: "steam_storefront_promotional_reference",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
    expiry: null,
    credit_required: false,
    commercial_use_allowed: true,
    risk_score: 0.35,
    evidence_file: "steam_storefront_metadata",
    rights_risk_class: "steam_storefront_promotional",
  };
}

function mergePromotionRightsLedger(existingLedger = [], story = {}, storyId = "") {
  const records = Array.isArray(existingLedger) ? [...existingLedger] : [];
  const seen = new Set(
    records.map((record) =>
      [
        cleanText(record.asset_id || record.id),
        cleanText(record.path || record.local_path),
        cleanText(record.source_url || record.url),
      ]
        .filter(Boolean)
        .join("|")
        .toLowerCase(),
    ),
  );

  const visualAssets = [
    ...(Array.isArray(story.game_images) ? story.game_images : []),
    ...(Array.isArray(story.downloaded_images) ? story.downloaded_images : []),
  ];

  for (const [index, asset] of visualAssets.entries()) {
    const record = buildSteamVisualRightsRecord(asset, storyId, index);
    if (!record) continue;
    const key = [record.asset_id, record.path, record.source_url]
      .filter(Boolean)
      .join("|")
      .toLowerCase();
    const urlKey = cleanText(record.source_url).toLowerCase();
    if (seen.has(key) || seen.has(urlKey)) continue;
    records.push(record);
    seen.add(key);
    seen.add(urlKey);
  }

  return records;
}

function countSteamVisualRights(records = []) {
  return (Array.isArray(records) ? records : []).filter(
    (record) => record && record.licence_basis === "steam_storefront_promotional_reference",
  ).length;
}

function sameReviewValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function buildPromotionOperatorReview({
  liveStory = {},
  updateStory = {},
  renderStory = {},
  rightsLedgerRecordsBefore = 0,
  inheritedSteamVisualRightsAdded = 0,
} = {}) {
  const motionClips = Array.isArray(renderStory.visual_v4_bridge_video_clips)
    ? renderStory.visual_v4_bridge_video_clips
    : Array.isArray(renderStory.video_clips)
      ? renderStory.video_clips
      : [];
  const motionFamilies = uniqueMotionFamilies(renderStory);
  const reviewFields = [
    "title",
    "suggested_title",
    "canonical_subject",
    "canonical_angle",
    "exported_path",
    "approved",
    "auto_approved",
    "approved_at",
    "full_script",
    "tts_script",
    "suggested_thumbnail_text",
    "thumbnail_headline",
    "first_frame_text",
    "audio_path",
    "rights_ledger",
    "visual_v4_bridge_video_clips",
    "render_quality_class",
    "duration_seconds",
    "audio_duration",
    "qa_visual_count",
    "manual_caption_generated",
    "clean_manual_captions",
    "subtitle_timing_source",
    "word_count",
  ];
  const changedFields = reviewFields.filter(
    (field) => !sameReviewValue(liveStory[field], updateStory[field]),
  );
  const approvalChanges = ["approved", "auto_approved", "approved_at"]
    .filter((field) => !sameReviewValue(liveStory[field], updateStory[field]))
    .map((field) => ({
      field,
      from: liveStory[field] ?? null,
      to: updateStory[field] ?? null,
    }));

  return {
    story_id: cleanText(updateStory.id || liveStory.id),
    changed_fields: changedFields,
    approval_changes: approvalChanges,
    public_platform_fields_present: existingPublicPlatformFields(liveStory),
    asset_summary: {
      motion_clips: motionClips.length,
      unique_motion_families: motionFamilies.size,
      rights_ledger_records_before: rightsLedgerRecordsBefore,
      rights_ledger_records_after: Array.isArray(updateStory.rights_ledger)
        ? updateStory.rights_ledger.length
        : 0,
      inherited_steam_visual_rights_added: inheritedSteamVisualRightsAdded,
    },
  };
}

function buildGovernanceGreenApprovalPromotionPlan({
  liveStory = {},
  renderStory = {},
  manifest = {},
  renderPath = "",
  renderReport = {},
  fileExists = null,
  renderHasAudio = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const warnings = [];
  const storyId = cleanText(liveStory.id || renderStory.id || manifest.story_id);
  const canonicalSubject = cleanText(
    manifest.canonical_subject || renderStory.canonical_subject || renderStory.primary_story_entity,
  );
  const title = cleanText(manifest.title || renderStory.title || renderStory.short_title);
  const script = cleanText(renderStory.tts_script || renderStory.full_script);
  const platformFields = existingPublicPlatformFields(liveStory);
  const motionFamilies = uniqueMotionFamilies(renderStory);
  const finalRenderHasAudio = renderHasAudioSafe(renderPath, renderHasAudio);

  if (!storyId) blockers.push("story_id_missing");
  if (manifest.publish_status !== "GREEN") blockers.push("manifest_not_green");
  if (manifest.can_auto_publish !== true) blockers.push("manifest_not_auto_publishable");
  if (Array.isArray(manifest.reason_codes) && manifest.reason_codes.length > 0) {
    blockers.push("manifest_has_reason_codes");
  }
  if (manifest.story_id && storyId && manifest.story_id !== storyId) {
    blockers.push("manifest_story_id_mismatch");
  }
  if (renderStory.id && storyId && renderStory.id !== storyId) {
    blockers.push("render_story_id_mismatch");
  }
  if (!canonicalSubject) blockers.push("canonical_subject_missing");
  if (!title || /^this gaming story$/i.test(title)) blockers.push("publish_title_missing_or_placeholder");
  if (canonicalSubject && title && !title.toLowerCase().includes(canonicalSubject.toLowerCase())) {
    blockers.push("canonical_subject_missing_from_title");
  }
  if (!script) blockers.push("script_missing");
  if (canonicalSubject && script && !script.slice(0, 240).toLowerCase().includes(canonicalSubject.toLowerCase())) {
    blockers.push("canonical_subject_missing_from_opening_script");
  }
  if (!renderPath) blockers.push("render_path_missing");
  else if (!fileExistsSafe(renderPath, fileExists)) blockers.push("render_path_missing_on_disk");
  if (!renderStory.audio_path && !finalRenderHasAudio) blockers.push("audio_path_missing");
  else if (
    renderStory.audio_path &&
    !fileExistsSafe(renderStory.audio_path, fileExists) &&
    !finalRenderHasAudio
  ) {
    blockers.push("audio_path_missing_on_disk");
  } else if (renderStory.audio_path && !fileExistsSafe(renderStory.audio_path, fileExists)) {
    warnings.push("audio_sidecar_missing_but_render_has_audio");
  }
  if (!Array.isArray(renderStory.rights_ledger) || renderStory.rights_ledger.length === 0) {
    blockers.push("rights_ledger_missing");
  }
  if (motionFamilies.size < 3) blockers.push("insufficient_unique_motion_families");
  if (platformFields.length > 0) {
    blockers.push(`already_has_public_platform_id:${platformFields.join(",")}`);
  }
  if (liveStory.approved === true || liveStory.auto_approved === true) {
    warnings.push("live_story_already_approved");
  }

  const updateStory = { ...liveStory };
  for (const field of PROMOTION_COPY_FIELDS) {
    if (renderStory[field] !== undefined) updateStory[field] = renderStory[field];
  }
  updateStory.id = storyId;
  updateStory.title = title || updateStory.title;
  updateStory.suggested_title = title || updateStory.suggested_title;
  const subjectAwareThumbnailText = buildSubjectAwareThumbnailText({
    current:
      updateStory.suggested_thumbnail_text ||
      updateStory.thumbnail_headline ||
      updateStory.first_frame_text,
    subject: canonicalSubject,
    title,
  });
  if (subjectAwareThumbnailText) {
    updateStory.suggested_thumbnail_text = subjectAwareThumbnailText;
    updateStory.thumbnail_headline = subjectAwareThumbnailText;
    updateStory.first_frame_text = subjectAwareThumbnailText;
  }
  updateStory.exported_path = renderPath;
  updateStory.approved = true;
  updateStory.auto_approved = true;
  updateStory.approved_at = liveStory.approved_at || generatedAt;
  updateStory.publish_status = null;
  updateStory.publish_error = null;
  updateStory.qa_failed = false;
  updateStory.qa_failures = [];
  updateStory.video_qa_failures = [];
  updateStory.content_qa_failures = [];
  updateStory.script_generation_status = "approved";
  updateStory.script_review_reason = "";
  updateStory.script_validation_errors = [];
  updateStory.governance_manifest_path = manifest.__file || liveStory.governance_manifest_path || "";
  updateStory.governance_publish_status = manifest.publish_status || "";
  updateStory.word_count = Number(renderStory.word_count) || countWords(script);
  updateStory.render_quality_class =
    renderStory.render_quality_class ||
    renderReport.render_quality_class ||
    liveStory.render_quality_class ||
    "premium";
  updateStory.duration_seconds =
    finiteNumberOrNull(renderStory.duration_seconds) ??
    finiteNumberOrNull(renderReport.rendered_duration_s) ??
    finiteNumberOrNull(liveStory.duration_seconds);
  updateStory.audio_duration =
    finiteNumberOrNull(renderStory.audio_duration) ??
    finiteNumberOrNull(renderReport.audio_duration_s) ??
    finiteNumberOrNull(liveStory.audio_duration);
  updateStory.qa_visual_count =
    finiteNumberOrNull(renderStory.qa_visual_count) ??
    finiteNumberOrNull(renderStory.visual_v4_render_bridge_clip_count) ??
    finiteNumberOrNull(liveStory.qa_visual_count);
  updateStory.manual_caption_generated =
    renderStory.manual_caption_generated === true ||
    renderStory.clean_manual_captions === true ||
    liveStory.manual_caption_generated === true;
  updateStory.clean_manual_captions =
    renderStory.clean_manual_captions === true ||
    renderStory.manual_caption_generated === true ||
    liveStory.clean_manual_captions === true;
  updateStory.subtitle_timing_source =
    renderStory.subtitle_timing_source ||
    liveStory.subtitle_timing_source ||
    "timestamps";
  updateStory.duration_lane =
    renderStory.duration_lane ||
    liveStory.duration_lane ||
    "pulse_retention_short";
  updateStory.allow_retention_short_video = true;
  updateStory.min_video_duration_seconds =
    finiteNumberOrNull(renderStory.min_video_duration_seconds) ??
    finiteNumberOrNull(liveStory.min_video_duration_seconds) ??
    22;
  const rightsLedgerRecordsBefore = Array.isArray(updateStory.rights_ledger)
    ? updateStory.rights_ledger.length
    : 0;
  const steamVisualRightsBefore = countSteamVisualRights(updateStory.rights_ledger);
  updateStory.rights_ledger = mergePromotionRightsLedger(
    updateStory.rights_ledger,
    updateStory,
    storyId,
  );
  const inheritedSteamVisualRightsAdded = Math.max(
    0,
    countSteamVisualRights(updateStory.rights_ledger) - steamVisualRightsBefore,
  );
  const operatorReview = buildPromotionOperatorReview({
    liveStory,
    updateStory,
    renderStory,
    rightsLedgerRecordsBefore,
    inheritedSteamVisualRightsAdded,
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "governance_green_approval_promotion",
    status: blockers.length ? "blocked" : "ready_for_operator_confirmed_apply",
    story_id: storyId || null,
    blockers,
    warnings,
    safety: {
      dry_run_by_default: true,
      requires_operator_confirmed: true,
      db_mutation_on_apply: true,
      posting: false,
      oauth: false,
      token_printing: false,
      safety_gates_weakened: false,
    },
    evidence: {
      manifest_publish_status: manifest.publish_status || null,
      manifest_can_auto_publish: manifest.can_auto_publish === true,
      render_path: renderPath || null,
      audio_path: renderStory.audio_path || null,
      render_has_audio: finalRenderHasAudio,
      unique_motion_families: motionFamilies.size,
      rights_ledger_records: Array.isArray(renderStory.rights_ledger)
        ? renderStory.rights_ledger.length
        : 0,
    },
    operator_review: blockers.length ? null : operatorReview,
    update_story: blockers.length ? null : updateStory,
  };
}

function commandForLane(lane, storyId) {
  const id = storyId || "<story-id>";
  const commands = {
    governance_green_approval_promotion:
      `npm run ops:publish-unblock -- --story-id ${id} --lane governance-green-approval --dry-run`,
    approval_scoring_review:
      `npm run ops:studio-governance -- --story-file <story-json-for-${id}> --json`,
    audio_regeneration:
      `npm run ops:local-tts-publish-refresh -- --story-id ${id} --dry-run`,
    script_runtime_rewrite:
      `npm run ops:reprocess-script-failures -- --story-id ${id} --dry-run`,
    canonical_script_rewrite:
      `npm run ops:reprocess-script-failures -- --story-id ${id} --source-bound-only --dry-run --json`,
    stale_script_qa_recheck:
      `npm run ops:next-publish-candidates -- --preflight-qa --story-id ${id}`,
    script_generation_retry:
      `npm run ops:reprocess-script-failures -- --story-id ${id} --dry-run`,
    visual_v4_motion_enrichment:
      `npm run ops:v4-source-deficit -- --story-id ${id} --json`,
    platform_media_repair:
      `npm run ops:local-media-repair -- --story-id ${id} --dry-run`,
    produce_or_render:
      `npm run produce -- --story-id ${id}`,
    stale_story_refresh:
      `npm run hunt && npm run ops:next-publish-candidates -- --preflight-qa`,
    duration_recut:
      `npm run ops:local-script-extension -- --story-id ${id} --dry-run`,
    already_handled:
      `npm run ops:platform:status`,
    manual_triage:
      `npm run ops:pipeline-backlog -- --json`,
  };
  return commands[lane] || commands.manual_triage;
}

function classifyPublishBlocker({
  story = {},
  reason = "",
  governanceGreenStoryIds = new Set(),
  v4ReadyStoryIds = new Set(),
} = {}) {
  const storyId = cleanText(story.id);
  const lowerReason = normaliseReason(reason);
  const governanceGreen = asSet(governanceGreenStoryIds).has(storyId);
  const v4Ready = asSet(v4ReadyStoryIds).has(storyId);

  let resolutionLane = "manual_triage";
  let action = "Inspect the story state and assign it to a repair lane.";
  let canApplyAutomatically = false;
  let safetyGate = "operator_review_required";
  let priority = 10;

  if (/^already_has_public_platform_id/.test(lowerReason)) {
    resolutionLane = "already_handled";
    action = "Confirm platform state and remove the row from active repair pressure.";
    safetyGate = "read_only_state_check";
    priority = 5;
  } else if (lowerReason === "not_approved" && governanceGreen) {
    resolutionLane = "governance_green_approval_promotion";
    action =
      "Promote only after the stored governance manifest is still GREEN and the live row matches the approved render pack.";
    safetyGate = "operator_confirmed_db_mutation_required";
    priority = 100;
  } else if (lowerReason === "not_approved") {
    resolutionLane = "approval_scoring_review";
    action = "Run governance and scoring against the story before it can enter the publish queue.";
    safetyGate = "governance_green_required";
    priority = 72;
  } else if (/audio_generation_failed|tts_timeout|pending_audio/.test(lowerReason)) {
    resolutionLane = "audio_regeneration";
    action = "Regenerate local TTS with the recovery path, then rerun audio, subtitle and governance checks.";
    canApplyAutomatically = true;
    safetyGate = "post_regeneration_qa_required";
    priority = 86;
  } else if (/actual spoken word count|outside \d+-\d+|duration_too_short|duration_too_long/.test(lowerReason)) {
    resolutionLane = "script_runtime_rewrite";
    action = "Rewrite to the target runtime, regenerate captions/audio and rerun preflight.";
    canApplyAutomatically = true;
    safetyGate = "script_contract_and_governance_required";
    priority = 84;
  } else if (staleExactCtaFailureCanBeRechecked(lowerReason, story)) {
    resolutionLane = "stale_script_qa_recheck";
    action =
      "Rerun current preflight because the persisted script QA label may pre-date the approved identity CTA policy.";
    canApplyAutomatically = true;
    safetyGate = "fresh_preflight_required_no_db_mutation";
    priority = 89;
  } else if (/top_comment_used_as_fact|placeholder_title|source backed|internal_qa|script_coherence/.test(lowerReason)) {
    if (canonicalRewriteCanBeAutomated(lowerReason, story)) {
      resolutionLane = "canonical_script_rewrite";
      action = "Rebuild from a locked canonical story manifest so title, script, thumbnail and source labels agree.";
      canApplyAutomatically = true;
      safetyGate = "public_output_coherence_required";
      priority = 88;
    } else {
      resolutionLane = "manual_triage";
      action =
        "Hold this script until a source-backed rewrite is available or reject weak community-only coverage.";
      canApplyAutomatically = false;
      safetyGate = "source_backed_rewrite_or_reject_required";
      priority = 57;
    }
  } else if (/bad control character|json|script_generation_error|local llm request failed|timed out/.test(lowerReason)) {
    resolutionLane = "script_generation_retry";
    action = "Sanitise the prompt/input and retry script generation with timeout-safe fallback.";
    canApplyAutomatically = true;
    safetyGate = "script_validation_required";
    priority = 80;
  } else if (/instagram.*(?:url processing failed|media upload|container creation|only photo)|error code 2207076|meta.*media/.test(lowerReason)) {
    resolutionLane = "platform_media_repair";
    action = "Repair or re-encode the platform media package, then rerun platform-video QA before retrying the failed platform.";
    canApplyAutomatically = true;
    safetyGate = "platform_video_qa_required";
    priority = 81;
  } else if (/thin_visuals|risky_article_context_dominated_deck|article_context_dominated|safe non-article|missing_motion|visual|motion/.test(lowerReason)) {
    resolutionLane = "visual_v4_motion_enrichment";
    action = "Acquire or validate more honest V4 motion clips without duplicate family padding.";
    canApplyAutomatically = true;
    safetyGate = "v4_motion_pack_required";
    priority = 82;
  } else if (/missing_mp4/.test(lowerReason)) {
    resolutionLane = "produce_or_render";
    action = v4Ready
      ? "Render with the existing V4-ready motion pack, then run governance preflight."
      : "Produce the story or first build a V4 motion pack if the render contract requires it.";
    canApplyAutomatically = true;
    safetyGate = "render_and_governance_required";
    priority = v4Ready ? 92 : 76;
  } else if (/stale_unpublished_backlog/.test(lowerReason)) {
    resolutionLane = "stale_story_refresh";
    action = "Refresh the story against current sources or replace it with fresher coverage.";
    canApplyAutomatically = true;
    safetyGate = "freshness_review_required";
    priority = 58;
  }

  return {
    story_id: storyId || "unknown",
    title: cleanText(story.title).slice(0, 180),
    blocker: cleanText(reason) || "unknown",
    resolution_lane: resolutionLane,
    priority,
    action,
    safe_next_command: commandForLane(resolutionLane, storyId),
    can_apply_automatically: canApplyAutomatically,
    safety_gate: safetyGate,
    governance_green: governanceGreen,
    v4_ready: v4Ready,
    dead_end: false,
  };
}

function countBy(items, key) {
  const out = {};
  for (const item of items) {
    const value = item[key] || "unknown";
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function buildPublishRunway({
  candidateCount = 0,
  items = [],
  returnedItems = [],
} = {}) {
  const rows = Array.isArray(items) ? items : [];
  const liveCandidates = Number(candidateCount || 0);
  const greenPackAvailable = rows.filter(
    (item) => item.resolution_lane === "governance_green_approval_promotion",
  ).length;
  const repairableBacklog = rows.filter(
    (item) =>
      item.can_apply_automatically === true &&
      AUTO_REPAIR_LANES.has(item.resolution_lane),
  ).length;
  const operatorConfirmedBacklog = rows.filter((item) =>
    /operator_confirmed/.test(item.safety_gate || ""),
  ).length;
  const freshContentNeeded = liveCandidates === 0 && greenPackAvailable === 0 && repairableBacklog === 0;

  let status = "fresh_content_required";
  let nextAction = "Run fresh hunt, scoring and candidate preflight.";
  if (liveCandidates > 0) {
    status = "publishable_now";
    nextAction = "Let the scheduler publish the highest preflight-passing candidate.";
  } else if (greenPackAvailable > 0) {
    status = "operator_confirmed_green_pack_available";
    nextAction = "Promote the governance-green render pack only after explicit operator confirmation and DB backup.";
  } else if (repairableBacklog > 0) {
    status = "repair_lane_supply_available";
    nextAction = "Run the highest-priority repair lanes, then rerun publish preflight.";
  }

  const recommendedSequence = [];
  if (greenPackAvailable > 0) {
    recommendedSequence.push("operator_confirmed_governance_green_promotion");
  }
  if (repairableBacklog > 0) {
    recommendedSequence.push("repair_script_audio_visual_render_backlog");
  }
  recommendedSequence.push("fresh_hunt_scoring_preflight");

  return {
    status,
    publishable_now: liveCandidates,
    green_pack_available: greenPackAvailable,
    repairable_backlog: repairableBacklog,
    operator_confirmed_backlog: operatorConfirmedBacklog,
    fresh_content_needed: freshContentNeeded,
    returned_items: Array.isArray(returnedItems) ? returnedItems.length : 0,
    next_action: nextAction,
    recommended_sequence: [...new Set(recommendedSequence)],
  };
}

function buildRepairOrchestration({
  items = [],
  returnedItems = [],
  candidateCount = 0,
} = {}) {
  const rows = Array.isArray(items) ? items : [];
  const returnedIds = new Set(
    (Array.isArray(returnedItems) ? returnedItems : []).map((item) => item.story_id),
  );
  const autoRepairBacklog = rows
    .filter(
      (item) =>
        item.can_apply_automatically === true &&
        AUTO_REPAIR_LANES.has(item.resolution_lane),
    )
    .map((item) => ({
      story_id: item.story_id,
      title: item.title,
      lane: item.resolution_lane,
      blocker: item.blocker,
      priority: item.priority,
      command: item.safe_next_command,
      returned_in_priority_view: returnedIds.has(item.story_id),
      safety_gate: item.safety_gate,
    }));
  const operatorConfirmed = rows
    .filter((item) => /operator_confirmed/.test(item.safety_gate || ""))
    .map((item) => ({
      story_id: item.story_id,
      title: item.title,
      lane: item.resolution_lane,
      blocker: item.blocker,
      priority: item.priority,
      command: item.safe_next_command,
      requires_operator_confirmation: true,
      safety_gate: item.safety_gate,
    }));

  const stages = [];
  if (operatorConfirmed.length > 0) {
    stages.push({
      id: "operator_confirmed_green_promotion",
      description:
        "Governance-green packs can be promoted only through the explicit operator-confirmed apply path after a fresh preflight.",
      requires_operator_confirmation: true,
      items: operatorConfirmed,
    });
  }
  stages.push({
    id: "auto_repair_backlog",
    description:
      "Dry-run repair lanes that can be worked without posting, OAuth changes or safety-gate relaxation.",
    requires_operator_confirmation: false,
    items: autoRepairBacklog,
  });
  stages.push({
    id: "verification_preflight",
    description: "Read-only verification after each repair batch.",
    requires_operator_confirmation: false,
    items: [],
    commands: [
      "npm run ops:next-publish-candidates -- --preflight-qa --limit 10",
      "npm run ops:publish-unblock -- --json --limit 30",
      "npm run ops:render-health -- --json",
    ],
  });

  return {
    schema_version: 1,
    mode: "safe_repair_sequence",
    status:
      Number(candidateCount || 0) > 0
        ? "publish_candidates_available"
        : autoRepairBacklog.length || operatorConfirmed.length
          ? "repair_supply_available"
          : "fresh_content_required",
    safety: {
      dry_run_first: true,
      posting: false,
      oauth: false,
      token_printing: false,
      db_mutation_without_operator_confirmation: false,
      safety_gates_weakened: false,
    },
    counts: {
      operator_confirmed_items: operatorConfirmed.length,
      auto_repair_backlog: autoRepairBacklog.length,
      returned_priority_items: Array.isArray(returnedItems) ? returnedItems.length : 0,
    },
    stages,
  };
}

function buildPublishBlockerResolutionPlan({
  stories = [],
  excluded = [],
  governanceGreenStoryIds = [],
  v4ReadyStoryIds = [],
  candidateCount = 0,
  generatedAt = new Date().toISOString(),
  limit = DEFAULT_LIMIT,
} = {}) {
  const storyById = new Map(
    (Array.isArray(stories) ? stories : [])
      .filter((story) => story && story.id)
      .map((story) => [String(story.id), story]),
  );
  const greenIds = asSet(governanceGreenStoryIds);
  const readyIds = asSet(v4ReadyStoryIds);
  const rows = Array.isArray(excluded) ? excluded : [];
  const items = rows
    .map((row) => {
      const story = storyById.get(String(row.id || "")) || {
        id: row.id,
        title: row.title,
      };
      return {
        ...classifyPublishBlocker({
          story,
          reason: row.reason,
          governanceGreenStoryIds: greenIds,
          v4ReadyStoryIds: readyIds,
        }),
        selection_score: storyScore(story),
      };
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.selection_score !== a.selection_score) return b.selection_score - a.selection_score;
      return String(a.story_id).localeCompare(String(b.story_id));
    });
  const returned = items.slice(0, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  const deadEnds = items.filter((item) => item.dead_end || !item.safe_next_command);
  const laneCounts = countBy(items, "resolution_lane");
  const runway = buildPublishRunway({
    candidateCount,
    items,
    returnedItems: returned,
  });
  const repairOrchestration = buildRepairOrchestration({
    candidateCount,
    items,
    returnedItems: returned,
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    safety: {
      mode: "read_only",
      db_mutation: false,
      posting: false,
      oauth: false,
      token_printing: false,
      safety_gates_weakened: false,
    },
    summary: {
      live_publish_candidates: Number(candidateCount || 0),
      total_blockers_seen: rows.length,
      total_resolution_items: items.length,
      resolution_items: returned.length,
      returned_resolution_items: returned.length,
      dead_end_blockers: deadEnds.length,
      auto_repairable_items: items.filter((item) => item.can_apply_automatically).length,
      returned_auto_repairable_items: returned.filter((item) => item.can_apply_automatically).length,
      operator_confirmed_items: items.filter((item) =>
        /operator_confirmed/.test(item.safety_gate),
      ).length,
      returned_operator_confirmed_items: returned.filter((item) =>
        /operator_confirmed/.test(item.safety_gate),
      ).length,
    },
    no_dead_end_blockers: deadEnds.length === 0,
    recovery_lanes: laneCounts,
    publish_runway: runway,
    repair_orchestration: repairOrchestration,
    priority_items: returned,
    fresh_content_fallback: {
      enabled: Number(candidateCount || 0) === 0,
      reason:
        Number(candidateCount || 0) === 0
          ? "No publishable candidates exist, so the system should run fresh hunt/scoring plus repair lanes in parallel."
          : "Publishable candidates already exist, so fresh hunt/scoring is secondary to keeping the repair lanes moving.",
      safe_next_commands: [
        "npm run hunt",
        "npm run approve",
        "npm run ops:next-publish-candidates -- --preflight-qa",
        "npm run ops:publish-unblock -- --json",
      ],
    },
  };
}

function formatPublishBlockerResolutionMarkdown(plan = {}) {
  const lines = [];
  const summary = plan.summary || {};
  lines.push("# Publish Blocker Resolution");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at || "unknown"}`);
  lines.push("");
  lines.push("## Safety");
  const safety = plan.safety || {};
  const mode = cleanText(safety.mode) || "read_only";
  lines.push(`- mode: ${mode}`);
  lines.push(`- publishing: ${safety.posting ? "yes" : "no"}`);
  lines.push(`- OAuth/token changes: ${safety.oauth || safety.token_printing ? "yes" : "no"}`);
  lines.push(`- production DB mutation: ${safety.db_mutation ? "yes" : "no"}`);
  lines.push(`- safety gates weakened: ${safety.safety_gates_weakened ? "yes" : "no"}`);
  lines.push("");
  lines.push("## No Dead Ends");
  lines.push(`- no_dead_end_blockers: ${plan.no_dead_end_blockers ? "yes" : "no"}`);
  lines.push(`- blockers seen: ${Number(summary.total_blockers_seen || 0)}`);
  lines.push(`- total resolution items: ${Number(summary.total_resolution_items || 0)}`);
  lines.push(`- returned resolution items: ${Number(summary.resolution_items || 0)}`);
  lines.push(`- auto-repairable after QA: ${Number(summary.auto_repairable_items || 0)}`);
  lines.push(`- operator-confirmed mutations needed: ${Number(summary.operator_confirmed_items || 0)}`);
  lines.push("");
  lines.push("## Publish Runway");
  const runway = plan.publish_runway || {};
  lines.push(`- status: ${runway.status || "unknown"}`);
  lines.push(`- publishable now: ${Number(runway.publishable_now || 0)}`);
  lines.push(`- governance-green packs waiting: ${Number(runway.green_pack_available || 0)}`);
  lines.push(`- repairable backlog: ${Number(runway.repairable_backlog || 0)}`);
  lines.push(`- next action: ${runway.next_action || "unknown"}`);
  lines.push("");
  lines.push("## Recovery Lanes");
  const lanes = plan.recovery_lanes || {};
  const laneEntries = Object.entries(lanes).sort((a, b) => b[1] - a[1]);
  if (!laneEntries.length) lines.push("- none");
  for (const [lane, count] of laneEntries) lines.push(`- ${lane}: ${count}`);
  lines.push("");
  lines.push("## Priority Items");
  const items = Array.isArray(plan.priority_items) ? plan.priority_items : [];
  if (!items.length) lines.push("- none");
  for (const item of items.slice(0, 20)) {
    lines.push(`- ${item.story_id}: ${item.resolution_lane} - ${item.blocker}`);
    lines.push(`  action: ${item.action}`);
    lines.push(`  command: \`${item.safe_next_command}\``);
  }
  lines.push("");
  if (plan.promotion_plan) {
    const promotion = plan.promotion_plan;
    lines.push("## Governance-Green Promotion");
    lines.push(`- status: ${promotion.status || "unknown"}`);
    lines.push(`- story: ${promotion.story_id || "unknown"}`);
    lines.push(`- render: ${promotion.evidence?.render_path || "missing"}`);
    lines.push(`- unique motion families: ${Number(promotion.evidence?.unique_motion_families || 0)}`);
    if (promotion.blockers?.length) {
      lines.push(`- blockers: ${promotion.blockers.join(", ")}`);
    }
    if (plan.apply_result) {
      lines.push(`- apply: ${plan.apply_result.status || "unknown"}`);
      lines.push(`- backup: ${plan.apply_result.backup_path || "unknown"}`);
    }
    if (promotion.operator_review) {
      const review = promotion.operator_review;
      const assets = review.asset_summary || {};
      lines.push("");
      lines.push("### Operator Review");
      lines.push(`- changed fields: ${(review.changed_fields || []).join(", ") || "none"}`);
      lines.push(`- public platform ids present: ${(review.public_platform_fields_present || []).join(", ") || "none"}`);
      lines.push(`- motion clips: ${Number(assets.motion_clips || 0)}`);
      lines.push(`- unique motion families: ${Number(assets.unique_motion_families || 0)}`);
      lines.push(`- rights records before: ${Number(assets.rights_ledger_records_before || 0)}`);
      lines.push(`- rights records after: ${Number(assets.rights_ledger_records_after || 0)}`);
      lines.push(`- inherited Steam visual rights added: ${Number(assets.inherited_steam_visual_rights_added || 0)}`);
    }
    lines.push("");
  }
  if (plan.promotion_apply_preview) {
    const preview = plan.promotion_apply_preview;
    lines.push("## Apply Preview");
    lines.push(`- status: ${preview.status || "unknown"}`);
    lines.push(`- pre-apply preflight: ${preview.pre_apply_preflight_status || "unknown"}`);
    if (preview.verification_phase) {
      lines.push(`- verification phase: ${preview.verification_phase}`);
    }
    if (preview.live_row_expected_blocked_before_apply !== undefined) {
      lines.push(
        `- live row expected blocked before apply: ${
          preview.live_row_expected_blocked_before_apply ? "yes" : "no"
        }`,
      );
    }
    if (Array.isArray(preview.pre_apply_preflight_blockers) && preview.pre_apply_preflight_blockers.length) {
      lines.push(`- pre-apply blockers: ${preview.pre_apply_preflight_blockers.join(", ")}`);
    }
    lines.push(`- expected backup: ${preview.expected_backup_path || "unknown"}`);
    if (preview.apply_command) lines.push(`- apply command: \`${preview.apply_command}\``);
    const verificationCommands = Array.isArray(preview.verification_commands)
      ? preview.verification_commands
      : [];
    if (verificationCommands.length) {
      lines.push("- verification:");
      for (const command of verificationCommands) lines.push(`  - \`${command}\``);
    }
    lines.push("");
  }
  lines.push("## Fresh Content Fallback");
  const fallback = plan.fresh_content_fallback || {};
  lines.push(`- enabled: ${fallback.enabled ? "yes" : "no"}`);
  if (fallback.reason) lines.push(`- reason: ${fallback.reason}`);
  for (const command of fallback.safe_next_commands || []) {
    lines.push(`- \`${command}\``);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildGovernanceGreenApprovalPromotionPlan,
  buildPublishRunway,
  buildPublishBlockerResolutionPlan,
  classifyPublishBlocker,
  formatPublishBlockerResolutionMarkdown,
};
