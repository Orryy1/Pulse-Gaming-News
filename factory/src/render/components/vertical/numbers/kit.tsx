// Shared pieces for the vertical Numbers styles (../VNumbers.tsx): the beat's timing (build, hold, exit over
// the last 10 frames), type fitting from Anton's measured widths, colour mixing for an accent of any hue,
// letters cut from a picture, the label line and a soft dark pool that keeps a figure readable over footage.
// Everything is a pure function of the frame and the props.
import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import { displayText } from "../../../timeline.ts";
import {
  ANTON,
  fitText,
  textEm,
  type Metrics,
} from "../../motifs/franchises/shared.ts";
import { VBOX } from "../types.ts";

export { ANTON, textEm };
export const W = VBOX.width;
export const H = VBOX.height;

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const easeOut = Easing.out(Easing.cubic);
export const easeOutQuint = Easing.out(Easing.poly(5));

/** The two long dashes, built from char codes so the source never holds either character. */
const LONG_DASHES = new RegExp(
  `\\s*[${String.fromCharCode(0x2013, 0x2014)}]\\s*`,
  "g",
);

/** Text from the beat, screen-ready: percent as %, long dashes as a spaced hyphen, single spaces. */
export const clean = (s: string | undefined) =>
  displayText(String(s ?? ""))
    .replace(LONG_DASHES, " - ")
    .replace(/\s+/g, " ")
    .trim();

/** The beat's clock: the frame, and `out` going 1 to 0 over the last 10 frames. */
export function useBeat(len: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = Math.max(24, len);
  const out = interpolate(frame, [L - 10, L], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  return { frame, fps, out, visible: frame < L };
}

/** The exit every style shares: a lift, a slight shrink and a fade, all inside the last 10 frames. */
export const exitStyle = (out: number): React.CSSProperties => ({
  opacity: out,
  transform: `translateY(${(1 - out) * -26}px) scale(${0.96 + 0.04 * out})`,
});

/** The biggest Anton size at which `text` fits `width` (tracking in em). */
export const antonFit = (
  text: string,
  width: number,
  max: number,
  tracking = 0,
) =>
  Math.floor(
    Math.min(max, width / Math.max(0.2, textEm(text, ANTON, tracking))),
  );

/** Inter 900 capitals, roughly: wide letters, narrow spaces. Enough to choose a size and breaks. */
const INTER_CAPS: Metrics = {
  w: {
    " ": 0.26,
    I: 0.3,
    "1": 0.5,
    ".": 0.3,
    ",": 0.3,
    ":": 0.3,
    "'": 0.25,
    M: 0.92,
    W: 1.0,
  },
  avg: 0.72,
};

/** A label in Inter 900 capitals: the biggest size from `max` down to 34 that fits in `lines` lines. */
export function fitLabel(
  text: string,
  width: number,
  max = 46,
  lines = 2,
  tracking = 0.04,
) {
  return fitText(text.toUpperCase(), INTER_CAPS, {
    width,
    height: 9999,
    lineHeight: 1.12,
    maxLines: lines,
    maxSize: max,
    minSize: 34,
    tracking,
  });
}

/** Does a label fit at 34 px or more in `lines` lines of `width`? */
export function labelFits(text: string, width: number, lines = 2): boolean {
  if (!text) return true;
  const f = fitLabel(text, width, 46, lines);
  return f.lines.every(
    (l) => textEm(l, INTER_CAPS, 0.04) * f.size <= width + 2,
  );
}

/** Two colours mixed: t 0 is a, 1 is b. Hex in, hex out (#rgb and #rrggbb). */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => {
    let x = h.replace("#", "");
    if (x.length === 3)
      x = x
        .split("")
        .map((c) => c + c)
        .join("");
    const n = parseInt(x.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  const m = (u: number, v: number) => Math.round(u + (v - u) * t);
  return `#${[m(r1!, r2!), m(g1!, g2!), m(b1!, b2!)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** The accent at an alpha, for glows and washes. */
export function alpha(hex: string, a: number): string {
  let x = hex.replace("#", "");
  if (x.length === 3)
    x = x
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(x.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Letters cut from the picture: the picture (lifted so a dark frame still reads) inside the glyphs, a light
 * sheen sweeping across once (`sheen` -1..1, off the left edge to off the right). With no picture, the
 * letters are the accent shading to a pale highlight. `pos` places the picture ("50% 50%"), `size` sizes it.
 */
export function cutFrom(
  src: string | undefined,
  accent: string,
  sheen: number,
  pos = "50% 50%",
  size = "cover",
  angle = 100,
): React.CSSProperties {
  const sweep = `linear-gradient(${angle}deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0) 60%)`;
  const sheenPos = `${50 - sheen * 50}% 0%`;
  const base: React.CSSProperties = {
    color: "transparent",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    backgroundRepeat: "no-repeat",
  };
  if (!src)
    return {
      ...base,
      backgroundImage: `${sweep}, linear-gradient(180deg, ${mix(accent, "#ffffff", 0.45)} 0%, ${accent} 55%, ${mix(accent, "#000000", 0.25)} 100%)`,
      backgroundSize: "300% 100%, 100% 100%",
      backgroundPosition: `${sheenPos}, 0 0`,
    };
  return {
    ...base,
    backgroundImage: `${sweep}, linear-gradient(0deg, #3c3834, #3c3834), url(${src})`,
    backgroundSize: `300% 100%, 100% 100%, ${size}`,
    backgroundPosition: `${sheenPos}, 0 0, ${pos}`,
    backgroundBlendMode: "normal, screen, normal",
  };
}

/** A soft dark pool under the figure so it reads over any footage. Spills only a little past the box. */
export const Pool: React.FC<{ opacity?: number; strength?: number }> = ({
  opacity = 1,
  strength = 0.62,
}) => (
  <div
    style={{
      position: "absolute",
      left: -64,
      right: -64,
      top: -24,
      bottom: -18,
      opacity,
      background: `radial-gradient(60% 58% at 50% 50%, rgba(4,4,6,${strength}) 0%, rgba(4,4,6,${strength * 0.7}) 45%, rgba(4,4,6,0) 100%)`,
    }}
  />
);

/** The label line: Inter 900 capitals in paper white, a dark halo for footage, rising through a mask. */
export const Label: React.FC<{
  text: string;
  width: number;
  rise: number;
  max?: number;
  lines?: number;
  colour?: string;
  align?: "center" | "left";
}> = ({
  text,
  width,
  rise,
  max = 46,
  lines = 2,
  colour = COLOUR.paper,
  align = "center",
}) => {
  if (!text) return null;
  const fit = fitLabel(text, width, max, lines);
  return (
    <div style={{ overflow: "hidden", paddingBottom: 6, marginBottom: -6 }}>
      <div
        style={{
          transform: `translateY(${(1 - rise) * 110}%)`,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: fit.size,
          lineHeight: 1.12,
          letterSpacing: "0.04em",
          color: colour,
          textTransform: "uppercase",
          textAlign: align,
          textShadow: "0 2px 14px rgba(0,0,0,0.9), 0 0 3px rgba(0,0,0,0.9)",
          width,
        }}
      >
        {fit.lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
};

/** A stable 0..1 from a variant and a slot: the styles' only randomness. */
export function seeded(variant: number, slot: number): number {
  const x = Math.sin((variant + 1) * 12.9898 + slot * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export const YEAR = /\b(19|20)\d\d\b/;
