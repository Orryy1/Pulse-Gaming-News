// Room in the narration for a character quote (CHARACTER_QUOTES): after the voice is recorded, the silence the
// quote's clip plays in goes into the file between the setup's last word and the reaction's first (in the middle
// of the pause the voice already left there, so no word is cut), and every later word timing moves by it. The
// captions, chapter breaks and the render all read the shifted timings, so nothing else needs to know. Pure except
// openQuoteGaps, which edits the file through insertSilence (src/voice/pauses.ts).

import type { Script } from "../editorial/schema.ts";
import type { CharacterQuote } from "../editorial/charquote.ts";
import { stripVoiceTags } from "./tags.ts";
import { speakable, speakContext } from "./speakable.ts";
import {
  gapSpans,
  insertSilence,
  openWords,
  type Gap,
  type TimedWord,
} from "./pauses.ts";

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
const wordsOf = (t: string) => t.split(/\s+/).map(norm).filter(Boolean);

/**
 * The index of the setup's last spoken word in the voice's word timings (pure), or -1. The narration is spoken in
 * the order narrationOf gives it, so the setup ends near the word count of everything before it; the match is the
 * nearest place where the setup's last words end and the reaction's first words begin.
 */
export function quoteBoundary(
  words: readonly TimedWord[],
  script: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
  q: Pick<CharacterQuote, "beat" | "before" | "after">,
): number {
  const ctx = speakContext();
  const texts = [
    script.hook,
    ...script.beats.slice(0, q.beat).map((b) => b.narration),
  ].map((t) => speakable(stripVoiceTags(t.trim()), ctx));
  const before = wordsOf(speakable(stripVoiceTags(q.before), ctx));
  const after = wordsOf(speakable(stripVoiceTags(q.after), speakContext()));
  if (!before.length || !after.length) return -1;
  const expected = texts.flatMap(wordsOf).length + before.length - 1;
  const heard = words.map((w) => norm(w.text));
  const tail = before.slice(-3);
  const head = after.slice(0, 2);
  const fits = (k: number) =>
    tail.every((w, i) => heard[k - (tail.length - 1) + i] === w) &&
    head.every((w, i) => heard[k + 1 + i] === w);
  let best = -1;
  for (let k = 0; k < heard.length - 1; k++)
    if (
      fits(k) &&
      (best < 0 || Math.abs(k - expected) < Math.abs(best - expected))
    )
      best = k;
  if (best >= 0) return best;
  // A word the voice spelled its own way: the last setup word and first reaction word alone, near the count.
  for (let d = 0; d <= 8; d++)
    for (const k of [expected - d, expected + d])
      if (
        k >= 0 &&
        k < heard.length - 1 &&
        heard[k] === before.at(-1) &&
        heard[k + 1] === after[0]
      )
        return k;
  return -1;
}

/** Where a quote's silence goes: in the middle of the pause after word k, never inside a word (pure). */
export function quoteGapAt(
  words: readonly TimedWord[],
  k: number,
  seconds: number,
): Gap {
  const a = words[k]!.end;
  const b = words[k + 1]?.start ?? a;
  const at =
    b - a >= 0.1 ? (a + b) / 2 : a + Math.min(0.02, Math.max(0, b - a) / 2);
  return {
    at: Math.round(at * 1000) / 1000,
    seconds: Math.round(seconds * 1000) / 1000,
    kind: "quiet",
  };
}

/** A quote on the finished timeline: when its clip starts and ends, in seconds of the narration as rendered. */
export interface QuoteSlot {
  id: string;
  start: number;
  end: number;
}

/**
 * The gaps for prepared quotes and where each lands once all are in (pure). A quote whose boundary cannot be
 * found is left out (its id in `missing`): the caller takes it out of the script and voices again.
 */
export function planQuoteGaps(
  words: readonly TimedWord[],
  script: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line"> & {
    character_quotes?: CharacterQuote[];
  },
  clips: ReadonlyArray<{ id: string; seconds: number }>,
): { gaps: Gap[]; slots: QuoteSlot[]; missing: string[] } {
  const placed: Array<{ id: string; gap: Gap }> = [];
  const missing: string[] = [];
  for (const q of script.character_quotes ?? []) {
    const clip = clips.find((c) => c.id === q.id);
    if (!clip) continue;
    const k = quoteBoundary(words, script, q);
    if (k < 0) {
      missing.push(q.id);
      continue;
    }
    placed.push({ id: q.id, gap: quoteGapAt(words, k, clip.seconds) });
  }
  placed.sort((a, b) => a.gap.at - b.gap.at);
  const spans = gapSpans(placed.map((p) => p.gap));
  return {
    gaps: placed.map((p) => p.gap),
    slots: placed.map((p, i) => ({
      id: p.id,
      start: spans[i]!.start,
      end: spans[i]!.end,
    })),
    missing,
  };
}

/** Puts the quotes' silences into the voice file and returns the shifted timings and where each quote plays. */
export async function openQuoteGaps(
  file: string,
  words: TimedWord[],
  durationSeconds: number,
  script: Parameters<typeof planQuoteGaps>[1],
  clips: ReadonlyArray<{ id: string; seconds: number }>,
): Promise<{
  words: TimedWord[];
  durationSeconds: number;
  slots: QuoteSlot[];
  missing: string[];
}> {
  const plan = planQuoteGaps(words, script, clips);
  if (!plan.gaps.length)
    return { words, durationSeconds, slots: [], missing: plan.missing };
  await insertSilence(file, plan.gaps);
  return {
    words: openWords(words, plan.gaps),
    durationSeconds:
      durationSeconds + plan.gaps.reduce((n, g) => n + g.seconds, 0),
    slots: plan.slots,
    missing: plan.missing,
  };
}

