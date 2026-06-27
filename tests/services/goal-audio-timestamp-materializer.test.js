"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  materializeGoalAudioTimestamps,
  normaliseTimestampFile,
  repairMergedSegmentVoiceMetadata,
  _testables,
  writeGoalAudioTimestampMaterializationReport,
} = require("../../lib/goal-audio-timestamp-materializer");

const ACCEPTED_SLEEPY_LIAM = {
  id: "pulse-sleepy-liam-20260502",
  fileName: "pulse_liam_sleepy.wav",
  referencePresent: true,
  referenceHash: "a".repeat(40),
};

function charAlignment(text) {
  return charAlignmentWithStep(text, 0.05);
}

function charAlignmentWithStep(text, step = 0.05) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * step),
    character_end_times_seconds: characters.map((_, index) => index * step + Math.max(0.04, step - 0.01)),
  };
}

function whisperWordsFromScript(scriptText) {
  return String(scriptText || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({
      word,
      start: Number((index * 0.18).toFixed(2)),
      end: Number((index * 0.18 + 0.12).toFixed(2)),
    }));
}

async function makePackage(root, storyId = "story-audio", canonicalOverrides = {}) {
  const artifactDir = path.join(root, "output", "goal-proof", "batch", storyId);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    selected_title: "Star Fox Deal Has One Catch",
    narration_script: "Star Fox just got a sharper Switch 2 camera deal.",
    ...canonicalOverrides,
  });
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), {
    schema_version: 1,
    story_id: storyId,
    narration_audio_path: null,
    safety: { local_only: true },
  });
  return artifactDir;
}

function workbenchJob(storyId, artifactDir) {
  return {
    story_id: storyId,
    title: "Star Fox Deal Has One Catch",
    artifact_dir: artifactDir,
    status: "requires_audio_timestamp_generation",
    missing: ["narration_audio", "word_timestamps"],
  };
}

test("goal audio materializer treats stale local TTS blocks as eligible when ElevenLabs is explicit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-elevenlabs-stale-local-"));
  const artifactDir = await makePackage(root, "story-stale-local");

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    provider: "elevenlabs",
    inspectOnly: true,
    workbenchReport: {
      local_tts: {
        verdict: "stale",
        ready: false,
        reason: "local TTS doctor report is stale",
      },
      jobs: [
        {
          ...workbenchJob("story-stale-local", artifactDir),
          status: "blocked_local_tts_stale",
        },
      ],
    },
    generatedAt: "2026-05-22T06:00:00.000Z",
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.inspect_only_count, 1);
  assert.equal(report.jobs[0].story_id, "story-stale-local");
  assert.equal(report.jobs[0].status, "inspect_only_pending_generation");
});

test("goal audio materializer generates local audio, word timestamps and updates the package manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-"));
  const artifactDir = await makePackage(root);
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-audio", artifactDir)],
    },
    generatedAt: "2026-05-22T06:00:00.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(await fs.pathExists(path.join(root, "output", "audio", "story-audio.mp3")), true);
  assert.equal(await fs.pathExists(path.join(artifactDir, "audio", "narration.mp3")), true);
  assert.equal(await fs.pathExists(path.join(artifactDir, "audio", "word_timestamps.json")), true);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-audio_timestamps.json"));
  assert.ok(timestamps.words.length >= 5);
  const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
  assert.equal(manifest.narration_audio_path, "audio/narration.mp3");
  assert.equal(manifest.word_timestamps_path, "audio/word_timestamps.json");
  assert.equal(manifest.resolved_narration_audio_path, path.join(artifactDir, "audio", "narration.mp3"));
  assert.equal(manifest.resolved_word_timestamps_path, path.join(artifactDir, "audio", "word_timestamps.json"));
  assert.equal(manifest.package_audio_stabilized, true);
  assert.equal(manifest.voice_provider, "local_tts");
  assert.equal(manifest.safety.local_only, true);
  assert.equal(report.safety.no_publish_triggered, true);
});

test("goal audio materializer stabilizes same-story refill audio inside each package", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-stable-package-"));
  const artifactDirA = await makePackage(root, "story-repeat");
  const artifactDirB = path.join(root, "output", "goal-proof", "batch-b", "story-repeat");
  await fs.outputJson(path.join(artifactDirB, "canonical_story_manifest.json"), {
    story_id: "story-repeat",
    selected_title: "Star Fox Deal Has One Catch",
    narration_script: "Star Fox just got a sharper Switch 2 camera deal.",
  });
  await fs.outputJson(path.join(artifactDirB, "audio_manifest.json"), {
    schema_version: 1,
    story_id: "story-repeat",
    narration_audio_path: null,
    safety: { local_only: true },
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [
        workbenchJob("story-repeat", artifactDirA),
        workbenchJob("story-repeat", artifactDirB),
      ],
    },
    generatedAt: "2026-05-22T06:00:30.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push(outputPath);
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, calls.length));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.candidate_count, 2);
  assert.ok(report.summary.materialized_count >= 1);
  const manifestA = await fs.readJson(path.join(artifactDirA, "audio_manifest.json"));
  const manifestB = await fs.readJson(path.join(artifactDirB, "audio_manifest.json"));
  assert.equal(manifestA.narration_audio_path, "audio/narration.mp3");
  assert.equal(manifestB.narration_audio_path, "audio/narration.mp3");
  assert.equal(manifestA.word_timestamps_path, "audio/word_timestamps.json");
  assert.equal(manifestB.word_timestamps_path, "audio/word_timestamps.json");
  assert.notEqual(manifestA.resolved_narration_audio_path, manifestB.resolved_narration_audio_path);
  assert.notEqual(manifestA.resolved_word_timestamps_path, manifestB.resolved_word_timestamps_path);
  assert.equal(await fs.pathExists(manifestA.resolved_narration_audio_path), true);
  assert.equal(await fs.pathExists(manifestB.resolved_narration_audio_path), true);
});

test("goal audio materializer passes an explicit TTS rate to narration generation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-rate-"));
  const artifactDir = await makePackage(root, "story-rate");
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    provider: "elevenlabs",
    ttsRate: 0.92,
    workbenchReport: {
      elevenlabs_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-rate", artifactDir)],
    },
    generatedAt: "2026-05-22T06:00:10.000Z",
    generateTtsForStory: async ({ text, outputPath, rate, provider }) => {
      calls.push({ text, outputPath, rate, provider });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignmentWithStep(text, 0.07),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "elevenlabs");
  assert.equal(calls[0].rate, 0.92);
});

test("goal audio materializer cleans cached spoken scripts before TTS generation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-clean-spoken-"));
  const artifactDir = await makePackage(root, "story-clean-spoken", {
    selected_title: "The Expanse: Osiris Reborn Shows Real Gameplay",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Follow Pulse [PAUSE] Gaming so you never miss a beat.",
    tts_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Follow Pulse [PAUSE] Gaming so you never miss a beat.",
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    provider: "elevenlabs",
    workbenchReport: {
      elevenlabs_tts: { provider: "elevenlabs", ready: true, configured: true },
      jobs: [workbenchJob("story-clean-spoken", artifactDir)],
    },
    generatedAt: "2026-05-22T06:00:15.000Z",
    generateTtsForStory: async ({ story, text, outputPath, provider }) => {
      calls.push({ story, text, outputPath, provider });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].text,
    "The Expanse Osiris Reborn finally showed real gameplay. Follow Pulse Gaming so you never miss a beat.",
  );
  assert.equal(calls[0].story.tts_script, calls[0].text);
  assert.doesNotMatch(calls[0].text, /:|\[PAUSE\]/);
});

test("goal audio materializer force-regenerates a workbench ready pair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-force-ready-"));
  const artifactDir = await makePackage(root, "story-force-ready", {
    selected_title: "GTA VI Cover Art Just Got Revealed",
    narration_script: "Rockstar just made Grand Theft Auto VI feel real in one image.",
    tts_script: "Rockstar just made Grand Theft Auto Six feel real in one image.",
  });
  await fs.outputFile(path.join(root, "output", "audio", "story-force-ready.mp3"), Buffer.alloc(4096, 1));
  await fs.outputJson(path.join(root, "output", "audio", "story-force-ready_timestamps.json"), {
    words: [{ word: "stale", start: 0, end: 0.2 }],
    meta: {
      transcript: "stale copy",
      wordTimestampSource: "elevenlabs_alignment_normalised",
    },
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    provider: "elevenlabs",
    force: true,
    workbenchReport: {
      elevenlabs_tts: { verdict: "green", ready: true },
      jobs: [
        {
          ...workbenchJob("story-force-ready", artifactDir),
          status: "ready_audio_timestamp_pair",
          audio: {
            path: path.join(root, "output", "audio", "story-force-ready.mp3"),
            exists: true,
            usable: true,
          },
          timestamps: {
            path: path.join(root, "output", "audio", "story-force-ready_timestamps.json"),
            exists: true,
            usable: true,
            word_count: 1,
          },
        },
      ],
    },
    generatedAt: "2026-05-22T06:00:20.000Z",
    generateTtsForStory: async ({ text, outputPath, provider }) => {
      calls.push({ text, outputPath, provider });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 2));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "elevenlabs");
  assert.match(calls[0].text, /the next Grand Theft Auto/);
  assert.doesNotMatch(calls[0].text, /Grand Theft Auto Six/);
  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].provider, "elevenlabs");
});

test("goal audio materializer promotes workbench ready pairs without forced TTS regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-ready-promote-"));
  const script = "Star Fox just got a sharper Switch 2 camera deal.";
  const artifactDir = await makePackage(root, "story-ready-promote", {
    selected_title: "Star Fox Deal Has One Catch",
    narration_script: script,
  });
  const audioPath = path.join(root, "output", "audio", "story-ready-promote.mp3");
  const timestampPath = path.join(root, "output", "audio", "story-ready-promote_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
  await fs.outputJson(timestampPath, {
    words: whisperWordsFromScript(script),
    meta: {
      transcript: script,
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: {
        repaired: true,
        script_inserted_actual_word_count: 0,
        script_trailing_actual_word_count: 0,
      },
    },
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    provider: "elevenlabs",
    alignmentMode: "whisper",
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      elevenlabs_tts: { provider: "elevenlabs", ready: true, configured: true },
      jobs: [
        {
          ...workbenchJob("story-ready-promote", artifactDir),
          status: "ready_audio_timestamp_pair",
          missing: [],
          audio: { path: audioPath, exists: true, usable: true },
          timestamps: {
            path: timestampPath,
            exists: true,
            usable: true,
            word_count: script.split(/\s+/).length,
          },
        },
      ],
    },
    generatedAt: "2026-05-22T06:00:30.000Z",
    generateTtsForStory: async () => {
      throw new Error("should not regenerate workbench-ready audio");
    },
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.skipped_existing_count, 1);
  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.jobs[0].status, "skipped_existing_ready_pair");
  assert.equal(report.safety.no_tts_generation_triggered, true);
  assert.equal(report.safety.external_tts_provider_used, null);
  const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
  assert.equal(manifest.voice_provider, "existing");
  assert.equal(manifest.word_timestamp_source, "local_whisper_word_alignment");
  assert.equal(manifest.safety.no_publishing_side_effects, true);
  assert.equal(manifest.timestamp_whisper_alignment.script_inserted_actual_word_count, 0);
});

test("goal audio materializer trusts strict ready pairs with harmless transcript formatting drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-ready-format-drift-"));
  const script =
    "If Activision prices this cleanly, it gets an easy goodwill win; if not, the backlash writes itself before launch.";
  const transcript =
    "If Activision prices this cleanly, it gets an easy Goodwill win. If not, the backlash writes itself before launch.";
  const artifactDir = await makePackage(root, "story-ready-format-drift", {
    selected_title: "Black Ops Classics Face A Price Test",
    narration_script: script,
  });
  const audioPath = path.join(root, "output", "audio", "story-ready-format-drift.mp3");
  const timestampPath = path.join(root, "output", "audio", "story-ready-format-drift_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
  await fs.outputJson(timestampPath, {
    words: whisperWordsFromScript(transcript),
    meta: {
      transcript,
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: {
        repaired: true,
        script_inserted_actual_word_count: 0,
        script_trailing_actual_word_count: 0,
      },
    },
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    provider: "elevenlabs",
    alignmentMode: "whisper",
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      elevenlabs_tts: { provider: "elevenlabs", ready: true, configured: true },
      jobs: [
        {
          ...workbenchJob("story-ready-format-drift", artifactDir),
          status: "ready_audio_timestamp_pair",
          missing: [],
          audio: { path: audioPath, exists: true, usable: true },
          timestamps: {
            path: timestampPath,
            exists: true,
            usable: true,
            word_count: script.split(/\s+/).length,
          },
        },
      ],
    },
    generatedAt: "2026-06-22T18:40:00.000Z",
    alignWordsWithAudio: async () => {
      throw new Error("should not rerun Whisper for harmless transcript formatting drift");
    },
    generateTtsForStory: async () => {
      throw new Error("should not regenerate workbench-ready audio");
    },
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.skipped_existing_count, 1);
  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.jobs[0].status, "skipped_existing_ready_pair");
});

test("goal audio materializer regenerates title-colon audio without the current pronunciation profile", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-title-colon-profile-"));
  const artifactDir = await makePackage(root, "story-title-colon-profile", {
    selected_title: "Halo: Campaign Evolved Shows The Real Remake Test",
    narration_script: "Halo: Campaign Evolved just gave Xbox a real remake test.",
    tts_script: "Halo: Campaign Evolved just gave Xbox a real remake test.",
  });
  const audioPath = path.join(root, "output", "audio", "story-title-colon-profile.mp3");
  const timestampPath = path.join(root, "output", "audio", "story-title-colon-profile_timestamps.json");
  const oldTranscript = "Halo Campaign Evolved just gave Xbox a real remake test.";
  await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
  await fs.outputJson(timestampPath, {
    words: whisperWordsFromScript(oldTranscript),
    meta: {
      transcript: oldTranscript,
      spoken_text: oldTranscript,
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: {
        repaired: true,
        script_inserted_actual_word_count: 0,
        script_trailing_actual_word_count: 0,
      },
    },
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    provider: "local",
    alignmentMode: "whisper",
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [
        {
          ...workbenchJob("story-title-colon-profile", artifactDir),
          status: "ready_audio_timestamp_pair",
          missing: [],
          audio: { path: audioPath, exists: true, usable: true },
          timestamps: {
            path: timestampPath,
            exists: true,
            usable: true,
            word_count: oldTranscript.split(/\s+/).length,
          },
        },
      ],
    },
    generatedAt: "2026-06-23T19:10:00.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 2));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "fixture",
      words: whisperWordsFromScript(scriptText),
      transcript: scriptText,
      language: "en",
      segments: 1,
    }),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "Halo Campaign Evolved just gave Xbox a real remake test.");
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].reason, "existing_pair_stale_after_title_colon_pronunciation_profile");
  const timestamps = await fs.readJson(timestampPath);
  assert.equal(timestamps.meta.ttsPronunciationProfileVersion, "gta-safe-next-title-v7");
  assert.equal(timestamps.meta.spoken_text, "Halo Campaign Evolved just gave Xbox a real remake test.");
});

test("goal audio materializer syncs canonical narration metadata after public-copy repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-canonical-sync-"));
  const repairedScript = "The Expanse finally showed real gameplay.";
  const artifactDir = await makePackage(root, "story-canonical-sync", {
    selected_title: "The Expanse Shows Real Gameplay",
    narration_script: repairedScript,
    tts_script: repairedScript,
    word_count: 135,
    public_copy_repaired_at: "2026-05-28T09:07:00.000Z",
    duration_variant_repaired_at: "2026-05-28T08:00:00.000Z",
    duration_variant_extension: {
      repaired_word_count: 135,
      target_word_count: 130,
    },
  });

  await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-canonical-sync", artifactDir)],
    },
    generatedAt: "2026-05-28T09:15:00.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignmentWithStep(text, 0.07),
      });
      return { ok: true };
    },
  });

  const canonical = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(canonical.word_count, repairedScript.split(/\s+/).length);
  assert.equal(canonical.tts_word_count, repairedScript.split(/\s+/).length);
  assert.equal(canonical.audio_word_timestamp_count, repairedScript.split(/\s+/).length);
  assert.equal(canonical.duration_variant_status, "invalidated_requires_repair");
  assert.equal(canonical.duration_variant_invalidated_reason, "narration_script_changed_after_duration_variant_repair");
});

test("goal audio materializer refreshes stale narration and caption manifests after audio regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-manifest-refresh-"));
  const script = "Hades II finally has a PlayStation and Xbox date.";
  const artifactDir = await makePackage(root, "story-manifest-refresh", {
    selected_title: "Hades II Just Broke PlayStation's Silence",
    narration_script: script,
  });
  await fs.outputJson(path.join(artifactDir, "narration_manifest.json"), {
    status: "ready",
    generated_at: "2026-05-22T05:00:00.000Z",
    transcript: "Hades, two finally has a PlayStation and Xbox date.",
    final_transcript: "Hades, two finally has a PlayStation and Xbox date.",
    word_timestamps_path: "output/audio/story-manifest-refresh_timestamps.json",
  });
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), {
    status: "ready",
    generated_at: "2026-05-22T05:00:00.000Z",
    word_timestamps_path: "output/audio/story-manifest-refresh_timestamps.json",
  });
  await fs.outputFile(
    path.join(artifactDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:01,000\nHades, two stale caption.\n",
  );

  await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-manifest-refresh", artifactDir)],
    },
    generatedAt: "2026-05-22T06:00:50.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignmentWithStep(text, 0.07),
      });
      return { ok: true };
    },
  });

  const narration = await fs.readJson(path.join(artifactDir, "narration_manifest.json"));
  assert.equal(narration.generated_at, "2026-05-22T06:00:50.000Z");
  assert.equal(narration.transcript, "Hades two finally has a PlayStation and Xbox date.");
  assert.equal(narration.final_transcript, "Hades two finally has a PlayStation and Xbox date.");
  assert.equal(narration.word_timestamp_source, "local_alignment_normalised");
  assert.equal(narration.status, "ready");
  assert.deepEqual(narration.blockers, []);
  assert.equal(narration.checks.narration_audio_present, true);
  assert.equal(narration.checks.narration_audio_usable, true);
  assert.doesNotMatch(narration.transcript, /Hades, two/);

  const captions = await fs.readJson(path.join(artifactDir, "caption_manifest.json"));
  assert.equal(captions.generated_at, "2026-05-22T06:00:50.000Z");
  assert.equal(captions.word_timestamp_source, "local_alignment_normalised");
  assert.equal(captions.transcript, "Hades two finally has a PlayStation and Xbox date.");
  assert.equal(captions.caption_srt_path, path.join(artifactDir, "captions.srt"));
  assert.equal(captions.status, "ready");
  assert.deepEqual(captions.blockers, []);
  assert.equal(captions.checks.caption_file_present, true);
  assert.equal(captions.checks.captions_well_formed, true);
  const srt = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  assert.match(srt, /Hades II finally/);
  assert.match(srt, /has a PlayStation/);
  assert.doesNotMatch(srt, /stale caption|Hades, two/);

  const voiceQuality = await fs.readJson(path.join(artifactDir, "voice_quality_report.json"));
  assert.equal(voiceQuality.generated_at, "2026-05-22T06:00:50.000Z");
  assert.equal(voiceQuality.verdict, "PASS");
  assert.deepEqual(voiceQuality.blockers, []);
  assert.equal(voiceQuality.checks.narration_audio_present, true);
  assert.equal(voiceQuality.checks.narration_audio_usable, true);
  assert.equal(voiceQuality.checks.captions_well_formed, true);
  assert.equal(voiceQuality.word_timestamp_count, script.split(/\s+/).length);
});

test("goal audio materializer separates spoken TTS text from display captions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-display-captions-"));
  const displayScript = "Grand Theft Auto VI pre orders open on June 25.";
  const spokenScript = "Rockstar's next Grand Theft Auto pre orders open on June 25.";
  const artifactDir = await makePackage(root, "story-display-captions", {
    selected_title: "Grand Theft Auto VI Cover Art",
    narration_script: displayScript,
    tts_script: spokenScript,
  });

  const calls = [];
  await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-display-captions", artifactDir)],
    },
    generatedAt: "2026-05-22T06:00:55.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push(text);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.deepEqual(calls, [spokenScript]);
  const captions = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  assert.match(captions, /GTA/);
  assert.match(captions, /\bVI\b/);
  assert.match(captions, /June/);
  assert.match(captions, /\b25\./);
  assert.doesNotMatch(captions, /Grand Theft Auto six/);
});

test("goal audio materializer anchors local word timestamps to measured speech pauses", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-anchored-"));
  const script =
    "Hades II just put PlayStation and Xbox players on the same April countdown. Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.";
  const artifactDir = await makePackage(root, "story-anchored", {
    selected_title: "Hades II Just Broke PlayStation's Silence",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-anchored", artifactDir)],
    },
    generatedAt: "2026-05-22T06:00:30.000Z",
    detectSilencesForAudio: async () => [
      { start: 0, end: 0.266, duration: 0.266 },
      { start: 4.793, end: 5.279, duration: 0.486 },
      { start: 10.2, end: 10.45, duration: 0.25 },
    ],
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-anchored_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_audio_silence_anchored");
  assert.equal(timestamps.meta.timestampAudioAnchor.strategy, "audio_silence_sentence_anchored");
  assert.equal(Number(timestamps.words[0].start.toFixed(3)), 0.266);
  assert.ok(timestamps.words.find((word) => word.word.startsWith("Xbox's")).start >= 5.279);
});

test("goal audio materializer sends spoken pronunciation text while preserving display text metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-hades-spoken-"));
  const script = "Hades II finally has a PlayStation and Xbox date.";
  const artifactDir = await makePackage(root, "story-hades-spoken", {
    selected_title: "Hades II Just Broke PlayStation's Silence",
    narration_script: script,
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-hades-spoken", artifactDir)],
    },
    generatedAt: "2026-05-22T06:00:40.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(calls[0].text, "Hades two finally has a PlayStation and Xbox date.");
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-hades-spoken_timestamps.json"));
  assert.equal(timestamps.meta.text, script);
  assert.equal(timestamps.meta.transcript, "Hades two finally has a PlayStation and Xbox date.");
  assert.equal(timestamps.words.filter((word) => /^Hades/i.test(word.word) || word.word === "two").length, 2);
  assert.ok(timestamps.words.some((word) => word.word === "two"));
});

test("goal audio materializer segments long local-clone narration before strict Whisper validation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-segmented-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = root;
  const script = [
    "Black Flag's remake rumour is not interesting because the map may be bigger.",
    "It is interesting because Ubisoft now has to sell nostalgia to players who remember how sharp the original already felt.",
    "The useful angle is the pressure on traversal, ship combat and stealth pacing.",
    "If those three pieces feel slower, the remake risks looking prettier while playing worse.",
    "That is the part worth watching before anyone treats a new trailer like a guaranteed win.",
  ].join(" ");
  const artifactDir = await makePackage(root, "story-segmented", {
    selected_title: "Black Flag Remake Has One Trap",
    narration_script: script,
  });
  const calls = [];

  try {
    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "green", ready: true },
        jobs: [workbenchJob("story-segmented", artifactDir)],
      },
      generatedAt: "2026-05-27T10:00:00.000Z",
      alignmentMode: "whisper",
      localTtsSegmentedMaterializer: true,
      localTtsSegmentedWordThreshold: 20,
      localTtsSegmentMaxWords: 18,
      getAudioDuration: async () => 2.5,
      concatAudioFiles: async (files, outputPath) => {
        assert.ok(files.length > 1);
        await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      },
      alignWordsWithAudio: async ({ scriptText }) => ({
        ok: true,
        source: "local_whisper_word_alignment",
        model: "tiny.en",
        transcript: scriptText,
        words: whisperWordsFromScript(scriptText),
      }),
      generateTtsForStory: async ({ text, outputPath }) => {
        calls.push({ text, outputPath });
        await fs.outputFile(path.join(root, outputPath), Buffer.alloc(2048, 1));
        await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
          alignment: {
            ...charAlignment(text),
            meta: {
              provider: "local",
              source: "local-production-voxcpm-path",
              approvedLocalVoice: true,
              acceptedLocalVoice: ACCEPTED_SLEEPY_LIAM,
              acoustic: {
                medianPitchHz: 118,
                integratedLufs: -16.2,
                truePeakDb: -2.4,
              },
              voiceMastering: {
                ok: true,
                code: "voice_mastered",
                targetLufs: -16,
                truePeak: -2.2,
              },
            },
          },
        });
        return { ok: true };
      },
    });

    assert.equal(report.summary.materialized_count, 1);
    assert.equal(report.jobs[0].status, "materialized");
    assert.ok(calls.length > 1);
    assert.equal(calls.some((call) => call.text === script), false);
    assert.ok(calls.every((call) => call.text.split(/\s+/).length <= 22));
    const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-segmented_timestamps.json"));
    assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
    assert.equal(timestamps.meta.segmentedLocalTtsMaterialized, true);
    assert.equal(timestamps.meta.segment_count, calls.length);
    assert.equal(timestamps.meta.provider, "local");
    assert.equal(timestamps.meta.source, "local-production-voxcpm-path");
    assert.equal(timestamps.meta.approvedLocalVoice, true);
    assert.equal(timestamps.meta.acceptedLocalVoice.id, "pulse-sleepy-liam-20260502");
    assert.equal(timestamps.meta.acceptedLocalVoice.referencePresent, true);
    assert.equal(timestamps.meta.voiceMastering.code, "voice_mastered");
    assert.equal(timestamps.meta.acoustic.medianPitchHz, 118);
    assert.equal(timestamps.meta.timestampWhisperAlignment.script_opening_covered, true);
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("goal audio materializer keeps production local TTS as a single take unless segmentation is explicit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-single-take-"));
  const script = [
    "Beastro's Xbox launch is not just cosy background noise.",
    "It matters because Game Pass keeps needing smaller games that still explain themselves instantly.",
    "The whole pitch is simple: cook, serve and survive a deckbuilding restaurant run.",
    "That makes it easier to sell than another vague creature collector, but harder to sustain if the loop feels thin.",
    "The useful question is whether Beastro becomes a repeatable comfort game or just a cute one-night curiosity.",
  ].join(" ");
  const artifactDir = await makePackage(root, "story-single-take", {
    selected_title: "Beastro Has A Cozy Deckbuilding Test",
    narration_script: script,
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-single-take", artifactDir)],
    },
    generatedAt: "2026-06-16T12:30:00.000Z",
    alignmentMode: "whisper",
    localTtsSegmentedWordThreshold: 20,
    localTtsSegmentMaxWords: 18,
    getAudioDuration: async () => 38,
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      words: whisperWordsFromScript(scriptText),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: {
          ...charAlignment(text),
          meta: {
            provider: "local",
            source: "local-production-voxcpm-path",
            approvedLocalVoice: true,
            acceptedLocalVoice: ACCEPTED_SLEEPY_LIAM,
          },
        },
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /^Beastrow's Xbox launch is not just cosy background noise\./);
  assert.match(calls[0].text, /Beastrow becomes a repeatable comfort game/);
  assert.match(calls[0].outputPath, /output[\\/]audio[\\/]\.staging[\\/]story-single-take_/);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-single-take_timestamps.json"));
  assert.notEqual(timestamps.meta.segmentedLocalTtsMaterialized, true);
  assert.equal(timestamps.meta.segment_count, undefined);
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
});

test("goal audio materializer avoids tiny trailing local-clone TTS segments", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-no-short-tail-"));
  const script =
    "Helldivers players expected armour crossover news after the latest leak framed the update around possible Warhammer rewards but the stronger story is what Arrowhead confirmed what remains unconfirmed and what squads should act on.";
  const artifactDir = await makePackage(root, "story-no-short-tail", {
    selected_title: "Helldivers Armour Leak Has One Catch",
    narration_script: script,
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-no-short-tail", artifactDir)],
    },
    generatedAt: "2026-05-27T17:30:00.000Z",
    alignmentMode: "whisper",
    localTtsSegmentedMaterializer: true,
    localTtsSegmentedWordThreshold: 20,
    localTtsSegmentMaxWords: 16,
    getAudioDuration: async () => 2.5,
    concatAudioFiles: async (files, outputPath) => {
      assert.ok(files.length > 1);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
    },
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      words: whisperWordsFromScript(scriptText),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(2048, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: {
          ...charAlignment(text),
          meta: {
            provider: "local",
            source: "local-production-voxcpm-path",
            approvedLocalVoice: true,
            acceptedLocalVoice: ACCEPTED_SLEEPY_LIAM,
          },
        },
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].status, "materialized");
  assert.ok(calls.length > 1);
  assert.equal(calls.some((call) => call.text.trim().toLowerCase() === "act on."), false);
  assert.ok(
    calls.every((call) => call.text.trim().split(/\s+/).length >= 3 && call.text.trim().length >= 24),
    calls.map((call) => call.text).join(" | "),
  );
});

test("goal audio materializer keeps short comma-led transitions with the following local-clone segment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-transition-fragment-"));
  const script = [
    "A confirmed timeline would turn this from business noise into a clearer launch pressure story.",
    "Until then, the audience has two questions about Krafton and whether the sequel still looks strong.",
  ].join(" ");
  const artifactDir = await makePackage(root, "story-transition-fragment", {
    selected_title: "Subnautica 2 Bonus Fight Got Bigger",
    narration_script: script,
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-transition-fragment", artifactDir)],
    },
    generatedAt: "2026-05-27T17:45:00.000Z",
    alignmentMode: "whisper",
    localTtsSegmentedMaterializer: true,
    localTtsSegmentedWordThreshold: 12,
    localTtsSegmentMaxWords: 12,
    getAudioDuration: async () => 2.5,
    concatAudioFiles: async (files, outputPath) => {
      assert.ok(files.length > 1);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
    },
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      words: whisperWordsFromScript(scriptText),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(2048, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.ok(calls.length > 1);
  assert.equal(
    calls.some((call) => /Until then,?$/i.test(call.text.trim())),
    false,
  );
  assert.equal(
    calls.some((call) => /^Until then,?$/i.test(call.text.trim())),
    false,
  );
});

test("local-clone segment splitter does not strand short comma-ending retry fragments", () => {
  const script = [
    "Subnautica 2's bonus fight now looks bigger than the sequel hype.",
    "Aftermath reports Subnautica 2's developers appear to be in line for a 250 million dollars bonus.",
    "Fans are watching the sequel and the payout fight at the same time, which makes every official update land heavier.",
    "Subnautica 2 is now carrying a business fight as much as sequel hype.",
    "Studio control, publisher timing and the reported creator payout are all colliding in public.",
    "Krafton now has to sell the sequel while the creators' reward story is still in the room.",
    "That makes each official update land with a business question attached, not just a gameplay one.",
    "A confirmed timeline would turn this from business noise into a clearer launch pressure story.",
    "Until then, the audience has two questions: what changed inside Krafton, and whether the sequel still looks strong.",
  ].join(" ");

  const segments = _testables.splitLocalTtsSegments(script, { maxWords: 12 });

  assert.equal(
    segments.some((segment) => /launch pressure story\. Until then,?$/i.test(segment.trim())),
    false,
    segments.join(" | "),
  );
  assert.equal(
    segments.some((segment) => segment.trim().endsWith(",") && segment.trim().split(/\s+/).length <= 6),
    false,
    segments.join(" | "),
  );
});

test("local-clone segment splitter clamps tiny max word settings to avoid choppy micro-segments", () => {
  const script = [
    "Fable has an open-world risk players will judge on day one.",
    "Xbox Wire says Albion's Living Population system covers more than one thousand NPCs, each with a personality and a life that moves while you are elsewhere.",
    "That is not a background feature.",
    "It is the fantasy.",
    "Fable only works if the world remembers whether you were charming, cruel, ridiculous or a total problem.",
    "Players will judge those routines, repeated dialogue and brittle reactions until the promise cracks, or until Albion starts creating stories worth retelling.",
    "If it feels alive, Xbox gets a world people talk about for months.",
    "If it feels staged, the headline becomes a bug-hunt.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");

  const segments = _testables.splitLocalTtsSegments(script, { maxWords: 8 });

  assert.ok(segments.length <= 8, segments.join(" | "));
  assert.equal(
    segments.some((segment) => segment.trim().split(/\s+/).length < 6),
    false,
    segments.join(" | "),
  );
});

test("local-clone segment splitter keeps protected gaming names inside one segment", () => {
  const script = [
    "Grand Theft Auto VI just turned cover art into a preorder fight with players watching every version closely.",
    "Halo Campaign Evolved should be spoken as one title when the remake debate comes up.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");

  const segments = _testables.splitLocalTtsSegments(script, { maxWords: 3, allowMicroSegments: true });
  const joined = segments.join(" | ");

  assert.equal(/Grand Theft(?:\s*\|\s*)Auto/i.test(joined), false, joined);
  assert.equal(/Grand Theft Auto(?:\s*\|\s*)VI/i.test(joined), false, joined);
  assert.equal(/Halo(?:\s*\|\s*)Campaign/i.test(joined), false, joined);
  assert.equal(/Campaign(?:\s*\|\s*)Evolved/i.test(joined), false, joined);
  assert.equal(/Pulse(?:\s*\|\s*)Gaming/i.test(joined), false, joined);
});

test("goal audio voice metadata repair restores approved local metadata from segment sidecars", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-voice-meta-repair-"));
  const storyId = "story-voice-meta-repair";
  const finalTimestampPath = path.join(root, "output", "audio", `${storyId}_timestamps.json`);
  const segmentPath = path.join(root, "output", "audio", `${storyId}_goal_segment_01_timestamps.json`);
  await fs.outputJson(finalTimestampPath, {
    words: whisperWordsFromScript("Mega Mewtwo lands now."),
    meta: {
      segmentedLocalTtsMaterialized: true,
      segment_audio_paths: [`output/audio/${storyId}_goal_segment_01.mp3`],
      wordTimestampSource: "local_whisper_word_alignment",
      transcript: "Mega Mewtwo lands now. Follow Pulse Gaming so you never miss a beat.",
    },
  });
  await fs.outputJson(segmentPath, {
    alignment: {
      ...charAlignment("Mega Mewtwo lands now."),
      meta: {
        provider: "local",
        source: "local-production-voxcpm-path",
        approvedLocalVoice: true,
        acceptedLocalVoice: ACCEPTED_SLEEPY_LIAM,
        acoustic: {
          medianPitchHz: 118,
          integratedLufs: -16.2,
          truePeakDb: -2.4,
        },
        voiceMastering: {
          ok: true,
          code: "voice_mastered",
          targetLufs: -16,
          truePeak: -2.2,
        },
      },
    },
  });

  const report = await repairMergedSegmentVoiceMetadata({
    workspaceRoot: root,
    storyId,
    applyLocal: true,
    generatedAt: "2026-05-27T16:55:00.000Z",
  });

  assert.equal(report.action, "applied_segment_voice_metadata");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.safety.posts_to_platforms, false);
  assert.equal(report.safety.mutates_production_db, false);
  const repaired = await fs.readJson(finalTimestampPath);
  assert.equal(repaired.meta.provider, "local");
  assert.equal(repaired.meta.source, "local-production-voxcpm-path");
  assert.equal(repaired.meta.acceptedLocalVoice.id, "pulse-sleepy-liam-20260502");
  assert.equal(repaired.meta.voiceMastering.code, "voice_mastered");
  assert.equal(repaired.meta.acoustic.medianPitchHz, 118);
  assert.equal(repaired.meta.voiceMetadataRepair.repaired, true);
});

test("goal audio materializer shrinks local-clone segments after strict ASR retry failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-retry-segments-"));
  const script = Array.from({ length: 12 }, (_, index) =>
    `Star Wars squad pressure beat ${index + 1} keeps the mission tense tonight.`
  ).join(" ");
  const artifactDir = await makePackage(root, "story-retry-segments", {
    selected_title: "Star Wars Zero Company Needs Real Pressure",
    narration_script: script,
  });
  const calls = [];
  let alignmentAttempt = 0;

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-retry-segments", artifactDir)],
    },
    generatedAt: "2026-05-27T13:30:00.000Z",
    alignmentMode: "whisper",
    localTtsSegmentedMaterializer: true,
    localTtsSegmentedWordThreshold: 20,
    localTtsSegmentMaxWords: 30,
    getAudioDuration: async () => 1.5,
    concatAudioFiles: async (files, outputPath) => {
      assert.ok(files.length > 1);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
    },
    alignWordsWithAudio: async ({ scriptText }) => {
      alignmentAttempt += 1;
      if (alignmentAttempt === 1) {
        const damaged = scriptText.replace("pressure beat 5 keeps", "pressure beat 5 beat 5 keeps");
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model: "tiny.en",
          transcript: damaged,
          words: whisperWordsFromScript(damaged),
        };
      }
      return {
        ok: true,
        source: "local_whisper_word_alignment",
        model: "tiny.en",
        transcript: scriptText,
        words: whisperWordsFromScript(scriptText),
      };
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(2048, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  const segmentWordCounts = calls
    .filter((call) => call.outputPath.includes("_goal_segment_"))
    .map((call) => call.text.split(/\s+/).filter(Boolean).length);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].generation_attempts, 2);
  assert.ok(segmentWordCounts.some((count) => count > 12));
  assert.ok(segmentWordCounts.some((count) => count <= 12));
  assert.ok(segmentWordCounts.at(-1) <= 12);
});

test("goal audio materializer makes a smaller third local-clone pass after a retry TTS drop", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-third-pass-"));
  const script = Array.from({ length: 10 }, (_, index) =>
    `Mega Mewtwo raid timing beat ${index + 1} keeps returning players watching closely.`
  ).join(" ");
  const artifactDir = await makePackage(root, "story-third-pass", {
    selected_title: "Mega Mewtwo Needs A Clear Raid Window",
    narration_script: script,
  });
  const calls = [];
  let alignmentAttempt = 0;
  let simulatedDropUsed = false;

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-third-pass", artifactDir)],
    },
    generatedAt: "2026-05-27T13:50:00.000Z",
    alignmentMode: "whisper",
    localTtsSegmentedMaterializer: true,
    localTtsSegmentedWordThreshold: 20,
    localTtsSegmentMaxWords: 30,
    getAudioDuration: async () => 1.2,
    concatAudioFiles: async (files, outputPath) => {
      assert.ok(files.length > 1);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
    },
    alignWordsWithAudio: async ({ scriptText }) => {
      alignmentAttempt += 1;
      if (alignmentAttempt === 1) {
        const damaged = scriptText.replace("returning players watching", "returning players players watching");
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model: "tiny.en",
          transcript: damaged,
          words: whisperWordsFromScript(damaged),
        };
      }
      return {
        ok: true,
        source: "local_whisper_word_alignment",
        model: "tiny.en",
        transcript: scriptText,
        words: whisperWordsFromScript(scriptText),
      };
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const count = text.split(/\s+/).filter(Boolean).length;
      if (alignmentAttempt >= 1 && !simulatedDropUsed && count > 8) {
        simulatedDropUsed = true;
        throw new Error("tts_failed:Request failed with status code 500");
      }
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(2048, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  const retrySegmentCounts = calls
    .filter((call) => call.outputPath.includes("_goal_segment_"))
    .map((call) => call.text.split(/\s+/).filter(Boolean).length);
  assert.equal(simulatedDropUsed, true);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].generation_attempts, 3);
  assert.ok(retrySegmentCounts.some((count) => count > 8));
  assert.ok(retrySegmentCounts.at(-1) <= 8);
});

test("goal audio materializer retries recoverable local TTS server errors", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-server-retry-"));
  const script = Array.from({ length: 7 }, (_, index) =>
    `Crimson Desert launch proof beat ${index + 1} keeps the shipped build under pressure.`
  ).join(" ");
  const artifactDir = await makePackage(root, "story-server-retry", {
    selected_title: "Crimson Desert Is Already Live",
    narration_script: script,
  });
  const calls = [];
  let failedOnce = false;

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-server-retry", artifactDir)],
    },
    generatedAt: "2026-05-27T20:20:00.000Z",
    alignmentMode: "whisper",
    localTtsSegmentedWordThreshold: 20,
    localTtsSegmentMaxWords: 30,
    getAudioDuration: async () => 1.2,
    concatAudioFiles: async (files, outputPath) => {
      assert.ok(files.length > 1);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
    },
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      words: whisperWordsFromScript(scriptText),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      if (!failedOnce) {
        failedOnce = true;
        throw new Error("local_tts_generation_failed:server_error:local TTS server returned a recoverable generation error");
      }
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(2048, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(failedOnce, true);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].generation_attempts, 2);
  assert.ok(calls.length > 1);
});

test("goal audio materializer retries local TTS server_down during strict Whisper generation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-server-down-retry-"));
  const script = Array.from({ length: 7 }, (_, index) =>
    `Marathon extraction proof beat ${index + 1} keeps the build under pressure for launch.`
  ).join(" ");
  const artifactDir = await makePackage(root, "story-server-down-retry", {
    selected_title: "Marathon Needs Its Next Proof Point",
    narration_script: script,
  });
  const calls = [];
  let failedOnce = false;

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-server-down-retry", artifactDir)],
    },
    generatedAt: "2026-06-07T15:30:00.000Z",
    alignmentMode: "whisper",
    localTtsSegmentedWordThreshold: 20,
    localTtsSegmentMaxWords: 30,
    getAudioDuration: async () => 1.2,
    concatAudioFiles: async (files, outputPath) => {
      assert.ok(files.length > 1);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
    },
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      words: whisperWordsFromScript(scriptText),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      if (!failedOnce) {
        failedOnce = true;
        throw new Error("local_tts_generation_failed:server_down:local TTS server is not reachable");
      }
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(2048, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(failedOnce, true);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].generation_attempts, 2);
  assert.ok(calls.length > 1);
});

test("goal audio materializer retries local TTS connection resets during strict Whisper generation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-connection-reset-retry-"));
  const script = Array.from({ length: 7 }, (_, index) =>
    `V Rising vampire world proof beat ${index + 1} keeps the next project under pressure.`
  ).join(" ");
  const artifactDir = await makePackage(root, "story-connection-reset-retry", {
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    narration_script: script,
  });
  const calls = [];
  let failedOnce = false;

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-connection-reset-retry", artifactDir)],
    },
    generatedAt: "2026-05-27T21:10:00.000Z",
    alignmentMode: "whisper",
    localTtsSegmentedWordThreshold: 20,
    localTtsSegmentMaxWords: 30,
    getAudioDuration: async () => 1.2,
    concatAudioFiles: async (files, outputPath) => {
      assert.ok(files.length > 1);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
    },
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      words: whisperWordsFromScript(scriptText),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      if (!failedOnce) {
        failedOnce = true;
        throw new Error("local_tts_generation_failed:connection_reset:local TTS connection reset during generation");
      }
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(2048, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(failedOnce, true);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].generation_attempts, 2);
  assert.ok(calls.length > 1);
});

test("goal audio materializer aligns expanded PlayStation hardware names when Whisper emits digits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-ps5-spoken-"));
  const script = "PS5 prices went up across Europe and the UK.";
  const artifactDir = await makePackage(root, "story-ps5-spoken", {
    selected_title: "PS5 Prices Went Up In Europe",
    narration_script: script,
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-ps5-spoken", artifactDir)],
    },
    generatedAt: "2026-05-26T19:20:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "PlayStation 5 prices went up across Europe and the UK.",
      words: [
        { word: "PlayStation", start: 0.08, end: 0.46 },
        { word: "5", start: 0.48, end: 0.62 },
        { word: "prices", start: 0.64, end: 0.88 },
        { word: "went", start: 0.9, end: 1.06 },
        { word: "up", start: 1.08, end: 1.2 },
        { word: "across", start: 1.22, end: 1.48 },
        { word: "Europe", start: 1.5, end: 1.8 },
        { word: "and", start: 1.82, end: 1.94 },
        { word: "the", start: 1.96, end: 2.08 },
        { word: "UK.", start: 2.1, end: 2.32 },
      ],
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls[0].text, "PlayStation five prices went up across Europe and the UK.");
  assert.equal(report.summary.materialized_count, 1);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-ps5-spoken_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_opening_covered, true);
  assert.deepEqual(
    timestamps.words.slice(0, 3).map((word) => word.word),
    ["PlayStation", "5", "prices"],
  );
});

test("goal audio materializer aligns GTA sequel numbers in spoken form while preserving display text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-gta-spoken-"));
  const script = "GTA 5 just became the GTA 6 waiting room.";
  const artifactDir = await makePackage(root, "story-gta-spoken", {
    selected_title: "GTA 5 Became The GTA 6 Waiting Room",
    narration_script: script,
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-gta-spoken", artifactDir)],
    },
    generatedAt: "2026-06-12T19:30:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "Grand Theft Auto five just became the next Grand Theft Auto waiting room.",
      words: [
        { word: "Grand", start: 0.08, end: 0.22 },
        { word: "Theft", start: 0.24, end: 0.4 },
        { word: "Auto", start: 0.42, end: 0.58 },
        { word: "five", start: 0.6, end: 0.78 },
        { word: "just", start: 0.8, end: 0.94 },
        { word: "became", start: 0.96, end: 1.22 },
        { word: "the", start: 1.24, end: 1.36 },
        { word: "next", start: 1.38, end: 1.52 },
        { word: "Grand", start: 1.54, end: 1.7 },
        { word: "Theft", start: 1.72, end: 1.88 },
        { word: "Auto", start: 1.9, end: 2.12 },
        { word: "waiting", start: 2.14, end: 2.44 },
        { word: "room.", start: 2.46, end: 2.7 },
      ],
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls[0].text, "Grand Theft Auto five just became the next Grand Theft Auto waiting room.");
  assert.equal(report.summary.materialized_count, 1);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-gta-spoken_timestamps.json"));
  assert.equal(timestamps.meta.text, script);
  assert.equal(timestamps.meta.transcript, "Grand Theft Auto five just became the next Grand Theft Auto waiting room.");
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 0);
});

test("goal audio materializer coverage treats compact and split outlet/game phrases as same words", () => {
  const scriptText = "GameSpot says G T A six pre-orders open today, wait or skip.";
  const words = [
    { word: "Game", start: 0, end: 0.18 },
    { word: "Spot", start: 0.18, end: 0.36 },
    { word: "says", start: 0.38, end: 0.52 },
    { word: "GTA", start: 0.54, end: 0.74 },
    { word: "six", start: 0.76, end: 0.94 },
    { word: "preorders", start: 0.96, end: 1.24 },
    { word: "open", start: 1.26, end: 1.44 },
    { word: "today,", start: 1.46, end: 1.7 },
    { word: "weight", start: 1.72, end: 1.94 },
    { word: "or", start: 1.96, end: 2.04 },
    { word: "skip.", start: 2.06, end: 2.3 },
  ];

  const coverage = _testables.analyseWhisperScriptCoverage({ words, scriptText });

  assert.equal(coverage.ok, true);
  assert.equal(coverage.inserted_actual_word_count, 0);
  assert.equal(coverage.unmatched_expected_word_count, 0);
});

test("goal audio materializer coverage accepts GTA VI roman numeral ASR variants without allowing inserted words", () => {
  const scriptText =
    "Grand Theft Auto VI now has one real preorder catch. Follow Pulse Gaming so you never miss a beat.";
  const words = [
    { word: "Grand", start: 0, end: 0.18 },
    { word: "Theft", start: 0.2, end: 0.38 },
    { word: "Auto", start: 0.4, end: 0.58 },
    { word: "6", start: 0.6, end: 0.72 },
    { word: "ic", start: 0.72, end: 0.8 },
    { word: "now", start: 0.82, end: 0.96 },
    { word: "has", start: 0.98, end: 1.1 },
    { word: "one", start: 1.12, end: 1.24 },
    { word: "real", start: 1.26, end: 1.4 },
    { word: "preorder", start: 1.42, end: 1.68 },
    { word: "catch.", start: 1.7, end: 1.9 },
    { word: "Follow", start: 1.92, end: 2.1 },
    { word: "Pulse", start: 2.12, end: 2.28 },
    { word: "Gaming", start: 2.3, end: 2.48 },
    { word: "so", start: 2.5, end: 2.58 },
    { word: "you", start: 2.6, end: 2.7 },
    { word: "never", start: 2.72, end: 2.88 },
    { word: "miss", start: 2.9, end: 3.04 },
    { word: "a", start: 3.06, end: 3.1 },
    { word: "beat.", start: 3.12, end: 3.3 },
  ];

  const coverage = _testables.analyseWhisperScriptCoverage({ words, scriptText });
  const reconciled = _testables.reconcileWhisperWordsToScript({ words, scriptText });

  assert.equal(coverage.ok, true);
  assert.equal(coverage.inserted_actual_word_count, 0);
  assert.equal(coverage.unmatched_expected_word_count, 0);
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.words[0].word, "Grand");
  assert.equal(reconciled.words[3].word, "VI");

  const c6Coverage = _testables.analyseWhisperScriptCoverage({
    words: [
      { word: "Grand", start: 0, end: 0.18 },
      { word: "Theft", start: 0.2, end: 0.38 },
      { word: "Auto", start: 0.4, end: 0.58 },
      { word: "C6", start: 0.6, end: 0.78 },
      { word: "now", start: 0.8, end: 0.94 },
      { word: "has", start: 0.96, end: 1.08 },
      { word: "one", start: 1.1, end: 1.22 },
      { word: "real", start: 1.24, end: 1.38 },
      { word: "preorder", start: 1.4, end: 1.66 },
      { word: "catch.", start: 1.68, end: 1.88 },
      { word: "Follow", start: 1.9, end: 2.08 },
      { word: "Pulse", start: 2.1, end: 2.26 },
      { word: "Gaming", start: 2.28, end: 2.46 },
      { word: "so", start: 2.48, end: 2.56 },
      { word: "you", start: 2.58, end: 2.68 },
      { word: "never", start: 2.7, end: 2.86 },
      { word: "miss", start: 2.88, end: 3.02 },
      { word: "a", start: 3.04, end: 3.08 },
      { word: "beat.", start: 3.1, end: 3.28 },
    ],
    scriptText,
  });

  assert.equal(c6Coverage.ok, true);
  assert.equal(c6Coverage.opening_covered, true);
  assert.equal(c6Coverage.inserted_actual_word_count, 0);
});

test("goal audio materializer aligns hyphenated script words when Whisper splits them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-hyphen-split-"));
  const script = "Every big first-party announcement carries the same platform question.";
  const artifactDir = await makePackage(root, "story-hyphen-split", {
    selected_title: "Xbox Exclusives Are Back Under Review",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-hyphen-split", artifactDir)],
    },
    generatedAt: "2026-05-27T08:15:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "Every big first party announcement carries the same platform question.",
      words: [
        { word: "Every", start: 0.1, end: 0.28 },
        { word: "big", start: 0.3, end: 0.42 },
        { word: "first", start: 0.44, end: 0.62 },
        { word: "party", start: 0.64, end: 0.84 },
        { word: "announcement", start: 0.86, end: 1.24 },
        { word: "carries", start: 1.26, end: 1.48 },
        { word: "the", start: 1.5, end: 1.58 },
        { word: "same", start: 1.6, end: 1.76 },
        { word: "platform", start: 1.78, end: 2.06 },
        { word: "question.", start: 2.08, end: 2.36 },
      ],
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-hyphen-split_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 0);
  assert.deepEqual(timestamps.words.slice(2, 4).map((word) => word.word), ["first", "party"]);
});

test("goal audio materializer accepts hyphenated title words split in the opening", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-opening-hyphen-"));
  const script = "Gears of War E-Day just turned PC specs into the story.";
  const artifactDir = await makePackage(root, "story-opening-hyphen", {
    selected_title: "Gears E-Day Has A 130GB Problem",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-opening-hyphen", artifactDir)],
    },
    generatedAt: "2026-06-19T09:20:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "Gears of War E Day just turned PC specs into the story.",
      words: [
        { word: "Gears", start: 0.06, end: 0.282 },
        { word: "of", start: 0.322, end: 0.362 },
        { word: "War", start: 0.403, end: 0.564 },
        { word: "E", start: 0.664, end: 0.745 },
        { word: "Day", start: 0.765, end: 0.946 },
        { word: "just", start: 1.006, end: 1.187 },
        { word: "turned", start: 1.208, end: 1.429 },
        { word: "PC", start: 1.489, end: 1.831 },
        { word: "specs", start: 1.872, end: 2.194 },
        { word: "into", start: 2.234, end: 2.395 },
        { word: "the", start: 2.435, end: 2.516 },
        { word: "story.", start: 2.536, end: 2.878 },
      ],
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-opening-hyphen_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_opening_covered, true);
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 0);
  assert.deepEqual(timestamps.words.slice(3, 5).map((word) => word.word), ["E", "Day"]);
});

test("goal audio materializer keeps the real opening match on long repeated title scripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-long-opening-"));
  const script = "Gears of War E-Day just turned PC specs into the story. PC Gamer says the requirements list a 130 GB SSD install, with RTX 2060-era hardware as the minimum floor. That is normal for a 2026 blockbuster. The catch is not the number. It is what players have to delete before launch night. A 130 GB install means clearing space, waiting through the preload and hoping the campaign earns that footprint. That is the trade-off for Xbox: if E-Day looks expensive because the levels are dense, cinematic and brutal, the size becomes part of the promise. If the opening hours feel padded, storage becomes the first complaint. E-Day has to make 130 GB feel like weight, not bloat. Follow Pulse Gaming so you never miss a beat.";
  const transcript = "Gears of War E Day just turned PC specs into the story. PC Gamer says the requirements list a 130 GB SSD install, with RTX twenty sixty era hardware as the minimum floor. That is normal for a twenty twenty six blockbuster. The catch is not the number. It is what players have to delete before launch night. A 130 GB install means clearing space, waiting through the preload and hoping the campaign earns that footprint. That is the trade off for Xbox. If E Day looks expensive because the levels are dense, cinematic and brutal, the size becomes part of the promise. If the opening hours feel padded, storage becomes the first complaint. E Day has to make 130 gigabytes feel like weight, not bloat. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-long-opening-hyphen", {
    selected_title: "Gears E-Day Has A 130GB Problem",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-long-opening-hyphen", artifactDir)],
    },
    generatedAt: "2026-06-19T09:32:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "small.en",
      transcript,
      words: whisperWordsFromScript(transcript),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-long-opening-hyphen_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_opening_covered, true);
  assert.equal(timestamps.words.slice(0, 6).map((word) => word.word).join(" "), "Gears of War E Day just");
});

test("goal audio materializer prefers local Whisper word alignment when configured", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-"));
  const script = "Hades II lands on console.";
  const artifactDir = await makePackage(root, "story-whisper", {
    selected_title: "Hades II Lands On Console",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper", artifactDir)],
    },
    generatedAt: "2026-05-22T06:00:50.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      words: [
        { word: "Hades,", start: 0.18, end: 0.42 },
        { word: "two", start: 0.44, end: 0.66 },
        { word: "lands", start: 0.86, end: 1.1 },
        { word: "on", start: 1.14, end: 1.25 },
        { word: "console.", start: 1.28, end: 1.6 },
      ],
      transcript: "Hades two lands on console.",
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-whisper_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.model, "tiny.en");
  assert.equal(timestamps.words[1].word, "two");
  assert.equal(timestamps.words[1].start, 0.44);
  assert.equal(timestamps.words[1].end, 0.66);
});

test("goal audio materializer blocks generated local audio when requested Whisper alignment fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-required-"));
  const script =
    "Subnautica 2 reportedly leaked before launch. Respawnfirst reports Subnautica 2 appeared online before launch. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-required", {
    selected_title: "Subnautica 2 Reportedly Leaked Early",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper-required", artifactDir)],
    },
    generatedAt: "2026-05-26T18:20:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "Subnautica 2 reportedly leaked before launch. Respawn",
      words: [
        { word: "Subnautica", start: 0.12, end: 0.38 },
        { word: "2", start: 0.4, end: 0.52 },
        { word: "reportedly", start: 0.54, end: 0.86 },
        { word: "leaked", start: 0.88, end: 1.08 },
        { word: "before", start: 1.1, end: 1.3 },
        { word: "launch.", start: 1.32, end: 1.58 },
        { word: "Respawn", start: 1.6, end: 1.94 },
      ],
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.jobs[0].status, "failed");
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
  assert.equal(report.jobs[0].timestamp_whisper_alignment.error, "script_coverage_below_threshold");
  assert.equal(report.jobs[0].timestamp_whisper_alignment.model, "tiny.en");
  assert.equal(report.jobs[0].timestamp_whisper_alignment.script_opening_covered, true);
});

test("goal audio materializer rolls back generated local audio when strict Whisper alignment fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-rollback-"));
  const script =
    "Mega Mewtwo finally has a Pokémon Go path instead of another tease. That matters because Go Fest Global is free this time. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-rollback", {
    selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper-rollback", artifactDir)],
    },
    generatedAt: "2026-05-27T14:50:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "Mega Mewtwo finally has a Pokémon Go path instead of another tease.",
      words: [
        { word: "Mega", start: 0, end: 0.2 },
        { word: "Mewtwo", start: 0.22, end: 0.52 },
        { word: "finally", start: 0.54, end: 0.78 },
        { word: "has", start: 0.8, end: 0.9 },
        { word: "a", start: 0.92, end: 0.98 },
        { word: "Pokémon", start: 1, end: 1.3 },
        { word: "Go", start: 1.32, end: 1.48 },
        { word: "path", start: 1.5, end: 1.74 },
        { word: "instead", start: 1.76, end: 2.02 },
        { word: "of", start: 2.04, end: 2.14 },
        { word: "another", start: 2.16, end: 2.42 },
        { word: "tease.", start: 2.44, end: 2.74 },
      ],
    }),
    generateTtsForStory: async ({ outputPath }) => {
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        words: [
          { word: "Mega", start: 0, end: 0.2 },
          { word: "Mewtwo", start: 0.22, end: 0.52 },
          { word: "finally", start: 0.54, end: 0.78 },
        ],
        meta: { transcript: "Mega Mewtwo finally." },
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
  assert.equal(await fs.pathExists(path.join(root, "output", "audio", "story-whisper-rollback.mp3")), false);
  assert.equal(
    await fs.pathExists(path.join(root, "output", "audio", "story-whisper-rollback_timestamps.json")),
    false,
  );
});

test("goal audio materializer stages strict Whisper regeneration before replacing canonical audio", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-staging-"));
  const storyId = "story-whisper-staged";
  const script =
    "Sea of Thieves just made its biggest social gamble in years. That risk could split the player base. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, storyId, {
    selected_title: "Sea Of Thieves Custom Seas Could Split Crews",
    narration_script: script,
    duration_variant_repaired_at: "2026-06-21T18:30:00.000Z",
  });
  const canonicalAudioPath = path.join(root, "output", "audio", `${storyId}.mp3`);
  const canonicalTimestampPath = path.join(root, "output", "audio", `${storyId}_timestamps.json`);
  await fs.outputFile(canonicalAudioPath, Buffer.alloc(2048, 1));
  await fs.outputJson(canonicalTimestampPath, {
    words: [{ word: "Old", start: 0, end: 0.2 }],
    meta: { transcript: "Old accepted narration." },
  });
  const oldAudio = await fs.readFile(canonicalAudioPath);
  const calls = [];
  const alignmentAudioPaths = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      elevenlabs_tts: { verdict: "green", ready: true },
      jobs: [
        {
          ...workbenchJob(storyId, artifactDir),
          tts_provider: "elevenlabs",
          status: "requires_audio_timestamp_generation",
          audio: { usable: false, reason: "voice_cadence_repaired" },
          timestamps: {
            usable: false,
            reason: "voice_cadence_repaired",
            requires_audio_regeneration: true,
          },
        },
      ],
    },
    generatedAt: "2026-06-21T18:35:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async ({ audioPath }) => {
      alignmentAudioPaths.push(audioPath);
      return {
        ok: false,
        source: "local_whisper_word_alignment",
        model: "tiny.en",
        error: "script_coverage_below_threshold",
      };
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      assert.match(outputPath, /output[\\/]audio[\\/]\.staging[\\/]/);
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 2));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
  assert.equal(calls.length, 1);
  assert.equal(alignmentAudioPaths.length, 1);
  assert.match(alignmentAudioPaths[0], /[\\/]output[\\/]audio[\\/]\.staging[\\/]/);
  assert.deepEqual(await fs.readFile(canonicalAudioPath), oldAudio);
  const canonicalTimestamps = await fs.readJson(canonicalTimestampPath);
  assert.equal(canonicalTimestamps.meta.transcript, "Old accepted narration.");
  assert.equal(await fs.pathExists(path.join(root, "output", "audio", ".staging")), false);
});

test("goal audio materializer blocks inserted Whisper words instead of hiding them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-reconcile-"));
  const script =
    "The Expanse: Osiris Reborn finally showed real gameplay. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-reconcile", {
    selected_title: "The Expanse Shows Real Gameplay",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper-reconcile", artifactDir)],
    },
    generatedAt: "2026-05-26T10:05:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      words: [
        { word: "The", start: 0.1, end: 0.18 },
        { word: "Expanse", start: 0.2, end: 0.48 },
        { word: "of", start: 0.5, end: 0.58 },
        { word: "Osiris", start: 0.6, end: 0.86 },
        { word: "Reborn", start: 0.88, end: 1.18 },
        { word: "finally", start: 1.22, end: 1.52 },
        { word: "showed", start: 1.56, end: 1.8 },
        { word: "real", start: 1.84, end: 2.02 },
        { word: "gameplay.", start: 2.06, end: 2.42 },
        { word: "Follow", start: 2.8, end: 3.02 },
        { word: "Pulse", start: 3.04, end: 3.22 },
        { word: "Gaming", start: 3.24, end: 3.52 },
        { word: "so", start: 3.56, end: 3.68 },
        { word: "you", start: 3.7, end: 3.82 },
        { word: "never", start: 3.84, end: 4.02 },
        { word: "miss", start: 4.04, end: 4.2 },
        { word: "a", start: 4.22, end: 4.28 },
        { word: "beat.", start: 4.3, end: 4.52 },
      ],
      transcript:
        "The Expanse of Osiris Reborn finally showed real gameplay. Follow Pulse Gaming so you never miss a beat.",
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.jobs[0].status, "failed");
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
});

test("goal audio materializer retries local narration when generated speech stutters under ASR", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-tts-stutter-retry-"));
  const script = "V Rising's next move is not another content drop. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-tts-stutter-retry", {
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    narration_script: script,
  });
  const calls = [];
  let alignmentCall = 0;

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-tts-stutter-retry", artifactDir)],
    },
    generatedAt: "2026-05-27T09:35:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => {
      alignmentCall += 1;
      if (alignmentCall === 1) {
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model: "tiny.en",
          transcript:
            "V Rising's next move is not another content drop drop. Follow Pulse Gaming so you never miss a beat.",
          words: [
            "V", "Rising's", "next", "move", "is", "not", "another", "content", "drop", "drop.",
            "Follow", "Pulse", "Gaming", "so", "you", "never", "miss", "a", "beat.",
          ].map((word, index) => ({
            word,
            start: Number((index * 0.2).toFixed(2)),
            end: Number((index * 0.2 + 0.16).toFixed(2)),
          })),
        };
      }
      return {
        ok: true,
        source: "local_whisper_word_alignment",
        model: "tiny.en",
        transcript: script,
        words: script.split(/\s+/).map((word, index) => ({
          word,
          start: Number((index * 0.2).toFixed(2)),
          end: Number((index * 0.2 + 0.16).toFixed(2)),
        })),
      };
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, calls.length));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].generation_attempts, 2);
  assert.equal(report.jobs[0].reason, "local_tts_retry_after_strict_alignment_failure");
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-tts-stutter-retry_timestamps.json"));
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 0);
});

test("goal audio materializer trims trailing ASR tail words before accepting word timestamps", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-tail-"));
  const script = "Super Mario RPG just dropped to 15 dollars. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-tail", {
    selected_title: "Super Mario RPG Drops To $15",
    narration_script: script,
  });
  const alignCalls = [];
  const trims = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper-tail", artifactDir)],
    },
    generatedAt: "2026-05-26T10:05:15.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => {
      alignCalls.push(true);
      const words = [
        "Super", "Mario", "RPG", "just", "dropped", "to", "15", "dollars.", "Follow", "Pulse",
        "Gaming", "so", "you", "never", "miss", "a", "beat.",
      ].map((word, index) => ({
        word,
        start: Number((index * 0.2).toFixed(2)),
        end: Number((index * 0.2 + 0.12).toFixed(2)),
      }));
      if (alignCalls.length === 1) {
        words.push({ word: "nonsense", start: 3.5, end: 3.72 });
      } else {
        words[words.length - 1] = { ...words[words.length - 1], end: 3.38 };
      }
      return {
        ok: true,
        source: "local_whisper_word_alignment",
        model: "tiny.en",
        words,
        transcript: alignCalls.length === 1
          ? `${script} nonsense`
          : script,
      };
    },
    trimAudioToDuration: async (audioPath, durationS) => {
      trims.push({ audioPath, durationS });
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(alignCalls.length, 2);
  assert.equal(trims.length, 1);
  assert.equal(Number(trims[0].durationS.toFixed(2)), 3.32);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-whisper-tail_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperTailRepair.repaired, true);
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_trailing_actual_word_count, 0);
  assert.equal(timestamps.words.at(-1).end <= trims[0].durationS, true);
  assert.deepEqual(
    timestamps.words.slice(-3).map((word) => word.word),
    ["miss", "a", "beat."],
  );
});

test("goal audio materializer rejects strict Whisper timestamps with an unsafe trailing audio tail", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-audio-tail-"));
  const script = "Mega Mewtwo is finally coming to Pokemon Go. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-audio-tail", {
    selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-audio-tail", artifactDir)],
    },
    generatedAt: "2026-05-27T15:30:00.000Z",
    alignmentMode: "whisper",
    measureWhisperAudioTail: true,
    getAudioDuration: async () => 10.5,
    trimAudioToDuration: null,
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      words: whisperWordsFromScript(scriptText),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
  assert.equal(await fs.pathExists(path.join(root, "output", "audio", "story-audio-tail.mp3")), false);
  assert.equal(await fs.pathExists(path.join(root, "output", "audio", "story-audio-tail_timestamps.json")), false);
});

test("goal audio materializer retries Whisper when mid-script ASR insertions exceed the safe threshold", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-insertions-"));
  const script = "PlayStation five just became harder to buy for new players. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-insertions", {
    selected_title: "PS5 Prices Went Up In Europe",
    narration_script: script,
  });
  const originalModels = process.env.LOCAL_WHISPER_MODELS;
  process.env.LOCAL_WHISPER_MODELS = "base.en,tiny.en";
  const alignCalls = [];
  try {
    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "green", ready: true },
        jobs: [workbenchJob("story-whisper-insertions", artifactDir)],
      },
      generatedAt: "2026-05-26T10:05:20.000Z",
      alignmentMode: "whisper",
      alignWordsWithAudio: async ({ model }) => {
        alignCalls.push(model);
        const text = model === "base.en"
          ? "PlayStation five just became harder to buy for the company to buy for new players. Follow Pulse Gaming so you never miss a beat."
          : script;
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model,
          transcript: text,
          words: text.split(/\s+/).map((word, index) => ({
            word,
            start: Number((index * 0.18).toFixed(2)),
            end: Number((index * 0.18 + 0.12).toFixed(2)),
          })),
        };
      },
      generateTtsForStory: async ({ text, outputPath }) => {
        const audioPath = path.join(root, outputPath);
        await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
        await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
          alignment: charAlignment(text),
        });
        return { ok: true };
      },
    });

    assert.equal(report.summary.materialized_count, 1);
    assert.deepEqual(alignCalls, ["base.en", "tiny.en"]);
    const timestamps = await fs.readJson(
      path.join(root, "output", "audio", "story-whisper-insertions_timestamps.json"),
    );
    assert.equal(timestamps.meta.timestampWhisperAlignment.model, "tiny.en");
    assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 0);
  } finally {
    if (originalModels === undefined) delete process.env.LOCAL_WHISPER_MODELS;
    else process.env.LOCAL_WHISPER_MODELS = originalModels;
  }
});

test("goal audio materializer blocks tiny ASR insertions even on long high-coverage Whisper alignment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-long-insertions-"));
  const script = [
    "Nintendo Professor Lawsuit Just Got Weird.",
    "Dexerto reports an Iowa man filed a lawsuit against Nintendo of America and The Pokemon Company International after being denied Pokemon Professor status.",
    "The odd part is the target: a fan programme rejection, not Nintendo's usual fight over ROMs or clone games.",
    "Nintendo is a strange legal fight, not another normal Nintendo takedown story.",
    "The unusual part is the target: a fan programme rejection, not a ROM site or a clone game.",
    "That makes it a community access dispute around one of Pokemon's official programmes.",
    "It is small compared with Nintendo's biggest legal fights, but weird enough to watch.",
    "If either side answers, the story changes from odd filing to clearer dispute.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");
  const artifactDir = await makePackage(root, "story-whisper-long-insertions", {
    selected_title: "Nintendo Professor Lawsuit Just Got Weird",
    narration_script: script,
  });
  const expectedWords = script.split(/\s+/);
  const actualWords = [
    ...expectedWords.slice(0, 28),
    "now",
    ...expectedWords.slice(28, 71),
    "still",
    ...expectedWords.slice(71, 102),
    "briefly",
    ...expectedWords.slice(102),
  ];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper-long-insertions", artifactDir)],
    },
    generatedAt: "2026-05-28T06:20:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "small.en",
      transcript: actualWords.join(" "),
      words: actualWords.map((word, index) => ({
        word,
        start: Number((index * 0.25).toFixed(3)),
        end: Number((index * 0.25 + 0.17).toFixed(3)),
      })),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
  assert.equal(await fs.pathExists(path.join(root, "output", "audio", "story-whisper-long-insertions.mp3")), false);
  assert.equal(await fs.pathExists(path.join(root, "output", "audio", "story-whisper-long-insertions_timestamps.json")), false);
});

test("goal audio materializer covers title openings when ASR spells GTA 6 possessives", async () => {
  const script = "GTA 6's release date just became a trust check, not a new reveal.";
  const words = "G T A six's release date just became a trust check not a new reveal"
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.2).toFixed(3)),
      end: Number((index * 0.2 + 0.12).toFixed(3)),
    }));

  const coverage = _testables.analyseWhisperScriptCoverage({
    words,
    scriptText: script,
  });

  assert.equal(coverage.ok, true);
  assert.equal(coverage.reason, "coverage_ok");
  assert.equal(coverage.opening_covered, true);
  assert.equal(coverage.inserted_actual_word_count, 0);
});

test("goal audio materializer uses configured stronger Whisper fallbacks before rejecting clean speech", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-default-whisper-fallback-"));
  const script =
    "Mega Mewtwo is finally coming to Pokemon Go. Fair access, clear timing and no paywall confusion decide whether this lands. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-default-whisper-fallback", {
    selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
    narration_script: script,
  });
  const previousModels = process.env.LOCAL_WHISPER_MODELS;
  const previousModel = process.env.LOCAL_WHISPER_MODEL;
  process.env.LOCAL_WHISPER_MODELS = "tiny.en,base.en,small.en";
  delete process.env.LOCAL_WHISPER_MODEL;
  const calls = [];
  try {
    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "green", ready: true },
        jobs: [workbenchJob("story-default-whisper-fallback", artifactDir)],
      },
      generatedAt: "2026-05-27T16:05:00.000Z",
      alignmentMode: "whisper",
      alignWordsWithAudio: async ({ model }) => {
        calls.push(model);
        if (model !== "small.en") {
          const drifted = script.split(/\s+/);
          drifted.splice(5, 0, "extra");
          const driftedText = drifted.join(" ");
          return {
            ok: true,
            source: "local_whisper_word_alignment",
            model,
            transcript: driftedText,
            words: whisperWordsFromScript(driftedText),
          };
        }
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model,
          transcript: script,
          words: whisperWordsFromScript(script),
        };
      },
      generateTtsForStory: async ({ text, outputPath }) => {
        const audioPath = path.join(root, outputPath);
        await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
        await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
          alignment: charAlignment(text),
        });
        return { ok: true };
      },
    });

    assert.equal(report.summary.materialized_count, 1);
    assert.deepEqual(calls, ["tiny.en", "base.en", "small.en"]);
    const timestamps = await fs.readJson(
      path.join(root, "output", "audio", "story-default-whisper-fallback_timestamps.json"),
    );
    assert.equal(timestamps.meta.timestampWhisperAlignment.model, "small.en");
    assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 0);
  } finally {
    if (previousModels === undefined) delete process.env.LOCAL_WHISPER_MODELS;
    else process.env.LOCAL_WHISPER_MODELS = previousModels;
    if (previousModel === undefined) delete process.env.LOCAL_WHISPER_MODEL;
    else process.env.LOCAL_WHISPER_MODEL = previousModel;
  }
});

test("goal audio materializer blocks high-coverage ASR drift when it inserts words", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-drift-"));
  const script =
    "Kadokawa's activist investor now has a bigger stake than Sony. Kadokawa works best as a tight news hit with the source visible. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-drift", {
    selected_title: "Kadokawa Stake Just Passed Sony",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper-drift", artifactDir)],
    },
    generatedAt: "2026-05-26T10:05:30.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      words: [
        { word: "Kadokawa's", start: 0.1, end: 0.42 },
        { word: "activist", start: 0.44, end: 0.72 },
        { word: "investor", start: 0.74, end: 1.08 },
        { word: "now", start: 1.1, end: 1.24 },
        { word: "has", start: 1.26, end: 1.38 },
        { word: "a", start: 1.4, end: 1.48 },
        { word: "bigger", start: 1.5, end: 1.74 },
        { word: "stake", start: 1.76, end: 1.98 },
        { word: "than", start: 2, end: 2.14 },
        { word: "Sony.", start: 2.16, end: 2.48 },
        { word: "Katokawa", start: 2.7, end: 3.08 },
        { word: "works", start: 3.1, end: 3.28 },
        { word: "best", start: 3.3, end: 3.48 },
        { word: "as", start: 3.5, end: 3.6 },
        { word: "a", start: 3.62, end: 3.7 },
        { word: "tight", start: 3.72, end: 3.94 },
        { word: "news", start: 3.96, end: 4.14 },
        { word: "hit", start: 4.16, end: 4.32 },
        { word: "with", start: 4.34, end: 4.48 },
        { word: "a", start: 4.5, end: 4.58 },
        { word: "source", start: 4.6, end: 4.86 },
        { word: "visible.", start: 4.88, end: 5.22 },
        { word: "Follow", start: 5.5, end: 5.72 },
        { word: "Paul's", start: 5.74, end: 5.96 },
        { word: "Gaming", start: 5.98, end: 6.24 },
        { word: "so", start: 6.26, end: 6.38 },
        { word: "you", start: 6.4, end: 6.52 },
        { word: "never", start: 6.54, end: 6.74 },
        { word: "miss", start: 6.76, end: 6.92 },
        { word: "a", start: 6.94, end: 7.02 },
        { word: "beat.", start: 7.04, end: 7.28 },
      ],
      transcript:
        "Kadokawa's activist investor now has a bigger stake than Sony. Katokawa works best as a tight news hit with a source visible. Follow Paul's Gaming so you never miss a beat.",
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.jobs[0].status, "failed");
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
});

test("goal audio materializer accepts high-confidence opening tense drift without falling back to loose timing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-opening-drift-"));
  const script =
    "Xbox asked for feedback and immediately got the exclusives argument. IGN reports Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives. Xbox now has one concrete change worth remembering after the scroll moves on. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-opening-drift", {
    selected_title: "Xbox Feedback Backfired Fast",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper-opening-drift", artifactDir)],
    },
    generatedAt: "2026-05-26T19:10:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript:
        "Xbox asks for feedback and immediately got the exclusives argument. IGN reports Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives. Xbox now has one concrete change worth remembering after the scroll moves on. Follow Pulse Gaming so you never miss a beat.",
      words: [
        "Xbox", "asks", "for", "feedback", "and", "immediately", "got", "the", "exclusives", "argument.",
        "IGN", "reports", "Microsoft", "Launches", "Xbox", "Player", "Voice", "to", "Gather", "Feedback,",
        "Fans", "Immediately", "Demand", "Exclusives.", "Xbox", "now", "has", "one", "concrete", "change",
        "worth", "remembering", "after", "the", "scroll", "moves", "on.", "Follow", "Pulse", "Gaming",
        "so", "you", "never", "miss", "a", "beat.",
      ].map((word, index) => ({
        word,
        start: Number((index * 0.18).toFixed(2)),
        end: Number((index * 0.18 + 0.12).toFixed(2)),
      })),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.failed_count, 0);
  const timestamps = await fs.readJson(
    path.join(root, "output", "audio", "story-whisper-opening-drift_timestamps.json"),
  );
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_reconciled, true);
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_opening_covered, true);
  assert.deepEqual(
    timestamps.words.slice(0, 6).map((word) => word.word),
    ["Xbox", "asked", "for", "feedback", "and", "immediately"],
  );
});

test("goal audio materializer reconciles gaming ASR alias rate back to raid for captions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-raid-alias-"));
  const script =
    "Mega Mewtwo finally has a Pokémon Go path. The player detail is timing, raid access and whether free players actually get a fair shot. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-raid-alias", {
    selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
    narration_script: script,
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-whisper-raid-alias", artifactDir)],
    },
    generatedAt: "2026-05-27T15:10:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript:
        "Mega Mewtwo finally has a Pokémon Go path. The player detail is timing, rate access and whether free players actually get a fair shot. Follow Pulse Gaming so you never miss a beat.",
      words: script.replace("raid", "rate").split(/\s+/).map((word, index) => ({
        word,
        start: Number((index * 0.18).toFixed(2)),
        end: Number((index * 0.18 + 0.12).toFixed(2)),
      })),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.failed_count, 0);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-whisper-raid-alias_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.ok(timestamps.words.some((word) => word.word === "raid"));
  assert.equal(timestamps.words.some((word) => word.word === "rate"), false);
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_reconciled, true);
});

test("goal audio materializer rejects truncated Whisper tracks instead of counting them materialized", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-truncated-"));
  const script =
    "Subnautica 2 reportedly leaked before launch. Respawnfirst reports Subnautica 2 appeared online before launch. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-whisper-truncated", {
    selected_title: "Subnautica 2 Reportedly Leaked Early",
    narration_script: script,
  });
  await fs.outputFile(
    path.join(root, "output", "audio", "story-whisper-truncated.mp3"),
    Buffer.alloc(4096, 1),
  );
  await fs.outputJson(path.join(root, "output", "audio", "story-whisper-truncated_timestamps.json"), {
    words: [
      { word: "Subnautica", start: 0.12, end: 0.38 },
      { word: "2", start: 0.4, end: 0.52 },
    ],
    meta: { wordTimestampSource: "local_audio_silence_anchored" },
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "red", ready: false, failure_code: "server_down" },
      jobs: [
        {
          ...workbenchJob("story-whisper-truncated", artifactDir),
          status: "requires_word_timestamp_asr_alignment",
          missing: ["word_timestamps_asr_alignment"],
          tts_provider: null,
        },
      ],
    },
    generatedAt: "2026-05-26T10:10:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "Subnautica 2 reportedly leaked before launch. Respawn",
      words: [
        { word: "Subnautica", start: 0.12, end: 0.38 },
        { word: "2", start: 0.4, end: 0.52 },
        { word: "reportedly", start: 0.54, end: 0.86 },
        { word: "leaked", start: 0.88, end: 1.08 },
        { word: "before", start: 1.1, end: 1.3 },
        { word: "launch.", start: 1.32, end: 1.58 },
        { word: "Respawn", start: 1.6, end: 1.94 },
      ],
    }),
    generateTtsForStory: async () => {
      throw new Error("should not regenerate narration for ASR-only alignment");
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
});

test("goal audio materializer retries local Whisper models before blocking ASR alignment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-whisper-model-retry-"));
  const previousModels = process.env.LOCAL_WHISPER_MODELS;
  process.env.LOCAL_WHISPER_MODELS = "tiny.en,base.en";
  try {
    const script =
      "Crimson Desert is already live in one region. The studio opened the test build before the wider rollout. Follow Pulse Gaming so you never miss a beat.";
    const artifactDir = await makePackage(root, "story-whisper-model-retry", {
      selected_title: "Crimson Desert Is Already Live",
      narration_script: script,
    });
    await fs.outputFile(
      path.join(root, "output", "audio", "story-whisper-model-retry.mp3"),
      Buffer.alloc(4096, 1),
    );
    await fs.outputJson(path.join(root, "output", "audio", "story-whisper-model-retry_timestamps.json"), {
      words: [{ word: "Crimson", start: 0.1, end: 0.4 }],
      meta: { wordTimestampSource: "local_audio_silence_anchored" },
    });
    const calls = [];

    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "red", ready: false, failure_code: "server_down" },
        jobs: [
          {
            ...workbenchJob("story-whisper-model-retry", artifactDir),
            status: "requires_word_timestamp_asr_alignment",
            missing: ["word_timestamps_asr_alignment"],
            tts_provider: null,
          },
        ],
      },
      generatedAt: "2026-05-26T17:20:00.000Z",
      alignmentMode: "whisper",
      alignWordsWithAudio: async ({ model }) => {
        calls.push(model);
        if (model === "tiny.en") {
          return {
            ok: true,
            source: "local_whisper_word_alignment",
            model,
            transcript: "Crimson Desert is already live",
            words: [
              { word: "Crimson", start: 0.1, end: 0.34 },
              { word: "Desert", start: 0.36, end: 0.58 },
              { word: "is", start: 0.6, end: 0.72 },
              { word: "already", start: 0.74, end: 0.98 },
              { word: "live", start: 1, end: 1.18 },
            ],
          };
        }
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model,
          transcript: script,
          words: script.split(/\s+/).map((word, index) => ({
            word,
            start: Number((index * 0.18).toFixed(2)),
            end: Number((index * 0.18 + 0.12).toFixed(2)),
          })),
        };
      },
      generateTtsForStory: async () => {
        throw new Error("should not regenerate narration for ASR-only alignment");
      },
    });

    assert.equal(report.summary.materialized_count, 1);
    assert.deepEqual(calls, ["tiny.en", "base.en"]);
    const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-whisper-model-retry_timestamps.json"));
    assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
    assert.equal(timestamps.meta.timestampWhisperAlignment.model, "base.en");
    assert.equal(timestamps.meta.timestampWhisperAlignment.model_attempts, 2);
  } finally {
    if (previousModels == null) delete process.env.LOCAL_WHISPER_MODELS;
    else process.env.LOCAL_WHISPER_MODELS = previousModels;
  }
});

test("goal audio materializer treats null Whisper timing anchors as unusable", () => {
  assert.equal(_testables.timingFromToken(null), null);
  assert.equal(_testables.timingFromToken({ timing: null }), null);
});

test("goal audio materializer reconciles split GameStop TTS text with merged Whisper ASR", () => {
  const script = "Game Stop lists Super Mario RPG at 15 dollars. Game Stop updates the listing.";
  const words = "GameStop lists Super Mario RPG at 15 dollars GameStop updates the listing"
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: index * 0.25,
      end: index * 0.25 + 0.16,
    }));

  const reconciled = _testables.reconcileWhisperWordsToScript({ words, scriptText: script });

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.coverage.inserted_actual_word_count, 0);
  assert.equal(reconciled.words.length, words.length);
  assert.equal(reconciled.words[0].word, "GameStop");
  assert.equal(reconciled.words[8].word, "GameStop");
});

test("goal audio materializer uses ElevenLabs fallback selected by the workbench", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-elevenlabs-"));
  const artifactDir = await makePackage(root, "story-elevenlabs");
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "red", ready: false, failure_code: "server_down" },
      elevenlabs_tts: { provider: "elevenlabs", ready: true, configured: true },
      provider_preference: "auto",
      jobs: [
        {
          ...workbenchJob("story-elevenlabs", artifactDir),
          tts_provider: "elevenlabs",
        },
      ],
    },
    generatedAt: "2026-05-22T06:01:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      words: whisperWordsFromScript(scriptText),
    }),
    generateTtsForStory: async ({ text, outputPath, provider }) => {
      calls.push({ text, outputPath, provider });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "elevenlabs");
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].provider, "elevenlabs");
  assert.equal(report.safety.local_tts_only, false);
  assert.equal(report.safety.external_tts_provider_used, "elevenlabs");
  const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
  assert.equal(manifest.voice_provider, "elevenlabs");
  assert.equal(manifest.safety.local_only, false);
  assert.equal(manifest.safety.external_tts_provider_used, "elevenlabs");
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-elevenlabs_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 0);
});

test("goal audio materializer rejects ElevenLabs output when strict Whisper verification fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-elevenlabs-strict-fail-"));
  const artifactDir = await makePackage(root, "story-elevenlabs-strict-fail");

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    provider: "elevenlabs",
    workbenchReport: {
      elevenlabs_tts: { provider: "elevenlabs", ready: true, configured: true },
      jobs: [
        {
          ...workbenchJob("story-elevenlabs-strict-fail", artifactDir),
          tts_provider: "elevenlabs",
        },
      ],
    },
    generatedAt: "2026-06-19T06:30:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: false,
      error: "whisper_alignment_failed",
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.jobs[0].status, "failed");
  assert.equal(report.jobs[0].provider, "elevenlabs");
  assert.match(report.jobs[0].error, /local_whisper_word_alignment_failed/);
  assert.equal(report.safety.local_tts_only, false);
  assert.equal(report.safety.external_tts_provider_used, "elevenlabs");
  assert.equal(await fs.pathExists(path.join(root, "output", "audio", "story-elevenlabs-strict-fail.mp3")), false);
  assert.equal(
    await fs.pathExists(path.join(root, "output", "audio", "story-elevenlabs-strict-fail_timestamps.json")),
    false,
  );
});

test("goal audio materializer adds ElevenLabs narration to the rights ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-elevenlabs-rights-"));
  const artifactDir = await makePackage(root, "story-elevenlabs-rights");
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), {
    schema_version: 1,
    story_id: "story-elevenlabs-rights",
    verdict: "pass",
    records: [],
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "red", ready: false },
      elevenlabs_tts: { provider: "elevenlabs", ready: true, configured: true },
      provider_preference: "elevenlabs",
      jobs: [
        {
          ...workbenchJob("story-elevenlabs-rights", artifactDir),
          tts_provider: "elevenlabs",
        },
      ],
    },
    generatedAt: "2026-05-22T06:02:00.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  const rights = await fs.readJson(path.join(artifactDir, "rights_ledger.json"));
  const audioRecord = rights.records.find((record) => record.asset_id === "story-elevenlabs-rights_audio_path");
  assert.equal(audioRecord.source_type, "elevenlabs_tts_voice");
  assert.equal(audioRecord.licence_basis, "elevenlabs_commercial_tts_generation");
  assert.equal(audioRecord.path, "audio/narration.mp3");
  assert.equal(audioRecord.commercial_use_allowed, true);
});

test("goal audio materializer can use ElevenLabs readiness from environment when legacy workbench lacks it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-env-elevenlabs-"));
  const artifactDir = await makePackage(root, "story-env-elevenlabs");
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "red", ready: false, failure_code: "server_down" },
      provider_preference: "local",
      jobs: [workbenchJob("story-env-elevenlabs", artifactDir)],
    },
    provider: "elevenlabs",
    ttsEnv: {
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_VOICE_ID: "test-voice",
    },
    generatedAt: "2026-05-22T06:02:30.000Z",
    generateTtsForStory: async ({ text, outputPath, provider }) => {
      calls.push({ text, outputPath, provider });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "elevenlabs");
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.elevenlabs_tts.ready, true);
  assert.equal(report.elevenlabs_tts.secret_values_exposed, false);
  assert.equal(report.safety.external_tts_provider_used, "elevenlabs");
});

test("goal audio materializer recomputes ElevenLabs readiness when explicit provider overrides stale workbench", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-stale-elevenlabs-"));
  const artifactDir = await makePackage(root, "story-stale-elevenlabs");
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      elevenlabs_tts: {
        provider: "elevenlabs",
        ready: false,
        allowed: false,
        configured: true,
        missing: [],
        reason: "external ElevenLabs generation requires --provider elevenlabs; local clone is default",
      },
      provider_preference: "auto",
      jobs: [workbenchJob("story-stale-elevenlabs", artifactDir)],
    },
    provider: "elevenlabs",
    ttsEnv: {
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_VOICE_ID: "test-voice",
    },
    generatedAt: "2026-05-22T06:02:40.000Z",
    generateTtsForStory: async ({ text, outputPath, provider }) => {
      calls.push({ text, outputPath, provider });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "elevenlabs");
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.elevenlabs_tts.ready, true);
  assert.equal(report.elevenlabs_tts.allowed, true);
  assert.equal(report.elevenlabs_tts.secret_values_exposed, false);
});

test("goal audio materializer honours explicit local provider over workbench ElevenLabs fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-local-override-"));
  const artifactDir = await makePackage(root);
  let generated = false;

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "stale", ready: false },
      elevenlabs_tts: { ready: true, configured: true },
      jobs: [
        {
          ...workbenchJob("story-audio", artifactDir),
          tts_provider: "elevenlabs",
        },
      ],
    },
    provider: "local",
    generatedAt: "2026-05-26T08:35:00.000Z",
    generateTtsForStory: async () => {
      generated = true;
    },
  });

  assert.equal(generated, false);
  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.jobs[0].status, "failed");
  assert.equal(report.jobs[0].error, "local_tts_not_ready");
  assert.equal(report.safety.external_tts_provider_used, null);
});

test("goal audio materializer normalises HTML entities before sending narration to local TTS", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-html-"));
  const artifactDir = await makePackage(root, "story-html", {
    selected_title: "Lego Batman Has One Arkham Catch",
    narration_script: "Lego Batman says You&#8217;ve got &amp; options.",
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-html", artifactDir)],
    },
    generatedAt: "2026-05-22T06:03:00.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(calls[0].text, "Lego Batman says You've got & options.");
  assert.equal(calls[0].text.includes("&#"), false);
  assert.equal(calls[0].text.includes("&amp;"), false);
});

test("goal audio materializer skips existing ready pairs unless forced", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-skip-"));
  const artifactDir = await makePackage(root);
  const audioPath = path.join(root, "output", "audio", "story-audio.mp3");
  const timestampPath = path.join(root, "output", "audio", "story-audio_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
  await fs.outputJson(timestampPath, {
    words: [{ word: "Star", start: 0, end: 0.2 }],
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-audio", artifactDir)],
    },
    generatedAt: "2026-05-22T06:05:00.000Z",
    generateTtsForStory: async () => {
      throw new Error("should not regenerate ready audio");
    },
  });

  assert.equal(report.summary.skipped_existing_count, 1);
  assert.equal(report.jobs[0].status, "skipped_existing_ready_pair");
});

test("goal audio materializer regenerates when existing ASR alignment repair is not clean", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-asr-regenerate-"));
  const script = "The Expanse Osiris Reborn finally showed real gameplay. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-asr-regenerate", {
    selected_title: "The Expanse Shows Real Gameplay",
    narration_script: script,
  });
  await fs.outputFile(
    path.join(root, "output", "audio", "story-asr-regenerate.mp3"),
    Buffer.alloc(4096, 1),
  );
  await fs.outputJson(path.join(root, "output", "audio", "story-asr-regenerate_timestamps.json"), {
    words: [
      { word: "The", start: 0, end: 0.2 },
      { word: "Expanse", start: 0.21, end: 0.5 },
    ],
    meta: {
      transcript: script,
      wordTimestampSource: "local_audio_silence_anchored",
    },
  });
  const calls = [];
  let alignmentCall = 0;

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [
        {
          ...workbenchJob("story-asr-regenerate", artifactDir),
          audio: { usable: false, reason: "asr_inserted_words_regenerate_narration" },
          timestamps: {
            usable: false,
            reason: "asr_inserted_words_above_threshold",
            requires_audio_regeneration: true,
          },
        },
      ],
    },
    generatedAt: "2026-05-27T09:20:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => {
      alignmentCall += 1;
      if (alignmentCall === 1) {
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model: "tiny.en",
          transcript: "The Expanse of Osiris Reborn finally showed real gameplay. Follow Pulse Gaming so you never miss a beat.",
          words: [
            { word: "The", start: 0.1, end: 0.2 },
            { word: "Expanse", start: 0.22, end: 0.5 },
            { word: "of", start: 0.52, end: 0.62 },
            { word: "Osiris", start: 0.64, end: 0.9 },
            { word: "Reborn", start: 0.92, end: 1.2 },
            { word: "finally", start: 1.22, end: 1.5 },
            { word: "showed", start: 1.52, end: 1.76 },
            { word: "real", start: 1.78, end: 1.96 },
            { word: "gameplay.", start: 1.98, end: 2.34 },
            { word: "Follow", start: 2.5, end: 2.72 },
            { word: "Pulse", start: 2.74, end: 2.94 },
            { word: "Gaming", start: 2.96, end: 3.22 },
            { word: "so", start: 3.24, end: 3.36 },
            { word: "you", start: 3.38, end: 3.5 },
            { word: "never", start: 3.52, end: 3.72 },
            { word: "miss", start: 3.74, end: 3.9 },
            { word: "a", start: 3.92, end: 3.98 },
            { word: "beat.", start: 4, end: 4.24 },
          ],
        };
      }
      return {
        ok: true,
        source: "local_whisper_word_alignment",
        model: "tiny.en",
        transcript: script,
        words: script.split(/\s+/).map((word, index) => ({
          word,
          start: Number((index * 0.2).toFixed(2)),
          end: Number((index * 0.2 + 0.16).toFixed(2)),
        })),
      };
    },
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 2));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.failed_count, 0);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].reason, "existing_pair_failed_asr_alignment_regenerated");
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-asr-regenerate_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 0);
});

test("goal audio materializer does not skip Whisper pairs already flagged for narration regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-no-false-ready-"));
  const script =
    "Mega Mewtwo finally has a Pokémon Go path instead of another tease. Follow Pulse Gaming so you never miss a beat.";
  const artifactDir = await makePackage(root, "story-no-false-ready", {
    selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
    narration_script: script,
  });
  await fs.outputFile(
    path.join(root, "output", "audio", "story-no-false-ready.mp3"),
    Buffer.alloc(4096, 1),
  );
  await fs.outputJson(path.join(root, "output", "audio", "story-no-false-ready_timestamps.json"), {
    words: [
      { word: "Mega", start: 0, end: 0.2 },
      { word: "Mewtwo", start: 0.21, end: 0.5 },
    ],
    meta: {
      transcript: script,
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: {
        repaired: true,
        script_inserted_actual_word_count: 7,
      },
    },
  });
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [
        {
          ...workbenchJob("story-no-false-ready", artifactDir),
          status: "requires_audio_timestamp_generation",
          audio: { usable: false, reason: "asr_inserted_words_regenerate_narration" },
          timestamps: {
            usable: false,
            reason: "asr_inserted_words_above_threshold",
            requires_audio_regeneration: true,
          },
        },
      ],
    },
    generatedAt: "2026-05-27T12:20:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: script,
      words: script.split(/\s+/).map((word, index) => ({
        word,
        start: Number((index * 0.2).toFixed(2)),
        end: Number((index * 0.2 + 0.16).toFixed(2)),
      })),
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 2));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].reason, "existing_pair_failed_asr_alignment_regenerated");
});

test("goal audio materializer regenerates existing pairs that predate repaired public copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-stale-copy-"));
  const artifactDir = await makePackage(root, "story-audio", {
    public_copy_repaired_at: "2026-05-22T09:00:00.000Z",
    narration_script: "Star Fox just got a cleaner Switch 2 camera line.",
  });
  const audioPath = path.join(root, "output", "audio", "story-audio.mp3");
  const timestampPath = path.join(root, "output", "audio", "story-audio_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
  await fs.outputJson(timestampPath, {
    words: [{ word: "Old", start: 0, end: 0.2 }],
  });
  const staleTime = new Date("2026-05-22T08:30:00.000Z");
  await fs.utimes(audioPath, staleTime, staleTime);
  await fs.utimes(timestampPath, staleTime, staleTime);
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-audio", artifactDir)],
    },
    generatedAt: "2026-05-22T09:05:00.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const freshAudioPath = path.join(root, outputPath);
      const freshTimestampPath = path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json"));
      await fs.outputFile(freshAudioPath, Buffer.alloc(4096, 2));
      await fs.outputJson(freshTimestampPath, {
        alignment: charAlignment(text),
      });
      const freshTime = new Date("2026-05-22T09:05:00.000Z");
      await fs.utimes(freshAudioPath, freshTime, freshTime);
      await fs.utimes(freshTimestampPath, freshTime, freshTime);
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "Star Fox just got a cleaner Switch 2 camera line.");
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].reason, "existing_pair_stale_after_public_copy_repair");
  const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
  assert.equal(manifest.materialized_at, "2026-05-22T09:05:00.000Z");
  assert.equal(manifest.voice_status, "materialized");
});

test("goal audio materializer regenerates existing pairs that predate repaired duration variants", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-stale-duration-"));
  const artifactDir = await makePackage(root, "story-audio", {
    duration_variant_repaired_at: "2026-05-22T10:00:00.000Z",
    narration_script: "Hades II just turned its console date into the real story.",
  });
  const audioPath = path.join(root, "output", "audio", "story-audio.mp3");
  const timestampPath = path.join(root, "output", "audio", "story-audio_timestamps.json");
  await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
  await fs.outputJson(timestampPath, {
    words: [{ word: "Old", start: 0, end: 0.2 }],
  });
  const staleTime = new Date("2026-05-22T09:55:00.000Z");
  await fs.utimes(audioPath, staleTime, staleTime);
  await fs.utimes(timestampPath, staleTime, staleTime);
  const calls = [];

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-audio", artifactDir)],
    },
    generatedAt: "2026-05-22T10:05:00.000Z",
    generateTtsForStory: async ({ text, outputPath }) => {
      calls.push({ text, outputPath });
      const freshAudioPath = path.join(root, outputPath);
      const freshTimestampPath = path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json"));
      await fs.outputFile(freshAudioPath, Buffer.alloc(4096, 2));
      await fs.outputJson(freshTimestampPath, {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "Hades two just turned its console date into the real story.");
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].status, "materialized");
  assert.equal(report.jobs[0].reason, "existing_pair_stale_after_duration_variant_repair");
  const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
  assert.equal(manifest.materialized_at, "2026-05-22T10:05:00.000Z");
});

test("goal audio materializer recognises ready pairs under MEDIA_ROOT", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-media-root-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-root-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const artifactDir = await makePackage(root);
    await fs.outputFile(
      path.join(mediaRoot, "output", "audio", "story-audio.mp3"),
      Buffer.alloc(4096, 1),
    );
    await fs.outputJson(path.join(mediaRoot, "output", "audio", "story-audio_timestamps.json"), {
      words: [{ word: "Star", start: 0, end: 0.2 }],
    });

    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "green", ready: true },
        jobs: [workbenchJob("story-audio", artifactDir)],
      },
      generatedAt: "2026-05-22T06:07:00.000Z",
      generateTtsForStory: async () => {
        throw new Error("should not regenerate media-root audio");
      },
    });

    assert.equal(report.summary.skipped_existing_count, 1);
    assert.equal(report.jobs[0].status, "skipped_existing_ready_pair");
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("goal audio materializer does not regenerate when fresh MEDIA_ROOT audio supersedes stale workspace audio", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-media-supersede-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-root-supersede-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const artifactDir = await makePackage(root, "story-audio", {
      public_copy_repaired_at: "2026-05-22T09:00:00.000Z",
      narration_script: "Star Fox just got a cleaner Switch 2 camera line.",
    });
    const staleTime = new Date("2026-05-22T08:30:00.000Z");
    const freshTime = new Date("2026-05-22T09:05:00.000Z");
    const workspaceAudioPath = path.join(root, "output", "audio", "story-audio.mp3");
    const workspaceTimestampPath = path.join(root, "output", "audio", "story-audio_timestamps.json");
    const mediaAudioPath = path.join(mediaRoot, "output", "audio", "story-audio.mp3");
    const mediaTimestampPath = path.join(mediaRoot, "output", "audio", "story-audio_timestamps.json");
    await fs.outputFile(workspaceAudioPath, Buffer.alloc(4096, 1));
    await fs.outputJson(workspaceTimestampPath, {
      words: [{ word: "Old", start: 0, end: 0.2 }],
    });
    await fs.utimes(workspaceAudioPath, staleTime, staleTime);
    await fs.utimes(workspaceTimestampPath, staleTime, staleTime);
    await fs.outputFile(mediaAudioPath, Buffer.alloc(4096, 2));
    await fs.outputJson(mediaTimestampPath, {
      words: [{ word: "Fresh", start: 0, end: 0.2 }],
    });
    await fs.utimes(mediaAudioPath, freshTime, freshTime);
    await fs.utimes(mediaTimestampPath, freshTime, freshTime);

    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "green", ready: true },
        jobs: [workbenchJob("story-audio", artifactDir)],
      },
      generatedAt: "2026-05-22T09:10:00.000Z",
      generateTtsForStory: async () => {
        throw new Error("should not regenerate when media-root pair is fresh");
      },
    });

    assert.equal(report.summary.skipped_existing_count, 1);
    assert.equal(report.jobs[0].status, "skipped_existing_ready_pair");
    assert.equal(report.jobs[0].audio_size_bytes, 4096);
    const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
    assert.equal(manifest.word_timestamps_path, "audio/word_timestamps.json");
    assert.equal(
      manifest.resolved_word_timestamps_path,
      path.join(artifactDir, "audio", "word_timestamps.json"),
    );
    const packageTimestamps = await fs.readJson(manifest.resolved_word_timestamps_path);
    assert.equal(packageTimestamps.words[0].word, "Fresh");
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("goal audio materializer promotes fresh generated workspace audio over stale MEDIA_ROOT copies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-media-promote-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-root-promote-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  const storyId = "story-media-promote";
  const script =
    "Mega Mewtwo finally has a Pokémon Go path. The player detail is timing, raid access and whether free players actually get a fair shot. Follow Pulse Gaming so you never miss a beat.";
  try {
    const artifactDir = await makePackage(root, storyId, {
      selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
      narration_script: script,
    });
    const mediaAudioPath = path.join(mediaRoot, "output", "audio", `${storyId}.mp3`);
    const mediaTimestampPath = path.join(mediaRoot, "output", "audio", `${storyId}_timestamps.json`);
    await fs.outputFile(mediaAudioPath, Buffer.alloc(2048, 1));
    await fs.outputJson(mediaTimestampPath, {
      words: [{ word: "stale", start: 0, end: 0.2 }],
      meta: { transcript: "stale media root copy" },
    });

    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "green", ready: true },
        jobs: [workbenchJob(storyId, artifactDir)],
      },
      generatedAt: "2026-05-27T15:15:00.000Z",
      force: true,
      promoteGeneratedMediaRoot: true,
      alignmentMode: "whisper",
      alignWordsWithAudio: async ({ audioPath, scriptText }) => {
        assert.match(audioPath, /[\\/]output[\\/]audio[\\/]\.staging[\\/]/);
        assert.equal((await fs.stat(audioPath)).size, 4096);
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model: "tiny.en",
          transcript: scriptText,
          words: whisperWordsFromScript(scriptText),
        };
      },
      generateTtsForStory: async ({ text, outputPath }) => {
        await fs.outputFile(path.join(root, outputPath), Buffer.alloc(4096, 2));
        await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
          alignment: charAlignment(text),
        });
        return { ok: true };
      },
    });

    assert.equal(report.summary.materialized_count, 1);
    assert.equal((await fs.stat(mediaAudioPath)).size, 4096);
    const timestamps = await fs.readJson(mediaTimestampPath);
    assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
    assert.equal(timestamps.words.length, script.split(/\s+/).length);
    assert.equal(await fs.pathExists(path.join(mediaRoot, "output", "audio", ".staging")), false);
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("goal audio materializer does not overwrite fresh MEDIA_ROOT generation with stale workspace copies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-media-fresh-root-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-root-fresh-root-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  const storyId = "story-media-root-fresh";
  const script =
    "Xbox asked for feedback and immediately got the exclusives argument. The uncomfortable part is that fans skipped the survey framing and went straight to Xbox's platform promise.";
  try {
    const artifactDir = await makePackage(root, storyId, {
      selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
      canonical_subject: "Xbox",
      narration_script: script,
      public_copy_repaired_at: "2026-05-28T03:10:00.000Z",
    });
    const workspaceAudioPath = path.join(root, "output", "audio", `${storyId}.mp3`);
    const workspaceTimestampPath = path.join(root, "output", "audio", `${storyId}_timestamps.json`);
    await fs.outputFile(workspaceAudioPath, Buffer.alloc(2048, 1));
    await fs.outputJson(workspaceTimestampPath, {
      alignment: charAlignment("Old stale narration that must not be promoted."),
    });
    const staleTime = new Date("2026-05-28T03:00:00.000Z");
    await fs.utimes(workspaceAudioPath, staleTime, staleTime);
    await fs.utimes(workspaceTimestampPath, staleTime, staleTime);

    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "green", ready: true },
        jobs: [workbenchJob(storyId, artifactDir)],
      },
      generatedAt: "2026-05-28T03:12:00.000Z",
      force: true,
      promoteGeneratedMediaRoot: true,
      alignmentMode: "whisper",
      alignWordsWithAudio: async ({ audioPath, scriptText }) => {
        assert.equal((await fs.stat(audioPath)).size, 4096);
        return {
          ok: true,
          source: "local_whisper_word_alignment",
          model: "tiny.en",
          transcript: scriptText,
          words: whisperWordsFromScript(scriptText),
        };
      },
      generateTtsForStory: async ({ text, outputPath }) => {
        await fs.outputFile(path.join(mediaRoot, outputPath), Buffer.alloc(4096, 2));
        await fs.outputJson(path.join(mediaRoot, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
          alignment: charAlignment(text),
        });
        return { ok: true };
      },
    });

    assert.equal(report.summary.materialized_count, 1);
    assert.equal((await fs.stat(path.join(mediaRoot, "output", "audio", `${storyId}.mp3`))).size, 4096);
    const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
    assert.equal(manifest.word_timestamp_source, "local_whisper_word_alignment");
    assert.equal(manifest.timestamp_whisper_alignment.script_inserted_actual_word_count, 0);
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("goal audio materializer normalises an existing media-root character alignment without regenerating", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-normalise-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-root-normalise-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const artifactDir = await makePackage(root);
    await fs.outputFile(
      path.join(mediaRoot, "output", "audio", "story-audio.mp3"),
      Buffer.alloc(4096, 1),
    );
    await fs.outputJson(path.join(mediaRoot, "output", "audio", "story-audio_timestamps.json"), {
      alignment: charAlignment("Star Fox just got a sharper Switch deal."),
    });

    const report = await materializeGoalAudioTimestamps({
      workspaceRoot: root,
      workbenchReport: {
        local_tts: { verdict: "green", ready: true },
        jobs: [workbenchJob("story-audio", artifactDir)],
      },
      generatedAt: "2026-05-22T06:08:00.000Z",
      generateTtsForStory: async () => {
        throw new Error("should not regenerate normalisable media-root audio");
      },
    });

    assert.equal(report.summary.materialized_count, 1);
    assert.equal(report.jobs[0].status, "materialized_existing_pair");
    const timestamps = await fs.readJson(
      path.join(mediaRoot, "output", "audio", "story-audio_timestamps.json"),
    );
    assert.ok(timestamps.words.length >= 5);
    const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
    assert.equal(manifest.word_timestamps_path, "audio/word_timestamps.json");
    assert.equal(manifest.word_timestamp_source, "local_alignment_normalised");
    assert.equal(
      manifest.resolved_word_timestamps_path,
      path.join(artifactDir, "audio", "word_timestamps.json"),
    );
    assert.equal(await fs.pathExists(path.join(artifactDir, "audio", "narration.mp3")), true);
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("goal audio materializer realigns existing local audio with Whisper without regenerating narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-asr-realign-"));
  const artifactDir = await makePackage(root);
  await fs.outputFile(
    path.join(root, "output", "audio", "story-audio.mp3"),
    Buffer.alloc(4096, 1),
  );
  await fs.outputJson(path.join(root, "output", "audio", "story-audio_timestamps.json"), {
    words: [
      { word: "Star", start: 0, end: 0.2 },
      { word: "Fox", start: 0.21, end: 0.44 },
    ],
    meta: {
      wordTimestampSource: "local_audio_silence_anchored",
    },
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "red", ready: false, failure_code: "server_down" },
      jobs: [
        {
          ...workbenchJob("story-audio", artifactDir),
          status: "requires_word_timestamp_asr_alignment",
          missing: ["word_timestamps_asr_alignment"],
          tts_provider: null,
        },
      ],
    },
    generatedAt: "2026-05-26T08:30:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async ({ audioPath, scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: scriptText,
      language: "en",
      segments: 1,
      words: [
        { word: "Star", start: 0.12, end: 0.3 },
        { word: "Fox", start: 0.31, end: 0.52 },
        { word: "just", start: 0.53, end: 0.7 },
        { word: "got", start: 0.71, end: 0.84 },
        { word: "a", start: 0.85, end: 0.92 },
        { word: "sharper", start: 0.94, end: 1.18 },
        { word: "Switch", start: 1.2, end: 1.42 },
        { word: "2", start: 1.44, end: 1.56 },
        { word: "camera", start: 1.58, end: 1.86 },
        { word: "deal.", start: 1.88, end: 2.12 },
      ],
      audioPath,
    }),
    generateTtsForStory: async () => {
      throw new Error("should not regenerate narration for ASR-only alignment");
    },
  });

  assert.equal(report.summary.candidate_count, 1);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].status, "materialized_existing_asr_alignment");
  assert.equal(report.jobs[0].provider, "existing_local_audio");
  assert.equal(report.safety.no_tts_generation_triggered, true);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-audio_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.repaired, true);
  assert.equal(timestamps.words[0].start, 0.12);
  const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
  assert.equal(manifest.word_timestamps_path, "audio/word_timestamps.json");
  assert.equal(manifest.word_timestamp_source, "local_whisper_word_alignment");
  assert.equal(manifest.timestamp_whisper_alignment.repaired, true);
  assert.equal(
    manifest.resolved_word_timestamps_path,
    path.join(artifactDir, "audio", "word_timestamps.json"),
  );
  assert.equal(await fs.pathExists(path.join(artifactDir, "audio", "narration.mp3")), true);
  assert.equal(manifest.voice_provider, "existing");
});

test("goal audio materializer does not skip fallback timestamps when strict Whisper alignment is requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-strict-existing-"));
  const script = "PlayStation five prices went up across Europe and the UK.";
  const artifactDir = await makePackage(root, "story-strict-existing", {
    selected_title: "PS5 Prices Went Up In Europe",
    narration_script: script,
  });
  await fs.outputFile(
    path.join(root, "output", "audio", "story-strict-existing.mp3"),
    Buffer.alloc(4096, 1),
  );
  await fs.outputJson(path.join(root, "output", "audio", "story-strict-existing_timestamps.json"), {
    words: [
      { word: "PlayStation", start: 0, end: 0.3 },
      { word: "five", start: 0.31, end: 0.5 },
    ],
    meta: {
      transcript: script,
      wordTimestampSource: "local_audio_silence_anchored",
    },
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-strict-existing", artifactDir)],
    },
    generatedAt: "2026-05-26T19:30:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: script,
      words: script.split(/\s+/).map((word, index) => ({
        word,
        start: Number((index * 0.16).toFixed(2)),
        end: Number((index * 0.16 + 0.11).toFixed(2)),
      })),
    }),
    generateTtsForStory: async () => {
      throw new Error("should not regenerate narration to repair fallback timestamps");
    },
  });

  assert.equal(report.summary.skipped_existing_count, 0);
  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.jobs[0].status, "materialized_existing_asr_alignment");
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-strict-existing_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
});

test("goal audio materializer repairs zero-duration local Whisper words before captions use them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-zero-word-"));
  const artifactDir = await makePackage(root, "story-zero-word", {
    narration_script: "Follow Pulse Gaming so you never miss a beat.",
  });
  await fs.outputFile(
    path.join(root, "output", "audio", "story-zero-word.mp3"),
    Buffer.alloc(4096, 1),
  );
  await fs.outputJson(path.join(root, "output", "audio", "story-zero-word_timestamps.json"), {
    words: [
      { word: "Follow", start: 40.88, end: 40.88 },
      { word: "Paul's", start: 40.88, end: 41.32 },
      { word: "Gaming,", start: 41.32, end: 41.46 },
      { word: "so", start: 41.62, end: 41.74 },
      { word: "you", start: 41.74, end: 41.88 },
    ],
    meta: {
      wordTimestampSource: "local_audio_silence_anchored",
    },
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "red", ready: false, failure_code: "server_down" },
      jobs: [
        {
          ...workbenchJob("story-zero-word", artifactDir),
          status: "requires_word_timestamp_asr_alignment",
          missing: ["word_timestamps_asr_alignment"],
          tts_provider: null,
        },
      ],
    },
    generatedAt: "2026-05-26T09:00:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async ({ scriptText }) => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "Follow Pulse Gaming, so you never miss a beat.",
      language: "en",
      segments: 1,
      words: [
        { word: "Follow", start: 40.88, end: 40.88 },
        { word: "Pulse", start: 40.88, end: 41.32 },
        { word: "Gaming,", start: 41.32, end: 41.46 },
        { word: "so", start: 41.62, end: 41.74 },
        { word: "you", start: 41.74, end: 41.88 },
        { word: "never", start: 41.9, end: 42.08 },
        { word: "miss", start: 42.1, end: 42.24 },
        { word: "a", start: 42.26, end: 42.32 },
        { word: "beat.", start: 42.34, end: 42.56 },
      ],
      scriptText,
    }),
    generateTtsForStory: async () => {
      throw new Error("should not regenerate narration for ASR-only alignment");
    },
  });

  assert.equal(report.summary.materialized_count, 1);
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-zero-word_timestamps.json"));
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWordSpanRepair.repaired, true);
  assert.equal(timestamps.words[0].word, "Follow");
  assert.ok(timestamps.words[0].end - timestamps.words[0].start >= 0.079);
  assert.equal(
    timestamps.words.filter((word) => word.end - word.start <= 0.03).length,
    0,
  );
});

test("goal audio materializer blocks Pulse Gaming ASR brand confusion instead of captioning over it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-brand-confusion-"));
  const artifactDir = await makePackage(root, "story-brand-confusion", {
    narration_script: "Follow Pulse Gaming so you never miss a beat.",
  });

  const report = await materializeGoalAudioTimestamps({
    workspaceRoot: root,
    workbenchReport: {
      local_tts: { verdict: "green", ready: true },
      jobs: [workbenchJob("story-brand-confusion", artifactDir)],
    },
    generatedAt: "2026-06-25T20:30:00.000Z",
    alignmentMode: "whisper",
    alignWordsWithAudio: async () => ({
      ok: true,
      source: "local_whisper_word_alignment",
      model: "tiny.en",
      transcript: "Follow Paul's Gaming so you never miss a beat.",
      words: [
        { word: "Follow", start: 0.04, end: 0.24 },
        { word: "Paul's", start: 0.26, end: 0.54 },
        { word: "Gaming", start: 0.56, end: 0.86 },
        { word: "so", start: 0.88, end: 0.98 },
        { word: "you", start: 1.0, end: 1.1 },
        { word: "never", start: 1.12, end: 1.32 },
        { word: "miss", start: 1.34, end: 1.5 },
        { word: "a", start: 1.52, end: 1.58 },
        { word: "beat.", start: 1.6, end: 1.84 },
      ],
    }),
    generateTtsForStory: async ({ text, outputPath }) => {
      const audioPath = path.join(root, outputPath);
      await fs.outputFile(audioPath, Buffer.alloc(4096, 1));
      await fs.outputJson(path.join(root, outputPath.replace(/\.mp3$/i, "_timestamps.json")), {
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  assert.equal(report.summary.materialized_count, 0);
  assert.equal(report.summary.failed_count, 1);
  assert.equal(report.jobs[0].status, "failed");
  assert.match(report.jobs[0].error, /whisper_protected_brand_phrase_mismatch/);
  assert.equal(
    report.jobs[0].timestamp_whisper_alignment.error,
    "whisper_protected_brand_phrase_mismatch",
  );
});

test("normaliseTimestampFile writes display-safe caption tokens for spoken platform, year and GTA expansions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-caption-display-"));
  const timestampPath = path.join(root, "timestamps.json");
  await fs.outputJson(timestampPath, {
    words: [
      { word: "PlayStation", start: 0, end: 0.42 },
      { word: "five", start: 0.43, end: 0.68 },
      { word: "gets", start: 0.7, end: 0.9 },
      { word: "a", start: 0.91, end: 1.0 },
      { word: "June", start: 1.02, end: 1.2 },
      { word: "twenty", start: 1.21, end: 1.48 },
      { word: "twenty", start: 1.49, end: 1.76 },
      { word: "six", start: 1.77, end: 2.0 },
      { word: "G", start: 2.1, end: 2.18 },
      { word: "T", start: 2.19, end: 2.27 },
      { word: "A", start: 2.28, end: 2.36 },
      { word: "six", start: 2.37, end: 2.6 },
      { word: "cover.", start: 2.61, end: 2.9 },
    ],
    meta: {
      wordTimestampSource: "local_alignment_normalised",
      timestampWhisperAlignment: {
        repaired: true,
        strategy: "local_whisper_word_alignment",
      },
    },
  });

  await normaliseTimestampFile(timestampPath, {
    generatedAt: "2026-06-25T16:00:00.000Z",
    text: "PS5 gets a June 2026 GTA VI cover.",
    spokenText: "PlayStation five gets a June twenty twenty six G T A six cover.",
    provider: "local",
    alignmentMode: "off",
  });

  const timestamps = await fs.readJson(timestampPath);
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  const display = timestamps.words.map((word) => word.word).join(" ");
  assert.equal(display, "PS5 gets a June 2026 GTA VI cover.");
  assert.equal(timestamps.words[0].start, 0);
  assert.equal(timestamps.words[0].end, 0.68);
  assert.equal(timestamps.words[4].word, "2026");
  assert.equal(timestamps.words[4].start, 1.21);
  assert.equal(timestamps.words[4].end, 2);
  assert.equal(timestamps.words[5].word, "GTA VI");
  assert.equal(timestamps.words[5].start, 2.1);
  assert.equal(timestamps.words[5].end, 2.6);
  assert.equal(timestamps.meta.timestampDisplayTextRepair.repaired, true);
  assert.deepEqual(timestamps.meta.timestampDisplayTextRepair.replacements, [
    "PlayStation five->PS5",
    "twenty twenty six->2026",
    "G T A six->GTA VI",
  ]);
});

test("normaliseTimestampFile does not clamp long aligned words to stale segment duration metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-stale-duration-"));
  const timestampPath = path.join(root, "timestamps.json");
  const script = Array.from({ length: 90 }, (_, index) => `word${index + 1}`).join(" ");
  const words = script.split(/\s+/).map((word, index) => ({
    word,
    start: Number((index * 0.42).toFixed(3)),
    end: Number((index * 0.42 + 0.24).toFixed(3)),
  }));
  await fs.outputJson(timestampPath, {
    words,
    meta: {
      acoustic: { durationSeconds: 4.48 },
    },
  });

  await normaliseTimestampFile(timestampPath, {
    generatedAt: "2026-05-28T22:40:00.000Z",
    text: script,
    provider: "local",
    alignmentMode: "off",
  });

  const normalised = await fs.readJson(timestampPath);
  assert.equal(normalised.words.length, words.length);
  assert.ok(
    normalised.words.at(-1).end > 37,
    `expected the last timestamp to keep the long alignment span, got ${normalised.words.at(-1).end}`,
  );
  assert.equal(normalised.meta.timestampDurationClamp, undefined);
});

test("goal audio materializer writes JSON and Markdown reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-materializer-write-"));
  const report = {
    mode: "LOCAL_AUDIO_TIMESTAMP_MATERIALIZER",
    generated_at: "2026-05-22T06:10:00.000Z",
    summary: { materialized_count: 0, failed_count: 0, skipped_existing_count: 0 },
    jobs: [],
    safety: { no_publish_triggered: true },
  };

  const written = await writeGoalAudioTimestampMaterializationReport(report, {
    outputDir: path.join(root, "out"),
  });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.match(markdown, /Audio Timestamp Materialization/);
});
