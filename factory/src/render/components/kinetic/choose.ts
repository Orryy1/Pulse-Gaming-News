// Which bare documentary sentences become kinetic typography, and in which style (31 Oct 2026). Kinetic
// type is for the emotional, punch-line and turning-point lines ("Nobody outside the studio knows it yet.",
// "That ambition had a cost."): short, with a turn or a weight word, often a line the sound editor already
// marked (`moment.beat`). A long descriptive sentence, one that already carries a graphic, or one with a
// quotation in it (that belongs on a quote card with its speaker) is declined. Pure: the pipeline imports it.

import {
  hash01,
  indexIn,
  type Candidate,
  type FillerAt,
  type FillerChapter,
  type FillerMoment,
  type Verdict,
} from "./types.ts";
import { keyWords, norm, tokens } from "./words.ts";

/** The kinetic styles, in registry order (./index.ts draws them). */
export const KINETIC_STYLES = [
  "land",
  "scale",
  "typeUnderline",
  "stack",
  "split",
  "highlight",
] as const;
export type KineticStyle = (typeof KINETIC_STYLES)[number];

/** What a kinetic component draws: the sentence's tokens, the ones on screen and the strongest. */
export interface KineticData {
  sentence: string;
  tokens: string[];
  /** Indices into tokens on screen, in order (at most six). */
  shown: number[];
  /** The strongest word: an index into tokens, one of shown. */
  hero: number;
  /** For the split style: the index into `shown` where the second half starts. */
  split?: number;
  /** The line's register, from the beat and the wording: it sets the pace and the weight. */
  tone: "punch" | "turn" | "quiet" | "reveal";
}

/** Longer than this and a sentence is narration to hear, not type to read. */
export const KINETIC_MAX_WORDS = 22;
/** Below this the chooser declines. */
export const KINETIC_MIN_CONFIDENCE = 0.5;

// The wording of a turn or a punch line.
const TURN =
  /\b(but|yet|instead|until|then|suddenly|except|however|not everyone|not everything|no longer|anymore|changed|reversed)\b/i;
const WEIGHT =
  /\b(nobody|no one|nothing|never|everything|everyone|only|alone|cost|price|gamble|bet|problem|risk|secret|secrecy|nightmare|survived|agreed|furthest|first|last|ever|biggest|fastest|worst|best|hard|enough|own)\b/i;
const QUOTE = /["“”]/;

/** Where a line divides into two halves that face off (a comma, "but", "yet", a colon), as an index into shown. */
export function splitPoint(
  toks: string[],
  shown: number[],
): number | undefined {
  if (shown.length < 2) return undefined;
  // The first token of the second half: just after a comma, colon, semicolon or dash, or a "but"/"yet".
  let cut = -1;
  for (let i = 1; i < toks.length; i++) {
    const prev = toks[i - 1]!;
    if (
      /[,;:]$|[—–-]$/.test(prev) ||
      // A closing "yet" ("knows it yet") is the punch, not a divide.
      (i < toks.length - 1 && /^(but|yet|instead|while)$/i.test(norm(toks[i]!)))
    ) {
      // The cut nearest the middle wins.
      if (
        cut < 0 ||
        Math.abs(i - toks.length / 2) < Math.abs(cut - toks.length / 2)
      )
        cut = i;
    }
  }
  if (cut < 0) return undefined;
  const k = shown.findIndex((i) => i >= cut);
  return k > 0 && k < shown.length ? k : undefined;
}

/** The styles that can draw this line (split needs a divide; stack and highlight need three words). */
export function fittingStyles(d: KineticData): KineticStyle[] {
  return KINETIC_STYLES.filter((s) => {
    if (s === "split") return d.split !== undefined;
    // Five or six lines squeeze the block to a narrow column (first stills): three or four words only.
    if (s === "stack") return d.shown.length >= 3 && d.shown.length <= 4;
    if (s === "highlight") return d.shown.length >= 3;
    if (s === "scale") return norm(d.tokens[d.hero] ?? "").length >= 3;
    return true;
  });
}

/**
 * The style for a line: the one its register asks for when it fits (a turn faces off, a reveal scales up,
 * a quiet line is typed), else a seeded rotation over the fitting styles, never the previous one.
 */
export function pickStyle(
  d: KineticData,
  seed: number,
  previous?: string,
): KineticStyle {
  const fit = fittingStyles(d);
  const want: Partial<Record<KineticData["tone"], KineticStyle>> = {
    turn: "split",
    reveal: "scale",
    quiet: "typeUnderline",
  };
  const w = want[d.tone];
  if (w && fit.includes(w) && w !== previous && hash01(d.sentence, seed) < 0.6)
    return w;
  const pool = fit.filter((s) => s !== previous);
  const list = pool.length ? pool : fit;
  return list[Math.floor(hash01(d.sentence, seed + 7) * list.length)]!;
}

/** The full verdict for a sentence: a candidate, or the reason it was declined. */
export function kineticVerdict(
  sentence: string,
  moment: FillerMoment,
  chapter: FillerChapter,
  at: FillerAt = {},
): Verdict<KineticData> {
  const kind = moment.graphic?.kind ?? "none";
  if (kind !== "none")
    return { declined: `it already carries a ${kind} graphic` };
  if (QUOTE.test(sentence))
    return {
      declined:
        "it quotes someone, which belongs on a quote card with the speaker",
    };
  const n = tokens(sentence).length;
  if (n > KINETIC_MAX_WORDS)
    return {
      declined: `${n} words is narration to hear, not a line to set in type`,
    };
  const kw = keyWords(sentence, moment.emphasis);
  if (!kw) return { declined: "no word in it is worth setting" };

  const beat = moment.beat && moment.beat !== "none" ? moment.beat : undefined;
  const why: string[] = [];
  let c = 0.25;
  if (
    beat === "key" ||
    beat === "reveal" ||
    beat === "turn" ||
    beat === "quiet"
  ) {
    c += 0.3;
    why.push(`the sound editor marked it "${beat}"`);
  } else if (beat === "record") {
    c += 0.15;
    why.push("it lands a record");
  }
  if (n <= 8) {
    c += 0.3;
    why.push(`a short line of ${n} words`);
  } else if (n <= 13) {
    c += 0.15;
    why.push(`a line of ${n} words`);
  }
  const turn = TURN.test(sentence);
  const weight = WEIGHT.test(sentence);
  if (turn || weight) {
    c += 0.15;
    why.push(turn ? "it turns the story" : "it carries a weight word");
  }
  if (/\?\s*$/.test(sentence)) {
    c += 0.15;
    why.push("it asks the question");
  }
  if (moment.emphasis?.trim() && kw.shown.length < kw.tokens.length) {
    c += 0.05;
    why.push("the shot list marks its key phrase");
  }
  // The chapter's first sentence opens on its title card and a scene; type there fights the card.
  const idx = indexIn(chapter, sentence, at);
  if (idx === 0) c -= 0.2;
  c = Math.max(0, Math.min(0.95, Math.round(c * 100) / 100));
  if (c < KINETIC_MIN_CONFIDENCE)
    return {
      declined: `a descriptive line, not a punch line (${why.join(", ") || "no turn, weight or beat"})`,
    };

  const tone: KineticData["tone"] =
    beat === "turn" || (turn && !weight)
      ? "turn"
      : beat === "reveal" || beat === "record"
        ? "reveal"
        : beat === "quiet"
          ? "quiet"
          : "punch";
  const data: KineticData = {
    sentence,
    tokens: kw.tokens,
    shown: kw.shown,
    hero: kw.hero,
    split: splitPoint(kw.tokens, kw.shown),
    tone,
  };
  const style = pickStyle(data, (at.seed ?? 0) + Math.max(0, idx), at.previous);
  return {
    candidate: {
      family: "kinetic",
      style,
      confidence: c,
      reason: `kinetic type: ${why.join(", ")}`,
      data,
    },
  };
}

/** The kinetic-typography candidate for a bare sentence, or undefined when it is not that kind of line. */
export function kineticFor(
  sentence: string,
  moment: FillerMoment,
  chapter: FillerChapter,
  at: FillerAt = {},
): Candidate<KineticData> | undefined {
  const v = kineticVerdict(sentence, moment, chapter, at);
  return "candidate" in v ? v.candidate : undefined;
}
