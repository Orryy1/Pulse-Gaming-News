"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildAssetRecord,
  buildSfxLibraryIngestReport,
  providerForPath,
  roleForPath,
} = require("../../lib/studio/v4/sfx-library-ingest");

async function touchAudio(filePath) {
  await fs.outputFile(filePath, Buffer.alloc(16, 1));
}

test("Visual V4 SFX library ingest turns licensed local files into rights-backed source coverage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-ingest-"));
  const files = [
    path.join(root, "audio", "sonniss", "Publisher", "Glitch Static.wav"),
    path.join(root, "audio", "sonniss", "Publisher", "UI Tick.wav"),
    path.join(root, "audio", "licensed-sfx", "boom", "Trailer Impact.wav"),
    path.join(root, "audio", "licensed-sfx", "boom", "Sub Boom.wav"),
    path.join(root, "audio", "licensed-sfx", "soundly", "Fast Whoosh.wav"),
    path.join(root, "audio", "licensed-sfx", "pse", "Tension Riser.wav"),
  ];
  for (const file of files) await touchAudio(file);

  const report = buildSfxLibraryIngestReport({
    workspaceRoot: root,
    generatedAt: "2026-05-23T19:20:00.000Z",
  });

  assert.equal(report.summary.readiness, "pass");
  assert.equal(report.asset_inventory.length, 6);
  assert.deepEqual(report.source_plan.readiness.blockers, []);
  assert.deepEqual(report.source_plan.required_roles, [
    "glitch",
    "impact",
    "riser",
    "sub_hit",
    "transition",
    "ui_tick",
  ]);
  assert.equal(report.rights_ledger.records.length, 6);
  assert.ok(report.rights_ledger.records.every((record) => record.commercial_use_allowed === true));
  assert.ok(report.safety.no_downloads_started);
  assert.ok(report.safety.no_db_mutation);
});

test("Visual V4 SFX library ingest recognises retained Epidemic Sound files as optional licensed evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-epidemic-"));
  const files = [
    path.join(root, "audio", "epidemic", "sfx", "Cinematic Impact Hit.wav"),
    path.join(root, "audio", "epidemic", "sfx", "Editorial Fast Whoosh.wav"),
  ];
  for (const file of files) await touchAudio(file);

  const report = buildSfxLibraryIngestReport({
    workspaceRoot: root,
    roots: [path.join(root, "audio", "epidemic")],
    generatedAt: "2026-05-26T16:11:00.000Z",
  });

  assert.equal(report.asset_inventory.length, 2);
  assert.ok(report.asset_inventory.every((asset) => asset.provider_id === "epidemic_sound"));
  assert.ok(report.rights_ledger.records.every((record) => record.licence_basis.includes("epidemic_sound")));
  assert.ok(report.source_plan.selected_assets.some((asset) => asset.provider_id === "epidemic_sound"));
  assert.equal(report.safety.no_downloads_started, true);
  assert.equal(report.safety.no_posting, true);
});

test("Visual V4 SFX library ingest rejects the old generated bespoke kit as production-grade evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-bespoke-"));
  const localHit = path.join(root, "audio", "sfx", "impact", "punch-mid.wav");
  await touchAudio(localHit);

  const report = buildSfxLibraryIngestReport({
    workspaceRoot: root,
    roots: [path.join(root, "audio", "sfx")],
    generatedAt: "2026-05-23T19:22:00.000Z",
  });

  assert.equal(report.summary.readiness, "blocked");
  assert.equal(report.asset_inventory.length, 0);
  assert.ok(
    report.rejected_assets.some((asset) => asset.reason === "local_bespoke_sfx_not_creator_studio_grade"),
  );
  assert.ok(report.source_plan.readiness.blockers.includes("sfx_source:no_creator_studio_sfx_assets"));
});

test("Visual V4 SFX library ingest classifies providers and cue roles from safe local paths", () => {
  assert.equal(providerForPath("C:/audio/licensed-sfx/soundly/short-whoosh.wav").provider_id, "soundly");
  assert.equal(providerForPath("C:/audio/epidemic/sfx/editorial-whoosh.wav").provider_id, "epidemic_sound");
  assert.equal(providerForPath("C:/audio/sonniss/GameAudioGDC2024/static-glitch.wav").provider_id, "sonniss");
  assert.equal(roleForPath("C:/audio/licensed-sfx/pse/tension-riser.wav"), "riser");
  assert.equal(
    roleForPath(
      "C:/audio/sonniss/GDC2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/112,StringsSectionRiser.wav",
    ),
    "",
  );
  assert.equal(
    roleForPath(
      "C:/audio/sonniss/GDC2024/Orbital Emitter - Cinematic Transitions for Editors Volume 2/27,Searing Whoosh.wav",
    ),
    "transition",
  );
  assert.equal(roleForPath("C:/audio/licensed-sfx/boom/sub-boom.wav"), "sub_hit");

  const built = buildAssetRecord("C:/audio/licensed-sfx/boom/trailer-impact.wav", {
    workspaceRoot: "C:/workspace",
  });
  assert.equal(built.asset.provider_id, "boom_library");
  assert.equal(built.rightsRecord.evidence_reference.startsWith("https://"), true);
});

test("Visual V4 SFX library ingest rejects ambience, crowd and vehicle Foley as editorial hit roles", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-context-reject-"));
  const files = [
    path.join(
      root,
      "audio",
      "sonniss",
      "GDC2024",
      "Pole Position - Ambiences for Atmos Vol 2 - Suburb Outskirts",
      "AMB - Forest Edge - Many Birds - Wind - Atmos.wav",
    ),
    path.join(
      root,
      "audio",
      "sonniss",
      "GDC2024",
      "Pole Position - Subway Station",
      "Crowd - Stockholm - Subway Station - Tunnel - Busy.wav",
    ),
    path.join(
      root,
      "audio",
      "sonniss",
      "GDC2024",
      "Pole Position - Audi Ur-Quattro 1983",
      "Audi Quattro - Gear Stick Dry Movement - Engine.wav",
    ),
  ];
  for (const file of files) await touchAudio(file);

  assert.equal(roleForPath(files[0]), "");
  assert.equal(roleForPath(files[1]), "");
  assert.equal(roleForPath(files[2]), "");

  const report = buildSfxLibraryIngestReport({
    workspaceRoot: root,
    roots: [path.join(root, "audio", "sonniss")],
    generatedAt: "2026-05-23T19:24:00.000Z",
  });

  assert.equal(report.asset_inventory.length, 0);
  assert.ok(
    report.rejected_assets.every((asset) => asset.reason === "sfx_context_not_editorial_hit"),
  );
  assert.equal(report.summary.readiness, "blocked");
});

test("Visual V4 SFX library ingest rejects watery textures and weather beds as creator-studio hit roles", () => {
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/BluezoneCorp - Designed Water/Bluezone_BC0298_designed_water_impact_006.wav"),
    "",
  );
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/Bolt - Backyard Rain & Thunder/RAIN_Distant Thunder and Rain Long Thunderstorm.wav"),
    "",
  );
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/BluezoneCorp - Alien Interface/Bluezone_BC0300_alien_interface_sci_fi_texture_003.wav"),
    "",
  );
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/BluezoneCorp - Modern Cinematic Impact/Bluezone_BC0294_modern_cinematic_impact_boom_003.wav"),
    "impact",
  );
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/Jake Fielding - Haunted Metal Vol.1/DSGNBoom_Cinematic Metallic Hit, Boom, Trailer, Sub_JF_Haunted Metal Vol 1_02.wav"),
    "",
  );
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/CB Sounddesign - Activation 2/UIClick_UI Click 33_CB Sounddesign_ACTIVATION2.wav"),
    "ui_tick",
  );
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/Pole Position - The Metal Hit Sweeteners Library/Spade - HIT - Drumstick - Ring - Mute.wav"),
    "",
  );
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/Pole Position - Electric Guitar Pickup Interference/Interference - Guitar Pickup - Buzz Hum - Thin - Swells - Hits Thumps.wav"),
    "",
  );
  assert.equal(
    roleForPath("C:/audio/sonniss/GDC2024/Mechanical Wave - Glass/GLASBrk_Glass Break Hit_04_MWSFX_GL.wav"),
    "",
  );
});

test("Visual V4 SFX library ingest rejects field-recording leftovers and local boom utilities", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-editorial-reject-"));
  const files = [
    path.join(root, "audio", "sfx", "boom", "boom-cinema.wav"),
    path.join(root, "audio", "sonniss", "GDC2024", "InMotionAudio - Broken Hair Dryer", "OBJMisc_HairDryerOnOff04_InMotionAudio_BrokenHairDryer.wav"),
    path.join(root, "audio", "sonniss", "GDC2024", "Pole Position - The Plastic Textures Library", "Flexible Sewer Pipe Big - Broken - DROP - Thump - Mono.wav"),
    path.join(root, "audio", "sonniss", "GDC2024", "Dramatic Cat - Lake Boat - Mercury 4-stroke 60HP", "BOATMotr_Boat Mercury EXTERIOR Pass By Ride Away STEREO.wav"),
    path.join(root, "audio", "sonniss", "GDC2024", "InMotionAudio - Submerge", "WATRImpt_Impact20_InMotionAudio_Submerge.wav"),
    path.join(root, "audio", "sonniss", "GDC2024", "Justsoundeffects - Gore Mini Pack", "GOREFlsh_Flesh Drops on Floor 03_JSE_GMP.wav"),
  ];
  for (const file of files) await touchAudio(file);

  const report = buildSfxLibraryIngestReport({
    workspaceRoot: root,
    roots: [path.join(root, "audio")],
    generatedAt: "2026-05-23T22:20:00.000Z",
  });

  assert.equal(report.asset_inventory.length, 0);
  assert.equal(report.summary.readiness, "blocked");
  assert.ok(
    report.rejected_assets.some((asset) => asset.reason === "local_bespoke_sfx_not_creator_studio_grade"),
  );
  assert.ok(
    report.rejected_assets.filter((asset) => asset.reason === "sfx_context_not_editorial_hit").length >= 5,
  );
});

test("Visual V4 SFX library ingest rejects voice, haunted and prop-texture cues before rights export", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-bad-semantics-"));
  const files = [
    path.join(
      root,
      "audio",
      "sonniss",
      "GDC2024",
      "CB Sounddesign - Sci-Fi Voices Volume 02 Big Battle Robot",
      "Target acquired Engaging stealth mode.wav",
    ),
    path.join(
      root,
      "audio",
      "sonniss",
      "GDC2024",
      "Jake Fielding - Haunted Metal Vol.2 - Cinematic Creaks & Risers",
      "DSGNRise_Cinematic Metallic Riser, Trailer, Designed Eerie Wail_JF_Haunted Metal Vol 2_02.wav",
    ),
    path.join(
      root,
      "audio",
      "sonniss",
      "GDC2024",
      "BluezoneCorp - Stone Impact",
      "Bluezone_BC0297_stone_impact_015.wav",
    ),
    path.join(
      root,
      "audio",
      "sonniss",
      "GDC2024",
      "Rescopic Sound - Distinct Whooshes",
      "WHSH_Deviant-Whoosh Flabby Slow 09_RSCPC_DW.wav",
    ),
  ];
  for (const file of files) await touchAudio(file);

  const report = buildSfxLibraryIngestReport({
    workspaceRoot: root,
    roots: [path.join(root, "audio", "sonniss")],
    generatedAt: "2026-05-24T18:55:00.000Z",
  });

  assert.equal(report.asset_inventory.length, 0);
  assert.equal(report.rights_ledger.records.length, 0);
  assert.ok(report.rejected_assets.every((asset) => asset.reason === "sfx_context_not_editorial_hit"));
});
