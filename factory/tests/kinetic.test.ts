import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayWord,
  emphasisRun,
  keyWords,
  MAX_SHOWN,
  shownCount,
  wordTimes,
  wordsIn,
} from "../src/render/components/kinetic/words.ts";
import {
  fittingStyles,
  kineticFor,
  kineticVerdict,
  pickStyle,
  splitPoint,
  type KineticData,
} from "../src/render/components/kinetic/choose.ts";
import { landFrames } from "../src/render/components/kinetic/kit.tsx";
import { stackSizes } from "../src/render/components/kinetic/styles.tsx";
import { KINETIC } from "../src/render/components/kinetic/index.ts";
import {
  backdropFor,
  backdropScore,
} from "../src/render/components/kinetic/backdrop.ts";
import { DRAWN_BY } from "../src/render/components/packs/fit.ts";

const chapter = (sentences: string[]) => ({
  game: "Grand Theft Auto III",
  year: 2001,
  sentences,
});
const shown = (s: string, e?: string) => {
  const k = keyWords(s, e)!;
  return k.shown.map((i) => displayWord(k.tokens[i]!)).join(" ");
};

test("a short punch line goes on screen whole, its punch word the hero", () => {
  // Seven words: one comes off, and it is never the opening "Nobody" or the closing "yet".
  assert.equal(
    shown("Nobody outside the studio knows it yet."),
    "Nobody outside the studio knows yet",
  );
  // A run of the sentence wins when it keeps the strongest words.
  assert.equal(
    shown("Internally, it started life as a Godzilla project."),
    "started life as a Godzilla project",
  );
  assert.equal(shown("That ambition had a cost."), "That ambition had a cost");
  const c = keyWords("That ambition had a cost.")!;
  assert.equal(displayWord(c.tokens[c.hero]!), "cost");
  // A filler at the end is not the punch: "agree", not "either".
  const e = keyWords("The awards couldn't agree either.")!;
  assert.equal(displayWord(e.tokens[e.hero]!), "agree");
});

test("never more than six words, and only the sentence's own words in its order", () => {
  const s = "Rockstar also offered the game to Microsoft as an Xbox exclusive.";
  const k = keyWords(s)!;
  assert.ok(k.shown.length <= MAX_SHOWN && k.shown.length >= 3);
  assert.deepEqual(
    [...k.shown].sort((a, b) => a - b),
    k.shown,
  );
  for (const i of k.shown) assert.ok(s.includes(displayWord(k.tokens[i]!)));
  // Names and the final punch come through.
  const words = k.shown.map((i) => displayWord(k.tokens[i]!));
  assert.ok(words.includes("exclusive"));
  assert.ok(words.includes("Xbox"));
});

test("the shot list's emphasis phrase is kept whole, as a run of the sentence", () => {
  const s = "Internally, it started life as a Godzilla project.";
  assert.deepEqual(emphasisRun(s.split(" "), "A Godzilla project"), [5, 6, 7]);
  assert.equal(
    shown(s, "A Godzilla project"),
    "it started life as a Godzilla project".split(" ").slice(1).join(" "),
  );
  assert.equal(shownCount(4), 4);
  assert.equal(shownCount(30), 6);
});

test("word times follow the voice: a written year lands on its spoken first word", () => {
  const toks = "It shipped in 1995 to Europe.".split(" ");
  const spoken = [
    { text: "It", start: 10, end: 10.1 },
    { text: "shipped", start: 10.2, end: 10.5 },
    { text: "in", start: 10.6, end: 10.7 },
    { text: "nineteen", start: 10.8, end: 11.1 },
    { text: "ninety-five", start: 11.2, end: 11.7 },
    { text: "to", start: 11.8, end: 11.9 },
    { text: "Europe.", start: 12.0, end: 12.4 },
  ];
  const t = wordTimes(toks, spoken, 10);
  assert.equal(t.length, toks.length);
  assert.ok(Math.abs(t[3]! - 0.8) < 1e-6, `1995 at ${t[3]}`);
  assert.ok(Math.abs(t[5]! - 2.0) < 1e-6);
  for (let i = 1; i < t.length; i++) assert.ok(t[i]! >= t[i - 1]!);
  // A word the voice skipped sits between its neighbours.
  const skip = wordTimes(
    ["A", "big", "game."],
    [
      { text: "A", start: 10, end: 10.1 },
      { text: "game.", start: 11, end: 11.3 },
    ],
    10,
  );
  assert.ok(skip[1]! > skip[0]! && skip[1]! <= skip[2]!);
  // No timings: evenly paced.
  assert.deepEqual(
    wordTimes(["a", "b"], [], 0, 2).map((x) => +x.toFixed(2)),
    [0.2, 1.2],
  );
  assert.equal(wordsIn(spoken, 10.5, 11.5).length, 3);
});

test("kineticFor takes punch lines and turns, declines narration, quotes and graphics", () => {
  const ch = chapter([
    "It's late 2001.",
    "Nobody outside the studio knows it yet.",
    "That ambition had a cost.",
  ]);
  const a = kineticFor(ch.sentences[1]!, { emphasis: "" }, ch);
  assert.ok(a && a.confidence >= 0.5, "punch line taken");
  assert.equal(a!.family, "kinetic");
  const b = kineticFor(ch.sentences[2]!, { beat: "turn" }, ch);
  assert.ok(b && b.confidence > a!.confidence, "a marked turn ranks higher");
  const long =
    "They unlocked as the story went on, because the team wanted you to start out feeling poor and work toward being richer.";
  assert.equal(kineticFor(long, {}, chapter([long])), undefined);
  const q = kineticVerdict(
    'He called it "a nightmare".',
    {},
    chapter(['He called it "a nightmare".']),
  );
  assert.ok("declined" in q && /quote/.test(q.declined));
  const g = kineticVerdict(
    "Critics agreed.",
    { graphic: { kind: "stat" } },
    chapter(["Critics agreed."]),
  );
  assert.ok("declined" in g && /graphic/.test(g.declined));
  const flat = kineticVerdict(
    "The new map was roughly three times the size of the old one in total.",
    {},
    chapter(["x"]),
  );
  assert.ok("declined" in flat);
});

test("styles: split needs a divide, the register picks its style, the previous style is avoided", () => {
  const toks = "It was smaller, but it was denser.".split(" ");
  const sp = splitPoint(toks, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(sp, 3);
  assert.equal(splitPoint("Critics agreed.".split(" "), [0, 1]), undefined);
  // A closing "yet" is the punch word, not a divide.
  assert.equal(
    splitPoint("Nobody knows it yet.".split(" "), [0, 1, 2, 3]),
    undefined,
  );
  assert.equal(
    splitPoint(
      "Reviews were mixed, but sales weren't.".split(" "),
      [0, 1, 2, 3, 4, 5],
    ),
    3,
  );
  const d: KineticData = {
    sentence: toks.join(" "),
    tokens: toks,
    shown: [0, 1, 2, 3, 4, 5, 6].slice(0, 6),
    hero: 5,
    split: 3,
    tone: "turn",
  };
  assert.ok(fittingStyles(d).includes("split"));
  assert.ok(!fittingStyles({ ...d, split: undefined }).includes("split"));
  const picks = new Set<string>();
  for (let seed = 0; seed < 40; seed++) {
    const s = pickStyle(d, seed, "split");
    assert.notEqual(s, "split");
    picks.add(s);
  }
  assert.ok(picks.size >= 3, "rotates across styles");
  for (const s of fittingStyles(d)) assert.ok(KINETIC[s], `registered ${s}`);
});

test("words land a frame before they are said, or evenly by DRAWN_BY without timings", () => {
  const d: KineticData = {
    sentence: "a b c",
    tokens: ["a", "b", "c"],
    shown: [0, 2],
    hero: 2,
    tone: "punch",
  };
  assert.deepEqual(landFrames(d, [0.5, 1, 2], 30, 180), [14, 59]);
  const even = landFrames(d, undefined, 30, 180);
  assert.ok(Math.max(...even) < DRAWN_BY);
  // Never after the shot's last 24 frames.
  assert.deepEqual(landFrames(d, [0, 0, 20], 30, 180), [4, 156]);
});

test("the stack fits its words to the block and the block to the height", () => {
  const { sizes, width } = stackSizes([
    "SECRECY",
    "BECAME",
    "ITS",
    "OWN",
    "DEPARTMENT",
  ]);
  assert.equal(sizes.length, 5);
  assert.ok(sizes.every((s) => s <= 300));
  assert.ok(sizes.reduce((a, s) => a + s * 0.94, 0) <= 761);
  assert.ok(width <= 1180);
});

test("the hero word carries the line's meaning, never a function or time word", () => {
  const hero = (s: string, e?: string) => {
    const k = keyWords(s, e)!;
    return displayWord(k.tokens[k.hero]!);
  };
  assert.equal(hero("Nobody outside the studio knows it yet."), "Nobody");
  assert.ok(
    ["sales", "weren't"].includes(
      hero("Reviews were mixed, but sales weren't."),
    ),
  );
  assert.equal(hero("The satire had found its voice."), "voice");
  assert.equal(hero("San Andreas had been about excess."), "excess");
  // The emphasis phrase first, then a number, then a name.
  assert.equal(hero("It sold in 2002 to fans everywhere.", ""), "2002");
  assert.equal(hero("Then Rockstar moved on again.", ""), "Rockstar");
  assert.equal(hero("The first decision was the name.", "the name"), "name");
  for (const s of [
    "It was just the beginning then.",
    "But still, even so, it was all yet to come.",
  ]) {
    const h = hero(s).toLowerCase();
    assert.ok(
      ![
        "yet",
        "but",
        "it",
        "the",
        "so",
        "still",
        "now",
        "just",
        "then",
        "also",
        "even",
        "all",
      ].includes(h),
      `${s} -> ${h}`,
    );
  }
});

test("backdrops prefer places over character art, skip other games and rotate", () => {
  const imgs = [
    {
      file: "hero_0.jpg",
      kind: "hero",
      label: "Cartoon woman with pistol, dark background",
      aspect: 3.1,
    },
    {
      file: "igdb_0.jpg",
      kind: "screenshot",
      label: "Claude holding baseball bat",
      aspect: 1.33,
    },
    {
      file: "shot_8.jpg",
      kind: "screenshot",
      label: "Subway train beside bridge and skyline",
      aspect: 1.78,
    },
    {
      file: "igdb_1.jpg",
      kind: "screenshot",
      label: "Cars in traffic downtown street",
      aspect: 1.33,
    },
    {
      file: "fill/other/gta2/igdb_0.jpg",
      kind: "screenshot",
      label: "Grand Theft Auto 2",
      aspect: 1.33,
    },
    { file: "capsule_1.jpg", kind: "capsule", aspect: 0.67 },
  ];
  assert.ok(backdropScore(imgs[2]!) > backdropScore(imgs[1]!));
  assert.ok(backdropScore(imgs[3]!) > backdropScore(imgs[0]!));
  assert.ok(backdropScore(imgs[3]!) > backdropScore(imgs[4]!));
  const first = backdropFor(imgs, 1, [])!;
  assert.ok(["shot_8.jpg", "igdb_1.jpg"].includes(first));
  const second = backdropFor(imgs, 1, [first])!;
  assert.notEqual(second, first);
  assert.ok(["shot_8.jpg", "igdb_1.jpg"].includes(second));
  // Every picture used: the one used longest ago; portrait art never.
  const all = imgs.map((i) => i.file).filter((f) => f !== "capsule_1.jpg");
  assert.equal(backdropFor(imgs, 1, all), all[0]);
  assert.equal(backdropFor([imgs[5]!], 1, []), undefined);
});
