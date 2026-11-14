// Dymo: an embossed tape label in the tone colour, the letters raised in white the way the wheel presses
// them (a light edge above, a dark edge below), fed out of the gun from the left over ten frames and
// snipped at the end with a jolt. The sub is a second, thinner strip of tape beneath.
import React from "react";
import type { WordMomentProps, WordStamp } from "../types.ts";
import {
  Band,
  BODY,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  alpha,
  fitBody,
  jolt,
  lin,
  mix,
  shadow,
  subText,
  textW,
  useMoment,
  wordText,
} from "../kit.tsx";

const Tape: React.FC<{
  text: string;
  size: number;
  colour: string;
  fed: number;
  cut: number;
}> = ({ text, size, colour, fed, cut }) => {
  const spacing = Math.round(size * 0.14);
  const w = Math.ceil(textW(text, "inter900", size, spacing)) + size * 1.1;
  const h = Math.round(size * 1.6);
  const dark = mix(colour, "#000000", 0.35);
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        clipPath: `inset(0 ${(1 - fed) * 100}% 0 0)`,
        transform: `translateX(${jolt(cut, 5, 2, 2.2)}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          // The tape's end is cut on a slight slant, as the gun's blade leaves it.
          clipPath: "polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%)",
          background: `linear-gradient(180deg, ${mix(colour, "#ffffff", 0.08)} 0%, ${colour} 35%, ${dark} 100%)`,
          boxShadow: shadow(0.6),
        }}
      />
      {/* The tape's plastic sheen: a thin highlight along the top edge. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: Math.round(h * 0.18),
          background: `linear-gradient(180deg, ${alpha("#ffffff", 0.22)} 0%, transparent 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: size,
          letterSpacing: spacing,
          paddingLeft: spacing,
          color: "#f7f7f4",
          whiteSpace: "nowrap",
          textShadow: `0 -2px 0 ${alpha("#ffffff", 0.55)}, 0 2px 0 ${alpha(dark, 0.95)}, 0 3px 2px rgba(0,0,0,0.55)`,
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const Dymo: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const fs = fitBody(text, 700, size * 0.82, 0.14);
  const fed = lin(frame, 0, 9);
  const subFed = lin(frame, 3, 12);
  return (
    <Band top={top}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: Math.round(size * 0.1),
          transform: `rotate(${variant % 2 ? 1.5 : -1.5}deg)`,
          opacity: out,
        }}
      >
        <Tape
          text={text}
          size={fs}
          colour={stamp.colour}
          fed={fed}
          cut={frame - 10}
        />
        {sub ? (
          <Tape
            text={sub}
            size={Math.round(fs * 0.4)}
            colour="#1d1d22"
            fed={subFed}
            cut={frame - 13}
          />
        ) : null}
      </div>
    </Band>
  );
};

export const fitsDymo = (s: WordStamp) => wordText(s).length <= 12;
