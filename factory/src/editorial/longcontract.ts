// The long-video opening contract (Top creator gap plan, gap 3, 18 Nov 2026). Pulse's long videos are watched for about
// 18% of their length; "Why San Andreas Never Got a Sequel" kept 63% at 36 s and 32% at 3 minutes. Their openings ran
// 122 to 129 words, began on a buyer's line that did not match the title ("a familiar city can mislead your next
// purchase", on a history documentary: the LONG_HOOK_STACK stakes rule asks for "the viewer's own money, time, habits or
// first evening with the game" in the first two sentences), reached the real question at 11 to 18 s and the first
// chapter at 46 to 54 s. The long videos that hold state the title's question inside 90 s, plant one finish line early
// and pay it in the last stretch, open on a real dated voice where one exists, hand chapters over by contrast and let
// the narrator say what he thinks.
//
// LONG_OPENING_CONTRACT=off|check|fix (default off). "check" measures a finished script and records what passes and
// why on the episode, changing nothing. "fix" also gives the writers these rules and sends a missed opening back to
// its writer once with the reasons, then accepts it with a note; a slot is never held up.
//
// Every count here is pure and reads the script as written; the model is used only for judgement (whether the first
// line and the question serve the title, and whether chapter hand-overs contrast), in one cheap call a video.

import { z } from "zod";
import type { Llm } from "./llm.ts";
import type { Script } from "./schema.ts";
import { sentencesOf } from "./longform.ts";
import { loopTokens } from "./openloops.ts";
import { outsideQuotes } from "./voice.ts";

export type ContractMode = "off" | "check" | "fix";
export const CONTRACT_MODES: ContractMode[] = ["off", "check", "fix"];

/** A mode as read from the environment: anything unknown is "off". */
export function contractMode(v: string | undefined): ContractMode {
  const m = (v ?? "").trim().toLowerCase();
  return (CONTRACT_MODES as string[]).includes(m) ? (m as ContractMode) : "off";
}

/** Spoken words a minute, for timing a script before it is voiced (the November long videos ran at 152 to 154). */
export const LONG_WPM = 150;
/** The title's question is said by this word (about 15 s). */
export const QUESTION_BY_WORDS = 40;
/** The opening before the first chapter, at most, in words. */
export const OPENING_WORDS_MAX = 90;
/** With a quoted primary source in it, the opening may run this long. */
export const OPENING_QUOTE_WORDS_MAX = 140;
/** The finish line is planted before this second. */
export const FINISH_PLANT_SECONDS = 90;
/** ...and paid after this share of the runtime (the last 15%). */
export const FINISH_PAY_SHARE = 0.85;
/** Where the source has a dated quote, the opening says it inside this many seconds. */
export const QUOTE_WITHIN_SECONDS = 30;
/** Honest first-person takes in every documentary chapter. */
export const TAKES_PER_CHAPTER = 2;

const wordsIn = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const wc = (t: string) => wordsIn(t).length;

// ---------------------------------------------------------------- the script, as the contract reads it

export type LongDocKind =
  | "documentary"
  | "guide"
  | "ranking"
  | "claims"
  | "other";

/** One long video as the checks read it: an opening, its chapters (a ranking's entries) and an outro. */
export interface LongDoc {
  title: string;
  kind: LongDocKind;
  /** Everything said before the first chapter (the cold open). */
  hook: string;
  chapters: Array<{ title: string; text: string; rank?: number }>;
  outro: string;
  thumbText?: string;
  /** Pinned open loops (entry -1 is the hook; moment indexes the entry's sentences). */
  loops?: Array<{
    question: string;
    plant: { entry: number; moment: number };
    payoff: { entry: number; moment: number };
    finish?: boolean;
  }>;
  /** Start second of every spoken word, from the voice's word timings, when there is a voice. */
  times?: number[];
}

/** Every spoken part in order: the hook, each chapter, the outro. */
export function partsOf(d: LongDoc): string[] {
  return [d.hook, ...d.chapters.map((c) => c.text), d.outro];
}

/** Words in the whole script. */
export function docWords(d: LongDoc): number {
  return partsOf(d).reduce((n, p) => n + wc(p), 0);
}

/**
 * The second a word is spoken (pure). With word timings the index is mapped proportionally onto them (the speech
 * recogniser's count differs a little from the script's); without, LONG_WPM.
 */
export function secondsAt(d: LongDoc, wordIndex: number): number {
  const n = docWords(d);
  const t = d.times;
  if (t && t.length > 1 && n > 1) {
    const k = Math.min(
      t.length - 1,
      Math.max(0, Math.round((wordIndex * (t.length - 1)) / (n - 1))),
    );
    return t[k]!;
  }
  return (wordIndex * 60) / LONG_WPM;
}

/** The whole runtime in seconds (to the last word). */
export function docSeconds(d: LongDoc): number {
  const t = d.times;
  if (t && t.length) return t[t.length - 1]!;
  return (docWords(d) * 60) / LONG_WPM;
}

/** The word index where a part starts (0 is the hook, 1 the first chapter, last the outro). */
export function partStart(d: LongDoc, part: number): number {
  return partsOf(d)
    .slice(0, part)
    .reduce((n, p) => n + wc(p), 0);
}

/** The word index where one sentence of a part starts (entry -1 is the hook, as loops count it). */
export function sentenceStart(
  d: LongDoc,
  entry: number,
  moment: number,
): number {
  const part = entry + 1;
  const text = partsOf(d)[part] ?? "";
  const before = sentencesOf(text)
    .slice(0, Math.max(0, moment))
    .reduce((n, s) => n + wc(s), 0);
  return partStart(d, part) + before;
}

/**
 * A stored script as the contract reads it (pure). A documentary's chapters start at its "chapter" beats; a ranking's
 * entries are its "rank" beats, lowest first. `words` are the voice's word timings when the video was voiced.
 */
export function longDocOfScript(
  s: Script,
  o: { kind?: LongDocKind; words?: ReadonlyArray<{ start: number }> } = {},
): LongDoc {
  const ranking = s.beats.some((b) => b.visual?.kind === "rank");
  const chapters: LongDoc["chapters"] = [];
  for (const b of s.beats) {
    const v = b.visual;
    if (ranking) {
      chapters.push({
        title: v?.primary ?? "",
        text: b.narration,
        rank: v?.value_a,
      });
      continue;
    }
    if (v?.kind === "chapter" || !chapters.length)
      chapters.push({ title: v?.primary ?? "", text: "" });
    const c = chapters[chapters.length - 1]!;
    c.text = c.text ? `${c.text} ${b.narration}` : b.narration;
  }
  const loops = (s.open_loops ?? []) as NonNullable<LongDoc["loops"]>;
  return {
    title: s.youtube?.title || s.headline || "",
    kind: o.kind ?? (ranking ? "ranking" : "documentary"),
    hook: s.hook ?? "",
    chapters,
    outro: s.pulse_take?.narration ?? "",
    ...(s.youtube?.thumb_text ? { thumbText: s.youtube.thumb_text } : {}),
    ...(loops.length ? { loops } : {}),
    ...(o.words?.length ? { times: o.words.map((w) => w.start) } : {}),
  };
}

// ---------------------------------------------------------------- 1. the first sentence

/** Purchase and buyer framing: right for a buyer's guide, wrong on a history. */
const BUYER =
  /\b(purchas\w*|buy(?:ing|s)?|bought|wallet|money|spend\w*|pre-?orders?|price[ds]?|pay(?:ing|s)?|worth (?:it|your)|upgrade|storage|deal|checkout|cart)\b/i;
/** A title or format that is a buyer's guide. */
const BUYER_TITLE =
  /\b(buy|buying|before you|worth it|should you|pay|price|deal|upgrade|pre-?order|edition)\b/i;

/** Whether this video is a buyer's guide (pure): its own format, or a title that asks a buying question. */
export function isBuyerGuide(title: string, kind: LongDocKind): boolean {
  return kind === "guide" || BUYER_TITLE.test(title);
}

/** The first sentence's framing problem, when it sells something the title never promised (pure). */
export function buyerFramingProblems(
  hook: string,
  title: string,
  kind: LongDocKind,
): string[] {
  const first = sentencesOf(hook)[0] ?? "";
  if (!first || isBuyerGuide(title, kind)) return [];
  const hit = first.match(BUYER);
  return hit
    ? [
        `The first sentence frames a purchase ("${hit[0]}") on a video titled "${title}", which isn't a buyer's guide. Open on the title's own promise.`,
      ]
    : [];
}

// ---------------------------------------------------------------- 2. the central question

/** Where the opening first asks a question (pure): the word its sentence ends on, and the question. */
export function questionAt(
  hook: string,
): { words: number; question: string } | undefined {
  let at = 0;
  const flat = outsideQuotes(hook);
  for (const s of sentencesOf(flat)) {
    at += wc(s);
    if (/\?\s*["”’']?$/.test(s.trim()))
      return { words: at, question: s.trim() };
  }
  return undefined;
}

/**
 * Whether a question is the title's idea, by its telling words (pure): it shares at least two of them with the title,
 * or half the title's when the title is short. The judge (contractJudge) has the last word; this is the free proxy.
 */
export function sameIdeaAsTitle(question: string, title: string): boolean {
  const t = loopTokens(title);
  const q = loopTokens(question);
  const shared = [...t].filter((x) => q.has(x)).length;
  return shared >= Math.min(2, Math.max(1, Math.ceil(t.size / 2)));
}

export function questionProblems(hook: string, title: string): string[] {
  const q = questionAt(hook);
  if (!q)
    return [
      `The opening never asks the title's question. Ask it, in plain words, within the first ${QUESTION_BY_WORDS} words.`,
    ];
  const p: string[] = [];
  if (q.words > QUESTION_BY_WORDS)
    p.push(
      `The first question ("${q.question}") ends at word ${q.words}; the title's question must be said by word ${QUESTION_BY_WORDS} (about 15 seconds).`,
    );
  // Whether it's the title's idea is the judge's call (contractJudge): shared words miss a fair paraphrase ("Why didn't
  // CJ's story continue?" under "Why San Andreas Never Got a Sequel" shares none), so they're only a measure.
  void title;
  return p;
}

// ---------------------------------------------------------------- 4. opening length

/** A quotation of four words or more in the text, in straight or curly quotes (pure). */
export function quotedPassages(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[“"]([^”"]{8,400})[”"]/g))
    if (wc(m[1]!) >= 4) out.push(m[1]!.trim());
  return out;
}

export function openingLengthProblems(hook: string): string[] {
  const n = wc(hook);
  const quoted = quotedPassages(hook).length > 0;
  const most = quoted ? OPENING_QUOTE_WORDS_MAX : OPENING_WORDS_MAX;
  return n > most
    ? [
        `The opening runs ${n} words before the first chapter; keep it to ${most}${quoted ? " with its quoted source" : " (up to " + OPENING_QUOTE_WORDS_MAX + " only when it quotes a primary source)"}.`,
      ]
    : [];
}

// ---------------------------------------------------------------- 5. a dated primary voice

export interface DatedQuote {
  /** The words in quotation marks, exactly as the source has them. */
  quote: string;
  /** The source sentence they sit in, which says who and when. */
  sentence: string;
}

const DATE =
  /\b(?:1[89]\d\d|20\d\d)\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/;
const SPOKE =
  /\b(said|says|told|wrote|writes|stated|announced|explained|recalled|called|described|admitted|tweeted|posted|put it)\b/i;

/**
 * Dated quotations in the source (pure): a quotation of 5 to 40 words in a sentence that names a year or month and a
 * speaking verb. These are the only quotes the opening may use: the writer is never asked to make one up.
 */
export function datedQuotesIn(source: string, most = 4): DatedQuote[] {
  const out: DatedQuote[] = [];
  const seen = new Set<string>();
  for (const sentence of source.split(/(?<=[.!?”"])\s+(?=[A-Z“"])/)) {
    if (!DATE.test(sentence) || !SPOKE.test(sentence)) continue;
    for (const m of sentence.matchAll(/[“"]([^”"]{12,320})[”"]/g)) {
      const q = m[1]!.trim();
      const n = wc(q);
      const key = q.toLowerCase();
      if (n < 5 || n > 40 || seen.has(key)) continue;
      seen.add(key);
      out.push({ quote: q, sentence: sentence.trim().slice(0, 400) });
      if (out.length >= most) return out;
    }
  }
  return out;
}

const flatWords = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Whether the opening's first QUOTE_WITHIN_SECONDS say one of the source's dated quotes, five words running at least. */
export function quoteOpeningProblems(
  hook: string,
  quotes: readonly DatedQuote[],
): string[] {
  if (!quotes.length) return [];
  const head = flatWords(
    wordsIn(hook)
      .slice(0, Math.round((QUOTE_WITHIN_SECONDS * LONG_WPM) / 60))
      .join(" "),
  );
  const used = quotes.some((q) => {
    const w = flatWords(q.quote).split(" ");
    for (let i = 0; i + 5 <= w.length; i++)
      if (head.includes(w.slice(i, i + 5).join(" "))) return true;
    return false;
  });
  return used
    ? []
    : [
        `The source has a dated quote and the opening doesn't use it in its first ${QUOTE_WITHIN_SECONDS} seconds. Open on one of these, word for word, saying who said it and when: ${quotes
          .slice(0, 3)
          .map((q) => `"${q.quote}"`)
          .join("; ")}.`,
      ];
}

// ---------------------------------------------------------------- 3. one finish line

export interface FinishLine {
  question: string;
  plantSeconds: number;
  /** The payoff's place in the runtime, 0 to 1. */
  payShare: number;
}

/**
 * The finish line (pure): the loop the outline marked as one, else the cold open's loop that is paid last (scripts
 * from before the mark). Undefined when the script has no loop planted in the opening.
 */
export function finishLineOf(d: LongDoc): FinishLine | undefined {
  const loops = d.loops ?? [];
  const pick =
    loops.find((l) => l.finish) ??
    [...loops]
      .filter((l) => l.plant.entry < 0)
      .sort(
        (a, b) =>
          b.payoff.entry - a.payoff.entry || b.payoff.moment - a.payoff.moment,
      )[0];
  if (!pick) return undefined;
  const total = Math.max(1, docSeconds(d));
  return {
    question: pick.question,
    plantSeconds: secondsAt(
      d,
      sentenceStart(d, pick.plant.entry, pick.plant.moment),
    ),
    payShare:
      secondsAt(d, sentenceStart(d, pick.payoff.entry, pick.payoff.moment)) /
      total,
  };
}

export function finishLineProblems(d: LongDoc): string[] {
  const f = finishLineOf(d);
  if (!f)
    return [
      `No finish line: plant one question or goal before ${FINISH_PLANT_SECONDS} seconds and pay it in the last 15% of the video.`,
    ];
  const p: string[] = [];
  if (f.plantSeconds > FINISH_PLANT_SECONDS)
    p.push(
      `The finish line ("${f.question}") is planted at ${Math.round(f.plantSeconds)} s; plant it before ${FINISH_PLANT_SECONDS} s.`,
    );
  if (f.payShare < FINISH_PAY_SHARE)
    p.push(
      `The finish line ("${f.question}") is paid at ${Math.round(f.payShare * 100)}% of the runtime; pay it in the last 15%.`,
    );
  return p;
}

// ---------------------------------------------------------------- 6. hand-overs by contrast

// A light feeling lexicon: enough to tell praise from cost and joy from threat at a chapter's seam. The judge reads the
// pairs this cannot settle; a rule this crude never sends a chapter back on its own.
const UP =
  /\b(success\w*|triumph\w*|hit|record\w*|sold|best-?selling|praise\w*|acclaim\w*|loved|celebrat\w*|won|wins|breakthrough|freedom|finally|perfect\w*|boom\w*|thriv\w*|saved|rescue\w*|beloved|legend\w*|masterpiece|delight\w*|soared|peak|golden|smash)\b/i;
const DOWN =
  /\b(cost\w*|cut|cuts|lost|loss|los(?:e|ing)|delay\w*|problem\w*|crunch|backlash|fail\w*|threat\w*|trouble\w*|shut\w*|broke\w*|flop\w*|risk\w*|fear\w*|doubt\w*|collaps\w*|lawsuit\w*|controvers\w*|criticis\w*|anger|angry|worse|worst|struggl\w*|danger\w*|warning|price|pressure|abandon\w*|cancel\w*|never|without|gone|empty)\b/i;

/** A line's feeling, roughly: +1 praise or joy, -1 cost or threat, 0 neither or both (pure). */
export function feelingOf(line: string): -1 | 0 | 1 {
  const t = outsideQuotes(line);
  const up = UP.test(t);
  const down = DOWN.test(t);
  return up === down ? 0 : up ? 1 : -1;
}

export interface Handover {
  /** The chapter the seam closes (1 is the first). */
  after: number;
  last: string;
  first: string;
  /** true: opposite feelings; false: the same; undefined: the rule can't tell. */
  contrast: boolean | undefined;
}

/** Every chapter seam with its last and first line and whether they contrast, as far as the lexicon can tell (pure). */
export function handoversOf(d: LongDoc): Handover[] {
  const out: Handover[] = [];
  for (let i = 0; i + 1 < d.chapters.length; i++) {
    const last = sentencesOf(d.chapters[i]!.text).at(-1) ?? "";
    const first = sentencesOf(d.chapters[i + 1]!.text)[0] ?? "";
    const a = feelingOf(last);
    const b = feelingOf(first);
    out.push({
      after: i + 1,
      last,
      first,
      contrast: a && b ? a !== b : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 8. honest takes

/** A sentence in the narrator's own first person, outside quotations. */
const FIRST_PERSON =
  /(?:^|[^A-Za-z’'])(I|I['’](?:m|d|ve|ll))(?=[^A-Za-z]|$)|\bmy (?:take|verdict|money|bet|guess|read|view|call)\b/;

/** The narrator's first-person sentences in a text (pure): quoted people never count. */
export function takesIn(text: string): string[] {
  return sentencesOf(outsideQuotes(text)).filter((s) => FIRST_PERSON.test(s));
}

/** Takes per chapter (pure). */
export function takesPerChapter(d: LongDoc): number[] {
  return d.chapters.map((c) => takesIn(c.text).length);
}

export function takeProblems(
  chapterText: string,
  least = TAKES_PER_CHAPTER,
): string[] {
  const n = takesIn(chapterText).length;
  return n >= least
    ? []
    : [
        `This chapter has ${n} honest first-person take${n === 1 ? "" : "s"}; give it at least ${least}: "I think", "I'd have", "I'll be honest", each one earned by the fact just given and clear on its own. Never claim to have played, owned or been there.`,
      ];
}

// ---------------------------------------------------------------- the writers' rules (fix)

/** The outline's finish line, as the open-loop machinery plans it (OpenLoopSchema.finish_line). */
export const FINISH_LINE_RULE = `Finish line: mark exactly one of the open loops with "finish_line": true. It is the one question or goal the whole video drives towards, the same idea as the title: raised in the cold open (plant_chapter 0) and answered in the last chapter. The other loops are smaller and pay off along the way.`;

/**
 * The opening a contract asks for (fix), in place of the stacked hook's "stakes for you" line. A buyer's guide may talk
 * money from the first line; anything else opens on the title's own promise.
 */
export function contractOpeningRule(o: {
  title?: string;
  buyer: boolean;
  quotes?: readonly DatedQuote[];
}): string {
  const quote = o.quotes?.length
    ? `\n- Inside the first ${QUOTE_WITHIN_SECONDS} seconds, use one of these dated quotes from the source, word for word in quotation marks, saying who said it and when, with no other quote made up or reworded:\n${o.quotes
        .slice(0, 3)
        .map((q) => `  - "${q.quote}" (from: ${q.sentence.slice(0, 220)})`)
        .join("\n")}`
    : "";
  return `The opening contract (it overrides any other length or order given for the intro):
- The first sentence serves the title's promise${o.title ? ` ("${o.title}")` : ""}: a moment, a person, a figure or the question itself.${o.buyer ? "" : " No purchase, price or buyer framing: this isn't a buyer's guide."}
- State the title's central question in plain words within the first ${QUESTION_BY_WORDS} words, as a question, and make it the same idea as the title.
- Plant the finish line (the outline's finish-line question) before about 90 seconds; it is answered in the last chapter.
- The whole intro is at most ${OPENING_WORDS_MAX} spoken words, or up to ${OPENING_QUOTE_WORDS_MAX} when it quotes a primary source. Then hand straight to the first chapter.${quote}`;
}

/** The chapter rules a contract adds (fix): honest takes, and a hand-over by contrast. */
export function contractChapterRule(takes: number, series = false): string {
  return `${takes > 0 ? `- At least ${takes} honest first-person takes in this chapter ("I think that was the right call", "I'll be honest, this one stings"), each earned by the fact just given, each clear on its own. Never claim to have played, owned or been there.\n` : ""}- Hand over by contrast: the chapter's first line carries the opposite feeling to the last line of the chapter before (praise then cost, joy then threat, calm then trouble), and its last line sets up a turn the next chapter will contrast.${series ? " A series part ends on the next threat." : ""}`;
}

// ---------------------------------------------------------------- the report

export interface ContractReport {
  pass: boolean;
  problems: string[];
  measures: {
    hookWords: number;
    questionAtWords?: number;
    questionAtSeconds?: number;
    /** The free proxy for "same idea as the title" (shared telling words); the judge decides. */
    questionSharesTitleWords?: boolean;
    firstChapterSeconds: number;
    finishLine?: FinishLine;
    takes: number[];
    handovers: Array<{ after: number; contrast: boolean | undefined }>;
    quoteInOpening: boolean;
  };
}

/**
 * Everything the contract measures on one finished long video (pure). `quotes` are the source's dated quotes when the
 * caller has the sources; a stored script without them is not held to rule 5. Takes are counted on documentaries.
 */
export function contractReport(
  d: LongDoc,
  o: { quotes?: readonly DatedQuote[] } = {},
): ContractReport {
  const q = questionAt(d.hook);
  const takes = d.kind === "ranking" ? [] : takesPerChapter(d);
  const handovers = d.kind === "ranking" ? [] : handoversOf(d);
  const problems = [
    ...buyerFramingProblems(d.hook, d.title, d.kind),
    ...(d.kind === "ranking" ? [] : questionProblems(d.hook, d.title)),
    ...(d.kind === "ranking" ? [] : finishLineProblems(d)),
    ...openingLengthProblems(d.hook),
    ...quoteOpeningProblems(d.hook, o.quotes ?? []),
    ...takes.flatMap((n, i) =>
      n >= TAKES_PER_CHAPTER
        ? []
        : [
            `Chapter ${i + 1} has ${n} first-person take${n === 1 ? "" : "s"} (at least ${TAKES_PER_CHAPTER}).`,
          ],
    ),
    ...handovers
      .filter((h) => h.contrast === false)
      .map(
        (h) =>
          `Chapters ${h.after} and ${h.after + 1} hand over on the same feeling ("${h.last.slice(0, 60)}" / "${h.first.slice(0, 60)}").`,
      ),
  ];
  return {
    pass: problems.length === 0,
    problems,
    measures: {
      hookWords: wc(d.hook),
      ...(q
        ? {
            questionAtWords: q.words,
            questionAtSeconds: Math.round(secondsAt(d, q.words) * 10) / 10,
            questionSharesTitleWords: sameIdeaAsTitle(q.question, d.title),
          }
        : {}),
      firstChapterSeconds: Math.round(secondsAt(d, partStart(d, 1)) * 10) / 10,
      ...(finishLineOf(d) ? { finishLine: finishLineOf(d) } : {}),
      takes,
      handovers: handovers.map((h) => ({
        after: h.after,
        contrast: h.contrast,
      })),
      quoteInOpening:
        quotedPassages(wordsIn(d.hook).slice(0, 75).join(" ")).length > 0,
    },
  };
}

// ---------------------------------------------------------------- the judge (one cheap call a video)

export const ContractJudgeSchema = z.object({
  first_line_serves_title: z
    .boolean()
    .describe("Does the first sentence serve the title's promise?"),
  question_is_title: z
    .boolean()
    .describe("Is the opening's central question the same idea as the title?"),
  handovers: z
    .array(z.object({ after: z.number().int(), contrast: z.boolean() }))
    .describe(
      "One per seam, in order: do the two lines carry opposite feelings?",
    ),
  reasons: z
    .array(z.string())
    .max(6)
    .describe("Each failed point in one plain sentence"),
});
export type ContractJudgement = z.infer<typeof ContractJudgeSchema>;

/** The judgement the counts can't make: whether the opening serves the title, and whether each seam contrasts. */
export async function contractJudge(
  llm: Llm,
  d: LongDoc,
): Promise<ContractJudgement> {
  const seams = handoversOf(d);
  return llm.structured({
    site: "long.judge",
    tier: "mid",
    effort: "low",
    system: `You check the opening of a long YouTube video against its title, and its chapter seams. Answer strictly.
- first_line_serves_title: true only if the first sentence plainly belongs to the title's promise (a moment, person, figure or the question). A line about buying, price or the viewer's purchase is false unless the title is about buying.
- question_is_title: true only if the opening asks, in its first sentences, the question the title promises to answer.
- handovers: for each seam, true when the last line of one chapter and the first of the next carry opposite feelings (praise then cost, joy then threat, calm then trouble).
List each failed point in "reasons".`,
    content: `Title: ${d.title}\n\nOpening:\n${d.hook}\n\nSeams:\n${
      seams.map((s) => `${s.after}. "${s.last}" -> "${s.first}"`).join("\n") ||
      "(none)"
    }`,
    schema: ContractJudgeSchema,
  });
}

/** A report with the judge's word added (pure): its failures join the problems; contrast follows the judge. */
export function withJudgement(
  r: ContractReport,
  j: ContractJudgement,
): ContractReport {
  const problems = [...r.problems];
  if (!j.first_line_serves_title)
    problems.push(
      "Judge: the first sentence doesn't serve the title's promise.",
    );
  if (!j.question_is_title)
    problems.push("Judge: the opening question isn't the title's question.");
  const seams = new Map(j.handovers.map((h) => [h.after, h.contrast]));
  const handovers = r.measures.handovers.map((h) => ({
    after: h.after,
    contrast: seams.get(h.after) ?? h.contrast,
  }));
  for (const h of handovers)
    if (
      h.contrast === false &&
      !problems.some((p) => p.startsWith(`Chapters ${h.after} and `))
    )
      problems.push(
        `Chapters ${h.after} and ${h.after + 1} hand over on the same feeling (judge).`,
      );
  return {
    pass: problems.length === 0,
    problems,
    measures: { ...r.measures, handovers },
  };
}
