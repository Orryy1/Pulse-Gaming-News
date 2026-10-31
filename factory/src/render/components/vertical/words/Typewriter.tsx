// Words/Typewriter (kind "quote"): a strip of paper feeds down out of a typewriter's platen while the
// quote types onto it fast, line by line behind an accent caret; the paper grows a line at a time, its
// foot torn. Once typed, the speaker is written underneath in marker with an accent swash.
// primary: the quote (4-30 words); secondary: the speaker (optional, 32 characters at most).
import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { HAND } from "../../fonts.ts";
import type { VGfxProps } from "../types.ts";
import {
  clamp01,
  exitOf,
  quoteText,
  ramp,
  rnd,
  textW,
  txt,
  words,
  wrap,
} from "./kit.ts";
import { SOFT_GRAIN, shadow } from "./kit.ts";

const W = 952;
const H = 500;
const PLATEN_H = 46;
const PAPER_X = 34;
const PAPER_W = W - PAPER_X * 2;
const PAD_X = 40;
const TEXT_W = PAPER_W - PAD_X * 2;
const PAD_TOP = 24;
const PAD_BOTTOM = 30;
const ATTR_GAP = 6;
const SIZES = [64, 58, 52, 48, 44, 40];
const TYPEFACE =
  "'Courier New', Courier, 'Nimbus Mono PS', 'Liberation Mono', monospace";
const INK = "#1d1b18";

type Layout = {
  lines: string[];
  size: number;
  lineH: number;
  attr: string;
  attrSize: number;
  attrH: number;
  total: number;
};

export function layoutTypewriter(v: VGfxProps["v"]): Layout | null {
  const quote = quoteText(v.primary);
  const n = words(quote).length;
  if (n < 4 || n > 30) return null;
  const attr = txt(v.secondary);
  if (attr.length > 32) return null;
  const typed = `"${quote}"`;
  for (const size of SIZES) {
    const lines = wrap(typed, "mono", size, TEXT_W);
    if (!lines) continue;
    const lineH = Math.round(size * 1.26);
    let attrSize = 0;
    if (attr) {
      attrSize = 56;
      while (attrSize > 40 && textW(attr, "marker", attrSize) > TEXT_W - 20)
        attrSize -= 2;
      if (textW(attr, "marker", attrSize) > TEXT_W - 20) continue;
    }
    const attrH = attr ? Math.round(attrSize * 1.4) : 0;
    const total =
      PLATEN_H +
      PAD_TOP +
      lines.length * lineH +
      (attr ? ATTR_GAP + attrH : 0) +
      PAD_BOTTOM;
    if (total <= H) return { lines, size, lineH, attr, attrSize, attrH, total };
  }
  return null;
}

/** A torn foot for the strip: a zigzag along the bottom 10 px. */
function tornFoot(seed: number): string {
  const pts: string[] = ["0 0", "100% 0"];
  const n = 26;
  for (let k = 0; k <= n; k++) {
    const x = 100 - (k / n) * 100;
    const y = (k % 2 ? 0 : 7) + 4 * rnd(seed, k);
    pts.push(`${x.toFixed(2)}% calc(100% - ${y.toFixed(1)}px)`);
  }
  return `polygon(${pts.join(", ")})`;
}

export const Typewriter: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = layoutTypewriter(v);
  if (!L) return null;
  const { lines, size, lineH, attr, attrSize, attrH, total } = L;
  const seed = 41 + variant * 13;
  const top = Math.round((H - total) / 3);

  // Typing: a fast run from frame 4, done by frame 28 at the most.
  const t0 = 4;
  const chars = lines.reduce((s, l) => s + l.length, 0);
  const dur = Math.max(10, Math.min(24, chars / 7));
  const cpf = chars / dur;
  const starts: number[] = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(t0 + acc / cpf);
    acc += l.length;
  }
  const done = t0 + dur;
  const typedIn = (i: number) =>
    Math.max(
      0,
      Math.min(lines[i]!.length, Math.floor((frame - starts[i]!) * cpf)),
    );

  // The paper feeds a line at a time (a quick snap per line), then once more for the speaker.
  const snap = (at: number) =>
    spring({
      frame: frame - at,
      fps,
      config: { damping: 18, stiffness: 420, mass: 0.4 },
    });
  let shown = snap(0);
  for (let i = 1; i < lines.length; i++) shown += snap(starts[i]! - 1);
  const attrAt = done + 2;
  const attrFeed = attr ? snap(attrAt) : 0;
  const paperH =
    PAD_TOP + shown * lineH + attrFeed * (ATTR_GAP + attrH) + PAD_BOTTOM;

  const drop = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 300, mass: 0.5 },
  });
  const out = exitOf(frame, len);
  const write = clamp01((frame - (attrAt + 3)) / 9);
  const swash = ramp(frame, attrAt + 9, attrAt + 18);

  const typing = frame < done;
  let caretLine = 0;
  for (let i = 0; i < lines.length; i++) if (frame >= starts[i]!) caretLine = i;
  const caretOn =
    typing ||
    (frame < attrAt + 3 + (attr ? 0 : 24) &&
      Math.floor((frame - done) / 6) % 2 === 0);
  const maxW = Math.max(...lines.map((l) => l.length)) * 0.6 * size;
  const attrW = attr ? textW(attr, "marker", attrSize) : 0;
  const textLeft = Math.round((PAPER_W - Math.max(maxW, attrW)) / 2);
  // The name sits under the quote's right edge, or starts at its left when it is the wider of the two.
  const attrPlace: React.CSSProperties =
    attrW > maxW ? { left: 0 } : { right: 0 };

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: W,
        height: total,
        opacity: out,
        transform: `translateY(${-(1 - out) * 30}px)`,
      }}
    >
      {/* The strip's shadow: a plain box tucked inside the torn foot, so the clip does not cut it. */}
      <div
        style={{
          position: "absolute",
          left: PAPER_X + 8,
          width: PAPER_W - 16,
          top: PLATEN_H - 10,
          height: Math.max(0, paperH - 6),
          boxShadow:
            "0 18px 40px rgba(0,0,0,0.55), 0 4px 10px rgba(0,0,0,0.35)",
          opacity: drop,
        }}
      />
      {/* The strip of paper, feeding down from under the platen. */}
      <div
        style={{
          position: "absolute",
          left: PAPER_X,
          width: PAPER_W,
          top: PLATEN_H - 14,
          height: paperH + 14,
          backgroundColor: "#f4f0e6",
          backgroundImage: `${SOFT_GRAIN}, linear-gradient(90deg, rgba(60,42,18,0.14) 0%, rgba(60,42,18,0) 6%, rgba(255,255,255,0.14) 45%, rgba(60,42,18,0) 85%, rgba(60,42,18,0.16) 100%), linear-gradient(180deg, rgba(40,28,12,0.28) 0px, rgba(40,28,12,0) 34px)`,
          clipPath: tornFoot(seed),
          opacity: drop,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: textLeft,
            top: 14 + PAD_TOP,
            fontFamily: TYPEFACE,
            fontWeight: 700,
            fontSize: size,
            color: INK,
            whiteSpace: "pre",
          }}
        >
          {lines.map((l, i) => {
            const n = typedIn(i);
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  height: lineH,
                  lineHeight: `${lineH}px`,
                }}
              >
                {Array.from(l.slice(0, n)).map((ch, k) => {
                  const age = frame - (starts[i]! + k / cpf);
                  const strike = Math.max(0, 1 - age / 2);
                  return (
                    <span
                      key={k}
                      style={{
                        display: "inline-block",
                        width: "0.6em",
                        opacity: 0.84 + 0.16 * rnd(seed, i * 97 + k),
                        transform: `translateY(${(rnd(seed, 400 + i * 97 + k) - 0.5) * 2.6}px) scale(${1 + 0.22 * strike})`,
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
                      left: `${0.6 * n}em`,
                      width: "0.6em",
                      bottom: (lineH - size) / 2 - 2,
                      height: Math.max(6, size * 0.1),
                      background: accent,
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
                top: lines.length * lineH + ATTR_GAP,
                height: attrH,
                display: "flex",
                alignItems: "center",
                transform: "rotate(-2deg)",
                transformOrigin: attrW > maxW ? "left center" : "right center",
              }}
            >
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "0.2em 0.25em",
                    margin: "-0.2em -0.25em",
                    clipPath: `inset(0 ${(1 - write) * 100}% 0 0)`,
                    fontFamily: HAND,
                    fontSize: attrSize,
                    lineHeight: 1.1,
                    color: INK,
                    whiteSpace: "nowrap",
                  }}
                >
                  {attr}
                </span>
                <svg
                  width="104%"
                  height={24}
                  viewBox="0 0 400 24"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", left: "-2%", bottom: -16 }}
                >
                  <path
                    d="M4 16 C 120 6, 260 22, 396 9"
                    stroke={accent}
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
      <Platen drop={drop} accent={accent} />
    </div>
  );
};

/** The platen the strip feeds from: a dark roller with knurled knobs at each end, an accent pin light. */
const Platen: React.FC<{ drop: number; accent: string }> = ({
  drop,
  accent,
}) => {
  const knob = (left: number): React.CSSProperties => ({
    position: "absolute",
    left,
    top: -4,
    width: 26,
    height: PLATEN_H + 8,
    borderRadius: 9,
    background:
      "linear-gradient(90deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 40%, rgba(0,0,0,0.45) 100%), repeating-linear-gradient(180deg, #2f2f34 0px, #2f2f34 4px, #131315 4px, #131315 8px)",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: W,
        height: PLATEN_H,
        opacity: drop,
        transform: `translateY(${(1 - drop) * -26}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          top: 0,
          height: PLATEN_H,
          borderRadius: 16,
          background:
            "linear-gradient(180deg, #060607 0%, #34343a 14%, #5a5a62 24%, #26262b 46%, #111113 78%, #060607 100%)",
          boxShadow: shadow(0.5),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: W / 2 - 40,
          top: PLATEN_H - 9,
          width: 80,
          height: 5,
          borderRadius: 3,
          background: accent,
          opacity: 0.9,
        }}
      />
      <div style={knob(0)} />
      <div style={knob(W - 26)} />
    </div>
  );
};

export const fitsTypewriter = (v: VGfxProps["v"]) =>
  layoutTypewriter(v) !== null;
