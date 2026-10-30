// Words/Flap (kind "timeline"): a split-flap departures board. It lands, then row by row the year's four
// digit modules flip through a few numbers and the event's wide slat flips through scrambled letters
// before settling, all done by about frame 28; the latest row lights in the accent.
// primary: the heading (optional, 26 characters at most); items: 2-4 "2013: GTA V launches" rows (an ISO
// date such as 2023-12 shows its year), each event 22 characters or fewer.
// (An older beat's "2013: a | 2020: b" primary with its heading in secondary reads the same.)
import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BODY } from "../../fonts.ts";
import { COLOUR } from "../../../brand.ts";
import type { VGfxProps } from "../types.ts";
import { exitOf, ramp, rgba, rnd, textW, txt, yearRows } from "./kit.ts";

const W = 952;
const H = 500;
const PAD = 24;
const COL_GAP = 18;
const FLIP = 2; // frames per flip
const LETTERS = "ABCDEFGHIJKLMNOPRSTUVWXYZ";
const DIGITS = "0123456789";

/** Capitals the board can show: accents dropped, curly quotes straightened. */
const boardText = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toUpperCase();

type Layout = {
  head: string;
  rows: Array<{ year: string; what: string }>;
  h: number;
  mw: number;
  mg: number;
  slatW: number;
  font: number;
  rowGap: number;
  total: number;
};

function rowsOf(v: VGfxProps["v"]): {
  head: string;
  rows: Array<{ year: string; what: string }> | null;
  raw: number;
} {
  const own = (v.items ?? []).filter((x) => x.trim());
  if (own.length)
    return { head: txt(v.primary), rows: yearRows(own), raw: own.length };
  if (v.primary.includes("|")) {
    const parts = v.primary.split("|").filter((x) => x.trim());
    return { head: txt(v.secondary), rows: yearRows(parts), raw: parts.length };
  }
  return { head: "", rows: null, raw: 0 };
}

export function layoutFlap(v: VGfxProps["v"]): Layout | null {
  const { head: h0, rows: r0 } = rowsOf(v);
  if (!r0 || r0.length < 2 || r0.length > 4) return null;
  const rows = r0.map((r) => ({ year: r.year, what: boardText(r.what) }));
  if (rows.some((r) => r.what.length > 22)) return null;
  const head = boardText(h0);
  if (
    head.length > 26 ||
    (head && textW(head, "inter900", 40, 4) > W - 2 * PAD - 40)
  )
    return null;
  const n = rows.length;
  const rowGap = n <= 3 ? 14 : 10;
  // The tallest modules whose events still fit their slat at 40 px or more and whose board fits the box.
  for (const h of [100, 92, 86, 80, 74, 68]) {
    const mw = Math.round(h * 0.66);
    const mg = 5;
    const slatW = W - 2 * PAD - (4 * mw + 3 * mg) - COL_GAP;
    const total = PAD + (head ? 48 + 14 : 0) + 30 + 10 + n * h + (n - 1) * rowGap + PAD;
    if (total > H) continue;
    let font = Math.round(h * 0.58);
    while (font > 40 && rows.some((r) => textW(r.what, "inter800", font, 1) > slatW - 28)) font -= 1;
    if (rows.some((r) => textW(r.what, "inter800", font, 1) > slatW - 28)) continue;
    return { head, rows, h, mw, mg, slatW, font, rowGap, total };
  }
  return null;
}

/** One half of a flap: the face drawn full height and clipped to its top or bottom half. */
const Half: React.FC<{
  text: string;
  w: number;
  h: number;
  top: boolean;
  colour: string;
  font: number;
  align: "center" | "left";
  glow?: string;
  shade?: number;
  scale?: number;
}> = ({ text, w, h, top, colour, font, align, glow, shade = 0, scale = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      width: w,
      top: top ? 0 : h / 2,
      height: h / 2,
      overflow: "hidden",
      background: top
        ? "linear-gradient(180deg, #2d2d33 0%, #232328 100%)"
        : "linear-gradient(180deg, #1c1c21 0%, #17171b 100%)",
      borderRadius: top ? "6px 6px 0 0" : "0 0 6px 6px",
      transform: scale !== 1 ? `scaleY(${scale})` : undefined,
      transformOrigin: top ? "50% 100%" : "50% 0%",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: align === "left" ? 16 : 0,
        width: align === "left" ? w - 16 : w,
        top: top ? 0 : -h / 2,
        height: h,
        lineHeight: `${h}px`,
        textAlign: align,
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: font,
        letterSpacing: align === "left" ? 1 : 0,
        color: colour,
        textShadow: glow,
        whiteSpace: "pre",
      }}
    >
      {text}
    </div>
    {shade ? (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(0,0,0,${shade})`,
        }}
      />
    ) : null}
  </div>
);

/** A flap at this frame: blank before it starts, then a few flips through `faces`, then the final face. */
const Flip: React.FC<{
  faces: string[];
  start: number;
  frame: number;
  w: number;
  h: number;
  font: number;
  colour: string;
  align: "center" | "left";
  glow?: string;
}> = ({ faces, start, frame, w, h, font, colour, align, glow }) => {
  const t = frame - start;
  const flips = faces.length;
  const face = (k: number) => (k < 0 ? "" : faces[Math.min(k, flips - 1)]!);
  const common = { w, h, font, align, colour };
  let body: React.ReactNode;
  if (t < 0) {
    body = (
      <>
        <Half {...common} text="" top />
        <Half {...common} text="" top={false} />
      </>
    );
  } else {
    const k = Math.floor(t / FLIP);
    if (k >= flips - 1) {
      body = (
        <>
          <Half {...common} text={face(flips - 1)} top glow={glow} />
          <Half {...common} text={face(flips - 1)} top={false} glow={glow} />
        </>
      );
    } else {
      // Mid flip: the new face's top shows while the old top falls, then the new bottom lands.
      const prev = face(k - 1);
      const next = face(k);
      body =
        t % FLIP < FLIP / 2 ? (
          <>
            <Half {...common} text={next} top shade={0.35} />
            <Half {...common} text={prev} top={false} />
            <Half {...common} text={prev} top scale={0.45} shade={0.2} />
          </>
        ) : (
          <>
            <Half {...common} text={next} top />
            <Half {...common} text={prev} top={false} shade={0.3} />
            <Half
              {...common}
              text={next}
              top={false}
              scale={0.5}
              shade={0.25}
            />
          </>
        );
    }
  }
  return (
    <div
      style={{ position: "relative", width: w, height: h, flex: "0 0 auto" }}
    >
      {body}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: h / 2 - 1,
          height: 2,
          background: "rgba(6,6,8,0.6)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.06)",
        }}
      />
    </div>
  );
};

/** A scrambled string as long as `t`, spaces kept, from a seed. */
const scramble = (t: string, seed: number) =>
  Array.from(t)
    .map((ch, i) =>
      ch === " " ? " " : LETTERS[Math.floor(rnd(seed, i) * LETTERS.length)]!,
    )
    .join("");

export const Flap: React.FC<VGfxProps> = ({ v, len, accent, variant = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = layoutFlap(v);
  if (!L) return null;
  const { head, rows, h, mw, mg, slatW, font, rowGap, total } = L;
  const top = Math.round((H - total) / 3);
  const out = exitOf(frame, len);
  const land = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 300, mass: 0.5 },
  });
  const title = ramp(frame, 3, 10);
  const last = rows.length - 1;
  const seed = 7 + variant * 31;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: W,
        height: total,
        padding: PAD,
        boxSizing: "border-box",
        borderRadius: 16,
        background: "linear-gradient(180deg, #141418 0%, #0c0c0f 100%)",
        border: "2px solid #2a2a31",
        boxShadow:
          "0 34px 80px rgba(0,0,0,0.7), inset 0 2px 0 rgba(255,255,255,0.06)",
        opacity: Math.min(land * 2, 1) * out,
        transform: `translateY(${(1 - land) * 50 + (1 - out) * 30}px) scale(${0.96 + 0.04 * land})`,
      }}
    >
      {[
        [10, 10],
        [10, -1],
        [-1, 10],
        [-1, -1],
      ].map(([x, y], i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            [x! >= 0 ? "left" : "right"]: 10,
            [y! >= 0 ? "top" : "bottom"]: 10,
            width: 10,
            height: 10,
            borderRadius: 5,
            background:
              "radial-gradient(circle at 35% 35%, #5a5a63 0%, #24242a 70%)",
          }}
        />
      ))}
      {head ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            height: 48,
            marginBottom: 14,
            opacity: title,
            transform: `translateX(${(1 - title) * -18}px)`,
          }}
        >
          <div
            style={{
              width: 12,
              height: 40,
              background: accent,
              borderRadius: 2,
            }}
          />
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 40,
              letterSpacing: 4,
              color: COLOUR.paper,
              whiteSpace: "nowrap",
            }}
          >
            {head}
          </div>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: COL_GAP,
          height: 30,
          marginBottom: 10,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 30,
          lineHeight: "30px",
          letterSpacing: 4,
          color: COLOUR.muted,
          opacity: title,
        }}
      >
        <div style={{ width: 4 * mw + 3 * mg }}>YEAR</div>
        <div>EVENT</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: rowGap }}>
        {rows.map((r, ri) => {
          const lit = ri === last;
          const colour = lit ? accent : "#F2EEE4";
          const glow = lit ? `0 0 14px ${rgba(accent, 0.55)}` : undefined;
          const rowAt = 5 + ri * 4;
          return (
            <div
              key={ri}
              style={{ display: "flex", alignItems: "center", gap: COL_GAP }}
            >
              <div style={{ display: "flex", gap: mg }}>
                {Array.from(r.year).map((d, ci) => {
                  const s = seed + ri * 997 + ci * 131;
                  const flips = 3 + Math.floor(rnd(s, 1) * 3);
                  const faces = Array.from({ length: flips }, (_, k) =>
                    k === flips - 1
                      ? d
                      : DIGITS[Math.floor(rnd(s, 10 + k) * 10)]!,
                  );
                  return (
                    <Flip
                      key={ci}
                      faces={faces}
                      start={rowAt + ci}
                      frame={frame}
                      w={mw}
                      h={h}
                      font={Math.round(h * 0.64)}
                      colour={colour}
                      align="center"
                      glow={glow}
                    />
                  );
                })}
              </div>
              <Flip
                faces={[
                  scramble(r.what, seed + ri * 53),
                  scramble(r.what, seed + ri * 53 + 7),
                  r.what,
                ]}
                start={rowAt + 3}
                frame={frame}
                w={slatW}
                h={h}
                font={font}
                colour={colour}
                align="left"
                glow={glow}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const fitsFlap = (v: VGfxProps["v"]) => layoutFlap(v) !== null;
