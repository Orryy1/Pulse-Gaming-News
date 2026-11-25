// LONG_OPENING_CONTRACT and LONG_ARGUES both off: the documentary and ranking writers ask the model exactly what they
// asked before either setting existed. Each writer is called twice with the same fake model, once the way the live
// pipeline called it before (no new options at all) and once the way it calls it now with both settings "off", and
// every call (site, system prompt, content, schema and effort) must match; then the ranking step itself runs with
// both off and must call nothing new and record nothing new.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  outlineDoc,
  validateBookends,
  writeBookends,
  writeChapter,
  type DocBookends,
  type DocOutline,
} from "../src/editorial/documentary.ts";
import {
  longRulesFor,
  type LongRuleSettings,
} from "../src/editorial/longrules.ts";
import {
  validateLongform,
  writeLongform,
  type LongformScript,
} from "../src/editorial/longform.ts";
import { contractRules } from "../src/longcontractstep.ts";
import {
  FINISH_LINE_RULE,
  TAKES_PER_CHAPTER,
  contractChapterRule,
  contractOpeningRule,
  OPENING_WORDS_MAX,
} from "../src/editorial/longcontract.ts";
import {
  ARGUES_PLAN_RULE,
  CLAIMS_CHAPTER_SHAPE,
  CLAIMS_OPENING_RULE,
  CLAIMS_OUTLINE_RULE,
  arguesEntryRule,
} from "../src/editorial/argues.ts";
import { advance, type Services } from "../src/pipeline.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { getEpisode } from "../src/episodes.ts";
import { testConfig, testDb, tmpDir } from "./helpers.ts";

/** Every long rule switched on, so "off" is proved against the busiest prompt the live settings can build. */
const ON: LongRuleSettings = {
  longYouPer1000: 25,
  guideYouPer1000: 35,
  longSentenceGate: 14,
  longHookStack: 5,
  longOpenLoopsMax: 4,
  loopNamePayoff: true,
  longVerdictStamps: true,
  longGuideFormat: true,
  guideChapterAction: true,
  longChapterCadence: true,
};
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
const OFF = { contract: "off", argues: "off" } as const;

/** Text only the two settings put in a prompt: none of it may appear with both off. */
const NEW_TEXT = [
  FINISH_LINE_RULE,
  CLAIMS_OUTLINE_RULE,
  CLAIMS_CHAPTER_SHAPE,
  CLAIMS_OPENING_RULE,
  ARGUES_PLAN_RULE,
  contractChapterRule(TAKES_PER_CHAPTER),
  contractOpeningRule({ title: "T", buyer: false }).slice(0, 60),
  arguesEntryRule([100, 200]).slice(0, 60),
  "This is claim number",
  `at most ${OPENING_WORDS_MAX} spoken words (this overrides`,
  "finish_line",
];

interface Call {
  site: unknown;
  system: unknown;
  content: unknown;
  schema: unknown;
  effort: unknown;
}

const para = (narration: string) => ({
  narration,
  callout: { kind: "none", primary: "", secondary: "" },
  footage: { want: "gameplay", keywords: [], moment: "" },
});
const plans = [1, 2, 3].map((n) => ({
  chapter_title: `Chapter ${n}`,
  game_title: `Game ${n}`,
  wiki_title: `Game ${n}`,
  steam_search_term: "",
  year: 2000 + n,
  platforms: "PC",
  focus: "f",
  photo_searches: [],
}));
const outline = {
  question: "Why did it work?",
  title: "Why It Worked",
  description: "d",
  chapters: plans,
  open_loops: [
    { question: "Who paid for it?", plant_chapter: 0, payoff_chapter: 3 },
  ],
  youtube: { title: "Why It Worked", description: "d", tags: [] },
} as unknown as DocOutline;
const bookends = {
  intro: {
    narration: "In 2001 a studio in Edinburgh bet everything on one game.",
    on_screen: "x",
  },
  outro: {
    narration: "It worked. It still works today, in 2026.",
    on_screen: "y",
    label: "z",
  },
} as unknown as DocBookends;
const entryBody = (narration: string) => ({
  year: 2010,
  narration,
  footage: { want: "gameplay", keywords: ["x"] },
  claims: [],
});
const rankingPlan = {
  theme: "T",
  title: "T",
  criterion: "c",
  intro: {
    narration: "You'll argue with this order. You will.",
    on_screen: "x",
  },
  outro: { narration: "o", on_screen: "o" },
  youtube: { title: "t", description: "d", tags: [], thumb_text: "Best ever" },
  entries: [1, 2, 3].map((rank) => ({
    rank,
    game_title: `G${rank}`,
    steam_search_term: "",
    year: 2010,
    platforms: "PC",
    verdict_chip: "ok",
    angle: "a",
  })),
};

/** A fake model that answers every writer site and keeps each call whole. */
function recorder(): { llm: Llm; calls: Call[] } {
  const calls: Call[] = [];
  const llm = {
    async structured(o: Record<string, unknown>) {
      calls.push({
        site: o.site,
        system: o.system,
        content: o.content,
        schema: o.schema,
        effort: o.effort,
      });
      const content = String(o.content ?? "");
      if (content.includes("YOUR DRAFT")) return { edits: [] };
      switch (o.site) {
        case "doc.outline":
          return outline;
        case "doc.chapter":
          return {
            claims: [],
            paragraphs: [
              para("In 2001 they shipped it."),
              para("It sold."),
              para("It changed things."),
            ],
          };
        case "doc.bookends":
          return bookends;
        case "longform.plan":
          return rankingPlan;
        case "longform.write":
          return entryBody(
            "Number three is G3, from 2010. It holds up. It sits here for the story.",
          );
        case "longform.shots":
          return { moments: [] };
        default:
          return {};
      }
    },
  } as unknown as Llm;
  return { llm, calls };
}

const docTopic = (format?: string) =>
  ({
    kind: "story",
    franchise: "GTA",
    title_idea: "T",
    angle: "a",
    ...(format ? { format } : {}),
  }) as never;

/** The documentary writers as the step drives them, given the rules it would pass. */
async function documentaryCalls(
  rules: ReturnType<typeof longRulesFor>,
  extra: { quotes?: [] } = {},
): Promise<Call[]> {
  const { llm, calls } = recorder();
  await outlineDoc(llm, docTopic(), "notes", { openLoops: true, rules });
  await outlineDoc(llm, docTopic(), "notes", { openLoops: false, rules });
  const source = {
    title: "Game 1",
    url: "https://en.wikipedia.org/wiki/Game_1",
    text: "[Development] It shipped in 2001.",
  };
  const first = await writeChapter(llm, {
    franchise: "GTA",
    plan: plans[0]!,
    index: 0,
    outline,
    source,
    loops: outline.open_loops as never,
    rules,
  } as never);
  await writeChapter(llm, {
    franchise: "GTA",
    plan: plans[1]!,
    index: 1,
    outline,
    source,
    previousEnding: "It changed things.",
    feedback: ["A sentence ran long."],
    draft: first,
    rules,
  } as never);
  await writeBookends(
    llm,
    outline,
    [{ plan: plans[0]!, chapter: first }] as never,
    "notes",
    { loops: outline.open_loops as never, echo: true, rules, ...extra },
  );
  return calls;
}

test("both off: the documentary writers ask exactly what they asked before, for every format and rule set", async () => {
  for (const settings of [NONE, ON])
    for (const format of [undefined, "guide", "claims", "retro", "everygame"]) {
      const before = {
        ...longRulesFor(settings, "documentary", format === "guide"),
        ...(format === "retro" ? { retro: true } : {}),
      };
      const now = contractRules(before, { ...OFF, format });
      assert.deepEqual(
        now,
        before,
        `contractRules off adds nothing (${format ?? "story"})`,
      );
      const a = await documentaryCalls(before);
      const b = await documentaryCalls(now);
      assert.equal(a.length, b.length);
      assert.deepEqual(b, a, `the same calls (${format ?? "story"})`);
      for (const c of b)
        for (const t of NEW_TEXT)
          assert.ok(
            !String(c.system).includes(t) && !String(c.content).includes(t),
            `no new text: ${t.slice(0, 40)}`,
          );
    }
});

test("both off: validateBookends finds the same problems whether or not the contract's opts are passed", () => {
  const rules = longRulesFor(NONE, "documentary");
  const base = { rules, chapters: ["In 2001 they shipped it."], echo: true };
  for (const b of [
    bookends,
    {
      ...bookends,
      intro: { narration: "Short.", on_screen: "x" },
    } as DocBookends,
  ]) {
    const before = validateBookends(b, base);
    // The step passes the contract's opts only when the contract is on; even passed, rules without it ignore them.
    assert.deepEqual(
      validateBookends(b, {
        ...base,
        contract: { title: "Why It Worked", quotes: [], sources: [] },
      }),
      before,
    );
  }
});

/** The ranking writer as the step drives it. */
async function rankingCalls(
  opts: Record<string, unknown>,
): Promise<{ calls: Call[]; draft: LongformScript }> {
  const { llm, calls } = recorder();
  const draft = await writeLongform(
    llm,
    { theme: "T", title_idea: "T", criterion: "c", format: "ranking" } as never,
    [],
    ["An earlier draft ran long."],
    "lessons",
    opts,
  );
  return { calls, draft };
}

test("both off: the ranking writer asks exactly what it asked before, and validateLongform says the same", async () => {
  for (const settings of [NONE, ON]) {
    const rules = longRulesFor(settings, "ranking");
    const stage = { punchyHook: true, soundBeats: true, rules };
    const a = await rankingCalls(stage);
    const b = await rankingCalls({ ...stage, argues: "off", contract: "off" });
    assert.deepEqual(b.calls, a.calls);
    assert.deepEqual(b.draft, a.draft);
    for (const c of b.calls)
      for (const t of NEW_TEXT)
        assert.ok(
          !String(c.system).includes(t) && !String(c.content).includes(t),
          `no new text: ${t.slice(0, 40)}`,
        );
    assert.deepEqual(
      validateLongform(b.draft, rules, { argues: false, openingCap: false }),
      validateLongform(a.draft, rules),
    );
  }
});

test("both off: the ranking step calls nothing new and records nothing new", async () => {
  const db = await testDb();
  const data = await tmpDir();
  const cfg = testConfig(data, {
    longformEnabled: true,
    longOpeningContract: "off",
    longArgues: "off",
  });
  const { llm, calls } = recorder();
  const s = {
    db,
    cfg,
    llm: {
      structured: async (o: Record<string, unknown>) =>
        o.site === "factcheck.ranking"
          ? { verdict: "pass", issues: [], summary: "ok" }
          : llm.structured(o as never),
    },
    now: () => new Date("2026-11-21T02:00:00Z"),
    notify: async () => true,
    findGame: async () => undefined,
    gameFacts: async () => undefined,
    research: async () => undefined,
  } as unknown as Services;
  const topic = {
    theme: "T",
    title_idea: "T",
    criterion: "c",
    format: "ranking",
  };
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json)
     VALUES ('ep_rank', 'longform:x', 'selected', $1, 'longform', $2)`,
    [
      JSON.stringify({
        headline: "T",
        items: [],
        sources: [],
        hash: "longform:x",
        gameHint: "T",
      }),
      JSON.stringify({ topic }),
    ],
  );
  try {
    await advance(s, (await getEpisode(db, "ep_rank"))!);
    const ep = (await getEpisode(db, "ep_rank"))!;
    assert.equal(ep.status, "scripted", ep.last_error ?? "");
    assert.ok(
      !calls.some((c) => /^long\./.test(String(c.site))),
      "no judge or other new site",
    );
    for (const c of calls)
      for (const t of NEW_TEXT)
        assert.ok(
          !String(c.system).includes(t) && !String(c.content).includes(t),
          `no new text: ${t.slice(0, 40)}`,
        );
    assert.doesNotMatch(
      JSON.stringify(ep.factcheck_json),
      /long_contract|long_argues/,
    );
    const events = await db.query<{ kind: string }>(
      `SELECT kind FROM events WHERE episode_id = 'ep_rank'`,
    );
    assert.ok(
      !events.some((e) => /^long_(contract|argues)/.test(e.kind)),
      "no long_contract or long_argues events",
    );
  } finally {
    await db.close();
  }
});
