// Shared pieces of the kinetic-typography styles (./styles.tsx): the dimmed, slowly moving game backdrop,
// the frame each on-screen word lands on (its spoken time, or an even pace finished by DRAWN_BY when the
// voice timings are missing), the fade out, and the word as the screen shows it. All pure functions of the
// frame and the props, so a render is the same twice.
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile } from "remotion";
import { COLOUR } from "../../brand.ts";
import { DRAWN_BY } from "../packs/fit.ts";
import type { KineticData } from "./choose.ts";
import { displayWord } from "./words.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export type KineticProps = {
  data: KineticData;
  /** Seconds from the shot's first frame at which each token is said (wordTimes); paced evenly when absent. */
  times?: number[];
  /** Frames the shot lasts. */
  len: number;
  /** A still of the chapter's game for the backdrop; brand ink when absent. */
  src?: string;
  /** Rotates small choices (drift direction, slide sides). */
  seed?: number;
};

/** The words on screen as display strings; a question keeps its mark on the last word. */
export function shownWords(d: KineticData): string[] {
  const last = d.tokens.length - 1;
  return d.shown.map((i) => {
    const w = displayWord(d.tokens[i]!);
    return i === last && /\?["”’']?$/.test(d.tokens[i]!) ? `${w}?` : w;
  });
}

/**
 * The frame each shown word lands on: a frame before the narrator says it (type that trails the voice
 * reads as late), never before frame 4, never after the shot's last 24 frames. Without timings the words
 * pace evenly so the last is down by DRAWN_BY.
 */
export function landFrames(
  d: KineticData,
  times: number[] | undefined,
  fps: number,
  len: number,
): number[] {
  const last = Math.max(4, len - 24);
  if (!times || times.length !== d.tokens.length) {
    const n = d.shown.length;
    const step = Math.min(14, (DRAWN_BY - 30) / Math.max(1, n));
    return d.shown.map((_, k) => Math.min(last, Math.round(8 + k * step)));
  }
  return d.shown.map((i) =>
    Math.min(last, Math.max(4, Math.round((times[i] ?? 0) * fps) - 1)),
  );
}

/** The frame by which every word is down and every flourish drawn (for the graphics pre-check's still). */
export function kineticSettle(
  d: KineticData,
  times: number[] | undefined,
  fps: number,
  len: number,
): number {
  const f = landFrames(d, times, fps, len);
  return Math.min(len - 12, Math.max(...f) + 30);
}

/** 1 to 0 over the shot's last ten frames. */
export const outro = (frame: number, len: number) =>
  interpolate(frame, [len - 10, len], [1, 0], clamp);

/**
 * The game picture, dimmed and softened so the type reads, drifting slowly across the shot; a vignette and
 * the channel's grain over it. `tone` tints the split style's halves.
 */
export const Backdrop: React.FC<{
  src?: string;
  frame: number;
  len: number;
  seed?: number;
  dim?: number;
  children?: React.ReactNode;
}> = ({ src, frame, len, seed = 0, dim = 0.34, children }) => {
  const t = frame / Math.max(1, len);
  const dir = seed % 2 === 0 ? 1 : -1;
  return (
    <AbsoluteFill style={{ background: COLOUR.ink, overflow: "hidden" }}>
      {src ? (
        <Img
          src={src}
          style={{
            position: "absolute",
            left: -60,
            top: -40,
            width: 2040,
            height: 1160,
            objectFit: "cover",
            transform: `scale(${1.04 + 0.07 * t}) translateX(${dir * (t * 30 - 15)}px)`,
            filter: `brightness(${dim}) saturate(0.65) blur(3px)`,
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at ${40 + 20 * t}% 45%, rgba(255,107,26,0.10), rgba(11,11,14,0) 60%)`,
          }}
        />
      )}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 46%, rgba(11,11,14,0) 35%, rgba(11,11,14,0.82) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile("grain.png")})`,
          opacity: 0.07,
          mixBlendMode: "overlay",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};
