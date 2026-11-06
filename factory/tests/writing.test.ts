// The written tells an audit of 60 videos found in the scripts (28 Oct 2026): each check sends a draft
// back once with an instruction a rewrite can follow, and leans towards missing a tell rather than
// raising a false alarm.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PULSE_VOICE,
  FORMAT_VOICE,
  voiceProblems,
  writingProblems,
  phraseProblems,
  copiedExamples,
  figuresIn,
  uncontractedForms,
  stockSegueProblems,
  repeatedRoles,
  repeatedTitles,
  sharedRuns,
} from "../src/editorial/voice.ts";
import {
  TAKE_SHAPES,
  takeShapeFor,
  hasConcession,
  isFactCommaQuestion,
} from "../src/editorial/phrasing.ts";
import {
  validateScript,
  writeScript,
  scriptPrompt,
  datesAndPrices,
  type RecentShapes,
} from "../src/editorial/editorial.ts";
import {
  FORMAT_RULES,
  fragments,
  validateEvergreen,
  evergreenScriptPrompt,
  type EvergreenScript,
} from "../src/editorial/evergreen.ts";
import {
  chapterPrompt,
  validateChapter,
  validateBookends,
  endsOnConsequence,
  priorSentencesFor,
  writeChapter,
  writeBookends,
  type DocChapter,
  type DocOutline,
} from "../src/editorial/documentary.ts";
import {
  validateRecapChapter,
  recapChapterPrompt,
} from "../src/editorial/recap.ts";
import { REHOOK_RULE } from "../src/editorial/rehooks.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { goodScript, item } from "./helpers.ts";

const has = (problems: string[], re: RegExp) =>
  problems.some((p) => re.test(p));

test("a possessive on a year is sent back, written or already made speakable", () => {
  assert.ok(
    has(
      voiceProblems("Its last Metal Gear, 2018's Survive, flopped."),
      /possessive on a year/,
    ),
  );
  assert.ok(
    has(
      voiceProblems("Its last Metal Gear, twenty eighteen's Survive, flopped."),
      /possessive on a year/,
    ),
  );
  assert.ok(
    has(
      phraseProblems("Twenty twenty-three's campaign sold well."),
      /possessive/,
    ),
  );
  assert.deepEqual(
    voiceProblems(
      "The 2023 campaign and the 1990s shooters still hold up. Konami's 2018 game flopped.",
    ),
    [],
  );
  assert.ok(
    !has(voiceProblems("Twenty people's saves were lost."), /possessive/),
  );
});

test("'speaking of' is a stock segue the voice never uses", () => {
  assert.ok(
    has(
      voiceProblems("Speaking of familiar faces, the next story has one."),
      /Speaking of/,
    ),
  );
});

test("an example line copied from a brief is sent back, a quotation is not", () => {
  assert.deepEqual(
    copiedExamples(
      "These five great Steam games cost less than a sandwich right now.",
    ),
    ["less than a sandwich", "five great Steam games"],
  );
  assert.ok(
    has(
      voiceProblems("To the Moon is just $1.49. Bring tissues."),
      /copied from an example/,
    ),
  );
  assert.ok(
    has(
      phraseProblems(
        "And that was only the start of it. This is how it began.",
      ),
      /only the start of it/,
    ),
  );
  assert.deepEqual(
    phraseProblems('The reviewer wrote "bring tissues" and meant it.'),
    [],
    "a quotation is the source's words, not ours",
  );
  assert.deepEqual(
    phraseProblems(
      "Five big games land this week, and two are worth your money.",
    ),
    [],
  );
});

test("colons: one in a Short, none read like a slide label, quotations and times excepted", () => {
  assert.deepEqual(writingProblems("Here is the catch: it costs $70."), []);
  assert.ok(
    has(
      writingProblems(
        "The catch: it costs $70. The upside: it ships in March.",
      ),
      /2 colons/,
    ),
  );
  assert.deepEqual(
    writingProblems(
      'Penn put it simply: "nobody wants to be the cop". Doors open at 9:30. The fix: a patch.',
    ),
    [],
  );
  // A long video gets one colon for every 400 words.
  const long = `${"word ".repeat(790)}The catch: one. The upside: two.`;
  assert.deepEqual(writingProblems(long, { long: true }), []);
});

test("uncontracted forms where speech contracts: two in a Short are sent back", () => {
  assert.deepEqual(
    uncontractedForms("It is not out yet, and they do not know when."),
    ["it is", "is not", "do not"],
  );
  assert.ok(
    has(
      writingProblems("It is not out yet, and they do not know when."),
      /contract "it is"/,
    ),
  );
  assert.deepEqual(
    writingProblems("It's not out yet, and it is what it is."),
    [],
  );
  assert.deepEqual(
    writingProblems(
      'Houser said "it is not a game, it is a world" and meant it.',
    ),
    [],
    "quotations keep their own wording",
  );
  assert.deepEqual(
    uncontractedForms("The game has been delayed and the studio is not alone."),
    ["is not"],
  );
});

test("a spoken platform list says 'PS5, Xbox and PC', never 'Series X|S'", () => {
  assert.ok(
    has(
      writingProblems("It's out on PC, PS5 and Xbox Series X|S."),
      /PS5, Xbox and PC/,
    ),
  );
  assert.ok(
    has(
      writingProblems("It's out on PC, PS5 and Xbox Series X and S."),
      /Series X\|S/,
    ),
  );
  assert.deepEqual(writingProblems("It's out on PS5, Xbox and PC."), []);
  assert.deepEqual(
    writingProblems("The Xbox Series X|S version runs at 60fps."),
    [],
  );
});

test("stacked figures: more than two in a sentence, a full date counting once and game numbers not at all", () => {
  assert.deepEqual(figuresIn("Preloads open November 12, 2026 on PS5."), [
    "DATEFIGURE",
  ]);
  assert.deepEqual(figuresIn("GTA 6 will eat 210GB of your PS5."), ["210GB"]);
  assert.deepEqual(figuresIn("In 2001, Final Fantasy 7 sold 10 million."), [
    "2001",
    "10",
  ]);
  assert.ok(
    has(
      writingProblems(
        "That bet paid off, with over 1 million sales in 24 hours and 2 million by March 2026.",
      ),
      /stacks 4 figures/,
    ),
  );
  assert.deepEqual(
    writingProblems(
      "It sold 2 million in three days. By March 2026 it passed 5 million.",
    ),
    [],
  );
});

test("stock segues in a long video: 'we think' twice, 'in fairness' and 'which, fair' once", () => {
  assert.deepEqual(
    stockSegueProblems(
      "We think so. In fairness, it works. Which, fair. We think it lands.",
    ),
    [],
  );
  const p = stockSegueProblems(
    "We think so. We think it works. We think it lands. In fairness, yes. In fairness, no. Which, fair. Which, fair.",
  );
  assert.equal(p.length, 3);
  assert.match(p[0]!, /"we think" comes 3 times/);
});

test("a person's role is spelled out on first mention only", () => {
  assert.deepEqual(
    repeatedRoles(
      "Rob Nelson, Rockstar North's co-studio head, said it was big. Later, Rob Nelson, Rockstar North's head of development, said more.",
    ),
    ["Rob Nelson"],
  );
  assert.deepEqual(
    repeatedRoles(
      "Producer David Jones cited Pac-Man. Later, producer David Jones moved on.",
    ),
    ["David Jones"],
  );
  assert.deepEqual(
    repeatedRoles(
      "Rob Nelson, Rockstar North's co-studio head, said it. Nelson agreed later.",
    ),
    [],
  );
});

test("full titles said more than twice in a Short; short names are fine", () => {
  const ff = "Final Fantasy 7 Remake Intergrade";
  assert.deepEqual(
    repeatedTitles(`${ff} joins Game Pass. ${ff} is huge. Is ${ff} worth it?`),
    [{ title: ff, times: 3 }],
  );
  assert.deepEqual(
    repeatedTitles(`${ff} joins Game Pass. Is ${ff} worth it?`),
    [],
  );
  assert.deepEqual(
    repeatedTitles(
      "Resident Evil scares. Resident Evil sells. Resident Evil lasts. Resident Evil wins.",
    ),
    [],
  );
  assert.deepEqual(
    repeatedTitles(
      "Call of Duty ranked. Call of Duty wins. Call of Duty lasts.",
      2,
      ["Call of Duty"],
    ),
    [],
  );
});

test("shared word runs ignore quotations and runs that are mostly names", () => {
  assert.deepEqual(
    sharedRuns(
      "the leak calls it double trouble for fans",
      ["a new leak calls it double trouble for fans"],
      6,
    ),
    ["leak calls it double trouble for", "calls it double trouble for fans"],
  );
  assert.deepEqual(
    sharedRuns(
      'He said "the leak calls it double trouble for fans"',
      ['"the leak calls it double trouble for fans"'],
      6,
    ),
    [],
  );
  assert.deepEqual(
    sharedRuns(
      "Final Fantasy 7 Remake Intergrade joins Game Pass",
      ["Final Fantasy 7 Remake Intergrade joins Game Pass"],
      6,
    ),
    [],
  );
});

test("take shapes: one per story, a concession at most one Short in three", () => {
  assert.equal(TAKE_SHAPES.length, 5);
  assert.deepEqual(
    takeShapeFor("story-a"),
    takeShapeFor("story-a"),
    "stable for the same story",
  );
  let concessions = 0;
  for (let i = 0; i < 600; i++)
    if (takeShapeFor(`seed-${i}`).id === "concession") concessions++;
  assert.ok(concessions < 600 / 3, `${concessions} of 600`);
  // A seed that would concede does not when one of the last two Shorts already did.
  const seed = Array.from({ length: 200 }, (_, i) => `s${i}`).find(
    (s) => takeShapeFor(s).id === "concession",
  )!;
  assert.notEqual(takeShapeFor(seed, [false, true]).id, "concession");
  assert.equal(takeShapeFor(seed, [false, false, true]).id, "concession");
});

test("concession and fact-comma-question shapes are recognised", () => {
  assert.ok(
    hasConcession(
      "In fairness, Rolling Stone called it leftovers. But it sold.",
    ),
  );
  assert.ok(hasConcession("Fair enough, a third date hurts."));
  assert.ok(
    hasConcession("Yes, Modern Warfare 4 tops 300GB. But GTA 6 has no disc."),
  );
  assert.ok(
    !hasConcession("Yes, it's worth it on day one."),
    "a plain yes answers the desk question",
  );
  assert.ok(
    !hasConcession("It isn't fair enough to call it a sequel."),
    "only at the start of a sentence",
  );
  assert.ok(
    isFactCommaQuestion(
      "After 2 million copies of Snake Eater, which Metal Gear would you want next?",
    ),
  );
  assert.ok(
    isFactCommaQuestion(
      "Before GTA 6 eats 210GB on November 19, which game are you deleting first?",
    ),
  );
  assert.ok(!isFactCommaQuestion("Day one, or wait for a sale?"));
  assert.ok(
    !isFactCommaQuestion("Which Metal Gear should Konami remake next?"),
  );
});

test("a Short says its hook's figure again, or a date three times: sent back", () => {
  assert.deepEqual(
    datesAndPrices("On November 19th it costs $69.99, up from $59.99."),
    ["november 19", "$69.99", "$59.99"],
  );
  const base = goodScript();
  const again = validateScript(
    goodScript({
      hook: "GTA 6 costs $79.99, and that matters for you.",
      beats: [
        {
          ...base.beats[0]!,
          narration: `At $79.99, ${base.beats[0]!.narration}`,
        },
        base.beats[1]!,
      ],
    }),
  );
  assert.ok(has(again, /first beat says the hook's "\$79.99" again/));
  const thrice = validateScript(
    goodScript({
      loop_line:
        "So if you're waiting on March 14, mark March 14 for Starfield's March 14 expansion.",
    }),
  );
  assert.ok(has(thrice, /"march 14" is said 3 times/));
});

test("data-feed lines: one time stamp and one 'on Steam' a Short, and not two Shorts running", () => {
  const feed = validateScript(
    goodScript({
      loop_line:
        "Right now it has 40,000 players on Steam today, so check it on Steam if you're waiting.",
    }),
  );
  assert.ok(has(feed, /"today" or "right now" comes 2 times/));
  assert.ok(has(feed, /"on Steam" comes 2 times/));
  const recent: RecentShapes = {
    takes: ["Honestly, this one"],
    loops: ["Keep playing, then."],
    scripts: ["Elden Ring has 50,000 players on Steam right now."],
  };
  const s = goodScript({
    loop_line: "It has 40,000 players on Steam right now, if you're waiting.",
  });
  const twice = validateScript(s, recent);
  assert.ok(has(twice, /last Short also stamped/));
  assert.ok(has(twice, /last Short also said "on Steam"/));
});

test("recent shapes: a concession and a fact-comma-question close count against the last Shorts", () => {
  const conceding = goodScript({
    pulse_take: {
      ...goodScript().pulse_take,
      narration:
        "Fair enough, a delay hurts. But Bethesda usually lands big content in better shape.",
    },
  });
  const recentConcession: RecentShapes = {
    takes: ["Honestly, this one", "In fairness, the studio"],
    loops: [],
  };
  assert.ok(
    has(validateScript(conceding, recentConcession), /concedes a point/),
  );
  assert.ok(
    !has(
      validateScript(conceding, {
        takes: ["Honestly, this one", "For us, the", "The way we"],
        loops: [],
      }),
      /concedes/,
    ),
    "a concession is fine when the last two Shorts had none",
  );
  const asking = goodScript({
    loop_line:
      "With early 2027 now the plan, will you wait for Starfield's expansion?",
  });
  const recentAsk: RecentShapes = {
    takes: [],
    loops: ["After 2 million copies, which Metal Gear would you want next?"],
  };
  assert.ok(
    has(validateScript(asking, recentAsk), /fact, a comma, then a question/),
  );
  assert.ok(
    !has(
      validateScript(asking, { takes: [], loops: ["Day one, or wait?"] }),
      /fact, a comma/,
    ),
  );
});

test("the same story told again in a recent Short is sent back; the platform list is not a story", () => {
  const s = goodScript();
  const copy = `${s.beats[0]!.narration} Different words follow here.`;
  assert.ok(
    has(
      validateScript(s, { takes: [], loops: [], scripts: ["Old news.", copy] }),
      /repeats a recent Short/,
    ),
  );
  assert.ok(
    !has(
      validateScript(s, {
        takes: [],
        loops: [],
        scripts: [
          "It's free on PC, PS5 and Xbox Series X and S with Game Pass.",
        ],
      }),
      /repeats a recent Short/,
    ),
  );
  assert.deepEqual(
    validateScript(s, {
      takes: ["Honestly, this one"],
      loops: ["Keep it, then."],
      scripts: ["Elden Ring sold well."],
    }),
    [],
  );
});

test("the news writer gets a take shape and the store data is one fact, not a feed", async () => {
  let content = "";
  const llm = {
    structured: async (req: { content: string }) => {
      content = req.content;
      return goodScript();
    },
  } as unknown as Llm;
  const cluster = {
    hash: "story-hash",
    items: [item("Starfield expansion delayed", "IGN")],
  } as never;
  await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    storeData: "Players now: 50,000",
  });
  assert.match(content, /This Short's take shape: /);
  assert.doesNotMatch(content, /figure from today/);
  assert.match(content, /never stamp it with "today" or "right now"/);
  assert.doesNotMatch(scriptPrompt(), /Isn't this just Mafia 2/);
  assert.match(scriptPrompt(), /never the hook's number again/);
});

test("the prompts describe shapes instead of example lines a writer could copy", () => {
  assert.match(PULSE_VOICE, /in fairness/);
  assert.doesNotMatch(PULSE_VOICE, /every preview we read/);
  assert.doesNotMatch(PULSE_VOICE, /\("which, fair"\)/);
  assert.doesNotMatch(FORMAT_VOICE.ranking, /Modern Warfare 2:/);
  const rules = Object.values(FORMAT_RULES).join(" ");
  for (const line of [
    "less than a sandwich",
    "Five stories ran gaming",
    "A stylish stealth classic",
    "Here is what actually mattered",
  ])
    assert.ok(!rules.includes(line), line);
  assert.match(evergreenScriptPrompt(), /one full sentence with a verb/);
  assert.doesNotMatch(chapterPrompt(), /It would not stay that way/);
  assert.match(REHOOK_RULE, /And that's where/);
  assert.match(recapChapterPrompt(), /speaking of/);
  for (const text of [
    PULSE_VOICE,
    scriptPrompt(),
    chapterPrompt(),
    evergreenScriptPrompt(),
    recapChapterPrompt(),
    rules,
  ])
    assert.ok(
      ![0x2014, 0x2013].some((c) => text.includes(String.fromCharCode(c))),
      "no em or en dashes",
    );
});

const evergreen = (lines: string[]): EvergreenScript => ({
  format: "steam_deals",
  theme: "Steam deals",
  title: "Great Steam Deals",
  hook: "Every game here costs under three dollars, and one is a classic you know.",
  entries: lines.map((one_line, i) => ({
    rank: lines.length - i,
    game_title: `Game ${i}`,
    steam_search_term: `Game ${i}`,
    year: 2015,
    platforms: "PC (Steam)",
    one_line,
    verdict_chip: "CULT CLASSIC",
    footage: { want: "gameplay", keywords: ["x"] },
  })),
  pulse_take: {
    label: "OUR PICK",
    narration:
      "Grab the classic first, because it still plays beautifully today.",
    on_screen: "Grab the classic",
  },
  loop_line: "Which of these are you grabbing before the weekend?",
  youtube: { title: "Five Steam Deals", description: "Deals.", tags: [] },
  claims: [],
});

test("evergreen lines are full sentences: a telegram fragment is sent back", () => {
  assert.deepEqual(
    fragments(
      "Now $1.99. Pure joy. It slaps. Grab it now. Nobody noticed. Day one?",
    ),
    ["Now $1.99.", "Pure joy."],
  );
  assert.deepEqual(fragments("Unmatched scale."), ["Unmatched scale."]);
  const ok = evergreen([
    "Green Hell is a survival game that sold millions, and it's $2.49.",
    "Finding Paradise is a quiet story game, and it's down to $1.99.",
    "Tomb Raider rebooted Lara well, and this one costs $2.99 now.",
    "Hollow Knight still has the best map in the genre for $4.99.",
  ]);
  assert.ok(
    !has(validateEvergreen(ok), /fragment|copied/),
    validateEvergreen(ok).join(" | "),
  );
  const bad = evergreen([
    "Green Hell is a survival game that sold millions. Now $2.49.",
    "Finding Paradise is a quiet story game for $1.99. Bring tissues.",
    "Tomb Raider rebooted Lara well, and this one costs $2.99 now.",
    "Hollow Knight still has the best map in the genre for $4.99.",
  ]);
  assert.ok(has(validateEvergreen(bad), /"Now \$2.49." is a fragment/));
  assert.ok(has(validateEvergreen(bad), /"bring tissues" is copied/));
});

const para = (narration: string) => ({
  narration,
  callout: { kind: "none" as const, primary: "", secondary: "" },
  footage: { want: "gameplay" as const, keywords: ["x"] },
});
const filler = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
const docChapter = (...extra: string[]): DocChapter => ({
  paragraphs: [
    para(`${filler(85, "a")}. So why did it work?`),
    ...extra.map((x, i) => para(`${filler(70, `x${i}`)}. ${x}`)),
    para(`${filler(85, "b")}. But it wouldn't last.`),
    para(`${filler(85, "c")}. What came next?`),
    para(`${filler(85, "d")}.`),
  ],
  claims: [{ claim: "It sold 10 million copies", section: "Sales" }],
});

test("documentary chapters: no seven-word run from an earlier chapter, no role twice, one 'That's a'", () => {
  const first = docChapter(
    "It became the fastest-selling entertainment product in history.",
    "Rob Nelson, Rockstar North's co-studio head, praised the team.",
  );
  assert.deepEqual(validateChapter(first), []);
  const second = docChapter(
    "Once more it became the fastest-selling entertainment product in history.",
    "Then Rob Nelson, Rockstar North's co-studio head, spoke again.",
  );
  assert.deepEqual(
    validateChapter(second),
    [],
    "on its own the chapter is fine",
  );
  const p = validateChapter(second, { earlier: [{ chapter: first }] });
  assert.ok(has(p, /repeats wording from an earlier chapter/), p.join(" | "));
  assert.ok(has(p, /Rob Nelson's role is spelled out again/));
  const thats = docChapter("That's a big claim. That's an even bigger bill.");
  assert.ok(has(validateChapter(thats), /2 sentences open "That's a"/));
  const prior =
    "Years later it became the fastest-selling entertainment product in history. Rob Nelson, Rockstar North's co-studio head, praised the team for it.";
  assert.ok(
    has(validateChapter(first, { priorDoc: prior }), /earlier documentary/),
  );
});

test("about one documentary chapter in three ends on a plain consequence", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(endsOnConsequence), [
    false,
    false,
    true,
    false,
    false,
    true,
  ]);
  assert.deepEqual(
    priorSentencesFor(
      "Vice City came out in 2002. San Andreas followed. The 2002 game sold well.",
      {
        game_title: "Vice City",
        year: 2002,
      },
    ),
    ["Vice City came out in 2002.", "The 2002 game sold well."],
  );
});

test("the documentary writer is told what earlier chapters said, how to end and the earlier documentary's wording", async () => {
  const seen: string[] = [];
  const llm = {
    structured: async (req: { system: string; content: string }) => {
      seen.push(`${req.system}\n${req.content}`);
      return docChapter();
    },
  } as unknown as Llm;
  const plan = {
    chapter_title: "The Leap to 3D",
    game_title: "Grand Theft Auto III",
    wiki_title: "Grand Theft Auto III",
    steam_search_term: "",
    year: 2001,
    platforms: "PS2",
    focus: "3D",
    photo_searches: [],
  };
  const outline = {
    title: "GTA",
    chapters: [plan, plan, plan],
  } as unknown as DocOutline;
  await writeChapter(llm, {
    franchise: "Grand Theft Auto",
    plan,
    index: 2,
    outline,
    source: { title: "GTA III", url: "u", text: "source" },
    earlier: [docChapter()],
    priorDoc:
      "Grand Theft Auto III changed everything in 2001. Something else.",
  });
  assert.match(
    seen[0]!,
    /Already said in earlier chapters[^]*It sold 10 million copies/,
  );
  assert.match(seen[0]!, /ends on a plain consequence/);
  assert.match(
    seen[0]!,
    /Don't reuse their wording[^]*Grand Theft Auto III changed everything in 2001/,
  );
  seen.length = 0;
  await writeBookends(llm, outline, [], "notes");
  assert.doesNotMatch(
    seen[0]!,
    /only the start of it|we have to go back to|This is the story of\.\.\./,
  );
  assert.ok(
    has(
      validateBookends({
        intro: {
          narration: `${filler(100, "i")}. And that was only the start of it.`,
          on_screen: "x",
        },
        outro: {
          label: "THE LEGACY",
          narration: filler(100, "o"),
          on_screen: "x",
        },
      }),
      /only the start of it/,
    ),
  );
});

test("a recap counts its stock lines across the whole video and bans 'speaking of'", () => {
  const story = (extra: string) => ({
    paragraphs: [
      para(`${filler(70, "a")}. ${extra}`),
      para(filler(80, "b")),
      para(filler(80, "c")),
    ],
    claims: [],
  });
  assert.deepEqual(validateRecapChapter(story("In fairness, it shipped.")), []);
  assert.ok(
    has(
      validateRecapChapter(story("In fairness, it shipped."), [
        story("In fairness, it was late."),
      ]),
      /"in fairness" comes 2 times/,
    ),
  );
  assert.ok(
    has(
      validateRecapChapter(story("Speaking of delays, there's more.")),
      /Speaking of/,
    ),
  );
});
