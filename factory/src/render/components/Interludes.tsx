// More looks for a documentary's breather before a chapter (beside the title interlude and the evidence
// board): a clapperboard snapping shut, a VHS tape with the chapter written on its label, and a sheet of
// paper torn apart to show the chapter's picture.

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
import { BODY, DISPLAY, HAND } from "./fonts.ts";
import { SPRING } from "../motion.ts";
import { TextureBackground } from "./Backgrounds.tsx";
import { CONTENT_W, LEGIBLE_SHADOW, fitSize } from "./packs/fit.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type InterludeProps = {
  number: number;
  title: string;
  game: string;
  year?: string;
  frames: number;
  variant?: number;
  /** A wide picture from the chapter, for the torn reveal. */
  picture?: string;
};

function useBreather(frames: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(
    frame,
    [0, 6, frames - 10, frames],
    [0, 1, 1, 0],
    clamp,
  );
  return { frame, fps, fade };
}

/** The clapper arm lands at this frame (the renderer plays the low hit on it). */
export const SLATE_CLAP = 16;

/** A film slate under a spotlight: the arm claps shut, the chapter written on in chalk. */
export const SlateInterlude: React.FC<InterludeProps> = ({
  number,
  title,
  game,
  year,
  frames,
  variant = 0,
}) => {
  const { frame, fps, fade } = useBreather(frames);
  const arm = interpolate(frame, [4, SLATE_CLAP], [-24, 0], {
    ...clamp,
    easing: (x) => x * x * x,
  });
  const shake =
    frame >= SLATE_CLAP && frame < SLATE_CLAP + 6
      ? Math.sin((frame - SLATE_CLAP) * 2.6) * (6 - (frame - SLATE_CLAP))
      : 0;
  const rise = spring({ frame, fps, config: SPRING.ENTER });
  const push = interpolate(frame, [0, frames], [1, 1.06], clamp);
  const write = (k: number) =>
    interpolate(
      frame,
      [SLATE_CLAP + 2 + k * 5, SLATE_CLAP + 14 + k * 5],
      [0, 1],
      clamp,
    );
  const chalk: React.CSSProperties = {
    fontFamily: HAND,
    color: "#f1efe8",
    textShadow: "0 0 2px rgba(255,255,255,0.35)",
  };
  const field = (label: string, value: string, k: number, size = 44) => (
    <div
      style={{
        borderTop: "3px solid rgba(240,238,230,0.75)",
        padding: "10px 18px 6px",
      }}
    >
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 18,
          letterSpacing: 4,
          color: "rgba(240,238,230,0.6)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...chalk,
          fontSize: size,
          lineHeight: 1.1,
          clipPath: `inset(0 ${(1 - write(k)) * 100}% 0 0)`,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {value}
      </div>
    </div>
  );
  const stripes =
    "repeating-linear-gradient(-55deg, #f2f0ea 0px, #f2f0ea 34px, #141414 34px, #141414 68px)";
  return (
    <AbsoluteFill style={{ opacity: fade, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(42% 60% at ${48 + (variant % 3) * 2}% 46%, #3a352e 0%, #1a1714 55%, #0a0908 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${push * 1.24})`,
        }}
      >
        <div
          style={{
            width: 1060,
            transform: `translateY(${(1 - rise) * 80 + shake}px) rotate(${-1.5 + (variant % 2) * 3}deg)`,
            filter: "drop-shadow(0 40px 60px rgba(0,0,0,0.7))",
          }}
        >
          {/* The arm, hinged at its left end. */}
          <div
            style={{
              height: 76,
              background: stripes,
              borderRadius: "8px 8px 2px 2px",
              transformOrigin: "14px 70px",
              transform: `rotate(${arm}deg)`,
              border: "4px solid #101010",
            }}
          />
          <div
            style={{
              height: 60,
              background: stripes,
              border: "4px solid #101010",
              borderTop: "none",
            }}
          />
          <div
            style={{
              background: "#151515",
              border: "4px solid #101010",
              borderTop: "none",
              padding: "6px 0 14px",
            }}
          >
            <div style={{ display: "flex" }}>
              <div style={{ flex: 1 }}>
                {field("PRODUCTION", "PULSE GAMING", 0, 40)}
              </div>
              <div
                style={{
                  width: 280,
                  borderLeft: "3px solid rgba(240,238,230,0.75)",
                }}
              >
                {field("CHAPTER", String(number), 1, 56)}
              </div>
            </div>
            {field("SCENE", title, 2, title.length > 26 ? 50 : 62)}
            <div style={{ display: "flex" }}>
              <div style={{ flex: 1 }}>
                {field("GAME", game, 3, game.length > 30 ? 30 : 38)}
              </div>
              {year ? (
                <div
                  style={{
                    width: 280,
                    borderLeft: "3px solid rgba(240,238,230,0.75)",
                  }}
                >
                  {field("YEAR", year, 4, 44)}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A VHS cassette with the chapter on its handwritten label, the player's PLAY in the corner and tracking lines. */
export const VhsInterlude: React.FC<InterludeProps> = ({
  number,
  title,
  game,
  year,
  frames,
  variant = 0,
}) => {
  const { frame, fps, fade } = useBreather(frames);
  const slide = spring({ frame: frame - 2, fps, config: SPRING.ENTER });
  const write = interpolate(frame, [14, 34], [0, 1], clamp);
  const roll = (frame * 2.4) % 100;
  const jitter = frame < 8 ? ((frame * 13 + variant) % 7) - 3 : 0;
  return (
    <AbsoluteFill
      style={{ opacity: fade, overflow: "hidden", background: "#07080b" }}
    >
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 4px)",
        }}
      />
      {/* A tracking band rolling down the picture. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${roll}%`,
          height: 46,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(220,230,255,0.12) 50%, rgba(255,255,255,0) 100%)",
          transform: `translateX(${jitter * 6}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 120,
          fontFamily: "'Courier New', Courier, monospace",
          fontWeight: 700,
          fontSize: 52,
          letterSpacing: 4,
          color: "#f4f4f4",
          textShadow: "2px 0 rgba(255,40,80,0.6), -2px 0 rgba(40,220,255,0.6)",
          opacity: Math.floor(frame / 15) % 2 === 0 || frame > 40 ? 1 : 0.2,
        }}
      >
        PLAY {"▶"}
      </div>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 1180,
            height: 640,
            borderRadius: 26,
            background: "linear-gradient(180deg, #1d1d20 0%, #121214 100%)",
            boxShadow:
              "0 50px 100px rgba(0,0,0,0.8), inset 0 2px 0 rgba(255,255,255,0.06)",
            transform: `translateY(${(1 - slide) * 260 + jitter}px) rotate(${(variant % 2 ? 1 : -1) * 1.2}deg)`,
            position: "relative",
          }}
        >
          {/* The label. */}
          <div
            style={{
              position: "absolute",
              left: 70,
              right: 70,
              top: 50,
              height: 250,
              background: "linear-gradient(180deg, #f4f1e8 0%, #e9e4d6 100%)",
              borderRadius: 6,
              padding: "18px 34px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 22,
                letterSpacing: 4,
                color: "#9a3a2a",
              }}
            >
              <span>CH. {number}</span>
              <span>{year ?? ""}</span>
            </div>
            <div
              style={{ height: 3, background: "#c94a36", margin: "8px 0 10px" }}
            />
            <div
              style={{
                fontFamily: HAND,
                fontSize: title.length > 24 ? 56 : 70,
                lineHeight: 1.05,
                color: "#1c1a17",
                clipPath: `inset(0 ${(1 - write) * 100}% 0 0)`,
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontFamily: HAND,
                fontSize: 30,
                color: "#4d4740",
                marginTop: 6,
                opacity: write,
              }}
            >
              {game}
            </div>
          </div>
          {/* The window with its two reels turning. */}
          <div
            style={{
              position: "absolute",
              left: 300,
              right: 300,
              top: 350,
              height: 170,
              borderRadius: 14,
              background: "#0a0a0b",
              boxShadow: "inset 0 4px 14px rgba(0,0,0,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-around",
            }}
          >
            {[0, 1].map((k) => (
              <div
                key={k}
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 60,
                  background:
                    k === 0
                      ? "radial-gradient(circle, #e9e6df 0 14%, #2b2a28 15% 52%, #3a3936 53% 100%)"
                      : "radial-gradient(circle, #e9e6df 0 14%, #3a3936 15% 100%)",
                  transform: `rotate(${frame * 9}deg)`,
                }}
              >
                {[0, 60, 120].map((a) => (
                  <div
                    key={a}
                    style={{
                      position: "absolute",
                      left: 57,
                      top: 38,
                      width: 6,
                      height: 44,
                      background: "#0a0a0b",
                      transform: `rotate(${a}deg)`,
                      transformOrigin: "3px 22px",
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Kraft paper torn apart down a jagged line, the chapter's picture and title behind it. */
export const TornInterlude: React.FC<InterludeProps> = ({
  number,
  title,
  game,
  year,
  frames,
  picture,
  variant = 0,
}) => {
  const { frame, fps, fade } = useBreather(frames);
  const tear = interpolate(frame, [10, 34], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  const head = spring({ frame: frame - 24, fps, config: SPRING.ENTER });
  const push = interpolate(frame, [0, frames], [1.08, 1.0], clamp);
  // The tear: a zigzag from top to bottom, a little different each time.
  const pts: string[] = [];
  for (let i = 0; i <= 18; i++) {
    const y = (i / 18) * 100;
    const x =
      50 + (i % 2 ? 1.6 : -1.6) + (((i * 7 + variant * 3) % 5) - 2) * 0.8;
    pts.push(`${x}% ${y}%`);
  }
  const left = `polygon(0% 0%, ${pts.join(", ")}, 0% 100%)`;
  const right = `polygon(100% 0%, ${pts.join(", ")}, 100% 100%)`;
  const half = (clip: string, dir: number): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    clipPath: clip,
    transform: `translateX(${dir * tear * 62}%) rotate(${dir * tear * 4}deg)`,
    filter: "drop-shadow(0 0 24px rgba(0,0,0,0.6))",
  });
  return (
    <AbsoluteFill
      style={{ opacity: fade, overflow: "hidden", background: COLOUR.ink }}
    >
      {picture ? (
        <Img
          src={picture}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${push})`,
            filter: "saturate(0.85) brightness(0.62)",
          }}
        />
      ) : null}
      {/* A dark band behind the title: the chapter's picture is often a face or a bright sky, and the
          title over it read as "sitting on a character's head" (30 Oct 2026). */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(5,5,7,0) 26%, rgba(5,5,7,0.78) 40%, rgba(5,5,7,0.78) 62%, rgba(5,5,7,0) 76%)",
          opacity: head,
        }}
      />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            textAlign: "center",
            maxWidth: CONTENT_W,
            opacity: head,
            transform: `translateY(${(1 - head) * 30}px)`,
          }}
        >
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 30,
              letterSpacing: 8,
              color: COLOUR.amber,
              textShadow: LEGIBLE_SHADOW,
            }}
          >
            CHAPTER {number}
          </div>
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: fitSize(
                title.toUpperCase(),
                "anton",
                CONTENT_W,
                [140, 112, 96, 80, 68],
              ).size,
              lineHeight: 1,
              marginTop: 14,
              color: COLOUR.paper,
              textTransform: "uppercase",
              textShadow: LEGIBLE_SHADOW,
            }}
          >
            {title}
          </div>
          <div
            style={{
              marginTop: 18,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: 3,
              color: "rgba(245,245,242,0.85)",
              textTransform: "uppercase",
            }}
          >
            {[game, year].filter(Boolean).join(" · ")}
          </div>
        </div>
      </AbsoluteFill>
      <div style={half(left, -1)}>
        <TextureBackground kind="kraft" variant={variant} />
      </div>
      <div style={half(right, 1)}>
        <TextureBackground kind="kraft" variant={variant + 1} />
      </div>
    </AbsoluteFill>
  );
};

/**
 * The chapter's title enormous, the chapter's picture showing through its letters; then the camera flies
 * through the letters and out into the picture itself.
 */
export const MaskInterlude: React.FC<InterludeProps> = ({
  number,
  title,
  game,
  year,
  frames,
  picture,
  variant = 0,
}) => {
  const { frame, fade } = useBreather(frames);
  const id = `mask${number}${variant}`;
  const text = title.toUpperCase();
  const size = Math.min(380, 1700 / Math.max(1, text.length * 0.47));
  const start = Math.max(40, frames - 62);
  const t = interpolate(frame, [start, frames - 12], [0, 1], {
    ...clamp,
    easing: (x) => x * x * x,
  });
  const z = 1 + t * 45;
  const reveal = interpolate(frame, [start + 22, frames - 14], [0, 1], clamp);
  const settle = interpolate(frame, [0, start], [1.06, 1], clamp);
  const label = interpolate(
    frame,
    [6, 18, start, start + 10],
    [0, 1, 1, 0],
    clamp,
  );
  return (
    <AbsoluteFill
      style={{ opacity: fade, background: "#050506", overflow: "hidden" }}
    >
      {picture ? (
        <AbsoluteFill style={{ opacity: reveal }}>
          <Img
            src={picture}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      ) : null}
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <mask id={id}>
            <rect width={1920} height={1080} fill="#000" />
            <text
              x={960}
              y={540 + size * 0.36}
              textAnchor="middle"
              fontFamily={DISPLAY}
              fontSize={size}
              fill="#fff"
              transform={`translate(960 540) scale(${z * settle}) translate(-960 -540)`}
            >
              {text}
            </text>
          </mask>
        </defs>
        {picture ? (
          <image
            href={picture}
            width={1920}
            height={1080}
            preserveAspectRatio="xMidYMid slice"
            mask={`url(#${id})`}
          />
        ) : (
          <rect
            width={1920}
            height={1080}
            fill={COLOUR.amber}
            mask={`url(#${id})`}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 540 - size * 0.62 - 70,
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 30,
          letterSpacing: 10,
          color: COLOUR.amber,
          opacity: label,
        }}
      >
        CHAPTER {number}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 540 + size * 0.5 + 30,
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 28,
          letterSpacing: 4,
          color: "rgba(245,245,242,0.8)",
          textTransform: "uppercase",
          opacity: label,
        }}
      >
        {[game, year].filter(Boolean).join(" \u00B7 ")}
      </div>
    </AbsoluteFill>
  );
};
