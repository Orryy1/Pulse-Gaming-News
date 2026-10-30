// Screen pack, "SplitFlap": the dates as an airport departures board. Every character module flips
// through a few letters before settling, row by row (a YEAR column and an EVENT column), under the
// heading painted on the board; the last row lights amber. All flipping settles by about frame 80.
import React from "react";
import { interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY } from "../../fonts.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { GfxProps } from "../types.ts";
import type { MomentGraphic } from "../../LongMoments.tsx";
import { clamp, paceFor, rand, txt, yearRows } from "./common.ts";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const FLIP = 2; // frames per flip
const MAX_EVENT = 30;

/** Capitals the board can show: accents dropped, curly quotes straightened. */
const boardText = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toUpperCase();

/** One half of a module: the glyph drawn full height and clipped to the top or bottom half. */
const Half: React.FC<{
  ch: string;
  w: number;
  h: number;
  top: boolean;
  colour: string;
  glow?: string;
  shade?: number;
  scale?: number;
}> = ({ ch, w, h, top, colour, glow, shade = 0, scale = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      width: w,
      top: top ? 0 : h / 2,
      height: h / 2,
      overflow: "hidden",
      background: top
        ? "linear-gradient(180deg, #2c2c32 0%, #232328 100%)"
        : "linear-gradient(180deg, #1d1d22 0%, #18181c 100%)",
      borderRadius: top ? "5px 5px 0 0" : "0 0 5px 5px",
      transform: scale !== 1 ? `scaleY(${scale})` : undefined,
      transformOrigin: top ? "50% 100%" : "50% 0%",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 0,
        width: w,
        top: top ? 0 : -h / 2,
        height: h,
        lineHeight: `${h}px`,
        textAlign: "center",
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: Math.round(h * 0.66),
        color: colour,
        textShadow: glow,
      }}
    >
      {ch === " " ? "" : ch}
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

/** One flap module at this frame: blank before it starts, then a few flips, then the final glyph. */
const Module: React.FC<{
  final: string;
  start: number;
  flips: number;
  seed: number;
  pool: string;
  frame: number;
  w: number;
  h: number;
  colour: string;
  glow?: string;
}> = ({ final, start, flips, seed, pool, frame, w, h, colour, glow }) => {
  const t = frame - start;
  const glyph = (k: number) =>
    k < 0
      ? " "
      : k >= flips - 1
        ? final
        : pool[Math.floor(rand(seed + k * 7) * pool.length)]!;
  let body: React.ReactNode;
  if (final === " " || t < 0) {
    body = (
      <>
        <Half ch=" " w={w} h={h} top colour={colour} />
        <Half ch=" " w={w} h={h} top={false} colour={colour} />
      </>
    );
  } else {
    const k = Math.floor(t / FLIP);
    if (k >= flips) {
      body = (
        <>
          <Half ch={final} w={w} h={h} top colour={colour} glow={glow} />
          <Half
            ch={final}
            w={w}
            h={h}
            top={false}
            colour={colour}
            glow={glow}
          />
        </>
      );
    } else {
      // Mid flip: the new glyph's top is revealed while the old top falls, then the new bottom lands.
      const prev = glyph(k - 1);
      const next = glyph(k);
      const firstHalf = t % FLIP < FLIP / 2;
      body = firstHalf ? (
        <>
          <Half ch={next} w={w} h={h} top colour={colour} shade={0.35} />
          <Half ch={prev} w={w} h={h} top={false} colour={colour} />
          <Half
            ch={prev}
            w={w}
            h={h}
            top
            colour={colour}
            scale={0.45}
            shade={0.2}
          />
        </>
      ) : (
        <>
          <Half ch={next} w={w} h={h} top colour={colour} />
          <Half ch={prev} w={w} h={h} top={false} colour={colour} shade={0.3} />
          <Half
            ch={next}
            w={w}
            h={h}
            top={false}
            colour={colour}
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
      {/* The hinge between the flaps. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: h / 2 - 1.5,
          height: 3,
          background: "#060608",
          boxShadow: "0 1px 0 rgba(255,255,255,0.06)",
        }}
      />
    </div>
  );
};

export const SplitFlap: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, showFor, dim, visible } = useStage(len, 200);
  const rows = (yearRows(g.items) ?? []).slice(0, 5).map((r) => ({
    year: r.year,
    what: boardText(r.what).slice(0, MAX_EVENT),
  }));
  const heading = boardText(txt(g.primary));
  if (!visible || rows.length < 2) return null;

  // One blank module after the longest event, so its last letter never runs into the row's lamp ("WORK
  // BEGINS" read as cramped and clipped against the board's edge, 30 Oct 2026).
  const cols = Math.max(14, ...rows.map((r) => r.what.length + 1));
  // Module pitch: the full board fits inside the safe area, and never larger than a comfortable size.
  const inner = 1728 - 2 * 40 - 34 - 46; // padding, column gap, lamps
  const pitch = Math.min(68, Math.floor(inner / (cols + 4)));
  const gap = Math.max(4, Math.round(pitch * 0.09));
  const w = pitch - gap;
  const h = Math.round(w * 1.42);
  const rowGap = Math.round(h * 0.16);

  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.9 },
  });
  const push = interpolate(frame, [0, showFor], [1, 1.03]);
  const title = interpolate(frame, [6, 18], [0, 1], clamp);
  const lastRow = rows.length - 1;

  const pace = paceFor(showFor);
  const rowStart = (r: number) => 10 + r * 9 * pace;
  const colStart = (c: number) => c * 0.6 * pace;

  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <div style={{ perspective: 2400 }}>
        <div
          style={{
            position: "relative",
            padding: "30px 40px 38px",
            borderRadius: 18,
            background: "linear-gradient(180deg, #131317 0%, #0c0c0f 100%)",
            border: "2px solid #26262c",
            boxShadow:
              "0 50px 140px rgba(0,0,0,0.75), inset 0 2px 0 rgba(255,255,255,0.06)",
            opacity: enter,
            transform: `translateY(${(1 - enter) * 70}px) rotateX(${3 + (1 - enter) * 10}deg) scale(${push})`,
            transformOrigin: "50% 60%",
          }}
        >
          {/* Screws at the corners. */}
          {[
            [12, 12],
            [12, -1],
            [-1, 12],
            [-1, -1],
          ].map(([x, y], i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                [x! >= 0 ? "left" : "right"]: 12,
                [y! >= 0 ? "top" : "bottom"]: 12,
                width: 12,
                height: 12,
                borderRadius: 6,
                background:
                  "radial-gradient(circle at 35% 35%, #55555e 0%, #24242a 70%)",
              }}
            />
          ))}
          {heading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                marginBottom: 22,
                opacity: title,
                transform: `translateX(${(1 - title) * -20}px)`,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 44,
                  background: COLOUR.amber,
                  borderRadius: 2,
                }}
              />
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 900,
                  fontSize: heading.length > 28 ? 38 : 46,
                  letterSpacing: 6,
                  color: COLOUR.paper,
                  whiteSpace: "nowrap",
                }}
              >
                {heading}
              </div>
            </div>
          ) : null}
          {/* Column heads. */}
          <div
            style={{
              display: "flex",
              gap: 34,
              marginBottom: 12,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 22,
              letterSpacing: 4,
              color: COLOUR.muted,
              opacity: title,
            }}
          >
            <div style={{ width: 4 * pitch - gap }}>YEAR</div>
            <div>EVENT</div>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: rowGap }}
          >
            {rows.map((r, ri) => {
              const lit = ri === lastRow;
              const colour = lit ? COLOUR.amber : "#F2EEE4";
              const glow = lit ? "0 0 14px rgba(255,107,26,0.55)" : undefined;
              const cells = [...r.year, ...r.what.padEnd(cols, " ")];
              const settled =
                rowStart(ri) + colStart(4 + r.what.length) + 9 * FLIP;
              const lamp = interpolate(
                frame,
                [settled - 4, settled + 2],
                [0, 1],
                clamp,
              );
              return (
                <div key={ri} style={{ display: "flex", alignItems: "center" }}>
                  {cells.map((ch, ci) => {
                    const seed = ri * 997 + ci * 131 + variant * 17;
                    const isYear = ci < 4;
                    return (
                      <div
                        key={ci}
                        style={{
                          display: "flex",
                          marginRight: ci === 3 ? 34 : gap,
                        }}
                      >
                        <Module
                          final={ch}
                          start={
                            rowStart(ri) +
                            colStart(ci) +
                            Math.floor(rand(seed + 3) * 3)
                          }
                          flips={3 + Math.floor(rand(seed) * 6)}
                          seed={seed}
                          pool={isYear ? DIGITS : LETTERS}
                          frame={frame}
                          w={w}
                          h={h}
                          colour={colour}
                          glow={glow}
                        />
                      </div>
                    );
                  })}
                  {/* The row's status lamp: amber on the lit row, a dim glow on the rest once settled. */}
                  <div
                    style={{
                      marginLeft: 22,
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      background: lit ? COLOUR.amber : "#4a4a52",
                      opacity: 0.25 + 0.75 * lamp,
                      boxShadow: lit
                        ? `0 0 ${18 * lamp}px rgba(255,107,26,0.9)`
                        : "none",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Stage>
  );
};

/** Two to five "year: event" rows, each a four-digit year and an event of at most 30 characters. */
export const fitsSplitFlap = (g: MomentGraphic) => {
  const rows = yearRows(g.items);
  return Boolean(
    rows &&
    rows.length >= 2 &&
    rows.length <= 5 &&
    rows.every((r) => r.what.length <= MAX_EVENT) &&
    txt(g.primary).length <= 40,
  );
};
