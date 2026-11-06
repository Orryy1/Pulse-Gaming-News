// Series motif "fantasy": an old parchment map homage for the high-fantasy role-playing series. The
// parchment unrolls between two wooden rollers, coastlines ink themselves on, a compass rose turns, a
// wax seal stamps down, the heading sits in a book serif and the picture is framed like an illuminated
// plate. Built from scratch: layout, colour, type and motion only.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { useStage } from "../../DocGraphics.tsx";
import type { GfxProps, GfxStyle } from "../../packs/types.ts";
import type { MotifCardProps } from "../types.ts";
import {
  SERIF,
  SERIF_CAPS,
  cardFade,
  clamp,
  easeInOut,
  easeOut,
  rand,
  sizeByLength,
  txt,
  yearRows,
} from "./common.ts";

const INK = "#2c1a0c";
const INK_RED = "#7d2214";
const MAP_INK = "#5e3d1f";
const GOLD =
  "linear-gradient(135deg, #8a5e1c 0%, #f1d27c 28%, #b8862f 52%, #f6dc8f 74%, #8a5e1c 100%)";

/* ------------------------------------------------------------------------------------------------ */
/* Materials                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** A candlelit table: warm dark, a soft pool of light that breathes. */
const Table: React.FC<{ frame: number; seed: number }> = ({ frame, seed }) => {
  const flicker =
    0.9 +
    0.1 *
      rand(seed * 31 + Math.floor(frame / 3)) *
      Math.abs(Math.sin(frame * 0.3));
  return (
    <AbsoluteFill style={{ background: "#120b06" }}>
      <AbsoluteFill
        style={{
          opacity: flicker,
          background:
            "radial-gradient(ellipse 65% 60% at 50% 48%, rgba(150,95,45,0.55) 0%, rgba(70,40,18,0.35) 45%, rgba(0,0,0,0) 80%)",
        }}
      />
    </AbsoluteFill>
  );
};

/** Parchment: warm stock darkening to the edges, a few old stains, burnt borders. */
const Parchment: React.FC<{ w: number; h: number; seed: number }> = ({
  w,
  h,
  seed,
}) => {
  const stains = Array.from({ length: 6 }, (_, i) => {
    const x = Math.round(rand(seed * 19 + i) * 100);
    const y = Math.round(rand(seed * 19 + i + 7) * 100);
    const s = 10 + Math.round(rand(seed * 19 + i + 13) * 16);
    return `radial-gradient(circle at ${x}% ${y}%, rgba(140,95,40,0.16) 0%, rgba(140,95,40,0) ${s}%)`;
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: w,
        height: h,
        background: [
          ...stains,
          "radial-gradient(ellipse 75% 70% at 50% 50%, #efe0b9 0%, #e2c993 58%, #c79f63 88%, #9c7139 100%)",
        ].join(", "),
        boxShadow:
          "inset 0 0 70px rgba(110,66,24,0.55), inset 0 0 16px rgba(80,45,15,0.7)",
      }}
    >
      {/* Faint laid lines of hand-made paper. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(120,80,30,0.05) 0px, rgba(120,80,30,0.05) 1px, transparent 1px, transparent 26px)",
        }}
      />
    </div>
  );
};

/** A wooden roller standing upright (or lying flat), with turned knobs at both ends. */
const Roller: React.FC<{
  x: number;
  y: number;
  len: number;
  flat?: boolean;
}> = ({ x, y, len, flat }) => {
  const T = 46;
  const wood = `linear-gradient(${flat ? 180 : 90}deg, #3a230f 0%, #8d5c2e 30%, #d9aa72 48%, #9a6634 66%, #2f1c0b 100%)`;
  const knob = (k: number) => (
    <div
      key={k}
      style={{
        position: "absolute",
        [flat ? "top" : "left"]: (T - 34) / 2,
        [flat ? "left" : "top"]: k === 0 ? -30 : len - 4,
        width: flat ? 34 : 34,
        height: flat ? 34 : 34,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 35% 35%, #e0b07a 0%, #8a5a2c 45%, #2c1a0a 100%)",
        boxShadow: "0 4px 10px rgba(0,0,0,0.5)",
      }}
    />
  );
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: flat ? len : T,
        height: flat ? T : len,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: wood,
          borderRadius: 10,
          boxShadow: "0 10px 26px rgba(0,0,0,0.55)",
        }}
      />
      {knob(0)}
      {knob(1)}
    </div>
  );
};

/** A closed, wobbly outline through jittered points around an ellipse. */
function shore(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  n = 14,
  wobble = 0.34,
) {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const j = 1 - wobble / 2 + wobble * rand(seed * 29 + i);
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

/** The inked map: two landmasses and an isle with coastal ripples, mountains, waves and a dotted route. */
const InkMap: React.FC<{
  w: number;
  h: number;
  draw: number;
  frame: number;
  seed: number;
  textSide: "left" | "center";
}> = ({ w, h, draw, frame, seed, textSide }) => {
  // Where the land, hills, waves and route go: clear of the heading, the plate and the compass.
  const left = textSide === "left";
  const lands = left
    ? [
        { cx: w * 0.86, cy: h * 0.55, rx: w * 0.2, ry: h * 0.62, n: 18 },
        { cx: w * 0.1, cy: h * 0.06, rx: w * 0.2, ry: h * 0.22, n: 12 },
        { cx: w * 0.42, cy: h * 0.88, rx: w * 0.12, ry: h * 0.1, n: 11 },
        { cx: w * 0.55, cy: h * 0.09, rx: w * 0.05, ry: h * 0.07, n: 9 },
      ]
    : [
        { cx: w * 0.88, cy: h * 0.5, rx: w * 0.2, ry: h * 0.46, n: 16 },
        { cx: w * 0.08, cy: h * 0.42, rx: w * 0.14, ry: h * 0.36, n: 14 },
        { cx: w * 0.5, cy: h * 0.96, rx: w * 0.14, ry: h * 0.09, n: 10 },
      ];
  const peakAt: Array<[number, number, number]> = left
    ? [
        [0.37, 0.87, 1.1],
        [0.405, 0.85, 1.35],
        [0.44, 0.875, 1],
        [0.79, 0.86, 1.2],
        [0.825, 0.83, 1.45],
        [0.86, 0.865, 1.1],
        [0.83, 0.1, 1.2],
        [0.865, 0.08, 1],
      ]
    : [
        [0.84, 0.42, 1.2],
        [0.875, 0.38, 1.45],
        [0.91, 0.43, 1.1],
        [0.86, 0.6, 1.25],
        [0.9, 0.64, 1],
        [0.06, 0.3, 1.2],
        [0.09, 0.27, 1],
      ];
  const waveAt: Array<[number, number]> = left
    ? [
        [0.27, 0.1],
        [0.36, 0.16],
        [0.64, 0.83],
        [0.69, 0.9],
        [0.25, 0.8],
      ]
    : [
        [0.24, 0.2],
        [0.3, 0.27],
        [0.66, 0.78],
        [0.72, 0.84],
        [0.36, 0.82],
        [0.62, 0.16],
      ];
  const paths = lands.map((l, i) =>
    shore(l.cx, l.cy, l.rx, l.ry, seed * 3 + i, l.n),
  );
  const ripples = lands.map((l, i) =>
    shore(l.cx, l.cy, l.rx * 1.07, l.ry * 1.07, seed * 3 + i, l.n),
  );
  const ripples2 = lands.map((l, i) =>
    shore(l.cx, l.cy, l.rx * 1.14, l.ry * 1.14, seed * 3 + i, l.n),
  );
  const jig = (i: number) => (rand(seed * 41 + i) - 0.5) * 0.012;
  const peaks = peakAt.map(([x, y, s], i) => ({
    x: w * (x + jig(i)),
    y: h * y,
    s,
  }));
  const waves = waveAt.map(([x, y], i) => ({
    x: w * (x + jig(i + 20)),
    y: h * y,
  }));
  const [ra, rb, rc] = left
    ? [
        [w * 0.45, h * 0.8],
        [w * 0.6, h * 0.66],
        [w * 0.75, h * 0.78],
      ]
    : [
        [w * 0.8, h * 0.55],
        [w * 0.5, h * 0.78],
        [w * 0.16, h * 0.6],
      ];
  const routeD = `M ${ra![0]} ${ra![1]} Q ${rb![0]} ${rb![1]} ${rc![0]} ${rc![1]}`;
  const xMark = interpolate(frame, [66, 74], [0, 1], clamp);
  const route = interpolate(frame, [26, 70], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const maskId = `routeMask${seed}`;
  return (
    <svg
      width={w}
      height={h}
      style={{ position: "absolute", inset: 0, overflow: "visible" }}
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={w}
          height={h}
        >
          <path
            d={routeD}
            fill="none"
            stroke="#fff"
            strokeWidth={14}
            pathLength={1}
            strokeDasharray={`${route} 1`}
          />
        </mask>
      </defs>
      {paths.map((d, i) => (
        <g key={i}>
          <path
            d={d}
            fill="rgba(150,110,55,0.10)"
            stroke="none"
            opacity={draw}
          />
          <path
            d={ripples2[i]}
            fill="none"
            stroke={MAP_INK}
            strokeWidth={1.4}
            opacity={0.22}
            pathLength={1}
            strokeDasharray={`${draw} 1`}
          />
          <path
            d={ripples[i]}
            fill="none"
            stroke={MAP_INK}
            strokeWidth={1.6}
            opacity={0.32}
            pathLength={1}
            strokeDasharray={`${draw} 1`}
          />
          <path
            d={d}
            fill="none"
            stroke={MAP_INK}
            strokeWidth={3.2}
            opacity={0.75}
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={`${draw} 1`}
          />
        </g>
      ))}
      {peaks.map((p, i) => {
        const o = interpolate(frame, [18 + i * 2, 24 + i * 2], [0, 1], clamp);
        const s = 22 * p.s;
        return (
          <g key={i} opacity={0.75 * o} transform={`translate(${p.x} ${p.y})`}>
            {/* The shaded flank, then the outline and a ridge line. */}
            <path
              d={`M 0 ${-s * 1.2} L ${s} 0 L ${s * 0.2} 0 Z`}
              fill={MAP_INK}
              opacity={0.28}
            />
            <path
              d={`M ${-s} 0 L 0 ${-s * 1.2} L ${s} 0`}
              fill="none"
              stroke={MAP_INK}
              strokeWidth={2.6}
              strokeLinejoin="round"
            />
            <path
              d={`M 0 ${-s * 1.2} L ${s * 0.2} 0`}
              fill="none"
              stroke={MAP_INK}
              strokeWidth={1.4}
            />
          </g>
        );
      })}
      {waves.map((v, i) => (
        <path
          key={i}
          d={`M ${v.x} ${v.y} q 10 -9 20 0 t 20 0`}
          fill="none"
          stroke={MAP_INK}
          strokeWidth={2}
          opacity={
            0.38 * interpolate(frame, [20 + i * 2, 28 + i * 2], [0, 1], clamp)
          }
        />
      ))}
      <path
        d={routeD}
        fill="none"
        stroke={INK_RED}
        strokeWidth={4}
        strokeDasharray="2 14"
        strokeLinecap="round"
        opacity={0.8}
        mask={`url(#${maskId})`}
      />
      <circle
        cx={ra![0]}
        cy={ra![1]}
        r={7}
        fill={INK_RED}
        opacity={0.85 * Math.min(1, route * 8)}
      />
      <g
        transform={`translate(${rc![0]} ${rc![1]}) scale(${0.5 + 0.5 * xMark})`}
        opacity={xMark}
      >
        <path
          d="M -13 -13 L 13 13 M 13 -13 L -13 13"
          stroke={INK_RED}
          strokeWidth={6}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
};

/** An eight-point compass rose, half-shaded points, a ring of ticks and the north letter. */
const CompassRose: React.FC<{ r: number; turn: number; opacity: number }> = ({
  r,
  turn,
  opacity,
}) => {
  const point = (deg: number, len: number, wid: number, k: string) => {
    const a = ((deg - 90) * Math.PI) / 180;
    const tip = [Math.cos(a) * len, Math.sin(a) * len];
    const l = [
      Math.cos(a - Math.PI / 2) * wid,
      Math.sin(a - Math.PI / 2) * wid,
    ];
    const rr = [
      Math.cos(a + Math.PI / 2) * wid,
      Math.sin(a + Math.PI / 2) * wid,
    ];
    return (
      <g key={k}>
        <polygon
          points={`0,0 ${tip[0]},${tip[1]} ${l[0]},${l[1]}`}
          fill="#3b2410"
        />
        <polygon
          points={`0,0 ${tip[0]},${tip[1]} ${rr[0]},${rr[1]}`}
          fill="#e8d3a4"
          stroke="#3b2410"
          strokeWidth={1.5}
        />
      </g>
    );
  };
  return (
    <svg
      width={r * 2.6}
      height={r * 2.6}
      viewBox={`${-r * 1.3} ${-r * 1.3} ${r * 2.6} ${r * 2.6}`}
      style={{ opacity, overflow: "visible" }}
    >
      <g transform={`rotate(${turn})`}>
        <circle
          r={r * 0.78}
          fill="none"
          stroke="#3b2410"
          strokeWidth={2}
          opacity={0.7}
        />
        <circle
          r={r * 0.7}
          fill="none"
          stroke="#3b2410"
          strokeWidth={1}
          opacity={0.6}
          strokeDasharray="3 6"
        />
        {[45, 135, 225, 315].map((d) => point(d, r * 0.62, r * 0.13, `d${d}`))}
        {[0, 90, 180, 270].map((d) => point(d, r, r * 0.17, `c${d}`))}
        <circle r={r * 0.08} fill="#7d2214" />
        <text
          y={-r * 1.08}
          textAnchor="middle"
          fontFamily={SERIF}
          fontWeight={700}
          fontSize={r * 0.36}
          fill="#3b2410"
        >
          N
        </text>
      </g>
    </svg>
  );
};

/** A wax seal: an irregular red disc, a raised ring, a five-petal rose pressed in, two ribbon tails. */
const WaxSeal: React.FC<{ r: number; land: number; seed: number }> = ({
  r,
  land,
  seed,
}) => {
  const edge = shore(0, 0, r, r, seed + 77, 18, 0.12);
  const star = (rad: number) => [
    ...[0, 72, 144, 216, 288].map((d) => (
      <ellipse
        key={`p${d}`}
        cx={0}
        cy={-rad * 0.52}
        rx={rad * 0.34}
        ry={rad * 0.5}
        fill="#7a1313"
        stroke="#5c0c0c"
        strokeWidth={3}
        transform={`rotate(${d})`}
      />
    )),
    <circle
      key="c"
      r={rad * 0.26}
      fill="#a52626"
      stroke="#5c0c0c"
      strokeWidth={3}
    />,
  ];
  const s = 1.7 - 0.7 * land;
  return (
    <svg
      width={r * 3}
      height={r * 3.4}
      viewBox={`${-r * 1.5} ${-r * 1.5} ${r * 3} ${r * 3.4}`}
      style={{
        overflow: "visible",
        opacity: land > 0.02 ? Math.min(1, land * 1.6) : 0,
        transform: `scale(${s})`,
        filter: "drop-shadow(0 8px 10px rgba(0,0,0,0.45))",
      }}
    >
      <polygon
        points={`${-r * 0.5},${r * 0.4} ${-r * 0.9},${r * 1.85} ${-r * 0.55},${r * 1.6} ${-r * 0.3},${r * 1.9} ${-r * 0.05},${r * 0.5}`}
        fill="#6e1414"
      />
      <polygon
        points={`${r * 0.5},${r * 0.4} ${r * 0.85},${r * 1.85} ${r * 0.5},${r * 1.62} ${r * 0.22},${r * 1.9} ${r * 0.05},${r * 0.5}`}
        fill="#7e1818"
      />
      <path d={edge} fill="#9b1f1f" />
      <circle r={r * 0.74} fill="#8a1a1a" stroke="#b63434" strokeWidth={4} />
      <circle
        r={r * 0.6}
        fill="none"
        stroke="#5c0c0c"
        strokeWidth={3}
        opacity={0.8}
      />
      {star(r * 0.44)}
      <ellipse
        cx={-r * 0.32}
        cy={-r * 0.42}
        rx={r * 0.32}
        ry={r * 0.14}
        fill="rgba(255,190,170,0.25)"
        transform={`rotate(-30 ${-r * 0.32} ${-r * 0.42})`}
      />
    </svg>
  );
};

/** The picture as an illuminated plate: a gilded double frame with corner rosettes. */
const Plate: React.FC<{
  src: string;
  w: number;
  h: number;
  frame: number;
  span: number;
}> = ({ src, w, h, frame, span }) => {
  const push = interpolate(frame, [0, span], [1.04, 1.1], clamp);
  const rosette = (k: string, style: React.CSSProperties) => (
    <svg
      key={k}
      width={46}
      height={46}
      viewBox="-23 -23 46 46"
      style={{ position: "absolute", ...style }}
    >
      <circle r={20} fill="#c99a3e" stroke="#6d4a14" strokeWidth={2} />
      {[0, 45, 90, 135].map((d) => (
        <ellipse
          key={d}
          rx={5}
          ry={16}
          fill="#f2d687"
          stroke="#6d4a14"
          strokeWidth={1.2}
          transform={`rotate(${d})`}
        />
      ))}
      <circle r={5} fill="#7d2214" />
    </svg>
  );
  return (
    <div style={{ position: "relative", width: w, height: h }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: GOLD,
          boxShadow: "0 18px 40px rgba(40,20,5,0.55)",
        }}
      />
      <div style={{ position: "absolute", inset: 10, background: "#3a230f" }} />
      <div style={{ position: "absolute", inset: 14, background: GOLD }} />
      <div
        style={{
          position: "absolute",
          inset: 20,
          overflow: "hidden",
          background: "#1d1208",
        }}
      >
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${push})`,
            filter: "sepia(0.3) saturate(0.9) contrast(1.05)",
          }}
        />
        <AbsoluteFill
          style={{ boxShadow: "inset 0 0 40px rgba(40,20,5,0.6)" }}
        />
      </div>
      {rosette("tl", { left: -14, top: -14 })}
      {rosette("tr", { right: -14, top: -14 })}
      {rosette("bl", { left: -14, bottom: -14 })}
      {rosette("br", { right: -14, bottom: -14 })}
    </div>
  );
};

/** A gilt round medallion around a picture. */
const Medallion: React.FC<{ src: string; d: number }> = ({ src, d }) => (
  <div
    style={{
      position: "relative",
      width: d,
      height: d,
      borderRadius: "50%",
      background: GOLD,
      boxShadow: "0 12px 30px rgba(40,20,5,0.55)",
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 8,
        borderRadius: "50%",
        background: "#3a230f",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 12,
        borderRadius: "50%",
        overflow: "hidden",
      }}
    >
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "sepia(0.35) saturate(0.85)",
        }}
      />
    </div>
  </div>
);

/** A drawn divider: two rules and a diamond. */
const Flourish: React.FC<{
  width: number;
  draw: number;
  colour?: string;
  align?: "left" | "center";
}> = ({ width, draw, colour = INK_RED, align = "left" }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      justifyContent: align === "center" ? "center" : "flex-start",
      width,
    }}
  >
    <div
      style={{
        height: 2,
        width: (width / 2 - 24) * draw,
        background: colour,
        opacity: 0.8,
      }}
    />
    <div
      style={{
        width: 14,
        height: 14,
        background: colour,
        transform: `rotate(45deg) scale(${draw})`,
      }}
    />
    <div
      style={{
        height: 2,
        width: (width / 2 - 24) * draw,
        background: colour,
        opacity: 0.8,
      }}
    />
  </div>
);

/* ------------------------------------------------------------------------------------------------ */
/* The card                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

const PX = 150;
const PY = 110;
const PW = 1620;
const PH = 860;

export const FantasyCard: React.FC<MotifCardProps> = ({
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
  const title = txt(heading);
  const k = txt(kicker).toUpperCase();
  const sub = [txt(game), txt(year)].filter(Boolean).join("  ·  ");
  const pics = pictures.filter(Boolean);
  const hasPlate = Boolean(pics[0]);
  const fade = cardFade(frame, frames, 4, 10);
  const unroll = interpolate(frame, [0, 14], [0.06, 1], {
    ...clamp,
    easing: easeOut,
  });
  const draw = interpolate(frame, [8, 40], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  const write = interpolate(frame, [12, 28], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const plateIn = spring({
    frame: frame - 14,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.9 },
  });
  const medIn = spring({
    frame: frame - 22,
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.7 },
  });
  const seal = spring({
    frame: frame - 30,
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.8 },
  });
  const turn =
    -150 *
      (1 -
        spring({
          frame: frame - 6,
          fps,
          config: { damping: 20, stiffness: 40, mass: 1.2 },
        })) +
    3 * Math.sin(frame * 0.05);
  const cam = interpolate(frame, [0, Math.max(1, frames)], [1, 1.04], clamp);
  const size = sizeByLength(title.length, [
    [12, 112],
    [22, 92],
    [34, 76],
    [52, 62],
    [999, 54],
  ]);
  const textW = hasPlate ? 820 : 1180;
  const textLeft = hasPlate ? 120 : (PW - textW) / 2;
  const align = hasPlate ? "left" : "center";
  const half = (PW / 2) * unroll;
  return (
    <AbsoluteFill style={{ opacity: fade, overflow: "hidden" }}>
      <Table frame={frame} seed={variant + 1} />
      <AbsoluteFill style={{ transform: `scale(${cam})` }}>
        <div
          style={{
            position: "absolute",
            left: PX,
            top: PY,
            width: PW,
            height: PH,
            clipPath: `inset(0 ${PW / 2 - half}px 0 ${PW / 2 - half}px)`,
            boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          }}
        >
          <Parchment w={PW} h={PH} seed={variant + 3} />
          <InkMap
            w={PW}
            h={PH}
            draw={draw}
            frame={frame}
            seed={variant + 5}
            textSide={hasPlate ? "left" : "center"}
          />
          <div style={{ position: "absolute", left: 60, bottom: 22 }}>
            <CompassRose
              r={80}
              turn={turn}
              opacity={interpolate(frame, [6, 16], [0, 1], clamp)}
            />
          </div>
          {/* The heading in a book serif, written on left to right. */}
          <div
            style={{
              position: "absolute",
              left: textLeft,
              width: textW,
              top: 0,
              bottom: 110,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: align === "center" ? "center" : "flex-start",
              textAlign: align,
            }}
          >
            {/* A pale cartouche so the map's ink never runs through the words. */}
            <div
              style={{
                position: "absolute",
                left: -90,
                right: -90,
                top: "18%",
                bottom: "12%",
                background:
                  "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(240,226,190,0.88) 0%, rgba(240,226,190,0.7) 55%, rgba(240,226,190,0) 100%)",
                opacity: draw,
              }}
            />
            {k ? (
              <div
                style={{
                  position: "relative",
                  fontFamily: SERIF_CAPS,
                  fontWeight: 700,
                  fontSize: 30,
                  letterSpacing: 8,
                  color: INK_RED,
                  marginBottom: 18,
                  opacity: interpolate(frame, [8, 18], [0, 1], clamp),
                }}
              >
                {k}
              </div>
            ) : null}
            <div
              style={{
                position: "relative",
                clipPath: `inset(-10% ${100 - write * 100}% -10% -5%)`,
                fontFamily: SERIF,
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: size,
                lineHeight: 1.08,
                color: INK,
                textShadow: "0 1px 0 rgba(255,240,200,0.4)",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                paddingBottom: 6,
              }}
            >
              {title}
            </div>
            <div style={{ marginTop: 22, position: "relative" }}>
              <Flourish
                width={hasPlate ? 360 : 460}
                draw={interpolate(frame, [22, 36], [0, 1], {
                  ...clamp,
                  easing: easeOut,
                })}
                align={align}
              />
            </div>
            {sub ? (
              <div
                style={{
                  position: "relative",
                  marginTop: 20,
                  fontFamily: SERIF_CAPS,
                  fontWeight: 700,
                  fontSize: 30,
                  letterSpacing: 4,
                  color: "#5a3b1e",
                  textTransform: "uppercase",
                  opacity: interpolate(frame, [26, 36], [0, 1], clamp),
                }}
              >
                {sub}
              </div>
            ) : null}
          </div>
          {hasPlate ? (
            <div
              style={{
                position: "absolute",
                left: 1000,
                top: 150,
                opacity: plateIn,
                transform: `translateY(${(1 - plateIn) * 40}px) rotate(${1.6 * plateIn}deg)`,
              }}
            >
              <Plate
                src={pics[0]!}
                w={500}
                h={370}
                frame={frame}
                span={Math.max(1, frames)}
              />
            </div>
          ) : null}
          {pics[1] ? (
            <div
              style={{
                position: "absolute",
                left: 1370,
                top: 410,
                opacity: medIn,
                transform: `scale(${0.7 + 0.3 * medIn})`,
              }}
            >
              <Medallion src={pics[1]} d={200} />
            </div>
          ) : null}
          <div
            style={{
              position: "absolute",
              left: !hasPlate ? PW - 300 : pics[1] ? 1010 : 1400,
              top: !hasPlate ? PH - 300 : pics[1] ? 470 : 450,
            }}
          >
            <WaxSeal r={62} land={seal} seed={variant} />
          </div>
        </div>
        <Roller x={PX + PW / 2 - half - 30} y={PY - 24} len={PH + 48} />
        <Roller x={PX + PW / 2 + half - 16} y={PY - 24} len={PH + 48} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------ */
/* The styles: a scroll unrolling downward, rows inked as it passes                                 */
/* ------------------------------------------------------------------------------------------------ */

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

type ScrollRow = { tag: string; text: string };

const ScrollSheet: React.FC<GfxProps & { mode: "timeline" | "list" }> = ({
  g,
  len,
  variant = 0,
  mode,
}) => {
  const rows: ScrollRow[] =
    mode === "timeline"
      ? (yearRows(g.items) ?? [])
          .slice(0, 5)
          .map((r) => ({ tag: r.year, text: r.what }))
      : g.items
          .map((x) => txt(x))
          .filter(Boolean)
          .slice(0, 6)
          .map((text, i) => ({ tag: ROMAN[i]!, text }));
  const { frame, fps, dim, visible, showFor } = useStage(
    len,
    70 + rows.length * 20 + 60,
  );
  if (!visible || rows.length < 2) return null;
  const head = txt(g.primary);
  const longest = Math.max(...rows.map((r) => r.text.length));
  const textSize = longest > 40 ? 34 : 38;
  const rowH = longest > 40 ? 104 : 88;
  const headH = head ? 150 : 40;
  const W = 1200;
  const H = headH + rows.length * rowH + 50;
  const X = (1920 - W) / 2;
  const Y = 130 + (878 - H) / 2;
  const unroll = interpolate(frame, [2, 16 + rows.length * 5], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  const shownH = H * unroll;
  const seal = spring({
    frame: frame - (24 + rows.length * 5),
    fps,
    config: { damping: 12, stiffness: 200, mass: 0.8 },
  });
  const cam = interpolate(frame, [0, showFor], [1, 1.025], clamp);
  const tagW = mode === "timeline" ? 150 : 90;
  return (
    <AbsoluteFill style={{ opacity: dim, overflow: "hidden" }}>
      <Table frame={frame} seed={variant + 1} />
      <AbsoluteFill style={{ transform: `scale(${cam})` }}>
        <div
          style={{
            position: "absolute",
            left: X,
            top: Y,
            width: W,
            height: H,
            clipPath: `inset(0 0 ${H - shownH}px 0)`,
            boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          }}
        >
          <Parchment w={W} h={H} seed={variant + 3} />
          {/* A faint compass rose behind the rows, as on the map. */}
          <div
            style={{
              position: "absolute",
              right: 40,
              top: Math.max(headH, H / 2 - 150),
              opacity: 0.16,
            }}
          >
            <CompassRose r={115} turn={-20 + frame * 0.08} opacity={1} />
          </div>
          <div style={{ position: "absolute", left: 70, right: 70, top: 36 }}>
            {head ? (
              <div style={{ height: headH - 36, textAlign: "center" }}>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontStyle: "italic",
                    fontSize: head.length > 26 ? 52 : 62,
                    lineHeight: 1.1,
                    color: INK,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {head}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <Flourish
                    width={420}
                    draw={interpolate(frame, [8, 20], [0, 1], clamp)}
                    align="center"
                  />
                </div>
              </div>
            ) : null}
            {rows.map((r, i) => {
              const y = headH + i * rowH;
              // A row is inked once the roller has passed it.
              const passed = (shownH - (y + rowH * 0.7)) / 60;
              const ink = Math.max(0, Math.min(1, passed));
              return (
                <div
                  key={i}
                  style={{
                    height: rowH,
                    display: "flex",
                    alignItems: "center",
                    gap: 26,
                    opacity: ink,
                    borderBottom:
                      i < rows.length - 1
                        ? "1px solid rgba(94,61,31,0.25)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      flex: "none",
                      width: tagW,
                      textAlign: "right",
                      fontFamily: SERIF_CAPS,
                      fontWeight: 700,
                      fontSize: mode === "timeline" ? 42 : 38,
                      color: INK_RED,
                    }}
                  >
                    {r.tag}
                  </div>
                  <div
                    style={{
                      flex: "none",
                      width: 12,
                      height: 12,
                      background: INK_RED,
                      transform: "rotate(45deg)",
                      opacity: 0.85,
                    }}
                  />
                  <div
                    style={{
                      fontFamily: SERIF,
                      fontSize: textSize,
                      lineHeight: 1.18,
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
          <div style={{ position: "absolute", right: 30, bottom: 6 }}>
            <WaxSeal r={44} land={seal} seed={variant} />
          </div>
        </div>
        <Roller x={X - 30} y={Y - 34} len={W + 60} flat />
        <Roller x={X - 30} y={Y + shownH - 12} len={W + 60} flat />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Scroll: React.FC<GfxProps> = (p) => (
  <ScrollSheet {...p} mode="timeline" />
);
const ScrollList: React.FC<GfxProps> = (p) => (
  <ScrollSheet {...p} mode="list" />
);

export const FANTASY_STYLES: Record<string, GfxStyle> = {
  /** primary: a 2-4 word heading; items: 2-5 "2011: Skyrim launches" rows. */
  Scroll: {
    kind: "timeline",
    component: Scroll,
    fits: (g) => {
      const rows = yearRows(g.items);
      return (
        !!rows &&
        rows.length >= 2 &&
        rows.length <= 5 &&
        rows.every((r) => r.what.length <= 60) &&
        txt(g.primary).length <= 36
      );
    },
    sound: "pop",
  },
  /** primary: a 2-4 word heading; items: 2-6 short items, numbered in Roman numerals. */
  ScrollList: {
    kind: "list",
    component: ScrollList,
    fits: (g) => {
      const rows = g.items.map((x) => txt(x)).filter(Boolean);
      return (
        rows.length >= 2 &&
        rows.length <= 6 &&
        rows.every((r) => r.length <= 60) &&
        txt(g.primary).length <= 36
      );
    },
    sound: "pop",
  },
};
