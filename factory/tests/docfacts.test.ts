// DOC_FACT_DISCIPLINE (src/docfacts.ts): built from the 18 lines the fact check still disputed in "The Fall and Return
// of Cyberpunk 2077" (ep_20261125_87abc5a2, 25 Nov 2026), which the documentary step kept and sent to the voice with
// "they stay in". Quotes and problems are the checker's own words. No network, no paid call, a fixed clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  disciplineChapter,
  docFactLine,
  repairDocChapter,
  type DocFactItem,
} from "../src/docfacts.ts";
import type { DocChapter } from "../src/editorial/documentary.ts";
import { advance, type Services } from "../src/pipeline.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { getEpisode } from "../src/episodes.ts";
import { testDb, testConfig, tmpDir } from "./helpers.ts";
import { stepScriptExplained } from "../src/explainedstep.ts";
import { EXPLAINED_PARTS } from "../src/editorial/explained.ts";
import { rewriteRetry } from "../src/adminretry.ts";

/** The 18 disputed lines, each with the sentence it sat in (the checker quotes a fragment for some). */
const CYBERPUNK: Array<{ sentence: string; item: DocFactItem }> = [
  {
    sentence:
      "If you remember The Matrix Online, you'll know it didn't last long.",
    item: {
      quote:
        "If you remember The Matrix Online, you'll know it didn't last long.",
      problem:
        "Eurogamer says it “came out and sunk,” but the source does not establish how long the game operated or when it shut down.",
    },
  },
  {
    sentence:
      "That's why the game you play is set decades past the tabletop's 2020.",
    item: {
      quote:
        "That's why the game you play is set decades past the tabletop's 2020.",
      problem:
        "The source describes the licensing timeline but does not establish that this rights arrangement caused the choice of the game's later setting.",
    },
  },
  {
    sentence: "If you were waiting, you got years of near silence.",
    item: {
      quote: "If you were waiting, you got years of near silence.",
      problem:
        "The source lists trailers in 2013 and 2018 but does not establish that announcements or updates were nearly absent between them.",
    },
  },
  {
    sentence:
      "The second trailer finally arrived after five years of near silence.",
    item: {
      quote: "after five years of near silence",
      problem:
        "The source establishes a gap between the January 2013 and E3 2018 trailers, but not five years of near silence.",
    },
  },
  {
    sentence:
      'The show also settled the question Jaki had only answered with "most probably" back in 2013.',
    item: {
      quote:
        'The show also settled the question Jaki had only answered with "most probably" back in 2013.',
      problem:
        'The source does not identify Jaki or provide this quotation. The cited 2013 GameSpot headline says "probably", not "most probably".',
    },
  },
  {
    sentence:
      "Cyberpunk 2077 left Los Angeles as the most decorated game at E3.",
    item: {
      quote: "the most decorated game at E3",
      problem:
        "Over one hundred awards is supported; having more awards than every other game is not.",
    },
  },
  {
    sentence:
      "Every big outlet you might have checked was saying the same thing about a game you still couldn't buy.",
    item: {
      quote:
        "Every big outlet you might have checked was saying the same thing about a game you still couldn't buy.",
      problem:
        "The source establishes praise from several named outlets, not agreement across every major outlet.",
    },
  },
  {
    sentence: "The second trailer did most of the work.",
    item: {
      quote: "The second trailer did most of the work.",
      problem:
        "The source supports the trailer's positive reception, but does not establish it as the main cause of the game's acclaim or awards.",
    },
  },
  {
    sentence:
      "The Witcher 3 had kept you behind Geralt's shoulder for an entire adventure.",
    item: {
      quote:
        "The Witcher 3 had kept you behind Geralt's shoulder for an entire adventure.",
      problem:
        "The source establishes The Witcher 3's third-person perspective, but does not identify Geralt or establish that the entire adventure follows him.",
    },
  },
  {
    sentence:
      "The PS4 was already seven years old, and the Xbox One was the same age.",
    item: {
      quote: "and the Xbox One was the same age.",
      problem:
        "The source gives the PS4's launch date but no Xbox One launch date or age comparison.",
    },
  },
  {
    sentence:
      "That same year, John Wick: Chapter 3 grossed $171 million in the US alone.",
    item: {
      quote:
        "That same year, John Wick: Chapter 3 grossed $171 million in the US alone.",
      problem:
        "“That same year” refers back to 2018. The source places John Wick: Chapter 3 and its $171 million US gross in 2019.",
    },
  },
  {
    sentence:
      "That spring he'd also gone viral twice, once for riding along with stranded plane passengers, once for a quiet answer about death on Stephen Colbert's show.",
    item: {
      quote:
        "That spring he'd also gone viral twice, once for riding along with stranded plane passengers, once for a quiet answer about death on Stephen Colbert's show.",
      problem:
        "This continues the 2018 time reference. The source dates the stranded-passenger incident to March 2019 and the Colbert appearance to May 2019.",
    },
  },
  {
    sentence:
      "For CD Projekt Red, it meant another version on top of PC, PS4 and Xbox One, from a team whose new engine, as we saw, was already testing older consoles.",
    item: {
      quote:
        "For CD Projekt Red, it meant another version on top of PC, PS4 and Xbox One, from a team whose new engine, as we saw, was already testing older consoles.",
      problem:
        "The source establishes REDengine 4's use and console performance problems at launch in December 2020. It does not establish that the engine was already straining older consoles in August 2019.",
    },
  },
  {
    sentence:
      "Pondsmith's second rulebook, from 1990, was called Cyberpunk 2020.",
    item: {
      quote:
        "Pondsmith's second rulebook, from 1990, was called Cyberpunk 2020",
      problem:
        "The source supports a 1990 Cyberpunk follow-up, not the claim that this was Pondsmith's second rulebook. It describes earlier works, including Mekton, and three separate books in the original 1988 Cyberpunk set.",
    },
  },
  {
    sentence:
      "By Christmas, the studio known for putting you first had been dropped from Sony's store.",
    item: {
      quote:
        "the studio known for putting you first had been dropped from Sony's store",
      problem:
        "The source says Sony removed Cyberpunk 2077 from the PlayStation Store. It does not say Sony dropped the studio or its other games.",
    },
  },
  {
    sentence: "The real fix was always meant to come on newer hardware.",
    item: {
      quote: "The real fix was always meant to come on newer hardware.",
      problem:
        "The source does not establish this longstanding intention. Iwiński’s plan included patches to improve older-console performance, followed by optimisation for newer consoles.",
    },
  },
  {
    sentence:
      "Then in October, USA Today reported the next-gen versions had slipped again.",
    item: {
      quote:
        "Then in October, USA Today reported the next-gen versions had slipped again.",
      problem:
        "The source supports the October 2021 postponement, but not “again” for the next-gen versions. The earlier documented delays concerned the original game release.",
    },
  },
  {
    sentence: "You can find the problem and the fix on the same spec sheet.",
    item: {
      quote: "You can find the problem and the fix on the same spec sheet.",
      problem:
        "The source describes PS5 hardware capabilities and Iwiński’s explanation of the streaming-engine problems, but does not establish that the hardware supplied the fix.",
    },
  },
];

const para = (
  narration: string,
  more: Partial<DocChapter["paragraphs"][number]> = {},
) => ({
  narration,
  callout: { kind: "none" as const, primary: "", secondary: "" },
  footage: { want: "none", keywords: [] } as never,
  ...more,
});

// Neutral lines around the disputed one, none of them leaning on what comes before it.
const OPEN =
  "Cyberpunk 2077 began on a tabletop in 1988. Mike Pondsmith wrote the first rules for a dark future city.";
const FILL_A =
  "Night City glowed on every screen at the studio in Warsaw. CD Projekt Red hired hundreds of new developers for the project. Fans counted the days between every new screenshot and every interview.";
const FILL_B =
  "Reviewers praised the city and its people at launch. Console owners found something very different on their screens. Refunds opened on both stores within a week of release.";
const FILL_C =
  "Patch 1.5 arrived in February 2022 with hundreds of fixes. Phantom Liberty followed in September 2023 with a new district to explore. Sales passed twenty five million copies by the end of that year.";

// A real chapter runs 500-900 words; this one is shorter, so the 20% cap is the tighter for it.
const FILL_D =
  "Keanu Reeves walked on stage at E3 in June 2019 to loud cheers from the crowd. The release date appeared on screen behind him a moment later. Preorders climbed on every store before the show had ended that afternoon.";

const docChapter = (middle: string): DocChapter => ({
  paragraphs: [para(OPEN), para(`${FILL_A} ${middle} ${FILL_B}`), para(FILL_C), para(FILL_D)],
  claims: [],
});

const spoken = (c: DocChapter) =>
  c.paragraphs.map((p) => p.narration).join(" ");
const fold = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

test("each of the 18 lines Cyberpunk 2077 kept is mended or cut, and none of its words survive", () => {
  for (const { sentence, item } of CYBERPUNK) {
    const r = repairDocChapter(docChapter(sentence), [item]);
    assert.deepEqual(
      r.unrepaired,
      [],
      `${item.quote}: ${r.unrepaired[0]?.why}`,
    );
    assert.equal(r.repairs.length, 1, item.quote);
    assert.ok(
      !fold(spoken(r.chapter)).includes(fold(item.quote)),
      `still said: ${item.quote}`,
    );
    // Only the disputed sentence or clause went: everything around it is still there word for word.
    for (const keep of [OPEN, FILL_A, FILL_B, FILL_C, FILL_D])
      assert.ok(spoken(r.chapter).includes(keep), keep);
    assert.ok(
      r.cut <= 0.2 * r.base,
      `${item.quote}: cut ${r.cut} of ${r.base}`,
    );
  }
});

test("a side clause the checker quotes goes alone: the PS4 line keeps its supported half", () => {
  const x = CYBERPUNK.find((c) =>
    /Xbox One was the same age/.test(c.sentence),
  )!;
  const r = repairDocChapter(docChapter(x.sentence), [x.item]);
  assert.equal(r.repairs[0]!.kind, "drop_clause");
  assert.match(spoken(r.chapter), /The PS4 was already seven years old\. /);
});

test("a disputed line that leans on an earlier disputed one: both go, the later one first", () => {
  const matrix = CYBERPUNK[0]!;
  const why = CYBERPUNK[1]!;
  const r = repairDocChapter(docChapter(`${matrix.sentence} ${why.sentence}`), [
    matrix.item,
    why.item,
  ]);
  assert.deepEqual(r.unrepaired, []);
  assert.deepEqual(
    r.repairs.map((x) => x.from),
    [why.sentence, matrix.sentence],
  );
  assert.doesNotMatch(spoken(r.chapter), /Matrix Online|That's why/);
});

test("a cut that would leave the next line leaning on nothing is refused, never made", () => {
  const matrix = CYBERPUNK[0]!;
  const r = repairDocChapter(
    docChapter(`${matrix.sentence} That one cost its studio dearly.`),
    [matrix.item],
  );
  assert.equal(r.unrepaired.length, 1);
  assert.match(r.unrepaired[0]!.why, /leans on it/);
  assert.match(spoken(r.chapter), /Matrix Online/, "nothing changed");
});

test("the chapter's opening line is never cut, a quote said twice is never guessed at, the cap holds", () => {
  const opener = repairDocChapter(
    {
      paragraphs: [para(`${CYBERPUNK[2]!.sentence} ${FILL_A}`), para(FILL_B)],
      claims: [],
    },
    [CYBERPUNK[2]!.item],
  );
  assert.match(opener.unrepaired[0]!.why, /opening sentence/);
  const twice = repairDocChapter(
    docChapter(`${CYBERPUNK[7]!.sentence} ${FILL_C} ${CYBERPUNK[7]!.sentence}`),
    [CYBERPUNK[7]!.item],
  );
  assert.match(twice.unrepaired[0]!.why, /once and once only/);
  const long = CYBERPUNK[12]!; // 30 words
  const capped = repairDocChapter(docChapter(long.sentence), [long.item], {
    maxCutShare: 0.05,
  });
  assert.match(capped.unrepaired[0]!.why, /5% cut cap/);
  const quoted = repairDocChapter(
    {
      paragraphs: [
        para(OPEN),
        para(`${FILL_A} ${CYBERPUNK[7]!.sentence}`, { quote: "q1" }),
        para(FILL_B),
      ],
      claims: [],
    },
    [CYBERPUNK[7]!.item],
  );
  assert.match(quoted.unrepaired[0]!.why, /character-quote/);
});

test("a rounded figure gets 'about', not a cut", () => {
  const r = repairDocChapter(
    docChapter("The Ultimate Edition now costs thirty dollars on Steam."),
    [
      {
        quote: "now costs thirty dollars on Steam.",
        problem:
          "The supplied Steam price is $29.99. The script states $30 without a rounding qualifier.",
      },
    ],
  );
  assert.equal(r.repairs[0]!.kind, "rounding");
  assert.match(spoken(r.chapter), /now costs about thirty dollars on Steam\./);
});

test("a paragraph emptied by the cuts goes; the chapter never drops under two paragraphs", () => {
  const lone = CYBERPUNK[7]!;
  const r = repairDocChapter(
    {
      paragraphs: [para(OPEN), para(lone.sentence), para(FILL_A), para(FILL_B)],
      claims: [],
    },
    [lone.item],
  );
  assert.deepEqual(r.unrepaired, []);
  assert.equal(r.chapter.paragraphs.length, 3);
  const two = repairDocChapter(
    { paragraphs: [para(OPEN), para(lone.sentence)], claims: [] },
    [lone.item],
    { maxCutShare: 0.4 },
  );
  assert.match(two.unrepaired[0]!.why, /fewer than two paragraphs/);
});

// ------------------------------------------------------------------ the gate with its one re-check

/** A fact checker that disputes whatever real Cyberpunk line is still in the narration. */
const checker =
  (calls: string[] = []) =>
  async (c: DocChapter) => {
    calls.push(spoken(c));
    return CYBERPUNK.filter((x) =>
      fold(spoken(c)).includes(fold(x.item.quote)),
    ).map((x) => x.item);
  };

test("the gate keeps a chapter only when the re-check after the cuts is clean", async () => {
  const calls: string[] = [];
  const ch = docChapter(`${CYBERPUNK[0]!.sentence} ${CYBERPUNK[1]!.sentence}`);
  const out = await disciplineChapter({
    chapter: ch,
    disputed: [CYBERPUNK[0]!.item, CYBERPUNK[1]!.item],
    check: checker(calls),
  });
  assert.ok(out.ok);
  assert.equal(calls.length, 1, "exactly one re-check");
  assert.doesNotMatch(spoken(out.chapter), /Matrix Online/);
  assert.match(
    docFactLine("Cyberpunk 2077: chapter 1", out.repairs),
    /^Cyberpunk 2077: chapter 1: fact check: 2 disputed lines settled \(2 cut\)/,
  );
});

test("a re-check that still disputes a line, or can't run, fails the chapter; nothing is waved through", async () => {
  const ch = docChapter(CYBERPUNK[7]!.sentence);
  const stubborn = await disciplineChapter({
    chapter: ch,
    disputed: [CYBERPUNK[7]!.item],
    check: async () => [CYBERPUNK[16]!.item],
  });
  assert.equal(stubborn.ok, false);
  assert.match(
    !stubborn.ok ? stubborn.why : "",
    /re-check after the cuts still disputes 1 line/,
  );
  const broken = await disciplineChapter({
    chapter: ch,
    disputed: [CYBERPUNK[7]!.item],
    check: async () => {
      throw new Error("model down");
    },
  });
  assert.equal(broken.ok, false);
  assert.match(!broken.ok ? broken.why : "", /could not run/);
  // The last check never ran: the gate checks it itself and never reads that as clean.
  const unchecked = await disciplineChapter({
    chapter: ch,
    disputed: undefined,
    check: async () => {
      throw new Error("model down");
    },
  });
  assert.equal(unchecked.ok, false);
  const clean = await disciplineChapter({
    chapter: docChapter("Night City waited."),
    disputed: undefined,
    check: checker(),
  });
  assert.ok(clean.ok && !clean.repairs.length);
});

// ------------------------------------------------------------------ the documentary step, on a fake model

async function writeDoc(
  chapterText: (n: number) => string,
  overrides: Partial<Services["cfg"]> = {},
) {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), {
    longformEnabled: true,
    docEnabled: true,
    docOpenLoops: false,
    friendPass: [],
    clarityGate: [],
    humanise: "off",
    ...overrides,
  } as Partial<Services["cfg"]>);
  const plans = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    chapter_title: `Chapter ${n}`,
    game_title: "Cyberpunk 2077",
    wiki_title: "Cyberpunk 2077",
    steam_search_term: "",
    year: 2020,
    platforms: "PC",
    focus: "x",
    photo_searches: [],
  }));
  const told: Array<{ ping?: boolean; content?: string }> = [];
  const checks: string[] = [];
  const llm = {
    async structured({ site, content }: { site: string; content: unknown }) {
      const text = String(content);
      if (site === "doc.outline")
        return {
          question: "Q?",
          title: "The Fall and Return of Cyberpunk 2077",
          description: "d",
          chapters: plans,
          open_loops: [],
          youtube: { title: "t", description: "d", tags: [] },
        };
      if (site === "doc.chapter") {
        const n = Number(/This chapter: Chapter (\d+)/.exec(text)?.[1] ?? 0);
        return {
          paragraphs: chapterText(n)
            .split("\n")
            .map((t) => para(t)),
          claims: [],
        };
      }
      if (site === "doc.check") {
        checks.push(text);
        const narration =
          text.split("NARRATION:\n")[1]?.split("\n\nSOURCE")[0] ?? text;
        return {
          unsupported: CYBERPUNK.filter((x) =>
            fold(narration).includes(fold(x.item.quote)),
          ).map((x) => x.item),
        };
      }
      if (site === "doc.shots") return { moments: [] };
      if (site === "doc.bookends")
        return {
          intro: { narration: "A long wait is over.", on_screen: "x" },
          outro: {
            narration: "Thanks for watching.",
            on_screen: "y",
            label: "z",
          },
          description: "d",
          title: "t",
          pinned_comment: "p",
          tags: [],
        };
      throw new Error(`no answer for ${site}`);
    },
  } as unknown as Llm;
  const s = {
    db,
    cfg,
    llm,
    now: () => new Date("2026-11-25T18:00:00Z"),
    notify: async (m: never) => (told.push(m), true),
    research: async () => ({
      title: "Cyberpunk 2077",
      url: "https://en.wikipedia.org/wiki/Cyberpunk_2077",
      text: "Cyberpunk 2077 was released in December 2020.",
    }),
  } as unknown as Services;
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json)
     VALUES ('ep_doc', 'documentary:cp', 'selected', $1, 'longform', $2)`,
    [
      JSON.stringify({
        headline: "Cyberpunk",
        items: [],
        sources: [],
        hash: "documentary:cp",
        gameHint: "Cyberpunk 2077",
      }),
      JSON.stringify({
        doc: true,
        topic: {
          kind: "story",
          franchise_index: -1,
          story_index: -1,
          title_idea: "t",
          angle: "a",
          reason: "r",
          franchise: "Cyberpunk 2077",
          wiki: "Cyberpunk 2077",
        },
      }),
    ],
  );
  await advance(s, (await getEpisode(db, "ep_doc"))!);
  const ep = (await getEpisode(db, "ep_doc"))!;
  const events = await db.query<{
    kind: string;
    detail: Record<string, unknown>;
  }>(`SELECT kind, detail FROM events WHERE episode_id = 'ep_doc' ORDER BY id`);
  await db.close();
  return { ep, told, events, checks };
}

const plainChapter = `${OPEN}\n${FILL_A}\n${FILL_B}\n${FILL_C}`;
const withLine = (line: string) =>
  `${OPEN}\n${FILL_A} ${line} ${FILL_B}\n${FILL_C}`;

test("the documentary cuts the disputed Matrix Online line, re-checks clean and says what it cut, never 'they stay in'", async () => {
  const { ep, told, events } = await writeDoc((n) =>
    n === 2 ? withLine(CYBERPUNK[0]!.sentence) : plainChapter,
  );
  assert.equal(ep.status, "scripted", ep.last_error ?? "");
  assert.doesNotMatch(JSON.stringify(ep.script_json), /Matrix Online/);
  const gate = events.filter(
    (e) => e.kind === "doc_fact_discipline" && e.detail.chapter === 2,
  );
  assert.equal(gate.length, 1);
  assert.equal(gate[0]!.detail.ok, true);
  assert.ok(
    told.some((m) =>
      /disputed lines were mended or cut, then checked clean/.test(
        m.content ?? "",
      ),
    ),
  );
  assert.ok(!told.some((m) => /stay in/.test(m.content ?? "")));
});

test("a chapter still disputed after the cuts is dropped and the documentary goes on without it", async () => {
  // The disputed line is the chapter's opening one: never cut, so the chapter can't be kept.
  const { ep, told, events } = await writeDoc((n) =>
    n === 3
      ? `${CYBERPUNK[16]!.sentence} ${OPEN}\n${FILL_A}\n${FILL_B}`
      : plainChapter,
  );
  assert.equal(ep.status, "scripted", ep.last_error ?? "");
  assert.doesNotMatch(JSON.stringify(ep.script_json), /slipped again/);
  const dropped = events.filter((e) => e.kind === "doc_chapter_dropped");
  assert.deepEqual(
    dropped.map((e) => [e.detail.chapter, e.detail.facts]),
    [[3, true]],
  );
  assert.ok(
    told.some((m) =>
      /dropped chapter 3 .*fact check still disputes it/.test(m.content ?? ""),
    ),
  );
});

test("a first chapter still disputed stops the documentary with a clear reason, before the voice", async () => {
  const { ep, told } = await writeDoc((n) =>
    n === 1 ? `${CYBERPUNK[16]!.sentence} ${OPEN}\n${FILL_A}` : plainChapter,
  );
  assert.equal(ep.status, "failed");
  assert.match(
    ep.last_error ?? "",
    /documentary chapter 1 fails its fact check after rewrites and cuts: .*opening sentence/,
  );
  assert.equal(ep.script_json, null);
  assert.ok(
    told.some((m) => m.ping && /Stopped the documentary/.test(m.content ?? "")),
  );
});

test("with DOC_FACT_DISCIPLINE off the old behaviour is back, and says so", async () => {
  const { ep, told } = await writeDoc(
    (n) => (n === 2 ? withLine(CYBERPUNK[0]!.sentence) : plainChapter),
    {
      docFactDiscipline: false,
    },
  );
  assert.equal(ep.status, "scripted", ep.last_error ?? "");
  assert.match(JSON.stringify(ep.script_json), /Matrix Online/);
  assert.ok(
    told.some((m) =>
      /stay in \(DOC_FACT_DISCIPLINE is off\)/.test(m.content ?? ""),
    ),
  );
});

// ------------------------------------------------------------------ the weekly explainer, on a fake model

async function writeExplained(partText: (n: number) => string) {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), { longformEnabled: true });
  const checks: string[] = [];
  const llm = {
    async structured({ site, content }: { site: string; content: unknown }) {
      const text = String(content);
      if (site === "doc.explained.package")
        return {
          question: "Why did Cyberpunk 2077 come back?",
          title: "Cyberpunk Comes Back",
          kicker: "How Night City was rebuilt",
          chapter_titles: [
            "The Launch Goes Wrong",
            "The Store Pulls It",
            "The Long Repair",
            "Night City Returns",
          ],
          youtube: {
            title: "What Really Happened to Cyberpunk 2077",
            thumb_text: "THE COMEBACK",
            description: "d.",
            tags: [],
          },
        };
      if (site === "doc.explained.chapter") {
        // The part being written, from its job line: a rewrite of a part is the same part.
        const part = EXPLAINED_PARTS.findIndex((p) => text.includes(p.job)) + 1;
        return {
          paragraphs: partText(part)
            .split("\n")
            .map((t) => para(t)),
          claims: [],
        };
      }
      if (site === "doc.check") {
        checks.push(text);
        const narration =
          text.split("NARRATION:\n")[1]?.split("\n\nSOURCE")[0] ?? text;
        return {
          unsupported: CYBERPUNK.filter((x) =>
            fold(narration).includes(fold(x.item.quote)),
          ).map((x) => x.item),
        };
      }
      if (site === "doc.shots") return { moments: [] };
      if (site === "doc.explained.bookends")
        return {
          intro: { narration: "Welcome back.", on_screen: "x" },
          outro: {
            narration: "Thanks for watching.",
            on_screen: "y",
            label: "z",
          },
          description: "d",
          title: "t",
          pinned_comment: "p",
          tags: [],
        };
      throw new Error(`no answer for ${site}`);
    },
  } as unknown as Llm;
  const s = {
    db,
    cfg,
    llm,
    now: () => new Date("2026-11-25T18:00:00Z"),
    notify: async () => true,
    fetchArticle: async () => ({
      title: "Eurogamer",
      text: "Cyberpunk 2077 was released in December 2020.",
    }),
    research: async () => undefined,
  } as unknown as Services;
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json)
     VALUES ('ep_x', 'explained:cp', 'selected', '{}', 'longform', '{}')`,
  );
  const story = {
    key: "cp",
    game: "Cyberpunk 2077",
    steamTerm: "",
    headline: "Cyberpunk 2077 returns",
    headlines: [],
    shortIds: [],
    urls: [
      { url: "https://www.eurogamer.net/x", source: "Eurogamer", title: "x" },
    ],
    summaries: [],
    rumour: false,
    score: 1,
    scoreLine: "",
  };
  const ep = (await getEpisode(db, "ep_x"))!;
  const out = await stepScriptExplained(s, ep, story, {
    segmentInputs: () => [],
  }).then(
    () => undefined,
    (e: Error) => e,
  );
  const after = (await getEpisode(db, "ep_x"))!;
  const events = await db.query<{
    kind: string;
    detail: Record<string, unknown>;
  }>(`SELECT kind, detail FROM events WHERE episode_id = 'ep_x' ORDER BY id`);
  await db.close();
  return { error: out, ep: after, events, checks };
}

test("the weekly explainer cuts a disputed line the same way and never keeps it", async () => {
  const { error, ep, events } = await writeExplained((n) =>
    n === 2 ? withLine(CYBERPUNK[15]!.sentence) : plainChapter,
  );
  assert.equal(error, undefined, error?.message ?? "");
  assert.equal(ep.status, "scripted");
  assert.doesNotMatch(
    JSON.stringify(ep.script_json),
    /always meant to come on newer hardware/,
  );
  assert.ok(
    events.some(
      (e) =>
        e.kind === "doc_fact_discipline" &&
        e.detail.ok === true &&
        (e.detail.repairs as unknown[]).length === 1,
    ),
  );
});

test("the weekly explainer stops when its first part stays disputed, with the reason", async () => {
  const { error } = await writeExplained((n) =>
    n === 1 ? `${CYBERPUNK[16]!.sentence} ${OPEN}\n${FILL_A}` : plainChapter,
  );
  assert.match(
    error?.message ?? "",
    /explainer part ".*" fails its fact check after rewrites and cuts/,
  );
});

// ------------------------------------------------------------------ requeueing a rejected episode

test("/admin/retry?rewrite=1 takes a rejected episode, voiced or not, but never one that reached YouTube", () => {
  assert.deepEqual(
    rewriteRetry({
      status: "rejected",
      lane: "longform",
      assets_json: { audio: "a.mp3" },
      youtube_video_id: null,
    }),
    {
      ok: true,
      clearAssets: true,
    },
  );
  assert.deepEqual(
    rewriteRetry({
      status: "failed",
      lane: "longform",
      assets_json: null,
      youtube_video_id: null,
    }),
    {
      ok: true,
      clearAssets: false,
    },
  );
  assert.equal(
    rewriteRetry({
      status: "rejected",
      lane: "longform",
      assets_json: null,
      youtube_video_id: "abc",
    }).ok,
    false,
  );
  // A voiced failure still takes the ordinary retry (back to "voiced"), as before.
  assert.equal(
    rewriteRetry({
      status: "failed",
      lane: "longform",
      assets_json: { audio: "a.mp3" },
      youtube_video_id: null,
    }).ok,
    false,
  );
  assert.equal(
    rewriteRetry({
      status: "published",
      lane: "longform",
      assets_json: null,
      youtube_video_id: null,
    }).ok,
    false,
  );
});

test("a rejected Short is never rewritten: it was rejected on purpose", () => {
  assert.equal(
    rewriteRetry({ status: "rejected", lane: "shorts", assets_json: null, youtube_video_id: null }).ok,
    false,
  );
});

// ------------------------------------------------------------------ review follow-ups (code-reviewer, 25 Nov)

test("two disputed claims in one sentence: the cut that takes the first settles the second", () => {
  const line = CYBERPUNK[12]!.sentence;
  const r = repairDocChapter(docChapter(line), [
    CYBERPUNK[12]!.item,
    { quote: "was already testing older consoles", problem: "Not dated to August 2019 by the source." },
  ]);
  assert.deepEqual(r.unrepaired, []);
  assert.doesNotMatch(spoken(r.chapter), /testing older consoles/);
});

test("a cut that would leave 'It' or 'The game' pointing at the wrong thing is refused", () => {
  for (const next of ["It closed four years later.", "The game never came back.", "Two years later the servers went dark."]) {
    const r = repairDocChapter(docChapter(`${CYBERPUNK[0]!.sentence} ${next}`), [CYBERPUNK[0]!.item]);
    assert.match(r.unrepaired[0]?.why ?? "", /leans on it/, next);
  }
});

test("a sentence the splitter cut short after an abbreviation is never cut as if whole", () => {
  const r = repairDocChapter(docChapter("Sales were strongest in the U.S. Retailers ran out by noon."), [
    { quote: "Sales were strongest in the U.S.", problem: "No regional sales split in the source." },
  ]);
  assert.match(r.unrepaired[0]?.why ?? "", /told apart cleanly/);
});

test("a fact check that can't run is a retry, never a drop or a verdict", async () => {
  const out = await disciplineChapter({
    chapter: docChapter(CYBERPUNK[7]!.sentence),
    disputed: undefined,
    check: async () => {
      throw new Error("model down");
    },
  });
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.errored, true);
  const stubborn = await disciplineChapter({
    chapter: docChapter(CYBERPUNK[7]!.sentence),
    disputed: [CYBERPUNK[7]!.item],
    check: async () => [CYBERPUNK[16]!.item],
  });
  assert.equal(!stubborn.ok && !!stubborn.errored, false, "a real verdict is not an outage");
});

test("a cut piece the splitter took from after an abbreviation is refused too", () => {
  const r = repairDocChapter(docChapter("Sales in the U.S. Topped two million by spring."), [
    { quote: "Topped two million by spring.", problem: "No sales figure in the source." },
  ]);
  assert.match(r.unrepaired[0]?.why ?? "", /told apart cleanly/);
  // An ordinary "no." at the end of a line is not an abbreviation.
  const ok = repairDocChapter(docChapter("Sony's answer was a flat no. The second trailer did most of the work."), [
    CYBERPUNK[7]!.item,
  ]);
  assert.deepEqual(ok.unrepaired, []);
});
