"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");

const {
  buildCurrentVoiceQualityReport,
  repairNarrationQaArtifacts,
} = require("../../lib/goal-narration-qa-repair");
const { auditNarrationQaArtifacts } = require("../../lib/narration-qa-artifact");
const { analyseNarrationCadence } = require("../../lib/narration-cadence-qa");
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
  if (options.includeNarrationManifest !== false) {
    await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
      story_id: storyId,
      status: "ready",
      audio_path: "narration.mp3",
      transcript:
        "Hades II finally hits console, and the real question is how much this changes Supergiant's launch plan.",
    });
  }
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    status: "ready",
    voice_status: "materialized",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
    word_timestamp_count: audioWordCount,
    ...(options.audioDurationSeconds ? { audio_duration_seconds: options.audioDurationSeconds } : {}),
    materialized_at: "2026-05-29T02:42:52.956Z",
    ...(options.resolvedAudioPath ? { resolved_narration_audio_path: options.resolvedAudioPath } : {}),
    ...(options.resolvedTimestampPath ? { resolved_word_timestamps_path: options.resolvedTimestampPath } : {}),
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

function transcriptWithWordCount(count) {
  const words = Array.from({ length: count }, (_, index) => `word${index + 1}`);
  const sentences = [];
  for (let i = 0; i < words.length; i += 11) {
    sentences.push(`${words.slice(i, i + 11).join(" ")}.`);
  }
  return sentences.join(" ");
}

function wordTimeline(count, durationSeconds) {
  const step = durationSeconds / count;
  return Array.from({ length: count }, (_, index) => {
    const start = Number((index * step).toFixed(3));
    return {
      word: `word${index + 1}`,
      start,
      end: index === count - 1
        ? durationSeconds
        : Number(Math.min(durationSeconds, start + step * 0.72).toFixed(3)),
    };
  });
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

test("narration QA repair refreshes stale caption manifests when caption evidence still matches audio", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-qa-repair-stale-caption-"));
  const fixture = await makeNarrationQaFixture(root);
  await fs.outputJson(path.join(fixture.artifactDir, "audio_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    voice_status: "materialized",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
    word_timestamp_count: 125,
    materialized_at: "2026-05-31T01:00:00.000Z",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "caption_manifest.json"), {
    story_id: fixture.storyId,
    generated_at: "2026-05-30T23:59:00.000Z",
    caption_srt_path: "captions.srt",
    word_timestamps_path: "word_timestamps.json",
    word_count: 125,
  });
  fixture.dryRunPlan.blocked_stories[0].blockers = [
    "caption_manifest_stale_after_audio",
    "voice_quality_report_stale_after_captions",
  ];

  const report = await repairNarrationQaArtifacts({
    dryRunPlan: fixture.dryRunPlan,
    generatedAt: "2026-05-31T01:12:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.target_count, 1);
  assert.equal(report.summary.freshness_pass_count, 1);
  assert.equal(report.summary.remaining_blocked_count, 0);
  assert.equal(report.rows[0].caption_manifest_written, true);

  const captionManifest = await fs.readJson(path.join(fixture.artifactDir, "caption_manifest.json"));
  assert.equal(captionManifest.generated_at, "2026-05-31T01:12:00.000Z");
  assert.equal(captionManifest.word_count, 125);
  assert.equal(captionManifest.repair_source, "current_caption_file_and_audio_manifest");
  assert.equal(captionManifest.safety.no_publish_triggered, true);
  assert.equal(captionManifest.safety.no_db_mutation, true);
});

test("narration QA repair replaces stale caption word count with current aligned timestamp count", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-qa-repair-stale-caption-count-"));
  const fixture = await makeNarrationQaFixture(root, {
    audioWordCount: 97,
    captionWordCount: 126,
    voiceQualityWordCount: 126,
  });
  await fs.outputJson(path.join(fixture.artifactDir, "caption_manifest.json"), {
    story_id: fixture.storyId,
    generated_at: "2026-05-31T01:00:00.000Z",
    caption_srt_path: "captions.srt",
    word_timestamps_path: "word_timestamps.json",
    word_count: 126,
    word_timestamp_count: 126,
    timestamp_whisper_alignment: {
      repaired: true,
      strategy: "local_whisper_word_alignment",
      word_count: 97,
    },
  });
  fixture.dryRunPlan.blocked_stories[0].blockers = [
    "caption_manifest_word_count_mismatch",
    "voice_quality_word_count_mismatch",
  ];

  const report = await repairNarrationQaArtifacts({
    dryRunPlan: fixture.dryRunPlan,
    generatedAt: "2026-05-31T01:14:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.freshness_pass_count, 1);
  assert.equal(report.summary.remaining_blocked_count, 0);

  const captionManifest = await fs.readJson(path.join(fixture.artifactDir, "caption_manifest.json"));
  assert.equal(captionManifest.word_count, 97);
  assert.equal(captionManifest.word_timestamp_count, 97);

  const voiceQuality = await fs.readJson(path.join(fixture.artifactDir, "voice_quality_report.json"));
  assert.equal(voiceQuality.verdict, "PASS");
  assert.equal(voiceQuality.word_timestamp_count, 97);
});

test("narration QA repair materialises a missing narration manifest from current audio evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-manifest-repair-"));
  const resolvedAudioPath = path.join(root, "media", "audio", "hades.mp3");
  const resolvedTimestampPath = path.join(root, "media", "audio", "hades_timestamps.json");
  await fs.outputFile(resolvedAudioPath, Buffer.alloc(1800, 1));
  await fs.outputJson(resolvedTimestampPath, { words: [{ word: "Hades", start: 0, end: 0.3 }] });
  const fixture = await makeNarrationQaFixture(root, {
    includeNarrationManifest: false,
    voiceQualityWordCount: 129,
    resolvedAudioPath,
    resolvedTimestampPath,
  });
  fixture.dryRunPlan.blocked_stories[0].blockers = [
    "narration_manifest_missing",
    "incident:narration_missing",
    "voice_quality_report_stale_after_audio",
    "voice_quality_word_count_mismatch",
  ];

  const report = await repairNarrationQaArtifacts({
    dryRunPlan: fixture.dryRunPlan,
    generatedAt: "2026-05-31T01:08:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.target_count, 1);
  assert.equal(report.summary.written_count, 1);
  assert.equal(report.summary.narration_manifest_written_count, 1);
  assert.equal(report.rows[0].narration_manifest_result, "ready");
  assert.equal(await fs.pathExists(path.join(fixture.artifactDir, "narration_manifest.json")), true);

  const narrationManifest = await fs.readJson(path.join(fixture.artifactDir, "narration_manifest.json"));
  assert.equal(narrationManifest.status, "ready");
  assert.equal(narrationManifest.audio_path, "narration.mp3");
  assert.equal(narrationManifest.resolved_audio_path, resolvedAudioPath);
  assert.equal(narrationManifest.resolved_word_timestamps_path, resolvedTimestampPath);
  assert.equal(narrationManifest.word_timestamp_count, 125);
  assert.match(narrationManifest.transcript, /Hades II finally hits console/);
  assert.equal(narrationManifest.safety.no_publish_triggered, true);
  assert.equal(narrationManifest.safety.no_db_mutation, true);
});

test("narration voice QA blocks unnaturally rushed cadence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-cadence-rushed-"));
  const fixture = await makeNarrationQaFixture(root, {
    audioWordCount: 130,
    audioDurationSeconds: 40,
  });
  await fs.outputJson(path.join(fixture.artifactDir, "caption_manifest.json"), {
    story_id: fixture.storyId,
    generated_at: "2026-05-31T01:00:00.000Z",
    caption_srt_path: "captions.srt",
    word_timestamps_path: "word_timestamps.json",
    word_count: 130,
  });

  const built = await buildCurrentVoiceQualityReport({
    artifactDir: fixture.artifactDir,
    generatedAt: "2026-05-31T01:16:00.000Z",
  });

  assert.equal(built.voiceQualityReport.verdict, "FAIL");
  assert.equal(built.voiceQualityReport.cadence.spoken_wpm, 195);
  assert.ok(built.voiceQualityReport.blockers.includes("voice_cadence:wpm_too_fast"));
});

test("narration voice QA accepts natural spoken cadence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-cadence-natural-"));
  const fixture = await makeNarrationQaFixture(root, {
    audioWordCount: 130,
    audioDurationSeconds: 50,
  });
  await fs.outputJson(path.join(fixture.artifactDir, "caption_manifest.json"), {
    story_id: fixture.storyId,
    generated_at: "2026-05-31T01:00:00.000Z",
    caption_srt_path: "captions.srt",
    word_timestamps_path: "word_timestamps.json",
    word_count: 130,
  });

  const built = await buildCurrentVoiceQualityReport({
    artifactDir: fixture.artifactDir,
    generatedAt: "2026-05-31T01:17:00.000Z",
  });

  assert.equal(built.voiceQualityReport.verdict, "PASS");
  assert.equal(built.voiceQualityReport.cadence.spoken_wpm, 156);
  assert.deepEqual(built.voiceQualityReport.blockers, []);
});

test("narration cadence QA prefers probed audio duration over compressed timestamp spans", async () => {
  const cadence = await analyseNarrationCadence({
    audioManifest: { word_timestamp_count: 130 },
    timestampPayload: {
      words: [
        { word: "first", start: 0, end: 0.12 },
        { word: "last", start: 3.6, end: 3.84 },
      ],
    },
    transcript: "A natural narration read should be judged against the real audio file duration.",
    audioPath: "narration.mp3",
    durationProbe: async () => 50,
    generatedAt: "2026-05-31T01:17:30.000Z",
  });

  assert.equal(cadence.duration_source, "ffprobe");
  assert.equal(cadence.duration_seconds, 50);
  assert.equal(cadence.spoken_wpm, 156);
  assert.deepEqual(cadence.blockers, []);
});

test("narration QA repair can proactively refresh scheduler bridge candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-qa-bridge-"));
  const fixture = await makeNarrationQaFixture(root, {
    audioWordCount: 130,
    audioDurationSeconds: 40,
  });

  const report = await repairNarrationQaArtifacts({
    dryRunPlan: { blocked_stories: [] },
    bridgeCandidates: [{ id: fixture.storyId, scheduler_bridge_artifact_dir: fixture.artifactDir }],
    includeBridgeCandidates: true,
    generatedAt: "2026-05-31T01:18:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.target_count, 1);
  assert.equal(report.summary.remaining_blocked_count, 1);
  assert.ok(report.rows[0].remaining_blockers.includes("voice_quality_report_not_pass"));
  assert.ok(report.rows[0].repaired_report_blockers.includes("voice_cadence:wpm_too_fast"));

  const voiceQuality = await fs.readJson(path.join(fixture.artifactDir, "voice_quality_report.json"));
  assert.equal(voiceQuality.verdict, "FAIL");
  assert.equal(voiceQuality.cadence.spoken_wpm, 195);
});

test("narration voice QA accepts sparse audio manifests when narration evidence has resolved paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-sparse-audio-manifest-"));
  const fixture = await makeNarrationQaFixture(root, {
    audioWordCount: 110,
    captionWordCount: 110,
    voiceQualityWordCount: 110,
  });
  const resolvedAudioPath = path.join(root, "media", "audio", "sparse.mp3");
  const resolvedTimestampPath = path.join(root, "media", "audio", "sparse_timestamps.json");
  const transcript = transcriptWithWordCount(110);
  await fs.outputFile(resolvedAudioPath, Buffer.alloc(1800, 1));
  await fs.outputJson(resolvedTimestampPath, {
    meta: {
      acoustic: { durationSeconds: 13.92 },
      voiceDiagnostics: { metrics: { duration_s: 13.92 } },
    },
    words: wordTimeline(110, 42),
  });
  await fs.outputJson(path.join(fixture.artifactDir, "audio_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    voice_status: "materialized",
    music_bed: "local_editorial_energy_bed",
    mix_rules: { narration_priority: true },
  });
  await fs.outputJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    narration_audio_path: "output/audio/sparse.mp3",
    word_timestamps_path: "output/audio/sparse_timestamps.json",
    resolved_narration_audio_path: resolvedAudioPath,
    resolved_word_timestamps_path: resolvedTimestampPath,
    word_timestamp_count: 110,
    transcript,
  });
  await fs.outputJson(path.join(fixture.artifactDir, "caption_manifest.json"), {
    story_id: fixture.storyId,
    generated_at: "2026-05-31T01:00:00.000Z",
    caption_srt_path: "captions.srt",
    word_timestamps_path: resolvedTimestampPath,
    word_count: 110,
  });

  const built = await buildCurrentVoiceQualityReport({
    artifactDir: fixture.artifactDir,
    generatedAt: "2026-05-31T01:19:00.000Z",
  });

  assert.equal(built.voiceQualityReport.verdict, "PASS");
  assert.equal(built.voiceQualityReport.word_timestamp_count, 110);
  assert.equal(built.voiceQualityReport.checks.narration_audio_present, true);
  assert.equal(built.voiceQualityReport.checks.word_timestamps_present, true);
  assert.equal(built.voiceQualityReport.cadence.duration_seconds, 42);
  assert.equal(built.voiceQualityReport.cadence.duration_source, "timestamps");
  assert.equal(built.voiceQualityReport.cadence.spoken_wpm, 157.1);
  assert.deepEqual(built.voiceQualityReport.blockers, []);
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
