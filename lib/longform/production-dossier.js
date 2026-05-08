"use strict";

const { confidenceFromFlair } = require("../creative/format-catalogue");
const { normaliseText: normalisePublicText } = require("../text-hygiene");

const LONGFORM_FORMATS = [
  {
    id: "weekly_roundup",
    label: "Weekly Roundup",
    target_runtime: "6-10 minutes",
    required_confidence: ["confirmed", "verified"],
    purpose: "Rank the week's strongest gaming stories by consequence and audience demand.",
    minimum_segments: 8,
  },
  {
    id: "monthly_release_radar",
    label: "Monthly Release Radar",
    target_runtime: "10-15 minutes",
    required_confidence: ["confirmed"],
    purpose: "Preview dated releases with source-backed dates, platforms and player utility.",
    minimum_segments: 10,
  },
  {
    id: "trailer_breakdown",
    label: "Trailer Breakdown",
    target_runtime: "6-10 minutes",
    required_confidence: ["confirmed", "verified"],
    purpose: "Turn official trailer footage into a frame-led explanation.",
    minimum_segments: 1,
  },
  {
    id: "before_you_download",
    label: "Before You Download",
    target_runtime: "5-8 minutes",
    required_confidence: ["confirmed"],
    purpose: "Help players decide whether a release is worth their time or money.",
    minimum_segments: 1,
  },
  {
    id: "daily_briefing",
    label: "Daily Briefing",
    target_runtime: "2-4 minutes",
    required_confidence: ["confirmed", "verified", "likely"],
    purpose: "Compress the day's important stories into one source-backed briefing.",
    minimum_segments: 6,
  },
];

const CLASS_SCORE = {
  reject_visuals: 0,
  blog_only: 10,
  briefing_item: 30,
  short_only: 45,
  standard_video: 70,
  premium_video: 90,
};

const CONFIDENCE_SCORE = {
  unknown: 0,
  rumour: 25,
  likely: 55,
  verified: 75,
  confirmed: 95,
};

function normaliseText(value) {
  return normalisePublicText(String(value || "")).replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getFormat(formatId) {
  return LONGFORM_FORMATS.find((format) => format.id === formatId) || LONGFORM_FORMATS[0];
}

function sourceConfidence(story) {
  return story?.flair_confidence || confidenceFromFlair(story?.flair || story?.classification);
}

function mediaInventory(story) {
  return story?.media_inventory || story?.mediaInventory || {};
}

function mediaClass(story) {
  return mediaInventory(story).classification || story?.media_inventory_class || "blog_only";
}

function exactAssets(story) {
  return Number(
    mediaInventory(story).exact_subject_asset_count ||
      story?.exact_subject_asset_count ||
      story?.premium_countable_asset_count ||
      0,
  );
}

function validatedClips(story) {
  return Number(
    mediaInventory(story).validated_clip_count ||
      mediaInventory(story).clip_count ||
      story?.validated_clip_count ||
      0,
  );
}

function visualScore(story) {
  return Number(
    mediaInventory(story).visual_strength_score ||
      mediaInventory(story).visualStrength ||
      story?.visual_strength_score ||
      CLASS_SCORE[mediaClass(story)] ||
      0,
  );
}

function topicDurability(story) {
  const text = `${story?.title || ""} ${story?.full_script || ""}`.toLowerCase();
  if (/release date|release times|launch|before you download|price|system requirements/.test(text)) {
    return 85;
  }
  if (/trailer|gameplay|breakdown|confirmed|director|official/.test(text)) return 72;
  if (/rumou?r|could|might|evidence|speculation/.test(text)) return 45;
  return 55;
}

function searchPotential(story) {
  const score = Number(story?.breaking_score || story?.score || 0);
  const title = normaliseText(story?.title);
  let value = Math.min(90, Math.max(30, score));
  if (/\bGTA\b|Pok[eé]mon|Pokemon|Final Fantasy|Xbox|Nintendo|PlayStation|Steam/i.test(title)) value += 8;
  if (/release date|release times|system requirements|price/i.test(title)) value += 8;
  return Math.min(100, value);
}

function franchiseDemand(story) {
  const title = normaliseText(story?.title);
  if (/\bGTA\b|Grand Theft Auto|Pok[eé]mon|Pokemon|Final Fantasy|Resident Evil|Mario|Zelda/i.test(title)) {
    return 90;
  }
  if (/Xbox|Nintendo|PlayStation|Steam/i.test(title)) return 75;
  return 55;
}

function factFlags(story) {
  const confidence = sourceConfidence(story);
  const flags = [];
  if (confidence === "rumour") flags.push("rumour_must_be_labelled");
  if (story?.release_date && confidence !== "confirmed") {
    flags.push(`unsupported_release_date:${story.id || "unknown"}`);
  }
  if (asArray(story?.platforms).length > 0 && !story?.url && !story?.source_url) {
    flags.push(`unsupported_platform_claim:${story.id || "unknown"}`);
  }
  if (!story?.url && !story?.source_url) flags.push(`missing_source_url:${story.id || "unknown"}`);
  return flags;
}

function recommendFormat(story, candidateScore) {
  const confidence = sourceConfidence(story);
  const title = normaliseText(story?.title);
  const cls = mediaClass(story);
  const clips = validatedClips(story);
  if (/release date|release times|launch/i.test(title) && confidence === "confirmed") {
    return "monthly_release_radar";
  }
  if (/trailer|gameplay/i.test(title) && clips > 0 && ["confirmed", "verified"].includes(confidence)) {
    return "trailer_breakdown";
  }
  if (/price|system requirements|before you download|download/i.test(title) && confidence === "confirmed") {
    return "before_you_download";
  }
  if (candidateScore >= 70 && CLASS_SCORE[cls] >= CLASS_SCORE.standard_video) return "weekly_roundup";
  return "daily_briefing";
}

function buildCandidate(story) {
  const confidence = sourceConfidence(story);
  const cls = mediaClass(story);
  const mediaScore = Math.min(100, visualScore(story) + exactAssets(story) * 3 + validatedClips(story) * 4);
  const sourceScore = CONFIDENCE_SCORE[confidence] || 0;
  const searchScore = searchPotential(story);
  const durabilityScore = topicDurability(story);
  const franchiseScore = franchiseDemand(story);
  const total = Math.round(
    sourceScore * 0.25 +
      mediaScore * 0.25 +
      searchScore * 0.2 +
      durabilityScore * 0.15 +
      franchiseScore * 0.15,
  );
  return {
    story_id: story?.id || null,
    title: normaliseText(story?.title),
    source_url: story?.source_url || story?.url || null,
    source_name: story?.source_name || story?.publisher || story?.subreddit || "unknown",
    source_confidence: confidence,
    media_class: cls,
    exact_subject_assets: exactAssets(story),
    validated_clips: validatedClips(story),
    scores: {
      source_confidence: sourceScore,
      media_inventory: mediaScore,
      search_potential: searchScore,
      topic_durability: durabilityScore,
      franchise_demand: franchiseScore,
      total,
    },
    fact_check_flags: factFlags(story),
    recommended_format: recommendFormat(story, total),
  };
}

function buildLongformCandidateSelector(stories = []) {
  const candidates = asArray(stories)
    .map(buildCandidate)
    .sort((a, b) => b.scores.total - a.scores.total);
  return {
    generated_at: new Date().toISOString(),
    candidate_count: candidates.length,
    candidates,
    rejected_or_deferred: candidates.filter((candidate) => candidate.scores.total < 45),
  };
}

function buildSegmentList(format, candidates) {
  const usable = candidates.filter(
    (candidate) =>
      candidate.scores.total >= 45 &&
      asArray(format.required_confidence).includes(candidate.source_confidence),
  );
  const limit = format.id === "monthly_release_radar" ? 10 : format.id === "daily_briefing" ? 6 : 8;
  return usable.slice(0, limit).map((candidate, index) => ({
    segment_id: `${format.id}_${index + 1}`,
    story_id: candidate.story_id,
    title: candidate.title,
    source_confidence: candidate.source_confidence,
    runtime_target_seconds:
      format.id === "daily_briefing" ? 25 : format.id === "monthly_release_radar" ? 75 : 60,
    editorial_angle: angleForCandidate(candidate),
    required_fact_checks: candidate.fact_check_flags,
  }));
}

function angleForCandidate(candidate) {
  if (candidate.recommended_format === "monthly_release_radar") {
    return "Lead with confirmed timing, platform utility and what players can do next.";
  }
  if (candidate.recommended_format === "trailer_breakdown") {
    return "Use official frames to explain what the reveal actually proves.";
  }
  if (candidate.source_confidence === "rumour") {
    return "Frame as unconfirmed audience speculation, not fact.";
  }
  return "Lead with the concrete consequence audiences did not expect.";
}

function buildSourcePack(segments, storyById) {
  return segments.map((segment) => {
    const story = storyById.get(segment.story_id) || {};
    return {
      story_id: segment.story_id,
      source_url: story.source_url || story.url || null,
      publisher: story.source_name || story.publisher || story.subreddit || "unknown",
      confidence: sourceConfidence(story),
      quoted_fact: normaliseText(story.title),
      release_date: story.release_date || null,
      platforms: asArray(story.platforms),
      unsupported_claims: factFlags(story),
    };
  });
}

function buildChapterPlan(format, segments) {
  let cursor = format.id === "daily_briefing" ? 8 : 20;
  return segments.map((segment, index) => {
    const chapter = {
      chapter_index: index + 1,
      start_time_seconds: cursor,
      title: segment.title,
      story_id: segment.story_id,
      promise: segment.editorial_angle,
    };
    cursor += segment.runtime_target_seconds;
    return chapter;
  });
}

function buildVisualPlan(segments, storyById) {
  return segments.map((segment) => {
    const story = storyById.get(segment.story_id) || {};
    const inventory = mediaInventory(story);
    const exact = exactAssets(story);
    const clips = validatedClips(story);
    const missing = [];
    if (exact < 3) missing.push("more_exact_subject_stills");
    if (clips < 1) missing.push("validated_motion_or_trailer_frames");
    return {
      story_id: segment.story_id,
      media_class: mediaClass(story),
      exact_subject_assets: exact,
      validated_clips: clips,
      visual_strength_score: visualScore(story),
      requested_assets: [
        "official gameplay or trailer windows",
        "Steam/IGDB stills for exact subject",
        "publisher/source card",
      ],
      missing,
      downgrade_recommendation:
        exact >= 4 || clips >= 2 ? "longform_ready_for_local_outline" : "keep_as_briefing_segment",
      provenance_required: Boolean(inventory),
    };
  });
}

function buildShotList(segments) {
  const shots = [];
  for (const segment of segments) {
    shots.push({
      story_id: segment.story_id,
      shot_type: "chapter_card",
      visual_target: segment.title,
      reason: "Reset attention before the next story.",
    });
    shots.push({
      story_id: segment.story_id,
      shot_type: "official_or_exact_subject_media",
      visual_target: segment.title,
      reason: "Anchor the narration to exact subject material.",
    });
    shots.push({
      story_id: segment.story_id,
      shot_type: "source_timeline_card",
      visual_target: segment.source_confidence,
      reason: "Show what is confirmed and what still needs source review.",
    });
  }
  return shots;
}

function buildSeoPackage(format, segments, generatedAt) {
  const lead = segments[0]?.title || "Gaming News";
  const date = String(generatedAt || new Date().toISOString()).slice(0, 10);
  return {
    title: `Pulse Gaming ${format.label}: ${lead}`,
    description:
      `${format.label} local-only draft for ${date}. Every release date, platform and source claim must be verified before public use.`,
    tags: [
      "Pulse Gaming",
      "gaming news",
      format.id.replace(/_/g, " "),
      ...segments.slice(0, 5).map((segment) => segment.title.split(/\s+/).slice(0, 3).join(" ")),
    ],
    thumbnail_concept: "Lead game art, one consequence headline and Pulse Gaming brand mark.",
  };
}

function buildShortsSpinOffPlan(segments) {
  return segments.slice(0, 5).map((segment) => ({
    source_segment_id: segment.segment_id,
    story_id: segment.story_id,
    short_runtime_target_seconds: 64,
    hook_type: segment.source_confidence === "rumour" ? "careful_uncertainty" : "concrete_consequence",
    working_title: `${segment.title} in 60 seconds`,
    approval_needed: segment.required_fact_checks.length > 0,
  }));
}

function buildFactCheckFlags(segments) {
  return [...new Set(segments.flatMap((segment) => segment.required_fact_checks))];
}

function buildDossierFactCheckFlags(segments, candidates) {
  return [...new Set(segments.flatMap((segment) => segment.required_fact_checks))];
}

function buildDeferredFactCheckFlags(segments, candidates) {
  const selected = new Set(segments.map((segment) => segment.story_id));
  return [
    ...new Set(
      candidates
        .filter((candidate) => !selected.has(candidate.story_id))
        .flatMap((candidate) => candidate.fact_check_flags || []),
    ),
  ];
}

function buildLongformProductionDossier({
  formatId = "weekly_roundup",
  stories = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const format = getFormat(formatId);
  const selector = buildLongformCandidateSelector(stories);
  const storyById = new Map(asArray(stories).map((story) => [story.id, story]));
  const segment_list = buildSegmentList(format, selector.candidates);
  const chapter_plan = buildChapterPlan(format, segment_list);
  const visual_plan = buildVisualPlan(segment_list, storyById);
  const fact_check_flags = buildDossierFactCheckFlags(segment_list, selector.candidates);
  const deferred_fact_check_flags = buildDeferredFactCheckFlags(segment_list, selector.candidates);
  const selectedIds = new Set(segment_list.map((segment) => segment.story_id));
  const minimumMet = segment_list.length >= format.minimum_segments;
  return {
    generated_at: generatedAt,
    status: minimumMet ? "outline_ready_for_editorial_review" : "insufficient_segments",
    publish_status: "local_prototype_only",
    format,
    candidate_selector: selector,
    segment_list,
    source_pack: buildSourcePack(segment_list, storyById),
    chapter_plan,
    visual_plan,
    shot_list: buildShotList(segment_list),
    fact_check_flags,
    selected_fact_check_flags: fact_check_flags,
    deferred_fact_check_flags,
    deferred_candidates: selector.candidates
      .filter((candidate) => !selectedIds.has(candidate.story_id))
      .map((candidate) => ({
        story_id: candidate.story_id,
        title: candidate.title,
        source_confidence: candidate.source_confidence,
        score: candidate.scores.total,
        reason: asArray(format.required_confidence).includes(candidate.source_confidence)
          ? "below_limit_or_score"
          : "format_confidence_ineligible",
        fact_check_flags: candidate.fact_check_flags,
      })),
    seo_package: buildSeoPackage(format, segment_list, generatedAt),
    shorts_spin_off_plan: buildShortsSpinOffPlan(segment_list),
    safety: {
      live_actions_allowed: false,
      upload_allowed: false,
      scheduler_allowed: false,
      production_db_writes_allowed: false,
      note: "Local-only prototype. No upload, no scheduler change and no production DB mutation.",
    },
  };
}

function renderLongformDossierMarkdown(dossier) {
  const lines = [];
  lines.push("# Pulse Gaming Longform Production Dossier");
  lines.push("");
  lines.push(`Generated: ${dossier.generated_at}`);
  lines.push(`Format: ${dossier.format.label}`);
  lines.push(`Status: ${dossier.status}`);
  lines.push(`Publish status: ${dossier.publish_status} (local-only prototype)`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No upload");
  lines.push("- No scheduler change");
  lines.push("- No production DB mutation");
  lines.push("- Facts flagged below still need manual verification before public use");
  lines.push("");
  lines.push("## Segments");
  lines.push("");
  for (const segment of dossier.segment_list) {
    lines.push(
      `- ${segment.segment_id}: ${segment.title} (${segment.runtime_target_seconds}s, ${segment.source_confidence})`,
    );
  }
  lines.push("");
  lines.push("## Fact-Check Flags");
  lines.push("");
  lines.push("Selected segments:");
  if (dossier.selected_fact_check_flags?.length) {
    for (const flag of dossier.selected_fact_check_flags) lines.push(`- ${flag}`);
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("Deferred candidates:");
  if (dossier.deferred_fact_check_flags?.length) {
    for (const flag of dossier.deferred_fact_check_flags) lines.push(`- ${flag}`);
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("## Source Pack");
  lines.push("");
  lines.push("| story | publisher | confidence | source | unsupported claims |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const source of dossier.source_pack || []) {
    lines.push(
      `| ${source.story_id} | ${source.publisher} | ${source.confidence} | ${source.source_url || "missing"} | ${source.unsupported_claims.join(", ") || "none"} |`,
    );
  }
  lines.push("");
  lines.push("## Chapter Plan");
  lines.push("");
  for (const chapter of dossier.chapter_plan) {
    lines.push(`- ${chapter.start_time_seconds}s: ${chapter.title}`);
  }
  lines.push("");
  lines.push("## Visual Plan");
  lines.push("");
  for (const visual of dossier.visual_plan) {
    lines.push(
      `- ${visual.story_id}: exact=${visual.exact_subject_assets}, clips=${visual.validated_clips}, missing=${visual.missing.join(", ") || "none"}`,
    );
  }
  lines.push("");
  lines.push("## SEO Package");
  lines.push("");
  lines.push(`Title: ${dossier.seo_package.title}`);
  lines.push(`Description: ${dossier.seo_package.description}`);
  lines.push("");
  lines.push("## Shorts Spin-Off Plan");
  lines.push("");
  for (const item of dossier.shorts_spin_off_plan) {
    lines.push(`- ${item.working_title} (${item.hook_type})`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  LONGFORM_FORMATS,
  buildLongformCandidateSelector,
  buildLongformProductionDossier,
  renderLongformDossierMarkdown,
};
