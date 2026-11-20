// File stamp: the clerk's office stamp, two heavy rules with the word in condensed capitals between them
// and the sub in small capitals under the lower rule, pressed flat and square (no tilt) with a second,
// fainter impression a few pixels off where the hand rocked. For delays and the like: a date pushed, a
// thing shelved, a plan on hold.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps, WordStamp } from "../types.ts";
import {
  Band,
  BODY,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  INK_MASK,
  fitBody,
  isDelay,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

const Impression: React.FC<{
  text: string;
  sub: string;
  size: number;
  colour: string;
  rule: number;
}> = ({ text, sub, size, colour, rule }) => {
  const fs = fitBody(text, 720, size * 1.05, -0.02);
  return (
    <div
      style={{
        position: "relative",
        padding: `${Math.round(size * 0.12)}px ${Math.round(size * 0.3)}px ${Math.round(size * 0.1)}px`,
        borderTop: `${rule}px solid ${colour}`,
        borderBottom: `${rule}px solid ${colour}`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: fs,
          lineHeight: 1,
          letterSpacing: Math.round(-fs * 0.02),
          color: colour,
          whiteSpace: "nowrap",
          transform: "scaleX(0.9)",
          transformOrigin: "50% 50%",
        }}
      >
        {text}
      </div>
      {sub ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `calc(100% + ${rule + 6}px)`,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: Math.round(size * 0.32),
            letterSpacing: Math.round(size * 0.1),
            color: colour,
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
};

export const FileStamp: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { hit, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const rule = Math.round(size * 0.12);
  const ghost = variant % 2 ? 5 : -4;
  return (
    <Band top={top} blur>
      <div
        style={{
          position: "relative",
          transform: `scale(${interpolate(hit, [0, 1], [1.35, 1])})`,
          opacity: Math.min(1, hit * 1.5) * out,
          paddingBottom: sub ? Math.round(size * 0.5) : 0,
          WebkitMaskImage: INK_MASK,
          maskImage: INK_MASK,
          WebkitMaskSize: "320px 320px",
          maskSize: "320px 320px",
          filter:
            "drop-shadow(0 0 3px rgba(0,0,0,0.9)) drop-shadow(0 8px 24px rgba(0,0,0,0.7))",
        }}
      >
        {/* The rocked second impression, under the main one. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate(${ghost}px, ${Math.abs(ghost) * 0.6}px)`,
            opacity: 0.28,
          }}
        >
          <Impression
            text={text}
            sub={sub}
            size={size}
            colour={stamp.colour}
            rule={rule}
          />
        </div>
        <Impression
          text={text}
          sub={sub}
          size={size}
          colour={stamp.colour}
          rule={rule}
        />
      </div>
    </Band>
  );
};

export const fitsFileStamp = (s: WordStamp) => isDelay(s) || s.tone === "alert";
