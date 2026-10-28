// Current consoles (2013 on), in homage to the modern console home screen: the chosen game full-bleed
// behind a soft gradient, its name as the hero title, a row of rounded tiles sliding in and the chosen
// tile growing inside a focus ring. Built from scratch; no logo, icon or real menu.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING, ease } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MotifCardProps } from "../types.ts";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import { cardFade, clamp, sizeFor, splitRow, txt } from "./util.ts";

const FOCUS = { damping: 13, stiffness: 170, mass: 0.6 } as const;
const GLASS =
  "linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.03) 100%)";

/** A soft abstract backdrop for when there is no picture: slow light in deep green, teal and blue. */
const Ambient: React.FC<{ frame: number }> = ({ frame }) => {
  const a = Math.sin(frame / 40) * 60;
  const b = Math.cos(frame / 52) * 50;
  const blob = (left: number, top: number, w: number, h: number, c: string) => (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: w,
        height: h,
        borderRadius: "50%",
        background: `radial-gradient(ellipse, ${c} 0%, rgba(0,0,0,0) 66%)`,
      }}
    />
  );
  return (
    <AbsoluteFill
      style={{ background: "linear-gradient(180deg, #0d171b 0%, #05090b 100%)" }}
    >
      {blob(760 + a, -320 + b, 1500, 1100, "rgba(40,150,90,0.75)")}
      {blob(-360 - b, 380 + a * 0.5, 1400, 1000, "rgba(36,96,170,0.55)")}
      {blob(1180 - a * 0.6, 420 - b * 0.4, 1000, 800, "rgba(120,200,160,0.28)")}
      {/* A soft band of light across the hero, the way a home screen's art glows */}
      <div
        style={{
          position: "absolute",
          left: -200,
          right: -200,
          top: 300 + b * 0.3,
          height: 260,
          transform: "rotate(-8deg)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(210,255,230,0.10) 50%, rgba(255,255,255,0) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

/** Muted gradients for tiles with no picture, so an empty row still reads as a shelf of apps. */
const TINTS = [
  "linear-gradient(150deg, rgba(64,160,100,0.55) 0%, rgba(20,60,40,0.55) 100%)",
  "linear-gradient(150deg, rgba(70,120,190,0.55) 0%, rgba(20,40,80,0.55) 100%)",
  "linear-gradient(150deg, rgba(150,160,170,0.45) 0%, rgba(40,46,54,0.55) 100%)",
  "linear-gradient(150deg, rgba(90,170,170,0.5) 0%, rgba(20,56,60,0.55) 100%)",
];

/** A rounded tile: a picture, or frosted glass with a generic label. */
const Tile: React.FC<{
  pic?: string;
  label?: string;
  size: number;
  focus: number;
  sheen?: number;
  tint?: string;
}> = ({ pic, label, size, focus, sheen = -100, tint = GLASS }) => (
  <div
    style={{
      position: "relative",
      width: size,
      height: size,
      borderRadius: 18,
      overflow: "hidden",
      flexShrink: 0,
      background: pic ? "#111" : tint,
      border: pic ? "none" : "1px solid rgba(255,255,255,0.16)",
      outline: `${5 * focus}px solid rgba(255,255,255,${focus})`,
      outlineOffset: 6,
      boxShadow: `0 ${16 + 14 * focus}px ${40 + 30 * focus}px rgba(0,0,0,0.55), 0 0 ${50 * focus}px rgba(255,255,255,${0.28 * focus})`,
    }}
  >
    {pic ? (
      <Img
        src={pic}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : (
      <div
        style={{
          position: "absolute",
          left: 22,
          bottom: 18,
          right: 18,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: 2,
          color: "rgba(255,255,255,0.86)",
        }}
      >
        {label}
      </div>
    )}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `linear-gradient(110deg, transparent ${sheen - 16}%, rgba(255,255,255,0.32) ${sheen}%, transparent ${sheen + 16}%)`,
      }}
    />
  </div>
);

/** The opening title or chapter breather as a current console's home screen. */
export const ModernCard: React.FC<MotifCardProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = cardFade(frame, p.frames);
  const heading = txt(p.heading);
  const kicker = txt(p.kicker);
  const game = txt(p.game);
  const year = txt(p.year);
  const hero = p.pictures[0];
  const generic = ["GAMES", "MEDIA", "SYSTEM", "HOME"];
  const tiles: Array<{ pic?: string; label?: string }> = p.pictures
    .slice(0, 6)
    .map((pic) => ({ pic }));
  for (let i = 0; tiles.length < 4; i++)
    tiles.push({ label: generic[i % generic.length] });
  const push = interpolate(frame, [0, p.frames], [1.1, 1.02], clamp);
  const pan = interpolate(frame, [0, p.frames], [-30, 10], clamp);
  const nav = interpolate(frame, [2, 12], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  const rise = interpolate(frame, [5, 19], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  const meta = interpolate(frame, [11, 23], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  const grow = spring({ frame: frame - 12, fps, config: FOCUS });
  const sheen = interpolate(frame, [18, 38], [-30, 130], clamp);
  const headSize = sizeFor(heading, [
    [14, 128],
    [24, 106],
    [38, 86],
    [60, 70],
    [999, 60],
  ]);
  const line = [
    game && game.toLowerCase() !== heading.toLowerCase() ? game : "",
    year,
  ]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <AbsoluteFill
      style={{ background: "#05080a", opacity: fade, overflow: "hidden" }}
    >
      {hero ? (
        <AbsoluteFill
          style={{ transform: `scale(${push}) translateX(${pan}px)` }}
        >
          <Img
            src={hero}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      ) : (
        <Ambient frame={frame} />
      )}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(4,6,8,0.9) 0%, rgba(4,6,8,0.66) 34%, rgba(4,6,8,0.12) 66%, rgba(4,6,8,0) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(0deg, rgba(4,6,8,0.95) 0%, rgba(4,6,8,0.55) 30%, rgba(4,6,8,0) 56%), linear-gradient(180deg, rgba(4,6,8,0.6) 0%, rgba(4,6,8,0) 18%)",
        }}
      />
      {/* Top bar: generic sections, HOME chosen */}
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 64,
          display: "flex",
          gap: 14,
          opacity: nav,
          transform: `translateY(${(1 - nav) * -20}px)`,
        }}
      >
        {["HOME", "GAMES", "MEDIA", "SYSTEM"].map((x, i) => (
          <div
            key={x}
            style={{
              padding: "10px 24px",
              borderRadius: 999,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 26,
              letterSpacing: 1.5,
              color: i === 0 ? "#0a0d10" : "rgba(255,255,255,0.78)",
              background: i === 0 ? "#ffffff" : "rgba(255,255,255,0.08)",
              border: i === 0 ? "none" : "1px solid rgba(255,255,255,0.14)",
            }}
          >
            {x}
          </div>
        ))}
      </div>
      {/* Hero title */}
      <div
        style={{ position: "absolute", left: 120, bottom: 394, width: 1200 }}
      >
        {kicker ? (
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: 6,
                color: "rgba(255,255,255,0.82)",
                textTransform: "uppercase",
                transform: `translateY(${(1 - rise) * 110}%)`,
              }}
            >
              {kicker}
            </div>
          </div>
        ) : null}
        <div style={{ overflow: "hidden", marginTop: 10, paddingBottom: 8 }}>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: headSize,
              lineHeight: 0.98,
              letterSpacing: -2,
              color: "#ffffff",
              textShadow: "0 6px 40px rgba(0,0,0,0.45)",
              transform: `translateY(${(1 - rise) * 100}%)`,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {heading}
          </div>
        </div>
        {line ? (
          <div
            style={{
              marginTop: 14,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 30,
              color: "rgba(255,255,255,0.8)",
              opacity: meta,
              transform: `translateY(${(1 - meta) * 14}px)`,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {line}
          </div>
        ) : null}
      </div>
      {/* The row */}
      <div
        style={{
          position: "absolute",
          left: 120,
          bottom: 84,
          display: "flex",
          alignItems: "flex-end",
          gap: 26,
        }}
      >
        {tiles.map((t, i) => {
          const s = spring({
            frame: frame - (3 + i * 2),
            fps,
            config: SPRING.ENTER,
          });
          const focus = i === 0 ? grow : 0;
          return (
            <div
              key={i}
              style={{
                opacity: Math.min(1, s * 1.5),
                transform: `translateX(${(1 - s) * (260 + i * 40)}px)`,
                marginRight: i === 0 ? 10 * focus : 0,
              }}
            >
              <Tile
                pic={t.pic}
                label={t.label}
                size={196 + 84 * focus}
                focus={focus}
                sheen={i === 0 ? sheen : -100}
                tint={TINTS[(i + (p.variant ?? 0)) % TINTS.length]}
              />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

type TileRow = { main: string; sub?: string; score?: boolean };

/** Items as tiles in the home row, the focus ring stepping along them one by one. */
const TileRows: React.FC<{
  rows: TileRow[];
  head: string;
  sub: string;
  len: number;
}> = ({ rows, head, sub, len }) => {
  const n = rows.length;
  const { frame, fps, dim, visible, showFor } = useStage(len, 120 + n * 20);
  if (!visible || n < 2) return null;
  const step = Math.max(10, Math.min(30, (showFor - 56) / n));
  const at = (i: number) => 16 + i * step;
  const gap = 30;
  const w = Math.min(400, (1728 - 40 - (n - 1) * gap) / n);
  const h = rows[0]?.score ? 330 : 310;
  const rowBottom = 72 + 48;
  const longestScore = rows.reduce((a, r) => Math.max(a, r.main.length), 0);
  // One score size for the whole row, small enough for the longest score to fit its tile.
  const scoreSize = Math.min(
    sizeFor("x".repeat(longestScore), [
      [4, 124],
      [6, 104],
      [999, 80],
    ]),
    Math.floor((w - 52) / Math.max(1, longestScore * 0.46)),
  );
  const longest = rows.reduce((a, r) => Math.max(a, r.main.length), 0);
  const base = w >= 380 ? 46 : w >= 300 ? 40 : 34;
  const size = Math.max(30, base - (longest > 30 ? 8 : longest > 20 ? 4 : 0));
  const headIn = interpolate(frame, [3, 15], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  const total = n * w + (n - 1) * gap;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{ opacity: dim, backdropFilter: `blur(${4 * dim}px)` }}
      >
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, rgba(4,6,8,0.78) 0%, rgba(4,6,8,0.42) 55%, rgba(4,6,8,0.22) 100%)",
          }}
        />
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(0deg, rgba(4,6,8,0.92) 0%, rgba(4,6,8,0.7) 45%, rgba(4,6,8,0) 80%)",
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: dim }}>
        <div
          style={{
            position: "absolute",
            left: 96 + 20,
            right: 96,
            bottom: rowBottom + h + 56,
            opacity: headIn,
            transform: `translateY(${(1 - headIn) * 24}px)`,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: sizeFor(head, [
                [20, 92],
                [34, 74],
                [999, 60],
              ]),
              lineHeight: 1,
              letterSpacing: -1.5,
              color: "#ffffff",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {head}
          </div>
          {sub ? (
            <div
              style={{
                marginTop: 14,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 30,
                color: "rgba(255,255,255,0.78)",
              }}
            >
              {sub}
            </div>
          ) : null}
        </div>
        <div
          style={{
            position: "absolute",
            left: 96 + 20 + (1728 - 40 - total) / 2,
            bottom: rowBottom,
            display: "flex",
            alignItems: "flex-end",
            gap,
          }}
        >
          {rows.map((r, i) => {
            const s = spring({
              frame: frame - (4 + i * 3),
              fps,
              config: SPRING.ENTER,
            });
            const on = spring({ frame: frame - at(i), fps, config: FOCUS });
            const off =
              i < n - 1
                ? spring({ frame: frame - at(i + 1), fps, config: FOCUS })
                : 0;
            const focus = Math.max(0, on - off);
            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  width: w,
                  height: h,
                  borderRadius: 20,
                  overflow: "hidden",
                  flexShrink: 0,
                  opacity: Math.min(1, s * 1.5),
                  transform: `translateX(${(1 - s) * 220}px) translateY(${-14 * focus}px) scale(${1 + 0.07 * focus})`,
                  transformOrigin: "center bottom",
                  background: GLASS,
                  border: "1px solid rgba(255,255,255,0.16)",
                  outline: `${5 * focus}px solid rgba(255,255,255,${focus})`,
                  outlineOffset: 6,
                  boxShadow: `0 ${18 + 14 * focus}px ${40 + 30 * focus}px rgba(0,0,0,0.5), 0 0 ${50 * focus}px rgba(255,255,255,${0.25 * focus})`,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(255,255,255,0.14)",
                    opacity: Math.min(1, on),
                  }}
                />
                {r.score ? (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        left: 28,
                        top: 22,
                        right: 20,
                        fontFamily: DISPLAY,
                        fontSize: scoreSize,
                        lineHeight: 1,
                        color: "#ffffff",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.main}
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        left: 28,
                        right: 20,
                        bottom: 24,
                        fontFamily: BODY,
                        fontWeight: 800,
                        fontSize: 26,
                        lineHeight: 1.15,
                        letterSpacing: 1.5,
                        textTransform: "uppercase",
                        color: "rgba(255,255,255,0.84)",
                      }}
                    >
                      {r.sub}
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      position: "absolute",
                      left: 28,
                      right: 24,
                      bottom: 26,
                      fontFamily: BODY,
                      fontWeight: 900,
                      fontSize: size,
                      lineHeight: 1.06,
                      letterSpacing: -0.5,
                      color: "#ffffff",
                      overflowWrap: "break-word",
                    }}
                  >
                    {r.main}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TilesList: React.FC<GfxProps> = ({ g, len }) => (
  <TileRows
    rows={g.items
      .map(txt)
      .filter(Boolean)
      .slice(0, 6)
      .map((main) => ({ main }))}
    head={txt(g.primary)}
    sub={txt(g.secondary)}
    len={len}
  />
);

const TilesReviews: React.FC<GfxProps> = ({ g, len }) => (
  <TileRows
    rows={g.items
      .map(splitRow)
      .filter((x): x is { a: string; b: string } => Boolean(x))
      .slice(0, 6)
      .map((r) => ({ main: r.b, sub: r.a, score: true }))}
    head={txt(g.primary)}
    sub=""
    len={len}
  />
);

export const MODERN_STYLES: Record<string, GfxStyle> = {
  HomeTiles: {
    kind: "list",
    component: TilesList,
    fits: (g) => {
      const items = g.items.filter((x) => x.trim());
      return (
        items.length >= 2 &&
        items.length <= 6 &&
        items.every((x) => x.length <= 42) &&
        g.primary.length <= 50
      );
    },
    sound: "glint",
  },
  HomeReviews: {
    kind: "reviews",
    component: TilesReviews,
    fits: (g) => {
      const rows = g.items.map(splitRow).filter(Boolean) as Array<{
        a: string;
        b: string;
      }>;
      return (
        rows.length >= 2 &&
        rows.length <= 6 &&
        rows.length === g.items.length &&
        rows.every((r) => r.b.length <= 8 && r.a.length <= 24) &&
        g.primary.length <= 50
      );
    },
    sound: "glint",
  },
};
