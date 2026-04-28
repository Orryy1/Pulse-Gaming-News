"use strict";

const ROUTE_ORDER = [
  "official_api_reapproval",
  "third_party_scheduler_true_autopublish",
  "phone_semi_approval",
  "browser_rpa_test_account_only",
  "va_last_resort",
];

const DEFAULT_HASHTAGS = ["#gaming", "#gamingnews", "#fyp", "#videogames"];

function words(text) {
  return String(text || "")
    .replace(/[^\w#]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildCaption(story) {
  const title = story?.suggested_title || story?.suggested_thumbnail_text || story?.title || "Gaming news update";
  return String(title).slice(0, 140);
}

function buildHashtags(story) {
  const titleWords = words(story?.title).slice(0, 4);
  const franchise = titleWords
    .filter((w) => w.length > 3)
    .slice(0, 2)
    .map((w) => `#${w.replace(/[^a-z0-9]/gi, "")}`);
  return Array.from(new Set([...DEFAULT_HASHTAGS, ...franchise])).slice(0, 8);
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

function statusForPack({ mp4, cover }) {
  if (!mp4 && !cover) return "missing_video_and_cover";
  if (!mp4) return "missing_video";
  if (!cover) return "missing_cover";
  return "ready_for_operator_review";
}

function buildDiscordMessage(pack) {
  const priority =
    pack.urgencyScore >= 75 ? "HIGH PRIORITY" : pack.urgencyScore >= 50 ? "PRIORITY" : "STANDARD";
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
    `TikTok Ready - ${priority}`,
    pack.title,
    `Duration: ${duration} (${rewards})`,
    `Recommended: ${pack.recommendedPublishTime.timeIso}`,
    `Caption: ${pack.caption}`,
    `Hashtags: ${pack.hashtags.join(" ")}`,
    `Video: ${pack.mp4 || "missing"}`,
    `Cover: ${pack.cover || "missing"}`,
    "Action: review source/title, upload through the chosen route, then mark the dispatch item complete.",
  ].join("\n");
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

function buildTikTokDispatchPack(story, { durationSeconds = null, now = new Date() } = {}) {
  const mp4 = story?.exported_path || null;
  const cover =
    story?.thumbnail_candidate_path ||
    story?.hf_thumbnail_path ||
    story?.story_image_path ||
    story?.image_path ||
    null;
  const score = urgencyScore(story);
  const pack = {
    storyId: story?.id || null,
    title: story?.title || "",
    mp4,
    cover,
    caption: buildCaption(story),
    hashtags: buildHashtags(story),
    urgencyScore: score,
    status: statusForPack({ mp4, cover }),
    recommendedPublishTime: recommendedPublishTime(score, { now }),
    eligibility: {
      hasMp4: Boolean(mp4),
      hasCover: Boolean(cover),
      durationSeconds,
      creatorRewardsLengthEligible:
        typeof durationSeconds === "number" ? durationSeconds >= 60 : null,
    },
    phoneInstructions: [
      "Open TikTok mobile app.",
      "Upload the MP4 from the dispatch pack.",
      "Set the cover image from the dispatch pack.",
      "Paste the caption and hashtags exactly.",
      "Publish only after the source and title have been manually reviewed.",
    ],
    routePriority: ROUTE_ORDER,
    recommendedRoute: "third_party_scheduler_true_autopublish",
    compatibility: {
      officialApi: "best_long_term_after_business_media_tool_reapproval",
      thirdPartyScheduler: "best_near_term_if_true_autopublish_personal_account_confirmed",
      phoneSemiApproval: "safe_fallback_when_operator_has_two_minutes",
      browserRpa: "test_account_only_before_live_consideration",
      virtualAssistant: "last_resort_only",
    },
  };
  pack.schedulerReadyJson = buildSchedulerPayload(pack);
  pack.phoneWorkflowJson = buildPhoneWorkflowPayload(pack);
  pack.discordNotification = buildDiscordMessage(pack);
  return pack;
}

function buildTikTokDispatchManifest(stories = [], { durationByStoryId = {}, now = new Date() } = {}) {
  const packs = (Array.isArray(stories) ? stories : [])
    .filter((s) => s && (s.exported_path || s.approved))
    .map((story) =>
      buildTikTokDispatchPack(story, {
        durationSeconds: durationByStoryId[story.id] ?? null,
        now,
      }),
    )
    .sort((a, b) => b.urgencyScore - a.urgencyScore);
  return {
    generatedAt: new Date().toISOString(),
    routePriority: ROUTE_ORDER,
    count: packs.length,
    packs,
    topPack: packs[0] || null,
    queue: packs.map((pack, index) => ({
      position: index + 1,
      storyId: pack.storyId,
      status: pack.status,
      urgencyScore: pack.urgencyScore,
      recommendedRoute: pack.recommendedRoute,
      recommendedPublishTime: pack.recommendedPublishTime,
      schedulerReadyJson: pack.schedulerReadyJson,
      phoneWorkflowJson: pack.phoneWorkflowJson,
      discordNotification: pack.discordNotification,
    })),
    sampleDiscordNotification: packs[0]?.discordNotification || null,
  };
}

function renderTikTokDispatchMarkdown(manifest) {
  const lines = [
    "# TikTok Live Dispatch",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Packs: ${manifest.count}`,
    "",
    "## Route Priority",
    "",
    "1. Official TikTok API approval route",
    "2. Third-party scheduler with true auto-publish",
    "3. Semi-automated phone approval workflow",
    "4. Browser/RPA automation of TikTok Studio on a test account only",
    "5. VA poster as last resort",
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
  renderTikTokDispatchMarkdown,
  recommendedPublishTime,
};
