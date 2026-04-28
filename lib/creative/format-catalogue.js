"use strict";

/**
 * lib/creative/format-catalogue.js — Session 2 (creative pass).
 *
 * Single source of truth for the Pulse Gaming format ladder. Every
 * format defines:
 *
 *   - viewerPromise        : one-line contract with the viewer
 *   - idealRuntimeSeconds  : target runtime band
 *   - sourceConfidence     : minimum source-confidence to qualify
 *                            (rumour | likely | verified | confirmed)
 *   - mediaInventory       : minimum media-inventory class required
 *                            (briefing_item, short_only, standard_video,
 *                             premium_video). Anything weaker is
 *                             demoted to a lower format or rejected.
 *   - scriptStructure      : ordered beats, no copied phrasing
 *   - titlePatterns        : SEO patterns (no copying)
 *   - seo                  : description shape + tag families
 *   - shortsRepurposing    : how the long-form can be cut into Shorts
 *   - analyticsToTrack     : metric names to wire into Session 3
 *   - monetisation         : revenue route (informational only)
 *   - promotionRules       : when this format levels up
 *   - demotionRules        : when this format gets shut down
 *   - reviewRequirements   : human checks before publish
 *
 * No phrasing, jokes, branding, thumbnails or visual assets here are
 * copied from any other channel. References to "weekly roundups",
 * "monthly previews" etc. are functional-genre descriptions, not
 * scripts.
 */

const FORMATS = [
  {
    id: "daily_shorts",
    label: "Daily Shorts",
    viewerPromise:
      "One verified gaming story in under a minute, delivered the day it broke.",
    idealRuntimeSeconds: { min: 30, max: 60, target: 45 },
    sourceConfidence: ["verified", "confirmed", "likely"],
    mediaInventory: {
      minClass: "short_only",
      minStoreAssets: 1,
      requireTrailerOrGameplay: false,
    },
    scriptStructure: [
      "hook (0-3s, no filler opener, gap of curiosity)",
      "fact stack (3-25s, sourced claims, no rumour-as-fact)",
      "consequence/why-it-matters (25-40s)",
      "loop/callback (40-50s, no comment-bait)",
    ],
    titlePatterns: [
      "<game> <event> — <consequence>",
      "<studio> just <verb>'d <thing>",
      "<platform> finally <action>",
    ],
    seo: {
      descriptionFirst200: "primary-keyword + game name + platform tag",
      tagFamilies: [
        "gameNameVariants",
        "platformTags",
        "channelTags",
        "verticalTags",
      ],
    },
    shortsRepurposing:
      "self (already a Short). Optional cross-post to TikTok/IG.",
    analyticsToTrack: [
      "views_24h",
      "views_72h",
      "average_view_percentage",
      "subscribers_gained",
      "comment_to_view_ratio",
      "like_to_view_ratio",
    ],
    monetisation:
      "ad-spliced once Shorts monetisation unlocks; affiliate link in description",
    promotionRules:
      "If 3 of last 7 daily shorts pass 90% AVP and >2x channel-mean views, raise daily cadence cap.",
    demotionRules:
      "If 4 of last 7 daily shorts under 30% AVP, drop the weakest source/topic from the next week's queue.",
    reviewRequirements: [
      "fact-check pass on the verification panel",
      "thumbnail safety green",
      "no advertiser-unfriendly tokens in title/description",
    ],
  },
  {
    id: "daily_briefing",
    label: "Daily Briefing",
    viewerPromise:
      "A 2-3 minute round-up of every important gaming story from the last 24 hours.",
    idealRuntimeSeconds: { min: 120, max: 240, target: 180 },
    sourceConfidence: ["verified", "confirmed", "likely"],
    mediaInventory: {
      minClass: "briefing_item",
      minStoryCount: 6,
      requirePerStoryArtwork: true,
    },
    scriptStructure: [
      "cold open (0-10s, the day's biggest single beat)",
      "agenda card (10-20s)",
      "6-10 segment chapters (each 18-30s, one beat each)",
      "callback / what to watch tomorrow (final 15-20s)",
    ],
    titlePatterns: [
      "Today in Gaming — <date>",
      "<date> Gaming News in <runtime>",
      "<lead beat> + <count> more stories",
    ],
    seo: {
      descriptionFirst200: "date + lead beat + 2 secondary beats",
      tagFamilies: ["dailyTags", "channelTags", "gameSpecificTagsPerSegment"],
    },
    shortsRepurposing:
      "every chapter that scored premium_suitability >= 70 in §D becomes a standalone Short.",
    analyticsToTrack: [
      "average_view_duration",
      "average_view_percentage",
      "audience_retention_curve",
      "chapter_skip_rate",
      "subscribers_gained",
    ],
    monetisation:
      "long-form mid-roll (post-YPP); affiliate stack in description",
    promotionRules:
      "If retention plateau above 45% at 2:30 on 3 consecutive briefings, extend the format to 4 minutes.",
    demotionRules:
      "If subscribers_gained per briefing < daily-shorts mean for 7 consecutive days, pause the format.",
    reviewRequirements: [
      "every segment has a sourced verification row",
      "no segment exceeds its 30s budget",
      "thumbnail and chapter cards both pass thumbnail-safety",
    ],
  },
  {
    id: "weekly_roundup",
    label: "Weekly Roundup",
    viewerPromise:
      "The week in gaming compiled into one watch with chapters, ranked by impact.",
    idealRuntimeSeconds: { min: 300, max: 720, target: 480 },
    sourceConfidence: ["verified", "confirmed"],
    mediaInventory: {
      minClass: "standard_video",
      minStoryCount: 8,
      perStoryMin: { storeAssets: 1 },
    },
    scriptStructure: [
      "cold open (0-15s)",
      "headline tease — top 3 beats (15-45s)",
      "chapters 1..N (each 45-90s, one weekly beat)",
      "footnotes — small stories that mattered (final 60s)",
      "outro and cta",
    ],
    titlePatterns: [
      "Gaming News This Week — <week ending date>",
      "Top <N> Gaming Stories This Week",
      "<lead beat>, <secondary beat> and more — Weekly Roundup",
    ],
    seo: {
      descriptionFirst200: "lead beat + 2 secondary + week-of date",
      tagFamilies: ["weeklyRoundupTags", "gameTagsPerChapter", "channelTags"],
    },
    shortsRepurposing:
      "top 3 chapters by retention curve become Sunday/Monday Shorts.",
    analyticsToTrack: [
      "average_view_duration",
      "audience_retention_curve",
      "shorts_uplift_post_publish",
      "subscribers_gained_72h",
    ],
    monetisation:
      "long-form ads + affiliate; weekly-roundup is the YPP-anchor format",
    promotionRules:
      "If a roundup hits >10x daily-shorts mean views in 14 days, lock the cadence and raise budget for B-roll on next week's stories.",
    demotionRules:
      "If 3 consecutive roundups underperform the briefing format on impressions, shorten the runtime to 5-6 min.",
    reviewRequirements: [
      "every chapter sourced",
      "no advertiser-unfriendly tokens",
      "thumbnail green AND first 30s passes a mobile preview",
    ],
  },
  {
    id: "monthly_release_radar",
    label: "Monthly Release Radar",
    viewerPromise:
      "Every notable game launching next month, with verified release dates and a per-game pitch.",
    idealRuntimeSeconds: { min: 900, max: 1500, target: 1200 },
    sourceConfidence: ["confirmed"],
    mediaInventory: {
      minClass: "premium_video",
      minStoryCount: 10,
      perStoryMin: {
        storeAssets: 2,
        trailerOrGameplay: 1,
      },
    },
    scriptStructure: [
      "cold open (0-20s, a single hook game from the list)",
      "intro + caveats (20-60s, calendar window + how titles were chosen)",
      "10 game segments (each 60-120s: pitch -> release date -> platforms -> verdict)",
      "honourable mentions (60-90s)",
      "outro + invite to bookmark (final 30s)",
    ],
    titlePatterns: [
      "Top 10 New Games Coming in <Month YYYY>",
      "<Month> <Year>'s Biggest Game Releases",
      "Every Game Worth Watching in <Month> <Year>",
    ],
    seo: {
      descriptionFirst200: "month + year + lead two games + platform mix",
      tagFamilies: [
        "monthlyReleaseTags",
        "gameTagsPerSegment",
        "platformTags",
        "channelTags",
      ],
    },
    shortsRepurposing:
      "each game segment is the source of a 45-60s Short with a one-game-only beat.",
    analyticsToTrack: [
      "average_view_duration",
      "average_view_percentage",
      "audience_retention_curve",
      "subscribers_gained",
      "comments_with_topic_suggestion",
    ],
    monetisation:
      "long-form ads; affiliate-heavy description; sponsor candidate",
    promotionRules:
      "If retention >40% at 8:00 on two consecutive radars, increase production budget for animated chapter cards.",
    demotionRules:
      "If a release date in a published radar turns out to be wrong, demote the source's verification weight by one tier.",
    reviewRequirements: [
      "every release date carries a source field",
      "fact-check gate ran without NEEDS_SOURCE leftovers",
      "thumbnail safety green",
      "advertiser-friendly title and description",
    ],
  },
  {
    id: "before_you_download",
    label: "Before You Download",
    viewerPromise:
      "An evidence-led pre-launch verdict on a single game: what's confirmed, what's hyped, what's missing.",
    idealRuntimeSeconds: { min: 240, max: 540, target: 360 },
    sourceConfidence: ["confirmed"],
    mediaInventory: {
      minClass: "premium_video",
      minStoreAssets: 3,
      requireTrailerOrGameplay: true,
    },
    scriptStructure: [
      "cold open (0-15s, the single biggest open question)",
      "what is confirmed (45-90s)",
      "what is unclear (60-120s)",
      "what is missing (60-90s)",
      "verdict + buy/wait line (final 30-60s)",
    ],
    titlePatterns: [
      "Before You Buy <Game> — Everything You Need to Know",
      "<Game>: What's Actually Confirmed",
      "Should You Pre-Order <Game>? Here's What We Know",
    ],
    seo: {
      descriptionFirst200:
        "game name + platform + release window + lead concern",
      tagFamilies: ["gameTags", "platformTags", "preLaunchTags", "channelTags"],
    },
    shortsRepurposing:
      "the verdict line and the single biggest open question each become Shorts.",
    analyticsToTrack: [
      "average_view_percentage",
      "subscribers_gained",
      "saved_to_watch_later",
      "click_through_rate_thumbnail",
    ],
    monetisation: "long-form ads + affiliate (game pre-order link)",
    promotionRules:
      "If a Before You Download beats the channel mean by >2x, schedule a follow-up Day-One Verdict short.",
    demotionRules:
      "If two consecutive videos contain claims later contradicted, pause the format and review verification process.",
    reviewRequirements: [
      "every claim is sourced",
      "no rumour shown as fact",
      "advertiser-friendly framing",
    ],
  },
  {
    id: "trailer_breakdown",
    label: "Trailer Breakdown",
    viewerPromise:
      "A frame-by-frame walkthrough of a single high-impact trailer, calling out only what's actually visible.",
    idealRuntimeSeconds: { min: 240, max: 600, target: 360 },
    sourceConfidence: ["confirmed"],
    mediaInventory: {
      minClass: "premium_video",
      minTrailerClips: 1,
      minTrailerFrames: 12,
    },
    scriptStructure: [
      "cold open with the most striking trailer beat (0-15s)",
      "context — what was announced, by whom, when (15-45s)",
      "frame walkthrough (4-8 callouts, each 30-60s, only what's visible)",
      "what's NOT in the trailer (60-90s)",
      "outro: questions left open (final 20-40s)",
    ],
    titlePatterns: [
      "<Game> Trailer — Frame by Frame",
      "Everything You Missed in the <Game> <Event> Trailer",
      "<Game> — What the Trailer Actually Confirms",
    ],
    seo: {
      descriptionFirst200:
        "game + event + trailer URL where permitted + lead callout",
      tagFamilies: ["gameTags", "trailerTags", "channelTags"],
    },
    shortsRepurposing: "each frame callout is a 30-45s Short.",
    analyticsToTrack: [
      "average_view_percentage",
      "audience_retention_curve",
      "subscribers_gained",
      "frame_callout_skip_rate",
    ],
    monetisation: "long-form ads + affiliate",
    promotionRules:
      "If a breakdown beats the channel mean by >2x AVP, schedule a follow-up at the next major trailer drop.",
    demotionRules:
      "If two consecutive breakdowns over-claim what's in the trailer, retighten the only-what-is-visible rule and pause for one week.",
    reviewRequirements: [
      "every callout matches a timestamp on the source trailer",
      "thumbnail safety green",
      "no fabricated frames",
    ],
  },
  {
    id: "rumour_radar",
    label: "Rumour Radar",
    viewerPromise:
      "A weekly survey of unconfirmed but widely-cited gaming rumours, with credibility tiers and dissent.",
    idealRuntimeSeconds: { min: 240, max: 480, target: 360 },
    sourceConfidence: ["likely", "rumour"],
    mediaInventory: {
      minClass: "standard_video",
      minStoryCount: 5,
      perStoryMin: { storeAssets: 1 },
    },
    scriptStructure: [
      "cold open (0-15s, the single most discussed rumour)",
      "tiering rule (15-45s, how the channel grades sources)",
      "5-8 rumour segments (each 30-60s, source + tier + dissent)",
      "watchlist (final 60s, rumours to watch into next week)",
    ],
    titlePatterns: [
      "Gaming Rumours — Week of <date> — Tier-Ranked",
      "Top Gaming Rumours This Week and How Reliable They Are",
      "<headline rumour>, <secondary rumour> — Rumour Radar",
    ],
    seo: {
      descriptionFirst200: "rumour-radar wording + lead rumour + week-of date",
      tagFamilies: ["rumourTags", "weeklyTags", "channelTags"],
    },
    shortsRepurposing:
      "the highest-tier rumour becomes a Short with a louder hedge.",
    analyticsToTrack: [
      "average_view_percentage",
      "comments_with_correction",
      "subscribers_gained",
      "watch_time_growth",
    ],
    monetisation: "long-form ads only — no affiliate on rumour-tagged segments",
    promotionRules:
      "If three consecutive rumour radars surface a verified scoop within 7 days of publish, raise the format priority.",
    demotionRules:
      "If a rumour radar surfaces a clearly debunked claim without dissent, pause the format until tiering rule is refreshed.",
    reviewRequirements: [
      "every rumour has at least one cited source URL",
      "no rumour is presented as fact",
      "advertiser-friendly framing across the whole video",
    ],
  },
  {
    id: "blog_only",
    label: "Blog-only",
    viewerPromise:
      "A short, sourced text article when there's not enough visual material for video.",
    idealRuntimeSeconds: null,
    sourceConfidence: ["verified", "confirmed", "likely"],
    mediaInventory: {
      minClass: "blog_only",
    },
    scriptStructure: [
      "headline (under 70 chars)",
      "lede (40-70 words, summarises the story)",
      "body (3-5 short sections)",
      "what to watch next",
      "sources block",
    ],
    titlePatterns: [
      "<game/topic>: <fact>",
      "What's Going On With <topic>",
      "<source> Reports <fact>",
    ],
    seo: {
      descriptionFirst200: "primary keyword + lede + game/platform tags",
      tagFamilies: ["blogTags", "gameTags", "channelTags"],
    },
    shortsRepurposing: "none unless visuals later become available.",
    analyticsToTrack: [
      "blog_pageviews",
      "newsletter_open_rate_lift",
      "search_impressions",
    ],
    monetisation: "blog-side ads + affiliate; newsletter cross-post",
    promotionRules:
      "If a blog post earns >5x channel-mean blog pageviews, escalate to a Shorts attempt.",
    demotionRules:
      "If three blog posts in a row earn under 100 pageviews each, prune the source feed that produced them.",
    reviewRequirements: [
      "every claim sourced",
      "no fabricated quotes",
      "headline matches body",
    ],
  },
  {
    id: "reject",
    label: "Reject",
    viewerPromise:
      "Not published. Inventory or sourcing was insufficient — surfaced for editorial review.",
    idealRuntimeSeconds: null,
    sourceConfidence: ["unknown"],
    mediaInventory: { minClass: "reject_visuals" },
    scriptStructure: [],
    titlePatterns: [],
    seo: { descriptionFirst200: null, tagFamilies: [] },
    shortsRepurposing: null,
    analyticsToTrack: ["editorial_review_outcome"],
    monetisation: null,
    promotionRules:
      "Reject does not promote automatically. An operator may move a story back into the queue with new evidence.",
    demotionRules:
      "Stories rejected three times by the inventory gate are archived.",
    reviewRequirements: ["operator review with evidence trail"],
  },
];

const CONFIDENCE_RANK = {
  unknown: 0,
  rumour: 1,
  likely: 2,
  verified: 3,
  confirmed: 4,
};
const CLASS_RANK = {
  reject_visuals: 0,
  blog_only: 1,
  briefing_item: 2,
  short_only: 3,
  standard_video: 4,
  premium_video: 5,
};

function listFormats() {
  return FORMATS.map((f) => ({ ...f }));
}

function getFormat(id) {
  return FORMATS.find((f) => f.id === id) || null;
}

function meetsRequirements(format, { sourceConfidence, classification }) {
  if (!format) return false;
  if (format.id === "reject") return classification === "reject_visuals";
  const wantConf = (format.sourceConfidence || []).map((c) =>
    String(c).toLowerCase(),
  );
  const haveConf = String(sourceConfidence || "").toLowerCase();
  if (wantConf.length > 0 && !wantConf.includes(haveConf)) return false;
  const required = format.mediaInventory?.minClass;
  if (required) {
    if (
      (CLASS_RANK[classification] ?? -1) < (CLASS_RANK[required] ?? Infinity)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Pick the highest-priority format a single story qualifies for.
 * Stories below short_only are routed to blog_only or reject.
 */
function selectFormatForStory(story, inventory) {
  const cls = inventory?.classification || "reject_visuals";
  const sourceConfidence =
    story?.flair_confidence ||
    confidenceFromFlair(story?.flair || story?.classification);

  if (cls === "reject_visuals") {
    return { format: getFormat("reject"), reasons: ["inventory_reject"] };
  }
  if (cls === "blog_only") {
    return {
      format: getFormat("blog_only"),
      reasons: ["inventory_below_video_bar"],
    };
  }

  const candidates = FORMATS.filter(
    (f) =>
      f.id !== "reject" &&
      f.id !== "blog_only" &&
      f.id !== "weekly_roundup" &&
      f.id !== "monthly_release_radar" &&
      f.id !== "rumour_radar" &&
      f.id !== "trailer_breakdown" &&
      f.id !== "before_you_download" &&
      f.id !== "daily_briefing",
  );

  for (const fmt of candidates) {
    if (meetsRequirements(fmt, { sourceConfidence, classification: cls })) {
      return {
        format: fmt,
        reasons: [
          `single_story_inventory=${cls}`,
          `confidence=${sourceConfidence}`,
        ],
      };
    }
  }
  return {
    format: getFormat("blog_only"),
    reasons: ["no_format_matched_for_single_story"],
  };
}

function confidenceFromFlair(flair) {
  const f = String(flair || "").toLowerCase();
  if (/confirmed|official/.test(f)) return "confirmed";
  if (/verified/.test(f)) return "verified";
  if (/highly\s*likely|likely/.test(f)) return "likely";
  if (/rumou?r|leak|unconfirmed/.test(f)) return "rumour";
  if (/news|breaking/.test(f)) return "verified";
  return "unknown";
}

module.exports = {
  FORMATS,
  CONFIDENCE_RANK,
  CLASS_RANK,
  listFormats,
  getFormat,
  meetsRequirements,
  selectFormatForStory,
  confidenceFromFlair,
};
