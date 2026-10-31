// House phrasing that must not turn into a tic. "Our read:" opened the opinion line in most
// Shorts and every pinned comment; viewers notice a stock phrase repeated across a channel.
// These helpers vary the frame by a stable seed (the same story always gets the same words).
import type { Script } from "./schema.ts";

const STOCK_OPENER = /^\s*our read\s*[:,-]?\s*/i;

/** Ways to introduce the channel's opinion in speech, each followed by the opinion itself. */
const SPOKEN = [
  "For us, ",
  "Honestly, ",
  // A full stop, not a colon: aloud a colon sounds like a slide label (audit, 28 Oct 2026).
  "Here's our take. ",
  "The way we see it, ",
  "We think ",
];

/** Ways to introduce the opinion in a pinned comment, each followed by the on-screen take. */
const WRITTEN = [
  "Our take:",
  "Where we land:",
  "The short version:",
  "Bottom line:",
  "Our verdict:",
];

function pick<T>(list: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length]!;
}

/** A spoken opinion that opened with "Our read:" gets a different frame (lowercasing only a plain first word). */
export function varySpokenOpinion(text: string, seed: string): string {
  if (!STOCK_OPENER.test(text)) return text;
  const rest = text.replace(STOCK_OPENER, "");
  const lead = pick(SPOKEN, seed);
  const ends = lead.endsWith(". ");
  // "Bethesda has..." keeps its capital; "a slip this small..." / "This is..." read on naturally,
  // and after a full stop the opinion starts a sentence of its own.
  const body = ends
    ? rest[0]!.toUpperCase() + rest.slice(1)
    : /^(This|That|It|The|A|An|We|Our|There|Nothing|No)\b/.test(rest)
      ? rest[0]!.toLowerCase() + rest.slice(1)
      : rest;
  return lead + body;
}

/** The pinned comment's frame for the take, varied by story. */
export function writtenOpinionLead(seed: string): string {
  return pick(WRITTEN, seed);
}

/** Applies the spoken variation to a script's take and anything else that opened with the stock phrase. */
export function varyOpinion(script: Script, seed: string): Script {
  return {
    ...script,
    pulse_take: {
      ...script.pulse_take,
      narration: varySpokenOpinion(script.pulse_take.narration, seed),
      on_screen: script.pulse_take.on_screen.replace(STOCK_OPENER, ""),
      ...(script.pulse_take.label &&
      /^our read$/i.test(script.pulse_take.label.trim())
        ? { label: "THE TAKEAWAY" }
        : {}),
    },
  };
}

// ---------------------------------------------------------------- take shapes
// The news Shorts fell into one skeleton (audit of 60 videos, 28 Oct 2026): a concession, "But", "we
// think", then "[fact], so [question]?". 22 of 57 Shorts carried a concession. Each Short now gets one
// take shape by a stable seed, and the validator counts the concession and the fact-comma-question
// close as shapes against the recent Shorts.

export type TakeShapeId =
  | "concession"
  | "comparison"
  | "consequence"
  | "what_next"
  | "verdict";

export interface TakeShape {
  id: TakeShapeId;
  /** What the writer is told the take should do. */
  rule: string;
}

export const TAKE_SHAPES: TakeShape[] = [
  {
    id: "concession",
    rule: "a concession then a verdict: grant the other side one point in a few words of your own, then say plainly where we land",
  },
  {
    id: "comparison",
    rule: "a comparison: set this against one named earlier game, price, date or rival and say which way it cuts",
  },
  {
    id: "consequence",
    rule: "a consequence for the viewer: what this does to their money, their console, their save or their weekend",
  },
  {
    id: "what_next",
    rule: "what happens next: the next date, decision or announcement to watch and what it would mean",
  },
  {
    id: "verdict",
    rule: "a plain verdict: what we think in one sentence, then the single reason",
  },
];

/**
 * This Short's take shape, the same for the same story. A concession is one shape in five, and never
 * when one of the last two Shorts already used one (so at most one Short in three carries one).
 */
export function takeShapeFor(
  seed: string,
  recentConcessions: boolean[] = [],
): TakeShape {
  const shape = pick(TAKE_SHAPES, seed);
  if (shape.id !== "concession" || !recentConcessions.slice(0, 2).some(Boolean))
    return shape;
  return pick(
    TAKE_SHAPES.filter((x) => x.id !== "concession"),
    `${seed}:again`,
  );
}

// A concession opens a sentence. Single words count only when a "But" sentence answers them later
// ("Yes, it's 300GB. But..."); a plain "Yes," often just answers the desk question.
const CONCESSION_PHRASE =
  /(?:^|[.!?]["”]?\s+)(?:fair enough|to be fair|in fairness|credit where it'?s due|credit to)\b/i;
const CONCESSION_WORD =
  /(?:^|[.!?]["”]?\s+)(?:sure|yes|granted|admittedly|true|okay)\s*,/i;

/** Whether a script (or the start of one) carries the concession shape. */
export function hasConcession(text: string): boolean {
  if (CONCESSION_PHRASE.test(text)) return true;
  const m = CONCESSION_WORD.exec(text);
  if (!m) return false;
  return /(?:^|[.!?]["”]?\s+)But\b/.test(text.slice(m.index + m[0].length));
}

/**
 * Whether a closing line is the "[fact], [question]?" shape: "After 2 million copies, which Metal Gear
 * would you want next?", "Before GTA 6 eats 210GB, which game are you deleting first?". A fork
 * ("Day one, or wait?") is a different shape.
 */
export function isFactCommaQuestion(line: string): boolean {
  return /^[^?]{12,}?,\s+(?:so\s+|and\s+|but\s+)?(?:which|what|what's|whats|will|would|do|does|did|are|is|how|who|where|when|should|can|could|has|have)\b[^?]*\?["”]?$/i.test(
    line.trim(),
  );
}
