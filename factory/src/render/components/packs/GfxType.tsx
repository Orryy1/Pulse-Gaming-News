// Graphic pack: Type. Big typography doing the work (owner, 27 Oct 2026, on the figure with the game inside
// its letters: "more stuff like that too would be insanely fantastic"): a year cut out of the picture, two
// years with the span counting between them, a figure filling like liquid, and a figure over a wall of its
// own type scrolling both ways.
import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { SPRING } from "../../motion.ts";
import { displayText } from "../../timeline.ts";
import { useStage } from "../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "./types.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const YEAR = /\b(19|20)\d\d\b/;

/** Letters cut from the picture: the picture drifts inside them, edged in light. */
const masked = (src: string | undefined, drift: number): React.CSSProperties =>
  src
    ? {
        color: "transparent",
        backgroundImage: `url(${src})`,
        backgroundSize: "cover",
        backgroundPosition: `${50 + drift}% 50%`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextStroke: "2px rgba(255,236,220,0.55)",
        filter:
          "brightness(1.55) saturate(1.35) contrast(1.1) drop-shadow(0 20px 60px rgba(255,107,26,0.3))",
      }
    : {
        color: COLOUR.amber,
        filter: "drop-shadow(0 20px 60px rgba(255,107,26,0.25))",
      };

/** The year, enormous, cut out of the picture; the month or day above it and the label beneath. */
const YearMask: React.FC<GfxProps> = ({ g, len, src }) => {
  const { frame, fps, dim, visible, showFor } = useStage(len, 160);
  const text = displayText(g.primary);
  const year = text.match(YEAR)?.[0];
  if (!visible || !year) return null;
  const rest = text
    .replace(year, "")
    .replace(/[,\s]+$/, "")
    .replace(/^[,\s]+/, "")
    .toUpperCase();
  const s = spring({ frame, fps, config: SPRING.ENTER });
  const drift = interpolate(frame, [0, showFor], [-6, 6], clamp);
  const tracking = interpolate(frame, [0, 30], [60, 4], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const label = interpolate(frame, [14, 28], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{
        opacity: dim,
        background: "#060608",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{ textAlign: "center", transform: `scale(${1.15 - 0.15 * s})` }}
      >
        {rest ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 54,
              letterSpacing: 18,
              color: COLOUR.paper,
              opacity: label,
              marginBottom: 6,
            }}
          >
            {rest}
          </div>
        ) : null}
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 520,
            lineHeight: 0.9,
            letterSpacing: tracking,
            ...masked(src, drift),
          }}
        >
          {year}
        </div>
        {g.secondary ? (
          <div
            style={{
              marginTop: 18,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 40,
              letterSpacing: 6,
              color: COLOUR.amber,
              textTransform: "uppercase",
              opacity: label,
              transform: `translateY(${(1 - label) * 16}px)`,
            }}
          >
            {displayText(g.secondary)}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** Two years cut out of the picture with a line drawing between them and the span counting up on it. */
const SpanMask: React.FC<GfxProps> = ({ g, len, src }) => {
  const { frame, fps, dim, visible, showFor } = useStage(len, 180);
  const years = g.items.map((x) => Number(x.match(YEAR)?.[0])).filter(Boolean);
  if (!visible || years.length !== 2 || years[1]! <= years[0]!) return null;
  const [a, b] = years as [number, number];
  const line = interpolate(frame, [16, 60], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 2,
  });
  const count = Math.round((b - a) * line);
  const left = spring({ frame, fps, config: SPRING.ENTER });
  const right = spring({ frame: frame - 50, fps, config: SPRING.ENTER });
  const drift = interpolate(frame, [0, showFor], [-5, 5], clamp);
  return (
    <AbsoluteFill
      style={{
        opacity: dim,
        background: "#060608",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 300,
            lineHeight: 0.9,
            opacity: left,
            transform: `translateX(${(1 - left) * -80}px)`,
            ...masked(src, drift),
          }}
        >
          {a}
        </div>
        <div style={{ width: 380, position: "relative", height: 200 }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 96,
              height: 8,
              width: `${line * 100}%`,
              background: COLOUR.amber,
              borderRadius: 4,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              textAlign: "center",
              fontFamily: DISPLAY,
              fontSize: 84,
              color: COLOUR.paper,
              opacity: interpolate(frame, [16, 24], [0, 1], clamp),
            }}
          >
            {count}
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 124,
              textAlign: "center",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 30,
              letterSpacing: 6,
              color: COLOUR.amber,
              opacity: interpolate(frame, [20, 30], [0, 1], clamp),
            }}
          >
            YEARS
          </div>
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 300,
            lineHeight: 0.9,
            opacity: right,
            transform: `translateX(${(1 - right) * 80}px)`,
            ...masked(src, -drift),
          }}
        >
          {b}
        </div>
      </div>
      {g.primary ? (
        <div
          style={{
            position: "absolute",
            bottom: 170,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 40,
            letterSpacing: 5,
            color: COLOUR.paper,
            textTransform: "uppercase",
            opacity: interpolate(frame, [60, 74], [0, 1], clamp),
          }}
        >
          {displayText(g.primary)}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** The figure as an outline that fills from the bottom like a glass, a wave on the surface. */
const LiquidFill: React.FC<GfxProps> = ({ g, len }) => {
  const { frame, fps, dim, visible } = useStage(len, 160);
  const figure = displayText(g.primary).toUpperCase();
  if (!visible || !figure) return null;
  const level = interpolate(frame, [10, 70], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 2,
  });
  const wave = Math.sin(frame / 5) * 3 * (1 - level * 0.7);
  const size = figure.length > 12 ? 230 : figure.length > 8 ? 290 : 360;
  const s = spring({ frame, fps, config: SPRING.ENTER });
  const fillTop = 100 - level * 100;
  const label = interpolate(frame, [60, 74], [0, 1], clamp);
  const word: React.CSSProperties = {
    fontFamily: DISPLAY,
    fontSize: size,
    lineHeight: 0.95,
    whiteSpace: "nowrap",
    letterSpacing: -1,
  };
  return (
    <AbsoluteFill
      style={{
        opacity: dim,
        background:
          "radial-gradient(70% 70% at 50% 50%, #17110c 0%, #070608 100%)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{ position: "relative", transform: `scale(${1.1 - 0.1 * s})` }}
      >
        <div
          style={{
            ...word,
            color: "transparent",
            WebkitTextStroke: `4px ${COLOUR.amber}`,
          }}
        >
          {figure}
        </div>
        <div
          style={{
            ...word,
            position: "absolute",
            inset: 0,
            color: COLOUR.amber,
            clipPath: `polygon(0% ${fillTop + wave}%, 25% ${fillTop - wave}%, 50% ${fillTop + wave}%, 75% ${fillTop - wave}%, 100% ${fillTop + wave}%, 100% 100%, 0% 100%)`,
            textShadow: "0 0 40px rgba(255,107,26,0.45)",
          }}
        >
          {figure}
        </div>
      </div>
      {g.secondary ? (
        <div
          style={{
            position: "absolute",
            bottom: 200,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 40,
            letterSpacing: 6,
            color: COLOUR.paper,
            textTransform: "uppercase",
            opacity: label,
          }}
        >
          {displayText(g.secondary)}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** The figure over a wall of itself in outline, rows scrolling opposite ways, the middle row lit. */
const TypeWall: React.FC<GfxProps> = ({ g, len }) => {
  const { frame, fps, dim, visible } = useStage(len, 160);
  const figure = displayText(g.primary).toUpperCase();
  if (!visible || !figure) return null;
  const s = spring({ frame: frame - 6, fps, config: SPRING.POP });
  const rows = [-3, -2, -1, 1, 2, 3];
  const unit = `${figure} · `;
  const label = interpolate(frame, [18, 32], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{
        opacity: dim,
        background: "#08080a",
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {rows.map((r) => (
        <div
          key={r}
          style={{
            position: "absolute",
            top: 540 + r * 170 - 85,
            left: 0,
            whiteSpace: "nowrap",
            fontFamily: DISPLAY,
            fontSize: 150,
            lineHeight: 1,
            color: "transparent",
            WebkitTextStroke: `2px rgba(255,107,26,${0.12 + 0.06 * (3 - Math.abs(r))})`,
            transform: `translateX(${(r % 2 ? -1 : 1) * (frame * 4) - 800}px)`,
          }}
        >
          {unit.repeat(8)}
        </div>
      ))}
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: figure.length > 12 ? 200 : 260,
          lineHeight: 1,
          color: COLOUR.paper,
          textShadow:
            "0 0 60px rgba(255,107,26,0.5), 0 14px 40px rgba(0,0,0,0.9)",
          transform: `scale(${1.4 - 0.4 * s})`,
          opacity: Math.min(1, s * 1.5),
          whiteSpace: "nowrap",
        }}
      >
        {figure}
      </div>
      {g.secondary ? (
        <div
          style={{
            position: "absolute",
            bottom: 180,
            padding: "10px 26px",
            background: COLOUR.amber,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 36,
            letterSpacing: 5,
            color: COLOUR.ink,
            textTransform: "uppercase",
            opacity: label,
            transform: `translateY(${(1 - label) * 20}px)`,
          }}
        >
          {displayText(g.secondary)}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const STYLES: Record<string, GfxStyle> = {
  YearMask: {
    kind: "date",
    component: YearMask,
    fits: (g) => YEAR.test(g.primary) && g.primary.length <= 22,
    sound: "pop",
  },
  SpanMask: {
    kind: "span",
    component: SpanMask,
    fits: (g) => {
      const ys = g.items.map((x) => Number(x.match(YEAR)?.[0]));
      return ys.length === 2 && ys.every(Boolean) && ys[1]! > ys[0]!;
    },
    sound: "glint",
  },
  LiquidFill: {
    kind: "stat",
    component: LiquidFill,
    fits: (g) => /\d/.test(g.primary) && g.primary.length <= 14,
    sound: "glint",
  },
  TypeWall: {
    kind: "stat",
    component: TypeWall,
    fits: (g) => /\d/.test(g.primary) && g.primary.length <= 16,
    sound: "pop",
  },
  TypeWallMilestone: {
    kind: "milestone",
    component: TypeWall,
    fits: (g) => g.primary.length <= 18,
    sound: "pop",
  },
};
