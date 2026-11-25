// The long-video opening contract (LONG_OPENING_CONTRACT, top creator gap plan gap 3, 18 Nov 2026): the first line serves
// the title, the title's question by word 40, one finish line, a 90-word opening, a dated source quote where one exists,
// hand-overs by contrast and two honest takes a chapter. Every count is pure; the judge is the only model call.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FINISH_PLANT_SECONDS,
  OPENING_WORDS_MAX,
  buyerFramingProblems,
  contractChapterRule,
  contractMode,
  contractOpeningRule,
  contractReport,
  datedQuotesIn,
  feelingOf,
  finishLineOf,
  finishLineProblems,
  handoversOf,
  isBuyerGuide,
  longDocOfScript,
  openingLengthProblems,
  questionAt,
  questionProblems,
  quoteOpeningProblems,
  sameIdeaAsTitle,
  secondsAt,
  takeProblems,
  takesIn,
  takesPerChapter,
  withJudgement,
  type LongDoc,
} from "../src/editorial/longcontract.ts";
import {
  groundFinishLine,
  placeOpenLoops,
  type OpenLoop,
} from "../src/editorial/openloops.ts";
import { contractRules, openingQuotes } from "../src/longcontractstep.ts";
import { NO_LONG_RULES } from "../src/editorial/longrules.ts";
import type { Script } from "../src/editorial/schema.ts";

const words = (n: number, w = "word") =>
  Array.from({ length: n }, () => w).join(" ");

// The real San Andreas opening (ep_20261107_8561a5da, 7 Nov 2026), as published.
const SAN_ANDREAS_HOOK =
  "Grove Street can pull you back to Grand Theft Auto San Andreas, but a familiar city can mislead your next purchase. You need more than an address. Why didn't CJ's story continue in Rockstar's next GTA? San Andreas was originally planned as three maps linked by public transport. A modder in the Netherlands used a hex editor to unlock hidden content. Grand Theft Auto 4 paired a smaller city with a budget above $100 million. Grand Theft Auto 5 left San Fierro and Las Venturas out of its return. We've checked the published development history, release dates, map changes and story continuity. Last, we'll reach CJ's return and see exactly what Rockstar brought back for you. The answer starts with extra time. Rockstar North had room to experiment.";

test("modes: off, check and fix; anything else is off", () => {
  assert.equal(contractMode("fix"), "fix");
  assert.equal(contractMode(" CHECK "), "check");
  assert.equal(contractMode("on"), "off");
  assert.equal(contractMode(undefined), "off");
});

test("the first sentence: buyer framing is flagged on a history, allowed on a buyer's guide", () => {
  const p = buyerFramingProblems(
    SAN_ANDREAS_HOOK,
    "Why San Andreas Never Got a Sequel",
    "documentary",
  );
  assert.equal(p.length, 1);
  assert.match(p[0]!, /purchase/);
  assert.deepEqual(
    buyerFramingProblems(
      SAN_ANDREAS_HOOK,
      "GTA 6 Before You Buy",
      "documentary",
    ),
    [],
  );
  assert.deepEqual(
    buyerFramingProblems(
      "Your console's storage screen could decide your launch night.",
      "Anything",
      "guide",
    ),
    [],
  );
  assert.ok(isBuyerGuide("Is the Deluxe Edition Worth It?", "documentary"));
  assert.ok(
    !isBuyerGuide("How Final Fantasy XIV Survived Its Shutdown", "documentary"),
  );
  assert.deepEqual(
    buyerFramingProblems(
      "In 2010, Square Enix shipped a game it would later apologise for.",
      "How Final Fantasy XIV Survived",
      "documentary",
    ),
    [],
  );
});

test("the central question: where it lands and whether it is the title's", () => {
  const q = questionAt(SAN_ANDREAS_HOOK)!;
  assert.equal(
    q.question,
    "Why didn't CJ's story continue in Rockstar's next GTA?",
  );
  assert.ok(q.words > 20 && q.words < 40, `question at word ${q.words}`);
  assert.ok(
    sameIdeaAsTitle(
      "Why did Rockstar never make a San Andreas sequel?",
      "Why San Andreas Never Got a Sequel",
    ),
  );
  assert.ok(
    !sameIdeaAsTitle(
      "What did the hex editor unlock?",
      "Why San Andreas Never Got a Sequel",
    ),
  );
  // Late: a question at word 50 fails the position.
  const late = `${words(45)}. Why did San Andreas never get a sequel?`;
  assert.match(
    questionProblems(late, "Why San Andreas Never Got a Sequel").join(" "),
    /by word 40/,
  );
  assert.deepEqual(questionProblems(SAN_ANDREAS_HOOK, "Why San Andreas Never Got a Sequel"), []);
  assert.match(
    questionProblems("No question here at all.", "Anything Goes").join(" "),
    /never asks/,
  );
  assert.deepEqual(
    questionProblems(
      "Why did San Andreas never get a sequel? Here's how.",
      "Why San Andreas Never Got a Sequel",
    ),
    [],
  );
  // A question inside someone's quote is not the narrator asking it.
  assert.equal(
    questionAt('He said "why bother?" and left. Nothing else.'),
    undefined,
  );
});

test("opening length: 90 words, or 140 only with one of the source's full dated quotes", () => {
  assert.deepEqual(openingLengthProblems(words(OPENING_WORDS_MAX)), []);
  assert.match(openingLengthProblems(words(128)).join(" "), /128 words/);
  const dated = [{ quote: "we wanted the whole state in one box", sentence: "In 2004 Sam Houser said it." }];
  const quoted = `In 2004, Sam Houser said "we wanted the whole state in one box". ${words(90)}`;
  assert.deepEqual(openingLengthProblems(quoted, dated), []);
  // A quote that isn't the source's dated one earns nothing; nor does any quote when the sources aren't known.
  assert.match(openingLengthProblems(quoted).join(" "), /keep it to 90/);
  const short = `Rockstar called it "a love letter". ${words(100)}`;
  assert.match(openingLengthProblems(short, dated).join(" "), /keep it to 90/);
});

test("dated quotes: only quotations in a dated sentence with a speaking verb, never made up", () => {
  const src =
    'The game shipped in 2004. In a 2004 interview, Sam Houser said "we wanted to make the whole state feel alive at once" about the design. Fans called it "the best one" online. In March 2005 Leslie Benzies told Edge "it was never meant to be a trilogy of cities" and moved on.';
  const q = datedQuotesIn(src);
  assert.equal(q.length, 2);
  assert.equal(
    q[0]!.quote,
    "we wanted to make the whole state feel alive at once",
  );
  const hook =
    'In 2004, Sam Houser said "we wanted to make the whole state feel alive at once". Why did that state never come back?';
  assert.deepEqual(quoteOpeningProblems(hook, q), []);
  assert.match(
    quoteOpeningProblems("Why did that state never come back?", q).join(" "),
    /word for word/,
  );
  assert.deepEqual(quoteOpeningProblems("Anything at all.", []), []);
  assert.equal(openingQuotes([src, src]).length, 2);
});

const doc = (o: Partial<LongDoc> = {}): LongDoc => ({
  title: "Why San Andreas Never Got a Sequel",
  kind: "documentary",
  hook: "Why did San Andreas never get a sequel? The answer took a decade.",
  chapters: [
    { title: "One", text: `${words(300)}. The launch was a triumph.` },
    {
      title: "Two",
      text: `But the cost was a delay. ${words(300)}. It sold millions.`,
    },
    {
      title: "Three",
      text: `The success was a hit. ${words(300)}. So did San Andreas ever get a sequel? It never did, and here is why.`,
    },
  ],
  outro: "And that's where it ends.",
  ...o,
});

test("the finish line: planted before 1:30, paid in the last 15%", () => {
  const d = doc({
    loops: [
      {
        question: "Why did San Andreas never get a sequel?",
        plant: { entry: -1, moment: 0 },
        payoff: { entry: 2, moment: 2 },
        finish: true,
      },
    ],
  });
  const f = finishLineOf(d)!;
  assert.ok(f.plantSeconds < FINISH_PLANT_SECONDS);
  assert.ok(f.payShare > 0.85, `paid at ${f.payShare}`);
  assert.deepEqual(finishLineProblems(d), []);
  // Paid in the middle: flagged.
  const mid = doc({
    loops: [
      {
        question: "Why?",
        plant: { entry: -1, moment: 0 },
        payoff: { entry: 1, moment: 0 },
        finish: true,
      },
    ],
  });
  assert.match(finishLineProblems(mid).join(" "), /last 15%/);
  // No loop at all.
  assert.match(finishLineProblems(doc()).join(" "), /No finish line/);
  // An older script: the cold open's loop paid last stands in for it.
  const old = doc({
    loops: [
      {
        question: "A?",
        plant: { entry: -1, moment: 0 },
        payoff: { entry: 1, moment: 0 },
      },
      {
        question: "B?",
        plant: { entry: -1, moment: 1 },
        payoff: { entry: 2, moment: 2 },
      },
    ],
  });
  assert.equal(finishLineOf(old)!.question, "B?");
});

test("timing: word timings when there are some, 150 words a minute when not", () => {
  const d = doc();
  assert.equal(secondsAt(d, 150), 60);
  const n = [d.hook, ...d.chapters.map((c) => c.text), d.outro]
    .join(" ")
    .split(/\s+/).length;
  const timed = { ...d, times: Array.from({ length: n }, (_, i) => i * 0.5) };
  assert.equal(secondsAt(timed, 100), 50);
});

test("hand-overs: opposite feelings across a seam, same feeling flagged, unclear left to the judge", () => {
  assert.equal(feelingOf("The launch was a triumph."), 1);
  assert.equal(feelingOf("But the cost was a delay."), -1);
  assert.equal(feelingOf("The office opened in Edinburgh."), 0);
  const h = handoversOf(doc());
  assert.equal(h[0]!.contrast, true); // triumph -> cost
  assert.equal(h[1]!.contrast, false); // sold millions -> success was a hit
});

test("takes: the narrator's own first person, quoted people never count", () => {
  assert.equal(
    takesIn(
      'I think that was the right call. He said "I quit" and left. I\'d have done the same.',
    ).length,
    2,
  );
  assert.equal(takesIn("Rockstar made the call. It worked.").length, 0);
  assert.match(
    takeProblems("Rockstar made the call.").join(" "),
    /0 honest first-person takes/,
  );
  assert.deepEqual(
    takeProblems("I think it worked. I'll be honest, it stung."),
    [],
  );
  assert.deepEqual(takesPerChapter(doc()), [0, 0, 0]);
});

test("the report: San Andreas as published fails on framing, length, finish line and takes", () => {
  const r = contractReport({
    title: "Why San Andreas Never Got a Sequel",
    kind: "documentary",
    hook: SAN_ANDREAS_HOOK,
    chapters: [
      { title: "a", text: "Rockstar shipped it." },
      { title: "b", text: "It sold." },
    ],
    outro: "End.",
  });
  assert.equal(r.pass, false);
  const all = r.problems.join("\n");
  assert.match(all, /purchase/);
  assert.match(all, /128 words|12\d words/);
  assert.match(all, /No finish line/);
  assert.match(all, /Chapter 1 has 0/);
  assert.equal(r.measures.hookWords, 128);
  // A ranking is not asked for a question or a finish line, nor takes per entry.
  const rank = contractReport({
    title: "Every GTA Ranked",
    kind: "ranking",
    hook: "Eleven games.",
    chapters: [],
    outro: "",
  });
  assert.equal(rank.pass, true);
});

test("the judge's word joins the report: its failures are problems, its seams win", () => {
  const r = contractReport(
    doc({
      loops: [
        {
          question: "Why?",
          plant: { entry: -1, moment: 0 },
          payoff: { entry: 2, moment: 2 },
          finish: true,
        },
      ],
    }),
  );
  const j = withJudgement(r, {
    first_line_serves_title: false,
    question_is_title: true,
    handovers: [{ after: 1, contrast: false }],
    reasons: [],
  });
  assert.match(j.problems.join(" "), /Judge: the first sentence/);
  assert.match(j.problems.join(" "), /Chapters 1 and 2/);
  assert.equal(j.measures.handovers[0]!.judge, false);
});

test("a stored script as the contract reads it: chapters at chapter beats, entries at rank beats", () => {
  const base = {
    hook: "Why?",
    youtube: { title: "T", thumb_text: "BEST: V" },
    pulse_take: { narration: "Out." },
  };
  const docScript = {
    ...base,
    beats: [
      { narration: "One a.", visual: { kind: "chapter", primary: "C1" } },
      { narration: "One b." },
      { narration: "Two a.", visual: { kind: "chapter", primary: "C2" } },
    ],
  } as unknown as Script;
  const d = longDocOfScript(docScript, { words: [{ start: 0 }, { start: 1 }] });
  assert.deepEqual(
    d.chapters.map((c) => [c.title, c.text]),
    [
      ["C1", "One a. One b."],
      ["C2", "Two a."],
    ],
  );
  assert.equal(d.outro, "Out.");
  assert.equal(d.thumbText, "BEST: V");
  assert.deepEqual(d.times, [0, 1]);
  const rank = longDocOfScript({
    ...base,
    beats: [
      {
        narration: "Ten.",
        visual: { kind: "rank", primary: "GTA 2", value_a: 2 },
      },
      {
        narration: "One.",
        visual: { kind: "rank", primary: "GTA 5", value_a: 1 },
      },
    ],
  } as unknown as Script);
  assert.equal(rank.kind, "ranking");
  assert.deepEqual(
    rank.chapters.map((c) => c.rank),
    [2, 1],
  );
});

test("finish line grounding: one mark, raised in the cold open and paid in the last chapter, kept through placement", () => {
  const loops: OpenLoop[] = [
    {
      question: "Why did San Andreas never get a sequel?",
      plant_chapter: 0,
      payoff_chapter: 6,
      finish_line: true,
    },
    {
      question: "Why did Rockstar drop the three cities?",
      plant_chapter: 1,
      payoff_chapter: 4,
      finish_line: true,
    },
  ];
  const g = groundFinishLine(loops, 6);
  assert.equal(g.loops[0]!.finish_line, true);
  assert.equal(g.loops[1]!.finish_line, undefined);
  assert.match(g.removed.join(" "), /a second one/);
  const wrong = groundFinishLine(
    [
      {
        question: "Q?",
        plant_chapter: 2,
        payoff_chapter: 3,
        finish_line: true,
      },
    ],
    6,
  );
  assert.equal(wrong.loops[0]!.finish_line, undefined);
  assert.match(wrong.removed.join(" "), /chapter 2/);
  // Placement carries the mark onto the script's loop.
  const placed = placeOpenLoops(
    [
      {
        question: "Why did San Andreas never get a sequel?",
        plant_chapter: 0,
        payoff_chapter: 2,
        finish_line: true,
      },
    ],
    ["Why did San Andreas never get a sequel?"],
    [
      ["Rockstar moved on."],
      [
        "San Andreas never got a sequel because Rockstar rebooted the universe.",
      ],
    ],
  );
  assert.equal(placed.placed[0]!.finish, true);
});

test("the rules a contract adds: fix only; claims only with LONG_ARGUES on fix", () => {
  const base = { ...NO_LONG_RULES, hookStack: 5 };
  assert.deepEqual(
    contractRules(base, { contract: "off", argues: "off" }),
    base,
  );
  assert.deepEqual(
    contractRules(base, { contract: "check", argues: "check" }),
    base,
  );
  const fix = contractRules(base, { contract: "fix", argues: "off" });
  assert.equal(fix.contract, true);
  assert.equal(fix.hookStack, 0);
  assert.equal(fix.takesMin, 2);
  assert.equal(
    contractRules(base, { contract: "off", argues: "fix", format: "claims" })
      .claims,
    true,
  );
  // "check" records and changes no writing (review, 25 Nov 2026).
  assert.equal(
    contractRules(base, { contract: "off", argues: "check", format: "claims" })
      .claims,
    undefined,
  );
  assert.equal(
    contractRules(base, { contract: "off", argues: "off", format: "claims" })
      .claims,
    undefined,
  );
});

test("the writers' rules: no buyer framing unless it's a buyer's guide; quotes offered word for word", () => {
  const r = contractOpeningRule({
    title: "Why San Andreas Never Got a Sequel",
    buyer: false,
    quotes: [{ quote: "a b c d e", sentence: "In 2004 he said it." }],
  });
  assert.match(r, /No purchase, price or buyer framing/);
  assert.match(r, /within the first 40 words/);
  assert.match(r, /"a b c d e"/);
  assert.doesNotMatch(contractOpeningRule({ buyer: true }), /No purchase/);
  assert.match(contractChapterRule(2), /At least 2 honest first-person takes/);
  assert.doesNotMatch(r, /—/); // no em dashes in anything the writers see
});
