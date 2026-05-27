"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildEpidemicSoundIntakeReport,
} = require("../../lib/epidemic-sound-intake");
const {
  buildEpidemicSoundImplementationPlan,
  executeEpidemicSoundImplementation,
} = require("../../lib/epidemic-audio-pack-materializer");

async function touchAudio(filePath) {
  await fs.outputFile(filePath, Buffer.alloc(64, 7));
}

async function createCompleteEpidemicRoot(root) {
  const epidemicRoot = path.join(root, "audio", "epidemic");
  const files = [
    path.join(epidemicRoot, "music", "bed_primary", "epidemic_bed_primary_main-news.wav"),
    path.join(epidemicRoot, "music", "bed_breaking", "epidemic_bed_breaking_urgent-news.wav"),
    path.join(epidemicRoot, "stings", "sting_verified", "epidemic_sting_verified_source-lock.wav"),
    path.join(epidemicRoot, "stings", "sting_rumour", "epidemic_sting_rumour_watch.wav"),
    path.join(epidemicRoot, "stings", "sting_breaking", "epidemic_sting_breaking_alert.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_impact_cinematic-hit.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_transition_fast-whoosh.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_ui_tick_clean-click.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_riser_short-swell.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_sub_hit_controlled-boom.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_glitch_clean-static.wav"),
  ];
  for (const file of files) await touchAudio(file);
  return epidemicRoot;
}

test("Epidemic implementation blocks and writes no channel packs when intake is incomplete", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-implementation-blocked-"));
  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: path.join(root, "audio", "epidemic"),
    generatedAt: "2026-05-27T19:00:00.000Z",
  });

  const result = await executeEpidemicSoundImplementation({
    workspaceRoot: root,
    report,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-27T19:01:00.000Z",
    apply: true,
  });

  assert.equal(result.plan.readiness.status, "blocked");
  assert.ok(result.plan.readiness.blockers.includes("epidemic:no_local_audio_assets"));
  assert.equal(result.plan.apply_plan.channel_pack_writes.length, 0);
  assert.equal(result.plan.summary.channel_packs_written, 0);
  assert.equal(await fs.pathExists(path.join(root, "channels", "pulse-gaming", "audio", "pack.json")), false);
  assert.equal(await fs.pathExists(result.outputs.reportPath), true);
  assert.equal(await fs.pathExists(result.outputs.blockersPath), true);
});

test("Epidemic implementation plan covers all music roles, channels and SFX roles from a pass intake", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-implementation-ready-"));
  const epidemicRoot = await createCompleteEpidemicRoot(root);
  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: epidemicRoot,
    generatedAt: "2026-05-27T19:02:00.000Z",
    safelistEvidence: "docs/proof/epidemic-safelist.md",
  });

  const plan = buildEpidemicSoundImplementationPlan({
    workspaceRoot: root,
    report,
    generatedAt: "2026-05-27T19:03:00.000Z",
  });

  assert.equal(plan.readiness.status, "ready");
  assert.deepEqual(plan.readiness.blockers, []);
  assert.equal(plan.channel_packs.length, 3);
  assert.ok(plan.channel_packs.some((pack) => pack.channel_id === "pulse-gaming"));
  assert.ok(plan.channel_packs.every((pack) => pack.root_path === "audio/epidemic"));
  assert.ok(plan.channel_packs.every((pack) => pack.assets.length === 5));
  assert.deepEqual(
    plan.channel_packs[0].assets.map((asset) => asset.role).sort(),
    ["bed_breaking", "bed_primary", "sting_breaking", "sting_rumour", "sting_verified"],
  );
  assert.deepEqual(
    plan.sfx_runtime_manifest.covered_roles.sort(),
    ["glitch", "impact", "riser", "sub_hit", "transition", "ui_tick"],
  );
  assert.ok(plan.sfx_runtime_manifest.rights_records.length >= 6);
});

test("Epidemic implementation apply writes channel pack configs and backs up existing packs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-implementation-apply-"));
  const epidemicRoot = await createCompleteEpidemicRoot(root);
  await fs.outputJson(path.join(root, "channels", "pulse-gaming", "audio", "pack.json"), {
    id: "pulse-owned",
    channel_id: "pulse-gaming",
    root_path: "audio",
    assets: [{ role: "bed_primary", filename: "old.wav" }],
  });
  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: epidemicRoot,
    generatedAt: "2026-05-27T19:04:00.000Z",
    safelistEvidence: "docs/proof/epidemic-safelist.md",
  });

  const result = await executeEpidemicSoundImplementation({
    workspaceRoot: root,
    report,
    outputDir: path.join(root, "out"),
    generatedAt: "2026-05-27T19:05:00.000Z",
    apply: true,
  });

  const pulsePackPath = path.join(root, "channels", "pulse-gaming", "audio", "pack.json");
  const pulsePack = await fs.readJson(pulsePackPath);
  assert.equal(result.plan.readiness.status, "applied");
  assert.equal(result.plan.summary.channel_packs_written, 3);
  assert.equal(pulsePack.id, "pulse-gaming-epidemic-v1");
  assert.equal(pulsePack.license, "epidemic_sound_active_subscription_safelisted_channel");
  assert.equal(await fs.pathExists(`${pulsePackPath}.pre-epidemic-backup`), true);
});
