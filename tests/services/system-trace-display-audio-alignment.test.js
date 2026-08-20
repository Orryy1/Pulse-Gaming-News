"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  alignFrameWithBoundedRepair,
  parseNarrationFrames,
  reconcileAlignedAudioMetadata,
} = require("../../lib/services/system-trace-display-audio-alignment");

test("parses only the indented narration under numbered SCRIPT frame headings", () => {
  const frames = parseNarrationFrames(`
## Opening (Frame 1)

**purpose:** hook

    One exact spoken line.

## Proof (Frame 2)

    A second exact line.
`);
  assert.deepEqual(frames, [
    { frame: 1, text: "One exact spoken line." },
    { frame: 2, text: "A second exact line." },
  ]);
});

test("binds exact script words to local Whisper timings and preserves the BGM", () => {
  const audioMeta = {
    bgm: { path: "assets/bgm/bed.wav", volume: 1 },
    bgm_pending: false,
    voices: [
      { frame: 1, path: "assets/voice/01.wav", duration_s: 1.2, words: [] },
    ],
    sfx: [],
  };
  const result = reconcileAlignedAudioMetadata({
    storyId: "display-test",
    audioMeta,
    scriptFrames: [{ frame: 1, text: "Exact words here." }],
    alignments: new Map([
      [1, {
        ok: true,
        source: "local_whisper_word_alignment",
        model: "faster-whisper:base.en",
        backend: "faster-whisper",
        words: [
          { word: "Exact", start: 0.1, end: 0.3 },
          { word: "words", start: 0.32, end: 0.6 },
          { word: "here", start: 0.62, end: 0.9 },
        ],
      }],
    ]),
  });

  assert.deepEqual(result.audioMeta.bgm, audioMeta.bgm);
  assert.deepEqual(result.audioMeta.voices[0].words.map((word) => word.text), [
    "Exact",
    "words",
    "here.",
  ]);
  assert.equal(result.evidence.verdict, "GREEN");
  assert.equal(result.evidence.frames[0].word_count, 3);
  assert.equal(result.evidence.frames[0].source, "local_whisper_word_alignment");
});

test("fails closed when a frame lacks strict local Whisper coverage", () => {
  assert.throws(
    () => reconcileAlignedAudioMetadata({
      storyId: "display-test",
      audioMeta: {
        bgm: null,
        voices: [{ frame: 1, path: "assets/voice/01.wav", duration_s: 1, words: [] }],
      },
      scriptFrames: [{ frame: 1, text: "Exact words here." }],
      alignments: new Map([[1, { ok: false, error: "asr_failed" }]]),
    }),
    /strict_local_whisper_alignment_required:display-test:1/,
  );
});

test("reconciles a split hyphenated term and one adjacent Whisper duplicate", () => {
  const text = "V-Sync can make motion feel slightly less immediate.";
  const tokens = ["V", "-Sync", "can", "make", "motion", "feel", "slightly", "slightly", "less", "immediate."];
  const result = reconcileAlignedAudioMetadata({
    storyId: "vsync-test",
    audioMeta: {
      bgm: null,
      voices: [{ frame: 1, path: "assets/voice/01.wav", duration_s: 2, words: [] }],
    },
    scriptFrames: [{ frame: 1, text }],
    alignments: new Map([[1, {
      ok: true,
      source: "local_whisper_word_alignment",
      words: tokens.map((word, index) => ({
        word,
        start: index * 0.15,
        end: index * 0.15 + 0.12,
      })),
    }]]),
  });
  assert.deepEqual(
    result.audioMeta.voices[0].words.map((word) => word.text),
    ["V-Sync", "can", "make", "motion", "feel", "slightly", "less", "immediate."],
  );
});

test("drops trailing Whisper hallucination tokens after exact script coverage", () => {
  const expected = "A fixed-refresh screen scans from top to bottom.";
  const tokens = [
    "A", "fixed", "-refresh", "screen", "scans", "from", "top", "to", "bottom.",
    "Mhm.", "Mhm.", "Yeah.",
  ];
  const result = reconcileAlignedAudioMetadata({
    storyId: "refresh-test",
    audioMeta: {
      bgm: null,
      voices: [{ frame: 1, path: "assets/voice/01.wav", duration_s: 2, words: [] }],
    },
    scriptFrames: [{ frame: 1, text: expected }],
    alignments: new Map([[1, {
      ok: true,
      source: "local_whisper_word_alignment",
      words: tokens.map((word, index) => ({
        word,
        start: index * 0.15,
        end: index * 0.15 + 0.12,
      })),
    }]]),
  });
  assert.equal(result.audioMeta.voices[0].words.at(-1).text, "bottom.");
  assert.ok(result.audioMeta.voices[0].words.at(-1).end < 1.35);
});

test("uses one small.en repair when base.en misses the spoken tail", async () => {
  const calls = [];
  const aligner = async ({ model }) => {
    calls.push(model);
    const words = model.endsWith("base.en")
      ? ["Fine"]
      : ["Fine", "detail", "stays", "clear."];
    return {
      ok: true,
      source: "local_whisper_word_alignment",
      model,
      words: words.map((word, index) => ({
        word,
        start: index * 0.2,
        end: index * 0.2 + 0.15,
      })),
    };
  };
  const result = await alignFrameWithBoundedRepair({
    aligner,
    audioPath: "voice.wav",
    scriptText: "Fine detail stays clear.",
  });
  assert.deepEqual(calls, ["faster-whisper:base.en", "faster-whisper:small.en"]);
  assert.equal(result.model, "faster-whisper:small.en");
  assert.equal(result.repair_attempted, true);
});
