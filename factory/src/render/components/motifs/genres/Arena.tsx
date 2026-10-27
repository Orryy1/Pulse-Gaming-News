// Genre motif: classic first-person shooters. The card is a first-person view: the screen melts away in
// columns (a level-start wipe) to reveal the picture (or a drawn corridor), the heading stamped as the
// level name with the kicker above it, a crosshair, and a status bar along the bottom with counters that
// roll up (health to a generic 100%, the year, the level from the chapter number) and the game's name on
// its centre plate. The style "Hud" sets a stat's figure as the big counter on that status bar.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { useStage } from "../../DocGraphics.tsx";
import { countText, parseFigure } from "../../packs/data/figures.ts";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  Pic,
  chapterNumber,
  clamp,
  clean,
  fitSize,
  hash,
  useCard,
  yearOf,
} from "./kit.tsx";

const RED = "#ff3a1a";
const METAL =
  "linear-gradient(180deg, #5b5751 0%, #3b3833 18%, #2a2824 60%, #1b1a17 100%)";

/** The level-start wipe: the old (black) screen slides down in columns at seeded speeds. */
const Melt: React.FC<{ frame: number; variant: number }> = ({
  frame,
  variant,
}) => {
  const cols = 48;
  const w = 1920 / cols;
  if (frame > 26) return null;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      {Array.from({ length: cols }, (_, i) => {
        // Neighbouring columns start close together, as the classic wipe does.
        const delay = Math.floor(
          3 * hash(variant * 3 + Math.floor(i / 2), 1) +
            2 * hash(variant + i, 2),
        );
        const t = Math.max(0, frame - delay);
        const y = t * t * 10 + t * 30;
        return (
          <rect
            key={i}
            x={i * w - 0.5}
            y={y}
            width={w + 1}
            height={1080}
            fill="#0a0303"
          />
        );
      })}
    </svg>
  );
};

/** A corridor drawn in perspective, for when there is no picture. */
const Corridor: React.FC = () => (
  <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
    <rect width={1920} height={1080} fill="#14100c" />
    <polygon points="0,0 1920,0 1180,420 740,420" fill="#2a2420" />
    <polygon points="0,1080 1920,1080 1180,620 740,620" fill="#3b2a1c" />
    <polygon points="0,0 740,420 740,620 0,1080" fill="#4a3c30" />
    <polygon points="1920,0 1180,420 1180,620 1920,1080" fill="#41352a" />
    <defs>
      <radialGradient id="arenaGlow" cx="50%" cy="60%" r="70%">
        <stop offset="0" stopColor="#ff7a2a" />
        <stop offset="0.45" stopColor="#8a1e06" />
        <stop offset="1" stopColor="#1a0603" />
      </radialGradient>
    </defs>
    <rect x={740} y={420} width={440} height={200} fill="url(#arenaGlow)" />
    {Array.from({ length: 9 }, (_, i) => {
      const t = i / 9;
      const xl = 740 * t;
      const yt = 420 * t;
      return (
        <g key={i} opacity={0.35}>
          <line
            x1={xl}
            y1={yt}
            x2={xl}
            y2={1080 - (1080 - 620) * t}
            stroke="#1a130d"
            strokeWidth={4}
          />
          <line
            x1={1920 - xl}
            y1={yt}
            x2={1920 - xl}
            y2={1080 - (1080 - 620) * t}
            stroke="#1a130d"
            strokeWidth={4}
          />
        </g>
      );
    })}
  </svg>
);

/** The crosshair: four short bars round a gap, with a dark keyline. */
const Crosshair: React.FC<{ x?: number; y?: number; spread: number }> = ({
  x = 960,
  y = 540,
  spread,
}) => {
  const g = 14 + spread;
  const L = 26;
  const bars = [
    [x - g - L, y - 2, L, 4],
    [x + g, y - 2, L, 4],
    [x - 2, y - g - L, 4, L],
    [x - 2, y + g, 4, L],
  ];
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      {bars.map(([bx, by, bw, bh], i) => (
        <rect
          key={`k${i}`}
          x={bx! - 2}
          y={by! - 2}
          width={bw! + 4}
          height={bh! + 4}
          fill="rgba(0,0,0,0.6)"
        />
      ))}
      {bars.map(([bx, by, bw, bh], i) => (
        <rect key={i} x={bx} y={by} width={bw} height={bh} fill="#b6ff6a" />
      ))}
      <rect x={x - 2} y={y - 2} width={4} height={4} fill="#b6ff6a" />
    </svg>
  );
};

/** Four rivets in the corners of a metal plate. */
const Rivets: React.FC<{ inset?: number }> = ({ inset = 9 }) => (
  <>
    {[
      { left: inset, top: inset },
      { right: inset, top: inset },
      { left: inset, bottom: inset },
      { right: inset, bottom: inset },
    ].map((pos, i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          ...pos,
          width: 10,
          height: 10,
          borderRadius: 5,
          background:
            "radial-gradient(circle at 35% 35%, #b9b2a6 0%, #5c574f 60%, #23211e 100%)",
        }}
      />
    ))}
  </>
);

/** Grille slots for an empty plate. */
const GRILLE =
  "repeating-linear-gradient(90deg, rgba(0,0,0,0) 0 22px, rgba(0,0,0,0.55) 22px 30px, rgba(255,255,255,0.08) 30px 32px)";

/** A counter cell on the status bar: a big red figure over a small label. */
const Counter: React.FC<{
  value: string;
  label: string;
  size?: number;
  width?: number;
  colour?: string;
}> = ({ value, label, size = 96, width, colour = RED }) => (
  <div
    style={{
      width,
      flex: width ? "none" : 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: METAL,
      borderTop: "3px solid #77726a",
      borderLeft: "3px solid #5f5a52",
      borderRight: "3px solid #121110",
      borderBottom: "3px solid #0a0a09",
      padding: "6px 18px 10px",
      position: "relative",
    }}
  >
    <Rivets />
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: size,
        lineHeight: 1,
        color: colour,
        textShadow: "4px 4px 0 #2a0500, 0 0 24px rgba(255,58,26,0.35)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </div>
    <div
      style={{
        marginTop: 4,
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: 22,
        letterSpacing: 4,
        color: "#c9c3b8",
      }}
    >
      {label}
    </div>
  </div>
);

/** The heading stamped as a level name: hot metal letters with a hard dark edge. */
const LevelName: React.FC<{ text: string; size: number; punch: number }> = ({
  text,
  size,
  punch,
}) => (
  <div
    style={{
      fontFamily: DISPLAY,
      fontSize: size,
      lineHeight: 1.04,
      letterSpacing: 2,
      textAlign: "center",
      color: "transparent",
      backgroundImage:
        "linear-gradient(180deg, #fff1cf 0%, #ffc070 30%, #ff7a2a 58%, #c0260c 82%, #6e1204 100%)",
      // The gradient repeats per line so a two-line name is hot metal on both lines.
      backgroundSize: `100% ${size * 1.04}px`,
      backgroundRepeat: "repeat-y",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      textWrap: "balance",
      WebkitTextStroke: `${Math.max(3, Math.round(size / 36))}px #1a0703`,
      filter:
        "drop-shadow(0 7px 0 #1a0703) drop-shadow(0 18px 40px rgba(0,0,0,0.7))",
      transform: `scale(${punch})`,
      padding: "0 20px",
    }}
  >
    {text}
  </div>
);

const Card: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const { frame, fps, len, opacity } = useCard(frames);
  const title = clean(heading).toUpperCase();
  const tag = clean(kicker).toUpperCase();
  const level = chapterNumber(kicker);
  const name = clean(game).toUpperCase();
  const yr = yearOf(year);
  const bg = pictures[0];
  const roll = interpolate(frame, [14, 34], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const barIn = spring({
    frame: frame - 4,
    fps,
    config: { damping: 18, stiffness: 200, mass: 0.6 },
  });
  const nameIn = interpolate(frame, [10, 16], [0, 1], clamp);
  const punch = interpolate(frame, [10, 16], [1.35, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const bobX = Math.sin(frame * 0.11) * 10;
  const bobY = Math.abs(Math.cos(frame * 0.11)) * 8;
  const size = fitSize(title, 1600, 2, [140, 124, 110, 96, 84, 72], 0.5);
  const health = Math.round(100 * roll);
  const yearShown = yr
    ? String(Math.round(Number(yr) * roll)).padStart(4, "0")
    : "";
  const flash = interpolate(frame, [12, 14, 22], [0, 0.35, 0], clamp);
  return (
    <AbsoluteFill
      style={{ opacity, background: "#0a0303", overflow: "hidden" }}
    >
      <AbsoluteFill
        style={{ transform: `translate(${bobX}px, ${bobY}px) scale(1.06)` }}
      >
        {bg ? (
          <Pic
            src={bg}
            style={{ filter: "contrast(1.12) saturate(1.05) brightness(0.82)" }}
          />
        ) : (
          <Corridor />
        )}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(80% 75% at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.7) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 40%)",
        }}
      />
      <AbsoluteFill style={{ background: "#ffd0a0", opacity: flash }} />
      <Crosshair
        spread={
          interpolate(frame, [12, 22], [26, 0], {
            ...clamp,
            easing: Easing.out(Easing.cubic),
          }) +
          Math.sin(frame * 0.2) * 2
        }
      />
      {/* The level name. */}
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          top: 150,
          opacity: nameIn,
        }}
      >
        {tag ? (
          <div
            style={{
              textAlign: "center",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 32,
              letterSpacing: 10,
              color: "#ffd9a8",
              textShadow: "3px 3px 0 #1a0703",
              marginBottom: 14,
            }}
          >
            {tag}
          </div>
        ) : null}
        <LevelName text={title} size={size} punch={punch} />
      </div>
      {/* The status bar. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 176,
          display: "flex",
          gap: 0,
          padding: "10px 96px 30px",
          background:
            "linear-gradient(180deg, #4a4640 0%, #2b2925 30%, #1d1c19 100%)",
          borderTop: "4px solid #7c766c",
          boxShadow: "0 -10px 30px rgba(0,0,0,0.6)",
          transform: `translateY(${(1 - barIn) * 200}px)`,
        }}
      >
        <Counter value={`${health}%`} label="HEALTH" width={300} />
        <Counter value={`${health}%`} label="ARMOR" width={300} />
        {yr ? <Counter value={yearShown} label="YEAR" width={300} /> : null}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: METAL,
            borderTop: "3px solid #77726a",
            borderLeft: "3px solid #5f5a52",
            borderRight: "3px solid #121110",
            borderBottom: "3px solid #0a0a09",
            padding: "0 30px",
            position: "relative",
            backgroundImage: name ? undefined : `${GRILLE}, ${METAL}`,
          }}
        >
          <Rivets />
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: name.length > 22 ? 40 : 58,
              lineHeight: 1.05,
              letterSpacing: 3,
              color: "#e8e1d4",
              textAlign: "center",
              textShadow: "3px 3px 0 #000",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {name}
          </div>
        </div>
        {level ? (
          <Counter
            value={String(Math.round(Number(level) * roll))}
            label="LEVEL"
            width={260}
          />
        ) : null}
      </div>
      <Melt frame={frame} variant={variant} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */

const fitsHud = (g: GfxProps["g"]) => {
  const t = clean(g.primary);
  return (
    /\d/.test(t) &&
    t.length <= 16 &&
    Boolean(parseFigure(t)) &&
    clean(g.secondary).length <= 36
  );
};

/** A stat as the big counter on a first-person status bar, a crosshair over the dimmed view. */
const Hud: React.FC<GfxProps> = ({ g, len }) => {
  const { frame, fps, dim, visible } = useStage(len, 170);
  if (!visible || !fitsHud(g)) return null;
  const fig = parseFigure(clean(g.primary))!;
  const label = clean(g.secondary).toUpperCase();
  const roll = interpolate(frame, [8, 36], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const barIn = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 200, mass: 0.6 },
  });
  const text = countText(fig, roll).toUpperCase();
  const size = fig.text.length > 11 ? 150 : fig.text.length > 7 ? 190 : 230;
  const flash = interpolate(frame, [36, 38, 46], [0, 0.3, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: dim, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(80% 75% at 50% 42%, rgba(10,3,3,0.45) 0%, rgba(10,3,3,0.85) 100%)",
        }}
      />
      <Crosshair
        y={400}
        spread={interpolate(frame, [0, 14], [30, 0], {
          ...clamp,
          easing: Easing.out(Easing.cubic),
        })}
      />
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 84,
          height: 360,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(180deg, #4a4640 0%, #2b2925 30%, #1d1c19 100%)",
          borderTop: "5px solid #8a847a",
          borderLeft: "5px solid #6a655c",
          borderRight: "5px solid #121110",
          borderBottom: "5px solid #0a0a09",
          boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
          transform: `translateY(${(1 - barIn) * 460}px)`,
        }}
      >
        <Rivets inset={16} />
        {/* Grille vents at both ends of the plate. */}
        {[{ left: 40 }, { right: 40 }].map((side, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              ...side,
              top: 70,
              bottom: 70,
              width: 120,
              backgroundImage: GRILLE,
              opacity: 0.8,
            }}
          />
        ))}
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: size,
            lineHeight: 1,
            color: RED,
            textShadow: "7px 7px 0 #2a0500, 0 0 40px rgba(255,58,26,0.4)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </div>
        {label ? (
          <div
            style={{
              marginTop: 10,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 34,
              letterSpacing: 8,
              color: "#d8d1c4",
            }}
          >
            {label}
          </div>
        ) : null}
        <AbsoluteFill style={{ background: "#ffd0a0", opacity: flash }} />
      </div>
    </AbsoluteFill>
  );
};

export const ArenaCard = Card;
export const ARENA_STYLES: Record<string, GfxStyle> = {
  Hud: { kind: "stat", component: Hud, fits: fitsHud, sound: "glint" },
};
