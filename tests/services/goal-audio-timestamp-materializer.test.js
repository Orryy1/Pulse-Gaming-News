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
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * 0.05),
    character_end_times_seconds: characters.map((_, index) => index * 0.05 + 0.04),
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
  const timestamps = await fs.readJson(path.join(root, "output", "audio", "story-audio_timestamps.json"));
  assert.ok(timestamps.words.length >= 5);
  const manifest = await fs.readJson(path.join(artifactDir, "audio_manifest.json"));
  assert.equal(manifest.narration_audio_path, "output/audio/story-audio.mp3");
  assert.equal(manifest.word_timestamps_path, "output/audio/story-audio_timestamps.json");
  assert.equal(manifest.voice_provider, "local_tts");
  assert.equal(manifest.safety.local_only, true);
  assert.equal(report.safety.no_publish_triggered, true);
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
        alignment: charAlignment(text),
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
        alignment: charAlignment(text),
      });
      return { ok: true };
    },
  });

  const narration = await fs.readJson(path.join(artifactDir, "narration_manifest.json"));
  assert.equal(narration.generated_at, "2026-05-22T06:00:50.000Z");
  assert.equal(narration.transcript, "Hades two finally has a PlayStation and Xbox date.");
  assert.equal(narration.final_transcript, "Hades two finally has a PlayStation and Xbox date.");
  assert.equal(narration.word_timestamp_source, "local_alignment_normalised");
  assert.doesNotMatch(narration.transcript, /Hades, two/);

  const captions = await fs.readJson(path.join(artifactDir, "caption_manifest.json"));
  assert.equal(captions.generated_at, "2026-05-22T06:00:50.000Z");
  assert.equal(captions.word_timestamp_source, "local_alignment_normalised");
  assert.equal(captions.transcript, "Hades two finally has a PlayStation and Xbox date.");
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

test("goal audio materializer accepts tiny ASR insertions on long high-coverage Whisper alignment", async () => {
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

  assert.equal(report.summary.materialized_count, 1);
  assert.equal(report.summary.failed_count, 0);
  const timestamps = await fs.readJson(
    path.join(root, "output", "audio", "story-whisper-long-insertions_timestamps.json"),
  );
  assert.equal(timestamps.meta.wordTimestampSource, "local_whisper_word_alignment");
  assert.equal(timestamps.meta.timestampWhisperAlignment.script_inserted_actual_word_count, 3);
  assert.equal(timestamps.words.length, expectedWords.length);
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
  assert.equal(timestamps.meta.wordTimestampSource, "elevenlabs_alignment_normalised");
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
  assert.equal(audioRecord.path, "output/audio/story-elevenlabs-rights.mp3");
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
    assert.equal(
      manifest.resolved_word_timestamps_path,
      path.join(mediaRoot, "output", "audio", "story-audio_timestamps.json"),
    );
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
        assert.equal(path.resolve(audioPath), path.resolve(mediaAudioPath));
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
    assert.equal(manifest.word_timestamps_path, "output/audio/story-audio_timestamps.json");
    assert.equal(manifest.word_timestamp_source, "local_alignment_normalised");
    assert.equal(
      manifest.resolved_word_timestamps_path,
      path.join(mediaRoot, "output", "audio", "story-audio_timestamps.json"),
    );
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
  assert.equal(manifest.word_timestamps_path, "output/audio/story-audio_timestamps.json");
  assert.equal(manifest.word_timestamp_source, "local_whisper_word_alignment");
  assert.equal(manifest.timestamp_whisper_alignment.repaired, true);
  assert.equal(
    manifest.resolved_word_timestamps_path,
    path.join(root, "output", "audio", "story-audio_timestamps.json"),
  );
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
      transcript: "Follow Paul's Gaming, so you never miss a beat.",
      language: "en",
      segments: 1,
      words: [
        { word: "Follow", start: 40.88, end: 40.88 },
        { word: "Paul's", start: 40.88, end: 41.32 },
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
