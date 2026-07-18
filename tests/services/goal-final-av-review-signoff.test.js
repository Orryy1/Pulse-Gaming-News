"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const {
  generateFinalAvReviewPack,
} = require("../../lib/goal-final-av-review-pack");
const {
  validateFinalAvReviewFile,
} = require("../../lib/goal-final-av-review");
const {
  signOffFinalAvReview,
} = require("../../lib/goal-final-av-review-signoff");
const {
  main: runSignoffCli,
} = require("../../tools/goal-final-av-review-signoff");

const execFileAsync = promisify(execFile);

async function makeMediaFixture(t, storyId = "story-final-av-signoff") {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-av-signoff-"));
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

function cleanObservations() {
  return {
    full_watch: true,
    full_listen: true,
    av_sync: true,
    caption_readability: true,
    subject_match: true,
    no_freeze: true,
    no_black: true,
    no_blur: true,
    no_repetition: true,
  };
}

test("explicit trusted human observations approve one current bound final AV pack", async (t) => {
  const fixture = await makeMediaFixture(t);
  const pack = await generateFinalAvReviewPack({
    ...fixture,
    generatedAt: "2026-07-18T15:00:00.000Z",
    sampleCount: 4,
  });

  const result = await signOffFinalAvReview({
    ...fixture,
    reviewerId: "independent-final-av-reviewer",
    reviewedAt: "2026-07-18T15:05:00.000Z",
    signedAt: "2026-07-18T15:06:00.000Z",
    observations: cleanObservations(),
    defects: [],
    operatorConfirmed: true,
    apply: true,
  });

  assert.equal(result.applied, true);
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.can_auto_publish, true);

  const validation = await validateFinalAvReviewFile(pack.paths.final_av_review, {
    storyId: fixture.storyId,
    artifactDir: fixture.artifactDir,
    finalMp4Path: fixture.finalMp4Path,
  });
  assert.equal(validation.valid, true, validation.blockers.join(","));

  const forensic = await fs.readJson(pack.paths.decoded_forensic_report);
  for (const checkName of ["captions", "av_sync", "freeze", "black", "blur", "repetition"]) {
    assert.equal(forensic.checks[checkName].checked, true, checkName);
    assert.equal(forensic.checks[checkName].verdict, "pass", checkName);
    assert.equal(
      forensic.checks[checkName].reviewer_id,
      "independent-final-av-reviewer",
      checkName,
    );
  }
});

test("sign-off refuses to write without explicit operator confirmation", async (t) => {
  const fixture = await makeMediaFixture(t, "story-final-av-signoff-confirmation");
  const pack = await generateFinalAvReviewPack({
    ...fixture,
    generatedAt: "2026-07-18T15:10:00.000Z",
    sampleCount: 4,
  });
  const before = await Promise.all([
    fs.readFile(pack.paths.final_av_review),
    fs.readFile(pack.paths.decoded_forensic_report),
  ]);

  await assert.rejects(
    signOffFinalAvReview({
      ...fixture,
      reviewerId: "independent-final-av-reviewer",
      reviewedAt: "2026-07-18T15:15:00.000Z",
      signedAt: "2026-07-18T15:16:00.000Z",
      observations: cleanObservations(),
      defects: [],
      apply: true,
    }),
    (error) => error?.code === "operator_confirmation_required",
  );

  const after = await Promise.all([
    fs.readFile(pack.paths.final_av_review),
    fs.readFile(pack.paths.decoded_forensic_report),
  ]);
  assert.deepEqual(after, before);
});

test("operator CLI requires each observed clean condition and emits validated GREEN JSON", async (t) => {
  const fixture = await makeMediaFixture(t, "story-final-av-signoff-cli");
  const pack = await generateFinalAvReviewPack({
    ...fixture,
    generatedAt: "2026-07-18T15:20:00.000Z",
    sampleCount: 4,
  });
  let output = "";

  const result = await runSignoffCli([
    "--story-id", fixture.storyId,
    "--artifact-dir", fixture.artifactDir,
    "--final-mp4", fixture.finalMp4Path,
    "--reviewer-id", "independent-final-av-reviewer",
    "--reviewed-at", "2026-07-18T15:25:00.000Z",
    "--signed-at", "2026-07-18T15:26:00.000Z",
    "--full-watch",
    "--full-listen",
    "--av-sync",
    "--caption-readable",
    "--subject-match",
    "--no-freeze",
    "--no-black",
    "--no-blur",
    "--no-repetition",
    "--no-defects",
    "--operator-confirmed",
    "--apply",
    "--json",
  ], {
    cwd: fixture.artifactDir,
    stdout: { write: (value) => { output += value; } },
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(JSON.parse(output).verdict, "GREEN");
  const validation = await validateFinalAvReviewFile(pack.paths.final_av_review, {
    storyId: fixture.storyId,
    artifactDir: fixture.artifactDir,
    finalMp4Path: fixture.finalMp4Path,
  });
  assert.equal(validation.valid, true, validation.blockers.join(","));
});
