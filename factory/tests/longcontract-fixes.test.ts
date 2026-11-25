// LONG_OPENING_CONTRACT and LONG_ARGUES on: the seven faults a review of the stage merge found (25 Nov 2026), one test
// each. Off, every one of these paths is the stage code (tests/longoff.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_I_RARE,
  chapterPrompt,
  writeBookends,
  type DocChapter,
  type DocOutline,
} from "../src/editorial/documentary.ts";
import { friendChapter } from "../src/editorial/friendpass.ts";
import {
  NO_LONG_RULES,
  longRulesFor,
  type LongRuleSettings,
} from "../src/editorial/longrules.ts";
import {
  contractOpeningRule,
  contractReport,
  takesGuard,
  takesVoiceLine,
  withoutSpoilerWarning,
  type LongDoc,
} from "../src/editorial/longcontract.ts";
import { rankingRules, writeLongform } from "../src/editorial/longform.ts";
import { contractRules, recordLongChecks } from "../src/longcontractstep.ts";
import { docRunDue, type RunEntry } from "../src/shortrun.ts";
import {
  retroSpoilerLine,
  withRetroWarning,
} from "../src/editorial/retrospective.ts";
import { withSpoilerWarning, advance, type Services } from "../src/pipeline.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { getEpisode } from "../src/episodes.ts";
import { localTime } from "../src/lanes.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

const NONE: LongRuleSettings = {
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
const docFix = () =>
  contractRules(longRulesFor(NONE, "documentary"), {
    contract: "fix",
    argues: "off",
  });
const words = (n: number, w = "word") =>
  Array.from({ length: n }, () => w).join(" ");
const para = (narration: string) => ({
  narration,
  callout: { kind: "none", primary: "", secondary: "" },
  footage: { want: "gameplay", keywords: [], moment: "" },
});

// ---------------------------------------------------------------- 1. takes survive the later passes

test("1. takes: the chapter prompt and the friend pass ask for the takes, not one 'I'; off they are stage's", async () => {
  const fix = docFix();
  assert.equal(fix.takesMin, 2);
  const on = chapterPrompt(fix);
  const off = chapterPrompt(NO_LONG_RULES);
  // The voice's single "I" is in every documentary prompt, so the swap has something to replace.
  assert.ok(
    off.includes(VOICE_I_RARE),
    "the voice line the contract swaps is still the voice's own wording",
  );
  assert.ok(off.includes(`as "I" once in the chapter`));
  assert.ok(!on.includes(VOICE_I_RARE) && !on.includes("about once a chapter"));
  assert.ok(!on.includes(`as "I" once in the chapter`));
  assert.equal(
    on.split(takesVoiceLine(2)).length - 1,
    2,
    "both places name the takes",
  );
  assert.ok(on.includes("At least 2 honest first-person takes"));

  const seen: string[] = [];
  const llm = {
    structured: async (o: { content: string }) => {
      seen.push(o.content);
      return { edits: [{ find: "It sold.", replace: "It sold well." }] };
    },
  } as unknown as Llm;
  const chapter = {
    claims: [],
    paragraphs: [
      para("I think it was brave."),
      para("It sold."),
      para("I'd call it the turn."),
    ],
  } as unknown as DocChapter;
  await friendChapter(llm, chapter, {});
  await friendChapter(llm, chapter, { takesMin: 2 });
  assert.ok(
    seen[0]!.includes(`steps forward as "I" once`) &&
      seen[0]!.includes("take some out"),
  );
  assert.ok(
    !seen[1]!.includes(`steps forward as "I" once`) &&
      !seen[1]!.includes("take some out"),
  );
  assert.ok(seen[1]!.includes("keeps its first-person takes, at least 2"));
});

test("1. takes: a later pass may reword a take but never leave the chapter with fewer than it had and needs", () => {
  const two = "I think it was brave. It sold. I'd call it the turn.";
  assert.deepEqual(
    takesGuard(
      two,
      "I think it was brave. It sold. I would call it the turn of the decade.",
    ),
    [],
  );
  assert.equal(
    takesGuard(two, "It was brave. It sold. It was the turn.").length,
    1,
    "2 to 0",
  );
  assert.equal(
    takesGuard("I think it was brave. It sold.", "It was brave. It sold.")
      .length,
    1,
    "already short, 1 to 0",
  );
  assert.deepEqual(
    takesGuard(`${two} I'd do it again.`, two),
    [],
    "3 to 2 still meets the floor",
  );
  assert.deepEqual(
    takesGuard("It sold.", "It sold well."),
    [],
    "nothing to lose",
  );
});

/** A chapter with two takes that validateChapter passes clean. */
const CLEAN_CHAPTER = [
  `In 2001 a small team in Dundee began work on a game that nobody outside the studio had heard of. They had 4 programmers, a borrowed office and a publisher that wanted the whole thing finished inside two years. The first prototype ran on a single test level, a grey street with three parked cars and one traffic light that never changed. The lead designer kept a notebook of every idea that was cut, and it filled up fast.`,
  `I think that was the bravest call of the decade in Dundee, because almost nobody else would risk a whole studio on one open map. The budget doubled twice before the first trailer, and the publisher asked for monthly reports that ran to forty pages. Every report ended with the same promise about the next milestone. So what kept them going?`,
  `The game reached shops in the autumn and sold 5 million copies in its first month. Reviews praised the city more than the story, and the team in Dundee spent the winter fixing bugs that players found within hours. The patch notes from that season read like a diary of tired people, and the forums kept a running list of every glitch they had not yet fixed.`,
  `By the second spring the studio had moved twice, first to a converted warehouse by the canal and then to a glass tower near the station. The art team grew from six people to forty, and the sound designers recorded real buses at dawn so the streets would feel busy. Testers played the same mission hundreds of times, filling spreadsheets with crashes, stuck cars and pedestrians who walked straight into walls. Would any of it be ready in time?`,
  `Money stayed tight the whole way through. The founders sold their own cars to cover one payroll, and a bank loan arrived only after the publisher signed a letter promising a second payment. Staff remember pizza for dinner most nights and a whiteboard in the kitchen counting down the days to the deadline, rubbed out and redrawn every time it slipped. One producer later said the countdown was the only thing in the building that ever moved on time.`,
  `I'd call that the moment the series in Dundee stopped being a cult hit and became a business. The next project already had a bigger office, a bigger team and a publisher that now asked for weekly reports. Nobody on the team guessed how hard the next five years would turn out to be.`,
];

test("1. takes: in the documentary step a friend pass that strips the takes is refused and the takes stay", async () => {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), {
    longformEnabled: true,
    docEnabled: true,
    docOpenLoops: false,
    longOpeningContract: "fix",
    longArgues: "off",
    friendPass: ["documentary"],
    docSandboxChapters: 1,
  });
  const plans = [1, 2, 3, 4, 5, 6].map((n) => ({
    chapter_title: `Chapter ${n}`,
    game_title: "Grand Theft Auto V",
    wiki_title: "Grand Theft Auto V",
    steam_search_term: "",
    year: 2013,
    platforms: [],
    focus: "x",
    photo_searches: [],
  }));
  const llm = {
    async structured({ site }: { site: string }) {
      if (site === "doc.outline")
        return {
          question: "Why did it work?",
          title: "Why It Worked",
          description: "d",
          chapters: plans,
          open_loops: [],
        };
      // One chapter that passes every chapter rule, so the friend pass runs on it (the pass needs a clean chapter).
      if (site === "doc.chapter") return { claims: [], paragraphs: CLEAN_CHAPTER.map(para) };
      if (site === "doc.check") return { unsupported: [] };
      if (site === "doc.shots") return { moments: [] };
      if (site === "friend.doc")
        return {
          edits: [
            {
              find: "I think that was the bravest call",
              replace: "That was the bravest call",
            },
            {
              find: "I'd call that the moment",
              replace: "That was the moment",
            },
          ],
        };
      if (site === "long.judge") throw new Error("judge down");
      if (site === "doc.bookends")
        return {
          intro: { narration: `Why did it work? ${words(50)}`, on_screen: "x" },
          outro: {
            narration: "It worked. It still works today, in 2026.",
            on_screen: "y",
            label: "z",
          },
        };
      return {};
    },
  } as unknown as Llm;
  const s = {
    db,
    cfg,
    llm,
    now: () => new Date("2026-11-21T02:00:00Z"),
    notify: async () => true,
    research: async () => ({
      title: "GTA V",
      url: "https://en.wikipedia.org/wiki/GTA_V",
      text: "[Development] It shipped in 2013.",
    }),
  } as unknown as Services;
  const topic = {
    kind: "story",
    franchise_index: -1,
    story_index: -1,
    title_idea: "Why It Worked",
    angle: "a",
    reason: "r",
    franchise: "Grand Theft Auto V",
    wiki: "Grand Theft Auto V",
  };
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json)
     VALUES ('ep_takes', 'documentary:t', 'selected', $1, 'longform', $2)`,
    [
      JSON.stringify({
        headline: "Why It Worked",
        items: [],
        sources: [],
        hash: "documentary:t",
        gameHint: "GTA V",
      }),
      JSON.stringify({ doc: true, topic }),
    ],
  );
  try {
    await advance(s, (await getEpisode(db, "ep_takes"))!);
    const ep = (await getEpisode(db, "ep_takes"))!;
    assert.equal(ep.status, "scripted", ep.last_error ?? "");
    const said = JSON.stringify(ep.script_json);
    assert.match(said, /I think that was the bravest call/);
    const passes = await db.query<{ detail: { kept: boolean; why: string[] } }>(
      `SELECT detail FROM events WHERE episode_id = 'ep_takes' AND kind = 'doc_friend_pass'`,
    );
    assert.ok(passes.length > 0);
    for (const p of passes) {
      assert.equal(p.detail.kept, false);
      assert.ok(
        p.detail.why.some((w) => /takes from 2 to 0/.test(w)),
        JSON.stringify(p.detail.why),
      );
    }
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------- 2. one title for writing and grading

test("2. the opening is written for the title it is graded against, buyer framing included", async () => {
  const systems: string[] = [];
  const llm = {
    structured: async (o: { system: string }) => {
      systems.push(o.system);
      return {
        intro: { narration: "x", on_screen: "x" },
        outro: { narration: "y", on_screen: "y", label: "z" },
      };
    },
  } as unknown as Llm;
  const outline = {
    title: "Outline Title",
    question: "Q?",
    chapters: [],
    youtube: { title: "Packaging Title", description: "d", tags: [] },
  } as unknown as DocOutline;
  await writeBookends(llm, outline, [], "notes", {
    rules: docFix(),
    contract: { title: "Why San Andreas Never Got a Sequel" },
  });
  assert.ok(systems[0]!.includes(`("Why San Andreas Never Got a Sequel")`));
  assert.ok(!systems[0]!.includes("Packaging Title"));
  assert.ok(systems[0]!.includes("No purchase, price or buyer framing"));
  await writeBookends(llm, outline, [], "notes", {
    rules: docFix(),
    contract: { title: "Should You Buy GTA 6 at Launch?" },
  });
  assert.ok(
    !systems[1]!.includes("No purchase, price or buyer framing"),
    "a buyer's title may talk money",
  );
  // No title given: the outline's packaging, as before.
  await writeBookends(llm, outline, [], "notes", { rules: docFix() });
  assert.ok(systems[2]!.includes(`("Packaging Title")`));
});

// ---------------------------------------------------------------- 3. the factory's spoiler warning is not the writer's

test("3. the record grades the opening without the spoiler warning the factory adds after it", async () => {
  const hook = `Why did San Andreas never get a sequel? ${words(80)}.`;
  assert.equal(
    withoutSpoilerWarning(withRetroWarning(hook, "San Andreas")),
    hook,
  );
  assert.ok(
    withRetroWarning(hook, "San Andreas").startsWith(
      retroSpoilerLine("San Andreas"),
    ),
  );
  const ranked = withSpoilerWarning({
    hook,
    criterion: "best campaigns",
    headline: "h",
    beats: [],
  } as never).hook;
  assert.notEqual(ranked, hook);
  assert.equal(withoutSpoilerWarning(ranked), hook);
  assert.equal(
    withoutSpoilerWarning(`${hook} And expect story spoilers.`),
    hook,
  );
  assert.equal(
    withoutSpoilerWarning("Spoilers aside, the map is huge."),
    "Spoilers aside, the map is huge.",
    "the writer's own line stays",
  );

  const db = { query: async () => [] } as never;
  const llm = {
    structured: async () => {
      throw new Error("judge down");
    },
  } as unknown as Llm;
  const cfg = {
    longOpeningContract: "check" as const,
    longArgues: "off" as const,
  };
  const rankingScript = (h: string) =>
    ({
      hook: h,
      headline: "h",
      youtube: {
        title: "The Best Campaigns, Ranked",
        description: "d",
        tags: [],
      },
      beats: [1, 2, 3].map((r) => ({
        narration: `Entry ${r}. ${words(40)}.`,
        visual: { kind: "rank", primary: `G${r}`, value_a: r },
      })),
      pulse_take: { narration: "That's the list." },
    }) as never;
  const capped = (r: { long_contract?: Record<string, unknown> }) =>
    ((r.long_contract?.problems as string[]) ?? []).filter(
      (p) => /words/.test(p) && /opening|intro/i.test(p),
    );
  const plain = await recordLongChecks(
    { db, llm, cfg },
    "ep",
    rankingScript(hook),
    { kind: "ranking" },
  );
  const warned = await recordLongChecks(
    { db, llm, cfg },
    "ep",
    rankingScript(ranked),
    { kind: "ranking" },
  );
  assert.deepEqual(capped(plain), [], "88 words: inside the cap");
  assert.deepEqual(
    capped(warned),
    [],
    "the warning the factory added is not counted",
  );
  assert.equal(
    (warned.long_contract!.measures as { hookWords: number }).hookWords,
    (plain.long_contract!.measures as { hookWords: number }).hookWords,
  );
});

// ---------------------------------------------------------------- 4. a ranking's cap replaces its stacked hook

test("4. a ranking under the 90-word cap gets no stacked hook; off it keeps it", async () => {
  const stacked = longRulesFor({ ...NONE, longHookStack: 5 }, "ranking");
  assert.equal(stacked.hookStack, 5);
  assert.equal(
    rankingRules(stacked, { contract: "fix", argues: "off" }).hookStack,
    0,
  );
  assert.equal(
    rankingRules(stacked, { contract: "off", argues: "fix" }).hookStack,
    0,
  );
  assert.equal(
    rankingRules(stacked, { contract: "check", argues: "check" }),
    stacked,
    "check changes nothing",
  );
  assert.equal(
    rankingRules(stacked, { contract: "off", argues: "off" }),
    stacked,
  );

  const systems: string[] = [];
  const llm = {
    structured: async (o: { site: string; system: string }) => {
      if (o.site === "longform.plan") systems.push(o.system);
      if (o.site === "longform.plan")
        return {
          theme: "T",
          title: "T",
          criterion: "c",
          intro: { narration: "You'll argue with this order.", on_screen: "x" },
          outro: { narration: "o", on_screen: "o" },
          youtube: { title: "t", description: "d", tags: [] },
          entries: [
            {
              rank: 1,
              game_title: "G1",
              steam_search_term: "",
              year: 2010,
              platforms: "PC",
              verdict_chip: "ok",
              angle: "a",
            },
          ],
        };
      if (o.site === "longform.write")
        return {
          year: 2010,
          narration: "Number one is G1.",
          footage: { want: "gameplay", keywords: ["x"] },
          claims: [],
        };
      return { edits: [], moments: [] };
    },
  } as unknown as Llm;
  const topic = {
    theme: "T",
    title_idea: "T",
    criterion: "c",
    format: "ranking",
  } as never;
  await writeLongform(llm, topic, [], [], "", {
    rules: stacked,
    contract: "fix",
  });
  await writeLongform(llm, topic, [], [], "", { rules: stacked });
  assert.ok(!systems[0]!.includes("stacked hook"), "capped: no stacked hook");
  assert.ok(systems[0]!.includes("at most 90 spoken words"));
  assert.ok(
    systems[1]!.includes("stacked hook"),
    "off: the stacked hook as before",
  );
});

// ---------------------------------------------------------------- 5. no finish line asked of an outline that can't carry one

test("5. an outline that can't carry a finish line is neither asked to plant one nor faulted for having none", async () => {
  assert.ok(
    contractOpeningRule({ title: "T", buyer: false }).includes(
      "Plant the finish line",
    ),
  );
  assert.ok(
    !contractOpeningRule({
      title: "T",
      buyer: false,
      finishLine: false,
    }).includes("Plant the finish line"),
  );
  const d: LongDoc = {
    title: "Why It Worked",
    kind: "documentary",
    hook: "Why did it work? It shipped in 2013.",
    chapters: [{ title: "One", text: "It shipped." }],
    outro: "It worked.",
  };
  assert.ok(contractReport(d).problems.some((p) => /No finish line/.test(p)));
  assert.ok(
    !contractReport(d, { finishLine: false }).problems.some((p) =>
      /finish line/i.test(p),
    ),
  );
  const systems: string[] = [];
  const llm = {
    structured: async (o: { system: string }) => {
      systems.push(o.system);
      return {
        intro: { narration: "x", on_screen: "x" },
        outro: { narration: "y", on_screen: "y", label: "z" },
      };
    },
  } as unknown as Llm;
  const outline = {
    title: "T",
    question: "Q?",
    chapters: [],
  } as unknown as DocOutline;
  await writeBookends(llm, outline, [], "notes", {
    rules: docFix(),
    contract: { title: "T", finishLine: false },
  });
  await writeBookends(llm, outline, [], "notes", {
    rules: docFix(),
    contract: { title: "T" },
  });
  assert.ok(!systems[0]!.includes("Plant the finish line"));
  assert.ok(systems[1]!.includes("Plant the finish line"));
});

// ---------------------------------------------------------------- 6. check never changes the writing

test("6. LONG_ARGUES=check writes a claims entry as before; only fix makes it a claims commentary", () => {
  const base = longRulesFor(NONE, "documentary");
  assert.deepEqual(
    contractRules(base, { contract: "off", argues: "check", format: "claims" }),
    base,
  );
  assert.equal(
    contractRules(base, { contract: "off", argues: "fix", format: "claims" })
      .claims,
    true,
  );
  assert.deepEqual(
    contractRules(base, {
      contract: "check",
      argues: "check",
      format: "claims",
    }),
    base,
  );
});

// ---------------------------------------------------------------- 7. off runs a claims entry as stage did

test("7. a run entry of format claims with a brief: off runs the plain documentary with no brief; check and fix keep both", () => {
  const tz = "Europe/London";
  const entry = {
    kind: "doc",
    date: "2026-11-13",
    slot: "20:00",
    make_hours_before: 44,
    title: "Is the Map Really Twice the Size?",
    franchise: "Grand Theft Auto VI",
    wiki: "Grand Theft Auto VI",
    angle: "c",
    format: "claims",
    brief: { thesis: "t", exclusive: "e", finish_line: "f" },
  } as RunEntry;
  const inside = new Date(
    localTime("2026-11-13", "20:00", tz).getTime() - 43 * 3600_000,
  );
  const off = docRunDue([entry], inside, [], tz)!.topic;
  assert.equal(off.format, undefined);
  assert.equal(off.brief, undefined);
  assert.deepEqual(docRunDue([entry], inside, [], tz, "off")!.topic, off);
  for (const mode of ["check", "fix"] as const) {
    const t = docRunDue([entry], inside, [], tz, mode)!.topic;
    assert.equal(t.format, "claims");
    assert.deepEqual(t.brief, { thesis: "t", exclusive: "e", finish_line: "f" });
  }
  // A guide entry is untouched whatever the setting.
  assert.equal(
    docRunDue(
      [{ ...entry, format: "guide", brief: undefined } as RunEntry],
      inside,
      [],
      tz,
    )!.topic.format,
    "guide",
  );
});
