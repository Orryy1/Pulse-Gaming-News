"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
  renderMarkdown,
} = require("../../tools/epidemic-audio-pack-materialize");
const {
  buildEpidemicSoundIntakeReport,
} = require("../../lib/epidemic-sound-intake");

async function touchAudio(filePath) {
  await fs.outputFile(filePath, Buffer.alloc(64, 8));
}

test("Epidemic implementation CLI writes blocked proof without applying packs by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-implementation-cli-"));
  const outDir = path.join(root, "out");
  const intakeReportPath = path.join(root, "intake.json");
  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: path.join(root, "audio", "epidemic"),
    generatedAt: "2026-05-27T19:06:00.000Z",
  });
  await fs.outputJson(intakeReportPath, report);

  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const { plan, outputs } = await main([
      "node",
      "tools/epidemic-audio-pack-materialize.js",
      "--intake-report",
      intakeReportPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-27T19:07:00.000Z",
    ]);

    assert.equal(plan.readiness.status, "blocked");
    assert.equal(plan.summary.channel_packs_written, 0);
    assert.equal(await fs.pathExists(outputs.reportPath), true);
    assert.equal(await fs.pathExists(outputs.channelPacksPath), true);
    assert.equal(await fs.pathExists(outputs.sfxRuntimeManifestPath), true);
    assert.equal(await fs.pathExists(path.join(root, "channels", "pulse-gaming", "audio", "pack.json")), false);
  } finally {
    process.chdir(previousCwd);
  }
});

test("Epidemic implementation CLI parses safe apply controls", () => {
  const args = parseArgs([
    "node",
    "tools/epidemic-audio-pack-materialize.js",
    "--intake-report",
    "output/epidemic-sound-intake/epidemic_sound_intake_report.json",
    "--out-dir",
    "output/epidemic-implementation",
    "--generated-at",
    "2026-05-27T19:08:00.000Z",
    "--apply",
    "--json",
  ]);

  assert.equal(args.intakeReportPath, "output/epidemic-sound-intake/epidemic_sound_intake_report.json");
  assert.equal(args.outputDir, "output/epidemic-implementation");
  assert.equal(args.generatedAt, "2026-05-27T19:08:00.000Z");
  assert.equal(args.apply, true);
  assert.equal(args.json, true);
});

test("Epidemic implementation markdown is honest about blocked local assets", () => {
  const markdown = renderMarkdown({
    generated_at: "2026-05-27T19:09:00.000Z",
    readiness: {
      status: "blocked",
      blockers: ["epidemic:no_local_audio_assets"],
      warnings: [],
    },
    summary: {
      channel_packs_planned: 0,
      channel_packs_written: 0,
      sfx_roles_covered: 0,
      rights_records: 0,
    },
    apply_plan: { channel_pack_writes: [] },
    safety: { no_posting: true, no_db_mutation: true, no_oauth_or_token_change: true },
  });

  assert.match(markdown, /Readiness: blocked/);
  assert.match(markdown, /epidemic:no_local_audio_assets/);
  assert.match(markdown, /No publishing APIs were called/);
});

test("Epidemic implementation CLI can apply a complete pass intake in a temp workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-implementation-cli-apply-"));
  const epidemicRoot = path.join(root, "audio", "epidemic");
  const files = [
    path.join(epidemicRoot, "music", "bed_primary", "epidemic_bed_primary_main.wav"),
    path.join(epidemicRoot, "music", "bed_breaking", "epidemic_bed_breaking_urgent.wav"),
    path.join(epidemicRoot, "stings", "sting_verified", "epidemic_sting_verified_source.wav"),
    path.join(epidemicRoot, "stings", "sting_rumour", "epidemic_sting_rumour_watch.wav"),
    path.join(epidemicRoot, "stings", "sting_breaking", "epidemic_sting_breaking_alert.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_impact_hit.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_transition_whoosh.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_ui_tick_click.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_riser_swell.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_sub_hit_boom.wav"),
    path.join(epidemicRoot, "sfx", "epidemic_glitch_static.wav"),
  ];
  for (const file of files) await touchAudio(file);
  const intakeReportPath = path.join(root, "intake.json");
  const report = buildEpidemicSoundIntakeReport({
    workspaceRoot: root,
    root: epidemicRoot,
    generatedAt: "2026-05-27T19:10:00.000Z",
    safelistEvidence: "docs/proof/epidemic-safelist.md",
  });
  await fs.outputJson(intakeReportPath, report);

  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const { plan } = await main([
      "node",
      "tools/epidemic-audio-pack-materialize.js",
      "--intake-report",
      intakeReportPath,
      "--out-dir",
      path.join(root, "out"),
      "--generated-at",
      "2026-05-27T19:11:00.000Z",
      "--apply",
    ]);

    assert.equal(plan.readiness.status, "applied");
    assert.equal(await fs.pathExists(path.join(root, "channels", "stacked", "audio", "pack.json")), true);
  } finally {
    process.chdir(previousCwd);
  }
});
