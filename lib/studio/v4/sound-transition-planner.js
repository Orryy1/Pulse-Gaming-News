"use strict";

const {
  buildCreatorStudioSfxSourcingPlan,
} = require("./sfx-source-registry");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function cueFamilyForShot(shot = {}, index = 0, motionIndex = 0) {
  switch (shot.kind) {
    case "hook_slam":
      return "impact";
    case "steam_chart":
      return "chart_tick";
    case "source_lock":
      return "source_tick";
    case "review_score_card":
      return "source_tick";
    case "pattern_interrupt":
      return "transition_hit";
    case "price_snap":
      return "cash_snap";
    case "context_caveat":
      return "sub_hit";
    case "motion_clip":
      return motionIndex % 2 === 0 ? "whoosh" : "transition_hit";
    default:
      return index % 3 === 0 ? "whoosh" : "transition_hit";
  }
}

function localAssetFamily(family) {
  switch (family) {
    case "impact":
      return "audio/sfx/impact";
    case "chart_tick":
    case "source_tick":
      return "audio/sfx/reveal";
    case "cash_snap":
      return "audio/sfx/impact";
    case "riser":
      return "audio/sfx/riser";
    case "whoosh":
    case "transition_hit":
      return "audio/sfx/transition";
    case "sub_hit":
    case "reveal":
    default:
      return "audio/sfx/reveal";
  }
}

function gainForFamily(family) {
  switch (family) {
    case "impact":
    case "cash_snap":
      return -7.5;
    case "riser":
      return -11.5;
    case "chart_tick":
    case "source_tick":
      return -12;
    default:
      return -10;
  }
}

function enforceMinimumSpacing(cues, minGapS = 0.35) {
  const sorted = asArray(cues)
    .map((cue) => ({ ...cue }))
    .sort((a, b) => Number(a.atS || 0) - Number(b.atS || 0));
  let previous = -Infinity;
  for (const cue of sorted) {
    const at = Number(cue.atS || 0);
    cue.atS = round(Math.max(at, previous + minGapS), 3);
    previous = cue.atS;
  }
  return sorted;
}

function maxRun(items, key) {
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

function deRepeatFamilies(cues) {
  const alternates = ["whoosh", "transition_hit", "reveal", "sub_hit"];
  const out = asArray(cues).map((cue) => ({ ...cue }));
  let run = 1;
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].family === out[i - 1].family) run += 1;
    else run = 1;
    if (run <= 2) continue;
    const replacement = alternates.find((family) => family !== out[i - 1].family) || "whoosh";
    out[i].family = replacement;
    out[i].local_asset_family = localAssetFamily(replacement);
    out[i].gainDb = gainForFamily(replacement);
    run = 1;
  }
  return out;
}

function cuesWithMaterialisedSourceRequirements(cues = []) {
  return asArray(cues).filter((cue) => cue && cue.family);
}

function buildSfx(shotPlan = [], { sfxAssetInventory = [], sfxRightsLedger = [], generatedAt } = {}) {
  let motionIndex = 0;
  const raw = asArray(shotPlan).map((shot, index) => {
    const currentMotionIndex = shot.kind === "motion_clip" ? motionIndex++ : 0;
    const family = cueFamilyForShot(shot, index, currentMotionIndex);
    return {
      id: `v4_sfx_${String(index + 1).padStart(2, "0")}`,
      target: shot.id || `shot_${index + 1}`,
      target_kind: shot.kind || "shot",
      atS: round(shot.startS || 0, 3),
      family,
      local_asset_family: localAssetFamily(family),
      gainDb: gainForFamily(family),
      duckGroup: "under_narration",
    };
  });
  const cues = enforceMinimumSpacing(deRepeatFamilies(raw));
  const sourcedCues = cuesWithMaterialisedSourceRequirements(cues);
  const sourcePlan = buildCreatorStudioSfxSourcingPlan({
    cues: sourcedCues,
    installedAssets: sfxAssetInventory,
    rightsLedger: sfxRightsLedger,
    generatedAt,
  });
  return {
    cue_count: cues.length,
    cues: cues.map((cue) => ({
      ...cue,
      source_requirement: {
        creator_studio_asset_required: true,
        retained_rights_record_required: true,
      },
    })),
    max_same_family_run: maxRun(cues, "family") || 0,
    source_plan: sourcePlan,
    mastering: {
      narration_priority: true,
      duck_under_narration: true,
      sidechain_release_ms: 420,
      limiter: true,
      target_peak_db: -1.5,
      local_only: true,
    },
  };
}

function transitionFamilyForShot(shot = {}, index = 0, motionIndex = 0) {
  if (shot.kind === "steam_chart") return "chart_slam";
  if (shot.kind === "source_lock") return "source_wipe";
  if (shot.kind === "motion_clip") return motionIndex % 2 === 0 ? "speed_ramp" : "whip_pan";
  if (shot.kind === "pattern_interrupt") return "wipe";
  return "hard_cut";
}

function buildTransitions(shotPlan = []) {
  let motionIndex = 0;
  const raw = asArray(shotPlan)
    .slice(1)
    .map((shot, index) => {
      const currentMotionIndex = shot.kind === "motion_clip" ? motionIndex++ : 0;
      return {
        id: `v4_transition_${String(index + 1).padStart(2, "0")}`,
        into: shot.id || `shot_${index + 2}`,
        atS: round(Math.max(0, Number(shot.startS || 0) - 0.04), 3),
        family: transitionFamilyForShot(shot, index, currentMotionIndex),
        durationS:
          shot.kind === "steam_chart" || shot.kind === "pattern_interrupt"
            ? 0.18
            : shot.kind === "motion_clip"
              ? 0.12
              : 0.08,
      };
    });
  const planned = deRepeatTransitionFamilies(raw);
  return {
    planned,
    required_families: [
      "hard_cut",
      "speed_ramp",
      "chart_slam",
      "source_wipe",
      "whip_pan",
      "wipe",
    ],
    max_same_family_run: maxRun(planned, "family") || 0,
    max_same_transition_run: maxRun(planned, "family") || 0,
    rules: {
      no_empty_rectangles: true,
      no_text_on_text: true,
      no_bottom_subtitle_collision: true,
      cut_on_audio_beats: true,
      prefer_motion_to_card_wipes: true,
    },
  };
}

function deRepeatTransitionFamilies(transitions) {
  const alternates = ["hard_cut", "speed_ramp", "wipe", "whip_pan", "source_wipe"];
  const out = asArray(transitions).map((transition) => ({ ...transition }));
  let run = 1;
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].family === out[i - 1].family) run += 1;
    else run = 1;
    if (run <= 2) continue;
    const replacement =
      alternates.find((family) => family !== out[i - 1].family) || "hard_cut";
    out[i].family = replacement;
    run = 1;
  }
  return out;
}

function buildReadiness({ sfx, transitions }) {
  const warnings = [];
  const blockers = [];
  if (sfx.max_same_family_run > 2) {
    warnings.push({
      code: "repeated_sfx_kind",
      message: "Too many adjacent cues share one SFX family.",
    });
  }
  if (transitions.max_same_family_run > 2) {
    warnings.push({
      code: "repeated_transition_family",
      message: "Too many adjacent transitions share one family.",
    });
  }
  for (const blocker of asArray(sfx.source_plan?.readiness?.blockers)) {
    blockers.push(blocker);
  }
  return {
    verdict: blockers.length ? "blocked" : warnings.length ? "review" : "pass",
    blockers,
    warnings,
  };
}

function buildVisualV4SoundTransitionPlan({
  shotPlan = [],
  durationS = 60,
  generatedAt = new Date().toISOString(),
  sfxAssetInventory = [],
  sfxRightsLedger = [],
} = {}) {
  const sfx = buildSfx(shotPlan, { sfxAssetInventory, sfxRightsLedger, generatedAt });
  const transitions = buildTransitions(shotPlan);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "visual_v4_sound_transition_plan",
    local_only: true,
    duration_s: Number(durationS) || null,
    sfx,
    transitions,
    readiness: buildReadiness({ sfx, transitions }),
    safety: {
      local_only: true,
      planner_only: true,
      no_external_sfx_downloads: true,
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
    },
  };
}

module.exports = {
  buildVisualV4SoundTransitionPlan,
};
