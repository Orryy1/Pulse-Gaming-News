// Shared materials for the Paper pack (../GfxPaper.tsx): paper grain, sheets with lifted corners, marker
// write-on, pushpins, masking tape and the ILLUSTRATION tag. Grain is a small SVG noise tile drawn once by
// the browser and repeated, so it costs nothing per frame. Everything is a pure function of its props.

import React from "react";
import { BODY } from "../../fonts.ts";
import { displayText } from "../../../timeline.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
/** A typewriter face: every glyph is the same width, so positions work in `ch` units. */
export const TYPEFACE =
  "'Courier New', Courier, 'Nimbus Mono PS', 'Liberation Mono', monospace";
export const SERIF = "Georgia, 'Times New Roman', serif";
export const INK = "#1d1b18";
export const RED_PEN = "#c8261e";

/** Text from the graphic, display-ready, on one line with single spaces. */
export const clean = (s: string | undefined) =>
  displayText(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
export const wordCount = (s: string) => (s ? s.split(" ").length : 0);

/** A stable 0..1 number for (seed, i): every "random" choice in the pack comes from here, never Math.random. */
export function rnd(seed: number, i: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^
      Math.imul((i | 0) + 0x632be5ab, 0x85ebca6b)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** -1..1 */
export const jit = (seed: number, i: number) => rnd(seed, i) * 2 - 1;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const svgUri = (svg: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

/** Fine dark paper fibres and specks, a 240 px tile. */
export const GRAIN = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='g' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.07  1.5 0 0 0 -0.62'/></filter>" +
    "<rect width='240' height='240' filter='url(#g)'/></svg>",
);
/** Large soft blotches: the uneven tone of real paper, a 700 px tile. */
export const MOTTLE = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' width='700' height='700'><filter id='m' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.006' numOctaves='2' seed='3' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 0.45  0 0 0 0 0.36  0 0 0 0 0.2  0.4 0 0 0 -0.15'/></filter>" +
    "<rect width='700' height='700' filter='url(#m)'/></svg>",
);
/** Dry streaks along a marker stroke, light on dark: laid over a black bar it stays opaque. */
export const STREAKS = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='90'><filter id='s' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.004 0.16' numOctaves='2' seed='5' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.9 0 0 0 -0.42'/></filter>" +
    "<rect width='600' height='90' filter='url(#s)'/></svg>",
);
/** Rubber-stamp ink: mostly solid with small dry holes (a mask, white = ink). */
export const INK_MASK = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='k' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='2' seed='11' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -5 0 0 0 3.6'/></filter>" +
    "<rect width='200' height='200' filter='url(#k)'/></svg>",
);

/** Light falling across a sheet from the top left, darker at the far edges: it reads as a slight curl. */
export const SHEET_LIGHT =
  "radial-gradient(135% 105% at 32% 22%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 48%, rgba(60,42,18,0.13) 100%)";
export const paperLayers = (extra?: string) =>
  [GRAIN, MOTTLE, SHEET_LIGHT, extra].filter(Boolean).join(", ");

/**
 * A sheet of paper with lifted corners: the shadow is deeper under the bottom corners, as real paper
 * curls up off a surface. `lift` (0..1) raises it, for things still landing.
 */
export const Sheet: React.FC<{
  width: number | string;
  tone?: string;
  lift?: number;
  style?: React.CSSProperties;
  outer?: React.CSSProperties;
  extraLayer?: string;
  children?: React.ReactNode;
}> = ({
  width,
  tone = "#f4efe3",
  lift = 0,
  style,
  outer,
  extraLayer,
  children,
}) => {
  const corner = (side: "left" | "right"): React.CSSProperties => ({
    position: "absolute",
    [side]: 26,
    bottom: 18 + 8 * lift,
    width: "40%",
    height: 46,
    transform: `rotate(${side === "left" ? -2.4 : 2.4}deg)`,
    boxShadow: `0 ${18 + 26 * lift}px ${16 + 22 * lift}px rgba(0,0,0,${0.55 - 0.15 * lift})`,
  });
  return (
    <div style={{ position: "relative", width, ...outer }}>
      <div style={corner("left")} />
      <div style={corner("right")} />
      <div
        style={{
          position: "relative",
          width: "100%",
          boxSizing: "border-box",
          backgroundColor: tone,
          backgroundImage: paperLayers(extraLayer),
          boxShadow: `0 1px 2px rgba(0,0,0,0.35), 0 ${8 + 30 * lift}px ${26 + 40 * lift}px rgba(0,0,0,0.38)`,
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Marker or pen writing itself on, left to right, as `p` goes 0..1. */
export const Write: React.FC<{
  p: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ p, style, children }) => (
  <span
    style={{
      display: "inline-block",
      padding: "0.2em 0.25em",
      margin: "-0.2em -0.25em",
      clipPath: `inset(0 ${(1 - clamp01(p)) * 100}% 0 0)`,
      ...style,
    }}
  >
    {children}
  </span>
);

/** A red pushpin seen from above, with its shadow cast down and to the right. */
export const Pin: React.FC<{
  show: number;
  style?: React.CSSProperties;
  colour?: string;
}> = ({ show, style, colour = "#d7262e" }) => (
  <div
    style={{
      position: "absolute",
      width: 34,
      height: 34,
      marginLeft: -17,
      marginTop: -17,
      transform: `scale(${show})`,
      opacity: show > 0.02 ? 1 : 0,
      ...style,
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 10,
        top: 14,
        width: 34,
        height: 34,
        borderRadius: 17,
        background: "rgba(0,0,0,0.32)",
        filter: "blur(3px)",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 17,
        background: `radial-gradient(circle at 34% 30%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 22%), radial-gradient(circle at 40% 38%, ${colour} 0%, ${colour} 52%, rgba(60,0,0,0.9) 100%)`,
        boxShadow: "inset -2px -3px 5px rgba(0,0,0,0.35)",
      }}
    />
  </div>
);

/** Torn ends for a strip of tape, as a clip-path polygon (px from the edges, % down). */
function tornEdges(seed: number): string {
  const n = 7;
  const left: string[] = [];
  const right: string[] = [];
  for (let k = 0; k <= n; k++) {
    const y = (k / n) * 100;
    left.push(`${(k % 2 ? 0 : 5) + 3 * rnd(seed, k)}px ${y}%`);
    right.push(
      `calc(100% - ${(k % 2 ? 5 : 0) + 3 * rnd(seed, 40 + k)}px) ${100 - y}%`,
    );
  }
  return `polygon(${[...left, ...right].join(", ")})`;
}

/** Translucent masking tape with torn ends; children are written on it. */
export const Tape: React.FC<{
  seed?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ seed = 1, style, children }) => (
  <div
    style={{
      position: "relative",
      display: "inline-block",
      padding: "18px 46px 14px",
      backgroundColor: "rgba(232,221,188,0.94)",
      backgroundImage: `${GRAIN}, linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 40%, rgba(120,100,60,0.12) 100%)`,
      clipPath: tornEdges(seed),
      filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.35))",
      ...style,
    }}
  >
    {children}
  </div>
);

/** The small tag every recreated document carries. */
export const IllustrationTag: React.FC<{
  on?: "paper" | "dark";
  style?: React.CSSProperties;
}> = ({ on = "paper", style }) => (
  <div
    style={{
      display: "inline-block",
      padding: "5px 12px 4px",
      borderRadius: 6,
      border:
        on === "paper"
          ? "2px solid rgba(29,27,24,0.42)"
          : "2px solid rgba(245,245,242,0.5)",
      fontFamily: BODY,
      fontWeight: 800,
      fontSize: 22,
      letterSpacing: 3,
      lineHeight: 1.1,
      color: on === "paper" ? "rgba(29,27,24,0.66)" : "rgba(245,245,242,0.8)",
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    ILLUSTRATION
  </div>
);

export type MonoLine = { text: string; start: number };

/**
 * Greedy word wrap for a monospaced face: lines of at most `maxChars`, each with its offset into `text`
 * (which must have single spaces). Null when a single word is longer than a line.
 */
export function wrapMono(text: string, maxChars: number): MonoLine[] | null {
  const lines: MonoLine[] = [];
  let cur = "";
  let start = 0;
  let pos = 0;
  for (const w of text.split(" ")) {
    if (w.length > maxChars) return null;
    if (!cur) {
      cur = w;
      start = pos;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ` ${w}`;
    } else {
      lines.push({ text: cur, start });
      cur = w;
      start = pos;
    }
    pos += w.length + 1;
  }
  if (cur) lines.push({ text: cur, start });
  return lines;
}

/** Lines a proportional face needs at `size` px in `width` px, `em` being its average letter width. */
export function linesAt(
  text: string,
  width: number,
  size: number,
  em: number,
): number {
  const per = Math.max(1, Math.floor(width / (size * em)));
  let lines = 1;
  let cur = 0;
  for (const w of text.split(" ")) {
    if (w.length > per) return Infinity;
    const need = cur ? cur + 1 + w.length : w.length;
    if (need > per) {
      lines++;
      cur = w.length;
    } else cur = need;
  }
  return lines;
}

/** The marker face (Permanent Marker) runs about 0.62 em a letter. The biggest size that fits a box. */
export function handFit(
  text: string,
  w: number,
  h: number,
  max: number,
  min = 30,
  lineHeight = 1.12,
): number {
  for (let f = max; f > min; f -= 2) {
    if (linesAt(text, w, f, 0.62) * f * lineHeight <= h) return f;
  }
  return min;
}
