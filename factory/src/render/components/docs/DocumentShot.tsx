// An archive document on a desk, the documentary way (Noclip, Ahoy, LEMMiNO): the page slides onto the desk,
// the camera pushes in on the line that matters and a highlighter, a pen or a red ring marks it as the
// narrator says it (the sentence's word timings). Full frame, 1920x1080, SVG and CSS only, a pure function of
// the frame. The page, its fixed labels and where the key line sits come from ./pages.tsx and ./layout.ts;
// what is on it comes from ./choose.ts (only the sentence's words and the chapter's game). Tagged ILLUSTRATION
// in the frame's corner, where it stays on screen however far the camera pushes in.

import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SPRING } from "../../motion.ts";
import { GRAIN, IllustrationTag, RED_PEN, Sheet } from "../packs/paper/kit.tsx";
import type { DocScene } from "./choose.ts";
import {
  CH,
  FRAME_H,
  FRAME_W,
  SETTLED,
  camera,
  layoutPage,
  markTiming,
  shotTiming,
  rnd,
  type PageLayout,
  type Rect,
} from "./layout.ts";
import { PAGES } from "./pages.tsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type DocWord = { text: string; start: number; end: number };

export type DocumentShotProps = {
  scene: DocScene;
  /** Frames the shot lasts. */
  len: number;
  /** The sentence's words, seconds from the shot's start: the mark lands on the narrator's words. */
  words?: DocWord[];
};

/** A dark walnut desk under a lamp, or a painted wall for the boards. */
const Surface: React.FC<{ wall: boolean; seed: number; zoom: number }> = ({
  wall,
  seed,
  zoom,
}) => (
  <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
    <AbsoluteFill
      style={
        wall
          ? {
              backgroundColor: "#2b2a2e",
              backgroundImage: `${GRAIN}, linear-gradient(180deg, #34333a 0%, #242328 100%)`,
            }
          : {
              backgroundColor: "#3a2416",
              backgroundImage: [
                GRAIN,
                `repeating-linear-gradient(${2 + rnd(seed, 1) * 3}deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0.12) 3px, rgba(0,0,0,0) 9px, rgba(255,210,160,0.04) 15px, rgba(0,0,0,0) 22px)`,
                `repeating-linear-gradient(${1 + rnd(seed, 2) * 2}deg, rgba(90,52,28,0) 0px, rgba(90,52,28,0.55) 60px, rgba(40,22,12,0.5) 140px, rgba(90,52,28,0) 230px)`,
                "linear-gradient(180deg, #45291a 0%, #2c1a10 100%)",
              ].join(", "),
            }
      }
    />
    {/* The lamp's pool of light, and the corners falling away. */}
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(70% 80% at 42% 38%, rgba(255,226,180,0.2) 0%, rgba(255,226,180,0) 60%), radial-gradient(120% 120% at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.62) 100%)",
      }}
    />
  </AbsoluteFill>
);

/** A hand-drawn ellipse around a rect, overshooting its start a little: points along it, 0..1. */
function ringPoints(
  r: Rect,
  seed: number,
  n = 48,
): Array<{ x: number; y: number }> {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // An ellipse round a box must be wider than the box to clear its corners.
  const rx = r.width * 0.56 + 18;
  const ry = r.height * 0.62 + 12;
  const a0 = -Math.PI * (0.62 + 0.1 * rnd(seed, 3));
  const sweep = Math.PI * 2 * 1.08;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = a0 + sweep * t;
    // The hand spirals out a little as it comes round.
    const grow = 1 + 0.06 * t + 0.02 * Math.sin(t * 9 + seed);
    return { x: cx + Math.cos(a) * rx * grow, y: cy + Math.sin(a) * ry * grow };
  });
}

/** A loose scribble along a signature line: loops and a tail, never letters or anyone's signature. */
function signaturePoints(
  r: Rect,
  seed: number,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const base = r.top + r.height * 0.78;
  const loops = 7 + Math.floor(rnd(seed, 5) * 4);
  const w = r.width * 0.8;
  const steps = loops * 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const k = Math.floor(t * loops);
    // A tall first stroke, then smaller loops of varied height, slanting right and tailing off.
    const tall = k === 0 ? 1 : 0.32 + 0.4 * rnd(seed, 10 + k);
    const h = r.height * 0.95 * tall * (1 - 0.35 * t);
    const lift = Math.abs(Math.sin(t * loops * Math.PI)) * h;
    const x =
      r.left + 16 + w * t + Math.sin(t * loops * Math.PI * 2) * (10 + 6 * rnd(seed, 30 + k)) + lift * 0.38;
    pts.push({ x, y: base - lift });
  }
  // The flourish: back under the name and out.
  const end = pts[pts.length - 1]!;
  pts.push({ x: end.x + 26, y: base + 4 });
  pts.push({ x: r.left + w * 0.55, y: base + 18 });
  pts.push({ x: r.left + w * 0.15, y: base + 14 });
  return pts;
}

const pathOf = (pts: Array<{ x: number; y: number }>) =>
  pts
    .map((p, i) => `${i ? "L" : "M"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

/** A point a fraction of the way along a polyline, by length. */
function along(pts: Array<{ x: number; y: number }>, t: number) {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    seg.push(d);
    total += d;
  }
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i]! || i === seg.length - 1) {
      const f = seg[i]! ? Math.min(1, want / seg[i]!) : 0;
      return {
        x: lerp(pts[i]!.x, pts[i + 1]!.x, f),
        y: lerp(pts[i]!.y, pts[i + 1]!.y, f),
      };
    }
    want -= seg[i]!;
  }
  return pts[pts.length - 1]!;
}

/** A highlighter or pen seen from above, its tip at (0, 0), lying toward the bottom right. */
const Tool: React.FC<{
  kind: "highlighter" | "pen" | "red";
  x: number;
  y: number;
  lift: number;
}> = ({ kind, x, y, lift }) => {
  const hl = kind === "highlighter";
  const body = hl ? "#ffb21a" : kind === "red" ? "#b8261f" : "#1e2a44";
  const w = hl ? 44 : 26;
  const len = hl ? 330 : 360;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 0,
        height: 0,
        transform: `translate(${lift * 10}px, ${-lift * 14}px)`,
      }}
    >
      <svg
        width={len + 80}
        height={len + 80}
        style={{
          position: "absolute",
          left: -20,
          top: -20,
          overflow: "visible",
        }}
      >
        <g transform="translate(20 20) rotate(-52)">
          {/* Shadow on the paper, further off as the tool lifts. */}
          <g
            transform={`translate(${12 + lift * 30} ${18 + lift * 30})`}
            opacity={0.32 - lift * 0.12}
            style={{ filter: "blur(5px)" }}
          >
            <rect
              x={-6}
              y={-w / 2}
              width={len}
              height={w}
              rx={w / 2}
              fill="#000"
            />
          </g>
          {hl ? (
            <>
              <path
                d={`M0 ${-w * 0.18} L26 ${-w / 2} L26 ${w / 2} L0 ${w * 0.32} Z`}
                fill="#ffcf4a"
              />
              <rect
                x={24}
                y={-w / 2}
                width={len * 0.32}
                height={w}
                rx={5}
                fill="#f2f0ea"
              />
              <rect
                x={24 + len * 0.32}
                y={-w / 2}
                width={len * 0.68}
                height={w}
                rx={w / 2.4}
                fill={body}
              />
              <rect
                x={24 + len * 0.32}
                y={-w / 2 + 5}
                width={len * 0.66}
                height={7}
                rx={3}
                fill="rgba(255,255,255,0.35)"
              />
            </>
          ) : (
            <>
              <path
                d={`M0 0 L22 ${-w * 0.32} L22 ${w * 0.32} Z`}
                fill="#b9bcc2"
              />
              <rect
                x={20}
                y={-w / 2}
                width={50}
                height={w}
                rx={4}
                fill="#d6d8dc"
              />
              <rect
                x={66}
                y={-w / 2}
                width={len - 70}
                height={w}
                rx={w / 2}
                fill={body}
              />
              <rect
                x={70}
                y={-w / 2 + 4}
                width={len - 80}
                height={5}
                rx={2}
                fill="rgba(255,255,255,0.28)"
              />
              <rect
                x={len - 120}
                y={-w / 2 - 6}
                width={90}
                height={8}
                rx={3}
                fill="#c9ccd2"
              />
            </>
          )}
        </g>
      </svg>
    </div>
  );
};

/** The mark itself, drawn up to `p` (0..1), and where the tool's tip is. */
function markGeometry(L: PageLayout, p: number, seed: number) {
  if (L.style === "ring") {
    const pts = ringPoints(L.mark, seed);
    return { tip: along(pts, p), ring: pts };
  }
  const k = L.key!;
  const total = k.segs.reduce((n, s) => n + (s.b - s.a), 0) || 1;
  let left = p * total;
  const bars: Rect[] = [];
  let tip = { x: k.x, y: k.y };
  for (const s of k.segs) {
    const n = Math.max(0, Math.min(s.b - s.a, left));
    left -= s.b - s.a;
    const x = k.x + s.a * k.size * CH;
    const line = k.y + s.line * k.lineH;
    if (n <= 0) break;
    const w = n * k.size * CH;
    if (L.style === "highlight") {
      const h = k.size * 1.12;
      bars.push({
        left: x - 6,
        top: line + (k.lineH - h) / 2,
        width: w + 12,
        height: h,
      });
      tip = { x: x + w, y: line + k.lineH / 2 };
    } else {
      const y = line + k.lineH / 2 + k.size * 0.58;
      bars.push({ left: x - 4, top: y, width: w + 8, height: 0 });
      tip = { x: x + w, y };
    }
  }
  return { tip, bars };
}

export const DocumentShot: React.FC<DocumentShotProps> = ({
  scene,
  len,
  words,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = layoutPage(scene);
  if (!L) return null;
  const Page = PAGES[scene.kind];
  const seed = scene.seed;
  const board = scene.kind === "ideas" || scene.kind === "reviews";
  const t = shotTiming(markTiming(words, scene.mark), !!L.signature);
  const cam = camera(L.w, L.h, L.focus);

  // The page lands (about 20 frames), then the camera pushes in to arrive just before the mark.
  const land = spring({ frame, fps, config: SPRING.ENTER });
  const push = interpolate(frame, [20, Math.max(36, t.from - 3)], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const drift = interpolate(
    frame,
    [SETTLED, Math.max(SETTLED + 1, len)],
    [0, 1],
    clamp,
  );
  const s = lerp(cam.s0, cam.s1, push) * (1 + 0.018 * drift);
  const c = {
    x: lerp(cam.c0.x, cam.c1.x, push),
    y: lerp(cam.c0.y, cam.c1.y, push),
  };

  // The mark runs over the narrator's words; a signature follows the contract's clause.
  const p = interpolate(frame, [t.from, t.to], [0, 1], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  const signFrom = t.to + 3;
  const signTo = Math.min(SETTLED - 8, signFrom + 24);
  const sp = L.signature
    ? interpolate(frame, [signFrom, signTo], [0, 1], {
        ...clamp,
        easing: Easing.inOut(Easing.sin),
      })
    : 0;
  const g = markGeometry(L, p, seed);
  const sig = L.signature ? signaturePoints(L.signature, seed) : undefined;
  const done = L.signature ? signTo : t.to;

  // The tool comes in a little before the mark and lifts away after it, gone by SETTLED.
  const toolIn = interpolate(frame, [t.from - 12, t.from], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const toolOut = interpolate(
    frame,
    [done + 2, Math.max(done + 3, Math.min(SETTLED, done + 16))],
    [0, 1],
    {
      ...clamp,
      easing: Easing.in(Easing.cubic),
    },
  );
  const start = markGeometry(L, 0, seed).tip;
  let tip = frame < t.from ? start : g.tip;
  if (sig && frame >= t.to) {
    const hop = interpolate(frame, [t.to, signFrom], [0, 1], clamp);
    tip =
      frame < signFrom
        ? { x: lerp(g.tip.x, sig[0]!.x, hop), y: lerp(g.tip.y, sig[0]!.y, hop) }
        : along(sig, sp);
  }
  const away = { x: 260, y: 300 };
  const toolX = tip.x + away.x * (1 - toolIn) + away.x * 1.4 * toolOut;
  const toolY = tip.y + away.y * (1 - toolIn) + away.y * 1.4 * toolOut;
  const lift = Math.max(
    1 - toolIn,
    toolOut,
    sig && frame > t.to && frame < signFrom ? 0.4 : 0,
  );
  const toolKind =
    L.style === "highlight"
      ? "highlighter"
      : L.style === "underline" && scene.kind === "contract"
        ? "pen"
        : "red";
  const showTool =
    frame >= t.from - 12 && frame <= Math.min(SETTLED, done + 16);

  const tilt = (rnd(seed, 7) * 2 - 1) * 1.4;
  const enterRot = -6 + tilt;
  const pageT = `translate(${(1 - land) * 160}px, ${(1 - land) * 760}px) rotate(${lerp(enterRot, tilt, land)}deg)`;
  const ink = scene.kind === "contract" ? "#1e2f6e" : RED_PEN;

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#1b120c" }}>
      <Surface wall={board} seed={seed} zoom={1 + 0.08 * push} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: L.w,
          height: L.h,
          transformOrigin: "0 0",
          transform: `translate(${FRAME_W / 2 - c.x * s}px, ${FRAME_H / 2 - c.y * s}px) scale(${s})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "50% 50%",
            transform: pageT,
          }}
        >
          {/* A second sheet under the page, for depth on the desk. */}
          {!board ? (
            <div
              style={{
                position: "absolute",
                left: 40,
                top: 30,
                transform: `rotate(${4 + tilt * 2}deg)`,
                transformOrigin: "50% 50%",
              }}
            >
              <Sheet width={L.w} tone="#e4dfd2" style={{ height: L.h }} />
            </div>
          ) : null}
          <div style={{ position: "absolute", left: 0, top: 0 }}>
            <Page scene={scene} L={L} frame={frame} />
          </div>
          {/* The mark, over the page. */}
          <svg
            width={L.w}
            height={L.h}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              overflow: "visible",
              pointerEvents: "none",
            }}
          >
            {g.bars?.map((b, i) =>
              L.style === "highlight" ? (
                <rect
                  key={i}
                  x={b.left}
                  y={b.top}
                  width={b.width}
                  height={b.height}
                  rx={6}
                  fill="rgba(255,176,26,0.62)"
                  style={{ mixBlendMode: "multiply" }}
                  transform={`rotate(${(rnd(seed, 20 + i) * 2 - 1) * 0.4} ${b.left} ${b.top})`}
                />
              ) : (
                <path
                  key={i}
                  d={`M ${b.left} ${b.top + 2} q ${b.width / 2} ${3 + 3 * rnd(seed, 30 + i)} ${b.width} ${-1}`}
                  stroke={ink}
                  strokeWidth={5.5}
                  strokeLinecap="round"
                  fill="none"
                />
              ),
            )}
            {g.ring && p > 0 ? (
              <path
                d={pathOf(g.ring)}
                stroke={RED_PEN}
                strokeWidth={7}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - p}
                opacity={0.92}
              />
            ) : null}
            {sig && sp > 0 ? (
              <path
                d={pathOf(sig)}
                stroke="#1e2f6e"
                strokeWidth={4.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1 - sp}
              />
            ) : null}
          </svg>
          {showTool ? (
            <Tool kind={toolKind} x={toolX} y={toolY} lift={lift} />
          ) : null}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 60,
          opacity: interpolate(frame, [6, 16], [0, 1], clamp),
        }}
      >
        <IllustrationTag
          on="dark"
          style={{ background: "rgba(11,11,14,0.9)", boxShadow: "0 4px 14px rgba(0,0,0,0.5)" }}
        />
      </div>
    </AbsoluteFill>
  );
};
