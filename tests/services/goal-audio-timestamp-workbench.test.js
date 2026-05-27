"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGoalAudioTimestampWorkbench,
  writeGoalAudioTimestampWorkbench,
} = require("../../lib/goal-audio-timestamp-workbench");

function audioJob(overrides = {}) {
  return {
    story_id: "story-audio",
    title: "Star Fox Deal Has One Catch",
    artifact_dir: null,
    status: "blocked_on_render_inputs",
    blockers: ["final_narration_audio_missing", "word_timestamps_missing"],
    actions: [
      {
        action_id: "generate_final_narration_audio_and_word_timestamps",
        status: "required",
        output_expectations: [
          "audio_manifest.json:narration_audio_path",
          "audio_manifest.json:word_timestamps_path",
          "output/audio/story-audio.mp3",
          "output/audio/story-audio_timestamps.json",
        ],
      },
    ],
    ...overrides,
  };
}

test("audio timestamp workbench detects an existing usable audio and word timestamp pair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-ready-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [
      { word: "Star", start: 0, end: 0.2 },
      { word: "Fox", start: 0.22, end: 0.5 },
    ],
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: { jobs: [audioJob()] },
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    generatedAt: "2026-05-22T05:00:00.000Z",
  });

  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.ready_audio_timestamp_pair_count, 1);
  assert.equal(report.summary.blocked_local_tts_count, 0);
  assert.equal(report.jobs[0].status, "ready_audio_timestamp_pair");
  assert.match(report.jobs[0].audio.path, /story-audio\.mp3$/);
  assert.match(report.jobs[0].timestamps.path, /story-audio_timestamps\.json$/);
  assert.equal(report.safety.no_tts_generation_triggered, true);
});

test("audio timestamp workbench accepts story-package arrays as work orders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-array-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [{ word: "Star", start: 0, end: 0.2 }],
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: [{ story_id: "story-audio", title: "Star Fox Deal Has One Catch" }],
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    generatedAt: "2026-05-22T05:01:00.000Z",
  });

  assert.equal(report.summary.story_count, 1);
  assert.equal(report.jobs[0].status, "ready_audio_timestamp_pair");
  assert.equal(report.source_work_order_generated_at, null);
});

test("audio timestamp workbench resolves output audio expectations from the workspace root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-root-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-audio");
  const audioDir = path.join(root, "output", "audio");
  await fs.ensureDir(artifactDir);
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [{ word: "Star", start: 0, end: 0.2 }],
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          artifact_dir: artifactDir,
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    generatedAt: "2026-05-22T05:03:00.000Z",
  });

  assert.equal(report.jobs[0].status, "ready_audio_timestamp_pair");
  assert.equal(report.jobs[0].audio.path, path.join(audioDir, "story-audio.mp3"));
  assert.equal(report.jobs[0].timestamps.path, path.join(audioDir, "story-audio_timestamps.json"));
});

test("audio timestamp workbench reports missing output expectations from the workspace root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-missing-root-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-audio");
  await fs.ensureDir(artifactDir);

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          artifact_dir: artifactDir,
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    generatedAt: "2026-05-22T05:04:00.000Z",
  });

  assert.equal(report.jobs[0].audio.path, path.join(root, "output", "audio", "story-audio.mp3"));
  assert.equal(
    report.jobs[0].timestamps.path,
    path.join(root, "output", "audio", "story-audio_timestamps.json"),
  );
});

test("audio timestamp workbench detects ready output audio under MEDIA_ROOT", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-media-root-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-workbench-media-root-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-audio");
    await fs.ensureDir(artifactDir);
    await fs.outputFile(
      path.join(mediaRoot, "output", "audio", "story-audio.mp3"),
      Buffer.alloc(2048, 1),
    );
    await fs.outputJson(path.join(mediaRoot, "output", "audio", "story-audio_timestamps.json"), {
      words: [{ word: "Star", start: 0, end: 0.2 }],
    });

    const report = await buildGoalAudioTimestampWorkbench({
      workspaceRoot: root,
      workOrder: {
        jobs: [
          audioJob({
            artifact_dir: artifactDir,
          }),
        ],
      },
      localTtsDoctorReport: { verdict: "green" },
      generatedAt: "2026-05-22T05:04:30.000Z",
    });

    assert.equal(report.jobs[0].status, "ready_audio_timestamp_pair");
    assert.equal(
      report.jobs[0].audio.path,
      path.join(mediaRoot, "output", "audio", "story-audio.mp3"),
    );
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("audio timestamp workbench prefers fresh MEDIA_ROOT audio over stale workspace legacy files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-media-prefer-"));
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-workbench-media-prefer-"));
  const originalMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-audio");
    const workspaceAudioDir = path.join(root, "output", "audio");
    const mediaAudioDir = path.join(mediaRoot, "output", "audio");
    await fs.ensureDir(artifactDir);
    await fs.outputFile(path.join(workspaceAudioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
    await fs.outputJson(path.join(workspaceAudioDir, "story-audio_timestamps.json"), {
      words: [{ word: "Old", start: 0, end: 0.2 }],
    });
    await fs.outputFile(path.join(mediaAudioDir, "story-audio.mp3"), Buffer.alloc(4096, 2));
    await fs.outputJson(path.join(mediaAudioDir, "story-audio_timestamps.json"), {
      words: [{ word: "Fresh", start: 0, end: 0.2 }],
    });

    const report = await buildGoalAudioTimestampWorkbench({
      workspaceRoot: root,
      workOrder: {
        jobs: [
          audioJob({
            artifact_dir: artifactDir,
          }),
        ],
      },
      localTtsDoctorReport: { verdict: "green" },
      generatedAt: "2026-05-22T05:04:45.000Z",
    });

    assert.equal(report.jobs[0].status, "ready_audio_timestamp_pair");
    assert.equal(
      report.jobs[0].audio.path,
      path.join(mediaRoot, "output", "audio", "story-audio.mp3"),
    );
    assert.equal(
      report.jobs[0].timestamps.path,
      path.join(mediaRoot, "output", "audio", "story-audio_timestamps.json"),
    );
  } finally {
    if (originalMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = originalMediaRoot;
  }
});

test("audio timestamp workbench forces regeneration for stale repaired-copy audio even when files exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-stale-copy-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [{ word: "Star", start: 0, end: 0.2 }],
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          blockers: [
            "final_narration_audio_stale_after_public_copy_repair",
            "word_timestamps_stale_after_public_copy_repair",
          ],
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "green" },
    generatedAt: "2026-05-22T09:20:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.deepEqual(report.jobs[0].missing, ["narration_audio", "word_timestamps"]);
  assert.equal(report.jobs[0].audio.reason, "stale_after_public_copy_repair");
  assert.equal(report.jobs[0].timestamps.reason, "stale_after_public_copy_repair");
});

test("audio timestamp workbench forces regeneration for stale pronunciation-policy audio even when files exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-stale-pronunciation-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [{ word: "Hades", start: 0, end: 0.2 }],
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          blockers: [
            "final_narration_audio_stale_after_pronunciation_repair",
            "word_timestamps_stale_after_pronunciation_repair",
          ],
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "green" },
    generatedAt: "2026-05-26T08:10:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.deepEqual(report.jobs[0].missing, ["narration_audio", "word_timestamps"]);
  assert.equal(report.jobs[0].audio.reason, "stale_after_pronunciation_repair");
  assert.equal(report.jobs[0].timestamps.reason, "stale_after_pronunciation_repair");
});

test("audio timestamp workbench routes existing local audio with non-ASR timestamps to Whisper alignment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-asr-align-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [
      { word: "Hades", start: 0, end: 0.2 },
      { word: "II", start: 0.21, end: 0.4 },
    ],
    meta: {
      wordTimestampSource: "local_audio_silence_anchored",
    },
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          blockers: ["word_timestamps_not_asr_aligned"],
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    generatedAt: "2026-05-26T08:20:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_asr_alignment_count, 1);
  assert.equal(report.summary.requires_generation_count, 0);
  assert.equal(report.jobs[0].status, "requires_word_timestamp_asr_alignment");
  assert.deepEqual(report.jobs[0].missing, ["word_timestamps_asr_alignment"]);
  assert.equal(report.jobs[0].tts_provider, null);
  assert.equal(report.jobs[0].timestamps.word_timestamp_source, "local_audio_silence_anchored");
  assert.deepEqual(report.jobs[0].next_actions, [
    "align_existing_local_voice_audio_with_local_whisper_word_timestamps",
    "rerun_goal_production_cutover_after_audio_materialisation",
  ]);
});

test("audio timestamp workbench treats Whisper-aligned timestamp blockers as ready after stale workorders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-asr-ready-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [
      { word: "Hades", start: 0, end: 0.2 },
      { word: "number", start: 0.21, end: 0.34 },
      { word: "two", start: 0.35, end: 0.5 },
    ],
    meta: {
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: { repaired: true, model: "tiny.en" },
    },
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          blockers: ["word_timestamps_not_asr_aligned"],
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    generatedAt: "2026-05-26T08:21:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 1);
  assert.equal(report.summary.requires_asr_alignment_count, 0);
  assert.equal(report.jobs[0].status, "ready_audio_timestamp_pair");
  assert.equal(report.jobs[0].timestamps.word_timestamp_source, "local_whisper_word_alignment");
});

test("audio timestamp workbench routes incomplete Whisper coverage back to ASR alignment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-asr-coverage-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [
      { word: "Subnautica", start: 0, end: 0.2 },
      { word: "2", start: 0.21, end: 0.34 },
      { word: "leaked", start: 0.35, end: 0.5 },
    ],
    meta: {
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: { repaired: true, model: "tiny.en" },
    },
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          blockers: ["word_timestamps_asr_coverage_incomplete"],
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    generatedAt: "2026-05-26T16:22:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_asr_alignment_count, 1);
  assert.equal(report.jobs[0].status, "requires_word_timestamp_asr_alignment");
  assert.deepEqual(report.jobs[0].missing, ["word_timestamps_asr_alignment"]);
});

test("audio timestamp workbench blocks failed Whisper coverage even without an explicit workorder blocker", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-failed-coverage-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [
      { word: "Capturing", start: 0, end: 0.2 },
      { word: "has", start: 0.21, end: 0.34 },
      { word: "problems", start: 0.35, end: 0.5 },
    ],
    meta: {
      wordTimestampSource: "local_audio_silence_anchored",
      timestampWhisperAlignment: {
        repaired: false,
        error: "script_coverage_below_threshold",
        model: "tiny.en",
        script_coverage_ratio: 0.84,
        script_opening_covered: true,
        script_expected_word_count: 45,
        script_actual_word_count: 48,
        script_matched_word_count: 38,
      },
    },
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          blockers: [],
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "green" },
    generatedAt: "2026-05-27T09:09:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_asr_alignment_count, 1);
  assert.equal(report.jobs[0].status, "requires_word_timestamp_asr_alignment");
  assert.deepEqual(report.jobs[0].missing, ["word_timestamps_asr_alignment"]);
  assert.equal(report.jobs[0].timestamps.usable, false);
  assert.equal(report.jobs[0].timestamps.requires_asr_alignment, true);
});

test("audio timestamp workbench escalates repeated Whisper coverage failure to narration regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-repeated-coverage-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [
      { word: "Capturing", start: 0, end: 0.2 },
      { word: "has", start: 0.21, end: 0.34 },
      { word: "problems", start: 0.35, end: 0.5 },
    ],
    meta: {
      wordTimestampSource: "local_audio_silence_anchored",
      timestampWhisperAlignment: {
        repaired: false,
        error: "script_coverage_below_threshold",
        model: "tiny.en",
        script_coverage_ratio: 0.84,
        script_opening_covered: true,
        model_attempts: [
          { model: "base.en", error: "script_coverage_below_threshold" },
          { model: "tiny.en", error: "script_coverage_below_threshold" },
        ],
      },
    },
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [audioJob({ blockers: [] })],
    },
    localTtsDoctorReport: { verdict: "green" },
    providerPreference: "local",
    generatedAt: "2026-05-27T09:31:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_asr_alignment_count, 0);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.deepEqual(report.jobs[0].missing, ["narration_audio", "word_timestamps"]);
  assert.equal(report.jobs[0].audio.reason, "asr_alignment_exhausted_regenerate_narration");
  assert.equal(report.jobs[0].timestamps.reason, "asr_alignment_exhausted_regenerate_narration");
  assert.equal(report.jobs[0].asr_failure.status, "exhausted_requires_narration_regeneration");
});

test("audio timestamp workbench routes inserted ASR words to narration regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-asr-insertions-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [{ word: "PS5", start: 0, end: 0.2 }],
    meta: {
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: {
        repaired: true,
        script_inserted_actual_word_count: 5,
        script_trailing_actual_word_count: 0,
      },
    },
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          blockers: ["word_timestamps_asr_coverage_incomplete"],
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "green" },
    generatedAt: "2026-05-27T01:25:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.summary.requires_asr_alignment_count, 0);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.deepEqual(report.jobs[0].missing, ["narration_audio", "word_timestamps"]);
  assert.equal(report.jobs[0].audio.reason, "asr_inserted_words_regenerate_narration");
  assert.equal(report.jobs[0].timestamps.reason, "asr_inserted_words_above_threshold");
});

test("audio timestamp workbench does not let legacy timing files hide bad ASR regeneration evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-asr-evidence-priority-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [{ word: "PS5", start: 0, end: 0.2 }],
    meta: {
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: {
        repaired: true,
        script_inserted_actual_word_count: 4,
        script_trailing_actual_word_count: 0,
      },
    },
  });
  await fs.outputJson(path.join(audioDir, "story-audio_timing.json"), {
    words: [{ word: "Old", start: 0, end: 0.2 }],
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          evidence: {
            word_timestamps_path: path.join(audioDir, "story-audio_timestamps.json"),
          },
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "green" },
    generatedAt: "2026-05-27T01:34:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.summary.requires_asr_alignment_count, 0);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.equal(report.jobs[0].timestamps.path, path.join(audioDir, "story-audio_timestamps.json"));
  assert.equal(report.jobs[0].timestamps.reason, "asr_inserted_words_above_threshold");
});

test("audio timestamp workbench routes exhausted Whisper mismatch to local narration regeneration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-asr-exhausted-"));
  const audioDir = path.join(root, "output", "audio");
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [
      { word: "Subnautica", start: 0, end: 0.2 },
      { word: "leaked", start: 0.21, end: 0.4 },
    ],
    meta: {
      wordTimestampSource: "local_audio_silence_anchored",
      timestampWhisperAlignment: {
        repaired: false,
        error: "reconciled_word_count_mismatch",
        model: "small.en",
        script_coverage_ratio: 0.62,
        script_opening_covered: true,
        model_attempts: [
          { model: "tiny.en", error: "script_coverage_below_threshold" },
          { model: "base.en", error: "script_coverage_below_threshold" },
          { model: "small.en", error: "reconciled_word_count_mismatch" },
        ],
      },
    },
  });

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          blockers: ["word_timestamps_not_asr_aligned"],
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "green" },
    providerPreference: "local",
    generatedAt: "2026-05-26T18:05:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.requires_asr_alignment_count, 0);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.deepEqual(report.jobs[0].missing, ["narration_audio", "word_timestamps"]);
  assert.equal(report.jobs[0].audio.reason, "asr_alignment_exhausted_regenerate_narration");
  assert.equal(report.jobs[0].timestamps.reason, "asr_alignment_exhausted_regenerate_narration");
  assert.equal(report.jobs[0].asr_failure.status, "exhausted_requires_narration_regeneration");
  assert.deepEqual(report.jobs[0].next_actions, [
    "generate_narration_audio_with_word_timestamps",
    "rerun_goal_production_cutover_after_audio_materialisation",
  ]);
});

test("audio timestamp workbench includes stale public-copy audio even without an explicit audio action", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-stale-copy-implicit-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-audio");
  const audioDir = path.join(root, "output", "audio");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-audio",
    public_copy_repaired_at: "2026-05-23T08:00:00.000Z",
  });
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [{ word: "Old", start: 0, end: 0.2 }],
  });
  const oldTime = new Date("2026-05-23T07:00:00.000Z");
  await fs.utimes(path.join(audioDir, "story-audio.mp3"), oldTime, oldTime);
  await fs.utimes(path.join(audioDir, "story-audio_timestamps.json"), oldTime, oldTime);

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          artifact_dir: artifactDir,
          blockers: ["materialised_motion_clips_missing"],
          actions: [
            {
              action_id: "materialise_validated_real_motion_clips",
              status: "required",
            },
          ],
          evidence: {
            public_copy_repaired_at: "2026-05-23T08:00:00.000Z",
          },
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    ttsEnv: {
      ELEVENLABS_API_KEY: "test-key-value",
      ELEVENLABS_VOICE_ID: "test-voice-id",
    },
    providerPreference: "elevenlabs",
    generatedAt: "2026-05-23T08:05:00.000Z",
  });

  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.summary.elevenlabs_generation_count, 1);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.equal(report.jobs[0].audio.reason, "stale_after_public_copy_repair");
  assert.equal(report.jobs[0].timestamps.reason, "stale_after_public_copy_repair");
  assert.equal(report.jobs[0].tts_provider, "elevenlabs");
});

test("audio timestamp workbench includes stale duration-variant audio even without an explicit audio action", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-stale-duration-implicit-"));
  const artifactDir = path.join(root, "output", "goal-proof", "batch", "story-audio");
  const audioDir = path.join(root, "output", "audio");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story-audio",
    duration_variant_repaired_at: "2026-05-23T09:00:00.000Z",
  });
  await fs.outputFile(path.join(audioDir, "story-audio.mp3"), Buffer.alloc(2048, 1));
  await fs.outputJson(path.join(audioDir, "story-audio_timestamps.json"), {
    words: [{ word: "Old", start: 0, end: 0.2 }],
  });
  const oldTime = new Date("2026-05-23T08:30:00.000Z");
  await fs.utimes(path.join(audioDir, "story-audio.mp3"), oldTime, oldTime);
  await fs.utimes(path.join(audioDir, "story-audio_timestamps.json"), oldTime, oldTime);

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: {
      jobs: [
        audioJob({
          artifact_dir: artifactDir,
          blockers: ["materialised_motion_clips_missing"],
          actions: [{ action_id: "materialise_validated_real_motion_clips", status: "required" }],
          evidence: {
            duration_variant_repaired_at: "2026-05-23T09:00:00.000Z",
          },
        }),
      ],
    },
    localTtsDoctorReport: { verdict: "green" },
    providerPreference: "local",
    generatedAt: "2026-05-23T09:05:00.000Z",
  });

  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.equal(report.jobs[0].audio.reason, "stale_after_duration_variant_repair");
  assert.equal(report.jobs[0].timestamps.reason, "stale_after_duration_variant_repair");
  assert.equal(report.jobs[0].tts_provider, "local");
});

test("audio timestamp workbench blocks missing pairs when local TTS is red", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-blocked-"));

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: { jobs: [audioJob()] },
    localTtsDoctorReport: {
      verdict: "red",
      action: "manual_start_required",
      failure_code: "server_down",
      reason: "local TTS HTTP health is unreachable",
    },
    generatedAt: "2026-05-22T05:05:00.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.blocked_local_tts_count, 1);
  assert.equal(report.jobs[0].status, "blocked_local_tts_unreachable");
  assert.deepEqual(report.jobs[0].missing, ["narration_audio", "word_timestamps"]);
  assert.deepEqual(report.jobs[0].next_actions, [
    "start_or_repair_local_tts_then_generate_narration_with_word_timestamps",
    "or_supply_approved_licensed_audio_and_matching_word_timestamps",
  ]);
});

test("audio timestamp workbench does not fall back to ElevenLabs by default when local TTS is red", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-elevenlabs-"));

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: { jobs: [audioJob()] },
    localTtsDoctorReport: {
      verdict: "red",
      action: "manual_start_required",
      failure_code: "server_down",
      reason: "local TTS HTTP health is unreachable",
    },
    ttsEnv: {
      ELEVENLABS_API_KEY: "test-key-value",
      ELEVENLABS_VOICE_ID: "test-voice-id",
    },
    generatedAt: "2026-05-22T05:05:30.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.blocked_local_tts_count, 1);
  assert.equal(report.summary.requires_generation_count, 0);
  assert.equal(report.summary.elevenlabs_generation_count, 0);
  assert.equal(report.elevenlabs_tts.ready, false);
  assert.equal(report.elevenlabs_tts.allowed, false);
  assert.equal(report.elevenlabs_tts.secret_values_exposed, false);
  assert.equal(report.jobs[0].status, "blocked_local_tts_unreachable");
  assert.equal(report.jobs[0].tts_provider, null);
  assert.deepEqual(report.jobs[0].next_actions, [
    "start_or_repair_local_tts_then_generate_narration_with_word_timestamps",
    "or_supply_approved_licensed_audio_and_matching_word_timestamps",
  ]);
});

test("audio timestamp workbench uses ElevenLabs only when explicitly selected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-elevenlabs-explicit-"));

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: { jobs: [audioJob()] },
    localTtsDoctorReport: {
      verdict: "red",
      action: "manual_start_required",
      failure_code: "server_down",
      reason: "local TTS HTTP health is unreachable",
    },
    ttsEnv: {
      ELEVENLABS_API_KEY: "test-key-value",
      ELEVENLABS_VOICE_ID: "test-voice-id",
    },
    providerPreference: "elevenlabs",
    generatedAt: "2026-05-22T05:05:35.000Z",
  });

  assert.equal(report.summary.ready_audio_timestamp_pair_count, 0);
  assert.equal(report.summary.blocked_local_tts_count, 0);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.summary.elevenlabs_generation_count, 1);
  assert.equal(report.elevenlabs_tts.ready, true);
  assert.equal(report.elevenlabs_tts.allowed, true);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.equal(report.jobs[0].tts_provider, "elevenlabs");
  assert.deepEqual(report.jobs[0].next_actions, [
    "generate_elevenlabs_narration_with_word_timestamps",
    "rerun_goal_production_cutover_after_audio_materialisation",
  ]);
});

test("audio timestamp workbench honours local-only provider preference", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-local-only-"));

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: { jobs: [audioJob()] },
    localTtsDoctorReport: {
      verdict: "red",
      failure_code: "server_down",
      reason: "local TTS HTTP health is unreachable",
    },
    ttsEnv: {
      ELEVENLABS_API_KEY: "test-key-value",
      ELEVENLABS_VOICE_ID: "test-voice-id",
    },
    providerPreference: "local",
    generatedAt: "2026-05-22T05:05:45.000Z",
  });

  assert.equal(report.elevenlabs_tts.ready, false);
  assert.equal(report.elevenlabs_tts.allowed, false);
  assert.equal(report.summary.blocked_local_tts_count, 1);
  assert.equal(report.jobs[0].status, "blocked_local_tts_unreachable");
  assert.equal(report.jobs[0].tts_provider, null);
});

test("audio timestamp workbench does not block on stale unreachable doctor fields when local TTS is green", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-stale-"));

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: { jobs: [audioJob()] },
    localTtsDoctorReport: {
      verdict: "green",
      action: "none",
      reason: "local TTS is ready with the accepted voice loaded",
      before: { status: "unreachable" },
    },
    generatedAt: "2026-05-22T05:07:00.000Z",
  });

  assert.equal(report.local_tts.ready, true);
  assert.equal(report.local_tts.unreachable, false);
  assert.equal(report.summary.blocked_local_tts_count, 0);
  assert.equal(report.summary.requires_generation_count, 1);
  assert.equal(report.jobs[0].status, "requires_audio_timestamp_generation");
  assert.deepEqual(report.jobs[0].next_actions, [
    "generate_narration_audio_with_word_timestamps",
    "rerun_goal_production_cutover_after_audio_materialisation",
  ]);
});

test("audio timestamp workbench blocks stale green local TTS doctor reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-stale-doctor-"));

  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: { jobs: [audioJob()] },
    localTtsDoctorReport: {
      generated_at: "2026-05-23T03:09:27.515Z",
      verdict: "green",
      action: "none",
      reason: "local TTS is ready with the accepted voice loaded",
      before: { ok: true, status: "ok", ready: true },
    },
    generatedAt: "2026-05-23T16:30:00.000Z",
  });

  assert.equal(report.local_tts.ready, false);
  assert.equal(report.local_tts.stale, true);
  assert.equal(report.local_tts.failure_code, "stale_doctor_report");
  assert.equal(report.summary.blocked_local_tts_count, 1);
  assert.equal(report.jobs[0].status, "blocked_local_tts_stale");
});

test("audio timestamp workbench writes JSON and Markdown reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-audio-workbench-write-"));
  const report = await buildGoalAudioTimestampWorkbench({
    workspaceRoot: root,
    workOrder: { jobs: [audioJob()] },
    localTtsDoctorReport: { verdict: "red", failure_code: "server_down" },
    generatedAt: "2026-05-22T05:10:00.000Z",
  });

  const written = await writeGoalAudioTimestampWorkbench(report, {
    outputDir: path.join(root, "out"),
  });

  assert.equal(await fs.pathExists(written.jsonPath), true);
  assert.equal(await fs.pathExists(written.markdownPath), true);
  const saved = await fs.readJson(written.jsonPath);
  assert.equal(saved.mode, "LOCAL_AUDIO_TIMESTAMP_WORKBENCH");
  const markdown = await fs.readFile(written.markdownPath, "utf8");
  assert.match(markdown, /Local Audio Timestamp Workbench/);
  assert.match(markdown, /blocked_local_tts_unreachable/);
});
