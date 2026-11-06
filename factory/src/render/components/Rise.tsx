// A line of text rising into view through a clip mask (the way a cut title enters in an edited video),
// instead of fading in whole. The mask is the text's own box, so the line appears from its baseline up
// over 13 frames (0.42 s) on an ease-out-quint. Used for every card line that is not a number counting up.

import React from "react";
import { useCurrentFrame } from "remotion";
import { riseProgress } from "../motion.ts";

export const Rise: React.FC<{
  /** Frames to wait before the rise starts (staggers a list). */
  delay?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ delay = 0, style, children }) => {
  const frame = useCurrentFrame();
  const p = riseProgress(frame - delay);
  return (
    <div
      style={{
        overflow: "hidden",
        // Room for the text's shadow and descenders inside the mask, without moving the layout.
        padding: "0.1em 0 0.22em",
        margin: "-0.1em 0 -0.22em",
        ...style,
      }}
    >
      <div style={{ transform: `translateY(${((1 - p) * 130).toFixed(2)}%)` }}>
        {children}
      </div>
    </div>
  );
};
