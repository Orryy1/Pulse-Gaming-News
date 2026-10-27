// Small touches an editor adds by hand: an accent on some cuts (a light leak, a film burn, a glitch, a
// flash, a dip to black) and the pictures that pop in beside the narration in several looks (a framed
// card, a taped polaroid, a torn cut-out, a desktop window).

import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, HAND } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { PopInPicture } from "./LongMoments.tsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const ACCENTS = [
  "flare",
  "burn",
  "glitch",
  "flash",
  "dip",
  "flare",
  "burn",
] as const;
export type AccentKind = (typeof ACCENTS)[number];
/** Frames an accent starts before its cut, and lasts. */
export const ACCENT_LEAD = 8;
export const ACCENT_FRAMES = 22;

/** One accent over a cut at frame ACCENT_LEAD of its sequence. */
export const CutAccent: React.FC<{ kind: AccentKind; variant?: number }> = ({
  kind,
  variant = 0,
}) => {
  const f = useCurrentFrame() - ACCENT_LEAD; // 0 is the cut
  if (kind === "flare") {
    // A warm leak sweeping across the lens through the cut.
    const x = interpolate(f, [-8, 12], [-30, 130], clamp);
    const o = interpolate(f, [-8, -1, 4, 13], [0, 0.85, 0.7, 0], clamp);
    const y = 30 + (variant % 3) * 18;
    return (
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          mixBlendMode: "screen",
          opacity: o,
          background: `radial-gradient(38% 70% at ${x}% ${y}%, rgba(255,214,150,0.95) 0%, rgba(255,140,60,0.65) 30%, rgba(255,80,30,0.25) 55%, rgba(0,0,0,0) 75%)`,
        }}
      />
    );
  }
  if (kind === "burn") {
    // Film burning through from a corner: a hot core blooming, then gone.
    const s = interpolate(f, [-6, 6], [0.2, 1.5], clamp);
    const o = interpolate(f, [-6, -1, 5, 13], [0, 1, 0.8, 0], clamp);
    const corner = ["0% 100%", "100% 0%", "100% 100%", "0% 0%"][variant % 4];
    return (
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          mixBlendMode: "screen",
          opacity: o,
          background: `radial-gradient(${60 * s}% ${80 * s}% at ${corner}, rgba(255,250,220,1) 0%, rgba(255,190,80,0.9) 25%, rgba(230,90,20,0.6) 50%, rgba(120,20,0,0) 80%)`,
        }}
      />
    );
  }
  if (kind === "glitch") {
    if (f < -2 || f > 3) return null;
    // Three frames of torn signal: colour bands and a slice offset.
    const bands = [0, 1, 2, 3, 4].map((i) => {
      const seed = (i * 37 + (f + 3) * 13 + variant * 7) % 100;
      return {
        top: (seed * 9.7) % 100,
        h: 2 + (seed % 7),
        dx: ((seed % 11) - 5) * 12,
        colour: [
          "rgba(255,40,80,0.45)",
          "rgba(40,230,255,0.4)",
          "rgba(255,255,255,0.35)",
        ][seed % 3]!,
      };
    });
    return (
      <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "screen" }}>
        {bands.map((b, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${b.top}%`,
              height: `${b.h}%`,
              background: b.colour,
              transform: `translateX(${b.dx}px)`,
            }}
          />
        ))}
      </AbsoluteFill>
    );
  }
  if (kind === "flash") {
    const o = interpolate(f, [-1, 1, 8], [0, 0.45, 0], clamp);
    return (
      <AbsoluteFill
        style={{ pointerEvents: "none", background: "#fff", opacity: o }}
      />
    );
  }
  // A dip to black: a breath between thoughts.
  const o = interpolate(f, [-6, 0, 6], [0, 1, 0], clamp);
  return (
    <AbsoluteFill
      style={{ pointerEvents: "none", background: "#000", opacity: o }}
    />
  );
};

type PopProps = {
  src: string;
  caption: string;
  len: number;
  side?: "left" | "right";
  variant?: number;
};

function usePop(len: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.min(120, Math.max(45, len - 10));
  const inP = spring({ frame, fps, config: SPRING.POP });
  const out = interpolate(frame, [showFor - 12, showFor], [1, 0], clamp);
  return { inP, out, visible: frame <= showFor };
}

/** A polaroid tossed onto the frame, held by two strips of tape, its caption in marker. */
const PolaroidPop: React.FC<PopProps> = ({
  src,
  caption,
  len,
  side = "right",
  variant = 0,
}) => {
  const { inP, out, visible } = usePop(len);
  if (!visible) return null;
  const tilt = (side === "right" ? 4 : -4) + (variant % 3) - 1;
  const tape: React.CSSProperties = {
    position: "absolute",
    top: -18,
    width: 120,
    height: 38,
    background: "rgba(236,226,196,0.78)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
  };
  return (
    <div
      style={{
        position: "absolute",
        [side]: 110,
        bottom: 140,
        width: 470,
        opacity: Math.min(1, inP * 1.6) * out,
        transform: `translateY(${(1 - inP) * 120}px) rotate(${tilt + (1 - inP) * (side === "right" ? 14 : -14)}deg)`,
        transformOrigin: "center bottom",
        background: "#f5f2ea",
        padding: "18px 18px 0",
        boxShadow: "0 30px 70px rgba(0,0,0,0.6)",
      }}
    >
      <div style={{ ...tape, left: -30, transform: "rotate(-32deg)" }} />
      <div style={{ ...tape, right: -30, transform: "rotate(30deg)" }} />
      <Img
        src={src}
        style={{
          width: "100%",
          height: 300,
          objectFit: "cover",
          display: "block",
        }}
      />
      <div
        style={{
          height: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: HAND,
          fontSize: caption.length > 24 ? 26 : 32,
          color: "#1d1a17",
          whiteSpace: "nowrap",
          overflow: "hidden",
          padding: "0 10px",
        }}
      >
        {caption}
      </div>
    </div>
  );
};

/** The picture cut out with torn edges and a white border, the caption on masking tape. */
const TornPop: React.FC<PopProps> = ({
  src,
  caption,
  len,
  side = "right",
  variant = 0,
}) => {
  const { inP, out, visible } = usePop(len);
  if (!visible) return null;
  const tilt = side === "right" ? -2 : 2;
  const torn =
    variant % 2
      ? "polygon(2% 4%, 12% 0%, 25% 3%, 38% 0%, 52% 4%, 66% 1%, 80% 4%, 93% 0%, 100% 6%, 98% 22%, 100% 40%, 97% 58%, 100% 76%, 98% 94%, 86% 100%, 70% 96%, 54% 100%, 38% 97%, 22% 100%, 6% 96%, 0% 80%, 3% 62%, 0% 44%, 2% 26%)"
      : "polygon(0% 2%, 15% 4%, 30% 0%, 45% 3%, 60% 0%, 75% 4%, 90% 1%, 100% 3%, 97% 20%, 100% 38%, 98% 55%, 100% 72%, 97% 90%, 100% 100%, 82% 96%, 66% 100%, 50% 97%, 34% 100%, 18% 96%, 2% 100%, 0% 84%, 3% 66%, 0% 48%, 3% 30%)";
  return (
    <div
      style={{
        position: "absolute",
        [side]: 110,
        bottom: 150,
        width: 500,
        opacity: Math.min(1, inP * 1.4) * out,
        transform: `scale(${0.7 + 0.3 * inP}) rotate(${tilt}deg)`,
        transformOrigin: side === "right" ? "right bottom" : "left bottom",
        filter: "drop-shadow(0 22px 34px rgba(0,0,0,0.6))",
      }}
    >
      <div style={{ clipPath: torn, background: "#f7f4ec", padding: 12 }}>
        <Img
          src={src}
          style={{
            width: "100%",
            height: 290,
            objectFit: "cover",
            display: "block",
            clipPath: torn,
          }}
        />
      </div>
      {caption ? (
        <div
          style={{
            position: "absolute",
            left: 40,
            bottom: -26,
            padding: "8px 18px",
            background: "rgba(236,226,196,0.92)",
            transform: "rotate(-3deg)",
            fontFamily: HAND,
            fontSize: 28,
            color: "#1d1a17",
            whiteSpace: "nowrap",
            boxShadow: "0 3px 8px rgba(0,0,0,0.3)",
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
};

/** The picture in a clean desktop window, its caption as the window's title. */
const WindowPop: React.FC<PopProps> = ({
  src,
  caption,
  len,
  side = "right",
}) => {
  const { inP, out, visible } = usePop(len);
  if (!visible) return null;
  return (
    <div
      style={{
        position: "absolute",
        [side]: 110,
        bottom: 150,
        width: 540,
        borderRadius: 14,
        overflow: "hidden",
        background: "#15161b",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 36px 90px rgba(0,0,0,0.65)",
        opacity: inP * out,
        transform: `translateY(${(1 - inP) * 40}px) scale(${0.92 + 0.08 * inP})`,
      }}
    >
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 16px",
          background: "#202128",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div
            key={c}
            style={{ width: 13, height: 13, borderRadius: 7, background: c }}
          />
        ))}
        <div
          style={{
            marginLeft: 12,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 20,
            letterSpacing: 1,
            color: "rgba(245,245,242,0.8)",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {caption}
        </div>
      </div>
      <Img
        src={src}
        style={{
          width: "100%",
          height: 300,
          objectFit: "cover",
          display: "block",
        }}
      />
      <div
        style={{
          height: 5,
          background: COLOUR.amber,
          transform: `scaleX(${inP})`,
          transformOrigin: "left",
        }}
      />
    </div>
  );
};

/** Every pop-in look; the renderer takes them in turn (src/render/Long.tsx). */
export const POPIN_STYLES: Array<React.FC<PopProps>> = [
  PopInPicture,
  PolaroidPop,
  TornPop,
  WindowPop,
];
