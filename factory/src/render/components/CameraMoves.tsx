// The documentary's camera moves on screen (the decisions are in src/render/camera.ts): transitions that
// carry the camera through the cut with real motion blur, whip pans, freeze frames with a label, the
// writer's beats as slow pushes and pulls, rack focus and a vertigo push from the depth layers, a hand-drawn
// circle or arrow on a named detail, a lens's edges and a 12 fps texture flicker over explainers.
// Everything is a pure function of the frame, so renders repeat exactly.

import React, { createContext, useContext, useId } from "react";
import {
  AbsoluteFill,
  Freeze,
  Img,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, HAND } from "./fonts.ts";
import {
  emotionScale,
  flickerStep,
  RACK_FRAMES,
  trackScale,
  whipOffset,
  type CutMove,
  type ShotMove,
} from "../camera.ts";
import { displayText } from "../timeline.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The sub-frame a motion-blur sample stands for (unclamped), so moves are measured between frames. */
const SampleFrame = createContext<number | null>(null);
const useSampleFrame = () => {
  const frame = useCurrentFrame();
  const sample = useContext(SampleFrame);
  return sample ?? frame;
};

/**
 * Motion blur the way a film camera's shutter makes it: `samples` sub-frames spread evenly across the
 * shutter, centred on the frame (so the blur peaks on the cut itself, not after it), each an equal share of
 * the light. The picture is sampled inside [0, len - 1] (a clip has no frames outside its shot); the move
 * is sampled across the whole shutter.
 */
const Shutter: React.FC<{
  samples: number;
  shutter: number;
  len: number;
  children: React.ReactNode;
}> = ({ samples, shutter, len, children }) => {
  const frame = useCurrentFrame();
  const n = Math.max(2, samples);
  return (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      {Array.from({ length: n }, (_, k) => {
        const t = frame + (k / (n - 1) - 0.5) * shutter;
        return (
          <AbsoluteFill
            key={k}
            style={{
              mixBlendMode: "plus-lighter",
              filter: `opacity(${1 / n})`,
            }}
          >
            <SampleFrame.Provider value={t}>
              <Freeze frame={Math.max(0, Math.min(len - 1, t))}>
                {children}
              </Freeze>
            </SampleFrame.Provider>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

/** The transition's move at the sample's own sub-frame: the push or the whip. */
const Moving: React.FC<{
  len: number;
  out?: CutMove;
  into?: CutMove;
  children: React.ReactNode;
}> = ({ len, out, into, children }) => {
  const f = useSampleFrame();
  const id = useId().replace(/:/g, "");
  const s = trackScale(f, len, out, into);
  const x = whipOffset(f, len, out, into) * 1920;
  // A whip travels hundreds of pixels a frame: the shutter's samples alone would step, so each is also
  // smeared along the pan by its own speed (pixels a frame, a fifth of it as the blur's spread).
  const speed =
    Math.abs(whipOffset(f + 0.5, len, out, into) - whipOffset(f - 0.5, len, out, into)) * 1920;
  const smear = speed > 4 ? Math.min(60, speed * 0.2) : 0;
  return (
    <AbsoluteFill
      style={{
        transform: `translateX(${x}px) scale(${s})`,
        transformOrigin: "50% 50%",
        filter: smear ? `url(#${id})` : undefined,
      }}
    >
      {smear ? (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={id} x="-10%" y="0" width="120%" height="100%">
            <feGaussianBlur stdDeviation={`${smear.toFixed(1)} 0`} edgeMode="duplicate" />
          </filter>
        </svg>
      ) : null}
      {children}
    </AbsoluteFill>
  );
};

/**
 * One shot's camera: the transition into it and out of it (motion-blurred only on those frames) and the move
 * inside it (a freeze frame or the writer's beat). `from` is the absolute frame its sequence starts on.
 */
export const ShotCamera: React.FC<{
  len: number;
  from: number;
  fps: number;
  into?: CutMove;
  out?: CutMove;
  move?: ShotMove;
  children: React.ReactNode;
}> = ({ len, from, fps, into, out, move, children }) => {
  const frame = useCurrentFrame();
  let node: React.ReactNode = children;
  if (move?.kind === "freeze") {
    const at = move.at - from;
    node = (
      <FreezeHold at={at} hold={move.hold}>
        {children}
      </FreezeHold>
    );
  } else if (move?.kind === "emotion") {
    const s = emotionScale(frame, move.at - from, move.push, fps);
    node = (
      <AbsoluteFill
        style={{ transform: `scale(${s})`, transformOrigin: "50% 46%" }}
      >
        {children}
      </AbsoluteFill>
    );
  }
  const moving =
    (into && frame < into.frames + 1) || (out && frame > len - out.frames - 2);
  if (!moving) {
    // A push through the cut comes to rest a little closer and stays there.
    const rest = trackScale(frame, len, undefined, into);
    return rest === 1 ? (
      <>{node}</>
    ) : (
      <AbsoluteFill style={{ transform: `scale(${rest})` }}>{node}</AbsoluteFill>
    );
  }
  // A whip shows the frame's edges: the shot itself, soft and dark, fills behind it.
  const backing =
    (into?.kind === "whip" && frame < into.frames + 1) ||
    (out?.kind === "whip" && frame > len - out.frames - 2);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {backing ? (
        <AbsoluteFill
          style={{
            filter: "blur(28px) brightness(0.7)",
            transform: "scale(1.15)",
          }}
        >
          {node}
        </AbsoluteFill>
      ) : null}
      <Shutter samples={7} shutter={0.9} len={len}>
        <Moving len={len} out={out} into={into}>
          {node}
        </Moving>
      </Shutter>
    </AbsoluteFill>
  );
};

/**
 * A freeze frame: the clip holds on frame `at` for `hold` frames, a little desaturated and drifting in,
 * then plays on from where it stopped. Its label is drawn by FreezeLabel above the scrim.
 */
const FreezeHold: React.FC<{
  at: number;
  hold: number;
  children: React.ReactNode;
}> = ({ at, hold, children }) => {
  const frame = useCurrentFrame();
  if (frame < at) return <>{children}</>;
  if (frame >= at + hold)
    return (
      <Sequence from={hold} layout="none">
        {children}
      </Sequence>
    );
  const p = interpolate(
    frame,
    [at, at + 6, at + hold - 6, at + hold],
    [0, 1, 1, 0],
    clamp,
  );
  return (
    <AbsoluteFill
      style={{
        filter: `saturate(${1 - 0.45 * p}) contrast(${1 + 0.06 * p}) brightness(${1 - 0.06 * p})`,
        transform: `scale(${1 + 0.035 * interpolate(frame, [at, at + hold], [0, 1], clamp)})`,
      }}
    >
      <Freeze frame={at}>{children}</Freeze>
    </AbsoluteFill>
  );
};

/** The freeze frame's annotation: a paused chip, brackets round the frame and what the narrator names. */
export const FreezeLabel: React.FC<{
  label: string;
  hold: number;
  seconds: number;
}> = ({ label, hold, seconds }) => {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [2, 10], [0, 1], clamp);
  const out = interpolate(frame, [hold - 2, hold + 10], [1, 0], clamp);
  const o = inP * out;
  if (o <= 0) return null;
  const tc = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}:${String(Math.floor((seconds % 1) * 30)).padStart(2, "0")}`;
  const corner = (x: number, y: number, sx: number, sy: number, k: number) => (
    <path
      key={k}
      d={`M ${x} ${y + sy * 70} L ${x} ${y} L ${x + sx * 70} ${y}`}
      fill="none"
      stroke={COLOUR.paper}
      strokeWidth={5}
      strokeLinecap="round"
    />
  );
  const inset = 70 - 26 * inP;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: o }}>
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        {corner(inset, inset, 1, 1, 0)}
        {corner(1920 - inset, inset, -1, 1, 1)}
        {corner(inset, 1080 - inset, 1, -1, 2)}
        {corner(1920 - inset, 1080 - inset, -1, -1, 3)}
      </svg>
      <div
        style={{
          position: "absolute",
          top: 128,
          left: 110,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 18px",
          background: "rgba(11,11,14,0.78)",
          borderRadius: 8,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 26,
          letterSpacing: 3,
          color: COLOUR.paper,
        }}
      >
        <span style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 8, height: 26, background: COLOUR.amber }} />
          <span style={{ width: 8, height: 26, background: COLOUR.amber }} />
        </span>
        {tc}
      </div>
      {label ? (
      <div
        style={{
          position: "absolute",
          left: 110,
          bottom: 210,
          transform: `translateY(${(1 - inP) * 24}px) rotate(-2deg)`,
          padding: "10px 24px 14px",
          background: COLOUR.amber,
          color: COLOUR.ink,
          fontFamily: HAND,
          fontSize: 54,
          lineHeight: 1.05,
          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
          maxWidth: 1100,
        }}
      >
        {displayText(label)}
      </div>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * A still from its depth layers with a deliberate lens move: a rack focus (the subject softens and the place
 * behind it sharpens on the key word, or the other way) or a vertigo push (the background swells while the
 * subject holds its size, Hitchcock's dolly zoom).
 */
export const DepthShot: React.FC<{
  layers: { bg: string; mid: string; fg: string };
  len: number;
  move: Extract<ShotMove, { kind: "rack" } | { kind: "dolly" }>;
  /** The rack's frame within this sequence. */
  at?: number;
  dir?: number;
}> = ({ layers, len, move, at = 0, dir = 1 }) => {
  const frame = useCurrentFrame();
  const p = Math.min(1, frame / Math.max(1, len));
  const fade = 1;
  const truck = (p - 0.5) * 30 * dir;
  let blur = [0, 0, 0];
  let scale = [1.1, 1.12, 1.14];
  if (move.kind === "rack") {
    const t = interpolate(frame, [at, at + RACK_FRAMES], [0, 1], {
      ...clamp,
      easing: (x) => x * x * (3 - 2 * x),
    });
    // Focus on the subject (background soft) pulling to the place behind it (subject soft), or back.
    const toBack = move.toBack ? t : 1 - t;
    blur = [6 * (1 - toBack), 2.5, 7 * toBack];
    const push = 0.04 * p;
    scale = [1.08 + push, 1.1 + push * 1.3, 1.12 + push * 1.6];
  } else {
    const e = p * p * (3 - 2 * p);
    const k = move.dir > 0 ? e : 1 - e;
    // The background swells while the subject holds: the space behind it seems to stretch.
    scale = [1.06 + 0.16 * k, 1.08 + 0.08 * k, 1.14 - 0.03 * k];
  }
  const layer = (src: string, n: number) => (
    <Img
      key={n}
      src={src}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: `contrast(1.03) saturate(1.05) blur(${blur[n]}px)`,
        transform: `scale(${scale[n]}) translateX(${move.kind === "rack" ? truck * n * 0.7 : 0}px)`,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity: fade }}>
      {layer(layers.bg, 0)}
      {layer(layers.mid, 1)}
      {layer(layers.fg, 2)}
    </AbsoluteFill>
  );
};

/** A seeded wobble in [-1, 1], so the hand-drawn marks are the same on every render. */
const wobble = (seed: number) => {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/** A hand-drawn loop round a box: an ellipse that overshoots its start and wobbles, as a marker would. */
export function circlePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
): string {
  const pts: string[] = [];
  const turns = 1.12;
  const n = 48;
  const start = -Math.PI * 0.62 + wobble(seed) * 0.3;
  for (let k = 0; k <= n; k++) {
    const a = start + (k / n) * turns * Math.PI * 2;
    const grow = 1 + 0.06 * (k / n) + 0.025 * wobble(seed + k * 0.37);
    const x = cx + Math.cos(a) * rx * grow;
    const y = cy + Math.sin(a) * ry * grow;
    pts.push(`${k ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

/**
 * The named detail marked by hand (the Johnny Harris and Vox way): once the camera has pushed in, a marker
 * circle loops round it, or an arrow swings in to it, as the word is said; the name follows in marker type.
 * Positions follow the zoom exactly. `draw` is when the mark starts, in this sequence's frames.
 */
export const MarkCallout: React.FC<{
  box: { x1: number; y1: number; x2: number; y2: number };
  origin: { x: number; y: number };
  zoom: number;
  label: string;
  len: number;
  look: "circle" | "arrow";
  /** Frames the push takes (the Still's FOCUS_FRAMES) and when it starts. */
  push: number;
  pushAt: number;
  draw: number;
  seed: number;
}> = ({ box, origin, zoom, label, len, look, push, pushAt, draw, seed }) => {
  const frame = useCurrentFrame();
  const raw = interpolate(frame, [pushAt, pushAt + push], [0, 1], clamp);
  const eased = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;
  const z = 1.04 * (1 + (zoom - 1) * eased);
  const map = (x: number, y: number) => ({
    x: (origin.x + (x - origin.x) * z) * 1920,
    y: (origin.y + (y - origin.y) * z) * 1080,
  });
  const a = map(box.x1, box.y1);
  const b = map(box.x2, box.y2);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = (b.x - a.x) / 2 + 26;
  const ry = (b.y - a.y) / 2 + 22;
  const progress = interpolate(frame, [draw, draw + 14], [0, 1], clamp);
  const tag = interpolate(frame, [draw + 10, draw + 20], [0, 1], clamp);
  const out = interpolate(frame, [len - 12, len - 2], [1, 0], clamp);
  if (frame > len || frame < draw) return null;
  const right = cx / 1920 < 0.55;
  const stroke = {
    fill: "none",
    stroke: COLOUR.amber,
    strokeWidth: 9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.65))" },
  };
  let mark: React.ReactNode;
  let tagX: number;
  let tagY: number;
  if (look === "circle") {
    const d = circlePath(cx, cy, rx, ry, seed);
    const total = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2) * 1.2;
    mark = (
      <path
        d={d}
        {...stroke}
        strokeDasharray={total}
        strokeDashoffset={total * (1 - progress)}
      />
    );
    tagX = right ? cx + rx + 30 : cx - rx - 30;
    tagY = Math.max(120, Math.min(900, cy - ry - 10));
  } else {
    // An arrow from the open side of the frame, curving in to stop short of the thing.
    const ex = right ? b.x + 18 : a.x - 18;
    const ey = cy;
    const sx = right ? Math.min(1860, ex + 300) : Math.max(60, ex - 300);
    const sy = Math.max(110, ey - 190);
    const mx = (sx + ex) / 2 + (right ? 40 : -40);
    const my = sy - 30;
    const d = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
    const total = Math.hypot(ex - sx, ey - sy) * 1.25;
    // The head points along the curve's last leg.
    const ang = Math.atan2(ey - my, ex - mx);
    const h = 34;
    const head = `M ${ex - h * Math.cos(ang - 0.5)} ${ey - h * Math.sin(ang - 0.5)} L ${ex} ${ey} L ${ex - h * Math.cos(ang + 0.5)} ${ey - h * Math.sin(ang + 0.5)}`;
    mark = (
      <>
        <path
          d={d}
          {...stroke}
          strokeDasharray={total}
          strokeDashoffset={total * (1 - progress)}
        />
        {progress >= 0.95 ? <path d={head} {...stroke} /> : null}
      </>
    );
    tagX = sx;
    tagY = Math.max(60, sy - 76);
  }
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: out }}>
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        {mark}
      </svg>
      <div
        style={{
          position: "absolute",
          top: tagY,
          ...(right
            ? { left: Math.min(1920 - 520, tagX) }
            : { right: Math.min(1920 - 520, 1920 - tagX) }),
          opacity: tag,
          transform: `translateY(${(1 - tag) * 14}px) rotate(${right ? -3 : 3}deg)`,
          fontFamily: HAND,
          fontSize: 52,
          color: COLOUR.amber,
          textShadow: "0 3px 10px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
          whiteSpace: "nowrap",
        }}
      >
        {displayText(label)}
      </div>
    </AbsoluteFill>
  );
};

/**
 * A lens's character over the picture: the edges a touch soft and the colours fringing apart towards the
 * corners (red outward on one side, cyan on the other), as if shot through glass. Subtle by design.
 */
export const LensOverlay: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill
      style={{
        backdropFilter: "blur(2.2px)",
        WebkitBackdropFilter: "blur(2.2px)",
        maskImage:
          "radial-gradient(ellipse 72% 70% at 50% 50%, transparent 58%, black 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 72% 70% at 50% 50%, transparent 58%, black 100%)",
      }}
    />
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity: 0.5,
        background:
          "radial-gradient(ellipse 75% 75% at 51.5% 50%, transparent 70%, rgba(255,40,30,0.10) 92%, rgba(255,40,30,0.16) 100%)",
      }}
    />
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        opacity: 0.5,
        background:
          "radial-gradient(ellipse 75% 75% at 48.5% 50%, transparent 70%, rgba(30,200,255,0.10) 92%, rgba(30,200,255,0.16) 100%)",
      }}
    />
  </AbsoluteFill>
);

/**
 * Stop-motion texture over a full-screen explainer (Vox's boiling backgrounds): a paper grain that re-rolls
 * at 12 fps, a different texture and offset each step, so even a held card breathes.
 */
export const TextureFlicker: React.FC<{ fps: number; seed?: number }> = ({
  fps,
  seed = 0,
}) => {
  const frame = useCurrentFrame();
  const step = flickerStep(frame, fps);
  const k = (step + seed) % 6;
  const dx = Math.round(wobble(step * 1.7 + seed) * 40);
  const dy = Math.round(wobble(step * 2.3 + seed + 5) * 40);
  const fade = interpolate(frame, [0, 8], [0, 1], clamp);
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: 0.22 * fade,
        mixBlendMode: "overlay",
      }}
    >
      <svg
        width={2000}
        height={1160}
        style={{ position: "absolute", left: -40 + dx, top: -40 + dy }}
      >
        <filter id={`flick${k}`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={k % 2 ? "0.85" : "0.6 0.9"}
            numOctaves={2}
            seed={11 + k * 7}
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#flick${k})`} />
      </svg>
    </AbsoluteFill>
  );
};
