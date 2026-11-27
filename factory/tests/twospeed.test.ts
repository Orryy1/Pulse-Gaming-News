// The opening contract's two-speed edit (LONG_OPENING_CONTRACT=fix): the first two minutes of a long plan cut about twice
// as fast as the body, no shot over 6 s there unless a quote is on screen, and the body keeps its own pace.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TWO_SPEED_CLIP,
  TWO_SPEED_STILL,
  openingPace,
  twoSpeedCap,
} from "../src/render/structure.ts";
import { buildLongPlan, type LongPlan } from "../src/render/longplan.ts";
import type { Segment } from "../src/render/timeline.ts";

// The stored plan of "Why San Andreas Never Got a Sequel" (ep_20261107_8561a5da), its first five minutes:
// [start frame, end frame, media type (clip, image, filler)].
const SAN_ANDREAS: Array<[number, number, string]> = [
  [0, 120, "c"],
  [120, 181, "c"],
  [181, 356, "i"],
  [356, 457, "c"],
  [457, 496, "i"],
  [496, 616, "c"],
  [616, 733, "c"],
  [733, 772, "i"],
  [772, 902, "i"],
  [902, 1022, "c"],
  [1022, 1229, "i"],
  [1229, 1297, "c"],
  [1297, 1376, "c"],
  [1376, 1496, "i"],
  [1496, 1620, "c"],
  [1620, 1814, "f"],
  [1814, 1913, "c"],
  [1913, 2003, "c"],
  [2003, 2088, "c"],
  [2088, 2206, "c"],
  [2206, 2245, "c"],
  [2245, 2386, "c"],
  [2386, 2425, "c"],
  [2425, 2454, "i"],
  [2454, 2529, "c"],
  [2529, 2611, "i"],
  [2611, 2697, "c"],
  [2697, 2736, "i"],
  [2736, 2845, "i"],
  [2845, 2965, "c"],
  [2965, 3058, "i"],
  [3058, 3178, "c"],
  [3178, 3220, "c"],
  [3220, 3259, "i"],
  [3259, 3319, "c"],
  [3319, 3365, "c"],
  [3365, 3496, "f"],
  [3496, 3695, "i"],
  [3695, 3818, "f"],
  [3818, 3929, "i"],
  [3929, 4001, "i"],
  [4001, 4101, "i"],
  [4101, 4186, "i"],
  [4186, 4288, "i"],
  [4288, 4368, "f"],
  [4368, 4549, "i"],
  [4549, 4664, "c"],
  [4664, 4703, "i"],
  [4703, 4780, "i"],
  [4780, 4958, "i"],
  [4958, 5047, "c"],
  [5047, 5197, "i"],
  [5197, 5270, "f"],
  [5270, 5446, "i"],
  [5446, 5584, "i"],
  [5584, 5801, "i"],
  [5801, 5903, "i"],
  [5903, 5974, "i"],
  [5974, 6092, "c"],
  [6092, 6223, "i"],
  [6223, 6308, "f"],
  [6308, 6439, "c"],
  [6439, 6560, "i"],
  [6560, 6630, "i"],
  [6630, 6707, "i"],
  [6707, 6907, "c"],
  [6907, 7025, "c"],
  [7025, 7207, "i"],
  [7207, 7298, "c"],
  [7298, 7435, "i"],
  [7435, 7495, "f"],
  [7495, 7615, "c"],
  [7615, 7711, "c"],
  [7711, 7813, "c"],
  [7813, 7900, "c"],
  [7900, 7969, "f"],
  [7969, 8089, "c"],
  [8089, 8129, "i"],
  [8129, 8213, "i"],
  [8213, 8467, "i"],
  [8467, 8636, "c"],
  [8636, 8756, "c"],
  [8756, 8851, "c"],
  [8851, 8921, "c"],
  [8921, 9008, "c"],
];

const stored: LongPlan = {
  version: 1,
  fps: 30,
  totalFrames: 9008 + 180,
  tailFrames: 180,
  shots: SAN_ANDREAS.map(([start, end, t], k) => ({
    start,
    end,
    segment: 0,
    media: {
      type: t === "c" ? "clip" : t === "i" ? "image" : "filler",
      index: k,
    },
    move: "pushIn" as const,
  })),
};

test("two-speed cap: tighter inside the first two minutes, the base cap after", () => {
  const inf = {
    still: Number.POSITIVE_INFINITY,
    clip: Number.POSITIVE_INFINITY,
  };
  assert.deepEqual(twoSpeedCap(0, 30, inf), {
    still: TWO_SPEED_STILL,
    clip: TWO_SPEED_CLIP,
  });
  assert.deepEqual(twoSpeedCap(119 * 30, 30, { still: 60, clip: 60 }), {
    still: 60,
    clip: 60,
  });
  assert.deepEqual(twoSpeedCap(120 * 30, 30, inf), inf);
});

test("the stored San Andreas plan cuts its opening at about the body's pace, with a 6.9 s still and a 6.5 s card in it", () => {
  const pace = openingPace(stored);
  assert.ok(pace.ratio < 1.3, `ratio ${pace.ratio}`);
  assert.ok(
    pace.openingPerMinute > 15 && pace.openingPerMinute < 20,
    `opening ${pace.openingPerMinute}`,
  );
  assert.equal(pace.longestOpeningSeconds, 6.9);
  // The 6.9 s still and a 6.5 s filler card run past 6 s.
  assert.equal(pace.overLongest, 2);
  // A quote on screen may hold.
  assert.equal(openingPace(stored, (s) => s.start === 1022).overLongest, 1);
});

const seg = (
  kind: Segment["kind"],
  text: string,
  start: number,
  end: number,
  visual?: Segment["visual"],
): Segment => ({
  kind,
  text,
  start,
  end,
  visual,
});
const wordsOf = (segments: Segment[]) =>
  segments.flatMap((s) => {
    const ws = s.text.split(/\s+/).filter(Boolean);
    const step = (s.end - s.start - 1) / ws.length;
    return ws.map((text, i) => ({
      text,
      start: s.start + i * step,
      end: s.start + (i + 0.8) * step,
    }));
  });

test("the planner with two speeds: the first two minutes about twice the body's cut rate, the body as it was", () => {
  // Ten minutes of one chapter on stills (no shot list), the same input with and without the setting.
  const segments: Segment[] = [
    seg("hook", "Open on a moment.", 0, 40),
    seg("beat", "One long chapter of narration.", 40, 600, {
      kind: "chapter",
      primary: "One",
      secondary: "",
      items: ["2004"],
      value_a: 1,
    }),
  ];
  const images = Array.from({ length: 40 }, (_, k) => ({
    kind: "screenshot",
    aspect: 1.78,
    beatIndex: k < 4 ? undefined : 0,
  }));
  const base = {
    segments,
    words: wordsOf(segments),
    durationSeconds: 606,
    images,
    clips: [],
    variant: 0,
    rhythm: true,
  };
  const plain = buildLongPlan(base);
  const fast = buildLongPlan({ ...base, twoSpeed: true });
  const p = openingPace(plain);
  const f = openingPace(fast);
  assert.ok(
    f.openingPerMinute > p.openingPerMinute,
    `${f.openingPerMinute} vs ${p.openingPerMinute}`,
  );
  assert.ok(f.ratio >= 1.8, `ratio ${f.ratio}`);
  assert.ok(f.longestOpeningSeconds <= 6, `longest ${f.longestOpeningSeconds}`);
  // After the opening (past the rhythm's own three minutes too) the shots run as they did.
  const after = (x: LongPlan) =>
    x.shots.filter((s) => s.start >= 200 * 30).map((s) => s.end - s.start);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(
    Math.abs(mean(after(fast)) - mean(after(plain))) < 15,
    `${mean(after(fast))} vs ${mean(after(plain))}`,
  );
  // Off: nothing changes.
  assert.deepEqual(buildLongPlan({ ...base, twoSpeed: false }), plain);
});
