// 14 Nov 2026 QA yield fixes: the final check's ad-safety faults swap the shot, the footage screen asks the same
// question before a moment is chosen and remembers its verdicts per source and time.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AD_FAULT,
  offendingMedia,
  problemFrames,
  rememberUnsafe,
} from "../src/qa/retry.ts";
import {
  banMoment,
  cachedVerdicts,
  frameKey,
  gridTimes,
  sourceKey,
  storeVerdicts,
} from "../src/assets/screencache.ts";
import {
  adUnsafe,
  cacheableVerdict,
  frameFlagsFromAnswer,
  rejectReason,
  screenFrames,
  screenPrompt,
} from "../src/assets/localvision.ts";
import { stopBeforeUnsafe } from "../src/assets/clipscore.ts";
import { adSafeProblem } from "../src/openingstep.ts";

const tmpCache = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qayield-"));
  process.env.SCREEN_CACHE_FILE = path.join(dir, "screen_cache.json");
  return process.env.SCREEN_CACHE_FILE;
};

const plan = {
  fps: 30,
  shots: [
    { start: 0, end: 30, media: { type: "clip", index: 0 } },
    { start: 30, end: 90, media: { type: "clip", index: 1 } },
    { start: 90, end: 150, media: { type: "clip", index: 2 } },
    { start: 150, end: 240, media: { type: "image", index: 0 } },
  ],
};
const times = [0.8, 2.0, 3.5, 6.0];

// The real failure texts from the Mac's log, 12-14 Nov 2026.
const REAL = [
  "Frame 3 shows a bent-over character with exposed purple underwear, creating suggestive imagery.",
  "Frame 2 shows a background woman in a revealing, cleavage-emphasizing top, violating the restriction on suggestive imagery.",
  "Frame 2 shows sexualised nightclub imagery, with a woman in revealing clothing prominently framed from behind.",
  "Frame 3: the crop is dominated by an exposed chest and torso, violating the specified advertiser-friendly framing rule.",
  "Frame 3 uses a chest-dominated crop with prominent cleavage, failing the stated advertiser-friendly requirement.",
  "Frame 4 includes a woman in a revealing bra-style top and suggestive pose beside the car.",
  "Frame 1 contains graphic bloody creature imagery with exposed flesh, making the opening advertiser-unfriendly.",
];

test("every real ad-safety failure text is read as an ad fault", () => {
  for (const p of REAL) assert.ok(AD_FAULT.test(p), p);
  assert.ok(!AD_FAULT.test("Frame 2 shows $395.99 instead of $399.99."));
  assert.ok(
    !AD_FAULT.test("Frames 5 and 6: the white PULSE wordmark is unreadable."),
  );
});

test("an ad-safety fault swaps its shot for the retry; off, it drops nothing as before", () => {
  const off = offendingMedia(
    [
      "Frame 3 shows a bent-over character with exposed purple underwear, creating suggestive imagery.",
    ],
    times,
    plan,
  );
  assert.deepEqual([...off.clips], [2]);
  assert.deepEqual([...off.unsafeClips!], [2]);
  const before = offendingMedia(
    [
      "Frame 3 shows a bent-over character with exposed purple underwear, creating suggestive imagery.",
    ],
    times,
    plan,
    { adSwap: false },
  );
  assert.equal(before.clips.size, 0);
  // A text fault still drops its clip but is not remembered as unsafe.
  const text = offendingMedia(
    ["Frame 1: large trailer text behind the headline."],
    times,
    plan,
  );
  assert.deepEqual([...text.clips], [0]);
  assert.equal(text.unsafeClips!.size, 0);
});

test("frame ranges and the last frame are read", () => {
  assert.deepEqual(
    problemFrames("Frames 3–4: sexualised characters", 6),
    [3, 4],
  );
  assert.deepEqual(
    problemFrames("Frames 4-6, including the last frame", 6),
    [4, 5, 6],
  );
  assert.deepEqual(
    problemFrames("Last frame (6): the source line washes out", 6),
    [6],
  );
  assert.deepEqual(problemFrames("Frames 1, 3 and 5", 6).sort(), [1, 3, 5]);
  const off = offendingMedia(
    ["Frames 2–3 show sexualised women in revealing outfits."],
    times,
    plan,
  );
  assert.deepEqual([...off.clips].sort(), [1, 2]);
});

test("the screen cache keys by video id and a tenth of a second; the final check's verdict outranks the screen", () => {
  tmpCache();
  assert.equal(
    sourceKey("https://www.youtube.com/watch?v=VQRLujxTm3c"),
    "yt:VQRLujxTm3c",
  );
  assert.equal(
    sourceKey("https://youtu.be/VQRLujxTm3c", "s1"),
    "yt:VQRLujxTm3c#s1",
  );
  assert.equal(sourceKey(undefined), undefined);
  const k = frameKey("yt:abc", 13.4999);
  assert.match(k, /\|yt:abc\|13\.5$/);
  const clean = {
    hud: false,
    text: false,
    webcam: false,
    gore: false,
    letterbox: false,
    dark: false,
    blurry: false,
    suggestive: false,
  };
  storeVerdicts([{ key: k, flags: clean }]);
  assert.equal(cachedVerdicts([k])[0]?.suggestive, false);
  assert.equal(
    banMoment({
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      start: 12,
      seconds: 3,
      why: "bent over",
    }),
    gridTimes(12, 3).length,
  );
  const qaKey = frameKey("yt:abcdefghijk", 13.5);
  assert.equal(cachedVerdicts([qaKey])[0]?.by, "qa");
  // A later clean screen never overwrites what the final check faulted.
  storeVerdicts([{ key: qaKey, flags: clean }]);
  assert.equal(cachedVerdicts([qaKey])[0]?.suggestive, true);
  assert.deepEqual(gridTimes(12, 3), [10.5, 12, 13.5, 15]);
});

test("rememberUnsafe writes the faulted clip's stretch of its source", () => {
  tmpCache();
  const off = offendingMedia(
    ["Frame 2 shows sexualised nightclub imagery."],
    times,
    plan,
  );
  const clips = [
    {
      sourceUrl: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
      startSeconds: 0,
      durationSeconds: 2,
    },
    {
      sourceUrl: "https://www.youtube.com/watch?v=BBBBBBBBBBB",
      startSeconds: 30,
      durationSeconds: 2.5,
    },
  ];
  assert.ok(rememberUnsafe(clips, off, "nightclub") > 0);
  assert.equal(cachedVerdicts([frameKey("yt:AAAAAAAAAAA", 0)])[0], undefined);
});

test("the local screen asks the final check's suggestive question and treats a yes as never usable", () => {
  assert.match(screenPrompt(), /suggestive: true when any person or character/);
  const f = frameFlagsFromAnswer({
    message: {
      content: JSON.stringify({
        text: false,
        hud_only: false,
        webcam: false,
        gore: false,
        letterbox: false,
        dark: false,
        blurry: false,
        suggestive: true,
      }),
    },
  })!;
  assert.equal(f.suggestive, true);
  assert.equal(rejectReason(f), "suggestive");
  assert.ok(adUnsafe(f));
  assert.ok(cacheableVerdict(f));
  // An old answer without the field still reads, but is not remembered under the new screen.
  const old = frameFlagsFromAnswer({
    message: {
      content: JSON.stringify({
        text: false,
        hud_only: false,
        webcam: false,
        gore: false,
        letterbox: false,
        dark: false,
        blurry: false,
      }),
    },
  })!;
  assert.equal(old.suggestive, undefined);
  assert.equal(cacheableVerdict(old), false);
  process.env.FOOTAGE_AD_SCREEN = "off";
  assert.doesNotMatch(screenPrompt(), /suggestive/);
  delete process.env.FOOTAGE_AD_SCREEN;
  assert.equal(
    adSafeProblem({
      gameplay: true,
      gore: false,
      nudity: true,
      weapon: false,
      shocking: false,
      strength: 5,
    }),
    "nudity or suggestive content",
  );
});

test("a cached verdict answers without the model, so a trailer is screened once (even with the relay down)", async () => {
  tmpCache();
  const k = frameKey("yt:CCCCCCCCCCC", 4.5);
  storeVerdicts([
    {
      key: k,
      flags: {
        hud: false,
        text: false,
        webcam: false,
        gore: false,
        letterbox: false,
        dark: false,
        blurry: false,
        suggestive: true,
      },
    },
  ]);
  const out = await screenFrames(["/nope/a.jpg", "/nope/b.jpg"], 2, [
    k,
    undefined,
  ]);
  assert.equal(out[0]?.suggestive, true);
  assert.equal(out[1], undefined);
});

test("a clip stops half a step before the first unsafe keyframe of its source", () => {
  const cands = [
    { index: 1, movie: 0, time: 10 },
    { index: 2, movie: 0, time: 11.5 },
    { index: 3, movie: 0, time: 13 },
    { index: 4, movie: 1, time: 11.5 },
  ];
  assert.equal(
    stopBeforeUnsafe({ movie: 0, time: 10 }, 4.8, cands, new Set([3])),
    2.25,
  );
  assert.equal(
    stopBeforeUnsafe({ movie: 0, time: 10 }, 4.8, cands, new Set([4])),
    4.8,
    "another source does not stop it",
  );
  assert.equal(
    stopBeforeUnsafe({ movie: 0, time: 10 }, 4.8, cands, new Set()),
    4.8,
  );
});

test("the technical check says where the black is, and the retry swaps the clip on screen there", async () => {
  const { parseBlackSpans } = await import("../src/qa/media.ts");
  assert.deepEqual(
    parseBlackSpans("[blackdetect @ 0x1] black_start:2.1 black_end:4.6 black_duration:2.5\n"),
    [{ start: 2.1, end: 4.6 }],
  );
  const off = offendingMedia(["2.5s of black frames (at 2.1-4.6s)."], times, plan);
  assert.deepEqual([...off.clips].sort(), [1, 2]);
  assert.equal(off.allClips, false);
  assert.equal(offendingMedia(["2.5s of black frames (at 2.1-4.6s)."], times, plan, { adSwap: false }).clips.size, 0);
});
