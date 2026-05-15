"use strict";

const ROUTE_ORDER = [
  "official_inbox_upload",
  "official_api_reapproval",
  "phone_semi_approval",
  "third_party_scheduler_true_autopublish",
  "browser_rpa_test_account_only",
  "va_last_resort",
];

const DEFAULT_HASHTAGS = ["#gaming", "#gamingnews", "#fyp", "#videogames"];
const DEFAULT_MAX_RENDER_AGE_HOURS = 72;
const DEFAULT_MAX_STORY_AGE_HOURS = 72;
const HASHTAG_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "another",
  "announcement",
  "before",
  "being",
  "boss",
  "confirmed",
  "confirms",
  "control",
  "despite",
  "doesnt",
  "during",
  "early",
  "even",
  "from",
  "gets",
  "having",
  "into",
  "just",
  "launch",
  "launched",
  "launches",
  "leak",
  "leaked",
  "lost",
  "major",
  "make",
  "makes",
  "merged",
  "more",
  "most",
  "news",
  "own",
  "revealed",
  "reveals",
  "says",
  "secret",
  "somehow",
  "still",
  "story",
  "than",
  "that",
  "their",
  "there",
  "these",
  "this",
  "trailer",
  "update",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "without",
  "worst",
]);
const HASHTAG_PHRASES = [
  [/assassin'?s creed/i, "#AssassinsCreed"],
  [/\bblack flag\b/i, "#BlackFlag"],
  [/\bgame pass\b/i, "#GamePass"],
  [/\bcall of duty\b/i, "#CallOfDuty"],
  [/\bgrand theft auto\b/i, "#GrandTheftAuto"],
  [/\bgta\s*6\b/i, "#GTA6"],
  [/\bbatman beyond\b/i, "#BatmanBeyond"],
  [/\bfinal fantasy\b/i, "#FinalFantasy"],
  [/\bresident evil\b/i, "#ResidentEvil"],
  [/\bdead space\b/i, "#DeadSpace"],
  [/\bstardew valley\b/i, "#StardewValley"],
  [/\bsubnautica\b/i, "#Subnautica"],
  [/\bpokemon|pokémon/i, "#Pokemon"],
  [/\bnintendo switch\s*2\b/i, "#Switch2"],
  [/\bnintendo switch\b/i, "#NintendoSwitch"],
  [/\bmario kart\b/i, "#MarioKart"],
  [/\bdonkey kong\b/i, "#DonkeyKong"],
  [/\bsplatoon\b/i, "#Splatoon"],
  [/\bplaystation\b/i, "#PlayStation"],
  [/\bxbox\b/i, "#Xbox"],
  [/\bnintendo\b/i, "#Nintendo"],
  [/\bsteam\b/i, "#Steam"],
  [/\bubisoft\b/i, "#Ubisoft"],
  [/\bmicrosoft\b/i, "#Microsoft"],
  [/\bdiscord\b/i, "#Discord"],
  [/\bamazon\b/i, "#Amazon"],
  [/\bebay\b/i, "#eBay"],
  [/\bgamestop\b/i, "#GameStop"],
  [/\brocksteady\b/i, "#Rocksteady"],
  [/\bjason schreier\b/i, "#JasonSchreier"],
];

function words(text) {
  return String(text || "")
    .replace(/[^\w#]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function uniqueHashtags(tags) {
  const seen = new Set();
  const out = [];
  for (const tag of tags || []) {
    const cleaned = String(tag || "").trim();
    if (!/^#[a-z0-9]+$/i.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function buildCaption(story) {
  const title = story?.suggested_title || story?.suggested_thumbnail_text || story?.title || "Gaming news update";
  return String(title).slice(0, 140);
}

function buildHashtags(story) {
  const sourceText = [
    story?.suggested_title,
    story?.suggested_thumbnail_text,
    story?.title,
    story?.caption,
    story?.company_name,
  ]
    .filter(Boolean)
    .join(" ");
  const phraseTags = HASHTAG_PHRASES
    .filter(([pattern]) => pattern.test(sourceText))
    .map(([, tag]) => tag);
  const fallbackTags = phraseTags.length >= 2
    ? []
    : words(sourceText)
        .map((w) => w.replace(/[^a-z0-9]/gi, ""))
        .filter((w) => w.length > 3 && !HASHTAG_STOPWORDS.has(w.toLowerCase()))
        .slice(0, 3)
        .map((w) => `#${w}`);
  return uniqueHashtags([...DEFAULT_HASHTAGS, ...phraseTags, ...fallbackTags]).slice(0, 8);
}

function urgencyScore(story) {
  let score = 30;
  if (/breaking|confirmed|verified/i.test(String(story?.flair || story?.classification))) score += 25;
  if (/leak|rumour|rumor/i.test(String(story?.flair || story?.classification))) score += 10;
  if (Number(story?.breaking_score || 0) > 70) score += 25;
  if (Number(story?.score || 0) > 1000) score += 15;
  return Math.max(0, Math.min(100, score));
}

function addMinutes(date, minutes) {
  const next = new Date(date.getTime());
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function nextUtcHour(date, hour) {
  const next = new Date(date.getTime());
  next.setUTCMinutes(0, 0, 0);
  if (next.getUTCHours() >= hour) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  next.setUTCHours(hour);
  return next;
}

function recommendedPublishTime(score, { now = new Date() } = {}) {
  const base = now instanceof Date ? now : new Date(now);
  if (score >= 75) {
    return {
      mode: "as_soon_as_reviewed",
      timeIso: addMinutes(base, 15).toISOString(),
      rationale: "High urgency: dispatch immediately after source and caption review.",
    };
  }
  if (score >= 50) {
    return {
      mode: "same_day_next_hour",
      timeIso: addMinutes(base, 60).toISOString(),
      rationale: "Medium urgency: publish same day without waiting for the evening slot.",
    };
  }
  return {
    mode: "next_evening_slot",
    timeIso: nextUtcHour(base, 19).toISOString(),
    rationale: "Lower urgency: hold for the regular evening posting window.",
  };
}

function normaliseAssetProbe(pathValue, existsValue) {
  const hasPath = Boolean(pathValue);
  const exists = existsValue === true ? true : existsValue === false ? false : null;
  return {
    path: pathValue || null,
    hasPath,
    exists,
    ready: hasPath && exists !== false,
  };
}

function statusForPack({ mp4, cover, mp4Exists = null, coverExists = null }) {
  const video = normaliseAssetProbe(mp4, mp4Exists);
  const coverAsset = normaliseAssetProbe(cover, coverExists);
  if (!video.ready && !coverAsset.ready) return "missing_video_and_cover";
  if (!video.ready) return "missing_video";
  if (!coverAsset.ready) return "missing_cover";
  return "ready_for_operator_review";
}

function normaliseDurationGate(durationSeconds = null) {
  if (durationSeconds === null || durationSeconds === undefined || durationSeconds === "") {
    return {
      ok: false,
      reason: "duration_unknown",
      blocks_dispatch: true,
      minimumSeconds: 60,
    };
  }
  const value = Number(durationSeconds);
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      reason: "duration_unknown",
      blocks_dispatch: true,
      minimumSeconds: 60,
    };
  }
  const rounded = Math.round(value * 100) / 100;
  return {
    ok: rounded >= 60,
    reason: rounded >= 60 ? "creator_rewards_length_ok" : "under_60_seconds",
    blocks_dispatch: rounded < 60,
    minimumSeconds: 60,
    durationSeconds: rounded,
  };
}

function normaliseCaptionGate(caption) {
  const trimmed = String(caption || "").trim();
  return {
    ok: trimmed.length > 0,
    reason: trimmed.length > 0 ? "caption_ready" : "caption_missing",
    blocks_dispatch: trimmed.length === 0,
    length: trimmed.length,
  };
}

function normaliseRenderFreshness(renderFreshness, env = process.env) {
  if (!renderFreshness || typeof renderFreshness !== "object") return null;
  const maxAgeHours = Number(env.TIKTOK_DISPATCH_MAX_RENDER_AGE_HOURS || DEFAULT_MAX_RENDER_AGE_HOURS);
  const ageHours = Number(renderFreshness.ageHours);
  const stale =
    renderFreshness.stale === true ||
    (Number.isFinite(ageHours) && Number.isFinite(maxAgeHours) && ageHours > maxAgeHours);
  return {
    lastModifiedIso: renderFreshness.lastModifiedIso || null,
    ageHours: Number.isFinite(ageHours) ? Math.round(ageHours * 100) / 100 : null,
    stale,
    maxAgeHours: Number.isFinite(maxAgeHours) ? maxAgeHours : DEFAULT_MAX_RENDER_AGE_HOURS,
  };
}

function parseStoryDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normaliseStoryFreshness(story = {}, { now = new Date(), env = process.env } = {}) {
  const maxAgeHours = Number(env.TIKTOK_DISPATCH_MAX_STORY_AGE_HOURS || DEFAULT_MAX_STORY_AGE_HOURS);
  const sourceDate =
    parseStoryDate(story.timestamp) ||
    parseStoryDate(story.created_at) ||
    parseStoryDate(story.approved_at);
  if (!sourceDate) {
    return {
      sourceDateIso: null,
      ageHours: null,
      stale: false,
      maxAgeHours: Number.isFinite(maxAgeHours) ? maxAgeHours : DEFAULT_MAX_STORY_AGE_HOURS,
      reason: "story_age_unknown",
    };
  }
  const nowDate = parseStoryDate(now) || new Date();
  const ageHours = Math.max(0, (nowDate.getTime() - sourceDate.getTime()) / 3_600_000);
  const safeMaxAge = Number.isFinite(maxAgeHours) ? maxAgeHours : DEFAULT_MAX_STORY_AGE_HOURS;
  return {
    sourceDateIso: sourceDate.toISOString(),
    ageHours: Math.round(ageHours * 100) / 100,
    stale: ageHours > safeMaxAge,
    maxAgeHours: safeMaxAge,
    reason: ageHours > safeMaxAge ? "stale_story_age_exceeds_limit" : "story_age_ok",
  };
}

function normaliseTikTokTokenGate(tokenStatus = null) {
  if (!tokenStatus || typeof tokenStatus !== "object") return null;
  const ok = tokenStatus.ok === true;
  const refreshAvailable = tokenStatus.refresh_available === true;
  const needsReauth = tokenStatus.needs_reauth === true;
  const needsRefreshOrSync = !ok && refreshAvailable && !needsReauth;
  return {
    ok,
    reason: tokenStatus.reason || null,
    expires_in_seconds:
      Number.isFinite(Number(tokenStatus.expires_in_seconds))
        ? Number(tokenStatus.expires_in_seconds)
        : null,
    refresh_available: refreshAvailable,
    needs_reauth: needsReauth,
    needs_refresh_or_sync: needsRefreshOrSync,
    action: needsRefreshOrSync
      ? "refresh_or_sync_local_token"
      : needsReauth
        ? "operator_reauth_required"
        : ok
          ? "token_ready"
          : "inspect_token_state",
    blocks_official_inbox_upload: !ok,
  };
}

function storyMatchesFilter(story, storyFilter = null) {
  if (!storyFilter) return true;
  const filters = Array.isArray(storyFilter) ? storyFilter : [storyFilter];
  const ids = filters.map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return true;
  return ids.includes(String(story?.id || ""));
}

function hasTikTokPost(story) {
  const legacyId = String(story?.tiktok_post_id || "").trim();
  if (legacyId) return true;
  if (story?.platform === "tiktok" && String(story?.external_id || "").trim()) return true;
  return false;
}

function normaliseTikTokInboxSend(story) {
  const publishId = String(
    story?.tiktok_inbox_publish_id ||
      story?.tiktok_inbox?.publish_id ||
      story?.tiktok_inbox?.publishId ||
      "",
  ).trim();
  const status = String(
    story?.tiktok_inbox_status ||
      story?.tiktok_inbox?.status ||
      story?.tiktok_inbox_completion_state ||
      story?.tiktok_inbox?.completion_state ||
      "",
  ).trim();
  const terminal = /^(failed|discarded|cancelled|canceled|deleted)$/i.test(status);
  return {
    alreadySent: Boolean(publishId) && !terminal,
    publishId: publishId || null,
    status: status || null,
    completionState:
      story?.tiktok_inbox_completion_state ||
      story?.tiktok_inbox?.completion_state ||
      null,
    sentAt:
      story?.tiktok_inbox_sent_at ||
      story?.tiktok_inbox?.sent_at ||
      null,
  };
}

function statusWithGates(
  baseStatus,
  voiceGate,
  renderFreshness,
  tiktokTokenGate,
  durationGate,
  captionGate,
) {
  if (baseStatus === "ready_for_operator_review" && renderFreshness?.stale === true) {
    return "stale_render_review_required";
  }
  if (baseStatus === "ready_for_operator_review" && durationGate?.blocks_dispatch) {
    return durationGate.reason === "under_60_seconds"
      ? "tiktok_length_review_required"
      : "duration_review_required";
  }
  if (baseStatus === "ready_for_operator_review" && captionGate?.blocks_dispatch) {
    return "caption_review_required";
  }
  if (baseStatus === "ready_for_operator_review" && tiktokTokenGate?.blocks_official_inbox_upload) {
    return "tiktok_auth_action_required";
  }
  if (!voiceGate) return baseStatus;
  if (voiceGate.verdict === "pass") return baseStatus;
  if (
    baseStatus === "ready_for_operator_review" &&
    (voiceGate.do_not_reuse_for_tiktok_dispatch === true ||
      (Array.isArray(voiceGate.blockers) && voiceGate.blockers.length > 0))
  ) {
    return "voice_review_required";
  }
  return baseStatus;
}

function buildDiscordMessage(pack) {
  const priority =
    pack.urgencyScore >= 75 ? "HIGH PRIORITY" : pack.urgencyScore >= 50 ? "PRIORITY" : "STANDARD";
  const headline =
    pack.status === "ready_for_operator_review"
      ? "TikTok Ready"
      : pack.status === "stale_render_review_required"
        ? "TikTok Stale Review"
      : pack.status === "tiktok_auth_action_required"
        ? "TikTok Auth"
      : pack.status === "voice_review_required"
        ? "TikTok Review"
        : "TikTok Not Ready";
  const duration =
    typeof pack.eligibility.durationSeconds === "number"
      ? `${Math.round(pack.eligibility.durationSeconds)}s`
      : "unknown";
  const rewards =
    pack.eligibility.creatorRewardsLengthEligible === true
      ? "eligible length"
      : pack.eligibility.creatorRewardsLengthEligible === false
        ? "under 60s"
        : "length unknown";
  return [
    `${headline} - ${priority}`,
    pack.title,
    `Duration: ${duration} (${rewards})`,
    `Recommended: ${pack.recommendedPublishTime.timeIso}`,
    `Caption: ${pack.caption}`,
    `Hashtags: ${pack.hashtags.join(" ")}`,
    `Video: ${pack.mp4 || "missing"}`,
    `Cover: ${pack.cover || "missing"}`,
    pack.voiceGate
      ? `Voice gate: ${pack.voiceGate.verdict} (${pack.voiceGate.blockers.join(", ") || "clear"}${
          pack.voiceGate.warnings?.length ? `; warnings: ${pack.voiceGate.warnings.join(", ")}` : ""
        })`
      : null,
    pack.renderFreshness?.stale
      ? `Render freshness: stale (${pack.renderFreshness.ageHours ?? "unknown"}h old)`
      : null,
    pack.durationGate?.blocks_dispatch
      ? `Duration gate: ${pack.durationGate.reason} (minimum ${pack.durationGate.minimumSeconds}s)`
      : null,
    pack.captionGate?.blocks_dispatch
      ? `Caption gate: ${pack.captionGate.reason}`
      : null,
    pack.tiktokTokenGate?.blocks_official_inbox_upload
      ? `TikTok token: ${pack.tiktokTokenGate.reason || "unknown"} (${pack.tiktokTokenGate.action})`
      : null,
    "Action: send to the TikTok inbox/drafts through the official inbox route, then manually review and publish in TikTok.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSchedulerPayload(pack) {
  return {
    network: "tiktok",
    video_path: pack.mp4,
    cover_path: pack.cover,
    caption: pack.caption,
    hashtags: pack.hashtags,
    publish_at: pack.recommendedPublishTime.timeIso,
    auto_publish: true,
    requires_mobile_confirmation: false,
    idempotency_key: `pulse-tiktok-${pack.storyId || "unknown"}-${String(pack.recommendedPublishTime.timeIso).slice(0, 10)}`,
    notes: "Use only with a scheduler that confirms true TikTok auto-publish for the connected account.",
  };
}

function buildOfficialInboxPayload(pack) {
  return {
    network: "tiktok",
    mode: "official_inbox_upload",
    endpoint: "/v2/post/publish/inbox/video/init/",
    video_path: pack.mp4,
    cover_path: pack.cover,
    caption: pack.caption,
    hashtags: pack.hashtags,
    public_auto_publish: false,
    requires_manual_completion: true,
    ready_for_upload: pack.status === "ready_for_operator_review",
    idempotency_key: `pulse-tiktok-inbox-${pack.storyId || "unknown"}-${String(pack.recommendedPublishTime.timeIso).slice(0, 10)}`,
    notes:
      "Uploads to the creator inbox only when the app/user has video.upload. The operator must open TikTok and complete the public post.",
  };
}

function buildPhoneWorkflowPayload(pack) {
  return {
    network: "tiktok",
    video_path: pack.mp4,
    cover_path: pack.cover,
    caption: pack.caption,
    hashtags: pack.hashtags,
    recommended_publish_at: pack.recommendedPublishTime.timeIso,
    phone_steps: pack.phoneInstructions,
    copy_blocks: {
      caption: pack.caption,
      hashtags: pack.hashtags.join(" "),
    },
  };
}

function buildTikTokDispatchPack(
  story,
  {
    durationSeconds = null,
    now = new Date(),
    voiceAudit = null,
    renderFreshness = null,
    tiktokTokenStatus = null,
    assetExistence = null,
    env = process.env,
  } = {},
) {
  const mp4 = story?.exported_path || null;
  const cover =
    story?.thumbnail_candidate_path ||
    story?.hf_thumbnail_path ||
    story?.story_image_path ||
    story?.image_path ||
    null;
  const score = urgencyScore(story);
  const voiceGate = voiceAudit
    ? (() => {
        const blockers = Array.isArray(voiceAudit.blockers) ? voiceAudit.blockers : [];
        const warnings = Array.isArray(voiceAudit.warnings) ? voiceAudit.warnings : [];
        return {
          verdict: voiceAudit.verdict || "review",
          blockers,
          warnings,
          do_not_reuse_for_tiktok_dispatch:
            voiceAudit.do_not_reuse_for_tiktok_dispatch === true ||
            voiceAudit.verdict === "reject" ||
            blockers.length > 0,
        };
      })()
    : null;
  const videoProbe = normaliseAssetProbe(mp4, assetExistence?.mp4Exists);
  const coverProbe = normaliseAssetProbe(cover, assetExistence?.coverExists);
  const baseStatus = statusForPack({
    mp4,
    cover,
    mp4Exists: assetExistence?.mp4Exists,
    coverExists: assetExistence?.coverExists,
  });
  const freshness = normaliseRenderFreshness(renderFreshness, env);
  const storyFreshness = normaliseStoryFreshness(story, { now, env });
  const tiktokTokenGate = normaliseTikTokTokenGate(tiktokTokenStatus);
  const tiktokInbox = normaliseTikTokInboxSend(story);
  const caption = buildCaption(story);
  const durationGate = normaliseDurationGate(durationSeconds);
  const captionGate = normaliseCaptionGate(caption);
  const pack = {
    storyId: story?.id || null,
    title: story?.title || "",
    mp4,
    cover,
    caption,
    hashtags: buildHashtags(story),
    urgencyScore: score,
    status: tiktokInbox.alreadySent
      ? "already_sent_to_tiktok_inbox"
      : storyFreshness.stale
        ? "stale_story_review_required"
        : statusWithGates(
            baseStatus,
            voiceGate,
            freshness,
            tiktokTokenGate,
            durationGate,
            captionGate,
          ),
    voiceGate,
    renderFreshness: freshness,
    storyFreshness,
    tiktokTokenGate,
    tiktokInbox,
    durationGate,
    captionGate,
    recommendedPublishTime: recommendedPublishTime(score, { now }),
    eligibility: {
      hasMp4: videoProbe.ready,
      hasCover: coverProbe.ready,
      hasMp4Path: videoProbe.hasPath,
      hasCoverPath: coverProbe.hasPath,
      mp4FileExists: videoProbe.exists,
      coverFileExists: coverProbe.exists,
      durationSeconds,
      creatorRewardsLengthEligible:
        typeof durationSeconds === "number" ? durationSeconds >= 60 : null,
      dispatchLengthReady: durationGate.ok,
      captionReady: captionGate.ok,
    },
    phoneInstructions: [
      "Open TikTok mobile app.",
      "Upload the MP4 from the dispatch pack.",
      "Set the cover image from the dispatch pack.",
      "Paste the caption and hashtags exactly.",
      "Publish only after the source and title have been manually reviewed.",
    ],
    routePriority: ROUTE_ORDER,
    recommendedRoute: "official_inbox_upload",
    compatibility: {
      officialInboxUpload: "proven_safe_near_term_route_after_tiktok_reauth",
      officialApi: "best_long_term_after_business_media_tool_reapproval",
      thirdPartyScheduler: "best_near_term_if_true_autopublish_personal_account_confirmed",
      phoneSemiApproval: "safe_fallback_when_operator_has_two_minutes",
      browserRpa: "test_account_only_before_live_consideration",
      virtualAssistant: "last_resort_only",
    },
    };
  pack.schedulerReadyJson = buildSchedulerPayload(pack);
  pack.officialInboxJson = buildOfficialInboxPayload(pack);
  pack.phoneWorkflowJson = buildPhoneWorkflowPayload(pack);
  pack.discordNotification = buildDiscordMessage(pack);
  return pack;
}

function buildTikTokDispatchManifest(
  stories = [],
  {
    durationByStoryId = {},
    voiceAuditByStoryId = {},
    renderFreshnessByStoryId = {},
    assetExistenceByStoryId = {},
    tiktokTokenStatus = null,
    storyId = null,
    storyIds = null,
    now = new Date(),
    env = process.env,
  } = {},
) {
  const sharedTokenGate = normaliseTikTokTokenGate(tiktokTokenStatus);
  const storyFilter = storyIds || storyId;
  function readinessRank(pack) {
    const hasFreshReadyMp4 =
      pack.eligibility?.hasMp4 === true &&
      pack.eligibility?.dispatchLengthReady === true &&
      pack.renderFreshness?.stale !== true;
    if (pack.status === "ready_for_operator_review") return 0;
    if (hasFreshReadyMp4 && pack.status === "tiktok_auth_action_required") return 1;
    if (hasFreshReadyMp4 && pack.status === "caption_review_required") return 2;
    if (hasFreshReadyMp4 && pack.status === "voice_review_required") return 3;
    if (hasFreshReadyMp4 && pack.status === "missing_cover") return 4;
    if (hasFreshReadyMp4) return 5;
    if (pack.status === "stale_render_review_required") return 6;
    if (pack.status === "duration_review_required") return 7;
    if (pack.status === "tiktok_length_review_required") return 8;
    if (pack.status === "stale_story_review_required") return 9;
    if (pack.status === "missing_cover") return 10;
    if (pack.status === "missing_video_and_cover") return 11;
    if (pack.status === "missing_video") return 12;
    if (pack.status === "already_sent_to_tiktok_inbox") return 13;
    return 14;
  }
  const packs = (Array.isArray(stories) ? stories : [])
    .filter((s) => s && !hasTikTokPost(s) && storyMatchesFilter(s, storyFilter))
    .filter((s) => s.exported_path || s.approved)
    .map((story) =>
      buildTikTokDispatchPack(story, {
        durationSeconds: durationByStoryId[story.id] ?? null,
        voiceAudit: voiceAuditByStoryId[story.id] || null,
        renderFreshness: renderFreshnessByStoryId[story.id] || null,
        assetExistence: assetExistenceByStoryId[story.id] || null,
        tiktokTokenStatus: sharedTokenGate || tiktokTokenStatus,
        now,
        env,
      }),
    )
    .sort((a, b) => {
      const readyDelta = readinessRank(a) - readinessRank(b);
      if (readyDelta !== 0) return readyDelta;
      return b.urgencyScore - a.urgencyScore;
    });
  const topReadyPack = packs.find((pack) => pack.status === "ready_for_operator_review") || null;
  const statusCounts = packs.reduce((counts, pack) => {
    counts[pack.status] = (counts[pack.status] || 0) + 1;
    return counts;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    routePriority: ROUTE_ORDER,
    storyFilter: storyFilter
      ? (Array.isArray(storyFilter) ? storyFilter : [storyFilter])
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      : null,
    count: packs.length,
    statusCounts,
    tiktokTokenGate: sharedTokenGate,
    packs,
    topPack: packs[0] || null,
    topReadyPack,
    queue: packs.map((pack, index) => ({
      position: index + 1,
      storyId: pack.storyId,
      status: pack.status,
      urgencyScore: pack.urgencyScore,
      recommendedRoute: pack.recommendedRoute,
      recommendedPublishTime: pack.recommendedPublishTime,
      voiceGate: pack.voiceGate,
      renderFreshness: pack.renderFreshness,
      storyFreshness: pack.storyFreshness,
      tiktokTokenGate: pack.tiktokTokenGate,
      tiktokInbox: pack.tiktokInbox,
      durationGate: pack.durationGate,
      captionGate: pack.captionGate,
      schedulerReadyJson: pack.schedulerReadyJson,
      officialInboxJson: pack.officialInboxJson,
      phoneWorkflowJson: pack.phoneWorkflowJson,
      discordNotification: pack.discordNotification,
    })),
    sampleDiscordNotification: topReadyPack?.discordNotification || null,
  };
}

function renderTikTokDispatchMarkdown(manifest) {
  const lines = [
    "# TikTok Live Dispatch",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Packs: ${manifest.count}`,
    "",
    "## TikTok Token Gate",
    "",
    manifest.tiktokTokenGate
      ? `- ${manifest.tiktokTokenGate.ok ? "ready" : "not ready"}: ${manifest.tiktokTokenGate.reason || "unknown"} (${manifest.tiktokTokenGate.action})`
      : "- not checked",
    "",
    "## Status Counts",
    "",
    ...(manifest.statusCounts && Object.keys(manifest.statusCounts).length
      ? Object.entries(manifest.statusCounts).map(([status, count]) => `- ${status}: ${count}`)
      : ["- none"]),
    "",
    "## Route Priority",
    "",
    "1. Official TikTok inbox/draft upload route",
    "2. Official TikTok API approval route",
    "3. Semi-automated phone approval workflow",
    "4. Third-party scheduler with true auto-publish",
    "5. Browser/RPA automation of TikTok Studio on a test account only",
    "6. VA poster as last resort",
    "",
    "## Top Dispatch Candidates",
    ...(manifest.packs.length
      ? manifest.packs
          .slice(0, 10)
          .map(
            (p) =>
              `- ${p.storyId}: status=${p.status} urgency=${p.urgencyScore} publish=${p.recommendedPublishTime.timeIso} duration=${p.eligibility.durationSeconds ?? "unknown"} mp4=${p.mp4 || "missing"} cover=${p.cover || "missing"}`,
          )
      : ["- none"]),
    "",
    "## Sample Discord Notification",
    "",
    "```text",
    manifest.sampleDiscordNotification || "No dispatch item ready.",
    "```",
    "",
    "## Standard Phone Flow",
    ...(manifest.topPack?.phoneInstructions || []).map((s) => `- ${s}`),
  ];
  return lines.join("\n") + "\n";
}

module.exports = {
  ROUTE_ORDER,
  buildTikTokDispatchPack,
  buildTikTokDispatchManifest,
  normaliseTikTokInboxSend,
  normaliseRenderFreshness,
  normaliseStoryFreshness,
  normaliseDurationGate,
  normaliseCaptionGate,
  normaliseTikTokTokenGate,
  renderTikTokDispatchMarkdown,
  recommendedPublishTime,
};
