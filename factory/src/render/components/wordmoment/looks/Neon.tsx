// Neon: the word as a glass tube in the tone colour on a dark mounting plate, flickering on the way a
// starter does (two stutters inside the first six frames, then steady), its glow spilling onto the plate.
// The sub is a smaller white tube beneath, lit a beat later.
import React from "react";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  Sub,
  alpha,
  fitDisplay,
  lin,
  mix,
  seeded,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

/** The tube's brightness by frame: a starter's stutter, then full by frame 8 with a faint hum wobble. */
function lit(frame: number, variant: number): number {
  const pattern = [0.9, 0.15, 0.7, 0.1, 0.4, 1, 0.75, 1];
  if (frame < pattern.length) return pattern[frame]!;
  const hum = 0.02 * Math.sin(frame * 1.3 + seeded(variant, 3) * 6);
  return 1 - Math.abs(hum);
}

export const Neon: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitDisplay(text, 780, size * 1.12, 0.06);
  const on = lit(frame, variant);
  const core = mix(stamp.colour, "#ffffff", 0.72);
  const glow = (c: string, k: number) =>
    `0 0 ${Math.round(2 * k)}px ${alpha(c, 0.95)}, 0 0 ${Math.round(10 * k)}px ${alpha(c, 0.8)}, 0 0 ${Math.round(28 * k)}px ${alpha(c, 0.55)}, 0 0 ${Math.round(64 * k)}px ${alpha(c, 0.35)}`;
  const subOn = lin(frame, 6, 9) * (frame > 9 ? on : 1);
  return (
    <Band top={top}>
      <div
        style={{
          position: "relative",
          padding: `${Math.round(size * 0.26)}px ${Math.round(size * 0.5)}px ${Math.round(size * 0.3)}px`,
          borderRadius: 18,
          background: "linear-gradient(180deg, #16161c 0%, #0b0b0e 100%)",
          border: "2px solid rgba(255,255,255,0.08)",
          boxShadow: `0 24px 60px rgba(0,0,0,0.65), inset 0 0 ${Math.round(80 * on)}px ${alpha(stamp.colour, 0.18 * on)}`,
          textAlign: "center",
          opacity: lin(frame, 0, 2) * out,
        }}
      >
        {/* Mounting screws, decoration only. */}
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i % 2 ? undefined : 12,
              right: i % 2 ? 12 : undefined,
              top: i < 2 ? 12 : undefined,
              bottom: i < 2 ? undefined : 12,
              width: 10,
              height: 10,
              borderRadius: 5,
              background: "#2a2a30",
              boxShadow: "inset 0 1px 1px rgba(255,255,255,0.25)",
            }}
          />
        ))}
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: fs,
            lineHeight: 1,
            letterSpacing: Math.round(size * 0.08),
            color: on > 0.5 ? core : alpha(stamp.colour, 0.25),
            textShadow: on > 0.3 ? glow(stamp.colour, on) : "none",
            WebkitTextStroke: `1px ${alpha(stamp.colour, 0.9)}`,
            whiteSpace: "nowrap",
            opacity: 0.25 + 0.75 * on,
          }}
        >
          {text}
        </div>
        <Sub
          text={sub}
          size={size}
          colour={subOn > 0.5 ? "#ffffff" : "rgba(255,255,255,0.3)"}
          opacity={0.3 + 0.7 * subOn}
          style={{
            marginTop: Math.round(size * 0.14),
            textShadow: subOn > 0.3 ? glow("#dfe8ff", 0.6 * subOn) : "none",
          }}
        />
      </div>
    </Band>
  );
};

export const fitsNeon = () => true;
