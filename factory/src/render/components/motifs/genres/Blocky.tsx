// Genre motif: block-built worlds (sandbox and brick games). The card is a voxel world under a sky
// gradient: square clouds drifting, a square sun, stepped hills, a grass-and-dirt ground, and the heading
// built from extruded blocks that drop in letter by letter (each letter a handful of paths: extrusion,
// mortar, face, highlight and shade). The look carries the topic, so it uses no picture. The kicker hangs on a dark label
// and the game and year sit on a plank sign. The style "Blocks" builds a stat's figure the same way.
import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { BODY } from "../../fonts.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  clamp,
  clean,
  glyphCells,
  hash,
  pixelFit,
  pixelLine,
  pixelNormal,
  pixelFitTiers,
  pixelOk,
  steppedHills,
  useCard,
  yearOf,
} from "./kit.tsx";

type Palette = {
  face: string;
  light: string;
  shade: string;
  mortar: string;
  side: string;
};
const GOLD: Palette = {
  face: "#ffb81f",
  light: "#ffe58a",
  shade: "#c27400",
  mortar: "#4a2a00",
  side: "#9a5a00",
};
/** One letter's paths at cell size c: mortar (full cells), face (inset), top light and bottom shade. */
function letterPaths(ch: string, c: number) {
  // A plain O for zero: the slashed zero reads as noise when built from blocks.
  const cells = glyphCells(ch === "0" ? "O" : ch);
  const i = Math.max(1.5, c * 0.07);
  let mortar = "";
  let face = "";
  let light = "";
  let shade = "";
  for (const [x, y] of cells) {
    const px = x * c;
    const py = y * c;
    mortar += `M${px} ${py}h${c}v${c}h-${c}z`;
    face += `M${px + i} ${py + i}h${c - 2 * i}v${c - 2 * i}h-${c - 2 * i}z`;
    light += `M${px + i} ${py + i}h${c - 2 * i}v${c * 0.2}h-${c - 2 * i}z`;
    shade += `M${px + i} ${py + c - i - c * 0.2}h${c - 2 * i}v${c * 0.2}h-${c - 2 * i}z`;
  }
  return { mortar, face, light, shade, empty: cells.length === 0 };
}

/**
 * Lines of block letters, centred in a box `width` wide, each letter dropping from above in turn from
 * `start` (gravity, a small hop on landing and a puff of dust).
 */
export const BlockLetters: React.FC<{
  lines: string[];
  cell: number;
  width: number;
  frame: number;
  start: number;
  span?: number;
  palette?: Palette;
}> = ({ lines, cell: c, width, frame, start, span = 22, palette = GOLD }) => {
  const total = lines.reduce((a, l) => a + l.replace(/\s/g, "").length, 0);
  const stagger = Math.min(1.4, span / Math.max(1, total));
  const lineH = 7 * c;
  const gap = 2 * c;
  const H = lines.length * lineH + (lines.length - 1) * gap;
  let k = 0;
  // Each block is extruded down and right (three steps of the side colour), then a soft shadow.
  const depth = c * 0.42;
  const shadow = depth + c * 0.22;
  return (
    <svg
      width={width}
      height={H + shadow + c}
      viewBox={`0 ${-c} ${width} ${H + shadow + c}`}
      style={{ overflow: "visible", display: "block" }}
    >
      {lines.map((line, li) => {
        const s = pixelNormal(line);
        const w = (s.length * 6 - 1) * c;
        const x0 = (width - w) / 2;
        const y0 = li * (lineH + gap);
        return [...s].map((ch, ci) => {
          if (ch === " ") return null;
          const p = letterPaths(ch, c);
          if (p.empty) return null;
          const t0 = start + k * stagger;
          k += 1;
          const fall = interpolate(frame, [t0, t0 + 9], [0, 1], {
            ...clamp,
            easing: Easing.in(Easing.quad),
          });
          if (fall <= 0) return null;
          const since = frame - (t0 + 9);
          const hop =
            since > 0 && since < 7
              ? Math.sin((since / 7) * Math.PI) * c * 0.55
              : 0;
          const dy = -(1 - fall) * 760 - hop;
          const x = x0 + ci * 6 * c;
          return (
            <g key={`${li}-${ci}`} transform={`translate(${x} ${y0 + dy})`}>
              <path
                d={p.mortar}
                fill="rgba(0,0,0,0.25)"
                transform={`translate(${shadow} ${shadow})`}
              />
              {[1, 0.66, 0.33].map((k) => (
                <path
                  key={k}
                  d={p.mortar}
                  fill={k === 1 ? palette.mortar : palette.side}
                  transform={`translate(${depth * k} ${depth * k})`}
                />
              ))}
              <path d={p.mortar} fill={palette.mortar} />
              <path d={p.face} fill={palette.face} />
              <path d={p.light} fill={palette.light} />
              <path d={p.shade} fill={palette.shade} />
              {since >= 0 && since < 9
                ? [-1, 1].map((dir) => (
                    <rect
                      key={dir}
                      x={2.5 * c + dir * (2 * c + since * c * 0.5) - c * 0.3}
                      y={7 * c - c * 0.6 - since * c * 0.12}
                      width={c * 0.6}
                      height={c * 0.6}
                      fill="#ffffff"
                      opacity={0.7 * (1 - since / 9)}
                    />
                  ))
                : null}
            </g>
          );
        });
      })}
    </svg>
  );
};

/** The ground: a stepped row of grass blocks over dirt, with seeded specks. */
const Ground: React.FC<{ top: number; block: number; variant: number }> = ({
  top,
  block: b,
  variant,
}) => {
  const cols = Math.ceil(1920 / b) + 1;
  let grass = "";
  let grassDark = "";
  let dirt = "";
  let speck = "";
  let grid = "";
  for (let i = 0; i < cols; i++) {
    const raise = hash(variant * 17 + Math.floor(i / 3), 4) > 0.72 ? 1 : 0;
    const x = i * b;
    const y = top - raise * b;
    grass += `M${x} ${y}h${b}v${b * 0.32}h-${b}z`;
    grassDark += `M${x} ${y + b * 0.32}h${b}v${b * 0.1}h-${b}z`;
    for (let r = 0; r < Math.ceil((1080 - y) / b); r++) {
      const yy = y + r * b;
      dirt += `M${x} ${yy + (r === 0 ? b * 0.42 : 0)}h${b}v${r === 0 ? b * 0.58 : b}h-${b}z`;
      grid += `M${x} ${yy}h${b}v1.5h-${b}z M${x} ${yy}h1.5v${b}h-1.5z`;
      for (let s = 0; s < 3; s++) {
        const sx = x + hash(i * 7 + r, s + 1) * (b - 8);
        const sy =
          yy +
          (r === 0 ? b * 0.45 : 0) +
          hash(i * 11 + r, s + 4) * (b * (r === 0 ? 0.5 : 0.85));
        speck += `M${sx} ${sy}h8v8h-8z`;
      }
    }
  }
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <path d={dirt} fill="#8a5a33" />
      <path d={speck} fill="#6b4224" />
      <path d={grass} fill="#5dbb3a" />
      <path d={grassDark} fill="#3f8f26" />
      <path d={grid} fill="rgba(0,0,0,0.18)" />
    </svg>
  );
};

/** Square clouds drifting right. */
const Clouds: React.FC<{ frame: number; variant: number }> = ({
  frame,
  variant,
}) => (
  <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
    {Array.from({ length: 5 }, (_, i) => {
      const w = 220 + hash(variant * 5 + i, 1) * 260;
      const y = 80 + hash(variant * 5 + i, 2) * 300;
      const x =
        ((hash(variant * 5 + i, 3) * 2400 + frame * (0.6 + i * 0.15)) % 2400) -
        300;
      return (
        <g key={i} transform={`translate(${x} ${y})`} opacity={0.92}>
          <rect x={0} y={20} width={w} height={40} fill="#ffffff" />
          <rect x={w * 0.2} y={0} width={w * 0.45} height={24} fill="#ffffff" />
          <rect x={0} y={56} width={w} height={8} fill="#dfeeff" />
        </g>
      );
    })}
  </svg>
);

/** A plank sign: pixel text burned onto wood, on a post. */
const Sign: React.FC<{ lines: string[]; cell: number }> = ({ lines, cell }) => {
  const w = Math.max(...lines.map((l) => pixelLine(l, cell).w)) + 56;
  const h = lines.length * 7 * cell + (lines.length - 1) * cell * 3 + 44;
  return (
    <div style={{ position: "relative", width: w }}>
      <div
        style={{
          width: w,
          height: h,
          background: "#b0814a",
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0) 0 22px, rgba(60,30,8,0.35) 22px 25px), linear-gradient(90deg, rgba(255,255,255,0.08), rgba(0,0,0,0.08))",
          border: "5px solid #5d3b16",
          boxShadow: "8px 8px 0 rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: cell * 3,
        }}
      >
        {lines.map((l, i) => {
          const p = pixelLine(l, cell);
          return (
            <svg key={i} width={p.w} height={p.h} style={{ display: "block" }}>
              <path d={p.d} fill={i === 0 ? "#2a1606" : "#4a2a0c"} />
            </svg>
          );
        })}
      </div>
      <div
        style={{
          width: 26,
          height: 70,
          background: "#6e4a1f",
          margin: "0 auto",
          borderLeft: "4px solid #5d3b16",
          borderRight: "4px solid #5d3b16",
        }}
      />
    </div>
  );
};

/** Pixel text on a dark rounded label (the kicker). */
const Tag: React.FC<{ lines: string[]; cell: number }> = ({ lines, cell }) => (
  <div
    style={{
      display: "inline-flex",
      flexDirection: "column",
      alignItems: "center",
      gap: cell * 3,
      padding: `${cell * 2}px ${cell * 3}px`,
      background: "rgba(16,10,28,0.88)",
      border: `${Math.max(3, cell * 0.6)}px solid #3c2a63`,
      borderRadius: 6,
    }}
  >
    {lines.map((l, i) => {
      const p = pixelLine(l, cell);
      return (
        <svg key={i} width={p.w} height={p.h} style={{ display: "block" }}>
          <path d={p.d} fill="#ffffff" />
        </svg>
      );
    })}
  </div>
);

const Card: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  frames,
  variant = 0,
}) => {
  const { frame, opacity } = useCard(frames);
  const title = clean(heading);
  // The largest blocks whose lines fit the width and stay clear of the ground and the sign.
  const fit = pixelOk(title)
    ? pixelFitTiers(
        title,
        1640,
        [
          [1, [30, 27, 24, 21, 18]],
          [2, [30, 27, 24, 21, 18, 16]],
          [3, [21, 18, 16, 14, 12, 10]],
        ],
        (f) => f.lines.length * 9 * f.cell - 2 * f.cell <= 430,
      )
    : undefined;
  const tag = clean(kicker);
  const name = clean(game);
  const yr = yearOf(year);
  const groundTop = 900;
  const block = 72;
  const signLines = [name, yr]
    .filter((x): x is string => Boolean(x) && pixelOk(x!))
    .flatMap((x) => pixelFit(x, 620, 2, [6, 5])?.lines ?? []);
  const signIn = interpolate(frame, [6, 14], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.back(1.6)),
  });
  const tagIn = interpolate(frame, [2, 10], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const H = fit
    ? fit.lines.length * 7 * fit.cell + (fit.lines.length - 1) * 2 * fit.cell
    : 0;
  const tagH = tag && pixelOk(tag) ? 100 : 0;
  const top = Math.max(150, 170 + (540 - H - tagH) / 2);
  return (
    <AbsoluteFill
      style={{
        opacity,
        overflow: "hidden",
        background:
          "linear-gradient(180deg, #3f86f0 0%, #6eb0ff 45%, #a9d6ff 75%, #d6efff 100%)",
      }}
    >
      {/* The square sun. */}
      <div
        style={{
          position: "absolute",
          right: 210,
          top: 96,
          width: 150,
          height: 150,
          background: "#fff6b0",
          boxShadow:
            "0 0 0 26px rgba(255,246,176,0.25), 0 0 0 60px rgba(255,246,176,0.1)",
        }}
      />
      <Clouds frame={frame} variant={variant} />
      {/* Distant block hills: a hazy far range, then a green near range with a lit rim. */}
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        <path d={steppedHills(48, 905, 70, 300, 5 + variant)} fill="#a9cfe8" />
        <path d={steppedHills(64, 905, 40, 170, 23 + variant)} fill="#9bd77f" />
        <path
          d={steppedHills(64, 905, 40, 170, 23 + variant)}
          fill="#6fae5a"
          transform="translate(0 12)"
        />
      </svg>
      <Ground top={groundTop} block={block} variant={variant} />
      {/* The heading in blocks. */}
      <div style={{ position: "absolute", left: 140, right: 140, top }}>
        {tag && pixelOk(tag) ? (
          <div
            style={{
              textAlign: "center",
              marginBottom: 40,
              opacity: tagIn,
              transform: `translateY(${(1 - tagIn) * -30}px)`,
            }}
          >
            <Tag
              lines={pixelFit(tag, 1400, 2, [6, 5])?.lines ?? [tag]}
              cell={6}
            />
          </div>
        ) : null}
        {fit ? (
          <BlockLetters
            lines={fit.lines}
            cell={fit.cell}
            width={1640}
            frame={frame}
            start={4}
          />
        ) : (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 84,
              lineHeight: 1.1,
              color: "#ffffff",
              textAlign: "center",
              textTransform: "uppercase",
              textShadow: "6px 6px 0 #4a2a00",
              opacity: tagIn,
            }}
          >
            {title}
          </div>
        )}
      </div>
      {signLines.length ? (
        <div
          style={{
            position: "absolute",
            left: 120,
            top: groundTop - 70 - (signLines.length * 60 - 18 + 54),
            transform: `translateY(${(1 - signIn) * 360}px)`,
            transformOrigin: "50% 100%",
          }}
        >
          <Sign lines={signLines} cell={6} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */

const fitsBlocks = (g: GfxProps["g"]) => {
  const t = clean(g.primary);
  return (
    /\d/.test(t) &&
    t.length <= 14 &&
    pixelOk(t) &&
    Boolean(pixelFit(t, 1600, 2, [30, 26, 22, 18])) &&
    clean(g.secondary).length <= 40
  );
};

/** A stat's figure built from dropping blocks over a sky, the label on a plank beneath. */
const Blocks: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const { frame, dim, visible } = useStage(len, 170);
  if (!visible || !fitsBlocks(g)) return null;
  const fit = pixelFitTiers(clean(g.primary), 1600, [
    [1, [34, 30, 26, 22, 20]],
    [2, [30, 26, 22, 18]],
  ])!;
  const label = clean(g.secondary);
  const labelFit =
    label && pixelOk(label) ? pixelFit(label, 1100, 2, [7, 6, 5]) : undefined;
  const labelIn = interpolate(frame, [26, 34], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.back(1.6)),
  });
  return (
    <AbsoluteFill style={{ opacity: dim, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(63,134,240,0.94) 0%, rgba(110,176,255,0.9) 60%, rgba(169,214,255,0.88) 100%)",
        }}
      />
      <Clouds frame={frame} variant={variant} />
      <Ground top={930} block={64} variant={variant + 3} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ marginTop: -60 - (labelFit ? 40 : 0), width: 1600 }}>
          <BlockLetters
            lines={fit.lines}
            cell={fit.cell}
            width={1600}
            frame={frame}
            start={2}
            span={16}
          />
          {label ? (
            <div
              style={{
                marginTop: 50,
                display: "flex",
                justifyContent: "center",
                opacity: labelIn,
                transform: `scale(${0.6 + 0.4 * labelIn})`,
              }}
            >
              {labelFit ? (
                <Tag lines={labelFit.lines} cell={labelFit.cell} />
              ) : (
                <div
                  style={{
                    padding: "12px 26px",
                    background: "rgba(16,10,28,0.88)",
                    border: "4px solid #3c2a63",
                    borderRadius: 6,
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: 34,
                    color: "#fff",
                    textTransform: "uppercase",
                    letterSpacing: 2,
                  }}
                >
                  {label}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const BlockyCard = Card;
export const BLOCKY_STYLES: Record<string, GfxStyle> = {
  Blocks: { kind: "stat", component: Blocks, fits: fitsBlocks, sound: "pop" },
};
