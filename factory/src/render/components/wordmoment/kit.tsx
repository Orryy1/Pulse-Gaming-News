// Shared pieces for the word-moment looks (./index.ts): the moment's clock (the stamp's landing spring and
// its lift in the last eight frames), the band every look sits in, type fitting for the text and the sub
// line, the channel's paper and ink textures, colour mixing and seeded numbers. Everything is a pure
// function of the frame and the props, so every look reads the same way and renders the same twice.
import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY, HAND } from "../fonts.ts";
import { antonFit, alpha, mix, seeded } from "../vertical/numbers/kit.tsx";
import { INK, PAPER_GRADIENT, shadow } from "../vertical/kit.ts";
import { onAccent, rnd, SOFT_GRAIN, textW } from "../vertical/words/kit.ts";
import { STAMP_FRAMES } from "../Stamp.tsx";
import type { WordStamp } from "./types.ts";

export { antonFit, alpha, mix, seeded, onAccent, rnd, SOFT_GRAIN, textW };
export { BODY, DISPLAY, HAND, COLOUR, STAMP_FRAMES };

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const easeOut = Easing.out(Easing.cubic);
export const easeOutQuint = Easing.out(Easing.poly(5));

/** The widest a moment may be: the Short's frame less a margin either side. */
export const BAND_W = 920;
/** The stamp's defaults in the Short (src/render/Short.tsx): the band's top and the headline size. */
export const DEFAULT_TOP = 930;
export const DEFAULT_SIZE = 104;

/**
 * The moment's clock. `hit` is the stamp's landing spring (about eight frames), `out` goes 1 to 0 over the
 * last eight frames of the hold, `t` is the frame as a share of the hold. Every look lands and lifts on it.
 */
export function useMoment(hold = STAMP_FRAMES) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hit = spring({
    frame,
    fps,
    config: { damping: 11, stiffness: 300, mass: 0.6 },
  });
  const out = interpolate(frame, [hold - 8, hold], [1, 0], clamp);
  return { frame, fps, hit, out, t: frame / Math.max(1, hold) };
}

/** 0..1 over [a, b] frames with a cubic ease out. */
export const ramp = (frame: number, a: number, b: number) =>
  interpolate(frame, [a, b], [0, 1], { ...clamp, easing: easeOut });

/** 0..1 over [a, b] frames, linear. */
export const lin = (frame: number, a: number, b: number) =>
  interpolate(frame, [a, b], [0, 1], clamp);

/** A damped wobble after a hit at `since` frames: the jolt of a thing landing. */
export const jolt = (since: number, amp = 6, decay = 2.4, freq = 1.8) =>
  since < 0 ? 0 : amp * Math.exp(-since / decay) * Math.cos(since * freq);

/** The stamp's text as it goes on screen: capitals, single spaces, 14 characters at most. */
export const wordText = (s: WordStamp) =>
  s.text.toUpperCase().replace(/\s+/g, " ").trim().slice(0, 14);
export const subText = (s: WordStamp) =>
  (s.sub ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/** Is the text a date: "NOV 19", "MARCH 2027", "Q1 2027", "2027", "19 NOV", "SPRING 2027"? */
export const isDate = (text: string) =>
  /^(?:(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?\s+(?:\d{1,2}(?:ST|ND|RD|TH)?(?:,?\s+(?:19|20)\d\d)?|(?:19|20)\d\d)|\d{1,2}(?:ST|ND|RD|TH)?\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*|(?:Q[1-4]|H[12]|SPRING|SUMMER|FALL|AUTUMN|WINTER|EARLY|LATE|MID)\s+(?:19|20)\d\d|(?:19|20)\d\d)$/.test(
    text.toUpperCase().trim(),
  );

/** Is the text a price: "$49.99", "£59", "FREE", "€69.99", "$0"? */
export const isPrice = (text: string) =>
  /^(?:[$£€¥]\s?\d[\d,.]*|\d[\d,.]*\s?(?:[$£€¥]|USD|EUR|GBP)|FREE)$/i.test(
    text.trim(),
  );

/** Is the text (or sub) about a delay: the courtroom file stamp's business. */
export const isDelay = (s: WordStamp) =>
  /\b(DELAY|DELAYED|PUSHED|SLIPS?|SLIPPED|POSTPONED|CANCELED|CANCELLED|SHELVED|HELD|PAUSED|SUSPENDED|ON HOLD|MOVED)\b/.test(
    `${wordText(s)} ${subText(s)}`,
  );

/** The biggest Anton size up to `max` at which `text` fits `width`. */
export const fitDisplay = (
  text: string,
  width: number,
  max: number,
  tracking = 0.02,
) => antonFit(text, width, max, tracking);

/** The biggest Inter 900 size up to `max` at which `text` fits `width`, with letter spacing in em. */
export function fitBody(
  text: string,
  width: number,
  max: number,
  spacingEm = 0.06,
): number {
  let size = max;
  while (size > 20 && textW(text, "inter900", size, size * spacingEm) > width)
    size -= 2;
  return size;
}

/** The biggest Permanent Marker size up to `max` at which `text` fits `width`. */
export function fitHand(text: string, width: number, max: number): number {
  let size = max;
  while (size > 20 && textW(text, "marker", size) > width) size -= 2;
  return size;
}

/** The channel's paper: a warm cream with a faint fibre. */
/** The channel's paper, ink and shadow ladder: the fact cards' own (../vertical/kit.ts), so one hand. */
export const PAPER = PAPER_GRADIENT;
export { INK, shadow };

/** Uneven ink: a mask that thins a stamped or printed thing in patches, so it reads as pressed by hand. */
export const INK_MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='m' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.045' numOctaves='3' seed='3' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 3.2 -0.5'/></filter>" +
    "<rect width='320' height='320' fill='white' filter='url(#m)'/></svg>",
)}")`;

/** A speckle of spray or chalk dust, for the stencil and the board. */
export const SPECKLE = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='s' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='1' seed='11' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 9 -7.6'/></filter>" +
    "<rect width='200' height='200' fill='white' filter='url(#s)'/></svg>",
)}")`;

/**
 * The band every look sits in: the Short's frame with the moment centred at `top`. Looks that slam in are
 * blurred from four sub-frame samples, as a camera would see them (the stamp's trick), so a hit reads as
 * a hit on a phone rather than a strobe.
 */
export const Band: React.FC<{
  top?: number;
  blur?: boolean;
  children: React.ReactNode;
}> = ({ top = DEFAULT_TOP, blur = false, children }) => {
  const fill = (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: top,
      }}
    >
      {children}
    </AbsoluteFill>
  );
  return blur ? (
    <CameraMotionBlur shutterAngle={180} samples={4}>
      {fill}
    </CameraMotionBlur>
  ) : (
    fill
  );
};

/** The sub line as the stamp sets it: Inter 900 capitals, wide tracking, in paper (or any colour). */
export const Sub: React.FC<{
  text: string;
  size: number;
  colour?: string;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({ text, size, colour = COLOUR.paper, opacity = 1, style }) =>
  text ? (
    <div
      style={{
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: Math.round(size * 0.26),
        letterSpacing: Math.round(size * 0.055),
        color: colour,
        opacity,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {text}
    </div>
  ) : null;

/** A seeded polygon edge torn along one side: teeth of `depth` px, `n` of them, as a list of "x y" points. */
export function tornSide(
  variant: number,
  slot: number,
  n: number,
  depth: number,
  along: (i: number) => number,
  across: (d: number) => number,
): string[] {
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const d =
      i % 2
        ? depth * (0.4 + 0.6 * seeded(variant, slot + i))
        : depth * 0.25 * seeded(variant, slot + i);
    pts.push(`${across(d)} ${along(i / n)}`);
  }
  return pts;
}
