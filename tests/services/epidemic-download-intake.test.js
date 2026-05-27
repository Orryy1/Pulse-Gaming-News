"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildEpidemicDownloadIntakePlan,
  classifyDownloadedEpidemicFile,
  executeEpidemicDownloadIntake,
} = require("../../lib/epidemic-download-intake");

async function touchAudio(filePath) {
  await fs.outputFile(filePath, Buffer.alloc(24, 5));
}

test("Epidemic download intake classifies downloaded beds, stings and SFX into target folders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-download-"));
  const source = path.join(root, "Downloads");
  await touchAudio(path.join(source, "Pulse Main News Loop.wav"));
  await touchAudio(path.join(source, "Urgent Breaking Bed.mp3"));
  await touchAudio(path.join(source, "Verified Source Lock Sting.wav"));
  await touchAudio(path.join(source, "Rumour Watch Sting.wav"));
  await touchAudio(path.join(source, "Breaking Hit Sting.wav"));
  await touchAudio(path.join(source, "Cinematic Impact Hit.wav"));
  await touchAudio(path.join(source, "Fast Whoosh Transition.wav"));
  await touchAudio(path.join(source, "Personal Voice Memo.wav"));

  const plan = buildEpidemicDownloadIntakePlan({
    workspaceRoot: root,
    sourceDir: source,
    targetRoot: path.join(root, "audio", "epidemic"),
    generatedAt: "2026-05-27T10:00:00.000Z",
  });

  assert.equal(plan.summary.candidate_files, 8);
  assert.equal(plan.summary.planned_copies, 7);
  assert.equal(plan.summary.needs_review, 1);
  assert.ok(plan.planned_copies.some((item) => item.role === "bed_primary" && item.target_path.includes("music")));
  assert.ok(plan.planned_copies.some((item) => item.role === "transition" && item.target_path.includes("sfx")));
  assert.ok(plan.needs_review.some((item) => item.reason === "epidemic_download_role_not_detected"));
  assert.equal(plan.safety.no_source_deletion, true);
});

test("Epidemic download intake copies recognised files and leaves unknown files in place", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-copy-"));
  const source = path.join(root, "Downloads");
  const targetRoot = path.join(root, "audio", "epidemic");
  const sourceFile = path.join(source, "Clean UI Tick Click.wav");
  const unknownFile = path.join(source, "Unclear Audio.wav");
  await touchAudio(sourceFile);
  await touchAudio(unknownFile);

  const result = await executeEpidemicDownloadIntake({
    workspaceRoot: root,
    sourceDir: source,
    targetRoot,
    generatedAt: "2026-05-27T10:01:00.000Z",
    apply: true,
  });

  assert.equal(result.summary.copied_files, 1);
  assert.equal(await fs.pathExists(sourceFile), true);
  assert.equal(await fs.pathExists(unknownFile), true);
  assert.equal(await fs.pathExists(path.join(targetRoot, "sfx", "Clean UI Tick Click.wav")), true);
  assert.equal(result.safety.no_source_deletion, true);
});

test("Epidemic download intake can limit candidates to files modified after a timestamp", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-epidemic-since-"));
  const source = path.join(root, "Downloads");
  const oldFile = path.join(source, "Old Main News Loop.wav");
  const newFile = path.join(source, "New Main News Loop.wav");
  await touchAudio(oldFile);
  await touchAudio(newFile);
  const oldDate = new Date("2026-05-27T09:00:00.000Z");
  const newDate = new Date("2026-05-27T10:05:00.000Z");
  await fs.utimes(oldFile, oldDate, oldDate);
  await fs.utimes(newFile, newDate, newDate);

  const plan = buildEpidemicDownloadIntakePlan({
    workspaceRoot: root,
    sourceDir: source,
    targetRoot: path.join(root, "audio", "epidemic"),
    generatedAt: "2026-05-27T10:06:00.000Z",
    sinceIso: "2026-05-27T10:00:00.000Z",
  });

  assert.equal(plan.summary.candidate_files, 1);
  assert.equal(plan.planned_copies[0].source_path.endsWith("New Main News Loop.wav"), true);
});

test("Epidemic download intake supports explicit role hints for awkward filenames", () => {
  assert.equal(classifyDownloadedEpidemicFile("download.wav", "bed_breaking").role, "bed_breaking");
  assert.equal(classifyDownloadedEpidemicFile("download.wav", "sting_rumour").target_folder, "stings/sting_rumour");
  assert.equal(classifyDownloadedEpidemicFile("digital static glitch.wav").role, "glitch");
});
