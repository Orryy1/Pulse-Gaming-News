// MATCH_WIPE: the same place in two games, one wiping into the other. Each matched pair (src/gpuvis/framematch.ts)
// plays both clips in sync: the older game first, then a glowing line sweeps across revealing the newer game under
// it, comes back to the middle and holds the two halves side by side, so the viewer compares like with like. The
// shared place is labelled at the top, each game and its year at the bottom of its own half.

import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BODY, DISPLAY } from "./components/fonts.ts";

export const MATCH_FPS = 30;
export const MATCH_SECONDS = 5;
const ORANGE = "#FF6B1A";
const INK = "#0B0B0E";
const PAPER = "#F5F5F2";

// Types, not interfaces: Remotion's Composition wants props assignable to Record<string, unknown>.
export type MatchPair = {
  aSrc: string;
  /** Where each clip's matched moment starts, in seconds. */
  aFrom: number;
  bSrc: string;
  bFrom: number;
  label: string;
};

export type MatchWipeProps = {
  aName: string;
  bName: string;
  pairs: MatchPair[];
  secondsPerPair?: number;
};

export const SAMPLE_MATCH_WIPE: MatchWipeProps = {
  aName: "GTA V · 2013",
  bName: "GTA VI · 2026",
  pairs: [],
  secondsPerPair: MATCH_SECONDS,
};

/**
 * Where the wipe line is, as a share of the width, at frame f of a pair lasting n frames (pure): the older game
 * alone for the first fifth, a sweep to the far edge by about three fifths, then back to the middle to hold.
 */
export function wipeAt(f: number, n: number): number {
  const a = Math.round(n * 0.2);
  const b = Math.round(n * 0.58);
  const c = Math.round(n * 0.78);
  if (f <= a) return 0;
  if (f <= b)
    return interpolate(f, [a, b], [0, 1], {
      easing: Easing.inOut(Easing.cubic),
    });
  if (f <= c)
    return interpolate(f, [b, c], [1, 0.5], {
      easing: Easing.inOut(Easing.cubic),
    });
  return 0.5;
}

const Tag: React.FC<{
  text: string;
  side: "left" | "right";
  opacity: number;
  vertical: boolean;
}> = ({ text, side, opacity, vertical }) => (
  <div
    style={{
      position: "absolute",
      bottom: vertical ? 300 : 64,
      [side]: 56,
      fontFamily: DISPLAY,
      fontSize: vertical ? 64 : 58,
      color: PAPER,
      letterSpacing: 1,
      padding: "6px 22px",
      background: "rgba(11,11,14,0.82)",
      borderBottom: `6px solid ${side === "right" ? ORANGE : PAPER}`,
      opacity,
      textTransform: "uppercase",
    }}
  >
    {text}
  </div>
);

const PairShot: React.FC<{
  pair: MatchPair;
  frames: number;
  aName: string;
  bName: string;
}> = ({ pair, frames, aName, bName }) => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const vertical = height > width;
  const p = wipeAt(f, frames);
  const x = p * width;
  const fade = interpolate(f, [0, 8, frames - 8, frames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const video = (src: string, from: number) => (
    <OffthreadVideo
      src={src}
      muted
      startFrom={Math.round(from * fps)}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  );
  return (
    <AbsoluteFill style={{ background: INK, opacity: fade }}>
      {video(pair.aSrc, pair.aFrom)}
      {/* The newer game shows left of the line: the line sweeps right, uncovering it. */}
      <AbsoluteFill
        style={{ clipPath: `inset(0 ${Math.max(0, width - x)}px 0 0)` }}
      >
        {video(pair.bSrc, pair.bFrom)}
      </AbsoluteFill>
      {p > 0 && p < 1 ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: x - 4,
            width: 8,
            background: ORANGE,
            boxShadow: `0 0 28px 6px ${ORANGE}, 0 0 80px 18px rgba(255,107,26,0.45)`,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          top: vertical ? 260 : 52,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: vertical ? 54 : 46,
          color: PAPER,
          textTransform: "uppercase",
          letterSpacing: 3,
          textShadow: "0 3px 18px rgba(0,0,0,0.9)",
        }}
      >
        <span
          style={{
            background: "rgba(11,11,14,0.78)",
            padding: "8px 24px",
            borderRadius: 6,
          }}
        >
          {pair.label}
        </span>
      </div>
      <Tag
        text={bName}
        side="left"
        opacity={interpolate(p, [0.08, 0.3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}
        vertical={vertical}
      />
      <Tag text={aName} side="right" opacity={1} vertical={vertical} />
    </AbsoluteFill>
  );
};

export const MatchWipe: React.FC<MatchWipeProps> = ({
  aName,
  bName,
  pairs,
  secondsPerPair = MATCH_SECONDS,
}) => {
  const { fps } = useVideoConfig();
  const n = Math.round(secondsPerPair * fps);
  return (
    <AbsoluteFill style={{ background: INK }}>
      {pairs.map((pair, i) => (
        <Sequence key={i} from={i * n} durationInFrames={n}>
          <PairShot pair={pair} frames={n} aName={aName} bName={bName} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
