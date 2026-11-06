// The original Xbox era (2001-2005), in homage: an organic green dashboard of glowing tubes winding
// out of a pulsing orb, the menu as soft green capsules, the chosen one lit. Built from scratch from
// layout, colour and motion only; no logo, no real menu text.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BODY } from "../../fonts.ts";
import { SPRING, ease } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MotifCardProps } from "../types.ts";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import { PulseMark } from "../../packs/screen/pulse.tsx";
import { cardFade, clamp, fitLabel, rng, sizeFor, txt, uniq } from "./util.ts";

const G = {
  void: "#010603",
  deep: "#04170a",
  moss: "#0d3a10",
  edge: "#0f4a0a",
  mid: "#49b322",
  lime: "#9df25a",
  pale: "#d9ffb5",
  glow: "rgba(120,255,60,",
  text: "#c9f7a6",
  ink: "#0b2606",
};

type Tube = { d: string; w: number; o: number; at: number; speed: number };

/** Tubes for a scene whose orb sits at (cx, cy); the mirror flips them for variety. */
function tubesFor(cx: number, cy: number, variant: number): Tube[] {
  const r = rng(variant + 11);
  const j = (n: number) => Math.round(n + (r() - 0.5) * 90);
  const o = `M ${cx} ${cy}`;
  return [
    {
      d: `${o} C ${j(cx + 170)} ${j(cy - 170)}, ${j(cx + 360)} ${j(cy - 300)}, ${cx + 620} ${cy - 390} S ${cx + 1140} ${cy - 560}, ${cx + 1440} ${cy - 620}`,
      w: 34,
      o: 0.95,
      at: 0,
      speed: 7,
    },
    {
      d: `${o} C ${j(cx - 140)} ${j(cy - 160)}, ${j(cx - 300)} ${j(cy - 240)}, ${cx - 480} ${cy - 280} S ${cx - 660} ${cy - 300}, ${cx - 760} ${cy - 280}`,
      w: 26,
      o: 0.85,
      at: 2,
      speed: 5,
    },
    {
      d: `${o} C ${j(cx + 80)} ${j(cy + 220)}, ${j(cx + 200)} ${j(cy + 360)}, ${cx + 440} ${cy + 460} S ${cx + 940} ${cy + 580}, ${cx + 1140} ${cy + 620}`,
      w: 30,
      o: 0.9,
      at: 1,
      speed: 6,
    },
    {
      d: `${o} C ${j(cx - 200)} ${j(cy + 100)}, ${j(cx - 340)} ${j(cy + 280)}, ${cx - 420} ${cy + 460} S ${cx - 500} ${cy + 660}, ${cx - 520} ${cy + 700}`,
      w: 22,
      o: 0.8,
      at: 3,
      speed: 8,
    },
    {
      d: `${o} C ${j(cx)} ${j(cy - 200)}, ${j(cx + 80)} ${j(cy - 380)}, ${cx + 200} ${cy - 500} S ${cx + 340} ${cy - 660}, ${cx + 400} ${cy - 700}`,
      w: 16,
      o: 0.6,
      at: 4,
      speed: 9,
    },
    {
      d: `M -100 ${cy + 280} C 300 ${cy + 160}, 700 ${cy + 440}, 1100 ${cy + 280} S 1700 ${cy + 20}, 2020 ${cy + 160}`,
      w: 13,
      o: 0.42,
      at: 5,
      speed: 4,
    },
    {
      d: `M ${cx + 740} -40 C ${cx + 690} 300, ${cx + 940} 500, ${cx + 890} 760 S ${cx + 1040} 1100, ${cx + 1140} 1200`,
      w: 15,
      o: 0.4,
      at: 6,
      speed: 5,
    },
  ];
}

/** Glowing translucent tubes, drawn out of the orb, a light pulse running along each. */
const Tubes: React.FC<{
  tubes: Tube[];
  frame: number;
  start?: number;
  near?: boolean;
}> = ({ tubes, frame, start = 0, near = true }) => (
  <svg
    width={1920}
    height={1080}
    viewBox="0 0 1920 1080"
    style={{ position: "absolute", inset: 0 }}
  >
    {tubes.map((t, i) => {
      const draw = interpolate(
        frame,
        [start + t.at, start + t.at + 20],
        [0, 1],
        {
          ...clamp,
          easing: ease.out,
        },
      );
      const dash = {
        strokeDasharray: "1000 1000",
        strokeDashoffset: 1000 * (1 - draw),
      };
      const pulse = (frame * t.speed + i * 173) % 1000;
      return (
        <g key={i} opacity={t.o} fill="none" strokeLinecap="round">
          <path
            d={t.d}
            pathLength={1000}
            stroke="rgba(90,220,50,0.12)"
            strokeWidth={t.w * 2.4}
            {...dash}
          />
          <path
            d={t.d}
            pathLength={1000}
            stroke={G.edge}
            strokeOpacity={0.85}
            strokeWidth={t.w}
            {...dash}
          />
          <path
            d={t.d}
            pathLength={1000}
            stroke={G.mid}
            strokeOpacity={0.6}
            strokeWidth={t.w * 0.62}
            {...dash}
          />
          <path
            d={t.d}
            pathLength={1000}
            stroke={G.pale}
            strokeOpacity={0.7}
            strokeWidth={Math.max(2, t.w * 0.18)}
            {...dash}
          />
          <path
            d={t.d}
            pathLength={1000}
            stroke="#f4ffd8"
            strokeWidth={t.w * 0.42}
            strokeDasharray="34 966"
            strokeDashoffset={-pulse}
            opacity={draw >= 1 ? 0.95 : 0}
          />
        </g>
      );
    })}
    {near ? (
      // One big tube close to the camera, soft and dim, for depth.
      <path
        d="M 1460 1200 C 1620 920, 1880 860, 2080 700"
        stroke="rgba(110,230,60,0.16)"
        strokeWidth={90}
        strokeLinecap="round"
        fill="none"
      />
    ) : null}
  </svg>
);

/** The orb: a glassy green sphere with a beating core, rings orbiting it, the picture glowing inside. */
const Orb: React.FC<{
  cx: number;
  cy: number;
  r: number;
  frame: number;
  enter: number;
  picture?: string;
}> = ({ cx, cy, r, frame, enter, picture }) => {
  const beat = 0.5 + 0.5 * Math.sin((frame / 30) * Math.PI * 1.3);
  const ringA = (frame * 3.2) % 1000;
  const size = r * 2;
  const ring = (
    rx: number,
    ry: number,
    rot: number,
    front: boolean,
    op: number,
  ) => (
    <svg
      width={rx * 2 + 40}
      height={rx * 2 + 40}
      viewBox={`${-rx - 20} ${-rx - 20} ${rx * 2 + 40} ${rx * 2 + 40}`}
      style={{
        position: "absolute",
        left: cx - rx - 20,
        top: cy - rx - 20,
        overflow: "visible",
      }}
    >
      <g transform={`rotate(${rot})`} fill="none" strokeLinecap="round">
        <path
          d={`M ${-rx} 0 A ${rx} ${ry} 0 0 ${front ? 0 : 1} ${rx} 0`}
          stroke="rgba(170,255,110,0.18)"
          strokeWidth={14}
        />
        <path
          d={`M ${-rx} 0 A ${rx} ${ry} 0 0 ${front ? 0 : 1} ${rx} 0`}
          stroke={front ? "rgba(220,255,170,0.85)" : "rgba(170,255,110,0.45)"}
          strokeWidth={3}
          pathLength={1000}
          strokeDasharray="220 60 90 60"
          strokeDashoffset={-ringA}
          opacity={op}
        />
      </g>
    </svg>
  );
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `scale(${0.7 + 0.3 * enter})`,
        transformOrigin: `${cx}px ${cy}px`,
        opacity: Math.min(1, enter * 1.6),
      }}
    >
      {/* Halo */}
      <div
        style={{
          position: "absolute",
          left: cx - r * 2.6,
          top: cy - r * 2.6,
          width: r * 5.2,
          height: r * 5.2,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${G.glow}${0.34 + 0.12 * beat}) 0%, ${G.glow}0.13) 26%, ${G.glow}0.04) 44%, transparent 62%)`,
        }}
      />
      {ring(r * 1.55, r * 0.36, -16, false, 1)}
      {ring(r * 1.32, r * 0.3, 21, false, 0.7)}
      {/* Sphere */}
      <div
        style={{
          position: "absolute",
          left: cx - r,
          top: cy - r,
          width: size,
          height: size,
          borderRadius: "50%",
          overflow: "hidden",
          isolation: "isolate",
          background:
            "radial-gradient(circle at 36% 30%, #f4ffd0 0%, #b6f55a 12%, #5fc52a 32%, #237a12 60%, #0a3207 84%, #041a03 100%)",
          boxShadow: `0 0 ${60 + 40 * beat}px ${16 + 10 * beat}px rgba(120,255,60,0.42), 0 0 0 2px rgba(200,255,150,0.35)`,
        }}
      >
        {picture ? (
          // The picture as texture inside the glow, never a dark photo in a circle.
          <Img
            src={picture}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "grayscale(1) contrast(1.4)",
              mixBlendMode: "overlay",
              opacity: 0.95,
              transform: `scale(${1.18 - 0.08 * enter})`,
            }}
          />
        ) : null}
        {/* Beating core */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(circle at 50% 54%, rgba(235,255,190,${0.35 + 0.35 * beat}) 0%, rgba(150,255,80,${0.18 + 0.16 * beat}) 22%, transparent 48%)`,
            mixBlendMode: "screen",
          }}
        />
        {/* The Pulse mark glowing in the core, where the console's own emblem sat in its orb. */}
        <div
          style={{
            position: "absolute",
            left: r - r * 0.42,
            top: r - r * 0.42,
            opacity: 0.5 + 0.25 * beat,
            filter: `drop-shadow(0 0 ${10 + 8 * beat}px rgba(200,255,140,0.9))`,
          }}
        >
          <PulseMark size={r * 0.84} colour={G.pale} />
        </div>
        {/* Glass: dark rim, top-left light */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 50% 50%, transparent 58%, rgba(2,20,2,0.55) 82%, rgba(0,10,0,0.9) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: size * 0.16,
            top: size * 0.09,
            width: size * 0.46,
            height: size * 0.3,
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.18) 45%, transparent 70%)",
            transform: "rotate(-24deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: size * 0.3,
            bottom: size * 0.05,
            width: size * 0.5,
            height: size * 0.16,
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse, rgba(190,255,120,0.45) 0%, transparent 70%)",
          }}
        />
      </div>
      {ring(r * 1.55, r * 0.36, -16, true, 1)}
      {ring(r * 1.32, r * 0.3, 21, true, 0.7)}
    </div>
  );
};

/** Drifting green motes. */
const Motes: React.FC<{ frame: number; variant: number; count?: number }> = ({
  frame,
  variant,
  count = 26,
}) => {
  const r = rng(variant + 101);
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const x = r() * 1920;
        const y0 = r() * 1080;
        const s = 3 + r() * 7;
        const v = 0.3 + r() * 0.9;
        const y = ((((y0 - frame * v) % 1120) + 1120) % 1120) - 20;
        const tw = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(frame / 9 + i));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: s,
              height: s,
              borderRadius: "50%",
              background: G.pale,
              opacity: tw * 0.7,
              boxShadow: `0 0 ${s * 2}px ${s * 0.6}px rgba(140,255,80,0.5)`,
            }}
          />
        );
      })}
    </>
  );
};

const backdrop =
  "radial-gradient(ellipse 75% 85% at 28% 50%, #12450f 0%, #072a0b 38%, #031207 70%, #010603 100%)";

/** A menu capsule. `lit` 0..1 lights it from the dim green of the rest to the bright chosen one. */
const Pill: React.FC<{
  text: string;
  lit: number;
  big?: boolean;
  width: number;
  size: number;
  /** 0..1: already passed in a list, kept brighter than the rest but still light-on-dark. */
  seen?: number;
}> = ({ text, lit, big, width, size, seen = 0 }) => (
  <div
    style={{
      position: "relative",
      width,
      padding: big ? "22px 46px 24px" : "0 40px",
      height: big ? undefined : 74,
      minHeight: big ? 104 : undefined,
      display: "flex",
      alignItems: "center",
      borderRadius: 999,
      background:
        "linear-gradient(180deg, rgba(120,225,70,0.30) 0%, rgba(26,96,18,0.42) 55%, rgba(10,50,8,0.55) 100%)",
      border: `2px solid rgba(170,255,110,${0.42 + 0.4 * Math.max(lit, seen * 0.6)})`,
      boxShadow: `inset 0 2px 0 rgba(255,255,255,0.16), 0 0 ${10 + 40 * lit}px rgba(150,255,70,${0.15 + 0.45 * lit}), 0 10px 26px rgba(0,0,0,0.45)`,
      overflow: "hidden",
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 999,
        opacity: 0.22 * seen * (1 - lit),
        background: "linear-gradient(180deg, #b4f046 0%, #4fa81c 100%)",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 999,
        opacity: lit,
        background:
          "linear-gradient(180deg, #f0ff9c 0%, #b4f046 42%, #63bf22 100%)",
      }}
    />
    {/* Glass highlight across the top of the capsule */}
    <div
      style={{
        position: "absolute",
        left: 22,
        right: 22,
        top: 4,
        height: "42%",
        borderRadius: 999,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.38), rgba(255,255,255,0))",
      }}
    />
    <div
      style={{
        position: "relative",
        fontFamily: BODY,
        fontWeight: big ? 900 : 800,
        fontSize: size,
        lineHeight: 1.08,
        letterSpacing: big ? 0.5 : 2,
        textTransform: "uppercase",
        color: interpolateColors(lit, [0, 1], [G.text, G.ink]),
        whiteSpace: big ? "normal" : "nowrap",
        flex: "1 1 auto",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        textShadow:
          lit > 0.5
            ? "0 1px 0 rgba(255,255,255,0.35)"
            : "0 0 14px rgba(120,255,60,0.45)",
      }}
    >
      {text}
    </div>
  </div>
);

/** The opening title or chapter breather as the 2001 dashboard: orb left, menu right, the heading chosen. */
export const OrbCard: React.FC<MotifCardProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = cardFade(frame, p.frames);
  const heading = txt(p.heading);
  const kicker = txt(p.kicker);
  const game = txt(p.game);
  const year = txt(p.year);
  const variant = p.variant ?? 0;
  const before =
    game && game.toLowerCase() !== heading.toLowerCase()
      ? year
        ? `${game} · ${year}`
        : game
      : year || "GAMES";
  const rest = uniq(["MEDIA", "SYSTEM", "HOME"])
    .filter((x) => x.toLowerCase() !== before.toLowerCase())
    .slice(0, 2);
  const items = [before, heading, ...rest];
  const sel = 1;
  const cx = 540;
  const cy = 540;
  const orbIn = spring({ frame: frame - 1, fps, config: SPRING.ENTER });
  const light = interpolate(frame, [13, 21], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  const pop = spring({ frame: frame - 13, fps, config: SPRING.POP });
  const drift = interpolate(frame, [0, p.frames], [1.045, 1], clamp);
  const tubes = tubesFor(cx, cy, variant);
  const headSize = sizeFor(heading, [
    [12, 66],
    [22, 56],
    [34, 48],
    [52, 42],
    [999, 36],
  ]);
  const kick = interpolate(frame, [6, 16], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  return (
    <AbsoluteFill
      style={{ background: G.void, opacity: fade, overflow: "hidden" }}
    >
      <AbsoluteFill style={{ transform: `scale(${drift})` }}>
        <AbsoluteFill style={{ background: backdrop }} />
        {/* A faint honeycomb-like weave in the dark, the dashboard's organic depth */}
        <AbsoluteFill
          style={{
            opacity: 0.16,
            backgroundImage:
              "radial-gradient(circle at 50% 50%, rgba(140,255,80,0.5) 0 1.5px, transparent 2.5px)",
            backgroundSize: "26px 22px",
            maskImage:
              "radial-gradient(ellipse 60% 70% at 30% 50%, black 0%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 60% 70% at 30% 50%, black 0%, transparent 75%)",
          }}
        />
        <Tubes tubes={tubes} frame={frame} />
        <Motes frame={frame} variant={variant} />
        <Orb
          cx={cx}
          cy={cy}
          r={200}
          frame={frame}
          enter={orbIn}
          picture={p.pictures[0]}
        />
      </AbsoluteFill>
      {/* The menu */}
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 90,
          bottom: 90,
          width: 880,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 22,
        }}
      >
        {kicker ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginLeft: 40,
              marginBottom: 6,
              opacity: kick,
              transform: `translateX(${(1 - kick) * 40}px)`,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: G.lime,
                boxShadow: "0 0 16px 4px rgba(150,255,70,0.6)",
              }}
            />
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: 6,
                color: G.lime,
                textTransform: "uppercase",
                textShadow: "0 0 18px rgba(120,255,60,0.55)",
              }}
            >
              {kicker}
            </div>
            <div
              style={{
                flex: 1,
                maxWidth: 260,
                height: 2,
                background:
                  "linear-gradient(90deg, rgba(160,255,90,0.7), transparent)",
              }}
            />
          </div>
        ) : null}
        {items.map((t, i) => {
          const s = spring({
            frame: frame - (3 + i * 3),
            fps,
            config: SPRING.ENTER,
          });
          const isSel = i === sel;
          const arc = 22 * (i - sel) ** 2;
          const width = isSel ? 840 : 600;
          return (
            <div
              key={i}
              style={{
                marginLeft: arc,
                opacity: Math.min(1, s * 1.4),
                transform: `translateX(${(1 - s) * 160}px) scale(${isSel ? 1 + 0.05 * pop - 0.05 * light : 1})`,
                transformOrigin: "left center",
              }}
            >
              <Pill
                text={isSel ? heading : t.toUpperCase()}
                lit={isSel ? light : 0}
                big={isSel}
                width={width}
                size={isSel ? headSize : fitLabel(t, width - 90, 32, 24)}
              />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** A list as the 2001 menu: the items as capsules, the light stepping down them one by one. */
const OrbList: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const items = g.items.map(txt).filter(Boolean).slice(0, 5);
  const n = items.length;
  const { frame, fps, dim, visible, showFor } = useStage(len, 120 + n * 22);
  if (!visible || n < 2) return null;
  const head = txt(g.primary);
  const cx = 330;
  const cy = 600;
  const step = Math.max(10, Math.min(28, (showFor - 60) / n));
  const at = (i: number) => 16 + i * step;
  const tubes = tubesFor(cx, cy, variant).slice(0, 5);
  const orbIn = spring({ frame, fps, config: SPRING.ENTER });
  const size = sizeFor(
    items.reduce((a, b) => (a.length > b.length ? a : b), ""),
    [
      [16, 40],
      [26, 36],
      [999, 32],
    ],
  );
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ opacity: dim }}>
        <AbsoluteFill style={{ background: backdrop, opacity: 0.93 }} />
        <Tubes tubes={tubes} frame={frame} near={false} />
        <Motes frame={frame} variant={variant} count={16} />
        <Orb cx={cx} cy={cy} r={150} frame={frame} enter={orbIn} />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 640,
          right: 96,
          top: 130,
          bottom: 72,
          opacity: dim,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 20,
        }}
      >
        {head ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 14,
              marginLeft: 36,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                background: G.lime,
                boxShadow: "0 0 16px 4px rgba(150,255,70,0.6)",
              }}
            />
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 34,
                letterSpacing: 5,
                color: G.lime,
                textTransform: "uppercase",
                textShadow: "0 0 18px rgba(120,255,60,0.5)",
              }}
            >
              {head}
            </div>
          </div>
        ) : null}
        {items.map((t, i) => {
          const s = spring({
            frame: frame - (4 + i * 4),
            fps,
            config: SPRING.ENTER,
          });
          const on = interpolate(frame, [at(i), at(i) + 6], [0, 1], clamp);
          const off =
            i < n - 1
              ? interpolate(frame, [at(i + 1), at(i + 1) + 6], [0, 1], clamp)
              : 0;
          // Lit while chosen, then kept a little brighter once passed.
          const lit = on * (1 - off);
          const arc = 16 * Math.abs(i - (n - 1) / 2) ** 2;
          return (
            <div
              key={i}
              style={{
                marginLeft: arc,
                opacity: Math.min(1, s * 1.4),
                transform: `translateX(${(1 - s) * 140}px) scale(${1 + 0.04 * on * (1 - off)})`,
                transformOrigin: "left center",
              }}
            >
              <Pill
                text={t.toUpperCase()}
                lit={lit}
                seen={off}
                width={980}
                size={fitLabel(t, 900, size, 26, 0.64)}
              />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const ORB_STYLES: Record<string, GfxStyle> = {
  OrbMenu: {
    kind: "list",
    component: OrbList,
    fits: (g) => {
      const items = g.items.filter((x) => x.trim());
      return (
        items.length >= 2 &&
        items.length <= 5 &&
        items.every((x) => x.length <= 38) &&
        g.primary.length <= 40
      );
    },
    sound: "glint",
  },
};
