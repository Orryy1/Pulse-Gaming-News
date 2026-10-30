// Stencil: the word sprayed through a stencil onto the frame, the can sweeping left to right over eight
// frames (the letters appear behind the sweep with a soft overspray halo and a speckle of paint round
// them), then two drips run down from the heaviest letters. The sub is a smaller stencil line beneath.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  SPECKLE,
  alpha,
  clamp,
  fitDisplay,
  lin,
  seeded,
  subText,
  textW,
  useMoment,
  wordText,
} from "../kit.tsx";

export const Stencil: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitDisplay(text, 800, size * 1.2, 0.1);
  const w = Math.ceil(textW(text, "anton", fs, fs * 0.1)) + 40;
  const sweep = lin(frame, 0, 8);
  const subSweep = lin(frame, 4, 12);
  const edge = sweep * (w + 80) - 40;
  const bridge = Math.max(3, Math.round(fs * 0.035));
  const drips = [0, 1].map((i) => ({
    x: 0.2 + 0.6 * seeded(variant, 90 + i),
    len: interpolate(
      frame,
      [8 + i * 3, 30 + i * 6],
      [0, size * (0.5 + 0.5 * seeded(variant, 95 + i))],
      clamp,
    ),
    wdt: Math.round(size * (0.05 + 0.03 * seeded(variant, 98 + i))),
  }));
  const cloudMask = `radial-gradient(60% 70% at 50% 50%, black 0%, rgba(0,0,0,0.4) 55%, transparent 100%)`;
  return (
    <Band top={top}>
      <div
        style={{
          position: "relative",
          opacity: out,
          transform: `rotate(${variant % 2 ? 1.2 : -1.8}deg)`,
        }}
      >
        {/* The overspray: a soft cloud of the colour and a speckle of paint, revealed with the sweep. */}
        <div
          style={{
            position: "absolute",
            left: -60,
            right: -60,
            top: -40,
            bottom: -30,
            WebkitMaskImage: cloudMask,
            maskImage: cloudMask,
            clipPath: `inset(0 ${Math.max(0, w + 120 - (edge + 60))}px 0 0)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: alpha(stamp.colour, 0.26),
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: stamp.colour,
              WebkitMaskImage: SPECKLE,
              maskImage: SPECKLE,
              WebkitMaskSize: "200px 200px",
              maskSize: "200px 200px",
              opacity: 0.7,
            }}
          />
        </div>
        <div
          style={{
            position: "relative",
            width: w,
            textAlign: "center",
            fontFamily: DISPLAY,
            fontSize: fs,
            lineHeight: 1,
            letterSpacing: fs * 0.1,
            color: stamp.colour,
            whiteSpace: "nowrap",
            clipPath: `inset(-20px ${Math.max(0, w - edge)}px -40px 0)`,
            // The paint's soft edge and the dark halo that keeps it readable over footage.
            textShadow: `0 0 ${Math.round(size * 0.04)}px ${alpha(stamp.colour, 0.9)}, 0 0 ${Math.round(size * 0.18)}px ${alpha(stamp.colour, 0.5)}, 0 2px 18px rgba(0,0,0,0.85)`,
          }}
        >
          {text}
          {/* The stencil's bridges: two thin gaps across the letters, as the card leaves them. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "36%",
              borderTop: `${bridge}px solid rgba(11,11,14,0.75)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "66%",
              borderTop: `${bridge}px solid rgba(11,11,14,0.75)`,
            }}
          />
        </div>
        {drips.map((d, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: Math.round(w * d.x),
              top: fs * 0.9,
              width: d.wdt,
              height: d.len,
              borderRadius: `0 0 ${d.wdt}px ${d.wdt}px`,
              background: `linear-gradient(180deg, ${alpha(stamp.colour, 0.9)} 0%, ${stamp.colour} 100%)`,
              boxShadow: `0 2px 6px rgba(0,0,0,0.5)`,
            }}
          />
        ))}
        {sub ? (
          <div
            style={{
              marginTop: Math.round(size * 0.14),
              textAlign: "center",
              fontFamily: DISPLAY,
              fontSize: Math.round(size * 0.34),
              letterSpacing: Math.round(size * 0.08),
              color: "#F5F5F2",
              whiteSpace: "nowrap",
              clipPath: `inset(0 ${(1 - subSweep) * 100}% 0 0)`,
              textShadow: `0 0 ${Math.round(size * 0.08)}px rgba(245,245,242,0.6), 0 2px 14px rgba(0,0,0,0.85)`,
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </Band>
  );
};

export const fitsStencil = () => true;
