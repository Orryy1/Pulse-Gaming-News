// The opening contract and the ranking rules after the Opus proof of 18 Nov 2026 (proof-longform-opus/rewrites.json):
// the writer's own payoff wins, an unplanted finish line is a finding, "I" is measured across the whole ranking, the word
// list never fails a seam alone, stock opinion openers are capped, a short primary quote is a real voice, and a
// ranking's intro has the same 90-word cap.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STOCK_OPENERS,
  contractChapterRule,
  contractOpeningRule,
  contractReport,
  feelingOf,
  finishLineOf,
  finishLineProblems,
  noPrimarySources,
  primaryVoiceIn,
  quoteOpeningProblems,
  stockOpenerCounts,
  stockOpenerProblems,
  takeProblems,
  withJudgement,
  withRewrittenOpening,
  type LongDoc,
} from "../src/editorial/longcontract.ts";
import {
  findFinishPayoff,
  findFinishPlant,
  placeOpenLoops,
} from "../src/editorial/openloops.ts";
import {
  ARGUES_PLAN_RULE,
  CLAIMS_CHAPTER_SHAPE,
  CLAIMS_OPENING_RULE,
  SHORT_ENTRY_WORDS,
  arguesEntryRule,
  iShortfall,
  verdictLineProblems,
} from "../src/editorial/argues.ts";
import {
  arguesEntryProblems,
  introWords,
  openingCapOn,
} from "../src/editorial/longform.ts";

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

// ---------------------------------------------------------------- 1. the writer's own payoff first

const FFXIV_LAST =
  "Yoshida's team kept the servers on through the rebuild. In 2014, Square Enix credited Final Fantasy 14 A Realm Reborn with helping it survive and return to profit. The subscription price came down for the players who stayed.";
const FFXIV_PAYOFF =
  "So that's how Final Fantasy 14 survived its shutdown: Yoshida's team rebuilt it on a new engine while the broken version kept running.";

const ffxiv = (): LongDoc => ({
  title: "How Final Fantasy XIV Survived Its Shutdown",
  kind: "documentary",
  hook: "Old opening.",
  chapters: [
    { title: "One", text: `${words(400)}.` },
    { title: "Two", text: `${words(400)}.` },
    { title: "Last", text: `${words(300)}. ${FFXIV_LAST}` },
  ],
  outro: "The end.",
});

test("payoff: the writer's own line is measured, never an incidental sentence that shares its words", () => {
  const intro =
    "In December 2010, Square Enix's president apologised for a game. So how did Final Fantasy 14 survive its own shutdown? Not with patches.";
  const d = withRewrittenOpening(ffxiv(), intro, {
    question: "How did Final Fantasy 14 survive its own shutdown?",
    payoff: FFXIV_PAYOFF,
  });
  const last = d.chapters.at(-1)!.text;
  assert.ok(last.endsWith(FFXIV_PAYOFF), "the writer's payoff joins the end");
  const f = finishLineOf(d)!;
  assert.ok(f.payShare > 0.97, `paid at ${f.payShare}`);
  // The writer's line already in the chapter is found as it is.
  const named = findFinishPayoff(
    "How did Final Fantasy 14 survive its own shutdown?",
    [FFXIV_PAYOFF, "Later."],
    FFXIV_PAYOFF,
  );
  assert.equal(named, 0);
  // With no flagged line, a sentence that answers in so many words beats a mere word match.
  const s = [
    "In 2014 Final Fantasy 14 helped Square Enix survive.",
    "That's how Final Fantasy 14 survived its shutdown.",
    "Then the price fell.",
  ];
  assert.equal(
    findFinishPayoff("How did Final Fantasy 14 survive its shutdown?", s),
    1,
  );
});

// ---------------------------------------------------------------- 2. the plant: a finding, matched on content words

test("plant: matched on content words without the game's name; unmatched is a finding, never sentence 0", () => {
  const hook = [
    "Rockstar has made plenty of promises about GTA 6.",
    "Some are in its purchase terms.",
    "So which launch promises can you actually trust?",
  ];
  assert.equal(
    findFinishPlant(
      "Which GTA 6 launch promises can you actually trust?",
      hook,
    ),
    2,
  );
  assert.equal(
    findFinishPlant("Why did the studio leave Edinburgh?", hook),
    -1,
  );
  const d = withRewrittenOpening(
    ffxiv(),
    "A first line. A second line about something else.",
    {
      question: "How did Final Fantasy 14 survive its own shutdown?",
      payoff: FFXIV_PAYOFF,
    },
  );
  assert.equal(finishLineOf(d)!.planted, false);
  assert.match(finishLineProblems(d).join(" "), /not planted in the opening/);
  // Placement uses the same matching for a finish line, and names what it drops.
  const placed = placeOpenLoops(
    [
      {
        question: "Which GTA 6 launch promises can you actually trust?",
        plant_chapter: 0,
        payoff_chapter: 1,
        finish_line: true,
      },
    ],
    hook,
    [["My answer to which launch promises you can trust: the purchase terms."]],
  );
  assert.equal(placed.placed.length, 1);
  assert.equal(placed.placed[0]!.plant.moment, 2);
  const lost = placeOpenLoops(
    [
      {
        question: "Why did the studio leave Edinburgh?",
        plant_chapter: 0,
        payoff_chapter: 1,
        finish_line: true,
      },
    ],
    hook,
    [["It left Edinburgh because of rent."]],
  );
  assert.match(lost.removed.join(" "), /^finish line ".*": never raised$/);
  // The report carries a dropped finish line as the same finding.
  const r = contractReport(ffxiv(), {
    finishMissing: { question: "Why?", why: "not planted" },
  });
  assert.match(r.problems.join(" "), /not planted in the opening/);
});

// ---------------------------------------------------------------- 3. "I" across the whole ranking

test("ranking I: measured across the video; a short entry needs only its closing verdict", () => {
  const short = `${words(90)}. I'd put it last, and that's fair.`;
  assert.ok(short.split(/\s+/).length < SHORT_ENTRY_WORDS);
  assert.deepEqual(
    arguesEntryProblems(short, "GTA", [70, 140], ["An intro with no I."]),
    [],
  );
  assert.equal(iShortfall([], short), undefined);
  // A long entry is asked for more only while the video so far is under the rate.
  const long = `${words(300)}. I'd put it first.`;
  assert.match(
    iShortfall(["No I here at all."], long) ?? "",
    /under 20 times per 1,000/,
  );
  const rich = Array.from({ length: 30 }, () => "I think so.").join(" ");
  assert.equal(iShortfall([rich], long), undefined);
  assert.doesNotMatch(arguesEntryRule([70, 140]), /times in every 100 words/);
  assert.match(arguesEntryRule([300, 460]), /Across the whole video/);
});

// ---------------------------------------------------------------- 4. hand-overs: the word list records, the judge decides

test("hand-overs: no single 'record' or 'finally' decides, and the word list alone never fails a seam", () => {
  assert.equal(feelingOf("It set a record."), 0);
  assert.equal(feelingOf("Square Enix finally changed who was in charge."), 0);
  const d: LongDoc = {
    title: "Why San Andreas Never Got a Sequel",
    kind: "documentary",
    hook: "Why did San Andreas never get a sequel?",
    chapters: [
      { title: "a", text: "I think it worked. I'd say so. It sold millions." },
      {
        title: "b",
        text: "The success was a hit. I think so. I'd say it again.",
      },
    ],
    outro: "",
  };
  const r = contractReport(d);
  assert.equal(r.measures.handovers[0]!.lexicon, false);
  assert.ok(
    !r.problems.some((p) => /hand over/.test(p)),
    r.problems.join("\n"),
  );
  const j = withJudgement(r, {
    first_line_serves_title: true,
    question_is_title: true,
    handovers: [{ after: 1, contrast: false }],
    reasons: [],
  });
  assert.match(
    j.problems.join(" "),
    /Chapters 1 and 2 hand over on the same feeling \(judge\)/,
  );
  // The writer's rule names feelings, never a joining word to use.
  const rule = contractChapterRule(2);
  for (const w of [
    "But",
    "Then",
    "Yet",
    "However",
    "Meanwhile",
    "Still",
    "finally",
  ])
    assert.doesNotMatch(rule, new RegExp(`"${w}\\b|\\b${w} \\.\\.\\.`), w);
  assert.doesNotMatch(rule, /\("[^"]+"/, "no quoted example lines");
});

// ---------------------------------------------------------------- 5. stock opinion openers

test("stock openers: each opens at most two takes in a video, and no rule text offers one", () => {
  const text =
    "I'll be honest, it stung. I'll be honest, it worked. I think so. Honestly, fine. I'll be honest, again.";
  assert.deepEqual(stockOpenerCounts(text), {
    "I'll be honest": 3,
    "I think": 1,
    Honestly: 1,
  });
  assert.match(
    stockOpenerProblems(text).join(" "),
    /"I'll be honest" opens 3 takes/,
  );
  // A writer is told only when its own draft pushes an opener over.
  assert.deepEqual(
    stockOpenerProblems("I think a. I think b. I think c.", "It sold."),
    [],
  );
  assert.equal(
    stockOpenerProblems("I think a. I think b.", "I think c.").length,
    1,
  );
  // A quoted person's "I think" is not the narrator's.
  assert.deepEqual(stockOpenerCounts('He said "I think so." It sold.'), {});
  const rules = [
    contractChapterRule(2),
    contractOpeningRule({ buyer: false }),
    takeProblems("Nothing.").join(" "),
    ARGUES_PLAN_RULE,
    arguesEntryRule([70, 140]),
    arguesEntryRule([300, 460]),
    CLAIMS_OPENING_RULE,
    CLAIMS_CHAPTER_SHAPE,
    verdictLineProblems("It shipped.", "GTA").join(" "),
  ].join("\n");
  for (const [name] of STOCK_OPENERS)
    assert.ok(
      !rules.toLowerCase().includes(`"${name.toLowerCase()}`),
      `rule text offers "${name}"`,
    );
  // A whole report carries the check.
  const d: LongDoc = {
    title: "T",
    kind: "documentary",
    hook: "Why T?",
    chapters: [{ title: "a", text: text }],
    outro: "",
  };
  assert.match(
    contractReport(d).problems.join(" "),
    /"I'll be honest" opens 3/,
  );
});

// ---------------------------------------------------------------- 6. a short primary quote is a real voice

test("quotes: a short primary quote found in the sources is a real voice; only encyclopaedia sources is advised", () => {
  const sources = [
    'In December 2010, Yoichi Wada said the game had "greatly damaged" the brand and apologised.',
  ];
  const hook =
    'In December 2010, Square Enix president Yoichi Wada said the game had "greatly damaged" the brand. So how did it survive?';
  assert.equal(primaryVoiceIn(hook, sources), "greatly damaged");
  assert.equal(
    primaryVoiceIn('Fans said it was "greatly damaged". So?', []),
    undefined,
    "no sources, nothing counts",
  );
  assert.equal(
    primaryVoiceIn('Someone said it was "never in the source". So?', sources),
    undefined,
  );
  const dated = [
    {
      quote: "we will rebuild this game from the ground up",
      sentence: "In 2011 Wada said it.",
    },
  ];
  assert.deepEqual(quoteOpeningProblems(hook, dated, sources), []);
  assert.match(
    quoteOpeningProblems("So how did it survive?", dated, sources).join(" "),
    /word for word/,
  );
  // It is a voice, not a licence for a longer opening.
  const r = contractReport(
    {
      title: "How Final Fantasy XIV Survived",
      kind: "documentary",
      hook: `${hook} ${words(80)}`,
      chapters: [{ title: "a", text: "x." }],
      outro: "",
    },
    {
      sources,
      sourceUrls: ["https://en.wikipedia.org/wiki/Final_Fantasy_XIV"],
    },
  );
  assert.equal(r.measures.realVoice, "greatly damaged");
  assert.match(r.problems.join(" "), /keep it to 90/);
  assert.deepEqual(r.advisories, ["no_primary_sources"]);
  assert.ok(
    !r.problems.some((p) => /no_primary_sources/.test(p)),
    "advisory only",
  );
  assert.ok(
    noPrimarySources([
      "https://en.wikipedia.org/wiki/A",
      "https://en.wikipedia.org/wiki/B",
    ]),
  );
  assert.ok(
    !noPrimarySources([
      "https://en.wikipedia.org/wiki/A",
      "https://www.rockstargames.com/newswire/article/1",
    ]),
  );
  assert.ok(!noPrimarySources([]));
});

// ---------------------------------------------------------------- 7. a ranking's intro has the 90-word cap

test("rankings: the 90-word opening cap, in the report and while the intro is written", () => {
  const d: LongDoc = {
    title: "Every GTA Ranked",
    kind: "ranking",
    hook: words(95),
    chapters: [],
    outro: "",
  };
  assert.match(contractReport(d).problems.join(" "), /95 words/);
  assert.ok(openingCapOn({ argues: "fix" }));
  assert.ok(openingCapOn({ contract: "fix" }));
  assert.ok(!openingCapOn({ argues: "check", contract: "check" }));
  assert.deepEqual(introWords(undefined, true), [40, 90]);
  assert.deepEqual(introWords(), [60, 140]);
});
