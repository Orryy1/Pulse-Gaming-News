import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cleanBookends,
  cutSentences,
  resolveTestRecords,
  testRecordsSection,
  unbackedTestClaims,
  withTestRecords,
  type TestRecord,
} from "../src/editorial/testevidence.ts";
import {
  checkChapterItems,
  type DocBookends,
  type DocChapter,
} from "../src/editorial/documentary.ts";
import { advance, maybeSelectDocumentary } from "../src/pipeline.ts";
import type { Services } from "../src/pipeline.ts";
import type { Llm } from "../src/editorial/llm.ts";
import { getEpisode } from "../src/episodes.ts";
import { testDb, testConfig, tmpDir } from "./helpers.ts";

const REC: TestRecord = {
  id: "T1",
  clip: "gp_bike",
  game: "Grand Theft Auto V",
  claim: "You can jump a motorbike off the tallest tower",
  question: "CAN YOU JUMP A BIKE OFF THE TALLEST TOWER?",
  result:
    "The player rides a motorbike to the edge of the Maze Bank rooftop helipad and drives off. The bike tumbles into a long freefall over the city.",
};

const para = (narration: string) => ({
  narration,
  callout: { kind: "none", primary: "", secondary: "" },
});
const chapter = (...lines: string[]) =>
  ({ paragraphs: lines.map(para), claims: [] }) as unknown as DocChapter;

async function inserted(
  db: Awaited<ReturnType<typeof testDb>>,
  clip: string,
  over: {
    approved?: boolean;
    status?: string;
    real?: boolean;
    game?: string;
    result?: string;
  } = {},
) {
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, script_json, lane, approved_by)
     VALUES ($1, $2, $3, '{"headline":"x","items":[]}', $4, 'gameplay', $5)`,
    [
      `ep_${clip}`,
      `gameplay:${clip}`,
      over.status ?? "published",
      JSON.stringify({
        game_title: over.game ?? "Grand Theft Auto V",
        gameplay: {
          inbox_id: clip,
          question: "CAN YOU?",
          result: over.result ?? "It worked on the first try.",
          real_test: over.real ?? true,
        },
      }),
      over.approved === false ? null : "owner",
    ],
  );
}

test("only an approved, real test of this very game earns a record", async () => {
  const db = await testDb();
  await inserted(db, "gp_ok");
  await inserted(db, "gp_unapproved", {
    approved: false,
    status: "awaiting_approval",
  });
  await inserted(db, "gp_rejected", { status: "rejected" });
  await inserted(db, "gp_moment", { real: false });
  await inserted(db, "gp_other", { game: "Grand Theft Auto VI" });
  await inserted(db, "gp_empty", { result: "  " });
  const { records, refused } = await resolveTestRecords(
    db,
    [
      "gp_ok",
      "gp_ok",
      "gp_unapproved",
      "gp_rejected",
      "gp_moment",
      "gp_other",
      "gp_empty",
      "gp_nothing",
    ].map((clip) => ({
      clip,
      claim: "A claim from the entry",
    })),
    "Grand Theft Auto V",
  );
  assert.deepEqual(
    records.map((r) => r.clip),
    ["gp_ok"],
  );
  assert.equal(records[0]!.id, "T1");
  assert.equal(
    records[0]!.result,
    "It worked on the first try.",
    "the approved card's words",
  );
  assert.equal(refused.length, 7);
  assert.match(refused.join("|"), /gp_unapproved: no approved Short/);
  assert.match(refused.join("|"), /gp_rejected: no approved Short/);
  assert.match(refused.join("|"), /gp_moment: not a real test/);
  assert.match(refused.join("|"), /gp_other: shows Grand Theft Auto VI/);
  assert.match(refused.join("|"), /gp_empty: no result/);
  assert.match(refused.join("|"), /gp_ok: listed twice/);
  await db.close();
});

test("the records join the source only when there are any, and label a claim as a claim", () => {
  const art = { title: "GTA V", url: "u", text: "[Gameplay] The article." };
  assert.equal(
    withTestRecords(art, []),
    art,
    "with none, the very same source",
  );
  const text = withTestRecords(art, [REC]).text;
  assert.ok(text.startsWith("[Gameplay] The article."));
  assert.match(text, /\[Pulse Gaming test records\]/);
  assert.match(
    text,
    /T1: Claim tested: .* \| Our question: .* \| What the clip showed: The player rides/,
  );
  assert.match(testRecordsSection([REC]), /not evidence that it is true/);
});

test("a test sentence with no record behind it is caught with no model involved", () => {
  const backed =
    "We tested it: the bike tumbles off the Maze Bank rooftop into a long freefall.";
  assert.deepEqual(unbackedTestClaims(backed, [REC]), []);
  const invented =
    "We tested the police on our Xbox and they gave up after ten seconds.";
  assert.deepEqual(unbackedTestClaims(invented, [REC]), [invented]);
  // Only one shared word is not enough; ordinary history sentences are not test claims at all.
  assert.deepEqual(
    unbackedTestClaims("Our footage shows a bike.", [REC]).length,
    1,
  );
  assert.deepEqual(
    unbackedTestClaims("Rockstar released the game in 2013.", [REC]),
    [],
  );
  assert.deepEqual(
    unbackedTestClaims("We tested it and nothing happened.", []).length,
    1,
  );
});

test("unsupported sentences are cut; a quote that cannot be found loses the chapter", () => {
  const ch = chapter(
    "First line stays. The bad line goes here. Third line stays.",
    "Second paragraph stays.",
  );
  const ok = cutSentences(ch, ["the bad line goes"]);
  assert.equal(ok.lost, false);
  assert.equal(
    ok.chapter.paragraphs[0]!.narration,
    "First line stays. Third line stays.",
  );
  assert.equal(ok.chapter.paragraphs.length, 2);
  assert.equal(cutSentences(ch, []).lost, false);
  assert.equal(cutSentences(ch, ["never written anywhere"]).lost, true);
  const all = cutSentences(chapter("Only line here."), ["only line here"]);
  assert.equal(all.lost, true, "nothing left is not a chapter");
});

test("bookends lose an invented test line and keep the rest", () => {
  const b = {
    intro: {
      narration:
        "A long wait is over. We tested the swamp and it swallowed a truck.",
      on_screen: "x",
    },
    outro: {
      narration:
        "We tested it: the bike falls in a long freefall from the Maze Bank rooftop. Thanks for watching.",
      on_screen: "y",
      label: "z",
    },
  } as unknown as DocBookends;
  const { bookends, removed } = cleanBookends(b, [REC]);
  assert.equal(bookends.intro.narration, "A long wait is over.");
  assert.match(bookends.outro.narration, /Maze Bank/);
  assert.equal(removed.length, 1);
});

test("with no records the check prompt and its source are exactly what they were", async () => {
  const seen: Array<{ system: string; content: unknown }> = [];
  const llm = {
    async structured({
      system,
      content,
    }: {
      system: string;
      content: unknown;
    }) {
      seen.push({ system, content });
      return { unsupported: [{ quote: "x", problem: "y" }] };
    },
  } as unknown as Llm;
  const art = { title: "GTA V", url: "u", text: "The article." };
  const items = await checkChapterItems(
    llm,
    chapter("A line."),
    withTestRecords(art, []),
  );
  assert.deepEqual(items, [{ quote: "x", problem: "y" }]);
  assert.doesNotMatch(String(seen[0]!.content), /test records/i);
  assert.doesNotMatch(seen[0]!.system, /test records/i);
});

/** A planned documentary inside its window, for the selection tests. */
async function planned(over: {
  setting: boolean;
  evidence?: string[];
  min?: number;
}) {
  const db = await testDb();
  const data = await tmpDir();
  const runFile = path.join(data, "run.json");
  await fs.writeFile(
    runFile,
    JSON.stringify([
      {
        kind: "doc",
        date: "2026-11-21",
        slot: "17:00",
        make_hours_before: 16,
        title: "We Tested It",
        franchise: "Grand Theft Auto V",
        wiki: "Grand Theft Auto V",
        angle: "Tests",
        evidence: (over.evidence ?? []).map((clip) => ({
          clip,
          claim: "A claim",
        })),
        min_evidence: over.min,
      },
    ]),
  );
  const cfg = testConfig(data, {
    longformEnabled: true,
    docEnabled: true,
    docBreakoutPicker: false,
    docWeeks: [],
    surplusDocDays: [],
    shortRunFile: runFile,
    docTestEvidence: over.setting,
  });
  const notes: string[] = [];
  const s = {
    db,
    cfg,
    now: () => new Date("2026-11-21T02:00:00Z"),
    notify: async (m: { content?: string }) => {
      notes.push(m.content ?? "");
      return true;
    },
  } as unknown as Services;
  return { db, s, notes };
}

test("a documentary that needs tests does not run short of them, says why once, and carries its records when it runs", async () => {
  // Too few.
  const few = await planned({ setting: true, evidence: ["gp_a"], min: 2 });
  await inserted(few.db, "gp_a");
  assert.equal(await maybeSelectDocumentary(few.s), undefined);
  assert.equal(await maybeSelectDocumentary(few.s), undefined);
  assert.equal(
    few.notes.filter((n) => /will not run/.test(n)).length,
    1,
    "told once",
  );
  assert.match(few.notes[0]!, /1 usable test, 2 needed/);
  await few.db.close();
  // Setting off: never, however many tests there are.
  const off = await planned({ setting: false, evidence: ["gp_a"], min: 1 });
  await inserted(off.db, "gp_a");
  assert.equal(await maybeSelectDocumentary(off.s), undefined);
  assert.match(off.notes[0]!, /DOC_TEST_EVIDENCE is off/);
  await off.db.close();
  // Enough: the records travel with the topic.
  const ok = await planned({
    setting: true,
    evidence: ["gp_a", "gp_b"],
    min: 2,
  });
  await inserted(ok.db, "gp_a");
  await inserted(ok.db, "gp_b");
  const id = await maybeSelectDocumentary(ok.s);
  assert.ok(id);
  const ep = (await getEpisode(ok.db, id!))!;
  const topic = (
    ep.factcheck_json as unknown as { topic: { test_records: TestRecord[] } }
  ).topic;
  assert.deepEqual(
    topic.test_records.map((r) => r.id),
    ["T1", "T2"],
  );
  await ok.db.close();
});

/** A documentary episode at the writing step, with a fake model that plants one bad line in every draft. */
async function writing(over: { setting: boolean; records: TestRecord[] }) {
  const db = await testDb();
  const data = await tmpDir();
  const cfg = testConfig(data, {
    longformEnabled: true,
    docEnabled: true,
    docTestEvidence: over.setting,
    docOpenLoops: false,
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
  const checks: number[] = [];
  const sources: string[] = [];
  let chapterNo = 0;
  const llm = {
    async structured({ site, content }: { site: string; content: unknown }) {
      if (site === "doc.outline")
        return {
          question: "Q?",
          title: "We Tested It",
          description: "d",
          chapters: plans,
          open_loops: [],
        };
      if (site === "doc.chapter") {
        chapterNo++;
        return {
          claims: [],
          paragraphs: [
            para("We tested it: the bike tumbles off the Maze Bank rooftop into a long freefall."),
            para("We tested the police on our Xbox and they gave up in ten seconds."),
            para("A false fact sentence stays here. A true line stays too."),
          ],
        };
      }
      if (site === "doc.check") {
        sources.push(String(content));
        const n = checks.length;
        checks.push(n);
        // The third chapter's checks never run; every other check flags the false fact.
        if (n >= 6 && n < 9) throw new Error("model down");
        return { unsupported: [{ quote: "A false fact sentence stays here.", problem: "not in the source" }] };
      }
      if (site === "doc.shots") return { moments: [] };
      if (site === "doc.bookends")
        return {
          intro: { narration: "A long wait is over. We tested the swamp and it swallowed a truck.", on_screen: "x" },
          outro: { narration: "Thanks for watching.", on_screen: "y", label: "z" },
          description: "d",
          title: "t",
          pinned_comment: "p",
          tags: [],
        };
      throw new Error(`unexpected ${site}`);
    },
  } as unknown as Llm;
  const s = {
    db,
    cfg,
    llm,
    now: () => new Date("2026-11-21T02:00:00Z"),
    notify: async () => true,
    research: async () => ({ title: "GTA V", url: "https://en.wikipedia.org/wiki/GTA_V", text: "[Gameplay] A true line stays too." }),
  } as unknown as Services;
  const topic = {
    kind: "story",
    franchise_index: -1,
    story_index: -1,
    title_idea: "We Tested It",
    angle: "a",
    reason: "r",
    franchise: "Grand Theft Auto V",
    wiki: "Grand Theft Auto V",
    test_records: over.records,
  };
  await db.query(
    `INSERT INTO episodes (id, story_hash, status, story_json, lane, factcheck_json)
     VALUES ('ep_doc', 'documentary:x', 'selected', $1, 'longform', $2)`,
    [
      JSON.stringify({ headline: "We Tested It", items: [], sources: [], hash: "documentary:x", gameHint: "Grand Theft Auto V" }),
      JSON.stringify({ doc: true, topic }),
    ],
  );
  await advance(s, (await getEpisode(db, "ep_doc"))!);
  const ep = (await getEpisode(db, "ep_doc"))!;
  return { db, ep, checks, sources, chapters: () => chapterNo };
}

test("with records, a check that never ran loses its chapter and every unsupported or unbacked line is cut", async () => {
  const { db, ep, sources } = await writing({ setting: true, records: [REC] });
  assert.equal(ep.status, "scripted", ep.last_error ?? "");
  const said = JSON.stringify(ep.script_json);
  assert.match(said, /Maze Bank rooftop/, "the backed line stays");
  assert.match(said, /A true line stays too/);
  assert.doesNotMatch(said, /A false fact sentence/, "unsupported after the rewrites: cut");
  assert.doesNotMatch(said, /gave up in ten seconds/, "an invented test: cut with no model's say");
  assert.doesNotMatch(said, /swallowed a truck/, "an invented test in the intro: cut");
  const warnings = (ep.factcheck_json as unknown as { warnings: string[] }).warnings.join("|");
  assert.match(warnings, /the fact check could not run/);
  assert.match(warnings, /unsupported lines? cut/);
  assert.equal((ep.script_json!.entries ?? []).length, 5, "five of six chapters: the unchecked one is gone");
  assert.match(sources[0]!, /Pulse Gaming test records/);
  await db.close();
});

test("with no records, or with the setting off, the documentary is written and checked exactly as before", async () => {
  for (const over of [
    { setting: true, records: [] as TestRecord[] },
    { setting: false, records: [REC] },
  ]) {
    const { db, ep, sources } = await writing(over);
    assert.equal(ep.status, "scripted", ep.last_error ?? "");
    const said = JSON.stringify(ep.script_json);
    assert.match(said, /A false fact sentence/, "kept with a warning, as today");
    assert.match(said, /gave up in ten seconds/);
    assert.equal((ep.script_json!.entries ?? []).length, 6, "a check that failed keeps its chapter, as today");
    assert.doesNotMatch(sources[0]!, /test records/i, "a source untouched by records");
    assert.doesNotMatch(JSON.stringify(ep.factcheck_json), /could not run/);
    await db.close();
  }
});
