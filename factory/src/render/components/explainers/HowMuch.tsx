// "How much": a price or number built up in stacked units. A column of unit tiles rises as a counter climbs to the
// first figure; each change lands as a new block on top (a rise, in the accent) or peels off (a fall, in red) while
// the counter rolls on to the next figure, and every block is labelled with its words from the script. The counter is
// set like the figure it reaches ("$99.99"), so the maths on screen is exactly the maths in the line.
import React from "react";
import { interpolate } from "remotion";
import { COLOUR } from "../../brand.ts";
import { DISPLAY } from "../fonts.ts";
import { figure } from "./ground.ts";
import {
  Board,
  clamp,
  easeInOut,
  formatLike,
  Icon,
  Label,
  land,
  progress,
  useClock,
  Value,
} from "./kit.tsx";
import { textWidth } from "../packs/fit.ts";
import { fitLabel, fitValue, LABEL_FACE, LINE_HEIGHT, VALUE_FACE } from "./layout.ts";
import type { ExplainerProps } from "./types.ts";

/** The running totals a build passes through: a value starting + or - adds to the last, any other value replaces it. */
export function runningTotals(values: Array<string | undefined>): number[] {
  const out: number[] = [];
  for (const v of values) {
    const f = figure(v) ?? 0;
    const delta = /^\s*[+\-−]/.test(v ?? "");
    out.push(delta && out.length ? out.at(-1)! + f : Math.abs(f));
  }
  return out;
}

/** A round unit for the tiles: about a dozen tiles for the largest total (1, 2, 5, 10, 20, 50 ...). */
export function tileUnit(max: number): number {
  if (!(max > 0)) return 1;
  const raw = max / 12;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

/** The tall counter's size: the largest that keeps its widest figure clear of a total row top left (pure). */
export function tallCounterSize(
  items: ExplainerProps["e"]["items"],
  totals: number[],
  max: number,
  width: number,
): number {
  const n = items.length;
  let flatW = 0;
  items.forEach((it, i) => {
    if (i === 0 || Math.abs(totals[i]! - totals[i - 1]!) > 1e-9) return;
    const v = fitValue(it.value ?? "", "howmuch", "tall", n);
    const l = fitLabel(it.label, "howmuch", "tall", n);
    flatW = Math.max(
      flatW,
      textWidth(it.value ?? "", VALUE_FACE, v.size * 0.8),
      ...l.lines.map((x) => textWidth(x, LABEL_FACE, l.size, -0.3)),
    );
  });
  // The counter is set like whichever absolute figure it last reached: measure each one at the top total.
  const shapes = items.map((x) => x.value ?? "").filter((v) => v && !/^\s*[+\-−]/.test(v));
  const figures = (shapes.length ? shapes : [items[0]?.value ?? "0"]).map((v) => formatLike(v, max));
  const wide = (size: number) => Math.max(...figures.map((f) => textWidth(f, VALUE_FACE, size)));
  for (const size of [176, 160, 150, 136, 120])
    if (!flatW || width - wide(size) >= flatW + 30) return size;
  return 104;
}

export const HowMuch: React.FC<ExplainerProps> = ({
  e,
  len,
  at,
  accent,
  backdrop,
}) => (
  <Board
    type="howmuch"
    title={e.title}
    len={len}
    accent={accent}
    backdrop={backdrop}
  >
    {({ o, content }) => (
      <HowMuchBody e={e} at={at} accent={accent} o={o} content={content} />
    )}
  </Board>
);

const HowMuchBody: React.FC<{
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
  const totals = runningTotals(e.items.map((x) => x.value));
  const max = Math.max(...totals, 1);
  const unit = tileUnit(max);
  // The column.
  const colW = tall ? 270 : 300;
  const colH = content.height - (tall ? 250 : 150);
  const colLeft = tall ? content.left + 40 : content.left + 220;
  // The counter's size. On the tall board it sits top right, level with a total row set top left (a row that changes
  // nothing on the column): the largest size whose widest figure leaves that row room.
  const counterSize = tall ? tallCounterSize(e.items, totals, max, content.width) : 170;
  const colBottom = content.top + content.height - 30;
  const pxPer = colH / max;
  // The counter: rolls between totals as each item lands.
  let shownTotal = 0;
  for (let i = 0; i < n; i++) {
    const t = interpolate(frame, [at[i]!, at[i]! + 22], [0, 1], {
      ...clamp,
      easing: easeInOut,
    });
    const from = i === 0 ? 0 : totals[i - 1]!;
    if (frame >= at[i]!) shownTotal = from + (totals[i]! - from) * t;
  }
  const absolute = [...e.items]
    .reverse()
    .find(
      (x, k) => !/^\s*[+\-−]/.test(x.value ?? "") && frame >= at[n - 1 - k]!,
    )?.value;
  const counterText = formatLike(
    absolute ?? e.items[0]!.value ?? "0",
    shownTotal,
  );
  const counterIn = land(frame, fps, at[0]!);
  // Tiles: one per unit up to the current total, each placed as the counter passes it.
  const tiles: React.ReactNode[] = [];
  const tileH = unit * pxPer;
  const count = Math.ceil(max / unit);
  for (let k = 0; k < count; k++) {
    const lo = k * unit;
    // Which item's block this tile belongs to, and is it shown yet.
    const owner = totals.findIndex((t) => t > lo + 1e-9);
    if (owner < 0) continue;
    const prev = owner === 0 ? 0 : totals[owner - 1]!;
    const rising = totals[owner]! >= prev;
    if (!rising) continue;
    const top = Math.min(totals[owner]!, lo + unit);
    const h = (top - lo) * pxPer;
    const reach = shownTotal - lo;
    if (reach <= 0) continue;
    const p = Math.min(1, reach / Math.max(1e-6, top - lo));
    const colour = owner === 0 ? "#C9CED8" : accent;
    tiles.push(
      <div
        key={k}
        style={{
          position: "absolute",
          left: colLeft,
          top: colBottom - lo * pxPer - h * p,
          width: colW,
          height: Math.max(0, h * p - 4),
          borderRadius: 8,
          background:
            owner === 0
              ? `linear-gradient(90deg, #8E95A3, ${colour})`
              : `linear-gradient(90deg, ${accent}BB, ${accent})`,
          boxShadow:
            owner === active
              ? `0 0 26px ${colour}66`
              : "0 6px 16px rgba(0,0,0,0.4)",
          opacity: 0.35 + 0.65 * p,
        }}
      />,
    );
  }
  // A fall: the removed part peels away in red.
  const falls = totals
    .map((t, i) =>
      i > 0 && t < totals[i - 1]!
        ? { i, from: t, to: totals[i - 1]! }
        : undefined,
    )
    .filter(Boolean) as Array<{ i: number; from: number; to: number }>;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: colLeft - 18,
          top: colBottom - colH - 20,
          width: colW + 36,
          height: colH + 44,
          borderRadius: 18,
          border: "2px dashed rgba(255,255,255,0.12)",
        }}
      />
      {tiles}
      {falls.map((f) => {
        const t = interpolate(frame, [at[f.i]!, at[f.i]! + 22], [0, 1], clamp);
        if (frame < at[f.i]!) return null;
        return (
          <div
            key={f.i}
            style={{
              position: "absolute",
              left: colLeft + t * 60,
              top: colBottom - f.to * pxPer - t * 40,
              width: colW,
              height: (f.to - f.from) * pxPer - 4,
              borderRadius: 8,
              background: COLOUR.alert,
              opacity: 1 - t,
              transform: `rotate(${t * 8}deg)`,
            }}
          />
        );
      })}
      {e.items.map((it, i) => {
        if (frame < at[i]! - 1) return null;
        const p = land(frame, fps, at[i]!);
        const lo = i === 0 ? 0 : Math.min(totals[i - 1]!, totals[i]!);
        const hi = i === 0 ? totals[0]! : Math.max(totals[i - 1]!, totals[i]!);
        // Tall: a label near the top of the column keeps clear of the counter above it (its own half height below it).
        const lab = fitLabel(it.label, "howmuch", o, n);
        const half = (fitValue(it.value ?? "", "howmuch", o, n).size * 0.8 + lab.lines.length * lab.size * LINE_HEIGHT) / 2;
        const mid = Math.max(colBottom - ((lo + hi) / 2) * pxPer, tall ? content.top + counterSize + 16 + half : -Infinity);
        const isActive = i === active;
        const x = colLeft + colW + 40;
        // A row that changes nothing on the column (the total a change reaches) is set by the counter, top left.
        const flat = i > 0 && hi - lo < 1e-9;
        if (flat)
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: tall ? content.left : colLeft - 18,
                top: tall ? content.top + 4 : content.top - 6,
                opacity: Math.min(1, p * 1.3),
                transform: `translateY(${(1 - p) * -24}px)`,
              }}
            >
              <Value text={it.value ?? ""} type="howmuch" o={o} n={n} colour={isActive ? accent : COLOUR.paper} scale={0.8} />
              <Label text={it.label} type="howmuch" o={o} n={n} colour={COLOUR.paper} />
            </div>
          );
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: mid,
              display: "flex",
              alignItems: "center",
              gap: 20,
              opacity:
                Math.min(1, p * 1.3) * (isActive || i > active ? 1 : 0.6),
              transform: `translate(${(1 - p) * 50}px, -50%)`,
            }}
          >
            <svg
              width={34}
              height={Math.max(30, (hi - lo) * pxPer - 6)}
              style={{ flex: "none" }}
            >
              <path
                d={`M4,3 L18,3 L18,${Math.max(30, (hi - lo) * pxPer - 6) - 3} L4,${Math.max(30, (hi - lo) * pxPer - 6) - 3}`}
                fill="none"
                stroke={isActive ? accent : "rgba(255,255,255,0.4)"}
                strokeWidth={4}
              />
            </svg>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {it.icon ? (
                  <Icon
                    name={it.icon}
                    size={tall ? 54 : 40}
                    colour={isActive ? accent : COLOUR.muted}
                  />
                ) : null}
                <Value
                  text={it.value ?? ""}
                  type="howmuch"
                  o={o}
                  n={n}
                  colour={isActive ? accent : COLOUR.paper}
                  scale={0.8}
                />
              </div>
              <Label
                text={it.label}
                type="howmuch"
                o={o}
                n={n}
                colour={COLOUR.paper}
              />
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: tall ? content.left : content.left + content.width - 560,
          top: tall ? content.top : content.top + content.height / 2 - 90,
          width: tall ? content.width : 540,
          textAlign: tall ? "right" : "right",
          fontFamily: DISPLAY,
          fontSize: counterSize,
          lineHeight: 1,
          color: COLOUR.paper,
          fontVariantNumeric: "tabular-nums",
          opacity: counterIn,
          transform: `scale(${0.9 + 0.1 * counterIn})`,
          transformOrigin: "right top",
          textShadow: `0 0 40px ${accent}55`,
        }}
      >
        {counterText}
      </div>
    </>
  );
};
