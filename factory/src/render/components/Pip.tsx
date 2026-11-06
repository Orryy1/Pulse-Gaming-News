// Pip: the channel's code-drawn mascot, an amber squircle with two eyes and a heartbeat line for a mouth
// (tried in src/render/Lab.tsx, 25 Oct 2026; on a share of Shorts from the desk verdict, src/experiments.ts).
// Two clocks drive it: the ambient one (a slow bob, a blink every few seconds) and the story one (the mouth
// moves while a word is spoken; a stamp makes it squash, spike and look at the stamp). Everything is a
// function of the frame, so a render is repeatable.

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../brand.ts";
import type { Word } from "../../voice/elevenlabs.ts";

/** Frames since the last event at or before this frame, or undefined. */
export function sinceLast(
  frame: number,
  fps: number,
  times: number[],
): number | undefined {
  const past = times.map((t) => Math.round(t * fps)).filter((f) => f <= frame);
  return past.length ? frame - Math.max(...past) : undefined;
}

/** Where Pip sits on a Short: the brand band's right end, beside the logo row (y 150 to 300, x up to 1016). */
export const PIP_SHORT = { left: 896, top: 162, size: 120 } as const;

/** Pixels Pip may bob above or below its box. */
export const PIP_BOB = 6;

export const Pip: React.FC<{
  words: Word[];
  /** Seconds of the big moments Pip reacts to (stamps landing). */
  reactions: number[];
  /** Where the pupils point at a frame: x and y from -1 to 1. */
  lookAt: (f: number) => { x: number; y: number };
  left: number;
  top: number;
  size: number;
}> = ({ words, reactions, lookAt, left, top, size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const bob = Math.sin(t * 2.2) * PIP_BOB;
  const blink = frame % 104 >= 100 ? 0.12 : 1;
  const talking = words.some((w) => t >= w.start && t < w.end + 0.02);
  const since = sinceLast(frame, fps, reactions);
  const react =
    since === undefined
      ? 0
      : spring({
          frame: since,
          fps,
          config: { damping: 9, stiffness: 220, mass: 0.6 },
        });
  const fresh = since !== undefined && since < 30;
  // Squash on impact, stretch on the rebound, settle.
  const squash = fresh
    ? interpolate(react, [0, 0.35, 0.7, 1], [1, 0.82, 1.08, 1])
    : 1;
  const look = lookAt(frame);
  // The heartbeat: a small blip that travels while speaking, a tall spike on a reaction.
  const amp = fresh
    ? interpolate(since!, [0, 8, 30], [34, 30, 10], {
        extrapolateRight: "clamp",
      })
    : talking
      ? 10 + Math.abs(Math.sin(t * 22)) * 8
      : 3;
  const phase = (t * 140) % 220;
  const pts: string[] = [];
  for (let x = 30; x <= 170; x += 4) {
    const d = Math.abs(x - 30 - (phase % 140));
    const y =
      128 - (d < 10 ? amp * (1 - d / 10) * (x % 8 === 0 ? 1 : -0.45) : 0);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        transform: `translateY(${bob}px) scale(${1 / Math.sqrt(squash)}, ${squash})`,
        transformOrigin: "50% 100%",
        filter: `drop-shadow(0 ${Math.round(size * 0.09)}px ${Math.round(size * 0.15)}px rgba(0,0,0,0.55))`,
      }}
    >
      <svg viewBox="0 0 200 200" width={size} height={size}>
        <defs>
          <linearGradient id="pipBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FF8A45" />
            <stop offset="1" stopColor={COLOUR.amber} />
          </linearGradient>
        </defs>
        <rect
          x="14"
          y="20"
          width="172"
          height="166"
          rx="62"
          fill="url(#pipBody)"
          stroke={COLOUR.ink}
          strokeWidth="6"
        />
        {[68, 132].map((cx) => (
          <g key={cx} transform={`translate(${cx} 82) scale(1 ${blink})`}>
            <ellipse
              cx="0"
              cy="0"
              rx="21"
              ry="25"
              fill={COLOUR.paper}
              stroke={COLOUR.ink}
              strokeWidth="4"
            />
            <circle cx={look.x * 8} cy={look.y * 9} r="10" fill={COLOUR.ink} />
            <circle
              cx={look.x * 8 - 3}
              cy={look.y * 9 - 4}
              r="3"
              fill={COLOUR.paper}
            />
          </g>
        ))}
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={COLOUR.ink}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
