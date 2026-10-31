// Game pack: a milestone as a level-up. An XP bar charges with a counting percentage while orbs of
// experience fly into it, then bursts on the stamp (frame 34) into a LEVEL UP flash with a shock ring,
// light rays and seeded particles; the record or first rises in word by word and the year settles in
// a badge beneath. An original design, not any real game's.
import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import {
  bySize,
  chamferClip,
  clamp,
  clean,
  easeOut,
  seeded,
  wordCount,
} from "./kit.tsx";

export function fitsLevelUp(g: MomentGraphic): boolean {
  const t = clean(g.primary);
  const w = wordCount(t);
  return w >= 2 && w <= 12 && t.length <= 96 && clean(g.secondary).length <= 24;
}

const HIT = 34; // the "stamp" sound lands here
const BAR_W = 1100;
const BAR_H = 36;
const BAR_X = 960 - BAR_W / 2;
const BAR_Y = 548; // centre line of the bar
const LEVEL_Y = 392; // centre line of LEVEL UP

type Particle = {
  x: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  spin: number;
  colour: string;
  delay: number;
  diamond: boolean;
};
type Orb = { x: number; y: number; start: number; size: number };

function useScatter(variant: number) {
  const r = seeded(variant * 97 + 13);
  const colours = [
    COLOUR.amber,
    "#FFC27A",
    COLOUR.paper,
    COLOUR.gold,
    COLOUR.amber,
  ];
  const particles: Particle[] = Array.from({ length: 34 }, () => {
    const a = (-90 + (r() - 0.5) * 150) * (Math.PI / 180);
    const speed = 260 + r() * 520;
    return {
      x: BAR_X + 60 + r() * (BAR_W - 120),
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      size: 8 + r() * 12,
      life: 28 + r() * 20,
      spin: (r() - 0.5) * 540,
      colour: colours[Math.floor(r() * colours.length)]!,
      delay: r() * 4,
      diamond: r() > 0.35,
    };
  });
  const orbs: Orb[] = Array.from({ length: 10 }, () => ({
    x: 260 + r() * 1400,
    y: 760 + r() * 220,
    start: 4 + r() * (HIT - 22),
    size: 12 + r() * 10,
  }));
  const shake = Array.from({ length: 8 }, () => ({
    x: (r() - 0.5) * 2,
    y: (r() - 0.5) * 2,
  }));
  return { particles, orbs, shake };
}

export const LevelUp: React.FC<GfxProps> = ({ g, len, bg, variant = 0 }) => {
  const { frame, fps, dim, visible } = useStage(len, 190);
  const text = clean(g.primary);
  const year = clean(g.secondary);
  const { particles, orbs, shake } = useScatter(variant);
  if (!visible || !text) return null;
  const words = text.split(" ");
  const since = frame - HIT;
  const hit = since >= 0;

  // The charge: the bar fills faster and faster up to the hit.
  const raw = interpolate(frame, [6, HIT], [0, 1], clamp);
  const fill = 0.55 * raw * raw + 0.45 * raw;
  const barIn = spring({ frame, fps, config: SPRING.SNAP });
  const pct = Math.round(fill * 100);

  // The hit: a camera shake, a flash, rings, rays and the title.
  const sh = hit && since < 8 ? shake[since]! : { x: 0, y: 0 };
  const shakeAmp = hit ? interpolate(since, [0, 8], [14, 0], clamp) : 0;
  const flash = interpolate(since, [0, 2, 14], [0, 0.9, 0], clamp);
  const title = spring({
    frame: since,
    fps,
    config: { damping: 11, stiffness: 230, mass: 0.6 },
  });
  const titleOp = interpolate(since, [0, 3], [0, 1], clamp);
  const rays = interpolate(since, [0, 10], [0, 1], clamp);
  const pctPop = hit
    ? 1 +
      0.3 * Math.max(0, 1 - spring({ frame: since, fps, config: SPRING.POP }))
    : 1;
  const glint = interpolate((frame - HIT - 20) % 75, [0, 22], [0, 1], clamp);

  // The milestone and the year.
  const TEXT_IN = HIT + 14;
  const textSize = bySize(text, [
    [26, 70],
    [48, 60],
    [72, 52],
    [999, 46],
  ]);
  const yearIn = spring({
    frame: frame - (TEXT_IN + words.length * 2 + 8),
    fps,
    config: SPRING.POP,
  });
  const yearBig = year.length <= 16;
  const yearSize = year.length <= 6 ? 64 : 54;

  const ring = (delay: number, maxR: number, width: number) => {
    const t = interpolate(since - delay, [0, 24], [0, 1], {
      ...clamp,
      easing: easeOut,
    });
    if (since - delay < 0 || t >= 1) return null;
    const r = 40 + t * maxR;
    return (
      <div
        style={{
          position: "absolute",
          left: 960 - r,
          top: (LEVEL_Y + BAR_Y) / 2 - r,
          width: 2 * r,
          height: 2 * r,
          borderRadius: "50%",
          border: `${Math.max(1, width * (1 - t))}px solid ${COLOUR.amber}`,
          opacity: 1 - t,
        }}
      />
    );
  };

  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <AbsoluteFill
        style={{
          transform: `translate(${sh.x * shakeAmp}px, ${sh.y * shakeAmp}px)`,
        }}
      >
        {/* Light rays behind the title, turning slowly. */}
        {hit ? (
          <div
            style={{
              position: "absolute",
              left: 960 - 760,
              top: LEVEL_Y - 760,
              width: 1520,
              height: 1520,
              opacity: 0.85 * rays,
              transform: `scale(${0.6 + 0.4 * rays})`,
              background: `repeating-conic-gradient(from ${frame * 0.35}deg, rgba(255,140,60,0.20) 0deg 5deg, rgba(255,140,60,0) 5deg 15deg)`,
              WebkitMaskImage:
                "radial-gradient(circle, rgba(0,0,0,1) 8%, rgba(0,0,0,0.5) 30%, rgba(0,0,0,0) 58%)",
              maskImage:
                "radial-gradient(circle, rgba(0,0,0,1) 8%, rgba(0,0,0,0.5) 30%, rgba(0,0,0,0) 58%)",
            }}
          />
        ) : null}
        {/* A warm glow under the title. */}
        <div
          style={{
            position: "absolute",
            left: 960 - 700,
            top: LEVEL_Y - 260,
            width: 1400,
            height: 520,
            opacity: rays,
            background:
              "radial-gradient(ellipse at center, rgba(255,107,26,0.38) 0%, rgba(255,107,26,0.12) 40%, rgba(255,107,26,0) 70%)",
          }}
        />
        {ring(0, 780, 12)}
        {ring(5, 560, 6)}

        {/* LEVEL UP: an extruded shadow layer under a gradient face. */}
        {hit ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: LEVEL_Y - 100,
              height: 200,
              display: "flex",
              justifyContent: "center",
              opacity: titleOp,
              transform: `scale(${1.4 - 0.4 * title})`,
            }}
          >
            <div
              style={{
                position: "relative",
                fontFamily: DISPLAY,
                fontSize: 196,
                lineHeight: 1,
                letterSpacing: 6 + 22 * (1 - title),
                whiteSpace: "nowrap",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 9,
                  color: "#5A1D00",
                }}
              >
                LEVEL UP
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 4,
                  color: "#A83A00",
                }}
              >
                LEVEL UP
              </div>
              <div
                style={{
                  position: "relative",
                  backgroundImage:
                    "linear-gradient(180deg, #FFF6E8 0%, #FFD29A 38%, #FF8A3D 56%, #FF6B1A 70%, #D84A00 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                LEVEL UP
              </div>
            </div>
          </div>
        ) : null}
        {/* Chevrons either side of the title. */}
        {hit
          ? [-1, 1].map((side) => (
              <div
                key={side}
                style={{
                  position: "absolute",
                  top: LEVEL_Y - 34,
                  left: 960 + side * (520 + 30 * (1 - title)) - 30,
                  width: 60,
                  height: 60,
                  opacity: titleOp,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                {[0, 1].map((k) => (
                  <svg
                    key={k}
                    width={52}
                    height={26}
                    viewBox="0 0 52 26"
                    style={{
                      transform: `translateY(${-((frame + k * 8) % 24) * 0.4}px)`,
                      opacity: k ? 0.55 : 1,
                    }}
                  >
                    <path
                      d="M4 24 L26 4 L48 24"
                      stroke={COLOUR.amber}
                      strokeWidth={7}
                      fill="none"
                      strokeLinejoin="miter"
                    />
                  </svg>
                ))}
              </div>
            ))
          : null}

        {/* XP orbs flying into the head of the bar while it charges. */}
        {orbs.map((o, i) => {
          const t = interpolate(frame, [o.start, o.start + 18], [0, 1], clamp);
          if (t <= 0 || t >= 1) return null;
          const e = t * t;
          const hx = BAR_X + fill * BAR_W;
          const x = o.x + (hx - o.x) * e;
          const y = o.y + (BAR_Y - o.y) * e - Math.sin(Math.PI * t) * 60;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x - o.size * 1.5,
                top: y - o.size * 1.5,
                width: o.size * 3,
                height: o.size * 3,
                borderRadius: "50%",
                opacity: interpolate(t, [0, 0.2, 1], [0, 1, 0.9]),
                background: `radial-gradient(circle, #FFF2D6 0%, ${COLOUR.gold} 22%, rgba(255,194,26,0.35) 40%, rgba(255,194,26,0) 68%)`,
              }}
            />
          );
        })}

        {/* The XP bar. */}
        <div
          style={{
            position: "absolute",
            left: BAR_X - 6,
            top: BAR_Y - BAR_H / 2 - 6,
            width: BAR_W + 12,
            height: BAR_H + 12,
            opacity: barIn,
            transform: `scaleX(${0.7 + 0.3 * barIn})`,
            background: hit
              ? `linear-gradient(90deg, #FFC27A, ${COLOUR.amber}, #FFC27A)`
              : "rgba(245,245,242,0.85)",
            clipPath: chamferClip(14),
            boxShadow: hit ? "0 0 40px rgba(255,107,26,0.6)" : "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 4,
              background: "#0F0F14",
              clipPath: chamferClip(11),
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${fill * 100}%`,
                background: `repeating-linear-gradient(115deg, rgba(255,255,255,0.20) 0 10px, rgba(255,255,255,0) 10px 22px) ${frame * 3}px 0 / 200% 100%, linear-gradient(90deg, #B83A06 0%, ${COLOUR.amber} 62%, #FFC27A 100%)`,
              }}
            />
            {/* Notches every tenth. */}
            {Array.from({ length: 9 }, (_, k) => (
              <div
                key={k}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${(k + 1) * 10}%`,
                  width: 3,
                  background: "rgba(0,0,0,0.45)",
                }}
              />
            ))}
            {hit ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${-30 + glint * 140}%`,
                  width: "18%",
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.55), rgba(255,255,255,0))",
                }}
              />
            ) : null}
          </div>
        </div>
        {/* The glowing head of the fill. */}
        {!hit && fill > 0.01 ? (
          <div
            style={{
              position: "absolute",
              left: BAR_X + fill * BAR_W - 50,
              top: BAR_Y - 50,
              width: 100,
              height: 100,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,240,215,0.95) 0%, rgba(255,170,90,0.55) 22%, rgba(255,107,26,0) 62%)",
            }}
          />
        ) : null}
        {/* XP and the percentage either side of the bar. */}
        <div
          style={{
            position: "absolute",
            left: BAR_X - 120,
            width: 96,
            top: BAR_Y - 20,
            textAlign: "right",
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 32,
            lineHeight: "40px",
            letterSpacing: 3,
            color: COLOUR.amber,
            opacity: barIn,
          }}
        >
          XP
        </div>
        <div
          style={{
            position: "absolute",
            left: BAR_X + BAR_W + 26,
            top: BAR_Y - 32,
            fontFamily: DISPLAY,
            fontSize: 60,
            lineHeight: "64px",
            color: hit ? COLOUR.amber : COLOUR.paper,
            fontVariantNumeric: "tabular-nums",
            opacity: barIn,
            transform: `scale(${pctPop})`,
            transformOrigin: "left center",
          }}
        >
          {pct}%
        </div>

        {/* The flash. */}
        {flash > 0 ? (
          <div
            style={{
              position: "absolute",
              left: 960 - 1100,
              top: BAR_Y - 640,
              width: 2200,
              height: 1280,
              opacity: flash,
              background:
                "radial-gradient(ellipse at center, rgba(255,250,240,0.95) 0%, rgba(255,200,140,0.6) 22%, rgba(255,107,26,0) 60%)",
            }}
          />
        ) : null}

        {/* Particles. */}
        {hit
          ? particles.map((p, i) => {
              const t = (since - p.delay) / p.life;
              if (t <= 0 || t >= 1) return null;
              const travel = 1 - (1 - t) ** 2;
              const x = p.x + p.vx * travel;
              const y = BAR_Y + p.vy * travel + 420 * t * t;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: x - p.size / 2,
                    top: y - p.size / 2,
                    width: p.size,
                    height: p.size,
                    background: p.colour,
                    borderRadius: p.diamond ? 2 : "50%",
                    opacity: 1 - t * t,
                    transform: `rotate(${45 + p.spin * t}deg) scale(${1 - 0.5 * t})`,
                  }}
                />
              );
            })
          : null}

        {/* The milestone, word by word, then the year. */}
        <div
          style={{
            position: "absolute",
            left: 230,
            right: 230,
            top: BAR_Y + 64,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: textSize,
              lineHeight: 1.14,
              color: COLOUR.paper,
              textAlign: "center",
              textShadow: "0 6px 28px rgba(0,0,0,0.65)",
            }}
          >
            {words.map((w, i) => {
              const p = spring({
                frame: frame - TEXT_IN - i * 2,
                fps,
                config: SPRING.ENTER,
              });
              return (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    overflow: "hidden",
                    verticalAlign: "top",
                    paddingBottom: 6,
                    marginBottom: -6,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      transform: `translateY(${(1 - p) * 105}%)`,
                      opacity: p > 0.01 ? 1 : 0,
                    }}
                  >
                    {w}
                    {i < words.length - 1 ? " " : ""}
                  </span>
                </span>
              );
            })}
          </div>
          {year ? (
            <div
              style={{
                marginTop: 30,
                opacity: yearIn,
                transform: `translateY(${(1 - yearIn) * 30}px) scale(${0.7 + 0.3 * yearIn})`,
                padding: 3,
                background: COLOUR.amber,
                clipPath: chamferClip(16),
              }}
            >
              <div
                style={{
                  clipPath: chamferClip(14),
                  background: "#121216",
                  padding: yearBig ? "8px 40px 6px" : "12px 30px",
                  fontFamily: yearBig ? DISPLAY : BODY,
                  fontWeight: yearBig ? 400 : 900,
                  fontSize: yearBig ? yearSize : 32,
                  lineHeight: 1,
                  letterSpacing: yearBig ? 3 : 2,
                  color: COLOUR.amber,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {year}
              </div>
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
