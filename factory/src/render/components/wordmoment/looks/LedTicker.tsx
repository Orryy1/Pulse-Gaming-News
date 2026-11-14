// LED ticker: a dot-matrix sign on a black housing, the word made of lit dots in the tone colour and
// scrolling in from the right to its place over ten frames, with a slow brightness shimmer across the
// panel; the sub is a second, smaller row of white dots. Every character is text behind a dot mask.
import React from "react";
import { interpolate } from "remotion";
import type { WordMomentProps, WordStamp } from "../types.ts";
import {
  Band,
  BODY,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  alpha,
  clamp,
  fitBody,
  mix,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

/** The dot grid as a mask: one round dot per `pitch` px, so letters behind it break into LEDs. */
const dots = (pitch: number) =>
  `radial-gradient(circle at 50% 50%, black ${pitch * 0.3}px, transparent ${pitch * 0.34}px) 0 0 / ${pitch}px ${pitch}px repeat`;

const Row: React.FC<{
  text: string;
  size: number;
  pitch: number;
  colour: string;
  width: number;
  scroll: number;
  shimmer: number;
}> = ({ text, size, pitch, colour, width, scroll, shimmer }) => (
  <div
    style={{
      position: "relative",
      width,
      height: Math.round(size * 1.08),
      overflow: "hidden",
    }}
  >
    {/* The unlit dots, barely there. */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: alpha(colour, 0.045),
        WebkitMaskImage: dots(pitch),
        maskImage: dots(pitch),
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        WebkitMaskImage: dots(pitch),
        maskImage: dots(pitch),
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `translateX(${scroll * width}px)`,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: size,
          letterSpacing: Math.round(size * 0.06),
          color: mix(colour, "#ffffff", 0.25),
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
      {/* The shimmer: a soft bright band passing across the lit dots once. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: width * 0.3,
          left: shimmer * width * 1.3 - width * 0.3,
          background: `linear-gradient(90deg, transparent, ${alpha("#ffffff", 0.35)}, transparent)`,
        }}
      />
    </div>
    {/* The glow the lit dots throw on the housing. */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `translateX(${scroll * width}px)`,
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: size,
        letterSpacing: Math.round(size * 0.06),
        color: "transparent",
        textShadow: `0 0 ${Math.round(size * 0.22)}px ${alpha(colour, 0.55)}`,
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  </div>
);

export const LedTicker: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
}) => {
  const { frame, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const width = 860;
  const fs = fitBody(text, width - 80, size * 1.0, 0.06);
  const scroll = interpolate(frame, [0, 10], [1, 0], { ...clamp });
  const shimmer = interpolate(frame, [10, 34], [0, 1], clamp);
  return (
    <Band top={top}>
      <div
        style={{
          position: "relative",
          padding: `${Math.round(size * 0.14)}px ${Math.round(size * 0.2)}px`,
          borderRadius: 12,
          background: "linear-gradient(180deg, #121216 0%, #050507 100%)",
          border: "3px solid #2a2a30",
          boxShadow:
            "0 26px 60px rgba(0,0,0,0.65), inset 0 0 40px rgba(0,0,0,0.9)",
          opacity: interpolate(frame, [0, 2], [0, 1], clamp) * out,
          display: "flex",
          flexDirection: "column",
          gap: Math.round(size * 0.06),
        }}
      >
        <Row
          text={text}
          size={fs}
          pitch={Math.max(7, Math.round(fs * 0.085))}
          colour={stamp.colour}
          width={width}
          scroll={scroll}
          shimmer={shimmer}
        />
        {sub ? (
          <Row
            text={sub}
            size={Math.round(fs * 0.4)}
            pitch={Math.max(5, Math.round(fs * 0.04))}
            colour="#F5F5F2"
            width={width}
            scroll={interpolate(frame, [2, 12], [1, 0], clamp)}
            shimmer={shimmer}
          />
        ) : null}
      </div>
    </Band>
  );
};

export const fitsLedTicker = (s: WordStamp) => wordText(s).length <= 12;
