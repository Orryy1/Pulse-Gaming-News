"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");

const {
  buildCurrentVoiceQualityReport,
  repairNarrationQaArtifacts,
  writeFlagshipNarrationQaEvidence,
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

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

test("post-render narration QA binds separate display and spoken evidence to one immutable GREEN run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flagship-narration-qa-"));
  const storyId = "flagship-currency-qa";
  const artifactDir = path.join(root, storyId);
  const evidenceDir = path.join(artifactDir, "flagship");
  const runId = `production-render:${storyId}:2026-07-15T09:00:00.000Z`;
  await fs.ensureDir(evidenceDir);

  const displayScript = "Steam lists it at $84.91.";
  const spokenScript = "Steam lists it at 84 dollars 91.";
  const paths = {
    final_video: path.join(artifactDir, "visual_v4_render.mp4"),
    final_audio: path.join(evidenceDir, "final_audio.mp3"),
    script: path.join(evidenceDir, "final_script.txt"),
    spoken_script: path.join(evidenceDir, "final_spoken_script.txt"),
    captions: path.join(evidenceDir, "captions.srt"),
    word_timestamps: path.join(evidenceDir, "word_timestamps.json"),
  };
  await fs.writeFile(paths.final_video, Buffer.alloc(4096, 4));
  await fs.writeFile(paths.final_audio, Buffer.alloc(4096, 5));
  await fs.writeFile(paths.script, `${displayScript}\n`, "utf8");
  await fs.writeFile(paths.spoken_script, `${spokenScript}\n`, "utf8");
  await fs.writeFile(
    paths.captions,
    `1\n00:00:00,000 --> 00:00:03,000\n${displayScript}\n`,
    "utf8",
  );
  const audioSha256 = await sha256File(paths.final_audio);
  const scriptSha256 = await sha256File(paths.script);
  const spokenScriptSha256 = await sha256File(paths.spoken_script);
  const captionsSha256 = await sha256File(paths.captions);
  const words = spokenScript.replace(/[.]/g, "").split(/\s+/).map((word, index, all) => ({
    word,
    start: Number((index * (3 / all.length)).toFixed(3)),
    end: Number(((index + 1) * (3 / all.length)).toFixed(3)),
  }));
  await fs.writeJson(paths.word_timestamps, {
    words,
    audio_sha256: audioSha256,
    script_sha256: scriptSha256,
    spoken_script_sha256: spokenScriptSha256,
    captions_sha256: captionsSha256,
    flagship_generation_run_id: runId,
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    input_fingerprint: {
      signature: "render-input-fingerprint",
      audio_sha256: audioSha256,
      word_timestamps_sha256: await sha256File(paths.word_timestamps),
    },
  }, { spaces: 2 });

  const artifacts = {};
  for (const [key, filePath] of Object.entries(paths)) {
    const stat = await fs.stat(filePath);
    artifacts[key] = {
      path: path.relative(artifactDir, filePath).replace(/\\/g, "/"),
      sha256: await sha256File(filePath),
      bytes: stat.size,
      run_id: runId,
      script_sha256: scriptSha256,
      spoken_script_sha256: spokenScriptSha256,
    };
  }
  const generationManifestPath = path.join(evidenceDir, "generation_manifest.json");
  await fs.writeJson(generationManifestPath, {
    schema_version: 1,
    story_id: storyId,
    complete: true,
    verdict: "GREEN",
    producer_id: "pulse-gaming-flagship-renderer",
    run_id: runId,
    generated_at: "2026-07-15T09:00:00.000Z",
    script_sha256: scriptSha256,
    spoken_script_sha256: spokenScriptSha256,
    artifacts,
    blockers: [],
  }, { spaces: 2 });

  const result = await writeFlagshipNarrationQaEvidence({
    artifactDir,
    generatedAt: "2026-07-15T09:00:00.000Z",
    durationProbe: async () => 3,
    silenceProbe: async () => [],
  });

  assert.equal(result.verdict, "PASS", JSON.stringify(result.blockers, null, 2));
  const captions = await fs.readJson(path.join(artifactDir, "caption_manifest.json"));
  const voice = await fs.readJson(path.join(artifactDir, "voice_quality_report.json"));
  const narration = await fs.readJson(path.join(artifactDir, "narration_manifest.json"));
  assert.equal(narration.authoritative, true);
  assert.equal(narration.verdict, "PASS");
  assert.equal(narration.status, "ready");
  assert.equal(narration.run_id, runId);
  assert.equal(narration.provider, "unknown");
  assert.equal(narration.resolved_audio_path, paths.final_audio);
  assert.equal(narration.audio_sha256, audioSha256);
  assert.equal(narration.word_timestamps_sha256, await sha256File(paths.word_timestamps));
  assert.equal(narration.display_script_sha256, scriptSha256);
  assert.equal(narration.spoken_script_sha256, spokenScriptSha256);
  assert.equal(narration.transcript, spokenScript);
  assert.equal(narration.display_transcript, displayScript);
  assert.equal(
    narration.lineage.generation_manifest.sha256,
    await sha256File(generationManifestPath),
  );
  assert.deepEqual(narration.blockers, []);
  assert.equal(captions.authoritative, true);
  assert.equal(voice.authoritative, true);
  assert.equal(captions.run_id, runId);
  assert.equal(voice.run_id, runId);
  assert.equal(captions.display_word_count, 6);
  assert.equal(captions.spoken_word_count, 7);
  assert.equal(voice.word_timestamp_count, 7);
  assert.equal(voice.cadence.status, "pass");
  assert.equal(
    captions.lineage.generation_manifest.sha256,
    await sha256File(generationManifestPath),
  );
  assert.equal(voice.lineage.captions_sha256, captionsSha256);
  assert.deepEqual(captions.blockers, []);
  assert.deepEqual(voice.blockers, []);
  assert.equal(auditNarrationQaArtifacts({
    audioManifest: { word_timestamp_count: 7 },
    captionManifest: captions,
    voiceQualityReport: voice,
  }).status, "fresh");
});

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

test("narration voice QA blocks GTA VI si-six evidence from current ASR transcript", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-gta-asr-stutter-"));
  const fixture = await makeNarrationQaFixture(root, {
    storyId: "gta-asr-stutter-story",
    audioWordCount: 105,
    audioDurationSeconds: 42,
  });
  await fs.outputJson(path.join(fixture.artifactDir, "canonical_story_manifest.json"), {
    story_id: fixture.storyId,
    selected_title: "GTA VI Starts The Preorder Fight",
    canonical_subject: "Grand Theft Auto VI",
    narration_script: "Rockstar's next Grand Theft Auto just made pre-orders a trust test.",
    tts_script: "Rockstar's next Grand Theft Auto just made pre-orders a trust test.",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "audio_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    voice_status: "materialized",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
    word_timestamp_count: 105,
    audio_duration_seconds: 42,
    materialized_at: "2026-06-29T01:00:00.000Z",
    timestamp_whisper_alignment: {
      repaired: true,
      transcript: "GTA si-six just made pre orders a trust test. Follow Pulse Gaming so you never miss a beat.",
    },
  });

  const built = await buildCurrentVoiceQualityReport({
    artifactDir: fixture.artifactDir,
    generatedAt: "2026-06-29T01:01:00.000Z",
  });

  assert.equal(built.voiceQualityReport.verdict, "FAIL");
  assert.ok(built.voiceQualityReport.blockers.includes("gta_vi_spoken_stutter"));
  assert.equal(built.voiceQualityReport.transcript.gta_vi_spoken_stutter, true);
});

test("narration voice QA blocks spaced GTA six evidence from current ASR transcript", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-gta-asr-spoken-six-"));
  const fixture = await makeNarrationQaFixture(root, {
    storyId: "gta-asr-spoken-six-story",
    audioWordCount: 105,
    audioDurationSeconds: 42,
  });
  await fs.outputJson(path.join(fixture.artifactDir, "canonical_story_manifest.json"), {
    story_id: fixture.storyId,
    selected_title: "GTA VI Starts The Preorder Fight",
    canonical_subject: "Grand Theft Auto VI",
    narration_script: "Rockstar's next Grand Theft Auto just made pre-orders a trust test.",
    tts_script: "Rockstar's next Grand Theft Auto just made pre-orders a trust test.",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "audio_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    voice_status: "materialized",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "word_timestamps.json",
    word_timestamp_count: 105,
    audio_duration_seconds: 42,
    materialized_at: "2026-06-29T01:00:00.000Z",
    timestamp_whisper_alignment: {
      repaired: true,
      transcript: "G T A six just made pre orders a trust test. Follow Pulse Gaming so you never miss a beat.",
    },
  });

  const built = await buildCurrentVoiceQualityReport({
    artifactDir: fixture.artifactDir,
    generatedAt: "2026-06-29T01:01:00.000Z",
  });

  assert.equal(built.voiceQualityReport.verdict, "FAIL");
  assert.ok(built.voiceQualityReport.blockers.includes("gta_vi_spoken_six"));
  assert.equal(built.voiceQualityReport.transcript.gta_vi_spoken_six, true);
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

test("narration cadence QA blocks a long acoustic gap even when average WPM is acceptable", async () => {
  const words = [
    ["This", 0, 0.15],
    ["game", 0.3, 0.45],
    ["just", 0.6, 0.75],
    ["changed", 0.9, 1.05],
    ["the", 2.05, 2.2],
    ["whole", 2.35, 2.5],
    ["player", 2.65, 2.8],
    ["decision", 2.95, 3.1],
  ].map(([word, start, end]) => ({ word, start, end }));
  const cadence = await analyseNarrationCadence({
    audioManifest: { word_timestamp_count: words.length, audio_duration_seconds: 3.2 },
    timestampPayload: { words },
    transcript: "This game just changed the whole player decision.",
  });

  assert.equal(cadence.spoken_wpm, 150);
  assert.equal(cadence.pause_profile.longest_pause_seconds, 1);
  assert.ok(cadence.blockers.includes("voice_cadence:acoustic_pause_too_long"));
});

test("narration cadence QA blocks timestamps that mask acoustic silence inside a word", async () => {
  const words = wordTimeline(130, 52.5);
  words[126] = { word: "Follow", start: 50.54, end: 51.62 };
  words[127] = { word: "Pulse", start: 51.68, end: 51.84 };
  words[128] = { word: "Gaming", start: 51.88, end: 52.04 };
  words[129] = { word: "beat", start: 52.08, end: 52.24 };
  const probedPaths = [];

  const cadence = await analyseNarrationCadence({
    audioManifest: { word_timestamp_count: words.length, audio_duration_seconds: 52.5 },
    timestampPayload: { words },
    transcript: transcriptWithWordCount(words.length),
    audioPath: "black-flag-narration.mp3",
    silenceProbe: async (audioPath) => {
      probedPaths.push(audioPath);
      return [{ start: 50.621, end: 51.371, duration: 0.75 }];
    },
  });

  assert.deepEqual(probedPaths, ["black-flag-narration.mp3"]);
  assert.equal(cadence.status, "fail");
  assert.ok(cadence.blockers.includes("voice_cadence:timestamp_masks_acoustic_silence"));
  assert.equal(cadence.acoustic_silence_profile.probe_status, "ok");
  assert.equal(cadence.acoustic_silence_profile.detected_silence_count, 1);
  assert.equal(cadence.acoustic_silence_profile.timestamp_masked_silence_count, 1);
  assert.deepEqual(cadence.acoustic_silence_profile.timestamp_masked_silences, [
    {
      word: "Follow",
      word_start_seconds: 50.54,
      word_end_seconds: 51.62,
      silence_start_seconds: 50.621,
      silence_end_seconds: 51.371,
      silence_duration_seconds: 0.75,
      overlap_seconds: 0.75,
      silence_overlap_ratio: 1,
    },
  ]);
});

test("narration cadence QA does not reject acoustic silence between sentence words", async () => {
  const words = [
    ["This", 0, 0.2],
    ["game", 0.3, 0.5],
    ["landed", 0.6, 0.8],
    ["today", 0.9, 1.15],
    ["Players", 1.85, 2.1],
    ["are", 2.2, 2.4],
    ["already", 2.5, 2.75],
    ["moving", 2.85, 3.1],
  ].map(([word, start, end]) => ({ word, start, end }));

  const cadence = await analyseNarrationCadence({
    audioManifest: { word_timestamp_count: words.length, audio_duration_seconds: 3.2 },
    timestampPayload: { words },
    transcript: "This game landed today. Players are already moving.",
    audioPath: "sentence-pause.mp3",
    silenceProbe: async () => [{ start: 1.2, end: 1.8, duration: 0.6 }],
  });

  assert.equal(cadence.status, "pass");
  assert.equal(cadence.acoustic_silence_profile.meaningful_silence_count, 1);
  assert.equal(cadence.acoustic_silence_profile.timestamp_masked_silence_count, 0);
  assert.deepEqual(cadence.blockers, []);
});

test("narration cadence QA exposes acoustic silence probe failure as warning evidence", async () => {
  const probeError = new Error("ffmpeg unavailable");
  probeError.code = "ffmpeg_unavailable";
  const cadence = await analyseNarrationCadence({
    audioManifest: { word_timestamp_count: 8, audio_duration_seconds: 3.2 },
    timestampPayload: { words: wordTimeline(8, 3.2) },
    transcript: "This natural narration remains valid when acoustic probing fails.",
    audioPath: "narration.mp3",
    silenceProbe: async () => {
      throw probeError;
    },
  });

  assert.equal(cadence.status, "warn");
  assert.deepEqual(cadence.blockers, []);
  assert.ok(cadence.warnings.includes("voice_cadence:acoustic_silence_probe_failed"));
  assert.equal(cadence.acoustic_silence_profile.probe_status, "failed");
  assert.equal(cadence.acoustic_silence_profile.probe_error_code, "ffmpeg_unavailable");
});

test("narration cadence QA blocks a pause between Pulse and Gaming in the CTA", async () => {
  const words = [
    ["Follow", 0, 0.2],
    ["Pulse", 0.3, 0.5],
    ["Gaming", 1.1, 1.35],
    ["so", 1.45, 1.6],
    ["you", 1.7, 1.85],
    ["never", 1.95, 2.15],
    ["miss", 2.25, 2.4],
    ["a", 2.5, 2.6],
    ["beat", 2.7, 2.9],
  ].map(([word, start, end]) => ({ word, start, end }));
  const cadence = await analyseNarrationCadence({
    audioManifest: { word_timestamp_count: words.length, audio_duration_seconds: 3.6 },
    timestampPayload: { words },
    transcript: "Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(cadence.pause_profile.cta_pulse_gaming_gap_seconds, 0.6);
  assert.ok(cadence.blockers.includes("voice_cadence:pulse_gaming_cta_gap"));
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

test("narration voice QA preserves repaired segmented local TTS continuity evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-qa-segmented-voice-"));
  const fixture = await makeNarrationQaFixture(root, {
    audioWordCount: 24,
    captionWordCount: 24,
    voiceQualityWordCount: 24,
  });
  const resolvedTimestampPath = path.join(root, "output", "audio", `${fixture.storyId}_timestamps.json`);
  const transcript = transcriptWithWordCount(24);
  await fs.outputJson(path.join(fixture.artifactDir, "canonical_story_manifest.json"), {
    story_id: fixture.storyId,
    selected_title: "Hades II Finally Hits Console",
    canonical_subject: "Hades II",
    narration_script: transcript,
  });
  await fs.outputJson(resolvedTimestampPath, {
    words: wordTimeline(24, 10),
    meta: {
      provider: "local",
      source: "local-tts-server",
      segmentedLocalTtsMaterialized: true,
      segment_count: 3,
      segment_word_counts: [8, 8, 8],
      segment_gap_s: 0.5,
      wordTimestampSource: "local_whisper_word_alignment",
      voiceMetadataRepair: {
        repaired: true,
        strategy: "merged_segment_local_voice_sidecar_evidence",
        segment_count: 3,
      },
    },
  });
  await fs.outputJson(path.join(fixture.artifactDir, "audio_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    voice_status: "materialized",
    voice_provider: "local_tts",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "output/audio/voice-repair-story_timestamps.json",
    resolved_word_timestamps_path: resolvedTimestampPath,
    word_timestamp_count: 24,
    materialized_at: "2026-05-31T01:00:00.000Z",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    audio_path: "narration.mp3",
    resolved_word_timestamps_path: resolvedTimestampPath,
    transcript,
  });
  await fs.outputJson(path.join(fixture.artifactDir, "caption_manifest.json"), {
    story_id: fixture.storyId,
    generated_at: "2026-05-31T01:10:00.000Z",
    caption_srt_path: "captions.srt",
    word_timestamps_path: resolvedTimestampPath,
    word_count: 24,
    word_timestamp_count: 24,
  });

  const built = await buildCurrentVoiceQualityReport({
    artifactDir: fixture.artifactDir,
    generatedAt: "2026-05-31T01:20:00.000Z",
  });

  assert.equal(built.voiceQualityReport.verdict, "PASS");
  assert.equal(built.voiceQualityReport.segmentedLocalTtsMaterialized, true);
  assert.equal(built.voiceQualityReport.local_tts_segment_count, 3);
  assert.equal(built.voiceQualityReport.segment_count, 3);
  assert.deepEqual(built.voiceQualityReport.segment_word_counts, [8, 8, 8]);
  assert.equal(built.voiceQualityReport.segment_gap_s, 0.5);
  assert.equal(built.voiceQualityReport.local_tts_segment_voice_continuity_verified, true);
  assert.equal(built.voiceQualityReport.segment_voice_continuity_verified, true);
});

test("narration voice QA verifies segmented local TTS continuity from approved merged local voice metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-narration-qa-segmented-approved-"));
  const fixture = await makeNarrationQaFixture(root, {
    audioWordCount: 24,
    captionWordCount: 24,
    voiceQualityWordCount: 24,
  });
  const resolvedTimestampPath = path.join(root, "output", "audio", `${fixture.storyId}_timestamps.json`);
  const transcript = transcriptWithWordCount(24);
  await fs.outputJson(path.join(fixture.artifactDir, "canonical_story_manifest.json"), {
    story_id: fixture.storyId,
    selected_title: "Hades II Finally Hits Console",
    canonical_subject: "Hades II",
    narration_script: transcript,
  });
  await fs.outputJson(resolvedTimestampPath, {
    words: wordTimeline(24, 10),
    meta: {
      provider: "local",
      source: "local-tts-server",
      segmentedLocalTtsMaterialized: true,
      segment_count: 4,
      segment_word_counts: [6, 6, 6, 6],
      segment_gap_s: 0.5,
      wordTimestampSource: "local_whisper_word_alignment",
      approvedLocalVoice: true,
      acceptedLocalVoice: {
        id: "pulse-sleepy-liam-20260502",
        referencePresent: true,
      },
      voiceMastering: {
        ok: true,
        source: "merged_segment_voice_mastering",
        segment_count: 4,
      },
    },
  });
  await fs.outputJson(path.join(fixture.artifactDir, "audio_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    voice_status: "materialized",
    voice_provider: "local_tts",
    narration_audio_path: "narration.mp3",
    word_timestamps_path: "output/audio/voice-repair-story_timestamps.json",
    resolved_word_timestamps_path: resolvedTimestampPath,
    word_timestamp_count: 24,
    materialized_at: "2026-05-31T01:00:00.000Z",
  });
  await fs.outputJson(path.join(fixture.artifactDir, "narration_manifest.json"), {
    story_id: fixture.storyId,
    status: "ready",
    audio_path: "narration.mp3",
    resolved_word_timestamps_path: resolvedTimestampPath,
    transcript,
  });
  await fs.outputJson(path.join(fixture.artifactDir, "caption_manifest.json"), {
    story_id: fixture.storyId,
    generated_at: "2026-05-31T01:10:00.000Z",
    caption_srt_path: "captions.srt",
    word_timestamps_path: resolvedTimestampPath,
    word_count: 24,
    word_timestamp_count: 24,
  });

  const built = await buildCurrentVoiceQualityReport({
    artifactDir: fixture.artifactDir,
    generatedAt: "2026-05-31T01:20:00.000Z",
  });

  assert.equal(built.voiceQualityReport.verdict, "PASS");
  assert.equal(built.voiceQualityReport.segmentedLocalTtsMaterialized, true);
  assert.equal(built.voiceQualityReport.local_tts_segment_count, 4);
  assert.deepEqual(built.voiceQualityReport.segment_word_counts, [6, 6, 6, 6]);
  assert.equal(built.voiceQualityReport.local_tts_segment_voice_continuity_verified, true);
  assert.equal(built.voiceQualityReport.segment_voice_continuity_verified, true);
  assert.equal(built.voiceQualityReport.voice_metadata_repair.repaired, true);
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
