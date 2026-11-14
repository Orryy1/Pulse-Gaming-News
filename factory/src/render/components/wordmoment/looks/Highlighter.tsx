// Highlighter: the word in paper white on the frame with a fat highlighter swipe in the tone colour
// behind it, swiped left to right over eight frames with the pen's chisel ends and a darker overlap where
// the stroke doubled back at the start; the sub gets a thinner swipe a beat later.
import React from "react";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  alpha,
  fitDisplay,
  lin,
  seeded,
  subText,
  textW,
  useMoment,
  wordText,
} from "../kit.tsx";

const Swipe: React.FC<{
  text: string;
  size: number;
  colour: string;
  swept: number;
  variant: number;
  thin?: boolean;
}> = ({ text, size, colour, swept, variant, thin }) => {
  const w = Math.ceil(textW(text, "anton", size, size * 0.03) * 1.12) + size * 0.6;
  const h = Math.round(size * (thin ? 1.0 : 0.82));
  const tilt = (seeded(variant, 70) - 0.5) * 1.6;
  const chisel = Math.round(size * 0.14);
  return (
    <div
      style={{
        position: "relative",
        height: Math.round(size * 1.08),
        width: w,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: Math.round(size * 0.14),
          width: w * swept,
          height: h,
          transform: `rotate(${tilt}deg)`,
          transformOrigin: "0 50%",
          background: `linear-gradient(90deg, ${alpha(colour, thin ? 0.4 : 0.9)} 0%, ${alpha(colour, thin ? 0.3 : 0.72)} 12%, ${alpha(colour, thin ? 0.3 : 0.72)} 100%)`,
          clipPath: `polygon(${chisel}px 0, 100% 0, calc(100% - ${chisel * 0.6}px) 100%, 0 100%)`,
          // A felt tip's uneven edge: a hair of blur on the stroke, hard on the glyphs.
          filter: "blur(0.6px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: Math.round(size * 1.08),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: DISPLAY,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: Math.round(size * 0.03),
          color: "#F5F5F2",
          whiteSpace: "nowrap",
          textShadow: "0 2px 12px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const Highlighter: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitDisplay(text, 780, size * 1.15, 0.03);
  return (
    <Band top={top}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: Math.round(size * 0.04),
          opacity: Math.min(1, hit * 1.6) * out,
          transform: `rotate(${variant % 2 ? 1 : -1.5}deg)`,
        }}
      >
        <Swipe
          text={text}
          size={fs}
          colour={stamp.colour}
          swept={lin(frame, 1, 8)}
          variant={variant}
        />
        {sub ? (
          <Swipe
            text={sub}
            size={Math.round(size * 0.4)}
            colour={stamp.colour}
            swept={lin(frame, 6, 12)}
            variant={variant + 1}
            thin
          />
        ) : null}
      </div>
    </Band>
  );
};

export const fitsHighlighter = () => true;
