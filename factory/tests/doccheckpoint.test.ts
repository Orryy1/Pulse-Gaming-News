// DOC_CHAPTER_CHECKPOINT: a documentary keeps its outline and finished chapters on disk, so a restart resumes them.
// 25 Nov 2026: the Cyberpunk 2077 documentary (ep_20261125_87abc5a2) started its chapters over four times, once per
// factory restart, and missed its 19:00 slot.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DOC_CHECKPOINT_VERSION,
  clearDocCheckpoint,
  docCheckpointPath,
  docTopicKey,
  loadDocCheckpoint,
  pruneDocCheckpoints,
  relinkPlans,
  saveDocCheckpoint,
  type DocCheckpoint,
} from "../src/editorial/doccheckpoint.ts";
import type { DocChapter } from "../src/editorial/documentary.ts";
import { advance, type Services } from "../src/pipeline.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { getEpisode } from "../src/episodes.ts";
import { testDb, testConfig, tmpDir } from "./helpers.ts";

const NOW = new Date("2026-11-25T18:00:00Z");
const TOPIC = {
  kind: "story",
  franchise_index: -1,
  story_index: -1,
  title_idea: "t",
  angle: "a",
  reason: "r",
  franchise: "Cyberpunk 2077",
  wiki: "Cyberpunk 2077",
};

const chapter = (n: number): DocChapter => ({
  paragraphs: Array.from({ length: 4 }, (_, p) => ({
    narration: `Chapter ${n} part ${p}: the game shipped in 2020, and the patches that followed rebuilt how its city felt to walk through, street by street, until the players who had left came back to see it.`,
    callout: { kind: "none" as const, primary: "", secondary: "" },
    footage: { want: "none", keywords: [] } as never,
  })),
  claims: [],
});

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

const chapterNo = (content: string) =>
  Number(/This chapter: Chapter (\d+)\b/.exec(content)?.[1] ?? 0);

const fixture = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", "ffxiv_writer_notes.json"), "utf8"),
) as { bad_beats: string[] };
const note: DocChapter = {
  ...chapter(0),
  paragraphs: chapter(0).paragraphs.map((p) => ({ ...p, narration: fixture.bad_beats[3]! })),
};

/** One run of the documentary writing step; `failAt` throws from that chapter's writer, as a timeout would. */
async function run(
  dataDir: string,
  opts: {
    failAt?: number;
    /** That chapter always comes back as a note to the editor, never narration. */
    noteAt?: number;
    bookendsFail?: boolean;
    overrides?: Partial<Services["cfg"]>;
    now?: Date;
  } = {},
) {
  const db = await testDb();
  const cfg = testConfig(dataDir, {
    longformEnabled: true,
    docEnabled: true,
    docOpenLoops: false,
    docChapterCheckpoint: true,
    ...opts.overrides,
  });
  const outlines: number[] = [];
  const chaptersAsked: number[] = [];
  const llm = {
    async structured({ site, content }: { site: string; content: unknown }) {
      if (site === "doc.outline") {
        outlines.push(1);
        return {
          question: "Q?",
          title: "Night City Rebuilt",
          description: "d",
          chapters: plans,
          open_loops: [],
          youtube: { title: "t", description: "d", tags: [] },
        };
      }
      if (site === "doc.chapter") {
        const n = chapterNo(String(content));
        chaptersAsked.push(n);
        if (n === opts.failAt) throw new Error("codex timed out after 705 s");
        if (n === opts.noteAt) return note;
        return chapter(n);
      }
      if (site === "doc.check") return { unsupported: [] };
      if (site === "doc.shots") return { moments: [] };
      if (site === "doc.bookends" && opts.bookendsFail) throw new Error("codex timed out after 705 s");
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
    now: () => opts.now ?? NOW,
    notify: async () => true,
    research: async () => ({
      title: "Cyberpunk 2077",
      url: "https://en.wikipedia.org/wiki/Cyberpunk_2077",
      text: "Cyberpunk 2077 was released in 2020.",
    }),
  } as unknown as Services;
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json)
     VALUES ('ep_cp', 'documentary:cp', 'selected', $1, 'longform', $2)`,
    [
      JSON.stringify({
        headline: "Night City Rebuilt",
        items: [],
        sources: [],
        hash: "documentary:cp",
        gameHint: "Cyberpunk 2077",
      }),
      JSON.stringify({ doc: true, topic: TOPIC }),
    ],
  );
  await advance(s, (await getEpisode(db, "ep_cp"))!).catch(() => undefined);
  const ep = (await getEpisode(db, "ep_cp"))!;
  const events = await db.query<{
    kind: string;
    detail: Record<string, unknown>;
  }>(`SELECT kind, detail FROM events WHERE episode_id = 'ep_cp' ORDER BY id`);
  await db.close();
  return { ep, outlines: outlines.length, chaptersAsked: [...new Set(chaptersAsked)], events };
}

const file = (dataDir: string) => docCheckpointPath(dataDir, "ep_cp");
const narrationOf = (ep: { script_json: unknown }) =>
  JSON.stringify(ep.script_json);

test("a run cut off at chapter 4 resumes there: no new outline, chapters 1 to 3 not written again", async () => {
  const dir = await tmpDir();
  const first = await run(dir, { failAt: 4 });
  assert.equal(first.ep.script_json, null, "the first run did not finish");
  assert.deepEqual(first.chaptersAsked, [1, 2, 3, 4]);
  const saved = JSON.parse(fs.readFileSync(file(dir), "utf8")) as DocCheckpoint;
  assert.deepEqual(saved.done, [0, 1, 2]);
  assert.equal(saved.chapters.length, 3);

  const second = await run(dir);
  assert.notEqual(second.ep.status, "failed", second.ep.last_error ?? "");
  assert.ok(second.ep.script_json, "the script was written");
  assert.equal(second.outlines, 0, "the outline was kept, not asked for again");
  assert.deepEqual(second.chaptersAsked, [4, 5, 6, 7]);
  for (const n of [1, 2, 3, 4, 5, 6, 7])
    assert.match(narrationOf(second.ep), new RegExp(`Chapter ${n} part 0`));
  const resumed = second.events.filter(
    (e) => e.kind === "doc_checkpoint_resumed",
  );
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]!.detail.chapters, 3);
  assert.equal(
    fs.existsSync(file(dir)),
    false,
    "a finished script removes its checkpoint",
  );
});

test("with the setting off nothing is kept and a second run starts from the outline", async () => {
  const dir = await tmpDir();
  await run(dir, { failAt: 4, overrides: { docChapterCheckpoint: false } });
  assert.equal(fs.existsSync(file(dir)), false);
  const second = await run(dir, { overrides: { docChapterCheckpoint: false } });
  assert.equal(second.outlines, 1);
  assert.deepEqual(second.chaptersAsked, [1, 2, 3, 4, 5, 6, 7]);
});

test("a failure after every chapter is written starts afresh next time instead of repeating the same draft", async () => {
  const dir = await tmpDir();
  // Seven chapters can't meet a minimum of eight: the step fails once the chapter loop is done.
  const first = await run(dir, { overrides: { docMinChapters: 8 } });
  assert.equal(first.ep.script_json, null);
  assert.match(first.ep.last_error ?? "", /only 7 chapters/);
  assert.equal(fs.existsSync(file(dir)), false);
});

test("a checkpoint that is too old is not resumed", async () => {
  const dir = await tmpDir();
  await run(dir, { failAt: 4 });
  const later = new Date(NOW.getTime() + 40 * 3_600_000);
  const second = await run(dir, { now: later });
  assert.equal(second.outlines, 1);
  assert.deepEqual(second.chaptersAsked, [1, 2, 3, 4, 5, 6, 7]);
});

const sample = (over: Partial<DocCheckpoint> = {}): DocCheckpoint => ({
  version: DOC_CHECKPOINT_VERSION,
  episode: "ep_x",
  topicKey: docTopicKey(TOPIC),
  savedAt: NOW.toISOString(),
  outline: { chapters: [] } as never,
  openLoops: { loops: [], removed: [] },
  done: [0],
  chapters: [],
  written: [0],
  droppedRefused: [],
  warnings: ["w"],
  ruleRevisions: 2,
  ...over,
});

test("load refuses another topic, another episode, a future or broken file; clear and prune remove files", async () => {
  const dir = await tmpDir();
  saveDocCheckpoint(dir, sample());
  assert.equal(
    loadDocCheckpoint(dir, "ep_x", docTopicKey(TOPIC), NOW, 36)?.ruleRevisions,
    2,
  );
  assert.equal(
    loadDocCheckpoint(
      dir,
      "ep_x",
      docTopicKey({ ...TOPIC, franchise: "The Witcher" }),
      NOW,
      36,
    ),
    undefined,
  );
  assert.equal(
    loadDocCheckpoint(dir, "ep_y", docTopicKey(TOPIC), NOW, 36),
    undefined,
  );
  assert.equal(
    loadDocCheckpoint(
      dir,
      "ep_x",
      docTopicKey(TOPIC),
      new Date(NOW.getTime() - 3_600_000),
      36,
    ),
    undefined,
  );
  assert.deepEqual(
    fs.readdirSync(path.dirname(docCheckpointPath(dir, "ep_x"))),
    ["ep_x.json"],
    "no temp file left behind",
  );
  fs.writeFileSync(docCheckpointPath(dir, "ep_x"), "{ half a fi");
  assert.equal(
    loadDocCheckpoint(dir, "ep_x", docTopicKey(TOPIC), NOW, 36),
    undefined,
  );
  clearDocCheckpoint(dir, "ep_x");
  assert.equal(fs.existsSync(docCheckpointPath(dir, "ep_x")), false);
  clearDocCheckpoint(dir, "ep_x");

  saveDocCheckpoint(dir, sample({ episode: "ep_old" }));
  saveDocCheckpoint(dir, sample({ episode: "ep_new" }));
  const old = docCheckpointPath(dir, "ep_old");
  const t = new Date(NOW.getTime() - 100 * 3_600_000);
  fs.utimesSync(old, t, t);
  assert.equal(pruneDocCheckpoints(dir, NOW, 72), 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(docCheckpointPath(dir, "ep_new")), true);
  assert.equal(pruneDocCheckpoints(path.join(dir, "nowhere"), NOW, 72), 0);
});

test("a timeout after every chapter is written keeps them: the retry goes straight to the bookends", async () => {
  const dir = await tmpDir();
  const first = await run(dir, { bookendsFail: true });
  assert.equal(first.ep.script_json, null);
  assert.equal((JSON.parse(fs.readFileSync(file(dir), "utf8")) as DocCheckpoint).done.length, 7);
  const second = await run(dir);
  assert.notEqual(second.ep.status, "failed", second.ep.last_error ?? "");
  assert.equal(second.outlines, 0);
  assert.deepEqual(second.chaptersAsked, []);
  assert.equal(fs.existsSync(file(dir)), false);
});

test("a chapter dropped as a note is not written again on resume, and the order holds", async () => {
  const dir = await tmpDir();
  const over = { docMetaGuard: true, writerNotesGuard: true, docDropRefusedChapter: true };
  const first = await run(dir, { noteAt: 3, failAt: 5, overrides: over });
  assert.equal(first.ep.script_json, null);
  const saved = JSON.parse(fs.readFileSync(file(dir), "utf8")) as DocCheckpoint;
  assert.ok(saved.done.includes(2), "chapter 3 is settled");
  const second = await run(dir, { noteAt: 3, overrides: over });
  assert.notEqual(second.ep.status, "failed", second.ep.last_error ?? "");
  assert.ok(!second.chaptersAsked.includes(3), "chapter 3 not asked again");
  assert.deepEqual(second.chaptersAsked, [5, 6, 7]);
  const text = narrationOf(second.ep);
  const at = [1, 2, 4, 5, 6, 7].map((n) => text.indexOf(`Chapter ${n} part 0`));
  assert.ok(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1]!)), "chapters in outline order");
  assert.doesNotMatch(text, /Chapter 3 part 0/);
});

test("kept chapters get the outline's own plan objects back (open loops are pinned by identity)", () => {
  const outline = { chapters: plans.map((p) => ({ ...p })) } as never as import("../src/editorial/documentary.ts").DocOutline;
  const fromDisk = JSON.parse(JSON.stringify({ chapters: [{ plan: plans[0] }, { plan: plans[3] }], written: [0, 3] }));
  const back = relinkPlans(fromDisk, outline);
  assert.equal(back[0]!.plan, outline.chapters[0]);
  assert.equal(back[1]!.plan, outline.chapters[3]);
});

test("the topic key changes with a re-planned entry", () => {
  assert.notEqual(docTopicKey(TOPIC), docTopicKey({ ...TOPIC, title_idea: "another" }));
  assert.notEqual(docTopicKey(TOPIC), docTopicKey({ ...TOPIC, planned: { chapters: ["a"] } }));
  assert.equal(docTopicKey(TOPIC), docTopicKey({ ...TOPIC }));
});
