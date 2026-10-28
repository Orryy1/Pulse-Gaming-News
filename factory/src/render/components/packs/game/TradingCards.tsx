// Game pack: who's who as collectible cards. Face-down cards are dealt up from below into a fan, flip
// over one by one and catch a holographic sheen. The face shows the person's portrait when the shot
// list has one (props.photos by lower-case name), else a bold monogram on a patterned field; name and
// role sit on a plate. An original card design: no real card game's frame, icons or type.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { Stage, pairs, useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps } from "../types.ts";
import {
  bySize,
  clamp,
  clampLines,
  clean,
  easeInOut,
  linesNeeded,
  longestWord,
  wordCount,
} from "./kit.tsx";

type Card = { name: string; role: string };

function cardRows(items: string[]): Card[] {
  return pairs(items.map(clean))
    .map(({ a, b }) => ({ name: a, role: b }))
    .filter((r) => r.name.length > 0 && r.role.length > 0);
}

export function fitsTradingCards(g: MomentGraphic): boolean {
  const rows = cardRows(g.items);
  const given = g.items.filter((x) => x.trim()).length;
  const heading = clean(g.primary);
  return (
    rows.length >= 1 &&
    rows.length <= 4 &&
    given === rows.length &&
    rows.every(
      (r) =>
        r.name.length <= 30 && longestWord(r.name) <= 16 && r.role.length <= 48,
    ) &&
    heading.length <= 44 &&
    wordCount(heading) <= 7
  );
}

/** Frame metals by variant: highlight, body, shadow, edge glint. */
const METALS = [
  ["#FFB27A", "#FF6B1A", "#8A3206", "#FFE0C2"],
  ["#FFE29A", "#D99A1C", "#6E4A06", "#FFF4CF"],
  ["#F4F4F6", "#A3A7B1", "#474B54", "#FFFFFF"],
] as const;

const initialsOf = (name: string) => {
  const w = name.split(/\s+/).filter((x) => /[A-Za-z0-9]/.test(x));
  const first = w[0]?.match(/[A-Za-z0-9]/)?.[0] ?? "";
  const last =
    w.length > 1 ? (w[w.length - 1]!.match(/[A-Za-z0-9]/)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
};

/** The monogram's field, by variant: stripes, halftone dots, rings or a fine grid. */
const FIELDS = [
  "repeating-linear-gradient(135deg, rgba(255,107,26,0.26) 0 12px, rgba(255,107,26,0.07) 12px 26px), radial-gradient(circle at 50% 38%, #3d2414 0%, #140f0d 72%)",
  "radial-gradient(circle, rgba(255,140,60,0.42) 2.6px, transparent 3.2px) 0 0 / 15px 15px, radial-gradient(circle at 50% 38%, #3a2416 0%, #120e0d 72%)",
  "repeating-radial-gradient(circle at 50% 42%, rgba(255,107,26,0.22) 0 7px, rgba(255,107,26,0.04) 7px 19px), radial-gradient(circle at 50% 38%, #3a2416 0%, #120e0d 72%)",
  "linear-gradient(rgba(255,140,60,0.18) 2px, transparent 2px) 0 0 / 22px 22px, linear-gradient(90deg, rgba(255,140,60,0.18) 2px, transparent 2px) 0 0 / 22px 22px, radial-gradient(circle at 50% 38%, #3d2414 0%, #120e0d 72%)",
];

const Sheen: React.FC<{
  p: number;
  strength: number;
  W: number;
  H: number;
}> = ({ p, strength, W, H }) =>
  p <= 0 || p >= 1 ? null : (
    <div
      style={{
        position: "absolute",
        top: -H * 0.25,
        height: H * 1.5,
        left: -W * 0.7 + p * W * 2.1,
        width: W * 0.62,
        transform: "rotate(20deg)",
        opacity: strength,
        mixBlendMode: "screen",
        pointerEvents: "none",
        background:
          "linear-gradient(90deg, rgba(255,200,140,0) 0%, rgba(255,190,120,0.30) 26%, rgba(255,245,225,0.62) 44%, rgba(150,225,255,0.42) 56%, rgba(255,150,225,0.32) 70%, rgba(255,150,225,0) 100%)",
      }}
    />
  );

const CardBack: React.FC<{
  W: number;
  H: number;
  metal: readonly string[];
}> = ({ W, H, metal }) => {
  const B = Math.round(W * 0.028);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: W * 0.06,
        padding: B,
        background: `linear-gradient(150deg, ${metal[3]} 0%, ${metal[0]} 16%, ${metal[1]} 46%, ${metal[2]} 72%, ${metal[0]} 100%)`,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: W * 0.06 - B + 2,
          overflow: "hidden",
          background:
            "repeating-linear-gradient(45deg, rgba(255,107,26,0.16) 0 2px, transparent 2px 24px), repeating-linear-gradient(-45deg, rgba(255,107,26,0.16) 0 2px, transparent 2px 24px), radial-gradient(circle at 50% 50%, #33200f 0%, #0d0b0c 78%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: W * 0.05,
            border: `2px solid ${metal[0]}`,
            opacity: 0.55,
            borderRadius: W * 0.03,
          }}
        />
        <div
          style={{
            width: W * 0.36,
            height: W * 0.36,
            transform: "rotate(45deg)",
            border: `${Math.round(W * 0.014)}px solid ${COLOUR.amber}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 30px rgba(255,107,26,0.35)",
          }}
        >
          <div
            style={{ width: "52%", height: "52%", background: COLOUR.amber }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: H * 0.5 - 1,
            height: 2,
            background: "rgba(255,107,26,0.35)",
          }}
        />
      </div>
    </div>
  );
};

const CardFace: React.FC<{
  r: Card;
  index: number;
  W: number;
  H: number;
  metal: readonly string[];
  field: string;
  photo?: string;
  sheens: Array<{ p: number; strength: number }>;
  name: { size: number; lines: number };
}> = ({ r, index, W, H, metal, field, photo, sheens, name }) => {
  const s = W / 340;
  const B = Math.round(W * 0.028);
  const strip = Math.round(46 * s);
  const winH = Math.round(H * 0.53);
  const nameSize = name.size;
  const roleSize = Math.max(
    22,
    Math.round(
      bySize(r.role, [
        [22, 25],
        [40, 23],
        [99, 22],
      ]) * Math.min(1.15, s),
    ),
  );
  const initials = initialsOf(r.name);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: W * 0.06,
        padding: B,
        background: `linear-gradient(150deg, ${metal[3]} 0%, ${metal[0]} 16%, ${metal[1]} 46%, ${metal[2]} 72%, ${metal[0]} 100%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: W * 0.06 - B + 2,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, #1d1b22 0%, #111015 60%, #0b0a0e 100%)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top strip: the card's number in the set and a row of pips (decoration only). */}
        <div
          style={{
            height: strip,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `0 ${Math.round(16 * s)}px`,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: Math.max(22, Math.round(22 * s)),
              letterSpacing: 3,
              color: metal[0],
            }}
          >
            No.{String(index + 1).padStart(2, "0")}
          </div>
          <div style={{ display: "flex", gap: Math.round(7 * s) }}>
            {[0, 1, 2].map((k) => (
              <div
                key={k}
                style={{
                  width: Math.round(11 * s),
                  height: Math.round(11 * s),
                  transform: "rotate(45deg)",
                  background: k === 0 ? COLOUR.amber : "transparent",
                  border: `2px solid ${k === 0 ? COLOUR.amber : metal[0]}`,
                  opacity: k === 0 ? 1 : 0.6,
                }}
              />
            ))}
          </div>
        </div>
        {/* The portrait window. */}
        <div
          style={{
            position: "relative",
            margin: `0 ${Math.round(14 * s)}px`,
            height: winH,
            flexShrink: 0,
            borderRadius: Math.round(10 * s),
            overflow: "hidden",
            background: photo ? COLOUR.ink : field,
          }}
        >
          {photo ? (
            <Img
              src={photo}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "50% 22%",
                filter: "contrast(1.06) saturate(0.92)",
              }}
            />
          ) : (
            <AbsoluteFill
              style={{ alignItems: "center", justifyContent: "center" }}
            >
              <div
                style={{
                  position: "absolute",
                  width: winH * 0.72,
                  height: winH * 0.72,
                  borderRadius: "50%",
                  border: `${Math.round(5 * s)}px solid rgba(255,107,26,0.55)`,
                  boxShadow: "inset 0 0 40px rgba(255,107,26,0.25)",
                }}
              />
              <div
                style={{
                  position: "relative",
                  fontFamily: DISPLAY,
                  fontSize: Math.round(
                    winH * (initials.length > 1 ? 0.46 : 0.56),
                  ),
                  lineHeight: 1,
                  color: COLOUR.paper,
                  letterSpacing: 2,
                  textShadow: `${Math.round(6 * s)}px ${Math.round(6 * s)}px 0 #8A3206`,
                }}
              >
                {initials}
              </div>
            </AbsoluteFill>
          )}
          {/* Depth: a soft shade at the foot of the window and a fine inner rule. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: Math.round(10 * s),
              boxShadow: `inset 0 0 0 ${Math.max(2, Math.round(3 * s))}px ${metal[0]}`,
              opacity: 0.85,
            }}
          />
        </div>
        {/* Name plate, overlapping the window's foot. */}
        <div
          style={{
            position: "relative",
            margin: `${Math.round(-30 * s)}px ${Math.round(12 * s)}px 0`,
            padding: `${Math.round(10 * s)}px ${Math.round(12 * s)}px`,
            background: `linear-gradient(180deg, #FF8A45 0%, ${COLOUR.amber} 55%, #E2550C 100%)`,
            clipPath: `polygon(${Math.round(14 * s)}px 0, 100% 0, 100% calc(100% - ${Math.round(14 * s)}px), calc(100% - ${Math.round(14 * s)}px) 100%, 0 100%, 0 ${Math.round(14 * s)}px)`,
            textAlign: "center",
            flexShrink: 0,
            boxSizing: "content-box",
            minHeight: name.lines * Math.round(nameSize * 1.04),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: nameSize,
              lineHeight: `${Math.round(nameSize * 1.04)}px`,
              color: COLOUR.ink,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              ...clampLines(2),
            }}
          >
            {r.name}
          </div>
        </div>
        {/* The role. */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: `${Math.round(8 * s)}px ${Math.round(18 * s)}px ${Math.round(12 * s)}px`,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: roleSize,
              lineHeight: 1.18,
              letterSpacing: 1.5,
              color: "#D9D4DE",
              textTransform: "uppercase",
              textAlign: "center",
              ...clampLines(3),
            }}
          >
            {r.role.split(" ").map((w, k) => (
              <React.Fragment key={k}>
                {k > 0 ? " " : null}
                <span style={{ whiteSpace: "nowrap" }}>{w}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div
          style={{
            height: Math.round(5 * s),
            background: `linear-gradient(90deg, transparent, ${COLOUR.amber}, transparent)`,
            opacity: 0.7,
            flexShrink: 0,
          }}
        />
      </div>
      {sheens.map((x, k) => (
        <Sheen key={k} p={x.p} strength={x.strength} W={W} H={H} />
      ))}
    </div>
  );
};

export const TradingCards: React.FC<GfxProps> = ({
  g,
  len,
  bg,
  variant = 0,
  photos = {},
}) => {
  const { frame, fps, dim, visible } = useStage(len, 200);
  const rows = cardRows(g.items).slice(0, 4);
  if (!visible || !rows.length) return null;
  const heading = clean(g.primary);
  const n = rows.length;
  const W = [420, 420, 440, 400, 360][n] ?? 360;
  const H = Math.round(W * 1.4);
  const gap = n === 4 ? 38 : 56;
  const metal = METALS[Math.abs(variant) % METALS.length]!;
  const field = FIELDS[Math.abs(variant) % FIELDS.length]!;
  const headH = heading ? 128 : 0;
  // Centre the heading and the fan together inside the safe area (130 to 1008).
  const top = Math.max(150, 569 - (headH + H) / 2);
  const cy = top + headH + H / 2;
  const mid = (n - 1) / 2;
  const headIn = spring({ frame, fps, config: SPRING.ENTER });
  const headSize = bySize(heading, [
    [16, 72],
    [26, 62],
    [99, 52],
  ]);
  const photoFor = (name: string) =>
    photos[name.toLowerCase()] ?? photos[name.trim().toLowerCase()];
  // One name size for the whole set: one line when every name fits at a readable size, else two.
  const k = Math.min(1.2, W / 340);
  const plateInner =
    W - 2 * Math.round(W * 0.028) - 4 * Math.round(12 * (W / 340));
  const sizes = [36, 33, 30, 28, 26].map((x) => Math.round(x * k));
  const fitsIn = (z: number, lines: number) =>
    rows.every(
      (r) => linesNeeded(r.name.toUpperCase(), plateInner, z, 0.68) <= lines,
    );
  const oneLine = sizes.find((z) => z >= Math.round(30 * k) && fitsIn(z, 1));
  const name = oneLine
    ? { size: oneLine, lines: 1 }
    : {
        size: sizes.find((z) => fitsIn(z, 2)) ?? sizes[sizes.length - 1]!,
        lines: 2,
      };
  return (
    <Stage dim={dim} bg={bg} variant={variant}>
      <AbsoluteFill>
        {heading ? (
          <div
            style={{
              position: "absolute",
              top,
              left: 96,
              right: 96,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 26,
              opacity: headIn,
              transform: `translateY(${(1 - headIn) * 30}px)`,
            }}
          >
            <div
              style={{
                width: 90 * headIn,
                height: 3,
                background: `linear-gradient(90deg, transparent, ${COLOUR.amber})`,
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                transform: "rotate(45deg)",
                background: COLOUR.amber,
              }}
            />
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: headSize,
                lineHeight: 1,
                color: COLOUR.paper,
                textTransform: "uppercase",
                letterSpacing: 3,
                whiteSpace: "nowrap",
                textShadow: "0 8px 30px rgba(0,0,0,0.6)",
              }}
            >
              {heading}
            </div>
            <div
              style={{
                width: 14,
                height: 14,
                transform: "rotate(45deg)",
                background: COLOUR.amber,
              }}
            />
            <div
              style={{
                width: 90 * headIn,
                height: 3,
                background: `linear-gradient(90deg, ${COLOUR.amber}, transparent)`,
              }}
            />
          </div>
        ) : null}
        {rows.map((r, i) => {
          const tx = 960 + (i - mid) * (W + gap);
          const ty = cy + (i - mid) ** 2 * 10;
          const restRot =
            (i - mid) * (n === 1 ? 0 : 2.6) + (n === 1 ? -1.5 : 0);
          const deal = spring({
            frame: frame - 4 - i * 7,
            fps,
            config: { damping: 15, stiffness: 110, mass: 0.85 },
          });
          const flipStart = 15 + i * 9;
          const flip = interpolate(frame, [flipStart, flipStart + 14], [0, 1], {
            ...clamp,
            easing: easeInOut,
          });
          const angle = 180 * (1 - flip);
          const showBack = angle > 90;
          const lift = 1 + 0.07 * Math.sin(Math.PI * flip);
          const settled = interpolate(
            frame,
            [flipStart + 14, flipStart + 40],
            [0, 1],
            clamp,
          );
          const float = Math.sin((frame + i * 23) / 26) * 5 * settled;
          const sway = Math.sin((frame + i * 31) / 38) * 4 * settled;
          const x = 960 + (tx - 960) * deal;
          const y = 1420 + (ty - 1420) * deal + float;
          const rot =
            -24 + (i - mid) * 6 + (restRot + 24 - (i - mid) * 6) * deal;
          const sweepAt = flipStart + 12;
          const sheens = [
            {
              p: interpolate(frame, [sweepAt, sweepAt + 26], [0, 1], clamp),
              strength: 1,
            },
            {
              p: interpolate(
                frame,
                [sweepAt + 70, sweepAt + 100],
                [0, 1],
                clamp,
              ),
              strength: 0.6,
            },
          ];
          if (deal <= 0.001) return null;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: W,
                height: H,
                transform: `translate(${x - W / 2}px, ${y - H / 2}px) rotate(${rot}deg) perspective(1600px) rotateY(${(showBack ? angle - 180 : angle) + sway}deg) scale(${lift})`,
                borderRadius: W * 0.06,
                boxShadow:
                  "0 34px 70px rgba(0,0,0,0.55), 0 8px 18px rgba(0,0,0,0.4)",
              }}
            >
              {/* Both faces stay mounted (the portrait loads before the flip); one shows at a time. */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: showBack ? 1 : 0,
                }}
              >
                <CardBack W={W} H={H} metal={metal} />
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: showBack ? 0 : 1,
                }}
              >
                <CardFace
                  r={r}
                  index={i}
                  W={W}
                  H={H}
                  metal={metal}
                  field={field}
                  photo={photoFor(r.name)}
                  sheens={sheens}
                  name={name}
                />
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </Stage>
  );
};
