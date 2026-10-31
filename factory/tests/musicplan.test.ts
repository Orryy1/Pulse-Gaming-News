import { test } from "node:test";
import assert from "node:assert/strict";
import { dropLevel, dropOuts, moodOf, musicSections } from "../src/render/musicplan.ts";

test("a chapter's mood comes from its era and its words; the hook keeps the house beds", () => {
  const base = { first: false, last: false, documentary: true };
  assert.equal(moodOf({ ...base, first: true, text: "delays crunch crisis trouble", year: 1997 }), undefined);
  assert.equal(moodOf({ ...base, text: "a quiet start", year: 2001 }), "retro");
  assert.equal(moodOf({ ...base, text: "The delay, then crunch, then a leak and a lawsuit.", year: 2013 }), "tense");
  assert.equal(moodOf({ ...base, text: "It sold a billion in days, a record, the biggest launch ever.", year: 2013 }), "triumph");
  assert.equal(moodOf({ ...base, text: "An ordinary chapter.", year: 2013 }), undefined);
  assert.equal(moodOf({ ...base, last: true, text: "What it meant.", year: 2013 }), "reflective");
  assert.equal(moodOf({ ...base, last: true, documentary: false, text: "Number one.", year: 2013 }), "triumph");
});

test("music sections change at a chapter whose mood differs, and the house beds still rotate", () => {
  const fps = 30;
  const chapters = [
    { frame: 60 * fps, text: "x", year: 1999 }, // retro
    { frame: 70 * fps, text: "x", year: 2002 }, // still retro: no change
    { frame: 200 * fps, text: "An ordinary chapter.", year: 2013 }, // house
    { frame: 380 * fps, text: "Another ordinary one.", year: 2014 }, // house, 180 s on: rotate
    { frame: 500 * fps, text: "The end.", year: 2015 }, // last: reflective
  ];
  const s = musicSections(chapters, 600 * fps, true, 45 * fps, 150 * fps, () => true);
  assert.deepEqual(
    s.map((x) => [x.from / fps, x.mood ?? "house"]),
    [[0, "house"], [60, "retro"], [200, "house"], [380, "house"], [500, "reflective"]],
  );
  const none = musicSections(chapters, 600 * fps, true, 45 * fps, 150 * fps, () => false);
  assert.ok(none.every((x) => !x.mood), "a mood with no bed keeps the house beds");
});

test("the music drops out once a long section, on a key word, and comes back", () => {
  const fps = 30;
  const drops = dropOuts([{ from: 0, to: 120 * fps }, { from: 120 * fps, to: 150 * fps }], [10 * fps, 70 * fps, 80 * fps, 130 * fps], fps, () => false);
  assert.deepEqual(drops, [70 * fps], "nearest 60% of the long section; the short one has none");
  assert.deepEqual(dropOuts([{ from: 0, to: 120 * fps }], [70 * fps], fps, () => true), [], "avoid wins");
  const w = 70 * fps;
  assert.equal(dropLevel(w - 60, [w]), 1);
  assert.equal(dropLevel(w, [w]), 0);
  assert.ok(dropLevel(w + 40, [w]) > 0 && dropLevel(w + 40, [w]) < 1);
  assert.equal(dropLevel(w + 70, [w]), 1);
});
