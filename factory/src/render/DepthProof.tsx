// A proof reel for the depth camera (PARALLAX_DEEP): the same real stills shot today's way (the three-layer drift
// of Long's and the Short's Still) or with the depth camera (components/DepthCam.tsx), one after another, so the two
// renders can be set side by side. Not part of any video.

import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Still as LongStill } from "./Long.tsx";
import { Still as ShortStill } from "./components/Background.tsx";
import { DepthCam } from "./components/DepthCam.tsx";
import { depthCamPlan } from "./depthcam.ts";
import { BODY } from "./components/fonts.ts";
import type { MovePreset } from "./motion.ts";

export interface DepthProofItem {
  src: string;
  aspect: number;
  focusX?: number;
  layers?: { bg: string; mid: string; fg: string };
  mesh?: { depth: string; far: string; farDepth: string; pivot: number };
  /** The stressed word's frame from the shot's start, when the proof wants one. */
  emphasis?: number;
  /** The shot's place in its video (the depth camera's path, direction and lens follow it); default its place here. */
  index?: number;
  /** The shot's own length in frames, to match a real video's shot; default `seconds`. */
  frames?: number;
}

/** Each item's first frame and length (pure): its own `frames` when given, otherwise `seconds` at the fps. */
export function depthProofTimeline(
  items: readonly DepthProofItem[],
  seconds: number,
  fps: number,
): Array<{ from: number; len: number }> {
  let from = 0;
  return items.map((it) => {
    const len = Math.max(1, Math.round(it.frames ?? seconds * fps));
    const r = { from, len };
    from += len;
    return r;
  });
}

export type DepthProofProps = {
  width: number;
  height: number;
  seconds: number;
  mode: "today" | "deep";
  label?: string;
  items: DepthProofItem[];
};

export const SAMPLE_DEPTH_PROOF: DepthProofProps = {
  width: 1920,
  height: 1080,
  seconds: 4,
  mode: "today",
  items: [],
};

const MOVES: MovePreset[] = ["pushIn", "pullBack", "pushPan", "driftDown"];

export const DepthProof: React.FC<DepthProofProps> = (props) => {
  const { fps, width, height } = useVideoConfig();
  const timeline = depthProofTimeline(props.items, props.seconds, fps);
  const tall = height > width;
  return (
    <AbsoluteFill style={{ background: "#0b0b0e" }}>
      {props.items.map((it, i) => {
        const { from, len } = timeline[i]!;
        const index = it.index ?? i;
        return (
        <Sequence key={i} from={from} durationInFrames={len}>
          {props.mode === "deep" && it.mesh ? (
            <DepthCam
              src={it.src}
              mesh={it.mesh}
              aspect={it.aspect}
              len={len}
              plan={depthCamPlan(index, len, it.emphasis)}
              focusX={it.focusX}
            />
          ) : tall ? (
            <ShortStill
              image={{
                src: it.src,
                kind: "hero",
                aspect: it.aspect,
                focusX: it.focusX,
                layers: it.layers,
              }}
              durationFrames={len}
              move={MOVES[i % MOVES.length]!}
            />
          ) : (
            <LongStill
              src={it.src}
              aspect={it.aspect}
              durationFrames={len}
              move={MOVES[i % MOVES.length]!}
              layers={it.layers}
              dir={i % 2 ? -1 : 1}
            />
          )}
          {props.label ? (
            <div
              style={{
                position: "absolute",
                left: 28,
                top: 24,
                padding: "6px 14px",
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: tall ? 34 : 28,
                letterSpacing: 2,
              }}
            >
              {props.label} {i + 1}
            </div>
          ) : null}
        </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
