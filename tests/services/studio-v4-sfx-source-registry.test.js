"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCreatorStudioSfxSourcingPlan,
  creatorStudioSfxSourceRegistry,
} = require("../../lib/studio/v4/sfx-source-registry");

function cues() {
  return [
    { id: "hook", family: "impact", target_kind: "hook_slam" },
    { id: "cut", family: "whoosh", target_kind: "motion_clip" },
    { id: "source", family: "source_tick", target_kind: "source_lock" },
    { id: "build", family: "riser", target_kind: "pattern_interrupt" },
  ];
}

test("creator-studio SFX sourcing rejects local generated utility sounds as production quality", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: cues(),
    installedAssets: [
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
    rightsLedger: [
      {
        asset_id: "local-whoosh",
        licence_basis: "owned_generated_utility_sfx",
        approval_status: "approved",
        commercial_use_allowed: true,
      },
    ],
    generatedAt: "2026-05-23T16:00:00.000Z",
  });

  assert.equal(plan.readiness.status, "blocked");
  assert.ok(plan.readiness.blockers.includes("sfx_source:local_bespoke_or_generated_only"));
  assert.ok(plan.readiness.blockers.includes("sfx_source:missing_role:impact"));
  assert.ok(plan.readiness.blockers.includes("sfx_source:missing_role:riser"));
  assert.ok(plan.recommended_sources.some((source) => source.provider_id === "boom_library"));
  assert.ok(plan.recommended_sources.some((source) => source.provider_id === "soundly"));
  assert.ok(plan.recommended_sources.some((source) => source.provider_id === "sonniss"));
  assert.equal(plan.safety.no_downloads_started, true);
});

test("creator-studio SFX sourcing passes when licensed premium libraries cover required cue roles", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: cues(),
    installedAssets: [
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
        asset_id: "pse-riser-01",
        role: "riser",
        family: "riser",
        provider: "pro_sound_effects",
        source_url: "file://audio/licensed-sfx/pse/riser-01.wav",
        licence_basis: "pro_sound_effects_subscription_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
    generatedAt: "2026-05-23T16:01:00.000Z",
  });

  assert.equal(plan.readiness.status, "pass");
  assert.deepEqual(plan.readiness.blockers, []);
  assert.equal(plan.covered_roles.length, 4);
  assert.ok(plan.selected_assets.every((asset) => asset.rights_basis));
  assert.ok(plan.selected_assets.every((asset) => asset.quality_tier === "creator_studio"));
});

test("creator-studio SFX registry carries rights evidence URLs for operator sourcing", () => {
  const registry = creatorStudioSfxSourceRegistry();

  assert.ok(registry.some((source) => source.provider_id === "boom_library"));
  assert.ok(registry.some((source) => source.provider_id === "epidemic_sound"));
  assert.ok(registry.some((source) => source.provider_id === "pro_sound_effects"));
  assert.ok(registry.every((source) => /^https:\/\//.test(source.licence_evidence_url)));
  assert.ok(registry.every((source) => source.allowed_use === "finished_editorial_video_only"));
});

test("creator-studio SFX sourcing can use Epidemic Sound when retained rights evidence is present", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [
      { id: "hook", family: "impact", role: "impact" },
      { id: "cut", family: "whoosh", role: "transition" },
    ],
    installedAssets: [
      {
        asset_id: "epidemic-editorial-impact",
        role: "impact",
        family: "impact",
        provider_id: "epidemic_sound",
        source_url: "file://audio/epidemic/sfx/cinematic-impact-hit.wav",
        licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
        evidence_reference: "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
      },
      {
        asset_id: "epidemic-fast-whoosh",
        role: "transition",
        family: "transition",
        provider_id: "epidemic_sound",
        source_url: "file://audio/epidemic/sfx/editorial-fast-whoosh.wav",
        licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
        evidence_reference: "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
      },
    ],
    generatedAt: "2026-05-26T16:10:00.000Z",
  });

  assert.equal(plan.readiness.status, "pass");
  assert.deepEqual(plan.readiness.blockers, []);
  assert.equal(plan.selected_assets.length, 2);
  assert.ok(plan.selected_assets.every((asset) => asset.provider_id === "epidemic_sound"));
  assert.ok(plan.selected_assets.every((asset) => asset.rights_basis.includes("epidemic_sound")));
});

test("creator-studio SFX sourcing keeps premium-provider files even when they live under audio/sfx", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [{ family: "sub_hit", role: "sub_hit" }],
    installedAssets: [
      {
        asset_id: "boom-sub-01",
        role: "sub_hit",
        family: "sub_hit",
        provider_id: "boom_library",
        source_url: "file://C:/workspace/audio/sfx/boom/boom-cinema.wav",
        licence_basis: "boom_library_media_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
    rightsLedger: [
      {
        asset_id: "boom-sub-01",
        licence_basis: "boom_library_media_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });

  assert.equal(plan.readiness.status, "pass");
  assert.equal(plan.selected_assets[0].provider_id, "boom_library");
  assert.equal(plan.selected_assets[0].role, "sub_hit");
});

test("creator-studio SFX sourcing prefers cinematic editorial cues over field-recording pass-bys", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [{ id: "cut", family: "whoosh", role: "transition" }],
    installedAssets: [
      {
        asset_id: "boat-pass-by",
        role: "transition",
        family: "transition",
        provider: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Dramatic Cat - Lake Boat/BOATMotr_Boat Mercury EXTERIOR Pass By Ride Away.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "editorial-whoosh",
        role: "transition",
        family: "transition",
        provider: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/27,Searing.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
    generatedAt: "2026-05-23T22:21:00.000Z",
  });

  assert.equal(plan.readiness.status, "pass");
  assert.equal(plan.selected_assets[0].asset_id, "editorial-whoosh");
  assert.ok(plan.selected_assets[0].editorial_sfx_score > 0.7);
});

test("creator-studio SFX sourcing avoids weak licensed cue matches for editorial roles", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [
      { id: "hook", family: "impact", role: "impact" },
      { id: "cut", family: "whoosh", role: "transition" },
      { id: "source", family: "source_tick", role: "ui_tick" },
    ],
    installedAssets: [
      {
        asset_id: "hammer-hit",
        role: "impact",
        family: "impact",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Pole Position - The Metal Hit Sweeteners Library/Iron - Thick - HIT - Hammer.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "modern-cinematic-impact",
        role: "impact",
        family: "impact",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/BluezoneCorp - Modern Cinematic Impact/Bluezone_BC0294_modern_cinematic_impact_boom_003.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "gong-transition",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/80,TheGong.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "scifi-whoosh",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - Distinct Whooshes/WHSH_Pure SciFi-Whoosh Fast 03_RSCPC_DW.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "lighter-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/BluezoneCorp - High Voltage/Bluezone_BC0299_electricity_electronic_lighter_button_click_on_off_002_02.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "qantum-ui",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Doex Studio - Qantum UI/UI_Noisy_Impact_09.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
    generatedAt: "2026-05-24T04:30:00.000Z",
  });

  const byRole = Object.fromEntries(plan.selected_assets.map((asset) => [asset.role, asset.asset_id]));
  assert.equal(byRole.impact, "modern-cinematic-impact");
  assert.equal(byRole.transition, "scifi-whoosh");
  assert.equal(byRole.ui_tick, undefined);
  assert.ok(plan.readiness.blockers.includes("sfx_source:missing_role:ui_tick"));
});

test("creator-studio SFX sourcing blocks licensed fantasy, horror and foley cues for newsroom videos", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [
      { id: "build", family: "riser", role: "riser" },
      { id: "low", family: "sub_hit", role: "sub_hit" },
      { id: "cut", family: "whoosh", role: "transition" },
      { id: "source", family: "source_tick", role: "ui_tick" },
      { id: "glitch", family: "glitch", role: "glitch" },
    ],
    installedAssets: [
      {
        asset_id: "dragon-reveal",
        role: "riser",
        family: "riser",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/08,DragonReveal - dramatic and recap.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "strings-riser",
        role: "riser",
        family: "riser",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/112,StringsSectionRiser.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "haunted-metal-hit",
        role: "sub_hit",
        family: "sub_hit",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Jake Fielding - Haunted Metal Vol. 1/haunted-metal-cinematic-metallic-hit-sub.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "mechanical-wave-hit",
        role: "sub_hit",
        family: "sub_hit",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Mechanical Wave - Cinematic Feel/Mechanical Wave cinematic hit.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "flabby-whoosh",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - Distinct Whooshes/WHSH_Deviant-Whoosh Flabby Slow 09_RSCPC_DW.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "pure-scifi-whoosh",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - Distinct Whooshes/WHSH_Pure SciFi-Whoosh Fast 03_RSCPC_DW.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "hostile-voice-line",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Cybernetix - Sci-Fi UI Voice/Hostile Territory Detected.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "activation-ui-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Glitchedtones - Activation User Interface/Activation_UI_Click_33.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "retro-glitch",
        role: "glitch",
        family: "glitch",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Retrofuturistic Computer/glitch malfunction 004.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "futuristic-data-glitch",
        role: "glitch",
        family: "glitch",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/BluezoneCorp - Futuristic User Interface/Bluezone_BC0298_futuristic_user_interface_data_glitch_003.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
    generatedAt: "2026-05-24T12:00:00.000Z",
  });

  const byRole = Object.fromEntries(plan.selected_assets.map((asset) => [asset.role, asset.asset_id]));
  const selectedIds = new Set(plan.selected_assets.map((asset) => asset.asset_id));

  assert.equal(plan.readiness.status, "blocked");
  assert.ok(plan.readiness.blockers.includes("sfx_source:missing_role:riser"));
  assert.equal(byRole.sub_hit, "mechanical-wave-hit");
  assert.equal(byRole.transition, "pure-scifi-whoosh");
  assert.equal(byRole.ui_tick, undefined);
  assert.equal(byRole.glitch, "futuristic-data-glitch");
  assert.equal(byRole.riser, undefined);
  assert.equal(selectedIds.has("dragon-reveal"), false);
  assert.equal(selectedIds.has("strings-riser"), false);
  assert.equal(selectedIds.has("haunted-metal-hit"), false);
  assert.equal(selectedIds.has("flabby-whoosh"), false);
  assert.equal(selectedIds.has("hostile-voice-line"), false);
  assert.equal(selectedIds.has("activation-ui-click"), false);
});

test("creator-studio SFX sourcing prefers subtle UI click ticks over noisy data-counter hits", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [{ id: "source", family: "source_tick", role: "ui_tick" }],
    installedAssets: [
      {
        asset_id: "noisy-impact",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Doex Studio - Qantum UI/UI_Noisy_Impact_09.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "data-counter",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/CB Sounddesign - Activation 2/UIData_Counter mid 54_CB Sounddesign_ACTIVATION2.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "data-progress",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - User Interaction/UIData_Progress 19_RSCPC_USIN.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "plastic-select",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Doex Studio - Qantum UI/UI_Select_Plastic_05.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "select-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - User Interaction/UIClick_Select Middle 29_RSCPC_USIN.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.equal(plan.readiness.status, "pass");
  assert.equal(plan.selected_assets[0].asset_id, "select-click");
  assert.ok(plan.selected_assets[0].editorial_sfx_score > 0.7);
});

test("creator-studio SFX sourcing rejects alert-confirm and activation UI ticks for source locks", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [{ id: "source", family: "source_tick", role: "ui_tick" }],
    installedAssets: [
      {
        asset_id: "alert-confirm",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - User Interaction/UIAlert_Confirm Middle 12_RSCPC_USIN.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "activation-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Glitchedtones - Activation User Interface/Activation_UI_Click_33.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "clean-select",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - User Interaction/UIClick_Select Middle 29_RSCPC_USIN.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.equal(plan.readiness.status, "pass");
  assert.equal(plan.selected_assets[0].asset_id, "clean-select");
  assert.ok(plan.selected_assets[0].editorial_sfx_score > 0.7);
});

test("creator-studio SFX sourcing blocks generic activation-pack clicks for source locks", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [{ id: "source", family: "source_tick", role: "ui_tick" }],
    installedAssets: [
      {
        asset_id: "activation-pack-ui-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/CB Sounddesign - Activation 2/UIClick_UI Click 33_CB Sounddesign_ACTIVATION2.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.equal(plan.readiness.status, "blocked");
  assert.equal(plan.selected_assets.length, 0);
  assert.ok(plan.readiness.blockers.includes("sfx_source:missing_role:ui_tick"));
});

test("creator-studio SFX sourcing prefers compact plain UI clicks over longer select sweeps", () => {
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues: [{ id: "source", family: "source_tick", role: "ui_tick" }],
    installedAssets: [
      {
        asset_id: "long-select-middle",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - User Interaction/UIClick_Select Middle 29_RSCPC_USIN.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "clean-user-interaction-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/Rescopic Sound - User Interaction/UIClick_UI Click Short 03_RSCPC_USIN.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "high-tech-beep",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/BluezoneCorp - Futuristic User Interface/Bluezone_BC0303_futuristic_user_interface_high_tech_beep_038.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  });

  assert.equal(plan.readiness.status, "pass");
  assert.equal(plan.selected_assets[0].asset_id, "clean-user-interaction-click");
  assert.ok(plan.selected_assets[0].editorial_sfx_score > 0.8);
});
