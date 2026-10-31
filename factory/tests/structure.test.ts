// The documentary's structure devices (31 Oct 2026): open loops and their payoffs, the bookend ending, the
// title drop, the chapter index and year counter, the callback cues and the cut rhythm.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asQuestion,
  bookendEchoProblems,
  deriveOpenLoops,
  findPayoff,
  findPlant,
  groundOpenLoops,
  loopBrief,
  loopMatch,
  loopProblems,
  openLoopsLine,
  OPEN_LOOP_RULE,
  placeOpenLoops,
  type OpenLoop,
} from "../src/editorial/openloops.ts";
import {
  BURST_SHOT,
  RHYTHM_OPEN_CLIP,
  RHYTHM_OPEN_STILL,
  bookendEcho,
  burstWindows,
  callbackCues,
  chapterMarks,
  cueText,
  indexAt,
  odometerDigits,
  recallMedia,
  sentenceStartFrames,
  shotCap,
  structureLine,
  structureSummary,
  titleDropWindow,
  yearAt,
} from "../src/render/structure.ts";
import {
  buildLongPlan,
  momentWindows,
  type LongPlan,
} from "../src/render/longplan.ts";
import type { Segment } from "../src/render/timeline.ts";

const loop = (question: string, plant: number, payoff: number): OpenLoop => ({
  question,
  plant_chapter: plant,
  payoff_chapter: payoff,
});

// ---------------------------------------------------------------- open loops

test("open loops: only real questions, answered at least a chapter later and never in chapter 1, spread out", () => {
  const r = groundOpenLoops(
    [
      loop("Why did Rockstar move the series to Miami?", 0, 3),
      loop("Who paid for the Vice City soundtrack licences?", 2, 4),
      loop("This is not a question at all.", 1, 3),
      loop("Why?", 1, 3),
      loop("What did the first trailer show?", 0, 1),
      loop("What did the leak reveal about the map?", 3, 3),
      loop("How did the studio survive the lawsuit?", 2, 5),
      loop("Why did Rockstar move the series to Miami?", 1, 5),
      loop("What did the sales figures look like in Japan?", 4, 9),
      loop("Why did the cocaine scene get cut from the game?", 1, 4),
    ],
    6,
  );
  assert.deepEqual(
    r.loops.map((l) => l.question),
    [
      "Why did Rockstar move the series to Miami?",
      "Who paid for the Vice City soundtrack licences?",
    ],
  );
  const why = r.removed.join("\n");
  assert.match(why, /not a question/);
  assert.match(why, /"Why\?": 1 words/);
  assert.match(why, /answered in chapter 1, too soon/);
  assert.match(why, /answered in chapter 3, too soon/);
  assert.match(why, /chapter 2 already raises one/);
  assert.match(why, /asked twice/);
  assert.match(why, /answered in chapter 9/);
  assert.match(why, /advertiser-unfriendly/);
  assert.deepEqual(groundOpenLoops(undefined, 6), { loops: [], removed: [] });
});

test("open loops: at most four, and the cold open may raise two", () => {
  const r = groundOpenLoops(
    [
      loop("Why did the studio leave Dundee for good?", 0, 2),
      loop("Who designed the original police car chase?", 0, 3),
      loop("What happened to the third game's lost city?", 0, 4),
      loop("How did the radio stations get their music?", 1, 5),
      loop("Why did the sequel take five years to make?", 2, 6),
      loop("What did the critics say about the final game?", 3, 7),
    ],
    8,
  );
  assert.equal(r.loops.length, 4);
  assert.equal(r.loops.filter((l) => l.plant_chapter === 0).length, 2);
  assert.match(r.removed.join(), /cold open already raises one|too many/);
});

test("the writer is told what to raise and what to answer, chapter by chapter, and the outline gets the rule", () => {
  const loops = [
    loop("Why did Rockstar move the series to Miami?", 0, 3),
    loop("Who paid for the soundtrack licences?", 2, 4),
  ];
  assert.match(
    loopBrief(loops, 0),
    /Raise this open question in the cold open[^]*chapter 3 answers it[^]*Miami/,
  );
  assert.equal(loopBrief(loops, 1), "");
  assert.match(
    loopBrief(loops, 2),
    /Raise this open question in this chapter[^]*chapter 4 answers it/,
  );
  assert.match(
    loopBrief(loops, 3),
    /The cold open raised this question; answer it[^]*from the SOURCE[^]*Miami/,
  );
  assert.match(loopBrief(loops, 4), /Chapter 2 raised this question/);
  assert.match(OPEN_LOOP_RULE, /never chapter 1/);
});

test("plants and payoffs are found by their key words; teases count as plants, answers must be statements", () => {
  const q = "Why did Rockstar move Grand Theft Auto to Miami?";
  const ch = [
    "The studio was busy in 2001.",
    "So why would Rockstar take Grand Theft Auto to Miami at all?",
    "Rockstar moved Grand Theft Auto to Miami because the eighties crime films were set there.",
  ];
  assert.equal(findPlant(q, ch), 1);
  assert.equal(findPayoff(q, ch), 2);
  // A sentence that shares common words but not the name is no answer.
  assert.equal(
    loopMatch(
      "Why did it go home to Vice City?",
      "The story went on and you would go home richer.",
    ),
    0,
  );
  assert.ok(
    loopMatch(
      "Why did it go home to Vice City?",
      "After a decade away, the series was heading home to Vice City.",
    ) >= 2,
  );
  // A promise in the cold open is a plant only where promises are allowed.
  const intro = [
    "On April 4, 1995, a team in Dundee began.",
    "This is the story of how Rockstar went home to Vice City.",
  ];
  assert.equal(findPlant("Why did Rockstar go home to Vice City?", intro), -1);
  assert.equal(
    findPlant("Why did Rockstar go home to Vice City?", intro, true),
    1,
  );
  // A line inside a quotation never counts.
  assert.equal(
    findPayoff(q, ['"Rockstar moved Grand Theft Auto to Miami,', 'he said."']),
    -1,
  );
});

test("a chapter missing its plant or payoff is sent back with the question named", () => {
  const loops = [
    loop("Why did Rockstar move Grand Theft Auto to Miami?", 1, 3),
  ];
  const plain = ["The studio was busy in 2001.", "Sales were strong."];
  assert.match(
    loopProblems(plain, loops, 1).join(),
    /Raise the open question "Why did Rockstar move/,
  );
  assert.match(
    loopProblems(plain, loops, 3).join(),
    /Answer the question raised earlier/,
  );
  assert.deepEqual(
    loopProblems(
      ["So why would Rockstar take Grand Theft Auto to Miami?"],
      loops,
      1,
    ),
    [],
  );
  assert.deepEqual(loopProblems(plain, loops, 2), []);
});

test("loops are pinned to their sentences; one never raised or never answered is dropped", () => {
  const loops = [
    loop("Why did Rockstar move Grand Theft Auto to Miami?", 0, 2),
    loop("Who wrote the Vice City radio adverts?", 1, 3),
  ];
  const hook = [
    "In 2002 the neon arrived.",
    "This is the story of why Rockstar moved Grand Theft Auto to Miami.",
  ];
  const chapters = [
    ["The team was small.", "Nobody expected much."],
    ["Rockstar moved Grand Theft Auto to Miami because of Scarface."],
    ["The adverts were funny."],
  ];
  const r = placeOpenLoops(loops, hook, chapters);
  assert.deepEqual(r.placed, [
    {
      question: loops[0]!.question,
      plant: { entry: -1, moment: 1 },
      payoff: { entry: 1, moment: 0 },
    },
  ]);
  assert.match(r.removed.join(), /radio adverts[^]*never raised/);
});

test("an older script's loops come from its own questions, answered in a later chapter", () => {
  const hook = [
    "On April 4, 1995, a small team in Dundee started work.",
    "It's also the story of why it went home to Vice City.",
  ];
  const chapters = [
    [
      "Vice City was a hit in 2002.",
      "Could the radio carry a whole decade of music?",
    ],
    [
      "The radio stations of Vice City carried a whole decade of eighties music.",
      "Sales doubled.",
    ],
    ["The studio grew."],
    [
      "After a decade away, the series was heading home to Vice City.",
      "The end.",
    ],
  ];
  const got = deriveOpenLoops(hook, chapters);
  assert.deepEqual(got, [
    {
      question: "Why it went home to Vice City",
      plant: { entry: -1, moment: 1 },
      payoff: { entry: 3, moment: 0 },
    },
    {
      question: "Could the radio carry a whole decade of music?",
      plant: { entry: 0, moment: 1 },
      payoff: { entry: 1, moment: 0 },
    },
  ]);
  assert.equal(
    asQuestion("This is the story of how a cop game became a crime game."),
    "How a cop game became a crime game",
  );
  assert.equal(asQuestion("Why did it work?"), "Why did it work?");
});

test("the bookend ending: the outro's last two sentences must return to the cold open's first image", () => {
  const intro =
    "On April 4, 1995, a small team at DMA Design in Dundee started work on Race'n'Chase. It missed every milestone.";
  assert.deepEqual(
    bookendEchoProblems(
      intro,
      "It kept betting on scale. Work on GTA 6 began in 2014. Race'n'Chase was meant to wrap by July 1, 1996. Rockstar never minded deadlines.",
    ),
    [],
  );
  const p = bookendEchoProblems(
    intro,
    "Race'n'Chase was the start. It kept betting on scale. And it paid off every time.",
  );
  assert.equal(p.length, 1);
  assert.match(p[0]!, /end where the documentary began[^]*april|1995|dundee/i);
});

test("the owner's line names the loops or says there were none", () => {
  assert.match(openLoopsLine("GTA", [], 0), /planned none/);
  assert.match(openLoopsLine("GTA", [], 3), /3 planned, none made it/);
  assert.match(
    openLoopsLine(
      "GTA",
      [
        {
          question: "Why Miami?",
          plant: { entry: -1, moment: 0 },
          payoff: { entry: 2, moment: 4 },
        },
      ],
      2,
    ),
    /1 question raised early[^]*"Why Miami\?" from the cold open to chapter 3/,
  );
});

// ---------------------------------------------------------------- the documentary writer, wired

test("the outline lists loops only when asked; chapters and bookends carry them; validation checks them", async () => {
  const doc = await import("../src/editorial/documentary.ts");
  const seen: string[] = [];
  const llm = {
    structured: async (o: { system: string; content: string }) => {
      seen.push(o.system, o.content);
      return {};
    },
  } as never;
  const topic = {
    kind: "franchise",
    franchise: "GTA",
    title_idea: "t",
    angle: "a",
  } as never;
  await doc.outlineDoc(llm, topic, "notes");
  assert.doesNotMatch(seen[0]!, /Open loops/);
  seen.length = 0;
  await doc.outlineDoc(llm, topic, "notes", { openLoops: true });
  assert.match(seen[0]!, /Open loops: in "open_loops"/);
  const plan = {
    chapter_title: "c",
    game_title: "GTA III",
    wiki_title: "w",
    steam_search_term: "",
    year: 2001,
    platforms: "PS2",
    focus: "f",
    photo_searches: [],
  };
  const outline = { title: "GTA", chapters: [plan, plan, plan] } as never;
  const loops = [
    loop("Why did Rockstar move Grand Theft Auto to Miami?", 0, 3),
  ];
  seen.length = 0;
  await doc.writeChapter(llm, {
    franchise: "GTA",
    plan,
    index: 2,
    outline,
    source: { title: "s", url: "u", text: "t" },
    loops,
  });
  assert.match(
    seen[1]!,
    /Open loops[^]*The cold open raised this question; answer it/,
  );
  seen.length = 0;
  await doc.writeBookends(llm, outline, [], "notes", {
    loops,
    echo: true,
    feedback: ["Fix the echo."],
  });
  assert.match(seen[0]!, /End where it began/);
  assert.match(seen[1]!, /Raise this open question in the cold open/);
  assert.match(seen[1]!, /A previous draft was rejected[^]*Fix the echo/);
  seen.length = 0;
  await doc.writeBookends(llm, outline, [], "notes");
  assert.doesNotMatch(seen[0]!, /End where it began/);
  // The chapter that should answer and does not is sent back.
  const para = (narration: string) => ({
    narration,
    callout: { kind: "none" as const, primary: "", secondary: "" },
    footage: { want: "gameplay" as const, keywords: [] },
  });
  const chapter = {
    paragraphs: [para("The studio was busy in 2001 and sales were strong.")],
    claims: [],
  };
  assert.ok(
    doc
      .validateChapter(chapter as never, { loops, chapter: 3 })
      .some((p) => /Answer the question raised earlier/.test(p)),
  );
  assert.ok(
    !doc
      .validateChapter(chapter as never, { loops, chapter: 2 })
      .some((p) => /question/.test(p)),
  );
  assert.ok(
    !doc
      .validateChapter(chapter as never)
      .some((p) => /question raised/.test(p)),
  );
  const bookends = {
    intro: {
      narration:
        "On April 4, 1995, a team in Dundee started work. It went badly.",
      on_screen: "x",
    },
    outro: {
      label: "L",
      narration: "It kept betting on scale. It paid off.",
      on_screen: "y",
    },
  };
  assert.ok(
    doc
      .validateBookends(bookends, { echo: true })
      .some((p) => /end where the documentary began/.test(p)),
  );
  assert.ok(
    doc
      .validateBookends(bookends, { loops })
      .some((p) => /Raise the open question/.test(p)),
  );
  assert.ok(
    !doc.validateBookends(bookends).some((p) => /began|open question/.test(p)),
  );
});

test("placeDocLoops maps the outline's chapters onto the draft's, past a chapter dropped for want of a source", async () => {
  const doc = await import("../src/editorial/documentary.ts");
  const plan = (n: number) => ({
    chapter_title: `c${n}`,
    game_title: `G${n}`,
    wiki_title: "w",
    steam_search_term: "",
    year: 2000 + n,
    platforms: "PC",
    focus: "f",
    photo_searches: [],
  });
  const plans = [plan(1), plan(2), plan(3)];
  const para = (narration: string) => ({
    narration,
    callout: { kind: "none" as const, primary: "", secondary: "" },
    footage: { want: "gameplay" as const, keywords: [] },
  });
  const draft = {
    outline: { chapters: plans },
    // Chapter 2 had no source and was dropped: the draft's entry 1 is the outline's chapter 3.
    chapters: [
      {
        plan: plans[0]!,
        chapter: {
          paragraphs: [para("The team began in Dundee.")],
          claims: [],
        },
      },
      {
        plan: plans[2]!,
        chapter: {
          paragraphs: [
            para("It went well."),
            para("Rockstar moved Grand Theft Auto to Miami for the neon."),
          ],
          claims: [],
        },
      },
    ],
    bookends: {
      intro: {
        narration:
          "In 1995 it began. So why would Rockstar take Grand Theft Auto to Miami?",
        on_screen: "",
      },
      outro: { label: "", narration: "", on_screen: "" },
    },
  } as never;
  const r = doc.placeDocLoops(draft, [
    loop("Why did Rockstar move Grand Theft Auto to Miami?", 0, 3),
    loop("Why did the team leave Dundee behind?", 1, 2),
  ]);
  assert.deepEqual(r.placed, [
    {
      question: "Why did Rockstar move Grand Theft Auto to Miami?",
      plant: { entry: -1, moment: 1 },
      payoff: { entry: 1, moment: 1 },
    },
  ]);
  assert.equal(r.removed.length, 1);
});

// ---------------------------------------------------------------- the render's structure

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
const chapterVisual = (n: number, title: string, year: string) => ({
  kind: "chapter" as const,
  primary: title,
  secondary: `Game ${n}`,
  value_a: n,
  items: [year, "PC"],
});
/** A short documentary: a 60 s cold open, a 4 s breather, three chapters of 120 s, a 30 s outro. */
function sampleDoc(): Segment[] {
  return [
    seg(
      "hook",
      "On April 4, 1995, a team began. It was slow. Nobody could finish it.",
      0,
      60,
    ),
    seg(
      "beat",
      "The first chapter opens. It goes on. And on. It ends.",
      64,
      184,
      chapterVisual(1, "The Tabloid Storm", "1997"),
    ),
    seg(
      "beat",
      "The second chapter opens. It goes on. And on. It ends.",
      184,
      304,
      chapterVisual(2, "The Leap to 3D", "2001"),
    ),
    seg(
      "beat",
      "The third chapter opens. It goes on. And on. It ends.",
      304,
      424,
      chapterVisual(3, "Back to Vice City", "2026"),
    ),
    seg("take", "So that was it. Dundee started it all.", 424, 454),
  ];
}
/** Even word timings across each segment, as the voice would give. */
function wordsOf(segments: Segment[]) {
  return segments.flatMap((s) => {
    const ws = s.text.split(/\s+/).filter(Boolean);
    const step = (s.end - s.start - 1) / ws.length;
    return ws.map((text, i) => ({
      text,
      start: s.start + i * step,
      end: s.start + (i + 0.8) * step,
    }));
  });
}

test("the title drops on the cold open's last beat: through the first breather, else over the last sentence", () => {
  const segments = sampleDoc();
  const words = wordsOf(segments);
  // The breather opens the first chapter (openChaptersAtBreaks): the hook ends where it begins.
  const opened = segments.map((s, i) => (i === 1 ? { ...s, start: 60 } : s));
  const withBreak = titleDropWindow(opened, words, 30, [
    { from: 1800, to: 1920 },
  ]);
  assert.deepEqual(withBreak, {
    from: 1785,
    len: 135,
    landAt: 15,
    breakSegment: 1,
  });
  const without = titleDropWindow(segments, words, 30, []);
  const lastStart = sentenceStartFrames(segments[0]!, 64, words, 30).at(-1)!;
  assert.ok(without);
  assert.equal(without.from + without.len, 64 * 30);
  assert.equal(without.from, Math.max(lastStart, 64 * 30 - 180));
  assert.equal(without.breakSegment, undefined);
  // A cold open too short to carry it after the opening has none.
  assert.equal(
    titleDropWindow(
      [
        seg("hook", "Short.", 0, 8),
        seg("beat", "x", 8, 20, chapterVisual(1, "t", "2001")),
      ],
      [],
      30,
    ),
    undefined,
  );
  assert.equal(titleDropWindow([seg("beat", "x", 0, 20)], [], 30), undefined);
});

test("the chapter index lights the current chapter, hides in breathers and the outro, and the year rolls", () => {
  const segments = sampleDoc();
  const starts = segments.map((s, i) =>
    i === 0 ? 0 : Math.round(s.start * 30),
  );
  const marks = chapterMarks(segments, starts, 454 * 30, [
    { from: 184 * 30, to: 188 * 30 },
  ]);
  assert.deepEqual(
    marks.map((m) => [m.number, m.from, m.shownFrom, m.to, m.year]),
    [
      [1, 1920, 1920, 5520, 1997],
      [2, 5520, 5640, 9120, 2001],
      [3, 9120, 9120, 12720, 2026],
    ],
  );
  assert.deepEqual(indexAt(marks, 100), { current: -1, opacity: 0 }); // the cold open
  assert.deepEqual(indexAt(marks, 2400), { current: 0, opacity: 1 });
  assert.equal(indexAt(marks, 5560).opacity, 0); // chapter 2's breather
  assert.equal(indexAt(marks, 5646).opacity, 0.5); // fading back in
  assert.deepEqual(indexAt(marks, 13000), { current: -1, opacity: 0 }); // the outro
  assert.equal(indexAt(marks, 9500, 9400).opacity, 0); // the end card
  const y = yearAt(marks, 5640 + 12)!;
  assert.deepEqual([y.year, y.from, y.roll], [2001, 1997, 0.5]);
  assert.equal(yearAt(marks, 100), undefined);
  assert.equal(yearAt(marks, 2400)!.from, 1997); // the first chapter has nothing to roll from
  // The odometer: unchanged digits stay, the rightmost moves first.
  const d = odometerDigits(1997, 2001, 0.3);
  assert.deepEqual(
    d.map((x) => [x.out, x.in]),
    [
      ["1", "2"],
      ["9", "0"],
      ["9", "0"],
      ["7", "1"],
    ],
  );
  assert.ok(d[3]!.t > d[0]!.t);
  assert.deepEqual(
    odometerDigits(2013, 2013, 0).map((x) => x.t),
    [1, 1, 1, 1],
  );
  // A chapter with no real year shows none.
  const odd = chapterMarks(
    [seg("beat", "x", 0, 10, chapterVisual(1, "t", "TBA"))],
    [0],
    300,
  );
  assert.equal(odd[0]!.year, undefined);
});

test("a callback recalls the question's shot when it is answered, never too soon and never two at once", () => {
  const segments = sampleDoc();
  const words = wordsOf(segments);
  const windows = momentWindows(segments, words, [4, 4, 4]);
  const loops = [
    {
      question: "Why did nobody finish it?",
      plant: { entry: -1, moment: 2 },
      payoff: { entry: 1, moment: 2 },
    },
    {
      question: "Too soon",
      plant: { entry: 0, moment: 3 },
      payoff: { entry: 1, moment: 0 },
    },
    {
      question: "Same moment",
      plant: { entry: -1, moment: 0 },
      payoff: { entry: 1, moment: 2 },
    },
    {
      question: "Nowhere",
      plant: { entry: 5, moment: 0 },
      payoff: { entry: 2, moment: 1 },
    },
  ];
  const cues = callbackCues(loops, segments, words, windows, 30);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]!.text, "Why did nobody finish it?");
  const w = windows.find((x) => x.entry === 1 && x.moment === 2)!;
  assert.equal(cues[0]!.from, Math.round(w.at * 30));
  assert.equal(cues[0]!.len, 120);
  assert.equal(callbackCues(undefined, segments, words, windows, 30).length, 0);
  const long = cueText(
    "Why did a studio that had never made a game set in a real place choose to rebuild the whole of Miami?",
  );
  assert.ok(long.length <= 81 && long.endsWith("..."));
  const plan: LongPlan = {
    version: 1,
    fps: 30,
    totalFrames: 300,
    tailFrames: 0,
    shots: [
      {
        start: 0,
        end: 100,
        segment: 0,
        media: { type: "plate", index: 0 },
        move: "pushIn",
      },
      {
        start: 100,
        end: 300,
        segment: 0,
        media: { type: "clip", index: 2 },
        move: "pushIn",
      },
    ],
  };
  assert.equal(recallMedia(plan, 50), undefined);
  assert.deepEqual(recallMedia(plan, 160), {
    media: { type: "clip", index: 2 },
    offset: 60,
  });
});

test("cut rhythm: tighter shots in the first three minutes, five-cut bursts later, clear of chapter openings", () => {
  const bursts = burstWindows(30 * 60 * 30, 30, [330 * 30 + 60]);
  // 5:30 runs into a chapter opening at 5:32, so it moves past it; then every 2.5 minutes.
  assert.deepEqual(bursts.slice(0, 3), [
    { from: 344 * 30, to: 354 * 30 },
    { from: 480 * 30, to: 490 * 30 },
    { from: 630 * 30, to: 640 * 30 },
  ]);
  assert.ok(bursts.every((b) => b.to <= 30 * 60 * 30 - 900));
  assert.deepEqual(shotCap(100, 30, bursts), {
    still: RHYTHM_OPEN_STILL,
    clip: RHYTHM_OPEN_CLIP,
  });
  assert.deepEqual(shotCap(345 * 30, 30, bursts), {
    still: BURST_SHOT,
    clip: BURST_SHOT,
  });
  assert.equal(shotCap(400 * 30, 30, bursts).still, Number.POSITIVE_INFINITY);
});

test("the plan follows the rhythm when asked: no still over 4 s in the first minutes, more cuts in a burst", () => {
  // Ten minutes of one chapter on stills alone (no shot list), so the caps are all that change.
  const segments: Segment[] = [
    seg("hook", "Open.", 0, 30),
    seg("beat", "One long chapter.", 30, 600, chapterVisual(1, "t", "2001")),
  ];
  const words = wordsOf(segments);
  const images = Array.from({ length: 12 }, (_, k) => ({
    kind: "screenshot",
    aspect: 1.78,
    beatIndex: k < 2 ? undefined : 0,
  }));
  const base = {
    segments,
    words,
    durationSeconds: 606,
    images,
    clips: [],
    variant: 0,
  };
  const plain = buildLongPlan(base);
  const tuned = buildLongPlan({ ...base, rhythm: true });
  const early = (p: LongPlan) => p.shots.filter((s) => s.start < 170 * 30);
  assert.ok(early(plain).some((s) => s.end - s.start > 120));
  assert.ok(early(tuned).every((s) => s.end - s.start <= 120 + 60));
  assert.ok(early(tuned).length > early(plain).length);
  const b = burstWindows(tuned.totalFrames, 30, [30 * 30])[0]!;
  const inBurst = (p: LongPlan) =>
    p.shots.filter((s) => s.start >= b.from && s.start < b.to).length;
  assert.ok(inBurst(tuned) >= 4, `only ${inBurst(tuned)} cuts in the burst`);
  assert.ok(inBurst(tuned) > inBurst(plain));
  // After the opening and outside a burst the usual 5-8 s stills return.
  assert.ok(
    tuned.shots.some((s) => s.start > 200 * 30 && s.end - s.start >= 150),
  );
});

test("the bookend: the last shot is the cold open's first picture with the move reversed", () => {
  const segments = sampleDoc();
  const words = wordsOf(segments);
  const plan: LongPlan = {
    version: 1,
    fps: 30,
    totalFrames: 460 * 30,
    tailFrames: 180,
    shots: [
      {
        start: 0,
        end: 90,
        segment: 0,
        media: { type: "image", index: 7 },
        move: "settle",
      },
      {
        start: 90,
        end: 600,
        segment: 0,
        media: { type: "clip", index: 3 },
        move: "pushIn",
      },
      {
        start: 600,
        end: 1920,
        segment: 0,
        media: { type: "image", index: 1 },
        move: "pushIn",
      },
      {
        start: 12720,
        end: 13500,
        segment: 4,
        media: { type: "image", index: 9 },
        move: "driftDown",
      },
      {
        start: 13500,
        end: 13800,
        segment: 4,
        media: { type: "image", index: 10 },
        move: "pushPan",
      },
    ],
  };
  const lastWord = Math.round(words.at(-1)!.end * 30);
  // The clip after the 3 s opening card is long enough: it returns, pulling back where it pushed in.
  const echo = bookendEcho(plan, segments, words, [0, 0, 0, 900], 90);
  const last = echo.shots.at(-1)!;
  assert.deepEqual(last.media, { type: "clip", index: 3 });
  assert.equal(last.move, "pullBack");
  assert.equal(last.end, 460 * 30);
  assert.equal(last.start, lastWord - 120);
  assert.equal(echo.shots.at(-2)!.end, last.start);
  // Too short a clip gives way to the cold open's first still.
  assert.deepEqual(
    bookendEcho(plan, segments, words, [0, 0, 0, 100], 90).shots.at(-1)!.media,
    { type: "image", index: 7 },
  );
  // No outro, no change.
  assert.equal(
    bookendEcho(plan, segments.slice(0, 4), words, [0, 0, 0, 900], 90),
    plan,
  );
  // buildLongPlan applies it only when asked.
  const images = [
    { kind: "hero", aspect: 1.78 },
    { kind: "screenshot", aspect: 1.78, beatIndex: 0 },
    { kind: "screenshot", aspect: 1.78, beatIndex: 1 },
    { kind: "screenshot", aspect: 1.78, beatIndex: 2 },
  ];
  const base = {
    segments,
    words,
    durationSeconds: 460,
    images,
    clips: [],
    variant: 0,
  };
  const built = buildLongPlan({ ...base, bookend: true });
  const hookFirst = built.shots.find((s) => s.segment === 0)!;
  assert.deepEqual(built.shots.at(-1)!.media, hookFirst.media);
  assert.notDeepEqual(buildLongPlan(base).shots.at(-1)!.media, hookFirst.media);
});

test("the structure summary and the owner's line say what the video will show", () => {
  const segments = sampleDoc();
  const words = wordsOf(segments);
  const windows = momentWindows(segments, words, [4, 4, 4]);
  const plan = buildLongPlan({
    segments,
    words,
    durationSeconds: 460,
    images: [{ kind: "hero", aspect: 1.78 }],
    clips: [],
    variant: 0,
    bookend: true,
  });
  const loops = [
    {
      question: "Why did nobody finish it?",
      plant: { entry: -1, moment: 2 },
      payoff: { entry: 1, moment: 2 },
    },
  ];
  const on = {
    titleDrop: true,
    chapterIndex: true,
    loops: true,
    rhythm: true,
    bookend: true,
  };
  const s = structureSummary({
    segments,
    words,
    windows,
    fps: 30,
    breaks: [],
    loops,
    plan,
    on,
  });
  assert.deepEqual(s, {
    titleDrop: true,
    chapters: 3,
    years: 3,
    callbacks: 1,
    bursts: 1,
    bookend: true,
    ranks: 0,
    entryBursts: 0,
  });
  const line = structureLine("GTA", s);
  assert.match(
    line,
    /title lands after the cold open[^]*3-chapter index with the year[^]*1 callback when[^]*1 short burst[^]*returns to the opening picture/,
  );
  const off = structureSummary({
    segments,
    words,
    windows,
    fps: 30,
    breaks: [],
    loops,
    plan,
    on: {
      titleDrop: false,
      chapterIndex: false,
      loops: false,
      rhythm: false,
      bookend: false,
    },
  });
  assert.deepEqual(off, {
    titleDrop: false,
    chapters: 0,
    years: 0,
    callbacks: 0,
    bursts: 0,
    bookend: false,
    ranks: 0,
    entryBursts: 0,
  });
  assert.match(
    structureLine("GTA", off),
    /none of the structure devices apply/,
  );
});
