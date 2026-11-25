// A cycle or loop: the stages sit round a ring and the arcs between them draw themselves as the narrator moves from
// one to the next; once the loop is closed a spark keeps orbiting and each stage brightens as it passes, so the
// picture says "and round again". The centre holds a slowly turning loop mark.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../brand.ts";
import {
  Board,
  clamp,
  easeInOut,
  Icon,
  IconDisc,
  Label,
  land,
  progress,
  useClock,
} from "./kit.tsx";
import type { ExplainerProps } from "./types.ts";

/** A stage's angle round the ring, in radians: the first at the top, then clockwise. */
export const stageAngle = (i: number, n: number) =>
  -Math.PI / 2 + (2 * Math.PI * i) / n;

export const Cycle: React.FC<ExplainerProps> = ({
  e,
  len,
  at,
  accent,
  backdrop,
}) => (
  <Board
    type="cycle"
    title={e.title}
    len={len}
    accent={accent}
    backdrop={backdrop}
  >
    {({ o, content }) => (
      <CycleBody e={e} at={at} accent={accent} o={o} content={content} />
    )}
  </Board>
);

const CycleBody: React.FC<{
  e: ExplainerProps["e"];
  at: number[];
  accent: string;
  o: "tall" | "wide";
  content: { left: number; top: number; width: number; height: number };
}> = ({ e, at, accent, o, content }) => {
  const { frame, fps } = useClock();
  const n = e.items.length;
  const { active, landed } = progress(frame, at);
  const tall = o === "tall";
  const disc = tall ? 112 : 104;
  const R = tall ? 190 : Math.min(290, content.height / 2 - 110);
  const cx = content.left + content.width / 2;
  const cy = content.top + content.height / 2 + (tall ? 30 : -20);
  const pt = (a: number, r = R): [number, number] => [
    cx + Math.cos(a) * r,
    cy + Math.sin(a) * r,
  ];
  const closeAt = at[n - 1]! + 16;
  const closed = frame >= closeAt + 14;
  // After the loop closes, a spark orbits once every 2.5 s.
  const orbit = closed ? ((frame - closeAt - 14) / (2.5 * fps)) % 1 : -1;
  const sparkA = -Math.PI / 2 + orbit * 2 * Math.PI;
  const ringIn = interpolate(frame, [0, 18], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const arcs: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = stageAngle(i, n);
    const a1 = stageAngle(i + 1, n);
    // Inset each arc so it starts and ends clear of the discs.
    const pad = (disc / 2 + 18) / R;
    const s = a0 + pad;
    const end = a1 - pad;
    const from = at[i]! + 6;
    const to = i < n - 1 ? Math.max(from + 10, at[i + 1]! + 2) : closeAt + 14;
    const p = interpolate(frame, [i < n - 1 ? from : closeAt, to], [0, 1], {
      ...clamp,
      easing: easeInOut,
    });
    if (p <= 0) continue;
    const cur = s + (end - s) * p;
    const [x0, y0] = pt(s);
    const [x1, y1] = pt(cur);
    const large = cur - s > Math.PI ? 1 : 0;
    const d = `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1}`;
    const ang = cur + Math.PI / 2;
    arcs.push(
      <g key={i}>
        <path
          d={d}
          fill="none"
          stroke={accent}
          strokeOpacity={0.3}
          strokeWidth={22}
          strokeLinecap="round"
          style={{ filter: "blur(7px)" }}
        />
        <path
          d={d}
          fill="none"
          stroke={accent}
          strokeWidth={8}
          strokeLinecap="round"
        />
        {p > 0.2 ? (
          <path
            d="M0,0 L-24,-15 L-17,0 L-24,15 Z"
            fill={accent}
            transform={`translate(${x1},${y1}) rotate(${(ang * 180) / Math.PI})`}
          />
        ) : null}
      </g>,
    );
  }
  const [sx, sy] = pt(sparkA);
  return (
    <>
      <svg
        width={content.left * 2 + content.width}
        height={content.top + content.height + 60}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={4}
          strokeDasharray={`${2 * Math.PI * R * ringIn} ${2 * Math.PI * R}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {arcs}
        {closed ? (
          <circle
            cx={sx}
            cy={sy}
            r={13}
            fill="#FFFFFF"
            style={{ filter: `drop-shadow(0 0 14px ${accent})` }}
          />
        ) : null}
      </svg>
      <div
        style={{
          position: "absolute",
          left: cx - 70,
          top: cy - 70,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,255,255,0.06), rgba(255,255,255,0))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: ringIn * (landed >= n ? 1 : 0.5),
          transform: `rotate(${frame * 1.2}deg)`,
        }}
      >
        <Icon
          name="repeat"
          size={84}
          colour={landed >= n ? accent : COLOUR.muted}
          stroke={1.6}
        />
      </div>
      {e.items.map((it, i) => {
        if (frame < at[i]! - 1) return null;
        const p = land(frame, fps, at[i]!);
        const a = stageAngle(i, n);
        const [x, y] = pt(a);
        // The spark lights the stage it passes.
        const near = closed
          ? Math.max(
              0,
              1 -
                Math.abs(
                  ((sparkA - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
                ) /
                  0.5,
            )
          : 0;
        const isActive = (!closed && i === active) || near > 0.5;
        const below = Math.sin(a) > 0.2;
        const w = tall ? 330 : 400;
        // Labels sit outside the ring: above the top stage, below the bottom ones, beside the side ones.
        const side =
          !tall && Math.abs(Math.cos(a)) > 0.6 && !below
            ? Math.cos(a) > 0
              ? "right"
              : "left"
            : undefined;
        const lx =
          side === "right"
            ? x + disc / 2 + 18
            : side === "left"
              ? x - disc / 2 - 18 - w
              : x - w / 2;
        const ly = side
          ? y - 40
          : below
            ? Math.max(y + disc / 2 + 14, cy + R + 22)
            : y - disc / 2 - 14 - (tall ? 112 : 96);
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: x - disc / 2,
                top: y - disc / 2,
                opacity: Math.min(1, p * 1.3),
                transform: `scale(${0.6 + 0.4 * p})`,
              }}
            >
              <IconDisc
                icon={it.icon}
                size={disc}
                accent={accent}
                p={Math.min(1, p)}
                active={isActive}
                number={it.icon ? undefined : i + 1}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: lx,
                top: ly,
                width: w,
                display: "flex",
                flexDirection: "column",
                justifyContent: !side && !below ? "flex-end" : "flex-start",
                alignItems:
                  side === "right"
                    ? "flex-start"
                    : side === "left"
                      ? "flex-end"
                      : "center",
                height: side ? undefined : tall ? 112 : 96,
                opacity: Math.min(1, p * 1.3),
              }}
            >
              <Label
                text={it.label}
                type="cycle"
                o={o}
                n={n}
                align={
                  side === "right"
                    ? "left"
                    : side === "left"
                      ? "right"
                      : "center"
                }
                colour={isActive ? COLOUR.paper : "#D5D5DA"}
              />
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};
