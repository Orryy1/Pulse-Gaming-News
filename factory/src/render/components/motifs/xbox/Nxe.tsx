// The Xbox 360's second look (2008-2011), in homage to the New Xbox Experience: a carousel of tiles
// in perspective receding into depth, the front one large, a list of channels down the side and soft
// streaks of light sweeping behind. Built from scratch; every word comes from props or a generic label.
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
import { ease } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MotifCardProps } from "../types.ts";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import { PulseBadge } from "../../packs/pulse/PulseBadge.tsx";
import {
  cardFade,
  clamp,
  fitLabel,
  sizeFor,
  splitRow,
  txt,
  uniq,
} from "./util.ts";

const TURN = { damping: 18, stiffness: 95, mass: 0.9 } as const;
const MINT = "#c4f79a";

/** Where a tile sits for a carousel position s (0 front, 1.. behind to the right, below 0 gone left). */
function slot(s: number, W: number) {
  if (s <= 0)
    return {
      x: s * (W + 120),
      z: 0,
      ry: -s * 14,
      o: interpolate(s, [-0.7, 0], [0, 1], clamp),
      shade: 0,
    };
  // Behind the front tile each one turns its far edge away, stacking into depth toward the right.
  if (s <= 1)
    return {
      x: s * W * 0.7,
      z: -s * 420,
      ry: s * 28,
      o: 1,
      shade: s * 0.3,
    };
  return {
    x: W * 0.7 + (s - 1) * 120,
    z: -420 - (s - 1) * 300,
    ry: 28,
    o: interpolate(s, [3.8, 4.8], [1, 0], clamp),
    shade: Math.min(0.72, 0.3 + (s - 1) * 0.12),
  };
}

/** Dark green depth with soft streaks of light drifting across and a glossy floor. */
const Streaks: React.FC<{ frame: number; strength?: number }> = ({
  frame,
  strength = 1,
}) => {
  const drift = -frame * 1.4;
  const run = (frame * 4) % 1000;
  const lines = [
    {
      d: "M -240 760 C 300 560, 800 880, 1320 600 S 1900 340, 2240 460",
      w: 170,
      c: "rgba(160,255,120,0.16)",
    },
    {
      d: "M -240 830 C 400 700, 900 960, 1420 700 S 2000 520, 2240 560",
      w: 64,
      c: "rgba(200,255,170,0.22)",
    },
    {
      d: "M -240 300 C 400 110, 1000 380, 1520 160 S 2000 40, 2240 90",
      w: 130,
      c: "rgba(150,240,120,0.09)",
    },
  ];
  const threads = [
    {
      d: "M -240 712 C 260 520, 820 828, 1330 566 S 1920 296, 2240 396",
      c: "rgba(225,255,210,0.75)",
      w: 3,
    },
    {
      d: "M -240 868 C 420 740, 920 990, 1430 736 S 2010 560, 2240 600",
      c: "rgba(200,255,170,0.5)",
      w: 2,
    },
    {
      d: "M -240 352 C 400 170, 1000 430, 1520 220 S 2000 100, 2240 150",
      c: "rgba(210,255,190,0.45)",
      w: 2,
    },
    {
      d: "M -240 250 C 360 70, 960 330, 1480 110 S 2000 0, 2240 40",
      c: "rgba(210,255,190,0.25)",
      w: 1.5,
    },
  ];
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 75% 65% at 60% 40%, #21452a 0%, #10261a 44%, #07100b 78%, #040806 100%)",
        }}
      />
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0, opacity: strength }}
      >
        <g
          transform={`translate(${drift} 0)`}
          fill="none"
          strokeLinecap="round"
        >
          {lines.map((l, i) => (
            <path key={i} d={l.d} stroke={l.c} strokeWidth={l.w} />
          ))}
          {threads.map((l, i) => (
            <path key={`t${i}`} d={l.d} stroke={l.c} strokeWidth={l.w} />
          ))}
          {threads.map((l, i) => (
            <path
              key={`p${i}`}
              d={l.d}
              pathLength={1000}
              stroke="#f4ffe8"
              strokeWidth={l.w + 2}
              strokeDasharray="70 930"
              strokeDashoffset={-(run + i * 250)}
              opacity={0.8}
            />
          ))}
        </g>
      </svg>
      {/* The floor: a horizon of light, darker below */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 884,
          bottom: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.6))",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 883,
          height: 2,
          background:
            "linear-gradient(90deg, rgba(180,255,150,0) 0%, rgba(180,255,150,0.35) 40%, rgba(180,255,150,0) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

/** A tile: its picture (and which part of it shows), or a generic label. */
type Tile = { pic?: string; pos?: string; label?: string };

const TileFace: React.FC<{
  t: Tile;
  W: number;
  H: number;
  front: number;
  frame: number;
  i: number;
}> = ({ t, W, H, front, frame, i }) => (
  <div
    style={{
      position: "relative",
      width: W,
      height: H,
      borderRadius: 10,
      overflow: "hidden",
      background: t.pic
        ? "#0b1a10"
        : i % 2
          ? "linear-gradient(150deg, #e9efec 0%, #b8c4c0 55%, #7f8e8a 100%)"
          : "linear-gradient(150deg, #9be35a 0%, #4f9e24 50%, #1f4d10 100%)",
      boxShadow: `0 0 0 ${2 + 2 * front}px rgba(230,255,215,${0.45 + 0.5 * front}), 0 0 ${60 * front}px rgba(150,255,100,${0.4 * front}), 0 30px 60px rgba(0,0,0,0.55)`,
    }}
  >
    {t.pic ? (
      <Img
        src={t.pic}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: t.pos ?? "center",
          transform: `scale(${1.1 - 0.06 * front - 0.0003 * frame})`,
        }}
      />
    ) : (
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: 4 }, (_, k) => (
          <path
            key={k}
            d={`M -20 ${H * (0.55 + k * 0.12)} C ${W * 0.3} ${H * (0.3 + k * 0.1)}, ${W * 0.6} ${H * (0.85 + k * 0.05)}, ${W + 20} ${H * (0.45 + k * 0.1)}`}
            stroke="#ffffff"
            strokeOpacity={0.22 - k * 0.04}
            strokeWidth={10 - k * 2}
            fill="none"
          />
        ))}
      </svg>
    )}
    {/* Glass */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(165deg, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.05) 34%, rgba(255,255,255,0) 35%)",
      }}
    />
  </div>
);

/** A carousel of tiles in perspective; `turn` brings tile k to the front when it equals k. */
const Carousel: React.FC<{
  tiles: Tile[];
  turn: number;
  W: number;
  H: number;
  frame: number;
  /** What tile k shows on its face; f is 1 when it is the front tile. */
  front: (k: number, f: number) => React.ReactNode;
}> = ({ tiles, turn, W, H, frame, front }) => (
  <>
    {tiles
      .map((t, k) => ({ t, k, s: k - turn }))
      .filter((x) => x.s > -0.8 && x.s < 4.8)
      .sort((a, b) => b.s - a.s)
      .map(({ t, k, s }) => {
        const p = slot(s, W);
        const f = interpolate(Math.abs(s), [0, 0.6], [1, 0], clamp);
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: W,
              height: H,
              opacity: p.o,
              transform: `translate3d(${p.x}px, 0, ${p.z}px) rotateY(${p.ry}deg)`,
              transformOrigin: "left center",
            }}
          >
            {/* The face and its shade are mirrored on the floor; the words on it are not */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                WebkitBoxReflect:
                  "below 14px linear-gradient(transparent 68%, rgba(255,255,255,0.22))",
              }}
            >
              <TileFace t={t} W={W} H={H} front={f} frame={frame} i={k} />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 10,
                  background: "#020604",
                  opacity: p.shade,
                }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 10,
                overflow: "hidden",
                opacity: 1 - p.shade * 0.85,
              }}
            >
              {front(k, f) ??
                (t.label ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 34,
                      bottom: 26,
                      fontFamily: BODY,
                      fontWeight: 900,
                      fontSize: 44,
                      letterSpacing: 2,
                      color: k % 2 ? "#2a3430" : "#ffffff",
                    }}
                  >
                    {t.label}
                  </div>
                ) : null)}
            </div>
          </div>
        );
      })}
  </>
);

/** Channels down the left, the chosen one big, the list scrolling up into place. */
const Channels: React.FC<{
  labels: string[];
  sel: number;
  scroll: number;
  top: number;
  width: number;
  bigSize: number;
  smallSize: number;
  rowGap: number;
}> = ({ labels, sel, scroll, top, width, bigSize, smallSize, rowGap }) => (
  <div style={{ position: "absolute", left: 96, top, width }}>
    {labels.map((l, i) => {
      const d = i - sel + scroll;
      const isSel = Math.abs(d) < 0.5;
      const near = 1 - Math.min(1, Math.abs(d));
      // Rows part around the big chosen one, smoothly, so nothing jumps as the list settles.
      const y =
        d * rowGap +
        Math.sign(d) *
          Math.min(1, Math.abs(d)) *
          (d > 0 ? bigSize * 0.5 + 10 : bigSize * 0.2);
      const size = smallSize + (bigSize - smallSize) * near;
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            top: y,
            width,
            transform: "translateY(-50%)",
            fontFamily: BODY,
            fontWeight: isSel ? 900 : 800,
            fontSize: size,
            lineHeight: 1.05,
            letterSpacing: isSel ? 0 : 1.5,
            textTransform: "uppercase",
            color: isSel ? "#ffffff" : MINT,
            opacity: interpolate(
              Math.abs(d),
              [0, 1, 2.6, 3.6],
              [1, 0.55, 0.22, 0],
              clamp,
            ),
            textShadow: isSel ? "0 0 24px rgba(150,255,100,0.55)" : "none",
            whiteSpace: "normal",
          }}
        >
          {l}
        </div>
      );
    })}
  </div>
);

/** The Pulse badge in the top right corner, where the dashboard named the console. */
const NxeBadge: React.FC<{ frame: number }> = ({ frame }) => (
  <PulseBadge
    size={38}
    colour={MINT}
    opacity={0.85 * interpolate(frame, [4, 16], [0, 1], clamp)}
    style={{
      position: "absolute",
      right: 96,
      top: 66,
      filter: "drop-shadow(0 0 14px rgba(150,255,100,0.4))",
    }}
  />
);

/** The opening title or chapter breather as the 2008 dashboard: the carousel turns to the heading. */
export const NxeCard: React.FC<MotifCardProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = cardFade(frame, p.frames);
  const heading = txt(p.heading);
  const kicker = txt(p.kicker);
  const game = txt(p.game);
  const year = txt(p.year);
  const sel = kicker || "GAMES";
  const below = uniq([
    game && game.toLowerCase() !== heading.toLowerCase() ? game : "",
    "GAMES",
    "MEDIA",
    "SYSTEM",
  ]).filter((x) => x.toLowerCase() !== sel.toLowerCase());
  const labels = ["HOME", sel, ...below.slice(0, 3)];
  const generic = ["MEDIA", "GAMES", "SYSTEM", "HOME"];
  const tiles: Tile[] = p.pictures.slice(0, 6).map((pic) => ({ pic }));
  // Empty slots become plain tiles with generic labels; the front one stays clear for the title.
  for (let i = 0; tiles.length < 5; i++)
    tiles.push({
      label: tiles.length ? generic[i % generic.length] : undefined,
    });
  const turn = -2.6 * (1 - spring({ frame: frame - 1, fps, config: TURN }));
  const scroll = 2 * (1 - spring({ frame: frame - 3, fps, config: TURN }));
  const W = 960;
  const H = 540;
  const rise = interpolate(frame, [14, 28], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  const meta = [
    game && game.toLowerCase() !== heading.toLowerCase() ? game : "",
    year,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const headSize = sizeFor(heading, [
    [16, 76],
    [28, 64],
    [44, 54],
    [999, 44],
  ]);
  return (
    <AbsoluteFill
      style={{ background: "#040806", opacity: fade, overflow: "hidden" }}
    >
      <Streaks frame={frame} />
      <NxeBadge frame={frame} />
      <Channels
        labels={labels}
        sel={1}
        scroll={scroll}
        top={320}
        width={400}
        bigSize={fitLabel(sel, 396, 58, 34, 0.76)}
        smallSize={30}
        rowGap={62}
      />
      <div
        style={{
          position: "absolute",
          left: 540,
          top: 200,
          width: 1380,
          height: 760,
          perspective: 1800,
          perspectiveOrigin: "68% 40%",
        }}
      >
        {/* Light pooled on the floor under the front tile */}
        <div
          style={{
            position: "absolute",
            left: W * 0.5 - 520,
            top: H + 40,
            width: 1040,
            height: 200,
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(170,255,130,0.28) 0%, rgba(170,255,130,0) 70%)",
            opacity: interpolate(turn, [-1, 0], [0, 1], clamp),
          }}
        />
        <Carousel
          tiles={tiles}
          turn={turn}
          W={W}
          H={H}
          frame={frame}
          front={(k, f) =>
            k === 0 && f > 0.01 ? (
              <div style={{ position: "absolute", inset: 0, opacity: f }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: tiles[0]?.pic
                      ? "linear-gradient(0deg, rgba(3,10,5,0.92) 0%, rgba(3,10,5,0.6) 34%, rgba(3,10,5,0) 62%)"
                      : "linear-gradient(0deg, rgba(3,10,5,0.55) 0%, rgba(3,10,5,0) 60%)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 40,
                    right: 40,
                    bottom: 32,
                  }}
                >
                  {meta ? (
                    <div style={{ overflow: "hidden" }}>
                      <div
                        style={{
                          fontFamily: BODY,
                          fontWeight: 800,
                          fontSize: 28,
                          letterSpacing: 2,
                          color: MINT,
                          textTransform: "uppercase",
                          transform: `translateY(${(1 - rise) * 110}%)`,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {meta}
                      </div>
                    </div>
                  ) : null}
                  <div
                    style={{
                      overflow: "hidden",
                      marginTop: 4,
                      paddingBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: BODY,
                        fontWeight: 900,
                        fontSize: headSize,
                        lineHeight: 1.04,
                        letterSpacing: -0.5,
                        color: "#ffffff",
                        textShadow: "0 4px 24px rgba(0,0,0,0.6)",
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
                </div>
              </div>
            ) : null
          }
        />
      </div>
    </AbsoluteFill>
  );
};

type Row = { side: string; big?: string; text: string };

/** Rows as tiles on the carousel; it turns to each in turn while the side list follows. */
const CarouselRows: React.FC<{
  rows: Row[];
  head: string;
  len: number;
  src?: string;
  timeline: boolean;
}> = ({ rows, head, len, src, timeline }) => {
  const n = rows.length;
  const { frame, fps, dim, visible, showFor } = useStage(len, 90 + n * 40);
  if (!visible || n < 2) return null;
  const step = Math.max(14, Math.min(44, (showFor - 50) / n));
  const T = (i: number) => 14 + i * step;
  let turn = -2.2 * (1 - spring({ frame, fps, config: TURN }));
  for (let i = 1; i < n; i++)
    turn += spring({ frame: frame - T(i), fps, config: TURN });
  const W = 820;
  const H = 462;
  const cur = Math.max(0, Math.min(n - 1, Math.round(turn)));
  // One picture across every tile: each shows a different part of it so the stack never repeats.
  const crops = ["50% 50%", "18% 40%", "82% 60%", "35% 75%", "65% 25%"];
  const tiles: Tile[] = rows.map((_, i) => ({
    pic: src,
    pos: crops[i % crops.length],
  }));
  const longest = rows.reduce((a, r) => Math.max(a, r.text.length), 0);
  const textSize = timeline
    ? sizeFor("x".repeat(longest), [
        [18, 54],
        [30, 46],
        [999, 40],
      ])
    : sizeFor("x".repeat(longest), [
        [14, 68],
        [24, 58],
        [34, 50],
        [999, 44],
      ]);
  const headIn = interpolate(frame, [4, 16], [0, 1], {
    ...clamp,
    easing: ease.out,
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: dim }}>
      <AbsoluteFill style={{ opacity: 0.94 }}>
        <Streaks frame={frame} strength={0.85} />
      </AbsoluteFill>
      <NxeBadge frame={frame} />
      {head ? (
        <div
          style={{
            position: "absolute",
            left: 96,
            right: 96,
            top: 130,
            opacity: headIn,
            transform: `translateY(${(1 - headIn) * -20}px)`,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: sizeFor(head, [
                [26, 50],
                [999, 42],
              ]),
              color: "#ffffff",
              textTransform: "uppercase",
              letterSpacing: 1,
              textShadow: "0 0 26px rgba(150,255,100,0.4)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {head}
          </div>
          <div
            style={{
              marginTop: 10,
              height: 4,
              width: 220 * headIn,
              borderRadius: 2,
              background:
                "linear-gradient(90deg, #b6f27a, rgba(182,242,122,0))",
            }}
          />
        </div>
      ) : null}
      <Channels
        labels={rows.map((r) => r.side)}
        sel={cur}
        scroll={cur - turn}
        top={560}
        width={420}
        bigSize={timeline ? 64 : 40}
        smallSize={timeline ? 34 : 28}
        rowGap={timeline ? 70 : 76}
      />
      <div
        style={{
          position: "absolute",
          left: 600,
          top: 290,
          width: 1320,
          height: 700,
          perspective: 1800,
          perspectiveOrigin: "68% 40%",
        }}
      >
        <Carousel
          tiles={tiles}
          turn={turn}
          W={W}
          H={H}
          frame={frame}
          front={(k, f) => {
            const r = rows[k];
            if (!r) return null;
            return (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: src
                    ? "linear-gradient(0deg, rgba(3,12,6,0.94) 0%, rgba(3,12,6,0.72) 50%, rgba(3,12,6,0.35) 100%)"
                    : "linear-gradient(0deg, rgba(3,12,6,0.5) 0%, rgba(3,12,6,0.15) 70%)",
                }}
              >
                {r.big ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 40,
                      top: 26,
                      fontFamily: DISPLAY,
                      fontSize: 150,
                      lineHeight: 1,
                      color: MINT,
                      textShadow: `0 0 ${40 * f}px rgba(150,255,100,0.45)`,
                    }}
                  >
                    {r.big}
                  </div>
                ) : null}
                <div
                  style={{
                    position: "absolute",
                    left: 40,
                    right: 40,
                    bottom: 34,
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: textSize,
                    lineHeight: 1.06,
                    color: "#ffffff",
                    textShadow: "0 4px 20px rgba(0,0,0,0.6)",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {r.text}
                </div>
              </div>
            );
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const YEAR = /\b(19|20)\d\d\b/;

function timelineRows(items: string[]): Row[] {
  return items
    .map((x): Row | undefined => {
      const r = splitRow(x);
      const year = (r?.a ?? x).match(YEAR)?.[0];
      if (!year) return undefined;
      const text = r
        ? r.a === year
          ? r.b
          : `${r.a}: ${r.b}`
        : txt(x.replace(year, "").replace(/^[\s:,-]+/, ""));
      return text ? { side: year, big: year, text } : undefined;
    })
    .filter((x): x is Row => Boolean(x));
}

const CarouselTimeline: React.FC<GfxProps> = ({ g, len, src }) => (
  <CarouselRows
    rows={timelineRows(g.items).slice(0, 5)}
    head={txt(g.primary)}
    len={len}
    src={src}
    timeline
  />
);

const CarouselList: React.FC<GfxProps> = ({ g, len, src }) => (
  <CarouselRows
    rows={g.items
      .map(txt)
      .filter(Boolean)
      .slice(0, 5)
      .map((t) => ({ side: t, text: t }))}
    head={txt(g.primary)}
    len={len}
    src={src}
    timeline={false}
  />
);

export const NXE_STYLES: Record<string, GfxStyle> = {
  Carousel: {
    kind: "timeline",
    component: CarouselTimeline,
    fits: (g) => {
      const rows = timelineRows(g.items);
      return (
        rows.length >= 2 &&
        rows.length <= 5 &&
        rows.length === g.items.length &&
        rows.every((r) => r.text.length <= 46) &&
        g.primary.length <= 44
      );
    },
    sound: "pop",
  },
  CarouselList: {
    kind: "list",
    component: CarouselList,
    fits: (g) => {
      const items = g.items.filter((x) => x.trim());
      return (
        items.length >= 2 &&
        items.length <= 5 &&
        items.every((x) => x.length <= 40) &&
        g.primary.length <= 44
      );
    },
    sound: "pop",
  },
};
