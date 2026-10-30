import { test } from "node:test";
import assert from "node:assert/strict";
import {
  breathsIn,
  wordsPerMinute,
  voiceProblems,
} from "../src/voice/breathcheck.ts";

/** An envelope at 20 ms a sample: speech at -16 dB, breaths at the given level, silence at -70. */
function take(breathDb: number, breaths: number): number[] {
  const env: number[] = [];
  const speech = (n: number) => {
    for (let i = 0; i < n; i++) env.push(-16 + (i % 3) - 1);
  };
  const quiet = (n: number, level: number) => {
    for (let i = 0; i < n; i++) env.push(level);
  };
  for (let k = 0; k < breaths; k++) {
    speech(60); // 1.2 s of words
    quiet(15, breathDb); // 0.3 s between them
  }
  speech(60);
  quiet(100, -70); // 2 s of silence at the end
  return env;
}

test("a take with audible breaths between its phrases is counted; a clean one is not", () => {
  const breathy = breathsIn(take(-28, 8)); // 12 dB under speech
  assert.equal(breathy.breaths, 8);
  assert.equal(breathy.loudBreaths, 8);
  assert.ok(breathy.loudPerMinute > 1.5);
  assert.ok(voiceProblems(breathy, 150).length === 1);
  const clean = breathsIn(take(-70, 8)); // silence between the phrases
  assert.equal(clean.breaths, 0);
  assert.deepEqual(voiceProblems(clean, 150), []);
  // A faint breath (28 dB under) is a breath but not an audible one.
  const faint = breathsIn(take(-44, 8));
  assert.equal(faint.breaths, 8);
  assert.equal(faint.loudBreaths, 0);
});

test("the end-of-file silence and long gaps are not breaths", () => {
  const env = take(-28, 0);
  assert.equal(breathsIn(env).breaths, 0);
  const longGap = [...take(-70, 0), ...Array(60).fill(-28), ...take(-70, 0)]; // 1.2 s in the band
  assert.equal(breathsIn(longGap).breaths, 0);
});

test("words a minute counts speaking time only", () => {
  const words = Array.from({ length: 150 }, (_, i) => ({
    start: i * 0.4,
    end: i * 0.4 + 0.3,
  }));
  assert.equal(wordsPerMinute(words), 150);
  // A long pause in the middle does not slow the figure.
  const paused = words.map((w, i) =>
    i >= 75 ? { start: w.start + 5, end: w.end + 5 } : w,
  );
  assert.ok(Math.abs(wordsPerMinute(paused) - 150) <= 2);
  assert.ok(voiceProblems(breathsIn(take(-70, 2)), 196).length === 1);
});

import { visionAnswer } from "../src/assets/localvision.ts";

test("a vision answer is read from the reply, or from the end of the model's reasoning", () => {
  assert.deepEqual(visionAnswer({ message: { content: '{"text": true}' } }), {
    text: true,
  });
  // Ollama 0.40 with qwen3-vl: the reasoning comes first and the reply may be empty or cut short.
  assert.deepEqual(
    visionAnswer({
      message: {
        content: "",
        thinking:
          '<think>\nSo, is there text? {maybe}\n</think>\n{"text": false, "dark": true}',
      },
    }),
    { text: false, dark: true },
  );
  assert.deepEqual(
    visionAnswer({
      message: { content: '{\n\n  "', thinking: "<think>\nSo, let's" },
    }),
    {},
  );
  assert.deepEqual(visionAnswer({}), {});
});

import { webPath } from "../src/render/render.ts";

test("a Windows file name becomes a URL path the renderer's CSS can load", () => {
  assert.equal(
    webPath(["entry_2", "assets", "hero_0.jpg"].join("\\")),
    "entry_2/assets/hero_0.jpg",
  );
  assert.equal(webPath("voice.mp3"), "voice.mp3");
});

import { renderStalled, STALL_MINUTES } from "../src/render/render.ts";

test("a render counts as frozen only after its quiet spell runs out", () => {
  const min = 60_000;
  assert.equal(renderStalled(9 * min, 0, true), false);
  assert.equal(renderStalled((STALL_MINUTES.between + 1) * min, 0, true), true);
  // Before the first frame the browser is still starting, so it gets longer.
  assert.equal(renderStalled((STALL_MINUTES.between + 1) * min, 0, false), false);
  assert.equal(renderStalled((STALL_MINUTES.first + 1) * min, 0, false), true);
});

import { uncoveredTargets } from "../src/assets/stillscore.ts";

test("a second look asks about uncovered sentences, those without a graphic first", () => {
  const moments = [
    { show: "a", graphic: { kind: "none" } },
    { show: "b", graphic: { kind: "stat" } },
    { show: "c" },
    { show: "d", graphic: { kind: "none" } },
  ];
  const got = uncoveredTargets(moments, ["s0", "s1", "s2", "s3"], new Set([3]));
  assert.deepEqual(got.map((t) => t.key), ["m0", "m2", "m1"]);
  assert.equal(got[0]!.sentence, "s0");
});
