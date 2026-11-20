// The three research devices on screen (plans in src/render/boldideas.ts), each behind its own switch:
// ScreenshotWall (CHAPTER_WALL), DepthType (DEPTH_TYPE) and CompareWipe (COMPARE_WIPE). Everything is a function
// of the frame (CSS 3D transforms, no randomness at render time), so a frame re-renders identically.

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
import { BODY, DISPLAY } from "./fonts.ts";
import { wallLayout } from "../boldideas.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (x: number) => x * x * (3 - 2 * x);

/**
 * CHAPTER_WALL: the chapter's stills as cards on a curved wall in real perspective; the cards settle in one by one
 * and the camera drifts slowly into the wall and turns a few degrees, with the far cards lost in the dark.
 */
export const ScreenshotWall: React.FC<{
  pictures: string[];
  frames: number;
  seed?: number;
}> = ({ pictures, frames, seed = 1 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const k = width / 1920;
  const cards = wallLayout(pictures.length, seed);
  const t = ease(Math.min(1, frame / Math.max(1, frames)));
  const dolly = -260 + 420 * t;
  const turn = (seed % 2 ? 1 : -1) * (-3 + 6 * t);
  const out = interpolate(frame, [frames - 12, frames], [1, 0], clamp);
  return (
    <AbsoluteFill
      style={{ background: COLOUR.ink, overflow: "hidden", opacity: out }}
    >
      <AbsoluteFill
        style={{ perspective: 1300 * k, perspectiveOrigin: "50% 46%" }}
      >
        <div
          style={{
            position: "absolute",
            left: width / 2,
            top: height / 2,
            transformStyle: "preserve-3d",
            transform: `translateZ(${dolly * k}px) rotateY(${turn}deg)`,
          }}
        >
          {cards.map((c, i) => {
            const arrive = interpolate(frame, [c.delay, c.delay + 16], [0, 1], {
              ...clamp,
              easing: ease,
            });
            // The far cards sink into the dark, the near ones keep their colour.
            const fog = Math.max(0.25, Math.min(1, 1 + (c.z + dolly) / 1400));
            const w = c.w * k;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  width: w,
                  height: w * 0.5625,
                  left: -w / 2,
                  top: (-w * 0.5625) / 2,
                  transform: `translate3d(${c.x * k}px, ${(c.y + (1 - arrive) * 60) * k}px, ${(c.z - (1 - arrive) * 300) * k}px) rotateY(${c.ry}deg)`,
                  opacity: arrive,
                  boxShadow: `0 ${30 * k}px ${80 * k}px rgba(0,0,0,0.7)`,
                  outline: `${2 * k}px solid rgba(255,255,255,0.10)`,
                  filter: `brightness(${fog}) saturate(${0.75 + 0.25 * fog})`,
                }}
              >
                <Img
                  src={pictures[i]!}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {/* A vignette so the title reads over the wall. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(70% 60% at 50% 50%, rgba(11,11,14,0.35) 0%, rgba(11,11,14,0.85) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * DEPTH_TYPE: the still's far layers, then the phrase set huge and rising through a mask on its word, then the
 * picture's subject in front of the letters. The layers drift a little like the usual 2.5D shot.
 */
export const DepthType: React.FC<{
  layers: { bg: string; mid: string; fg: string };
  phrase: string;
  at: number;
  len: number;
  dir?: 1 | -1;
  /** Where the layers sit in a crop narrower than the picture (a Short: round its subject, focusPosition). */
  position?: string;
}> = ({ layers, phrase, at, len, dir = 1, position }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const p = Math.min(1, frame / Math.max(1, len));
  const rise = spring({
    frame: frame - at,
    fps,
    config: { damping: 200, stiffness: 120, mass: 0.9 },
  });
  const truck = (p - 0.5) * 30 * dir * (width / 1920);
  const words = phrase.toUpperCase();
  const size = Math.min(
    height * 0.34,
    (width * 0.9) / Math.max(4, words.length * 0.56),
  );
  const layer = (src: string, k: number) => (
    <Img
      src={src}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: position,
        filter: "contrast(1.03) saturate(1.05)",
        transform: `scale(${1.08 + 0.03 * k * p}) translateX(${truck * k}px)`,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {layer(layers.bg, 0)}
      {layer(layers.mid, 0.6)}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ overflow: "hidden", padding: `0 ${size * 0.1}px` }}>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: size,
              lineHeight: 0.92,
              letterSpacing: size * 0.01,
              color: COLOUR.paper,
              textShadow: `0 ${size * 0.04}px ${size * 0.12}px rgba(0,0,0,0.45)`,
              transform: `translateY(${(1 - rise) * 105}%) translateX(${truck * 0.3}px)`,
              whiteSpace: "nowrap",
            }}
          >
            {words}
          </div>
        </div>
      </AbsoluteFill>
      {layer(layers.fg, 1.4)}
    </AbsoluteFill>
  );
};

/**
 * COMPARE_WIPE: two games' pictures share the frame; the wipe line slides in from the right, overshoots a touch and
 * settles off-centre, then drifts, so neither picture is cut exactly in half. Each side is labelled with its game.
 */
export const CompareWipe: React.FC<{
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
  len: number;
}> = ({ left, right, leftLabel, rightLabel, len }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const k = width / 1920;
  const s = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  const settle = 54 + 4 * Math.sin((frame / fps) * 1.1);
  const x = interpolate(s, [0, 1], [100, settle]);
  const fade = interpolate(frame, [0, 6, len - 8, len], [0, 1, 1, 0], clamp);
  const label = (text: string, side: "l" | "r") => (
    <div
      style={{
        position: "absolute",
        bottom: 70 * k,
        [side === "l" ? "left" : "right"]: 60 * k,
        padding: `${10 * k}px ${18 * k}px`,
        background: "rgba(11,11,14,0.78)",
        borderLeft:
          side === "l" ? `${6 * k}px solid ${COLOUR.amber}` : undefined,
        borderRight:
          side === "r" ? `${6 * k}px solid ${COLOUR.amber}` : undefined,
        color: COLOUR.paper,
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: 34 * k,
        letterSpacing: 3 * k,
        textTransform: "uppercase",
        opacity: interpolate(frame, [10, 20], [0, 1], clamp),
      }}
    >
      {text}
    </div>
  );
  const pic = (src: string, z: number) => (
    <Img
      src={src}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${1.05 + 0.03 * Math.min(1, frame / Math.max(1, len))})`,
        zIndex: z,
      }}
    />
  );
  return (
    <AbsoluteFill
      style={{ overflow: "hidden", opacity: fade, background: COLOUR.ink }}
    >
      {pic(right, 0)}
      <AbsoluteFill style={{ clipPath: `inset(0 ${100 - x}% 0 0)`, zIndex: 1 }}>
        {pic(left, 0)}
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${x}%`,
          width: 6 * k,
          marginLeft: -3 * k,
          background: COLOUR.paper,
          boxShadow: `0 0 ${24 * k}px rgba(255,255,255,0.6)`,
          zIndex: 2,
        }}
      />
      <div style={{ position: "absolute", inset: 0, zIndex: 3 }}>
        {label(leftLabel, "l")}
        {label(rightLabel, "r")}
      </div>
    </AbsoluteFill>
  );
};
