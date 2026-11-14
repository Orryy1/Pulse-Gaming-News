// Documentary footage is asked for sentence by sentence (29 Oct 2026 review: barely one shot in ten showed
// what the narrator said, because chapters only ever asked for footage by paragraph).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterSentences, docShotTargets } from "../src/pipeline.ts";

const moment = (show: string, extra: Record<string, unknown> = {}) => ({
  show,
  keywords: ["Vice City"],
  broll: "",
  graphic: { kind: "none", primary: "", secondary: "", items: [] },
  emphasis: "",
  person: "",
  ...extra,
});

test("a chapter's sentences are its own paragraphs', and every in-game sentence asks for its own shot", () => {
  const script = {
    beats: [
      { narration: "Welcome. This is the intro.", visual: { kind: "title" } },
      { narration: "Vice City launched in 2002. It sold well.", visual: { kind: "chapter" } },
      { narration: "Sam Houser led it. The office was in New York.", visual: { kind: "beat" } },
      { narration: "Then came San Andreas.", visual: { kind: "chapter" } },
    ],
  } as never;
  assert.deepEqual(chapterSentences(script, 0), [
    "Vice City launched in 2002.",
    "It sold well.",
    "Sam Houser led it.",
    "The office was in New York.",
  ]);
  const entry = {
    game_title: "Grand Theft Auto: Vice City",
    moments: [
      moment("the Vice City skyline at launch"),
      moment("sales chart"),
      moment("Sam Houser", { person: "Sam Houser", keywords: ["Sam Houser", "Rockstar"] }),
      moment("an office at night", { broll: "office at night" }),
    ],
  } as never;
  const t = docShotTargets(entry, chapterSentences(script, 0), 1);
  // The B-roll sentence is left to stock and photos.
  assert.deepEqual(t.map((x) => x.key), ["beat:1#m0", "beat:1#m1", "beat:1#m2"]);
  assert.match(t[0]!.text, /^Vice City launched in 2002\. \(show: the Vice City skyline at launch\)$/);
  // A named real person is kept out of the footage keywords (no gameplay shows Sam Houser).
  assert.deepEqual(t[2]!.keywords, ["Grand Theft Auto: Vice City", "Rockstar"]);
});

test("the matched share counts sentences with a clip or still chosen for them, once each", async () => {
  const { matchedShare } = await import("../src/pipeline.ts");
  const moments = [[1, 2, 3, 4], [1, 2]];
  const images = [
    { beatIndex: 0, moment: 0 },
    { beatIndex: 0, moment: 0 },
    { beatIndex: 1, moment: 1 },
    { beatIndex: 0 },
  ];
  const clips = [{ beatIndex: 0, moment: 2 }];
  assert.equal(matchedShare(moments, images, clips), 3 / 6);
});

test("a cold-open sentence previews the chapter shot it shares names with, each shot once", async () => {
  const { previewShot } = await import("../src/render/longplan.ts");
  const shows = [
    ["Dundee skyline and the DMA Design office", "Race'n'Chase prototype on a 1995 PC"],
    ["Vice City neon beach at night", "Tommy Vercetti in the Malibu Club"],
  ];
  const images = [
    { beatIndex: 0, moment: 0 },
    { beatIndex: 1, moment: 1 },
  ];
  const clips = [{ beatIndex: 0, moment: 1 }];
  const taken = new Set<string>();
  const used = [false];
  assert.deepEqual(
    previewShot("A small team at DMA Design in Dundee started work.", shows, taken, images, clips, used),
    { type: "image", index: 0 },
  );
  assert.deepEqual(
    previewShot("It began in 1995 as a prototype.", shows, taken, images, clips, used),
    { type: "clip", index: 0 },
  );
  // Nothing shared: the montage keeps the sentence.
  assert.equal(previewShot("Get comfortable.", shows, taken, images, clips, used), undefined);
  // Used once only.
  assert.equal(previewShot("Dundee, DMA Design again.", shows, taken, images, clips, used), undefined);
});

test("a kinetic caption must be a whole name or phrase", async () => {
  const { wholePhrase } = await import("../src/editorial/documentary.ts");
  for (const ok of ["Sam Houser", "Vice City", "1986", "Race'n'Chase", "the Malibu Club"])
    assert.ok(wholePhrase(ok), ok);
  for (const bad of ["MORE", "fresh and new", "and the", "it", "of", "a whole new kind of open world"])
    assert.ok(!wholePhrase(bad), bad);
});
