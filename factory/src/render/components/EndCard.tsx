// A documentary's rendered end card: the last twenty seconds, after the outro's final word, carry "Up
// next" with the channel's most recent public documentary (its title and thumbnail from the factory's own
// data), the channel mark and a subscribe nudge. YouTube's Data API cannot set end screens, so the card is
// rendered into the video; the description's second line carries the same link. Timing is in one place
// (endCardTiming) so the pipeline, the composition and the tests agree on where the card starts.

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
import { endCardTiming } from "../bookends.ts";
import { TextureBackground } from "./Backgrounds.tsx";

export interface EndCardNext {
  title: string;
  thumbSrc: string | null;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const SAFE_X = 96;

/** The card itself, rendered inside a Sequence that starts at endCardTiming().from. */
export const EndCard: React.FC<{
  next?: EndCardNext;
  logoSrc: string | null;
  endLine: string;
  variant?: number;
}> = ({ next, logoSrc, endLine, variant = 0 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = endCardTiming(durationInFrames, fps);
  const fade = interpolate(frame, [0, t.fadeIn], [0, 1], clamp);
  const nextIn = spring({
    frame: frame - t.nextIn,
    fps,
    config: SPRING.ENTER,
  });
  const subIn = spring({
    frame: frame - t.subscribeIn,
    fps,
    config: SPRING.ENTER,
  });
  // The card leaves with the video: a short fade so the last frame is never a hard cut to black.
  const out = interpolate(frame, [t.frames - 12, t.frames - 1], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: out }}>
      {/* The house slate with amber contours, not plain ink: the technical QA counts a near-black frame as black. */}
      <AbsoluteFill style={{ opacity: fade }}>
        <TextureBackground kind="contour" variant={variant} />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: SAFE_X,
          top: 140,
          width: 1040,
          opacity: nextIn,
          transform: `translateY(${(1 - nextIn) * 40}px)`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: "8px 18px",
            background: COLOUR.amber,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 28,
            letterSpacing: 4,
            borderRadius: 7,
          }}
        >
          {next ? "UP NEXT" : "MORE DOCUMENTARIES"}
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: DISPLAY,
            fontSize: next && next.title.length > 40 ? 64 : 76,
            lineHeight: 1.02,
            color: COLOUR.paper,
            textTransform: "uppercase",
            textShadow: "0 10px 40px rgba(0,0,0,0.6)",
          }}
        >
          {next ? next.title : "The stories behind the games"}
        </div>
        {next?.thumbSrc ? (
          <div
            style={{
              marginTop: 28,
              width: 880,
              height: 495,
              borderRadius: 14,
              overflow: "hidden",
              border: `4px solid ${COLOUR.amber}`,
              boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
              background: "#000",
            }}
          >
            <Img
              src={next.thumbSrc}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          right: SAFE_X,
          bottom: 120,
          width: 620,
          textAlign: "right",
          opacity: subIn,
          transform: `translateY(${(1 - subIn) * 30}px)`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 18,
          }}
        >
          {logoSrc ? (
            <Img
              src={logoSrc}
              style={{ width: 84, height: 84, borderRadius: 20 }}
            />
          ) : null}
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 60,
              color: COLOUR.paper,
              letterSpacing: 2,
              lineHeight: 1,
            }}
          >
            PULSE GAMING NEWS<span style={{ color: COLOUR.amber }}>.</span>
          </div>
        </div>
        <div
          style={{
            marginTop: 26,
            display: "inline-block",
            padding: "14px 30px",
            background: COLOUR.alert,
            color: COLOUR.paper,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 34,
            letterSpacing: 3,
            borderRadius: 12,
          }}
        >
          SUBSCRIBE
        </div>
        <div
          style={{
            marginTop: 16,
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: 26,
            color: COLOUR.muted,
            letterSpacing: 1.5,
            textTransform: "uppercase",
          }}
        >
          {endLine}
        </div>
      </div>
    </AbsoluteFill>
  );
};
