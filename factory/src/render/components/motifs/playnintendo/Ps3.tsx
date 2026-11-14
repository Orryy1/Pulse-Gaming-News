// PlayStation 3 and PSP (2005-2013) homage: a cross media bar. A soft gradient with a flowing ribbon of
// light lines, a horizontal row of category glyphs (generic words: GAME, VIDEO, MUSIC, SETTINGS or the
// kicker) crossed by a vertical list with the heading selected and glowing. The style runs a list down
// that vertical, the selection moving from item to item. Glyphs are simple generic drawings.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring } from "remotion";
import { BODY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { MomentGraphic } from "../../LongMoments.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import { PulseBadge } from "../../packs/pulse/PulseBadge.tsx";
import {
  clamp,
  clean,
  easeInOut,
  fit,
  gameLine,
  glowRoom,
  lineClamp,
  longestWord,
  seeded,
  useCard,
} from "./shared.tsx";

const THEMES: Array<[string, string, string]> = [
  ["#3f7be0", "#1b3d98", "#0a1848"],
  ["#2aa3a6", "#136470", "#06262e"],
  ["#8a5cd8", "#4a2a94", "#1b0e44"],
  ["#4f9c44", "#28622a", "#0d2711"],
  ["#d0873c", "#87481c", "#321607"],
  ["#c44d6c", "#77203d", "#2c0a18"],
];
const themeOf = (variant: number) =>
  THEMES[
    ((Math.floor(variant) % THEMES.length) + THEMES.length) % THEMES.length
  ]!;

const Backdrop: React.FC<{ variant: number; frame: number }> = ({
  variant,
  frame,
}) => {
  const [a, b, c] = themeOf(variant);
  const ph = frame * 0.035 + (variant % 7) * 0.9;
  const line = (i: number, amp = 1) => {
    const pts: string[] = [];
    for (let x = -40; x <= 1960; x += 32) {
      const y =
        650 +
        amp * 72 * Math.sin(x * 0.0027 + ph + i * 0.1) +
        amp * 38 * Math.sin(x * 0.0063 - ph * 1.3 + i * 0.23) +
        (i - 4) * 8 * (1 + 0.6 * Math.sin(x * 0.0021 + ph * 0.7));
      pts.push(`${x},${y.toFixed(1)}`);
    }
    return pts;
  };
  const lines = Array.from({ length: 9 }, (_, i) => line(i));
  const top = lines[0]!;
  const bottom = lines[8]!;
  const ribbon = `M${top.join(" L")} L${[...bottom].reverse().join(" L")} Z`;
  const upper = line(-6, 0.7);
  const lower = line(-1, 0.7);
  const ribbon2 = `M${upper.join(" L")} L${[...lower].reverse().join(" L")} Z`;
  return (
    <>
      <AbsoluteFill
        style={{
          background: `linear-gradient(168deg, ${a} 0%, ${b} 46%, ${c} 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(70% 60% at 22% 18%, rgba(255,255,255,0.2) 0%, transparent 70%)",
        }}
      />
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <linearGradient id={`xmbr${variant}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity={0.02} />
            <stop offset="0.5" stopColor="#fff" stopOpacity={0.12} />
            <stop offset="1" stopColor="#fff" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <path d={ribbon2} fill={`url(#xmbr${variant})`} opacity={0.6} />
        <path d={ribbon} fill={`url(#xmbr${variant})`} />
        {lines.map((p, i) => (
          <polyline
            key={i}
            points={p.join(" ")}
            fill="none"
            stroke="#fff"
            strokeOpacity={0.1 + 0.32 * (1 - Math.abs(i - 4) / 4)}
            strokeWidth={i === 4 ? 2.6 : 1.4}
          />
        ))}
        <polyline
          points={lines[4]!.join(" ")}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.07}
          strokeWidth={12}
        />
      </svg>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 100% at 50% 50%, transparent 60%, rgba(0,0,0,0.35) 100%)",
        }}
      />
    </>
  );
};

type GlyphKind =
  | "settings"
  | "photo"
  | "music"
  | "video"
  | "game"
  | "disc"
  | "network";

/** Simple, generic line drawings for the categories. */
const Glyph: React.FC<{ kind: GlyphKind; size: number; glow?: number }> = ({
  kind,
  size,
  glow = 0,
}) => {
  const s = {
    fill: "none",
    stroke: "#fff",
    strokeWidth: 5.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{
        display: "block",
        overflow: "visible",
        filter: glow
          ? `drop-shadow(0 0 ${10 * glow}px rgba(255,255,255,${0.8 * glow}))`
          : undefined,
      }}
    >
      {kind === "settings" ? (
        <>
          <rect x={16} y={40} width={68} height={40} rx={7} {...s} />
          <path d="M38 40 V29 H62 V40 M16 57 H84" {...s} />
        </>
      ) : kind === "photo" ? (
        <>
          <rect x={14} y={22} width={72} height={56} rx={7} {...s} />
          <path d="M22 70 L41 49 L54 61 L64 52 L78 70" {...s} />
          <circle cx={66} cy={37} r={6} {...s} />
        </>
      ) : kind === "music" ? (
        <>
          <path d="M40 70 V28 L76 20 V62" {...s} />
          <circle cx={32} cy={70} r={9} fill="#fff" />
          <circle cx={68} cy={62} r={9} fill="#fff" />
        </>
      ) : kind === "video" ? (
        <>
          <rect x={12} y={24} width={76} height={52} rx={8} {...s} />
          <path
            d="M43 38 L62 50 L43 62 Z"
            fill="#fff"
            stroke="#fff"
            strokeWidth={3}
            strokeLinejoin="round"
          />
        </>
      ) : kind === "disc" ? (
        <>
          <circle cx={50} cy={50} r={33} {...s} />
          <circle cx={50} cy={50} r={9} {...s} />
          <path d="M50 26 A24 24 0 0 1 74 50" {...s} strokeOpacity={0.6} />
        </>
      ) : kind === "game" ? (
        <>
          <path
            d="M27 38 H73 A15 15 0 0 1 88 53 V58 A11 11 0 0 1 69 66 L63 60 H37 L31 66 A11 11 0 0 1 12 58 V53 A15 15 0 0 1 27 38 Z"
            {...s}
          />
          <path d="M25 50 H37 M31 44 V56" {...s} />
          <circle cx={66} cy={47} r={3.6} fill="#fff" />
          <circle cx={74} cy={54} r={3.6} fill="#fff" />
        </>
      ) : (
        <>
          <circle cx={50} cy={50} r={33} {...s} />
          <ellipse cx={50} cy={50} rx={14} ry={33} {...s} />
          <path d="M17 50 H83 M23 34 H77 M23 66 H77" {...s} />
        </>
      )}
    </svg>
  );
};

type Cat = { kind: GlyphKind; label: string };

/** The category row: generic categories either side, the selected one (the kicker, or GAME) at `selX`. */
function categories(selected: string): { cats: Cat[]; sel: number } {
  const left: Cat[] = [
    { kind: "settings", label: "SETTINGS" },
    { kind: "photo", label: "PHOTO" },
    { kind: "music", label: "MUSIC" },
    { kind: "video", label: "VIDEO" },
  ];
  const isGame = !selected || selected.toUpperCase() === "GAME";
  const right: Cat[] = isGame
    ? [{ kind: "network", label: "NETWORK" }]
    : [
        { kind: "game", label: "GAME" },
        { kind: "network", label: "NETWORK" },
      ];
  return {
    cats: [
      ...left,
      { kind: isGame ? "game" : "disc", label: isGame ? "GAME" : selected },
      ...right,
    ],
    sel: left.length,
  };
}

const CategoryRow: React.FC<{
  selected: string;
  selX: number;
  y: number;
  frame: number;
  fps: number;
  gap?: number;
}> = ({ selected, selX, y, frame, fps, gap = 220 }) => {
  const { cats, sel } = categories(selected);
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const shift = (1 - enter) * 520;
  const settle = spring({ frame: frame - 6, fps, config: SPRING.POP });
  return (
    <>
      {cats.map((c, i) => {
        const isSel = i === sel;
        const size = isSel ? 92 + 22 * settle : 76;
        const x = selX + (i - sel) * gap + shift;
        if (x < -120 || x > 2040) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              opacity: (isSel ? 1 : 0.6) * enter,
            }}
          >
            <Glyph kind={c.kind} size={size} glow={isSel ? settle : 0} />
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: selX - 400,
          width: 800,
          top: y + 68,
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 30,
          letterSpacing: 1,
          color: "#fff",
          opacity: settle,
          textShadow: "0 0 14px rgba(255,255,255,0.55)",
          whiteSpace: "nowrap",
        }}
      >
        {cats[sel]!.label}
      </div>
    </>
  );
};

/** A list item's picture, or a generic tile with the game glyph when there is none. */
const Thumb: React.FC<{
  src?: string;
  w: number;
  h: number;
  pos?: string;
  glow: number;
}> = ({ src, w, h, pos, glow }) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: 6,
      overflow: "hidden",
      background:
        "linear-gradient(160deg, rgba(255,255,255,0.32), rgba(255,255,255,0.06))",
      boxShadow: `0 0 0 ${2 + glow}px rgba(255,255,255,${0.35 + 0.55 * glow}), 0 0 ${40 * glow}px rgba(255,255,255,${0.45 * glow}), 0 12px 30px rgba(0,0,0,0.35)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {src ? (
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: pos,
        }}
      />
    ) : (
      <Glyph kind="game" size={Math.min(w, h) * 0.6} />
    )}
  </div>
);

// ---------------------------------------------------------------------------------------------------
// The card.

/** The Pulse badge in the top left corner of the bar's screen, white and a little translucent. */
const XmbBadge: React.FC<{ frame: number }> = ({ frame }) => (
  <PulseBadge
    size={40}
    colour="#fff"
    opacity={0.85 * interpolate(frame, [4, 14], [0, 1], clamp)}
    style={{
      position: "absolute",
      left: 110,
      top: 66,
      filter: "drop-shadow(0 0 10px rgba(255,255,255,0.35))",
    }}
  />
);

const XmbCard: React.FC<MotifCardProps> = (props) => {
  const { frame, fps, fade } = useCard(props.frames);
  const variant = props.variant ?? 0;
  const heading = clean(props.heading);
  const kicker = clean(props.kicker);
  // The year sits where the clock would be; the line under the heading names the game.
  const meta = gameLine(props);
  const year = clean(props.year);
  const pics = props.pictures.filter(Boolean);
  const selX = 560;
  const ROW_Y = 300;
  const big = { w: 320, h: 180 };
  const small = { w: 192, h: 108 };
  const above = pics[1];
  const below: Array<string | undefined> =
    pics.length > 2 ? pics.slice(2, 5) : [undefined, undefined];
  const pick = spring({ frame: frame - 10, fps, config: SPRING.ENTER });
  const glow = pick * (0.75 + 0.25 * Math.sin(frame * 0.12));
  const textIn = interpolate(frame, [14, 26], [0, 1], clamp);
  const metaIn = interpolate(frame, [22, 32], [0, 1], clamp);
  const textX = selX + big.w / 2 + 44;
  const textW = 1824 - textX;
  const hSize = fit(heading, textW, 3, [74, 64, 56, 48], 0.56);
  const item = (i: number) =>
    spring({ frame: frame - 6 - i * 3, fps, config: SPRING.ENTER });
  const selTop = 420;
  return (
    <AbsoluteFill style={{ opacity: fade, overflow: "hidden" }}>
      <Backdrop variant={variant} frame={frame} />
      <XmbBadge frame={frame} />
      {year ? (
        <div
          style={{
            position: "absolute",
            right: 110,
            top: 70,
            display: "flex",
            alignItems: "center",
            gap: 18,
            opacity: interpolate(frame, [4, 14], [0, 1], clamp),
          }}
        >
          <div
            style={{
              width: 60,
              height: 2,
              background: "rgba(255,255,255,0.6)",
            }}
          />
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 32,
              color: "#fff",
              letterSpacing: 1,
            }}
          >
            {year}
          </div>
        </div>
      ) : null}
      {above ? (
        <div
          style={{
            position: "absolute",
            left: selX - small.w / 2,
            top: 96 - (1 - item(0)) * 60,
            opacity: 0.5 * item(0),
          }}
        >
          <Thumb src={above} w={small.w} h={small.h} glow={0} />
        </div>
      ) : null}
      <CategoryRow
        selected={kicker}
        selX={selX}
        y={ROW_Y}
        frame={frame}
        fps={fps}
      />
      {/* The selected item. */}
      <div
        style={{
          position: "absolute",
          left: selX - big.w / 2,
          top: selTop + (1 - item(1)) * 90,
          opacity: item(1),
          transform: `scale(${0.62 + 0.38 * pick})`,
          transformOrigin: "50% 50%",
        }}
      >
        <Thumb src={pics[0]} w={big.w} h={big.h} glow={glow} />
      </div>
      <div
        style={{
          position: "absolute",
          left: textX,
          width: textW,
          top: selTop + big.h / 2,
          transform: `translateY(-50%) translateX(${(1 - textIn) * 40}px)`,
          opacity: textIn,
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: hSize,
            lineHeight: 1.08,
            color: "#fff",
            textShadow: `0 0 ${18 + 10 * glow}px rgba(255,255,255,${0.35 + 0.3 * glow}), 0 2px 8px rgba(0,0,0,0.3)`,
            ...lineClamp(3),
            ...glowRoom(32),
          }}
        >
          {heading}
        </div>
        {meta ? (
          <div
            style={{
              marginTop: 14,
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 32,
              color: "rgba(255,255,255,0.85)",
              opacity: metaIn,
              ...lineClamp(1),
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
      {below.map((src, i) => {
        const s = item(i + 2);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: selX - small.w / 2,
              top: selTop + big.h + 48 + i * (small.h + 26) + (1 - s) * 90,
              opacity: s * (0.55 - i * 0.1),
            }}
          >
            <Thumb src={src} w={small.w} h={small.h} glow={0} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// The style: the list down the vertical, the selection moving from item to item.

export function fitsBar(g: MomentGraphic): boolean {
  const items = g.items.map(clean).filter(Boolean);
  return (
    items.length >= 2 &&
    items.length <= 5 &&
    items.length === g.items.length &&
    items.every((x) => x.length <= 40 && longestWord(x) <= 22) &&
    clean(g.primary).length <= 28
  );
}

const Bar: React.FC<GfxProps> = ({ g, len, src, variant = 0 }) => {
  const { frame, fps, dim, visible } = useStage(len, 210);
  const items = g.items.map(clean).filter(Boolean).slice(0, 5);
  if (!visible || items.length < 2) return null;
  const n = items.length;
  const selX = 400;
  const ROW_Y = 222;
  const thumb = { w: 192, h: 108 };
  const ROW = 128;
  const top = 360 + Math.round(((5 - n) * ROW) / 2);
  const STEP = 22;
  const k = Math.max(0, (frame - 16) / STEP);
  const i0 = Math.min(n - 1, Math.floor(k));
  const pos =
    i0 >= n - 1 ? n - 1 : i0 + easeInOut(Math.min(1, ((k - i0) * STEP) / 10));
  const r = seeded(variant * 13 + 7);
  const crops = items.map(
    () => `${20 + Math.floor(r() * 60)}% ${25 + Math.floor(r() * 50)}%`,
  );
  const textX = selX + thumb.w / 2 + 56;
  const size = Math.min(
    ...items.map((t) => fit(t, 1824 - textX - 80, 1, [46, 42, 38], 0.56)),
  );
  return (
    <AbsoluteFill style={{ opacity: dim, overflow: "hidden" }}>
      <Backdrop variant={variant} frame={frame} />
      <XmbBadge frame={frame} />
      <CategoryRow
        selected={clean(g.primary)}
        selX={selX}
        y={ROW_Y}
        frame={frame}
        fps={fps}
        gap={230}
      />
      {items.map((t, i) => {
        const s = spring({
          frame: frame - 6 - i * 4,
          fps,
          config: SPRING.ENTER,
        });
        const fo =
          Math.max(0, 1 - Math.abs(pos - i)) *
          interpolate(frame, [12, 20], [0, 1], clamp);
        const y = top + i * ROW;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: selX - thumb.w / 2,
                top: y + (1 - s) * 60,
                opacity: s * (0.55 + 0.45 * fo),
                transform: `scale(${1 + 0.16 * fo})`,
              }}
            >
              <Thumb
                src={src}
                w={thumb.w}
                h={thumb.h}
                pos={crops[i]}
                glow={fo}
              />
            </div>
            <div
              style={{
                position: "absolute",
                left: textX + 16 * fo,
                right: 96,
                top: y + thumb.h / 2,
                transform: `translateY(-50%) translateY(${(1 - s) * 60}px)`,
                fontFamily: BODY,
                fontWeight: fo > 0.5 ? 800 : 600,
                fontSize: size * (1 + 0.1 * fo),
                color: "#fff",
                opacity: s * (0.6 + 0.4 * fo),
                textShadow: `0 0 ${20 * fo}px rgba(255,255,255,${0.6 * fo}), 0 2px 8px rgba(0,0,0,0.3)`,
                whiteSpace: "nowrap",
              }}
            >
              {t}
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

export const PS3_CARD = XmbCard;
export const PS3_STYLES: Record<string, GfxStyle> = {
  /** list: primary the category (28 characters at most), items 2-5 lines; the selection runs down the list. */
  Bar: { kind: "list", component: Bar, fits: fitsBar, sound: "glint" },
};
