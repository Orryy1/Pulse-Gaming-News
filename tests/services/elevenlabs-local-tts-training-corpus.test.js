"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildElevenLabsLocalTtsTrainingCorpus,
  writeElevenLabsLocalTtsTrainingCorpus,
} = require("../../lib/elevenlabs-local-tts-training-corpus");

async function writeStory(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, overrides.artifactSubPath || path.join("output", "proof", storyId));
  const mediaDir = path.join(root, "media");
  const audioPath = path.join(mediaDir, `${storyId}.mp3`);
  const timestampPath = path.join(mediaDir, `${storyId}_timestamps.json`);
  await fs.outputFile(audioPath, Buffer.from(`${storyId}-audio`));

  const words = [
    { word: "Rockstar", start: 0, end: 0.2 },
    { word: "Games", start: 0.24, end: 0.44 },
    { word: "just", start: 0.5, end: 0.66 },
    { word: "made", start: 0.7, end: 0.88 },
    { word: "Grand", start: 0.95, end: 1.12 },
    { word: "Theft", start: 1.16, end: 1.34 },
    { word: "Auto", start: 1.4, end: 1.62 },
    { word: "Six", start: 1.68, end: 1.9 },
  ];
  await fs.outputJson(
    timestampPath,
    {
      meta: {
        provider: overrides.provider || "elevenlabs",
        source: "elevenlabs-production-path",
        text: overrides.transcript ||
          "Rockstar Games just made Grand Theft Auto Six feel real in one image.",
        transcript: overrides.transcript ||
          "Rockstar Games just made Grand Theft Auto Six feel real in one image.",
        elevenlabs: {
          voiceId: "TX3LPaxmHKxFdv7VOQHJ",
          modelId: "eleven_multilingual_v2",
          speakingRate: 1,
        },
      },
      words: overrides.words || words,
    },
    { spaces: 2 },
  );

  await fs.outputJson(
    path.join(artifactDir, "audio_manifest.json"),
    {
      schema_version: 1,
      story_id: storyId,
      voice_provider: overrides.voiceProvider || "elevenlabs",
      voice_status: "materialized",
      narration_audio_path: path.relative(root, audioPath),
      resolved_narration_audio_path: audioPath,
      word_timestamps_path: path.relative(root, timestampPath),
      resolved_word_timestamps_path: timestampPath,
      word_timestamp_count: words.length,
      word_timestamp_source: "elevenlabs_alignment_normalised",
      safety: {
        external_tts_provider_used: overrides.externalProvider || "elevenlabs",
        no_publishing_side_effects: true,
        production_db_mutated: false,
        oauth_triggered: false,
      },
    },
    { spaces: 2 },
  );

  await fs.outputJson(
    path.join(artifactDir, "narration_manifest.json"),
    {
      schema_version: 1,
      story_id: storyId,
      provider: overrides.voiceProvider || "elevenlabs",
      status: "ready",
      resolved_audio_path: audioPath,
      resolved_word_timestamps_path: timestampPath,
      transcript: overrides.transcript ||
        "Rockstar Games just made Grand Theft Auto Six feel real in one image.",
      final_transcript: overrides.transcript ||
        "Rockstar Games just made Grand Theft Auto Six feel real in one image.",
      display_text: overrides.displayText ||
        "Rockstar Games just made GTA 6 feel real in one image.",
      word_timestamp_source: "elevenlabs_alignment_normalised",
      safety: {
        no_publish_triggered: true,
        no_network_uploads: true,
        no_db_mutation: true,
      },
    },
    { spaces: 2 },
  );

  return { artifactDir, audioPath, timestampPath };
}

test("ElevenLabs local TTS training corpus accepts consented production narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-corpus-ready-"));
  const { audioPath } = await writeStory(root, "gta6_cover_art");
  const expectedHash = crypto.createHash("sha256").update(await fs.readFile(audioPath)).digest("hex");

  const report = await buildElevenLabsLocalTtsTrainingCorpus({
    workspaceRoot: root,
    roots: [path.join(root, "output")],
    operatorTrainingPermission: true,
    generatedAt: "2026-06-18T17:00:00.000Z",
    minAcceptedSamples: 1,
    minWords: 5,
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.accepted_sample_count, 1);
  assert.equal(report.summary.blocked_sample_count, 0);
  assert.equal(report.samples[0].story_id, "gta6_cover_art");
  assert.equal(report.samples[0].provider, "elevenlabs");
  assert.equal(report.samples[0].voice_id, "TX3LPaxmHKxFdv7VOQHJ");
  assert.equal(report.samples[0].model_id, "eleven_multilingual_v2");
  assert.equal(report.samples[0].sha256, expectedHash);
  assert.equal(report.training_work_order.status, "blocked_no_trainer_configured");
  assert.equal(report.training_work_order.corpus_ready, true);
  assert.equal(report.rights_ledger.records[0].allowed_use, "local_pulse_tts_training_and_evaluation");
  assert.equal(report.safety.no_external_uploads, true);
});

test("ElevenLabs local TTS training corpus fails closed without operator permission", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-corpus-permission-"));
  await writeStory(root, "gta6_cover_art");

  const report = await buildElevenLabsLocalTtsTrainingCorpus({
    workspaceRoot: root,
    roots: [path.join(root, "output")],
    operatorTrainingPermission: false,
    generatedAt: "2026-06-18T17:00:00.000Z",
    minAcceptedSamples: 1,
    minWords: 5,
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.accepted_sample_count, 0);
  assert.equal(
    report.blocker_counts["elevenlabs_tts_corpus:operator_training_permission_missing"],
    1,
  );
});

test("ElevenLabs local TTS training corpus excludes local TTS samples", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-corpus-local-"));
  await writeStory(root, "local_story", {
    voiceProvider: "local_tts",
    provider: "local",
    externalProvider: null,
  });

  const report = await buildElevenLabsLocalTtsTrainingCorpus({
    workspaceRoot: root,
    roots: [path.join(root, "output")],
    operatorTrainingPermission: true,
    generatedAt: "2026-06-18T17:00:00.000Z",
    minAcceptedSamples: 1,
    minWords: 5,
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.accepted_sample_count, 0);
  assert.equal(report.blocker_counts["elevenlabs_tts_corpus:not_elevenlabs_provider"], 1);
});

test("ElevenLabs local TTS training corpus excludes platform variants by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-corpus-variant-"));
  await writeStory(root, "variant_story", {
    artifactSubPath: path.join(
      "output",
      "proof",
      "variant_story",
      "platform_variants",
      "tiktok_creator_rewards",
    ),
  });

  const report = await buildElevenLabsLocalTtsTrainingCorpus({
    workspaceRoot: root,
    roots: [path.join(root, "output")],
    operatorTrainingPermission: true,
    generatedAt: "2026-06-18T17:00:00.000Z",
    minAcceptedSamples: 1,
    minWords: 5,
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.accepted_sample_count, 0);
  assert.equal(report.blocker_counts["elevenlabs_tts_corpus:platform_variant_excluded"], 1);
});

test("ElevenLabs local TTS training corpus writes proof artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-elevenlabs-corpus-write-"));
  await writeStory(root, "gta6_cover_art");
  const outputDir = path.join(root, "out");

  const report = await buildElevenLabsLocalTtsTrainingCorpus({
    workspaceRoot: root,
    roots: [path.join(root, "output")],
    operatorTrainingPermission: true,
    generatedAt: "2026-06-18T17:00:00.000Z",
    minAcceptedSamples: 1,
    minWords: 5,
  });
  const written = await writeElevenLabsLocalTtsTrainingCorpus(report, { outputDir });

  assert.equal(await fs.pathExists(written.reportJson), true);
  assert.equal(await fs.pathExists(written.reportMarkdown), true);
  assert.equal(await fs.pathExists(written.corpusJsonl), true);
  assert.equal(await fs.pathExists(written.trainingWorkOrder), true);
  assert.equal(await fs.pathExists(written.rightsLedger), true);
  assert.match(await fs.readFile(written.corpusJsonl, "utf8"), /gta6_cover_art/);
});
