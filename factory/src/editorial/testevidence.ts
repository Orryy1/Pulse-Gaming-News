// Our own test results as a source for a documentary (DOC_TEST_EVIDENCE, off by default; launch plan, part 2: "We
// tested GTA 6's biggest claims on launch day"). A documentary is fact-checked against Wikipedia, and what the owner's
// Xbox clip showed last night is not in Wikipedia. So a run entry names approved clips, each with the pre-launch claim
// it tests, and for that documentary alone the records join the source the outline, the writer and the checker read.
//
// A record is not free text. It is the result on the Discord card the owner tapped Approve on, so a clip that was not
// approved, is not a real test or shows another game gives no record. The claim being tested is labelled as a claim,
// never as evidence. A documentary with records is also held to a stricter check than the others, whose behaviour is
// untouched: a fact check that could not run counts as a failure, a sentence still unsupported after the rewrites is
// cut rather than kept with a warning, and any "we tested" sentence must match a record whatever the model says.

import type { Db } from "../db.ts";
import type { WikiArticle } from "../discovery/wikipedia.ts";
import { sameGame } from "../assets/steam.ts";
import { sentencesOf } from "./longform.ts";
import type { DocBookends, DocChapter } from "./documentary.ts";

export interface TestRecord {
  id: string; // T1, T2... in the order the entry lists them
  clip: string; // the gameplay inbox id
  game: string;
  claim: string; // what is being tested: from the entry, not evidence
  question: string;
  result: string; // what the clip showed: the approved card's words
  youtube_id?: string;
}

/** What a run entry lists: an inbox clip and the claim it tests. */
export interface TestEvidenceRef {
  clip: string;
  claim: string;
}

interface Row {
  id: string;
  script_json: {
    game_title?: string;
    gameplay?: {
      inbox_id?: string;
      question?: string;
      result?: string;
      real_test?: boolean;
    };
  } | null;
  youtube_video_id: string | null;
}

/**
 * The records an entry's clips earn. A clip counts only when its Short was approved by a person and not rejected
 * since, is a real test by the reviewer's reading and is of the documentary's own game. The rest are returned too,
 * with the reason, so nobody wonders where a test went.
 */
export async function resolveTestRecords(
  db: Db,
  refs: TestEvidenceRef[],
  game: string,
): Promise<{ records: TestRecord[]; refused: string[] }> {
  const records: TestRecord[] = [];
  const refused: string[] = [];
  for (const ref of refs) {
    const rows = await db.query<Row>(
      `SELECT id, script_json, youtube_video_id FROM episodes
        WHERE lane = 'gameplay' AND script_json->'gameplay'->>'inbox_id' = $1
          AND approved_by IS NOT NULL AND status NOT IN ('rejected','failed')
        ORDER BY created_at DESC LIMIT 1`,
      [ref.clip],
    );
    const g = rows[0]?.script_json?.gameplay;
    const title = rows[0]?.script_json?.game_title ?? "";
    if (!g) refused.push(`${ref.clip}: no approved Short`);
    else if (!g.real_test) refused.push(`${ref.clip}: not a real test`);
    else if (!g.result?.trim() || !g.question?.trim())
      refused.push(`${ref.clip}: no result on record`);
    else if (!sameGame(title, game))
      refused.push(`${ref.clip}: shows ${title}, not ${game}`);
    else if (records.some((r) => r.clip === ref.clip))
      refused.push(`${ref.clip}: listed twice`);
    else
      records.push({
        id: `T${records.length + 1}`,
        clip: ref.clip,
        game: title,
        claim: ref.claim,
        question: g.question,
        result: g.result.trim(),
        ...(rows[0]?.youtube_video_id
          ? { youtube_id: rows[0].youtube_video_id }
          : {}),
      });
  }
  return { records, refused };
}

/** The records as one section of a source, carrying its own rule so the reader needs no other prompt. */
export function testRecordsSection(records: TestRecord[]): string {
  return [
    "[Pulse Gaming test records]",
    "Our own tests, recorded on Xbox Series X and approved by the person who played them. Each one supports only what it says that clip showed. It supports no general claim about the game, no number it does not give and no other test. A sentence saying we tested or found something needs a record here that says so. 'Claim tested' is the question being asked, not evidence that it is true.",
    ...records.map(
      (r) =>
        `${r.id}: Claim tested: ${r.claim} | Our question: ${r.question} | What the clip showed: ${r.result}`,
    ),
  ].join("\n");
}

/** What the outline is told so the video is built on the tests rather than the game's history with a test bolted on. */
export function testOutlineNote(records: TestRecord[]): string {
  return [
    "",
    "",
    `PLAN THIS DOCUMENTARY AROUND THE TESTS, not the game's history: one chapter for each of the ${records.length} test records below, in the order that builds best, with the strongest result last. Each chapter's title names what was tested, its wiki_title is this game's own article and its focus is that record's claim and what the clip showed. Time order does not apply. Do not add history chapters, unless there are under five records: then add only enough to reach five, each on what the tests could not settle and what the game's article says about it.`,
  ].join("\n");
}

/** The source a documentary with records reads: the article, then the records. */
export function withTestRecords(
  article: WikiArticle,
  records: TestRecord[],
): WikiArticle {
  return records.length
    ? {
        ...article,
        text: `${article.text}\n\n${testRecordsSection(records)}`,
      }
    : article;
}

// A sentence reporting our own test: this is what must rest on a record.
const TEST_CLAIM =
  /\b(we|our)\b[^.?!]*\b(tests?|tested|testing|tried|try|found|filmed|recorded|checked|played|ran|run)\b|\b(tested|tried) (it|this|that)\b|\bon (our|his|the owner's) xbox\b|\bour (clip|footage|run|attempt|result)s?\b/i;

// A sentence about what our tests cannot show claims nothing ("Our tests can't tell you how the map was laid out").
const TEST_LIMIT = /\b(can'?t|cannot|can not|won'?t|doesn'?t|don'?t|didn'?t)\s+(tell|prove|show|say|answer)\b/i;

const STOP = new Set(
  "the a an and or but of to in on at for with from by is are was were be been it its this that these those you your we our they them their he his she her as if so not no yes can could will would do does did have has had how what when where why who which then than there here into out up down off over about after before just very more most".split(
    " ",
  ),
);

function words(text: string, game: string): Set<string> {
  const own = new Set(game.toLowerCase().split(/\W+/));
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/'s$/, ""))
      .filter((w) => w.length > 2 && !STOP.has(w) && !own.has(w)),
  );
}

/** Whether a test sentence has a record behind it: at least two words of substance shared with one record's question or result. */
function backedBy(sentence: string, records: TestRecord[]): boolean {
  return records.some((r) => {
    const said = words(sentence, r.game);
    const rec = words(`${r.question} ${r.result}`, r.game);
    let shared = 0;
    for (const w of said) if (rec.has(w)) shared++;
    return shared >= 2;
  });
}

/** Sentences that report a test of ours with no record behind them; no model involved, so no model can wave one through. */
export function unbackedTestClaims(
  text: string,
  records: TestRecord[],
): string[] {
  return sentencesOf(text).filter(
    (s) => TEST_CLAIM.test(s) && !TEST_LIMIT.test(s) && !backedBy(s, records),
  );
}

/** Takes out every sentence holding one of the quotes. `lost` when a quote could not be found or nothing would be left. */
export function cutSentences(
  chapter: DocChapter,
  quotes: string[],
): { chapter: DocChapter; lost: boolean } {
  const fold = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const wanted = quotes.map(fold).filter(Boolean);
  const found = new Set<string>();
  const paragraphs = chapter.paragraphs
    .map((p) => ({
      ...p,
      narration: sentencesOf(p.narration)
        .filter((s) => {
          const hit = wanted.filter(
            (q) => fold(s).includes(q) || q.includes(fold(s)),
          );
          hit.forEach((q) => found.add(q));
          return !hit.length;
        })
        .join(" "),
    }))
    .filter((p) => p.narration.trim());
  return {
    chapter: { ...chapter, paragraphs },
    lost: found.size < wanted.length || !paragraphs.length,
  };
}

/** The bookends' spoken lines with unbacked test claims taken out. They are written from the checked chapters and have no check of their own. */
export function cleanBookends(
  b: DocBookends,
  records: TestRecord[],
): { bookends: DocBookends; removed: string[] } {
  const removed: string[] = [];
  const clean = (text: string) => {
    const bad = unbackedTestClaims(text, records);
    removed.push(...bad);
    return sentencesOf(text)
      .filter((s) => !bad.includes(s))
      .join(" ");
  };
  return {
    bookends: {
      ...b,
      intro: { ...b.intro, narration: clean(b.intro.narration) },
      outro: { ...b.outro, narration: clean(b.outro.narration) },
    },
    removed,
  };
}
