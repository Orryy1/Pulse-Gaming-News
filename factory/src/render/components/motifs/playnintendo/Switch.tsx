// Nintendo Switch (2017 on) homage: the home screen. A row of large square tiles (the pictures), a bright
// focus outline gliding to the selected tile with the heading above it, round icons along the bottom and
// the year where the clock would be. The styles set a list or review scores out as the tile row. Built
// from scratch: generic glyphs and shapes only, no logo or real icon.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import { reviewRows } from "../../packs/data/figures.ts";
import type { MotifCardProps } from "../types.ts";
import { PulseBadge } from "../../packs/pulse/PulseBadge.tsx";
import {
  clamp,
  clean,
  easeInOut,
  fit,
  gameLine,
  lerp,
  lineClamp,
  longestWord,
  seeded,
  useCard,
} from "./shared.tsx";

type Theme = {
  bg: string;
  ink: string;
  sub: string;
  disc: string;
  line: string;
  title: string;
};
const DARK: Theme = {
  bg: "#2d2d2d",
  ink: "#ffffff",
  sub: "#c4c4c4",
  disc: "#454545",
  line: "rgba(255,255,255,0.14)",
  title: "#2fd8f5",
};
const LIGHT: Theme = {
  bg: "#ebebeb",
  ink: "#2d2d2d",
  sub: "#6e6e6e",
  disc: "#ffffff",
  line: "rgba(0,0,0,0.12)",
  title: "#0aa0c8",
};
const themeOf = (v: number) => (Math.abs(Math.floor(v)) % 2 ? LIGHT : DARK);

const HUES: Array<[string, string]> = [
  ["#ff6a5c", "#b3262f"],
  ["#ffb648", "#c4651a"],
  ["#4fb2ff", "#2257c4"],
  ["#73d97a", "#2a8a46"],
  ["#b896ff", "#6537c4"],
  ["#4fe0d0", "#1c8f91"],
];

/** The focus outline: a thick rounded frame whose colour breathes between cyan and blue. */
const Focus: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  frame: number;
  a: number;
}> = ({ x, y, w, h, frame, a }) => {
  const t = 0.5 + 0.5 * Math.sin(frame * 0.16);
  const c = `rgb(${Math.round(lerp(25, 70, t))},${Math.round(lerp(225, 150, t))},255)`;
  return (
    <div
      style={{
        position: "absolute",
        left: x - 13,
        top: y - 13,
        width: w + 26,
        height: h + 26,
        borderRadius: 12,
        border: `7px solid ${c}`,
        boxSizing: "border-box",
        boxShadow: `0 0 26px rgba(40,200,255,${0.55 * a}), inset 0 0 12px rgba(40,200,255,${0.35 * a})`,
        opacity: a,
      }}
    />
  );
};

/** Generic round shortcuts: simple shapes, each in its own colour. */
const RoundIcons: React.FC<{
  theme: Theme;
  y: number;
  frame: number;
  size?: number;
}> = ({ theme, y, frame, size = 104 }) => {
  const gap = 34;
  const n = 6;
  const left = 960 - (n * size + (n - 1) * gap) / 2;
  const cols = [
    "#ff5a4f",
    "#ff9f1c",
    "#3aa0ff",
    "#55c95a",
    "#a07cff",
    "#9e9e9e",
  ];
  const st = {
    fill: "none",
    strokeWidth: 6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const glyph = (i: number, c: string) => {
    switch (i) {
      case 0:
        return (
          <path
            d="M28 32 H72 A6 6 0 0 1 78 38 V60 A6 6 0 0 1 72 66 H48 L36 76 V66 H28 A6 6 0 0 1 22 60 V38 A6 6 0 0 1 28 32 Z"
            stroke={c}
            {...st}
          />
        );
      case 1:
        return (
          <path
            d="M28 28 H46 V46 H28 Z M54 28 H72 V46 H54 Z M28 54 H46 V72 H28 Z M54 54 H72 V72 H54 Z"
            stroke={c}
            {...st}
          />
        );
      case 2:
        return (
          <>
            <rect
              x={24}
              y={30}
              width={52}
              height={40}
              rx={5}
              stroke={c}
              {...st}
            />
            <path d="M30 64 L44 48 L54 58 L62 50 L72 64" stroke={c} {...st} />
          </>
        );
      case 3:
        return (
          <path
            d="M50 24 L57 41 L76 42 L61 54 L66 73 L50 62 L34 73 L39 54 L24 42 L43 41 Z"
            stroke={c}
            {...st}
          />
        );
      case 4:
        return (
          <path
            d="M26 34 H74 M26 50 H74 M26 66 H74 M40 28 V40 M60 44 V56 M34 60 V72"
            stroke={c}
            {...st}
          />
        );
      default:
        return (
          <path d="M36 34 A22 22 0 1 0 64 34 M50 24 V48" stroke={c} {...st} />
        );
    }
  };
  return (
    <>
      {cols.map((c, i) => {
        const a = interpolate(
          frame,
          [6 + i * 1.5, 14 + i * 1.5],
          [0, 1],
          clamp,
        );
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: left + i * (size + gap),
              top: y - size / 2 + (1 - a) * 20,
              width: size,
              height: size,
              borderRadius: size / 2,
              background: theme.disc,
              boxShadow: "0 4px 10px rgba(0,0,0,0.18)",
              opacity: a,
            }}
          >
            <svg width={size} height={size} viewBox="0 0 100 100">
              {glyph(i, c)}
            </svg>
          </div>
        );
      })}
    </>
  );
};

/** The top bar: three round user discs on the left, the year and a battery on the right. */
const TopBar: React.FC<{
  theme: Theme;
  year: string;
  y: number;
  frame: number;
  seed: number;
}> = ({ theme, year, y, frame, seed }) => {
  const a = interpolate(frame, [2, 12], [0, 1], clamp);
  const first = Math.floor(seeded(seed)() * HUES.length);
  return (
    <div
      style={{
        position: "absolute",
        left: 110,
        right: 110,
        top: y,
        height: 80,
        opacity: a,
      }}
    >
      {[0, 1, 2].map((i) => {
        const [c1, c2] = HUES[(first + i * 2) % HUES.length]!;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i * 96,
              top: 0,
              width: 80,
              height: 80,
              borderRadius: 40,
              background: `linear-gradient(150deg, ${c1}, ${c2})`,
              border: `4px solid ${theme.disc}`,
              boxSizing: "border-box",
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          height: 80,
          display: "flex",
          alignItems: "center",
          gap: 22,
        }}
      >
        {/* The Pulse badge leads the status corner, where the console's own name would sit. */}
        <PulseBadge
          size={36}
          colour={theme.ink}
          opacity={0.85}
          style={{ marginRight: 14 }}
        />
        {year ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 38,
              color: theme.ink,
            }}
          >
            {year}
          </div>
        ) : null}
        <div
          style={{
            width: 58,
            height: 28,
            borderRadius: 6,
            border: `3px solid ${theme.ink}`,
            padding: 3,
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 2,
              background: theme.ink,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -8,
              top: 7,
              width: 4,
              height: 10,
              borderRadius: 2,
              background: theme.ink,
            }}
          />
        </div>
      </div>
    </div>
  );
};

/** A tile: a picture, or a seeded colour with its contents. */
const Tile: React.FC<{
  size: number;
  src?: string;
  hue: [string, string];
  pos?: string;
  zoom?: number;
  shade?: number;
  /** Wash the picture in the tile's own colour, so a row cut from one picture still varies. */
  tint?: boolean;
  children?: React.ReactNode;
}> = ({ size, src, hue, pos, zoom = 1, shade = 0, tint, children }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 4,
      overflow: "hidden",
      position: "relative",
      background: `linear-gradient(150deg, ${hue[0]}, ${hue[1]})`,
      boxShadow: "0 6px 18px rgba(0,0,0,0.28)",
    }}
  >
    {src ? (
      <Img
        src={src}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: pos,
          transform: `scale(${zoom})`,
        }}
      />
    ) : null}
    {tint && src ? (
      <AbsoluteFill
        style={{
          background: `linear-gradient(150deg, ${hue[0]}, ${hue[1]})`,
          opacity: 0.62,
        }}
      />
    ) : null}
    {shade ? (
      <AbsoluteFill style={{ background: `rgba(0,0,0,${shade})` }} />
    ) : null}
    {children}
  </div>
);

/** The all-software tile at the end of the row: a small grid of squares. */
const AllTile: React.FC<{ size: number; theme: Theme }> = ({ size, theme }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 4,
      background: theme.disc,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
    }}
  >
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 34px)",
        gap: 12,
      }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          style={{
            width: 34,
            height: 34,
            borderRadius: 4,
            background: theme.sub,
            opacity: 0.8,
          }}
        />
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------------------------------
// The card.

const HomeCard: React.FC<MotifCardProps> = (props) => {
  const { frame, fps, len, fade } = useCard(props.frames);
  const variant = props.variant ?? 0;
  const theme = themeOf(variant);
  const heading = clean(props.heading);
  const kicker = clean(props.kicker);
  const year = clean(props.year);
  const game = clean(props.game);
  const pics = props.pictures.filter(Boolean).slice(0, 6);
  const T = 400;
  const GAP = 22;
  const X0 = 110;
  const ROW_Y = 356;
  // The focused tile shows the first picture; the row reads [second, first, third, ...].
  const order: Array<string | undefined> =
    pics.length >= 2
      ? [pics[1], pics[0], ...pics.slice(2)]
      : pics.length === 1
        ? [undefined, pics[0]]
        : [undefined, undefined];
  // A short library still fills the row: plain colour tiles after the pictures.
  while (order.length < 4) order.push(undefined);
  const sel = 1;
  const r = seeded(variant * 19 + 4);
  const hues = order.map(() => HUES[Math.floor(r() * HUES.length)]!);
  const drift = interpolate(frame, [0, len], [0, -24], clamp);
  const tileX = (i: number) => X0 + i * (T + GAP) + drift;
  const slide = spring({ frame, fps, config: SPRING.ENTER });
  const move = spring({
    frame: frame - 12,
    fps,
    config: { damping: 18, stiffness: 160, mass: 0.7 },
  });
  const fx = lerp(tileX(0), tileX(sel), sel ? move : 1);
  const focusIn = interpolate(frame, [6, 11], [0, 1], clamp);
  const bump = sel
    ? interpolate(frame, [20, 25, 32], [1, 1.035, 1.02], clamp)
    : interpolate(frame, [10, 15, 22], [1, 1.035, 1.02], clamp);
  const textIn = interpolate(frame, [20, 32], [0, 1], clamp);
  const kickIn = interpolate(frame, [16, 26], [0, 1], clamp);
  const headX = tileX(sel);
  const headW = 1920 - 96 - headX;
  const hSize = fit(heading, headW, 2, [70, 62, 54, 48], 0.56);
  const lines = Math.min(
    2,
    Math.max(1, Math.ceil((heading.length * hSize * 0.56) / headW)),
  );
  const sub = [kicker, gameLine(props)].filter(Boolean).join("  ·  ");
  return (
    <AbsoluteFill
      style={{ background: theme.bg, opacity: fade, overflow: "hidden" }}
    >
      <TopBar
        theme={theme}
        year={year}
        y={56}
        frame={frame}
        seed={variant + 2}
      />
      {/* The heading above the focused tile, the way the home screen names the selected software. */}
      <div
        style={{
          position: "absolute",
          left: headX,
          width: headW,
          bottom: 1080 - ROW_Y + 26,
          opacity: textIn,
          transform: `translateY(${(1 - textIn) * 14}px)`,
        }}
      >
        {sub ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 30,
              color: theme.sub,
              marginBottom: 6,
              opacity: kickIn,
              ...lineClamp(1),
            }}
          >
            {sub}
          </div>
        ) : null}
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: hSize,
            lineHeight: 1.08,
            color: theme.title,
            ...lineClamp(lines),
          }}
        >
          {heading}
        </div>
      </div>
      {[...order, "all"].map((src, i) => {
        const s = interpolate(frame, [i * 1.6, i * 1.6 + 6], [0, 1], clamp);
        const x = tileX(i);
        if (x > 2000) return null;
        const isSel = i === sel;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: ROW_Y,
              opacity: Math.min(1, s * 1.4),
              transform: `translateX(${(1 - slide) * 280}px) scale(${isSel ? bump : 1})`,
              zIndex: isSel ? 2 : 1,
            }}
          >
            {src === "all" ? (
              <AllTile size={T} theme={theme} />
            ) : (
              <Tile
                size={T}
                src={src}
                hue={hues[i]!}
                zoom={isSel ? 1 + 0.04 * (frame / len) : 1}
              >
                {!src && game && isSel ? (
                  <AbsoluteFill
                    style={{
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 34px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: DISPLAY,
                        fontSize: fit(game, T - 68, 3, [96, 80, 66, 56], 0.5),
                        lineHeight: 1.02,
                        color: "#ffffff",
                        textTransform: "uppercase",
                        textShadow: "0 4px 18px rgba(0,0,0,0.25)",
                        ...lineClamp(3),
                      }}
                    >
                      {game}
                    </div>
                  </AbsoluteFill>
                ) : null}
              </Tile>
            )}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: ROW_Y,
          transform: `scale(${bump})`,
          transformOrigin: `${fx + T / 2}px ${T / 2}px`,
          zIndex: 3,
        }}
      >
        <Focus
          x={fx + (1 - slide) * 280}
          y={0}
          w={T}
          h={T}
          frame={frame}
          a={focusIn}
        />
      </div>
      <RoundIcons theme={theme} y={872} frame={frame} />
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: 970,
          height: 2,
          background: theme.line,
        }}
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Styles: the row of tiles carries a list or review scores, the focus visiting each tile in turn.

const RowStyle: React.FC<{
  len: number;
  variant: number;
  year?: number;
  heading: string;
  tiles: (size: number, i: number, focus: number) => React.ReactNode;
  n: number;
}> = ({ len, variant, year, heading, tiles, n }) => {
  const { frame, fps, dim, visible } = useStage(len, 210);
  if (!visible) return null;
  const theme = themeOf(variant);
  const GAP = 22;
  const T = Math.min(380, Math.floor((1728 - (n - 1) * GAP) / n));
  const rowW = n * T + (n - 1) * GAP;
  const X0 = 960 - rowW / 2;
  const ROW_Y = 330 + Math.round((380 - T) / 2);
  const STEP = 20;
  const k = Math.max(0, (frame - 14) / STEP);
  const i0 = Math.min(n - 1, Math.floor(k));
  const pos =
    i0 >= n - 1 ? n - 1 : i0 + easeInOut(Math.min(1, ((k - i0) * STEP) / 8));
  const fx = X0 + pos * (T + GAP);
  const focusIn = interpolate(frame, [8, 14], [0, 1], clamp);
  const slide = spring({ frame, fps, config: SPRING.ENTER });
  const headIn = interpolate(frame, [4, 16], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{ opacity: dim, background: theme.bg, overflow: "hidden" }}
    >
      <TopBar
        theme={theme}
        year={year ? String(year) : ""}
        y={140}
        frame={frame}
        seed={variant + 5}
      />
      {heading ? (
        <div
          style={{
            position: "absolute",
            left: X0,
            right: 96,
            bottom: 1080 - ROW_Y + 24,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: fit(heading, 1920 - 96 - X0, 1, [60, 52, 46], 0.56),
            color: theme.title,
            opacity: headIn,
            transform: `translateY(${(1 - headIn) * 12}px)`,
            ...lineClamp(1),
          }}
        >
          {heading}
        </div>
      ) : null}
      {Array.from({ length: n }, (_, i) => {
        const s = interpolate(frame, [2 + i * 2, 8 + i * 2], [0, 1], clamp);
        const fo = Math.max(0, 1 - Math.abs(pos - i)) * focusIn;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: X0 + i * (T + GAP),
              top: ROW_Y,
              opacity: Math.min(1, s * 1.4),
              transform: `translateX(${(1 - slide) * 260}px) scale(${1 + 0.03 * fo})`,
              zIndex: fo > 0.5 ? 2 : 1,
            }}
          >
            {tiles(T, i, fo)}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 0, top: ROW_Y, zIndex: 3 }}>
        <Focus
          x={fx + (1 - slide) * 260}
          y={0}
          w={T}
          h={T}
          frame={frame}
          a={focusIn}
        />
      </div>
      <RoundIcons theme={theme} y={900} frame={frame} size={92} />
    </AbsoluteFill>
  );
};

export function fitsHome(g: MomentGraphic): boolean {
  const items = g.items.map(clean).filter(Boolean);
  return (
    items.length >= 2 &&
    items.length <= 5 &&
    items.length === g.items.length &&
    items.every((x) => x.length <= 32 && longestWord(x) <= 13) &&
    clean(g.primary).length <= 40
  );
}

const Home: React.FC<GfxProps> = ({ g, len, src, variant = 0, year }) => {
  const items = g.items.map(clean).filter(Boolean).slice(0, 5);
  const r = seeded(variant * 23 + 9);
  const looks = items.map(() => ({
    hue: HUES[Math.floor(r() * HUES.length)]!,
    pos: `${15 + Math.floor(r() * 70)}% ${20 + Math.floor(r() * 60)}%`,
    zoom: 1.2 + r() * 0.8,
  }));
  if (items.length < 2) return null;
  return (
    <RowStyle
      len={len}
      variant={variant}
      year={year}
      heading={clean(g.primary)}
      n={items.length}
      tiles={(size, i) => {
        const t = items[i]!;
        const fs = fit(t, size - 56, 3, [44, 40, 36, 32], 0.58);
        return (
          <Tile
            size={size}
            src={src}
            hue={looks[i]!.hue}
            pos={looks[i]!.pos}
            zoom={looks[i]!.zoom}
            shade={src ? 0.3 : 0.1}
            tint
          >
            <AbsoluteFill
              style={{
                alignItems: "center",
                justifyContent: "center",
                padding: "0 28px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: fs,
                  lineHeight: 1.1,
                  color: "#ffffff",
                  textShadow: "0 3px 14px rgba(0,0,0,0.55)",
                  ...lineClamp(3),
                }}
              >
                {t}
              </div>
            </AbsoluteFill>
          </Tile>
        );
      }}
    />
  );
};

export function fitsHomeReviews(g: MomentGraphic): boolean {
  const rows = reviewRows(g.items);
  return (
    rows.length >= 2 &&
    rows.length <= 6 &&
    rows.length === g.items.filter((x) => x.trim()).length &&
    rows.every(
      (r) =>
        r.outlet.length <= 18 &&
        r.score.length <= 8 &&
        longestWord(r.outlet) <= 12,
    ) &&
    clean(g.primary).length <= 40
  );
}

const HomeReviews: React.FC<GfxProps> = ({ g, len, variant = 0, year }) => {
  const rows = reviewRows(g.items).slice(0, 6);
  const r = seeded(variant * 29 + 3);
  const hues = rows.map(() => HUES[Math.floor(r() * HUES.length)]!);
  if (rows.length < 2) return null;
  return (
    <RowStyle
      len={len}
      variant={variant}
      year={year}
      heading={clean(g.primary)}
      n={rows.length}
      tiles={(size, i) => {
        const row = rows[i]!;
        const big = Math.round(
          size *
            (row.score.length > 5 ? 0.3 : row.score.length > 3 ? 0.38 : 0.46),
        );
        return (
          <Tile size={size} hue={hues[i]!}>
            <AbsoluteFill
              style={{
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                paddingBottom: size * 0.12,
              }}
            >
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: big,
                  lineHeight: 1,
                  color: "#ffffff",
                  textShadow: "0 4px 18px rgba(0,0,0,0.3)",
                  whiteSpace: "nowrap",
                }}
              >
                {row.score}
              </div>
            </AbsoluteFill>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                padding: "14px 16px",
                background: "rgba(0,0,0,0.28)",
                textAlign: "center",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: size > 300 ? 30 : 26,
                letterSpacing: 2,
                color: "#ffffff",
                textTransform: "uppercase",
                ...lineClamp(1),
              }}
            >
              {row.outlet}
            </div>
          </Tile>
        );
      }}
    />
  );
};

export const SWITCH_CARD = HomeCard;
export const SWITCH_STYLES: Record<string, GfxStyle> = {
  /** list: primary a heading, items 2-5 short lines (32 characters at most); each a tile the focus visits. */
  Home: { kind: "list", component: Home, fits: fitsHome, sound: "glint" },
  /** reviews: primary a heading, items 2-6 "Outlet: score" rows; each score a tile the focus visits. */
  HomeReviews: {
    kind: "reviews",
    component: HomeReviews,
    fits: fitsHomeReviews,
    sound: "glint",
  },
};
