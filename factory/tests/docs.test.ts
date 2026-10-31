import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOC_KINDS,
  documentFor,
  markPhrase,
  pageLine,
  type DocScene,
} from "../src/render/components/docs/choose.ts";
import {
  SETTLED,
  camera,
  columnFigure,
  layoutPage,
  manifestTitle,
  markTiming,
  shotTiming,
  typedBlock,
} from "../src/render/components/docs/layout.ts";
import { DOCUMENTS } from "../src/render/components/docs/index.ts";

const ch = { game: "Grand Theft Auto: Vice City", year: 2002 };

test("a document is offered only for a bare, safe, real-world line that names a document's business", () => {
  assert.equal(
    documentFor(
      "Even the windows needed an NDA.",
      { show: "Privacy film on office windows" },
      ch,
    )?.kind,
    "contract",
  );
  assert.equal(
    documentFor(
      "The team worked through weekends for months to finish it.",
      {},
      ch,
    )?.kind,
    "rota",
  );
  assert.equal(
    documentFor("Two million discs were pressed before launch day.", {}, ch)
      ?.kind,
    "manifest",
  );
  assert.equal(
    documentFor(
      'Destructoid\'s Chris Carter called it a "messy launch" that should have been delayed.',
      {},
      ch,
    )?.kind,
    "reviews",
  );
  // Covered, or carrying a graphic: nothing.
  assert.equal(
    documentFor(
      "Even the windows needed an NDA.",
      {},
      { ...ch, covered: true },
    ),
    undefined,
  );
  assert.equal(
    documentFor(
      "Even the windows needed an NDA.",
      { graphic: { kind: "stat" } },
      ch,
    ),
    undefined,
  );
  // Sensitive lines and lines about something on a screen: nothing.
  assert.equal(
    documentFor("The lawsuit was signed off in court.", {}, ch),
    undefined,
  );
  assert.equal(
    documentFor(
      "Players couldn't connect to the servers or the Social Club service.",
      {},
      ch,
    ),
    undefined,
  );
  // No document's business at all.
  assert.equal(
    documentFor(
      "San Andreas had been about excess.",
      { show: "San Andreas chaotic excess scene" },
      ch,
    ),
    undefined,
  );
});

test("a line too long for a sticky note goes on a memo instead", () => {
  const c = documentFor(
    "Early on, the team pitched dozens of ideas for the new city, from a working airport and a full casino strip to a whole island of hotels and a theme park nobody ever finished.",
    {},
    ch,
  )!;
  assert.equal(c.kind, "memo");
  assert.ok(layoutPage(c.scene));
  assert.match(c.reason, /so a memo/);
});

test("a dated line about timing becomes a schedule with its milestone in that month", () => {
  const c = documentFor(
    "Rockstar set a deadline of October 2002 for the whole game.",
    {},
    ch,
  )!;
  assert.equal(c.kind, "schedule");
  assert.equal(c.scene.date, "October 2002");
  assert.equal(c.scene.month, 9);
  assert.equal(c.scene.mark, "October 2002");
  assert.ok(c.confidence >= 0.7 && c.reason.includes("deadline"));
});

test("a page shows only the sentence's words and the chapter's game", () => {
  const s = "They wanted fewer dead spots, like San Andreas's empty deserts.";
  const c = documentFor(s, {}, ch)!;
  assert.equal(c.scene.line, pageLine(s));
  assert.ok(c.scene.line.includes(c.scene.mark));
  assert.equal(c.scene.project, ch.game);
  // No date or figure the sentence does not say.
  assert.equal(c.scene.date, undefined);
  assert.equal(c.scene.figure, undefined);
  assert.equal(pageLine("It “worked” — mostly."), 'It "worked", mostly.');
});

test("the pen marks the telling words: a quote, a scale, the cue but not a name", () => {
  assert.equal(
    markPhrase('Houser wanted something "fresh and new" instead.', "memo"),
    "fresh and new",
  );
  assert.equal(
    markPhrase(
      "The new map was roughly three times the size of GTA 3's Liberty City.",
      "design",
    ),
    "three times the size",
  );
  assert.equal(
    markPhrase(
      "They wanted fewer dead spots, like San Andreas's empty deserts.",
      "design",
    ),
    "empty deserts",
  );
  assert.equal(
    markPhrase("Secrecy became its own department.", "memo"),
    "Secrecy became its own department",
  );
  assert.equal(
    markPhrase(
      "Its next game would test how much money one world could make.",
      "budget",
      { emphasis: "one world" },
    ),
    "one world",
  );
});

test("every document lays out a short and a long line inside its page, the mark inside the key line", () => {
  const lines = [
    "Not everything survived.",
    "They unlocked as the story went on, because the team wanted you to start out feeling poor and work toward being richer.",
  ];
  for (const kind of DOC_KINDS)
    for (const line of lines) {
      const scene: DocScene = {
        kind,
        line,
        mark: "survived",
        look: "laser",
        seed: 3,
        sketch: kind === "design",
        date: "October 2002",
        month: 9,
      };
      if (!line.includes("survived")) scene.mark = "feeling poor";
      const L = layoutPage(scene);
      // A board's sticky note or headline takes a short line only (documentFor moves a long one to a memo).
      if (!L && (kind === "ideas" || kind === "reviews") && line.length > 60)
        continue;
      assert.ok(L, `${kind} lays out`);
      for (const r of [L.mark, L.focus]) {
        assert.ok(r.width > 0 && r.height > 0, kind);
        assert.ok(
          r.left > -80 &&
            r.top > -80 &&
            r.left + r.width < L.w + 80 &&
            r.top + r.height < L.h + 80,
          `${kind} inside`,
        );
      }
      if (L.key) {
        assert.ok(L.key.segs.length >= 1, `${kind} marks`);
        assert.ok(
          L.key.box.left + L.key.box.width <= L.w - 60,
          `${kind} key in margin`,
        );
        assert.ok(
          L.key.box.top + L.key.box.height <= L.h - 60,
          `${kind} key above the foot`,
        );
      }
      assert.ok(DOCUMENTS[kind].page);
    }
});

test("a typed block finds a phrase that wraps across lines", () => {
  const b = typedBlock("one two three four five six", "four five", {
    x: 0,
    y: 0,
    maxW: 14 * 30 * 0.6,
    maxH: 999,
    sizes: [30],
  })!;
  assert.deepEqual(
    b.lines.map((l) => l.text),
    ["one two three", "four five six"],
  );
  assert.deepEqual(b.segs, [{ line: 1, a: 0, b: 9 }]);
});

test("the mark lands on the narrator's words, after the push and settled by frame 100", () => {
  const words = [
    { text: "Even", start: 0, end: 0.3 },
    { text: "the", start: 0.3, end: 0.4 },
    { text: "windows", start: 1.6, end: 2.0 },
    { text: "needed", start: 2.0, end: 2.3 },
    { text: "an", start: 2.3, end: 2.4 },
    { text: "NDA.", start: 2.4, end: 2.9 },
  ];
  assert.deepEqual(markTiming(words, "windows needed an NDA"), {
    from: 48,
    to: 70,
    matched: true,
  });
  // Said early: held until the camera has arrived; said late: no later than frame 70.
  assert.equal(markTiming(words, "Even the").from, 40);
  const late = words.map((w) => ({ ...w, start: w.start + 9, end: w.end + 9 }));
  const t = markTiming(late, "NDA");
  assert.equal(t.from, 70);
  assert.ok(t.to <= 92);
  // A spelt-out year still finds its month; no timings at all, the default.
  assert.equal(
    markTiming(
      [
        { text: "November", start: 2, end: 2.4 },
        { text: "two", start: 2.4, end: 2.6 },
      ],
      "November 2004",
    ).from,
    60,
  );
  assert.deepEqual(markTiming(undefined, "x"), {
    from: 48,
    to: 66,
    matched: false,
  });
  // A contract writes its signature after the clause, and finishes by SETTLED.
  const c = shotTiming(t, true);
  assert.ok(c.to <= 62 && c.to + 3 + 24 <= SETTLED);
});

test("the camera pushes in at least 1.3x and keeps the view on the page", () => {
  const cam = camera(1100, 1420, {
    left: 96,
    top: 640,
    width: 600,
    height: 120,
  });
  assert.ok(cam.s1 >= cam.s0 * 1.3 - 1e-9 && cam.s1 <= 1.45);
  assert.ok(cam.c1.y >= 540 / cam.s1 - 1e-9);
});

test("narrow columns take a figure only when it stays legible; the manifest names a shipment", () => {
  assert.deepEqual(columnFigure("$100 million", 280, 40), {
    text: "$100 million",
    size: 38,
  });
  assert.equal(columnFigure("Two million discs", 200, 30), undefined);
  assert.equal(
    manifestTitle("Two million discs were pressed."),
    "SHIPPING MANIFEST",
  );
  assert.equal(
    manifestTitle("It sat on store shelves for a month."),
    "PURCHASE ORDER",
  );
});

// The coordinator's review (31 Oct 2026): a page implies a real paper existed, so its kind must match what the
// line says. These are the Vice City documentary's own bare sentences.
const vc = (s: string, m: Record<string, string> = {}) => documentFor(s, m, ch);

test("quoted words never go on a memo or any internal paper; a clipping only when a publication is named", () => {
  assert.equal(vc('He called the job of following up San Andreas "a nightmare".'), undefined);
  assert.equal(vc('Earlier games had leaned on movie references, and Houser wanted something "fresh and new" instead.'), undefined);
  const c = vc('Destructoid\'s Chris Carter called it a "messy launch" that should have been delayed.')!;
  assert.equal(c.kind, "reviews");
  assert.equal(c.scene.mark, "messy launch");
});

test("an order or manifest only for an order, shipment or quantity", () => {
  assert.equal(vc("It's November 2004, and San Andreas has been on store shelves for barely a month."), undefined);
  assert.equal(vc("Two million discs were pressed before launch day.")?.kind, "manifest");
});

test("a budget only with money in it, a contract only for a deal stated as made", () => {
  assert.equal(vc("Its next game would test how much money one world could make."), undefined);
  assert.equal(vc("By the end, the budget had grown to $100 million.")?.kind, "budget");
  assert.equal(vc("Rockstar also offered the game to Microsoft as an Xbox exclusive.", { broll: "Xbox console" }), undefined);
  assert.equal(vc("Even the windows needed an NDA.")?.kind, "contract");
});

test("general lines with no paper behind them are a memo at 0.5 or below", () => {
  for (const s of [
    "Not everything survived.",
    "The ambition came from the top.",
    "Secrecy became its own department.",
    "The first decision was the name.",
  ]) {
    const c = vc(s, { broll: "office" })!;
    assert.equal(c.kind, "memo", s);
    assert.ok(c.confidence <= 0.5, s);
  }
  // A short line that names a publication or a paper is not general.
  assert.equal(vc("IGN went furthest.")?.kind, "reviews");
});
