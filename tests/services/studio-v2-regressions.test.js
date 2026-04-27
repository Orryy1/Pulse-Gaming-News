"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildQualityReportV2,
  gradeDurationIntegrity,
} = require("../../lib/studio/v2/quality-gate-v2");
const { buildSfxCueList } = require("../../lib/studio/v2/sound-layer-v2");

function tempAss(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-"));
  const file = path.join(dir, "captions.ass");
  fs.writeFileSync(file, contents);
  return file;
}

function dialogue(start, end, text = "word") {
  return `Dialogue: 0,${start},${end},Caption,,0,0,0,,${text}`;
}

test("v2 duration integrity fails when rendered MP4 is shorter than voice/subtitles", () => {
  const assPath = tempAss(
    [
      dialogue("0:00:00.00", "0:00:01.00"),
      dialogue("0:00:54.52", "0:00:55.36", "survival."),
    ].join("\n"),
  );
  const result = gradeDurationIntegrity({
    renderedDurationS: 51.2,
    audioDurationS: 55.431837,
    assPath,
  });
  assert.equal(result.grade, "red");
  assert.deepEqual(result.failures, [
    "rendered MP4 is shorter than narration",
    "subtitle cues run past rendered MP4",
  ]);
});

test("v2 duration integrity passes when render covers voice and subtitle timeline", () => {
  const assPath = tempAss(dialogue("0:00:54.52", "0:00:55.36", "survival."));
  const result = gradeDurationIntegrity({
    renderedDurationS: 55.44,
    audioDurationS: 55.431837,
    assPath,
  });
  assert.equal(result.grade, "green");
});

test("v2 quality report rejects truncated exports even when creative scores pass", () => {
  const assPath = tempAss(dialogue("0:00:54.52", "0:00:55.36", "survival."));
  const words = Array.from({ length: 20 }, (_, i) => ({
    word: `w${i}`,
    start: i * 2.5,
    end: i * 2.5 + 0.1,
  }));
  const scenes = Array.from({ length: 16 }, (_, i) => ({
    type: i % 4 === 0 ? "clip" : i % 4 === 1 ? "clip.frame" : "punch",
    source: `source-${i}.mp4`,
    duration: 3.4,
  }));
  const transitions = Array.from({ length: 15 }, (_, i) => ({
    type: "cut",
    offset: words[i]?.end || i * 3.4,
  }));
  const report = buildQualityReportV2({
    storyId: "x",
    outputPath: "test/output/x.mp4",
    pkg: {
      hook: {
        chosen: {
          text: "Metro 2039 is real and the reveal is grim today",
        },
      },
      script: {
        tightened: Array.from({ length: 140 }, () => "word").join(" "),
      },
    },
    scenes,
    transitions,
    audioMeta: { provider: "elevenlabs", voiceId: "TX3LPaxmHKxFdv7VOQHJ" },
    audioDurationS: 55.431837,
    assPath,
    soundLayerPayload: {
      cueCount: 1,
      filterLines: ["sidechaincompress=threshold=0.05:ratio=4"],
    },
    realignedWords: words,
    renderedDurationS: 51.2,
    branch: "test",
  });
  assert.equal(report.auto.durationIntegrity.grade, "red");
  assert.equal(report.verdict.lane, "reject");
  assert.ok(
    report.verdict.reasons.includes(
      "render duration does not cover narration/subtitles",
    ),
  );
});

test("v2 sound layer defaults to minimal SFX instead of every-cut repetition", () => {
  const oldMode = process.env.STUDIO_V2_SFX_MODE;
  delete process.env.STUDIO_V2_SFX_MODE;
  try {
    const cues = buildSfxCueList({
      scenes: [
        { type: "opener", duration: 4 },
        { type: "punch", duration: 1.6 },
        { type: "card.source", duration: 4 },
      ],
      transitions: [
        { type: "cut", offset: 4 },
        { type: "cut", offset: 5.6 },
      ],
      openerStingS: 0.6,
    });
    assert.deepEqual(cues, [
      { atS: 0, kind: "opener-sting", durationS: 0.6 },
    ]);
  } finally {
    if (oldMode === undefined) delete process.env.STUDIO_V2_SFX_MODE;
    else process.env.STUDIO_V2_SFX_MODE = oldMode;
  }
});
