// Torn banner: a strip of paper torn off at both ends, the word printed on it in the tone colour and the
// sub in ink beneath, dropped onto the frame from above and settling with a bounce, a little askew. The
// tear's fibres are a pale thread along each torn edge.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  BODY,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  INK,
  PAPER,
  SOFT_GRAIN,
  fitDisplay,
  lin,
  seeded,
  shadow,
  subText,
  textW,
  useMoment,
  wordText,
} from "../kit.tsx";

/** The strip's outline with both short ends torn: seeded teeth down each side. */
function torn(variant: number, depth: number): string {
  const n = 12;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= n; i++) {
    const y = ((i / n) * 100).toFixed(1);
    const dl =
      (i % 2 ? depth : depth * 0.35) * (0.5 + 0.5 * seeded(variant, 200 + i));
    const dr =
      (i % 2 ? depth * 0.35 : depth) * (0.5 + 0.5 * seeded(variant, 230 + i));
    left.push(`${dl.toFixed(1)}px ${y}%`);
    right.push(`calc(100% - ${dr.toFixed(1)}px) ${y}%`);
  }
  return `polygon(${[...right, ...left.reverse()].join(", ")})`;
}

export const TornBanner: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitDisplay(text, 720, size * 1.1, 0.03);
  const w = Math.max(
    520,
    Math.ceil(textW(text, "anton", fs, fs * 0.03)) + size * 1.3,
  );
  const depth = Math.round(size * 0.22);
  const drop = interpolate(hit, [0, 1], [-140, 0]);
  const tilt = variant % 2 ? 2.2 : -2.6;
  return (
    <Band top={top} blur>
      <div
        style={{
          position: "relative",
          width: w,
          transform: `translateY(${drop}px) rotate(${tilt}deg)`,
          opacity: lin(frame, 0, 2) * out,
          filter: `drop-shadow(0 8px 14px rgba(0,0,0,0.4)) drop-shadow(0 28px 60px rgba(0,0,0,0.5))`,
        }}
      >
        <div
          style={{
            position: "relative",
            padding: `${Math.round(size * 0.22)}px ${depth + Math.round(size * 0.3)}px ${Math.round(size * 0.26)}px`,
            background: PAPER,
            clipPath: torn(variant, depth),
            textAlign: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: SOFT_GRAIN,
              opacity: 0.55,
            }}
          />
          {/* The fibres along each tear. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: depth + 6,
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.9), rgba(255,255,255,0))",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: depth + 6,
              background:
                "linear-gradient(270deg, rgba(255,255,255,0.9), rgba(255,255,255,0))",
            }}
          />
          <div
            style={{
              position: "relative",
              fontFamily: DISPLAY,
              fontSize: fs,
              lineHeight: 1,
              letterSpacing: Math.round(size * 0.03),
              color: stamp.colour,
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </div>
          {sub ? (
            <div
              style={{
                position: "relative",
                marginTop: Math.round(size * 0.08),
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: Math.round(size * 0.26),
                letterSpacing: Math.round(size * 0.06),
                color: INK,
                whiteSpace: "nowrap",
                opacity: 0.9,
              }}
            >
              {sub}
            </div>
          ) : null}
        </div>
      </div>
    </Band>
  );
};

export const fitsTornBanner = () => true;
