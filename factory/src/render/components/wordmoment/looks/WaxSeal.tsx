// Wax seal: a blob of sealing wax in the tone colour, pressed at the hit (it squashes wide and springs
// back), the word embossed into it with a lit upper edge and a shadowed lower one. The sub is on a paper
// ribbon that unfurls beneath. For confirmations: official news gets the seal.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps, WordStamp } from "../types.ts";
import {
  Band,
  BODY,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  INK,
  PAPER,
  alpha,
  clamp,
  fitDisplay,
  lin,
  mix,
  seeded,
  shadow,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

/** The wax's lumpy outline: a circle with seeded bumps round its rim. */
function blob(r: number, variant: number): string {
  const pts: string[] = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.07 * (seeded(variant, 40 + i) - 0.5);
    pts.push(
      `${(50 + Math.cos(a) * 50 * k).toFixed(1)}% ${(50 + Math.sin(a) * 50 * k).toFixed(1)}%`,
    );
  }
  void r;
  return `polygon(${pts.join(", ")})`;
}

export const WaxSeal: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const d = Math.round(size * 2.7);
  const fs = fitDisplay(text, d * 0.74, size * 0.8, 0.04);
  // The press: wide and flat at the hit, back to round by frame 8.
  const press = interpolate(frame, [0, 2, 8], [0, 1, 0], clamp);
  const sx = 1 + 0.12 * press;
  const sy = 1 - 0.1 * press;
  const dark = mix(stamp.colour, "#000000", 0.45);
  const light = mix(stamp.colour, "#ffffff", 0.35);
  const ribbon = lin(frame, 5, 12);
  return (
    <Band top={top - Math.round(size * 0.3)} blur>
      <div
        style={{
          position: "relative",
          width: d,
          height: d + size * 0.8,
          opacity: out,
        }}
      >
        {sub ? (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: d - size * 0.12,
              transform: `translateX(-50%) scaleX(${ribbon})`,
              padding: `${Math.round(size * 0.12)}px ${Math.round(size * 0.5)}px`,
              background: PAPER,
              clipPath: `polygon(0 0, 100% 0, calc(100% - ${size * 0.18}px) 50%, 100% 100%, 0 100%, ${size * 0.18}px 50%)`,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: Math.round(size * 0.26),
              letterSpacing: Math.round(size * 0.055),
              color: INK,
              whiteSpace: "nowrap",
              boxShadow: shadow(0.5),
              opacity: ribbon,
            }}
          >
            {sub}
          </div>
        ) : null}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: d,
            height: d,
            transform: `scale(${interpolate(hit, [0, 1], [1.4, 1]) * sx}, ${interpolate(hit, [0, 1], [1.4, 1]) * sy}) rotate(${variant % 2 ? 6 : -8}deg)`,
            opacity: Math.min(1, hit * 1.6),
            filter: `drop-shadow(0 ${Math.round(size * 0.06)}px ${Math.round(size * 0.1)}px rgba(0,0,0,0.5)) drop-shadow(0 ${Math.round(size * 0.3)}px ${Math.round(size * 0.6)}px rgba(0,0,0,0.5))`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              clipPath: blob(d / 2, variant),
              background: `radial-gradient(circle at 38% 32%, ${light} 0%, ${stamp.colour} 38%, ${dark} 100%)`,
            }}
          />
          {/* The pressed disc inside the rim, a shade darker and lit along its top. */}
          <div
            style={{
              position: "absolute",
              inset: Math.round(d * 0.11),
              borderRadius: "50%",
              background: `radial-gradient(circle at 50% 45%, ${stamp.colour} 0%, ${mix(stamp.colour, "#000000", 0.2)} 100%)`,
              boxShadow: `inset 0 ${Math.round(size * 0.05)}px ${Math.round(size * 0.08)}px ${alpha("#000000", 0.55)}, inset 0 -${Math.round(size * 0.03)}px ${Math.round(size * 0.05)}px ${alpha("#ffffff", 0.25)}`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: DISPLAY,
              fontSize: fs,
              lineHeight: 1,
              letterSpacing: Math.round(size * 0.04),
              color: mix(stamp.colour, "#000000", 0.5),
              textShadow: `0 -2px 1px ${alpha("#000000", 0.7)}, 0 2px 1px ${alpha("#ffffff", 0.55)}`,
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </div>
        </div>
      </div>
    </Band>
  );
};

export const fitsWaxSeal = (s: WordStamp) =>
  wordText(s).length <= 10 && subText(s).length <= 16;
