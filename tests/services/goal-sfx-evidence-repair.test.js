"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildStorySfxManifest,
  mergeRightsRecords,
  repairGoalSfxEvidence,
} = require("../../lib/goal-sfx-evidence-repair");

function passSourcePlan() {
  return {
    readiness: { status: "pass", blockers: [] },
    selected_assets: [
      {
        asset_id: "sonniss-impact-01",
        role: "impact",
        family: "impact",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Trailer Impacts/Cinematic Impact Hit.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
        licence_evidence_url: "https://sonniss.com/gdc-bundle-license/",
      },
    ],
  };
}

test("goal SFX evidence repair stamps story packages and merges SFX rights records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-one");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-one", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), passSourcePlan());
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [
      {
        asset_id: "sonniss-impact-01",
        asset_type: "sfx",
        commercial_use_allowed: true,
        evidence_reference: "https://sonniss.com/gdc-bundle-license/",
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), { sfx_cue_count: 5 });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [{ asset_id: "clip-1", asset_type: "video" }],
  });

  const report = await repairGoalSfxEvidence({
    root,
    generatedAt: "2026-05-23T19:45:00.000Z",
  });

  assert.equal(report.readiness.status, "pass");
  assert.equal(report.summary.repaired_count, 1);
  const sfxManifest = await fs.readJson(path.join(artifactDir, "sfx_manifest.json"));
  assert.equal(sfxManifest.story_id, "story-one");
  assert.equal(sfxManifest.cue_count, 5);
  assert.equal(sfxManifest.source_plan.readiness.status, "pass");
  const rightsLedger = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.deepEqual(rightsLedger.records.map((record) => record.asset_id).sort(), [
    "clip-1",
    "sonniss-impact-01",
  ]);
  assert.equal(report.safety.no_db_mutation, true);
});

test("goal SFX evidence repair refuses to stamp blocked source plans", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-blocked-"));
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-one", artifact_dir: path.join(root, "output", "goal-proof", "batch", "story-one") },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: { status: "blocked", blockers: ["sfx_source:missing_role:impact"] },
    selected_assets: [],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), { records: [] });

  const report = await repairGoalSfxEvidence({ root });

  assert.equal(report.readiness.status, "blocked");
  assert.ok(report.readiness.blockers.includes("sfx_source_plan_not_pass"));
  assert.equal(report.summary.repaired_count, 0);
});

test("goal SFX evidence repair ignores missing catalogue roles that current renders do not use", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-story-roles-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-source-lock");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-source-lock", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: {
      status: "blocked",
      blockers: ["sfx_source:missing_role:riser"],
      warnings: [],
    },
    required_roles: ["impact", "transition", "ui_tick", "riser"],
    selected_assets: [
      {
        asset_id: "plain-editorial-click",
        role: "ui_tick",
        family: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/CB Sounddesign - Activation 2/UIClick_UI Click 33_CB Sounddesign_ACTIVATION2.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
      },
    ],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [
      {
        asset_id: "plain-editorial-click",
        asset_type: "sfx",
        role: "ui_tick",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/GDC2024/CB Sounddesign - Activation 2/UIClick_UI Click 33_CB Sounddesign_ACTIVATION2.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), { sfx_cue_count: 1 });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), {
    sound_transition_plan: {
      sfx: {
        cues: [
          { target_kind: "source_lock", family: "source_tick", atS: 2.4 },
          { target_kind: "motion_clip", family: "whoosh", atS: 4.6 },
          { target_kind: "hook_slam", family: "impact", atS: 0 },
        ],
      },
    },
  });

  const report = await repairGoalSfxEvidence({ root });
  const sfxManifest = await fs.readJson(path.join(artifactDir, "sfx_manifest.json"));

  assert.equal(report.readiness.status, "pass");
  assert.equal(report.summary.repaired_count, 1);
  assert.deepEqual(sfxManifest.source_plan.required_roles, ["ui_tick"]);
  assert.equal(sfxManifest.source_plan.readiness.status, "pass");
  assert.deepEqual(sfxManifest.selected_assets.map((asset) => asset.asset_id), ["plain-editorial-click"]);
  assert.ok(!sfxManifest.source_plan.readiness.blockers.includes("sfx_source:missing_role:riser"));
});

test("goal SFX evidence repair can plan without writing package artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-dry-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-one");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-one", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), passSourcePlan());
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [{ asset_id: "sonniss-impact-01" }],
  });
  await fs.ensureDir(artifactDir);

  const report = await repairGoalSfxEvidence({ root, dryRun: true });

  assert.equal(report.summary.planned_count, 1);
  assert.equal(await fs.pathExists(path.join(artifactDir, "sfx_manifest.json")), false);
});

test("goal SFX evidence repair refreshes stale pass manifests when the approved source plan changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-refresh-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-one");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-one", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: { status: "pass", blockers: [] },
    selected_assets: [
      {
        asset_id: "sonniss-sub-01",
        role: "sub_hit",
        family: "sub_hit",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Cinematic Impacts/Sub Hit Deep Trailer Impact.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
        licence_evidence_url: "https://sonniss.com/gdc-bundle-license/",
      },
    ],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [
      {
        asset_id: "sonniss-sub-01",
        asset_type: "sfx",
        role: "sub_hit",
        family: "sub_hit",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Cinematic Impacts/Sub Hit Deep Trailer Impact.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), { sfx_cue_count: 1 });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      selected_assets: [
        {
          asset_id: "old-water-impact",
          role: "impact",
          provider_id: "sonniss",
          source_url: "file://audio/sonniss/designed_water_impact.wav",
        },
      ],
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), { records: [] });

  const report = await repairGoalSfxEvidence({ root });

  assert.equal(report.summary.repaired_count, 1);
  const sfxManifest = await fs.readJson(path.join(artifactDir, "sfx_manifest.json"));
  assert.deepEqual(sfxManifest.selected_assets.map((asset) => asset.asset_id), ["sonniss-sub-01"]);
});

test("goal SFX evidence repair keeps rights merge idempotent", () => {
  const merged = mergeRightsRecords(
    { records: [{ asset_id: "clip-1" }, { asset_id: "sfx-1" }] },
    { records: [{ asset_id: "sfx-1" }, { asset_id: "sfx-2" }] },
  );

  assert.deepEqual(merged.records.map((record) => record.asset_id), ["clip-1", "sfx-1", "sfx-2"]);
  assert.equal(buildStorySfxManifest({ storyId: "x", sourcePlan: passSourcePlan() }).readiness.status, "pass");
});

test("goal SFX evidence repair rotates approved SFX variants by story id", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-variants-"));
  const firstDir = path.join(root, "output", "goal-proof", "batch", "story-alpha");
  const secondDir = path.join(root, "output", "goal-proof", "batch", "story-c");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-alpha", artifact_dir: firstDir },
    { story_id: "story-c", artifact_dir: secondDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: { status: "pass", blockers: [] },
    required_roles: ["transition"],
    selected_assets: [
      {
        asset_id: "editorial-transition-01",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/editorial-transition-01.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
      },
    ],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [
      {
        asset_id: "editorial-transition-01",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Orbital Emitter - Cinematic Transitions for Editors/27,Searing.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "editorial-transition-02",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Orbital Emitter - Cinematic Transitions for Editors/28,Searing.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "bad-boat-pass-by",
        role: "transition",
        family: "transition",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Dramatic Cat - Lake Boat/BOATMotr_Boat Mercury EXTERIOR Pass By.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });
  await fs.outputJson(path.join(firstDir, "audio_manifest.json"), { sfx_cue_count: 1 });
  await fs.outputJson(path.join(secondDir, "audio_manifest.json"), { sfx_cue_count: 1 });

  const report = await repairGoalSfxEvidence({
    root,
    generatedAt: "2026-05-23T22:35:00.000Z",
  });

  const first = await fs.readJson(path.join(firstDir, "sfx_manifest.json"));
  const second = await fs.readJson(path.join(secondDir, "sfx_manifest.json"));
  const selected = [
    first.selected_assets[0].asset_id,
    second.selected_assets[0].asset_id,
  ];

  assert.equal(report.summary.repaired_count, 2);
  assert.notEqual(selected[0], selected[1]);
  assert.ok(selected.every((id) => /^editorial-transition-0[12]$/.test(id)));
  assert.equal(first.source_plan.anti_repetition.variant_source, "story_id_hash");
});

test("goal SFX evidence repair keeps variant rotation inside the top editorial SFX tier", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-variant-quality-"));
  const firstDir = path.join(root, "output", "goal-proof", "batch", "story-alpha");
  const secondDir = path.join(root, "output", "goal-proof", "batch", "story-beta");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-alpha", artifact_dir: firstDir },
    { story_id: "story-beta", artifact_dir: secondDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: { status: "pass", blockers: [] },
    required_roles: ["glitch"],
    selected_assets: [
      {
        asset_id: "futuristic-data-glitch",
        role: "glitch",
        family: "glitch",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/BluezoneCorp - Futuristic User Interface/futuristic_user_interface_data_glitch_003.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
      },
    ],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [
      {
        asset_id: "futuristic-data-glitch",
        role: "glitch",
        family: "glitch",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/BluezoneCorp - Futuristic User Interface/futuristic_user_interface_data_glitch_003.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "retro-malfunction-glitch",
        role: "glitch",
        family: "glitch",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/BluezoneCorp - Retrofuturistic Computer/retrofuturistic_computer_glitch_malfunction_004.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });
  await fs.outputJson(path.join(firstDir, "audio_manifest.json"), { sfx_cue_count: 1 });
  await fs.outputJson(path.join(secondDir, "audio_manifest.json"), { sfx_cue_count: 1 });

  await repairGoalSfxEvidence({
    root,
    generatedAt: "2026-05-24T06:15:00.000Z",
  });

  const first = await fs.readJson(path.join(firstDir, "sfx_manifest.json"));
  const second = await fs.readJson(path.join(secondDir, "sfx_manifest.json"));
  assert.deepEqual(
    [first.selected_assets[0].asset_id, second.selected_assets[0].asset_id],
    ["futuristic-data-glitch", "futuristic-data-glitch"],
  );
  assert.equal(first.source_plan.anti_repetition.candidate_pool_size_by_role.glitch, 1);
});

test("goal SFX evidence repair does not fall back to stale environmental selected assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-no-env-fallback-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-one");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-one", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: { status: "pass", blockers: [] },
    required_roles: ["sub_hit"],
    selected_assets: [
      {
        asset_id: "old-rain-sub-hit",
        role: "sub_hit",
        family: "sub_hit",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Bolt - Backyard Rain & Thunder/RAIN_Distant Thunder and Rain Long Thunderstorm.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
      },
    ],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [
      {
        asset_id: "old-rain-sub-hit",
        role: "sub_hit",
        family: "sub_hit",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Bolt - Backyard Rain & Thunder/RAIN_Distant Thunder and Rain Long Thunderstorm.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), { sfx_cue_count: 1 });

  const report = await repairGoalSfxEvidence({ root });
  const sfxManifest = await fs.readJson(path.join(artifactDir, "sfx_manifest.json"));

  assert.equal(report.summary.repaired_count, 1);
  assert.equal(sfxManifest.source_plan.readiness.status, "blocked");
  assert.ok(sfxManifest.source_plan.readiness.blockers.includes("sfx_source:missing_role:sub_hit"));
  assert.deepEqual(sfxManifest.selected_assets, []);
  assert.doesNotMatch(JSON.stringify(sfxManifest), /rain|thunder/i);
});

test("goal SFX evidence repair merges only selected SFX rights records into story packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-selected-rights-only-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-one");
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-one", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: { status: "pass", blockers: [] },
    required_roles: ["impact"],
    selected_assets: [
      {
        asset_id: "clean-impact",
        role: "impact",
        family: "impact",
        provider_id: "sonniss",
        source_url: "file://audio/sonniss/Modern Cinematic Impact/clean-impact.wav",
        rights_basis: "sonniss_game_audio_gdc_bundle_license",
      },
    ],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [
      {
        asset_id: "clean-impact",
        asset_type: "sfx",
        role: "impact",
        source_url: "file://audio/sonniss/Modern Cinematic Impact/clean-impact.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
      {
        asset_id: "bad-rain-unused",
        asset_type: "sfx",
        role: "sub_hit",
        source_url: "file://audio/sonniss/Backyard Rain/RAIN_Distant Thunder.wav",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), { sfx_cue_count: 1 });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [
      { asset_id: "clip-1", asset_type: "video" },
      {
        asset_id: "bad-rain-unused",
        asset_type: "sfx",
        role: "sub_hit",
        source_url: "file://audio/sonniss/Backyard Rain/RAIN_Distant Thunder.wav",
      },
    ],
  });

  await repairGoalSfxEvidence({ root });

  const rightsLedger = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  const ids = rightsLedger.records.map((record) => record.asset_id);
  assert.ok(ids.includes("clean-impact"));
  assert.equal(ids.includes("bad-rain-unused"), false);
});

test("goal SFX evidence repair cleans stale unselected SFX rights when manifest already passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-repair-prune-existing-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-one");
  const selectedAsset = {
    asset_id: "clean-impact",
    role: "impact",
    family: "impact",
    provider_id: "sonniss",
    source_url: "file://audio/sonniss/Modern Cinematic Impact/clean-impact.wav",
    rights_basis: "sonniss_game_audio_gdc_bundle_license",
  };
  await fs.outputJson(path.join(root, "output", "goal-contract", "story-packages.json"), [
    { story_id: "story-one", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_source_plan.json"), {
    readiness: { status: "pass", blockers: [] },
    required_roles: ["impact"],
    selected_assets: [selectedAsset],
  });
  await fs.outputJson(path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"), {
    records: [
      {
        ...selectedAsset,
        asset_type: "sfx",
        licence_basis: "sonniss_game_audio_gdc_bundle_license",
        approval_status: "approved_for_commercial_editorial_use",
        commercial_use_allowed: true,
      },
    ],
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), { sfx_cue_count: 1 });
  await fs.outputJson(path.join(artifactDir, "sfx_manifest.json"), {
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      selected_assets: [selectedAsset],
    },
  });
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    records: [
      { asset_id: "clip-1", asset_type: "video" },
      { ...selectedAsset, asset_type: "sfx" },
      {
        asset_id: "bad-rain-unused",
        asset_type: "sfx",
        role: "sub_hit",
        source_url: "file://audio/sonniss/Backyard Rain/RAIN_Distant Thunder.wav",
      },
    ],
  });

  const report = await repairGoalSfxEvidence({ root });

  assert.equal(report.summary.repaired_count, 1);
  const rightsLedger = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  assert.deepEqual(rightsLedger.records.map((record) => record.asset_id).sort(), [
    "clean-impact",
    "clip-1",
  ]);
});
