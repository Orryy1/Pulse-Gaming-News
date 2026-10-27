// Genre motif: sports games, as a TV sports broadcast. The card opens on a broadcast stinger (three
// slanted bars sweeping across), the picture lit by floodlight banks powering on, a score bug sliding in
// top left (kicker, game, year as the clock) and the heading on a two-tier lower third. Styles:
// "Scoreboard" sets two "label: value" rows on an arena board with dot-matrix figures, and "Matchup"
// sets a versus (two game titles) as a broadcast matchup plate.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import { countText, figureRows } from "../../packs/data/figures.ts";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  Pic,
  clamp,
  clean,
  fitSize,
  pixelLine,
  pixelOk,
  useCard,
  yearOf,
} from "./kit.tsx";

const NAVY = "#0a1733";
const NAVY2 = "#13264f";
const RED = "#e8112d";
const GOLD = "#ffb81c";

/** The stinger: three slanted bars sweeping across the frame. */
const Stinger: React.FC<{ frame: number; at?: number }> = ({
  frame,
  at = 0,
}) => {
  const t = frame - at;
  if (t < 0 || t > 12) return null;
  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      {[
        { c: NAVY, w: 900, d: 0 },
        { c: RED, w: 260, d: 1 },
        { c: "#ffffff", w: 90, d: 2 },
      ].map((b, i) => {
        const x = interpolate(t - b.d, [0, 8], [-1400, 2700], {
          ...clamp,
          easing: Easing.inOut(Easing.cubic),
        });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: -200,
              bottom: -200,
              left: x - b.w,
              width: b.w,
              background: b.c,
              transform: "skewX(-24deg)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * A distant floodlight tower: a small rig of lamps on a mast that snaps on (one flicker), a wide bloom
 * and a horizontal flare streak, the way stadium lights read on a broadcast camera.
 */
const Floodlight: React.FC<{
  x: number;
  y: number;
  scale: number;
  frame: number;
  at: number;
}> = ({ x, y, scale, frame, at }) => {
  const t = frame - at;
  const lit = t < 0 ? 0 : t < 1 ? 1 : t < 2 ? 0.35 : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -6,
          top: 34,
          width: 12,
          height: 520,
          background:
            "linear-gradient(180deg, #0b0f17 0%, rgba(11,15,23,0.6) 60%, rgba(11,15,23,0) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -340,
          top: -340,
          width: 680,
          height: 680,
          borderRadius: 340,
          background:
            "radial-gradient(circle, rgba(244,250,255,0.62) 0%, rgba(210,230,255,0.22) 26%, rgba(210,230,255,0.06) 50%, rgba(210,230,255,0) 68%)",
          opacity: lit,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -520,
          top: -3,
          width: 1040,
          height: 6,
          borderRadius: 3,
          background:
            "linear-gradient(90deg, rgba(220,235,255,0) 0%, rgba(230,242,255,0.75) 50%, rgba(220,235,255,0) 100%)",
          opacity: lit,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -74,
          top: -42,
          width: 148,
          height: 84,
          padding: 9,
          boxSizing: "border-box",
          background: "#0b0f17",
          borderRadius: 6,
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gridTemplateRows: "repeat(3, 1fr)",
          gap: 6,
        }}
      >
        {Array.from({ length: 15 }, (_, i) => (
          <div
            key={i}
            style={{
              borderRadius: 999,
              background: lit > 0.5 ? "#ffffff" : "#26303f",
              boxShadow:
                lit > 0.5 ? "0 0 12px 5px rgba(225,238,255,0.85)" : "none",
            }}
          />
        ))}
      </div>
    </div>
  );
};

/** A segment of the score bug wiping open. */
const Seg: React.FC<{
  open: number;
  bg: string;
  children: React.ReactNode;
  pad?: string;
  minW?: number;
}> = ({ open, bg, children, pad = "0 26px", minW }) => (
  <div
    style={{
      background: bg,
      padding: pad,
      display: "flex",
      alignItems: "center",
      clipPath: `inset(0 ${(1 - open) * 100}% 0 0)`,
      minWidth: minW,
      justifyContent: "center",
    }}
  >
    {children}
  </div>
);

const Card: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
}) => {
  const { frame, fps, len, opacity } = useCard(frames);
  const title = clean(heading);
  const tag = clean(kicker).toUpperCase();
  const name = clean(game).toUpperCase();
  const yr = yearOf(year);
  const bg = pictures[0];
  const push = interpolate(frame, [0, len], [1.08, 1.0], clamp);
  const bugIn = spring({ frame: frame - 7, fps, config: SPRING.SNAP });
  const seg = (k: number) =>
    interpolate(frame, [9 + k * 3, 15 + k * 3], [0, 1], {
      ...clamp,
      easing: Easing.out(Easing.cubic),
    });
  const l3 = interpolate(frame, [9, 19], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const l3top = interpolate(frame, [15, 23], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const size = fitSize(title, 1440, 2, [92, 84, 76, 68, 60, 54], 0.56);
  const shine = interpolate(frame, [24, 44], [-20, 120], clamp);
  return (
    <AbsoluteFill
      style={{ opacity, background: "#03060d", overflow: "hidden" }}
    >
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        {bg ? (
          <Pic
            src={bg}
            style={{ filter: "brightness(0.72) saturate(1.1) contrast(1.05)" }}
          />
        ) : (
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, #050b1c 0%, #0c1a3a 46%, #135a2a 47%, #1b7a36 70%, #11531f 100%)",
            }}
          >
            <AbsoluteFill
              style={{
                top: "47%",
                backgroundImage:
                  "repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 120px, transparent 120px 240px)",
              }}
            />
          </AbsoluteFill>
        )}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(2,6,16,0.75) 0%, rgba(2,6,16,0.2) 26%, rgba(2,6,16,0) 50%, rgba(2,6,16,0.55) 78%, rgba(2,6,16,0.85) 100%)",
        }}
      />
      {/* A cold floodlight haze from the top of frame, then the towers (right of the bug). */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(190,215,255,0.16) 0%, rgba(190,215,255,0) 35%)",
          opacity: interpolate(frame, [2, 8], [0, 1], clamp),
        }}
      />
      <Floodlight x={1160} y={118} scale={0.62} frame={frame} at={2} />
      <Floodlight x={1480} y={92} scale={0.9} frame={frame} at={4} />
      <Floodlight x={1780} y={150} scale={0.55} frame={frame} at={6} />
      {/* The score bug. */}
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 64,
          height: 68,
          display: "flex",
          boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
          transform: `translateX(${(1 - bugIn) * -120}px)`,
          opacity: bugIn,
          fontFamily: BODY,
          fontWeight: 900,
        }}
      >
        {tag && !name ? (
          <Seg open={seg(0)} bg={RED}>
            <span
              style={{
                fontSize: 28,
                letterSpacing: 3,
                color: "#fff",
                whiteSpace: "nowrap",
              }}
            >
              {tag}
            </span>
          </Seg>
        ) : null}
        {name ? (
          <div style={{ width: 10, background: RED, opacity: seg(0) }} />
        ) : null}
        {name ? (
          <Seg open={seg(1)} bg={NAVY}>
            <span
              style={{
                fontSize: 30,
                letterSpacing: 2,
                color: "#fff",
                whiteSpace: "nowrap",
                maxWidth: 820,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {name}
            </span>
          </Seg>
        ) : null}
        {yr ? (
          <Seg open={seg(2)} bg="#ffffff" minW={130}>
            <span
              style={{
                fontSize: 34,
                color: NAVY,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {yr}
            </span>
          </Seg>
        ) : null}
        <div style={{ width: 10, background: GOLD, opacity: seg(2) }} />
      </div>
      {/* The lower third. */}
      <div style={{ position: "absolute", left: 96, right: 96, bottom: 96 }}>
        {name && tag ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 14,
              padding: "10px 24px",
              background: RED,
              clipPath: `inset(0 ${(1 - l3top) * 100}% 0 0)`,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 28,
              letterSpacing: 4,
              color: "#fff",
            }}
          >
            {tag}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            width: "fit-content",
            alignItems: "stretch",
            clipPath: `inset(0 ${(1 - l3) * 100}% 0 0)`,
            boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            maxWidth: 1728,
          }}
        >
          <div style={{ width: 16, background: GOLD }} />
          <div
            style={{
              position: "relative",
              background: "linear-gradient(180deg, #ffffff 0%, #eef2f8 100%)",
              padding: "18px 40px 20px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: size,
                lineHeight: 1.08,
                letterSpacing: -0.5,
                color: NAVY,
                textTransform: "uppercase",
                textWrap: "balance",
              }}
            >
              {title}
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(100deg, transparent ${shine - 10}%, rgba(255,255,255,0.8) ${shine}%, transparent ${shine + 10}%)`,
              }}
            />
          </div>
          <div
            style={{
              width: 70,
              background: `linear-gradient(90deg, ${NAVY} 0%, ${NAVY2} 100%)`,
            }}
          />
        </div>
      </div>
      <Stinger frame={frame} />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */

function boardRows(g: GfxProps["g"]) {
  const rows = figureRows(g.items);
  return rows.length === 2 && g.items.filter((x) => x.trim()).length === 2
    ? rows
    : [];
}

const fitsScoreboard = (g: GfxProps["g"]) => {
  const rows = boardRows(g);
  return (
    rows.length === 2 &&
    rows.every(
      (r) =>
        r.label.length <= 26 && r.fig.text.length <= 12 && pixelOk(r.fig.text),
    ) &&
    clean(g.primary).length <= 40 &&
    clean(g.secondary).length <= 50
  );
};

/** Dot-matrix text: lit cells on a faint grid of unlit ones. */
const Led: React.FC<{ text: string; cell: number; colour: string }> = ({
  text,
  cell,
  colour,
}) => {
  const { d, w, h } = pixelLine(
    text,
    cell,
    Math.max(2, Math.round(cell * 0.18)),
  );
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ overflow: "visible", display: "block" }}
    >
      <path
        d={d}
        fill={colour}
        style={{ filter: `drop-shadow(0 0 ${cell * 0.5}px ${colour})` }}
      />
    </svg>
  );
};

const board: React.CSSProperties = {
  background: "linear-gradient(180deg, #0c121f 0%, #05080f 100%)",
  border: "6px solid #2b3446",
  borderRadius: 14,
  boxShadow: "0 0 0 3px #0a0d14, 0 40px 120px rgba(0,0,0,0.7)",
  overflow: "hidden",
};

/** Two "label: value" rows on an arena scoreboard, the figures in dot matrix. */
const Scoreboard: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const { frame, fps, dim, visible } = useStage(len, 180);
  const rows = boardRows(g);
  if (!visible || !fitsScoreboard(g)) return null;
  const head = clean(g.primary).toUpperCase();
  const foot = clean(g.secondary).toUpperCase();
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const count = interpolate(frame, [14, 40], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const longest = Math.max(...rows.map((r) => r.fig.text.length));
  const cell = Math.max(7, Math.min(16, Math.floor(700 / (longest * 6))));
  const teams = variant % 2 ? [NAVY2, RED] : [RED, NAVY2];
  return (
    <AbsoluteFill
      style={{
        opacity: dim,
        pointerEvents: "none",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(80% 80% at 50% 45%, rgba(3,6,14,0.62) 0%, rgba(3,6,14,0.92) 100%)",
        }}
      />
      <div
        style={{
          width: 1560,
          marginTop: 50,
          transform: `translateY(${(1 - enter) * 80}px)`,
          opacity: enter,
          ...board,
        }}
      >
        {head ? (
          <div
            style={{
              padding: "18px 30px",
              background: `linear-gradient(90deg, ${NAVY} 0%, ${NAVY2} 100%)`,
              borderBottom: `5px solid ${GOLD}`,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 38,
              letterSpacing: 5,
              color: "#fff",
              textAlign: "center",
            }}
          >
            {head}
          </div>
        ) : null}
        {rows.map((r, i) => {
          const s = spring({
            frame: frame - 8 - i * 6,
            fps,
            config: SPRING.SNAP,
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "stretch",
                height: 170,
                borderTop: i ? "3px solid #1b2232" : undefined,
              }}
            >
              <div
                style={{
                  width: 640,
                  display: "flex",
                  alignItems: "center",
                  gap: 22,
                  padding: "0 30px",
                  background: `linear-gradient(90deg, ${teams[i]} 0%, ${teams[i]}cc 100%)`,
                  transform: `translateX(${(1 - s) * -660}px)`,
                }}
              >
                <div
                  style={{
                    fontFamily: BODY,
                    fontWeight: 900,
                    fontSize: r.label.length > 18 ? 38 : 46,
                    lineHeight: 1.06,
                    color: "#fff",
                    textTransform: "uppercase",
                  }}
                >
                  {r.label}
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundImage:
                    "radial-gradient(circle, rgba(255,190,60,0.09) 1.6px, transparent 2px)",
                  backgroundSize: `${cell}px ${cell}px`,
                }}
              >
                <Led
                  text={countText(r.fig, count)}
                  cell={cell}
                  colour={i === 0 ? "#ffc23a" : "#ffe9b0"}
                />
              </div>
            </div>
          );
        })}
        {foot ? (
          <div
            style={{
              padding: "14px 30px",
              borderTop: "3px solid #1b2232",
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: 4,
              color: "rgba(255,255,255,0.78)",
              textAlign: "center",
              opacity: interpolate(frame, [24, 34], [0, 1], clamp),
            }}
          >
            {foot}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const fitsMatchup = (g: GfxProps["g"]) => {
  const items = g.items.map(clean).filter(Boolean);
  return (
    items.length === 2 &&
    items.every((x) => x.length <= 36) &&
    clean(g.primary).length <= 40
  );
};

/** A versus as a broadcast matchup: two title plates sliding in from each side, VS between. */
const Matchup: React.FC<GfxProps> = ({ g, len, src }) => {
  const { frame, fps, dim, visible } = useStage(len, 170);
  if (!visible || !fitsMatchup(g)) return null;
  const [a, b] = g.items.map(clean).filter(Boolean) as [string, string];
  const head = clean(g.primary).toUpperCase();
  const s1 = spring({ frame: frame - 6, fps, config: SPRING.ENTER });
  const s2 = spring({ frame: frame - 10, fps, config: SPRING.ENTER });
  const vs = spring({ frame: frame - 18, fps, config: SPRING.POP });
  const headIn = interpolate(frame, [2, 12], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const plate = (t: string, colour: string, left: boolean, s: number) => {
    const sz = fitSize(t.toUpperCase(), 620, 3, [64, 56, 50, 44, 38], 0.6);
    return (
      <div
        style={{
          width: 720,
          height: 330,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 50px",
          background: `linear-gradient(${left ? 135 : 225}deg, ${colour} 0%, ${colour}dd 60%, ${NAVY} 100%)`,
          clipPath: left
            ? "polygon(0 0, 100% 0, 92% 100%, 0 100%)"
            : "polygon(8% 0, 100% 0, 100% 100%, 0 100%)",
          transform: `translateX(${(1 - s) * (left ? -1000 : 1000)}px)`,
          boxShadow: `inset 0 12px 0 ${GOLD}, inset 0 -8px 0 rgba(0,0,0,0.3)`,
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: sz,
            lineHeight: 1.06,
            color: "#fff",
            textTransform: "uppercase",
            textShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}
        >
          {t}
        </div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ opacity: dim, pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "rgba(3,6,14,0.78)" }} />
      {head ? (
        <div
          style={{
            position: "absolute",
            top: 170,
            left: 96,
            right: 96,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "stretch",
              clipPath: `inset(0 ${(1 - headIn) * 50}% 0 ${(1 - headIn) * 50}%)`,
              boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ width: 12, background: GOLD }} />
            <div
              style={{
                padding: "14px 34px",
                background: "#ffffff",
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 40,
                letterSpacing: 4,
                color: NAVY,
              }}
            >
              {head}
            </div>
            <div style={{ width: 12, background: GOLD }} />
          </div>
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          top: 380,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 60,
        }}
      >
        {plate(a, RED, true, s1)}
        {plate(b, NAVY2, false, s2)}
      </div>
      <div
        style={{
          position: "absolute",
          top: 545 - 80,
          left: 960 - 80,
          width: 160,
          height: 160,
          borderRadius: 80,
          background: "#ffffff",
          border: `8px solid ${GOLD}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: DISPLAY,
          fontSize: 76,
          color: NAVY,
          transform: `scale(${vs})`,
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
        }}
      >
        VS
      </div>
    </AbsoluteFill>
  );
};

export const SportsCard = Card;
export const SPORTS_STYLES: Record<string, GfxStyle> = {
  Scoreboard: {
    kind: "compare",
    component: Scoreboard,
    fits: fitsScoreboard,
    sound: "pop",
  },
  Matchup: {
    kind: "versus",
    component: Matchup,
    fits: fitsMatchup,
    sound: "pop",
  },
};
