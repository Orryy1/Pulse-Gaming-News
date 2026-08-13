"use strict";

const {
  buildVisualV4SoundTransitionPlan,
} = require("./sound-transition-planner");
const { runMediaHouseBenchmark } = require("../../media-house-benchmark");
const {
  V5_SOURCE_CARD_TIMING,
} = require("./premium-card-timing-policy");
const {
  CREATIVE_SYSTEM_VERSION,
  resolvePulseVisualIdentity,
} = require("../v5/pulse-visual-identity");
const {
  PREMIUM_EDIT_RHYTHM_V5,
} = require("../v5/premium-edit-rhythm");
const {
  buildPulseEditorialExceptionPlan,
  buildPulseMotionCanvasContract,
  resolvePulseVisualEditorialPolicy,
} = require("../v5/pulse-visual-editorial-policy");

const PREMIUM_BENCHMARK_MOTION_SCENES = 8;
const SOURCE_LOCK_CARD_SHOT_DURATION_S = V5_SOURCE_CARD_TIMING.planned_visible_duration_s;
const MIN_READABLE_CARD_SHOT_DURATION_S = 4.2;
const MAX_READABLE_CARD_SHOT_DURATION_S = 5.8;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseMotionSourceAsset(value = "") {
  const text = cleanText(value);
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
    if (host === "youtube.com") {
      const pathVideoId = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i)?.[1];
      const videoId = cleanText(parsed.searchParams.get("v") || pathVideoId);
      if (videoId) return `youtube:${videoId.toLowerCase()}`;
    }
    if (host === "youtu.be") {
      const videoId = cleanText(parsed.pathname.split("/").filter(Boolean)[0]);
      if (videoId) return `youtube:${videoId.toLowerCase()}`;
    }
  } catch {}
  return (
    text
      .toLowerCase()
      .replace(/\\/g, "/")
      .replace(/[?#].*$/, "")
      .replace(/\.(?:mp4|mov|webm|mkv|m3u8|mpd)$/i, "")
      .replace(
        /([_/-]v4[_/-]clip[_/-]?\d+)[_/-]segment[_/-]direct[_/-]motion[_/-]?\d+(?:[_/-][a-f0-9]{6,})?$/i,
        "$1",
      )
      .replace(
        /[_/-]segment[_/-]direct[_/-]motion[_/-]?\d+(?:[_/-][a-f0-9]{6,})?$/i,
        "",
      )
      .replace(
        /\/(?:hls(?:_[a-z0-9]+)*_master|hls(?:_[a-z0-9]+)*|dash(?:_[a-z0-9]+)*|movie(?:_max|\d+)?(?:_[a-z0-9]+)*)$/i,
        "",
      )
      .replace(/(?:[_/-]window[_/-]?\d+(?:[_/-]\d+)?)$/i, "")
      .replace(/(?:[_/-]segment[_/-]?\d+)$/i, "") || ""
  );
}

function normaliseMotionShotSourceAsset(value = "") {
  const family = cleanText(value);
  if (/(?:^|[_/-])window[_/-]?\d+/i.test(family)) {
    return family.toLowerCase().replace(/\\/g, "/");
  }
  return normaliseMotionSourceAsset(family);
}

function officialWindowMotionSourceFamily(clip = {}) {
  const family = cleanText(
    clip.source_family ||
      clip.motion_family ||
      clip.base_source_family ||
      clip.original_source_family,
  );
  if (!/(?:^|[_/-])window[_/-]?\d+/i.test(family)) return "";
  const text = [
    family,
    clip.source_type,
    clip.source_kind,
    clip.media_kind,
    clip.source_url_kind,
    clip.source_url,
    clip.url,
    clip.licence_basis,
    clip.license_basis,
    clip.rights_basis,
    clip.allowed_use,
    clip.approval_status,
  ].map(cleanText).join(" ").toLowerCase();
  if (/generated|owned_generated|pulse-generated|rss_story_v4_clip/i.test(text)) return "";
  if (
    /\b(?:official_trailer_segment|official_game_website_media_page|official_game_site_news_page|official_social_media_video|official_direct_media|licensed_direct_media|validated_official_local_motion|trimmed_segment_samples_passed)\b/i.test(text)
  ) {
    return family.replace(/\\/g, "/").toLowerCase();
  }
  return "";
}

function readableCardDurationS(...values) {
  const text = cleanText(values.filter(Boolean).join(" "));
  if (!text) return MIN_READABLE_CARD_SHOT_DURATION_S;
  const words = text.split(/\s+/).filter(Boolean).length;
  const longTokenPenalty = /\b[A-Z0-9]{6,}\b/.test(text) ? 0.25 : 0;
  const computed = Math.max(
    MIN_READABLE_CARD_SHOT_DURATION_S,
    0.34 * words + 2.8 + longTokenPenalty,
  );
  return Number(Math.min(MAX_READABLE_CARD_SHOT_DURATION_S, Math.ceil(computed * 10) / 10).toFixed(1));
}

function readableSourceLockDurationS() {
  return SOURCE_LOCK_CARD_SHOT_DURATION_S;
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function storyText(story = {}) {
  return [
    story.title,
    story.hook,
    story.body,
    story.full_script,
    story.narration_script,
    story.tts_script,
    story.canonical_angle,
    story.first_spoken_line,
    story.description,
    story.canonical_subject,
    story.primary_source,
    story.source_name,
  ]
    .filter(Boolean)
    .join(". ");
}

function extractCommaMetric(text) {
  const raw = cleanText(text);
  const match = raw.match(/\b\d{1,3}(?:,\d{3})+\b/);
  if (match) return match[0];
  if (!/\b(?:steam|steamdb|players?|concurrent)\b/i.test(raw)) return null;
  const compact = raw.match(/\b(\d{2,3})(?:\.\d+)?\s*k\b/i);
  if (!compact) return null;
  const expanded = Number(compact[1]) * 1000;
  return Number.isFinite(expanded) ? expanded.toLocaleString("en-GB") : null;
}

function extractReviewScore(text) {
  const raw = cleanText(text);
  if (!/\b(?:metacritic|critic score|review score|aggregate)\b/i.test(raw)) {
    return null;
  }
  const patterns = [
    /\b(100|[1-9]\d)\s+(?:metacritic|critic score|review score|aggregate)\b/i,
    /\b(?:metacritic|critic score|review score|aggregate)\D{0,40}\b(100|[1-9]\d)\b/i,
    /\b(100|[1-9]\d)\D{0,40}\b(?:metacritic|critic score|review score|aggregate)\b/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const score = Number(match[1]);
    if (Number.isFinite(score) && score >= 50 && score <= 100) {
      return match[1];
    }
  }
  return null;
}

function extractPrice(text) {
  const match = cleanText(text).match(/\$\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function proofCardBeatForStory({ story = {}, text = "" } = {}) {
  const subject = cleanText(story.canonical_subject || story.subject || story.title || "STORY")
    .toUpperCase()
    .slice(0, 28);
  const lower = cleanText(text).toLowerCase();
  if (/\b(?:xcom|tactic|tactical|strategy)\b/.test(lower)) {
    return {
      id: "tactics_proof_card",
      label: "TACTICS CHECK",
      detail: "NOT JUST XCOM",
    };
  }
  if (/\b(?:ai[-\s]?look|handmade|hand made|crafted|art direction|production process)\b/.test(lower)) {
    return {
      id: "creative_process_card",
      label: "HANDMADE STAGE",
      detail: "NOT AI SHORTCUTS",
    };
  }
  if (
    /\brocksteady\b/.test(lower) &&
    /\b(?:listed|credited|production|involved)\b/.test(lower) &&
    /\b(?:arkham|batman)\b/.test(lower)
  ) {
    return {
      id: "studio_credit_card",
      label: "ROCKSTEADY LISTED",
      detail: /\b(?:arkham dna|arkham[-\s]?lite|combat)\b/.test(lower)
        ? "ARKHAM-LITE COMBAT"
        : "PRODUCTION CREDIT",
    };
  }
  const isHardwarePerformanceStory =
    /\b(?:hardware|ps5 pro|playstation 5 pro|xbox series [xs])\b/.test(lower) &&
    /\b(?:performance|frame ?rate|framerate|fps|resolution|4k|pssr|upscal(?:e|ing)|sharper|graphics|visuals?|stress test|upgrade|patch)\b/.test(lower);
  if (isHardwarePerformanceStory) {
    const isPs5Pro = /\b(?:ps5 pro|playstation 5 pro)\b/.test(lower);
    const hasSharpnessClaim = /\b(?:pssr|upscal(?:e|ing)|sharper|resolution|4k)\b/.test(lower);
    const hasFrameRateClaim = /\b(?:frame ?rate|framerate|fps|steadier)\b/.test(lower);
    return {
      id: "hardware_performance_card",
      label: isPs5Pro ? "PS5 PRO STRESS TEST" : "PERFORMANCE TEST",
      detail: hasSharpnessClaim
        ? "SHARPER DETAIL"
        : hasFrameRateClaim
          ? "FRAME RATE CHECK"
          : "PLAYER IMPACT",
    };
  }
  const isHardwareProduct = /\b(?:controller|headset|accessory|steam deck)\b/.test(lower);
  const isHardwareListing =
    /\bhardware\b/.test(lower) &&
    /\b(?:buy|price|priced|retailer|store|listing|listed|pre[-\s]?order|availability|compatible|sku)\b/.test(lower);
  if (isHardwareProduct || isHardwareListing) {
    if (/\b(?:date|release|launch|leak|leaked|may have)\b/.test(lower)) {
      return {
        id: "hardware_date_card",
        label: "DATE LEAK",
        detail: "HARDWARE WINDOW",
      };
    }
    return {
      id: "hardware_proof_card",
      label: "ACCESSORY LISTED",
      detail: "CHECK PRICE + PLATFORM",
    };
  }
  if (/\b(?:devs? are making|developer.*making|studio.*working|next game|new project)\b/.test(lower)) {
    return {
      id: "studio_project_card",
      label: "NEXT PROJECT",
      detail: `${subject || "STUDIO"} WATCH`,
    };
  }
  if (/\b(?:eras?|timeline|generations?|five eras|history)\b/.test(lower)) {
    return {
      id: "timeline_proof_card",
      label: "TIMELINE SHIFT",
      detail: "MULTI-ERA HOOK",
    };
  }
  if (
    /\b(?:leak|leaked|reportedly|rumou?r|claimed|may have)\b/.test(lower) &&
    /\b(?:date|release|launch)\b/.test(lower)
  ) {
    if (/\bsubnautica\b/.test(lower)) {
      return {
        id: "leaked_build_card",
        label: "LEAKED BUILD",
        detail: "BEFORE LAUNCH",
      };
    }
    return {
      id: "release_date_card",
      label: "RELEASE DATE",
      detail: "LEAKED EARLY",
    };
  }
  if (/\b(?:leak|leaked|reportedly|rumou?r|claimed|may have)\b/.test(lower)) {
    return {
      id: "claim_boundary_card",
      label: "LEAK BOUNDARY",
      detail: "SOURCE, NOT HYPE",
    };
  }
  if (/\b(?:gameplay|trailer footage|combat|hands[-\s]?on|real footage)\b/i.test(text)) {
    return {
      id: "gameplay_proof_card",
      label: "REAL GAMEPLAY",
      detail: "SHOW THE PROOF",
    };
  }
  return {
    id: "source_proof_card",
    label: subject ? `${subject} PROOF` : "SOURCE PROOF",
    detail: "ONE CLAIM, ONE SOURCE",
  };
}

function wantsEarlyMetric(retentionIntelligence = {}) {
  const text = [
    ...asArray(retentionIntelligence.recommendations).map(
      (item) => `${item.id || ""} ${item.action || ""}`,
    ),
    ...asArray(retentionIntelligence.visual_v3_adjustments?.prompt_directives),
  ]
    .join(" ")
    .toLowerCase();
  return /move.*(?:steam|metric|number|chart).*opening|opening four|first four|concrete number/.test(
    text,
  );
}

function sourceLabel(story = {}) {
  return cleanText(
    story.source_card_label ||
      story.primary_source ||
      story.source_label ||
      story.source_name ||
      story.publisher ||
      story.outlet ||
      story.source,
  )
    .toUpperCase() || "SOURCE";
}

function beatStart(localTimeline = {}, typeOrMetric, fallback) {
  const query = cleanText(typeOrMetric).toLowerCase();
  const beat = asArray(localTimeline.beats).find((item) => {
    const text = `${item.type || ""} ${item.metric || ""} ${item.text || ""}`.toLowerCase();
    return text.includes(query);
  });
  return round(beat?.start ?? fallback, 3);
}

function retentionPatternShots(retentionIntelligence = {}) {
  return asArray(retentionIntelligence.visual_v3_adjustments?.timeline_events)
    .filter((event) => event?.kind === "retention_pattern_interrupt")
    .slice(0, 3)
    .map((event, index) => ({
      id: event.id || `pattern_interrupt_${index + 1}`,
      kind: "pattern_interrupt",
      startS: round(event.atS ?? 18 + index * 8, 3),
      durationS: round(event.durationS || 2.1, 3),
      label: cleanText(event.label) || "NEW ANGLE",
      detail: cleanText(event.detail) || "Retention save beat",
      priority: Number(event.priority || 90),
      source: "retention_intelligence",
      visual_treatment: "full-frame kinetic caption and motion cutaway",
    }));
}

function uniqueMotionClips(footagePlan = {}, targetCount = 5) {
  const seenSources = new Set();
  const seenClips = new Set();
  const usesBySource = new Map();
  const clips = [];
  const candidates = asArray(footagePlan.motion_inventory?.accepted_local_clips).map((clip) => {
    const family = cleanText(clip.source_family);
    const baseSourceFamily =
      officialWindowMotionSourceFamily(clip) ||
      normaliseMotionSourceAsset(
        clip.base_source_family ||
          clip.original_source_family ||
          clip.provenance?.base_source_family ||
          clip.source_url ||
          clip.reference_url ||
          family,
      );
    if (!family) return null;
    return {
      id: clip.id || `motion_${clips.length + 1}`,
      source_family: family,
      base_source_family: baseSourceFamily || family,
      path: clip.path || null,
      durationS: round(clip.durationS || 2.4, 3),
      allows_second_owned_generator_variant:
        Boolean(cleanText(clip.generator_project_id)) &&
        /^[a-f0-9]{64}$/i.test(cleanText(clip.generator_master_sha256)) &&
        /^[a-f0-9]{64}$/i.test(
          cleanText(
            clip.materialised_output_sha256 ||
              clip.materialized_output_sha256,
          ),
        ) &&
        clip.owned_explainer_visual_plan === true &&
        clip.counts_towards_motion_readiness === true &&
        clip.owned_generated_rights_grant?.grant_type === "owned_generated" &&
        clip.owned_generated_rights_grant?.commercial_use_allowed === true,
      allows_second_official_window:
        /official|publisher|studio|storefront|steam|youtube/i.test(
          [clip.source_type, clip.provider, clip.source_url, clip.reference_url].filter(Boolean).join(" "),
        ) &&
        Boolean(cleanText(clip.source_url || clip.reference_url)),
    };
  }).filter(Boolean);
  const add = (clip) => {
    const clipKey = cleanText(clip.id || clip.path);
    const sourceKey = cleanText(clip.base_source_family || clip.source_family);
    if (!clipKey || seenClips.has(clipKey)) return false;
    const sourceUseLimit =
      clip.allows_second_owned_generator_variant ||
      clip.allows_second_official_window
        ? 2
        : 1;
    if ((usesBySource.get(sourceKey) || 0) >= sourceUseLimit) return false;
    seenClips.add(clipKey);
    seenSources.add(sourceKey);
    usesBySource.set(sourceKey, (usesBySource.get(sourceKey) || 0) + 1);
    clips.push(clip);
    return true;
  };
  for (const clip of candidates) {
    const sourceKey = cleanText(clip.base_source_family || clip.source_family);
    if (seenSources.has(sourceKey)) continue;
    add(clip);
  }
  for (const clip of candidates) {
    if (clips.length >= targetCount) break;
    add(clip);
  }
  return clips.slice(0, Math.max(0, Number(targetCount || 0)));
}

function motionShotTimes(durationS, count) {
  const safeDuration = Math.max(20, Number(durationS) || 58);
  const anchors = [0.35, 5.2, 10.8, 16.6, 23.4, 31.2, 39.4, 47.2, 52.0];
  if (count <= anchors.length) return anchors.slice(0, count);
  const out = [...anchors];
  while (out.length < count) {
    const t = 3 + (safeDuration - 8) * (out.length / Math.max(1, count - 1));
    out.push(round(t, 3));
  }
  return out.slice(0, count);
}

function buildMotionShots({
  footagePlan = {},
  durationS,
  preferredMotionSceneCount = PREMIUM_BENCHMARK_MOTION_SCENES,
}) {
  const minActual = Number(footagePlan.motion_budget?.required_motion_scenes || 5);
  const minDistinctSourceAssets = Number(
    footagePlan.motion_budget?.required_distinct_source_assets ||
      footagePlan.motion_budget?.required_distinct_base_sources ||
      footagePlan.motion_budget?.required_distinct_families ||
      0,
  );
  const targetCount = Math.max(
    minActual,
    PREMIUM_BENCHMARK_MOTION_SCENES,
    Number(preferredMotionSceneCount || PREMIUM_BENCHMARK_MOTION_SCENES),
    minDistinctSourceAssets,
  );
  const clips = uniqueMotionClips(
    footagePlan,
    targetCount,
  );
  const selectedCount = Math.max(0, Math.min(targetCount, clips.length));
  const selected = clips.slice(0, selectedCount);
  const starts = motionShotTimes(durationS, selected.length);
  return selected.map((clip, index) => ({
    id: `motion_clip_${String(index + 1).padStart(2, "0")}`,
    kind: "motion_clip",
    startS: round(starts[index], 3),
    durationS: round(Math.min(3.6, Math.max(2.1, clip.durationS || 2.4)), 3),
    source_family: clip.source_family,
    base_source_family: clip.base_source_family || clip.source_family,
    motion_pack_clip_id: clip.id,
    media_path: clip.path,
    priority: 62 - index,
    visual_treatment:
      index === 0
        ? "hook speed-ramp motion"
        : index % 2 === 0
          ? "tight kinetic b-roll"
          : "source-backed motion cutaway",
  }));
}

function motionReadinessEvidence({ footagePlan = {}, motionShots = [] } = {}) {
  const minActualMotionClips = Number(footagePlan.motion_budget?.required_motion_scenes || 5);
  const minDistinctMotionFamilies = Number(
    footagePlan.motion_budget?.required_distinct_families || 4,
  );
  const minDistinctMotionSourceAssets = Number(
    footagePlan.motion_budget?.required_distinct_source_assets ||
      footagePlan.motion_budget?.required_distinct_base_sources ||
      minDistinctMotionFamilies,
  );
  const materialisedMotionShots = asArray(motionShots).filter(
    (shot) => cleanText(shot.media_path) && cleanText(shot.source_family),
  );
  const distinctFamilies = new Set(
    materialisedMotionShots.map((shot) => cleanText(shot.source_family)),
  );
  const distinctSourceAssets = new Set(
    materialisedMotionShots.map((shot) =>
      normaliseMotionShotSourceAsset(shot.base_source_family || shot.source_family),
    ),
  );
  return {
    min_actual_motion_clips: minActualMotionClips,
    min_distinct_motion_families: minDistinctMotionFamilies,
    min_distinct_motion_source_assets: minDistinctMotionSourceAssets,
    available_motion_clips: materialisedMotionShots.length,
    available_distinct_motion_families: distinctFamilies.size,
    available_distinct_motion_source_assets: distinctSourceAssets.size,
    actual_motion_clip_minimum_met: materialisedMotionShots.length >= minActualMotionClips,
    distinct_motion_families_minimum_met:
      distinctFamilies.size >= minDistinctMotionFamilies,
    distinct_motion_source_assets_minimum_met:
      distinctSourceAssets.size >= minDistinctMotionSourceAssets,
  };
}

function isSatisfiedStaleMotionBlocker(blocker, evidence) {
  const id = cleanText(blocker).split(":").pop();
  if (
    id === "actual_motion_clip_minimum_not_met" &&
    evidence.actual_motion_clip_minimum_met
  ) {
    return true;
  }
  if (
    id === "distinct_motion_families_minimum_not_met" &&
    evidence.distinct_motion_families_minimum_met
  ) {
    return true;
  }
  if (
    id === "distinct_motion_source_assets_minimum_not_met" &&
    evidence.distinct_motion_source_assets_minimum_met
  ) {
    return true;
  }
  if (
    id === "no_trusted_footage_references_for_story" &&
    evidence.actual_motion_clip_minimum_met &&
    evidence.distinct_motion_families_minimum_met &&
    evidence.distinct_motion_source_assets_minimum_met
  ) {
    return true;
  }
  return false;
}

function filterStaleMotionBlockers(blockers = [], evidence = {}) {
  return asArray(blockers).filter(
    (blocker) => !isSatisfiedStaleMotionBlocker(blocker, evidence),
  );
}

function buildCoreShots({
  story = {},
  localTimeline = {},
  retentionIntelligence = {},
}) {
  const text = storyText(story);
  const earlyMetric = wantsEarlyMetric(retentionIntelligence);
  const commaMetric = extractCommaMetric(text);
  const score = extractReviewScore(text);
  const price = extractPrice(text);
  const source = sourceLabel(story);
  const shots = [
    {
      id: "hook_slam",
      kind: "hook_slam",
      startS: 0,
      durationS: 2.4,
      label: "THE HEADLINE",
      priority: 100,
      visual_treatment: "instant motion hit, no text stack",
    },
    {
      id: "source_lock",
      kind: "source_lock",
      startS: earlyMetric ? 4.55 : 2.75,
      durationS: readableSourceLockDurationS(),
      source,
      title: "SOURCE",
      label: source,
      priority: 86,
      visual_treatment: "large readable source bug",
    },
  ];

  if (commaMetric) {
    shots.push({
      id: "steam_chart",
      kind: "steam_chart",
      startS: earlyMetric ? 2.55 : Math.max(3.6, beatStart(localTimeline, commaMetric, 13.8) - 0.25),
      durationS: readableCardDurationS("STEAM PEAK", commaMetric),
      metric: commaMetric,
      label: "STEAM PEAK",
      priority: 98,
      visual_treatment: "animated chart with count-up and source lock",
    });
  }

  if (score) {
    shots.push({
      id: "review_score_card",
      kind: "review_score_card",
      startS: Math.max(6.4, beatStart(localTimeline, score, 8.0) - 0.25),
      durationS: readableCardDurationS("METACRITIC", score),
      metric: score,
      label: "METACRITIC",
      priority: 88,
      visual_treatment: "score reveal with critic context",
    });
  }

  if (price) {
    shots.push({
      id: "price_snap",
      kind: "price_snap",
      startS: Math.max(17.4, beatStart(localTimeline, price, 24.8) - 0.2),
      durationS: readableCardDurationS("PAID ACCESS", price),
      metric: price,
      label: "PAID ACCESS",
      priority: 78,
      visual_treatment: "price tag slam with caveat line",
    });
  }

  if (!commaMetric && !score && !price) {
    const proofCard = proofCardBeatForStory({ story, text });
    shots.push({
      id: proofCard.id,
      kind: "proof_card",
      startS: 4.45,
      durationS: readableCardDurationS(proofCard.label, proofCard.detail),
      label: proofCard.label,
      detail: proofCard.detail,
      priority: 84,
      visual_treatment:
        "full-frame animated proof card with source label, large subject crop and no paragraph text",
    });
  }

  if (/\bearly[-\s]access\b|\bnot full demand\b|\bpaid[-\s]access\b/i.test(text)) {
    shots.push({
      id: "context_caveat",
      kind: "context_caveat",
      startS: Math.max(20.6, beatStart(localTimeline, "early", 27.0)),
      durationS: readableCardDurationS("NOT FULL DEMAND YET", "Premium Edition changes the read"),
      label: "NOT FULL DEMAND YET",
      detail: "Premium Edition changes the read",
      priority: 72,
      visual_treatment: "one-line caveat, no paragraph card",
    });
  }

  return shots;
}

function sortShots(shots) {
  return asArray(shots).sort(
    (a, b) => Number(a.startS || 0) - Number(b.startS || 0) || Number(b.priority || 0) - Number(a.priority || 0),
  );
}

function countMaxRun(items, key) {
  let max = 0;
  let run = 0;
  let previous = null;
  for (const item of items) {
    const value = item?.[key];
    if (value === previous) run += 1;
    else {
      previous = value;
      run = 1;
    }
    max = Math.max(max, run);
  }
  return max;
}

function buildTransitionPlan(shotPlan = []) {
  const families = ["hard_cut", "speed_ramp", "chart_slam", "wipe", "match_cut", "whip_pan"];
  const transitions = asArray(shotPlan)
    .slice(1)
    .map((shot, index) => ({
      atS: round(Math.max(0, Number(shot.startS || 0) - 0.04), 3),
      family: families[index % families.length],
      into: shot.id,
    }));
  return {
    required_families: families.slice(0, 4),
    planned: transitions,
    max_same_transition_run: Math.min(2, countMaxRun(transitions, "family") || 1),
    rules: {
      no_empty_rectangle_wipes: true,
      no_text_over_text_wipes: true,
      cut_on_audio_beats: true,
    },
  };
}

function buildSfxPlan(shotPlan = []) {
  const cueFamilies = ["impact", "whoosh", "tick", "transition_hit", "riser"];
  const cues = [];
  for (const [index, shot] of asArray(shotPlan).entries()) {
    const family =
      shot.kind === "hook_slam"
        ? "impact"
        : shot.kind === "steam_chart"
          ? "tick"
          : shot.kind === "pattern_interrupt"
            ? "riser"
            : cueFamilies[index % cueFamilies.length];
    cues.push({
      id: `sfx_${String(index + 1).padStart(2, "0")}`,
      atS: round(shot.startS || 0, 3),
      family,
      target: shot.id,
      gainDb: family === "impact" ? -7 : -10,
    });
  }
  if (!cues.some((cue) => cue.family === "transition_hit")) {
    cues.push({
      id: "sfx_transition_hit_fill",
      atS: 6.8,
      family: "transition_hit",
      target: "transition_fill",
      gainDb: -11,
    });
  }
  if (!cues.some((cue) => cue.family === "whoosh")) {
    cues.push({
      id: "sfx_whoosh_fill",
      atS: 11.8,
      family: "whoosh",
      target: "motion_fill",
      gainDb: -12,
    });
  }
  return {
    cue_count: cues.length,
    cues: cues.sort((a, b) => a.atS - b.atS),
    max_same_family_run: Math.min(2, countMaxRun(cues, "family") || 1),
    mastering: {
      duck_under_narration: true,
      limiter: true,
      local_only: true,
      target_peak_db: -1.5,
    },
  };
}

function animatedElementFamilyForShot(shot = {}) {
  const kind = cleanText(shot.kind).toLowerCase();
  if (kind === "hook_slam") return "kinetic_headline";
  if (kind === "source_lock") return "source_lock";
  if (kind === "steam_chart") return "stat_or_price_count_up";
  if (kind === "review_score_card") return "rank_or_score_meter";
  if (kind === "price_snap") return "stat_or_price_count_up";
  if (kind === "pattern_interrupt") return "achievement_or_feature_pop";
  if (kind === "context_caveat") return "comparison_panel";
  if (kind === "proof_card") return "player_impact_callout";
  if (kind === "motion_clip") return "platform_signal_transition";
  return "kinetic_context";
}

function buildEngagementElementPlan({
  story = {},
  visualEditorialPolicy = {},
  platformVisualLanguage = {},
} = {}) {
  const requiredFamilies = [
    ...new Set(asArray(visualEditorialPolicy.required_animated_element_families)),
  ];
  const platformSpecificFamilies = [
    ...new Set(asArray(platformVisualLanguage.animated_elements)),
  ];
  const text = storyText(story).toLowerCase();
  const storyTriggeredFamilies = [];
  if (
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:games?|titles?|additions?|releases?)\b/i.test(
      text,
    )
  ) {
    storyTriggeredFamilies.push("game_count_reveal");
  }
  if (/\b(?:achievement|trophy|feature|mode|upgrade|patch)\b/i.test(text)) {
    storyTriggeredFamilies.push("achievement_or_feature_pop");
  }
  if (/\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|week|month|date|launch|release)\b/i.test(text)) {
    storyTriggeredFamilies.push("timeline");
  }
  if (/\b(?:versus|vs\.?|compared|cheaper|faster|higher|lower|before|after)\b/i.test(text)) {
    storyTriggeredFamilies.push("comparison_panel");
  }

  const plannedFamilies = [
    ...new Set([
      ...requiredFamilies,
      ...storyTriggeredFamilies,
      ...platformSpecificFamilies,
    ]),
  ];
  return {
    version: "pulse_engagement_element_plan_v1",
    animation_rule: visualEditorialPolicy.animation_rule,
    decorative_motion_without_story_function:
      visualEditorialPolicy.decorative_motion_without_story_function,
    platform_visual_language_id: platformVisualLanguage.id || "neutral",
    platform_motion_signature:
      platformVisualLanguage.motion_signature || "signal_trace",
    required_families: requiredFamilies,
    story_triggered_families: storyTriggeredFamilies,
    platform_specific_families: platformSpecificFamilies,
    planned_families: plannedFamilies,
    target_element_count: Math.max(8, requiredFamilies.length),
    maximum_seconds_without_visual_change:
      visualEditorialPolicy.edit_rules?.maximum_seconds_without_visual_change ||
      3.8,
    overlay_gameplay_when_readable:
      visualEditorialPolicy.edit_rules?.cards_overlay_gameplay_when_readable !==
      false,
    text_and_evidence_default_presentation: "OVERLAY",
    fullscreen_evidence_requires_bounded_necessity_exception: true,
    platform_theme_is_context_not_identity: true,
  };
}

function buildVisualV4DirectorPlan({
  story = {},
  footagePlan = {},
  localTimeline = {},
  retentionIntelligence = {},
  trustedRightsAuthority,
  trustedAcceptanceAuthority,
  sfxAssetInventory = story.sfx_asset_inventory || story.sfx_assets || [],
  sfxRightsLedger = story.sfx_rights_ledger || story.sfx_rights || [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const durationS = Number(localTimeline.duration_s || localTimeline.durationS || 58);
  const visualEditorialPolicy = resolvePulseVisualEditorialPolicy(story);
  const motionCanvasContract = buildPulseMotionCanvasContract({ format: "SHORT" });
  const editorialExceptionPlan = buildPulseEditorialExceptionPlan({
    format: "SHORT",
    episode_id: story.id,
    segments: [
      ...asArray(story.motion_canvas_editorial_exceptions),
      ...asArray(story.editorial_exception_segments),
      ...asArray(footagePlan.motion_canvas_editorial_exceptions),
      ...asArray(footagePlan.editorial_exception_segments),
    ],
    trusted_rights_authority: trustedRightsAuthority,
    trusted_acceptance_authority: trustedAcceptanceAuthority,
    usage_scope: {
      platform: "youtube_shorts",
      ypp_monetisation_requested: true,
      paywall_distribution_requested: false,
      resale_requested: false,
    },
  });
  const coreShots = buildCoreShots({ story, localTimeline, retentionIntelligence });
  const patternShots = retentionPatternShots(retentionIntelligence);
  const motionShots = buildMotionShots({
    footagePlan,
    durationS,
    preferredMotionSceneCount:
      visualEditorialPolicy.preferred_motion_scene_count,
  });
  const creativeIdentity = resolvePulseVisualIdentity(story);
  const platformVisualLanguage =
    creativeIdentity.platform_visual_language || {};
  const engagementElementPlan = buildEngagementElementPlan({
    story,
    visualEditorialPolicy,
    platformVisualLanguage,
  });
  const shotPlan = sortShots([...coreShots, ...motionShots, ...patternShots]).map((shot) => ({
    ...shot,
    ...(shot.kind === "motion_clip"
      ? {
          canvas_role: "FULL_BLEED_MOTION_CANVAS",
          canvas_type: "GAMEPLAY",
        }
      : {
          presentation_role: "OVERLAY",
          underlying_canvas_required: "FULL_BLEED_GAME_MOTION",
        }),
    creative_category: creativeIdentity.category,
    creative_motion_mode: creativeIdentity.motion_mode,
    creative_transition_family: creativeIdentity.transition_family,
    platform_visual_language_id: platformVisualLanguage.id || "neutral",
    platform_visual_motif:
      platformVisualLanguage.motif || "pulse_signal_matrix",
    platform_motion_signature:
      platformVisualLanguage.motion_signature || "signal_trace",
    animated_element_family: animatedElementFamilyForShot(shot),
  }));
  const motionEvidence = motionReadinessEvidence({ footagePlan, motionShots });
  const footageBlockers = asArray(footagePlan.readiness?.blockers);
  const blockers = [...new Set(filterStaleMotionBlockers(footageBlockers, motionEvidence))];
  const warnings = [...new Set(asArray(footagePlan.readiness?.warnings))];
  if (!motionEvidence.actual_motion_clip_minimum_met) {
    blockers.push("actual_motion_clip_minimum_not_met");
  }
  if (!motionEvidence.distinct_motion_families_minimum_met) {
    blockers.push("distinct_motion_families_minimum_not_met");
  }
  if (!motionEvidence.distinct_motion_source_assets_minimum_met) {
    blockers.push("distinct_motion_source_assets_minimum_not_met");
  }
  for (const blocker of editorialExceptionPlan.blockers) {
    if (!blockers.includes(blocker)) blockers.push(blocker);
  }
  for (const warning of editorialExceptionPlan.warnings) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  const soundTransitionPlan = buildVisualV4SoundTransitionPlan({
    shotPlan,
    durationS,
    generatedAt,
    sfxAssetInventory,
    sfxRightsLedger,
  });
  const transitionPlan = soundTransitionPlan.transitions;
  const sfxPlan = soundTransitionPlan.sfx;
  for (const blocker of asArray(soundTransitionPlan.readiness?.blockers)) {
    blockers.push(blocker);
  }

  const plan = {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "visual_v4_director_brain",
    local_only: true,
    story_id: story.id || null,
    creative_identity: creativeIdentity,
    creative_rhythm: PREMIUM_EDIT_RHYTHM_V5,
    visual_editorial_policy: visualEditorialPolicy,
    motion_canvas_contract: motionCanvasContract,
    editorial_exception_plan: editorialExceptionPlan,
    platform_visual_language: platformVisualLanguage,
    engagement_element_plan: engagementElementPlan,
    readiness: {
      status: blockers.length ? "director_blocked" : "director_ready",
      blockers,
      warnings,
    },
    shot_budget: {
      min_actual_motion_clips: Number(footagePlan.motion_budget?.required_motion_scenes || 5),
      available_motion_clips: Number(footagePlan.motion_budget?.available_motion_clips || 0),
      min_distinct_motion_families: Number(footagePlan.motion_budget?.required_distinct_families || 4),
      available_distinct_motion_families: Number(
        footagePlan.motion_budget?.available_distinct_families || 0,
      ),
      min_distinct_motion_source_assets: Number(
        footagePlan.motion_budget?.required_distinct_source_assets ||
          footagePlan.motion_budget?.required_distinct_base_sources ||
          footagePlan.motion_budget?.required_distinct_families ||
          4,
      ),
      available_distinct_motion_source_assets: Number(
        footagePlan.motion_budget?.available_distinct_source_assets ||
          footagePlan.motion_budget?.available_distinct_base_sources ||
          0,
      ),
      max_static_card_ratio: Math.min(
        Number(footagePlan.motion_budget?.max_static_card_ratio || PREMIUM_EDIT_RHYTHM_V5.max_generated_card_duration_ratio),
        PREMIUM_EDIT_RHYTHM_V5.max_generated_card_duration_ratio,
        Number(
          visualEditorialPolicy.maximum_context_card_duration_ratio ||
            PREMIUM_EDIT_RHYTHM_V5.max_generated_card_duration_ratio,
        ),
      ),
      max_static_card_seconds: Number(footagePlan.motion_budget?.max_static_card_seconds || 14),
      target_motion_ratio: Math.max(
        Number(footagePlan.motion_budget?.target_motion_ratio || 0.64),
        Number(visualEditorialPolicy.target_authentic_motion_ratio || 0.72),
      ),
      preferred_motion_scene_count: Number(
        visualEditorialPolicy.preferred_motion_scene_count || 10,
      ),
      max_fullscreen_card_scenes: PREMIUM_EDIT_RHYTHM_V5.max_generated_card_scene_count,
      max_narrative_fullscreen_card_scenes:
        PREMIUM_EDIT_RHYTHM_V5.max_narrative_card_scene_count,
    },
    shot_plan: shotPlan,
    sound_transition_plan: soundTransitionPlan,
    transition_plan: transitionPlan,
    sfx_plan: sfxPlan,
    visual_obligations: {
      forbid_empty_rectangles: true,
      forbid_text_on_text: true,
      source_locks_must_be_readable: true,
      chart_numbers_must_be_large: true,
      no_bottom_safety_band_unless_subtitles_need_it: true,
      cards_are_context_only: true,
      use_actual_motion_before_static_cards: true,
      fullscreen_cards_are_context_only: true,
      no_adjacent_fullscreen_cards: true,
      source_lock_is_compact_provenance: true,
      continuous_full_bleed_game_motion_canvas_required:
        visualEditorialPolicy.continuous_full_bleed_game_motion_canvas_required === true,
      text_and_evidence_default_presentation:
        visualEditorialPolicy.text_and_evidence_default_presentation,
      fullscreen_evidence_requires_bounded_necessity_exception: true,
      comparison_footage_counts_as_full_bleed_motion:
        visualEditorialPolicy.comparison_footage_counts_as_full_bleed_motion === true,
      unrelated_filler_forbidden:
        visualEditorialPolicy.unrelated_filler_forbidden === true,
      cta_and_outro_require_game_motion_canvas:
        visualEditorialPolicy.cta_and_outro_require_game_motion_canvas === true,
      rights_ledger_still_authoritative:
        visualEditorialPolicy.rights_ledger_still_authoritative === true,
      green_cleared_sources_may_be_continuous_canvas: true,
      amber_editorial_exceptions_are_brief_claim_bound_evidence_only: true,
      editorial_exception_credit_is_not_clearance: true,
      editorial_exception_requires_hash_bound_episode_review: true,
      green_control_tower_still_required_for_publish: true,
      authentic_game_media_is_visual_backbone_when_available:
        visualEditorialPolicy.authentic_game_media_is_default_backbone === true,
      animated_context_layer_required:
        visualEditorialPolicy.animated_context_is_required === true,
      generic_abstract_visuals_are_fallback_only:
        visualEditorialPolicy.generic_ai_or_abstract_visuals_when_relevant_game_media_exists ===
        "fallback_only",
      platform_story_theme_required:
        visualEditorialPolicy.platform_story_theme_required === true,
      pulse_brand_boundary_required:
        visualEditorialPolicy.pulse_brand_boundary_required === true,
    },
    caption_policy: {
      subtitles_last: true,
      clean_manual_captions: true,
      manual_caption_generated: true,
      subtitle_timing_source: "timestamps",
      snap_to_local_word_timing: true,
      max_caption_desync_ms: 120,
      avoid_lower_third_collisions: true,
      preserve_numeric_formatting: ["178,009", "$120"],
    },
    render_adjustments: {
      director_brain_version: "v1",
      creative_system_version: CREATIVE_SYSTEM_VERSION,
      creative_category: creativeIdentity.category,
      creative_motion_mode: creativeIdentity.motion_mode,
      creative_transition_cycle: [...creativeIdentity.transition_cycle],
      platform_visual_language_version:
        platformVisualLanguage.version || null,
      platform_visual_language_id:
        platformVisualLanguage.id || "neutral",
      platform_motion_signature:
        platformVisualLanguage.motion_signature || "signal_trace",
      visual_editorial_policy_version: visualEditorialPolicy.version,
      engagement_element_plan_version: engagementElementPlan.version,
      visual_v4_enabled: true,
      suppress_repeated_clip_windows: true,
      suppress_placeholder_cards: true,
      retention_pattern_interrupts: patternShots.length,
      steam_metric_first: wantsEarlyMetric(retentionIntelligence),
    },
    safety: {
      local_only: true,
      planner_only: true,
      video_downloads_started: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
      elevenlabs_required: false,
    },
  };

  plan.shot_budget.min_actual_motion_clips = motionEvidence.min_actual_motion_clips;
  plan.shot_budget.available_motion_clips = Math.max(
    Number(plan.shot_budget.available_motion_clips || 0),
    motionEvidence.available_motion_clips,
  );
  plan.shot_budget.min_distinct_motion_families =
    motionEvidence.min_distinct_motion_families;
  plan.shot_budget.available_distinct_motion_families = Math.max(
    Number(plan.shot_budget.available_distinct_motion_families || 0),
    motionEvidence.available_distinct_motion_families,
  );
  plan.shot_budget.min_distinct_motion_source_assets =
    motionEvidence.min_distinct_motion_source_assets;
  plan.shot_budget.available_distinct_motion_source_assets = Math.max(
    Number(plan.shot_budget.available_distinct_motion_source_assets || 0),
    motionEvidence.available_distinct_motion_source_assets,
  );

  plan.media_house_benchmark = runMediaHouseBenchmark({
    story,
    directorPlan: plan,
    requireGate: false,
  });

  return plan;
}

module.exports = {
  buildVisualV4DirectorPlan,
};
