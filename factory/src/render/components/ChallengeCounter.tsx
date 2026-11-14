// The running count on a challenge episode (CHALLENGE_SERIES, src/challenge.ts): the episode, the rule and the
// measured counts (attempt, missions, rule breaks) in the brand band under the handle, from the end of the hook to
// the last half second. Only measured counts are passed in, so nothing here is ever a guess.

import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { BANDS, SAFE } from "../layout.ts";

export interface ChallengeCounterProps {
  /** "EP 3" or "THE VERDICT". */
  title: string;
  /** "NO CARS". */
  rule: string;
  items: Array<{ label: string; value: number }>;
  from: number;
  until: number;
}

export const ChallengeCounter: React.FC<{
  counter: ChallengeCounterProps;
  accent: string;
}> = ({ counter, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < counter.from || t >= counter.until) return null;
  const opacity = interpolate(
    t,
    [counter.from, counter.from + 0.25, counter.until - 0.25, counter.until],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: BANDS.brand[0] + 64,
        display: "flex",
        gap: 10,
        alignItems: "stretch",
        opacity,
      }}
    >
      <div
        style={{
          background: accent,
          color: COLOUR.ink,
          fontFamily: DISPLAY,
          fontSize: 30,
          lineHeight: 1.05,
          padding: "8px 14px",
          borderRadius: 10,
          textAlign: "center",
        }}
      >
        <div>{counter.title}</div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: 1,
          }}
        >
          {counter.rule}
        </div>
      </div>
      {counter.items.map((i) => (
        <div
          key={i.label}
          style={{
            background: "rgba(11,11,14,0.82)",
            color: COLOUR.paper,
            borderRadius: 10,
            padding: "8px 14px",
            textAlign: "center",
            minWidth: 96,
          }}
        >
          <div style={{ fontFamily: DISPLAY, fontSize: 36, lineHeight: 1 }}>
            {i.value}
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: 1,
              color: COLOUR.muted,
            }}
          >
            {i.label}
          </div>
        </div>
      ))}
    </div>
  );
};
