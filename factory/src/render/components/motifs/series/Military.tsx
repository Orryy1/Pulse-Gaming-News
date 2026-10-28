// Series motif "military": a mission briefing homage for the military shooters. A manila dossier opens
// on a tactical grid table: a typed briefing page with the heading as the operation name, a stamp with
// the kicker, a paper-clipped photo over a grid map with a route drawing on, and a slow compass tape
// along the top. Built from scratch: layout, colour, type and motion only.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../../brand.ts";
import { BODY, DISPLAY } from "../../fonts.ts";
import { SPRING } from "../../../motion.ts";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  TYPEWRITER,
  cardFade,
  clamp,
  easeInOut,
  easeOut,
  rand,
  sizeByLength,
  txt,
  yearRows,
} from "./common.ts";

const INK = "#1b1a16";
const RED = "#b3261e";
const MANILA = "#cfad72";
const MANILA_IN = "#d9bd87";
const PAPER = "#f2ede1";
const HUD = "rgba(222,232,204,0.9)";

/* ------------------------------------------------------------------------------------------------ */
/* Pieces                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

/** The tactical table: dark olive with a fine and a coarse grid, a lamp's pool of light. */
const GridTable: React.FC<{ frame: number }> = ({ frame }) => (
  <AbsoluteFill style={{ background: "#12160f", overflow: "hidden" }}>
    <AbsoluteFill
      style={{
        backgroundImage:
          "linear-gradient(rgba(180,200,150,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(180,200,150,0.06) 1px, transparent 1px), linear-gradient(rgba(180,200,150,0.14) 2px, transparent 2px), linear-gradient(90deg, rgba(180,200,150,0.14) 2px, transparent 2px)",
        backgroundSize: "40px 40px, 40px 40px, 200px 200px, 200px 200px",
        backgroundPosition: `${-frame * 0.15}px 0px`,
      }}
    />
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse 60% 55% at 50% 45%, rgba(255,236,190,0.10) 0%, rgba(0,0,0,0) 70%), radial-gradient(ellipse 90% 90% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.6) 100%)",
      }}
    />
  </AbsoluteFill>
);

const CARDINAL: Record<number, string> = {
  0: "N",
  45: "NE",
  90: "E",
  135: "SE",
  180: "S",
  225: "SW",
  270: "W",
  315: "NW",
};

/** A HUD heading tape: ticks every 5 degrees, figures every 15, cardinal letters, a caret and readout. */
const Compass: React.FC<{
  heading: number;
  width: number;
  opacity: number;
}> = ({ heading, width, opacity }) => {
  const PPD = 7;
  const span = width / 2 / PPD + 5;
  const first = Math.ceil((heading - span) / 5) * 5;
  const ticks: React.ReactNode[] = [];
  for (let d = first; d <= heading + span; d += 5) {
    const x = width / 2 + (d - heading) * PPD;
    const n = ((d % 360) + 360) % 360;
    const card = CARDINAL[n];
    const major = n % 15 === 0;
    ticks.push(
      <div
        key={d}
        style={{
          position: "absolute",
          left: x - 1,
          top: 0,
          width: 2,
          height: card ? 22 : major ? 16 : 9,
          background: HUD,
        }}
      />,
    );
    if (card || major)
      ticks.push(
        <div
          key={`l${d}`}
          style={{
            position: "absolute",
            left: x - 40,
            width: 80,
            top: 26,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: card ? 900 : 700,
            fontSize: card ? 26 : 22,
            color: card ? "#F5F5F2" : "rgba(222,232,204,0.7)",
            letterSpacing: 1,
          }}
        >
          {card ?? String(n)}
        </div>,
      );
  }
  const shown = String(Math.round(((heading % 360) + 360) % 360)).padStart(
    3,
    "0",
  );
  return (
    <div
      style={{
        position: "absolute",
        left: (1920 - width) / 2,
        top: 40,
        width,
        height: 100,
        opacity,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 0 40px 0",
          overflow: "hidden",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, black 14%, black 86%, transparent 100%)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, black 14%, black 86%, transparent 100%)",
          borderTop: `2px solid rgba(222,232,204,0.35)`,
        }}
      >
        {ticks}
      </div>
      <svg
        width={24}
        height={14}
        style={{ position: "absolute", left: width / 2 - 12, top: -16 }}
      >
        <polygon points="0,0 24,0 12,14" fill={COLOUR.amber} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: width / 2 - 44,
          top: 64,
          width: 88,
          textAlign: "center",
          padding: "2px 0",
          border: `2px solid ${COLOUR.amber}`,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 24,
          letterSpacing: 2,
          color: COLOUR.amber,
          background: "rgba(10,12,8,0.6)",
        }}
      >
        {shown}
      </div>
    </div>
  );
};

/** A closed, wobbly contour around (cx, cy): smooth curves through jittered points. */
function blob(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  n = 9,
) {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const j = 0.78 + 0.44 * rand(seed * 13 + i);
    return [cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j] as const;
  });
  const mid = (i: number) => {
    const p = pts[i % n]!;
    const q = pts[(i + 1) % n]!;
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const;
  };
  const m0 = mid(0);
  let d = `M ${m0[0].toFixed(1)} ${m0[1].toFixed(1)}`;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n]!;
    const m = mid(i);
    d += ` Q ${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`;
  }
  return `${d} Z`;
}

/** A printed grid map: lettered columns, numbered rows, contour hills, a red route drawing on to an X. */
const GridMap: React.FC<{
  w: number;
  h: number;
  draw: number;
  seed: number;
}> = ({ w, h, draw, seed }) => {
  const cols = 6;
  const rows = 4;
  const m = 34;
  const cw = (w - m) / cols;
  const rh = (h - m) / rows;
  const hills = [
    {
      x: m + (w - m) * (0.22 + 0.1 * rand(seed)),
      y: m + (h - m) * 0.32,
      r: (w - m) * 0.17,
    },
    {
      x: m + (w - m) * (0.72 + 0.08 * rand(seed + 1)),
      y: m + (h - m) * 0.68,
      r: (w - m) * 0.2,
    },
  ];
  const start = { x: m + cw * 0.5, y: m + (h - m) * 0.85 };
  const wp1 = {
    x: m + (w - m) * 0.38,
    y: m + (h - m) * (0.6 + 0.1 * rand(seed + 2)),
  };
  const wp2 = { x: m + (w - m) * 0.55, y: m + (h - m) * 0.3 };
  const end = {
    x: m + (w - m) * 0.86,
    y: m + (h - m) * (0.22 + 0.1 * rand(seed + 3)),
  };
  const route = `M ${start.x} ${start.y} L ${wp1.x} ${wp1.y} L ${wp2.x} ${wp2.y} L ${end.x} ${end.y}`;
  const routeLen =
    Math.hypot(wp1.x - start.x, wp1.y - start.y) +
    Math.hypot(wp2.x - wp1.x, wp2.y - wp1.y) +
    Math.hypot(end.x - wp2.x, end.y - wp2.y);
  const xIn = interpolate(draw, [0.92, 1], [0, 1], clamp);
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
      <rect width={w} height={h} fill="#e8e3cf" />
      {hills.map((hl, k) =>
        [1, 0.74, 0.5, 0.27].map((s, i) => (
          <path
            key={`${k}${i}`}
            d={blob(hl.x, hl.y, hl.r * s, hl.r * 0.66 * s, seed * 5 + k)}
            fill={i === 3 ? "rgba(122,140,84,0.22)" : "none"}
            stroke="rgba(122,104,64,0.55)"
            strokeWidth={i === 0 ? 2.4 : 1.6}
          />
        )),
      )}
      {Array.from({ length: cols + 1 }, (_, i) => (
        <line
          key={`c${i}`}
          x1={m + i * cw}
          x2={m + i * cw}
          y1={m}
          y2={h}
          stroke="rgba(40,60,90,0.35)"
          strokeWidth={1.5}
        />
      ))}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line
          key={`r${i}`}
          x1={m}
          x2={w}
          y1={m + i * rh}
          y2={m + i * rh}
          stroke="rgba(40,60,90,0.35)"
          strokeWidth={1.5}
        />
      ))}
      {Array.from({ length: cols }, (_, i) => (
        <text
          key={`ct${i}`}
          x={m + cw * (i + 0.5)}
          y={25}
          textAnchor="middle"
          fontFamily={TYPEWRITER}
          fontWeight={700}
          fontSize={22}
          fill="#3b3a33"
        >
          {"ABCDEF"[i]}
        </text>
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <text
          key={`rt${i}`}
          x={17}
          y={m + rh * (i + 0.5) + 8}
          textAnchor="middle"
          fontFamily={TYPEWRITER}
          fontWeight={700}
          fontSize={22}
          fill="#3b3a33"
        >
          {i + 1}
        </text>
      ))}
      <path
        d={route}
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth={9}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={`${routeLen * draw} ${routeLen}`}
      />
      <path
        d={route}
        fill="none"
        stroke={RED}
        strokeWidth={5}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={`${routeLen * draw} ${routeLen}`}
      />
      <circle
        cx={start.x}
        cy={start.y}
        r={9}
        fill={RED}
        opacity={draw > 0 ? 1 : 0}
      />
      {[wp1, wp2].map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={7}
          fill="#e8e3cf"
          stroke={RED}
          strokeWidth={3}
          opacity={draw > (i + 1) / 3.2 ? 1 : 0}
        />
      ))}
      <g
        transform={`translate(${end.x} ${end.y}) scale(${0.4 + 0.6 * xIn})`}
        opacity={xIn}
      >
        <line
          x1={-16}
          y1={-16}
          x2={16}
          y2={16}
          stroke={RED}
          strokeWidth={7}
          strokeLinecap="round"
        />
        <line
          x1={16}
          y1={-16}
          x2={-16}
          y2={16}
          stroke={RED}
          strokeWidth={7}
          strokeLinecap="round"
        />
        <circle r={26} fill="none" stroke={RED} strokeWidth={3} />
      </g>
    </svg>
  );
};

/** A paper clip, steel, about 30 by 96. */
const PaperClip: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <svg
    width={34}
    height={100}
    viewBox="0 0 34 100"
    style={{ position: "absolute", ...style }}
  >
    <path
      d="M 11 30 V 84 A 6 6 0 0 0 23 84 V 14 A 10 10 0 0 0 3 14 V 78"
      fill="none"
      stroke="#5d6166"
      strokeWidth={5}
      strokeLinecap="round"
    />
    <path
      d="M 11 30 V 84 A 6 6 0 0 0 23 84 V 14 A 10 10 0 0 0 3 14 V 78"
      fill="none"
      stroke="#d7dbe0"
      strokeWidth={2}
      strokeLinecap="round"
    />
  </svg>
);

/** A photographic print with a white border. */
const Print: React.FC<{
  src: string;
  w: number;
  h: number;
  style?: React.CSSProperties;
}> = ({ src, w, h, style }) => (
  <div
    style={{
      position: "absolute",
      width: w,
      height: h,
      padding: 12,
      background: "#f7f5ef",
      boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
      ...style,
    }}
  >
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: "saturate(0.75) contrast(1.08) sepia(0.12)",
      }}
    />
  </div>
);

/** Placeholder typed lines and redaction bars (no invented copy), drawn on left to right. */
const TypedLines: React.FC<{
  n: number;
  seed: number;
  frame: number;
  from: number;
  width: number;
}> = ({ n, seed, frame, from, width }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    {Array.from({ length: n }, (_, i) => {
      const redacted = (i + seed) % 3 === 1;
      const w = (0.55 + 0.4 * rand(seed * 17 + i)) * width;
      const p = interpolate(frame, [from + i * 3, from + i * 3 + 8], [0, 1], {
        ...clamp,
        easing: easeOut,
      });
      return (
        <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              height: redacted ? 24 : 11,
              width: (redacted ? w * 0.5 : w) * p,
              background: redacted ? "#141310" : "rgba(60,56,46,0.32)",
              borderRadius: redacted ? 1 : 5,
            }}
          />
          {redacted ? (
            <div
              style={{
                height: 11,
                width: w * 0.42 * p,
                background: "rgba(60,56,46,0.32)",
                borderRadius: 5,
              }}
            />
          ) : null}
        </div>
      );
    })}
  </div>
);

/** A rubber stamp: a red double border, letter-spaced capitals, landing with a slam. */
const RubberStamp: React.FC<{
  text: string;
  land: number;
  rotate: number;
  size: number;
  style?: React.CSSProperties;
}> = ({ text, land, rotate, size, style }) => (
  <div
    style={{
      position: "absolute",
      padding: "10px 22px",
      border: `6px double ${RED}`,
      borderRadius: 8,
      fontFamily: BODY,
      fontWeight: 900,
      fontSize: size,
      letterSpacing: size * 0.14,
      lineHeight: 1.05,
      color: RED,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      mixBlendMode: "multiply",
      opacity: land > 0.02 ? Math.min(0.9, land * 1.5) : 0,
      transform: `rotate(${rotate}deg) scale(${2.1 - 1.1 * land})`,
      ...style,
    }}
  >
    {text}
  </div>
);

/* ------------------------------------------------------------------------------------------------ */
/* The card                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

const FW = 1440;
const FH = 780;
const HALF = FW / 2;

export const MilitaryCard: React.FC<MotifCardProps> = ({
  heading,
  kicker,
  game,
  year,
  pictures,
  frames,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const title = txt(heading).toUpperCase();
  const k = txt(kicker);
  const g = txt(game);
  const y = txt(year);
  const pics = pictures.filter(Boolean);
  const fade = cardFade(frame, frames, 6, 10);
  const enter = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 150, mass: 0.8 },
  });
  const open = interpolate(frame, [6, 22], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const angle = -180 * open;
  const headIn = spring({ frame: frame - 16, fps, config: SPRING.ENTER });
  const fields = interpolate(frame, [22, 32], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const stamp = spring({
    frame: frame - 30,
    fps,
    config: { damping: 11, stiffness: 180, mass: 0.8 },
  });
  const route = interpolate(frame, [24, 62], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const cam = interpolate(frame, [0, Math.max(1, frames)], [1, 1.045], clamp);
  const heading0 = 20 + 300 * rand(variant + 7);
  const compassHeading =
    heading0 + interpolate(frame, [0, Math.max(1, frames)], [0, 24], clamp);
  const titleSize = sizeByLength(title.length, [
    [12, 100],
    [20, 84],
    [32, 68],
    [48, 56],
    [999, 48],
  ]);
  const tilt = variant % 2 ? 1.2 : -1.2;

  // The inside of the cover: a grid map clipped in, the photo clipped over it.
  const inside = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: MANILA_IN,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0) 85%, rgba(80,50,10,0.25) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 46,
          top: pics.length ? 352 : 90,
          width: 620,
          height: pics.length ? 390 : 640,
          transform: "rotate(1deg)",
          boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
        }}
      >
        <GridMap
          w={620}
          h={pics.length ? 390 : 640}
          draw={route}
          seed={variant + 2}
        />
      </div>
      {pics[1] ? (
        <Print
          src={pics[1]}
          w={250}
          h={176}
          style={{ left: 420, top: 120, transform: "rotate(6deg)" }}
        />
      ) : null}
      {pics[0] ? (
        <>
          <Print
            src={pics[0]}
            w={470}
            h={300}
            style={{ left: 60, top: 54, transform: "rotate(-3deg)" }}
          />
          <PaperClip
            style={{ left: 112, top: 14, transform: "rotate(-3deg)" }}
          />
        </>
      ) : null}
    </div>
  );

  const cover = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `linear-gradient(160deg, #d3b178 0%, ${MANILA} 60%, #c09a5c 100%)`,
        borderRadius: 10,
        boxShadow: "inset 0 0 0 2px rgba(120,80,30,0.25)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 120,
          right: 120,
          top: 300,
          padding: "26px 30px",
          background: "#f4efe2",
          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: TYPEWRITER,
            fontWeight: 700,
            fontSize: 30,
            color: INK,
            textTransform: "uppercase",
            lineHeight: 1.2,
          }}
        >
          {g || k || " "}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 120,
          height: 34,
          background: "rgba(179,38,30,0.75)",
        }}
      />
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity: fade, overflow: "hidden" }}>
      <GridTable frame={frame} />
      <Compass
        heading={compassHeading}
        width={1120}
        opacity={interpolate(frame, [2, 12], [0, 1], clamp)}
      />
      <AbsoluteFill
        style={{ transform: `scale(${cam})`, transformOrigin: "50% 60%" }}
      >
        <div
          style={{
            position: "absolute",
            left: (1920 - FW) / 2,
            top: 200,
            width: FW,
            height: FH,
            perspective: 3200,
            transform: `translate(${(-HALF / 2) * (1 - open)}px, ${(1 - enter) * 90}px) rotate(${tilt}deg)`,
          }}
        >
          {/* The folder's back with its tab, and the briefing page on it. */}
          <div
            style={{
              position: "absolute",
              left: HALF,
              top: 0,
              width: HALF,
              height: FH,
              background: `linear-gradient(200deg, #d6b67e 0%, ${MANILA} 70%)`,
              borderRadius: 10,
              boxShadow: "0 40px 90px rgba(0,0,0,0.6)",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: 40,
                top: -40,
                width: 230,
                height: 48,
                background: "#d6b67e",
                borderRadius: "12px 12px 0 0",
                textAlign: "center",
                fontFamily: TYPEWRITER,
                fontWeight: 700,
                fontSize: 26,
                lineHeight: "44px",
                color: INK,
              }}
            >
              {y}
            </div>
            <div
              style={{
                position: "absolute",
                left: 30,
                top: 28,
                right: 30,
                bottom: 28,
                background: PAPER,
                boxShadow: "0 3px 10px rgba(0,0,0,0.25)",
                padding: "40px 46px",
                transform: "rotate(0.6deg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: `3px solid ${INK}`,
                  paddingBottom: 12,
                }}
              >
                <div
                  style={{
                    fontFamily: TYPEWRITER,
                    fontWeight: 700,
                    fontSize: 26,
                    letterSpacing: 6,
                    color: RED,
                  }}
                >
                  BRIEFING
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {Array.from({ length: 14 }, (_, i) => (
                    <div
                      key={i}
                      style={{
                        width: 2 + Math.round(rand(variant * 3 + i) * 5),
                        height: 30,
                        background: INK,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div
                style={{
                  marginTop: 24,
                  fontFamily: TYPEWRITER,
                  fontWeight: 700,
                  fontSize: 24,
                  letterSpacing: 4,
                  color: "#5c574b",
                  opacity: headIn,
                }}
              >
                {/^OPERATION\b/.test(title) ? "\u00A0" : "OPERATION"}
              </div>
              <div style={{ overflow: "hidden", marginTop: 6 }}>
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: titleSize,
                    lineHeight: 1.02,
                    color: INK,
                    transform: `translateY(${(1 - headIn) * 105}%)`,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {title}
                </div>
              </div>
              {g || y ? (
                <div
                  style={{
                    marginTop: 24,
                    opacity: fields,
                    fontFamily: TYPEWRITER,
                    fontWeight: 700,
                    fontSize: 28,
                    lineHeight: 1.3,
                    color: INK,
                  }}
                >
                  {g ? (
                    <div style={{ display: "flex", gap: 16 }}>
                      <span style={{ color: "#6b6457", flex: "none", width: 132 }}>
                        SUBJECT
                      </span>
                      <span style={{ textTransform: "uppercase" }}>{g}</span>
                    </div>
                  ) : null}
                  {y ? (
                    <div style={{ display: "flex", gap: 16 }}>
                      <span style={{ color: "#6b6457", flex: "none", width: 132 }}>
                        YEAR
                      </span>
                      <span>{y}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div style={{ marginTop: 30 }}>
                <TypedLines
                  n={Math.max(3, (g || y ? 6 : 8) - (titleSize <= 56 ? 2 : titleSize <= 68 ? 1 : 0))}
                  seed={variant + 1}
                  frame={frame}
                  from={24}
                  width={560}
                />
              </div>
              <RubberStamp
                text={k || "CLASSIFIED"}
                land={stamp}
                rotate={-9}
                size={(k || "CLASSIFIED").length > 14 ? 34 : 42}
                style={{ right: 36, bottom: 48 }}
              />
            </div>
          </div>
          {/* The cover, swinging open about the spine: its inside lands on the left. */}
          <div
            style={{
              position: "absolute",
              left: HALF,
              top: 0,
              width: HALF,
              height: FH,
              transformOrigin: "0% 50%",
              transformStyle: "preserve-3d",
              transform: `rotateY(${angle}deg)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                backfaceVisibility: "hidden",
              }}
            >
              {cover}
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              {inside}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* The style: objectives with tick boxes, or a dated log                                            */
/* ------------------------------------------------------------------------------------------------ */

type Row = { tag: string; text: string };

const listRows = (items: string[]): Row[] =>
  items
    .map((x) => txt(x))
    .filter(Boolean)
    .slice(0, 6)
    .map((text, i) => ({ tag: String(i + 1).padStart(2, "0"), text }));

const logRows = (items: string[]): Row[] =>
  (yearRows(items) ?? [])
    .slice(0, 5)
    .map((r) => ({ tag: r.year, text: r.what }));

const BriefingSheet: React.FC<GfxProps & { mode: "list" | "timeline" }> = ({
  g,
  len,
  variant = 0,
  src,
  mode,
}) => {
  const rows = mode === "list" ? listRows(g.items) : logRows(g.items);
  const { frame, fps, dim, visible, showFor } = useStage(
    len,
    60 + rows.length * 22 + 60,
  );
  if (!visible || rows.length < 2) return null;
  const head = txt(g.primary).toUpperCase();
  const label = mode === "list" ? "OBJECTIVES" : "MISSION LOG";
  const enter = spring({
    frame,
    fps,
    config: { damping: 17, stiffness: 140, mass: 0.8 },
  });
  const longest = Math.max(...rows.map((r) => r.text.length));
  const textSize = longest > 44 ? 32 : 36;
  const rowH = longest > 34 ? 104 : 84;
  const headSize = sizeByLength(head.length, [
    [16, 76],
    [26, 64],
    [999, 54],
  ]);
  const pageW = 1080;
  const pageX = 170;
  const pageH = 40 + 44 + 18 + Math.ceil(headSize * 1.06) + 22 + rows.length * rowH + 46;
  const stamp = spring({ frame: frame - 34, fps, config: { damping: 11, stiffness: 180, mass: 0.8 } });
  const route = interpolate(frame, [18, 60], [0, 1], { ...clamp, easing: easeInOut });
  const pageY = 130 + (878 - pageH) / 2;
  const cam = interpolate(frame, [0, showFor], [1, 1.03], clamp);
  const tilt = variant % 2 ? 0.8 : -0.8;
  return (
    <AbsoluteFill style={{ opacity: dim }}>
      <GridTable frame={frame} />
      <AbsoluteFill style={{ transform: `scale(${cam})` }}>
        {/* The folder's back peeking out behind the sheet. */}
        <div
          style={{
            position: "absolute",
            left: pageX - 26,
            top: pageY - 22,
            width: pageW + 52,
            height: pageH + 44,
            background: MANILA,
            borderRadius: 10,
            boxShadow: "0 40px 90px rgba(0,0,0,0.55)",
            transform: `translateY(${(1 - enter) * 120}px) rotate(${-tilt}deg)`,
            opacity: enter,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: pageX,
            top: pageY,
            width: pageW,
            height: pageH,
            background: PAPER,
            padding: "40px 56px",
            boxShadow: "0 6px 16px rgba(0,0,0,0.3)",
            transform: `translateY(${(1 - enter) * 160}px) rotate(${tilt}deg)`,
            opacity: enter,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              borderBottom: `3px solid ${INK}`,
              paddingBottom: 10,
            }}
          >
            <div
              style={{
                fontFamily: TYPEWRITER,
                fontWeight: 700,
                fontSize: 26,
                letterSpacing: 6,
                color: RED,
              }}
            >
              {label}
            </div>
          </div>
          <RubberStamp text="CLASSIFIED" land={stamp} rotate={-7} size={32} style={{ right: 120, top: 14 }} />
          <div
            style={{
              marginTop: 18,
              fontFamily: DISPLAY,
              fontSize: headSize,
              lineHeight: 1.06,
              color: INK,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              opacity: interpolate(frame, [6, 16], [0, 1], clamp),
            }}
          >
            {head}
          </div>
          <div style={{ marginTop: 22 }}>
            {rows.map((r, i) => {
              const at = 14 + i * 8;
              const s = spring({
                frame: frame - at,
                fps,
                config: SPRING.ENTER,
              });
              const tick = interpolate(frame, [at + 16, at + 26], [0, 1], {
                ...clamp,
                easing: easeOut,
              });
              return (
                <div
                  key={i}
                  style={{
                    height: rowH,
                    display: "flex",
                    alignItems: "center",
                    gap: 26,
                    borderBottom:
                      i < rows.length - 1
                        ? "2px dashed rgba(27,26,22,0.22)"
                        : "none",
                    opacity: s,
                    transform: `translateX(${(1 - s) * -40}px)`,
                  }}
                >
                  {mode === "list" ? (
                    <svg width={52} height={52} style={{ flex: "none" }}>
                      <rect
                        x={3}
                        y={3}
                        width={46}
                        height={46}
                        fill="none"
                        stroke={INK}
                        strokeWidth={4}
                      />
                      <path
                        d="M 10 27 L 22 39 L 46 8"
                        fill="none"
                        stroke={RED}
                        strokeWidth={7}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray={`${62 * tick} 62`}
                      />
                    </svg>
                  ) : null}
                  <div
                    style={{
                      flex: "none",
                      minWidth: mode === "list" ? 56 : 120,
                      padding: mode === "list" ? 0 : "4px 12px",
                      background: mode === "list" ? "transparent" : INK,
                      color: mode === "list" ? "#6b6457" : PAPER,
                      fontFamily: TYPEWRITER,
                      fontWeight: 700,
                      fontSize: 32,
                      textAlign: "center",
                    }}
                  >
                    {r.tag}
                  </div>
                  <div
                    style={{
                      fontFamily: BODY,
                      fontWeight: 800,
                      fontSize: textSize,
                      lineHeight: 1.15,
                      color: INK,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {r.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Clipped to the sheet's edge: the sentence's picture, or a grid map when there is none. */}
        <div
          style={{
            position: "absolute",
            left: pageX + pageW - 60,
            top: pageY + 30,
            opacity: enter,
            transform: `translateX(${(1 - enter) * 120}px)`,
          }}
        >
          {src ? (
            <Print src={src} w={520} h={350} style={{ left: 0, top: 0, transform: "rotate(3deg)" }} />
          ) : (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 520,
                height: 380,
                transform: "rotate(3deg)",
                boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
              }}
            >
              <GridMap w={520} h={380} draw={route} seed={variant + 4} />
            </div>
          )}
          <PaperClip style={{ left: 60, top: -40, transform: "rotate(3deg)" }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Briefing: React.FC<GfxProps> = (p) => (
  <BriefingSheet {...p} mode="list" />
);
const BriefingLog: React.FC<GfxProps> = (p) => (
  <BriefingSheet {...p} mode="timeline" />
);

export const MILITARY_STYLES: Record<string, GfxStyle> = {
  /** primary: a 2-4 word heading; items: 2-6 short objectives. */
  Briefing: {
    kind: "list",
    component: Briefing,
    fits: (g) => {
      const rows = g.items.map((x) => txt(x)).filter(Boolean);
      return (
        rows.length >= 2 &&
        rows.length <= 6 &&
        rows.every((r) => r.length <= 56) &&
        txt(g.primary).length <= 34
      );
    },
    sound: "stamp",
  },
  /** primary: a 2-4 word heading; items: 2-5 "2013: GTA V launches" rows. */
  BriefingLog: {
    kind: "timeline",
    component: BriefingLog,
    fits: (g) => {
      const rows = yearRows(g.items);
      return (
        !!rows &&
        rows.length >= 2 &&
        rows.length <= 5 &&
        rows.every((r) => r.what.length <= 52) &&
        txt(g.primary).length <= 34
      );
    },
    sound: "stamp",
  },
};
