// Words/Checklist (kind "list"): a game-style objectives panel. An accent line draws, the chamfered panel
// opens from it, the objectives slide in, then a selector steps down the list ticking each box in turn
// with a flash while the counter in the header climbs. An original panel design, not any game's HUD.
// primary: the heading (optional, 26 characters at most); items: 2-4 items of 34 characters or fewer.
// (An older list beat's "a | b | c" primary with its label in secondary reads the same.)
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { COLOUR } from "../../../brand.ts";
import type { VGfxProps } from "../types.ts";
import {
  clamp,
  exitOf,
  listOf,
  onAccent,
  ramp,
  rgba,
  textW,
  wrap,
} from "./kit.ts";

const W = 952;
const H = 500;
const PAD_X = 30;
const BOX = 54;
const TEXT_X = PAD_X + BOX + 24;
const TEXT_W = W - TEXT_X - 34;
const HEAD_H = 74;
const ROW_PAD = 16;
const CUT = 22;
const SIZES = [64, 60, 56, 52, 48, 44, 40];

type Row = { lines: string[]; h: number };
type Layout = {
  head: string;
  rows: Row[];
  size: number;
  lineH: number;
  total: number;
};

export function layoutChecklist(v: VGfxProps["v"]): Layout | null {
  const { head, items, raw } = listOf(v);
  if (items.length < 2 || items.length > 4 || items.length !== raw) return null;
  if (items.some((x) => x.length > 34) || head.length > 26) return null;
  // With no heading the panel carries the generic game label instead.
  const heading = (head || "Objectives").toUpperCase();
  if (heading && textW(heading, "anton", 50, 1) > W - 2 * PAD_X - 140)
    return null;
  // One line an objective reads best: take the biggest size that keeps every one on a line (48 px or
  // more), else the biggest that fits at two lines each.
  for (const [maxLines, size] of [...SIZES.filter((x) => x >= 48).map((x) => [1, x] as const), ...SIZES.map((x) => [2, x] as const)]) {
    const lineH = Math.round(size * 1.14);
    const rows: Row[] = [];
    let ok = true;
    for (const it of items) {
      const lines = wrap(it, "inter800", size, TEXT_W);
      if (!lines || lines.length > maxLines) {
        ok = false;
        break;
      }
      rows.push({
        lines,
        h: Math.max(BOX, lines.length * lineH) + ROW_PAD * 2,
      });
    }
    if (!ok) continue;
    const total =
      18 + (heading ? HEAD_H + 10 : 4) + rows.reduce((s, r) => s + r.h, 0) + 18;
    if (total <= H) return { head: heading, rows, size, lineH, total };
  }
  return null;
}

const chamfer = (w: number, h: number, c: number, i = 0) =>
  `polygon(${[
    [c + i, i],
    [w - i, i],
    [w - i, h - c - i],
    [w - c - i, h - i],
    [i, h - i],
    [i, c + i],
  ]
    .map(([x, y]) => `${x}px ${y}px`)
    .join(", ")})`;

export const Checklist: React.FC<VGfxProps> = ({ v, len, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = layoutChecklist(v);
  if (!L) return null;
  const { head, rows, size, lineH, total } = L;
  const top = Math.round((H - total) / 3);
  const out = exitOf(frame, len);
  const ink = onAccent(accent);

  const line = ramp(frame, 0, 5);
  const open = spring({
    frame: frame - 2,
    fps,
    config: { damping: 18, stiffness: 380, mass: 0.45 },
  });
  const shut = interpolate(out, [0, 1], [0.04, 1], clamp);
  const n = rows.length;
  const tickAt = (i: number) => 13 + i * 6;
  const ticked = rows.filter((_, i) => frame >= tickAt(i)).length;

  // Row tops inside the panel.
  const listTop = 18 + (head ? HEAD_H + 10 : 4);
  const tops: number[] = [];
  let y = listTop;
  for (const r of rows) {
    tops.push(y);
    y += r.h;
  }
  // The selector glides to each row a few frames before its tick.
  let selY = tops[0]!;
  let selH = rows[0]!.h;
  for (let i = 1; i < n; i++) {
    const p = ramp(frame, tickAt(i) - 4, tickAt(i));
    selY += (tops[i]! - tops[i - 1]!) * p;
    selH += (rows[i]!.h - rows[i - 1]!.h) * p;
  }
  const selIn =
    ramp(frame, 9, 13) *
    (frame < tickAt(n - 1) + 14
      ? 1
      : 1 - ramp(frame, tickAt(n - 1) + 14, tickAt(n - 1) + 22));

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: W,
        height: total,
        opacity: Math.min(1, out * 1.4),
      }}
    >
      {/* The line the panel opens from. */}
      <div
        style={{
          position: "absolute",
          left: (W * (1 - line)) / 2,
          width: W * line,
          top: total / 2 - 2,
          height: 4,
          background: accent,
          opacity: 1 - open,
          boxShadow: `0 0 18px ${rgba(accent, 0.8)}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scaleY(${Math.max(0.02, open) * shut})`,
          transformOrigin: "50% 50%",
          opacity: Math.min(1, open * 3),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 6,
            width: W,
            height: total,
            background: "rgba(0,0,0,0.38)",
            clipPath: chamfer(W, total, CUT),
            transform: "translate(6px, 8px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(245,245,242,0.22)",
            clipPath: chamfer(W, total, CUT),
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(20,20,26,0.95) 0%, rgba(11,11,14,0.94) 100%)",
            clipPath: chamfer(W, total, CUT, 2),
          }}
        />
        {/* Corner brackets in the accent. */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 40,
            height: 6,
            background: accent,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 6,
            height: 40,
            background: accent,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: 40,
            height: 6,
            background: accent,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: 6,
            height: 40,
            background: accent,
          }}
        />

        {head ? (
          <>
            <div
              style={{
                position: "absolute",
                left: PAD_X,
                top: 18,
                height: HEAD_H,
                right: PAD_X,
                display: "flex",
                alignItems: "center",
                gap: 20,
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  background: accent,
                  transform: "rotate(45deg)",
                  flex: "0 0 auto",
                }}
              />
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 50,
                  letterSpacing: 1,
                  color: COLOUR.paper,
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {head}
              </div>
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: 34,
                  letterSpacing: 2,
                  color: ticked === n ? accent : COLOUR.muted,
                  transform: `scale(${1 + 0.18 * (1 - ramp(frame, tickAt(Math.max(0, ticked - 1)), tickAt(Math.max(0, ticked - 1)) + 6)) * (ticked ? 1 : 0)})`,
                }}
              >
                {ticked}/{n}
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                left: PAD_X,
                top: 18 + HEAD_H,
                height: 3,
                width: (W - 2 * PAD_X) * ramp(frame, 6, 14),
                background: `linear-gradient(90deg, ${accent} 0%, ${rgba(accent, 0.15)} 100%)`,
              }}
            />
          </>
        ) : null}

        {/* The selector. */}
        <div
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            top: selY + 4,
            height: selH - 8,
            opacity: selIn,
            background: `linear-gradient(90deg, ${rgba(accent, 0.3)} 0%, ${rgba(accent, 0.08)} 70%, ${rgba(accent, 0)} 100%)`,
            borderLeft: `6px solid ${accent}`,
          }}
        />

        {rows.map((r, i) => {
          const slide = ramp(frame, 6 + i * 2, 12 + i * 2);
          const tick = spring({
            frame: frame - tickAt(i),
            fps,
            config: { damping: 11, stiffness: 340, mass: 0.45 },
          });
          const draw = ramp(frame, tickAt(i) + 1, tickAt(i) + 5);
          const flash =
            frame >= tickAt(i) ? 1 - ramp(frame, tickAt(i), tickAt(i) + 8) : 0;
          const done = frame >= tickAt(i);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: tops[i],
                height: r.h,
                opacity: slide,
                transform: `translateX(${(1 - slide) * -36}px)`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 10,
                  right: 10,
                  top: 4,
                  bottom: 4,
                  background: `rgba(255,255,255,${0.22 * flash})`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: PAD_X,
                  top: (r.h - BOX) / 2,
                  width: BOX,
                  height: BOX,
                  borderRadius: 7,
                  border: `4px solid ${done ? accent : "rgba(245,245,242,0.7)"}`,
                  boxSizing: "border-box",
                  background: done ? accent : "rgba(255,255,255,0.04)",
                  transform: `scale(${done ? 0.7 + 0.3 * tick : 1})`,
                }}
              >
                <svg
                  width={BOX - 8}
                  height={BOX - 8}
                  viewBox="0 0 38 38"
                  style={{ position: "absolute", left: 0, top: 0 }}
                >
                  <path
                    d="M8 20 L16 28 L31 10"
                    stroke={ink}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - draw}
                  />
                </svg>
              </div>
              <div
                style={{
                  position: "absolute",
                  left: TEXT_X,
                  top: (r.h - r.lines.length * lineH) / 2,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: size,
                  lineHeight: `${lineH}px`,
                  color: done ? "#d9d9de" : COLOUR.paper,
                  whiteSpace: "nowrap",
                }}
              >
                {r.lines.map((l, k) => (
                  <div key={k}>{l}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const fitsChecklist = (v: VGfxProps["v"]) => layoutChecklist(v) !== null;
