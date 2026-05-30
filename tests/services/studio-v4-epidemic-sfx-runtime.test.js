"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyEpidemicSfxRuntimeManifestToStory,
  sfxRuntimeAssetsFromManifest,
} = require("../../lib/studio/v4/epidemic-sfx-runtime");
const {
  buildVisualV4SoundTransitionPlan,
} = require("../../lib/studio/v4/sound-transition-planner");

function runtimeManifest() {
  return {
    schema_version: 1,
    provider_id: "epidemic_sound",
    readiness: { status: "ready", blockers: [] },
    selected_assets: [
      {
        asset_id: "epidemic-impact",
        role: "impact",
        family: "impact",
        provider_id: "epidemic_sound",
        source_url: "file://C:/pulse/audio/epidemic/sfx/editorial-impact.wav",
        rights_basis: "epidemic_sound_active_subscription_safelisted_channel",
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
    variant_assets_by_role: {
      transition: [
        {
          asset_id: "epidemic-transition",
          role: "transition",
          family: "transition",
          provider_id: "epidemic_sound",
          source_url: "file://C:/pulse/audio/epidemic/sfx/editorial-fast-whoosh.wav",
          license: "epidemic_sound_active_subscription_safelisted_channel",
          approval_status: "approved_for_commercial_editorial_use",
        },
      ],
      ui_tick: [
        {
          asset_id: "epidemic-ui-click",
          role: "ui_tick",
          family: "ui_tick",
          provider_id: "epidemic_sound",
          source_url: "file://C:/pulse/audio/epidemic/sfx/user-interface-click-standard-short-clean.wav",
          license: "epidemic_sound_active_subscription_safelisted_channel",
          approval_status: "approved_for_commercial_editorial_use",
        },
      ],
      sub_hit: [
        {
          asset_id: "epidemic-sub",
          role: "sub_hit",
          family: "sub_hit",
          provider_id: "epidemic_sound",
          source_url: "file://C:/pulse/audio/epidemic/sfx/designed-boom-low-hit.wav",
          license: "epidemic_sound_active_subscription_safelisted_channel",
          approval_status: "approved_for_commercial_editorial_use",
        },
      ],
    },
    rights_records: [
      {
        asset_id: "epidemic-impact",
        asset_type: "sfx",
        role: "impact",
        provider_id: "epidemic_sound",
        licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
        commercial_use_allowed: true,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "epidemic-transition",
        asset_type: "sfx",
        role: "transition",
        provider_id: "epidemic_sound",
        licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
        commercial_use_allowed: true,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "epidemic-ui-click",
        asset_type: "sfx",
        role: "ui_tick",
        provider_id: "epidemic_sound",
        licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
        commercial_use_allowed: true,
        approval_status: "approved_for_commercial_editorial_use",
      },
      {
        asset_id: "epidemic-sub",
        asset_type: "sfx",
        role: "sub_hit",
        provider_id: "epidemic_sound",
        licence_basis: "epidemic_sound_active_subscription_safelisted_channel",
        commercial_use_allowed: true,
        approval_status: "approved_for_commercial_editorial_use",
      },
    ],
  };
}

test("Epidemic SFX runtime manifest exposes selected and variant assets with rights evidence", () => {
  const { assets, rightsRecords } = sfxRuntimeAssetsFromManifest(runtimeManifest());

  assert.deepEqual(
    assets.map((asset) => asset.asset_id).sort(),
    ["epidemic-impact", "epidemic-sub", "epidemic-transition", "epidemic-ui-click"],
  );
  assert.equal(assets.every((asset) => asset.provider_id === "epidemic_sound"), true);
  assert.equal(assets.every((asset) => asset.licence_basis), true);
  assert.equal(rightsRecords.length, 4);
});

test("Epidemic SFX runtime manifest bridges live stories into the V4 sound source gate", () => {
  const story = { id: "sfx-live-bridge", title: "Destiny 2 Needs Better SFX" };
  applyEpidemicSfxRuntimeManifestToStory(story, runtimeManifest());

  const plan = buildVisualV4SoundTransitionPlan({
    shotPlan: [
      { id: "hook", kind: "hook_slam", startS: 0 },
      { id: "source", kind: "source_lock", startS: 2.4 },
      { id: "clip", kind: "motion_clip", startS: 4.8 },
      { id: "caveat", kind: "context_caveat", startS: 8.2 },
    ],
    sfxAssetInventory: story.sfx_asset_inventory,
    sfxRightsLedger: story.sfx_rights_ledger,
  });

  assert.equal(plan.readiness.verdict, "pass");
  assert.deepEqual(plan.sfx.source_plan.readiness.blockers, []);
  assert.ok(plan.sfx.source_plan.covered_roles.includes("impact"));
  assert.ok(plan.sfx.source_plan.covered_roles.includes("transition"));
  assert.ok(plan.sfx.source_plan.covered_roles.includes("ui_tick"));
  assert.ok(plan.sfx.source_plan.covered_roles.includes("sub_hit"));
});
