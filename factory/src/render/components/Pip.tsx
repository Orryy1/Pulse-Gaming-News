// Pip, the Pulse mascot, drawn in code (vector SVG, so the design and its licence are the channel's own): an amber
// rounded body with an ink outline, two big eyes, a pulse antenna and the heartbeat mark on his front, with stubby
// arms for poses. He never talks: the mouth is a fixed shape per face and nothing moves with the narration.
//
// PipFigure draws one face at a moment of its reaction (the character sheet uses it on its own); PipReactions puts
// him on a Short only during the moments src/render/mascot.ts picks (the reveal, the joke, the verdict), each a pop
// in, a short pose and a pop out. Everything is a function of the frame, so a render is repeatable.

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../brand.ts";
import {
  momentAt,
  PIP_BOB,
  PIP_SHORT,
  type PipMood,
  type PipMoment,
} from "../mascot.ts";

export { PIP_SHORT } from "../mascot.ts";

/** Frames since the last event at or before this frame, or undefined. */
export function sinceLast(
  frame: number,
  fps: number,
  times: number[],
): number | undefined {
  const past = times.map((t) => Math.round(t * fps)).filter((f) => f <= frame);
  return past.length ? frame - Math.max(...past) : undefined;
}

type Pt = [number, number];
const INK = COLOUR.ink;
const AMBER = COLOUR.amber;
const PAPER = COLOUR.paper;
const VIEW = "-6 -8 216 216";

const SHOULDER_L: Pt = [44, 128];
const SHOULDER_R: Pt = [156, 128];
const REST_L: Pt[] = [SHOULDER_L, [26, 146], [28, 162]];
const REST_R: Pt[] = [SHOULDER_R, [174, 146], [172, 162]];

/** The arms for each face: shoulder, elbow, hand. */
const ARMS: Record<PipMood, [Pt[], Pt[]]> = {
  shocked: [
    [SHOULDER_L, [20, 114], [30, 86]],
    [SHOULDER_R, [180, 114], [170, 86]],
  ],
  laughing: [
    [SHOULDER_L, [52, 154], [80, 156]],
    [SHOULDER_R, [148, 154], [120, 156]],
  ],
  thinking: [REST_L, [SHOULDER_R, [150, 154], [116, 144]]],
  smug: [
    [SHOULDER_L, [70, 154], [130, 146]],
    [SHOULDER_R, [130, 154], [70, 146]],
  ],
  facepalm: [[SHOULDER_L, [38, 106], [78, 96]], REST_R],
  hype: [
    [SHOULDER_L, [20, 98], [16, 60]],
    [SHOULDER_R, [180, 98], [184, 60]],
  ],
  sceptical: [
    [SHOULDER_L, [14, 142], [40, 162]],
    [SHOULDER_R, [186, 142], [160, 162]],
  ],
  receipt: [REST_L, [SHOULDER_R, [184, 118], [176, 92]]],
};

const lerp = (a: Pt[], b: Pt[], k: number): Pt[] =>
  a.map((p, i) => [p[0] + (b[i]![0] - p[0]) * k, p[1] + (b[i]![1] - p[1]) * k]);

const Arm: React.FC<{ pts: Pt[]; hand?: number }> = ({ pts, hand = 11 }) => {
  const d = pts.map((p) => p.join(",")).join(" ");
  const end = pts[pts.length - 1]!;
  return (
    <g>
      <polyline
        points={d}
        fill="none"
        stroke={INK}
        strokeWidth={21}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={d}
        fill="none"
        stroke={AMBER}
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={end[0]}
        cy={end[1]}
        r={hand}
        fill={AMBER}
        stroke={INK}
        strokeWidth={4.5}
      />
    </g>
  );
};

type Eye =
  | {
      kind: "open";
      ry?: number;
      pupil?: number;
      lid?: number;
      sparkle?: boolean;
    }
  | { kind: "happy" }
  | { kind: "shut" }
  | { kind: "hidden" };

interface Face {
  eyes: [Eye, Eye];
  brows: [string, string];
  look: { x: number; y: number };
  mouth: React.ReactNode;
}

const stroke = {
  fill: "none",
  stroke: INK,
  strokeWidth: 5.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const FACES: Record<PipMood, Face> = {
  shocked: {
    eyes: [
      { kind: "open", ry: 21, pupil: 5 },
      { kind: "open", ry: 21, pupil: 5 },
    ],
    brows: ["M60 70 Q76 58 92 66", "M108 66 Q124 58 140 70"],
    look: { x: 0, y: 0 },
    mouth: <ellipse cx="100" cy="138" rx="10" ry="13" fill={INK} />,
  },
  laughing: {
    eyes: [{ kind: "happy" }, { kind: "happy" }],
    brows: ["M62 74 Q78 66 92 72", "M108 72 Q122 66 138 74"],
    look: { x: 0, y: 0 },
    mouth: (
      <g>
        <path
          d="M74 124 Q100 166 126 124 Z"
          fill={INK}
          stroke={INK}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <ellipse cx="100" cy="146" rx="11" ry="6" fill="#FF8FA3" />
      </g>
    ),
  },
  thinking: {
    eyes: [{ kind: "open" }, { kind: "open" }],
    brows: ["M64 80 L92 80", "M108 72 Q122 62 138 70"],
    look: { x: 0.6, y: -0.8 },
    mouth: <path d="M92 138 L112 133" {...stroke} />,
  },
  smug: {
    eyes: [
      { kind: "open", lid: 0.5 },
      { kind: "open", lid: 0.5 },
    ],
    brows: ["M62 74 Q78 66 92 74", "M108 80 L138 76"],
    look: { x: -0.5, y: 0.2 },
    mouth: <path d="M84 134 Q104 144 118 126" {...stroke} />,
  },
  facepalm: {
    eyes: [{ kind: "hidden" }, { kind: "shut" }],
    brows: ["M64 78 L92 78", "M108 74 L134 82"],
    look: { x: 0, y: 0 },
    mouth: <path d="M84 140 q8 -7 16 0 t16 0" {...stroke} />,
  },
  hype: {
    eyes: [
      { kind: "open", ry: 20, pupil: 8, sparkle: true },
      { kind: "open", ry: 20, pupil: 8, sparkle: true },
    ],
    brows: ["M60 70 Q76 60 92 68", "M108 68 Q124 60 140 70"],
    look: { x: 0, y: -0.2 },
    mouth: (
      <path
        d="M76 124 Q100 162 124 124 Q100 132 76 124 Z"
        fill={INK}
        stroke={INK}
        strokeWidth="4"
        strokeLinejoin="round"
      />
    ),
  },
  sceptical: {
    eyes: [{ kind: "open", lid: 0.55 }, { kind: "open" }],
    brows: ["M62 80 L92 86", "M108 70 Q122 58 140 66"],
    look: { x: 0.5, y: 0 },
    mouth: <path d="M86 138 L116 132" {...stroke} />,
  },
  receipt: {
    eyes: [{ kind: "open" }, { kind: "open" }],
    brows: ["M64 76 Q78 70 92 76", "M108 76 Q122 70 136 76"],
    look: { x: 0.8, y: -0.3 },
    mouth: <path d="M84 130 Q100 146 116 130" {...stroke} />,
  },
};

const EyeShape: React.FC<{
  cx: number;
  eye: Eye;
  look: { x: number; y: number };
  blink: number;
}> = ({ cx, eye, look, blink }) => {
  const cy = 98;
  if (eye.kind === "hidden") return null;
  if (eye.kind === "happy")
    return (
      <path
        d={`M${cx - 15} ${cy + 4} Q${cx} ${cy - 14} ${cx + 15} ${cy + 4}`}
        {...stroke}
        strokeWidth={6}
      />
    );
  if (eye.kind === "shut")
    return (
      <path
        d={`M${cx - 14} ${cy - 2} Q${cx} ${cy + 8} ${cx + 14} ${cy - 2}`}
        {...stroke}
        strokeWidth={6}
      />
    );
  const ry = eye.ry ?? 18;
  const rx = 15 + (ry - 18) * 0.4;
  const pr = eye.pupil ?? 7;
  const px = look.x * (rx - pr - 3);
  const py = look.y * (ry - pr - 3);
  const lidY = eye.lid ? -ry + ry * 2 * eye.lid : 0;
  return (
    <g transform={`translate(${cx} ${cy}) scale(1 ${blink})`}>
      <ellipse
        cx="0"
        cy="0"
        rx={rx}
        ry={ry}
        fill={PAPER}
        stroke={INK}
        strokeWidth="4"
      />
      <circle cx={px} cy={py} r={pr} fill={INK} />
      <circle
        cx={px - pr * 0.35}
        cy={py - pr * 0.45}
        r={Math.max(2, pr * 0.3)}
        fill={PAPER}
      />
      {eye.sparkle ? (
        <circle cx={px + pr * 0.4} cy={py + pr * 0.35} r={1.6} fill={PAPER} />
      ) : null}
      {eye.lid ? (
        // The heavy lid: the body colour over the top of the eye (kept inside it), an ink lid line, the rim again.
        <>
          <clipPath id={`pipLid-${ry}-${rx}`}>
            <ellipse cx="0" cy="0" rx={rx} ry={ry} />
          </clipPath>
          <path
            d={`M${-rx - 2} ${-ry - 2} L${rx + 2} ${-ry - 2} L${rx + 2} ${lidY} Q0 ${lidY + 4} ${-rx - 2} ${lidY} Z`}
            fill={AMBER}
            clipPath={`url(#pipLid-${ry}-${rx})`}
          />
          <path
            d={`M${-rx} ${lidY} Q0 ${lidY + 4} ${rx} ${lidY}`}
            {...stroke}
            strokeWidth={4.5}
          />
          <ellipse
            cx="0"
            cy="0"
            rx={rx}
            ry={ry}
            fill="none"
            stroke={INK}
            strokeWidth="4"
          />
        </>
      ) : null}
    </g>
  );
};

/** A spark line with an ink edge, readable on dark and bright pictures alike. */
const Spark: React.FC<{ d: string; on: number }> = ({ d, on }) =>
  on <= 0 ? null : (
    <g opacity={on}>
      <path d={d} {...stroke} strokeWidth={10} />
      <path
        d={d}
        fill="none"
        stroke={PAPER}
        strokeWidth={5}
        strokeLinecap="round"
      />
    </g>
  );

const Star: React.FC<{ x: number; y: number; r: number; on: number }> = ({
  x,
  y,
  r,
  on,
}) =>
  on <= 0 ? null : (
    <path
      d={`M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z`}
      fill={COLOUR.gold}
      stroke={INK}
      strokeWidth="3"
      strokeLinejoin="round"
      transform={`rotate(${on * 20} ${x} ${y})`}
      opacity={Math.min(1, on * 1.5)}
    />
  );

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * One face of Pip at frame `f` of its reaction (0 = the pop-in). Pure drawing: the pose settles over the first
 * half-second, then holds with the small motion each face has.
 */
export const PipFigure: React.FC<{
  mood: PipMood;
  f: number;
  size: number;
}> = ({ mood, f, size }) => {
  const face = FACES[mood];
  const settle = interpolate(f, [2, 12], [0, 1], clamp);
  const [armL, armR] = ARMS[mood];
  // Hype waves both arms.
  const wave = mood === "hype" ? Math.sin(f * 0.5) * 6 * settle : 0;
  const L = lerp(REST_L, armL, settle).map(
    ([x, y], i) => [x - (i === 2 ? wave : 0), y] as Pt,
  );
  const R = lerp(REST_R, armR, settle).map(
    ([x, y], i) => [x + (i === 2 ? wave : 0), y] as Pt,
  );
  const blinking =
    face.eyes.some((e) => e.kind === "open") && f >= 50 && f < 54;
  const blink = blinking ? 0.12 : 1;
  // The antenna's pulse dot flashes as he pops in: the channel's "pulse".
  const flash = interpolate(f, [0, 4, 14], [1, 1, 0], {
    extrapolateRight: "clamp",
  });
  const tick = interpolate(f, [16, 26], [0, 1], clamp);
  const slip = interpolate(f, [4, 14], [40, 0], clamp);
  const sparkOn = interpolate(f, [3, 8, 40, 52], [0, 1, 1, 0], clamp);
  const dot = (from: number) => interpolate(f, [from, from + 5], [0, 1], clamp);
  const browLift =
    mood === "smug" || mood === "sceptical"
      ? -interpolate(f, [14, 20, 26], [0, 4, 2], clamp)
      : 0;
  return (
    <svg
      viewBox={VIEW}
      width={size}
      height={size}
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={`pipBody-${mood}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF8A45" />
          <stop offset="1" stopColor={AMBER} />
        </linearGradient>
        {/* A thin light rim round the whole figure, like a sticker, so the ink outline reads on dark footage too. */}
        <filter id="pipRim" x="-10%" y="-10%" width="120%" height="120%">
          <feMorphology
            in="SourceAlpha"
            operator="dilate"
            radius="3.5"
            result="grow"
          />
          <feFlood floodColor={PAPER} floodOpacity="0.9" />
          <feComposite in2="grow" operator="in" result="rim" />
          <feMerge>
            <feMergeNode in="rim" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#pipRim)">
        {/* Antenna with the pulse dot. */}
        <path d="M100 48 Q98 34 104 22" {...stroke} strokeWidth={6} />
        <circle
          cx="104"
          cy="16"
          r={9 + flash * 3}
          fill={flash > 0.05 ? COLOUR.gold : AMBER}
          stroke={INK}
          strokeWidth="4.5"
        />
        {/* Feet, then the body over them. */}
        <ellipse
          cx="78"
          cy="175"
          rx="16"
          ry="8"
          fill={AMBER}
          stroke={INK}
          strokeWidth="4.5"
        />
        <ellipse
          cx="122"
          cy="175"
          rx="16"
          ry="8"
          fill={AMBER}
          stroke={INK}
          strokeWidth="4.5"
        />
        <rect
          x="34"
          y="46"
          width="132"
          height="126"
          rx="52"
          fill={`url(#pipBody-${mood})`}
          stroke={INK}
          strokeWidth="6"
        />
        {/* A soft highlight, so he reads as a rounded toy, not a flat sticker. */}
        <path
          d="M52 78 Q56 58 78 54"
          fill="none"
          stroke="#FFC79F"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.7"
        />
        {/* The heartbeat mark on his front: the Pulse line, never a mouth. */}
        <path
          d="M80 160 L90 160 L95 152 L101 168 L106 156 L110 160 L120 160"
          fill="none"
          stroke={INK}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <EyeShape cx={78} eye={face.eyes[0]} look={face.look} blink={blink} />
        <EyeShape cx={122} eye={face.eyes[1]} look={face.look} blink={blink} />
        <g transform={`translate(0 ${browLift})`}>
          <path d={face.brows[0]} {...stroke} strokeWidth={6} />
          <path d={face.brows[1]} {...stroke} strokeWidth={6} />
        </g>
        {face.mouth}
        {mood === "laughing" ? (
          <g opacity={sparkOn}>
            <path
              d="M56 104 q-5 8 0 12 q5 -4 0 -12 Z"
              fill={COLOUR.sky}
              stroke={INK}
              strokeWidth="2.5"
            />
            <path
              d="M144 104 q-5 8 0 12 q5 -4 0 -12 Z"
              fill={COLOUR.sky}
              stroke={INK}
              strokeWidth="2.5"
            />
          </g>
        ) : null}
        {mood === "facepalm" ? (
          <path
            d="M150 62 q-7 11 0 16 q7 -5 0 -16 Z"
            fill={COLOUR.sky}
            stroke={INK}
            strokeWidth="2.5"
            opacity={sparkOn}
          />
        ) : null}
        {mood === "receipt" ? (
          // A till receipt with a tick: the claim was checked against the source.
          <g
            transform={`translate(0 ${slip}) rotate(8 176 92)`}
            opacity={interpolate(slip, [0, 40], [1, 0])}
          >
            <path
              d="M156 34 L198 34 L198 92 L193 87 L188 92 L183 87 L178 92 L173 87 L168 92 L163 87 L156 92 Z"
              fill={PAPER}
              stroke={INK}
              strokeWidth="4"
              strokeLinejoin="round"
            />
            <path
              d="M163 44 L191 44 M163 52 L185 52"
              stroke={COLOUR.chrome}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <circle
              cx="177"
              cy="70"
              r="12"
              fill="none"
              stroke={COLOUR.up}
              strokeWidth="3.5"
              opacity={tick}
            />
            <path
              d="M170 70 L175 76 L185 63"
              fill="none"
              stroke={COLOUR.up}
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="24"
              strokeDashoffset={24 * (1 - tick)}
            />
          </g>
        ) : null}
        {/* Arms over the body (and over the receipt, so the hand holds it). */}
        <Arm pts={L} hand={mood === "facepalm" ? 15 : 11} />
        <Arm pts={R} />
        {mood === "shocked" ? (
          <>
            <Spark d="M150 40 L162 26" on={sparkOn} />
            <Spark d="M166 56 L184 50" on={sparkOn} />
            <Spark d="M50 40 L38 26" on={sparkOn} />
          </>
        ) : null}
        {mood === "hype" ? (
          <>
            <Star x={186} y={28} r={11} on={sparkOn} />
            <Star x={14} y={30} r={9} on={sparkOn} />
            <Star x={196} y={88} r={7} on={sparkOn} />
          </>
        ) : null}
        {mood === "thinking" ? (
          <g>
            {(
              [
                [160, 46, 5, 12],
                [174, 30, 6.5, 18],
                [190, 12, 8.5, 24],
              ] as const
            ).map(([x, y, r, from]) => (
              <circle
                key={x}
                cx={x}
                cy={y}
                r={r * dot(from)}
                fill={PAPER}
                stroke={INK}
                strokeWidth="3"
              />
            ))}
          </g>
        ) : null}
      </g>
    </svg>
  );
};

/** How a reaction moves the whole figure at frame `f` of `len`: pop in and out, plus each face's own motion. */
export function reactionMotion(
  mood: PipMood,
  f: number,
  len: number,
  fps: number,
) {
  const pop = spring({
    frame: f,
    fps,
    config: { damping: 11, stiffness: 210, mass: 0.6 },
  });
  const out = interpolate(f, [len - 8, len], [1, 0], clamp);
  let x = 0;
  let y = 0;
  let rotate = 0;
  if (mood === "shocked") {
    y = -interpolate(f, [0, 4, 10], [0, PIP_BOB, 0], clamp);
    x = f >= 6 && f < 22 ? Math.sin(f * 2.3) * 4 * (1 - (f - 6) / 16) : 0;
  } else if (mood === "laughing") {
    y = -Math.abs(Math.sin(f * 0.55)) * (PIP_BOB - 2);
    rotate = Math.sin(f * 0.55) * 4;
  } else if (mood === "hype") {
    y =
      f >= 6 && f < len - 12 ? -Math.abs(Math.sin((f - 6) * 0.3)) * PIP_BOB : 0;
  } else if (mood === "thinking") {
    rotate = -interpolate(f, [6, 20], [0, 7], clamp);
  } else if (mood === "smug") {
    rotate = interpolate(f, [4, 16], [0, 6], clamp);
  } else if (mood === "sceptical") {
    rotate = -interpolate(f, [4, 16], [0, 6], clamp);
  } else if (mood === "facepalm") {
    y = interpolate(f, [10, 18], [0, 4], clamp);
  } else if (mood === "receipt") {
    y = f >= 26 && f < 34 ? Math.sin(((f - 26) / 8) * Math.PI) * 3 : 0;
  }
  return { scale: pop * out, x, y, rotate, opacity: Math.min(1, out * 1.5) };
}

/** Pip on a Short: nothing on screen except during his moments. */
export const PipReactions: React.FC<{
  moments: PipMoment[];
  left?: number;
  top?: number;
  size?: number;
}> = ({
  moments,
  left = PIP_SHORT.left,
  top = PIP_SHORT.top,
  size = PIP_SHORT.size,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = momentAt(moments, frame / fps);
  if (!m) return null;
  const start = Math.round(m.at * fps);
  const len = Math.round(m.seconds * fps);
  const f = frame - start;
  const mo = reactionMotion(m.mood, f, len, fps);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        opacity: mo.opacity,
        transform: `translate(${mo.x}px, ${mo.y}px) rotate(${mo.rotate}deg) scale(${mo.scale})`,
        transformOrigin: "60% 95%",
        filter: `drop-shadow(0 ${Math.round(size * 0.05)}px ${Math.round(size * 0.08)}px rgba(0,0,0,0.6))`,
      }}
    >
      <PipFigure mood={m.mood} f={f} size={size} />
    </div>
  );
};
