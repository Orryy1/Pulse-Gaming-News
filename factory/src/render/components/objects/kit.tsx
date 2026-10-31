// The shared finish of the drawn scenes (./Objects.tsx, ./Silhouettes.tsx), after the Pulse console reveal
// (../packs/pulse/PulseConsole.tsx): a lit grey room with a warm pool of light on the surface, an amber spot
// behind the subject, a rim light and a soft halo on what matters, a slow camera push that settles, and the
// ILLUSTRATION tag bottom right. The faceless figure of the silhouette scenes lives here too: flat, two-tone,
// built from a circle and rounded strokes, so it reads as "a person" and never as anyone. Every value is a
// pure function of the frame and the props; the filters are bounded and few, so a long render is not slowed.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLOUR } from "../../brand.ts";
import { IllustrationMark } from "../packs/pulse/handset.tsx";
import { clamp, easeInOut, easeOut, rand } from "../packs/screen/common.ts";

export { clamp, easeInOut, easeOut, rand };

/** Props every drawn scene takes. */
export interface SceneProps {
  /** Frames the shot lasts. */
  len: number;
  /** The year the scene is set in (the chooser's), for the era's hardware. */
  year?: number;
  /** Rotates small choices (layout, colourway) so two of one scene never look identical. */
  variant?: number;
  /** A picture of the chapter's game, for a disc print or a box cover. */
  src?: string;
  /** A month the sentence names (the calendar's header only). */
  month?: string;
}

/**
 * The scene's clock: the frame, and `at(a, b)`, a 0-1 ramp between two frames of a full-length shot. A short
 * shot plays the same build faster (never under half the length), so it still settles with time to read.
 */
export function useScene(len: number) {
  const frame = useCurrentFrame();
  const k = Math.min(1, Math.max(0.5, len / 130));
  const at = (a: number, b: number, ease: (x: number) => number = easeOut) =>
    ease(interpolate(frame, [a * k, b * k], [0, 1], clamp));
  return { frame, k, at };
}

/** A smooth 0-1 number that wanders with the frame, for idle motion (a needle, a flicker). */
export function wobble(frame: number, seed: number, speed = 0.08): number {
  const a = Math.sin(frame * speed + seed * 1.7);
  const b = Math.sin(frame * speed * 2.3 + seed * 3.1);
  return 0.5 + 0.3 * a + 0.2 * b;
}

/** Filters and room gradients, with ids under `p` so two scenes on screen at once never share them. */
export const SceneDefs: React.FC<{ p: string; cx: number; cy: number }> = ({
  p,
  cx,
  cy,
}) => (
  <defs>
    <filter id={`${p}-glow`} x="-200%" y="-200%" width="500%" height="500%">
      <feGaussianBlur stdDeviation={6} />
    </filter>
    <filter id={`${p}-soft`} x="-30%" y="-80%" width="160%" height="260%">
      <feGaussianBlur stdDeviation={14} />
    </filter>
    <filter id={`${p}-blur`} x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation={28} />
    </filter>
    {/* Rim light: the silhouette grown a few px, lit warm and nudged upward, drawn under the body. */}
    <filter id={`${p}-rim`} x="-10%" y="-10%" width="120%" height="120%">
      <feMorphology in="SourceAlpha" operator="dilate" radius={3} result="d" />
      <feOffset in="d" dy={-3} result="o" />
      <feFlood floodColor="#ffe2bf" floodOpacity={0.85} />
      <feComposite in2="o" operator="in" result="rim" />
      <feGaussianBlur in="rim" stdDeviation={1.4} />
    </filter>
    {/* A wide soft halo behind the silhouette, so a dark shape stands off the backdrop. */}
    <filter id={`${p}-halo`} x="-20%" y="-20%" width="140%" height="140%">
      <feMorphology in="SourceAlpha" operator="dilate" radius={6} result="d" />
      <feFlood floodColor="#ffd1a0" floodOpacity={0.45} />
      <feComposite in2="d" operator="in" result="h" />
      <feGaussianBlur in="h" stdDeviation={22} />
    </filter>
    <radialGradient
      id={`${p}-room`}
      cx={cx / 1920}
      cy={cy / 1080}
      r={0.7}
      gradientUnits="objectBoundingBox"
    >
      <stop offset="0" stopColor="#40414a" />
      <stop offset="0.5" stopColor="#26272d" />
      <stop offset="1" stopColor="#141519" />
    </radialGradient>
    <linearGradient id={`${p}-floor`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#48464d" />
      <stop offset="0.45" stopColor="#2d2c32" />
      <stop offset="1" stopColor="#18181c" />
    </linearGradient>
    <radialGradient id={`${p}-pool`}>
      <stop offset="0" stopColor="#ffb878" stopOpacity={0.42} />
      <stop offset="0.6" stopColor="#ffb878" stopOpacity={0.12} />
      <stop offset="1" stopColor="#ffb878" stopOpacity={0} />
    </radialGradient>
    <radialGradient id={`${p}-spot`}>
      <stop offset="0" stopColor={COLOUR.amber} stopOpacity={0.2} />
      <stop offset="0.55" stopColor={COLOUR.amber} stopOpacity={0.06} />
      <stop offset="1" stopColor={COLOUR.amber} stopOpacity={0} />
    </radialGradient>
    <radialGradient id={`${p}-warm`}>
      <stop offset="0" stopColor="#ffd9a8" stopOpacity={0.55} />
      <stop offset="0.5" stopColor="#ffb878" stopOpacity={0.16} />
      <stop offset="1" stopColor="#ffb878" stopOpacity={0} />
    </radialGradient>
    <linearGradient id={`${p}-front`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#232328" />
      <stop offset="1" stopColor="#111114" />
    </linearGradient>
    <linearGradient id={`${p}-vignette`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#000" stopOpacity={0.35} />
      <stop offset="0.25" stopColor="#000" stopOpacity={0} />
      <stop offset="0.8" stopColor="#000" stopOpacity={0} />
      <stop offset="1" stopColor="#000" stopOpacity={0.45} />
    </linearGradient>
  </defs>
);

/**
 * The room: the lit grey backdrop above `surface`, the surface (a desk top or a floor) below it with a lit
 * edge, the warm pool and the amber spot round the subject at (cx, cy).
 */
export const Room: React.FC<{
  p: string;
  surface: number;
  cx: number;
  cy: number;
  /** A desk has a front face below its top; a floor runs to the bottom. */
  deskFront?: number;
  pool?: { rx: number; ry: number };
  /** 0-1: how lit the room is (a late-night scene is darker). */
  light?: number;
}> = ({ p, surface, cx, cy, deskFront, pool, light = 1 }) => (
  <g>
    <rect width={1920} height={1080} fill={`url(#${p}-room)`} />
    <circle cx={cx} cy={cy} r={720} fill={`url(#${p}-spot)`} opacity={light} />
    <rect
      x={0}
      y={surface}
      width={1920}
      height={(deskFront ?? 1080) - surface}
      fill={`url(#${p}-floor)`}
    />
    <line
      x1={0}
      x2={1920}
      y1={surface}
      y2={surface}
      stroke="#5d5b62"
      strokeWidth={2}
    />
    {deskFront !== undefined && (
      <g>
        <rect
          x={0}
          y={deskFront}
          width={1920}
          height={1080 - deskFront}
          fill={`url(#${p}-front)`}
        />
        <line
          x1={0}
          x2={1920}
          y1={deskFront}
          y2={deskFront}
          stroke="#77737a"
          strokeOpacity={0.7}
          strokeWidth={3}
        />
      </g>
    )}
    <ellipse
      cx={cx}
      cy={surface + ((deskFront ?? 1080) - surface) * 0.42}
      rx={pool?.rx ?? 760}
      ry={pool?.ry ?? 120}
      fill={`url(#${p}-pool)`}
      opacity={light}
    />
  </g>
);

/** Draws its children three times: a soft halo, a warm rim light, then the body itself. */
export const Lit: React.FC<{
  p: string;
  children: React.ReactNode;
  halo?: boolean;
}> = ({ p, children, halo = true }) => (
  <g>
    {halo && <g filter={`url(#${p}-halo)`}>{children}</g>}
    <g filter={`url(#${p}-rim)`}>{children}</g>
    {children}
  </g>
);

/** A soft contact shadow under an object standing on a surface. */
export const Shadow: React.FC<{
  p: string;
  cx: number;
  cy: number;
  rx: number;
  ry?: number;
  o?: number;
}> = ({ p, cx, cy, rx, ry = 18, o = 0.55 }) => (
  <ellipse
    cx={cx}
    cy={cy}
    rx={rx}
    ry={ry}
    fill="#000"
    opacity={o}
    filter={`url(#${p}-soft)`}
  />
);

/**
 * The frame every scene draws in: an ink ground, the scene's SVG under a slow camera push that settles by
 * frame 40 and then drifts a little, a vignette, and the ILLUSTRATION tag.
 */
export const SceneFrame: React.FC<{
  p: string;
  len: number;
  /** Where the camera pushes towards. */
  cx: number;
  cy: number;
  children: React.ReactNode;
  /** HTML laid over the drawing (rarely: the calendar's numbers are SVG text too). */
  over?: React.ReactNode;
}> = ({ p, len, cx, cy, children, over }) => {
  const frame = useCurrentFrame();
  const push = easeOut(interpolate(frame, [0, 40], [0, 1], clamp));
  const drift = interpolate(frame, [40, Math.max(41, len)], [0, 1], clamp);
  const s = 1.06 - 0.06 * push + 0.018 * drift;
  const tagIn = interpolate(frame, [14, 24], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      <svg
        width={1920}
        height={1080}
        viewBox="0 0 1920 1080"
        style={{ position: "absolute", inset: 0 }}
      >
        <SceneDefs p={p} cx={cx} cy={cy} />
        <g
          transform={`translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`}
        >
          {children}
        </g>
        <rect width={1920} height={1080} fill={`url(#${p}-vignette)`} />
      </svg>
      {over}
      <IllustrationMark opacity={tagIn} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- the figure

/** Figure tones: the body, the far limbs a shade darker, and an accent for the scene's key figure. */
export const TONE = {
  body: "#1a1b20",
  shade: "#0f1013",
  hair: "#0c0c0f",
  accent: COLOUR.amber,
  lightBody: "#3a3b43",
  lightShade: "#2c2d34",
} as const;

export type Arm = [shoulder: number, elbow: number];

export interface Pose {
  /** Seated on a chair of seat height 110 (local units), or standing. */
  sit?: boolean;
  /** Arm angles in degrees from hanging straight down, positive swinging forward (the facing side). */
  near?: Arm;
  far?: Arm;
  /** Walk phase in radians (legs and arms swing); undefined stands still. */
  walk?: number;
  /** Head tilt in degrees (a nod is a small positive tilt). */
  head?: number;
  /** Whole-body lean forward in degrees. */
  lean?: number;
  /** Seen from the front or from behind (the flat figure is the same both ways): arms at the shoulders' edges,
   *  `near` the right arm and `far` the left, angles swinging outward; legs straight. */
  front?: boolean;
}

/** A hair or headwear shape by index, so a crowd varies without anyone being drawn. */
export type Hair = 0 | 1 | 2 | 3 | 4;

const UPPER = 74;
const FORE = 70;
const SHOULDER_Y = -292;
const HIP_Y = -158;

function armPath(sx: number, sy: number, [sh, el]: Arm, dir: number): string {
  const a = (sh * Math.PI) / 180;
  const ex = sx + dir * UPPER * Math.sin(a);
  const ey = sy + UPPER * Math.cos(a);
  const b = ((sh + el) * Math.PI) / 180;
  const hx = ex + dir * FORE * Math.sin(b);
  const hy = ey + FORE * Math.cos(b);
  return `M${sx} ${sy} L${ex.toFixed(1)} ${ey.toFixed(1)} L${hx.toFixed(1)} ${hy.toFixed(1)}`;
}

/** Where a figure's near hand is, in local units, for props held or hands meeting. */
export function handAt(arm: Arm, dir = 1, sit = false): [number, number] {
  const sy = SHOULDER_Y + (sit ? 48 : 0);
  const a = (arm[0] * Math.PI) / 180;
  const b = ((arm[0] + arm[1]) * Math.PI) / 180;
  return [
    dir * (14 + UPPER * Math.sin(a) + FORE * Math.sin(b)),
    sy + UPPER * Math.cos(a) + FORE * Math.cos(b),
  ];
}

/**
 * A faceless flat figure, feet at (x, y), about 370 units tall standing at scale 1, facing right (`dir` 1)
 * or left (-1). Two tones: the near side in `tone`, the far limbs in `shade`; an optional accent top.
 */
export const Figure: React.FC<{
  x: number;
  y: number;
  s?: number;
  dir?: 1 | -1;
  pose?: Pose;
  hair?: Hair;
  /** Body width factor (0.9 to 1.15), for a varied crowd. */
  build?: number;
  tone?: string;
  shade?: string;
  accent?: string;
  children?: React.ReactNode;
}> = ({
  x,
  y,
  s = 1,
  dir = 1,
  pose = {},
  hair = 0,
  build = 1,
  tone = TONE.body,
  shade = TONE.shade,
  accent,
  children,
}) => {
  const sit = Boolean(pose.sit);
  const drop = sit ? 48 : 0;
  const shY = SHOULDER_Y + drop;
  const hipY = HIP_Y + drop;
  const w = 44 * build;
  const hw = 34 * build;
  const swing = pose.walk === undefined ? 0 : Math.sin(pose.walk);
  const near: Arm = pose.near ?? [6 + swing * -22, 8];
  const far: Arm = pose.far ?? [-4 + swing * 22, 8];
  const legA = swing * 22;
  const front = Boolean(pose.front);
  const leg = (deg: number, dx: number, fill: string) => {
    if (front) {
      const fx = dx * 1.4;
      return (
        <path
          d={`M${fx} ${hipY} L${fx * 1.1} 0`}
          stroke={fill}
          strokeWidth={32 * build}
          strokeLinecap="round"
          fill="none"
        />
      );
    }
    if (sit) {
      // Thigh forward to the knee, shin down to the floor.
      return (
        <path
          d={`M${dx} ${hipY} L${dx + 70} ${hipY + 4} L${dx + 74} 0`}
          stroke={fill}
          strokeWidth={34 * build}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    }
    const r = (deg * Math.PI) / 180;
    const L = -hipY;
    const kx = dx + Math.sin(r) * L * 0.52;
    const ky = hipY + Math.cos(r) * L * 0.52;
    const knee = deg < 0 ? -deg * 0.5 : 0;
    const r2 = ((deg - knee) * Math.PI) / 180;
    const fx = kx + Math.sin(r2) * L * 0.5;
    const fy = Math.min(0, ky + Math.cos(r2) * L * 0.5);
    return (
      <path
        d={`M${dx} ${hipY} L${kx.toFixed(1)} ${ky.toFixed(1)} L${fx.toFixed(1)} ${fy.toFixed(1)}`}
        stroke={fill}
        strokeWidth={32 * build}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    );
  };
  const headY = shY - 52;
  const torso = `M${-hw} ${hipY + 8} L${-w} ${shY + 14} Q${-w} ${shY - 8} ${-w + 20} ${shY - 10} L${w - 20} ${shY - 10} Q${w} ${shY - 8} ${w} ${shY + 14} L${hw} ${hipY + 8} Q${hw} ${hipY + 20} ${hw - 12} ${hipY + 20} L${-hw + 12} ${hipY + 20} Q${-hw} ${hipY + 20} ${-hw} ${hipY + 8} Z`;
  const hairShape = (() => {
    if (front && hair === 2)
      return (
        <path
          d={`M-32 ${headY + 4} Q-36 ${headY + 50} -26 ${headY + 62} H26 Q36 ${headY + 50} 32 ${headY + 4} Z`}
          fill={TONE.hair}
        />
      );
    if (front && hair === 3)
      return (
        <path
          d={`M-31 ${headY - 6} Q-30 ${headY - 34} 0 ${headY - 34} Q30 ${headY - 34} 31 ${headY - 6} Z`}
          fill={TONE.hair}
        />
      );
    if (front && hair === 1)
      return <circle cx={0} cy={headY - 34} r={14} fill={TONE.hair} />;
    switch (hair) {
      case 1: // a bun
        return <circle cx={-14} cy={headY - 30} r={15} fill={TONE.hair} />;
      case 2: // long hair down the back
        return (
          <path
            d={`M-30 ${headY - 6} Q-34 ${headY + 46} -20 ${headY + 60} L8 ${headY + 52} Q-6 ${headY + 20} 8 ${headY - 28} Z`}
            fill={TONE.hair}
          />
        );
      case 3: // a cap with a peak
        return (
          <path
            d={`M-30 ${headY - 6} Q-30 ${headY - 34} 0 ${headY - 34} Q30 ${headY - 34} 30 ${headY - 8} L52 ${headY - 4} L30 ${headY + 2} Z`}
            fill={TONE.hair}
          />
        );
      case 4: // a hood
        return (
          <path
            d={`M-38 ${headY + 34} Q-44 ${headY - 40} 0 ${headY - 40} Q40 ${headY - 40} 36 ${headY + 10} L26 ${headY + 34} Z`}
            fill={TONE.hair}
          />
        );
      default: // short hair, a slightly darker crown
        return (
          <path
            d={`M-29 ${headY - 2} Q-30 ${headY - 32} 0 ${headY - 32} Q28 ${headY - 32} 30 ${headY - 6} Q10 ${headY - 20} -29 ${headY - 2} Z`}
            fill={TONE.hair}
          />
        );
    }
  })();
  return (
    <g
      transform={`translate(${x} ${y}) scale(${s * dir} ${s}) rotate(${pose.lean ?? 0} 0 ${hipY})`}
    >
      {/* Far side first: the far arm and leg in the darker shade. */}
      <path
        d={front ? armPath(-(w - 10), shY + 14, far, -1) : armPath(-14, shY + 12, far, 1)}
        stroke={shade}
        strokeWidth={24 * build}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {leg(-legA, -12, shade)}
      {leg(legA, 12, tone)}
      <path d={torso} fill={accent ?? tone} />
      {/* The far half of the torso a touch darker: the two-tone of the flat style. */}
      <path
        d={`M${-hw} ${hipY + 8} L${-w} ${shY + 14} Q${-w} ${shY - 8} ${-w + 20} ${shY - 10} L-6 ${shY - 10} L-6 ${hipY + 20} L${-hw + 12} ${hipY + 20} Q${-hw} ${hipY + 20} ${-hw} ${hipY + 8} Z`}
        fill="#000"
        opacity={0.22}
      />
      <rect x={-10} y={shY - 24} width={20} height={20} fill={tone} />
      <g transform={`rotate(${pose.head ?? 0} 0 ${shY - 18})`}>
        {hair === 2 && hairShape}
        <circle cx={0} cy={headY} r={30} fill={tone} />
        {hair !== 2 && hairShape}
      </g>
      {children}
      <path
        d={front ? armPath(w - 10, shY + 14, near, 1) : armPath(14, shY + 12, near, 1)}
        stroke={accent ? shadeOf(accent) : tone}
        strokeWidth={24 * build}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </g>
  );
};

/** A darker step of an accent colour, for a sleeve over a lit top. */
function shadeOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.78);
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** A plain office chair seen side-on, seat at height 110 above its feet (local units, same scale as a figure). */
export const Chair: React.FC<{
  x: number;
  y: number;
  s?: number;
  dir?: 1 | -1;
  fill?: string;
}> = ({ x, y, s = 1, dir = 1, fill = "#2b2c32" }) => (
  <g transform={`translate(${x} ${y}) scale(${s * dir} ${s})`}>
    <rect x={-46} y={-122} width={96} height={16} rx={8} fill={fill} />
    <rect x={-54} y={-260} width={18} height={150} rx={9} fill={fill} />
    <rect x={-4} y={-106} width={10} height={70} fill={fill} />
    <path
      d="M-40 -6 L50 -6"
      stroke={fill}
      strokeWidth={10}
      strokeLinecap="round"
    />
    <circle cx={-40} cy={-4} r={6} fill={fill} />
    <circle cx={50} cy={-4} r={6} fill={fill} />
  </g>
);

/** The point a fraction `t` along a polyline (by length), for a pen riding the front of a stroke. */
export function alongPolyline(
  pts: Array<[number, number]>,
  t: number,
): [number, number] {
  if (pts.length < 2) return pts[0] ?? [0, 0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(
      pts[i]![0] - pts[i - 1]![0],
      pts[i]![1] - pts[i - 1]![1],
    );
    seg.push(d);
    total += d;
  }
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i]! || i === seg.length - 1) {
      const f = seg[i]! ? Math.min(1, want / seg[i]!) : 0;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    want -= seg[i]!;
  }
  return pts[pts.length - 1]!;
}

export const poly = (pts: Array<[number, number]>) =>
  pts
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
