// Typewriter: the word struck letter by letter onto a strip of paper, one or two keys a frame so the whole
// word is down by frame ten, each letter landing a shade too hard (a squash and a halo of ink that settle
// in two frames). The sub is typed smaller beneath in the same ribbon. The strip is a torn-off piece of
// paper the stamp's width, slightly askew.
import React from "react";
import type { WordMomentProps } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  PAPER,
  SOFT_GRAIN,
  lin,
  mix,
  seeded,
  shadow,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

const MONO =
  "'Courier New', Courier, 'Nimbus Mono PS', 'Liberation Mono', monospace";

const Struck: React.FC<{
  text: string;
  size: number;
  colour: string;
  frame: number;
  start: number;
  perFrame: number;
  variant: number;
}> = ({ text, size, colour, frame, start, perFrame, variant }) => (
  <div
    style={{
      fontFamily: MONO,
      fontWeight: 700,
      fontSize: size,
      lineHeight: 1,
      letterSpacing: Math.round(size * 0.04),
      color: colour,
      whiteSpace: "pre",
      display: "flex",
    }}
  >
    {text.split("").map((ch, i) => {
      const at = start + Math.floor(i / perFrame);
      const since = frame - at;
      if (since < 0)
        return (
          <span key={i} style={{ opacity: 0 }}>
            {ch}
          </span>
        );
      const squash = since < 2 ? 1 + 0.12 * (1 - since / 2) : 1;
      const halo = since < 3 ? (3 - since) * 1.2 : 0;
      // Each key sits a hair off the line, as a real ribbon prints.
      const dy = (seeded(variant, 120 + i) - 0.5) * size * 0.05;
      return (
        <span
          key={i}
          style={{
            display: "inline-block",
            transform: `translateY(${dy}px) scale(${squash})`,
            textShadow: `0 0 ${halo}px ${colour}, 0 0 1px ${colour}`,
            opacity: 0.85 + 0.15 * seeded(variant, 140 + i),
          }}
        >
          {ch}
        </span>
      );
    })}
  </div>
);

export const Typewriter: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = Math.min(size, Math.floor(760 / (text.length * 0.64)));
  const perFrame = text.length > 9 ? 2 : 1;
  const ink = mix(stamp.colour, "#000000", 0.15);
  return (
    <Band top={top}>
      <div
        style={{
          position: "relative",
          padding: `${Math.round(size * 0.3)}px ${Math.round(size * 0.5)}px ${Math.round(size * 0.32)}px`,
          background: PAPER,
          transform: `rotate(${variant % 2 ? 1.4 : -1.1}deg)`,
          opacity: lin(frame, 0, 2) * out,
          boxShadow: shadow(0.9),
          // Torn top and bottom edges.
          clipPath: `polygon(0 6px, 4% 0, 9% 7px, 15% 2px, 22% 8px, 30% 1px, 38% 6px, 47% 0, 55% 7px, 63% 2px, 71% 8px, 80% 1px, 88% 6px, 95% 0, 100% 5px, 100% calc(100% - 6px), 94% 100%, 86% calc(100% - 7px), 78% calc(100% - 1px), 69% calc(100% - 8px), 60% calc(100% - 2px), 51% calc(100% - 7px), 42% 100%, 33% calc(100% - 6px), 24% calc(100% - 1px), 16% calc(100% - 8px), 8% calc(100% - 2px), 0 calc(100% - 7px))`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: SOFT_GRAIN,
            opacity: 0.6,
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: Math.round(size * 0.14),
          }}
        >
          <Struck
            text={text}
            size={fs}
            colour={ink}
            frame={frame}
            start={0}
            perFrame={perFrame}
            variant={variant}
          />
          {sub ? (
            <Struck
              text={sub}
              size={Math.round(fs * 0.38)}
              colour="#2a2825"
              frame={frame}
              start={Math.ceil(text.length / perFrame) + 1}
              perFrame={3}
              variant={variant + 1}
            />
          ) : null}
        </div>
      </div>
    </Band>
  );
};

export const fitsTypewriter = () => true;
