"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
  runCli,
  usage,
} = require("../../tools/flagship-media-evidence-materializer");

async function makeIncompleteCliFixture(prefix = "pulse-flagship-cli-red-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const packageDir = path.join(root, "package");
  const inventoryPath = path.join(root, "inventory.json");
  const outputDir = path.join(root, "proof");
  await fs.ensureDir(packageDir);
  await fs.writeJson(inventoryPath, {
    schema_version: 1,
    story_id: "story-cli-real-red",
    final_outputs: {
      video: { path: "missing.mp4" },
      audio: { path: "missing.wav" },
      script: { path: "missing-script.txt" },
      timestamps: { path: "missing-timestamps.json" },
      captions: { path: "missing-captions.srt" },
    },
    used_assets: [],
  });
  return { root, packageDir, inventoryPath, outputDir };
}

test("RED: CLI rejects caller-selected verifier binary flags", () => {
  assert.throws(
    () => parseArgs(["--ffprobe", "C:/fake/ffprobe.exe"]),
    /Unknown argument: --ffprobe/,
  );
});

test("RED: exported CLI cannot inject a fake GREEN materializer", async () => {
  await assert.rejects(
    () => main([
      "--package-dir", "unused-package",
      "--inventory", "unused-inventory.json",
      "--out-dir", "unused-output",
    ], {
      readJson: async () => ({}),
      materialize: async () => ({ complete: true, verdict: "GREEN" }),
    }),
    /CLI verifier dependency injection is forbidden/,
  );
});

test("CLI requires explicit local package, inventory and proof-output arguments", () => {
  const args = parseArgs([
    "--package-dir", "test/package",
    "--inventory", "test/inventory.json",
    "--out-dir", "test/proof",
    "--generated-at", "2026-07-15T11:00:00.000Z",
    "--json",
  ]);
  assert.equal(args.packageDir, "test/package");
  assert.equal(args.inventoryPath, "test/inventory.json");
  assert.equal(args.outDir, "test/proof");
  assert.equal(args.json, true);
  assert.match(usage(), /Local proof only/i);
});

test("CLI rejects missing required paths before materialisation", async () => {
  await assert.rejects(
    () => main(["--package-dir", "test/package"]),
    /--inventory is required/,
  );
});

test("RED: runCli exits nonzero when materialised evidence is incomplete", async () => {
  const fixture = await makeIncompleteCliFixture("pulse-flagship-run-cli-red-");
  const exitCodes = [];
  const result = await runCli([
    "--package-dir", fixture.packageDir,
    "--inventory", fixture.inventoryPath,
    "--out-dir", fixture.outputDir,
    "--json",
  ], {
    stdout: () => {},
    stderr: () => {},
    exit: (code) => exitCodes.push(code),
  });

  assert.equal(result.report.complete, false);
  assert.deepEqual(exitCodes, [2]);
});

test("actual CLI process exits 2 and persists RED evidence for an incomplete package", async () => {
  const fixture = await makeIncompleteCliFixture();

  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, "../../tools/flagship-media-evidence-materializer.js"),
    "--package-dir", fixture.packageDir,
    "--inventory", fixture.inventoryPath,
    "--out-dir", fixture.outputDir,
    "--json",
  ], { encoding: "utf8", windowsHide: true });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.complete, false);
  assert.equal(printed.verdict, "RED");
  const persisted = await fs.readJson(path.join(fixture.outputDir, "flagship_media_evidence.json"));
  assert.equal(persisted.complete, false);
  assert.equal(persisted.publish_ready, false);
});
