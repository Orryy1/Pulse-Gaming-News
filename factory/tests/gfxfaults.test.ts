// The graphics faults of 4 Nov 2026: the exact strings the check faulted on the FFXIV documentary, Vice City
// and the weekly recap, put through the layouts and the choosers that now keep them apart and complete.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareLayout } from "../src/render/components/LongMoments.tsx";
import { fitBlock, textWidth } from "../src/render/components/packs/fit.ts";
import {
  completeCard,
  fittingStyles,
  kineticVerdict,
  type KineticData,
} from "../src/render/components/kinetic/choose.ts";
import {
  canFinish,
  completeRun,
  displayWord,
  keyWords,
  tokens,
} from "../src/render/components/kinetic/words.ts";
import { settledBy, shotTiming, SETTLED } from "../src/render/components/docs/layout.ts";
import { wholeLineFiller } from "../src/render/fillerplan.ts";
import { faultsByKind, graphicsNotice } from "../src/qa/graphicscheck.ts";
import { cueSide } from "../src/render/structure.ts";
import { underFullScreen } from "../src/render/momentspan.ts";

const row = (s: string) => {
  const i = s.lastIndexOf(":");
  return { label: s.slice(0, i).trim(), value: s.slice(i + 1).trim() };
};
const shown = (k: { tokens: string[]; shown: number[] }) =>
  k.shown.map((i) => displayWord(k.tokens[i]!)).join(" ");

// Rows of the graphics the check muted on FFXIV: label and value ran into each other on one line.
const FAULTED = [
  ["Final Fantasy XIV:Updated and expanded game", "Final Fantasy XI:Original art"],
  ["Carried forward:Aesthetic elements from Final Fantasy XI", "New:Something that stood on its own"],
  ["Flowerpot:As many polygons as a player character", "Player character:Same count"],
  ["Producer:Hiromichi Tanaka then Naoki Yoshida", "Director:Nobuaki Komoto then Naoki Yoshida"],
  ["Before:Hiromichi Tanaka and Nobuaki Komoto", "After:Naoki Yoshida"],
  ["Players:Subscription fees", "Square Enix:Permanently reduced monthly payments"],
  ["Intention:Design direction and upcoming changes", "Delivery:Battle system changes and instanced dungeons"],
  ["Relaunch:Contributed to Square Enix's return to profitability", "Original:Heavy losses"],
];

test("a compare row that cannot share a line stacks its label over its value, on two lines at most", () => {
  for (const items of FAULTED) {
    const rows = items.map(row);
    const L = compareLayout(rows);
    assert.equal(L.stacked, true, String(items[0]));
    assert.equal(L.bars, false, "words get no bar");
    for (const r of rows) {
      const fit = fitBlock(r.value, "inter", {
        maxWidth: L.width - 64,
        sizes: [L.valueSize],
        maxLines: 2,
      });
      assert.ok(fit.fits, r.value);
      assert.ok(textWidth(r.label, "inter", L.labelSize) <= L.width - 64, r.label);
    }
  }
});

test("a compare whose rows fit keeps its look, with a clear gap, and bars only for like figures", () => {
  const a = compareLayout([row("Vice City:$59"), row("San Andreas:$69")]);
  assert.deepEqual(
    { stacked: a.stacked, bars: a.bars, width: a.width },
    { stacked: false, bars: true, width: 620 },
  );
  assert.equal(
    compareLayout([row("GTA V:11 million"), row("GTA IV:25 million")]).bars,
    true,
  );
  // Words, a figure against a difference, and two units cannot share a bar.
  assert.equal(compareLayout([row("Before:Tanaka"), row("After:Yoshida")]).bars, false);
  assert.equal(compareLayout([row("Base:$69.99"), row("Deluxe:$10 more")]).bars, false);
  assert.equal(compareLayout([row("Sales:1 billion"), row("Rival:500 million")]).bars, false);
});

test("a kinetic line is the whole sentence, never a pick of its words", () => {
  for (const [s, want] of [
    ["What did they want you to find there?", "What did they want you to find there"],
    ["Would that promised PlayStation version ever reach players?", "Would that promised PlayStation version ever reach players"],
    ["How would Yoshida keep approvals from slowing the rebuild?", "How would Yoshida keep approvals from slowing the rebuild"],
    ["Why hadn't that production effort delivered a better launch?", "Why hadn't that production effort delivered a better launch"],
    ["Nobody outside the studio knows it yet.", "Nobody outside the studio knows it yet"],
  ] as const)
    assert.equal(shown(keyWords(s)!), want);
});

test("a longer line takes its closing clause when that stands alone, and otherwise is not set in type", () => {
  assert.equal(
    shown(keyWords("After months of arguments in the boardroom, the whole team walked out.")!),
    "the whole team walked out",
  );
  // Leans on what came before: no card.
  assert.equal(
    completeRun(tokens("The studio spent eleven long years building its own engine, which nobody wanted.")),
    undefined,
  );
  // FFXIV 7:30: eleven words and no clause to stand on.
  assert.equal(
    keyWords("But what would all this work mean for Square Enix's finances?"),
    undefined,
  );
  const v = kineticVerdict(
    "But what would all this work mean for Square Enix's finances?",
    { emphasis: "" },
    { game: "Final Fantasy XIV", year: 2013, sentences: [] },
    { index: 3, seed: 1 },
  );
  assert.ok("declined" in v);
});

test("the older pick of words is still there behind the setting", () => {
  assert.equal(
    shown(keyWords("Nobody outside the studio knows it yet.", undefined, false)!),
    "Nobody outside the studio knows yet",
  );
  const v = kineticVerdict(
    "Would that promised PlayStation version ever reach players?",
    { emphasis: "" },
    { game: "Final Fantasy XIV", year: 2013, sentences: [] },
    { index: 3, seed: 1, complete: false },
  );
  assert.ok("candidate" in v && !v.candidate.data.finish);
});

test("the giant word of a scale card finishes the line, and a weak last word cannot take it", () => {
  const card = (s: string): KineticData => {
    const k = keyWords(s)!;
    return { sentence: s, ...k, tone: "punch", finish: true };
  };
  assert.ok(fittingStyles(card("Not everything survived.")).includes("scale"));
  assert.ok(canFinish(tokens("The second week went no better."), [0, 1, 2, 3, 4, 5]));
  // "either" or "it" set giant would finish nothing.
  assert.ok(!fittingStyles(card("The awards couldn't agree either.")).includes("scale"));
  assert.ok(!fittingStyles(card("Nobody outside the studio knows it.")).includes("scale"));
});

test("a card from an older plan is brought up to a complete thought, or left out", () => {
  const old: KineticData = {
    sentence: "What did they want you to find there?",
    tokens: tokens("What did they want you to find there?"),
    shown: [1, 2, 3, 4, 5, 6],
    hero: 3,
    tone: "punch",
  };
  const done = completeCard(old, "scale")!;
  assert.equal(shown(done.card), "What did they want you to find there");
  assert.equal(done.card.finish, true);
  // A giant "THERE" would finish nothing, and a stack cannot draw eight lines: both become "land".
  assert.equal(done.style, "land");
  assert.equal(completeCard(old, "stack")!.style, "land");
  const name = "The first decision was the name.";
  assert.equal(
    completeCard(
      { sentence: name, tokens: tokens(name), shown: [0, 1, 2, 3, 4, 5], hero: 1, tone: "punch" },
      "scale",
    )!.style,
    "scale",
  );
  const f = {
    family: "kinetic" as const,
    style: "highlight",
    data: {
      card: {
        ...old,
        sentence: "But what would all this work mean for Square Enix's finances?",
        tokens: tokens("But what would all this work mean for Square Enix's finances?"),
      },
    },
  };
  assert.equal(wholeLineFiller(f as never), undefined);
  const other = { family: "document", style: "memo", data: {} };
  assert.equal(wholeLineFiller(other as never), other);
});

test("a recall card crosses to the left while a corner card holds the right", () => {
  const cue = { from: 1000, len: 150 };
  assert.equal(cueSide(cue, [{ from: 1100, to: 1250 }]), "left");
  assert.equal(cueSide(cue, [{ from: 900, to: 1001 }]), "left");
  assert.equal(cueSide(cue, [{ from: 900, to: 1000 }]), "right");
  assert.equal(cueSide(cue, [{ from: 1150, to: 1300 }]), "right");
});

test("a name tag waits for a full-screen graphic of the sentence before it", () => {
  const none = { kind: "none", primary: "", secondary: "", items: [] };
  const windows = [
    { entry: 3, moment: 0, start: 10, end: 12, at: 10 },
    { entry: 3, moment: 1, start: 12, end: 18, at: 12 },
  ] as never;
  const look = (shares: boolean) => ({
    moment: (_: number, m: number) =>
      ({
        graphic:
          m === 0
            ? { kind: "source", primary: "A passage of the record that runs long enough to read here", secondary: "", items: ["x"] }
            : none,
        emphasis: "",
      }) as never,
    fillerStart: () => undefined,
    shares: () => shares,
  });
  assert.equal(underFullScreen(windows, 1, 30, look(false)), true);
  // A corner card shares the frame: the tag may land beside it.
  assert.equal(underFullScreen(windows, 1, 30, look(true)), false);
});

test("the alert says which card most of the faults came from", () => {
  const by = faultsByKind(["0:1", "0:2", "1:3", "break:2"], (e, m) =>
    e === 0 ? "compare" : m === 3 ? "kinetic card" : undefined,
  );
  assert.deepEqual(by[0], { kind: "compare", n: 2 });
  assert.equal(by.length, 3);
  const line = graphicsNotice("T", "prepass", 200, ["0:1", "0:2"], [], by);
  assert.match(line, /Most: 2 compare, 1 chapter breather, 1 kinetic card\./);
});

test("a document's pen has left the page before a short shot cuts away", () => {
  // The contract line of Vice City 7:23: 75 frames, its underline running to the end of the shot.
  const t = shotTiming({ from: 60, to: 82, matched: true }, false, 75);
  assert.ok(t.to <= settledBy(75) - 18);
  assert.ok(t.from < t.to);
  assert.equal(settledBy(400), SETTLED);
  // Long shots are as they were.
  assert.deepEqual(shotTiming({ from: 60, to: 80, matched: true }, false, 300), {
    from: 60,
    to: 80,
    matched: true,
  });
  const c = shotTiming({ from: 60, to: 80, matched: true }, true, 80);
  assert.ok(c.to <= settledBy(80) - 25);
});
