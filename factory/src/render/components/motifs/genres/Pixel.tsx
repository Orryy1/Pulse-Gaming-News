// Genre motif: 8 and 16-bit games. The card is a pixel-art title screen built from rectangles: a banded
// dusk sky (or the picture in chunky pixels under a dusk wash), three parallax layers scrolling (far
// peaks, near hills, a brick-and-grass ground), the heading in chunky pixel letters with a hard outline
// and a shine, the kicker above, the game and year below and a blinking PRESS START. The style "Pixel"
// sets a milestone as an 8-bit unlock: a spinning pixel coin, a flash on the chime and the record in
// pixel letters.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring } from "remotion";
import { BODY } from "../../fonts.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  PixelPic,
  clamp,
  clean,
  hash,
  pixelFit,
  pixelFitTiers,
  pixelLine,
  pixelOk,
  steppedHills,
  useCard,
  words,
  yearOf,
} from "./kit.tsx";

const OUTLINE = "#140a2e";
const SKY = [
  "#140c3a",
  "#22145a",
  "#3a1f78",
  "#5e2a8c",
  "#8f3a8e",
  "#c95484",
  "#f07c6c",
  "#ffad6a",
];

/** A layer that scrolls left forever: its tile drawn twice side by side. */
const Scroll: React.FC<{
  d: string;
  w: number;
  speed: number;
  frame: number;
  fill: string;
  dy?: number;
}> = ({ d, w, speed, frame, fill, dy = 0 }) => {
  const x = -((frame * speed) % w);
  return (
    <g transform={`translate(${x} ${dy})`}>
      <path d={d} fill={fill} />
      <path d={d} fill={fill} transform={`translate(${w} 0)`} />
    </g>
  );
};

/** Pixel text with a hard outline (the path drawn offset four ways), a drop shadow and a banded fill. */
export const PixelTitle: React.FC<{
  lines: string[];
  cell: number;
  width: number;
  fill: string;
  shine?: number;
  id: string;
}> = ({ lines, cell, width, fill, shine = -1, id }) => {
  const lineH = 7 * cell;
  const gap = 3 * cell;
  const o = Math.max(2, Math.round(cell * 0.3));
  const H = lines.length * lineH + (lines.length - 1) * gap;
  const paths = lines.map((l, i) => {
    const p = pixelLine(l, cell);
    return { ...p, x: (width - p.w) / 2, y: i * (lineH + gap) };
  });
  const all = (
    dx: number,
    dy: number,
    f: string,
    key: string,
    clip?: string,
  ) => (
    <g key={key} clipPath={clip}>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={f}
          transform={`translate(${p.x + dx} ${p.y + dy})`}
        />
      ))}
    </g>
  );
  return (
    <svg
      width={width}
      height={H + o * 3}
      viewBox={`${-o} ${-o} ${width + 2 * o} ${H + o * 3}`}
      style={{ overflow: "visible", display: "block" }}
    >
      <defs>
        <linearGradient
          id={`${id}-fill`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0" stopColor="#fffbe0" />
          <stop offset="0.3" stopColor="#fffbe0" />
          <stop offset="0.3" stopColor={fill} />
          <stop offset="0.68" stopColor={fill} />
          <stop offset="0.68" stopColor="#ff7a2a" />
          <stop offset="1" stopColor="#ff7a2a" />
        </linearGradient>
        <clipPath id={`${id}-shine`}>
          <polygon
            points={`${shine * width - 60},-50 ${shine * width + 30},-50 ${shine * width - 90},${H + 50} ${shine * width - 180},${H + 50}`}
          />
        </clipPath>
      </defs>
      {all(o * 2, o * 2, OUTLINE, "shadow")}
      {all(-o, 0, OUTLINE, "l")}
      {all(o, 0, OUTLINE, "r")}
      {all(0, -o, OUTLINE, "t")}
      {all(0, o, OUTLINE, "b")}
      <g>
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={`url(#${id}-fill)`}
            transform={`translate(${p.x} ${p.y})`}
          />
        ))}
      </g>
      {shine > -0.2 && shine < 1.4
        ? all(0, 0, "#ffffff", "shine", `url(#${id}-shine)`)
        : null}
    </svg>
  );
};

/** One line of plain pixel text. */
const PText: React.FC<{
  text: string;
  cell: number;
  fill: string;
  shadow?: boolean;
}> = ({ text, cell, fill, shadow = true }) => {
  const p = pixelLine(text, cell);
  return (
    <svg
      width={p.w + cell}
      height={p.h + cell}
      style={{ display: "block", overflow: "visible" }}
    >
      {shadow ? (
        <path
          d={p.d}
          fill={OUTLINE}
          transform={`translate(${cell * 0.6} ${cell * 0.6})`}
        />
      ) : null}
      <path d={p.d} fill={fill} />
    </svg>
  );
};

const Card: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const { frame, fps, opacity } = useCard(frames);
  const title = clean(heading);
  const fit = pixelOk(title)
    ? pixelFitTiers(title, 1640, [
        [1, [22, 20, 18, 16, 14]],
        [2, [22, 20, 18, 16, 14, 12]],
        [3, [14, 12, 10, 9, 8]],
      ])
    : undefined;
  const tag = clean(kicker);
  const name = clean(game);
  const yr = yearOf(year);
  const foot = [name, yr].filter(Boolean).join("  ");
  const footFit =
    foot && pixelOk(foot) ? pixelFit(foot, 1500, 1, [6, 5]) : undefined;
  const drop = spring({
    frame: frame - 3,
    fps,
    config: { damping: 9, stiffness: 140, mass: 0.7 },
  });
  const shine = interpolate(frame, [26, 44], [-0.2, 1.3], clamp);
  const start = frame >= 20 && Math.floor((frame - 20) / 14) % 2 === 0;
  const bg = pictures[0];
  const W = 1920;
  const far = React.useMemo(
    () => steppedHills(24, 905, 110, 420, 11 + variant, W),
    [variant],
  );
  const near = React.useMemo(
    () => steppedHills(32, 905, 50, 210, 37 + variant, W),
    [variant],
  );
  const tagIn = interpolate(frame, [8, 14], [0, 1], clamp);
  const lineH = fit ? 7 * fit.cell : 0;
  const H = fit
    ? fit.lines.length * lineH + (fit.lines.length - 1) * 3 * fit.cell
    : 0;
  const titleTop = Math.max(170, 420 - H / 2);
  const groundY = 900;
  const tile = 48;
  return (
    <AbsoluteFill style={{ opacity, background: SKY[0], overflow: "hidden" }}>
      {/* Sky: the picture in chunky pixels under a dusk wash, or banded dusk. */}
      {bg ? (
        <>
          <PixelPic src={bg} cols={80} rows={45} />
          <AbsoluteFill
            style={{
              background: `linear-gradient(180deg, ${SKY[0]}e6 0%, ${SKY[2]}b3 35%, ${SKY[5]}80 70%, ${SKY[7]}66 100%)`,
            }}
          />
        </>
      ) : (
        <svg width={W} height={1080} style={{ position: "absolute", inset: 0 }}>
          {SKY.map((c, i) => (
            <rect
              key={i}
              x={0}
              y={i * 96}
              width={W}
              height={i === SKY.length - 1 ? 1080 : 96}
              fill={c}
            />
          ))}
          {Array.from({ length: 40 }, (_, i) => (
            <rect
              key={`s${i}`}
              x={Math.floor(hash(variant + i, 1) * 240) * 8}
              y={Math.floor(hash(variant + i, 2) * 40) * 8}
              width={8}
              height={8}
              fill="#fff"
              opacity={hash(i, Math.floor(frame / 8)) > 0.3 ? 0.9 : 0.3}
            />
          ))}
        </svg>
      )}
      {/* Parallax layers. */}
      <svg width={W} height={1080} style={{ position: "absolute", inset: 0 }}>
        {/* Each range drawn twice: a light rim, then its body 8 px lower. */}
        <Scroll d={far} w={W} speed={0.8} frame={frame} fill="#5a43a8" />
        <Scroll d={far} w={W} speed={0.8} frame={frame} fill="#2e1d63" dy={8} />
        <Scroll d={near} w={W} speed={2.2} frame={frame} fill="#3d2a80" />
        <Scroll d={near} w={W} speed={2.2} frame={frame} fill="#1b1040" dy={8} />
        <g transform={`translate(${-((frame * 6) % (tile * 2))} 0)`}>
          <rect
            x={0}
            y={groundY}
            width={W + tile * 2}
            height={1080 - groundY}
            fill="#a8502a"
          />
          <rect
            x={0}
            y={groundY}
            width={W + tile * 2}
            height={16}
            fill="#5ad15a"
          />
          <rect
            x={0}
            y={groundY + 16}
            width={W + tile * 2}
            height={8}
            fill="#2f8a3a"
          />
          {Array.from({ length: Math.ceil(W / tile) + 3 }, (_, i) => (
            <g key={i}>
              <rect
                x={i * tile}
                y={groundY + 24}
                width={4}
                height={1080 - groundY}
                fill="#6e2e14"
              />
              <rect
                x={i * tile + tile / 2}
                y={groundY + 24 + tile / 2}
                width={4}
                height={tile / 2}
                fill="#6e2e14"
              />
            </g>
          ))}
          {[0, 1, 2, 3].map((r) => (
            <rect
              key={`r${r}`}
              x={0}
              y={groundY + 24 + r * (tile / 2) + tile / 2 - 2}
              width={W + tile * 2}
              height={4}
              fill="#6e2e14"
            />
          ))}
        </g>
      </svg>
      {/* Title. */}
      <div
        style={{ position: "absolute", left: 140, right: 140, top: titleTop }}
      >
        {tag && pixelOk(tag) ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: 34,
              opacity: tagIn,
            }}
          >
            <PText text={tag} cell={7} fill="#7ef9ff" />
          </div>
        ) : null}
        <div style={{ transform: `translateY(${(1 - drop) * -700}px)` }}>
          {fit ? (
            <PixelTitle
              lines={fit.lines}
              cell={fit.cell}
              width={1640}
              fill="#ffd23f"
              shine={shine}
              id={`pt${variant}`}
            />
          ) : (
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 84,
                lineHeight: 1.1,
                textAlign: "center",
                textTransform: "uppercase",
                color: "#ffd23f",
                textShadow: `6px 6px 0 ${OUTLINE}`,
              }}
            >
              {title}
            </div>
          )}
        </div>
      </div>
      {/* PRESS START and the credit line. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: groundY - 150,
          display: "flex",
          justifyContent: "center",
          opacity: start ? 1 : 0,
        }}
      >
        <PText text="PRESS START" cell={8} fill="#ffffff" />
      </div>
      {footFit ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 84,
            display: "flex",
            justifyContent: "center",
            opacity: tagIn,
          }}
        >
          <div style={{ padding: "12px 22px 8px", background: "rgba(20,10,46,0.82)", border: "4px solid #140a2e" }}>
            <PText text={footFit.lines[0]!} cell={footFit.cell} fill="#ffe7c2" />
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */

const COIN = [
  "..####..",
  ".#oooo#.",
  "#oo##oo#",
  "#oo##oo#",
  "#oo##oo#",
  "#oo##oo#",
  ".#oooo#.",
  "..####..",
];

/** A pixel coin, spinning (squeezed by the cosine of its turn). */
const Coin: React.FC<{ size: number; turn: number }> = ({ size, turn }) => {
  const c = size / 8;
  let edge = "";
  let face = "";
  COIN.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const r = `M${x * c} ${y * c}h${c}v${c}h-${c}z`;
      if (ch === "#") edge += r;
      else if (ch === "o") face += r;
    }),
  );
  return (
    <svg
      width={size}
      height={size}
      style={{
        transform: `scaleX(${Math.max(0.12, Math.abs(Math.cos(turn)))})`,
        display: "block",
      }}
    >
      <path d={face} fill="#ffd23f" />
      <path d={edge} fill="#b86a00" />
    </svg>
  );
};

const milestoneFit = (g: GfxProps["g"]) => {
  const t = clean(g.primary);
  if (!pixelOk(t)) return undefined;
  return pixelFit(t, 1240, 3, [10, 9, 8, 7]);
};

const fitsPixel = (g: GfxProps["g"]) => {
  const t = clean(g.primary);
  const n = words(t).length;
  const s = clean(g.secondary);
  return (
    n >= 2 &&
    n <= 12 &&
    Boolean(milestoneFit(g)) &&
    s.length <= 24 &&
    (!s || pixelOk(s))
  );
};

const CHIME = 12;

/** A milestone as an 8-bit unlock: the window pops, a coin spins, the border flashes on the chime. */
const PixelStyle: React.FC<GfxProps> = ({ g, len }) => {
  const { frame, fps, dim, visible } = useStage(len, 170);
  if (!visible || !fitsPixel(g)) return null;
  const fit = milestoneFit(g)!;
  const sub = clean(g.secondary);
  const pop = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 260, mass: 0.5 },
  });
  const cycle = ["#ffffff", "#ffd23f", "#7ef9ff", "#ff6bd6"];
  const flashing = frame >= CHIME && frame < CHIME + 20;
  const border = flashing
    ? cycle[Math.floor((frame - CHIME) / 2) % cycle.length]!
    : "#ffffff";
  const flash = interpolate(
    frame,
    [CHIME - 1, CHIME, CHIME + 6],
    [0, 0.6, 0],
    clamp,
  );
  const reveal = (i: number) =>
    interpolate(frame, [CHIME + 2 + i * 4, CHIME + 6 + i * 4], [0, 1], clamp);
  const sparkle = interpolate(frame, [CHIME, CHIME + 18], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const lines = fit.lines;
  return (
    <AbsoluteFill
      style={{
        opacity: dim,
        pointerEvents: "none",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AbsoluteFill style={{ background: "rgba(10,6,30,0.8)" }} />
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.22) 0 3px, transparent 3px 6px)",
        }}
      />
      <div
        style={{
          position: "relative",
          marginTop: 40,
          transform: `scale(${pop})`,
        }}
      >
        {/* Sparkles thrown out on the chime. */}
        {sparkle > 0 && sparkle < 1
          ? Array.from({ length: 8 }, (_, i) => {
              const a = (i / 8) * Math.PI * 2;
              const r = 260 + 420 * sparkle;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 16,
                    height: 16,
                    marginLeft: -8 + Math.cos(a) * r * 1.4,
                    marginTop: -8 + Math.sin(a) * r * 0.6,
                    background: cycle[i % cycle.length],
                    opacity: 1 - sparkle,
                    boxShadow: `16px 0 0 ${cycle[(i + 1) % cycle.length]}, -16px 0 0 ${cycle[(i + 1) % cycle.length]}, 0 16px 0 ${cycle[(i + 1) % cycle.length]}, 0 -16px 0 ${cycle[(i + 1) % cycle.length]}`,
                  }}
                />
              );
            })
          : null}
        <div
          style={{
            background: "#0a0618",
            border: `10px solid ${border}`,
            boxShadow: `0 0 0 8px #0a0618, 0 0 0 14px ${border}55, 14px 14px 0 14px rgba(0,0,0,0.5)`,
            padding: "44px 64px 46px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 30,
            minWidth: 900,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <Coin size={84} turn={frame * 0.32} />
            <PText text="UNLOCKED" cell={10} fill="#ffd23f" />
            <Coin size={84} turn={frame * 0.32} />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: fit.cell * 3,
            }}
          >
            {lines.map((l, i) => (
              <div
                key={i}
                style={{
                  opacity: reveal(i),
                  transform: `translateY(${(1 - reveal(i)) * 12}px)`,
                }}
              >
                <PText text={l} cell={fit.cell} fill="#ffffff" />
              </div>
            ))}
          </div>
          {sub ? (
            <div style={{ opacity: reveal(lines.length) }}>
              <PText text={sub} cell={7} fill="#7ef9ff" />
            </div>
          ) : null}
        </div>
        <div
          style={{
            position: "absolute",
            inset: -24,
            background: "#ffffff",
            opacity: flash,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const PixelCard = Card;
export const PIXEL_STYLES: Record<string, GfxStyle> = {
  Pixel: {
    kind: "milestone",
    component: PixelStyle,
    fits: fitsPixel,
    sound: "glint",
  },
};
