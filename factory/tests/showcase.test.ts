import test from "node:test";
import assert from "node:assert/strict";
import { mediaTitle } from "../src/pipeline.ts";
import { splitAtThen, thenWindows } from "../src/render/plan.ts";

const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });

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
