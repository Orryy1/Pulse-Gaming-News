// A timeline with a moving playhead: the stops are laid along a track, and a glowing playhead glides to each one as
// the narrator reaches it, filling the track behind it; the stop it rests on lights up and its time counts in. Tall
// (the Short): the track runs down the board with times and labels to its right. Wide: across the board, times
// above the track and labels below.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../brand.ts";
import {
  Board,
  clamp,
  easeInOut,
  Label,
  land,
  progress,
  useClock,
  Value,
} from "./kit.tsx";
import type { ExplainerProps } from "./types.ts";

/** Where the playhead is, 0..n-1 along the stops, at this frame: it glides to stop i over the 14 frames before at[i]. */
export function playheadAt(frame: number, at: number[]): number {
  let pos = 0;
  for (let i = 0; i < at.length; i++) {
    const t = interpolate(frame, [at[i]! - 14, at[i]!], [0, 1], {
      ...clamp,
      easing: easeInOut,
    });
    if (i === 0) pos = t * 0;
    else pos = Math.max(pos, i - 1 + t);
  }
  return pos;
}

export const Playhead: React.FC<ExplainerProps> = ({
  e,
  len,
  at,
  accent,
  backdrop,
}) => (
  <Board
    type="timeline"
    title={e.title}
    len={len}
    accent={accent}
    backdrop={backdrop}
  >
    {({ o, content }) => (
      <PlayheadBody e={e} at={at} accent={accent} o={o} content={content} />
    )}
  </Board>
);

const PlayheadBody: React.FC<{
  e: ExplainerProps["e"];
  at: number[];
  accent: string;
  o: "tall" | "wide";
  content: { left: number; top: number; width: number; height: number };
}> = ({ e, at, accent, o, content }) => {
  const { frame, fps } = useClock();
  const n = e.items.length;
  const { active } = progress(frame, at);
  const tall = o === "tall";
  const trackIn = interpolate(frame, [2, 20], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  // Stop positions along the track (px from the track's start).
  const span = tall ? content.height - 120 : content.width - 220;
  const stopAt = (i: number) => (n === 1 ? 0 : (span * i) / (n - 1));
  const x0 = tall ? content.left + 110 : content.left + 110;
  const y0 = tall ? content.top + 60 : content.top + content.height * 0.46;
  const pt = (d: number): [number, number] =>
    tall ? [x0, y0 + d] : [x0 + d, y0];
  const pos = playheadAt(frame, at);
  const visible = frame >= at[0]! - 14;
  const lo = Math.floor(pos);
  const headD =
    stopAt(lo) + (stopAt(Math.min(n - 1, lo + 1)) - stopAt(lo)) * (pos - lo);
  const [hx, hy] = pt(visible ? headD : 0);
  const end = pt(span * trackIn);
  const bob = Math.sin(frame / 6) * 3;
  return (
    <>
      <svg
        width={content.left * 2 + content.width}
        height={content.top + content.height + 40}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <line
          x1={x0}
          y1={y0}
          x2={end[0]}
          y2={end[1]}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {visible ? (
          <>
            <line
              x1={x0}
              y1={y0}
              x2={hx}
              y2={hy}
              stroke={accent}
              strokeOpacity={0.35}
              strokeWidth={26}
              strokeLinecap="round"
              style={{ filter: "blur(8px)" }}
            />
            <line
              x1={x0}
              y1={y0}
              x2={hx}
              y2={hy}
              stroke={accent}
              strokeWidth={10}
              strokeLinecap="round"
            />
          </>
        ) : null}
        {e.items.map((_, i) => {
          const [sx, sy] = pt(stopAt(i));
          const on = frame >= at[i]!;
          const tickIn = interpolate(
            frame,
            [4 + i * 3, 14 + i * 3],
            [0, 1],
            clamp,
          );
          return (
            <g key={i} opacity={tickIn}>
              <circle
                cx={sx}
                cy={sy}
                r={on ? 20 : 14}
                fill={on ? accent : COLOUR.ink}
                stroke={on ? accent : "rgba(255,255,255,0.4)"}
                strokeWidth={4}
              />
              {on ? <circle cx={sx} cy={sy} r={7} fill={COLOUR.ink} /> : null}
            </g>
          );
        })}
        {visible ? (
          <g transform={`translate(${hx},${hy})`}>
            <circle r={44 + bob} fill={accent} opacity={0.16} />
            <circle
              r={30}
              fill={COLOUR.paper}
              style={{ filter: `drop-shadow(0 0 16px ${accent})` }}
            />
            <circle r={12} fill={accent} />
          </g>
        ) : null}
      </svg>
      {e.items.map((it, i) => {
        if (frame < at[i]! - 2) return null;
        const p = land(frame, fps, at[i]!);
        const [sx, sy] = pt(stopAt(i));
        const isActive = i === active;
        const colour = isActive ? accent : COLOUR.paper;
        const fade = Math.min(1, p * 1.3) * (isActive || i > active ? 1 : 0.62);
        if (tall)
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: sx + 70,
                top: sy - 46,
                width: content.width - 200,
                opacity: fade,
                transform: `translateX(${(1 - p) * 40}px)`,
              }}
            >
              <Value text={it.value ?? ""} type="timeline" o={o} n={n} colour={colour} />
              <div style={{ height: 10 }} />
              <Label text={it.label} type="timeline" o={o} n={n} colour={COLOUR.paper} />
            </div>
          );
        const colW = content.width / n - 40;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: sx - colW / 2,
                top: sy - 190,
                width: colW,
                height: 150,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                opacity: fade,
                transform: `translateY(${(1 - p) * -30}px)`,
              }}
            >
              <Value text={it.value ?? ""} type="timeline" o={o} n={n} colour={colour} />
            </div>
            <div
              style={{
                position: "absolute",
                left: sx - colW / 2,
                top: sy + 52,
                width: colW,
                display: "flex",
                justifyContent: "center",
                opacity: fade,
                transform: `translateY(${(1 - p) * 30}px)`,
              }}
            >
              <Label text={it.label} type="timeline" o={o} n={n} align="center" colour={COLOUR.paper} />
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};
