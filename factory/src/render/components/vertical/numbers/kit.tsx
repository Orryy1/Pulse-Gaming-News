// Shared pieces for the vertical Numbers styles (../VNumbers.tsx): the beat's timing (build, hold, exit over
// the last 10 frames), type fitting from Anton's measured widths, colour mixing for an accent of any hue,
// letters cut from a picture, the label line and a soft dark pool that keeps a figure readable over footage.
// Everything is a pure function of the frame and the props. The pieces every pack shares (timing, paper,
// grain, ink, shadows, colour mixing, seeded numbers) live in ../kit.ts and are re-exported here.
import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import {
  ANTON,
  fitText,
  textEm,
  type Metrics,
} from "../../motifs/franchises/shared.ts";
import { VBOX } from "../types.ts";
import {
  EXIT_FRAMES,
  INK,
  PAPER,
  PAPER_GRADIENT,
  SOFT_GRAIN,
  alpha,
  clamp,
  clean as cleanText,
  easeOut,
  easeOutQuint,
  exitStyle,
  mix,
  seeded,
  shadow,
} from "../kit.ts";

export { ANTON, textEm };
/** Text from the beat, screen-ready: percent as %, long dashes as a spaced hyphen, single spaces. */
export const clean = (s: string | undefined) => cleanText(s);
export {
  INK,
  PAPER,
  PAPER_GRADIENT,
  SOFT_GRAIN,
  alpha,
  clamp,
  easeOut,
  easeOutQuint,
  exitStyle,
  mix,
  seeded,
  shadow,
};
export const W = VBOX.width;
export const H = VBOX.height;

/** The beat's clock: the frame, and `out` going 1 to 0 over the last EXIT_FRAMES. */
export function useBeat(len: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = Math.max(24, len);
  const out = interpolate(frame, [L - EXIT_FRAMES, L], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  return { frame, fps, out, visible: frame < L };
}

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

export const YEAR = /\b(19|20)\d\d\b/;
