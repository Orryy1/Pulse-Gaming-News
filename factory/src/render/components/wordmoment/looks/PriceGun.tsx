// Price gun: the shop-shelf label with its scalloped top and bottom edges, a tone-colour stripe carrying
// the sub and the price printed big in black, slapped on with the gun's click (a hard land, a small
// sideways nudge as the gun lifts). For prices only: the text must read as money or FREE.
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
  SOFT_GRAIN,
  clamp,
  fitDisplay,
  isPrice,
  onAccent,
  shadow,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

/** The scalloped edge: a row of half-circles cut from the top and the bottom, as a mask. */
const scallop = (r: number) =>
  `radial-gradient(circle ${r}px at ${r}px 0, transparent 97%, black 100%) ${-r}px 0 / ${r * 2}px ${r * 2}px repeat-x, radial-gradient(circle ${r}px at ${r}px ${r * 2}px, transparent 97%, black 100%) ${-r}px calc(100% - ${r * 2}px) / ${r * 2}px ${r * 2}px repeat-x, linear-gradient(black, black) 0 ${r}px / 100% calc(100% - ${r * 2}px) no-repeat`;

export const PriceGun: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const r = Math.round(size * 0.07);
  const fs = fitDisplay(text, 640, size * 1.15, 0.01);
  const stripe = Math.round(size * 0.42);
  const nudge = interpolate(frame, [5, 9], [0, 1], clamp);
  const side = variant % 2 ? 1 : -1;
  return (
    <Band top={top} blur>
      <div
        style={{
          position: "relative",
          padding: `${r + stripe + Math.round(size * 0.1)}px ${Math.round(size * 0.5)}px ${r + Math.round(size * 0.16)}px`,
          minWidth: 460,
          textAlign: "center",
          transform: `scale(${interpolate(hit, [0, 1], [1.45, 1])}) rotate(${side * (2 + nudge * 1.5)}deg) translateX(${nudge * 6 * side}px)`,
          opacity: Math.min(1, hit * 1.5) * out,
          filter: `drop-shadow(0 8px 14px rgba(0,0,0,0.4)) drop-shadow(0 26px 50px rgba(0,0,0,0.5))`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #fffefa 0%, #f6f3ea 100%)",
            WebkitMaskImage: scallop(r),
            maskImage: scallop(r),
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: SOFT_GRAIN,
              opacity: 0.35,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: r,
              height: stripe,
              background: stamp.colour,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: Math.round(size * 0.24),
              letterSpacing: Math.round(size * 0.06),
              color: onAccent(stamp.colour),
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </div>
        </div>
        <div
          style={{
            position: "relative",
            fontFamily: DISPLAY,
            fontSize: fs,
            lineHeight: 1,
            letterSpacing: Math.round(size * 0.01),
            color: INK,
            whiteSpace: "nowrap",
            // The gun's ink: a hair of dot-matrix unevenness.
            textShadow: "0 0 1px rgba(20,19,18,0.5)",
          }}
        >
          {text}
        </div>
      </div>
    </Band>
  );
};

export const fitsPriceGun = (s: WordStamp) =>
  isPrice(wordText(s)) && subText(s).length <= 18;
