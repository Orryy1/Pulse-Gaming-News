// VHS: a video recorder's on-screen insert for a game from before 2000, the word in blocky caps in the
// tone colour with the tape's colour fringing (a red and a cyan ghost a few pixels either side), a tracking
// band rolling down through it and a two-frame jitter as it cuts in. The sub is the smaller white line a
// VCR writes beneath; a blinking play mark beside it is decoration only.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  alpha,
  clamp,
  fitDisplay,
  mix,
  seeded,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

export const Vhs: React.FC<WordMomentProps> = ({
  stamp,
  hold = 51,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitDisplay(text, 760, size * 1.1, 0.12);
  // The cut-in: the insert jumps sideways on its first two frames, then holds.
  const jitter = frame < 3 ? (seeded(variant, 10 + frame) - 0.5) * 24 : 0;
  const tear = frame < 3 ? 1 : 0;
  // The tracking band: a pale noise bar that rolls down through the insert over the hold.
  const bandY = interpolate(frame, [0, hold], [-60, 260], clamp);
  const fringe = Math.max(2, Math.round(size * 0.035));
  const colour = mix(stamp.colour, "#ffffff", 0.1);
  const line = (c: string, dx: number, blend: "screen" | "normal") => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `translateX(${dx}px)`,
        fontFamily: DISPLAY,
        fontSize: fs,
        lineHeight: 1,
        letterSpacing: Math.round(size * 0.12),
        color: c,
        whiteSpace: "nowrap",
        mixBlendMode: blend,
        // The VCR's blocky face: squared off a little wider than Anton draws it.
        transformOrigin: "50% 50%",
      }}
    >
      <span style={{ display: "inline-block", transform: "scaleX(1.12)" }}>
        {text}
      </span>
    </div>
  );
  return (
    <Band top={top}>
      <div
        style={{
          position: "relative",
          width: 900,
          height: Math.round(size * (sub ? 2.1 : 1.5)),
          transform: `translateX(${jitter}px) skewX(${tear * (seeded(variant, 20 + frame) - 0.5) * 6}deg)`,
          opacity: out,
          // The insert's dark pool, so the glyphs read over the footage as a VCR's caption does.
          background:
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 20%, rgba(0,0,0,0.55) 80%, rgba(0,0,0,0) 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: Math.round(size * 1.35),
          }}
        >
          {line(alpha("#ff2a2a", 0.85), -fringe, "screen")}
          {line(alpha("#2ae9ff", 0.85), fringe, "screen")}
          {line(colour, 0, "normal")}
        </div>
        {sub ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: Math.round(size * 1.35),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: Math.round(size * 0.2),
              fontFamily: DISPLAY,
              fontSize: Math.round(size * 0.4),
              letterSpacing: Math.round(size * 0.1),
              color: "#f2f2ee",
              whiteSpace: "nowrap",
              textShadow: `${fringe * 0.6}px 0 ${alpha("#2ae9ff", 0.7)}, ${-fringe * 0.6}px 0 ${alpha("#ff2a2a", 0.7)}`,
            }}
          >
            {/* The play mark, blinking once a second. */}
            <span
              style={{
                display: "inline-block",
                width: 0,
                height: 0,
                borderTop: `${Math.round(size * 0.14)}px solid transparent`,
                borderBottom: `${Math.round(size * 0.14)}px solid transparent`,
                borderLeft: `${Math.round(size * 0.24)}px solid #f2f2ee`,
                opacity: Math.floor(frame / 15) % 2 ? 0.25 : 1,
              }}
            />
            <span
              style={{ display: "inline-block", transform: "scaleX(1.12)" }}
            >
              {sub}
            </span>
          </div>
        ) : null}
        {/* The tracking band and the scanlines. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: bandY,
            height: 26,
            background:
              "linear-gradient(180deg, transparent, rgba(255,255,255,0.28) 40%, rgba(255,255,255,0.1) 60%, transparent)",
            filter: "blur(1px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 2px, transparent 2px 5px)",
            pointerEvents: "none",
          }}
        />
      </div>
    </Band>
  );
};

export const fitsVhs = () => true;
