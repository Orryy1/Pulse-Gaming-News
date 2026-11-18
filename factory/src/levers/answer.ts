// Search and AI-answer packaging for long videos (ANSWER_PACK and ANSWER_PAGES, research of 14 Nov 2026, section
// 3.11): Google's AI Overviews and AI Mode cite YouTube more than any other site, almost always long videos, and most
// often a timestamp or chapter. What they quote is a description that summarises the video, chapters named as the
// questions people ask, and facts that sit at a time in the video. So a long video gets:
//
// - a 2 to 3 sentence summary as the first lines of the description (what the video answers, in plain words);
// - question-style chapters where a question is natural: the documentary's own open loops first (the questions the
//   writer raised and answered in that chapter), then a few safe rewrites ("The Making of X" is "How X Was Made?"
//   only where the grammar is certain), and the rest left as they are;
// - a key-facts list, each fact with the time it is said. The time sits at the end of the line, never at its start,
//   so YouTube still reads exactly one chapter list (a line that starts with a time is a chapter candidate).
//
// Pure: the pipeline supplies the script, the chapter lines and the narration with its times.

import type { Script } from "../editorial/schema.ts";
import { markSeconds, stamp } from "../youtube/chapters.ts";

/** A spoken stretch of the long video: the narration and when it starts (seconds). */
export interface TimedLine {
  start: number;
  text: string;
  /** This stretch opens a chapter (a chapter card or a ranking entry). */
  opensChapter?: boolean;
}

export interface KeyFact {
  at: number;
  text: string;
}

export interface AnswerPack {
  summary: string;
  chapters: Array<{ at: number; title: string }>;
  facts: KeyFact[];
}

const SENTENCE = /[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g;
const FIGURE =
  /\b(1[89]\d\d|20\d\d)\b|\d[\d,.]*\s*(%|percent|million|billion|thousand|hours?|years?|days?|copies|players|dollars)|\$\s?\d|£\s?\d|€\s?\d|\b\d{2,}\b/i;
const NAMED = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z0-9]+)+\b/;
const SOFT_START = /^(and|but|so|then|now|still|yet|because|which|that)\b/i;
/** A fact that holds only on a condition, or a line about the video's own structure ("Check 14 is..."). */
const CONDITIONAL = /^(if|when you|whether|unless|in case)\b/i;
const META = /\b(check|claim|chapter|part|entry) \d+\b/i;
const LINKISH = /https?:|#\w/;
/** The writer's description reads as a summary only when it says this much. */
const SUMMARY_MIN_CHARS = 120;
const VAGUE = /\b(this|that|these|those|it|they|he|she)\b/i;
const QUESTION_WORD =
  /^(why|how|what|when|where|who|which|is|are|was|were|did|does|do|can|could|will|would|should)\b/i;
const MAKING_OF = /^the making of (.+)$/i;
const STORY_OF = /^the (?:story|history) of (.+)$/i;
const LEGACY_OF = /^(?:the )?legacy of (.+)$/i;
const FALL_OF = /^the fall of (.+)$/i;
const RISE_OF = /^the rise of (.+)$/i;
const NOT_A_QUESTION =
  /^(intro|introduction|outro|our pick|the verdict|verdict|final thoughts|conclusion|stream starts)$/i;
const RANK_LINE = /^#\d+\s/;
const TRAILING_STOP = /[.?!]+$/;

/** The sentences of a text (pure), trimmed, empty ones dropped. */
export function sentencesOf(text: string): string[] {
  return (String(text ?? "").match(SENTENCE) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

const capital = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t && !TRAILING_STOP.test(t) ? `${t}.` : t;
};

/**
 * The description's opening summary (pure): what the video answers in two or three plain sentences, under 320
 * characters. The hook says what happened, the writer's one-line point says what it means, the take closes it; any of
 * them missing, the next beat stands in. Never more than three sentences, never a question to the viewer.
 */
export function summaryLead(
  script: Pick<Script, "hook" | "beats" | "pulse_take"> & {
    point?: string;
    youtube?: { description?: string };
  },
  maxChars = 320,
): string {
  // The writer's own description is written as a summary ("We check 30 GTA 6 claims..."): its first sentences lead
  // when they say enough. Otherwise the summary is built from the hook, the point, the beats and the take.
  const own = sentencesOf(script.youtube?.description ?? "")
    .filter(
      (s) =>
        s.length >= 12 &&
        !s.endsWith("?") &&
        !SOFT_START.test(s) &&
        !LINKISH.test(s),
    )
    .map(sentence);
  const lead: string[] = [];
  for (const s of own) {
    if (lead.length >= 3 || [...lead, s].join(" ").length > maxChars) break;
    lead.push(s);
  }
  if (lead.length >= 2 && lead.join(" ").length >= SUMMARY_MIN_CHARS)
    return lead.join(" ");
  const parts = [
    sentencesOf(script.hook)[0],
    script.point ? sentencesOf(script.point)[0] : undefined,
    ...script.beats.flatMap((b) => sentencesOf(b.narration).slice(0, 1)),
    sentencesOf(script.pulse_take?.narration ?? "")[0],
  ]
    // A sentence that leans on the one before it ("And that is where...") cannot open a description.
    .filter((s): s is string =>
      Boolean(
        s &&
        s.length >= 12 &&
        !s.trim().endsWith("?") &&
        !SOFT_START.test(s.trim()),
      ),
    )
    .map(sentence);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length >= 3) break;
    if (out.some((o) => o.toLowerCase() === p.toLowerCase())) continue;
    const next = [...out, p].join(" ");
    if (next.length > maxChars) {
      if (out.length >= 2) break;
      continue;
    }
    out.push(p);
  }
  return out.join(" ");
}

/**
 * A chapter title as a question where that is natural (pure), else the title unchanged. Only rewrites whose grammar is
 * certain: "The Making of X" asks how X was made, "The Story of X" what the story of X is, "The Legacy of X" what X
 * left behind, "The Fall/Rise of X" how X fell or rose. A title that already starts with a question word gets its
 * question mark. Intros, picks, verdicts and ranking entries ("#3 Vice City") stay as they are.
 */
export function questionTitle(title: string): string {
  const t = title.trim().replace(TRAILING_STOP, "");
  if (!t || NOT_A_QUESTION.test(t) || RANK_LINE.test(t)) return title.trim();
  if (QUESTION_WORD.test(t)) return `${capital(t)}?`;
  let m = t.match(MAKING_OF);
  if (m) return `How Was ${m[1]} Made?`;
  m = t.match(STORY_OF);
  if (m) return `What Is the Story of ${m[1]}?`;
  m = t.match(LEGACY_OF);
  if (m) return `What Did ${m[1]} Leave Behind?`;
  m = t.match(FALL_OF);
  if (m) return `How Did ${m[1]} Fall?`;
  m = t.match(RISE_OF);
  if (m) return `How Did ${m[1]} Rise?`;
  return title.trim();
}

/**
 * The chapter lines with question titles (pure). `questions[i]` is the documentary's own question answered in chapter
 * i + 1 (its open loops), used when it is short enough for a chapter list; otherwise questionTitle decides. The first
 * line (0:00) and the last (the take or the pick) keep their titles; times never change.
 */
export function questionChapters(
  lines: string[],
  questions: Array<string | undefined> = [],
): string[] {
  return lines.map((line, i) => {
    const m = line.trim().match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/);
    if (!m || i === 0 || i === lines.length - 1) return line;
    const own = questions[i - 1]?.trim();
    const title =
      own && own.length <= 70 && own.endsWith("?") ? own : questionTitle(m[2]!);
    return `${m[1]} ${title}`;
  });
}

/** The open-loop questions by the chapter that answers them (pure): index 0 is chapter 1. */
export function loopQuestions(
  script: Pick<Script, "open_loops">,
): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  for (const l of script.open_loops ?? []) {
    // The placement counts chapters from 0 (src/editorial/openloops.ts placeOpenLoops).
    const n = l.payoff?.entry;
    if (typeof n === "number" && n >= 0 && !out[n]) out[n] = l.question;
  }
  return out;
}

/** How much a sentence carries on its own as a fact (pure): a figure, a name, a full sentence that needs no context. */
export function factScore(s: string): number {
  const t = s.trim();
  if (t.length < 40 || t.length > 180 || t.endsWith("?")) return 0;
  let n = 0;
  if (FIGURE.test(t)) n += 2;
  if (NAMED.test(t)) n += 1;
  if (SOFT_START.test(t) || CONDITIONAL.test(t) || META.test(t)) n -= 2;
  if (VAGUE.test(t.split(/\s+/).slice(0, 2).join(" "))) n -= 1;
  return Math.max(0, n);
}

/**
 * The key facts (pure): at most `max`, at most one per chapter, each the best-scoring sentence of its stretch with the
 * time that stretch starts, in the order of the video. A sentence that scores under 2 (no figure, or one that leans on
 * the sentence before it) is never a key fact, so a thin video gets fewer facts, not weak ones.
 */
export function keyFacts(timed: TimedLine[], max = 6): KeyFact[] {
  const chapters: TimedLine[][] = [];
  for (const t of timed) {
    if (t.opensChapter || !chapters.length) chapters.push([]);
    chapters.at(-1)!.push(t);
  }
  const best = chapters
    .map((lines) => {
      let pick: KeyFact | undefined;
      let score = 1;
      for (const l of lines)
        for (const s of sentencesOf(l.text)) {
          const n = factScore(s);
          if (n > score) {
            score = n;
            pick = { at: Math.floor(l.start), text: sentence(s) };
          }
        }
      return pick ? { ...pick, score } : undefined;
    })
    .filter((x): x is KeyFact & { score: number } => Boolean(x));
  return best
    .slice()
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, max)
    .sort((a, b) => a.at - b.at)
    .map(({ at, text }) => ({ at, text }));
}

/** The description's key-facts block (pure): the time after each fact, so the chapter list stays the only one. */
export function keyFactLines(facts: KeyFact[]): string[] {
  if (!facts.length) return [];
  return ["Key facts:", ...facts.map((f) => `• ${f.text} (at ${stamp(f.at)})`)];
}

/** The chapter lines as times and titles (pure). */
export function chapterMarks(
  lines: string[],
): Array<{ at: number; title: string }> {
  return lines.flatMap((l) => {
    const m = l.trim().match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/);
    return m ? [{ at: markSeconds(l), title: m[2]! }] : [];
  });
}

/** Removes from the writer's description the sentences the summary already says (pure), so nothing reads twice. */
export function withoutSummary(body: string, summary: string): string {
  const said = new Set(
    sentencesOf(summary).map((s) => s.toLowerCase().replace(TRAILING_STOP, "")),
  );
  return sentencesOf(body)
    .filter((s) => !said.has(s.toLowerCase().replace(TRAILING_STOP, "")))
    .join(" ");
}

/** The whole pack for a long video (pure): the summary, the question chapters as marks and the key facts. */
export function answerPack(
  script: Pick<Script, "hook" | "beats" | "pulse_take" | "open_loops"> & {
    point?: string;
    youtube?: { description?: string };
  },
  chapterLines: string[],
  timed: TimedLine[],
): AnswerPack {
  return {
    summary: summaryLead(script),
    chapters: chapterMarks(
      questionChapters(chapterLines, loopQuestions(script)),
    ),
    facts: keyFacts(timed),
  };
}

/** ISO 8601 duration for schema.org (pure): "PT1H2M3S". */
export function isoDuration(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}
