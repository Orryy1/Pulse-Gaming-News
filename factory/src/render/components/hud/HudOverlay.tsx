// The HUD graphics on a GTA 6 Day N Short (src/hudreader/overlay.ts): the location pin in the first 2 seconds, the
// wanted-level ticker, and the "every spot so far" end map. Pulse's own graphics drawn from Pulse's own measurements
// of the owner's footage: the map is stitched from his minimap, never Rockstar's map art or logo.

import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, DISPLAY } from "../fonts.ts";
import { BANDS, CONTENT_WIDTH, SAFE } from "../../layout.ts";
import type {
  HudEndMapProps,
  HudOverlayProps,
  HudPinProps,
  HudTickerProps,
} from "../../../hudreader/overlay.ts";

const src = (s: string) =>
  /^(https?:|data:|blob:)/.test(s) ? s : staticFile(s);

const STAR_PATH =
  "M12 1.8l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9l7.1-.6z";

const Star: React.FC<{ size: number; filled: boolean; accent: string }> = ({
  size,
  filled,
  accent,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{ display: "block" }}
  >
    <path
      d={STAR_PATH}
      fill={filled ? accent : "rgba(11,11,14,0.55)"}
      stroke={filled ? "#1a0a00" : "rgba(245,245,242,0.65)"}
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  </svg>
);

const PinIcon: React.FC<{ size: number; accent: string }> = ({
  size,
  accent,
}) => (
  <svg
    width={size}
    height={size * 1.3}
    viewBox="0 0 24 31"
    style={{ display: "block" }}
  >
    <path
      d="M12 0C5.4 0 0 5.3 0 11.9 0 20.6 12 31 12 31s12-10.4 12-19.1C24 5.3 18.6 0 12 0z"
      fill={accent}
      stroke="#0B0B0E"
      strokeWidth={1.6}
    />
    <circle cx={12} cy={11.6} r={4.6} fill="#0B0B0E" />
  </svg>
);

export const HudPin: React.FC<{ p: HudPinProps; accent: string }> = ({
  p,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < p.from || t >= p.until) return null;
  const local = frame - Math.round(p.from * fps);
  // On screen from the first frame (a feed shows frame one), with a small settle rather than a fade in.
  const drop = spring({
    frame: local,
    fps,
    config: { damping: 11, mass: 0.6 },
  });
  const out = interpolate(t, [p.until - 0.22, p.until], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const disc = 250;
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: BANDS.shelf[0] - 10,
        width: CONTENT_WIDTH,
        display: "flex",
        alignItems: "center",
        gap: 30,
        opacity: out,
      }}
    >
      <div
        style={{
          position: "relative",
          width: disc,
          height: disc,
          borderRadius: "50%",
          overflow: "hidden",
          border: `6px solid ${accent}`,
          boxShadow: "0 16px 44px rgba(0,0,0,0.65)",
          background: COLOUR.ink,
          transform: `scale(${interpolate(drop, [0, 1], [0.92, 1])})`,
          flexShrink: 0,
        }}
      >
        {p.mapImage ? (
          <Img
            src={src(p.mapImage)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            left: `${(p.dot?.x ?? 0.5) * 100}%`,
            top: `${(p.dot?.y ?? 0.5) * 100}%`,
            transform: `translate(-50%, -100%) translateY(${interpolate(drop, [0, 1], [-40, 0])}px)`,
          }}
        >
          <PinIcon size={56} accent={accent} />
        </div>
      </div>
      <div
        style={{
          background: "rgba(11,11,14,0.84)",
          borderRadius: 18,
          padding: "18px 26px 20px",
          boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
          maxWidth: CONTENT_WIDTH - disc - 30,
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 28,
            letterSpacing: 2,
            color: accent,
            textTransform: "uppercase",
          }}
        >
          {p.sub}
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: p.label.length > 18 ? 54 : 66,
            lineHeight: 1.02,
            color: COLOUR.paper,
            textTransform: "uppercase",
          }}
        >
          {p.label}
        </div>
      </div>
    </div>
  );
};

/** The level at a time (pure). */
export function starsAt(
  changes: HudTickerProps["changes"],
  t: number,
): { stars: number; since: number } {
  let cur = { stars: 0, since: -Infinity };
  for (const c of changes) if (c.t <= t) cur = { stars: c.stars, since: c.t };
  return cur;
}

export const HudTicker: React.FC<{ p: HudTickerProps; accent: string }> = ({
  p,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < p.from || t >= p.until) return null;
  const { stars, since } = starsAt(p.changes, t);
  const pulse = Number.isFinite(since)
    ? spring({
        frame: frame - Math.round(since * fps),
        fps,
        config: { damping: 8, mass: 0.4 },
      })
    : 1;
  const bump =
    Number.isFinite(since) && t - since < 0.6
      ? interpolate(pulse, [0, 1], [1.35, 1])
      : 1;
  return (
    <div
      style={{
        position: "absolute",
        right: 1080 - SAFE.right,
        top: BANDS.brand[0] + 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 6,
          transform: `scale(${bump})`,
          transformOrigin: "right center",
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.8))",
        }}
      >
        {Array.from({ length: p.max }, (_, i) => (
          <Star key={i} size={52} filled={i < stars} accent={accent} />
        ))}
      </div>
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 22,
          letterSpacing: 3,
          color: "rgba(245,245,242,0.85)",
          textShadow: "0 2px 8px rgba(0,0,0,0.9)",
        }}
      >
        WANTED {stars}/{p.max}
      </div>
    </div>
  );
};

export const HudEndMap: React.FC<{ p: HudEndMapProps; accent: string }> = ({
  p,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (t < p.from || t >= p.until) return null;
  const local = frame - Math.round(p.from * fps);
  const rise = spring({
    frame: local,
    fps,
    config: { damping: 14, mass: 0.7 },
  });
  const boxW = CONTENT_WIDTH;
  const boxH = BANDS.shelf[0] - BANDS.hero[0] - 70;
  const scale = Math.min(boxW / p.width, boxH / p.height);
  const w = p.width * scale;
  const h = p.height * scale;
  const ring = (local % Math.round(fps * 0.9)) / (fps * 0.9);
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: BANDS.hero[0],
        width: boxW,
        opacity: Math.min(1, rise * 1.6),
        transform: `translateY(${interpolate(rise, [0, 1], [40, 0])}px)`,
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 58,
          color: COLOUR.paper,
          textTransform: "uppercase",
          textShadow: "0 4px 18px rgba(0,0,0,0.9)",
          marginBottom: 12,
        }}
      >
        {p.title}
      </div>
      <div
        style={{
          position: "relative",
          width: w,
          height: h,
          margin: "0 auto",
          borderRadius: 20,
          overflow: "hidden",
          background: "rgba(11,11,14,0.86)",
          border: `3px solid ${accent}`,
          boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
        }}
      >
        <Img
          src={src(p.image)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />
        {p.spots.map((s) => (
          <div
            key={s.day}
            style={{
              position: "absolute",
              left: s.x * w,
              top: s.y * h,
              transform: "translate(-50%, -50%)",
            }}
          >
            {s.today ? (
              <div
                style={{
                  position: "absolute",
                  left: -34 * (0.6 + ring),
                  top: -34 * (0.6 + ring),
                  width: 68 * (0.6 + ring),
                  height: 68 * (0.6 + ring),
                  borderRadius: "50%",
                  border: `4px solid ${accent}`,
                  opacity: 1 - ring,
                }}
              />
            ) : null}
            <div
              style={{
                width: s.today ? 30 : 22,
                height: s.today ? 30 : 22,
                marginLeft: s.today ? -15 : -11,
                marginTop: s.today ? -15 : -11,
                borderRadius: "50%",
                background: s.today ? accent : COLOUR.paper,
                border: "3px solid #0B0B0E",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 13,
                color: COLOUR.ink,
              }}
            >
              {s.today ? "" : s.day}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const HudOverlay: React.FC<{ hud: HudOverlayProps }> = ({ hud }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {hud.ticker ? <HudTicker p={hud.ticker} accent={hud.accent} /> : null}
    {hud.pin ? <HudPin p={hud.pin} accent={hud.accent} /> : null}
    {hud.endMap ? <HudEndMap p={hud.endMap} accent={hud.accent} /> : null}
  </AbsoluteFill>
);
