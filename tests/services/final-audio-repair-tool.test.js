"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  needsAudioRepair,
  renderMarkdown,
} = require("../../tools/final-audio-repair");

test("final audio repair does not label missing files as loudness-repairable", () => {
  assert.equal(
    needsAudioRepair({
      ok: false,
      code: "file_missing",
      integratedLufs: null,
      truePeakDb: null,
      loudnessRange: null,
    }),
    false,
  );
});

test("final audio repair markdown keeps missing peaks as unknown instead of zero", () => {
  const markdown = renderMarkdown({
    generatedAt: "2026-05-31T03:20:00.000Z",
    mode: "dry-run",
    rows: [
      {
        storyId: "story-1",
        action: "dry_run_only",
        audioBefore: { truePeakDb: null },
        audioAfter: null,
        finalBefore: { truePeakDb: null },
        finalAfter: null,
        timestampSidecarUpdated: null,
      },
    ],
  });

  assert.match(markdown, /audioPeak=unknown -> n\/a/);
  assert.match(markdown, /finalPeak=unknown -> n\/a/);
  assert.doesNotMatch(markdown, /audioPeak=0/);
  assert.doesNotMatch(markdown, /finalPeak=0/);
});
