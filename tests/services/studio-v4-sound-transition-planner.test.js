"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVisualV4SoundTransitionPlan,
} = require("../../lib/studio/v4/sound-transition-planner");

function shotPlan() {
  return [
    { id: "hook_slam", kind: "hook_slam", startS: 0, durationS: 2.4 },
    { id: "motion_01", kind: "motion_clip", startS: 0.35, durationS: 2.8 },
    { id: "steam_chart", kind: "steam_chart", startS: 2.55, durationS: 3.4 },
    { id: "source_lock", kind: "source_lock", startS: 4.55, durationS: 2.2 },
    { id: "review_score_card", kind: "review_score_card", startS: 8.0, durationS: 2.8 },
    { id: "motion_02", kind: "motion_clip", startS: 10.8, durationS: 2.7 },
    { id: "pattern_interrupt", kind: "pattern_interrupt", startS: 18.2, durationS: 2.1 },
    { id: "price_snap", kind: "price_snap", startS: 25.2, durationS: 2.5 },
    { id: "context_caveat", kind: "context_caveat", startS: 28.4, durationS: 2.5 },
    { id: "motion_03", kind: "motion_clip", startS: 39.4, durationS: 2.8 },
  ];
}

function creatorStudioSfxInventory() {
  return [
    {
      asset_id: "boom-impact-01",
      role: "impact",
      family: "impact",
      provider: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/impact-01.wav",
      licence_basis: "boom_library_media_license",
      approval_status: "approved_for_commercial_editorial_use",
      commercial_use_allowed: true,
    },
    {
      asset_id: "soundly-transition-01",
      role: "transition",
      family: "whoosh",
      provider: "soundly",
      source_url: "file://audio/licensed-sfx/soundly/transition-01.wav",
      licence_basis: "soundly_pro_commercial_use",
      approval_status: "approved_for_commercial_editorial_use",
      commercial_use_allowed: true,
    },
    {
      asset_id: "soundly-hit-01",
      role: "transition",
      family: "transition_hit",
      provider: "soundly",
      source_url: "file://audio/licensed-sfx/soundly/hit-01.wav",
      licence_basis: "soundly_pro_commercial_use",
      approval_status: "approved_for_commercial_editorial_use",
      commercial_use_allowed: true,
    },
    {
      asset_id: "sonniss-ui-01",
      role: "ui_tick",
      family: "source_tick",
      provider: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/ui-01.wav",
      licence_basis: "sonniss_game_audio_gdc_bundle_license",
      approval_status: "approved_for_commercial_editorial_use",
      commercial_use_allowed: true,
    },
    {
      asset_id: "sonniss-chart-01",
      role: "ui_tick",
      family: "chart_tick",
      provider: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/chart-01.wav",
      licence_basis: "sonniss_game_audio_gdc_bundle_license",
      approval_status: "approved_for_commercial_editorial_use",
      commercial_use_allowed: true,
    },
    {
      asset_id: "pse-riser-01",
      role: "riser",
      family: "riser",
      provider: "pro_sound_effects",
      source_url: "file://audio/licensed-sfx/pse/riser-01.wav",
      licence_basis: "pro_sound_effects_subscription_license",
      approval_status: "approved_for_commercial_editorial_use",
      commercial_use_allowed: true,
    },
    {
      asset_id: "boom-sub-01",
      role: "sub_hit",
      family: "sub_hit",
      provider: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/sub-01.wav",
      licence_basis: "boom_library_media_license",
      approval_status: "approved_for_commercial_editorial_use",
      commercial_use_allowed: true,
    },
  ];
}

test("Visual V4 sound planner maps key shots to varied SFX without fighting narration", () => {
  const plan = buildVisualV4SoundTransitionPlan({
    shotPlan: shotPlan(),
    durationS: 58,
    sfxAssetInventory: creatorStudioSfxInventory(),
  });
  const families = new Set(plan.sfx.cues.map((cue) => cue.family));

  assert.equal(plan.execution_mode, "visual_v4_sound_transition_plan");
  assert.equal(plan.local_only, true);
  assert.equal(plan.readiness.verdict, "pass");
  assert.ok(plan.sfx.cues.length >= 8);
  assert.ok(families.has("impact"));
  assert.ok(families.has("whoosh"));
  assert.ok(families.has("chart_tick"));
  assert.ok(families.has("transition_hit"));
  assert.equal(families.has("riser"), false);
  assert.ok(families.has("cash_snap"));
  assert.equal(plan.sfx.mastering.narration_priority, true);
  assert.equal(plan.sfx.mastering.duck_under_narration, true);
  assert.ok(plan.sfx.cues.every((cue) => cue.gainDb <= -6));
  assert.ok(plan.sfx.cues.every((cue) => cue.local_asset_family));
  assert.equal(plan.sfx.source_plan.readiness.status, "pass");
});

test("Visual V4 transition planner uses varied transitions and forbids empty rectangles", () => {
  const plan = buildVisualV4SoundTransitionPlan({
    shotPlan: shotPlan(),
    durationS: 58,
    sfxAssetInventory: creatorStudioSfxInventory(),
  });
  const families = new Set(plan.transitions.planned.map((transition) => transition.family));

  assert.ok(plan.transitions.planned.length >= shotPlan().length - 1);
  assert.ok(families.has("hard_cut"));
  assert.ok(families.has("speed_ramp"));
  assert.ok(families.has("chart_slam"));
  assert.ok(families.has("source_wipe"));
  assert.ok(families.has("whip_pan"));
  assert.equal(plan.transitions.rules.no_empty_rectangles, true);
  assert.equal(plan.transitions.rules.no_text_on_text, true);
  assert.equal(plan.transitions.rules.no_bottom_subtitle_collision, true);
  assert.ok(plan.transitions.max_same_family_run <= 2);
});

test("Visual V4 sound planner blocks renders when only newsroom tick cues are sourced", () => {
  const plan = buildVisualV4SoundTransitionPlan({
    shotPlan: shotPlan(),
    durationS: 58,
    sfxAssetInventory: [
      {
        asset_id: "sonniss-ui-01",
        role: "ui_tick",
        family: "source_tick",
        provider: "sonniss",
        source_url: "file://audio/licensed-sfx/sonniss/ui-01.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });

  assert.equal(plan.readiness.verdict, "blocked");
  assert.deepEqual(plan.sfx.source_plan.required_roles, ["impact", "sub_hit", "transition", "ui_tick"]);
  assert.deepEqual(plan.sfx.source_plan.covered_roles, ["ui_tick"]);
  assert.ok(plan.sfx.source_plan.readiness.blockers.includes("sfx_source:missing_role:impact"));
  assert.ok(plan.sfx.source_plan.readiness.blockers.includes("sfx_source:missing_role:transition"));
  assert.ok(plan.sfx.source_plan.readiness.blockers.includes("sfx_source:missing_role:sub_hit"));
  assert.ok(plan.sfx.cues.some((cue) => cue.family === "impact"));
});

test("Visual V4 sound planner de-periodises repetitive cue requests", () => {
  const repetitiveShots = Array.from({ length: 8 }, (_, index) => ({
    id: `motion_${index + 1}`,
    kind: "motion_clip",
    startS: index * 3,
    durationS: 2.4,
  }));
  const plan = buildVisualV4SoundTransitionPlan({
    shotPlan: repetitiveShots,
    durationS: 28,
    sfxAssetInventory: creatorStudioSfxInventory(),
  });

  assert.equal(plan.readiness.verdict, "pass");
  assert.equal(
    plan.readiness.warnings.some((warning) => warning.code === "periodic_sfx_spacing"),
    false,
  );
  assert.ok(plan.sfx.max_same_family_run <= 2);
  assert.ok(
    plan.sfx.cues.every((cue, index, cues) => {
      if (index === 0) return true;
      return cue.atS - cues[index - 1].atS >= 0.35;
    }),
  );
});

test("Visual V4 sound planner blocks production SFX when only local utility sounds are available", () => {
  const plan = buildVisualV4SoundTransitionPlan({
    shotPlan: shotPlan(),
    durationS: 58,
    sfxAssetInventory: [
      {
        asset_id: "local-whoosh",
        family: "whoosh",
        role: "transition",
        provider: "pulse_generated",
        source_url: "local://pulse-generated-sfx/whoosh",
        licence_basis: "owned_generated_utility_sfx",
        approval_status: "approved",
        commercial_use_allowed: true,
      },
    ],
  });

  assert.equal(plan.readiness.verdict, "blocked");
  assert.ok(plan.readiness.blockers.includes("sfx_source:local_bespoke_or_generated_only"));
  assert.ok(plan.sfx.source_plan.recommended_sources.length >= 4);
});
