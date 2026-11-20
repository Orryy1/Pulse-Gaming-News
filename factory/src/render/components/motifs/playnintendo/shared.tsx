// Shared bits for the PlayStation and Nintendo homage motifs (../PlayNintendo.tsx): the card clock, text
// fitting, small glyphs and the platform reading every matches() uses. Pure functions of their inputs
// and the frame; any randomness is seeded from the variant.
import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { displayText } from "../../../timeline.ts";
import { linesNeeded, seeded } from "../../packs/game/kit.tsx";
import type { MotifGame } from "../types.ts";

export { linesNeeded, seeded };

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** En and em dashes (built from char codes so no long dash sits in the source). */
const DASHES = new RegExp(
  "\\s*[" + String.fromCharCode(0x2013, 0x2014) + "]\\s*",
  "g",
);

/** Text from props made safe for the screen: "percent" as %, long dashes as a spaced hyphen, single spaces. */
export const clean = (t: string | undefined | null): string =>
  displayText(String(t ?? ""))
    .replace(DASHES, " - ")
    .replace(/\s+/g, " ")
    .trim();

export const words = (t: string): number =>
  t.split(/\s+/).filter(Boolean).length;
export const longestWord = (t: string): number =>
  t.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);

/** A card's clock: frame, fps, its length and the fade (in over 4 frames, out over the last 10). */
export function useCard(frames: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const len = Math.max(40, Math.round(frames || 120));
  const fade = Math.min(
    interpolate(frame, [0, 4], [0, 1], clamp),
    interpolate(frame, [len - 10, len], [1, 0], clamp),
  );
  return { frame, fps, len, fade };
}

/** The largest of `sizes` at which the text wraps to at most `lines` lines in `width` (em: glyph width). */
export function fit(
  text: string,
  width: number,
  lines: number,
  sizes: number[],
  em = 0.56,
): number {
  for (const s of sizes) if (linesNeeded(text, width, s, em) <= lines) return s;
  return sizes[sizes.length - 1] ?? 32;
}

/** Clamp a block of text to n lines, a last guard against overflow. */
export const lineClamp = (n: number): React.CSSProperties => ({
  display: "-webkit-box",
  WebkitLineClamp: n,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});

/** "Game  ·  2004" from props, leaving out the game when the heading already names it. */
export function metaLine(p: {
  heading: string;
  game?: string;
  year?: string;
}): string {
  const heading = clean(p.heading).toLowerCase();
  const game = clean(p.game);
  const year = clean(p.year);
  return [game && !heading.includes(game.toLowerCase()) ? game : "", year]
    .filter(Boolean)
    .join("  ·  ");
}

/** The game's title from props, or "" when the heading already names it. */
export function gameLine(p: { heading: string; game?: string }): string {
  const game = clean(p.game);
  return game && !clean(p.heading).toLowerCase().includes(game.toLowerCase())
    ? game
    : "";
}

/** Room for a glow around clamped text: the clamp clips at its box, so pad the box and pull it back. */
export const glowRoom = (px: number): React.CSSProperties => ({
  padding: px,
  margin: -px,
});

/** "Name: value" rows split at the first colon, both sides cleaned. */
export function splitPairs(items: string[]): Array<{ a: string; b: string }> {
  return items
    .map((x) => {
      const t = clean(x);
      const i = t.indexOf(":");
      return i > 0
        ? { a: t.slice(0, i).trim(), b: t.slice(i + 1).trim() }
        : undefined;
    })
    .filter((x): x is { a: string; b: string } => Boolean(x && x.a && x.b));
}

/** Two letters for a name, for a seal when there is no portrait. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

// ---------------------------------------------------------------------------------------------------
// Reading platforms. Each platform in the list is one token ("PS2", "PlayStation 2", "Nintendo DS");
// a console matches a whole token, never a fragment, so "DS" is never found inside another word.

const strip = (t: string) =>
  t
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[™®]/g, "")
    .replace(/\b(sony|nintendo)\b/g, " ")
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "PS2, PC, Xbox" -> ["ps2", "pc", "xbox"]; "Nintendo 3DS" -> ["3ds"]. */
export function platformTokens(platforms: string | undefined): string[] {
  return String(platforms ?? "")
    .split(/[,;/|&+\n]|\band\b/i)
    .map(strip)
    .filter(Boolean);
}

const T = {
  ps1: /^(ps ?(1|one)|psx|psone|playstation ?(1|one)|original playstation)$/,
  ps2: /^(ps ?2|playstation ?2)$/,
  ps3: /^(ps ?3|playstation ?3)$/,
  psp: /^(psp( go)?|playstation portable)$/,
  wii: /^wii( ?ware| virtual console)?$/,
  ds: /^(new )?(n?ds|dsi|[23]ds)( ?(lite|xl|ll|ware))?$/,
  sw: /^(switch( ?2| oled| lite)?|nsw)$/,
};

const knownYear = (y: number | undefined): y is number =>
  typeof y === "number" && Number.isFinite(y) && y > 1950;
const themeOf = (g: MotifGame) => clean(g.theme).toLowerCase();
const titleOf = (g: MotifGame) => clean(g.title).toLowerCase();
const has = (g: MotifGame, re: RegExp) =>
  platformTokens(g.platforms).some((t) => re.test(t));

/** The original PlayStation, 2001 or earlier: "PS1", "PSX", "PlayStation 1", or a bare "PlayStation" of its era. */
export function isPs1(g: MotifGame): boolean {
  const y = g.year;
  if (knownYear(y) && y > 2001) return false;
  if (has(g, T.ps1)) return true;
  if (knownYear(y) && has(g, /^playstation$/)) return true;
  const th = themeOf(g);
  if (
    /\b(ps ?(1|one)|psx|psone|playstation ?(1|one)|original playstation)\b/.test(
      th,
    )
  )
    return true;
  return knownYear(y) && /^(sony )?playstation$/.test(th);
}

export function isPs2(g: MotifGame): boolean {
  return has(g, T.ps2) || /\b(ps ?2|playstation ?2)\b/.test(themeOf(g));
}

export function isPs3OrPsp(g: MotifGame): boolean {
  return (
    has(g, T.ps3) ||
    has(g, T.psp) ||
    /\b(ps ?3|playstation ?3|psp|playstation portable)\b/.test(themeOf(g))
  );
}

/** The Wii, never the Wii U. */
export function isWii(g: MotifGame): boolean {
  const notU = /\bwii\b(?!\s*-?\s*u\b)/;
  return has(g, T.wii) || notU.test(themeOf(g)) || notU.test(titleOf(g));
}

/** Nintendo's two-screen handhelds: DS, DSi, 3DS and 2DS. */
export function isDualScreen(g: MotifGame): boolean {
  const re = /\bnintendo (new )?(dsi?|[23]ds)\b|\b(new )?[23]ds\b|\bdsi\b/;
  const th = themeOf(g);
  return (
    has(g, T.ds) ||
    re.test(th) ||
    /^ds$/.test(th) ||
    re.test(titleOf(g)) ||
    /\b(ds|3ds)$/.test(titleOf(g))
  );
}

/** The Switch (and Switch 2): its own games from 2017 on, or a video about the console. */
export function isSwitch(g: MotifGame): boolean {
  const th = themeOf(g);
  if (/\bnintendo switch\b|\bswitch 2\b|^switch$/.test(th)) return true;
  if (/\bnintendo switch\b/.test(titleOf(g))) return true;
  if (!has(g, T.sw)) return false;
  return !knownYear(g.year) || g.year >= 2017;
}
