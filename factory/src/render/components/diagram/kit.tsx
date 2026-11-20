// Shared pieces of the explainer diagrams (./styles.tsx): the board they sit on (the chapter's game picture
// dimmed far down under a faint blueprint grid), the small fixed header label, a node panel whose label is
// fitted to its box, and connectors that draw themselves. Every build finishes by DRAWN_BY (../packs/fit.ts),
// where the graphics pre-check looks.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../brand.ts";
import { SPRING } from "../../motion.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { SAFE_EDGE, fitBlock } from "../packs/fit.ts";
import type { DiagramData } from "./choose.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const easeOut = (x: number) => 1 - (1 - x) ** 3;

export type DiagramProps = {
  data: DiagramData;
  /** Frames the shot lasts. */
  len: number;
  /** A still of the chapter's game, very dim behind the board; brand ink when absent. */
  src?: string;
  seed?: number;
};

/** The moment's clock: frame, fps, and the whole diagram's fade in and out. */
export function useBoard(len: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dim = interpolate(frame, [0, 10, len - 12, len], [0, 1, 1, 0], clamp);
  return { frame, fps, dim };
}

/** A spring from frame `at`, 0..1. */
export const pop = (frame: number, fps: number, at: number) =>
  spring({ frame: frame - at, fps, config: SPRING.ENTER });
/** 0..1 eased over [a, b]. */
export const ramp = (frame: number, a: number, b: number) =>
  interpolate(frame, [a, b], [0, 1], { ...clamp, easing: easeOut });

/** The board: the picture very dim and soft, a faint grid, a vignette, then the diagram. */
export const Board: React.FC<{
  src?: string;
  frame: number;
  len: number;
  dim: number;
  label?: string;
  children: React.ReactNode;
}> = ({ src, frame, len, dim, label, children }) => {
  const t = frame / Math.max(1, len);
  return (
    <AbsoluteFill style={{ background: COLOUR.ink, overflow: "hidden" }}>
      {src ? (
        <Img
          src={src}
          style={{
            position: "absolute",
            left: -40,
            top: -30,
            width: 2000,
            height: 1140,
            objectFit: "cover",
            transform: `scale(${1.04 + 0.04 * t})`,
            filter: "brightness(0.2) saturate(0.5) blur(10px)",
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          opacity: 0.9 * dim,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
          backgroundPosition: "-1px -1px",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(11,11,14,0) 40%, rgba(11,11,14,0.85) 100%)",
        }}
      />
      {label ? (
        <div
          style={{
            position: "absolute",
            left: SAFE_EDGE + 40,
            top: SAFE_EDGE + 30,
            display: "flex",
            alignItems: "center",
            gap: 16,
            opacity: dim,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: 6,
            color: COLOUR.muted,
          }}
        >
          <div style={{ width: 14, height: 14, background: COLOUR.amber }} />
          {label}
        </div>
      ) : null}
      <AbsoluteFill style={{ opacity: dim }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A label as a panel shows it: the sentence's words, the first letter capitalised ("Planned single-player DLC"). */
export const upFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A label fitted to a box: Inter at the largest size whose wrap fits `lines` lines. */
export function fitLabel(
  text: string,
  width: number,
  sizes = [68, 62, 56, 50, 44, 38, 34],
  lines = 2,
) {
  return fitBlock(text, "inter", {
    maxWidth: width,
    sizes,
    maxLines: lines,
    lineHeight: 1.15,
  });
}

/** A node panel at (x, y) centre, its label fitted inside; `focus` gets the amber edge and a lift. */
export const NodeBox: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  p: number;
  focus?: boolean;
  faded?: number;
  head?: string;
}> = ({ x, y, w, h, text, p, focus, faded = 0, head }) => {
  const f = fitLabel(
    upFirst(text),
    w - 56,
    head ? [46, 42, 38, 34, 30] : undefined,
    head ? 2 : 2,
  );
  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        borderRadius: 18,
        background: focus ? "rgba(32,22,16,0.95)" : "rgba(20,20,26,0.93)",
        border: `3px solid ${focus ? COLOUR.amber : "rgba(245,245,242,0.16)"}`,
        boxShadow: focus
          ? "0 18px 60px rgba(255,107,26,0.25), 0 12px 40px rgba(0,0,0,0.5)"
          : "0 12px 40px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        opacity: interpolate(p, [0, 0.4], [0, 1], clamp) * (1 - 0.55 * faded),
        transform: `scale(${0.85 + 0.15 * p}) translateY(${(1 - p) * 24}px)`,
        filter: faded ? `grayscale(${faded})` : undefined,
      }}
    >
      {head ? (
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 40,
            letterSpacing: 2,
            color: focus ? COLOUR.amber : COLOUR.muted,
            marginBottom: 6,
          }}
        >
          {head}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: f.size,
          lineHeight: 1.15,
          color: COLOUR.paper,
        }}
      >
        {f.lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
};

/** A connector from (x1, y1) to (x2, y2) drawing over `p` 0..1, with an arrowhead once drawn. */
export const Arrow: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  p: number;
  colour?: string;
  dashed?: boolean;
  width?: number;
  head?: boolean;
}> = ({
  x1,
  y1,
  x2,
  y2,
  p,
  colour = COLOUR.amber,
  dashed,
  width = 6,
  head = true,
}) => {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const ex = x1 + (x2 - x1) * p;
  const ey = y1 + (y2 - y1) * p;
  const hs = 22;
  return (
    <svg
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        overflow: "visible",
      }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={ex}
        y2={ey}
        stroke={colour}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dashed ? "14 14" : undefined}
      />
      {head && p > 0.98 && len > hs * 2 ? (
        <polygon
          points={`${x2},${y2} ${x2 - hs * Math.cos(ang - 0.45)},${y2 - hs * Math.sin(ang - 0.45)} ${x2 - hs * Math.cos(ang + 0.45)},${y2 - hs * Math.sin(ang + 0.45)}`}
          fill={colour}
        />
      ) : null}
    </svg>
  );
};

/** A small pill label (a word from the sentence, such as "acquired") centred at (x, y). */
export const Pill: React.FC<{
  x: number;
  y: number;
  text: string;
  p: number;
  colour?: string;
}> = ({ x, y, text, p, colour = COLOUR.amber }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * p})`,
      opacity: p,
      padding: "8px 22px",
      borderRadius: 999,
      background: colour,
      color: COLOUR.ink,
      fontFamily: BODY,
      fontWeight: 900,
      fontSize: 30,
      letterSpacing: 3,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}
  >
    {text}
  </div>
);
