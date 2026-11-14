// Shared bits of the Xbox motifs (../Xbox.tsx): era matching, seeded randomness, fades and text fitting.
import { interpolate } from "remotion";
import { displayText } from "../../../timeline.ts";
import type { MotifGame } from "../types.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** A seeded generator in [0, 1): the same variant always draws the same scene. */
export function rng(seed: number): () => number {
  let a = (Math.floor(Math.abs(seed)) * 2654435761 + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A card's opacity: in over 8 frames, out over the last 10. */
export function cardFade(frame: number, frames: number): number {
  const f = Math.max(40, frames);
  return interpolate(frame, [0, 8, f - 10, f], [0, 1, 1, 0], clamp);
}

/** Prop text as it should read on screen (percent signs and so on), trimmed. */
export const txt = (s?: string): string => (s ? displayText(s).trim() : "");

/** The first size whose length limit the text fits under, else the last size. */
export function sizeFor(text: string, ladder: Array<[number, number]>): number {
  for (const [max, size] of ladder) if (text.length <= max) return size;
  return ladder[ladder.length - 1]![1];
}

/** A label shrunk to fit a width (rough Inter caps metrics), never under `min`. */
export function fitLabel(
  text: string,
  width: number,
  max: number,
  min: number,
  em = 0.68,
): number {
  const want = width / Math.max(1, text.length * em);
  return Math.max(min, Math.min(max, Math.floor(want)));
}

/** Labels without repeats (case-insensitive), empties dropped. */
export function uniq(list: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    const t = (x ?? "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** "label: value" split on the first colon (people, reviews, timeline rows). */
export function splitRow(x: string): { a: string; b: string } | undefined {
  const i = x.indexOf(":");
  if (i <= 0) return undefined;
  const a = txt(x.slice(0, i));
  const b = txt(x.slice(i + 1));
  return a && b ? { a, b } : undefined;
}

// ---------------------------------------------------------------------------------------------- eras

const RE_360 = /\bxbox\s*360\b|\bx360\b|\bxbox\s*live\s*arcade\b|\bxbla\b/i;
const RE_ONE = /\bxbox\s*one\b/i;
const RE_SERIES = /\bxbox\s*series\b/i;
const RE_ORIGINAL =
  /\b(original|first|classic)\s+xbox\b|\bxbox\s*\(\s*2001\s*\)|\bxbox\s+classic\b/i;
const RE_RROD = /\bred\s+ring\s+of\s+death\b|\brrod\b/i;
const RE_PS_MODERN = /\bps\s?[45]\b|\bplaystation\s*[45]\b/i;
const RE_SWITCH2 = /\bswitch\s*2\b/i;
/** The original Xbox's rivals: a plain "Xbox" listed beside these is the 2001 machine. */
const RE_SIXTH_GEN =
  /\bps2\b|\bplaystation\s*2\b|\bgame\s*cube\b|\bdreamcast\b|\bgame\s*boy\s*advance\b|\bgba\b/i;

/** "Xbox" named on its own, not as the 360, One, Series or a service. */
export function plainXbox(t: string): boolean {
  const s = t.replace(
    /\bxbox\s*(360|one|series(\s*[xs](\s*[|/]\s*s)?)?|live(\s*arcade)?|game\s*pass|cloud(\s*gaming)?|wire|play\s*anywhere|game\s*studios|store)\b/gi,
    " ",
  );
  return /\bxbox\b/i.test(s);
}

/** The game's year, else one written in its theme ("Xbox 360 (2005)"). */
export function gameYear(g: MotifGame): number | undefined {
  if (typeof g.year === "number" && Number.isFinite(g.year)) return g.year;
  const m = (g.theme ?? "").match(/\b(19[89]\d|20[0-3]\d)\b/);
  return m ? Number(m[1]) : undefined;
}

export function isOrbEra(g: MotifGame): boolean {
  const plat = g.platforms ?? "";
  const theme = g.theme ?? "";
  if (RE_ORIGINAL.test(g.title ?? "") || RE_ORIGINAL.test(theme)) return true;
  const inPlat = plainXbox(plat);
  if (!inPlat && !plainXbox(theme)) return false;
  const y = gameYear(g);
  if (y !== undefined) return y >= 2001 && y <= 2005;
  return inPlat && RE_SIXTH_GEN.test(plat);
}

export function isBladesEra(g: MotifGame): boolean {
  const plat = g.platforms ?? "";
  const theme = g.theme ?? "";
  const title = g.title ?? "";
  const rrod = RE_RROD.test(`${title} ${theme}`);
  const y = gameYear(g);
  if (y !== undefined)
    return (
      (RE_360.test(plat) || RE_360.test(theme) || rrod) &&
      y >= 2005 &&
      y <= 2008
    );
  // No year: the console itself (a hardware story), not a game that merely lists it.
  return rrod || RE_360.test(theme) || RE_360.test(title);
}

export function isNxeEra(g: MotifGame): boolean {
  const y = gameYear(g);
  if (y === undefined) return false;
  return (
    (RE_360.test(g.platforms ?? "") || RE_360.test(g.theme ?? "")) &&
    y >= 2008 &&
    y <= 2011
  );
}

export function isModernEra(g: MotifGame): boolean {
  const plat = g.platforms ?? "";
  const theme = g.theme ?? "";
  const y = gameYear(g);
  const modernXbox =
    RE_ONE.test(plat) ||
    RE_SERIES.test(plat) ||
    RE_ONE.test(theme) ||
    RE_SERIES.test(theme);
  if (modernXbox) return y === undefined || y >= 2013;
  if (y === undefined || y < 2013) return false;
  return (
    RE_PS_MODERN.test(plat) ||
    RE_SWITCH2.test(plat) ||
    RE_PS_MODERN.test(theme) ||
    RE_SWITCH2.test(theme) ||
    plainXbox(plat)
  );
}
