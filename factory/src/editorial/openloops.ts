// Open loops and their payoffs (creator study, 31 Oct 2026, no. 82; LEMMiNO's mysteries): a documentary that
// raises two to four questions early and answers each one later gives the viewer a reason to stay past the
// points where they would drift off. Re-hooks (src/editorial/rehooks.ts) already tease what is coming; this
// is the bookkeeping that makes the teases into promises that are kept.
//
// How it works, with no new model call:
//  - the outline call (doc.outline, already medium effort) lists the loops: a question, the chapter that
//    raises it (0 is the cold open) and the later chapter that answers it (OPEN_LOOP_RULE);
//  - groundOpenLoops keeps only loops that can work (a real question, answered at least a chapter later,
//    spread out), so a bad plan never reaches the writer;
//  - each chapter call (doc.chapter) and the bookends call get a line or two saying what to plant or pay off
//    (loopBrief), and loopProblems sends a chapter back when the plant or the payoff sentence is missing,
//    through the existing rewrite loop;
//  - placeOpenLoops pins each loop to the sentence that raises it and the sentence that answers it, so the
//    render can recall the earlier shot when the answer comes (src/render/structure.ts callbackCues).
// A documentary written before this existed gets its loops from its own text (deriveOpenLoops): a question
// the narrator asks, matched to a later sentence that answers it in the same words.
//
// The matching is a word-overlap heuristic by design: the writer is told to reuse the question's key words,
// so the overlap is reliable, and a miss costs a rewrite, a warning or a cue that is not shown, never the video.

import { z } from "zod";
import { advertiserProblems } from "./voice.ts";
import { isRehook, quotedSentences } from "./rehooks.ts";

export const OPEN_LOOPS_MIN = 2;
export const OPEN_LOOPS_MAX = 4;
const QUESTION_WORDS_MIN = 4;
const QUESTION_WORDS_MAX = 18;

export const OpenLoopSchema = z.object({
  question: z
    .string()
    .describe(
      "The question as a viewer would ask it, 5-16 words, ending in a question mark, e.g. 'Why did a cop game end up as a crime game?'",
    ),
  plant_chapter: z
    .number()
    .int()
    .describe(
      "Where it is first raised: 0 for the cold open, else the chapter number (1 is the first chapter)",
    ),
  payoff_chapter: z
    .number()
    .int()
    .describe("The later chapter number that answers it, never chapter 1"),
});
export type OpenLoop = z.infer<typeof OpenLoopSchema>;

/** The outline prompt's rule, so the planner and the tests agree on it. */
export const OPEN_LOOP_RULE = `Open loops: in "open_loops" list ${OPEN_LOOPS_MIN}-${OPEN_LOOPS_MAX} questions this documentary raises early and answers later, the way the best documentaries keep a viewer watching. Each is one short question a viewer would ask (5-16 words, ending in a question mark) about something the sources can answer for certain, never a rumour. plant_chapter is where it is first raised (0 for the cold open, else the chapter number); payoff_chapter is the later chapter that answers it, at least one chapter after it is raised and never chapter 1. Spread them out: at most one raised and one answered in any chapter (the cold open may raise two).`;

export interface OpenLoopGrounding {
  loops: OpenLoop[];
  removed: string[];
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The loops a documentary keeps (pure): a real question of 4-18 words, raised in the cold open or a chapter
 * and answered in a later chapter (never the first: a payoff that close is no loop), advertiser-friendly,
 * no question twice, at most one raised and one answered per chapter (the cold open may raise two), and
 * OPEN_LOOPS_MAX in all, in the order they are raised. `chapters` is the outline's chapter count.
 */
export function groundOpenLoops(
  loops: readonly OpenLoop[] | undefined,
  chapters: number,
): OpenLoopGrounding {
  const removed: string[] = [];
  const kept: OpenLoop[] = [];
  const planted = new Map<number, number>();
  const paid = new Set<number>();
  const seen = new Set<string>();
  const sorted = [...(loops ?? [])].sort(
    (a, b) =>
      a.plant_chapter - b.plant_chapter || a.payoff_chapter - b.payoff_chapter,
  );
  for (const l of sorted) {
    const q = l.question.trim();
    const n = words(q).length;
    const why = !q.endsWith("?")
      ? "not a question"
      : n < QUESTION_WORDS_MIN || n > QUESTION_WORDS_MAX
        ? `${n} words`
        : advertiserProblems(q).length
          ? "advertiser-unfriendly"
          : l.plant_chapter < 0 || l.plant_chapter >= chapters
            ? `raised in chapter ${l.plant_chapter} of ${chapters}`
            : l.payoff_chapter < 2 ||
                l.payoff_chapter > chapters ||
                l.payoff_chapter <= l.plant_chapter
              ? `answered in chapter ${l.payoff_chapter}, too soon or out of range`
              : seen.has(norm(q))
                ? "asked twice"
                : (planted.get(l.plant_chapter) ?? 0) >=
                    (l.plant_chapter === 0 ? 2 : 1)
                  ? `chapter ${l.plant_chapter} already raises one`
                  : paid.has(l.payoff_chapter)
                    ? `chapter ${l.payoff_chapter} already answers one`
                    : kept.length >= OPEN_LOOPS_MAX
                      ? "too many"
                      : "";
    if (why) {
      removed.push(`open loop "${q}": ${why}`);
      continue;
    }
    seen.add(norm(q));
    planted.set(l.plant_chapter, (planted.get(l.plant_chapter) ?? 0) + 1);
    paid.add(l.payoff_chapter);
    kept.push({ ...l, question: q });
  }
  return { loops: kept, removed };
}

const where = (chapter: number) =>
  chapter === 0 ? "the cold open" : `chapter ${chapter}`;

/**
 * The lines a chapter's brief gets (pure): what to raise here and what to answer here. `chapter` is the
 * chapter number (1 is the first); 0 asks for the cold open's lines (the bookends call). Empty when the
 * chapter has nothing to do.
 */
export function loopBrief(loops: readonly OpenLoop[], chapter: number): string {
  const lines: string[] = [];
  for (const l of loops) {
    if (l.plant_chapter === chapter)
      lines.push(
        `- Raise this open question${chapter === 0 ? " in the cold open" : " in this chapter"}, in your own words but keeping its key words, and do not answer it here (${where(l.payoff_chapter)} answers it): "${l.question}"`,
      );
    if (chapter > 0 && l.payoff_chapter === chapter)
      lines.push(
        `- ${where(l.plant_chapter)[0]!.toUpperCase()}${where(l.plant_chapter).slice(1)} raised this question; answer it in this chapter in one plain sentence that keeps the question's key words and gives the answer from the SOURCE (if the SOURCE cannot answer it, leave it unanswered rather than guess): "${l.question}"`,
      );
  }
  return lines.length
    ? `Open loops (questions the documentary raises and later answers):\n${lines.join("\n")}`
    : "";
}

// Words too common to tie a question to its answer.
const STOP = new Set(
  "about after again also because been before being could does doing done during each even every from game games have having here into just last later made make many more most much never only other over really same should since some still such than that their them then there these they thing this those through time under until very want was were what when where which while who whom whose why will with would years year your how did does the and for are but not you can its it's out one two all any had has him her his our off too way well went goes going come came take took back began start started story part first".split(
    " ",
  ),
);

/** A word reduced to a rough stem, so "deadline" meets "deadlines" and "finish" meets "finished". */
function stem(w: string): string {
  const s = w.replace(/(ing|ed|es|s|ly)$/, "");
  return (s.length >= 4 ? s : w).slice(0, 6);
}

/** The telling words of a text, stemmed: names, numbers and content words of four letters or more. */
export function loopTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^a-z0-9$]+/)) {
    if (!raw) continue;
    if (/^\$?\d/.test(raw)) {
      out.add(raw.replace(/^\$/, ""));
      continue;
    }
    if (raw.length < 4 || STOP.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** The names and figures of a text, stemmed like loopTokens: capitalised words past its first, and numbers. */
export function nameTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const [i, raw] of text
    .replace(/[’']s\b/g, "")
    .split(/\s+/)
    .entries()) {
    const w = raw.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9]+$/g, "");
    if (/^\$?\d/.test(w)) out.add(w.replace(/^\$/, "").toLowerCase());
    else if (i > 0 && /^[A-Z]/.test(w) && w.length >= 3) {
      const l = w.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!STOP.has(l)) out.add(l.length >= 4 ? stem(l) : l);
    }
  }
  return out;
}

const shared = (a: Set<string>, b: Set<string>) =>
  [...a].filter((t) => b.has(t)).length;
/** How many telling words a sentence must share with the question: two, or two fifths of a long question's. */
const needed = (q: Set<string>) => Math.max(2, Math.ceil(q.size * 0.4));

/**
 * How well a sentence matches a question: the telling words they share, or 0 when that is too few, or when
 * the question names someone or something (a name or a figure) and the sentence names none of it.
 */
export function loopMatch(question: string, sentence: string): number {
  const q = loopTokens(question);
  const s = shared(q, loopTokens(sentence));
  if (s < needed(q)) return 0;
  const names = nameTokens(question);
  if (names.size) {
    const theirs = new Set([...nameTokens(sentence), ...loopTokens(sentence)]);
    if (![...names].some((n) => theirs.has(n))) return 0;
  }
  return s;
}

/** Whether a sentence raises something: a question in the narrator's own words or a tease (rehooks.ts). */
function raises(sentence: string, inQuote: boolean): boolean {
  return isRehook(sentence, inQuote) || (!inQuote && /\?\s*$/.test(sentence));
}

/** A cold-open line that promises an explanation ("This is the story of how ..."), a plant too. */
const PROMISE = /\b(story of (how|why)|(how|why) (it|they|he|she|a|an|the)\b)/i;

/**
 * The sentence (index) that raises a question: one that asks or teases, sharing enough of its telling words;
 * the best match, the earliest on a tie. -1 when none does. `promises` also counts a line that promises the
 * explanation ("the story of how..."), which is how a cold open raises a question.
 */
export function findPlant(
  question: string,
  sentences: readonly string[],
  promises = false,
): number {
  let best = -1;
  let score = 0;
  for (const [i, x] of quoteFlags(sentences).entries()) {
    if (
      !raises(x.text, x.inQuote) &&
      !(promises && !x.inQuote && PROMISE.test(x.text))
    )
      continue;
    const s = loopMatch(question, x.text);
    if (s > score) {
      best = i;
      score = s;
    }
  }
  return best;
}

/**
 * The sentence (index) that answers a question: a plain statement (not a question, not a tease) sharing
 * enough of its telling words; the best match, the earliest on a tie. -1 when none does.
 */
export function findPayoff(
  question: string,
  sentences: readonly string[],
): number {
  let best = -1;
  let score = 0;
  for (const [i, x] of quoteFlags(sentences).entries()) {
    // Someone else's words (a quotation, or a sentence inside one) never answer for the narrator.
    if (x.inQuote || /^["“]/.test(x.text) || raises(x.text, false)) continue;
    const s = loopMatch(question, x.text);
    if (s > score) {
      best = i;
      score = s;
    }
  }
  return best;
}

/** Each sentence with whether it starts inside a quotation, carried across the list. */
function quoteFlags(
  sentences: readonly string[],
): Array<{ text: string; inQuote: boolean }> {
  // Each sentence as given (the indices are the shot list's), flagged when a quotation opened before it.
  let open = false;
  return sentences.map((text) => {
    const inQuote = open;
    for (const ch of text) {
      if (ch === "“") open = true;
      else if (ch === "”") open = false;
      else if (ch === '"') open = !open;
    }
    return { text, inQuote };
  });
}

/**
 * A chapter's open-loop problems, as instructions its rewrite can follow (pure): the question it should raise
 * and does not, the question it should answer and does not. `chapter` is the chapter number (0: the cold open).
 */
export function loopProblems(
  sentences: readonly string[],
  loops: readonly OpenLoop[],
  chapter: number,
): string[] {
  const p: string[] = [];
  for (const l of loops) {
    if (
      l.plant_chapter === chapter &&
      findPlant(l.question, sentences, chapter === 0) < 0
    )
      p.push(
        `Raise the open question "${l.question}" as a line that asks or teases it, keeping its key words, without answering it yet.`,
      );
    if (
      chapter > 0 &&
      l.payoff_chapter === chapter &&
      findPayoff(l.question, sentences) < 0
    )
      p.push(
        `Answer the question raised earlier, "${l.question}", in one plain sentence that keeps its key words and gives the answer from the source.`,
      );
  }
  return p;
}

/** Where a loop sits in the finished script: entry -1 is the cold open (the hook), moment the sentence index. */
export interface LoopPlacement {
  question: string;
  plant: { entry: number; moment: number };
  payoff: { entry: number; moment: number };
}

/**
 * Pins each grounded loop to its sentences (pure): the plant in the cold open (`hook`, its sentences) or its
 * chapter, the payoff in its chapter (`chapters`, each chapter's sentences in shot-list order). A loop whose
 * plant or payoff cannot be found is dropped and named in `removed`, so no cue points at nothing.
 */
export function placeOpenLoops(
  loops: readonly OpenLoop[],
  hook: readonly string[],
  chapters: ReadonlyArray<readonly string[]>,
): { placed: LoopPlacement[]; removed: string[] } {
  const placed: LoopPlacement[] = [];
  const removed: string[] = [];
  for (const l of loops) {
    const plantIn =
      l.plant_chapter === 0 ? hook : (chapters[l.plant_chapter - 1] ?? []);
    const plant = findPlant(l.question, plantIn, l.plant_chapter === 0);
    const payoff = findPayoff(l.question, chapters[l.payoff_chapter - 1] ?? []);
    if (plant < 0 || payoff < 0) {
      removed.push(
        `open loop "${l.question}": ${plant < 0 ? "never raised" : "never answered"}`,
      );
      continue;
    }
    placed.push({
      question: l.question,
      plant: { entry: l.plant_chapter - 1, moment: plant },
      payoff: { entry: l.payoff_chapter - 1, moment: payoff },
    });
  }
  return { placed, removed };
}

/**
 * A raising line as the recall card shows it: a question as it is; a cold open's promise as the "how" or
 * "why" it promises ("It's also the story of why it went home to Vice City." reads "Why it went home to
 * Vice City").
 */
export function asQuestion(sentence: string): string {
  const s = sentence.trim();
  if (/\?\s*$/.test(s)) return s;
  const m = s.match(/\b(how|why)\b[^.!?]*/i);
  if (!m) return s;
  const clause = m[0].trim().replace(/[\s,;:]+$/, "");
  return clause[0]!.toUpperCase() + clause.slice(1);
}

/**
 * The loops a script already holds, for a documentary written before the outline listed them (pure): each
 * question the narrator asks (or, in the cold open, each promise of a "how" or "why"), outside the last
 * chapter, paired with the best-matching plain sentence at least one chapter later. At most one loop raised
 * per chapter (two in the cold open), one answer per chapter, OPEN_LOOPS_MAX in all, strongest first, then
 * listed in the order they are raised.
 */
export function deriveOpenLoops(
  hook: readonly string[],
  chapters: ReadonlyArray<readonly string[]>,
): LoopPlacement[] {
  type Candidate = LoopPlacement & { score: number };
  const found: Candidate[] = [];
  const passages: Array<{ entry: number; sentences: readonly string[] }> = [
    { entry: -1, sentences: hook },
    ...chapters.slice(0, -1).map((sentences, e) => ({ entry: e, sentences })),
  ];
  for (const p of passages)
    for (const [k, x] of quoteFlags(p.sentences).entries()) {
      const asks = !x.inQuote && /\?\s*$/.test(x.text);
      const promise =
        p.entry === -1 &&
        !x.inQuote &&
        (raises(x.text, false) || PROMISE.test(x.text));
      if (!asks && !promise) continue;
      const q = loopTokens(x.text);
      if (q.size < 2) continue;
      let best: { entry: number; moment: number; score: number } | undefined;
      // A question in the cold open is answered from the second chapter on; one in a chapter, a chapter later.
      // On a tie a cold-open question takes the latest answer (it is the documentary's spine, answered at the
      // end) and a chapter's question the nearest (it is local).
      for (let e = Math.max(1, p.entry + 1); e < chapters.length; e++) {
        const m = findPayoff(x.text, chapters[e]!);
        if (m < 0) continue;
        const score = loopMatch(x.text, chapters[e]![m]!);
        if (
          !best ||
          score > best.score ||
          (score === best.score && p.entry === -1)
        )
          best = { entry: e, moment: m, score };
      }
      if (best)
        found.push({
          question: asQuestion(x.text),
          plant: { entry: p.entry, moment: k },
          payoff: { entry: best.entry, moment: best.moment },
          score: best.score,
        });
    }
  const planted = new Map<number, number>();
  const paid = new Set<number>();
  const kept: Candidate[] = [];
  for (const c of [...found].sort((a, b) => b.score - a.score)) {
    if (kept.length >= OPEN_LOOPS_MAX) break;
    if ((planted.get(c.plant.entry) ?? 0) >= (c.plant.entry === -1 ? 2 : 1))
      continue;
    if (paid.has(c.payoff.entry)) continue;
    planted.set(c.plant.entry, (planted.get(c.plant.entry) ?? 0) + 1);
    paid.add(c.payoff.entry);
    kept.push(c);
  }
  return kept
    .sort(
      (a, b) =>
        a.plant.entry - b.plant.entry || a.plant.moment - b.plant.moment,
    )
    .map(({ score: _score, ...l }) => l);
}

/**
 * The bookend ending's check (creator study no. 84, LEMMiNO and Fern): the outro's last two sentences must
 * return to the cold open's first image, naming one of the names, places or numbers of the intro's first
 * sentence, so the documentary ends where it began. Returns the problem as an instruction, or nothing.
 */
export function bookendEchoProblems(intro: string, outro: string): string[] {
  const first = quotedSentences(intro)[0]?.text ?? "";
  const anchors = anchorsOf(first);
  if (!anchors.size) return [];
  const last = quotedSentences(outro)
    .slice(-2)
    .map((x) => x.text)
    .join(" ");
  const close = anchorsOf(last, true);
  if ([...anchors].some((a) => close.has(a))) return [];
  return [
    `The outro must end where the documentary began: let its last two sentences return to the cold open's first image, naming ${[...anchors].slice(0, 3).join(", ")} or another detail of the intro's first sentence.`,
  ];
}

/** The names, places and figures of a sentence: capitalised words past its first, and numbers. */
function anchorsOf(sentence: string, anyCapital = false): Set<string> {
  const out = new Set<string>();
  const toks = sentence.split(/\s+/).filter(Boolean);
  for (const [i, raw] of toks.entries()) {
    const t = raw
      .replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9]+$/g, "")
      .replace(/[’']s$/, "");
    if (!t) continue;
    if (/^\$?\d[\d,.]*$/.test(t)) {
      out.add(t.replace(/[$,]/g, ""));
      continue;
    }
    const capital = /^[A-Z]/.test(t);
    if (!capital || (!anyCapital && i === 0) || t.length < 3) continue;
    if (
      /^(The|This|That|These|Those|And|But|Its|His|Her|Their|When|Then|In|On|At|By|For)$/.test(
        t,
      )
    )
      continue;
    out.add(t.toLowerCase());
  }
  return out;
}

/** What the open loops came to in one documentary, in plain English for the owner (one line). */
export function openLoopsLine(
  title: string,
  placed: readonly LoopPlacement[],
  planned: number,
): string {
  if (!placed.length)
    return `Open loops for "${title}": ${planned ? `${planned} planned, none made it into the script` : "the outline planned none"}, so no callbacks this time.`;
  const where = (e: number) => (e < 0 ? "the cold open" : `chapter ${e + 1}`);
  return `Open loops for "${title}": ${placed.length} question${placed.length === 1 ? "" : "s"} raised early and answered later (${placed
    .map(
      (l) =>
        `"${l.question}" from ${where(l.plant.entry)} to ${where(l.payoff.entry)}`,
    )
    .join("; ")}).`;
}
