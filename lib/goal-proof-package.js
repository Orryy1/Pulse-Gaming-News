"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");
const fs = require("fs-extra");

const { buildViralScriptIntelligence } = require("./viral-script-intelligence");
const { buildStudioGovernanceReport } = require("./studio-governance-engine");
const { buildStudioEnterpriseOSPack } = require("./studio-enterprise-os");
const { buildFootageEmpirePlan } = require("./studio/v4/footage-empire");
const { buildVisualV4DirectorPlan } = require("./studio/v4/director-brain");
const { PRIMARY_PULSE_CTA } = require("./pulse-cta");
const {
  isGeneratedMotionAsset,
  isRealMediaAsset,
} = require("./visual-evidence-classifier");

const ACCEPTANCE_ARTEFACTS = [
  "canonical_story_manifest.json",
  "script_scorecard.json",
  "footage_inventory.json",
  "rights_ledger.json",
  "director_beat_map.json",
  "render_manifest.json",
  "visual_v4_render.mp4",
  "audio_manifest.json",
  "sfx_manifest.json",
  "sfx_source_plan.json",
  "captions.srt",
  "platform_publish_manifest.json",
  "x_publish_pack.json",
  "instagram_publish_pack.json",
  "affiliate_link_manifest.json",
  "landing_page_manifest.json",
  "platform_policy_report.json",
  "benchmark_report.json",
  "coherence_report.json",
  "publish_verdict.json",
  "analytics_ingest_plan.json",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseSignatureText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceFamilyFor(asset = {}, index = 0) {
  return (
    cleanText(asset.source_family) ||
    cleanText(asset.trusted_footage_source_id) ||
    cleanText(asset.source_id) ||
    cleanText(asset.id) ||
    `source_family_${index + 1}`
  );
}

function buildTrustedFootageReport(story = {}) {
  const clips = asArray(story.video_clips).length
    ? asArray(story.video_clips)
    : asArray(story.motion_clips);
  return {
    story_candidates: clips
      .filter((clip) => !isGeneratedMotionAsset(clip) && isRealMediaAsset(clip))
      .map((clip, index) => ({
        story_id: story.id || null,
        entity: story.canonical_subject || story.canonical_game || story.title || null,
        source_id: cleanText(clip.id || clip.asset_id || `clip_${index + 1}`),
        display_name: cleanText(clip.source_family || clip.source_type || "trusted source"),
        source_tier: /licensed/i.test(clip.rights_risk_class || "") ? "licensed_creator" : "official",
        source_family: sourceFamilyFor(clip, index),
        reference_url: cleanText(clip.source_url || clip.url || clip.path),
        source_url_kind: "web_page",
        segment_validation_eligible: false,
        autonomous_motion_candidate: true,
        allowed_render_use: "reference_only_by_default",
        rights_risk_class: cleanText(clip.rights_risk_class) || "official_reference_only",
      })),
  };
}

function buildLocalMotionClips(story = {}) {
  const seen = new Set();
  return [
    ...asArray(story.video_clips),
    ...asArray(story.visual_v4_local_motion_clips),
  ]
    .filter((clip) => !isGeneratedMotionAsset(clip) && isRealMediaAsset(clip))
    .filter((clip) => {
      const key = [
        cleanText(clip.id || clip.asset_id),
        cleanText(clip.path || clip.local_path),
        cleanText(clip.source_url || clip.url),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((clip, index) => ({
      ...clip,
      id: cleanText(clip.id || clip.asset_id || `local_clip_${index + 1}`),
      source_family: sourceFamilyFor(clip, index),
      path: cleanText(clip.path || clip.local_path || `output/video/${story.id || "story"}_${index + 1}.mp4`),
      durationS: Number(clip.durationS || clip.duration_s || clip.duration || 2.4),
      validated: clip.validated !== false,
      type: "motion_clip",
    }));
}

function buildLocalTimeline(story = {}) {
  const script = cleanText(story.full_script || story.tts_script);
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
  return {
    duration_s: Math.max(35, Math.min(60, sentences.length * 6)),
    beats: sentences.slice(0, 8).map((sentence, index) => ({
      id: `beat_${index + 1}`,
      type: index === 0 ? "hook" : /\b\d|steam|score|price|\$/i.test(sentence) ? "metric" : "context",
      start: Number((index * 4.8).toFixed(2)),
      end: Number((index * 4.8 + 3.4).toFixed(2)),
      text: sentence,
    })),
  };
}

function buildAudioManifest({ story, soundPlan }) {
  return {
    schema_version: 1,
    story_id: story.id || null,
    narration_audio_path: story.audio_path || null,
    music_bed: "local_editorial_energy_bed",
    sfx_cue_count: soundPlan.sfx?.cue_count || 0,
    loudness_target: {
      platform: "short_form_social",
      peak_db: soundPlan.sfx?.mastering?.target_peak_db ?? -1.5,
      narration_priority: true,
    },
    mix_rules: soundPlan.sfx?.mastering || {},
    safety: soundPlan.safety || {},
  };
}

function buildVisualQualityReport({ story, directorPlan, benchmark }) {
  return {
    schema_version: 1,
    story_id: story.id || null,
    result: benchmark.result || "unknown",
    scores: benchmark.scores || {},
    frame_rules: {
      first_frame_subject: story.canonical_subject || story.canonical_game || null,
      first_frame_text: story.suggested_thumbnail_text || null,
      source_locks_readable: directorPlan.visual_obligations?.source_locks_must_be_readable === true,
      no_empty_rectangles: directorPlan.visual_obligations?.forbid_empty_rectangles === true,
      no_text_on_text: directorPlan.visual_obligations?.forbid_text_on_text === true,
    },
    failures: benchmark.failures || [],
  };
}

function buildForensicQaReport({ scriptScorecard, footageInventory, directorPlan, benchmark, governanceReport }) {
  return {
    schema_version: 1,
    story_id: governanceReport.story_id || null,
    verdict:
      governanceReport.publish_control_tower?.verdict === "GREEN" &&
      !asArray(scriptScorecard.blockers).length
        ? "reviewable_proof"
        : "blocked_or_rewrite_required",
    checks: {
      public_output: governanceReport.public_output_coherence_gate?.result || "unknown",
      rights: governanceReport.rights_ledger?.verdict || "unknown",
      script: scriptScorecard.verdict || "unknown",
      footage: footageInventory.readiness?.status || "unknown",
      director: directorPlan.readiness?.status || "unknown",
      benchmark: benchmark.result || "unknown",
    },
    blockers: [
      ...asArray(governanceReport.rejection_reasons?.reason_codes),
      ...asArray(scriptScorecard.blockers),
      ...asArray(footageInventory.readiness?.blockers),
      ...asArray(directorPlan.readiness?.blockers),
      ...asArray(benchmark.failures),
    ],
  };
}

function buildSimpleCaptionSrt(script = "", durationS = 12) {
  const sentences = cleanText(script).split(/(?<=[.!?])\s+/).filter(Boolean);
  const lines = sentences.length ? sentences.slice(0, 10) : ["Pulse Gaming proof render."];
  const segment = Math.max(1.2, durationS / lines.length);
  return `${lines.map((line, index) => {
    const start = index * segment;
    const end = Math.min(durationS, start + segment);
    return [
      String(index + 1),
      `${formatSrtTime(start)} --> ${formatSrtTime(end)}`,
      line,
    ].join("\n");
  }).join("\n\n")}\n`;
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function ffmpegDrawtextEscape(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function compactRenderText(value = "", fallback = "") {
  const text = cleanText(value || fallback).replace(/[^a-zA-Z0-9 $+&._-]+/g, "");
  return text.split(/\s+/).slice(0, 7).join(" ").toUpperCase();
}

const PLATFORM_NATIVE_ORDER = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "threads",
  "pinterest",
];

const PLATFORM_NATIVE_REQUIREMENTS = {
  youtube_shorts: [
    "title",
    "description",
    "hashtags",
    "cover_frame",
    "captions",
    "profile_or_landing_page_cta",
  ],
  tiktok: [
    "conversational_hook",
    "caption",
    "hashtags",
    "disclosure_flag",
    "commercial_content_setting_recommendation",
    "product_link_eligibility",
  ],
  instagram_reels: [
    "cover_frame",
    "caption",
    "carousel_companion.required",
    "story_poll_idea",
    "bio_link_cta",
  ],
  facebook_reels: [
    "page_caption",
    "link_routing_strategy",
    "duration_seconds",
    "explanatory_framing",
  ],
  x: [
    "hot_take_post",
    "source_safe_post",
    "thread_posts",
    "poll_candidate",
    "landing_page_link",
  ],
  threads: [
    "discussion_post",
    "duplicate_x_wording_allowed",
    "landing_page_link",
    "tone",
  ],
  pinterest: [
    "pin_title",
    "pin_description",
    "disclosure",
    "landing_page_link",
    "evergreen_only",
  ],
};

function slugify(value = "") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "pulse-gaming-story";
}

function storySubject(story = {}, canonical = {}) {
  return cleanText(
    canonical.canonical_subject ||
      canonical.canonical_game ||
      story.canonical_subject ||
      story.canonical_game ||
      story.public_title ||
      story.title,
  );
}

function storyTitle(story = {}, canonical = {}) {
  return cleanText(
    canonical.selected_title ||
      canonical.canonical_title ||
      canonical.title ||
      story.public_title ||
      story.suggested_title ||
      story.title ||
      storySubject(story, canonical),
  );
}

function storyAngle(story = {}, canonical = {}) {
  return cleanText(canonical.canonical_angle || story.canonical_angle || story.angle || "");
}

const INTERNAL_ANGLE_RE = /\b(?:source_locked_update|source locked update)\b/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSubjectPrefix(value = "", subject = "") {
  let text = cleanText(value).replace(/[.!?]+$/g, "");
  const subjectText = cleanText(subject);
  if (subjectText) {
    text = text.replace(new RegExp(`^${escapeRegExp(subjectText)}\\s*[:,-]?\\s*`, "i"), "");
  }
  return cleanText(text);
}

function sentenceCaseFragment(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function publicAngleFor({ story = {}, canonical = {}, subject = "", title = "", firstLine = "" } = {}) {
  const explicitAngle = storyAngle(story, canonical);
  if (explicitAngle && !INTERNAL_ANGLE_RE.test(explicitAngle)) return explicitAngle;

  const candidates = [
    canonical.description,
    firstLine,
    title,
    canonical.confirmed_claims?.[0],
    story.claim,
  ];
  for (const candidate of candidates) {
    let fragment = stripSubjectPrefix(candidate, subject)
      .replace(/\bsource:\s*.+$/i, "")
      .replace(/\bsources and related links\b.*$/i, "")
      .trim();
    if (!fragment || INTERNAL_ANGLE_RE.test(fragment)) continue;
    const words = fragment.split(/\s+/).filter(Boolean);
    if (words.length >= 4 && words.length <= 18) return sentenceCaseFragment(fragment);
  }

  return "the update changes what players should check next";
}

function storySourceName(story = {}, canonical = {}) {
  const source = canonical.primary_source || story.primary_source || story.source_name;
  if (source && typeof source === "object") return cleanText(source.name || source.label || source.url);
  return cleanText(source || story.source_card_label || story.thumbnail_source_label || "source");
}

function storyFirstLine(story = {}, canonical = {}) {
  return cleanText(
    canonical.first_spoken_line ||
      story.hook ||
      cleanText(story.full_script || story.tts_script).split(/(?<=[.!?])\s+/)[0] ||
      storyTitle(story, canonical),
  );
}

function storyDisclosure(affiliateManifest = {}) {
  const required = affiliateManifest.disclosure_required === true ||
    Boolean(affiliateManifest.primary_link);
  return {
    required,
    type: required ? "affiliate" : "none",
    caption: required ? "Affiliate links may earn us a commission." : "No commercial link attached.",
  };
}

function landingRouteFor(story = {}, canonical = {}, landingPage = {}) {
  const slug = cleanText(
    landingPage.landing_page_slug ||
      landingPage.slug ||
      story.landing_page_slug ||
      `${storySubject(story, canonical)} ${story.id || ""}`,
  );
  return `/p/${slugify(slug)}`;
}

function buildHashtags(story = {}, canonical = {}) {
  const subject = storySubject(story, canonical).toLowerCase();
  const tags = ["#GamingNews", "#PulseGaming"];
  if (/\bxbox|forza|game pass\b/i.test(subject)) tags.push("#Xbox");
  if (/\bplaystation|ps5\b/i.test(subject)) tags.push("#PlayStation");
  if (/\bnintendo|switch\b/i.test(subject)) tags.push("#Nintendo");
  if (/\bsteam|pc\b/i.test(subject)) tags.push("#PCGaming");
  return [...new Set(tags)];
}

function mergePlatformOutput(base = {}, additions = {}) {
  return {
    ...base,
    ...additions,
    duration_seconds: additions.duration_seconds || base.duration_seconds,
    strategic_duration_seconds: base.duration_seconds || additions.duration_seconds,
  };
}

function buildPlatformNativePublishPacks({
  story = {},
  canonical = {},
  platformOutputs = {},
  affiliateManifest = {},
  landingPage = {},
} = {}) {
  const subject = storySubject(story, canonical);
  const title = storyTitle(story, canonical);
  const firstLine = storyFirstLine(story, canonical);
  const angle = publicAngleFor({ story, canonical, subject, title, firstLine });
  const sourceName = storySourceName(story, canonical);
  const landingPageLink = landingRouteFor(story, canonical, landingPage);
  const disclosure = storyDisclosure(affiliateManifest);
  const headline = cleanText(canonical.thumbnail_headline || story.suggested_thumbnail_text || title)
    .split(/\s+/)
    .slice(0, 7)
    .join(" ");
  const hashtags = buildHashtags(story, canonical);
  const shortAngle = angle || "the latest story behind the headline";
  const sourceLine = `Source: ${sourceName}.`;
  const formatFamily = platformStoryFormatFamily({ subject, title, angle: shortAngle, affiliateManifest });
  const outputs = {
    youtube_shorts: mergePlatformOutput(platformOutputs.youtube_shorts, {
      platform: "youtube_shorts",
      native_role: "searchable_short",
      title,
      description: `${subject}: ${shortAngle}. ${sourceLine} Sources and related links: ${landingPageLink}`,
      hashtags,
      cover_frame: {
        headline,
        subject,
        source_label: sourceName,
      },
      captions: {
        file: "captions.srt",
        clean_manual_captions_required: true,
      },
      cta: `${PRIMARY_PULSE_CTA}.`,
      disclosure_status: disclosure,
      profile_or_landing_page_cta: `Story sources and related links: ${landingPageLink}`,
      link_strategy: "profile_link_or_related_video_for_shorts",
      cta_style: "identity_follow",
    }),
    tiktok: mergePlatformOutput(platformOutputs.tiktok, {
      platform: "tiktok",
      native_role: "conversation_first_short",
      conversational_hook: firstLine,
      caption: `${firstLine.replace(/[.!?]+$/g, "")}. ${sourceLine}`,
      hashtags: [...hashtags, "#GamingTok"],
      disclosure_flag: disclosure.required ? "commercial_content_disclosure_required" : "not_required",
      commercial_content_setting_recommendation: disclosure.required
        ? "required_for_affiliate_or_brand_promotion"
        : "not_required_unless_brand_or_product_promoted",
      product_link_eligibility: affiliateManifest.primary_link ? "review_required" : "not_used",
      link_strategy: "bio_or_product_link_when_enabled",
      cta_style: "source_context",
    }),
    instagram_reels: mergePlatformOutput(platformOutputs.instagram_reels, {
      platform: "instagram_reels",
      native_role: "cover_first_reel_plus_carousel",
      cover_frame: {
        headline,
        text_word_limit: 7,
        source_label: sourceName,
      },
      caption: `${subject}: ${shortAngle}. Full source list is on the story page.`,
      carousel_companion: {
        required: true,
        cards: ["cover", "source", "player impact", "related links"],
      },
      story_poll_idea: `Does ${subject} change your watchlist?`,
      bio_link_cta: `Story page in bio: ${landingPageLink}`,
      disclosure_status: disclosure,
      cta_style: "bio_link",
    }),
    facebook_reels: mergePlatformOutput(platformOutputs.facebook_reels, {
      platform: "facebook_reels",
      native_role: "context_first_reel",
      explanatory_framing: `${subject} matters because ${shortAngle}.`,
      page_caption: `${subject}: ${shortAngle}. ${sourceLine} More context: ${landingPageLink}`,
      link_routing_strategy: "page_caption_or_comment_link",
      disclosure_status: disclosure,
      cta_style: "context_link",
    }),
    x: mergePlatformOutput(platformOutputs.x, {
      platform: "x",
      native_role: "headline_source_post",
      hot_take_post: `${subject} is the part of this story everyone will argue about: ${shortAngle}.`,
      source_safe_post: `${title}\n\n${sourceLine} Full source list: ${landingPageLink}`,
      concise_news_post: `${subject}: ${shortAngle}.`,
      thread_posts: [
        title,
        `${sourceLine} The confirmed angle is ${shortAngle}.`,
        "The player impact is price, access, trust or timing.",
        `Sources and related links: ${landingPageLink}`,
      ],
      poll_candidate: `Is ${subject} a buy-now story or a wait-for-reviews story?`,
      landing_page_link: landingPageLink,
      cta_style: "source_first_link",
    }),
    threads: {
      platform: "threads",
      native_role: "soft_discussion_post",
      discussion_post: `${subject} is worth watching for the player impact, not just the headline. ${sourceLine}`,
      duplicate_x_wording_allowed: false,
      tone: "discussion-led and source-safe",
      landing_page_link: landingPageLink,
      disclosure_status: disclosure,
      cta_style: "soft_discussion",
    },
    pinterest: {
      platform: "pinterest",
      native_role: "evergreen_pin_only",
      pin_title: `${subject} story guide`,
      pin_description: `${subject}: ${shortAngle}. Sources, related links and safer buying routes are on the story page.`,
      evergreen_only: true,
      disclosure: disclosure.caption,
      affiliate_disclosure_required: disclosure.required,
      landing_page_required: true,
      landing_page_link: landingPageLink,
      cta_style: "evergreen_story_page",
    },
  };
  const platformNativeEvidence = buildPlatformNativeEvidence(outputs, { formatFamily });
  return { outputs, platformNativeEvidence };
}

function valueAtPath(object = {}, pathExpression = "") {
  return pathExpression.split(".").reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, object);
}

function hasEvidenceValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "boolean") return true;
  return cleanText(value).length > 0;
}

function copyFingerprintForPlatform(platform, pack = {}) {
  const copyFields = {
    youtube_shorts: ["title", "description", "profile_or_landing_page_cta"],
    tiktok: ["conversational_hook", "caption"],
    instagram_reels: ["caption", "story_poll_idea"],
    facebook_reels: ["page_caption", "explanatory_framing"],
    x: ["hot_take_post", "source_safe_post"],
    threads: ["discussion_post"],
    pinterest: ["pin_title", "pin_description"],
  };
  return asArray(copyFields[platform])
    .map((field) => cleanText(valueAtPath(pack, field)))
    .join(" ")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\/p\/[a-z0-9-]+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectBlindDuplicatePairs(outputs = {}) {
  const fingerprints = new Map();
  const duplicates = [];
  for (const platform of PLATFORM_NATIVE_ORDER) {
    const fingerprint = copyFingerprintForPlatform(platform, outputs[platform]);
    if (!fingerprint) continue;
    const previous = fingerprints.get(fingerprint);
    if (previous) {
      duplicates.push({
        platforms: [previous, platform],
        reason: "exact_public_copy_fingerprint_match",
      });
    } else {
      fingerprints.set(fingerprint, platform);
    }
  }
  return duplicates;
}

function platformStoryFormatFamily({ subject = "", title = "", angle = "", affiliateManifest = {} } = {}) {
  const text = cleanText([subject, title, angle].join(" ")).toLowerCase();
  if (/\b(?:controller|headset|keyboard|mouse|monitor|hardware|accessory|steam deck)\b/.test(text)) {
    if (/\b(?:deal|price|sale|discount|drops? to|bundle)\b/.test(text)) return "hardware_deal_watch";
    if (/\b(?:date|release|launch|leak|leaked|reportedly|may have)\b/.test(text)) return "hardware_release_watch";
    return "hardware_accessory_watch";
  }
  if (/\b(?:xcom|tactic|tactical|strategy comparison|more than)\b/.test(text)) {
    return "tactics_comparison";
  }
  if (/\b(?:ai[-\s]?look|handmade|hand made|crafted|art direction|production process)\b/.test(text)) {
    return "creative_process";
  }
  if (/\b(?:devs? are making|developer.*making|studio.*working|next game|new project)\b/.test(text)) {
    return "studio_project_watch";
  }
  if (/\b(?:eras?|timeline|generations?|five eras|history)\b/.test(text)) {
    return "timeline_showcase";
  }
  if (/\b(?:gameplay|hands[-\s]?on|preview|trailer|demo|shown|shows)\b/.test(text)) {
    return "gameplay_showcase";
  }
  if (/\b(?:leak|leaked|reportedly|rumou?r|claimed|may have)\b/.test(text)) {
    return /\b(?:date|release|launch)\b/.test(text) ? "release_date_watch" : "leak_watch";
  }
  if (/\b(?:drops? to|deal|discount|price|sale|bundle|subscription|game pass)\b/.test(text)) {
    return "game_price_watch";
  }
  if (/\b(?:metacritic|opencritic|review|score|rated)\b/.test(text)) return "review_score";
  if (/\b(?:playstation|ps5|xbox|switch|steam)\b/.test(text)) return "platform_access";
  if (/\b(?:jobs?|layoff|composer|studio|developer|publisher|business)\b/.test(text)) return "industry_business";
  if (affiliateManifest.primary_link || asArray(affiliateManifest.fallback_links).length) return "commercial_context";
  return "source_brief";
}

function buildPlatformFormatSignature(outputs = {}, { formatFamily = "source_brief" } = {}) {
  const instagramCards = asArray(outputs.instagram_reels?.carousel_companion?.cards).join(">");
  const xThreadCount = asArray(outputs.x?.thread_posts).length;
  const roles = PLATFORM_NATIVE_ORDER
    .map((platform) => `${platform}:${cleanText(outputs[platform]?.native_role)}`)
    .join("|");
  return normaliseSignatureText(`${formatFamily}|ig:${instagramCards}|x_thread:${xThreadCount}|${roles}`);
}

function buildPlatformNativeEvidence(outputs = {}, options = {}) {
  const platforms = PLATFORM_NATIVE_ORDER.map((platform) => {
    const pack = outputs[platform] || {};
    const requiredFields = PLATFORM_NATIVE_REQUIREMENTS[platform] || [];
    const missingFields = requiredFields.filter((field) => !hasEvidenceValue(valueAtPath(pack, field)));
    return {
      platform,
      status: missingFields.length ? "fail" : "pass",
      native_role: pack.native_role || null,
      duration_strategy: pack.duration_strategy || pack.pacing || null,
      cta_style: pack.cta_style || null,
      link_strategy: pack.link_strategy || pack.link_routing_strategy || null,
      required_fields: requiredFields,
      missing_fields: missingFields,
      copy_fingerprint: copyFingerprintForPlatform(platform, pack),
    };
  });
  const blindDuplicatePairs = detectBlindDuplicatePairs(outputs);
  const failures = [
    ...platforms
      .filter((item) => item.status !== "pass")
      .map((item) => ({
        platform: item.platform,
        reason: "missing_native_fields",
        missing_fields: item.missing_fields,
      })),
    ...blindDuplicatePairs.map((item) => ({
      platform: item.platforms.join("+"),
      reason: item.reason,
    })),
  ];
  return {
    schema_version: 1,
    verdict: failures.length ? "fail" : "pass",
    format_signature: buildPlatformFormatSignature(outputs, options),
    format_family: options.formatFamily || "source_brief",
    platforms,
    blind_duplicate_pairs: blindDuplicatePairs,
    failures,
    rule: "Each platform pack must carry its own role, copy shape, CTA and link strategy.",
  };
}

function buildLandingPageManifest({
  story = {},
  canonical = {},
  enterpriseLandingPage = {},
  affiliateManifest = {},
} = {}) {
  const route =
    affiliateManifest.landing_page_route ||
    enterpriseLandingPage.landing_page_route ||
    enterpriseLandingPage.route ||
    landingRouteFor(story, canonical, enterpriseLandingPage);
  const slug =
    affiliateManifest.landing_page_slug ||
    enterpriseLandingPage.landing_page_slug ||
    enterpriseLandingPage.slug ||
    route.replace(/^\/p\//, "");

  return {
    ...enterpriseLandingPage,
    schema_version: enterpriseLandingPage.schema_version || 1,
    story_id: story.id || affiliateManifest.story_id || null,
    landing_page_slug: slug,
    landing_page_route: route,
    link_pack: {
      primary_link: affiliateManifest.primary_link || null,
      fallback_links: asArray(affiliateManifest.fallback_links),
      source_links: asArray(affiliateManifest.source_links),
      affiliate_tracking_map: affiliateManifest.affiliate_tracking_map || null,
    },
    disclosure_block: {
      required: Boolean(affiliateManifest.disclosure_required),
      copy: affiliateManifest.disclosure_copy || null,
      source_first: true,
    },
    tracking_utm: affiliateManifest.tracking_utm || null,
    attribution_manifest: affiliateManifest.landing_page_attribution || null,
    revenue_tracking: affiliateManifest.revenue_attribution || null,
    safety: {
      ...(enterpriseLandingPage.safety || {}),
      story_page_before_offer: true,
      no_direct_social_posting: true,
    },
  };
}

async function writeLocalProofMp4(filePath, pack = {}) {
  await fs.ensureDir(path.dirname(filePath));
  const subject = compactRenderText(
    pack.canonical_story_manifest?.canonical_subject || pack.story_id,
    "PULSE GAMING",
  );
  const headline = compactRenderText(
    pack.canonical_story_manifest?.thumbnail_headline ||
      pack.canonical_story_manifest?.selected_title ||
      pack.story_id,
    "SOURCE-BACKED STORY",
  );
  const source = compactRenderText(
    pack.canonical_story_manifest?.primary_source?.name ||
      pack.source_manifest?.primary_source?.name ||
      "VERIFIED SOURCE",
    "VERIFIED SOURCE",
  );
  const fontOpt = "fontfile='C\\:/Windows/Fonts/arial.ttf'";
  const filter = [
    "scale=1080:1920",
    "format=yuv420p",
    "noise=alls=5:allf=t",
    "drawbox=x=0:y=0:w=iw:h=260:color=black@0.55:t=fill",
    "drawbox=x=60:y=690:w=960:h=250:color=0xFF6B1A@0.90:t=fill",
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(subject)}':fontcolor=0xFF6B1A:fontsize=52:x=64:y=72`,
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(source)}':fontcolor=white:fontsize=34:x=64:y=148`,
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(headline)}':fontcolor=black:fontsize=64:x=(w-tw)/2:y=770`,
    `drawtext=${fontOpt}:text='PULSE GAMING':fontcolor=white@0.72:fontsize=34:x=w-tw-58:y=h-112`,
  ].join(",");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x101114:size=1080x1920:rate=30:duration=2.4",
    "-vf",
    filter,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-movflags",
    "+faststart",
    filePath,
  ]);
  return filePath;
}

function buildAcceptanceEntry({
  story,
  scriptScorecard,
  footageInventory,
  directorBeatMap,
  benchmarkReport,
  governanceReport,
} = {}) {
  const blockers = [];
  if (governanceReport.publish_control_tower?.verdict !== "GREEN") {
    blockers.push(`governance:${governanceReport.publish_control_tower?.verdict || "unknown"}`);
  }
  if (scriptScorecard.verdict === "rewrite_required" || asArray(scriptScorecard.blockers).length) {
    blockers.push(`script:${scriptScorecard.verdict || "blocked"}`);
  }
  if (footageInventory.readiness?.status !== "v4_motion_ready") {
    blockers.push(`footage:${footageInventory.readiness?.status || "unknown"}`);
  }
  if (directorBeatMap.readiness?.status !== "director_ready") {
    blockers.push(`director:${directorBeatMap.readiness?.status || "unknown"}`);
  }
  if (!["pass"].includes(benchmarkReport.result)) {
    blockers.push(`benchmark:${benchmarkReport.result || "unknown"}`);
  }
  return {
    story_id: story.id || null,
    verdict: blockers.length ? "RED" : "GREEN",
    blockers,
    artefacts: ACCEPTANCE_ARTEFACTS,
  };
}

function buildGoalProofPackage({
  story = {},
  rightsLedger = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const scriptScorecard = buildViralScriptIntelligence({
    story,
    script: story.full_script || story.tts_script || "",
  });
  const footageInventory = buildFootageEmpirePlan({
    story,
    trustedFootageReport: buildTrustedFootageReport(story),
    localMotionClips: buildLocalMotionClips(story),
    generatedAt,
  });
  const directorBeatMap = buildVisualV4DirectorPlan({
    story,
    footagePlan: footageInventory,
    localTimeline: buildLocalTimeline(story),
    sfxAssetInventory: story.sfx_asset_inventory || story.sfx_assets || [],
    sfxRightsLedger: story.sfx_rights_ledger || rightsLedger,
    generatedAt,
  });
  const soundPlan = directorBeatMap.sound_transition_plan || {};
  const governanceReport = buildStudioGovernanceReport({
    story,
    rightsLedger,
    generatedAt,
  });
  const enterprisePack = buildStudioEnterpriseOSPack({
    generatedAt,
    stories: [story],
    governanceSummary: governanceReport.publish_manifest,
  });
  const benchmarkReport = directorBeatMap.media_house_benchmark || {};
  const platformOutputs = enterprisePack.multi_platform_format_engine.outputs || {};
  const affiliateManifest = story.affiliate_link_manifest || {};
  const landingPageManifest = buildLandingPageManifest({
    story,
    canonical: governanceReport.canonical_story_manifest,
    enterpriseLandingPage: enterprisePack.landing_page_link_hub || {},
    affiliateManifest,
  });
  const platformNativePacks = buildPlatformNativePublishPacks({
    story,
    canonical: governanceReport.canonical_story_manifest,
    platformOutputs,
    affiliateManifest,
    landingPage: landingPageManifest,
  });

  const pack = {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: story.id || null,
    script_scorecard: scriptScorecard,
    footage_inventory: footageInventory,
    director_beat_map: directorBeatMap,
    audio_manifest: buildAudioManifest({ story, soundPlan }),
    sfx_manifest: soundPlan.sfx || {},
    sfx_source_plan: soundPlan.sfx?.source_plan || {},
    visual_quality_report: buildVisualQualityReport({
      story,
      directorPlan: directorBeatMap,
      benchmark: benchmarkReport,
    }),
    forensic_qa_report: buildForensicQaReport({
      scriptScorecard,
      footageInventory,
      directorPlan: directorBeatMap,
      benchmark: benchmarkReport,
      governanceReport,
    }),
    benchmark_report: benchmarkReport,
    canonical_story_manifest: governanceReport.canonical_story_manifest,
    source_manifest: governanceReport.source_manifest,
    claim_inventory: governanceReport.claim_inventory,
    rights_ledger: governanceReport.rights_ledger,
    coherence_report: governanceReport.public_output_coherence_gate,
    platform_policy_report: governanceReport.platform_policy_engine,
    publish_verdict: governanceReport.publish_control_tower,
    render_manifest: {
      schema_version: 1,
      story_id: story.id || null,
      renderer: "visual_v4_local_proof",
      output: "visual_v4_render.mp4",
      visual_tier: "local_proof_motion_graphic",
      final_publish_render: false,
      director_beat_map: "director_beat_map.json",
      render_basis: "local proof render generated from governed story manifest",
      no_publish_triggered: true,
    },
    affiliate_link_manifest: affiliateManifest,
    landing_page_manifest: landingPageManifest,
    analytics_ingest_plan: {
      schema_version: 1,
      story_id: story.id || null,
      required_metrics: [
        "views",
        "average_view_duration",
        "first_3_second_drop_off",
        "stayed_to_watch",
        "swipe_away",
        "follows_or_subscribers_gained",
        "affiliate_clicks",
        "landing_page_visits",
      ],
      dry_run_only: true,
    },
    youtube_publish_pack: platformNativePacks.outputs.youtube_shorts,
    tiktok_publish_pack: platformNativePacks.outputs.tiktok,
    instagram_publish_pack: platformNativePacks.outputs.instagram_reels,
    facebook_publish_pack: platformNativePacks.outputs.facebook_reels,
    x_publish_pack: platformNativePacks.outputs.x,
    threads_publish_pack: platformNativePacks.outputs.threads,
    pinterest_publish_pack: platformNativePacks.outputs.pinterest,
    carousel_manifest: {
      platform: "instagram",
      story_id: story.id || null,
      cards: ["cover", "source", "impact", "related_links"],
    },
    image_card_manifest: {
      story_id: story.id || null,
      platforms: ["x", "instagram", "facebook"],
      headline: story.suggested_thumbnail_text || story.public_title || story.title || null,
    },
    thread_manifest: {
      platform: "x",
      story_id: story.id || null,
      posts: ["hot_take", "source_safe_post", "concise_news_post", "landing_page_post"],
    },
    finance_crypto_risk_report: governanceReport.finance_crypto_firewall,
    uniqueness_report: governanceReport.anti_spam_uniqueness_gate,
    retention_report: {
      schema_version: 1,
      story_id: story.id || null,
      recommendations: scriptScorecard.rewrite_recommendations || [],
      future_render_rules: [
        "keep canonical subject in first frame",
        "keep thumbnail text under mobile limits",
        "route motion deficits to Footage Empire before publish",
      ],
    },
    experiment_manifest: enterprisePack.experimentation_engine,
    platform_publish_manifest: {
      schema_version: 1,
      story_id: story.id || null,
      operating_mode: "LOCAL_PROOF",
      publish_status: governanceReport.publish_control_tower?.verdict || "RED",
      outputs: platformNativePacks.outputs,
      landing_page_attribution: landingPageManifest.attribution_manifest,
      platform_mirroring_detection:
        enterprisePack.multi_platform_format_engine.platform_mirroring_detection,
      platform_native_evidence: platformNativePacks.platformNativeEvidence,
      no_publish_triggered: true,
    },
    platform_variant_scorecard: {
      ...enterprisePack.multi_platform_format_engine,
      outputs: platformNativePacks.outputs,
      platform_native_evidence: platformNativePacks.platformNativeEvidence,
    },
    safety: {
      local_only: true,
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
      tokens_or_oauth_changed: false,
    },
  };
  pack.acceptance_entry = buildAcceptanceEntry({
    story,
    scriptScorecard,
    footageInventory,
    directorBeatMap,
    benchmarkReport,
    governanceReport,
  });
  return pack;
}

async function writeJson(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, value, { spaces: 2 });
  return filePath;
}

async function writeGoalProofPackageArtifacts(pack = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalProofPackageArtifacts requires outputDir");
  const outDir = path.resolve(outputDir);
  const mapping = {
    canonical_story_manifest: "canonical_story_manifest.json",
    source_manifest: "source_manifest.json",
    claim_inventory: "claim_inventory.json",
    script_scorecard: "script_scorecard.json",
    footage_inventory: "footage_inventory.json",
    rights_ledger: "rights_ledger.json",
    director_beat_map: "director_beat_map.json",
    render_manifest: "render_manifest.json",
    audio_manifest: "audio_manifest.json",
    sfx_manifest: "sfx_manifest.json",
    sfx_source_plan: "sfx_source_plan.json",
    visual_quality_report: "visual_quality_report.json",
    forensic_qa_report: "forensic_qa_report.json",
    benchmark_report: "benchmark_report.json",
    coherence_report: "coherence_report.json",
    platform_policy_report: "platform_policy_report.json",
    affiliate_link_manifest: "affiliate_link_manifest.json",
    landing_page_manifest: "landing_page_manifest.json",
    publish_verdict: "publish_verdict.json",
    analytics_ingest_plan: "analytics_ingest_plan.json",
    youtube_publish_pack: "youtube_publish_pack.json",
    tiktok_publish_pack: "tiktok_publish_pack.json",
    instagram_publish_pack: "instagram_publish_pack.json",
    facebook_publish_pack: "facebook_publish_pack.json",
    x_publish_pack: "x_publish_pack.json",
    threads_publish_pack: "threads_publish_pack.json",
    pinterest_publish_pack: "pinterest_publish_pack.json",
    carousel_manifest: "carousel_manifest.json",
    image_card_manifest: "image_card_manifest.json",
    thread_manifest: "thread_manifest.json",
    finance_crypto_risk_report: "finance_crypto_risk_report.json",
    uniqueness_report: "uniqueness_report.json",
    retention_report: "retention_report.json",
    experiment_manifest: "experiment_manifest.json",
    platform_publish_manifest: "platform_publish_manifest.json",
    platform_variant_scorecard: "platform_variant_scorecard.json",
    acceptance_entry: "goal_package_summary.json",
  };
  const written = {};
  for (const [key, basename] of Object.entries(mapping)) {
    written[key] = await writeJson(path.join(outDir, basename), pack[key] || {});
  }
  written.captions = await fs.writeFile(
    path.join(outDir, "captions.srt"),
    buildSimpleCaptionSrt(
      pack.canonical_story_manifest?.narration_script ||
        pack.canonical_story_manifest?.first_spoken_line ||
        "",
    ),
    "utf8",
  ).then(() => path.join(outDir, "captions.srt"));
  written.visual_v4_render = await writeLocalProofMp4(path.join(outDir, "visual_v4_render.mp4"), pack);
  return written;
}

module.exports = {
  ACCEPTANCE_ARTEFACTS,
  buildPlatformNativePublishPacks,
  buildGoalProofPackage,
  writeGoalProofPackageArtifacts,
};
