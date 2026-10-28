// Motif: Red Dead Redemption. An homage to frontier print: an aged, torn paper poster nailed to
// weathered boards, a slab-serif heading in two-colour ink, the picture printed in sepia, lantern
// light and drifting dust. Layout, colour, type and motion only: no logo, no series font, no artwork.
import React, { useId } from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { displayText } from "../../../timeline.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { Motif, MotifCardProps } from "../types.ts";
import {
  SLAB,
  SLAB_BOLD,
  cardFade,
  clamp,
  fitText,
  fitsAt,
  rand,
} from "./shared.ts";

/** Rockwell ships with Windows (Office) and macOS; Georgia is the fallback everywhere. */
const SLAB_FACE = "Rockwell, 'Rockwell Nova', 'Roboto Slab', Georgia, serif";
const INK = "#2a190c";
const RED = "#8f2417";
const PAPER = "#e8d6ab";
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

// ---------------------------------------------------------------------------------------------------
// The boards

const PLANK = 180;
const PLANK_TONES = [
  "#4a3828",
  "#3e2f22",
  "#534030",
  "#433325",
  "#4c3a2b",
  "#3a2c20",
];

/** Weathered horizontal boards: tones per plank, dark seams, a long grain, knots and old nail holes. */
export const Boards: React.FC<{ variant?: number }> = ({ variant = 0 }) => {
  const id = `grain${safeId(useId())}`;
  const v = Math.abs(Math.floor(variant));
  return (
    <AbsoluteFill style={{ background: "#1c120a", overflow: "hidden" }}>
      {Array.from({ length: 6 }, (_, i) => {
        const tone = PLANK_TONES[(i + v) % PLANK_TONES.length]!;
        const kx = 8 + rand(v * 7 + i) * 84;
        const jx = 10 + rand(v * 5 + i * 9) * 80;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: -20,
              right: -20,
              top: i * PLANK + 3,
              height: PLANK - 7,
              // A knot, a sun-bleached patch, a lit top edge and a shadowed bottom edge, and the
              // butt joint where two lengths of board meet.
              background: `linear-gradient(90deg, rgba(0,0,0,0) ${jx}%, rgba(12,7,3,0.85) ${jx}%, rgba(12,7,3,0.85) ${jx + 0.25}%, rgba(0,0,0,0) ${jx + 0.25}%), radial-gradient(60px 22px at ${kx}% ${30 + rand(i + v) * 40}%, rgba(20,12,5,0.8) 0%, rgba(20,12,5,0.3) 45%, rgba(0,0,0,0) 100%), radial-gradient(420px 90px at ${100 - kx}% 40%, rgba(190,170,140,0.13) 0%, rgba(0,0,0,0) 100%), linear-gradient(180deg, rgba(255,220,170,0.12) 0%, rgba(0,0,0,0) 10%, rgba(0,0,0,0) 78%, rgba(0,0,0,0.45) 100%), ${tone}`,
              transform: `translateX(${(rand(i * 3 + v) - 0.5) * 30}px)`,
            }}
          />
        );
      })}
      <svg
        viewBox="0 0 960 540"
        preserveAspectRatio="none"
        width={1920}
        height={1080}
        style={{
          position: "absolute",
          inset: 0,
          mixBlendMode: "overlay",
          opacity: 1,
        }}
      >
        <filter id={id} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.0025 0.09"
            numOctaves={3}
            seed={3 + (v % 7)}
          />
          <feColorMatrix type="saturate" values="0" />
          {/* Pushed contrast: long dark streaks of grain, not a soft haze. */}
          <feComponentTransfer>
            <feFuncR type="linear" slope={2.6} intercept={-0.8} />
            <feFuncG type="linear" slope={2.6} intercept={-0.8} />
            <feFuncB type="linear" slope={2.6} intercept={-0.8} />
          </feComponentTransfer>
        </filter>
        <rect width="960" height="540" filter={`url(#${id})`} />
      </svg>
      {/* Old nail holes left by posters long gone. */}
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: rand(v * 11 + i * 5) * 1880,
            top: Math.floor(rand(v * 13 + i) * 6) * PLANK + 30 + rand(i) * 110,
            width: 7,
            height: 7,
            borderRadius: 4,
            background: "#120a04",
            boxShadow: "0 1px 0 rgba(255,220,170,0.15)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Lantern light from the upper left, a dusty beam, and the room's dark corners. */
const Lantern: React.FC<{ frame: number; variant: number; motes?: number }> = ({
  frame,
  variant,
  motes = 16,
}) => {
  const flicker =
    0.92 + 0.08 * Math.sin(frame * 0.37 + variant) * Math.sin(frame * 0.13);
  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 80% at 28% 18%, rgba(255,186,104,${0.3 * flicker}) 0%, rgba(255,186,104,0) 60%)`,
          mixBlendMode: "screen",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(112deg, rgba(0,0,0,0) 18%, rgba(255,214,150,0.09) 30%, rgba(255,214,150,0.03) 42%, rgba(0,0,0,0) 52%)",
          mixBlendMode: "screen",
        }}
      />
      {Array.from({ length: motes }, (_, i) => {
        const x =
          (rand(variant * 17 + i) * 1920 + frame * (0.3 + rand(i + 5) * 0.5)) %
          1920;
        const y =
          (rand(variant * 19 + i * 3) * 1080 -
            frame * (0.25 + rand(i) * 0.35) +
            2160) %
          1080;
        const s = 2 + rand(i * 7) * 4;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: s,
              height: s,
              borderRadius: s,
              background: "rgba(255,226,170,0.55)",
              boxShadow: "0 0 6px rgba(255,210,140,0.5)",
              opacity: 0.4 + 0.6 * Math.abs(Math.sin(frame * 0.05 + i)),
            }}
          />
        );
      })}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(80% 85% at 46% 40%, rgba(0,0,0,0) 30%, rgba(8,4,1,0.55) 70%, rgba(8,4,1,0.92) 100%)",
        }}
      />
    </>
  );
};

/** A paper edge torn by hand: jittered in a few pixels all round, a bite out of one corner. */
function tornClip(w: number, h: number, seed: number, bite = 1): string {
  const pts: string[] = [];
  const N = 26;
  const j = (k: number) => 2 + rand(seed + k) * 9;
  // The bottom right corner is torn away along a ragged diagonal B px each way.
  const B = Math.round(70 * bite);
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * w;
    pts.push(`${x.toFixed(1)}px ${j(i).toFixed(1)}px`);
  }
  for (let i = 0; i <= N; i++) {
    const y = (i / N) * h;
    if (B > 0 && y > h - B) break;
    pts.push(`${(w - j(100 + i)).toFixed(1)}px ${y.toFixed(1)}px`);
  }
  if (B > 0)
    for (let i = 0; i <= 7; i++) {
      const f = i / 7;
      const n = (rand(seed + 400 + i) - 0.5) * 16;
      pts.push(
        `${(w - 4 - f * (B - 4) - n).toFixed(1)}px ${(h - B + f * (B - 4) - n).toFixed(1)}px`,
      );
    }
  for (let i = 0; i <= N; i++) {
    const x = w - (i / N) * w;
    if (B > 0 && x > w - B) continue;
    pts.push(`${x.toFixed(1)}px ${(h - j(200 + i)).toFixed(1)}px`);
  }
  for (let i = 0; i <= N; i++) {
    const y = h - (i / N) * h;
    pts.push(`${j(300 + i).toFixed(1)}px ${y.toFixed(1)}px`);
  }
  return `polygon(${pts.join(", ")})`;
}

/** Aged paper: warm stains, foxing, darker edges and a fold crease each way. */
const paperStyle = (tone = PAPER): React.CSSProperties => ({
  background: [
    "linear-gradient(180deg, rgba(0,0,0,0) 47.6%, rgba(255,248,225,0.4) 48%, rgba(95,60,25,0.22) 48.4%, rgba(0,0,0,0) 49.2%)",
    "linear-gradient(90deg, rgba(0,0,0,0) 49.2%, rgba(255,248,225,0.32) 49.6%, rgba(95,60,25,0.18) 50%, rgba(0,0,0,0) 50.6%)",
    "radial-gradient(circle at 80% 72%, rgba(140,90,38,0.26) 0%, rgba(140,90,38,0.1) 9%, rgba(0,0,0,0) 16%)",
    "radial-gradient(circle at 16% 84%, rgba(120,76,30,0.2) 0%, rgba(0,0,0,0) 14%)",
    "radial-gradient(circle at 70% 12%, rgba(120,76,30,0.16) 0%, rgba(0,0,0,0) 10%)",
    "radial-gradient(ellipse at 35% 30%, rgba(255,250,232,0.45) 0%, rgba(0,0,0,0) 55%)",
    `linear-gradient(170deg, ${tone} 0%, #dcc595 100%)`,
  ].join(", "),
  boxShadow:
    "inset 0 0 90px rgba(115,72,26,0.6), inset 0 0 18px rgba(90,55,20,0.5)",
});

const Nail: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <div
    style={{
      position: "absolute",
      left: x - 13,
      top: y - 13,
      width: 26,
      height: 26,
      borderRadius: 13,
      background:
        "radial-gradient(circle at 38% 34%, #b9aa98 0%, #6d6255 35%, #2c251e 75%)",
      boxShadow: "2px 5px 6px rgba(0,0,0,0.6)",
    }}
  />
);

/** A printer's rule: two lines with a diamond between, or a single long line. */
const Ornament: React.FC<{ width: number; colour?: string }> = ({
  width,
  colour = INK,
}) => (
  <svg
    width={width}
    height={22}
    viewBox={`0 0 ${width} 22`}
    style={{ display: "block", margin: "0 auto" }}
  >
    <line
      x1={0}
      y1={8}
      x2={width / 2 - 26}
      y2={8}
      stroke={colour}
      strokeWidth={3}
    />
    <line
      x1={0}
      y1={14}
      x2={width / 2 - 26}
      y2={14}
      stroke={colour}
      strokeWidth={1.5}
    />
    <line
      x1={width / 2 + 26}
      y1={8}
      x2={width}
      y2={8}
      stroke={colour}
      strokeWidth={3}
    />
    <line
      x1={width / 2 + 26}
      y1={14}
      x2={width}
      y2={14}
      stroke={colour}
      strokeWidth={1.5}
    />
    <path
      d={`M ${width / 2} 1 L ${width / 2 + 14} 11 L ${width / 2} 21 L ${width / 2 - 14} 11 Z`}
      fill={colour}
    />
    <circle cx={width / 2 - 21} cy={11} r={3} fill={colour} />
    <circle cx={width / 2 + 21} cy={11} r={3} fill={colour} />
  </svg>
);

/** A five-pointed star, the printer's stock ornament. */
const Star: React.FC<{ size: number; colour?: string }> = ({
  size,
  colour = INK,
}) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? size * 0.21 : size / 2;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(size / 2 + r * Math.cos(a)).toFixed(1)},${(size / 2 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <polygon points={pts} fill={colour} />
    </svg>
  );
};

/** A picture as an old print: sepia, crushed, the paper showing through. */
const SepiaPrint: React.FC<{
  src: string;
  w: number;
  h: number;
  oval: boolean;
  t: number;
}> = ({ src, w, h, oval, t }) => (
  <div
    style={{
      width: w,
      height: h,
      margin: "0 auto",
      borderRadius: oval ? "50%" : 2,
      border: `4px solid ${INK}`,
      boxShadow: `0 0 0 7px ${PAPER}, 0 0 0 10px ${INK}`,
      overflow: "hidden",
      position: "relative",
      isolation: "isolate",
    }}
  >
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${1.06 + 0.06 * t})`,
        filter: "grayscale(1) sepia(0.9) contrast(1.3) brightness(0.92)",
      }}
    />
    <AbsoluteFill
      style={{ background: "#e2c793", mixBlendMode: "multiply", opacity: 0.55 }}
    />
    <AbsoluteFill
      style={{
        background: oval
          ? "radial-gradient(closest-side, rgba(0,0,0,0) 62%, rgba(232,214,171,0.85) 100%)"
          : "radial-gradient(80% 80% at 50% 50%, rgba(0,0,0,0) 55%, rgba(60,36,14,0.45) 100%)",
      }}
    />
  </div>
);

/** A poster long since pasted over: a torn scrap with a faded print and bars of worn-away type. */
const Scrap: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  src?: string;
  seed: number;
  t: number;
}> = ({ x, y, w, h, rot, src, seed, t }) => {
  const bars = (n: number, s: number) =>
    Array.from({ length: n }, (_, i) => (
      <div
        key={i}
        style={{
          height: i === 0 ? 34 : 16,
          width: `${50 + rand(s + i) * 45}%`,
          margin: "10px auto 0",
          background: i === 0 ? "rgba(70,40,18,0.38)" : "rgba(70,40,18,0.22)",
          borderRadius: 2,
        }}
      />
    ));
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        transform: `rotate(${rot}deg)`,
        filter: "brightness(0.55) saturate(0.75)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 10,
          boxShadow: "6px 18px 34px rgba(0,0,0,0.6)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          ...paperStyle("#d9c193"),
          clipPath: tornClip(w, h, seed, 1.4),
          padding: "40px 34px",
          boxSizing: "border-box",
        }}
      >
        {bars(2, seed)}
        {src ? (
          <div
            style={{
              marginTop: 26,
              height: h * 0.42,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <Img
              src={src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${1.1 + 0.04 * t})`,
                filter: "grayscale(1) sepia(0.9) contrast(1.2) brightness(0.9)",
                opacity: 0.8,
              }}
            />
            <AbsoluteFill
              style={{
                background: "#d9c193",
                mixBlendMode: "multiply",
                opacity: 0.6,
              }}
            />
          </div>
        ) : null}
        {bars(3, seed + 9)}
      </div>
      <Nail x={w / 2} y={30} />
    </div>
  );
};

// ---------------------------------------------------------------------------------------------------
// The card

const PW = 760;
const PH = 930;

export const RedDeadCard: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = Math.abs(Math.floor(variant));
  const pics = pictures.filter(Boolean);
  const head = displayText(heading).toUpperCase().trim();
  const kick = kicker ? displayText(kicker).toUpperCase().trim() : "";
  const gameText = game ? displayText(game).toUpperCase().trim() : "";
  const yr = year ? displayText(year).trim() : "";
  const t = interpolate(frame, [0, Math.max(30, frames)], [0, 1], clamp);
  const oval = v % 2 === 0;
  const pic = pics[0];
  // Fixed blocks, then the heading takes what is left.
  const picH = pic ? (oval ? 330 : 320) : 0;
  const emblem = pic ? 0 : 150;
  const footShown = Boolean(gameText || yr);
  const fixed =
    64 +
    52 +
    22 +
    28 +
    (pic ? picH + 20 + 34 : emblem + 44 + 30) +
    (footShown ? 84 : 0) +
    64;
  const fit = fitText(head, SLAB_BOLD, {
    width: PW - 120,
    height: Math.max(120, PH - fixed),
    lineHeight: 1.02,
    maxLines: 4,
    maxSize: pic ? 120 : 150,
    minSize: 44,
    tracking: 0.01,
  });
  // The poster swings in on its nail and keeps a slow sway; the camera eases in.
  const swing = spring({
    frame,
    fps,
    config: { damping: 5, stiffness: 55, mass: 1.1 },
  });
  const drop = interpolate(frame, [0, 7], [-110, 0], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const angle = (1 - swing) * 9 + 0.8 * Math.sin(frame / 26 + v);
  const push = interpolate(
    frame,
    [0, Math.max(30, frames)],
    [1.0, 1.06],
    clamp,
  );
  const px = 960 - PW / 2 + (v % 3 === 1 ? -40 : v % 3 === 2 ? 40 : 0);
  const py = 70;
  const gameLine = [gameText && gameText !== head ? gameText : "", yr].filter(
    Boolean,
  );
  return (
    <AbsoluteFill
      style={{
        opacity: cardFade(frame, frames),
        overflow: "hidden",
        background: "#120b06",
      }}
    >
      <AbsoluteFill
        style={{ transform: `scale(${push})`, transformOrigin: "50% 40%" }}
      >
        <Boards variant={v} />
        <Scrap
          x={70}
          y={400}
          w={400}
          h={600}
          rot={-5}
          src={pics[1]}
          seed={v * 31 + 5}
          t={t}
        />
        <Scrap
          x={1450}
          y={90}
          w={400}
          h={620}
          rot={4}
          src={pics[2]}
          seed={v * 31 + 77}
          t={t}
        />
        <div
          style={{
            position: "absolute",
            left: px,
            top: py,
            width: PW,
            height: PH,
            transform: `translateY(${drop}px) rotate(${angle}deg)`,
            transformOrigin: `50% 36px`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 14,
              boxShadow: "10px 30px 50px rgba(0,0,0,0.7)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              ...paperStyle(),
              clipPath: tornClip(PW, PH, v * 53 + 11),
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "64px 60px 64px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                mixBlendMode: "multiply",
              }}
            >
              <Ornament width={PW - 160} colour={RED} />
              <div
                style={{
                  marginTop: 14,
                  height: 38,
                  fontFamily: SLAB_FACE,
                  fontWeight: 700,
                  fontSize: 30,
                  lineHeight: "38px",
                  letterSpacing: 9,
                  color: RED,
                  whiteSpace: "nowrap",
                }}
              >
                {kick}
              </div>
              <div
                style={{
                  marginTop: 22,
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  fontFamily: SLAB_FACE,
                  fontWeight: 700,
                  fontSize: fit.size,
                  lineHeight: 1.02,
                  letterSpacing: "0.01em",
                  color: INK,
                }}
              >
                {fit.lines.map((l, i) => (
                  <div key={i} style={{ whiteSpace: "nowrap" }}>
                    {l}
                  </div>
                ))}
                {pic ? null : (
                  // No picture: the printer's stars sit right under the heading, the pair centred.
                  <div
                    style={{
                      marginTop: 44,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 26,
                    }}
                  >
                    <Star size={60} colour={RED} />
                    <Star size={emblem} colour={INK} />
                    <Star size={60} colour={RED} />
                  </div>
                )}
              </div>
              {pic ? (
                <div style={{ marginTop: 20, marginBottom: 30 }}>
                  <SepiaPrint
                    src={pic}
                    w={oval ? 540 : 600}
                    h={picH}
                    oval={oval}
                    t={t}
                  />
                </div>
              ) : (
                <div style={{ height: 30 }} />
              )}
              {footShown ? (
                <>
                  <Ornament width={PW - 160} />
                  <div
                    style={{
                      marginTop: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 18,
                      fontFamily: SLAB_FACE,
                      fontWeight: 700,
                      fontSize: gameLine.join("").length > 30 ? 24 : 30,
                      letterSpacing: 4,
                      color: INK,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {gameLine.map((x, i) => (
                      <React.Fragment key={i}>
                        {i ? <Star size={22} colour={RED} /> : null}
                        <span>{x}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
          <Nail x={PW / 2} y={36} />
        </div>
        <Lantern frame={frame} variant={v} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Graphic style: a quote on a frontier handbill

const HW = 1380;
const HH = 760;

const Handbill: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const text = displayText(g.primary)
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
  const words = text.split(/\s+/).filter(Boolean);
  const { frame, fps, dim, visible, showFor } = useStage(
    len,
    Math.max(140, Math.min(260, 60 + words.length * 8)),
  );
  if (!visible || !words.length) return null;
  const v = Math.abs(Math.floor(variant));
  const who = displayText(g.secondary).trim();
  const comma = who.indexOf(",");
  const name = (comma > 0 ? who.slice(0, comma) : who).trim().toUpperCase();
  const role = comma > 0 ? who.slice(comma + 1).trim() : "";
  const fit = fitText(`“${text}”`, SLAB, {
    width: HW - 220,
    height: who ? 400 : 500,
    lineHeight: 1.2,
    maxLines: 6,
    maxSize: 78,
    minSize: 40,
  });
  const land = spring({
    frame: frame - 2,
    fps,
    config: { damping: 11, stiffness: 170, mass: 0.8 },
  });
  const t = interpolate(frame, [0, showFor], [0, 1], clamp);
  const lineAt = (i: number) => 10 + i * 5;
  const creditAt = lineAt(fit.lines.length) + 4;
  const credit = interpolate(frame, [creditAt, creditAt + 10], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ opacity: dim, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${1 + 0.03 * t})` }}>
        <Boards variant={v} />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 960 - HW / 2,
          top: 160,
          width: HW,
          height: HH,
          opacity: frame < 2 ? 0 : Math.min(1, land * 2),
          transform: `scale(${1.1 - 0.1 * land}) rotate(${(v % 2 ? 1.2 : -1.2) + (1 - land) * 4}deg)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 16,
            boxShadow: "10px 30px 50px rgba(0,0,0,0.7)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            ...paperStyle(),
            clipPath: tornClip(HW, HH, v * 41 + 3, 0.6),
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "56px 110px 50px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              mixBlendMode: "multiply",
            }}
          >
            <Ornament width={HW - 300} colour={RED} />
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                fontFamily: SLAB_FACE,
                fontWeight: 400,
                fontSize: fit.size,
                lineHeight: 1.2,
                color: INK,
              }}
            >
              {fit.lines.map((l, i) => {
                const o = interpolate(
                  frame,
                  [lineAt(i), lineAt(i) + 7],
                  [0, 1],
                  clamp,
                );
                return (
                  <div
                    key={i}
                    style={{
                      whiteSpace: "nowrap",
                      opacity: o,
                      transform: `translateY(${(1 - o) * 10}px)`,
                    }}
                  >
                    {l}
                  </div>
                );
              })}
            </div>
            {who ? (
              <div style={{ opacity: credit }}>
                <Ornament width={420} />
                <div
                  style={{
                    marginTop: 12,
                    fontFamily: SLAB_FACE,
                    fontWeight: 700,
                    fontSize: 38,
                    letterSpacing: 6,
                    color: RED,
                  }}
                >
                  {name}
                </div>
                {role ? (
                  <div
                    style={{
                      marginTop: 2,
                      fontFamily: SLAB_FACE,
                      fontStyle: "italic",
                      fontSize: 30,
                      color: INK,
                    }}
                  >
                    {role}
                  </div>
                ) : null}
              </div>
            ) : (
              <Ornament width={420} />
            )}
          </div>
        </div>
        <Nail x={44} y={42} />
        <Nail x={HW - 44} y={42} />
      </div>
      <Lantern frame={frame} variant={v} motes={10} />
    </AbsoluteFill>
  );
};

export const RED_DEAD: Motif = {
  id: "reddead",
  name: "Red Dead Redemption frontier poster",
  matches: (game) => /red dead/i.test(`${game.title} ${game.theme ?? ""}`),
  card: RedDeadCard,
  styles: {
    Poster: {
      kind: "quote",
      component: Handbill,
      sound: "pop",
      fits: (g) => {
        const text = g.primary.replace(/^["“”']+|["“”']+$/g, "").trim();
        const n = text.split(/\s+/).filter(Boolean).length;
        const who = g.secondary.trim();
        return (
          n >= 4 &&
          n <= 34 &&
          who.length <= 60 &&
          fitsAt(`“${text}”`, SLAB, {
            width: HW - 220,
            height: who ? 400 : 500,
            lineHeight: 1.2,
            maxLines: 6,
            maxSize: 78,
            minSize: 40,
          })
        );
      },
    },
  } satisfies Record<string, GfxStyle>,
};
