// The signature opening of every documentary: three seconds with the same shape each time, so a regular
// viewer knows the channel before a word is read. The Pulse sting (already fired at frame 0 by Long.tsx),
// the mark on ink, then one line of white type with the episode's hook, which fades as the cold open proper
// (the narrator's own opening, under it from the first frame) takes the picture. The hook line is the first
// sentence of the script's hook, as written for the screen, not reworded. Timing lives in coldOpenTiming so
// the composition and the tests agree.

import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { coldOpenTiming } from "../bookends.ts";
import { TextureBackground } from "./Backgrounds.tsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The card, rendered inside a Sequence of coldOpenTiming(fps).frames from frame 0. */
export const ColdOpen: React.FC<{
  line: string;
  logoSrc: string | null;
  variant?: number;
}> = ({ line, logoSrc, variant = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = coldOpenTiming(fps);
  const markIn = spring({ frame: frame - t.markIn, fps, config: SPRING.ENTER });
  const lineIn = interpolate(
    frame,
    [t.lineIn, t.lineIn + Math.round(fps * 0.4)],
    [0, 1],
    clamp,
  );
  const out = interpolate(frame, [t.fadeOutFrom, t.frames - 1], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: out }}>
      {/* The house slate with amber contours, not plain ink: the technical QA counts a near-black frame as black. */}
      <TextureBackground kind="contour" variant={variant} />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          gap: 36,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 26,
            opacity: markIn,
            transform: `scale(${0.92 + markIn * 0.08})`,
          }}
        >
          {logoSrc ? (
            <Img
              src={logoSrc}
              style={{ width: 110, height: 110, borderRadius: 26 }}
            />
          ) : null}
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 104,
              color: COLOUR.paper,
              letterSpacing: 4,
              lineHeight: 1,
            }}
          >
            PULSE<span style={{ color: COLOUR.amber }}>.</span>
          </div>
        </div>
        <div
          style={{
            width: 120,
            height: 6,
            background: COLOUR.amber,
            opacity: lineIn,
          }}
        />
        <div
          style={{
            maxWidth: 1400,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 46,
            lineHeight: 1.25,
            color: COLOUR.paper,
            opacity: lineIn,
            transform: `translateY(${(1 - lineIn) * 16}px)`,
          }}
        >
          {line}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
