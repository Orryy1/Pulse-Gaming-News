// The word stamp: a rubber-stamp card that slams in on the exact spoken word that carries the news
// ("CONFIRMED" on the date, "DELAYED", "$49.99"), holds for under two seconds and lifts away. Shared by the
// Short and the render lab.

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
export { stampColour } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";

export interface StampSpec {
  /** Seconds the stamp lands: the spoken word's start. */
  at: number;
  text: string;
  sub?: string;
  colour: string;
}

/** Frames a stamp stays on screen. */
export const STAMP_FRAMES = 51;

export const Stamp: React.FC<{
  stamp: StampSpec;
  hold?: number;
  top?: number;
  size?: number;
}> = ({ stamp, hold = STAMP_FRAMES, top = 760, size = 132 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hit = spring({
    frame,
    fps,
    config: { damping: 11, stiffness: 300, mass: 0.6 },
  });
  const scale = interpolate(hit, [0, 1], [2.3, 1]);
  const out = interpolate(frame, [hold - 8, hold], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: top,
      }}
    >
      <div
        style={{
          transform: `rotate(-7deg) scale(${scale})`,
          opacity: Math.min(1, hit * 1.4) * out,
          border: `${Math.round(size / 13)}px solid ${stamp.colour}`,
          outline: `${Math.round(size / 33)}px solid ${stamp.colour}`,
          outlineOffset: Math.round(size / 16),
          borderRadius: 14,
          padding: `${Math.round(size * 0.1)}px ${Math.round(size * 0.32)}px ${Math.round(size * 0.14)}px`,
          background: "rgba(11,11,14,0.86)",
          textAlign: "center",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: size,
            lineHeight: 1,
            color: stamp.colour,
            letterSpacing: 3,
          }}
        >
          {stamp.text}
        </div>
        {stamp.sub ? (
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: Math.round(size * 0.26),
              letterSpacing: 6,
              color: COLOUR.paper,
              marginTop: 6,
            }}
          >
            {stamp.sub}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
