"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  alignHyperframesAudioMeta,
  extractFrameVoiceovers,
} = require("../../tools/hyperframes-align-audio-meta");

test("extractFrameVoiceovers binds quoted voiceover text to frame numbers", () => {
  const storyboard = [
    "## Frame 1 — Hook",
    '- voiceover: "First line."',
    "## Frame 2 — Proof",
    '- voiceover: "Second line."',
  ].join("\n");

  assert.deepEqual(extractFrameVoiceovers(storyboard), {
    1: "First line.",
    2: "Second line.",
  });
});

test("alignHyperframesAudioMeta writes word timing only after every voice succeeds", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-align-"));
  await fs.mkdir(path.join(root, "assets", "voice"), { recursive: true });
  await fs.writeFile(path.join(root, "assets", "voice", "01.wav"), "audio");
  await fs.writeFile(path.join(root, "assets", "voice", "02.wav"), "audio");
  await fs.writeFile(
    path.join(root, "STORYBOARD.md"),
    [
      "## Frame 1 — Hook",
      '- voiceover: "First line."',
      "## Frame 2 — Proof",
      '- voiceover: "Second line."',
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "audio_meta.json"),
    JSON.stringify({
      voices: [
        { frame: 1, path: "assets/voice/01.wav", duration_s: 1, words: [] },
        { frame: 2, path: "assets/voice/02.wav", duration_s: 1, words: [] },
      ],
    }),
  );

  const calls = [];
  const report = await alignHyperframesAudioMeta({
    projectRoot: root,
    model: "faster-whisper:small.en",
    aligner: async ({ audioPath, scriptText, model }) => {
      calls.push({ audioPath, scriptText, model });
      return {
        ok: true,
        model,
        transcript: scriptText,
        words: [
          { word: scriptText.split(" ")[0], start: 0, end: 0.4 },
          { word: scriptText.split(" ")[1], start: 0.4, end: 0.9 },
        ],
      };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.aligned_voice_count, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].scriptText, "First line.");
  const written = JSON.parse(await fs.readFile(path.join(root, "audio_meta.json"), "utf8"));
  assert.equal(written.voices[0].words.length, 2);
  assert.equal(written.voices[0].words[0].text, "First");
  assert.equal(written.voices[1].alignment.model, "faster-whisper:small.en");
});

test("alignHyperframesAudioMeta leaves audio_meta unchanged on a failed frame", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hf-align-fail-"));
  await fs.mkdir(path.join(root, "assets", "voice"), { recursive: true });
  await fs.writeFile(path.join(root, "assets", "voice", "01.wav"), "audio");
  await fs.writeFile(path.join(root, "STORYBOARD.md"), '## Frame 1 — Hook\n- voiceover: "First line."\n');
  const original = JSON.stringify({
    voices: [{ frame: 1, path: "assets/voice/01.wav", duration_s: 1, words: [] }],
  });
  await fs.writeFile(path.join(root, "audio_meta.json"), original);

  await assert.rejects(
    alignHyperframesAudioMeta({
      projectRoot: root,
      aligner: async () => ({ ok: false, error: "asr_failed" }),
    }),
    /frame_1_alignment_failed:asr_failed/,
  );
  assert.equal(await fs.readFile(path.join(root, "audio_meta.json"), "utf8"), original);
});
