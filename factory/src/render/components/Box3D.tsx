// The 3D game box on screen (rules in src/render/boxart.ts): the game's cover on the front of a box drawn with
// CSS 3D, a spine in Pulse's ink and amber with the title running up it, a back with the cover's colours
// blurred behind the year and platforms, plastic or card edges. It turns in from its back and settles at three
// quarters with a slow sway. A game with no portrait cover gets a front made from its key art with the title
// on a band, in the same style, never a made-up cover.

import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { boxShape, boxTurn } from "../boxart.ts";
import { displayText } from "../timeline.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const Box3D: React.FC<{
  /** The cover (portrait) or, with portrait false, key art to make a front from. */
  src: string;
  portrait: boolean;
  title: string;
  year?: string;
  platforms?: string;
  /** The box's height in px. */
  height: number;
  /** Frames the box is on screen (for the sway) and the frame it starts turning. */
  len: number;
  startAt?: number;
}> = ({ src, portrait, title, year, platforms, height, len, startAt = 0 }) => {
  const frame = useCurrentFrame() - startAt;
  const shape = boxShape(Number(year) || undefined);
  const H = height;
  const W = Math.round(H * shape.aspect);
  const D = Math.max(8, Math.round(H * shape.depth));
  const turn = boxTurn(frame, len);
  const appear = interpolate(frame, [0, 8], [0, 1], clamp);
  const face = (style: React.CSSProperties, child: React.ReactNode) => (
    <div
      style={{
        position: "absolute",
        backfaceVisibility: "hidden",
        overflow: "hidden",
        ...style,
      }}
    >
      {child}
    </div>
  );
  const cardEdge = shape.depth > 0.1;
  const edge = cardEdge
    ? "linear-gradient(180deg,#2a2a30,#17171b)"
    : "linear-gradient(90deg,#0c0c0f,#2b2b31 45%,#0c0c0f)";
  const spineTitle = displayText(title).toUpperCase();
  return (
    <div
      style={{
        width: W,
        height: H,
        perspective: H * 5,
        opacity: appear,
      }}
    >
      <div
        style={{
          position: "relative",
          width: W,
          height: H,
          transformStyle: "preserve-3d",
          transform: `translateZ(${-D / 2}px) rotateX(-4deg) rotateY(${turn}deg)`,
        }}
      >
        {/* Front: the cover, or key art with the title on a band. */}
        {face(
          {
            width: W,
            height: H,
            borderRadius: shape.round,
            transform: `translateZ(${D / 2}px)`,
            background: COLOUR.ink,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
          },
          <>
            <Img
              src={src}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {portrait ? null : (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: `${H * 0.05}px ${H * 0.04}px`,
                  background:
                    "linear-gradient(0deg, rgba(11,11,14,0.92), rgba(11,11,14,0.6) 70%, rgba(11,11,14,0))",
                  fontFamily: DISPLAY,
                  fontSize: H * 0.085,
                  lineHeight: 1,
                  color: COLOUR.paper,
                  textTransform: "uppercase",
                }}
              >
                {spineTitle}
                <div
                  style={{
                    width: H * 0.18,
                    height: Math.max(2, H * 0.012),
                    background: COLOUR.amber,
                    marginTop: H * 0.025,
                  }}
                />
              </div>
            )}
            {/* The case's sheen. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(${105 + turn * 0.6}deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.16) 48%, rgba(255,255,255,0) 62%)`,
              }}
            />
          </>,
        )}
        {/* Back: the cover's colours blurred under the year and platforms. */}
        {face(
          {
            width: W,
            height: H,
            borderRadius: shape.round,
            transform: `rotateY(180deg) translateZ(${D / 2}px)`,
            background: COLOUR.ink,
          },
          <>
            <Img
              src={src}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "blur(10px) brightness(0.45) saturate(1.2)",
                transform: "scale(1.15)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: H * 0.06,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                gap: H * 0.02,
                fontFamily: BODY,
                fontWeight: 800,
                color: COLOUR.paper,
                fontSize: H * 0.05,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              <div
                style={{
                  width: H * 0.16,
                  height: Math.max(2, H * 0.012),
                  background: COLOUR.amber,
                }}
              />
              {year ? (
                <div style={{ fontFamily: DISPLAY, fontSize: H * 0.1 }}>
                  {year}
                </div>
              ) : null}
              {platforms ? (
                <div style={{ color: COLOUR.muted }}>
                  {displayText(platforms)}
                </div>
              ) : null}
            </div>
          </>,
        )}
        {/* Spine (left): ink with an amber band and the title running up it. */}
        {face(
          {
            width: D,
            height: H,
            left: (W - D) / 2,
            transform: `rotateY(-90deg) translateZ(${W / 2}px)`,
            background: `linear-gradient(90deg, #0b0b0e, #1b1b21 50%, #0b0b0e)`,
          },
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: H * 0.06,
                height: H * 0.05,
                background: COLOUR.amber,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "56%",
                transform: "translate(-50%, -50%) rotate(-90deg)",
                whiteSpace: "nowrap",
                fontFamily: DISPLAY,
                fontSize: Math.min(
                  D * 0.62,
                  ((H * 0.8) / Math.max(6, spineTitle.length)) * 1.6,
                ),
                color: COLOUR.paper,
                letterSpacing: 1,
              }}
            >
              {spineTitle}
            </div>
          </>,
        )}
        {/* The other edge, the top and the bottom. */}
        {face(
          {
            width: D,
            height: H,
            left: (W - D) / 2,
            transform: `rotateY(90deg) translateZ(${W / 2}px)`,
            background: edge,
          },
          null,
        )}
        {face(
          {
            width: W,
            height: D,
            top: (H - D) / 2,
            transform: `rotateX(90deg) translateZ(${H / 2}px)`,
            background: edge,
          },
          null,
        )}
        {face(
          {
            width: W,
            height: D,
            top: (H - D) / 2,
            transform: `rotateX(-90deg) translateZ(${H / 2}px)`,
            background: edge,
          },
          null,
        )}
      </div>
      {/* A soft shadow on the ground under it. */}
      <div
        style={{
          width: W * 1.1,
          height: H * 0.06,
          marginLeft: -W * 0.05,
          marginTop: H * 0.01,
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)",
        }}
      />
    </div>
  );
};

/**
 * A documentary's launch beat: the box turns in at the right of the frame as the narrator says the game came
 * out, with a small RELEASED chip and the year, then slides away.
 */
export const BoxReveal: React.FC<{
  src: string;
  portrait: boolean;
  title: string;
  year?: string;
  platforms?: string;
  len: number;
}> = ({ src, portrait, title, year, platforms, len }) => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [len - 12, len - 1], [0, 1], clamp);
  const chip = interpolate(frame, [18, 30], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(270deg, rgba(11,11,14,0.55), rgba(11,11,14,0) 45%)",
          opacity: interpolate(frame, [0, 12], [0, 1], clamp) * (1 - out),
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 190,
          top: 200,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
          opacity: 1 - out,
          transform: `translateX(${out * 120}px)`,
        }}
      >
        <Box3D
          src={src}
          portrait={portrait}
          title={title}
          year={year}
          platforms={platforms}
          height={520}
          len={len}
        />
        {year ? (
          <div
            style={{
              padding: "8px 18px",
              background: COLOUR.amber,
              color: COLOUR.ink,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 28,
              letterSpacing: 2.5,
              borderRadius: 8,
              opacity: chip,
              transform: `scale(${0.85 + 0.15 * chip})`,
            }}
          >
            RELEASED {year}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
