"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");

const {
  repairNarrationQaArtifacts,
} = require("../../lib/goal-narration-qa-repair");
const { auditNarrationQaArtifacts } = require("../../lib/narration-qa-artifact");
const packageJson = require("../../package.json");

async function makeNarrationQaFixture(root, options = {}) {
  const storyId = options.storyId || "voice-repair-story";
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  const audioWordCount = options.audioWordCount || 125;
  const captionWordCount = options.captionWordCount || audioWordCount;
  await fs.ensureDir(artifactDir);
  await fs.writeFile(path.join(artifactDir, "narration.mp3"), Buffer.alloc(1500, 1));
  await fs.writeFile(
    path.join(artifactDir, "captions.srt"),
    [
      "1",
      "00:00:00,000 --> 00:00:01,200",
      "Hades II finally hits console.",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Hades II Finally Hits Console",
    canonical_subject: "Hades II",
    narration_script:
      "Hades II finally hits console, and the real question is how much this changes Supergiant's launch plan.",
  });
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    story_id: storyId,
    audio_path: "narration.mp3",
    transcript:
      "Hades II finally hits console, and the real question is how much this changes Supergiant's launch plan.",
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    status: "ready",
    voice_status: "materialized",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
    word_timestamp_count: audioWordCount,
    materialized_at: "2026-05-29T02:42:52.956Z",
  });
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    story_id: storyId,
    generated_at: "2026-05-29T02:46:21.461Z",
    caption_srt_path: "captions.srt",
    word_timestamps_path: "word_timestamps.json",
    word_count: captionWordCount,
  });
  await fs.outputJson(path.join(artifactDir, "voice_quality_report.json"), {
    story_id: storyId,
    generated_at: "2026-05-28T23:40:22.491Z",
    verdict: "PASS",
    word_timestamp_count: options.voiceQualityWordCount || 129,
  });
  return {
    storyId,
    artifactDir,
    dryRunPlan: {
      blocked_stories: [
        {
          story_id: storyId,
          artifact_dir: artifactDir,
          blockers: [
            "voice_quality_report_stale_after_audio",
            "voice_quality_report_stale_after_captions",
            "voice_quality_word_count_mismatch",
          ],
        },
      ],
    },
  };
}

test("narration QA repair rewrites stale reports from current audio and captions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-qa-repair-"));
  const fixture = await makeNarrationQaFixture(root);

  const report = await repairNarrationQaArtifacts({
    dryRunPlan: fixture.dryRunPlan,
    generatedAt: "2026-05-31T01:00:00.000Z",
    apply: true,
  });

  assert.equal(report.mode, "apply_file_repair");
  assert.equal(report.summary.target_count, 1);
  assert.equal(report.summary.written_count, 1);
  assert.equal(report.summary.freshness_pass_count, 1);
  assert.equal(report.summary.remaining_blocked_count, 0);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);

  const voiceQuality = await fs.readJson(path.join(fixture.artifactDir, "voice_quality_report.json"));
  assert.equal(voiceQuality.verdict, "PASS");
  assert.equal(voiceQuality.generated_at, "2026-05-31T01:00:00.000Z");
  assert.equal(voiceQuality.word_timestamp_count, 125);
  assert.equal(voiceQuality.repair_source, "current_audio_caption_manifest_and_files");

  const audit = auditNarrationQaArtifacts({
    audioManifest: await fs.readJson(path.join(fixture.artifactDir, "audio_manifest.json")),
    captionManifest: await fs.readJson(path.join(fixture.artifactDir, "caption_manifest.json")),
    voiceQualityReport: voiceQuality,
  });
  assert.equal(audit.status, "fresh");
  assert.deepEqual(audit.blockers, []);
});

test("narration QA repair keeps caption timing drift blocked", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-qa-repair-caption-drift-"));
  const fixture = await makeNarrationQaFixture(root, {
    captionWordCount: 118,
    voiceQualityWordCount: 129,
  });

  const report = await repairNarrationQaArtifacts({
    dryRunPlan: fixture.dryRunPlan,
    generatedAt: "2026-05-31T01:05:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.target_count, 1);
  assert.equal(report.summary.written_count, 1);
  assert.equal(report.summary.freshness_pass_count, 0);
  assert.equal(report.summary.remaining_blocked_count, 1);
  assert.ok(report.rows[0].remaining_blockers.includes("caption_manifest_word_count_mismatch"));
  assert.ok(report.rows[0].remaining_blockers.includes("voice_quality_report_not_pass"));
});

test("narration QA repair CLI defaults to report-only mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-qa-repair-cli-"));
  const fixture = await makeNarrationQaFixture(root);
  const dryRunPlanPath = path.join(root, "dry_run_publish_plan.json");
  const outDir = path.join(root, "reports");
  await fs.outputJson(dryRunPlanPath, fixture.dryRunPlan);

  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "tools", "goal-narration-qa-repair.js"),
      "--root",
      root,
      "--dry-run-plan",
      dryRunPlanPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-31T01:10:00.000Z",
      "--json",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const stdout = JSON.parse(result.stdout);
  assert.equal(stdout.mode, "dry_run_no_file_write");
  assert.equal(stdout.summary.target_count, 1);
  assert.equal(stdout.summary.written_count, 0);
  assert.equal(await fs.pathExists(path.join(outDir, "narration_qa_repair_report.json")), true);
  assert.equal(
    packageJson.scripts["ops:goal-narration-qa-repair"],
    "node tools/goal-narration-qa-repair.js",
  );

  const unchanged = await fs.readJson(path.join(fixture.artifactDir, "voice_quality_report.json"));
  assert.equal(unchanged.generated_at, "2026-05-28T23:40:22.491Z");
});
