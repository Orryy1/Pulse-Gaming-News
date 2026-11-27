// Rankings and commentary as arguments (LONG_ARGUES, top creator gap plan gap 4, 18 Nov 2026): an "I" verdict on every
// entry, the fight inside 30 s, unequal time, a verdict thumbnail, "claims tested" commentary and the franchise guard.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FILLER_SECONDS_MAX,
  claimsReport,
  endsOnVerdict,
  entryWordRange,
  franchiseGuardProblems,
  iPer1000,
  inviteProblems,
  median,
  rankingReport,
  thumbVerdictProblems,
  unequalTimeProblems,
  verdictLineProblems,
  ARGUES_PLAN_RULE,
  CLAIMS_CHAPTER_SHAPE,
  CLAIMS_OPENING_RULE,
  CLAIMS_OUTLINE_RULE,
} from "../src/editorial/argues.ts";
import {
  arguesEntryProblems,
  longWordsMax,
  LONG_WORDS_MAX,
} from "../src/editorial/longform.ts";
import type { LongDoc } from "../src/editorial/longcontract.ts";

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

test('"I" per 1,000 words: the narrator only, never a quoted person; "I\'d" counts, "it" does not', () => {
  assert.equal(iPer1000("I think so. It is."), 200);
  assert.equal(iPer1000('He said "I quit" today.'), 0);
  assert.ok(iPer1000("I'd play it. Ice is cold.") > 0);
  assert.equal(iPer1000("Ice is cold. In 2001 it shipped."), 0);
});

test("a verdict closes the entry: the last line, or the one before a short hand-over", () => {
  assert.ok(
    endsOnVerdict("It shipped in 2001. I'd still play it over GTA 3 tonight."),
  );
  assert.ok(
    endsOnVerdict(
      "It shipped. I put it here and I'll defend it. Next, a handheld.",
    ),
  );
  assert.ok(
    !endsOnVerdict(
      "It shipped in 2001. It still holds up for one reason, and the next entry fixed it.",
    ),
  );
  assert.match(
    verdictLineProblems("It shipped.", "GTA 2").join(" "),
    /doesn't end on a verdict/,
  );
});

test("unequal time: the bottom third under a minute, the top three twice the rest's median", () => {
  assert.deepEqual(entryWordRange(0, 11), [70, 140]);
  assert.deepEqual(entryWordRange(5, 11), [130, 240]);
  assert.deepEqual(entryWordRange(10, 11), [300, 460]);
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  // The GTA ranking as published: eleven entries of about 80 s each.
  const equal = Array.from({ length: 11 }, () => 82);
  const p = unequalTimeProblems(equal);
  assert.equal(
    p.filter((x) => x.includes(`under ${FILLER_SECONDS_MAX} s`)).length,
    3,
  );
  assert.equal(p.filter((x) => x.includes("top-three")).length, 3);
  const shaped = [40, 45, 50, 70, 75, 80, 85, 90, 170, 180, 200];
  assert.deepEqual(unequalTimeProblems(shaped), []);
  assert.deepEqual(unequalTimeProblems([10, 10, 10]), []);
});

test("the fight inside 30 seconds: a contested placement named and disagreement invited", () => {
  const titles = [
    "Grand Theft Auto",
    "Grand Theft Auto: San Andreas",
    "Grand Theft Auto IV",
  ];
  assert.deepEqual(
    inviteProblems(
      "San Andreas isn't number one, and I know some of you will want to argue about that. Here's the rule.",
      titles,
    ),
    [],
  );
  const p = inviteProblems(
    "In 1997, the first Grand Theft Auto shipped as a top-down game where you chased a points target instead of an ending.",
    titles,
  );
  assert.match(p.join(" "), /Invite the disagreement/);
});

test("the thumbnail shows the verdict in four words or fewer, never the title restated", () => {
  const title = "Every Grand Theft Auto Game Ranked Worst to Best";
  assert.deepEqual(thumbVerdictProblems("BEST: V / WORST: 2", title), []);
  assert.deepEqual(
    thumbVerdictProblems("SAN ANDREAS ISN'T #1", title, [
      "Grand Theft Auto: San Andreas",
    ]),
    [],
  );
  assert.match(
    thumbVerdictProblems("EVERY GRAND THEFT AUTO RANKED", title).join(" "),
    /4 at most|restates/,
  );
  assert.match(
    thumbVerdictProblems("ELEVEN GAMES", title).join(" "),
    /no verdict/,
  );
  assert.match(thumbVerdictProblems(undefined, title).join(" "), /no words/);
});

test("a ranking's report: the published GTA shape fails, an argued one passes", () => {
  const entry = (title: string, n: number, verdict: boolean) => ({
    title,
    text: `${words(n - 12)}. ${verdict ? "I'd put it right here, and I'll defend that." : "It holds up well enough today."}`,
  });
  const flat: LongDoc = {
    title: "Every Grand Theft Auto Game Ranked Worst to Best",
    kind: "ranking",
    hook: "In 1997, the first game shipped as a top-down game. We're ranking all eleven.",
    chapters: Array.from({ length: 6 }, (_, i) =>
      entry(`Game ${i}`, 205, false),
    ),
    outro: "That's the list.",
    thumbText: "ELEVEN GAMES RANKED",
  };
  const r = rankingReport(flat);
  assert.equal(r.pass, false);
  assert.equal(r.measures.verdictEntries, 0);
  assert.ok(r.measures.iPer1000 < 20);
  const argued: LongDoc = {
    ...flat,
    hook: "I know you'll argue about Game 2 sitting this low, and I think I'm right. Here's how I judged them.",
    chapters: [
      entry("Game 0", 100, true),
      entry("Game 1", 110, true),
      entry("Game 2", 180, true),
      entry("Game 3", 380, true),
      entry("Game 4", 390, true),
      entry("Game 5", 420, true),
    ].map((c) => ({
      ...c,
      text: `I said so. I mean it. I stand by it. I'd argue it. ${c.text}`,
    })),
    thumbText: "BEST: 5 / WORST: 0",
  };
  const ok = rankingReport(argued);
  assert.deepEqual(ok.problems, []);
});

test("arguesEntryProblems: one entry's verdict, length and I", () => {
  const p = arguesEntryProblems(
    `${words(200)}. It holds up.`,
    "GTA 2",
    [70, 140],
  );
  assert.equal(p.length, 3);
  assert.deepEqual(
    arguesEntryProblems(
      `I think it's fine. I mean it. ${words(80)}. I'd put it here.`,
      "GTA 2",
      [70, 140],
    ),
    [],
  );
  assert.equal(longWordsMax(false), LONG_WORDS_MAX);
  assert.ok(longWordsMax(true) > LONG_WORDS_MAX);
});

test("claims tested: verdict by 2:15, the other side first, numbered claims with rulings, rumours flagged", () => {
  const good: LongDoc = {
    title: "GTA 6 Claims, Tested",
    kind: "claims",
    hook: "To be fair, the case for the hype is strong. I think most of it holds up, and I'll show you where it doesn't. Three claims.",
    chapters: [
      {
        title: "Map",
        text: "Claim number one: the map is twice the size. Rockstar's trailer shows two cities. So that one is half true.",
      },
      {
        title: "Price",
        text: "Claim number two: it costs $70. Rockstar's store lists it at $69.99. So that one is true.",
      },
      {
        title: "Date",
        text: "The third claim is a delay. A leak said so, and that's unconfirmed. So that one is wrong.",
      },
    ],
    outro: "That's my verdict.",
  };
  const r = claimsReport(good);
  assert.deepEqual(r.problems, []);
  assert.equal(r.measures.ruled, 3);
  const bad: LongDoc = {
    ...good,
    hook: `${words(400)}. I think it holds up.`,
    chapters: [
      { title: "Map", text: "The map is big. Insiders say it is huge." },
    ],
  };
  const b = claimsReport(bad).problems.join("\n");
  assert.match(b, /verdict arrives at/);
  assert.match(b, /other side/);
  assert.match(b, /1 claims; test 3 to 6/);
  assert.match(b, /signpost/);
  assert.match(b, /ruling/);
  assert.match(b, /isn't called unconfirmed/);
});

test("the franchise guard: a franchise history or every-game piece needs thesis, exclusive and finish line", () => {
  assert.deepEqual(franchiseGuardProblems({ kind: "story" }), []);
  assert.match(
    franchiseGuardProblems({ kind: "franchise" }).join(" "),
    /thesis, exclusive, finish line/,
  );
  assert.match(
    franchiseGuardProblems({
      kind: "story",
      format: "everygame",
      brief: { thesis: "x" },
    }).join(" "),
    /exclusive, finish line/,
  );
  assert.deepEqual(
    franchiseGuardProblems({
      kind: "franchise",
      brief: { thesis: "a", exclusive: "b", finish_line: "c" },
    }),
    [],
  );
});

test("the writers' rules: plain, no em dashes, the claims shape spoken", () => {
  for (const r of [
    ARGUES_PLAN_RULE,
    CLAIMS_CHAPTER_SHAPE,
    CLAIMS_OPENING_RULE,
    CLAIMS_OUTLINE_RULE,
  ])
    assert.doesNotMatch(r, /—/);
  assert.match(CLAIMS_CHAPTER_SHAPE, /half true/);
  assert.match(ARGUES_PLAN_RULE, /30 seconds/);
});
