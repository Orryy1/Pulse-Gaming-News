// Paper/Redacted: the source's own words as a typed file copy. Black redaction bars sweep over the
// passage one line after another, leaving only the key phrase, which then takes an amber marker. The
// document is generic (no letterhead, no file numbers) and tagged ILLUSTRATION; the credit is the source's.

import React from "react";
import { Easing, interpolate, spring } from "remotion";
import { BODY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import {
  INK,
  INK_MASK,
  STREAKS,
  IllustrationTag,
  Sheet,
  TYPEFACE,
  clamp,
  clean,
  jit,
  wordCount,
  wrapMono,
  type MonoLine,
} from "./kit.tsx";

/** A portrait-ish sheet for short passages, widening for long ones so the type stays big. */
const SHEET_WS = [1000, 1240, 1360, 1480];
const PAD_X = 92;
/** The typed passage's height budget: with the header and the credit the sheet stays inside the safe area. */
const BODY_MAX_H = 520;
const LINE = 1.52;
const SIZES = [60, 56, 52, 48, 45, 42, 40, 37, 34, 32];

type Layout = {
  text: string;
  size: number;
  sheetW: number;
  lines: MonoLine[];
  ks: number;
  ke: number;
};

/** Where the key phrase sits in the passage (case and curly quotes ignored), as [start, end). */
function findPhrase(text: string, phrase: string): [number, number] | null {
  if (!phrase) return null;
  const fold = (s: string) =>
    s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
  const t = fold(text);
  if (t.length !== text.length) return null;
  for (const p of [phrase, phrase.replace(/^[^\w$£€]+|[^\w%)]+$/g, "")]) {
    const q = fold(p);
    if (!q) continue;
    const i = t.indexOf(q);
    if (i >= 0) return [i, i + q.length];
  }
  return null;
}

export function layoutRedacted(g: MomentGraphic): Layout | null {
  const text = clean(g.primary);
  const key = clean(g.items[0]);
  const n = wordCount(text);
  const kn = wordCount(key);
  if (n < 10 || n > 70 || kn < 1 || kn > 10) return null;
  const at = findPhrase(text, key);
  // The phrase must be in the passage, and leave something to redact.
  if (!at || at[1] - at[0] > text.length * 0.6) return null;
  for (const size of SIZES)
    for (const sheetW of SHEET_WS) {
      const lines = wrapMono(
        text,
        Math.floor((sheetW - PAD_X * 2) / (size * 0.6)),
      );
      if (lines && lines.length * Math.round(size * LINE) <= BODY_MAX_H)
        return { text, size, sheetW, lines, ks: at[0], ke: at[1] };
    }
  return null;
}

export const fitsRedacted = (g: MomentGraphic) =>
  layoutRedacted(g) !== null && clean(g.secondary).length <= 90;

type Run = {
  a: number;
  b: number;
  nearKeyLeft: boolean;
  nearKeyRight: boolean;
};

/** Per line: the key phrase's part, and the runs around it to black out (line-relative chars). */
function splitLine(ln: MonoLine, ks: number, ke: number) {
  const ls = ln.start;
  const le = ls + ln.text.length;
  const k0 = Math.max(ls, ks);
  const k1 = Math.min(le, ke);
  const key = k1 > k0 ? { a: k0 - ls, b: k1 - ls } : null;
  const parts: Array<[number, number, boolean, boolean]> = key
    ? [
        [0, key.a, false, true],
        [key.b, ln.text.length, true, false],
      ]
    : [[0, ln.text.length, false, false]];
  const runs: Run[] = [];
  for (const [a0, b0, l, r] of parts) {
    let a = a0;
    let b = b0;
    while (a < b && ln.text[a] === " ") a++;
    while (b > a && ln.text[b - 1] === " ") b--;
    if (b > a)
      runs.push({
        a,
        b,
        nearKeyLeft: l && a === a0,
        nearKeyRight: r && b === b0,
      });
  }
  return { key, runs };
}

/** A rubber stamp landing, with dry ink. */
const Stamp: React.FC<{ s: number; children: React.ReactNode }> = ({
  s,
  children,
}) => (
  <div
    style={{
      display: "inline-block",
      padding: "8px 18px 6px",
      border: "4px solid #b3352b",
      borderRadius: 8,
      fontFamily: BODY,
      fontWeight: 900,
      fontSize: 30,
      letterSpacing: 7,
      lineHeight: 1.1,
      color: "#b3352b",
      whiteSpace: "nowrap",
      mixBlendMode: "multiply",
      WebkitMaskImage: INK_MASK,
      maskImage: INK_MASK,
      opacity: s > 0.02 ? Math.min(1, s * 1.6) * 0.92 : 0,
      transform: `rotate(-3.5deg) scale(${1.55 - 0.55 * s})`,
    }}
  >
    {children}
  </div>
);

const CLIP =
  "M24 140 V44 a12 12 0 0 1 24 0 V156 a20 20 0 0 1 -40 0 V30 a26 26 0 0 1 52 0 V142";

/** A steel paperclip with its shadow. */
const Paperclip: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <svg
    width={74}
    height={196}
    viewBox="0 0 74 196"
    style={{ position: "absolute", ...style }}
  >
    <defs>
      <linearGradient id="paperSteel" x1="0" x2="1" y1="0" y2="0.2">
        <stop offset="0" stopColor="#7d8087" />
        <stop offset="0.42" stopColor="#f1f2f4" />
        <stop offset="0.6" stopColor="#b9bcc2" />
        <stop offset="1" stopColor="#6e7178" />
      </linearGradient>
    </defs>
    <path
      d={CLIP}
      transform="translate(7 8)"
      stroke="rgba(0,0,0,0.3)"
      strokeWidth={6}
      fill="none"
      strokeLinecap="round"
    />
    <path
      d={CLIP}
      stroke="url(#paperSteel)"
      strokeWidth={5.5}
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

export const Redacted: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  year,
}) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 210);
  const L = layoutRedacted(g);
  if (!visible || !L) return null;
  const { size, sheetW, lines, ks, ke } = L;
  const lineH = Math.round(size * LINE);
  const credit = clean(g.secondary);
  const seed = 17 + variant * 7;

  // The reveal is complete (and readable) by `fin`: about frame 88, earlier on a short sentence.
  const fin = Math.max(44, Math.min(88, showFor - 50));
  const r0 = 15;
  const r1 = fin - 17;
  const h0 = fin - 15;

  const page = spring({ frame, fps, config: SPRING.ENTER });
  const stamp = spring({ frame: frame - 9, fps, config: SPRING.SNAP });
  const out = interpolate(frame, [showFor - 14, showFor], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  const push = interpolate(frame, [fin, showFor], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad),
  });
  const tilt = (variant % 2 ? 0.7 : -0.8) + 0.3 * jit(seed, 1);

  const split = lines.map((ln) => splitLine(ln, ks, ke));
  // One sweep per line, a little overlap between lines, like a hand working down the page.
  const step = (r1 - r0) / lines.length;
  const sweep = (i: number) =>
    interpolate(
      frame,
      [r0 + i * step, r0 + (i + 1) * step + step * 0.3],
      [0, 1],
      {
        ...clamp,
        easing: Easing.inOut(Easing.quad),
      },
    );
  // The highlighter runs along the phrase's parts in reading order.
  const keyChars = split.reduce(
    (n, s) => n + (s.key ? s.key.b - s.key.a : 0),
    0,
  );
  const hl = interpolate(frame, [h0, fin], [0, keyChars], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });

  // The camera eases in on the phrase once it is marked.
  const keyLine = Math.max(
    0,
    split.findIndex((s) => s.key),
  );
  const kseg = split[keyLine]?.key;
  const ox =
    PAD_X +
    (kseg ? ((kseg.a + kseg.b) / 2) * size * 0.6 : (sheetW - PAD_X * 2) / 2);
  const oy = 44 + 70 + 34 + keyLine * lineH + lineH / 2;
  const tone = year && year < 2000 ? "#efe5cc" : "#f3eee1";

  let hlUsed = 0;
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div
        style={{
          marginTop: 52,
          opacity: Math.min(1, page * 2),
          transform: `translateY(${(1 - page) * 170 - 24 * out}px) rotate(${tilt * page - 4.5 * (1 - page)}deg) scale(${1 + 0.015 * out})`,
        }}
      >
        <div
          style={{
            position: "relative",
            transformOrigin: `${ox}px ${oy}px`,
            transform: `scale(${1 + 0.045 * push})`,
          }}
        >
          <Sheet
            width={sheetW}
            tone={tone}
            style={{ padding: `44px ${PAD_X}px 34px` }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 30,
                height: 70,
              }}
            >
              <Stamp s={stamp}>FILE COPY</Stamp>
              <div style={{ flex: 1 }}>
                <div style={{ height: 3, background: "rgba(29,27,24,0.7)" }} />
                <div
                  style={{
                    height: 1.5,
                    marginTop: 4,
                    background: "rgba(29,27,24,0.5)",
                  }}
                />
              </div>
            </div>
            <div
              style={{
                marginTop: 34,
                fontFamily: TYPEFACE,
                fontWeight: 700,
                fontSize: size,
                color: INK,
                textShadow: "0 0 0.7px rgba(29,27,24,0.55)",
              }}
            >
              {lines.map((ln, i) => {
                const { key, runs } = split[i]!;
                const pen = sweep(i) * ln.text.length;
                let hlPart = 0;
                if (key) {
                  hlPart = Math.max(0, Math.min(key.b - key.a, hl - hlUsed));
                  hlUsed += key.b - key.a;
                }
                return (
                  <div
                    key={i}
                    style={{
                      position: "relative",
                      height: lineH,
                      lineHeight: `${lineH}px`,
                      whiteSpace: "pre",
                    }}
                  >
                    {key && hlPart > 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          left: `${key.a - 0.3}ch`,
                          width: `${hlPart + 0.6}ch`,
                          top: (lineH - size * 1.08) / 2 + 2,
                          height: size * 1.08,
                          background: "rgba(255,107,26,0.88)",
                          borderRadius: "5px 12px 7px 14px",
                          transform: `skewX(-6deg) rotate(${0.4 * jit(seed, 50 + i)}deg)`,
                        }}
                      />
                    ) : null}
                    <span style={{ position: "relative" }}>{ln.text}</span>
                    {runs.map((r, k) => {
                      const shown = Math.max(0, Math.min(r.b - r.a, pen - r.a));
                      if (shown <= 0) return null;
                      // Bars overhang the words a little, but stop short of the kept phrase.
                      const padL = r.nearKeyLeft ? -0.35 : 0.18;
                      const padR = r.nearKeyRight ? -0.35 : 0.18;
                      const a = r.a - padL;
                      const full = r.b - r.a + padL + padR;
                      const w =
                        shown >= r.b - r.a ? full : Math.max(0, shown + padL);
                      return (
                        <div
                          key={k}
                          style={{
                            position: "absolute",
                            left: `${a}ch`,
                            width: `${w}ch`,
                            top:
                              (lineH - size * 1.14) / 2 +
                              1 +
                              2 * jit(seed, i * 9 + k),
                            height: size * 1.14,
                            backgroundColor: "#0c0c0c",
                            backgroundImage: `${STREAKS}, linear-gradient(180deg, #1d1c1b 0%, #0b0b0b 24%, #151413 62%, #080808 100%)`,
                            backgroundPosition: `${-37 * (i * 9 + k)}px 0, 0 0`,
                            borderRadius: "3px 6px 4px 5px",
                            transform: `rotate(${0.35 * jit(seed, 20 + i * 9 + k)}deg)`,
                            boxShadow: "0 0 1px rgba(0,0,0,0.7)",
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 30,
                paddingTop: 16,
                borderTop: "2px solid rgba(29,27,24,0.32)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 30,
              }}
            >
              <div
                style={{
                  fontFamily: TYPEFACE,
                  fontWeight: 700,
                  fontSize: credit.length > 56 ? 23 : 26,
                  color: "#4a453d",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {credit}
              </div>
              <IllustrationTag on="paper" />
            </div>
          </Sheet>
          <Paperclip
            style={{ left: sheetW - 210, top: -60, transform: "rotate(5deg)" }}
          />
        </div>
      </div>
    </Stage>
  );
};
