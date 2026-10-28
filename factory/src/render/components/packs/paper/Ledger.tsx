// Paper/Ledger: two or three "label: value" figures entered in an accounting ledger. The labels are typed
// into the rows, the values written in marker in the money column, and when the values are alike (both
// money, both copies sold) the bigger one is circled in red pen as it draws on.

import React from "react";
import { Easing, interpolate, spring } from "remotion";
import { HAND } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, pairs, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import {
  INK,
  RED_PEN,
  SERIF,
  Sheet,
  TYPEFACE,
  Write,
  clamp,
  clean,
  jit,
} from "./kit.tsx";

const W = 1420;
const MARGIN_X = 118; // the red double rule on the left
const MONEY_X = 860; // the red double rule before the money column
const ROW = 150;
const HEAD = 150;
const RULE = 50;

const rowsOf = (g: MomentGraphic) =>
  pairs(g.items).map((r) => ({ a: clean(r.a), b: clean(r.b) }));

export function fitsLedger(g: MomentGraphic): boolean {
  const rows = rowsOf(g);
  return (
    g.items.length >= 2 &&
    g.items.length <= 3 &&
    rows.length === g.items.length &&
    rows.every((r) => r.a && r.b && r.a.length <= 32 && r.b.length <= 22) &&
    clean(g.primary).length <= 44
  );
}

const MULT: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  mn: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
};

/** A value as a number and the kind of thing it counts ("$", "copies"), so only like is compared with like. */
export function valueOf(v: string): { n: number; unit: string } | null {
  const m = v.match(
    /(-?\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|bn|mn|k|m|b)?\b/i,
  );
  if (!m) return null;
  const n =
    Number(m[1]!.replace(/,/g, "")) *
    (m[2] ? (MULT[m[2].toLowerCase()] ?? 1) : 1);
  if (!Number.isFinite(n)) return null;
  const unit = v
    .replace(m[0], " ")
    .toLowerCase()
    .replace(/[^a-z$£€¥%]+/g, " ")
    .trim()
    .replace(
      /\b(about|around|over|under|nearly|almost|roughly|more than|less than|than|some|approximately|approx|est|estimated)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return { n, unit };
}

/** The row holding the strictly biggest of like values, or -1. */
export function biggest(values: string[]): number {
  const parsed = values.map(valueOf);
  if (parsed.some((p) => !p) || new Set(parsed.map((p) => p!.unit)).size !== 1)
    return -1;
  const ns = parsed.map((p) => p!.n);
  const max = Math.max(...ns);
  return ns.filter((x) => x === max).length === 1 ? ns.indexOf(max) : -1;
}

export const Ledger: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 190);
  if (!visible || !fitsLedger(g)) return null;
  const rows = rowsOf(g);
  const head = clean(g.primary);
  const seed = 71 + variant * 5;
  const best = biggest(rows.map((r) => r.b));
  const n = rows.length;
  const H = HEAD + n * ROW + 70;

  const page = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [showFor - 14, showFor], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  const tilt = (variant % 2 ? 0.9 : -0.7) + 0.3 * jit(seed, 1);
  const labelLen = Math.max(...rows.map((r) => r.a.length));
  const labelSize = Math.max(
    32,
    Math.min(46, Math.floor((MONEY_X - MARGIN_X - 70) / (labelLen * 0.6))),
  );
  const valueLen = Math.max(...rows.map((r) => r.b.length));
  const valueSize = Math.max(
    40,
    Math.min(84, Math.floor((W - MONEY_X - 110) / (valueLen * 0.62))),
  );
  // Rows enter one after another: the label types on, then the value is written; the circle comes last.
  const rowAt = (i: number) => 18 + i * 16;
  const lastValue = rowAt(n - 1) + 8 + 14;
  const circle = interpolate(frame, [lastValue + 4, lastValue + 22], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  const close = interpolate(frame, [lastValue + 20, lastValue + 34], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad),
  });

  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div
        style={{
          marginTop: 56,
          opacity: Math.min(1, page * 2),
          transform: `translateY(${(1 - page) * 170 - 24 * out}px) rotate(${tilt * page - 4 * (1 - page)}deg) scale(${1 + 0.015 * out})`,
        }}
      >
        <Sheet
          width={W}
          tone="#eef1dc"
          extraLayer={`repeating-linear-gradient(180deg, transparent 0 ${RULE - 2}px, rgba(96,150,110,0.42) ${RULE - 2}px ${RULE}px)`}
          style={{ height: H, overflow: "hidden" }}
        >
          {/* The printed head: a clean band over the ruling, double rules under it. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: HEAD - 24,
              background: "linear-gradient(180deg, #eef1dc 0%, #eaeed6 100%)",
              borderBottom: "3px solid rgba(45,100,62,0.75)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: HEAD - 16,
              height: 2,
              background: "rgba(45,100,62,0.6)",
            }}
          />
          {/* The red double rules: the left margin and the money column. */}
          {[MARGIN_X, MONEY_X].map((x) => (
            <React.Fragment key={x}>
              <div
                style={{
                  position: "absolute",
                  left: x,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: "rgba(200,48,40,0.6)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: x + 6,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: "rgba(200,48,40,0.6)",
                }}
              />
            </React.Fragment>
          ))}
          {/* Thin green verticals: the cents columns at the right. */}
          {[W - 150, W - 75].map((x) => (
            <div
              key={x}
              style={{
                position: "absolute",
                left: x,
                top: HEAD - 16,
                bottom: 0,
                width: 2,
                background: "rgba(96,150,110,0.45)",
              }}
            />
          ))}
          {head ? (
            <div
              style={{
                position: "absolute",
                left: MARGIN_X + 40,
                right: 60,
                top: 34,
                fontFamily: SERIF,
                fontWeight: 700,
                fontSize: head.length > 30 ? 40 : 48,
                letterSpacing: 4,
                lineHeight: 1.1,
                textTransform: "uppercase",
                color: "#1f4a2e",
                whiteSpace: "nowrap",
                opacity: interpolate(frame, [6, 18], [0, 1], clamp),
                transform: `translateY(${interpolate(frame, [6, 18], [10, 0], clamp)}px)`,
              }}
            >
              {head}
            </div>
          ) : null}
          {rows.map((r, i) => {
            const top = HEAD + i * ROW;
            const t = rowAt(i);
            const typed = Math.max(
              0,
              Math.min(r.a.length, Math.floor((frame - t) * 2.2)),
            );
            const write = interpolate(frame, [t + 8, t + 22], [0, 1], {
              ...clamp,
              easing: Easing.out(Easing.quad),
            });
            const isBest = i === best;
            return (
              <React.Fragment key={i}>
                <div
                  style={{
                    position: "absolute",
                    left: MARGIN_X + 40,
                    // Courier's baseline sits 0.82 em into a 1.1 line: rest it just above the row's last rule.
                    top: top + ROW - 6 - labelSize * 0.82,
                    fontFamily: TYPEFACE,
                    fontWeight: 700,
                    fontSize: labelSize,
                    lineHeight: 1.1,
                    color: INK,
                    whiteSpace: "pre",
                    textShadow: "0 0 0.7px rgba(29,27,24,0.55)",
                  }}
                >
                  {r.a.slice(0, typed)}
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: MONEY_X + 56,
                    // The marker's baseline sits 0.97 em into its 1.15 line (its ascent is 1.11 em): same rule as the label.
                    top: top + ROW - 6 - valueSize * 0.97,
                    transform: `rotate(${-1.6 + 1.2 * jit(seed, 10 + i)}deg)`,
                    transformOrigin: "left bottom",
                  }}
                >
                  <div
                    style={{ position: "relative", display: "inline-block" }}
                  >
                    <Write
                      p={write}
                      style={{
                        fontFamily: HAND,
                        fontSize: valueSize,
                        lineHeight: 1.15,
                        color: "#121110",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.b}
                    </Write>
                    {isBest ? (
                      <>
                        {/* The red pen: once round, a touch past where it started. */}
                        <div
                          style={{
                            position: "absolute",
                            left: -34,
                            right: -34,
                            top: -16,
                            bottom: -12,
                            borderRadius: "50%",
                            borderStyle: "solid",
                            borderColor: RED_PEN,
                            borderWidth: "6px 7px 5px 7px",
                            transform: "rotate(-4deg)",
                            WebkitMaskImage: `conic-gradient(from 200deg, #000 ${circle * 360}deg, transparent ${circle * 360}deg)`,
                            maskImage: `conic-gradient(from 200deg, #000 ${circle * 360}deg, transparent ${circle * 360}deg)`,
                            opacity: circle > 0 ? 0.92 : 0,
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            left: -30,
                            right: -40,
                            top: -12,
                            bottom: -14,
                            borderRadius: "50%",
                            borderStyle: "solid",
                            borderColor: RED_PEN,
                            borderWidth: "5px 6px 4px 5px",
                            transform: "rotate(-1deg)",
                            WebkitMaskImage: `conic-gradient(from 196deg, #000 ${close * 48}deg, transparent ${close * 48}deg)`,
                            maskImage: `conic-gradient(from 196deg, #000 ${close * 48}deg, transparent ${close * 48}deg)`,
                            opacity: close > 0 ? 0.85 : 0,
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          {/* The accountant's double underline under the money column, ruled once the figures are in. */}
          <div
            style={{
              position: "absolute",
              left: MONEY_X + 40,
              top: HEAD + n * ROW + 14,
              width:
                (W - MONEY_X - 90) *
                interpolate(frame, [lastValue, lastValue + 14], [0, 1], {
                  ...clamp,
                  easing: Easing.out(Easing.quad),
                }),
              height: 12,
              borderTop: "3px solid rgba(29,27,24,0.8)",
              borderBottom: "3px solid rgba(29,27,24,0.8)",
              boxSizing: "border-box",
            }}
          />
        </Sheet>
      </div>
    </Stage>
  );
};
