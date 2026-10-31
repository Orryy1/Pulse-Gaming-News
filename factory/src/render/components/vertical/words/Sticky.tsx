// Words/Sticky (kind "list"): the heading written in marker on a strip of masking tape, then two to four
// sticky notes slapped on in quick succession, each item in marker. Two notes sit side by side, three in
// a staggered row, four in a two by two grid. Tilts and colours come from the variant.
// primary: the heading (optional, 28 characters at most); items: 2-4 items of 30 characters or fewer.
// (An older list beat's "a | b | c" primary with its label in secondary reads the same.)
import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { HAND } from "../../fonts.ts";
import type { VGfxProps } from "../types.ts";
import { exitOf, jit, listOf, rnd, textW, wrap } from "./kit.ts";
import { SOFT_GRAIN, shadow } from "./kit.ts";

const W = 952;
const H = 500;
const INK = "#1d1b18";
const HEAD_H = 80;
const MIN_FONT = 40;

type Note = { x: number; y: number; w: number; h: number; lines: string[] };
type Layout = { head: string; headSize: number; notes: Note[]; font: number };

/** Faces and their deeper glue strips: yellow, a pale lemon, a soft pink and a mint. */
const FACES = [
  { face: "#ffe45a", glue: "#f5d03a" },
  { face: "#fff07e", glue: "#f6df58" },
  { face: "#ffa9c4", glue: "#f58fae" },
  { face: "#b8f0c8", glue: "#9fe2b2" },
];

/** The accent lightened toward white, for one note in each set. */
function tint(hex: string, t: number): string {
  const m = hex
    .replace("#", "")
    .match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#ffb07a";
  const c = [m[1], m[2], m[3]].map((x) =>
    Math.round(parseInt(x!, 16) + (255 - parseInt(x!, 16)) * t),
  );
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function layoutSticky(v: VGfxProps["v"]): Layout | null {
  const { head, items, raw } = listOf(v);
  if (items.length < 2 || items.length > 4 || items.length !== raw) return null;
  if (items.some((x) => x.length > 30) || head.length > 28) return null;
  let headSize = 0;
  if (head) {
    headSize = 58;
    while (headSize > MIN_FONT && textW(head, "marker", headSize) > W - 140)
      headSize -= 2;
    if (textW(head, "marker", headSize) > W - 140) return null;
  }
  const top = head ? HEAD_H + 18 : 8;
  const avail = H - top - 6;
  const n = items.length;
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (n === 2) {
    const s = Math.min(400, avail - 20);
    const gap = 48;
    const x0 = (W - (2 * s + gap)) / 2;
    for (let i = 0; i < 2; i++)
      boxes.push({ x: x0 + i * (s + gap), y: top + (i ? 18 : 0), w: s, h: s });
  } else if (n === 3) {
    const s = Math.min(292, avail - 46);
    const gap = (W - 3 * s) / 2 - 4;
    const x0 = (W - (3 * s + 2 * gap)) / 2;
    const ys = [0, 40, 8];
    for (let i = 0; i < 3; i++)
      boxes.push({ x: x0 + i * (s + gap), y: top + ys[i]!, w: s, h: s });
  } else {
    const gx = 36;
    const gy = 22;
    const w = (W - gx - 20) / 2;
    const h = Math.min(260, (avail - gy) / 2);
    const x0 = (W - (2 * w + gx)) / 2;
    for (let i = 0; i < 4; i++)
      boxes.push({
        x: x0 + (i % 2) * (w + gx),
        y: top + Math.floor(i / 2) * (h + gy) + (i % 2 ? 6 : 0),
        w,
        h,
      });
  }
  // One marker size for every note, so the list reads as one hand: the size the hardest item allows.
  for (let font = 84; font >= MIN_FONT; font -= 2) {
    const notes: Note[] = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      const b = boxes[i]!;
      const lines = wrap(items[i]!, "marker", font, b.w - (n === 4 ? 44 : 56));
      if (!lines || lines.length * font * 1.12 > b.h - (n === 4 ? 40 : 64)) {
        ok = false;
        break;
      }
      notes.push({ ...b, lines });
    }
    if (ok) return { head, headSize, notes, font };
  }
  return null;
}

/** Torn ends for the tape, as a clip-path polygon. */
function tornEnds(seed: number): string {
  const n = 7;
  const left: string[] = [];
  const right: string[] = [];
  for (let k = 0; k <= n; k++) {
    const y = (k / n) * 100;
    left.push(`${(k % 2 ? 0 : 6) + 4 * rnd(seed, k)}px ${y}%`);
    right.push(
      `calc(100% - ${(k % 2 ? 6 : 0) + 4 * rnd(seed, 40 + k)}px) ${100 - y}%`,
    );
  }
  return `polygon(${[...left, ...right].join(", ")})`;
}

export const Sticky: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = layoutSticky(v);
  if (!L) return null;
  const { head, headSize, notes, font } = L;
  const seed = 101 + variant * 17;
  const out = exitOf(frame, len);
  const leaving = 1 - out;

  const tape = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 320, mass: 0.5 },
  });
  const landAt = (i: number) => (head ? 3 : 0) + i * 3;
  const faces = FACES.map((f) => f);
  faces.splice(1 + (variant % 3), 0, {
    face: tint(accent, 0.52),
    glue: tint(accent, 0.38),
  });
  const start = Math.floor(rnd(seed, 3) * faces.length);
  const headW = head
    ? Math.min(W - 40, textW(head, "marker", headSize) + 110)
    : 0;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {head ? (
        <div
          style={{
            position: "absolute",
            left: (W - headW) / 2,
            top: 6,
            width: headW,
            height: HEAD_H,
            opacity: Math.min(1, tape * 2) * out,
            transform: `rotate(${(variant % 2 ? 1.4 : -1.6) + 0.5 * jit(seed, 1)}deg) scale(${1.2 - 0.2 * tape}) translateY(${-leaving * 30}px)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 10,
              right: 10,
              top: 12,
              bottom: 2,
              boxShadow: shadow(0.35),
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(236,226,196,0.97)",
              backgroundImage: `${SOFT_GRAIN}, linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 40%, rgba(120,100,60,0.14) 100%)`,
              clipPath: tornEnds(seed),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontFamily: HAND,
                fontSize: headSize,
                lineHeight: 1,
                color: INK,
                whiteSpace: "nowrap",
                transform: "translateY(3px)",
              }}
            >
              {head}
            </div>
          </div>
        </div>
      ) : null}
      {notes.map((nt, i) => {
        const s = spring({
          frame: frame - landAt(i),
          fps,
          config: { damping: 13, stiffness: 340, mass: 0.5 },
        });
        const lift = Math.max(0, 1 - s);
        const c = faces[(start + i) % faces.length]!;
        const tilt =
          (i % 2 ? 1 : -1) *
          (1.4 + 2.6 * rnd(seed, 10 + i)) *
          (variant % 2 ? -1 : 1);
        // On the way out the notes drop in turn, the last one first.
        const go = Math.min(
          1,
          Math.max(0, leaving * 1.6 - (notes.length - 1 - i) * 0.15),
        );
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: nt.x + 8 * jit(seed, 20 + i),
              top: nt.y,
              width: nt.w,
              height: nt.h,
              opacity: (s > 0.02 ? Math.min(1, s * 3) : 0) * (go > 0.85 ? (1 - go) / 0.15 : 1),
              transform: `translateY(${lift * -60 + go * go * 160}px) rotate(${tilt + lift * 8 + go * 10 * (i % 2 ? 1 : -1)}deg) scale(${1 + 0.3 * lift - 0.08 * go})`,
            }}
          >
            {/* The shadow: wide while the note is in the air, tight once it sticks, deeper under the curl. */}
            <div
              style={{
                position: "absolute",
                left: 12,
                right: 8,
                top: 26,
                bottom: 6,
                boxShadow: `${6 + 26 * lift}px ${12 + 40 * lift}px ${16 + 30 * lift}px rgba(0,0,0,${0.55 - 0.2 * lift})`,
                borderRadius: "4px 4px 26px 16px",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: c.face,
                backgroundImage: `${SOFT_GRAIN}, linear-gradient(180deg, ${c.glue} 0%, ${c.face} 16%, ${c.face} 84%, rgba(255,255,255,0.32) 95%, rgba(0,0,0,0.06) 100%), linear-gradient(100deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0) 20%, rgba(255,255,255,0.18) 60%, rgba(0,0,0,0.07) 100%)`,
                boxShadow: "0 1px 1px rgba(0,0,0,0.25)",
                borderRadius: "1px 1px 3px 10px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                paddingTop: 10,
                boxSizing: "border-box",
              }}
            >
              {nt.lines.map((l, k) => (
                <div
                  key={k}
                  style={{
                    fontFamily: HAND,
                    fontSize: font,
                    lineHeight: 1.12,
                    color: INK,
                    whiteSpace: "nowrap",
                    transform: `rotate(${-1.5 * jit(seed, 60 + i)}deg)`,
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const fitsSticky = (v: VGfxProps["v"]) => layoutSticky(v) !== null;
