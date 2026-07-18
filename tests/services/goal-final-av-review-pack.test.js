"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const sharp = require("sharp");

const {
  FINAL_AV_CONTACT_SHEET_FILENAME,
  FINAL_AV_FORENSIC_REPORT_FILENAME,
  FINAL_AV_REVIEW_FILENAME,
  generateFinalAvReviewPack,
} = require("../../lib/goal-final-av-review-pack");
const {
  FINAL_AV_REVIEW_ATTESTATION_KEYS,
  validateFinalAvReviewFile,
} = require("../../lib/goal-final-av-review");

const execFileAsync = promisify(execFile);

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

async function makeMediaFixture(t, storyId = "story-final-av-pack") {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-pack-"));
  t.after(() => fs.remove(artifactDir));
  const finalMp4Path = path.join(artifactDir, "current-final.mp4");
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-nostdin",
    "-v", "error",
    "-f", "lavfi",
    "-i", "testsrc2=size=180x320:rate=12:duration=1.2",
    "-f", "lavfi",
    "-i", "sine=frequency=880:sample_rate=48000:duration=1.2",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "-movflags", "+faststart",
    "-y",
    finalMp4Path,
  ], { windowsHide: true, timeout: 30_000 });
  return { artifactDir, finalMp4Path, storyId };
}

test("final AV review-pack generator materialises bound evidence and an unsigned PENDING template", async (t) => {
  const fixture = await makeMediaFixture(t);

  const result = await generateFinalAvReviewPack({
    ...fixture,
    generatedAt: "2026-07-15T12:00:00.000Z",
    sampleCount: 4,
  });

  assert.deepEqual(result.paths, {
    contact_sheet: path.join(fixture.artifactDir, FINAL_AV_CONTACT_SHEET_FILENAME),
    decoded_forensic_report: path.join(
      fixture.artifactDir,
      FINAL_AV_FORENSIC_REPORT_FILENAME,
    ),
    final_av_review: path.join(fixture.artifactDir, FINAL_AV_REVIEW_FILENAME),
  });
  assert.ok(Object.values(result.paths).every((filePath) => path.dirname(filePath) === fixture.artifactDir));

  const contactSheet = await sharp(result.paths.contact_sheet).metadata();
  assert.equal(contactSheet.format, "png");
  assert.ok(contactSheet.width >= 640);
  assert.ok(contactSheet.height >= 640);

  const report = await fs.readJson(result.paths.decoded_forensic_report);
  assert.equal(report.story_id, fixture.storyId);
  assert.equal(report.status, "PENDING");
  assert.equal(report.verdict, "PENDING");
  assert.equal(report.full_duration_decoded, true);
  assert.equal(report.publish_ready, false);
  assert.equal(report.can_auto_publish, false);
  assert.deepEqual(report.blockers, ["independent_semantic_av_review_pending"]);
  assert.equal(report.final_media.sha256, await sha256(fixture.finalMp4Path));
  assert.equal(report.sampled_frames.length, 4);
  assert.equal(report.sampled_frames[0].time_seconds, 0);
  const endCoverageWindow = Math.max(0.5, report.final_media.duration_seconds * 0.05);
  assert.ok(
    report.sampled_frames.at(-1).time_seconds >=
      report.final_media.duration_seconds - endCoverageWindow,
  );
  assert.equal(report.sampling.full_duration_covered, true);
  assert.ok(report.sampled_frames.every((frame) => /^[a-f0-9]{64}$/.test(frame.hash)));

  const review = await fs.readJson(result.paths.final_av_review);
  assert.equal(review.schema_version, 1);
  assert.equal(review.story_id, fixture.storyId);
  assert.equal(review.status, "PENDING");
  assert.equal(review.verdict, "PENDING");
  assert.equal(review.publish_ready, false);
  assert.equal(review.can_auto_publish, false);
  assert.equal(review.reviewed_at, null);
  assert.deepEqual(review.reviewer, { id: null, independent: null });
  assert.equal(review.signoff, null);
  assert.ok(Object.values(review.attestations).every((value) => value === false));
  assert.deepEqual(review.reviewed_artefact_fingerprints, {
    final_mp4: await sha256(fixture.finalMp4Path),
    contact_sheet: await sha256(result.paths.contact_sheet),
    decoded_forensic_report: await sha256(result.paths.decoded_forensic_report),
  });
  assert.deepEqual(review.contact_sheet_binding.sampled_frames, report.sampled_frames.map((frame) => ({
    time_seconds: frame.time_seconds,
    hash: frame.hash,
  })));
});

test("uniform frame hashes and a full decode cannot machine-pass semantic AV review", async (t) => {
  const fixture = await makeMediaFixture(t, "story-final-av-semantic-review");
  const pack = await generateFinalAvReviewPack({
    ...fixture,
    generatedAt: "2026-07-15T12:02:00.000Z",
    sampleCount: 4,
  });
  const report = await fs.readJson(pack.paths.decoded_forensic_report);

  assert.equal(report.full_duration_decoded, true);
  assert.equal(report.sampling.full_duration_covered, true);
  assert.ok(report.sampled_frames.every((frame) => /^[a-f0-9]{64}$/.test(frame.hash)));
  assert.equal(report.status, "PENDING");
  assert.equal(report.verdict, "PENDING");
  assert.equal(report.publish_ready, false);
  assert.equal(report.can_auto_publish, false);
  assert.equal(pack.status, "PENDING");
  assert.equal(pack.publish_ready, false);
  assert.equal(pack.can_auto_publish, false);

  for (const checkName of ["audio", "video"]) {
    assert.equal(report.checks[checkName].review_mode, "machine_decode");
    assert.equal(report.checks[checkName].checked, true);
    assert.equal(report.checks[checkName].verdict, "pass");
  }

  const semanticChecks = {
    captions: "caption_readability",
    blur: "blur",
    freeze: "freeze",
    black: "black_frames",
    repetition: "repetition",
    av_sync: "av_sync",
  };
  for (const [checkName, semanticCheck] of Object.entries(semanticChecks)) {
    const check = report.checks[checkName];
    assert.equal(check.semantic_check, semanticCheck);
    assert.equal(check.review_mode, "independent_semantic_review");
    assert.equal(check.checked, false);
    assert.equal(check.verdict, "PENDING");
    assert.equal(check.independent_review_required, true);
    assert.ok(check.machine_evidence);
  }
  assert.ok(
    Object.keys(semanticChecks).every((checkName) =>
      report.checks[checkName].verdict !== "pass"),
  );
  assert.equal(JSON.stringify(report).includes('"GREEN"'), false);
});

test("trusted independent completion promotes pending semantic checks before validation", async (t) => {
  const fixture = await makeMediaFixture(t, "story-final-av-validator-binding");
  const pack = await generateFinalAvReviewPack({
    ...fixture,
    generatedAt: "2026-07-15T12:05:00.000Z",
    sampleCount: 4,
  });
  const report = await fs.readJson(pack.paths.decoded_forensic_report);
  const review = await fs.readJson(pack.paths.final_av_review);
  const reviewerId = "independent-final-av-reviewer";
  const reviewedAt = "2026-07-15T12:10:00.000Z";

  for (const checkName of ["captions", "blur", "freeze", "black", "repetition", "av_sync"]) {
    Object.assign(report.checks[checkName], {
      checked: true,
      verdict: "pass",
      independent_review_required: false,
      reviewed_at: reviewedAt,
      reviewer_id: reviewerId,
    });
  }
  report.status = "pass";
  report.verdict = "pass";
  report.independent_review_required = false;
  report.analysis_scope.semantic_av_acceptance = "INDEPENDENT_REVIEW_COMPLETE";
  report.blockers = [];
  await fs.writeJson(pack.paths.decoded_forensic_report, report, { spaces: 2 });
  const reviewedForensicReportHash = await sha256(pack.paths.decoded_forensic_report);
  review.reviewed_artefact_fingerprints.decoded_forensic_report = reviewedForensicReportHash;
  review.contact_sheet_binding.decoded_forensic_report_sha256 = reviewedForensicReportHash;

  review.reviewed_at = reviewedAt;
  review.signed_at = "2026-07-15T12:11:00.000Z";
  review.reviewer = {
    id: reviewerId,
    independent: true,
  };
  review.signoff = {
    reviewer_id: review.reviewer.id,
    signed_at: review.signed_at,
  };
  review.status = "GREEN";
  review.verdict = "GREEN";
  review.final_verdict = "GREEN";
  review.publish_ready = true;
  review.can_auto_publish = true;
  review.attestations = Object.fromEntries(
    FINAL_AV_REVIEW_ATTESTATION_KEYS.map((key) => [key, true]),
  );
  review.defects = [];
  review.blockers = [];

  await fs.writeJson(pack.paths.final_av_review, review, { spaces: 2 });
  const validation = await validateFinalAvReviewFile(pack.paths.final_av_review, {
    storyId: fixture.storyId,
    artifactDir: fixture.artifactDir,
    finalMp4Path: fixture.finalMp4Path,
  });

  assert.equal(validation.valid, true, validation.blockers.join(","));
  assert.equal(validation.verdict, "GREEN");
  assert.equal(validation.evidence.final_mp4_matches_current_render, true);
  assert.equal(validation.evidence.contact_sheet_binding.bound_to_current_media, true);
  assert.equal(validation.evidence.decoded_forensic_report_valid, true);
  assert.equal(
    validation.evidence.decoded_forensic_report.frame_hash_verification.verified,
    true,
  );
});

test("unreadable final media fails closed without materialising review outputs", async (t) => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-corrupt-"));
  t.after(() => fs.remove(artifactDir));
  const finalMp4Path = path.join(artifactDir, "corrupt-final.mp4");
  await fs.writeFile(finalMp4Path, Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x00,
  ]));

  await assert.rejects(
    generateFinalAvReviewPack({
      storyId: "story-corrupt-final-av",
      artifactDir,
      finalMp4Path,
      sampleCount: 4,
    }),
    (error) => error?.code === "final_mp4_probe_failed",
  );

  for (const fileName of [
    FINAL_AV_CONTACT_SHEET_FILENAME,
    FINAL_AV_FORENSIC_REPORT_FILENAME,
    FINAL_AV_REVIEW_FILENAME,
  ]) {
    assert.equal(await fs.pathExists(path.join(artifactDir, fileName)), false, fileName);
  }
});

test("final AV review-pack CLI generates only a local PENDING evidence summary", async (t) => {
  const fixture = await makeMediaFixture(t, "story-final-av-pack-cli");
  const toolPath = path.resolve(__dirname, "../../tools/goal-final-av-review-pack.js");

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    toolPath,
    "--story-id", fixture.storyId,
    "--artifact-dir", fixture.artifactDir,
    "--final-mp4", fixture.finalMp4Path,
    "--sample-count", "4",
    "--generated-at", "2026-07-15T12:15:00.000Z",
    "--json",
  ], { windowsHide: true, timeout: 60_000 });

  const summary = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(summary.story_id, fixture.storyId);
  assert.equal(summary.status, "PENDING");
  assert.equal(summary.publish_ready, false);
  assert.equal(summary.sample_count, 4);
  assert.equal(summary.paths.final_av_review, path.join(fixture.artifactDir, FINAL_AV_REVIEW_FILENAME));
  assert.equal(await fs.pathExists(summary.paths.contact_sheet), true);
  assert.equal(await fs.pathExists(summary.paths.decoded_forensic_report), true);
  assert.equal(await fs.pathExists(summary.paths.final_av_review), true);
});

test("final AV review-pack CLI accepts an existing cwd-relative MP4 inside the artifact directory", async (t) => {
  const fixture = await makeMediaFixture(t, "story-final-av-pack-cli-cwd-relative");
  const toolPath = path.resolve(__dirname, "../../tools/goal-final-av-review-pack.js");
  const cwd = path.dirname(fixture.artifactDir);
  const artifactDir = path.relative(cwd, fixture.artifactDir);
  const finalMp4Path = path.relative(cwd, fixture.finalMp4Path);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    toolPath,
    "--story-id", fixture.storyId,
    "--artifact-dir", artifactDir,
    "--final-mp4", finalMp4Path,
    "--sample-count", "4",
    "--generated-at", "2026-07-15T12:16:00.000Z",
    "--json",
  ], { cwd, windowsHide: true, timeout: 60_000 });

  const summary = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(summary.story_id, fixture.storyId);
  assert.equal(summary.final_mp4, fixture.finalMp4Path);
  assert.equal(summary.paths.final_av_review, path.join(
    fixture.artifactDir,
    FINAL_AV_REVIEW_FILENAME,
  ));
});

test("final AV review-pack CLI keeps filename-relative MP4 paths under the artifact directory", async (t) => {
  const fixture = await makeMediaFixture(t, "story-final-av-pack-cli-filename-relative");
  const toolPath = path.resolve(__dirname, "../../tools/goal-final-av-review-pack.js");
  const cwd = path.dirname(fixture.artifactDir);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    toolPath,
    "--story-id", fixture.storyId,
    "--artifact-dir", path.relative(cwd, fixture.artifactDir),
    "--final-mp4", path.basename(fixture.finalMp4Path),
    "--sample-count", "4",
    "--generated-at", "2026-07-15T12:17:00.000Z",
    "--json",
  ], { cwd, windowsHide: true, timeout: 60_000 });

  const summary = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(summary.final_mp4, fixture.finalMp4Path);
  assert.equal(summary.paths.final_av_review, path.join(
    fixture.artifactDir,
    FINAL_AV_REVIEW_FILENAME,
  ));
});

test("final AV review-pack CLI rejects an existing cwd-relative MP4 outside the artifact directory", async (t) => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-cli-scope-"));
  const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-cli-external-"));
  t.after(() => Promise.all([fs.remove(artifactDir), fs.remove(externalDir)]));
  const externalMp4Path = path.join(externalDir, "external.mp4");
  const toolPath = path.resolve(__dirname, "../../tools/goal-final-av-review-pack.js");
  await fs.writeFile(externalMp4Path, Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
  ]));

  await assert.rejects(
    execFileAsync(process.execPath, [
      toolPath,
      "--artifact-dir", ".",
      "--final-mp4", path.relative(artifactDir, externalMp4Path),
      "--sample-count", "4",
      "--json",
    ], { cwd: artifactDir, windowsHide: true, timeout: 60_000 }),
    (error) => (
      error?.code === 1 &&
      String(error.stderr).includes("final_mp4_outside_story_dir")
    ),
  );

  assert.deepEqual(await fs.readdir(artifactDir), []);
});

test("final AV review-pack CLI rejects a cwd-relative MP4 symlink escape", async (t) => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-cli-link-"));
  const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-cli-link-target-"));
  t.after(() => Promise.all([fs.remove(artifactDir), fs.remove(externalDir)]));
  const externalMp4Path = path.join(externalDir, "external.mp4");
  const linkedDir = path.join(artifactDir, "linked");
  const toolPath = path.resolve(__dirname, "../../tools/goal-final-av-review-pack.js");
  await fs.writeFile(externalMp4Path, Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
  ]));
  await fs.symlink(
    externalDir,
    linkedDir,
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(
    execFileAsync(process.execPath, [
      toolPath,
      "--artifact-dir", ".",
      "--final-mp4", path.join("linked", path.basename(externalMp4Path)),
      "--sample-count", "4",
      "--json",
    ], { cwd: artifactDir, windowsHide: true, timeout: 60_000 }),
    (error) => (
      error?.code === 1 &&
      String(error.stderr).includes("final_mp4_symlink_escape")
    ),
  );

  assert.deepEqual(await fs.readdir(artifactDir), ["linked"]);
});

test("current final MP4 outside the story directory is rejected before output", async (t) => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-scope-"));
  const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-external-"));
  t.after(() => Promise.all([fs.remove(artifactDir), fs.remove(externalDir)]));
  const externalMp4Path = path.join(externalDir, "external.mp4");
  await fs.writeFile(externalMp4Path, Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
  ]));

  await assert.rejects(
    generateFinalAvReviewPack({
      storyId: "story-final-av-scope",
      artifactDir,
      finalMp4Path: externalMp4Path,
      sampleCount: 4,
    }),
    (error) => error?.code === "final_mp4_outside_story_dir",
  );

  const names = await fs.readdir(artifactDir);
  assert.deepEqual(names, []);
});
