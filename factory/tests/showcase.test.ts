import test from "node:test";
import assert from "node:assert/strict";
import { mediaTitle } from "../src/pipeline.ts";
import { pickOfficial, seriesNumber } from "../src/assets/officialTrailer.ts";
import { pictureForWords, splitAtThen, thenWindows } from "../src/render/plan.ts";

const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });

test("an official trailer of another instalment is refused", () => {
  const items = [
    { videoId: "a", title: "Grand Theft Auto VI Launch Trailer", channelId: "r", channelTitle: "Rockstar Games", publishedAt: "2026-10-01T00:00:00Z" },
    { videoId: "b", title: "Grand Theft Auto IV Trailer", channelId: "r", channelTitle: "Rockstar Games", publishedAt: "2008-01-01T00:00:00Z" },
  ];
  const subs = new Map([["r", 20_000_000]]);
  assert.equal(pickOfficial(items, "Grand Theft Auto IV", subs)?.videoId, "b");
  assert.equal(pickOfficial(items, "Grand Theft Auto 2", subs), undefined);
  assert.equal(pickOfficial(items, "Grand Theft Auto: Vice City", subs), undefined);
  assert.equal(seriesNumber("Grand Theft Auto: Vice City"), undefined);
  assert.equal(seriesNumber("The Legend of Zelda: Ocarina of Time – Overview Trailer – Nintendo Switch 2"), undefined);
  assert.equal(seriesNumber("Hades II on PS5"), 2);
});

test("a picture chosen for a clause lands on the shot that says it", () => {
  const images = [
    { kind: "screenshot", aspect: 1.78, forWords: "Link finally jumps," },
    { kind: "screenshot", aspect: 1.78, forWords: "and you can hum into the mic." },
  ];
  const words = "Link finally jumps, and you can hum into the mic.".split(" ").map((t, i) => w(t, i * 0.3));
  assert.equal(pictureForWords(images, words, { start: 0, end: 27 }, [0, 0]), 0);
  assert.equal(pictureForWords(images, words, { start: 27, end: 90 }, [0, 0]), 1);
  assert.equal(pictureForWords(images, words, { start: 27, end: 90 }, [0, 1]), undefined);
});

test("mediaTitle drops a writer's qualifier so picture searches match the exact game", () => {
  assert.equal(
    mediaTitle("The Legend of Zelda: Ocarina of Time (Switch 2 remake)"),
    "The Legend of Zelda: Ocarina of Time",
  );
  assert.equal(mediaTitle("Halo 3"), "Halo 3");
});

test("thenWindows finds the words about the old game, up to the end of the sentence", () => {
  const words = [
    w("first", 1),
    w("came", 1.3),
    w("out", 1.6),
    w("in", 1.9),
    w("nineteen", 2.2),
    w("ninety-eight.", 2.6),
    w("Now", 3.2),
    w("you", 3.5),
  ];
  const [a, ...rest] = thenWindows(words);
  assert.equal(rest.length, 0);
  assert.equal(a!.from, 64); // two frames before the word at 30 fps
  assert.ok(a!.to >= 66 + 36 - 1 && a!.to <= 66 + 90);
});

test("splitAtThen folds a sliver into its neighbour, not into the old game's shot", () => {
  const cuts = [
    { start: 0, end: 60, segment: 0 },
    { start: 60, end: 100, segment: 0 },
  ];
  const out = splitAtThen(cuts, [{ from: 80, to: 100 }]);
  assert.deepEqual(
    out.map((c) => [c.start, c.end, Boolean(c.then)]),
    [
      [0, 80, false],
      [80, 100, true],
    ],
  );
});

test("splitAtThen gives each window its own shot and leaves the rest", () => {
  const cuts = [
    { start: 0, end: 100, segment: 0 },
    { start: 100, end: 200, segment: 1 },
  ];
  const out = splitAtThen(cuts, [{ from: 60, to: 90 }]);
  assert.deepEqual(
    out.map((c) => [c.start, c.end, Boolean(c.then)]),
    [
      [0, 60, false],
      [60, 100, true],
      [100, 200, false],
    ],
  );
});
