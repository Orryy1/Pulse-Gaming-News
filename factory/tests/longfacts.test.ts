// LONG_FACT_DISCIPLINE (src/editorial/longfacts.ts, src/longrepair.ts): built from the ten real blocker sets that
// killed long rankings at the fact-check, the four Half-Life and Portal runs of 20 Nov 2026 (upgrade queue item 45)
// and six from 22-23 Nov. No model is called anywhere in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  absoluteFlags,
  countedText,
  countedTitle,
  disciplineLongform,
  figuresIn,
  leadYear,
  preFlagFeedback,
  scopeRule,
  unbackedMethod,
  type PackFact,
} from "../src/editorial/longfacts.ts";
import { repairLongform, longWords } from "../src/longrepair.ts";
import { sentencesOf, type LongformScript } from "../src/editorial/longform.ts";
import { speakable, speakContext } from "../src/voice/speakable.ts";

const ctx = speakContext(undefined);
const speak = (t: string) => speakable(t, ctx);

type Card = {
  kind: string;
  primary?: string;
  secondary?: string;
  items?: string[];
};
const moment = (c?: Card) => ({
  show: "the scene",
  keywords: ["scene"],
  graphic: {
    kind: (c?.kind ??
      "none") as LongformScript["entries"][number]["moments"][number]["graphic"]["kind"],
    primary: c?.primary ?? "",
    secondary: c?.secondary ?? "",
    items: c?.items ?? [],
  },
  emphasis: "",
});

/** An entry whose moments match its sentences one for one, with cards where given. */
function entry(
  rank: number,
  game_title: string,
  year: number,
  sentences: string[],
  cards: Record<number, Card> = {},
): LongformScript["entries"][number] {
  return {
    rank,
    game_title,
    steam_search_term: "",
    year,
    platforms: "PC",
    narration: sentences.join(" "),
    verdict_chip: "Holds up",
    footage: { want: "gameplay", keywords: [game_title] },
    moments: sentences.map((_, i) => moment(cards[i])),
  };
}

/** Plain filler sentences, so an entry is long enough for the cut cap to allow one cut. */
const filler = (game: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `${game} keeps its pace in part ${i + 1} with a steady run of rooms and fights.`,
  );

function draft(
  over: Partial<LongformScript> & { entries: LongformScript["entries"] },
): LongformScript {
  return {
    theme: "Half-Life and Portal",
    title: "Half-Life and Portal, Ranked",
    criterion: "How well each one plays today",
    intro: {
      narration:
        "A crowbar changed shooters for good. Tonight the order is judged on how each one plays today. Number one waits until the end, and one placement will start an argument.",
      on_screen: "Valve's best",
    },
    outro: {
      narration:
        "Half-Life 2 takes the top spot because it still plays like nothing else. The top three are close. The hardest call was Portal against Episode Two. It comes back to that crowbar.",
      on_screen: "Half-Life 2 wins",
    },
    youtube: {
      title: "Half-Life and Portal Games Ranked",
      description:
        "Every Half-Life and Portal game ranked from worst to best. Which one tops the list?",
      tags: [],
      thumb_text: "NOT PORTAL 2?",
    },
    claims: [],
    ...over,
  };
}

const pack = (title: string, facts: string): PackFact => ({ title, facts });
const blocker = (quote: string, problem: string) =>
  `Fact-check: "${quote}" - ${problem}`;

// ---------------------------------------------------------------- 20 Nov: Half-Life and Portal (item 45)

const HL2 = pack(
  "Half-Life 2",
  "Game: Half-Life 2\nRelease date: Nov 16, 2004\nMetacritic: 96\nBackground notes: Half-Life 2 is a 2004 first-person shooter developed by Valve. It sold 12 million copies by 2011.",
);
const PORTAL = pack(
  "Portal",
  "Game: Portal\nRelease date: Oct 10, 2007\nMetacritic: 90\nBackground notes: Portal is a 2007 puzzle-platform game developed by Valve.",
);
const HLPACK = [HL2, PORTAL];

function halfLife(): LongformScript {
  return draft({
    entries: [
      entry(
        2,
        "Portal",
        2007,
        [
          "Coming in at number two, Portal from 2007.",
          "It is the only puzzle game anyone still talks about.",
          "Most of you don't own one of the old Orange Box discs.",
          ...filler("Portal", 12),
        ],
        {
          2: {
            kind: "stat",
            primary: "Orange Box",
            secondary: "most of you don't own one",
          },
          3: {
            kind: "stat",
            primary: "Story length",
            secondary: "a few hours",
          },
        },
      ),
      entry(
        1,
        "Half-Life 2",
        2004,
        [
          "Number one is Half-Life 2, from 2004.",
          "Gordon Freeman never says a word, and every other shooter of 2004 talked too much.",
          "You stay in Gordon's eyes the whole way.",
          "It sold 12 million copies by 2011.",
          ...filler("Half-Life 2", 12),
        ],
        {
          3: { kind: "stat", primary: "12 million", secondary: "copies sold" },
          4: {
            kind: "stat",
            primary: "Time to finish",
            secondary: "one evening",
          },
        },
      ),
    ],
  });
}

test("20 Nov set 1 (ep 37fa9031): the absolutes are named for the rewrite, the sourceless stat cards are dropped", () => {
  const r = disciplineLongform(halfLife(), HLPACK);
  const named = preFlagFeedback(r.flags);
  // "only", "never" (with "every other"), "the whole way": each a named line for the one rewrite.
  for (const q of [
    "the only puzzle game",
    "never says a word",
    "the whole way",
  ])
    assert.ok(
      named.some((n) => n.startsWith("Pre-check:") && n.includes(q)),
      `named: ${q}`,
    );
  // "Story length: a few hours" and "Time to finish: one evening": no fact says either, so the cards go.
  const portal = r.draft.entries[0]!;
  const hl2 = r.draft.entries[1]!;
  assert.equal(portal.moments[3]!.graphic.kind, "none");
  assert.equal(hl2.moments[4]!.graphic.kind, "none");
  // The sourced card stays: 12 million copies is in the pack.
  assert.equal(hl2.moments[3]!.graphic.kind, "stat");
  assert.ok(
    r.flags.some(
      (f) =>
        f.kind === "card_figure" && f.fixed && f.quote.includes("a few hours"),
    ),
  );
  // Nothing the pre-check did broke the one-moment-per-sentence alignment.
  for (const e of r.draft.entries)
    assert.equal(e.moments.length, sentencesOf(e.narration).length);
});

test("20 Nov set 2 (ep 595dbd8a, seven blockers): the line repair refuses, the last resort cuts within the cap", () => {
  const d = halfLife();
  const seven = [
    blocker(
      "It is the only puzzle game anyone still talks about.",
      "Unsupported absolute: the facts do not say it is the only one.",
    ),
    blocker(
      "Most of you don't own one of the old Orange Box discs.",
      "A claim about the viewer that no fact supports.",
    ),
    blocker(
      "Gordon Freeman never says a word, and every other shooter of 2004 talked too much.",
      "Unsupported comparison with every other shooter.",
    ),
    blocker(
      "You stay in Gordon's eyes the whole way.",
      "An absolute the facts do not support.",
    ),
    blocker(
      "Story length a few hours",
      "The card's length is in no fact given.",
    ),
    blocker(
      "Time to finish one evening",
      "The card's time is in no fact given.",
    ),
    blocker(
      "Half-Life and Portal Games Ranked",
      "Title is fine; this is a style note.",
    ),
  ];
  // More than four: FACT_REPAIR's long cap refuses the lot.
  const normal = repairLongform(d, seven);
  assert.equal(normal.unrepaired.length, 7);
  assert.deepEqual(normal.draft, d);
  // The last resort mends what it can; the title line it cannot, so the episode still fails (nothing unchecked ships).
  const last = repairLongform(d, seven, (t) => t, { lastResort: true });
  assert.deepEqual(last.unrepaired, [seven[6]]);
  // The six it did mend leave the script aligned and inside the 15% cap.
  const six = repairLongform(d, seven.slice(0, 6), (t) => t, {
    lastResort: true,
  });
  assert.deepEqual(six.unrepaired, []);
  assert.ok(
    six.cut <= 0.15 * longWords(d),
    `cut ${six.cut} of ${longWords(d)}`,
  );
  for (const e of six.draft.entries)
    assert.equal(e.moments.length, sentencesOf(e.narration).length);
  const text = six.draft.entries.map((e) => e.narration).join(" ");
  assert.doesNotMatch(text, /Most of you|the whole way|every other shooter/);
  assert.match(text, /Coming in at number two, Portal/, "the rank line stays");
});

test("20 Nov set 3 (ep f439862d, five blockers): five is over the long cap, the last resort mends all five", () => {
  const d = halfLife();
  const five = [
    blocker(
      "It is the only puzzle game anyone still talks about.",
      "An absolute claim the facts do not support.",
    ),
    blocker(
      "Most of you don't own one of the old Orange Box discs.",
      "A claim about the viewer.",
    ),
    blocker("You stay in Gordon's eyes the whole way.", "An absolute claim."),
    blocker("Story length: a few hours", "No fact gives a story length."),
    blocker("Time to finish: one evening", "No fact gives a time to finish."),
  ];
  assert.equal(repairLongform(d, five).unrepaired.length, 5);
  const last = repairLongform(d, five, (t) => t, { lastResort: true });
  assert.deepEqual(last.unrepaired, []);
  const kinds = last.repairs.map((r) => r.kind);
  assert.equal(
    kinds.filter((k) => k === "drop_card").length >= 2,
    true,
    kinds.join(","),
  );
  assert.equal(
    last.draft.entries[0]!.moments.every(
      (m) => !/a few hours/.test(m.graphic.secondary),
    ),
    true,
  );
});

test("20 Nov set 4 (ep ff70a139, recheck failed): a cut line takes its card with it, so the re-check sees neither", () => {
  const d = halfLife();
  const viewer = blocker(
    "Most of you don't own one of the old Orange Box discs.",
    "A claim about the viewer that no fact supports.",
  );
  const r = repairLongform(d, [viewer]);
  assert.deepEqual(r.unrepaired, []);
  const portal = r.draft.entries[0]!;
  assert.doesNotMatch(portal.narration, /Most of you/);
  // The moment that carried "most of you don't own one" went with its sentence: no card repeats the claim.
  assert.ok(
    !portal.moments.some((m) => /most of you/i.test(m.graphic.secondary)),
  );
  assert.equal(portal.moments.length, sentencesOf(portal.narration).length);
  // And the next sentence's card ("a few hours") moved up with it, still beside its own line.
  const idx = sentencesOf(portal.narration).findIndex((x) =>
    x.includes("part 1"),
  );
  assert.equal(portal.moments[idx]!.graphic.secondary, "a few hours");
});

test("an edited line loses a card that repeats the blocked figure (the rounding is not undone on screen)", () => {
  const d = draft({
    entries: [
      entry(
        1,
        "Half-Life 2",
        2004,
        [
          "Number one is Half-Life 2, from 2004.",
          "Today the Steam copy costs ten dollars, which is a lot of game for the money.",
          ...filler("Half-Life 2", 5),
        ],
        {
          1: { kind: "stat", primary: "10 dollars", secondary: "Steam price" },
        },
      ),
    ],
  });
  const r = repairLongform(
    d,
    [
      blocker(
        "costs ten dollars",
        "The Steam price is $9.99; this rounding is unqualified. Say about ten dollars.",
      ),
    ],
    speak,
  );
  assert.deepEqual(r.unrepaired, []);
  assert.match(r.draft.entries[0]!.narration, /costs about ten dollars/);
  assert.equal(r.draft.entries[0]!.moments[1]!.graphic.kind, "none");
  assert.ok(r.repairs.some((x) => x.kind === "drop_card"));
});

// ---------------------------------------------------------------- 22-23 Nov: six more

test("22 Nov 1, Valve hardware: an 'Every' title over a list that left out the 2026 Steam Controller is counted", () => {
  const hw = [
    "Steam Controller",
    "Steam Link",
    "Valve Index",
    "Steam Deck",
    "Steam Deck OLED",
    "Steam Machine",
  ];
  const d = draft({
    theme: "Valve hardware",
    title: "Every Valve Hardware Release",
    youtube: {
      title: "Every Valve Hardware Release Ranked",
      description:
        "Every Valve hardware release ranked from worst to best. One of them changed handheld PCs.",
      tags: [],
      thumb_text: "NOT THE DECK?",
    },
    intro: {
      narration:
        "A controller with two trackpads. We're ranking every Valve hardware release, worst to best. Number one waits until the end.",
      on_screen: "Valve's machines",
    },
    entries: hw.map((t, i) =>
      entry(hw.length - i, t, 2015 + i, [
        `At number ${hw.length - i}, the ${t}.`,
        ...filler(t, 3),
      ]),
    ),
  });
  const r = scopeRule(d);
  assert.equal(r.draft.youtube.title, "6 Valve Hardware Releases Ranked");
  assert.equal(r.draft.title, "6 Valve Hardware Releases");
  assert.match(
    r.draft.intro.narration,
    /We're ranking each of these 6 Valve hardware releases, worst to best\./,
  );
  assert.match(
    r.draft.youtube.description,
    /^Each of these 6 Valve hardware releases ranked/,
  );
  assert.ok(r.flags.every((f) => f.fixed));
  // With the pack's own complete list covered, "every" stands.
  assert.equal(
    scopeRule(d, { completeList: hw }).draft.youtube.title,
    "Every Valve Hardware Release Ranked",
  );
  // A list it does not cover (the second-generation Steam Controller, May 2026) still counts it.
  assert.equal(
    scopeRule(d, { completeList: [...hw, "Steam Controller (2026)"] }).draft
      .youtube.title,
    "6 Valve Hardware Releases Ranked",
  );
});

test("22 Nov 2: the invented methodology line is cut when the pack holds no patch histories or hardware tests", () => {
  const line =
    "All of this comes from launch reviews, the sales figures the studio has reported, patch histories and how each game runs on today's hardware.";
  assert.deepEqual(unbackedMethod(line, HL2.facts), [
    "patch histories",
    "hardware tests",
  ]);
  // A pack with every one of those sources lets the line stand.
  assert.deepEqual(
    unbackedMethod(
      line,
      "Metacritic: 90. It sold 2 million. Patch 1.2 notes. Benchmarks at 60 fps.",
    ),
    [],
  );
  // A plain claim about reviews is no methodology line.
  assert.deepEqual(
    unbackedMethod("It got great reviews and huge sales.", ""),
    [],
  );
  const d = halfLife();
  d.intro.narration = `A crowbar changed shooters for good. ${line} Number one waits until the end, and one placement will start an argument.`;
  const r = disciplineLongform(d, HLPACK);
  assert.doesNotMatch(r.draft.intro.narration, /patch histories/);
  assert.match(
    r.draft.intro.narration,
    /^A crowbar changed shooters for good\. Number one waits/,
  );
  assert.ok(r.flags.some((f) => f.kind === "method" && f.fixed));
  // The opening line itself is never cut: it is named for the rewrite instead.
  const opener = halfLife();
  opener.intro.narration = `${line} Number one waits until the end. One placement will start an argument.`;
  const o = disciplineLongform(opener, HLPACK);
  assert.match(o.draft.intro.narration, /patch histories/);
  assert.ok(
    preFlagFeedback(o.flags).some((x) => x.includes("patch histories")),
  );
});

const GOW_LINE =
  "Ready at Dawn built it, the first God of War not made mainly by Santa Monica Studio.";

function godOfWar(): LongformScript {
  return draft({
    theme: "God of War",
    title: "God of War, Ranked",
    youtube: {
      title: "God of War Games Ranked",
      description: "The God of War games ranked.",
      tags: [],
    },
    entries: [
      entry(2, "God of War: Chains of Olympus", 2008, [
        "At number two, Chains of Olympus on the PSP.",
        GOW_LINE,
        "It squeezed the series onto a handheld.",
        ...filler("Chains of Olympus", 4),
      ]),
      entry(1, "God of War", 2018, [
        "Number one is God of War from 2018.",
        ...filler("God of War", 6),
      ]),
    ],
  });
}

test("22 Nov 3, God of War: a series-wide 'first' is named for the rewrite (Betrayal came first)", () => {
  const flags = absoluteFlags(godOfWar(), [
    pack(
      "God of War: Chains of Olympus",
      "Chains of Olympus is a 2008 action game developed by Ready at Dawn.",
    ),
  ]);
  const first = flags.find((f) => f.kind === "first");
  assert.ok(first, "a first flag");
  assert.equal(first.quote, GOW_LINE);
  assert.match(first.problem, /spin-offs, handheld and mobile games count/);
  // "The first level" or "first released" are not series-wide claims.
  const plain = draft({
    entries: [
      entry(1, "Portal", 2007, [
        "The first level is a quiet room.",
        "It was first released in 2007.",
        ...filler("Portal", 3),
      ]),
    ],
  });
  assert.deepEqual(
    absoluteFlags(plain, []).filter((f) => f.kind === "first"),
    [],
  );
});

test("22 Nov 3, God of War: after the rewrite the last resort cuts the false appositive and keeps the sentence", () => {
  const b = blocker(
    "the first God of War not made mainly by Santa Monica Studio",
    "God of War: Betrayal (2007, Javaground) came first; this series-wide first is false.",
  );
  // The quote is most of this short sentence: the line repair drops it whole, and its moment with it.
  const short = repairLongform(godOfWar(), [b]);
  assert.deepEqual(short.unrepaired, []);
  assert.equal(short.repairs[0]!.kind, "drop_sentence");
  const s = short.draft.entries[0]!;
  assert.doesNotMatch(s.narration, /Ready at Dawn/);
  assert.equal(s.moments.length, sentencesOf(s.narration).length);
  // In a longer sentence the quote is a side clause after a plain comma, which the line repair never cuts; the
  // last resort cuts the appositive and keeps the rest.
  const long = godOfWar();
  long.entries[0]!.narration = long.entries[0]!.narration.replace(
    GOW_LINE,
    "Ready at Dawn built it for the PSP in 2008 with a tiny team, the first God of War not made mainly by Santa Monica Studio.",
  );
  assert.deepEqual(
    repairLongform(long, [b]).unrepaired,
    [b],
    "a plain comma is no clause boundary for the line repair",
  );
  const last = repairLongform(long, [b], (t) => t, { lastResort: true });
  assert.deepEqual(last.unrepaired, []);
  assert.equal(last.repairs[0]!.kind, "cut_appositive");
  const e = last.draft.entries[0]!;
  assert.match(
    e.narration,
    /Ready at Dawn built it for the PSP in 2008 with a tiny team\. It squeezed/,
  );
  assert.equal(e.moments.length, sentencesOf(e.narration).length);
});

test("23 Nov 4, Final Fantasy: a card naming XVI in the IV entry is dropped, and XVI's rank card takes its own year", () => {
  const FF4 = pack(
    "Final Fantasy IV",
    "Background notes: Final Fantasy IV is a 1991 role-playing video game developed by Square.",
  );
  const FF16 = pack(
    "Final Fantasy XVI",
    "Release date: Sep 17, 2024\nBackground notes: Final Fantasy XVI is a 2023 action role-playing game developed by Square Enix.",
  );
  assert.equal(leadYear(FF4.facts), 1991);
  const d = draft({
    theme: "Final Fantasy",
    title: "Final Fantasy, Ranked",
    youtube: {
      title: "Final Fantasy Games Ranked",
      description: "Ranked.",
      tags: [],
    },
    entries: [
      entry(
        2,
        "Final Fantasy IV",
        1991,
        [
          "At number two, Final Fantasy IV from 1991.",
          "It brought the Active Time Battle system.",
          ...filler("Final Fantasy IV", 4),
        ],
        {
          0: { kind: "date", primary: "Final Fantasy XVI", secondary: "1991" },
        },
      ),
      entry(
        1,
        "Final Fantasy XVI",
        1991,
        ["Number one is Final Fantasy XVI.", ...filler("Final Fantasy XVI", 5)],
        {
          1: { kind: "date", primary: "1991", secondary: "Released" },
        },
      ),
    ],
  });
  const r = disciplineLongform(d, [FF4, FF16]);
  assert.equal(
    r.draft.entries[0]!.moments[0]!.graphic.kind,
    "none",
    "the IV card naming XVI",
  );
  assert.equal(
    r.draft.entries[1]!.year,
    2023,
    "XVI's rank card shows its own year",
  );
  assert.equal(
    r.draft.entries[1]!.moments[1]!.graphic.kind,
    "none",
    "a 1991 date card in the XVI entry",
  );
  assert.ok(r.flags.some((f) => f.kind === "card_game" && f.fixed));
  assert.ok(
    r.flags.some(
      (f) =>
        f.kind === "rank_year" &&
        f.fixed &&
        /1991 is Final Fantasy IV's/.test(f.problem),
    ),
  );
  assert.ok(
    r.flags.some(
      (f) =>
        f.kind === "card_date" && /it is Final Fantasy IV's/.test(f.problem),
    ),
  );
  // The same mix-up as the checker words it after the rewrite: the rank card takes the year the checker gives.
  const late = repairLongform(d, [
    blocker(
      "Final Fantasy XVI: 1991",
      "The year 1991 belongs to Final Fantasy IV; Final Fantasy XVI was released in 2023.",
    ),
  ]);
  assert.deepEqual(late.unrepaired, []);
  assert.equal(late.repairs[0]!.kind, "card_year");
  assert.equal(late.draft.entries[1]!.year, 2023);
  assert.equal(late.draft.entries[0]!.year, 1991, "IV keeps its own year");
});

test("23 Nov 5, Metal Gear 2: 'exactly what they saw' is named, and after the rewrite the false line is cut whole", () => {
  const line =
    "Guards got vision cones, so you could see exactly what they saw.";
  const d = draft({
    theme: "Metal Gear",
    title: "Metal Gear, Ranked",
    youtube: {
      title: "Metal Gear Games Ranked",
      description: "Ranked.",
      tags: [],
    },
    entries: [
      entry(1, "Metal Gear 2: Solid Snake", 1990, [
        "Number one is Metal Gear 2: Solid Snake.",
        "It added a radar to the corner of the screen.",
        line,
        "Snake could crawl under desks and through vents.",
        ...filler("Metal Gear 2", 4),
      ]),
    ],
  });
  assert.ok(
    absoluteFlags(d, []).some(
      (f) => f.quote === line && /"exactly"/.test(f.problem),
    ),
  );
  const b = blocker(
    "so you could see exactly what they saw",
    "False: Metal Gear 2 has no vision cones.",
  );
  assert.deepEqual(
    repairLongform(d, [b]).unrepaired,
    [b],
    "the quote is too small a part of the sentence for the line repair",
  );
  const last = repairLongform(d, [b], (t) => t, { lastResort: true });
  assert.deepEqual(last.unrepaired, []);
  assert.equal(last.repairs[0]!.kind, "cut_sentence");
  const e = last.draft.entries[0]!;
  assert.doesNotMatch(e.narration, /vision cones/);
  assert.equal(e.moments.length, sentencesOf(e.narration).length);
});

test("23 Nov 6, 2D Mario: the 'every' title and lines become '12 2D Mario Games', as the checker itself suggested", () => {
  const games = [
    "Super Mario Bros.",
    "Super Mario Bros.: The Lost Levels",
    "Super Mario Bros. 2",
    "Super Mario Bros. 3",
    "Super Mario Land",
    "Super Mario World",
    "Super Mario Land 2",
    "New Super Mario Bros.",
    "New Super Mario Bros. Wii",
    "New Super Mario Bros. 2",
    "New Super Mario Bros. U",
    "Super Mario Bros. Wonder",
  ];
  const d = draft({
    theme: "2D Mario",
    title: "Every 2D Mario Game, Ranked",
    youtube: {
      title: "Every 2D Mario Game, Ranked",
      description:
        "Every 2D Mario game ranked from worst to best. All 2D Mario games get a fair hearing.",
      tags: [],
    },
    intro: {
      narration:
        "A plumber jumped. Every 2D Mario game gets judged on one thing: the jump. Number one waits.",
      on_screen: "Mario's best",
    },
    entries: games.map((g, i) =>
      entry(12 - i, g, 1985 + i, [
        `At number ${12 - i}, ${g}.`,
        ...filler(g, 3),
      ]),
    ),
  });
  const r = disciplineLongform(d, []);
  assert.equal(r.draft.youtube.title, "12 2D Mario Games, Ranked");
  assert.equal(r.draft.title, "12 2D Mario Games, Ranked");
  assert.match(
    r.draft.intro.narration,
    /Each of these 12 2D Mario games gets judged on one thing/,
  );
  assert.equal(
    r.draft.youtube.description,
    "Each of these 12 2D Mario games ranked from worst to best. All 12 2D Mario games get a fair hearing.",
  );
});

// ---------------------------------------------------------------- the pieces

test("countedTitle: the shapes the factory's long titles take", () => {
  assert.equal(
    countedTitle("Ranking EVERY Half-Life and Portal Game", 9),
    "Ranking 9 Half-Life and Portal Games",
  );
  assert.equal(
    countedTitle("Every Resident Evil Game Ranked Worst to Best", 10),
    "10 Resident Evil Games Ranked Worst to Best",
  );
  assert.equal(
    countedTitle("All Metal Gear Games Ranked", 8),
    "8 Metal Gear Games Ranked",
  );
  assert.equal(
    countedTitle("RANKING EVERY HALO GAME", 7),
    "RANKING 7 HALO GAMES",
  );
  // The head noun is the last word of the phrase, so a name holding one ("Game Boy", "Master System") stays whole.
  assert.equal(
    countedTitle("Every Game Boy Game, Ranked", 12),
    "12 Game Boy Games, Ranked",
  );
  assert.equal(
    countedTitle("Every Sega Master System Game Ranked", 12),
    "12 Sega Master System Games Ranked",
  );
  // No head noun to count ("Zelda", "Steam Hardware", "Track"), or a head that is not the last word: left for the
  // writer, never guessed ("12 Steam Hardware Games" would be false).
  for (const t of [
    "Every Zelda, Ranked",
    "All Steam Hardware, Ranked",
    "Every Mario Kart Track, Ranked",
    "Every Xbox Console Exclusive Ranked",
  ])
    assert.equal(countedTitle(t, 12), undefined, t);
  // Already counted, or no "every" claim at all: nothing to change.
  assert.equal(countedTitle("All 12 Halo Games Ranked", 12), undefined);
  assert.equal(
    countedTitle("The Best Open-World Game for Every Year of the 2010s", 10),
    undefined,
  );
  assert.equal(countedTitle("Half-Life and Portal Games Ranked", 9), undefined);
});

test("countedText counts only the title's own phrase, word for word, and never writes a false count", () => {
  const mario = { span: "Mario ", head: "Game" };
  const zelda = { span: "Zelda ", head: "Game" };
  const halo = { span: "Halo ", head: "Game" };
  assert.equal(
    countedText("Every Mario game has a flagpole.", 12, mario),
    "Each of these 12 Mario games has a flagpole.",
  );
  assert.equal(
    countedText("We ranked all Mario games.", 12, mario),
    "We ranked all 12 Mario games.",
  );
  // The review's cases: subsets, other heads, "other", number words, "almost", "every one of".
  for (const [line, scope] of [
    ["Unlike every other Mario game, it floats.", mario],
    ["Every 3D Zelda game since has borrowed its lock-on.", zelda],
    ["Nintendo hid a secret in every Mario level.", mario],
    ["Every boss in the series is tough.", mario],
    ["Of all the other Zelda games, this one wins.", zelda],
    ["It beat every game in the series.", mario],
    ["All three Halo games share a ring.", halo],
    ["Almost every Zelda game has a Master Sword.", zelda],
    ["Every one of the Halo games has a warthog.", halo],
    ["Every game here has a hook.", mario],
  ] as const)
    assert.equal(countedText(line, 12, scope), line, line);
});

test("an 'Every' title that can't be counted safely is named for the rewrite, not rewritten", () => {
  const d = draft({
    title: "Every Zelda, Ranked",
    youtube: {
      title: "Every Zelda, Ranked",
      description: "Every Zelda game ranked.",
      tags: [],
    },
    entries: [
      entry(1, "Ocarina of Time", 1998, [
        "Number one is Ocarina of Time.",
        ...filler("Ocarina", 3),
      ]),
    ],
  });
  const r = scopeRule(d);
  assert.equal(r.draft.youtube.title, "Every Zelda, Ranked");
  assert.ok(r.flags.some((f) => f.kind === "scope" && !f.fixed));
  assert.ok(preFlagFeedback(r.flags).some((x) => x.includes("Say the count")));
});

test("figuresIn: names with digits are not figures, scales and years are", () => {
  const vals = (t: string) => figuresIn(t).map((f) => f.value);
  assert.deepEqual(vals("PS5 and N64, in 2D"), []);
  assert.deepEqual(vals("12 million copies"), [12e6]);
  assert.deepEqual(vals("five million copies"), [5e6]);
  assert.deepEqual(vals("Released 2004, Metacritic 96"), [2004, 96]);
  assert.equal(figuresIn("in 2004")[0]!.year, true);
});

test("a card with a rounded figure the pack states ('almost 350,000') is kept; one off by more is dropped", () => {
  const p = [
    pack(
      "Portal",
      "Background notes: Portal is a 2007 puzzle game. Players on Steam right now: 346,258",
    ),
  ];
  const mk = (n: string) =>
    draft({
      entries: [
        entry(
          1,
          "Portal",
          2007,
          [
            "Number one is Portal.",
            `It has ${n} players right now.`,
            ...filler("Portal", 3),
          ],
          {
            1: { kind: "stat", primary: n, secondary: "players" },
          },
        ),
      ],
    });
  assert.equal(
    disciplineLongform(mk("350,000"), p).draft.entries[0]!.moments[1]!.graphic
      .kind,
    "stat",
  );
  assert.equal(
    disciplineLongform(mk("500,000"), p).draft.entries[0]!.moments[1]!.graphic
      .kind,
    "none",
  );
});

test("an absolute the pack itself states is not flagged", () => {
  const d = draft({
    entries: [
      entry(1, "Half-Life 2", 2004, [
        "Number one is Half-Life 2.",
        "Gordon never speaks in the game.",
        ...filler("Half-Life 2", 3),
      ]),
    ],
  });
  assert.ok(absoluteFlags(d, []).some((f) => f.quote.includes("never speaks")));
  assert.deepEqual(
    absoluteFlags(d, [
      pack("Half-Life 2", "Gordon Freeman never speaks in the game."),
    ]),
    [],
  );
});

test("the last resort never cuts the opening line, a rank line, or a line the next one leans on", () => {
  const d = draft({
    entries: [
      entry(1, "Portal", 2007, [
        "Number one is Portal, the only game here with a cake.",
        "Its portal gun is the only tool you get.",
        "That choice shaped every puzzle in it.",
        ...filler("Portal", 4),
      ]),
    ],
  });
  const opener = blocker(
    "A crowbar changed shooters for good.",
    "Unsupported.",
  );
  const rank = blocker(
    "Number one is Portal, the only game here with a cake.",
    "Unsupported absolute.",
  );
  const leaned = blocker(
    "Its portal gun is the only tool you get",
    "Unsupported absolute claim.",
  );
  const r = repairLongform(d, [opener, rank], (t) => t, { lastResort: true });
  assert.deepEqual(r.unrepaired, [opener, rank]);
  // "only" is not "always"/"never", so it is not softened; the next line opens on "That": the cut is refused too.
  assert.deepEqual(
    repairLongform(d, [leaned], (t) => t, { lastResort: true }).unrepaired,
    [leaned],
  );
});

test("the last resort keeps to the 15% cap across both passes", () => {
  const d = halfLife();
  const all = longWords(d);
  const b = blocker(
    "Most of you don't own one of the old Orange Box discs.",
    "A claim about the viewer.",
  );
  // Already at the cap from the first pass: nothing more may go.
  const r = repairLongform(d, [b], (t) => t, {
    lastResort: true,
    baseWords: all,
    alreadyCut: Math.floor(0.15 * all),
  });
  assert.deepEqual(r.unrepaired, [b]);
});

test("a blocked description sentence is dropped when another is left", () => {
  const d = halfLife();
  const b = blocker("Which one tops the list?", "Fine, but a style note.");
  const r = repairLongform(d, [
    blocker(
      "Every Half-Life and Portal game ranked from worst to best",
      "Not every entry is ranked.",
    ),
  ]);
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.draft.youtube.description, "Which one tops the list?");
  assert.equal(
    repairLongform(
      {
        ...d,
        youtube: { ...d.youtube, description: "Which one tops the list?" },
      },
      [b],
    ).unrepaired.length,
    1,
  );
});

// ---------------------------------------------------------------- from the code review (25 Nov)

test("a line about a game's engine or port is no methodology line, whatever it names", () => {
  for (const line of [
    "Built on id Tech 7, it runs on almost anything.",
    "The Switch port is based on the Wii U version, and the frame rate halves.",
    "We played it on a CRT and the reviews were right.",
  ])
    assert.deepEqual(unbackedMethod(line, ""), [], line);
  // The ranking as the subject with a method verb is one.
  assert.deepEqual(unbackedMethod("This ranking is based on launch reviews.", ""), ["reviews"]);
});

test("a compare card may show another entry's figure when that entry's facts hold it", () => {
  const d = draft({
    entries: [
      entry(2, "Portal", 2007, ["At number two, Portal.", "Half-Life 2 scored 96 to Portal's 90.", ...filler("Portal", 3)], {
        1: { kind: "compare", primary: "Metacritic", items: ["Half-Life 2: 96", "Portal: 90"] },
      }),
      entry(1, "Half-Life 2", 2004, ["Number one is Half-Life 2.", ...filler("Half-Life 2", 3)]),
    ],
  });
  const r = disciplineLongform(d, HLPACK);
  assert.equal(r.draft.entries[0]!.moments[1]!.graphic.kind, "compare");
});

test("a pack that is another entry's own is never borrowed for a game without one", () => {
  const SMB3 = pack("Super Mario Bros. 3", "Background notes: Super Mario Bros. 3 is a 1988 platform game.");
  const d = draft({
    entries: [
      entry(2, "Super Mario Bros.", 1985, ["At number two, Super Mario Bros.", ...filler("Mario", 3)]),
      entry(1, "Super Mario Bros. 3", 1988, ["Number one is Super Mario Bros. 3.", ...filler("Mario 3", 3)]),
    ],
  });
  const r = disciplineLongform(d, [SMB3]);
  assert.equal(r.draft.entries[0]!.year, 1985, "the first game keeps its own year");
  assert.ok(!r.flags.some((f) => f.kind === "rank_year"));
});

test("the last resort never cuts the main clause after an opening subordinate clause", () => {
  const line = "When the sequel arrived in 2006, the series had sold ten million copies worldwide.";
  const d = draft({
    entries: [entry(1, "Portal", 2007, ["Number one is Portal.", line, "It still plays well today on a laptop.", ...filler("Portal", 4)])],
  });
  const b = blocker("the series had sold ten million copies worldwide", "No fact gives this sales figure.");
  const r = repairLongform(d, [b], (t) => t, { lastResort: true });
  // Not cut to "When the sequel arrived in 2006."; the whole sentence goes instead.
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.repairs[0]!.kind, "cut_sentence");
  assert.doesNotMatch(r.draft.entries[0]!.narration, /When the sequel arrived/);
});

test("the last resort never cuts a sentence the next one leans on with a pronoun", () => {
  const d = draft({
    entries: [
      entry(1, "Metal Gear Solid", 1998, [
        "Number one is Metal Gear Solid.",
        "Kojima hired Yoji Shinkawa in 1987 to draw the whole cast for every game.",
        "He drew every poster.",
        ...filler("Metal Gear Solid", 4),
      ]),
    ],
  });
  const b = blocker("hired Yoji Shinkawa in 1987", "Shinkawa joined Konami in 1994.");
  assert.deepEqual(repairLongform(d, [b], (t) => t, { lastResort: true }).unrepaired, [b]);
});
