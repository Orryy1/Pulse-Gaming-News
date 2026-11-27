// Genre motif: racing games. The card is a race start: a gantry of three lights counting down and then
// going green, the picture pushing forward with speed streaks once the lights change, the heading on a
// checkered finish-line banner, a timing panel down the left side (the lap from the chapter number, the
// game in first place, the year as its time, three sector bars) and a speedometer needle sweeping up.
// The style "Timing" sets ranked "label: figure" rows as a timing tower, the leader highlighted.
import React from "react";
import { AbsoluteFill, Easing, interpolate, spring } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import { countText, rankedRows } from "../../packs/data/figures.ts";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  Pic,
  chapterNumber,
  clamp,
  clean,
  fitSize,
  hash,
  linesAt,
  useCard,
  yearOf,
} from "./kit.tsx";

const GREEN_AT = 22;
const LIGHTS = [4, 10, 16];
const YELLOW = "#ffd400";
const RED = "#ff2b2b";
const GREEN = "#1fe36a";

/** A strip of checkered squares, `rows` high. */
const Checker: React.FC<{ rows: number; size: number; offset?: number }> = ({
  rows,
  size,
  offset = 0,
}) => (
  <div
    style={{
      height: rows * size,
      backgroundColor: "#f5f5f0",
      backgroundImage: `conic-gradient(#111 25%, transparent 25% 50%, #111 50% 75%, transparent 75%)`,
      backgroundSize: `${size * 2}px ${size * 2}px`,
      backgroundPosition: `${offset}px 0`,
    }}
  />
);

/** Horizontal speed streaks rushing past once the lights go green. */
const Streaks: React.FC<{ frame: number; on: number; variant: number }> = ({
  frame,
  on,
  variant,
}) => {
  if (on <= 0) return null;
  return (
    <svg
      width={1920}
      height={1080}
      style={{ position: "absolute", inset: 0, opacity: on }}
    >
      {Array.from({ length: 26 }, (_, i) => {
        const y = 40 + hash(variant * 13 + i, 1) * 1000;
        const len = 220 + hash(variant * 13 + i, 2) * 520;
        const speed = 70 + hash(variant * 13 + i, 3) * 90;
        const x =
          1920 -
          ((frame * speed + hash(variant * 13 + i, 4) * 2600) %
            (1920 + len + 200));
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={len}
            height={2 + hash(i, 5) * 3}
            rx={2}
            fill="#ffffff"
            opacity={0.18 + hash(i, 6) * 0.3}
          />
        );
      })}
    </svg>
  );
};

/** The speedometer: a half dial, ticks, a red zone and a needle sweeping up after the start. */
const Speedo: React.FC<{ sweep: number; frame: number; show: number }> = ({
  sweep,
  frame,
  show,
}) => {
  const R = 190;
  const cx = 230;
  const cy = 230;
  const ticks = Array.from({ length: 25 }, (_, i) => i);
  const angle =
    -90 + 180 * sweep + (sweep > 0.7 ? Math.sin(frame * 1.7) * 1.4 : 0);
  return (
    <svg
      width={460}
      height={250}
      viewBox="0 0 460 250"
      style={{
        position: "absolute",
        right: 70,
        bottom: 26,
        opacity: show,
        transform: `translateY(${(1 - show) * 120}px)`,
      }}
    >
      <path
        d={`M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx + R} ${cy} Z`}
        fill="rgba(8,10,14,0.88)"
      />
      <path
        d={`M${cx - R + 14} ${cy} A${R - 14} ${R - 14} 0 0 1 ${cx + R - 14} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={10}
      />
      {/* Red zone: the last fifth of the dial. */}
      <path
        d={`M${cx + (R - 14) * Math.cos(Math.PI * 0.2)} ${cy - (R - 14) * Math.sin(Math.PI * 0.2)} A${R - 14} ${R - 14} 0 0 1 ${cx + R - 14} ${cy}`}
        fill="none"
        stroke={RED}
        strokeWidth={10}
      />
      {ticks.map((i) => {
        const a = Math.PI - (i / 24) * Math.PI;
        const major = i % 4 === 0;
        const r1 = R - 34;
        const r2 = major ? R - 66 : R - 50;
        const lit = i / 24 <= sweep;
        return (
          <line
            key={i}
            x1={cx + r1 * Math.cos(a)}
            y1={cy - r1 * Math.sin(a)}
            x2={cx + r2 * Math.cos(a)}
            y2={cy - r2 * Math.sin(a)}
            stroke={lit ? (i >= 20 ? RED : "#ffffff") : "rgba(255,255,255,0.3)"}
            strokeWidth={major ? 6 : 3}
            strokeLinecap="round"
          />
        );
      })}
      <text
        x={cx}
        y={cy - 62}
        textAnchor="middle"
        fontFamily={BODY}
        fontWeight={900}
        fontSize={24}
        letterSpacing={4}
        fill="rgba(255,255,255,0.75)"
      >
        MPH
      </text>
      <g transform={`rotate(${angle} ${cx} ${cy})`}>
        <polygon
          points={`${cx - 7},${cy} ${cx + 7},${cy} ${cx + 1.5},${cy - R + 40} ${cx - 1.5},${cy - R + 40}`}
          fill="#ff3d1f"
        />
      </g>
      <circle
        cx={cx}
        cy={cy}
        r={20}
        fill="#16181d"
        stroke="#ffffff"
        strokeWidth={4}
      />
    </svg>
  );
};

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
  const lap = chapterNumber(kicker);
  const tag = clean(kicker).toUpperCase();
  const name = clean(game).toUpperCase();
  const yr = yearOf(year);
  const green = frame >= GREEN_AT;
  const go = interpolate(frame, [GREEN_AT, GREEN_AT + 10], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const push = interpolate(frame, [GREEN_AT, len], [1.04, 1.2], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  const sweep = interpolate(frame, [GREEN_AT, GREEN_AT + 26], [0, 0.86], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const banner = spring({
    frame: frame - 3,
    fps,
    config: { damping: 15, stiffness: 190, mass: 0.7 },
  });
  const tower = spring({ frame: frame - 6, fps, config: SPRING.ENTER });
  const gantry = spring({ frame, fps, config: SPRING.SNAP });
  const gantryOut = interpolate(frame, [GREEN_AT + 24, GREEN_AT + 34], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  // One line at full size when it fits, else two smaller lines (the banner must clear the speedometer).
  const one = fitSize(title, 1560, 1, [132, 118, 104, 92], 0.5);
  const size =
    linesAt(title, 1560, one, 0.5) <= 1
      ? one
      : fitSize(title, 1300, 2, [88, 78, 70, 62, 56], 0.5);
  const bg = pictures[0];
  const hasTower = Boolean(lap || tag || name || yr);
  const sectors = [0, 1, 2].map((i) =>
    interpolate(frame, [GREEN_AT + 4 + i * 8, GREEN_AT + 12 + i * 8], [0, 1], {
      ...clamp,
      easing: Easing.out(Easing.quad),
    }),
  );
  const towerRow = (k: number) =>
    interpolate(frame, [8 + k * 4, 14 + k * 4], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{ opacity, background: "#07080b", overflow: "hidden" }}
    >
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        {bg ? (
          <Pic
            src={bg}
            style={{
              filter: `brightness(${0.42 + 0.4 * go}) saturate(${0.8 + 0.35 * go})`,
            }}
          />
        ) : (
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(180deg, #0c1018 0%, #1a1f29 52%, #2a2e36 53%, #121418 100%)",
            }}
          />
        )}
      </AbsoluteFill>
      <Streaks frame={frame} on={go * 0.9} variant={variant} />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0) 70%), linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.6) 100%)",
        }}
      />
      {/* The start gantry. */}
      <div
        style={{
          position: "absolute",
          top: 36,
          left: "50%",
          transform: `translate(-50%, ${(1 - gantry) * -220 - gantryOut * 260}px)`,
          display: "flex",
          gap: 30,
          padding: "22px 40px",
          background: "linear-gradient(180deg, #23262d 0%, #121418 100%)",
          borderRadius: 26,
          border: "3px solid #3a3f49",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
        }}
      >
        {LIGHTS.map((at, i) => {
          const on = frame >= at;
          const c = green ? GREEN : on ? RED : "#2b0b0b";
          return (
            <div
              key={i}
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                background:
                  on || green
                    ? `radial-gradient(circle at 40% 35%, #ffffff 0%, ${c} 32%, ${c} 70%, rgba(0,0,0,0.4) 100%)`
                    : "#1a0c0c",
                border: "5px solid #050608",
                boxShadow:
                  on || green
                    ? `0 0 40px 10px ${c}aa`
                    : "inset 0 6px 14px rgba(0,0,0,0.8)",
              }}
            />
          );
        })}
      </div>
      {/* The timing panel. */}
      {hasTower ? (
        <div
          style={{
            position: "absolute",
            left: 96,
            top: 210,
            width: 500,
            transform: `translateX(${(1 - tower) * -640}px)`,
            fontFamily: BODY,
            color: "#fff",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 22px",
              background: "#e10600",
              opacity: towerRow(0),
            }}
          >
            <span style={{ fontWeight: 900, fontSize: 30, letterSpacing: 4 }}>
              {lap ? "LAP" : tag}
            </span>
            {lap ? (
              <span style={{ fontWeight: 900, fontSize: 40, lineHeight: 1 }}>
                {lap}
              </span>
            ) : null}
          </div>
          {name || yr ? (
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                background: "rgba(14,16,20,0.94)",
                borderLeft: `8px solid ${YELLOW}`,
                opacity: towerRow(1),
              }}
            >
              <div
                style={{
                  width: 66,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#fff",
                  color: "#0b0c0f",
                  fontWeight: 900,
                  fontSize: 38,
                }}
              >
                1
              </div>
              <div
                style={{
                  flex: 1,
                  padding: "16px 20px",
                  fontWeight: 900,
                  fontSize: name.length > 26 ? 26 : 32,
                  lineHeight: 1.12,
                  letterSpacing: 1,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {name || tag}
              </div>
              {yr ? (
                <div
                  style={{
                    padding: "0 20px",
                    display: "flex",
                    alignItems: "center",
                    fontWeight: 900,
                    fontSize: 34,
                    color: YELLOW,
                    fontVariantNumeric: "tabular-nums",
                    background: "rgba(255,255,255,0.05)",
                  }}
                >
                  {yr}
                </div>
              ) : null}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "14px 18px 16px",
              background: "rgba(14,16,20,0.94)",
              borderTop: "2px solid rgba(255,255,255,0.08)",
              opacity: towerRow(2),
            }}
          >
            {["#b44dff", GREEN, YELLOW].map((c, i) => (
              <div key={i} style={{ flex: 1 }}>
                <div
                  style={{
                    fontWeight: 900,
                    fontSize: 22,
                    letterSpacing: 2,
                    color: "rgba(255,255,255,0.7)",
                    marginBottom: 6,
                  }}
                >
                  S{i + 1}
                </div>
                <div
                  style={{
                    height: 12,
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.12)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${sectors[i]! * 100}%`,
                      height: "100%",
                      background: c,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {/* The finish-line banner. */}
      <div
        style={{
          position: "absolute",
          left: -40,
          right: -40,
          top: 560,
          transform: `translateX(${(1 - banner) * 2100}px) rotate(-1.2deg)`,
          boxShadow: "0 30px 80px rgba(0,0,0,0.65)",
        }}
      >
        <Checker rows={2} size={26} offset={frame * -2} />
        <div
          style={{
            background: "#f7f7f3",
            padding: "18px 136px 20px",
            minHeight: 150,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: size,
              lineHeight: 1.02,
              color: "#0b0c0f",
              textAlign: "center",
              transform: "skewX(-10deg)",
              textWrap: "balance",
              letterSpacing: 1,
            }}
          >
            {title}
          </div>
        </div>
        <Checker rows={2} size={26} offset={frame * 2} />
      </div>
      <Speedo
        sweep={sweep}
        frame={frame}
        show={interpolate(frame, [GREEN_AT - 8, GREEN_AT], [0, 1], clamp)}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */

const PALETTE = [
  "#e10600",
  "#00d2be",
  "#ff8700",
  "#0090ff",
  "#b44dff",
  "#22c55e",
];

function timingRows(g: GfxProps["g"]) {
  const rows = rankedRows(g.items);
  return rows.length === g.items.filter((x) => x.trim()).length ? rows : [];
}

const fitsTiming = (g: GfxProps["g"]) => {
  const rows = timingRows(g);
  return (
    rows.length >= 2 &&
    rows.length <= 6 &&
    rows.every((r) => r.label.length <= 28 && r.fig.text.length <= 15) &&
    clean(g.primary).length <= 40 &&
    clean(g.secondary).length <= 40
  );
};

/** Ranked figures as a timing tower over the picture: positions, a team stripe, the leader lit up. */
const Timing: React.FC<GfxProps> = ({ g, len, variant = 0 }) => {
  const rows = timingRows(g);
  const { frame, fps, dim, visible } = useStage(
    len,
    Math.max(170, 90 + rows.length * 16),
  );
  if (!visible || !fitsTiming(g)) return null;
  const head = clean(g.primary).toUpperCase();
  const foot = clean(g.secondary).toUpperCase();
  const longLabel = Math.max(...rows.map((r) => r.label.length));
  const size = longLabel > 22 || rows.length > 5 ? 36 : 42;
  const rowH = rows.length > 5 ? 92 : 104;
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const count = interpolate(frame, [12, 42], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const lit = interpolate(frame, [30, 38], [0, 1], clamp);
  const sweep = interpolate(frame, [30, 46], [-30, 130], clamp);
  return (
    <AbsoluteFill style={{ opacity: dim, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(4,5,8,0.92) 0%, rgba(4,5,8,0.78) 45%, rgba(4,5,8,0.15) 80%, rgba(4,5,8,0) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 150,
          width: 1100,
          fontFamily: BODY,
          color: "#fff",
          transform: `translateX(${(1 - enter) * -200}px)`,
          opacity: enter,
        }}
      >
        {head ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "16px 26px",
              background: "#e10600",
              fontWeight: 900,
              fontSize: 36,
              letterSpacing: 4,
            }}
          >
            {head}
          </div>
        ) : null}
        {rows.map((r, i) => {
          const s = spring({
            frame: frame - 6 - i * 4,
            fps,
            config: SPRING.SNAP,
          });
          const lead = i === 0;
          return (
            <div
              key={i}
              style={{
                height: rowH,
                display: "flex",
                alignItems: "center",
                background: lead
                  ? `linear-gradient(90deg, rgba(255,212,0,${0.95 * lit}) 0%, rgba(255,212,0,${0.95 * lit}) 100%), rgba(14,16,20,0.94)`
                  : i % 2
                    ? "rgba(20,22,27,0.94)"
                    : "rgba(14,16,20,0.94)",
                borderTop: "2px solid rgba(255,255,255,0.06)",
                opacity: s,
                transform: `translateX(${(1 - s) * -80}px)`,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: 84,
                  alignSelf: "stretch",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: lead ? "#0b0c0f" : "#ffffff",
                  color: lead ? YELLOW : "#0b0c0f",
                  fontWeight: 900,
                  fontSize: 42,
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  width: 10,
                  alignSelf: "stretch",
                  background: PALETTE[(i + variant) % PALETTE.length],
                }}
              />
              <div
                style={{
                  flex: 1,
                  padding: "0 26px",
                  fontWeight: 900,
                  fontSize: size,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: lead && lit > 0.5 ? "#0b0c0f" : "#ffffff",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.label}
              </div>
              <div
                style={{
                  padding: "0 28px",
                  fontWeight: 900,
                  fontSize: size,
                  color: lead && lit > 0.5 ? "#0b0c0f" : YELLOW,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  textTransform: "uppercase",
                }}
              >
                {countText(r.fig, count)}
              </div>
              {/* The row's share of the leader's figure, as a thin bar along its foot. */}
              <div
                style={{
                  position: "absolute",
                  left: 94,
                  bottom: 0,
                  height: 6,
                  width: `calc((100% - 94px) * ${((r.fig.scaled / rows[0]!.fig.scaled) * count).toFixed(4)})`,
                  background: lead
                    ? "#0b0c0f"
                    : PALETTE[(i + variant) % PALETTE.length],
                  opacity: lead ? 0.35 : 0.9,
                }}
              />
              {lead ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: `linear-gradient(100deg, transparent ${sweep - 14}%, rgba(255,255,255,0.55) ${sweep}%, transparent ${sweep + 14}%)`,
                  }}
                />
              ) : null}
            </div>
          );
        })}
        {foot ? (
          <div
            style={{
              padding: "14px 26px",
              background: "rgba(14,16,20,0.94)",
              borderTop: "2px solid rgba(255,255,255,0.08)",
              fontWeight: 800,
              fontSize: 26,
              letterSpacing: 3,
              color: "rgba(255,255,255,0.75)",
            }}
          >
            {foot}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const RacingCard = Card;
export const RACING_STYLES: Record<string, GfxStyle> = {
  Timing: { kind: "bars", component: Timing, fits: fitsTiming, sound: "glint" },
};
