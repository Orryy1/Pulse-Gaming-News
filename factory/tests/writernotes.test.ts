import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  releaseWriterNotes,
  scriptWriterNotes,
  srtText,
  writerNoteHits,
  writerNoteProblems,
} from "../src/editorial/writernotes.ts";
import { voiceProblems, phraseProblems } from "../src/editorial/voice.ts";
import {
  chapterRefusal,
  validateChapter,
  writeChapter,
  DocChapterSchema,
  type DocChapter,
} from "../src/editorial/documentary.ts";
import { gateDecision } from "../src/qa/releaseGate.ts";
import { badTextAlert, badTextMutes } from "../src/qa/graphicscheck.ts";
import {
  focusTerms,
  mergeArticles,
  pickSections,
  shareBudget,
} from "../src/discovery/wikipedia.ts";
import { guardScript } from "../src/writerguard.ts";
import { advance, type Services } from "../src/pipeline.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { getEpisode } from "../src/episodes.ts";
import { testDb, testConfig, tmpDir } from "./helpers.ts";
import { widerDocSource } from "../src/pipeline.ts";
import { narrate } from "../src/voice/index.ts";
import { FatalError } from "../src/lib/util.ts";

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, "fixtures", "ffxiv_writer_notes.json"),
    "utf8",
  ),
) as { bad_beats: string[]; bad_captions: string; good_beats: string[] };

test("every one of the real Final Fantasy XIV refusal beats is caught", () => {
  assert.equal(fixture.bad_beats.length, 8);
  for (const beat of fixture.bad_beats)
    assert.ok(writerNoteHits(beat).length > 0, beat.slice(0, 80));
});

test("the real captions are caught, where the capitals of SOURCE are gone", () => {
  const text = srtText(fixture.bad_captions);
  assert.ok(!/-->/.test(text));
  assert.ok(writerNoteHits(text).length >= 8);
  // Line by line in sentence case, as a recogniser hands them over with no punctuation.
  const flat = text.toLowerCase().replace(/[.,!?]/g, "");
  assert.ok(writerNoteHits(flat).length >= 3);
});

test("the same film's normal beats raise no alarm", () => {
  for (const beat of fixture.good_beats)
    assert.deepEqual(writerNoteHits(beat), [], beat.slice(0, 80));
});

test("real uses of the risky words are left alone", () => {
  for (const line of [
    "One source told Eurogamer she was allegedly terminated for policy violations.",
    "IGN says Prime Video sources confirmed it, and every creative attached to the show is still on board.",
    "After the source code reportedly leaked in December 2023, dataminers found at least eight cancelled expansions.",
    "Valve built Half-Life 2 on the Source engine, and Counter-Strike: Source followed that year.",
    "Source 2 arrived with Dota 2. Built on Source, it looked a generation newer.",
    "The source says Rockstar hasn't decided.",
    "Eurogamer couldn't verify it. The sources were reportedly caught up in last month's mass layoffs.",
    "Nothing in the sources suggests Valve is doing that here.",
    "What our sources don't give us yet is a price, a date or the full roster.",
    "The script, written with Rupert Humphries, ran about 1,000 pages. The first draft was twice that.",
    "Even failing a mission was rewritten, with fresh lines on a retry.",
    "The first chapter of the game opens in Liberty City. This chapter of Rockstar's history ended badly.",
    "The narrator of the game sounds tired. The narration in the opening is Hank's.",
    "She read an excerpt from the novel on stage. Critics praised the excerpt.",
    "Your instructions are simple: reach the extraction point and don't die.",
    "Please add Bloodborne to PC, fans wrote. Please, the petition said, just a remaster.",
    "I can't believe it's real, Kojima said. I cannot wait for players to see it.",
    "The brief filed by the FTC argued the deal would hurt competition.",
    "The court saw the evidence. A passage from the email said the opposite.",
    "He supplied the voice of Niko, and motion capture supplied the basis for movement.",
    "Square Enix hasn't said when the game will arrive. That hasn't been mentioned since.",
    "Bethesda doesn't name a date.",
    "The parachute prompt stays on screen as you fall.",
    "It runs the same word count as a Tolstoy novel, the writers joked.".replace(
      "the same word count as",
      "as long as",
    ),
  ])
    assert.deepEqual(writerNoteHits(line), [], line);
});

test("a new wording of the same thing is caught by its signs, not only by known phrases", () => {
  const hits = writerNoteHits(
    "The article doesn't mention the billing date. This chapter can't go further without it. There's no direct evidence here, and the passage about the finale is missing.",
  );
  assert.ok(hits.length > 0);
});

test("the classic answers of a model are caught", () => {
  for (const line of [
    "I cannot write this chapter without more information.",
    "As an AI, I don't have the history.",
    "Here's the revised chapter with the date removed.",
    "If you can provide the release section, I'll finish it.",
  ])
    assert.ok(writerNoteHits(line).length > 0, line);
});

test("the shared validators send it back in every lane", () => {
  const line = fixture.bad_beats[3]!;
  assert.ok(phraseProblems(line).some((p) => /writing task/.test(p)));
  assert.ok(voiceProblems(line).some((p) => /writing task/.test(p)));
  assert.equal(writerNoteProblems(fixture.good_beats[0]!).length, 0);
});

const chapter = (
  narration: string,
  more: Partial<DocChapter> = {},
): DocChapter => ({
  paragraphs: Array.from({ length: 4 }, () => ({
    narration,
    callout: { kind: "none" as const, primary: "", secondary: "" },
    footage: { want: "none", keywords: [] } as never,
  })),
  claims: [],
  ...more,
});

test("a chapter can say it lacks evidence, and that is never narration", () => {
  const gap = DocChapterSchema.parse({
    paragraphs: [],
    claims: [],
    missing_evidence: "Nothing on when billing resumed.",
  });
  assert.ok(chapterRefusal(gap).some((r) => /missing evidence/.test(r)));
  assert.ok(validateChapter(gap).some((p) => /at least/.test(p)));
  assert.ok(chapterRefusal(chapter("x", { paragraphs: [] })).length > 0);
  assert.ok(chapterRefusal(chapter(fixture.bad_beats[0]!)).length > 0);
  assert.deepEqual(chapterRefusal(chapter(fixture.good_beats[0]!)), []);
});

test("the chapter prompt offers the way out and forbids the refusal", async () => {
  let seen = "";
  const llm = {
    structured: async (o: { system: string }) => {
      seen = o.system;
      return chapter(fixture.good_beats[0]!);
    },
  } as never;
  await writeChapter(llm, {
    franchise: "F",
    plan: {
      chapter_title: "T",
      game_title: "G",
      wiki_title: "W",
      steam_search_term: "",
      year: 2010,
      platforms: "PC",
      focus: "f",
      photo_searches: [],
    },
    index: 0,
    outline: {
      title: "O",
      chapters: [{ chapter_title: "T", game_title: "G", year: 2010 }],
    } as never,
    source: { title: "W", url: "u", text: "t" },
  });
  assert.match(seen, /missing_evidence/);
  assert.match(seen, /never explain what can't be written/);
});

const services = () => {
  const told: Array<{ ping?: boolean; content?: string }> = [];
  const events: unknown[][] = [];
  return {
    told,
    events,
    s: {
      db: { query: async (...a: unknown[]) => (events.push(a), []) } as never,
      notify: async (m: never) => {
        told.push(m);
      },
      cfg: { writerNotesGuard: true },
    },
  };
};

const ffxivScript = () => ({
  headline: "How Final Fantasy XIV Survived Its Shutdown",
  hook: fixture.good_beats[0]!,
  beats: fixture.bad_beats.map((narration) => ({ narration })),
  pulse_take: { narration: "It worked." },
  loop_line: "",
  youtube: {
    title: "How Final Fantasy XIV Survived Its Shutdown",
    description: "Source: Wikipedia.",
  },
});

test("the door stops the real script with a loud alert, in every direction", async () => {
  const { s, told } = services();
  const ep = {
    id: "e",
    script_json: null,
    story_json: { headline: "h" },
  } as never;
  await assert.rejects(
    guardScript(s as never, ep, ffxivScript() as never, "before the voice"),
    (e: Error) => e instanceof FatalError && /writer's notes/.test(e.message),
  );
  assert.equal(told.length, 1);
  assert.equal(told[0]!.ping, true);
  assert.match(told[0]!.content!, /Stopped/);
});

test("the door lets a normal script through and can be turned off", async () => {
  const { s, told } = services();
  const ep = {
    id: "e",
    script_json: null,
    story_json: { headline: "h" },
  } as never;
  const good = {
    ...ffxivScript(),
    beats: fixture.good_beats.map((narration) => ({ narration })),
  };
  await guardScript(s as never, ep, good as never, "before the voice");
  await guardScript(
    { ...s, cfg: { writerNotesGuard: false } } as never,
    ep,
    ffxivScript() as never,
    "before the voice",
  );
  assert.equal(told.length, 0);
});

test("the voice itself refuses the text and spends nothing", async () => {
  await assert.rejects(
    narrate(
      { writerNotesGuard: true, voiceProvider: "elevenlabs" } as never,
      fixture.bad_beats[3]!,
      "nowhere.mp3",
    ),
    (e: Error) => e instanceof FatalError,
  );
});

test("the release gate fails it whatever the shots scored", () => {
  const stats = {
    shots: 100,
    mean: 2.9,
    zeroShare: 0,
    threeShare: 0.9,
    seconds: 1000,
  } as never;
  const limits = { minMean: 1.2, maxZero: 0.1 };
  assert.equal(gateDecision(stats, limits).pass, true);
  const found = releaseWriterNotes({ srt: fixture.bad_captions });
  const d = gateDecision(stats, limits, found);
  assert.equal(d.pass, false);
  assert.match(d.reasons[0]!, /writer's notes/);
});

test("release looks at the script, the voice's words and the captions apart", () => {
  const words = fixture.bad_beats[3]!.split(" ").map((text) => ({ text }));
  assert.ok(
    releaseWriterNotes({ words }).some((f) => f.where === "the voice's words"),
  );
  assert.ok(
    releaseWriterNotes({ srt: fixture.bad_captions }).some(
      (f) => f.where === "the captions",
    ),
  );
  assert.ok(scriptWriterNotes(ffxivScript()).some((f) => f.where === "beat 3"));
  assert.deepEqual(
    releaseWriterNotes({
      script: { beats: fixture.good_beats.map((narration) => ({ narration })) },
      srt: "1\n00:00:00,000 --> 00:00:01,000\nOne source told Eurogamer.\n",
    }),
    [],
  );
});

test("on-screen text counts, and the picture editor's note does not", () => {
  const found = scriptWriterNotes({
    entries: [
      {
        moments: [
          { show: "Supplied excerpt on a desk", graphic: { primary: "" } },
          {
            show: "x",
            filler: {
              data: {
                card: { sentence: "That gap matters under your source rule." },
              },
            },
          },
        ],
      },
    ],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.where, "chapter 0 moment 1 on screen");
});

test("graphics muted as placeholder text raise the alarm; ordinary faults do not", () => {
  const bad = badTextMutes([
    'Frame 3: The headline reads "DID THEY WANT YOU TO FIND" and ends on the giant word, so it looks like garbled or placeholder text.',
    "Frame 4: the row label wraps to two lines and crowds the value.",
  ]);
  assert.equal(bad.length, 1);
  assert.match(badTextAlert("FFXIV", bad), /Muting hides it/);
});

// ---------------------------------------------------------------- the thin brief behind it

const article = [
  "Lead text about the game.",
  "== Development ==",
  "d".repeat(7000),
  "== Release ==",
  "r".repeat(3000),
  "== Post-release ==",
  `${"p".repeat(3500)} The servers closed in the grand finale.`,
  "== Legacy ==",
  "l".repeat(900),
  "== Plot ==",
  "The moon falls on Eorzea.",
  "== References ==",
  "none",
].join("\n");

test("one long section can't push the rest of the article out of the brief", () => {
  const picked = pickSections(article, 9000);
  for (const heading of [
    "Overview",
    "Development",
    "Release",
    "Post-release",
    "Legacy",
    "Plot",
  ])
    assert.ok(picked.includes(`## ${heading}`), heading);
  assert.ok(picked.length <= 9400, String(picked.length));
  assert.ok(!picked.includes("none"));
});

test("a chapter's focus brings the sections about it first and whole", () => {
  const picked = pickSections(
    article,
    9000,
    "The grand finale as the servers closed",
  );
  assert.ok(
    picked.indexOf("## Post-release") < picked.indexOf("## Development"),
  );
  assert.ok(picked.includes("closed in the grand finale"));
  assert.ok(focusTerms("The Shutdown Becomes Canon").includes("shutdown"));
});

test("shareBudget gives short sections all they want and shares the rest", () => {
  assert.deepEqual(shareBudget([100, 5000, 5000], 3100), [100, 1500, 1500]);
  assert.deepEqual(shareBudget([10, 20], 1000), [10, 20]);
  assert.deepEqual(shareBudget([], 1000), []);
});

test("a chapter short of evidence gets more articles, credited, and not a tighter brief", async () => {
  const asked: Array<[string, number | undefined, string | undefined]> = [];
  const wider = await widerDocSource(
    {
      research: async (
        title: string,
        _q: string,
        max?: number,
        focus?: string,
      ) => {
        asked.push([title, max, focus]);
        return title === "Missing"
          ? undefined
          : { title, url: `https://w/${title}`, text: `about ${title}` };
      },
    } as never,
    {
      wiki_title: "A",
      game_title: "G",
      year: 2010,
      focus: "the finale",
      chapter_title: "The End",
    },
    "B",
    ["A", "Missing", "C", "D"],
  );
  assert.deepEqual(
    asked.map((x) => x[0]),
    ["A", "B", "Missing", "C"],
  );
  assert.ok(asked.every((x) => x[1]! > 9000 && /finale/.test(x[2]!)));
  assert.equal(wider!.title, "A");
  assert.deepEqual(wider!.also, ["https://w/B", "https://w/C"]);
  assert.match(wider!.text, /about C/);
  assert.equal(mergeArticles([]), undefined);
});

// ---------------------------------------------------------------- the whole writing step, on a fake model

async function writeDoc(chapterAnswer: (no: number, content: string) => unknown) {
  const db = await testDb();
  const cfg = testConfig(await tmpDir(), {
    longformEnabled: true,
    docEnabled: true,
    docOpenLoops: false,
  });
  const plans = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    chapter_title: `Chapter ${n}`,
    game_title: "Final Fantasy XIV",
    wiki_title: "Final Fantasy XIV (2010 video game)",
    steam_search_term: "",
    year: 2010,
    platforms: "PC",
    focus: "x",
    photo_searches: [],
  }));
  const researched: Array<number | undefined> = [];
  const told: Array<{ ping?: boolean; content?: string }> = [];
  let no = 0;
  const llm = {
    async structured({ site, content }: { site: string; content: unknown }) {
      if (site === "doc.outline")
        return { question: "Q?", title: "The Rebuild", description: "d", chapters: plans, open_loops: [], youtube: { title: "t", description: "d", tags: [] } };
      if (site === "doc.chapter") return chapterAnswer(++no, String(content));
      if (site === "doc.check") return { unsupported: [] };
      if (site === "doc.shots") return { moments: [] };
      if (site === "doc.bookends")
        return { intro: { narration: "A long wait is over.", on_screen: "x" }, outro: { narration: "Thanks for watching.", on_screen: "y", label: "z" }, description: "d", title: "t", pinned_comment: "p", tags: [] };
      throw new Error(`no answer for ${site}`);
    },
  } as unknown as Llm;
  const s = {
    db,
    cfg,
    llm,
    now: () => new Date("2026-11-21T02:00:00Z"),
    notify: async (m: never) => (told.push(m), true),
    research: async (_t: string, _q: string, max?: number) => {
      researched.push(max);
      return { title: "FFXIV", url: "https://en.wikipedia.org/wiki/FFXIV", text: `${max && max > 16000 ? "WIDE " : ""}The servers closed in 2012.` };
    },
  } as unknown as Services;
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json)
     VALUES ('ep_doc', 'documentary:x', 'selected', $1, 'longform', $2)`,
    [
      JSON.stringify({ headline: "The Rebuild", items: [], sources: [], hash: "documentary:x", gameHint: "Final Fantasy XIV" }),
      JSON.stringify({ doc: true, topic: { kind: "story", franchise_index: -1, story_index: -1, title_idea: "t", angle: "a", reason: "r", franchise: "Final Fantasy XIV", wiki: "Final Fantasy XIV" } }),
    ],
  );
  await advance(s, (await getEpisode(db, "ep_doc"))!);
  const ep = (await getEpisode(db, "ep_doc"))!;
  await db.close();
  return { ep, told, researched, asked: () => no };
}

const storyChapter = () =>
  chapter(
    "The servers closed in 2012, and the players who had stayed to the end watched the old world go dark together. It was the first time an online game had made its own closure part of the story, and nobody who was there forgot the sight of it.",
  );

const isChapter = (n: number, content: string) =>
  new RegExp(`This chapter: Chapter ${n}\\b`).test(content);

test("a refusal gets more sources and a fresh attempt, and the refusal is not what goes out", async () => {
  const seen: string[] = [];
  let refusals = 0;
  const { ep, researched } = await writeDoc((_no, content) => {
    if (isChapter(2, content) && !refusals++) return chapter(fixture.bad_beats[3]!);
    if (isChapter(2, content)) seen.push(content);
    return storyChapter();
  });
  assert.notEqual(ep.status, "failed", ep.last_error ?? "");
  assert.doesNotMatch(JSON.stringify(ep.script_json), /SOURCE|recorded or published/);
  assert.ok(researched.some((m) => m! > 16000), "the wider brief was fetched");
  assert.match(seen[0]!, /WIDE/, "the retry sees it");
  assert.doesNotMatch(seen[0]!, /YOUR DRAFT/, "and the refusal isn't patched");
});

test("a writer that says it lacks evidence is asked again with more, and that line is never spoken", async () => {
  let gaps = 0;
  const { ep } = await writeDoc((_no, content) =>
    isChapter(3, content) && !gaps++
      ? { paragraphs: [], claims: [], missing_evidence: "Nothing on billing." }
      : storyChapter(),
  );
  assert.notEqual(ep.status, "failed", ep.last_error ?? "");
  assert.doesNotMatch(JSON.stringify(ep.script_json), /Nothing on billing/);
});

test("the first refusal on the last try still gets its go with the wider sources", async () => {
  let asked = 0;
  const { ep } = await writeDoc((_no, content) => {
    if (!isChapter(2, content)) return storyChapter();
    asked++;
    return asked === 3 ? chapter(fixture.bad_beats[3]!) : storyChapter();
  });
  assert.notEqual(ep.status, "failed", ep.last_error ?? "");
  assert.equal(asked, 4);
  assert.doesNotMatch(JSON.stringify(ep.script_json), /SOURCE/);
});

test("a writer that keeps refusing stops the video with a loud alert, and it never gets to the voice", async () => {
  let asked = 0;
  const { ep, told } = await writeDoc((_no, content) => {
    if (!isChapter(2, content)) return storyChapter();
    asked++;
    return chapter(fixture.bad_beats[3]!);
  });
  assert.equal(ep.status, "failed");
  assert.match(ep.last_error ?? "", /refused/);
  assert.equal(asked, 3);
  assert.ok(told.some((m) => m.ping && /Stopped the documentary/.test(m.content ?? "")));
  assert.equal(ep.script_json, null);
});
