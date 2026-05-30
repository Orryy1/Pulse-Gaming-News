"use strict";

const {
  buildVisualV4SoundTransitionPlan,
} = require("./sound-transition-planner");
const { runMediaHouseBenchmark } = require("../../media-house-benchmark");

const PREMIUM_BENCHMARK_MOTION_SCENES = 8;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
    story.tts_script,
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
  if (/\b(?:controller|headset|hardware|accessory|steam deck)\b/.test(lower)) {
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
    .toUpperCase()
    .slice(0, 28) || "SOURCE";
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
  const seen = new Set();
  const clips = [];
  const repeats = [];
  for (const clip of asArray(footagePlan.motion_inventory?.accepted_local_clips)) {
    const family = cleanText(clip.source_family);
    if (!family) continue;
    if (seen.has(family)) {
      repeats.push({
        id: clip.id || `motion_repeat_${repeats.length + 1}`,
        source_family: family,
        path: clip.path || null,
        durationS: round(clip.durationS || 2.4, 3),
      });
      continue;
    }
    seen.add(family);
    clips.push({
      id: clip.id || `motion_${clips.length + 1}`,
      source_family: family,
      path: clip.path || null,
      durationS: round(clip.durationS || 2.4, 3),
    });
  }
  return [...clips, ...repeats.slice(0, Math.max(0, Number(targetCount || 0) - clips.length))];
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

function buildMotionShots({ footagePlan = {}, durationS }) {
  const minActual = Number(footagePlan.motion_budget?.required_motion_scenes || 5);
  const clips = uniqueMotionClips(
    footagePlan,
    Math.max(minActual, PREMIUM_BENCHMARK_MOTION_SCENES),
  );
  const selectedCount = Math.max(
    0,
    Math.max(minActual, Math.min(PREMIUM_BENCHMARK_MOTION_SCENES, clips.length)),
  );
  const selected = clips.slice(0, selectedCount);
  const starts = motionShotTimes(durationS, selected.length);
  return selected.map((clip, index) => ({
    id: `motion_clip_${String(index + 1).padStart(2, "0")}`,
    kind: "motion_clip",
    startS: round(starts[index], 3),
    durationS: round(Math.min(3.6, Math.max(2.1, clip.durationS || 2.4)), 3),
    source_family: clip.source_family,
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
  const materialisedMotionShots = asArray(motionShots).filter(
    (shot) => cleanText(shot.media_path) && cleanText(shot.source_family),
  );
  const distinctFamilies = new Set(
    materialisedMotionShots.map((shot) => cleanText(shot.source_family)),
  );
  return {
    min_actual_motion_clips: minActualMotionClips,
    min_distinct_motion_families: minDistinctMotionFamilies,
    available_motion_clips: materialisedMotionShots.length,
    available_distinct_motion_families: distinctFamilies.size,
    actual_motion_clip_minimum_met: materialisedMotionShots.length >= minActualMotionClips,
    distinct_motion_families_minimum_met:
      distinctFamilies.size >= minDistinctMotionFamilies,
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
    id === "no_trusted_footage_references_for_story" &&
    evidence.actual_motion_clip_minimum_met &&
    evidence.distinct_motion_families_minimum_met
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
      durationS: 2.2,
      source: sourceLabel(story),
      priority: 86,
      visual_treatment: "large readable source bug",
    },
  ];

  if (commaMetric) {
    shots.push({
      id: "steam_chart",
      kind: "steam_chart",
      startS: earlyMetric ? 2.55 : Math.max(3.6, beatStart(localTimeline, commaMetric, 13.8) - 0.25),
      durationS: earlyMetric ? 3.4 : 3.8,
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
      durationS: 2.8,
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
      durationS: 2.5,
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
      durationS: 2.35,
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
      durationS: 2.5,
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

function buildVisualV4DirectorPlan({
  story = {},
  footagePlan = {},
  localTimeline = {},
  retentionIntelligence = {},
  sfxAssetInventory = story.sfx_asset_inventory || story.sfx_assets || [],
  sfxRightsLedger = story.sfx_rights_ledger || story.sfx_rights || [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const durationS = Number(localTimeline.duration_s || localTimeline.durationS || 58);
  const coreShots = buildCoreShots({ story, localTimeline, retentionIntelligence });
  const patternShots = retentionPatternShots(retentionIntelligence);
  const motionShots = buildMotionShots({ footagePlan, durationS });
  const shotPlan = sortShots([...coreShots, ...motionShots, ...patternShots]);
  const motionEvidence = motionReadinessEvidence({ footagePlan, motionShots });
  const footageBlockers = asArray(footagePlan.readiness?.blockers);
  const blockers = [...new Set(filterStaleMotionBlockers(footageBlockers, motionEvidence))];
  const warnings = [...new Set(asArray(footagePlan.readiness?.warnings))];

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
      max_static_card_ratio: Number(footagePlan.motion_budget?.max_static_card_ratio || 0.28),
      max_static_card_seconds: Number(footagePlan.motion_budget?.max_static_card_seconds || 14),
      target_motion_ratio: Number(footagePlan.motion_budget?.target_motion_ratio || 0.64),
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
