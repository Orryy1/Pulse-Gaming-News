// The rank card on a ranked Short (owner, 4 Nov 2026: "items not being on the screen anywhere near long enough to
// read whatsoever"). The 29 Oct rule that a card lands on its word and holds 2.5 s is right for small supporting
// graphics, but a ranking's card is what the viewer came to read: it now stays from the start of its entry to the
// start of the next. Its text comes from a size ladder with a floor, so it is never tiny and never clipped. Pure
// functions, so the card, the writer's grounding and the gate agree.

import type { Segment } from "./timeline.ts";
import { fitBlock, fits, wrapText } from "./components/packs/fit.ts";
import { CARD_WIDTH } from "./layout.ts";

/** The card's top on a clean Short, under the logo row and well above the middle of the frame, where the subject sits. */
export const ENTRY_CARD_TOP = 290;
/** On the full-chrome Short the progress rule owns y 300-352. */
export const ENTRY_CARD_TOP_CHROME = 372;
/** Everything on the card is at least this big (px on the 1080-wide Short: about 13 pt on a phone). */
export const ENTRY_TEXT_FLOOR = 34;
export const REQUIREMENT_SIZES = [50, 48, 46, 44, 42];
export const REQUIREMENT_MAX_LINES = 3;
export const REQUIREMENT_LINE_HEIGHT = 1.16;
export const NAME_SIZES = [84, 76, 68, 62, 56];
export const NAME_MAX_LINES = 3;
export const BADGE_SIZE = 130;
export const ART_GAP = 24;
/** A card may start and end this far inside its entry: its entrance plus a hair (seconds). */
export const ENTRY_HOLD_MARGIN = 0.35;

/** The width left for the name beside the badge and the art. */
export const nameWidth = (hasArt: boolean, artWidth = BADGE_SIZE) =>
  CARD_WIDTH - BADGE_SIZE - ART_GAP - (hasArt ? artWidth + ART_GAP : 0);

export const isEntryCard = (s: Pick<Segment, "kind" | "visual">): boolean =>
  s.kind === "beat" &&
  s.visual?.kind === "rank" &&
  typeof s.visual.value_a === "number";

/** The requirement's size and lines: the largest of the ladder that wraps to three lines across the card. */
export function fitRequirement(text: string): {
  size: number;
  lines: string[];
  fits: boolean;
} {
  return fitBlock(text, "inter", {
    maxWidth: CARD_WIDTH,
    sizes: REQUIREMENT_SIZES,
    maxLines: REQUIREMENT_MAX_LINES,
    lineHeight: REQUIREMENT_LINE_HEIGHT,
  });
}

/** The name's size and lines beside the badge and the art. */
export function fitName(
  title: string,
  hasArt: boolean,
  artWidth?: number,
): { size: number; lines: string[]; fits: boolean } {
  return fitBlock(title.toUpperCase(), "anton", {
    maxWidth: nameWidth(hasArt, artWidth),
    sizes: NAME_SIZES,
    maxLines: NAME_MAX_LINES,
    lineHeight: 1.02,
  });
}

/**
 * A requirement the card can always show: as written when it fits; otherwise cut at a sentence or a clause; otherwise
 * at a word, with a mark that says so. Never a smaller size than the ladder's floor.
 */
export function cardRequirement(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || fitRequirement(clean).fits) return clean;
  const clauses = clean.split(/(?<=[.;,:])\s+/);
  for (let n = clauses.length - 1; n >= 1; n--) {
    const piece = clauses
      .slice(0, n)
      .join(" ")
      .replace(/[,;:]$/, "");
    if (fitRequirement(piece).fits)
      return /[.!?]$/.test(piece) ? piece : `${piece}.`;
  }
  const words = clean.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const piece = `${words
      .slice(0, n)
      .join(" ")
      .replace(/[,;:.]$/, "")}...`;
    if (fitRequirement(piece).fits) return piece;
  }
  return "";
}

/** The size for a card's small line in `width`: one line from the ladder down to the floor, or the floor on two. */
export function fitMeta(
  text: string,
  width: number,
  spacing = 1,
): { size: number; lines: number } {
  for (const size of [40, 38, 36, ENTRY_TEXT_FLOOR])
    if (fits(text, "inter", size, width, spacing)) return { size, lines: 1 };
  return {
    size: ENTRY_TEXT_FLOOR,
    lines: (
      wrapText(text, "inter", ENTRY_TEXT_FLOOR, width, spacing) ?? ["", ""]
    ).length,
  };
}

export interface EntryHold {
  segment: number;
  primary: string;
  /** The entry's length and how long its card is up, in seconds. */
  entrySeconds: number;
  holdSeconds: number;
}

/** Each rank card's time on screen against its entry, from the spans as they will be drawn. */
export function entryHolds(
  segments: Segment[],
  kept: Array<{ key: string; from: number; to: number }>,
  fps: number,
  totalFrames: number,
): EntryHold[] {
  const out: EntryHold[] = [];
  segments.forEach((s, i) => {
    if (!isEntryCard(s)) return;
    const start = i === 0 ? 0 : Math.round(s.start * fps);
    const end =
      i === segments.length - 1
        ? totalFrames
        : Math.round(segments[i + 1]!.start * fps);
    const span = kept.find((k) => k.key === `card${i}`);
    out.push({
      segment: i,
      primary: s.visual!.primary,
      entrySeconds: (end - start) / fps,
      holdSeconds: span ? (span.to - span.from) / fps : 0,
    });
  });
  return out;
}

/** The gate: a card that leaves before its entry ends, or text the card can't show at a readable size. */
export function entryCardProblems(
  holds: EntryHold[],
  segments: Segment[],
): string[] {
  const p: string[] = [];
  for (const h of holds)
    if (h.holdSeconds < h.entrySeconds - ENTRY_HOLD_MARGIN)
      p.push(
        `rank card "${h.primary}" holds ${h.holdSeconds.toFixed(1)} s of its ${h.entrySeconds.toFixed(1)} s entry`,
      );
  for (const s of segments) {
    if (!isEntryCard(s)) continue;
    const need = s.visual!.items?.[2];
    if (need && !fitRequirement(need).fits)
      p.push(
        `rank card "${s.visual!.primary}": the requirement does not fit three readable lines ("${need.slice(0, 60)}")`,
      );
  }
  return p;
}

// ------------------------------------------------------------- Buy, Wait or Skip's two-column card
// (format plan item 7): who should buy on the left in the accent, who should pass on the right, each in readable
// type from a ladder with the same floor as the rank card. The writer's card lines are 3-7 words; a longer one is
// cut at a word with a mark, never shrunk below the floor.

/** The gap between the two columns and each column's inner padding (px on the 1080-wide Short). */
export const BUY_PASS_GAP = 28;
export const BUY_PASS_PAD = 26;
export const BUY_PASS_SIZES = [56, 52, 48, 44, 40, ENTRY_TEXT_FLOOR];
export const BUY_PASS_MAX_LINES = 4;
/** Each column's text width. */
export const buyPassWidth = () =>
  Math.floor((CARD_WIDTH - BUY_PASS_GAP) / 2) - 2 * BUY_PASS_PAD;

export interface BuyPassColumn {
  label: string;
  text: string;
  size: number;
  lines: string[];
}

/**
 * The card's columns (pure) when a versus card's rows are "Buy if" and "Pass if" (or skip/wait if), as
 * src/editorial/verdict.ts writes them; undefined for any other versus card, which keeps the VS layout.
 */
export function buyPassColumns(
  items: string[] | undefined,
): { buy: BuyPassColumn; pass: BuyPassColumn } | undefined {
  const rows = (items ?? [])
    .map((raw) => {
      const i = raw.indexOf(":");
      return i < 0
        ? undefined
        : { label: raw.slice(0, i).replace(/^\*/, "").trim(), text: raw.slice(i + 1).trim() };
    })
    .filter((r): r is { label: string; text: string } => Boolean(r?.label && r.text));
  const buy = rows.find((r) => /^buy\b/i.test(r.label));
  const pass = rows.find((r) => /^(pass|skip|wait)\b/i.test(r.label));
  if (!buy || !pass || rows.length !== 2) return undefined;
  const column = (r: { label: string; text: string }): BuyPassColumn => {
    const width = buyPassWidth();
    let text = r.text;
    let fit = fitBlock(text, "inter", { maxWidth: width, sizes: BUY_PASS_SIZES, maxLines: BUY_PASS_MAX_LINES, lineHeight: 1.12 });
    const words = r.text.split(/\s+/);
    for (let n = words.length - 1; !fit.fits && n >= 1; n--) {
      text = `${words.slice(0, n).join(" ").replace(/[,;:.]$/, "")}...`;
      fit = fitBlock(text, "inter", { maxWidth: width, sizes: BUY_PASS_SIZES, maxLines: BUY_PASS_MAX_LINES, lineHeight: 1.12 });
    }
    return { label: r.label.toUpperCase(), text, size: fit.size, lines: fit.lines };
  };
  return { buy: column(buy), pass: column(pass) };
}
