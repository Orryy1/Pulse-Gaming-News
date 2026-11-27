// GTA_KIT's three overlays (rules and planning: src/render/gtakit.ts), in Pulse's own palette and type: Anton for the
// glanced words, Inter for the read ones, the amber accent, ink plates. Ported from the gta-components kit (MIT,
// github.com/echris6/gta-components): the place card from its location card and district pop-up, the cash readout
// from its cash counter (the layout after @cole_editing's free GTA HUD project), the head-to-head from its versus
// card. No Rockstar type, logos, HUD art or footage: Pulse's furniture with the series' grammar.
//
// Each one holds `len` frames, is fully drawn by its key word (`at`) and leaves in its last 10 frames. `tall` is a
// Short's 1080x1920 frame (the hero band, y 360-900), else a long video's 1920x1080.

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { SAFE } from "../layout.ts";
import { fitBlock, fitSize, LEGIBLE_SHADOW, SAFE_EDGE } from "./packs/fit.ts";
import type { KitData, KitMoment } from "../gtakit.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const OUT = 10;
const PLATE = "rgba(11,11,14,0.84)";

/** 0 to 1 over the last OUT frames: everything leaves together. */
const leave = (frame: number, len: number) =>
  interpolate(frame, [len - OUT, len], [1, 0], clamp);

/** A place's name writes on from its word: the region above, the name through a blur as its tracking tightens. */
export const KitPlace: React.FC<{
  d: Extract<KitData, { kind: "place" }>;
  len: number;
  at: number;
  tall: boolean;
  accent: string;
}> = ({ d, len, at, tall, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const name = d.name.toUpperCase();
  // Inside the plate's padding, measured at the widest tracking it ever has, on at most two lines.
  const block = placeBlock(name, tall);
  const size = block.size;
  const t0 = Math.max(0, at - 4);
  const p = spring({ frame: frame - t0, fps, config: SPRING.ENTER });
  const rule = interpolate(frame, [t0 + 4, t0 + 22], [0, 1], clamp);
  const kicker = interpolate(frame, [0, 10], [0, 1], clamp);
  const blur = interpolate(p, [0, 1], [14, 0]);
  const track = interpolate(p, [0, 1], [PLACE_TRACK_IN, 0.04]);
  const out = leave(frame, len);
  const label = [d.region.toUpperCase(), d.label].filter(Boolean).join("  ·  ");
  const box: React.CSSProperties = tall
    ? {
        position: "absolute",
        left: 0,
        right: 0,
        top: 420,
        display: "flex",
        justifyContent: "center",
      }
    : { position: "absolute", left: 96, bottom: 300 };
  return (
    <AbsoluteFill style={{ opacity: out, pointerEvents: "none" }}>
      <div style={box}>
        <div
          style={{
            background: PLATE,
            borderRadius: 18,
            padding: tall ? "30px 54px 34px" : "22px 40px 26px",
            display: "flex",
            flexDirection: "column",
            alignItems: tall ? "center" : "flex-start",
            transform: `translateY(${(1 - kicker) * 16}px)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: tall ? 32 : 26,
              letterSpacing: "0.22em",
              color: COLOUR.muted,
              opacity: kicker,
            }}
          >
            <PinDot size={tall ? 26 : 22} accent={accent} />
            {label}
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: size,
              lineHeight: 1.02,
              color: COLOUR.paper,
              letterSpacing: `${track}em`,
              filter: `blur(${blur}px)`,
              opacity: interpolate(p, [0, 0.4], [0, 1], clamp),
              marginTop: 8,
              whiteSpace: "nowrap",
              textAlign: tall ? "center" : "left",
              textShadow: LEGIBLE_SHADOW,
            }}
          >
            {block.lines.map((l, k) => (
              <div key={k}>{l}</div>
            ))}
          </div>
          <div
            style={{
              height: 6,
              width: `${rule * 100}%`,
              background: accent,
              borderRadius: 3,
              marginTop: 12,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** The place name's tracking as it writes on (em); it settles to 0.04em. */
export const PLACE_TRACK_IN = 0.12;

/**
 * The place name's size and lines (pure, for tests): the widest the plate's content may be in each frame, at the
 * entry tracking, on one line if it fits and two if not.
 */
export function placeBlock(name: string, tall: boolean): { size: number; lines: string[]; fits: boolean } {
  // A Short: the safe width less the plate's padding; a long video: a lower-left card no wider than 1100 px.
  const maxW = tall ? SAFE.right - SAFE.left - 2 * 54 : 1100;
  const sizes = tall ? [150, 132, 116, 100, 88, 76, 66] : [112, 100, 88, 76, 64, 56];
  for (const size of sizes) {
    if (fitSize(name, "anton", maxW, [size], size * PLACE_TRACK_IN).fits) return { size, lines: [name], fits: true };
  }
  let last = { size: 0, lines: [name], fits: false };
  for (const size of sizes) {
    last = fitBlock(name, "anton", { maxWidth: maxW, sizes: [size], maxLines: 2, spacing: size * PLACE_TRACK_IN });
    if (last.fits) return last;
  }
  return last;
}

const PinDot: React.FC<{ size: number; accent: string }> = ({
  size,
  accent,
}) => (
  <svg
    width={size}
    height={size * 1.3}
    viewBox="0 0 24 31"
    style={{ display: "block" }}
  >
    <path
      d="M12 1C6 1 1.5 5.6 1.5 11.4 1.5 19 12 30 12 30s10.5-11 10.5-18.6C22.5 5.6 18 1 12 1z"
      fill={accent}
    />
    <circle cx={12} cy={11.5} r={4.2} fill={COLOUR.ink} />
  </svg>
);

/** How far a count has run at `frame`: eased to 1 by `at` (the figure's word), from a start a little before. */
export function cashProgress(frame: number, at: number): number {
  const start = Math.max(0, at - 22);
  const t = interpolate(frame, [start, Math.max(start + 1, at)], [0, 1], clamp);
  return 1 - Math.pow(1 - t, 3);
}

/**
 * The readout part way through its count, in the finished figure's shape: the number before the unit rolls ("$0.9
 * BILLION" on the way to "$1.5 BILLION"), with the figure's own decimals; whole dollars with commas otherwise.
 */
export function cashAt(value: number, decimals: number, unit: string, p: number): string {
  const v = p >= 1 ? value : value * p;
  const n = v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return unit ? `$${n} ${unit}` : `$${n}`;
}

/** A HUD-style cash readout: what it is above, the figure rolling up to its word, a gauge filling under it. */
export const KitCash: React.FC<{
  d: Extract<KitData, { kind: "cash" }>;
  len: number;
  at: number;
  tall: boolean;
  accent: string;
}> = ({ d, len, at, tall, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = cashProgress(frame, at);
  const shown = cashAt(d.value, d.decimals, d.unit, p);
  const maxW = tall ? SAFE.right - SAFE.left - 100 : 760;
  // Sized for the finished figure, so the box never grows as it counts.
  const size = fitSize(
    d.text,
    "inter",
    maxW,
    tall ? [128, 112, 96, 84, 72, 64] : [96, 84, 72, 64, 56],
  ).size;
  const enter = spring({ frame, fps, config: SPRING.POP });
  const hit = spring({ frame: frame - at, fps, config: SPRING.SNAP });
  const glow =
    frame >= at ? interpolate(frame, [at, at + 18], [1, 0], clamp) : 0;
  const out = leave(frame, len);
  const box: React.CSSProperties = tall
    ? { position: "absolute", right: 1080 - SAFE.right, top: 420 }
    : { position: "absolute", right: 96, top: 110 };
  return (
    <AbsoluteFill style={{ opacity: out, pointerEvents: "none" }}>
      <div
        style={{
          ...box,
          transform: `translateX(${(1 - enter) * 60}px)`,
          opacity: enter,
        }}
      >
        <div
          style={{
            background: PLATE,
            borderRadius: 16,
            padding: tall ? "24px 40px 28px" : "18px 32px 22px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: tall ? 32 : 26,
              letterSpacing: "0.22em",
              color: COLOUR.muted,
            }}
          >
            {d.label}
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: size,
              lineHeight: 1.05,
              color: COLOUR.paper,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              transform: `scale(${1 + 0.06 * hit * glow})`,
              transformOrigin: "right center",
              textShadow: glow > 0 ? `0 0 ${28 * glow}px ${accent}` : undefined,
            }}
          >
            <span style={{ color: accent }}>{shown.slice(0, 1)}</span>
            {shown.slice(1)}
          </div>
          <div
            style={{
              alignSelf: "stretch",
              height: 8,
              borderRadius: 4,
              background: "rgba(245,245,242,0.16)",
              marginTop: 10,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${p * 100}%`,
                background: accent,
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** A head-to-head: the left name in, the amber VS, the right name slamming in on its word. */
export const KitVersus: React.FC<{
  d: Extract<KitData, { kind: "versus" }>;
  len: number;
  at: number;
  tall: boolean;
  accent: string;
}> = ({ d, len, at, tall, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const left = d.left.toUpperCase();
  const right = d.right.toUpperCase();
  const half = tall ? 400 : 640;
  const sizes = tall ? [124, 108, 96, 84, 72, 64] : [120, 104, 92, 80, 68];
  const size = Math.min(
    fitSize(left, "anton", half, sizes).size,
    fitSize(right, "anton", half, sizes).size,
  );
  const pl = spring({ frame, fps, config: SPRING.ENTER });
  const vs = spring({ frame: frame - 6, fps, config: SPRING.POP });
  const pr = spring({
    frame: frame - Math.max(8, at - 3),
    fps,
    config: SPRING.SNAP,
  });
  const shake =
    frame >= at && frame < at + 8
      ? Math.sin((frame - at) * 2.6) * (8 - (frame - at))
      : 0;
  const out = leave(frame, len);
  /** A name's box: against the VS (right-aligned on the left, left-aligned on the right); centred, stacked, in a Short. */
  const name = (align: "flex-end" | "flex-start"): React.CSSProperties => ({
    width: tall ? SAFE.right - SAFE.left : half,
    display: "flex",
    justifyContent: tall ? "center" : align,
    fontFamily: DISPLAY,
    fontSize: size,
    lineHeight: 1,
    color: COLOUR.paper,
    whiteSpace: "nowrap",
    textShadow: LEGIBLE_SHADOW,
    letterSpacing: "0.02em",
  });
  return (
    <AbsoluteFill style={{ opacity: out, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: tall ? 0 : SAFE_EDGE,
          right: tall ? 0 : SAFE_EDGE,
          top: tall ? 520 : 250,
          display: "flex",
          flexDirection: tall ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 18 : 30,
          transform: `translateX(${shake}px)`,
        }}
      >
        <div
          style={{
            ...name("flex-end"),
            transform: `translateX(${(1 - pl) * -120}px)`,
            opacity: pl,
          }}
        >
          <span
            style={{
              background: PLATE,
              borderRadius: 14,
              padding: "6px 26px 2px",
            }}
          >
            {left}
          </span>
        </div>
        <div
          style={{
            width: tall ? 118 : 128,
            height: tall ? 118 : 128,
            borderRadius: "50%",
            background: accent,
            color: COLOUR.ink,
            fontFamily: DISPLAY,
            fontSize: tall ? 60 : 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${vs})`,
            flexShrink: 0,
          }}
        >
          VS
        </div>
        <div
          style={{
            ...name("flex-start"),
            transform: `scale(${interpolate(pr, [0, 1], [1.6, 1])})`,
            opacity: interpolate(pr, [0, 0.3], [0, 1], clamp),
          }}
        >
          <span
            style={{
              background: PLATE,
              borderRadius: 14,
              padding: "6px 26px 2px",
            }}
          >
            {right}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** One planned kit moment (drawn inside its own Sequence, so frames count from its start). */
export const KitOverlay: React.FC<{
  m: KitMoment;
  tall: boolean;
  accent: string;
}> = ({ m, tall, accent }) => {
  const d = m.data;
  if (d.kind === "place")
    return <KitPlace d={d} len={m.len} at={m.at} tall={tall} accent={accent} />;
  if (d.kind === "cash")
    return <KitCash d={d} len={m.len} at={m.at} tall={tall} accent={accent} />;
  return <KitVersus d={d} len={m.len} at={m.at} tall={tall} accent={accent} />;
};
