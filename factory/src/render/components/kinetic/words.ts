// The words of a kinetic-typography line (the LEMMiNO/Vox technique: a sentence's key words set large and
// animated in step with the narrator). Three pure pieces, all tested:
//   - tokens(): the sentence's own words as the script writes them, so the screen never paraphrases;
//   - keyWords(): which of them go on screen (at most six), from the moment's marked emphasis, figures,
//     proper names, the sentence-final punch word and the strong content words, in sentence order;
//   - wordTimes(): when the narrator says each of them, aligned from the voice's word timings. The voice
//     says "nineteen ninety-five" where the script writes "1995", so each written word is expanded the way
//     the voice reads it (speakable) and the two sequences are aligned by edit distance.
// Nothing here imports React: the pipeline imports it from Node.

import { speakable } from "../../../voice/speakable.ts";

/** At most this many words of a sentence on screen at once (brief, 31 Oct 2026). */
export const MAX_SHOWN = 6;

/** A word as the screen shows it: outer quotes and trailing punctuation off, inner apostrophes kept. */
export function displayWord(w: string): string {
  return w
    .replace(/^[("“‘'\[]+/, "")
    .replace(/[)"”’'\],.;:!?]+$/, "")
    .replace(/^[("“‘'\[]+/, "");
}

/** The sentence's words in order, as written (punctuation attached). */
export function tokens(sentence: string): string[] {
  return sentence.trim().split(/\s+/).filter(Boolean);
}

/** A word reduced for comparing: lower case letters and digits only. */
export const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

// Function words: never a key word on their own (they may fill a one-word gap between two key words).
const STOP = new Set(
  (
    "a an the and or but so of to in on at by for with from into onto over under as than then that this these those " +
    "it its it's is was were be been being are am has had have having do did does done not no nor " +
    "he she they them their his her him we us our you your i me my mine who whom whose which what when where why how " +
    "there here also just very really quite even still again ever about around after before during until while " +
    "would could should can will may might must shall "
  )
    .split(/\s+/)
    .filter(Boolean),
);
// Words that carry the turn of a punch line even though they are short or common.
const PUNCH = new Set(
  (
    "nobody nothing never everything everyone everybody none nowhere only alone first last yet cost gamble bet problem " +
    "survived agreed failed broke worked won lost gone changed furthest biggest fastest worst best record secret secrecy " +
    "nightmare enough instead hard"
  )
    .split(/\s+/)
    .filter(Boolean),
);
// Weak verbs and fillers: allowed as gap words, never chosen on merit.
const WEAK = new Set(
  (
    "said says made make got get went go came come took take put seen saw found find became become started start began " +
    "much many more most some any each every other another one own same such like way thing things lot kind part " +
    "either too though anyway anymore later soon now"
  )
    .split(/\s+/)
    .filter(Boolean),
);

export const isStop = (w: string) => STOP.has(norm(w)) || norm(w) === "";

/** The emphasis phrase's position in the sentence: the token indices it covers, or [] when it is not there. */
export function emphasisRun(
  toks: string[],
  emphasis: string | undefined,
): number[] {
  const want = tokens(emphasis ?? "")
    .map(norm)
    .filter(Boolean);
  if (!want.length) return [];
  const have = toks.map(norm);
  for (let i = 0; i + want.length <= have.length; i++)
    if (want.every((w, j) => have[i + j] === w))
      return want.map((_, j) => i + j);
  return [];
}

/** How strongly each word asks to be on screen (0: never on merit). Pure, so tests pin the order. */
export function wordScores(toks: string[], emphasis?: string): number[] {
  const run = new Set(emphasisRun(toks, emphasis));
  const last = (() => {
    // The punch word: the last word that is neither a function word nor a filler ("agree", not "either").
    for (let i = toks.length - 1; i >= 0; i--)
      if (!isStop(toks[i]!) && !WEAK.has(norm(toks[i]!))) return i;
    return -1;
  })();
  return toks.map((t, i) => {
    const n = norm(t);
    if (!n) return 0;
    let s = 0;
    if (run.has(i)) s += 3;
    if (/\d/.test(t)) s += 3;
    if (PUNCH.has(n)) s += 1.5;
    if (STOP.has(n)) return run.has(i) ? 1 : PUNCH.has(n) && i === last ? s : 0;
    // A capital away from the sentence start is a name ("Rockstar", "Microsoft", "Xbox").
    if (i > 0 && /^[("“‘']?[A-Z]/.test(t)) s += 2;
    if (i === last) s += 2.5;
    if (!WEAK.has(n)) s += 1 + 0.08 * Math.min(n.length, 10);
    else s += 0.3;
    return s;
  });
}

/** How many words a sentence of n words puts on screen: all of a short line, about two in five of a long one. */
export function shownCount(n: number): number {
  if (n <= MAX_SHOWN) return n;
  // Seven to ten words lose only their weakest few; a longer line keeps about two in five.
  if (n <= 10) return MAX_SHOWN;
  return Math.min(MAX_SHOWN, Math.max(3, Math.ceil(n / 2.5)));
}

export interface KeyWords {
  /** The sentence's tokens, as written. */
  tokens: string[];
  /** Indices into tokens of the words on screen, in sentence order, at most MAX_SHOWN. */
  shown: number[];
  /** The single strongest word (an index into tokens, one of shown): the one a style makes biggest. */
  hero: number;
}

/**
 * The words of a sentence that go on screen: a short line (six words or fewer) whole; a longer one by
 * score, the moment's emphasis phrase first when it fits, then figures, names, the final punch word and the
 * strongest content words, with a single small word kept where it joins two chosen ones into a phrase.
 * Undefined when nothing in the sentence is worth setting.
 */
export function keyWords(
  sentence: string,
  emphasis?: string,
): KeyWords | undefined {
  const toks = tokens(sentence);
  if (!toks.length) return undefined;
  const scores = wordScores(toks, emphasis);
  const best = (idx: number[]) =>
    idx.reduce(
      (b, i) =>
        scores[i]! > scores[b]! || (scores[i] === scores[b] && i > b) ? i : b,
      idx[0]!,
    );
  if (toks.length <= MAX_SHOWN) {
    const all = toks.map((_, i) => i).filter((i) => norm(toks[i]!));
    if (!all.some((i) => scores[i]! > 0)) return undefined;
    return { tokens: toks, shown: all, hero: best(all) };
  }
  const want = shownCount(toks.length);
  const pick = new Set<number>();
  const run = emphasisRun(toks, emphasis);
  if (run.length && run.length <= want) run.forEach((i) => pick.add(i));
  const order = toks
    .map((_, i) => i)
    .filter((i) => scores[i]! >= 1)
    .sort((a, b) => scores[b]! - scores[a]! || b - a);
  for (const i of order) {
    if (pick.size >= want) break;
    pick.add(i);
  }
  if (!pick.size) return undefined;
  // One small word between two chosen ones reads as a phrase ("its own department", "Xbox exclusive").
  for (let i = 1; i < toks.length - 1 && pick.size < MAX_SHOWN; i++)
    if (!pick.has(i) && pick.has(i - 1) && pick.has(i + 1) && norm(toks[i]!))
      pick.add(i);
  const scattered = [...pick].sort((a, b) => a - b);
  // In a line of up to ten words a run of six reads better than the same words with gaps ("started life
  // as a Godzilla project", not "Internally, started life a Godzilla project"), but only when the run keeps
  // the line's two strongest words ("Nobody ... yet" must not lose "Nobody"), and all of the emphasis phrase.
  const sum = (idx: number[]) => idx.reduce((a, i) => a + scores[i]!, 0);
  const top2 = toks
    .map((_, i) => i)
    .sort((a, b) => scores[b]! - scores[a]! || b - a)
    .slice(0, 2);
  let window: number[] = [];
  if (toks.length <= 10)
    for (let a = 0; a + MAX_SHOWN <= toks.length; a++) {
      const w = Array.from({ length: MAX_SHOWN }, (_, j) => a + j);
      if (
        run.length &&
        run.length <= MAX_SHOWN &&
        !run.every((i) => w.includes(i))
      )
        continue;
      if (!top2.every((i) => w.includes(i))) continue;
      if (!window.length || sum(w) > sum(window) + 0.01) window = w;
    }
  const shown = window.length ? window : scattered;
  return { tokens: toks, shown, hero: best(shown) };
}

/** A voice word timing, as assets.words stores it (seconds from the start of the narration). */
export type SpokenWord = { text: string; start: number; end: number };

/** The spoken words inside [start, end) of the narration (a sentence's window, from momentWindows). */
export function wordsIn(
  words: SpokenWord[],
  start: number,
  end: number,
): SpokenWord[] {
  return words.filter((w) => w.start >= start - 0.05 && w.start < end);
}

/**
 * When the narrator starts each written token, in seconds relative to `origin` (the shot's first frame):
 * the sentence's tokens are expanded as the voice reads them and aligned to the spoken words by edit
 * distance, so "1995" lands on "nineteen" and a word the voice skipped takes its neighbours' timing.
 * With no spoken words at all the tokens are paced evenly over `fallback` seconds.
 */
export function wordTimes(
  toks: string[],
  spoken: SpokenWord[],
  origin: number,
  fallback = 2.6,
): number[] {
  if (!toks.length) return [];
  if (!spoken.length)
    return toks.map((_, i) => 0.2 + (fallback * i) / Math.max(1, toks.length));
  // Each written token as the words the voice says for it.
  const exp: Array<{ tok: number; w: string }> = [];
  toks.forEach((t, i) => {
    const said = (() => {
      try {
        return speakable(t);
      } catch {
        return t;
      }
    })();
    const parts = said
      .split(/[\s-]+/)
      .map(norm)
      .filter(Boolean);
    for (const p of parts.length ? parts : [norm(t)])
      exp.push({ tok: i, w: p });
  });
  // The voice's words split the same way, each part carrying its word's start.
  const sp: Array<{ w: string; t: number }> = [];
  for (const w of spoken) {
    const parts = w.text
      .split(/[\s-]+/)
      .map(norm)
      .filter(Boolean);
    parts.forEach((p, j) =>
      sp.push({ w: p, t: w.start + ((w.end - w.start) * j) / parts.length }),
    );
  }
  // Edit-distance alignment: match equal words, skip either side at a cost.
  const n = exp.length;
  const m = sp.length;
  const D: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) D[i]![0] = i;
  for (let j = 1; j <= m; j++) D[0]![j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const same = exp[i - 1]!.w === sp[j - 1]!.w;
      D[i]![j] = Math.min(
        D[i - 1]![j]! + 1,
        D[i]![j - 1]! + 1,
        D[i - 1]![j - 1]! + (same ? 0 : 1.5),
      );
    }
  const at = new Array<number | undefined>(toks.length).fill(undefined);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const same = exp[i - 1]!.w === sp[j - 1]!.w;
    if (D[i]![j] === D[i - 1]![j - 1]! + (same ? 0 : 1.5)) {
      // A substitution still places the token at that word (a misheard word is still the moment it is said).
      const k = exp[i - 1]!.tok;
      at[k] = Math.min(at[k] ?? Infinity, sp[j - 1]!.t);
      i--;
      j--;
    } else if (D[i]![j] === D[i - 1]![j]! + 1) i--;
    else j--;
  }
  // Tokens the voice did not say take the time between their neighbours.
  const first = spoken[0]!.start;
  const lastT = spoken[spoken.length - 1]!.end;
  const abs: number[] = [];
  for (let k = 0; k < toks.length; k++) {
    if (at[k] !== undefined) {
      abs.push(at[k]!);
      continue;
    }
    const prev = k > 0 ? abs[k - 1]! : first;
    let next = lastT;
    for (let q = k + 1; q < toks.length; q++)
      if (at[q] !== undefined) {
        next = at[q]!;
        break;
      }
    abs.push(
      k > 0 ? prev + Math.max(0, next - prev) * 0.5 : Math.min(first, next),
    );
  }
  // Relative to the shot, and never earlier than the word before (the alignment can cross on a repeat).
  const rel = abs.map((t) => t - origin);
  for (let k = 1; k < rel.length; k++) rel[k] = Math.max(rel[k]!, rel[k - 1]!);
  return rel.map((t) => Math.max(0, t));
}
