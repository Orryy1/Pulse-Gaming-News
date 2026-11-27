// Numbers/Odometer: the figure on rolling digit wheels in dark slots, each wheel spinning down and settling
// with a small bounce, left to right; currency signs, separators and words stay still. When the figure
// carries words ("12 million players") they sit on a second line in the accent so the digits stay huge.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import type { VGfxProps } from "../types.ts";
import {
  ANTON,
  H,
  Label,
  Pool,
  W,
  alpha,
  antonFit,
  clamp,
  clean,
  easeOut,
  exitStyle,
  fitLabel,
  labelFits,
  textEm,
  useBeat,
} from "./kit.tsx";

const SLOT_EM = 0.6; // a digit's slot, in em of the figure's size
const GAP_EM = 0.05;

/** The figure split where its words begin: "12 MILLION PLAYERS" -> "12 MILLION" / "PLAYERS" when it must. */
export function splitFigure(text: string): { head: string; tail: string } {
  const t = text.toUpperCase();
  const m = t.match(/^(.*\d(?:[\d,.]*\d)?\s?(?:%|\+|[KMBX]\b)?)\s*(.*)$/);
  if (!m) return { head: t, tail: "" };
  return { head: m[1]!.trim(), tail: m[2]!.trim() };
}

/** A line's width in em with each digit in its slot. */
const lineEm = (s: string) =>
  s
    .split("")
    .reduce(
      (a, c) => a + (/\d/.test(c) ? SLOT_EM + GAP_EM : textEm(c, ANTON) + 0.02),
      0,
    );

type Layout = { lines: string[]; size: number; tailSize: number };

function layout(text: string, labelH: number): Layout {
  const t = text.toUpperCase();
  const room = H - labelH - 10;
  const one = Math.floor(Math.min((W - 20) / lineEm(t), room / 1.02, 330));
  const { head, tail } = splitFigure(t);
  if (!tail || one >= 190) return { lines: [t], size: one, tailSize: 0 };
  const tailSize = Math.min(antonFit(tail, W - 20, 118), 118);
  const size = Math.floor(
    Math.min((W - 20) / lineEm(head), (room - tailSize * 0.98 - 8) / 1.02, 330),
  );
  return { lines: [head, tail], size, tailSize };
}

const Wheel: React.FC<{
  digit: number;
  size: number;
  frame: number;
  settle: number;
  spins: number;
}> = ({ digit, size, frame, settle, spins }) => {
  const h = size * 1.02;
  const travel = digit + 10 * spins;
  const u = interpolate(frame, [0, settle], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const after = Math.max(0, frame - settle);
  // Past the stop the wheel rocks back and settles: a small damped swing.
  const rock =
    frame > settle
      ? -0.16 * Math.exp(-after / 2.6) * Math.sin(after * 1.25)
      : 0;
  const pos = travel * u + rock;
  const base = Math.floor(pos);
  const frac = pos - base;
  const speed =
    travel *
    (interpolate(frame + 1, [0, settle], [0, 1], {
      ...clamp,
      easing: easeOut,
    }) -
      u);
  const smear = Math.min(1, speed / 3);
  const glyph = (n: number, y: number) => (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: h,
        lineHeight: `${h}px`,
        textAlign: "center",
        transform: `translateY(${y}px) scaleY(${1 + smear * 0.18})`,
        color: COLOUR.paper,
        opacity: 1 - smear * 0.35,
        textShadow:
          smear > 0.05
            ? `0 ${-h * 0.12 * smear}px 0 rgba(245,245,242,${0.3 * smear}), 0 ${h * 0.12 * smear}px 0 rgba(245,245,242,${0.3 * smear})`
            : undefined,
      }}
    >
      {((n % 10) + 10) % 10}
    </div>
  );
  return (
    <div
      style={{
        position: "relative",
        width: size * SLOT_EM,
        height: h,
        margin: `0 ${(size * GAP_EM) / 2}px`,
        overflow: "hidden",
        borderRadius: size * 0.07,
        background:
          "linear-gradient(180deg, #050506 0%, #1c1c21 22%, #26262c 50%, #1c1c21 78%, #050506 100%)",
        boxShadow:
          "inset 0 0 0 2px rgba(255,255,255,0.07), 0 14px 34px rgba(0,0,0,0.6)",
      }}
    >
      {glyph(base, -frac * h)}
      {glyph(base + 1, (1 - frac) * h)}
      {/* The wheel's curve: darker toward the slot's top and bottom edges. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 74%, rgba(0,0,0,0.78) 100%)",
        }}
      />
    </div>
  );
};

export const Odometer: React.FC<VGfxProps> = ({ v, len, accent }) => {
  const { frame, fps, out, visible } = useBeat(len);
  const figure = clean(v.primary).toUpperCase();
  const label = clean(v.secondary);
  if (!visible || !/\d/.test(figure)) return null;
  const lab = label ? fitLabel(label, W - 40, 44, 2) : undefined;
  const labelH = lab ? lab.lines.length * lab.size * 1.12 + 22 : 0;
  const { lines, size, tailSize } = layout(figure, labelH);
  const digits = lines[0]!.replace(/\D/g, "").length;
  const enter = spring({ frame, fps, config: SPRING.POP });
  let k = 0;
  const row = lines[0]!.split("").map((c, i) => {
    if (/\d/.test(c)) {
      const n = k++;
      // Left to right: the first wheel stops at frame 8, the last by 17.
      const settle = 8 + (digits > 1 ? (n / (digits - 1)) * 9 : 0);
      return (
        <Wheel
          key={i}
          digit={Number(c)}
          size={size}
          frame={frame}
          settle={settle}
          spins={1 + n}
        />
      );
    }
    if (c === " ") return <div key={i} style={{ width: size * 0.2 }} />;
    return (
      <div
        key={i}
        style={{
          fontFamily: DISPLAY,
          fontSize: size,
          lineHeight: `${size * 1.02}px`,
          color: COLOUR.paper,
          margin: `0 ${size * 0.01}px`,
          textShadow: "0 10px 30px rgba(0,0,0,0.8)",
        }}
      >
        {c}
      </div>
    );
  });
  const tailIn = interpolate(frame, [4, 12], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const rise = interpolate(frame, [8, 17], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  return (
    <div style={{ position: "absolute", inset: 0, ...exitStyle(out) }}>
      <Pool opacity={interpolate(frame, [0, 6], [0, 1], clamp)} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontFamily: DISPLAY,
            fontSize: size,
            transform: `translateY(${(1 - enter) * 40}px) scale(${0.9 + 0.1 * enter})`,
            opacity: interpolate(frame, [0, 4], [0, 1], clamp),
          }}
        >
          {row}
        </div>
        {lines[1] ? (
          <div style={{ overflow: "hidden", marginTop: 4 }}>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: tailSize,
                lineHeight: 0.98,
                color: accent,
                whiteSpace: "nowrap",
                transform: `translateY(${(1 - tailIn) * 100}%)`,
                textShadow: `0 0 30px ${alpha(accent, 0.45)}, 0 10px 30px rgba(0,0,0,0.8)`,
              }}
            >
              {lines[1]}
            </div>
          </div>
        ) : null}
        {lab ? (
          <div style={{ marginTop: 14 }}>
            <Label text={label} width={W - 40} rise={rise} max={44} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const fitsOdometer = (v: VGfxProps["v"]) => {
  const f = clean(v.primary);
  const label = clean(v.secondary);
  if (
    !/\d/.test(f) ||
    f.length > 16 ||
    f.replace(/\D/g, "").length > 9 ||
    !labelFits(label, W - 40)
  )
    return false;
  const lab = label ? fitLabel(label, W - 40, 44, 2) : undefined;
  const l = layout(f, lab ? lab.lines.length * lab.size * 1.12 + 22 : 0);
  return l.size >= 140 && (!l.lines[1] || l.tailSize >= 80);
};
