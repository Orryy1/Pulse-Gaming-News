// An AI motion clip's shot in a documentary (src/assets/localvideo.ts makes them from the concept sketches).
// Two treatments: "print", the living sketch taped to a dark desk as the still sketch's print sits, so a run
// of sketches and clips reads as one family; and "bleed", the clip filling the frame, for a screenshot
// brought to life. Both carry the ILLUSTRATION tag from the first frames (in by frame 10) and a slow push so a
// held last frame still breathes. Timing is ./plan.ts: a long shot slows the clip a little, then holds its
// last frame (Remotion's Freeze), a short one cuts it early. CSS only; the clip is the one moving picture.

import React from "react";
import {
  AbsoluteFill,
  Freeze,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GRAIN, IllustrationTag, Tape } from "../packs/paper/kit.tsx";
import {
  clipTiming,
  printSize,
  printTilt,
  pushScale,
  type LocalVideoTreatment,
} from "./plan.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const CREAM = "#f4efe3";
const SHEET_PAD = 18;

export interface LocalVideoShotProps {
  src: string;
  /** The clip's own width over height (1280/704 from the model). */
  aspect: number;
  /** The clip's length in seconds (assets.clips durationSeconds). */
  clipSeconds: number;
  /** Frames of the shot. */
  len: number;
  treatment: LocalVideoTreatment;
  seed: number;
}

/** The dark desk the print lands on, drawn in code like the sketch's stop-motion desk. */
const Desk: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(160deg, #2c2620 0%, #1c1814 55%, #0f0d0b 100%)",
    }}
  >
    <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: 0.7 }} />
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at 50% 44%, rgba(255,235,200,0.12) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
      }}
    />
  </AbsoluteFill>
);

/** The clip, playing at the plan's rate and holding its last frame after playFrames. */
const Clip: React.FC<{
  src: string;
  len: number;
  clipSeconds: number;
  style: React.CSSProperties;
}> = ({ src, len, clipSeconds, style }) => {
  const { fps } = useVideoConfig();
  const t = clipTiming(len, fps, clipSeconds);
  return (
    <Freeze frame={t.playFrames} active={(f) => f >= t.playFrames}>
      <OffthreadVideo src={src} muted playbackRate={t.rate} style={style} />
    </Freeze>
  );
};

const Tag: React.FC<{ frame: number }> = ({ frame }) => (
  <IllustrationTag
    on="dark"
    style={{
      position: "absolute",
      right: 60,
      bottom: 26,
      padding: "4px 10px",
      fontSize: 16,
      letterSpacing: 2,
      border: "1px solid rgba(245,245,242,0.5)",
      background: "rgba(11,11,14,0.45)",
      color: "rgba(245,245,242,0.75)",
      opacity: interpolate(frame, [0, 10], [0, 1], clamp),
    }}
  />
);

export const LocalVideoShot: React.FC<LocalVideoShotProps> = ({
  src,
  aspect,
  clipSeconds,
  len,
  treatment,
  seed,
}) => {
  const frame = useCurrentFrame();
  const scale = pushScale(frame, len);
  if (treatment === "bleed")
    return (
      <AbsoluteFill style={{ background: "#0b0b0e", overflow: "hidden" }}>
        <AbsoluteFill style={{ transform: `scale(${scale})` }}>
          <Clip
            src={src}
            len={len}
            clipSeconds={clipSeconds}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.45) 100%)",
          }}
        />
        <Tag frame={frame} />
      </AbsoluteFill>
    );
  const { w, h } = printSize(aspect);
  const tilt = printTilt(seed);
  // The print lands: up from 24 px lower and in from 0 over 12 frames, then the slow push.
  const land = interpolate(frame, [0, 12], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Desk />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "relative",
            width: w + SHEET_PAD * 2,
            height: h + SHEET_PAD * 2,
            padding: SHEET_PAD,
            boxSizing: "border-box",
            backgroundColor: CREAM,
            backgroundImage: GRAIN,
            boxShadow:
              "0 18px 40px rgba(0,0,0,0.55), 0 4px 10px rgba(0,0,0,0.4)",
            opacity: land,
            transform: `translateY(${(1 - land) * 24}px) rotate(${tilt}deg) scale(${scale})`,
          }}
        >
          <Clip
            src={src}
            len={len}
            clipSeconds={clipSeconds}
            style={{
              width: w,
              height: h,
              objectFit: "cover",
              display: "block",
            }}
          />
          <Tape
            seed={seed}
            style={{
              position: "absolute",
              top: -22,
              left: 70,
              transform: "rotate(-4deg)",
            }}
          />
          <Tape
            seed={seed + 1}
            style={{
              position: "absolute",
              top: -20,
              right: 70,
              transform: "rotate(3deg)",
            }}
          />
        </div>
      </AbsoluteFill>
      <Tag frame={frame} />
    </AbsoluteFill>
  );
};
