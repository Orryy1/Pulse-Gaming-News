// Paper/Typewriter: a quote typed onto a sheet rolled into a typewriter. Only the paper, the platen and a
// hint of the carriage are drawn (no maker's name). Letters strike on one by one behind a caret, the
// carriage creeps left along each line and returns, the paper feeds up a line at a time, then rolls up
// so the quote sits centred and the speaker is written underneath in marker.

import React from "react";
import { Easing, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { HAND } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import {
  GRAIN,
  INK,
  MOTTLE,
  TYPEFACE,
  Write,
  clamp,
  clean,
  rnd,
  wordCount,
  wrapMono,
  type MonoLine,
} from "./kit.tsx";

const PLATEN_TOP = 846;
const PLATEN_H = 112;
/** The bottom of the line being typed sits just above the platen. */
const STRIKE = PLATEN_TOP - 14;
const PAPER_W = 1360;
const PAPER_X = (1920 - PAPER_W) / 2;
const PAPER_H = 1900;
const TEXT_MAX_W = 1150;
const TOP_MARGIN = 96;
const LINE = 1.42;
const GAP = 26;
/** Where the finished block (quote and name) is centred. */
const CENTRE_Y = 478;
const SHIFT = 30;
const SIZES = [78, 72, 66, 60, 55, 50, 46, 42, 39, 36];
const RETURN = 4;

type Layout = {
  lines: MonoLine[];
  size: number;
  lineH: number;
  attr: string;
  attrSize: number;
  attrH: number;
};

/** The speaker's line in marker: the biggest size up to 58 px that fits one line. */
function attrFit(attr: string) {
  if (!attr) return { attrSize: 0, attrH: 0 };
  const attrSize = Math.max(
    34,
    Math.min(58, Math.floor(1050 / (attr.length * 0.62))),
  );
  return { attrSize, attrH: Math.round(attrSize * 1.5) };
}

export function layoutTypewriter(g: MomentGraphic): Layout | null {
  const quote = clean(g.primary)
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .trim();
  const n = wordCount(quote);
  if (n < 4 || n > 40) return null;
  const attr = clean(g.secondary);
  if (attr.length > 60) return null;
  const { attrSize, attrH } = attrFit(attr);
  const typed = `"${quote}"`;
  for (const size of SIZES) {
    const lines = wrapMono(typed, Math.floor(TEXT_MAX_W / (size * 0.6)));
    if (!lines || lines.length > 8) continue;
    const lineH = Math.round(size * LINE);
    if (lines.length * lineH + (attr ? GAP + attrH : 0) <= 560)
      return { lines, size, lineH, attr, attrSize, attrH };
  }
  return null;
}

export const fitsTypewriter = (g: MomentGraphic) =>
  layoutTypewriter(g) !== null;

export const Typewriter: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 210);
  const L = layoutTypewriter(g);
  if (!visible || !L) return null;
  const { lines, size, lineH, attr, attrSize, attrH } = L;
  const N = lines.length;
  const seed = 31 + variant * 13;

  // Typing runs from t0 and is done by `fin` (about frame 88; sooner for a short quote or a short sentence).
  const t0 = 14;
  const fin = Math.max(44, Math.min(88, showFor - 60));
  const chars = lines.reduce((s, l) => s + l.text.length, 0);
  const cpf = Math.max(0.62, chars / Math.max(10, fin - t0 - RETURN * (N - 1)));
  const starts: number[] = [];
  const ends: number[] = [];
  let t = t0;
  for (const l of lines) {
    starts.push(t);
    t += l.text.length / cpf;
    ends.push(t);
    t += RETURN;
  }
  const done = ends[N - 1]!;
  const typed = (i: number) =>
    Math.max(
      0,
      Math.min(lines[i]!.text.length, Math.floor((frame - starts[i]!) * cpf)),
    );

  // The paper feeds a line on each return, then rolls up so the block sits centred.
  const snap = (at: number) =>
    spring({
      frame: frame - at,
      fps,
      config: { damping: 18, stiffness: 320, mass: 0.5 },
    });
  let feed = 0;
  for (let i = 1; i < N; i++) feed += snap(ends[i - 1]! + 1);
  const blockH = N * lineH + (attr ? GAP + attrH : 0);
  const finalFeed = Math.max(
    N - 1,
    (STRIKE - CENTRE_Y + blockH / 2) / lineH - 1,
  );
  const roll = spring({
    frame: frame - (done + 5),
    fps,
    config: { damping: 20, stiffness: 110, mass: 0.9 },
  });
  feed += (finalFeed - (N - 1)) * roll;
  const paperTop = STRIKE - TOP_MARGIN - (feed + 1) * lineH;

  // The carriage creeps left as a line types, and slams back on the return.
  let cx = 0;
  for (let i = 0; i < N; i++) {
    if (frame < starts[i]!) break;
    if (frame < ends[i]!)
      cx = -SHIFT * ((frame - starts[i]!) / (ends[i]! - starts[i]!));
    else cx = -SHIFT * (1 - snap(ends[i]!));
  }

  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [showFor - 14, showFor], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  const maxW = Math.max(...lines.map((l) => l.text.length)) * size * 0.6;
  const textLeft = Math.round((PAPER_W - maxW) / 2);
  // The name sits under the quote's right edge, or centred under it when it is the wider of the two.
  const attrW = attr ? attr.length * 0.62 * attrSize : 0;
  const attrPlace: React.CSSProperties =
    attrW > maxW ? { left: Math.round((maxW - attrW) / 2) } : { right: 0 };
  // The name follows the roll; on a short sentence it comes sooner so it still holds a second.
  const attrAt = Math.min(done + 16, Math.max(done + 4, showFor - 50));
  const write = interpolate(frame, [attrAt, attrAt + 20], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad),
  });
  const swash = interpolate(frame, [attrAt + 14, attrAt + 28], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  // The caret: steady while typing, blinking until the name is written, then gone.
  const typing = frame >= t0 - 4 && frame < done;
  const caretOn =
    typing ||
    (frame >= done &&
      frame < attrAt &&
      Math.floor((frame - done) / 8) % 2 === 0);
  let caretLine = 0;
  for (let i = 0; i < N; i++) if (frame >= starts[i]! - RETURN) caretLine = i;
  const caretCol = typed(caretLine);
  const tone = year && year < 2000 ? "#efe6d0" : "#f3efe4";

  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${(1 - enter) * 320 + 30 * out}px)`,
        }}
      >
        {/* The sheet, moving with the carriage; its foot runs down behind the platen. */}
        <div
          style={{
            position: "absolute",
            left: PAPER_X + cx,
            top: paperTop,
            width: PAPER_W,
            height: PAPER_H,
            backgroundColor: tone,
            backgroundImage: `${GRAIN}, ${MOTTLE}, linear-gradient(90deg, rgba(60,42,18,0.16) 0%, rgba(60,42,18,0) 7%, rgba(255,255,255,0.12) 40%, rgba(60,42,18,0) 80%, rgba(60,42,18,0.18) 100%)`,
            boxShadow: "0 0 2px rgba(0,0,0,0.4), 0 30px 70px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: textLeft,
              top: TOP_MARGIN,
              fontFamily: TYPEFACE,
              fontWeight: 700,
              fontSize: size,
              color: INK,
              whiteSpace: "pre",
            }}
          >
            {lines.map((l, i) => {
              const n = typed(i);
              const base = l.start;
              return (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    height: lineH,
                    lineHeight: `${lineH}px`,
                  }}
                >
                  {Array.from(l.text.slice(0, n)).map((ch, k) => {
                    const age = frame - (starts[i]! + k / cpf);
                    const strike = Math.max(0, 1 - age / 2.5);
                    return (
                      <span
                        key={k}
                        style={{
                          display: "inline-block",
                          width: "1ch",
                          opacity: 0.86 + 0.14 * rnd(seed, base + k),
                          transform: `translateY(${(rnd(seed, 500 + base + k) - 0.5) * 2.4}px) scale(${1 + 0.16 * strike})`,
                          textShadow: "0 0 0.8px rgba(29,27,24,0.6)",
                        }}
                      >
                        {ch}
                      </span>
                    );
                  })}
                  {caretOn && i === caretLine ? (
                    <div
                      style={{
                        position: "absolute",
                        left: `${caretCol}ch`,
                        width: "1ch",
                        bottom: (lineH - size) / 2 - 4,
                        height: Math.max(5, size * 0.09),
                        background: COLOUR.amber,
                        borderRadius: 2,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            {attr ? (
              <div
                style={{
                  position: "absolute",
                  ...attrPlace,
                  top: N * lineH + GAP,
                  height: attrH,
                  display: "flex",
                  alignItems: "center",
                  transform: "rotate(-2deg)",
                  transformOrigin: "right center",
                }}
              >
                <div style={{ position: "relative" }}>
                  <Write
                    p={write}
                    style={{
                      fontFamily: HAND,
                      fontSize: attrSize,
                      lineHeight: 1.1,
                      color: INK,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {attr}
                  </Write>
                  <svg
                    width="104%"
                    height={30}
                    viewBox="0 0 400 30"
                    preserveAspectRatio="none"
                    style={{ position: "absolute", left: "-2%", bottom: -22 }}
                  >
                    <path
                      d="M4 20 C 120 8, 260 26, 396 12"
                      stroke={COLOUR.amber}
                      strokeWidth={7}
                      strokeLinecap="round"
                      fill="none"
                      pathLength={1}
                      strokeDasharray={1}
                      strokeDashoffset={1 - swash}
                    />
                  </svg>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {/* Where the paper bends round the platen it falls into shadow. */}
        <div
          style={{
            position: "absolute",
            left: PAPER_X + cx,
            width: PAPER_W,
            top: PLATEN_TOP - 46,
            height: 48,
            background:
              "linear-gradient(180deg, rgba(40,28,12,0) 0%, rgba(40,28,12,0.24) 100%)",
          }}
        />
        <Carriage x={cx} />
      </div>
    </Stage>
  );
};

/** The platen, its knobs, the return lever and the rail, all moving with the carriage; the body stays put. */
const Carriage: React.FC<{ x: number }> = ({ x }) => {
  const L = 170;
  const W = 1580;
  const knob = (side: "l" | "r"): React.CSSProperties => ({
    position: "absolute",
    top: PLATEN_TOP - 22,
    left: side === "l" ? L - 92 + x : L + W + 22 + x,
    width: 70,
    height: PLATEN_H + 44,
    borderRadius: 22,
    background:
      "linear-gradient(90deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.45) 100%), repeating-linear-gradient(180deg, #2d2d32 0px, #2d2d32 5px, #121214 5px, #121214 10px)",
    boxShadow: "0 16px 30px rgba(0,0,0,0.6)",
  });
  const hub = (side: "l" | "r"): React.CSSProperties => ({
    position: "absolute",
    top: PLATEN_TOP + 14,
    left: side === "l" ? L - 26 + x : L + W - 4 + x,
    width: 30,
    height: PLATEN_H - 28,
    borderRadius: 6,
    background:
      "linear-gradient(180deg, #5d6066 0%, #e3e5e8 30%, #8a8d93 60%, #3b3d42 100%)",
  });
  return (
    <>
      {/* The body under the carriage: dark, still, catching a little light along its top. */}
      <div
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          top: PLATEN_TOP + PLATEN_H + 20,
          height: 220,
          borderRadius: "34px 34px 0 0",
          background:
            "linear-gradient(180deg, #2a2a2f 0%, #17171a 18%, #0c0c0e 100%)",
          boxShadow:
            "inset 0 2px 0 rgba(255,255,255,0.12), 0 -10px 40px rgba(0,0,0,0.5)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: L - 30 + x,
          width: W + 60,
          top: PLATEN_TOP + PLATEN_H + 4,
          height: 16,
          borderRadius: 8,
          background:
            "linear-gradient(180deg, #e9ebee 0%, #9a9da3 45%, #4a4c51 100%)",
          boxShadow: "0 6px 12px rgba(0,0,0,0.5)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: L + x,
          top: PLATEN_TOP,
          width: W,
          height: PLATEN_H,
          borderRadius: 20,
          background:
            "linear-gradient(180deg, #060607 0%, #303036 12%, #55555d 22%, #26262b 44%, #111113 76%, #060607 100%)",
          boxShadow: "0 22px 40px rgba(0,0,0,0.6)",
        }}
      />
      <div style={hub("l")} />
      <div style={hub("r")} />
      <div style={knob("l")} />
      <div style={knob("r")} />
    </>
  );
};
