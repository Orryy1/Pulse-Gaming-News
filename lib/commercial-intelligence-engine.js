"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  amazonSearchUrl,
  normaliseAffiliateUrl,
  storyText,
} = require("./affiliate-targeting");
const { normaliseText: normalisePublicText } = require("./text-hygiene");

const APPROVED_AFFILIATE_PROGRAMMES = [
  {
    id: "amazon_uk",
    name: "Amazon Associates UK",
    status: "active",
    link_type: "tagged_search",
    trust_score: 82,
  },
  {
    id: "awin",
    name: "Awin",
    status: "approved_pending_account_integration",
    link_type: "network_deep_link",
    trust_score: 78,
  },
  {
    id: "impact",
    name: "impact.com",
    status: "approved_pending_account_integration",
    link_type: "partnership_platform",
    trust_score: 78,
  },
  {
    id: "sovrn",
    name: "Sovrn Commerce",
    status: "approved_pending_account_integration",
    link_type: "commerce_api",
    trust_score: 74,
  },
];

const PLATFORM_KEYS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];

function cleanText(value) {
  return normalisePublicText(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseText(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slugify(value, fallback = "story") {
  const slug = normaliseText(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 96)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function safeFilename(value, fallback = "story") {
  return slugify(value, fallback).replace(/[^a-z0-9_-]/g, "");
}

function classifyVertical(story, text) {
  const channel = normaliseText(story.channel_id || story.channel || process.env.CHANNEL);
  if (channel === "the-signal") return "tech";
  if (/\b(?:crypto|bitcoin|ethereum|blockchain|token|wallet|exchange|leverage|web3)\b/.test(text)) {
    return "crypto";
  }
  if (
    channel === "stacked" ||
    /\b(?:finance|budget|budgeting|saver|savers|stocks?|shares?|market|mortgage|pension|tax|isa|bank|fees?)\b/.test(text)
  ) {
    return "finance";
  }
  const gamingContext =
    /\b(?:game|gaming|player|players|xbox|playstation|nintendo|steam|switch|ps5|rpg|racer|trailer|release date|developer|studio|publisher|combat|gameplay)\b/.test(
      text,
    );
  if (
    !gamingContext &&
    /\b(?:ai|artificial intelligence|software|saas|laptop|phone|camera|microphone|creator tool|cloud)\b/.test(text)
  ) {
    return "tech";
  }
  return "gaming";
}

function hasPolicyOnlyShape(text) {
  const policy = /\b(?:policy|account|verification|privacy|regulation|rules?|terms|laws?|ban|moderation)\b/.test(text);
  if (/\b(?:without|no)\s+(?:a\s+)?(?:product|hardware|subscription|purchase|commercial)\b/.test(text)) {
    return policy;
  }
  const product =
    /\b(?:game|release|launch|price|deal|sale|discount|hardware|console|controller|accessor(?:y|ies)|peripheral|headset|storage|download|steam deck|game pass|edition|wheel|monitor)\b/.test(
      text,
    );
  return policy && !product;
}

function extractStoryEntities(story, text) {
  const title = cleanText(story.title || story.suggested_title || "");
  const entities = [];
  const known = [
    ["Forza Horizon 6", /\bforza horizon 6\b/i],
    ["Forza", /\bforza\b/i],
    ["Steam Deck OLED", /\bsteam deck oled\b/i],
    ["Steam Deck", /\bsteam deck\b/i],
    ["Xbox", /\bxbox\b/i],
    ["PlayStation", /\bplaystation|ps5\b/i],
    ["Nintendo Switch", /\bnintendo switch|switch 2\b/i],
    ["Pokemon Go", /\bpokemon go|pok[e\u00e9]mon go\b/i],
    ["Bitcoin", /\bbitcoin\b/i],
  ];
  for (const [label, match] of known) {
    if (match.test(`${title} ${text}`)) entities.push(label);
  }
  if (entities.length === 0 && title) {
    const subject = title
      .split(/\s+/)
      .filter((word) => /^[A-Z0-9]/.test(word))
      .slice(0, 4)
      .join(" ");
    if (subject) entities.push(subject);
  }
  return [...new Set(entities)];
}

function commercialStoryText(story = {}) {
  return [
    storyText(story),
    story.selected_title,
    story.short_title,
    story.canonical_title,
    story.canonical_subject,
    story.canonical_game,
    story.narration_script,
    story.description,
    ...(
      Array.isArray(story.confirmed_claims)
        ? story.confirmed_claims
        : []
    ),
  ]
    .filter(Boolean)
    .join(" ");
}

function detectIntent(story, vertical, text) {
  if (vertical === "crypto") {
    const highRisk =
      /\b(?:leverage|guaranteed|upside|price prediction|buy now|sell now|exchange promotion|trading signal|token promotion)\b/.test(
        text,
      );
    return {
      type: highRisk ? "crypto_high_risk_no_promotion" : "crypto_education_only",
      angle: "Sources and risk notes only",
      highRisk,
    };
  }

  if (vertical === "finance") {
    return {
      type: "finance_education_only",
      angle: "Sources and further reading only",
      highRisk: !story.compliance_approved,
    };
  }

  if (hasPolicyOnlyShape(text)) {
    return {
      type: "no_safe_commercial_intent",
      angle: "No natural affiliate angle",
      highRisk: false,
    };
  }

  if (
    /\b(?:super mario|mario)\b/.test(text) &&
    /\b(?:deal|price|sale|discount|physical|switch|game|gamestop|eshop)\b/.test(text)
  ) {
    return {
      type: "nintendo_franchise_game_deal",
      angle: "Nintendo game and Switch buying checks",
      highRisk: false,
    };
  }

  if (/\b(?:forza|gran turismo|racing wheel|racing game|f1\s*\d*|steam numbers?)\b/.test(text)) {
    return {
      type: "racing_game_setup",
      angle: "Racing wheels and Xbox/PC setup checks",
      highRisk: false,
    };
  }

  if (/\b(?:pokemon go|pokemon|mobile game event)\b/.test(text)) {
    return {
      type: "mobile_game_accessory",
      angle: "Mobile game accessories and gift card checks",
      highRisk: false,
    };
  }

  if (/\bsteam deck\b/.test(text)) {
    return {
      type: "steam_deck_setup",
      angle: "Steam Deck storage and dock checks",
      highRisk: false,
    };
  }

  if (vertical === "tech") {
    return {
      type: "creator_or_tech_tools",
      angle: "Related tools and setup checks",
      highRisk: false,
    };
  }

  if (/\b(?:controller|headset|monitor|keyboard|mouse|ssd|storage|console|hardware|accessor(?:y|ies)|game pass|subscription|edition|deal|price|sale|discount|pre[-\s]?order)\b/.test(text)) {
    return {
      type: "gaming_setup_or_buying_context",
      angle: "Game, hardware and setup checks",
      highRisk: false,
    };
  }

  return {
    type: "no_safe_commercial_intent",
    angle: "No natural affiliate angle",
    highRisk: false,
  };
}

function intentOffers(intentType) {
  if (intentType === "racing_game_setup") {
    return [
      {
        label: "Racing wheel",
        query: "racing wheel PS5 Xbox PC",
        category: "racing wheel",
        relevance: 94,
        conversion: 78,
        commission: 58,
      },
      {
        label: "Xbox controller",
        query: "Xbox wireless controller",
        category: "controller",
        relevance: 86,
        conversion: 80,
        commission: 48,
      },
      {
        label: "Game Pass route",
        query: "Xbox Game Pass gift card",
        category: "subscription",
        relevance: 78,
        conversion: 74,
        commission: 42,
      },
      {
        label: "Racing monitor",
        query: "gaming monitor racing games",
        category: "monitor",
        relevance: 74,
        conversion: 62,
        commission: 62,
      },
    ];
  }

  if (intentType === "steam_deck_setup") {
    return [
      {
        label: "Steam Deck storage",
        query: "microSD card Steam Deck",
        category: "storage",
        relevance: 92,
        conversion: 82,
        commission: 52,
      },
      {
        label: "Steam Deck dock",
        query: "Steam Deck dock",
        category: "dock",
        relevance: 86,
        conversion: 72,
        commission: 50,
      },
      {
        label: "Steam Deck case",
        query: "Steam Deck case",
        category: "case",
        relevance: 78,
        conversion: 70,
        commission: 48,
      },
    ];
  }

  if (intentType === "mobile_game_accessory") {
    return [
      {
        label: "Mobile power bank",
        query: "portable power bank phone",
        category: "mobile accessory",
        relevance: 78,
        conversion: 72,
        commission: 48,
      },
      {
        label: "Pokemon Go Plus+",
        query: "Pokemon Go Plus Plus",
        category: "game accessory",
        relevance: 84,
        conversion: 68,
        commission: 44,
      },
      {
        label: "Gaming gift card",
        query: "gaming gift card",
        category: "game credit",
        relevance: 64,
        conversion: 70,
        commission: 34,
      },
    ];
  }

  if (intentType === "nintendo_franchise_game_deal") {
    return [
      {
        label: "Mario games",
        query: "Super Mario Nintendo Switch game",
        category: "game",
        relevance: 88,
        conversion: 72,
        commission: 42,
      },
      {
        label: "Nintendo Switch games",
        query: "Nintendo Switch games",
        category: "game",
        relevance: 82,
        conversion: 70,
        commission: 42,
      },
      {
        label: "Nintendo eShop gift card",
        query: "Nintendo eShop gift card",
        category: "game credit",
        relevance: 76,
        conversion: 74,
        commission: 34,
      },
      {
        label: "Switch controller",
        query: "Nintendo Switch Pro Controller",
        category: "controller",
        relevance: 64,
        conversion: 66,
        commission: 48,
      },
    ];
  }

  if (intentType === "creator_or_tech_tools") {
    return [
      {
        label: "Creator microphone",
        query: "USB microphone creator",
        category: "microphone",
        relevance: 72,
        conversion: 66,
        commission: 50,
      },
      {
        label: "Creator lights",
        query: "video creator lighting kit",
        category: "creator setup",
        relevance: 68,
        conversion: 62,
        commission: 48,
      },
    ];
  }

  if (intentType === "gaming_setup_or_buying_context") {
    return [
      {
        label: "Game editions and prices",
        query: "video game editions PS5 Xbox Nintendo Switch",
        category: "game",
        relevance: 76,
        conversion: 68,
        commission: 42,
      },
      {
        label: "Gaming headset",
        query: "gaming headset PS5 Xbox PC",
        category: "headset",
        relevance: 72,
        conversion: 72,
        commission: 54,
      },
      {
        label: "Extra controller",
        query: "gaming controller PS5 Xbox Nintendo Switch",
        category: "controller",
        relevance: 70,
        conversion: 74,
        commission: 48,
      },
    ];
  }

  return [];
}

function overuseCount(offer, recentOfferUse = {}) {
  const keys = [
    offer.category,
    offer.label,
    offer.query,
  ]
    .filter(Boolean)
    .map((value) => normaliseText(value));
  let count = 0;
  for (const key of keys) {
    count = Math.max(count, Number(recentOfferUse[key] || 0));
  }
  return count;
}

function affiliateScore(parts) {
  return Math.max(
    0,
    Math.round(
      parts.story_relevance * 0.35 +
        parts.conversion_likelihood * 0.2 +
        parts.commission_value * 0.15 +
        parts.merchant_trust * 0.15 +
        parts.audience_fit * 0.1 +
        parts.availability * 0.05 -
        parts.compliance_risk -
        parts.spam_penalty -
        parts.repetition_penalty,
    ),
  );
}

function buildCandidateLink(offer, opts) {
  const recentCount = overuseCount(offer, opts.recentOfferUse);
  const spamPenalty = recentCount >= 5 ? 25 + Math.min(25, (recentCount - 5) * 5) : 0;
  const rejectionReasons = [];
  if (spamPenalty > 0) rejectionReasons.push("offer_overused_recently");

  const url = normaliseAffiliateUrl(amazonSearchUrl(offer.query, opts.tag));
  const scoreParts = {
    story_relevance: offer.relevance,
    conversion_likelihood: offer.conversion,
    commission_value: offer.commission,
    merchant_trust: 84,
    audience_fit: opts.vertical === "gaming" ? 86 : 72,
    availability: 70,
    compliance_risk: opts.complianceRisk,
    spam_penalty: spamPenalty,
    repetition_penalty: Math.max(0, recentCount - 2) * 2,
  };

  return {
    id: slugify(`${offer.category}-${offer.query}`),
    label: offer.label,
    query: offer.query,
    url,
    merchant: "Amazon UK",
    programme_id: "amazon_uk",
    product_category: offer.category,
    category: offer.category,
    story_relevance: scoreParts.story_relevance,
    conversion_likelihood: scoreParts.conversion_likelihood,
    commission_value: scoreParts.commission_value,
    merchant_trust: scoreParts.merchant_trust,
    audience_fit: scoreParts.audience_fit,
    availability: scoreParts.availability,
    compliance_risk: scoreParts.compliance_risk,
    spam_penalty: scoreParts.spam_penalty,
    repetition_penalty: scoreParts.repetition_penalty,
    recent_offer_use: recentCount,
    affiliate_score: affiliateScore(scoreParts),
    commission_estimate: {
      basis: "Amazon UK category rate varies by product and account status",
      amount: null,
      currency: "GBP",
      confidence: "low_until_click_data",
    },
    disclosure_required: true,
    tracking: {
      story_id: opts.storyId,
      cta_variant: offer.category,
      video_id: opts.videoId || null,
    },
    rejection_reasons: rejectionReasons,
  };
}

function buildDisclosureCopy(hasLinks) {
  if (!hasLinks) {
    return {
      short: "No affiliate links are attached to this story.",
      landing:
        "This page is editorial first. If we add affiliate links later, they will be labelled clearly.",
    };
  }
  return {
    short: "Affiliate links may earn us a commission.",
    landing:
      "Affiliate links may earn us a commission. We only attach links when they fit the story and the source material.",
    video: "Affiliate links are on the story page where relevant.",
  };
}

function platformCtas({ vertical, hasLinks }) {
  if (vertical === "crypto") {
    return {
      youtube: "Sources and risk notes are on the story page. No buy/sell recommendation.",
      tiktok: "Sources and risk notes are on the story page. No buy/sell recommendation.",
      instagram: "Sources and risk notes are on the story page. No buy/sell recommendation.",
      facebook: "Sources and risk notes are on the story page. No buy/sell recommendation.",
      x: "Sources and risk notes are on the story page. No buy/sell recommendation.",
      threads: "Sources and risk notes are on the story page. No buy/sell recommendation.",
      pinterest: "Sources and risk notes are on the story page. No buy/sell recommendation.",
    };
  }
  if (vertical === "finance") {
    return {
      youtube: "Sources and further reading are linked. This is not financial advice.",
      tiktok: "Sources and further reading are linked. This is not financial advice.",
      instagram: "Sources and further reading are linked. This is not financial advice.",
      facebook: "Sources and further reading are linked. This is not financial advice.",
      x: "Sources and further reading are linked. This is not financial advice.",
      threads: "Sources and further reading are linked. This is not financial advice.",
      pinterest: "Sources and further reading are linked. This is not financial advice.",
    };
  }
  if (!hasLinks) {
    return {
      youtube: "The story page has sources and context.",
      tiktok: "The story page has sources and context.",
      instagram: "The story page has sources and context.",
      facebook: "The story page has sources and context.",
      x: "The story page has sources and context.",
      threads: "The story page has sources and context.",
      pinterest: "The story page has sources and context.",
    };
  }
  return {
    youtube: "Story page has source links, editions and related setup checks.",
    tiktok: "Source notes and related setup links are on the story page.",
    instagram: "Source notes and related setup links are on the story page.",
    facebook: "Story page has source links and related setup checks.",
    x: "Sources and related setup links are on the story page.",
    threads: "Sources and context are on the story page.",
    pinterest: "Sources and setup links are on the story page.",
  };
}

function sourceLinks(story) {
  return [
    story.article_url,
    story.url,
    story.primary_source_url,
    story.official_confirmation_source,
  ]
    .filter(Boolean)
    .map((url) => ({ label: "Source", url }))
    .filter((item, index, arr) => arr.findIndex((other) => other.url === item.url) === index);
}

function buildTrackingUtm(story, slug) {
  return {
    utm_source: "pulse_gaming",
    utm_medium: "shorts",
    utm_campaign: slug,
    story_id: story.id || null,
    video_id: story.youtube_post_id || story.youtube_id || null,
    cta_variants: PLATFORM_KEYS.reduce((out, platform) => {
      out[platform] = `${slug}_${platform}`;
      return out;
    }, {}),
  };
}

function parsedOfferTrackingRoute(value) {
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    const parsed = new URL(text, "https://pulse.local");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "go") return {};
    return {
      storyId: decodeURIComponent(parts[1] || ""),
      offerId: decodeURIComponent(parts[2] || ""),
      ctaVariant: parsed.searchParams.get("cta") || "",
      videoId: parsed.searchParams.get("video_id") || "",
    };
  } catch {
    return {};
  }
}

function offerIdForLink(link = {}) {
  return String(link.id || parsedOfferTrackingRoute(link.tracking_url).offerId || "").trim();
}

function buildOfferTrackingUrl(link, platform = "story_page") {
  if (!link) return null;
  const parsedTracking = parsedOfferTrackingRoute(link.tracking_url);
  const storyId = link.tracking?.story_id || parsedTracking.storyId || "";
  const offerId = link.id || parsedTracking.offerId || "";
  const ctaVariant =
    link.tracking?.cta_variant ||
    parsedTracking.ctaVariant ||
    link.product_category ||
    "offer";
  const videoId = link.tracking?.video_id || parsedTracking.videoId || "";
  if (!storyId || !offerId) return null;
  const query = new URLSearchParams({
    platform,
    cta: ctaVariant,
  });
  if (videoId) query.set("video_id", videoId);
  return `/go/${encodeURIComponent(storyId)}/${encodeURIComponent(offerId)}?${query.toString()}`;
}

function appendQueryParams(route, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      query.set(key, String(value));
    }
  }
  const glue = String(route || "").includes("?") ? "&" : "?";
  return `${route || "/p/story"}${glue}${query.toString()}`;
}

function attributionTrackingKey({ storyId, platform, videoId, ctaVariant }) {
  return [storyId || "story", platform || "unknown", videoId || "no_video", ctaVariant || "story_page"].join(":");
}

function buildLandingPageAttribution({
  story = {},
  storyId,
  slug,
  route,
  primaryLink = null,
  disclosureRequired = false,
  disclosureCopy = {},
} = {}) {
  const videoId = story.youtube_post_id || story.youtube_id || null;
  const ctaVariant = "story_page";
  const rejectionReasons = [];
  if (!route) rejectionReasons.push("missing_story_landing_page");
  if (primaryLink && !disclosureRequired) rejectionReasons.push("missing_affiliate_disclosure");

  const platforms = PLATFORM_KEYS.reduce((out, platform) => {
    const trackingKey = attributionTrackingKey({
      storyId,
      platform,
      videoId,
      ctaVariant,
    });
    out[platform] = {
      platform,
      story_id: storyId,
      video_id: videoId,
      cta_variant: ctaVariant,
      tracking_key: trackingKey,
      landing_page_url: appendQueryParams(route, {
        utm_source: platform,
        utm_medium: "social",
        utm_campaign: slug,
        utm_content: `${storyId}_${platform}_${ctaVariant}`,
        story_id: storyId,
        video_id: videoId,
        cta_variant: ctaVariant,
      }),
      offer_tracking_url: primaryLink ? buildOfferTrackingUrl(primaryLink, platform) : null,
      disclosure_required: Boolean(disclosureRequired),
      disclosure_copy: disclosureRequired ? disclosureCopy.short || null : null,
    };
    return out;
  }, {});

  return {
    schema_version: 1,
    story_id: storyId,
    video_id: videoId,
    landing_page_slug: slug,
    landing_page_route: route,
    verdict: rejectionReasons.length ? "fail" : "pass",
    platforms,
    link_tracking: Object.values(platforms).map((item) => ({
      story_id: storyId,
      video_id: videoId,
      offer_id: primaryLink ? offerIdForLink(primaryLink) || null : null,
      platform: item.platform,
      cta_variant: item.cta_variant,
      tracking_key: item.tracking_key,
      landing_page_url: item.landing_page_url,
      offer_tracking_url: item.offer_tracking_url,
      disclosure_required: item.disclosure_required,
    })),
    rejection_reasons: rejectionReasons,
    safety: {
      source_first_story_page: true,
      no_direct_social_posting: true,
      no_live_account_changes: true,
    },
  };
}

function buildPlatformTrackingUrls(link) {
  if (!link) return {};
  return PLATFORM_KEYS.reduce((out, platform) => {
    out[platform] = buildOfferTrackingUrl(link, platform);
    return out;
  }, {});
}

function selectedPublicFields(link) {
  if (!link) return null;
  return {
    id: link.id,
    label: link.label,
    query: link.query,
    url: link.url,
    tracking_url: buildOfferTrackingUrl(link, "story_page"),
    platform_tracking_urls: buildPlatformTrackingUrls(link),
    merchant: link.merchant,
    programme_id: link.programme_id,
    product_category: link.product_category,
    category: link.category,
    affiliate_score: link.affiliate_score,
    commission_estimate: link.commission_estimate,
    story_relevance: link.story_relevance,
    audience_fit: link.audience_fit,
    merchant_trust: link.merchant_trust,
    disclosure_required: link.disclosure_required,
    tracking: link.tracking,
    reason: `commercial_intent:${link.product_category}`,
    story_specific: true,
    relevance_score: link.story_relevance,
  };
}

function buildAffiliateLinkManifest({
  story = {},
  tag = process.env.AMAZON_AFFILIATE_TAG || "placeholder",
  recentOfferUse = {},
  clickHistory = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const storyId = story.id || story.story_id || slugify(story.title || story.selected_title || story.canonical_title || "story");
  const text = normaliseText(commercialStoryText(story));
  const vertical = classifyVertical(story, text);
  const intent = detectIntent(story, vertical, text);
  const complianceRisk =
    vertical === "crypto" && intent.highRisk ? 90 : vertical === "finance" && intent.highRisk ? 65 : 0;
  const rejectionReasons = [];
  let offers = [];

  if (intent.type === "no_safe_commercial_intent") {
    rejectionReasons.push("story_does_not_naturally_support_affiliate");
  } else if (vertical === "crypto" && intent.highRisk) {
    rejectionReasons.push("crypto_financial_promotion_risk_high");
  } else if (vertical === "finance" && intent.highRisk) {
    rejectionReasons.push("finance_compliance_review_required");
  } else {
    offers = intentOffers(intent.type);
  }

  const candidates = offers.map((offer) =>
    buildCandidateLink(offer, {
      tag,
      vertical,
      complianceRisk,
      recentOfferUse,
      storyId,
      videoId: story.youtube_post_id || story.youtube_id || null,
    }),
  );
  const selected = candidates
    .filter((candidate) => candidate.url && candidate.affiliate_score >= 60 && candidate.rejection_reasons.length === 0)
    .sort((a, b) => b.affiliate_score - a.affiliate_score);
  const primary = selected[0] || null;
  const fallbacks = selected.slice(1, 4);
  const slug = slugify(story.title || story.suggested_title || storyId, storyId);
  const hasLinks = Boolean(primary);
  const disclosureCopy = buildDisclosureCopy(hasLinks);
  const ctas = platformCtas({ vertical, hasLinks });
  const scoreFromPrimary = primary || candidates[0] || null;
  const primaryPublic = selectedPublicFields(primary);
  const fallbackPublic = fallbacks.map(selectedPublicFields);
  const landingPageAttribution = buildLandingPageAttribution({
    story,
    storyId,
    slug,
    route: `/p/${slug}`,
    primaryLink: primaryPublic,
    disclosureRequired: hasLinks,
    disclosureCopy,
  });

  return {
    story_id: storyId,
    generated_at: generatedAt,
    vertical,
    story_entities: extractStoryEntities(story, text),
    commercial_intent_type: intent.type,
    primary_affiliate_angle: intent.angle,
    approved_affiliate_programmes: APPROVED_AFFILIATE_PROGRAMMES.map((programme) => ({
      ...programme,
      configured:
        programme.id === "amazon_uk"
          ? Boolean(tag && tag !== "placeholder")
          : Boolean(process.env[`${programme.id.toUpperCase()}_AFFILIATE_TOKEN`]),
    })),
    candidate_links: candidates,
    primary_link: primaryPublic,
    fallback_links: fallbackPublic,
    merchant: primary ? primary.merchant : null,
    product_category: primary ? primary.product_category : null,
    commission_estimate: primary ? primary.commission_estimate : null,
    relevance_score: scoreFromPrimary ? scoreFromPrimary.story_relevance : 0,
    audience_fit_score: scoreFromPrimary ? scoreFromPrimary.audience_fit : vertical === "gaming" ? 82 : 64,
    trust_score: scoreFromPrimary ? scoreFromPrimary.merchant_trust : 0,
    compliance_risk_score: complianceRisk,
    disclosure_required: hasLinks,
    disclosure_copy: disclosureCopy,
    platform_disclosure: PLATFORM_KEYS.reduce((out, platform) => {
      out[platform] = {
        affiliate_disclosure_required: hasLinks,
        commercial_relationship_toggle_required: false,
        caption_copy: hasLinks ? disclosureCopy.short : null,
      };
      return out;
    }, {}),
    platform_specific_ctas: ctas,
    landing_page_slug: slug,
    landing_page_route: `/p/${slug}`,
    tracking_utm: buildTrackingUtm(story, slug),
    affiliate_tracking_map: {
      story_id: storyId,
      video_id: story.youtube_post_id || story.youtube_id || null,
      primary_offer_id: primaryPublic?.id || null,
      story_page: primaryPublic?.tracking_url || null,
      platforms: primaryPublic?.platform_tracking_urls || {},
      fallback_offer_ids: fallbackPublic.map((link) => link?.id).filter(Boolean),
    },
    landing_page_attribution: landingPageAttribution,
    revenue_attribution: {
      story_id: storyId,
      video_id: story.youtube_post_id || story.youtube_id || null,
      primary_offer_id: primaryPublic?.id || null,
      platform_clicks: PLATFORM_KEYS.reduce((out, platform) => {
        out[platform] = 0;
        return out;
      }, {}),
      landing_page_visits: 0,
      conversions: 0,
      revenue: {
        amount: 0,
        currency: "GBP",
        source: "waiting_for_affiliate_network_reporting",
      },
    },
    source_links: sourceLinks(story),
    compliance: {
      disclaimer_required: vertical === "finance" || vertical === "crypto" || hasLinks,
      finance_or_crypto: vertical === "finance" || vertical === "crypto",
      no_buy_sell_recommendation: vertical === "crypto",
      financial_advice_blocked: vertical === "finance",
      review_required: rejectionReasons.some((reason) => /compliance|crypto_financial/.test(reason)),
    },
    revenue_score: primary ? primary.affiliate_score : 0,
    commercial_opportunity_score: primary ? primary.affiliate_score : 0,
    click_history: clickHistory,
    rejection_reasons: rejectionReasons,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkList(items, emptyCopy, rel = "nofollow sponsored") {
  if (!items.length) return `<p>${escapeHtml(emptyCopy)}</p>`;
  return `<ul>${items
    .map((item) => {
      const href = item.tracking_url || item.url;
      return `<li><a href="${escapeHtml(href)}" rel="${escapeHtml(rel)}">${escapeHtml(item.label)}</a></li>`;
    })
    .join("")}</ul>`;
}

function buildCommercialLandingPageHtml(manifest) {
  const title = manifest.story_entities?.[0]
    ? `${manifest.story_entities[0]} story links`
    : "Pulse Gaming story links";
  const offers = [manifest.primary_link, ...(manifest.fallback_links || [])].filter(Boolean);
  const sources = manifest.source_links || [];
  const safetyNote =
    manifest.vertical === "crypto"
      ? "<p>Crypto stories include source notes only. There is no buy/sell recommendation.</p>"
      : manifest.vertical === "finance"
        ? "<p>Finance stories include sources and further reading only. This is not financial advice.</p>"
        : "";

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;background:#090909;color:#f5f5f5;font-family:Arial,sans-serif;line-height:1.55}
    main{max-width:760px;margin:0 auto;padding:32px 20px}
    a{color:#ffb45c}
    .tag{color:#ffb45c;font-size:13px;text-transform:uppercase;letter-spacing:.08em}
    section{border-top:1px solid #292929;padding-top:20px;margin-top:24px}
    .disclosure{background:#151515;border-left:4px solid #ff6b1a;padding:14px 16px}
    input{width:100%;box-sizing:border-box;padding:12px;border-radius:4px;border:1px solid #444;background:#111;color:#fff}
    button{margin-top:10px;padding:11px 14px;border:0;border-radius:4px;background:#ff6b1a;color:#111;font-weight:700}
  </style>
</head>
<body>
<main>
  <p class="tag">Pulse Gaming story page</p>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(manifest.primary_affiliate_angle || "Sources and related links for this story.")}</p>
  <p class="disclosure">${escapeHtml(manifest.disclosure_copy?.landing || "")}</p>
  ${safetyNote}
  <section>
    <h2>Best related offers</h2>
    ${linkList(offers, "No affiliate offer is attached to this story.")}
  </section>
  <section>
    <h2>Sources</h2>
    ${linkList(sources, "Source links will appear here when the story includes a public URL.", "nofollow")}
  </section>
  <section>
    <h2>Newsletter</h2>
    <p>Get the useful gaming stories, deal checks and source notes in one place.</p>
    <form>
      <input type="email" name="email" placeholder="Email address" aria-label="Email address">
      <button type="submit">Join</button>
    </form>
  </section>
</main>
</body>
</html>`;
}

async function writeAffiliateLinkManifest(manifest, { outputDir = path.join(process.cwd(), "output", "commercial") } = {}) {
  await fs.mkdir(outputDir, { recursive: true });
  const stem = safeFilename(manifest.story_id || manifest.landing_page_slug || "story");
  const outPath = path.join(outputDir, `${stem}_affiliate_link_manifest.json`);
  await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { path: outPath, manifest };
}

async function writeCommercialLandingPage(manifest, { outputDir = path.join(process.cwd(), "blog", "dist", "p") } = {}) {
  await fs.mkdir(outputDir, { recursive: true });
  const outPath = path.join(outputDir, `${safeFilename(manifest.landing_page_slug || manifest.story_id)}.html`);
  await fs.writeFile(outPath, buildCommercialLandingPageHtml(manifest), "utf8");
  return { path: outPath, route: manifest.landing_page_route };
}

module.exports = {
  APPROVED_AFFILIATE_PROGRAMMES,
  buildAffiliateLinkManifest,
  buildLandingPageAttribution,
  buildCommercialLandingPageHtml,
  writeAffiliateLinkManifest,
  writeCommercialLandingPage,
};
