// GAME_LOOK (default off): a video's graphics take on its game's own visual identity, from a per-game style
// profile (src/render/gamelooks.data.ts, built by src/tools/gamelook-build.ts): a palette taken from the game's key art
// and logo, corner treatments and accents in the style of its UI, HUD-like framing, and a display face matched in
// style from a free licensed font (SIL OFL, shipped in public/fonts), never the game's own font files. Pulse's
// marks stay Pulse's: the logo, the watermark and the end card never change.
//
// The profile reaches the graphics through LookContext: the shared house primitives (Stage, Label, the small
// card's figure, the maps) read their accent and plate colour from it, the frame (GameLookFrame) draws the
// corners and HUD over every full-screen graphic, and the chapter card (GameLookCard) is drawn in the look.
// With no provider the context is Pulse's own look, so nothing changes while GAME_LOOK is off.

import React from "react";
import { COLOUR } from "./brand.ts";
import type { Face } from "./components/packs/fit.ts";
import { PROFILES } from "./gamelooks.data.ts";

export type LookCorner =
  | "none"
  | "chamfer"
  | "bracket"
  | "pixel"
  | "ornate"
  | "scratch";
export type LookHud = "none" | "minimap" | "stamina" | "pixel" | "vhs";

/** A display face in public/fonts, matched in style: never a game's own font file. */
export interface LookFont {
  family: string;
  /** In public/fonts. */
  file: string;
  weight: string;
  licence: string;
  /** The nearest face the fit estimates know (src/render/components/packs/fit.ts), and this face's width against it. */
  face: Face;
  scale: number;
  /** Set in capitals. */
  caps: boolean;
}

export const LOOK_FONTS: Record<string, LookFont> = {
  anton: {
    family: "PulseDisplay",
    file: "anton-latin-400-normal.woff2",
    weight: "400",
    licence: "OFL",
    face: "anton",
    scale: 1,
    caps: true,
  },
  bebas: {
    family: "LookBebas",
    file: "bebas-neue-latin-400-normal.woff2",
    weight: "400",
    licence: "OFL",
    face: "anton",
    scale: 0.86,
    caps: true,
  },
  cinzel: {
    family: "LookCinzel",
    file: "cinzel-latin-700-normal.woff2",
    weight: "700",
    licence: "OFL",
    face: "serif",
    scale: 1.32,
    caps: true,
  },
  pressstart: {
    family: "LookPressStart",
    file: "press-start-2p-latin-400-normal.woff2",
    weight: "400",
    licence: "OFL",
    face: "mono",
    scale: 1.62,
    caps: true,
  },
  imfell: {
    family: "LookImFell",
    file: "im-fell-english-sc-latin-400-normal.woff2",
    weight: "400",
    licence: "OFL",
    face: "serif",
    scale: 1.08,
    caps: true,
  },
};

export interface GameLook {
  id: string;
  /** Plain-English name for logs and previews. */
  name: string;
  /** Whole titles (and short forms) the profile belongs to. */
  titles: string[];
  /** Identity colour: rules, pins, figures, kickers. Readable on ink (at least 4.5:1). */
  accent: string;
  /** A second colour for small accents. */
  accent2: string;
  /** Plates and panels. */
  ink: string;
  /** Text. */
  paper: string;
  muted: string;
  display: keyof typeof LOOK_FONTS | string;
  corner: LookCorner;
  hud: LookHud;
  /** Where the palette came from, for the record. */
  source?: { art: string; logo?: string; built: string };
}

/** Pulse's own look: what every graphic draws with when GAME_LOOK is off or the game has no profile. */
export const PULSE_LOOK: GameLook = {
  id: "pulse",
  name: "Pulse",
  titles: [],
  accent: COLOUR.amber,
  accent2: COLOUR.gold,
  ink: COLOUR.ink,
  paper: COLOUR.paper,
  muted: COLOUR.muted,
  display: "anton",
  corner: "none",
  hud: "none",
};

export const GAME_LOOKS: GameLook[] = PROFILES;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The profile for a game, by whole title or listed short form; none for anything else. */
export function gameLookFor(
  title: string | undefined,
  looks: GameLook[] = GAME_LOOKS,
): GameLook | undefined {
  const t = norm(title ?? "");
  if (!t) return undefined;
  return looks.find((l) => l.titles.some((x) => norm(x) === t));
}

export const LookContext = React.createContext<GameLook>(PULSE_LOOK);

export function useLook(): GameLook {
  return React.useContext(LookContext);
}

/** A profile's display face (Pulse's Anton when it names one not shipped). */
export function lookFont(look: GameLook): LookFont {
  return LOOK_FONTS[look.display] ?? LOOK_FONTS.anton!;
}

/** "#rrggbb" as rgba() with an alpha. */
export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
