import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beforeAfterFacts,
  condense,
  eventLabel,
  flowFacts,
  orgFacts,
  orgNames,
  orgRelation,
  sentenceYear,
  splitFacts,
  timelineFacts,
} from "../src/render/components/diagram/facts.ts";
import {
  diagramFor,
  diagramVerdict,
  DIAGRAM_STYLES,
} from "../src/render/components/diagram/choose.ts";
import {
  flowLayout,
  orgLayout,
  timelineXs,
} from "../src/render/components/diagram/styles.tsx";
import { DIAGRAMS } from "../src/render/components/diagram/index.ts";
import { DRAWN_BY, SAFE_EDGE } from "../src/render/components/packs/fit.ts";

const ch = (sentences: string[], game = "Grand Theft Auto III") => ({
  game,
  year: 2001,
  sentences,
});

/** Every word of a label appears in the given texts (nothing invented). */
const fromText = (label: string, ...texts: string[]) =>
  label
    .split(/\s+/)
    .every((w) => texts.some((t) => t.includes(w.replace(/[.,]$/, ""))));

test("org chart: the deal a sentence names, or the one beside an ownership line, never an invented name", () => {
  const deal =
    "Take-Two Interactive acquired DMA from Infogrames in September 1999, and the two teams were merged.";
  const c = ch([
    "In 1999, a small group at DMA Design built a demo.",
    "Then the ownership changed.",
    deal,
  ]);
  assert.deepEqual(orgNames(deal, c), [
    "Take-Two Interactive",
    "DMA",
    "Infogrames",
  ]);
  const r = orgRelation(deal, c)!;
  assert.equal(r.focus, "DMA");
  assert.deepEqual(
    r.edges.map((e) => `${e.from}>${e.to}:${e.kind}`),
    ["Infogrames>DMA:former", "Take-Two Interactive>DMA:owns"],
  );
  const near = orgFacts("Then the ownership changed.", c, 1);
  assert.ok(near.ok && /beside/.test(near.note));
  // An ownership line with no deal near it declines.
  assert.equal(
    orgFacts(
      "Then the ownership changed.",
      ch(["a.", "Then the ownership changed.", "b."]),
      1,
    ).ok,
    false,
  );
  // A game title is never an org.
  assert.deepEqual(
    orgNames("Grand Theft Auto III was bought by millions.", c),
    [],
  );
  assert.equal(orgFacts("The game sold well.", c, 0).ok, false);
});

test("timeline: the sentence's own year lit among the chapter's dated events; fiction years and bare years decline", () => {
  const c = ch([
    "It's late 2001, and Grand Theft Auto 3 is nearly finished.",
    "Rockstar announced the game at E3 on May 22, 2002.",
    "The story is set in 1986 in a city of neon.",
    "Rockstar would come back to these streets with a prequel, Vice City Stories, in 2006, and again later.",
    "Nobody knew yet.",
  ]);
  assert.equal(
    eventLabel(c.sentences[0]!),
    "Grand Theft Auto 3 is nearly finished",
  );
  assert.equal(
    eventLabel(c.sentences[1]!),
    "Rockstar announced the game at E3",
  );
  assert.equal(eventLabel(c.sentences[3]!), "Vice City Stories");
  assert.equal(sentenceYear(c.sentences[2]!), undefined);
  const t = timelineFacts(c.sentences[1]!, c, 1);
  assert.ok(t.ok);
  if (t.ok) {
    assert.deepEqual(
      t.data.events.map((e) => e.year),
      [2001, 2002, 2006],
    );
    assert.equal(t.data.events.find((e) => e.focus)!.year, 2002);
    for (const e of t.data.events)
      assert.ok(fromText(e.label, ...c.sentences), e.label);
  }
  assert.equal(timelineFacts(c.sentences[4]!, c, 4).ok, false);
  assert.equal(timelineFacts(c.sentences[2]!, c, 2).ok, false);
  // Too few dated events.
  assert.equal(
    timelineFacts(
      "It shipped in 2001 to stores.",
      ch(["It shipped in 2001 to stores."]),
      0,
    ).ok,
    false,
  );
});

test("split, flow and before/after take only what the sentence names", () => {
  const c = ch(["x"], "Grand Theft Auto VI");
  const s = splitFacts(
    "Rockstar hoped to build it alongside Red Dead Redemption 2.",
    c,
  );
  assert.ok(
    s.ok &&
      s.data.left.title === "Grand Theft Auto VI" &&
      s.data.right.title === "Red Dead Redemption 2",
  );
  assert.equal(splitFacts("Two teams worked hard.", c).ok, false);
  const f = flowFacts(
    "Meanwhile, planned single-player DLC had been scrapped, its resources moved to GTA Online and Red Dead Redemption 2.",
    c,
  );
  assert.ok(f.ok);
  if (f.ok) {
    assert.deepEqual(f.data.steps, ["planned single-player DLC", "GTA Online"]);
    assert.deepEqual(f.data.fan, ["Red Dead Redemption 2"]);
  }
  const g = flowFacts(
    "The combined group began work on the Dreamcast, then switched to the PlayStation 2 after four months.",
    c,
  );
  assert.ok(g.ok && g.data.steps.join(">") === "Dreamcast>PlayStation 2");
  assert.equal(flowFacts("The game was a success.", c).ok, false);
  const b = beforeAfterFacts(
    "The world that couldn't hold a save in 2013 now charged rent every month.",
    c,
  );
  assert.ok(
    b.ok &&
      b.data.before.head === "2013" &&
      b.data.after.text === "charged rent every month",
  );
  const life = beforeAfterFacts(
    "Internally, it started life as a Godzilla project.",
    ch(["x"]),
  );
  assert.ok(
    life.ok &&
      life.data.before.text === "a Godzilla project" &&
      life.data.after.text === "Grand Theft Auto III",
  );
  assert.equal(beforeAfterFacts("It didn't start as a sequel.", c).ok, false);
  assert.equal(
    beforeAfterFacts("One story, told by three criminals instead of one.", c)
      .ok,
    false,
  );
  assert.equal(condense("and the discs went to the", 7), "the discs went");
  assert.equal(
    condense("one two three four five six seven eight", 7),
    undefined,
  );
});

test("diagramFor ranks the shapes and declines a punch line, a quote or a sentence with a graphic", () => {
  const deal =
    "Take-Two Interactive acquired DMA from Infogrames in September 1999.";
  const c = ch(["Then the ownership changed.", deal]);
  const own = diagramFor(deal, {}, c);
  assert.ok(own && own.style === "orgChart" && own.family === "diagram");
  const near = diagramFor("Then the ownership changed.", {}, c);
  assert.ok(
    near && near.confidence < own!.confidence,
    "a borrowed deal is less certain",
  );
  assert.equal(diagramFor("Critics agreed.", {}, c), undefined);
  const g = diagramVerdict(deal, { graphic: { kind: "lineage" } }, c);
  assert.ok("declined" in g && /graphic/.test(g.declined));
  for (const s of DIAGRAM_STYLES)
    assert.ok(DIAGRAMS[s] && DIAGRAMS[s].settled <= DRAWN_BY, s);
});

test("layouts stay inside the frame's safe edge", () => {
  for (const n of [2, 3, 5]) {
    const xs = timelineXs(n);
    assert.ok(
      xs[0]! - 190 >= SAFE_EDGE && xs[xs.length - 1]! + 190 <= 1920 - SAFE_EDGE,
    );
  }
  const boxes = flowLayout({ steps: ["a", "b", "c", "d"], fan: ["e", "f"] });
  for (const b of boxes) {
    assert.ok(b.x - b.w / 2 >= SAFE_EDGE && b.x + b.w / 2 <= 1920 - SAFE_EDGE);
    assert.ok(b.y - b.h / 2 >= SAFE_EDGE && b.y + b.h / 2 <= 1080 - 150);
  }
  const org = orgLayout({
    nodes: ["A", "B", "C"],
    edges: [
      { from: "A", to: "C", label: "from", kind: "former" },
      { from: "B", to: "C", label: "acquired", kind: "owns" },
    ],
  });
  assert.deepEqual(org.map((p) => p.role).sort(), ["child", "former", "owner"]);
});
