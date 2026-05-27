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
} = require("../../tools/epidemic-sound-intake");

async function touchAudio(filePath) {
  await fs.outputFile(filePath, Buffer.alloc(32, 4));
}

test("Epidemic intake CLI writes machine-readable and human-readable proof artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-cli-"));
  const epidemicRoot = path.join(root, "audio", "epidemic");
  const outDir = path.join(root, "out");
  await touchAudio(path.join(epidemicRoot, "music", "bed_primary", "Main News Bed.wav"));
  await touchAudio(path.join(epidemicRoot, "music", "bed_breaking", "Urgent Breaking Bed.wav"));
  await touchAudio(path.join(epidemicRoot, "stings", "sting_verified", "Verified Sting.wav"));
  await touchAudio(path.join(epidemicRoot, "stings", "sting_rumour", "Rumour Sting.wav"));
  await touchAudio(path.join(epidemicRoot, "stings", "sting_breaking", "Breaking Sting.wav"));
  await touchAudio(path.join(epidemicRoot, "sfx", "Cinematic Impact Hit.wav"));
  await touchAudio(path.join(epidemicRoot, "sfx", "Fast Whoosh Transition.wav"));
  await touchAudio(path.join(epidemicRoot, "sfx", "Clean UI Tick Click.wav"));
  await touchAudio(path.join(epidemicRoot, "sfx", "Tension Riser.wav"));
  await touchAudio(path.join(epidemicRoot, "sfx", "Sub Boom.wav"));
  await touchAudio(path.join(epidemicRoot, "sfx", "Digital Glitch Static.wav"));

  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const { report, outputs } = await main([
      "node",
      "tools/epidemic-sound-intake.js",
      "--root",
      epidemicRoot,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-26T17:03:00.000Z",
      "--safelist-evidence",
      "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
    ]);

    assert.equal(report.readiness.status, "pass");
    assert.equal(await fs.pathExists(outputs.reportPath), true);
    assert.equal(await fs.pathExists(outputs.musicInventoryPath), true);
    assert.equal(await fs.pathExists(outputs.rightsLedgerPath), true);
    assert.equal(await fs.pathExists(outputs.audioPackCandidatesPath), true);
    assert.equal(await fs.pathExists(outputs.downloadPlanPath), true);
    assert.equal(await fs.pathExists(outputs.markdownPath), true);
    assert.equal(await fs.pathExists(outputs.downloadCockpitPath), true);
    const markdown = await fs.readFile(outputs.markdownPath, "utf8");
    assert.match(markdown, /Readiness: pass/);
    assert.match(markdown, /No downloads were started/);
    const cockpit = await fs.readFile(outputs.downloadCockpitPath, "utf8");
    assert.match(cockpit, /Epidemic Sound Download Cockpit/);
    assert.match(cockpit, /music\/bed_primary/);
  } finally {
    process.chdir(previousCwd);
  }
});

test("Epidemic intake CLI parses local-only safety arguments", () => {
  const args = parseArgs([
    "node",
    "tools/epidemic-sound-intake.js",
    "--root",
    "audio/epidemic",
    "--out-dir",
    "output/epidemic",
    "--generated-at",
    "2026-05-26T17:04:00.000Z",
    "--safelist-evidence",
    "docs/proof/safelisting.md",
    "--json",
  ]);

  assert.equal(args.root, "audio/epidemic");
  assert.equal(args.outputDir, "output/epidemic");
  assert.equal(args.generatedAt, "2026-05-26T17:04:00.000Z");
  assert.equal(args.safelistEvidence, "docs/proof/safelisting.md");
  assert.equal(args.json, true);
});

test("Epidemic intake markdown is honest when assets are missing", () => {
  const markdown = renderMarkdown({
    generated_at: "2026-05-26T17:05:00.000Z",
    readiness: {
      status: "blocked",
      blockers: ["epidemic:no_local_audio_assets"],
      warnings: [],
    },
    summary: {
      music_assets: 0,
      sfx_assets: 0,
      rights_records: 0,
    },
    audio_pack_candidates: [],
    download_plan: {
      required_slots: [{ role: "bed_primary", folder: "music/bed_primary" }],
    },
    safety: {
      no_downloads_started: true,
      no_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  });

  assert.match(markdown, /Readiness: blocked/);
  assert.match(markdown, /epidemic:no_local_audio_assets/);
  assert.match(markdown, /music\/bed_primary/);
});
