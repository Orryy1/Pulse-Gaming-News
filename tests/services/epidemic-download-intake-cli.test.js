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
} = require("../../tools/epidemic-download-intake");

async function touchAudio(filePath) {
  await fs.outputFile(filePath, Buffer.alloc(24, 6));
}

test("Epidemic download intake CLI writes dry-run proof without copying by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-download-cli-"));
  const source = path.join(root, "Downloads");
  const outDir = path.join(root, "out");
  await touchAudio(path.join(source, "Main News Loop.wav"));

  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const { report, outputs } = await main([
      "node",
      "tools/epidemic-download-intake.js",
      "--source",
      source,
      "--target-root",
      path.join(root, "audio", "epidemic"),
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-27T10:02:00.000Z",
    ]);

    assert.equal(report.summary.planned_copies, 1);
    assert.equal(report.summary.copied_files, 0);
    assert.equal(report.mode, "dry_run");
    assert.equal(await fs.pathExists(outputs.reportPath), true);
    assert.equal(await fs.pathExists(outputs.markdownPath), true);
    assert.equal(await fs.pathExists(path.join(root, "audio", "epidemic", "music", "bed_primary", "Main News Loop.wav")), false);
  } finally {
    process.chdir(previousCwd);
  }
});

test("Epidemic download intake CLI copies files only when apply is set", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-download-apply-"));
  const source = path.join(root, "Downloads");
  const targetRoot = path.join(root, "audio", "epidemic");
  await touchAudio(path.join(source, "Breaking Alert Hit.wav"));

  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const { report } = await main([
      "node",
      "tools/epidemic-download-intake.js",
      "--source",
      source,
      "--target-root",
      targetRoot,
      "--out-dir",
      path.join(root, "out"),
      "--generated-at",
      "2026-05-27T10:03:00.000Z",
      "--apply",
    ]);

    assert.equal(report.mode, "apply");
    assert.equal(report.summary.copied_files, 1);
    assert.equal(await fs.pathExists(path.join(targetRoot, "stings", "sting_breaking", "Breaking Alert Hit.wav")), true);
  } finally {
    process.chdir(previousCwd);
  }
});

test("Epidemic download intake CLI parses source, target and explicit role", () => {
  const args = parseArgs([
    "node",
    "tools/epidemic-download-intake.js",
    "--source",
    "C:/Users/MORR/Downloads",
    "--target-root",
    "audio/epidemic",
    "--out-dir",
    "output/epidemic-download-intake",
    "--role",
    "bed_primary",
    "--since-iso",
    "2026-05-27T10:00:00.000Z",
    "--apply",
    "--json",
  ]);

  assert.equal(args.sourceDir, "C:/Users/MORR/Downloads");
  assert.equal(args.targetRoot, "audio/epidemic");
  assert.equal(args.outputDir, "output/epidemic-download-intake");
  assert.equal(args.roleHint, "bed_primary");
  assert.equal(args.sinceIso, "2026-05-27T10:00:00.000Z");
  assert.equal(args.apply, true);
  assert.equal(args.json, true);
});

test("Epidemic download intake markdown reports review queue", () => {
  const markdown = renderMarkdown({
    generated_at: "2026-05-27T10:04:00.000Z",
    mode: "dry_run",
    summary: {
      candidate_files: 1,
      planned_copies: 0,
      needs_review: 1,
      copied_files: 0,
    },
    planned_copies: [],
    needs_review: [{ source_path: "Downloads/unknown.wav", reason: "epidemic_download_role_not_detected" }],
    safety: { no_source_deletion: true },
  });

  assert.match(markdown, /Needs Review/);
  assert.match(markdown, /unknown\.wav/);
});
