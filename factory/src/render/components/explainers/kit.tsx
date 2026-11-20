// The explainers' shared look: the board (the story's picture blurred far down under a slow perspective grid), the
// kicker and heading, glass cards with an icon disc that light up as the narrator reaches them, connectors that draw
// themselves with a travelling spark, and the easing every build shares. Tall (the Short) and wide (the long video)
// read their geometry from ./layout.ts, so text is measured before it is drawn and never clipped.
import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { ICONS, type IconName } from "./icons.ts";
import {
  boardBox,
  fitLabel,
  fitTitle,
  fitValue,
  LINE_HEIGHT,
  TITLE_BAND,
  type Box,
  type Orientation,
} from "./layout.ts";
import { EXPLAINER_KICKER, type ExplainerType } from "./types.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

/** A lively but settled spring: lands in about 14 frames with a small overshoot. */
const LAND = { damping: 13, mass: 0.6, stiffness: 170 } as const;
export const land = (frame: number, fps: number, at: number) =>
  spring({ frame: frame - at, fps, config: LAND });
/** 0..1 eased over [a, b]. */
export const ramp = (frame: number, a: number, b: number) =>
  interpolate(frame, [a, b], [0, 1], { ...clamp, easing: easeOut });

/** The frame and the frame rate. */
export function useClock() {
  return { frame: useCurrentFrame(), fps: useVideoConfig().fps };
}

/** The frame's orientation and the board it draws in. */
export function useGeometry(): {
  o: Orientation;
  box: Box;
  w: number;
  h: number;
} {
  const { width, height } = useVideoConfig();
  const o: Orientation = height > width ? "tall" : "wide";
  return { o, box: boardBox(o), w: width, h: height };
}

/** How many items have landed by this frame, and which one is the narrator's current one. */
export function progress(
  frame: number,
  at: number[],
): { landed: number; active: number } {
  const landed = at.filter((a) => frame >= a).length;
  return { landed, active: landed - 1 };
}

/** The whole board's fade: in over 9 frames, out over the last 10, with a small settle in scale. */
export function useBoardFade(len: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inP = ramp(frame, 0, 9);
  const out = interpolate(frame, [len - 10, len], [1, 0], clamp);
  return {
    frame,
    fps,
    opacity: Math.min(inP, out),
    scale: 0.97 + 0.03 * inP + 0.015 * (1 - out),
  };
}

const KICKER = EXPLAINER_KICKER;

/**
 * The board: the story's picture very dim and soft, drifting, a perspective grid sliding towards the viewer, a
 * vignette, then the kicker, the heading and the explainer itself inside the board box.
 */
export const Board: React.FC<{
  type: ExplainerType;
  title: string;
  len: number;
  accent: string;
  backdrop?: string;
  /**
   * The content height the shape really uses, when less than the board offers (layout.ts tallContentUsed): the
   * heading and the content then sit together in the middle of the board, not at its top over an empty band.
   */
  used?: number;
  children: (g: { box: Box; o: Orientation; content: Box }) => React.ReactNode;
}> = ({ type, title, len, accent, backdrop, used, children }) => {
  const { frame, opacity, scale } = useBoardFade(len);
  const { o, box: full, w, h } = useGeometry();
  const t = frame / Math.max(1, len);
  const head = title ? fitTitle(title, o) : undefined;
  const band = TITLE_BAND[o] + (head && head.lines.length > 1 ? head.size : 0);
  const room = full.height - band;
  const drop = o === "tall" && used !== undefined && used < room ? Math.round((room - used) / 2) : 0;
  const box: Box = { ...full, top: full.top + drop, height: full.height - 2 * drop };
  const content: Box = {
    left: box.left,
    top: box.top + band,
    width: box.width,
    height: box.height - band,
  };
  const kickIn = ramp(frame, 2, 14);
  const titleIn = ramp(frame, 5, 18);
  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill style={{ background: COLOUR.ink, overflow: "hidden" }}>
        {backdrop ? (
          <Img
            src={backdrop}
            style={{
              position: "absolute",
              left: -60,
              top: -60,
              width: w + 120,
              height: h + 120,
              objectFit: "cover",
              transform: `scale(${1.06 + 0.05 * t}) translateX(${-12 * t}px)`,
              filter: "brightness(0.34) saturate(0.75) blur(14px)",
            }}
          />
        ) : null}
        <PerspectiveGrid frame={frame} w={w} h={h} accent={accent} />
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at 50% 42%, rgba(11,11,14,0) 30%, rgba(11,11,14,0.9) 100%)`,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <div
          style={{
            position: "absolute",
            left: box.left + 4,
            top: box.top,
            display: "flex",
            alignItems: "center",
            gap: 14,
            opacity: kickIn,
            transform: `translateX(${(1 - kickIn) * -20}px)`,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: o === "tall" ? 30 : 26,
            letterSpacing: 6,
            color: COLOUR.muted,
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              background: accent,
              borderRadius: 3,
            }}
          />
          {KICKER[type]}
        </div>
        {head ? (
          <div
            style={{
              position: "absolute",
              left: box.left,
              top: box.top + (o === "tall" ? 46 : 40),
              width: box.width,
              fontFamily: DISPLAY,
              fontSize: head.size,
              lineHeight: 1.0,
              color: COLOUR.paper,
              letterSpacing: 1,
              opacity: titleIn,
              transform: `translateY(${(1 - titleIn) * 14}px)`,
              textShadow: "0 4px 18px rgba(0,0,0,0.6)",
            }}
          >
            {head.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        ) : null}
        {children({ box, o, content })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A floor grid in perspective, its lines sliding slowly towards the viewer; faint, so it reads as depth, not pattern. */
const PerspectiveGrid: React.FC<{
  frame: number;
  w: number;
  h: number;
  accent: string;
}> = ({ frame, w, h, accent }) => {
  const horizon = h * 0.38;
  const rows = 14;
  const lines: React.ReactNode[] = [];
  const shift = (frame * 0.012) % 1;
  for (let i = 0; i < rows; i++) {
    const z = (i + shift) / rows;
    const y = horizon + (h - horizon) * z * z;
    lines.push(
      <line
        key={`h${i}`}
        x1={0}
        x2={w}
        y1={y}
        y2={y}
        stroke="rgba(255,255,255,0.05)"
        strokeWidth={1 + z * 1.5}
      />,
    );
  }
  const cols = 16;
  for (let i = 0; i <= cols; i++) {
    const x = (i / cols) * w;
    lines.push(
      <line
        key={`v${i}`}
        x1={w / 2 + (x - w / 2) * 0.12}
        y1={horizon}
        x2={w / 2 + (x - w / 2) * 2.2}
        y2={h}
        stroke="rgba(255,255,255,0.045)"
        strokeWidth={1.2}
      />,
    );
  }
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="xp-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="1" />
          <stop offset="0.45" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="xp-glow" cx="0.5" cy="0.38" r="0.6">
          <stop offset="0" stopColor={accent} stopOpacity="0.12" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="url(#xp-glow)" />
      {lines}
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill="url(#xp-fade)"
        opacity={0.5}
      />
    </svg>
  );
};

/** One icon from the vendored set, stroked in the current colour. */
export const Icon: React.FC<{
  name?: IconName;
  size: number;
  colour: string;
  stroke?: number;
}> = ({ name, size, colour, stroke = 1.8 }) => {
  const nodes = name ? ICONS[name] : undefined;
  if (!nodes) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colour}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      {nodes.map(([tag, attrs], i) =>
        React.createElement(tag, { key: i, ...attrs }),
      )}
    </svg>
  );
};

/** The disc an icon sits in: a dark well with an accent ring that fills as the item lands, and a soft glow when current. */
export const IconDisc: React.FC<{
  icon?: IconName;
  size: number;
  accent: string;
  p: number;
  active: boolean;
  number?: number;
}> = ({ icon, size, accent, p, active, number }) => {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <div
      style={{ position: "relative", width: size, height: size, flex: "none" }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 35% 30%, #23232B 0%, #121216 70%)",
          boxShadow: active
            ? `0 0 ${size * 0.45}px ${accent}66, inset 0 0 0 1px rgba(255,255,255,0.08)`
            : "inset 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      />
      <svg
        width={size}
        height={size}
        style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={4}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, p))}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon ? (
          <Icon
            name={icon}
            size={size * 0.48}
            colour={active ? COLOUR.paper : "#D9D9DE"}
          />
        ) : number !== undefined ? (
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: size * 0.46,
              color: COLOUR.paper,
            }}
          >
            {number}
          </div>
        ) : null}
      </div>
      {icon && number !== undefined ? (
        <div
          style={{
            position: "absolute",
            right: -6,
            top: -6,
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: "50%",
            background: accent,
            color: COLOUR.ink,
            fontFamily: DISPLAY,
            fontSize: size * 0.22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          }}
        >
          {number}
        </div>
      ) : null}
    </div>
  );
};

/** A label set on at most two lines at its measured size. */
export const Label: React.FC<{
  text: string;
  type: ExplainerType;
  o: Orientation;
  n: number;
  colour?: string;
  align?: "left" | "center" | "right";
  /** The board's heading: stacked cards are shorter under a two-line heading. */
  title?: string;
}> = ({ text, type, o, n, colour = COLOUR.paper, align = "left", title = "" }) => {
  const f = fitLabel(text, type, o, n, title);
  return (
    <div
      style={{
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: f.size,
        lineHeight: LINE_HEIGHT,
        color: colour,
        textAlign: align,
        letterSpacing: -0.3,
      }}
    >
      {f.lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>
          {l}
        </div>
      ))}
    </div>
  );
};

/** A value in display type, one line at its measured size. */
export const Value: React.FC<{
  text: string;
  type: ExplainerType;
  o: Orientation;
  n: number;
  colour: string;
  scale?: number;
}> = ({ text, type, o, n, colour, scale = 1 }) => {
  const f = fitValue(text, type, o, n);
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: f.size * scale,
        lineHeight: 1,
        color: colour,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: 0.5,
      }}
    >
      {text}
    </div>
  );
};

/** A glass card: dark, faintly lit from above, an accent edge when current, and a light sweep as it lands. */
export const Glass: React.FC<{
  frame: number;
  at: number;
  active: boolean;
  done: boolean;
  accent: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ frame, at, active, done, accent, style, children }) => {
  const sweep = interpolate(frame, [at + 2, at + 22], [-0.4, 1.4], clamp);
  return (
    <div
      style={{
        position: "absolute",
        borderRadius: 26,
        background:
          "linear-gradient(180deg, rgba(38,38,46,0.92) 0%, rgba(18,18,22,0.94) 100%)",
        boxShadow: active
          ? `0 0 0 2px ${accent}, 0 18px 60px rgba(0,0,0,0.55), 0 0 46px ${accent}40`
          : "0 0 0 1px rgba(255,255,255,0.10), 0 18px 50px rgba(0,0,0,0.5)",
        opacity: done && !active ? 0.82 : 1,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(105deg, transparent ${sweep * 100 - 18}%, rgba(255,255,255,0.10) ${sweep * 100}%, transparent ${sweep * 100 + 18}%)`,
          pointerEvents: "none",
        }}
      />
      {children}
    </div>
  );
};

/** Points along a polyline, for a spark that travels the connector. */
function along(pts: Array<[number, number]>, t: number): [number, number] {
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
      const k = seg[i]! ? want / seg[i]! : 0;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    want -= seg[i]!;
  }
  return pts[pts.length - 1]!;
}

/**
 * A connector that draws itself from `from` to `to` (frames), with an arrowhead and a bright spark running ahead of
 * the line; afterwards a faint pulse keeps travelling so the flow still reads as motion.
 */
export const Connector: React.FC<{
  pts: Array<[number, number]>;
  frame: number;
  from: number;
  to: number;
  accent: string;
  width?: number;
  head?: boolean;
  dashed?: boolean;
}> = ({
  pts,
  frame,
  from,
  to,
  accent,
  width = 6,
  head = true,
  dashed = false,
}) => {
  const p = interpolate(frame, [from, to], [0, 1], {
    ...clamp,
    easing: easeInOut,
  });
  if (p <= 0) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++)
    total += Math.hypot(
      pts[i]![0] - pts[i - 1]![0],
      pts[i]![1] - pts[i - 1]![1],
    );
  const d = pts
    .map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`)
    .join(" ");
  const tip = along(pts, p);
  const before = along(pts, Math.max(0, p - 0.02));
  const ang =
    (Math.atan2(tip[1] - before[1], tip[0] - before[0]) * 180) / Math.PI;
  const loop = p >= 1 ? ((frame - to) % 40) / 40 : -1;
  const pulse = loop >= 0 ? along(pts, loop) : undefined;
  const hs = width * 3.2;
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={accent}
        strokeOpacity={0.25}
        strokeWidth={width * 3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={`${total * p} ${total}`}
        style={{ filter: "blur(6px)" }}
      />
      <path
        d={d}
        fill="none"
        stroke={accent}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={
          dashed ? `${width * 2.4} ${width * 2.2}` : `${total * p} ${total}`
        }
        strokeDashoffset={dashed ? -frame * 1.5 : 0}
        opacity={dashed ? Math.min(1, p * 3) : 1}
      />
      {head && p > 0.15 ? (
        <path
          d={`M0,0 L${-hs},${-hs * 0.62} L${-hs * 0.72},0 L${-hs},${hs * 0.62} Z`}
          fill={accent}
          transform={`translate(${tip[0]},${tip[1]}) rotate(${ang})`}
        />
      ) : null}
      {p < 1 ? (
        <circle
          cx={tip[0]}
          cy={tip[1]}
          r={width * 1.4}
          fill="#FFFFFF"
          opacity={0.9}
          style={{ filter: `drop-shadow(0 0 10px ${accent})` }}
        />
      ) : null}
      {pulse ? (
        <circle
          cx={pulse[0]}
          cy={pulse[1]}
          r={width * 0.9}
          fill="#FFFFFF"
          opacity={0.55 * (1 - Math.abs(loop - 0.5) * 2) + 0.15}
        />
      ) : null}
    </g>
  );
};

/** Formats a counter value like its target ("$79.99", "1,950", "30"): same prefix, suffix and decimals. */
export function formatLike(target: string, v: number): string {
  const m = target.replace(/,/g, "").match(/^([^\d]*?)(\d+(?:\.(\d+))?)(.*)$/);
  if (!m) return target;
  const decimals = m[3]?.length ?? 0;
  const commas = /\d,\d/.test(target);
  const n = Math.abs(v).toFixed(decimals);
  const [i, f] = n.split(".");
  const int = commas ? i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : i!;
  return `${m[1]}${int}${f !== undefined ? `.${f}` : ""}${m[4]}`;
}
