import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignFromBin,
  coverageShare,
  coveredMoments,
  photoMatches,
  titleWords,
} from "../src/assets/fill.ts";

test("a Commons photo counts only when its title names what was searched", () => {
  assert.equal(photoMatches("File:Sam Houser 2011.jpg", { person: "Sam Houser", words: [] }), true);
  assert.equal(photoMatches("File:Edinburgh street.jpg", { person: "Sam Houser", words: [] }), false);
  const words = titleWords("PlayStation 2 console on a desk");
  assert.deepEqual(words, ["playstation", "console", "desk"]);
  assert.equal(photoMatches("File:PS2 PlayStation-2 slim.png", { words }), true);
  assert.equal(photoMatches("File:Random office.jpg", { words }), false);
});

test("a sentence is covered by its own picture or clip, or a graphic", () => {
  const moments = [{ show: "a" }, { show: "b", graphic: { kind: "stat" } }, { show: "c" }, { show: "d", graphic: { kind: "none" } }];
  const images = [{ beatIndex: 0, moment: 0 }, { beatIndex: 1, moment: 2 }];
  const clips = [{ beatIndex: 0, moment: 2 }];
  assert.deepEqual([...coveredMoments(0, moments, images, clips)].sort(), [0, 1, 2]);
  assert.equal(coverageShare([{ entry: 0, game: "", moments, sentences: [] }], images, clips), 0.75);
});

test("the bin pass gives each open sentence one unused, fitting item and leaves 'none' bare", async () => {
  const llm = {
    structured: async () => ({
      picks: [
        { sentence: 1, item: "c0", fit: "fits it" },
        { sentence: 2, item: "c0", fit: "shows it" }, // the same clip twice: refused
        { sentence: 3, item: "i0", fit: "none" },
        { sentence: 9, item: "i0", fit: "shows it" }, // a sentence not asked about: refused
      ],
    }),
  } as never;
  const images = [{ file: "a.jpg", kind: "screenshot", beatIndex: 0, label: "Tommy on Ocean Drive" } as { file: string; kind: string; beatIndex: number; label: string; moment?: number }];
  const clips = [{ beatIndex: 0, label: "briefcases of cash" } as { beatIndex: number; label: string; moment?: number }];
  const moments = [{ show: "x" }, { show: "y" }, { show: "z" }, { show: "w" }];
  const n = await assignFromBin(llm, { entry: 0, game: "Vice City", moments, sentences: ["s0", "s1", "s2", "s3"] }, [1, 2, 3], images, clips);
  assert.equal(n, 1);
  assert.equal(clips[0]!.moment, 1);
  assert.equal(images[0]!.moment, undefined);
});

import { graphicFitsSentence } from "../src/assets/fill.ts";

test("a graphic only carries figures and quotes its own sentence says", () => {
  const s = ["It slipped.", "Production was meant to end on July 1, 1996.", 'Penn said "nobody wants to be the cop".', "Then it shipped."];
  const text = s.join(" ") + " Gary Penn, creative director.";
  const g = (kind: string, primary: string, secondary = "", items: string[] = []) => ({ kind, primary, secondary, items });
  assert.equal(graphicFitsSentence(g("date", "July 1, 1996"), s, 1, text), true);
  assert.equal(graphicFitsSentence(g("date", "December 16, 2021"), s, 1, text), false);
  assert.equal(graphicFitsSentence(g("quote", "nobody wants to be the cop", "Gary Penn, creative director"), s, 2, text), true);
  // The narrator's own words are not a quote, and a speaker the chapter never names is refused.
  assert.equal(graphicFitsSentence(g("quote", "Then it shipped", "Gary Penn"), s, 2, text), false);
  assert.equal(graphicFitsSentence(g("quote", "nobody wants to be the cop", "Rockstar mission dialogue"), s, 2, text), false);
});
