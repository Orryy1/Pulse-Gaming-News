// The sound editor's beats, shared by every long format's writer (31 Oct 2026): the documentary's shot list
// asks for them, and since then the ranking's too (src/editorial/longform.ts). The kinds and the grounding
// live here so the two writers can share them without importing each other.

/**
 * The sound editor's beats (30 Oct 2026): a sentence the mix should react to. The music ducks before a
 * reveal, drops out under the chapter's key line, a sting marks a record, the bed changes on a turn and
 * the narrator leaves a breath after a quiet line (src/render/musicplan.ts, src/voice/pauses.ts).
 */
export const DOC_BEAT_KINDS = [
  "none",
  "reveal",
  "key",
  "record",
  "turn",
  "quiet",
] as const;
export type DocBeat = (typeof DOC_BEAT_KINDS)[number];
/** At most this many beats a chapter survive grounding (the writer is asked for three). */
export const DOC_BEATS_MAX = 4;

// A sentence earns a beat when it carries a figure (digits or a counting word), a quote (quotation marks or a
// speech verb) or a superlative. "one", "two" and "first time"-style phrases are too common to count on their own.
const BEAT_FIGURE =
  /\d|\b(hundred|thousand|million|billion|dozen|twice|double|triple|half|quarter|per ?cent|percent)\b/i;
const BEAT_QUOTE =
  /["“”]|\b(said|says|told|wrote|called it|admitted|recalled|described it|put it|in (his|her|their) words)\b/i;
const BEAT_SUPERLATIVE =
  /\b(biggest|largest|smallest|fastest|slowest|highest|lowest|longest|shortest|best|worst|most|least|first|last|only|record|ever|never|greatest|earliest|latest|newest|oldest|richest|cheapest|strongest|weakest|hardest|easiest|busiest|loudest|deepest|widest|heaviest|youngest|unprecedented|all-time|all time|top-selling|best-selling|bestselling|fastest-selling)\b/i;

/** Whether a sentence carries what a beat needs: a figure, a quote or a superlative. */
export function beatGrounded(sentence: string | undefined): boolean {
  const s = sentence ?? "";
  return BEAT_FIGURE.test(s) || BEAT_QUOTE.test(s) || BEAT_SUPERLATIVE.test(s);
}

/**
 * The beats a chapter keeps (pure): never on its first sentence (under the title card), never on two
 * sentences in a row, only where the sentence carries a figure, a quote or a superlative, one "key" at
 * most (the first wins) and DOC_BEATS_MAX in all, in sentence order. Everything else reads "none".
 */
export function groundBeats<T extends { beat?: DocBeat }>(
  moments: T[],
  sentences?: string[],
): { moments: T[]; removed: string[] } {
  const removed: string[] = [];
  let kept = 0;
  let keyed = false;
  let prev = false;
  const out = moments.map((m, i) => {
    const b = m.beat;
    if (!b || b === "none") {
      prev = false;
      return m.beat === undefined ? m : { ...m, beat: "none" as DocBeat };
    }
    const ok =
      i > 0 &&
      !prev &&
      kept < DOC_BEATS_MAX &&
      !(b === "key" && keyed) &&
      beatGrounded(sentences?.[i]);
    if (!ok) {
      removed.push(`${b}: ${(sentences?.[i] ?? "").slice(0, 60)}`);
      prev = false;
      return { ...m, beat: "none" as DocBeat };
    }
    kept++;
    if (b === "key") keyed = true;
    prev = true;
    return m;
  });
  return { moments: out, removed };
}
