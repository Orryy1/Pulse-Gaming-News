"use strict";

const { URL } = require("node:url");
const { evaluatePulseGamingTopicality } = require("./topicality-gate");
const { classifyTextHygiene, normaliseText } = require("./text-hygiene");
const { scoreStoryMediaInventory } = require("./creative/media-inventory-scorer");
const { confidenceFromFlair } = require("./creative/format-catalogue");
const { buildExactSubjectReadiness } = require("./exact-subject-matching");
const { buildControlledFrameExtractionPlan } = require("./controlled-frame-extraction-plan");
const { buildFormatLanePolicy } = require("./format-lane-policy");
const {
  buildFlashLaneProductionContract,
} = require("./studio/v2/flash-lane-production-contract");
const {
  mediaSourceUrlKindFields,
} = require("./media-source-url-kind");

const ENTITY_PATTERNS = [
  ["GTA", /\b(?:gta|grand theft auto)\b/i],
  ["Grand Theft Auto", /\bgrand theft auto\b/i],
  ["Red Dead", /\bred dead\b/i],
  ["BioShock", /\bbioshock\b/i],
  ["Xbox", /\bxbox\b/i],
  ["PlayStation", /\bplaystation|ps5|ps4\b/i],
  ["Nintendo", /\bnintendo\b/i],
  ["Switch", /\bswitch\b/i],
  ["MindsEye", /\bmindseye\b/i],
  ["Pok\u00e9mon", /\b(?:pokemon|pok\u00e9mon)\b/i],
  ["Zelda", /\bzelda\b/i],
  ["Steam", /\bsteam\b/i],
  ["Take-Two", /\btake[- ]two\b/i],
  ["Rockstar", /\brockstar\b/i],
  ["Niantic", /\bniantic\b/i],
  ["Metro", /\bmetro\b/i],
];

const PLATFORM_PATTERNS = [
  ["Xbox", /\bxbox\b/i],
  ["PlayStation", /\bplaystation|ps5|ps4\b/i],
  ["Nintendo Switch", /\bswitch\b/i],
  ["PC", /\bpc\b/i],
  ["Steam", /\bsteam\b/i],
  ["Game Pass", /\bgame pass\b/i],
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function storyText(story) {
  return [
    story?.title,
    story?.hook,
    story?.body,
    story?.loop,
    story?.full_script,
    story?.description,
    story?.top_comment,
    story?.subreddit,
    story?.flair,
  ]
    .filter(Boolean)
    .map((part) => normaliseText(part))
    .join(" ");
}

function lowerStoryText(story) {
  return storyText(story).toLowerCase();
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sourceUrl(story) {
  return story?.source_url || story?.url || story?.link || null;
}

function publisherName(story) {
  return (
    story?.publisher ||
    story?.source_name ||
    story?.source ||
    story?.subreddit ||
    hostFromUrl(sourceUrl(story)) ||
    "unknown"
  );
}

function extractEntities(story) {
  const text = storyText(story);
  const out = [];
  for (const [name, re] of ENTITY_PATTERNS) {
    if (re.test(text) && !out.includes(name)) out.push(name);
  }
  return out;
}

function extractPlatforms(story) {
  const text = storyText(story);
  return PLATFORM_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function classifyStoryType(story, topicality) {
  const text = lowerStoryText(story);
  if (topicality?.category === "off_topic_entertainment") {
    return "off_brand_entertainment";
  }
  if (topicality?.category === "gaming_adaptation") {
    return "game_adaptation";
  }
  if (/\brumou?r\b|\bleak\b|reportedly|sources? (?:say|claim|suggest)/i.test(text)) {
    return "rumour";
  }
  if (/release date|launch(?:es|ing)? on|coming (?:on|in)|delayed to/i.test(text)) {
    return "release_date";
  }
  if (/price|pricing|discount|sale|pre[- ]?order|game pass price|subscription/i.test(text)) {
    return "pricing";
  }
  if (/policy|store rule|refund|subscription|game pass|ps plus|platform/i.test(text)) {
    return "platform_policy";
  }
  if (/\btrailer\b|gameplay reveal|deep dive|showcase trailer/i.test(text)) {
    return "trailer";
  }
  if (/million (?:copies|players|sales)|sold|sales milestone/i.test(text)) {
    return "sales_milestone";
  }
  if (/\bpatch\b|\bupdate\b|nerf|buff|hotfix|season update/i.test(text)) {
    return "patch_update";
  }
  if (/publisher|developer|studio|earnings|acquisition|take[- ]two|rockstar/i.test(text)) {
    return "publisher_business";
  }
  if (/breaking|confirmed|official/i.test(text) || Number(story?.breaking_score || 0) >= 70) {
    return "breaking_news";
  }
  return "unknown";
}

function confidenceLabel(story) {
  return story?.flair_confidence || confidenceFromFlair(story?.flair || story?.classification);
}

function urgencyLabel(story, storyType) {
  const score = Number(story?.breaking_score || story?.score || 0);
  if (score >= 80 || storyType === "breaking_news") return "high";
  if (score >= 50 || ["release_date", "trailer", "platform_policy"].includes(storyType)) {
    return "medium";
  }
  return "low";
}

function evergreenLabel(storyType) {
  if (["before_you_download", "release_date", "pricing", "platform_policy"].includes(storyType)) {
    return "medium";
  }
  if (["trailer", "patch_update", "breaking_news"].includes(storyType)) return "low";
  return "limited";
}

function buildStoryDossier(story) {
  const topicality = evaluatePulseGamingTopicality(story);
  const storyType = classifyStoryType(story, topicality);
  const entities = extractEntities(story);
  const manualReviewFlags = [];
  if (topicality.decision === "review") manualReviewFlags.push(topicality.reason);
  if (topicality.decision === "reject") manualReviewFlags.push(topicality.reason);
  if (confidenceLabel(story) === "unknown") manualReviewFlags.push("source_confidence_unknown");

  return {
    story_id: story?.id || null,
    title: normaliseText(story?.title || ""),
    source_type: story?.source_type || "unknown",
    source_url: sourceUrl(story),
    publisher: publisherName(story),
    topicality_verdict: topicality.decision,
    topicality_reason: topicality.reason,
    story_type: storyType,
    entities,
    franchise_entity: entities[0] || null,
    gaming_relevance_reason:
      topicality.decision === "accept"
        ? `Matched gaming signals: ${topicality.matchedGamingSignals.join(", ") || "gaming"}`
        : topicality.reason,
    off_brand_risk: topicality.decision === "reject" ? "high" : "low",
    rumour_confirmed_status: confidenceLabel(story),
    urgency: urgencyLabel(story, storyType),
    evergreen_value: evergreenLabel(storyType),
    suggested_format: null,
    manual_review_flags: manualReviewFlags,
  };
}

function quotedFacts(story) {
  const facts = [];
  if (story?.title) facts.push(normaliseText(story.title));
  if (story?.flair) facts.push(`Source label: ${story.flair}`);
  const platforms = extractPlatforms(story);
  if (platforms.length) facts.push(`Mentioned platforms: ${platforms.join(", ")}`);
  return facts;
}

function buildSourcePack(story, dossier) {
  const source = sourceUrl(story);
  const sourceConfidence = confidenceLabel(story);
  const textHygiene = classifyTextHygiene(
    [story?.title, story?.hook, story?.body, story?.loop, story?.full_script]
      .filter(Boolean)
      .join(" "),
  );
  const platforms = extractPlatforms(story);
  const warnings = [];
  if (!source) warnings.push("missing_source_url");
  if (dossier.story_type === "release_date" && !/(official|confirmed)/i.test(storyText(story))) {
    warnings.push("release_date_needs_official_source");
  }
  if (platforms.length > 0 && !source) warnings.push("platform_claim_without_source_url");
  if (sourceConfidence === "rumour") warnings.push("rumour_requires_clear_labelling");
  if (textHygiene.severity === "fail") warnings.push("public_text_hygiene_fail");

  return {
    source_url: source,
    publisher: publisherName(story),
    confidence_level: sourceConfidence,
    source_confidence: sourceConfidence,
    date: story?.timestamp || story?.created_at || story?.published_at || null,
    date_confidence: story?.timestamp || story?.published_at ? "dated" : "unknown",
    platforms,
    platform_confidence: platforms.length > 0 ? "detected_from_story_text" : "not_applicable",
    release_date: story?.release_date || null,
    release_date_confidence:
      dossier.story_type === "release_date"
        ? story?.release_date
          ? "provided"
          : "needs_source"
        : "not_applicable",
    developer_publisher: story?.company_name || story?.developer || story?.publisher || null,
    official_source: /official|xbox\.com|playstation\.com|nintendo\.com|rockstargames\.com/i.test(
      source || "",
    ),
    rumour_confirmed_status: sourceConfidence,
    quoted_facts: quotedFacts(story),
    verified_facts: sourceConfidence === "rumour" ? [] : quotedFacts(story),
    unverified_claims:
      sourceConfidence === "rumour" || sourceConfidence === "likely"
        ? [story?.title || "claim needs confirmation"].filter(Boolean)
        : [],
    uncertainty_notes:
      sourceConfidence === "rumour"
        ? ["Treat as rumour unless an official source confirms it."]
        : [],
    manual_fact_check_requirements: warnings,
    unsupported_claim_warnings: warnings,
    text_hygiene: {
      severity: textHygiene.severity,
      issues: textHygiene.issues,
      normalised: textHygiene.normalised,
    },
  };
}

function mediaVerdictFromClass(cls) {
  return {
    premium_video: "premium_ready",
    standard_video: "standard_ready",
    short_only: "short_only",
    briefing_item: "card_only",
    blog_only: "blog_only",
    reject_visuals: "reject_visuals",
  }[cls] || "reject_visuals";
}

function safetyVerdict(score, unknownFaces) {
  if (unknownFaces > 0) return "review";
  if (score >= 60) return "safe";
  if (score >= 40) return "review";
  return "unsafe";
}

function buildMediaInventory(story) {
  const scored = scoreStoryMediaInventory(story);
  const exactSubject = buildExactSubjectReadiness(story);
  const c = scored.counts;
  const verdict = mediaVerdictFromClass(scored.classification);
  return {
    story_id: story?.id || null,
    official_trailer_clip_count: c.official_trailer_clips,
    gameplay_clip_count: c.gameplay_clips,
    trailer_frame_count: c.trailer_extracted_frames,
    steam_image_count: c.store_assets,
    igdb_image_count: Number(story?.igdb_image_count || 0),
    publisher_image_count: c.publisher_official_images,
    article_image_count: c.article_images,
    generic_stock_image_count: c.generic_stock,
    unknown_face_person_risk_count: c.unknown_human_portrait_risk,
    repeated_visual_risk: c.repeated_source_risk > 0,
    repeated_visual_risk_count: c.repeated_source_risk,
    thumbnail_safety_verdict: safetyVerdict(
      scored.scores.thumbnailSafety,
      c.unknown_human_portrait_risk,
    ),
    first_frame_safety_verdict: safetyVerdict(
      scored.scores.thumbnailSafety,
      c.unknown_human_portrait_risk,
    ),
    clip_still_card_ratio: scored.ratios,
    visual_strength_score: scored.scores.visualStrength,
    premium_suitability_score: scored.scores.premiumSuitability,
    exact_subject_asset_count: exactSubject.exact_subject_asset_count,
    generic_context_asset_count: exactSubject.generic_context_asset_count,
    premium_countable_asset_count: exactSubject.premium_countable_asset_count,
    standard_countable_asset_count: exactSubject.standard_countable_asset_count,
    unique_exact_subject_groups: exactSubject.unique_exact_subject_groups,
    exact_subject_groups: exactSubject.exact_subject_groups,
    required_subject_groups: exactSubject.required_subject_groups,
    missing_exact_subject_groups: exactSubject.missing_exact_subject_groups,
    repeated_asset_pairs: exactSubject.repeated_asset_pairs,
    studio_v2_60s_eligibility: exactSubject.studio_v2_60s_eligible,
    studio_v2_premium_candidate: exactSubject.studio_v2_premium_candidate,
    recommended_runtime_class: exactSubject.recommended_runtime_class,
    recommended_runtime_seconds: exactSubject.recommended_runtime_seconds,
    recommended_format_after_exact_subject_gate: exactSubject.recommended_format,
    scene_beat_capacity: exactSubject.scene_beat_capacity,
    rejection_or_downgrade_reasons: exactSubject.downgrade_reasons,
    exact_subject_readiness: exactSubject,
    verdict,
    source_classification: scored.classification,
    reasons: scored.classificationReasons,
    raw_inventory: scored,
  };
}

function buildFormatRoute({ dossier, sourcePack, mediaInventory }) {
  const reasons = [];
  if (dossier.topicality_verdict === "reject") {
    return { verdict: "reject", reasons: ["topicality_reject"] };
  }
  if (mediaInventory.verdict === "reject_visuals") {
    return { verdict: "reject", reasons: ["media_reject_visuals"] };
  }
  if (mediaInventory.verdict === "blog_only") {
    return { verdict: "blog_only", reasons: ["no_video_media_inventory"] };
  }
  if (dossier.topicality_verdict === "review") {
    return {
      verdict: "blog_only",
      reasons: ["manual_review_required_before_video"],
    };
  }
  if (mediaInventory.verdict === "card_only") {
    return {
      verdict: "daily_briefing_item",
      reasons: ["thin_visuals_better_as_briefing_item"],
    };
  }
  if (dossier.story_type === "release_date" && sourcePack.confidence_level === "confirmed") {
    return {
      verdict: "monthly_release_radar_item",
      reasons: ["confirmed_release_date_story"],
    };
  }
  if (dossier.story_type === "trailer" && mediaInventory.verdict === "premium_ready") {
    return {
      verdict: "trailer_breakdown_candidate",
      reasons: ["trailer_story_with_premium_media"],
    };
  }
  if (mediaInventory.verdict === "premium_ready") {
    reasons.push("premium_media_inventory");
    return { verdict: "premium_short", reasons };
  }
  if (mediaInventory.verdict === "standard_ready" || mediaInventory.verdict === "short_only") {
    reasons.push(`media=${mediaInventory.verdict}`);
    return { verdict: "standard_short", reasons };
  }
  return { verdict: "blog_only", reasons: ["default_safe_route"] };
}

function selectAsset(story, kinds) {
  const images = Array.isArray(story?.downloaded_images) ? story.downloaded_images : [];
  const clips = Array.isArray(story?.video_clips) ? story.video_clips : [];
  const all = [...clips, ...images];
  return (
    all.find((asset) => kinds.some((kind) => String(asset?.type || "").toLowerCase().includes(kind))) ||
    all[0] ||
    null
  );
}

function scriptBeatText(story, key) {
  if (story?.[key]) return normaliseText(story[key]);
  const script = normaliseText(story?.full_script || "");
  if (!script) return "";
  const parts = script.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (key === "hook") return parts[0] || "";
  if (key === "loop") return parts[parts.length - 1] || "";
  return parts.slice(1, -1).join(" ") || script;
}

function buildShotList({ story, dossier, mediaInventory, formatRoute }) {
  if (["reject", "blog_only"].includes(formatRoute.verdict)) {
    return { shots: [], visual_script: "No video shot list. Route is " + formatRoute.verdict + "." };
  }

  const entities = dossier.entities.length ? dossier.entities : ["the story"];
  const trailerAsset = selectAsset(story, ["trailer", "gameplay"]);
  const keyArt = selectAsset(story, ["steam", "hero", "capsule", "screenshot"]);
  const shots = [
    {
      timestamp_estimate: "0.0s",
      script_beat: scriptBeatText(story, "hook"),
      visual_type: "hook_card",
      visual_target: entities[0],
      source_asset: null,
      card_type: "hook",
      reason: "Open with a clear editorial angle.",
      risk: "low",
    },
  ];

  if (trailerAsset) {
    shots.push({
      timestamp_estimate: "4.0s",
      script_beat: "Proof/context",
      visual_type: "official_trailer_clip",
      visual_target: entities[0],
      source_asset: trailerAsset.path || trailerAsset.url || null,
      card_type: null,
      reason: "Use motion early to support retention.",
      risk: "check rights/provenance",
    });
  }

  entities.slice(0, 4).forEach((entity, index) => {
    shots.push({
      timestamp_estimate: `${8 + index * 7}.0s`,
      script_beat: `Line mentions ${entity}`,
      visual_type: index % 2 === 0 ? "franchise_key_art" : "context_card",
      visual_target: entity,
      source_asset: keyArt?.path || keyArt?.url || null,
      card_type: index % 2 === 0 ? null : "context",
      reason: `Script/entity alignment for ${entity}.`,
      risk: mediaInventory.repeated_visual_risk ? "repeat-risk" : "low",
    });
  });

  shots.push({
    timestamp_estimate: "52.0s",
    script_beat: scriptBeatText(story, "loop"),
    visual_type: "takeaway_card",
    visual_target: entities[0],
    source_asset: null,
    card_type: "takeaway",
    reason: "Summarise why the story matters before the outro.",
    risk: "low",
  });
  shots.push({
    timestamp_estimate: "60.0s",
    script_beat: "Follow Pulse Gaming so you never miss a beat.",
    visual_type: "outro",
    visual_target: "Pulse Gaming",
    source_asset: null,
    card_type: "outro",
    reason: "Branded close and CTA.",
    risk: "must be present in final render",
  });

  return {
    shots,
    visual_script: shots
      .map((shot, i) => `Shot ${i + 1}: ${shot.visual_type} -> ${shot.visual_target}`)
      .join("\n"),
  };
}

function targetDurationForFormat(formatVerdict) {
  if (["premium_short", "standard_short"].includes(formatVerdict)) return 64;
  if (formatVerdict === "trailer_breakdown_candidate") return 360;
  if (formatVerdict === "before_you_download_candidate") return 360;
  if (formatVerdict === "daily_briefing_item") return 0;
  return null;
}

function buildRenderContract({ story, formatRoute, mediaInventory, shotList }) {
  const format = formatRoute.verdict;
  const targetDuration = targetDurationForFormat(format);
  const visualCount =
    mediaInventory.official_trailer_clip_count +
    mediaInventory.gameplay_clip_count +
    mediaInventory.trailer_frame_count +
    mediaInventory.steam_image_count +
    mediaInventory.igdb_image_count +
    mediaInventory.publisher_image_count +
    mediaInventory.article_image_count;

  let renderLane = "unknown";
  let qualityClass = "unknown";
  if (format === "reject") {
    renderLane = "reject";
    qualityClass = "reject";
  } else if (format === "blog_only" || format === "daily_briefing_item") {
    renderLane = "card_only";
    qualityClass = "fallback";
  } else if (format === "premium_short") {
    renderLane = "studio_v2_candidate";
    qualityClass = "premium";
  } else if (format === "standard_short") {
    renderLane = visualCount >= 3 ? "legacy_multi_image" : "legacy_single_image_fallback";
    qualityClass = visualCount >= 3 ? "standard" : "fallback";
  } else if (format.endsWith("_candidate")) {
    renderLane = "longform";
    qualityClass = mediaInventory.verdict === "premium_ready" ? "premium" : "standard";
  }

  return {
    render_lane: renderLane,
    render_quality_class: qualityClass,
    target_duration_seconds: targetDuration,
    tiktok_60_second_eligibility: typeof targetDuration === "number" ? targetDuration >= 60 : false,
    visual_count: visualCount,
    real_image_count:
      mediaInventory.steam_image_count +
      mediaInventory.igdb_image_count +
      mediaInventory.publisher_image_count +
      mediaInventory.article_image_count,
    clip_count: mediaInventory.official_trailer_clip_count + mediaInventory.gameplay_clip_count,
    still_count:
      mediaInventory.trailer_frame_count +
      mediaInventory.steam_image_count +
      mediaInventory.igdb_image_count +
      mediaInventory.article_image_count,
    card_count: shotList.shots.filter((shot) => shot.card_type).length,
    outro_expected: !["reject", "blog_only"].includes(format),
    outro_present:
      typeof story?.outro_present === "boolean" ? story.outro_present : story?.exported_path ? null : null,
    thumbnail_candidate_required: !["reject", "blog_only"].includes(format),
    thumbnail_candidate_present: Boolean(story?.thumbnail_candidate_path),
    subtitle_required: !["reject", "blog_only"].includes(format),
    audio_path: story?.audio_path || null,
    audio_status: story?.audio_path ? "present" : "not_generated_yet",
    fallback_allowed: qualityClass === "fallback",
    fallback_reason: qualityClass === "fallback" ? "media_inventory_or_format_route" : null,
    minimum_publish_standard: qualityClass === "premium" ? "premium" : "standard",
  };
}

function buildThumbnailSafety({ story, mediaInventory }) {
  const text = story?.suggested_thumbnail_text || story?.title || "";
  const gameArtPresent =
    mediaInventory.steam_image_count +
      mediaInventory.igdb_image_count +
      mediaInventory.trailer_frame_count >
    0;
  const unknownFaceRisk = mediaInventory.unknown_face_person_risk_count > 0;
  return {
    thumbnail_candidate_present: Boolean(story?.thumbnail_candidate_path),
    thumbnail_safe: mediaInventory.thumbnail_safety_verdict !== "unsafe",
    first_frame_safe: mediaInventory.first_frame_safety_verdict !== "unsafe",
    unknown_face_risk: unknownFaceRisk,
    author_headshot_risk: false,
    random_person_risk: unknownFaceRisk,
    text_readability: String(text).length <= 72 ? "pass" : "review",
    game_art_present: gameArtPresent,
    brand_present: story?.brand_present === true || Boolean(story?.outro_present),
    safe_fallback_present: gameArtPresent && !unknownFaceRisk,
  };
}

function buildCommentOverlayHonesty(story) {
  const hasText = Boolean(String(story?.top_comment || story?.description || "").trim());
  if (story?.source_type === "reddit" && String(story?.top_comment || "").trim()) {
    return {
      real_reddit_comments_available: true,
      comment_source_type: "real_reddit_comments",
      comment_overlay_allowed: true,
      reason: "Reddit source with top_comment present.",
    };
  }
  if (story?.source_type === "rss" && hasText) {
    return {
      real_reddit_comments_available: false,
      comment_source_type: "rss_description_only",
      comment_overlay_allowed: false,
      reason: "RSS descriptions must not be shown as Reddit comments.",
    };
  }
  if (story?.synthetic_comment) {
    return {
      real_reddit_comments_available: false,
      comment_source_type: "synthetic_fallback_text",
      comment_overlay_allowed: false,
      reason: "Synthetic text cannot use Reddit styling.",
    };
  }
  return {
    real_reddit_comments_available: false,
    comment_source_type: "no_comments",
    comment_overlay_allowed: false,
    reason: "No real comment source available.",
  };
}

function optionReferencePlans(opts = {}) {
  if (Array.isArray(opts.officialTrailerReferencePlans)) return opts.officialTrailerReferencePlans;
  if (Array.isArray(opts.officialTrailerReferenceReport?.plans)) {
    return opts.officialTrailerReferenceReport.plans;
  }
  return [];
}

function referencesForStory(story, opts = {}) {
  const storyId = story?.id;
  return optionReferencePlans(opts)
    .filter((plan) => plan?.story_id === storyId || plan?.storyId === storyId)
    .flatMap((plan) => (Array.isArray(plan?.references) ? plan.references : []))
    .filter((reference) => reference?.downloads_allowed !== true)
    .map((reference) => {
      const urlKind = mediaSourceUrlKindFields(reference.source_url || reference.local_path || "");
      return {
        provider: reference.provider || reference.source || null,
        source_type: reference.source_type || "unknown",
        source_url: reference.source_url || null,
        local_path: reference.local_path || null,
        source_url_kind: reference.source_url_kind || urlKind.source_url_kind,
        segment_validation_eligible:
          reference.segment_validation_eligible === false
            ? false
            : urlKind.segment_validation_eligible,
        segment_validation_ineligible_reason:
          reference.segment_validation_ineligible_reason ||
          urlKind.segment_validation_ineligible_reason,
        entity: reference.entity || null,
        movie_name: reference.movie_name || reference.name || null,
        rights_risk_class: reference.rights_risk_class || null,
        allowed_render_use: reference.allowed_render_use || null,
        downloads_allowed: false,
      };
    });
}

function storyMotionReferences(story, opts = {}) {
  const optionRefs = referencesForStory(story, opts);
  const localRefs = asArray(story?.video_clips)
    .filter((clip) => /official_trailer|trailer|gameplay/i.test(String(clip?.type || clip?.source_type || "")))
    .map((clip) => {
      const sourceUrl = clip.url || clip.source_url || null;
      const localPath = clip.path || clip.local_path || null;
      const urlKind = mediaSourceUrlKindFields(sourceUrl || localPath || "");
      return {
        provider: clip.source || clip.provider || null,
        source_type: clip.type || clip.source_type || "official_trailer",
        source_url: sourceUrl,
        local_path: localPath,
        source_url_kind: clip.source_url_kind || urlKind.source_url_kind,
        segment_validation_eligible:
          clip.segment_validation_eligible === false
            ? false
            : urlKind.segment_validation_eligible,
        segment_validation_ineligible_reason:
          clip.segment_validation_ineligible_reason || urlKind.segment_validation_ineligible_reason,
        entity: clip.entity || null,
        movie_name: clip.title || clip.name || null,
        rights_risk_class: clip.rights_risk_class || null,
        allowed_render_use: clip.allowed_render_use || "local_reference",
        downloads_allowed: false,
      };
    });
  return [...optionRefs, ...localRefs];
}

function buildCreatorMotionSummary(story, dossier, opts = {}) {
  const references = storyMotionReferences(story, opts);
  const totalClips = asArray(story?.video_clips).length;
  const trailerFrames = asArray(story?.downloaded_images).filter((image) =>
    /trailer_frame|frame/i.test(String(image?.type || image?.source_type || "")),
  ).length;
  let readiness = "official_reference_search_required";
  if (dossier.topicality_verdict === "reject") {
    readiness = "reject";
  } else if (totalClips >= 3 && trailerFrames >= 3) {
    readiness = "local_motion_proof_ready";
  } else if (references.length > 0) {
    readiness = "reference_ready_for_local_frame_plan";
  }
  return {
    schema_version: 1,
    execution_mode: "report_only",
    will_download: false,
    will_extract_frames: false,
    motion_readiness: readiness,
    studio_v2_motion_candidate: readiness === "local_motion_proof_ready",
    existing_references: references,
    counts: {
      total_clips: totalClips,
      trailer_extracted_frames: trailerFrames,
      official_references: references.length,
    },
    safety: {
      local_only: true,
      report_only: true,
      video_downloads: false,
      frame_extraction: false,
      clip_slicing: false,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
    },
  };
}

function buildPlatformRoutePlan(renderContract) {
  return {
    youtube: {
      route_active: true,
      primary: true,
      upload_allowed: renderContract.render_lane !== "reject",
      thumbnail_required: true,
      upload_verified: "unknown_until_publish",
    },
    instagram: {
      reel_route_status: "active",
      story_fallback_status: "active",
      pending_verifier_needed: true,
    },
    facebook: {
      reel_route_status: "page_gated",
      card_fallback_status: "active",
    },
    tiktok: {
      official_api_status: "blocked",
      dispatch_pack_required: true,
      sixty_second_eligibility: renderContract.tiktok_60_second_eligibility,
      creator_rewards_minimum_seconds: 60,
    },
    x: {
      route_status: "disabled",
      reason: "disabled_unless_explicitly_enabled",
    },
  };
}

function buildPublishReadiness({
  dossier,
  sourcePack,
  mediaInventory,
  renderContract,
  thumbnailSafety,
}) {
  const red = [];
  const amber = [];

  if (dossier.topicality_verdict === "reject") red.push("off_brand_or_non_gaming");
  if (mediaInventory.verdict === "reject_visuals") red.push("reject_visuals");
  if (renderContract.render_lane === "reject") red.push("render_contract_reject");
  if (sourcePack.text_hygiene.severity === "fail") red.push("raw_text_hygiene_fails");
  if (!thumbnailSafety.thumbnail_safe && !thumbnailSafety.safe_fallback_present) {
    red.push("no_safe_thumbnail_or_first_frame");
  }

  if (dossier.topicality_verdict === "review") amber.push("topicality_review");
  if (["blog_only", "card_only"].includes(mediaInventory.verdict)) {
    amber.push(`media_inventory_${mediaInventory.verdict}`);
  }
  if (mediaInventory.verdict === "short_only") amber.push("media_is_short_only");
  if (sourcePack.unsupported_claim_warnings.length > 0) amber.push("fact_check_warnings");
  if (sourcePack.text_hygiene.severity === "warn") amber.push("text_hygiene_warn");
  if (["unknown", "card_only", "legacy_single_image_fallback"].includes(renderContract.render_lane)) {
    amber.push(`render_lane_${renderContract.render_lane}`);
  }
  if (renderContract.outro_expected && renderContract.outro_present === false) {
    amber.push("outro_missing");
  }
  if (renderContract.thumbnail_candidate_required && !thumbnailSafety.thumbnail_candidate_present) {
    amber.push("thumbnail_candidate_not_generated_yet");
  }

  if (red.length > 0) {
    return { verdict: "reject", colour: "RED", blockers: red, warnings: amber };
  }
  if (amber.length > 0) {
    return { verdict: "review", colour: "AMBER", blockers: [], warnings: amber };
  }
  return { verdict: "publish", colour: "GREEN", blockers: [], warnings: [] };
}

function buildLearningHook({ story, dossier, mediaInventory, formatRoute, renderContract }) {
  const title = story?.title || "";
  return {
    story_type: dossier.story_type,
    format_type: formatRoute.verdict,
    render_lane: renderContract.render_lane,
    visual_inventory_class: mediaInventory.verdict,
    title_pattern: title.includes(":") ? "colon_context" : title.includes("?") ? "question" : "statement",
    hook_type: /just|finally|breaking/i.test(story?.hook || title) ? "urgency" : "context",
    franchise: dossier.franchise_entity,
    source_type: story?.source_type || "unknown",
    clip_ratio: mediaInventory.clip_still_card_ratio.clipRatio,
    card_ratio: mediaInventory.clip_still_card_ratio.cardRatio,
    expected_retention_risk:
      mediaInventory.verdict === "premium_ready"
        ? "low"
        : mediaInventory.verdict === "card_only"
          ? "high"
          : "medium",
    experiment_tag: `creator_os_v1:${formatRoute.verdict}:${mediaInventory.verdict}`,
  };
}

function buildProductionPacket(story, opts = {}) {
  const story_dossier = buildStoryDossier(story, opts);
  const fact_check_report = buildSourcePack(story, story_dossier);
  const media_inventory = buildMediaInventory(story);
  const format_route = buildFormatRoute({
    dossier: story_dossier,
    sourcePack: fact_check_report,
    mediaInventory: media_inventory,
  });
  story_dossier.suggested_format = format_route.verdict;
  const shot_list = buildShotList({
    story,
    dossier: story_dossier,
    mediaInventory: media_inventory,
    formatRoute: format_route,
  });
  const render_contract = buildRenderContract({
    story,
    formatRoute: format_route,
    mediaInventory: media_inventory,
    shotList: shot_list,
  });
  const thumbnail_safety = buildThumbnailSafety({ story, mediaInventory: media_inventory });
  const comment_overlay = buildCommentOverlayHonesty(story);
  const motion_acquisition = buildCreatorMotionSummary(story, story_dossier, opts);
  const controlled_frame_plan = buildControlledFrameExtractionPlan(motion_acquisition);
  const platform_route_plan = buildPlatformRoutePlan(render_contract);
  const format_lane_policy = buildFormatLanePolicy({
    story,
    formatRoute: format_route,
    sourcePack: fact_check_report,
    mediaInventory: media_inventory,
    renderContract: render_contract,
  });
  const flash_lane_contract =
    format_lane_policy?.lane_id === "pulse_flash_short"
      ? buildFlashLaneProductionContract({
          story,
          narrationDurationS: opts.narrationDurationS,
          env: opts.env || process.env,
        })
      : null;
  const publish_readiness = buildPublishReadiness({
    dossier: story_dossier,
    sourcePack: fact_check_report,
    mediaInventory: media_inventory,
    renderContract: render_contract,
    thumbnailSafety: thumbnail_safety,
  });
  const learning_hook = buildLearningHook({
    story,
    dossier: story_dossier,
    mediaInventory: media_inventory,
    formatRoute: format_route,
    renderContract: render_contract,
  });

  return {
    schema_version: 1,
    generated_at: opts.now || new Date().toISOString(),
    story_id: story?.id || null,
    story_dossier,
    source_pack: fact_check_report,
    fact_check_report,
    media_inventory,
    format_route,
    shot_list,
    render_manifest: render_contract,
    render_contract,
    thumbnail_safety,
    comment_overlay,
    motion_acquisition,
    controlled_frame_plan,
    format_lane_policy,
    flash_lane_contract,
    platform_route_plan,
    publish_readiness,
    learning_hook,
  };
}

function buildCreatorStudioControlRoom(stories = [], opts = {}) {
  const packets = (Array.isArray(stories) ? stories : []).map((story) =>
    buildProductionPacket(story, opts),
  );
  const counts = { GREEN: 0, AMBER: 0, RED: 0 };
  for (const packet of packets) {
    counts[packet.publish_readiness.colour] =
      (counts[packet.publish_readiness.colour] || 0) + 1;
  }
  const overall_colour = counts.RED > 0 ? "RED" : counts.AMBER > 0 ? "AMBER" : "GREEN";
  return {
    schema_version: 1,
    generated_at: opts.now || new Date().toISOString(),
    mode: opts.mode || "fixture_or_local",
    overall_colour,
    story_count: packets.length,
    counts,
    packets,
    outputs: {
      json: "test/output/creator_studio_control_room.json",
      markdown: "test/output/creator_studio_control_room.md",
    },
    notes: [
      "Read-only control/reporting layer.",
      "No hard production gates enabled by this report.",
      "TikTok official API remains blocked; dispatch pack is the safe route.",
    ],
  };
}

function renderCreatorStudioMarkdown(report) {
  const lines = [];
  lines.push("# Pulse Creator Studio OS v1 Control Room");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Overall: ${report.overall_colour}`);
  lines.push(`Stories: ${report.story_count}`);
  lines.push("");
  lines.push("| story | colour | verdict | format | lane | lane readiness | flash action | media | exact | v2 60s | runtime | motion | frames | refs | topic | render | notes |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- |");
  for (const packet of report.packets) {
    lines.push(
      [
        packet.story_id,
        packet.publish_readiness.colour,
        packet.publish_readiness.verdict,
        packet.format_route.verdict,
        packet.format_lane_policy?.lane_id || "unknown",
        packet.format_lane_policy?.readiness_colour || "unknown",
        packet.flash_lane_contract?.next_action || "",
        packet.media_inventory.verdict,
        packet.media_inventory.exact_subject_asset_count,
        packet.media_inventory.studio_v2_60s_eligibility,
        packet.media_inventory.recommended_runtime_class,
        packet.motion_acquisition?.motion_readiness || "unknown",
        packet.controlled_frame_plan?.frame_plan_readiness || "unknown",
        packet.motion_acquisition?.existing_references?.length || 0,
        packet.story_dossier.topicality_verdict,
        packet.render_contract.render_lane,
        [
          ...packet.publish_readiness.blockers,
          ...packet.publish_readiness.warnings,
        ].join(", ") || "clear",
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("## Operator Notes");
  lines.push("");
  for (const note of report.notes || []) lines.push(`- ${note}`);
  return lines.join("\n") + "\n";
}

function renderPacketMarkdown(packet) {
  const lines = [];
  lines.push(`# Production Packet - ${packet.story_id}`);
  lines.push("");
  lines.push(`- readiness: ${packet.publish_readiness.colour} / ${packet.publish_readiness.verdict}`);
  lines.push(`- format: ${packet.format_route.verdict}`);
  lines.push(`- lane: ${packet.format_lane_policy?.lane_name || "unknown"} (${packet.format_lane_policy?.readiness_colour || "unknown"})`);
  if (packet.flash_lane_contract) {
    lines.push(`- flash contract: ${packet.flash_lane_contract.next_action}`);
  }
  lines.push(`- media: ${packet.media_inventory.verdict}`);
  lines.push(`- exact-subject assets: ${packet.media_inventory.exact_subject_asset_count}`);
  lines.push(`- Studio V2 60s eligible: ${packet.media_inventory.studio_v2_60s_eligibility}`);
  lines.push(`- runtime class: ${packet.media_inventory.recommended_runtime_class}`);
  lines.push(`- motion readiness: ${packet.motion_acquisition?.motion_readiness || "unknown"}`);
  lines.push(`- frame-plan readiness: ${packet.controlled_frame_plan?.frame_plan_readiness || "unknown"}`);
  lines.push(`- render lane: ${packet.render_contract.render_lane}`);
  lines.push(`- topicality: ${packet.story_dossier.topicality_verdict} (${packet.story_dossier.topicality_reason})`);
  lines.push("");
  lines.push("## Shot List");
  lines.push("");
  if (packet.shot_list.shots.length === 0) {
    lines.push("No video shot list for this route.");
  } else {
    for (const shot of packet.shot_list.shots) {
      lines.push(
        `- ${shot.timestamp_estimate}: ${shot.visual_type} -> ${shot.visual_target} (${shot.reason})`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

function buildDemoStories() {
  return [
    {
      id: "demo_gta_xbox",
      title: "GTA 6 gets a new Xbox showcase update",
      url: "https://example.com/gta-6-xbox",
      source_type: "rss",
      subreddit: "IGN",
      flair: "Verified",
      score: 500,
      hook: "GTA 6 just became the biggest Xbox story of the week.",
      body: "Rockstar and Xbox are now the centre of the conversation. MindsEye is part of the comparison.",
      loop: "The question is whether Xbox can turn that attention into a real hardware moment.",
      full_script:
        "GTA 6 just became the biggest Xbox story of the week. Rockstar and Xbox are now the centre of the conversation. MindsEye is part of the comparison. The question is whether Xbox can turn that attention into a real hardware moment.",
      downloaded_images: [
        { type: "steam_hero", source: "steam", path: "demo-gta-hero.jpg" },
        { type: "steam_capsule", source: "steam", path: "demo-gta-capsule.jpg" },
        { type: "screenshot", source: "steam", path: "demo-gta-screen.jpg" },
        { type: "screenshot", source: "steam", path: "demo-gta-screen-2.jpg" },
        { type: "key_art", source: "steam", path: "demo-gta-key-art.jpg" },
        { type: "article_hero", source: "article", path: "demo-gta-article.jpg" },
      ],
      video_clips: [
        { type: "official_trailer", source: "youtube", path: "demo-gta-trailer.mp4" },
      ],
      thumbnail_candidate_path: "test/output/demo-gta-thumb.jpg",
      outro_present: true,
    },
    {
      id: "demo_hotd_reject",
      title: "House of the Dragon season 3 adds a major new cast member",
      source_type: "rss",
      subreddit: "Entertainment",
      flair: "News",
      body: "The HBO series is adding a new actor.",
      full_script: "The HBO series is adding a new actor.",
      downloaded_images: [],
      video_clips: [],
    },
  ];
}

module.exports = {
  buildCreatorStudioControlRoom,
  buildDemoStories,
  buildProductionPacket,
  renderCreatorStudioMarkdown,
  renderPacketMarkdown,
  classifyStoryType,
  extractEntities,
};
