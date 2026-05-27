"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/studio-v4-sfx-library-ingest");

async function touchAudio(filePath) {
  await fs.outputFile(filePath, Buffer.alloc(16, 2));
}

test("SFX library ingest CLI writes inventory, rights ledger and source plan without side effects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-sfx-cli-"));
  const outDir = path.join(root, "out");
  await touchAudio(path.join(root, "licensed", "soundly", "source-ui-click.wav"));

  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const { report, outputs } = await main([
      "node",
      "tools/studio-v4-sfx-library-ingest.js",
      "--root",
      path.join(root, "licensed"),
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-23T19:25:00.000Z",
    ]);

    assert.equal(report.summary.accepted_assets, 1);
    assert.equal(report.safety.no_posting, true);
    assert.equal(await fs.pathExists(outputs.reportPath), true);
    assert.equal(await fs.pathExists(outputs.inventoryPath), true);
    assert.equal(await fs.pathExists(outputs.rightsPath), true);
    assert.equal(await fs.pathExists(outputs.sourcePlanPath), true);
    const sourcePlan = await fs.readJson(outputs.sourcePlanPath);
    assert.ok(sourcePlan.readiness.blockers.includes("sfx_source:missing_role:impact"));
  } finally {
    process.chdir(previousCwd);
  }
});

test("SFX library ingest CLI parses repeated roots", () => {
  const args = parseArgs([
    "node",
    "tools/studio-v4-sfx-library-ingest.js",
    "--root",
    "audio/sonniss",
    "--root",
    "D:/sfx/soundly",
    "--out-dir",
    "out/sfx",
    "--json",
  ]);

  assert.deepEqual(args.roots, ["audio/sonniss", "D:/sfx/soundly"]);
  assert.equal(args.outputDir, "out/sfx");
  assert.equal(args.json, true);
});
