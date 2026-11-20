// The Inspiration rules (reports/Inspiration playlist forensics.md): each off by default, each tested on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOOK_STACK_MIN,
  NO_LONG_RULES,
  guideActionProblems,
  hookStackProblems,
  longRulesFor,
  longRulesOn,
  longRuleWarnings,
  namedPayoffProblems,
  saysPayoff,
  scriptMeasures,
  sentenceShortfall,
  sentenceStats,
  verdictHookProblems,
  verdictProblem,
  writerNoteProblems,
  youPer1000,
  youShortfall,
  type HookStack,
  type LongRuleSettings,
} from "../src/editorial/longrules.ts";
import {
  chapterPrompt,
  chapterRuleProblems,
  groundDocMoments,
  outlineDoc,
  sourceCredit,
  validateBookends,
  writeBookends,
  writeChapter,
  type DocChapter,
  type DocMoment,
  type DocOutline,
} from "../src/editorial/documentary.ts";
import {
  OPEN_LOOPS_MAX,
  OPEN_LOOP_RULE,
  groundOpenLoops,
  openLoopRule,
} from "../src/editorial/openloops.ts";
import {
  introWords,
  longformPrompt,
  longformToScript,
  validateLongform,
  writeLongform,
} from "../src/editorial/longform.ts";
import { capSamePicture, pictureMeasures } from "../src/render/picturecap.ts";
import {
  planGaps,
  usefulGraphic,
  type LongShot,
} from "../src/render/longplan.ts";
import { chooseFillers, needsOf } from "../src/assets/fillers.ts";
import { docRunDue, readRun } from "../src/shortrun.ts";
import { loadConfig } from "../src/config.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OFF: LongRuleSettings = {
  longYouPer1000: 0,
  guideYouPer1000: 35,
  longSentenceGate: 0,
  longHookStack: 0,
  longOpenLoopsMax: 0,
  loopNamePayoff: false,
  longVerdictStamps: false,
  longGuideFormat: false,
  guideChapterAction: false,
};
const ON: LongRuleSettings = {
  ...OFF,
  longYouPer1000: 25,
  longSentenceGate: 14,
  longHookStack: 5,
  longOpenLoopsMax: 8,
  loopNamePayoff: true,
  longVerdictStamps: true,
  longGuideFormat: true,
  guideChapterAction: true,
};

test("every rule is off by default and a guide entry alone changes nothing", () => {
  const cfg = loadConfig();
  assert.equal(cfg.longYouPer1000, 0);
  assert.equal(cfg.longSentenceGate, 0);
  assert.equal(cfg.longHookStack, 0);
  assert.equal(cfg.longOpenLoopsMax, 0);
  assert.equal(cfg.loopNamePayoff, false);
  assert.equal(cfg.longVerdictStamps, false);
  assert.equal(cfg.longGuideFormat, false);
  assert.equal(cfg.guideChapterAction, false);
  assert.equal(cfg.longSamePictureMaxSeconds, 0);
  assert.equal(cfg.longCardShare, 0);
  assert.equal(cfg.longStillXfadeFrames, 9);
  assert.equal(cfg.longMinWpm, 0);
  for (const kind of ["documentary", "ranking", "explained"] as const)
    assert.equal(longRulesOn(longRulesFor(OFF, kind, true)), false);
});

test("the rules for each format", () => {
  const guide = longRulesFor(ON, "documentary", true);
  assert.equal(guide.kind, "guide");
  assert.equal(guide.youFloor, 35);
  assert.equal(guide.sentenceGate, 14);
  assert.equal(guide.loopsMax, 8);
  assert.equal(guide.verdicts, true);
  const doc = longRulesFor(ON, "documentary");
  assert.equal(doc.youFloor, 25);
  assert.equal(doc.sentenceGate, 0, "a documentary's scenes keep their rhythm");
  assert.equal(doc.loopsMax, 0, "a documentary keeps its own cap of four");
  assert.equal(doc.verdicts, false);
  const ranking = longRulesFor(ON, "ranking");
  assert.equal(ranking.youFloor, 25);
  assert.equal(ranking.sentenceGate, 14);
  assert.equal(ranking.loopsMax, 3);
  const explained = longRulesFor(ON, "explained");
  assert.equal(explained.hookStack, 0);
  assert.equal(explained.youFloor, 25);
  // A guide entry with the format setting off runs as the documentary it always was.
  assert.equal(
    longRulesFor({ ...ON, longGuideFormat: false }, "documentary", true).guide,
    false,
  );
});

test("LONG_YOU_PER_1000: counts the family, not a quoted person's words", () => {
  assert.equal(
    youPer1000("You and your friends said you're fine yourself."),
    (4 / 8) * 1000,
  );
  assert.equal(youPer1000(`He said "you are all fired today" and left.`), 0);
  assert.equal(youPer1000("Young yogurt youth"), 0);
});

test("LONG_YOU_PER_1000: the script so far is measured, and a low chapter is forgiven when the rest make up for it", () => {
  const high = "You see it and you pay for it and your save is fine. ".repeat(
    20,
  );
  const low = "The studio shipped the game in the spring of that year. ".repeat(
    20,
  );
  assert.equal(youShortfall([high], low, 25), undefined);
  const miss = youShortfall([], low, 25);
  assert.ok(miss?.includes("25"));
  assert.ok(miss?.includes("Keep every fact"));
  assert.equal(youShortfall([], low, 0), undefined);
  // A chapter already over the floor is never sent back, whatever came before: revising it wouldn't help.
  assert.equal(youShortfall([low, low, low], high, 25), undefined);
});

test("LONG_SENTENCE_GATE: mean under the limit, and the same forgiving measure", () => {
  const long =
    "This is a sentence that keeps on going and going with many more words than it should have in it. ".repeat(
      5,
    );
  const short = "It works. You can see it now. ".repeat(10);
  assert.ok(sentenceStats(long).mean > 14);
  assert.ok(sentenceShortfall([], long, 14)?.includes("under 14"));
  assert.equal(sentenceShortfall([short, short, short], long, 14), undefined);
  assert.equal(sentenceShortfall([], short, 14), undefined);
  assert.equal(sentenceShortfall([], long, 0), undefined);
  assert.deepEqual(longRuleWarnings(short, NO_LONG_RULES), []);
  assert.equal(
    longRuleWarnings(long, { ...NO_LONG_RULES, sentenceGate: 14, youFloor: 25 })
      .length,
    2,
  );
  assert.equal(scriptMeasures("You go. It stops.").you, 250);
});

const stack: HookStack = {
  stakes: "Your first evening depends on this",
  surprises: [
    { tease: "police remember your clothes", chapter: 1 },
    { tease: "litter helps your criminal record", chapter: 2 },
    { tease: "cash goals lock the story", chapter: 3 },
  ],
  trust: "We checked every claim against Rockstar's own pages",
  saved: { tease: "the map number most people believe", chapter: 4 },
};
const introGood =
  "Your first evening with GTA 6 depends on what you unlearn. The police remember your clothes. Litter helps your criminal record. Cash goals lock the story. We checked every claim against Rockstar's own pages. And we're keeping the map number most people believe for last.";
const chaptersGood = [
  "The police remember your clothes when you run, and clothes are how they find you.",
  "Your criminal record shrinks when litter gets picked up, so litter helps.",
  "Cash goals lock the story until you reach them, and the story waits.",
  "The map number most people believe is a fan estimate, and Rockstar has never given a map number.",
];

test("LONG_HOOK_STACK: a stack that's said and paid passes; 0 asks nothing", () => {
  assert.deepEqual(hookStackProblems(introGood, stack, 5, chaptersGood), []);
  assert.deepEqual(
    hookStackProblems("On April 4, 1995, a team met.", undefined, 0, []),
    [],
  );
  assert.ok(HOOK_STACK_MIN === 3);
});

test("LONG_HOOK_STACK: a date first, no 'you', too few surprises and unpaid promises are all sent back", () => {
  const dated = hookStackProblems(
    `On April 4, 1995, a small team met. ${introGood}`,
    stack,
    5,
    chaptersGood,
  );
  assert.ok(dated.some((x) => x.includes("opens on a date")));
  assert.ok(
    hookStackProblems(
      "The game is big. It ships soon. More follows.",
      stack,
      5,
      chaptersGood,
    ).some((x) => x.includes('never say "you"')),
  );
  assert.ok(
    hookStackProblems(introGood, undefined, 5, chaptersGood).some((x) =>
      x.includes("hook_stack"),
    ),
  );
  assert.ok(
    hookStackProblems(
      introGood,
      { ...stack, surprises: stack.surprises.slice(0, 2) },
      5,
      chaptersGood,
    ).some((x) => x.includes("names 2 surprises")),
  );
  const unpaid = hookStackProblems(introGood, stack, 5, [
    "Nothing here.",
    chaptersGood[1]!,
    chaptersGood[2]!,
    "Nothing about that at all.",
  ]);
  assert.ok(unpaid.some((x) => x.includes("doesn't pay it")));
  assert.ok(unpaid.some((x) => x.includes("saved for the end")));
  assert.ok(
    hookStackProblems(
      introGood,
      { ...stack, trust: "We played it for six hours on every console" },
      5,
      chaptersGood,
    ).length > 0,
  );
});

test("the older opening stays exactly as it was with the rules off", async () => {
  let system = "";
  const llm = {
    structured: async (o: { system: string }) => {
      system = o.system;
      return {
        intro: { narration: "x", on_screen: "x" },
        outro: { label: "x", narration: "y", on_screen: "y" },
      };
    },
  } as never;
  const outline = {
    title: "T",
    question: "Q?",
    chapters: [],
  } as unknown as DocOutline;
  await writeBookends(llm, outline, [], "notes");
  assert.ok(system.includes("the first sentence names a date, a place"));
  assert.ok(!system.includes("stacked hook"));
  await writeBookends(llm, outline, [], "notes", {
    rules: longRulesFor(ON, "documentary", true),
  });
  assert.ok(system.includes("stacked hook"));
  assert.ok(system.includes("No date or year in the first sentence"));
  assert.ok(system.includes("confirmed, reported and busted"));
  assert.ok(!system.includes("the first sentence names a date, a place"));
});

test("validateBookends reads the stack and, in a guide, that the verdicts are taught", () => {
  const b = {
    intro: { narration: introGood, on_screen: "x", hook_stack: stack },
    outro: { label: "X", narration: "y ".repeat(90), on_screen: "y" },
  };
  const guide = longRulesFor(ON, "documentary", true);
  const p = validateBookends(b, { rules: guide, chapters: chaptersGood });
  assert.ok(p.some((x) => x.includes("three verdicts")));
  assert.equal(
    verdictHookProblems("It's confirmed, reported or busted.").length,
    0,
  );
  // Off: none of it is asked.
  assert.ok(!validateBookends(b, {}).some((x) => x.includes("verdicts")));
});

test("LONG_OPEN_LOOPS_MAX: a guide keeps up to eight, a documentary still four", () => {
  const loops = Array.from({ length: 9 }, (_, i) => ({
    question: `What does thing number ${i + 1} do to your first day?`,
    plant_chapter: i === 0 ? 0 : i,
    payoff_chapter: i + 2,
  }));
  assert.equal(groundOpenLoops(loops, 12).loops.length, OPEN_LOOPS_MAX);
  assert.equal(groundOpenLoops(loops, 12, { max: 8 }).loops.length, 8);
  const cold = Array.from({ length: 5 }, (_, i) => ({
    question: `What does thing number ${i + 1} do to your first day?`,
    plant_chapter: 0,
    payoff_chapter: i + 2,
  }));
  assert.equal(groundOpenLoops(cold, 12).loops.length, 2);
  assert.equal(
    groundOpenLoops(cold, 12, { max: 8, coldOpen: 5 }).loops.length,
    5,
  );
  const rule = openLoopRule({ max: 8, coldOpen: 5, what: "guide" });
  assert.ok(rule.includes("2-8 questions this guide"));
  assert.ok(rule.includes("the cold open may raise 5"));
  assert.ok(
    rule.includes("never a rumour"),
    "a loop's still answerable for certain",
  );
  assert.ok(OPEN_LOOP_RULE.includes("2-4 questions this documentary"));
});

test("LOOP_NAME_PAYOFF: an answer has to say it's the promise kept", () => {
  const l = [
    {
      question: "Why does the map number keep changing?",
      plant_chapter: 0,
      payoff_chapter: 4,
    },
  ];
  const plain = [
    "The map number keeps changing because fans estimate the map number.",
  ];
  const named = [
    "That's the number from the start.",
    "The map number keeps changing because fans estimate the map number.",
  ];
  assert.equal(namedPayoffProblems(plain, l, 4).length, 1);
  assert.equal(namedPayoffProblems(named, l, 4).length, 0);
  assert.equal(namedPayoffProblems(plain, l, 3).length, 0);
  assert.ok(saysPayoff(["Remember the habit we said would cost you?"], 0));
  assert.ok(!saysPayoff(["It costs twenty dollars."], 0));
});

const SOURCE =
  "rockstar games says the game launches on november 19 kotaku reported it runs at 30 fps";

test("LONG_VERDICT_STAMPS: a stamp only where the sentence says it, and who says it is named", () => {
  const ok = (word: string, who: string, s: string) =>
    verdictProblem({ primary: word, secondary: who }, s, SOURCE) === "";
  assert.ok(
    ok(
      "CONFIRMED",
      "Rockstar Games",
      "Rockstar Games has confirmed that date for you.",
    ),
  );
  assert.ok(ok("REPORTED", "Kotaku", "Kotaku reported it runs at 30 fps."));
  assert.ok(
    ok(
      "BUSTED",
      "",
      "That map size is a fan estimate, and Rockstar has never given one.",
    ),
  );
  assert.ok(
    !ok("CONFIRMED", "Rockstar Games", "Rockstar Games shipped a trailer."),
    "the sentence must say it",
  );
  assert.ok(!ok("REPORTED", "", "Kotaku reported it."), "nobody named");
  assert.ok(
    !ok("REPORTED", "Some Outlet", "Some Outlet reported it."),
    "not in the source",
  );
  assert.ok(
    !ok("MAYBE", "Kotaku", "Kotaku reported it."),
    "only the three words",
  );
});

test("LONG_VERDICT_STAMPS: a rumour can't be stamped into a fact", () => {
  const bad = (word: string, who: string, s: string) =>
    verdictProblem(
      { primary: word, secondary: who },
      s,
      `${SOURCE} ign insider`,
    ) !== "";
  // Confirmation needs the publisher's or platform's own word: an outlet saying so stays reported.
  assert.ok(bad("CONFIRMED", "Kotaku", "Kotaku confirmed it runs at 30 fps."));
  assert.ok(
    bad(
      "CONFIRMED",
      "Rockstar",
      "Rockstar hasn't confirmed it, and it's a rumor.",
    ),
  );
  // Nothing leaked or datamined gets a verdict, even "reported".
  assert.ok(
    bad("CONFIRMED", "Rockstar", "The leak confirmed what Rockstar planned."),
  );
  assert.ok(
    bad("REPORTED", "IGN", "IGN reported what the datamined files show."),
  );
  // Calling a leak false is the one verdict allowed near one.
  assert.ok(!bad("BUSTED", "", "That leak is false."));
});

test("LONG_VERDICT_STAMPS: off, or on a line that doesn't earn it, a stamp never reaches the screen", () => {
  const m = (primary: string, secondary = ""): DocMoment =>
    ({
      show: "x",
      keywords: [],
      broll: "",
      emphasis: "",
      person: "",
      graphic: { kind: "verdict", primary, secondary, items: [] },
    }) as DocMoment;
  const none = {
    show: "x",
    keywords: [],
    broll: "",
    emphasis: "",
    person: "",
    graphic: { kind: "none", primary: "", secondary: "", items: [] },
  } as DocMoment;
  const sentences = [
    "You start here.",
    "Rockstar Games has confirmed the date.",
    "Kotaku says it runs at 30 fps.",
  ];
  const source = { title: "GTA", url: "u", text: SOURCE } as never;
  const off = groundDocMoments(
    [none, m("CONFIRMED", "Rockstar Games"), none],
    source,
    [],
    sentences,
  );
  assert.equal(off.moments[1]!.graphic.kind, "none");
  const on = groundDocMoments(
    [none, m("confirmed", "Rockstar Games"), m("CONFIRMED", "Kotaku")],
    source,
    [],
    sentences,
    true,
  );
  assert.equal(on.moments[1]!.graphic.kind, "verdict");
  assert.equal(on.moments[1]!.graphic.primary, "CONFIRMED");
  assert.equal(on.moments[2]!.graphic.kind, "none");
  assert.ok(on.removed.some((x) => x.startsWith("verdict")));
  assert.ok(
    usefulGraphic({ kind: "verdict", primary: "BUSTED", secondary: "" }),
  );
});

test("LONG_GUIDE_FORMAT and GUIDE_CHAPTER_ACTION: the journey brief, and a chapter that ends on a job", async () => {
  const guide = longRulesFor(ON, "documentary", true);
  const prompt = chapterPrompt(guide);
  assert.ok(prompt.includes("launch guide"));
  assert.ok(prompt.includes("one specific job to do on day one"));
  assert.ok(prompt.includes("Verdicts:"));
  assert.ok(!prompt.includes("names the year"));
  assert.ok(chapterPrompt().includes("names the year"));
  assert.ok(!chapterPrompt().includes("Verdicts:"));
  assert.equal(
    guideActionProblems(
      "It works. Before you start the first mission, set your radio. So what does it cost?",
    ).length,
    0,
  );
  assert.equal(
    guideActionProblems("It works. The studio made it. They shipped it.")
      .length,
    1,
  );
  assert.equal(
    guideActionProblems("It works. Check your storage now. Where do you go?")
      .length,
    0,
  );
  let system = "";
  const llm = {
    structured: async (o: { system: string }) => {
      system = o.system;
      return {};
    },
  } as never;
  await outlineDoc(
    llm,
    { kind: "story", franchise: "GTA", title_idea: "T", angle: "a" } as never,
    "n",
    {
      openLoops: true,
      rules: guide,
    },
  );
  assert.ok(system.includes("viewer's own first day"));
  assert.ok(system.includes("2-8 questions this guide"));
  await outlineDoc(
    llm,
    { kind: "story", franchise: "GTA", title_idea: "T", angle: "a" } as never,
    "n",
    { openLoops: true },
  );
  assert.ok(system.includes("single-story documentary"));
  assert.ok(system.includes("2-4 questions this documentary"));
});

const chapter = (text: string): DocChapter =>
  ({
    paragraphs: ["The first part of it.", "The second part of it.", "The third part of it.", text].map((narration) => ({
      narration,
      callout: { kind: "none", primary: "", secondary: "" },
      footage: { want: "gameplay", keywords: [], moment: "" },
    })),
    claims: [],
  }) as never;

test("a miss on a first draft asks for one revision, by edits, with the rule named", async () => {
  const rules = longRulesFor(ON, "documentary", true);
  const draft = chapter(
    "The studio shipped the game that year and it sold well. They were pleased.",
  );
  const misses = chapterRuleProblems(draft, { rules, written: [], chapter: 1 });
  assert.ok(misses.some((x) => x.includes("35")));
  assert.ok(misses.some((x) => x.includes("job for day one")));
  assert.deepEqual(
    chapterRuleProblems(draft, {
      rules: NO_LONG_RULES,
      written: [],
      chapter: 1,
    }),
    [],
  );
  const calls: Array<{ site?: string; content: string }> = [];
  const llm = {
    structured: async (o: { site?: string; content: string }) => {
      calls.push(o);
      return {
        edits: [{ find: "They were pleased.", replace: "You can see why." }],
      };
    },
  } as never;
  const plan = {
    chapter_title: "T",
    game_title: "G",
    wiki_title: "G",
    steam_search_term: "",
    year: 2026,
    platforms: "PS5",
    focus: "f",
    photo_searches: [],
  };
  const outline = { title: "T", chapters: [plan] } as unknown as DocOutline;
  const out = await writeChapter(llm, {
    franchise: "G",
    plan,
    index: 0,
    outline,
    source: { title: "G", url: "u", text: "t" } as never,
    feedback: misses,
    draft,
    rules,
  });
  assert.equal(calls.length, 1, "one call");
  assert.equal(
    calls[0]!.site,
    "doc.chapter",
    "a revision goes where the draft went",
  );
  assert.ok(out.paragraphs[3]!.narration.endsWith("You can see why."));
});

const entryBody = (narration: string) => ({
  year: 2010,
  narration,
  footage: { want: "gameplay", keywords: ["x"] },
  claims: [],
});

test("a ranking: the brief changes only when the rule is on, and a long first draft gets one revision before its shot list", async () => {
  const on = longRulesFor(ON, "ranking");
  assert.ok(longformPrompt().includes("six to ten sentences"));
  assert.ok(
    longformPrompt({ rules: on }).includes("ten to sixteen short sentences"),
  );
  assert.ok(longformPrompt({ rules: on }).includes("stacked hook"));
  assert.ok(
    longformPrompt({ rules: on }).includes("2-3 questions this ranking"),
  );
  assert.ok(!longformPrompt().includes("stacked hook"));
  assert.deepEqual(introWords(on), [90, 200]);
  assert.deepEqual(introWords(), [60, 140]);

  const longLine =
    "This entry keeps on going and going with many more words than anyone should ever put in one sentence. ";
  const sites: string[] = [];
  const plan = {
    theme: "T",
    title: "T",
    criterion: "c",
    intro: {
      narration: "You'll argue with this order. You will.",
      on_screen: "x",
    },
    outro: { narration: "o", on_screen: "o" },
    youtube: { title: "t", description: "d", tags: [] },
    entries: [1, 2].map((rank) => ({
      rank,
      game_title: `G${rank}`,
      steam_search_term: "",
      year: 2010,
      platforms: "PC",
      verdict_chip: "ok",
      angle: "a",
    })),
  };
  const llm = {
    structured: async (o: { site?: string; content: string }) => {
      sites.push(o.site ?? "?");
      if (o.site === "longform.plan" && !o.content.includes("YOUR DRAFT"))
        return plan;
      if (o.site === "longform.write" && !o.content.includes("YOUR DRAFT"))
        return entryBody(longLine.repeat(3));
      if (o.content.includes("YOUR DRAFT"))
        return {
          edits: [
            {
              find: "with many more words than anyone should ever put in one sentence.",
              replace: "and you notice.",
            },
          ],
        };
      if (o.site === "longform.shots") return { moments: [] };
      return {};
    },
  } as never;
  const out = await writeLongform(
    llm,
    { theme: "T", title_idea: "T", criterion: "c", format: "ranking" } as never,
    [],
    [],
    "",
    {
      rules: { ...NO_LONG_RULES, kind: "ranking", sentenceGate: 14 },
    },
  );
  // Two entries, each written then revised once, and no second whole draft.
  assert.equal(sites.filter((x) => x === "longform.plan").length, 1);
  // The first is revised; the second may be forgiven when the script so far is back under the limit.
  assert.ok(sites.filter((x) => x === "longform.write").length >= 3);
  assert.ok(out.entries.some((x) => x.narration.includes("and you notice.")));
  // Off: one call an entry and nothing revised.
  sites.length = 0;
  await writeLongform(
    llm,
    { theme: "T", title_idea: "T", criterion: "c", format: "ranking" } as never,
    [],
    [],
    "",
    {},
  );
  assert.equal(sites.filter((x) => x === "longform.write").length, 2);
});

test("a ranking's revisions stop at the cap, so a writer that can't reach a floor can't run up a bill", async () => {
  const sites: string[] = [];
  const plan = {
    theme: "T",
    title: "T",
    criterion: "c",
    intro: { narration: "Intro line here.", on_screen: "x" },
    outro: { narration: "o", on_screen: "o" },
    youtube: { title: "t", description: "d", tags: [] },
    entries: [1, 2, 3, 4, 5, 6].map((rank) => ({
      rank,
      game_title: `G${rank}`,
      steam_search_term: "",
      year: 2010,
      platforms: "PC",
      verdict_chip: "ok",
      angle: "a",
    })),
  };
  const llm = {
    structured: async (o: { site?: string; content: string }) => {
      sites.push(o.site ?? "?");
      if (o.content.includes("YOUR DRAFT"))
        return { edits: [{ find: "nothing like this", replace: "x" }] };
      if (o.site === "longform.plan") return plan;
      if (o.site === "longform.write")
        return entryBody(
          "The studio shipped it in the spring of that year and it did well enough.",
        );
      return { moments: [] };
    },
  } as never;
  await writeLongform(
    llm,
    { theme: "T", title_idea: "T", criterion: "c", format: "ranking" } as never,
    [],
    [],
    "",
    {
      rules: { ...NO_LONG_RULES, kind: "ranking", youFloor: 25 },
    },
  );
  assert.equal(sites.filter((x) => x === "longform.write").length, 6 + 3);
});

test("a ranking's placed loops reach the script; with none, the script is as it was", () => {
  const e = {
    theme: "T",
    title: "T",
    criterion: "c",
    intro: { narration: "x", on_screen: "x" },
    outro: { narration: "o", on_screen: "o" },
    youtube: { title: "t", description: "d", tags: [] },
    entries: [],
    claims: [],
  } as never;
  assert.equal(longformToScript(e).open_loops, undefined);
  const placed = [
    {
      question: "q?",
      plant: { entry: -1, moment: 0 },
      payoff: { entry: 2, moment: 1 },
    },
  ];
  assert.deepEqual(
    longformToScript({ ...(e as object), placed_loops: placed } as never)
      .open_loops,
    placed,
  );
  assert.ok(validateLongform(e).some((x) => x.includes("it must be 60-140")));
  assert.ok(
    validateLongform(e, longRulesFor(ON, "ranking")).some((x) =>
      x.includes("it must be 90-200"),
    ),
  );
});

// ---------------------------------------------------------------- pictures

const shot = (
  start: number,
  end: number,
  index: number,
  segment = 1,
): LongShot => ({
  start,
  end,
  segment,
  media: { type: "image", index },
  move: "pushIn",
});
const FPS = 30;
const media = (
  images: Array<Record<string, unknown>>,
  clips: Array<Record<string, unknown>> = [],
) => ({
  images: images as never,
  clips: clips as never,
  real: (k: number) => images[k]?.kind === "photo",
  entryOf: () => 0,
  clipsPlayed: new Set<number>(),
});

test("LONG_SAME_PICTURE_MAX_SECONDS: 46 seconds on one picture becomes a walk through the chapter's others", () => {
  const m = media([
    { file: "a.jpg", kind: "hero", beatIndex: 0 },
    { file: "b.jpg", kind: "screenshot", beatIndex: 0 },
    { file: "c.jpg", kind: "screenshot", beatIndex: 0 },
    { file: "d.jpg", kind: "screenshot", beatIndex: 0 },
    { file: "e.jpg", kind: "screenshot", beatIndex: 0 },
  ]);
  const r = capSamePicture([shot(0, 46 * FPS, 0)], 12, FPS, m);
  assert.ok(r.replaced >= 3);
  assert.equal(r.unresolvedSeconds, 0);
  assert.equal(
    r.shots.at(-1)!.end,
    46 * FPS,
    "nothing lost from the running time",
  );
  r.shots.forEach((s, i) => {
    if (i) assert.equal(s.start, r.shots[i - 1]!.end, "no gaps");
    assert.ok(s.end - s.start <= 12 * FPS + 2.5 * FPS);
    assert.ok(s.end - s.start >= 2.5 * FPS, "no flashes");
  });
  const after = pictureMeasures(
    { fps: FPS, totalFrames: 46 * FPS, shots: r.shots },
    m,
  );
  assert.ok(after.longestHoldSeconds <= 14.5);
  const before = pictureMeasures(
    { fps: FPS, totalFrames: 46 * FPS, shots: [shot(0, 46 * FPS, 0)] },
    m,
  );
  assert.equal(before.longestHoldSeconds, 46);
});

test("LONG_SAME_PICTURE_MAX_SECONDS: off is untouched; a picture coming back counts; two listings of a file are one picture", () => {
  const m = media([
    { file: "a.jpg", kind: "hero", beatIndex: 0 },
    { file: "A.jpg".toLowerCase(), kind: "screenshot", beatIndex: 0 },
    { file: "b.jpg", kind: "screenshot", beatIndex: 0 },
    { file: "c.jpg", kind: "screenshot", beatIndex: 0 },
  ]);
  const shots = [
    shot(0, 8 * FPS, 0),
    shot(8 * FPS, 16 * FPS, 2),
    shot(16 * FPS, 24 * FPS, 1),
  ];
  assert.deepEqual(capSamePicture(shots, 0, FPS, m).shots, shots);
  const r = capSamePicture(shots, 12, FPS, m);
  const onA = r.shots.filter(
    (s) =>
      s.media.type === "image" && (s.media.index === 0 || s.media.index === 1),
  );
  const seconds = onA.reduce((n, s) => n + (s.end - s.start), 0) / FPS;
  assert.ok(
    seconds <= 12 + 2.5,
    `one file's total in the minute was ${seconds}`,
  );
});

test("LONG_SAME_PICTURE_MAX_SECONDS: an unplayed clip comes first; a real photo stays on its sentence; another game's art never comes in", () => {
  const m = media(
    [
      { file: "a.jpg", kind: "hero", beatIndex: 0 },
      { file: "photo.jpg", kind: "photo", beatIndex: 0, moment: 3 },
      { file: "other.jpg", kind: "screenshot", beatIndex: 1 },
    ],
    [{ file: "clip.mp4", beatIndex: 0, durationSeconds: 6 }],
  );
  const r = capSamePicture([shot(0, 40 * FPS, 0)], 12, FPS, m);
  assert.ok(
    r.shots.some((s) => s.media.type === "clip" && s.media.index === 0),
  );
  assert.ok(
    !r.shots.some((s) => s.media.type === "image" && s.media.index !== 0),
  );
  assert.ok(r.unresolvedSeconds > 0, "it says so when the chapter runs out");
  assert.deepEqual(r.thinEntries, [0]);
});

test("picture cap never spends a scene reserved for a later sentence", () => {
  const m = media([{ file: "a.jpg", kind: "hero", beatIndex: 0 }],
    [{ file: "scene.mp4", beatIndex: 0, durationSeconds: 6, cutsceneMatch: { targetKey: "beat:0#m7", how: "chapter" } }]);
  const result = capSamePicture([shot(0, 40 * FPS, 0)], 12, FPS, m);
  assert.ok(result.shots.every((item) => item.media.type !== "clip"));
  assert.ok(result.unresolvedSeconds > 0);
});

test("LONG_SAME_PICTURE_MAX_SECONDS: an entry holding one picture counts as thin, so the top-up brings it more", () => {
  const segments = [
    { kind: "hook", start: 0, end: 10, text: "h" },
    { kind: "beat", start: 10, end: 60, text: "b" },
  ] as never;
  const plan = {
    version: 1 as const,
    fps: FPS,
    totalFrames: 60 * FPS,
    tailFrames: 0,
    shots: [shot(10 * FPS, 58 * FPS, 0)],
  };
  assert.deepEqual(planGaps(plan, segments), []);
  assert.deepEqual(
    planGaps(plan, segments, undefined, 12).map((g) => g.entry),
    [0],
  );
});

test("the measures: repeats, the worst minute and cards counted once", () => {
  const m = media([
    { file: "a.jpg", kind: "hero", beatIndex: 0 },
    { file: "b.jpg", kind: "screenshot", beatIndex: 0 },
  ]);
  const plan = {
    fps: FPS,
    totalFrames: 40 * FPS,
    shots: [
      shot(0, 10 * FPS, 0),
      shot(10 * FPS, 20 * FPS, 1),
      shot(20 * FPS, 40 * FPS, 0),
    ],
  };
  const x = pictureMeasures(plan, m, [
    { start: 0, end: 4 },
    { start: 2, end: 6 },
  ]);
  assert.equal(x.longestHoldSeconds, 20);
  assert.equal(x.worstMinuteSeconds, 30);
  assert.equal(x.repeatShare, 0.5);
  assert.equal(x.cardShare, 0.15);
});

test("LONG_CARD_SHARE: off, a line with its own still keeps it; on, a sure filler may take it until the share is met", () => {
  const moments = Array.from({ length: 6 }, () => ({
    show: "x",
    graphic: { kind: "none", primary: "", secondary: "", items: [] },
    emphasis: "",
    person: "",
  }));
  const ch = {
    entry: 0,
    game: "G",
    year: 2020,
    sentences: moments.map((_, k) =>
      k % 2
        ? "Players with limited free time shaped the design too."
        : "The replacement announcement presents a separate sourcing gap.",
    ),
    moments,
  };
  const images = moments.map((_, k) => ({
    file: `s${k}.jpg`,
    kind: "screenshot",
    beatIndex: 0,
    moment: k,
  }));
  assert.equal(needsOf(ch as never, images, [] as never).size, 0);
  assert.equal(needsOf(ch as never, images, [] as never, true).size, 5);
  const off = chooseFillers([ch] as never, { images, clips: [], seed: 1 });
  assert.equal(off.picks.length, 0);
  const on = chooseFillers([ch] as never, {
    images,
    clips: [],
    seed: 1,
    cardShare: 0.3,
  });
  assert.ok(on.picks.length >= 1, "takes some");
  assert.ok(
    on.picks.length <= 3,
    `stops near the share, took ${on.picks.length}`,
  );
});

// ---------------------------------------------------------------- the launch run

test("the launch file's Part 1 is a guide with named sources; a run entry carries them; Part 2 stays a documentary", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const run = readRun(path.join(here, "..", "launch_run.json"));
  const part1 = run.find((e) => e.kind === "doc" && e.date === "2026-11-10");
  const part2 = run.find((e) => e.kind === "doc" && e.date === "2026-11-21");
  assert.equal(part1?.kind === "doc" && part1.format, "guide");
  assert.ok(part1?.kind === "doc" && (part1.sources?.length ?? 0) >= 5);
  assert.ok(part1?.kind === "doc" && part1.sources!.some((s) => s.official));
  assert.equal(part2?.kind === "doc" ? part2.format : "x", undefined);
  const due = docRunDue(
    run,
    new Date("2026-11-09T00:30:00Z"),
    [],
    "Europe/London",
  );
  assert.equal(due?.topic.format, "guide");
  assert.ok((due?.topic.sources?.length ?? 0) >= 5);
});

test("a passage from a guide's article is credited to it, one from its added sources to the outlet", () => {
  const source = {
    title: "Grand Theft Auto VI",
    url: "u",
    text: "The article says the game is set in Leonida.\n\n[Kotaku] GTA 6 pre-load times\nThe install is up to 212 GB on some devices.",
  } as never;
  assert.equal(
    sourceCredit("the game is set in Leonida", source),
    "Wikipedia: Grand Theft Auto VI",
  );
  assert.equal(
    sourceCredit("The install is up to 212 GB on some devices", source),
    "Kotaku: GTA 6 pre-load times",
  );
});

test("DOC_META_GUARD: a note to the editor is caught, and ordinary narration isn't", () => {
  // The FFXIV documentary's chapter 6, as voiced on 4 Nov 2026.
  for (const line of [
    "These paragraphs flag the missing evidence. They aren't a finished documentary chapter.",
    "They shouldn't be recorded or published as narration.",
    "This excerpt cannot substantiate the chapter's central claim.",
    "Please provide the omitted shutdown and story transition material.",
    "That gap matters under your source rule.",
  ])
    assert.equal(writerNoteProblems(line).length, 1, line);
  for (const line of [
    "The source code leaked, and Rockstar said so.",
    "Please stop asking about the map, one fan wrote.",
    "If you've ever sat through a rough launch, that last one will sound familiar.",
    "The excerpts in the magazine ran for three pages.",
  ])
    assert.equal(writerNoteProblems(line).length, 0, line);
  assert.equal(writerNoteProblems(`He called it "the brief" and left.`).length, 0);
});

test("a revision only the rules asked for keeps the draft when its edits don't land, so it can never buy a whole new chapter", async () => {
  let calls = 0;
  const llm = {
    structured: async () => {
      calls++;
      return { edits: [{ find: "nothing like this anywhere", replace: "x" }] };
    },
  } as never;
  const draft = chapter("The studio shipped the game that year.");
  const plan = { chapter_title: "T", game_title: "G", wiki_title: "G", steam_search_term: "", year: 2026, platforms: "PS5", focus: "f", photo_searches: [] };
  const out = await writeChapter(llm, {
    franchise: "G",
    plan,
    index: 0,
    outline: { title: "T", chapters: [plan] } as never,
    source: { title: "G", url: "u", text: "t" } as never,
    feedback: ["Say you more."],
    draft,
    keepDraft: true,
  });
  assert.equal(calls, 1);
  assert.equal(out, draft);
});
