// The kinetic captions in many hands (owner, 27 Oct 2026: "an extremely huge suite of massively varied
// visual elements"). A sentence's key phrase lands on screen as a slam, in marker with a drawn underline,
// on a torn label with a highlighter swipe, through an RGB glitch, as a rubber stamp, typed out, or rising
// through a mask in two tones. The video rotates through them so no two in a row look alike.

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY, HAND } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { displayText } from "../timeline.ts";
import { KineticCaption } from "./LongMoments.tsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const LEFT = 96;
const TOP = 148;

function useCaption(len: number, hold = 80) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.min(hold, Math.max(45, len - 10));
  const out = interpolate(frame, [showFor - 12, showFor], [1, 0], clamp);
  return { frame, fps, out, visible: frame <= showFor };
}

type CaptionProps = { text: string; len: number; variant?: number };

const words = (t: string) =>
  displayText(t).toUpperCase().split(/\s+/).filter(Boolean).slice(0, 4);

/** In marker, a little tilted, with an underline drawn on under it by hand. */
const MarkerCaption: React.FC<CaptionProps> = ({ text, len, variant = 0 }) => {
  const { frame, fps, out, visible } = useCaption(len);
  if (!visible) return null;
  const t = displayText(text);
  const s = spring({ frame, fps, config: SPRING.POP });
  const draw = interpolate(frame, [8, 24], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 2,
  });
  const tilt = variant % 2 ? -2.5 : -1.5;
  const size = t.length > 22 ? 78 : 96;
  const width = Math.min(1500, t.length * size * 0.56 + 40);
  return (
    <div
      style={{
        position: "absolute",
        left: LEFT,
        top: TOP,
        opacity: out * Math.min(1, s * 1.5),
        transform: `rotate(${tilt}deg) scale(${0.9 + 0.1 * s})`,
        transformOrigin: "left center",
      }}
    >
      <div
        style={{
          fontFamily: HAND,
          fontSize: size,
          lineHeight: 1.05,
          color: COLOUR.paper,
          textShadow: "0 8px 30px rgba(0,0,0,0.75)",
          whiteSpace: "nowrap",
        }}
      >
        {t}
      </div>
      <svg
        width={width}
        height={40}
        style={{ display: "block", marginTop: -6, overflow: "visible" }}
      >
        <path
          d={`M6 22 C ${width * 0.25} ${12 + (variant % 3) * 4}, ${width * 0.6} ${30 - (variant % 2) * 6}, ${width - 10} 16`}
          stroke={COLOUR.amber}
          strokeWidth={11}
          strokeLinecap="round"
          fill="none"
          pathLength={1}
          strokeDasharray={`${draw} 1`}
          style={{ filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))" }}
        />
      </svg>
    </div>
  );
};

/** On a torn paper label, the last word swiped with highlighter. */
const LabelCaption: React.FC<CaptionProps> = ({ text, len, variant = 0 }) => {
  const { frame, fps, out, visible } = useCaption(len);
  if (!visible) return null;
  const ws = words(text);
  const s = spring({ frame, fps, config: SPRING.ENTER });
  const swipe = interpolate(frame, [12, 26], [0, 1], clamp);
  const tilt = variant % 2 ? 1.5 : -1.2;
  return (
    <div
      style={{
        position: "absolute",
        left: LEFT,
        top: TOP,
        padding: "18px 34px 20px",
        background: "#f2ede2",
        clipPath:
          "polygon(0% 6%, 3% 0%, 9% 5%, 16% 1%, 24% 6%, 33% 0%, 41% 5%, 50% 1%, 58% 6%, 67% 0%, 75% 4%, 84% 0%, 92% 5%, 100% 1%, 99% 94%, 94% 100%, 86% 95%, 77% 100%, 69% 95%, 60% 100%, 51% 96%, 42% 100%, 33% 95%, 25% 100%, 16% 95%, 8% 100%, 1% 96%)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
        opacity: out * s,
        transform: `translateX(${(1 - s) * -60}px) rotate(${tilt}deg)`,
        display: "flex",
        gap: 18,
        fontFamily: DISPLAY,
        fontSize: 84,
        lineHeight: 1,
        color: "#16130f",
      }}
    >
      {ws.map((w, i) => (
        <span key={i} style={{ position: "relative", display: "inline-block" }}>
          {i === ws.length - 1 ? (
            <span
              style={{
                position: "absolute",
                left: -8,
                right: -8,
                top: "18%",
                height: "70%",
                background: "rgba(255,140,40,0.75)",
                transform: `scaleX(${swipe}) skewX(-8deg)`,
                transformOrigin: "left",
                borderRadius: 4,
              }}
            />
          ) : null}
          <span style={{ position: "relative" }}>{w}</span>
        </span>
      ))}
    </div>
  );
};

/** Slammed in through an RGB split that settles, a couple of frames of sliced glitch first. */
const GlitchCaption: React.FC<CaptionProps> = ({ text, len, variant = 0 }) => {
  const { frame, out, visible } = useCaption(len);
  if (!visible) return null;
  const t = words(text).join(" ");
  const split = interpolate(frame, [0, 9], [18, 0], clamp);
  const slice = frame < 6 ? ((frame * 7 + variant * 3) % 5) - 2 : 0;
  const size = t.length > 20 ? 88 : 108;
  const base: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    fontFamily: DISPLAY,
    fontSize: size,
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
  return (
    <div
      style={{
        position: "absolute",
        left: LEFT,
        top: TOP,
        height: size + 10,
        width: 1600,
        opacity: out * interpolate(frame, [0, 2], [0, 1], clamp),
        transform: `translateX(${slice * 14}px) skewX(${slice * 3}deg)`,
      }}
    >
      <div
        style={{
          ...base,
          color: "#ff2b4a",
          transform: `translateX(${-split}px)`,
          opacity: 0.85,
          mixBlendMode: "screen",
        }}
      >
        {t}
      </div>
      <div
        style={{
          ...base,
          color: "#2be6ff",
          transform: `translateX(${split}px)`,
          opacity: 0.85,
          mixBlendMode: "screen",
        }}
      >
        {t}
      </div>
      <div
        style={{
          ...base,
          color: COLOUR.paper,
          textShadow: "0 10px 40px rgba(0,0,0,0.7)",
        }}
      >
        {t}
      </div>
    </div>
  );
};

/** A rubber stamp thumped on at an angle: amber ink in a double border. */
const StampCaption: React.FC<CaptionProps> = ({ text, len, variant = 0 }) => {
  const { frame, fps, out, visible } = useCaption(len);
  if (!visible) return null;
  const t = words(text).join(" ");
  const s = spring({
    frame: frame - 2,
    fps,
    config: { damping: 11, stiffness: 300, mass: 0.6 },
  });
  const tilt = variant % 2 ? -7 : -4;
  return (
    <div
      style={{
        position: "absolute",
        left: LEFT,
        top: TOP,
        opacity: out * Math.min(1, s * 2),
        transform: `rotate(${tilt}deg) scale(${1.7 - 0.7 * s})`,
        transformOrigin: "left center",
        padding: "12px 30px",
        border: `7px solid ${COLOUR.amber}`,
        outline: `3px solid ${COLOUR.amber}`,
        outlineOffset: 6,
        borderRadius: 10,
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: t.length > 18 ? 62 : 76,
        letterSpacing: 6,
        color: COLOUR.amber,
        background: "rgba(11,11,14,0.35)",
        textShadow: "0 0 1px rgba(255,107,26,0.6)",
        whiteSpace: "nowrap",
        filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.6))",
      }}
    >
      {t}
    </div>
  );
};

/** Typed out on a dark bar, a caret blinking at the end. */
const TypedCaption: React.FC<CaptionProps> = ({ text, len }) => {
  const { frame, out, visible } = useCaption(len, 90);
  if (!visible) return null;
  const t = words(text).join(" ");
  const shown = Math.min(t.length, Math.max(0, Math.floor((frame - 3) / 1.2)));
  const caret = Math.floor(frame / 8) % 2 === 0 || shown < t.length;
  const bar = interpolate(frame, [0, 8], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: LEFT,
        top: TOP,
        padding: "16px 28px",
        background: "rgba(11,11,14,0.86)",
        borderLeft: `8px solid ${COLOUR.amber}`,
        clipPath: `inset(0 ${(1 - bar) * 100}% 0 0)`,
        opacity: out,
        fontFamily: "'Courier New', Courier, monospace",
        fontWeight: 700,
        fontSize: 64,
        letterSpacing: 2,
        color: COLOUR.paper,
        whiteSpace: "pre",
        boxShadow: "0 18px 40px rgba(0,0,0,0.5)",
      }}
    >
      {t.slice(0, shown)}
      <span style={{ color: COLOUR.amber, opacity: caret ? 1 : 0 }}>{"█"}</span>
    </div>
  );
};

/** Two tones rising through a mask: the words in white, the last in amber, a thin rule drawing beneath. */
const RiseCaption: React.FC<CaptionProps> = ({ text, len }) => {
  const { frame, fps, out, visible } = useCaption(len);
  if (!visible) return null;
  const ws = words(text);
  const rule = interpolate(frame, [6, 22], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", left: LEFT, top: TOP, opacity: out }}>
      <div
        style={{
          display: "flex",
          gap: 20,
          overflow: "hidden",
          paddingBottom: 6,
        }}
      >
        {ws.map((w, i) => {
          const s = spring({ frame: frame - i * 3, fps, config: SPRING.ENTER });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                fontFamily: DISPLAY,
                fontSize: 100,
                lineHeight: 1,
                color:
                  i === ws.length - 1 && ws.length > 1
                    ? COLOUR.amber
                    : COLOUR.paper,
                textShadow: "0 10px 40px rgba(0,0,0,0.7)",
                transform: `translateY(${(1 - s) * 110}%)`,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      <div
        style={{
          height: 3,
          width: 260 * rule,
          background: COLOUR.paper,
          opacity: 0.8,
          marginTop: 10,
        }}
      />
    </div>
  );
};

/** Every caption style; the renderer takes them in turn (src/render/Long.tsx). */
export const CAPTION_STYLES: Array<React.FC<CaptionProps>> = [
  KineticCaption,
  MarkerCaption,
  LabelCaption,
  GlitchCaption,
  StampCaption,
  TypedCaption,
  RiseCaption,
];
