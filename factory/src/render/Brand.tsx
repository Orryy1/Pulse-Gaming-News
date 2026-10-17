// Channel brand stills, rendered from the same tokens as the Shorts so the
// banner, avatar and thumbnails match the videos frame for frame.

import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";

const Grid: React.FC<{ opacity?: number; cell?: number }> = ({
  opacity = 0.05,
  cell = 120,
}) => (
  <div
    style={{
      position: "absolute",
      inset: -400,
      top: "40%",
      backgroundImage: `linear-gradient(rgba(255,255,255,${opacity}) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,${opacity}) 2px, transparent 2px)`,
      backgroundSize: `${cell}px ${cell}px`,
      transform: "perspective(1200px) rotateX(58deg)",
      transformOrigin: "50% 100%",
    }}
  />
);

const Field: React.FC<{ children: React.ReactNode; glow?: string }> = ({
  children,
  glow = COLOUR.amber,
}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 70% at 50% 0%, #17171d 0%, ${COLOUR.ink} 55%, #050507 100%)`,
      overflow: "hidden",
    }}
  >
    <Grid />
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "62%",
        width: "60%",
        height: "40%",
        transform: "translate(-50%, -50%)",
        background: `radial-gradient(ellipse at center, ${glow}33 0%, transparent 65%)`,
      }}
    />
    {children}
  </AbsoluteFill>
);

const Lockup: React.FC<{ size: number; logo?: boolean }> = ({
  size,
  logo = true,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
    {logo ? (
      <Img
        src={staticFile("logo.png")}
        style={{
          width: size * 1.35,
          height: size * 1.35,
          borderRadius: size * 0.3,
        }}
      />
    ) : null}
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: size,
        color: COLOUR.paper,
        letterSpacing: size * 0.04,
        lineHeight: 1,
      }}
    >
      PULSE<span style={{ color: COLOUR.amber }}>.</span>
    </div>
  </div>
);

/**
 * Channel banner, 2560x1440. YouTube shows only the central 1546x423 on every
 * device, so the lockup, line and promise sit inside that box; the rest is
 * field and grid that frames it on TV and desktop.
 */
export const Banner: React.FC = () => (
  <Field>
    <div
      style={{
        position: "absolute",
        left: (2560 - 1546) / 2,
        top: (1440 - 423) / 2,
        width: 1546,
        height: 423,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 48px",
      }}
    >
      <div>
        <Lockup size={150} />
        <div
          style={{
            marginTop: 26,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 34,
            letterSpacing: 6,
            color: COLOUR.muted,
            textTransform: "uppercase",
          }}
        >
          Gaming news, checked and explained
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            display: "inline-block",
            padding: "14px 28px",
            background: COLOUR.amber,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 36,
            letterSpacing: 4,
            borderRadius: 10,
            whiteSpace: "nowrap",
          }}
        >
          NEW SHORTS DAILY
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: 32,
            letterSpacing: 2,
            color: "rgba(245,245,242,0.75)",
          }}
        >
          12:00 · 16:00 · 19:30 UK
        </div>
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: (1440 + 423) / 2 + 36,
        height: 6,
        background: `linear-gradient(90deg, transparent 0%, ${COLOUR.amber} 30%, ${COLOUR.amber} 70%, transparent 100%)`,
      }}
    />
  </Field>
);

/** Avatar, 800x800: the mark on the field, readable at 48 px. */
export const Avatar: React.FC = () => (
  <Field>
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Img
        src={staticFile("logo.png")}
        style={{
          width: 560,
          height: 560,
          borderRadius: 120,
          boxShadow: `0 0 120px ${COLOUR.amber}55`,
        }}
      />
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 16,
        background: COLOUR.amber,
      }}
    />
  </Field>
);

export type ThumbProps = {
  headline: string;
  kicker: string; // e.g. "DELAYED", "REVIEWS ARE IN"
  game: string;
  imageSrc: string | null; // key art; the field shows when null
  accent: string;
};

/** Long-form thumbnail, 1280x720: art on the right, three-word headline on the left, kicker chip, lockup. */
export const Thumb: React.FC<ThumbProps> = ({
  headline,
  kicker,
  game,
  imageSrc,
  accent,
}) => (
  <Field glow={accent}>
    {imageSrc ? (
      <>
        <Img
          src={imageSrc}
          style={{
            position: "absolute",
            left: 520,
            top: 0,
            width: 760,
            height: 720,
            objectFit: "cover",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 480,
            top: 0,
            width: 420,
            height: 720,
            background: `linear-gradient(90deg, ${COLOUR.ink} 0%, transparent 100%)`,
          }}
        />
      </>
    ) : null}
    <div style={{ position: "absolute", left: 56, top: 56 }}>
      <Lockup size={44} />
    </div>
    <div style={{ position: "absolute", left: 56, top: 150, width: 640 }}>
      <div
        style={{
          display: "inline-block",
          padding: "8px 18px",
          background: accent,
          color: COLOUR.ink,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 28,
          letterSpacing: 3,
          borderRadius: 8,
        }}
      >
        {kicker.toUpperCase()}
      </div>
      <div
        style={{
          marginTop: 22,
          fontFamily: DISPLAY,
          fontSize: 120,
          lineHeight: 0.98,
          color: COLOUR.paper,
          textShadow: "0 10px 50px rgba(0,0,0,0.8)",
        }}
      >
        {headline.toUpperCase()}
      </div>
      <div
        style={{
          marginTop: 20,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 30,
          letterSpacing: 3,
          color: COLOUR.muted,
          textTransform: "uppercase",
        }}
      >
        {game}
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 10,
        background: accent,
      }}
    />
  </Field>
);

export const SAMPLE_THUMB: ThumbProps = {
  headline: "Slips to 2027",
  kicker: "Delayed",
  game: "Starfield",
  imageSrc: null,
  accent: COLOUR.alert,
};
