// Pulse/Platforms (kind "platforms"): the beat's platforms as a Pulse Store listing's "available on" panel,
// drawn for the 952x500 box. The game's picture sits in the listing's corner, the beat's line is the
// listing's heading and each platform drops in as a tile, two frames apart, so the whole card has read by
// frame 14. A beat that says the game is only on one ("Only on Switch 2", "exclusive") gets the single tile
// large with an ONLY ON ribbon; otherwise no platform is singled out. Every word on screen is the beat's or a
// fixed label (PULSE STORE, AVAILABLE ON, ONLY ON, ILLUSTRATION); platform names are text, never logos.
import React from "react";
import { Img, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BODY, DISPLAY } from "../../fonts.ts";
import type { VGfxProps } from "../types.ts";
import { alpha, exitOf, exitStyle, onAccent, shadow } from "../kit.ts";
import { ramp, textW, txt, wrap } from "../words/kit.ts";

const W = 952;
const H = 500;
const PAD = 34;
const MAX_ITEMS = 6;
const MAX_ITEM = 18;

/** The platforms on the card, cleaned, or undefined when the beat cannot be drawn this way. */
export function platformsOf(
  v: VGfxProps["v"],
): { heading: string; items: string[]; only: boolean } | undefined {
  const items = (v.items ?? []).map((x) => txt(x)).filter(Boolean);
  if (!items.length || items.length > MAX_ITEMS) return undefined;
  if (items.some((x) => x.length > MAX_ITEM)) return undefined;
  const heading = txt(v.primary);
  if (heading.length > 34) return undefined;
  const only =
    items.length === 1 &&
    /\b(only|exclusive|exclusively)\b/i.test(`${v.primary} ${v.secondary}`);
  return { heading, items, only };
}

export const fitsPlatforms = (v: VGfxProps["v"]) =>
  v.kind === "platforms" && platformsOf(v) !== undefined;

/** The store's mark: a rounded accent square with a pulse line, drawn in code. */
const Mark: React.FC<{ accent: string; size: number }> = ({ accent, size }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <rect width={48} height={48} rx={12} fill={accent} />
    <polyline
      points="7,26 16,26 20,15 27,35 31,22 34,26 41,26"
      fill="none"
      stroke={onAccent(accent)}
      strokeWidth={4}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

export const Platforms: React.FC<VGfxProps> = ({
  v,
  len,
  accent,
  src,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = platformsOf(v);
  if (!p) return null;
  const out = exitOf(frame, len);
  const rise = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 240, mass: 0.6 },
  });
  const headSize =
    textW(p.heading, "inter800", 50) <= W - 2 * PAD - 150 ? 50 : 40;
  const headLines = wrap(
    p.heading,
    "inter800",
    headSize,
    W - 2 * PAD - 150,
  ) ?? [p.heading];
  const cols = p.only
    ? 1
    : p.items.length <= 3
      ? p.items.length
      : Math.ceil(p.items.length / 2);
  const rows = p.only ? 1 : Math.ceil(p.items.length / cols);
  const gap = 18;
  const tileW = Math.floor((W - 2 * PAD - gap * (cols - 1)) / cols);
  const tileH = p.only ? 150 : rows === 1 ? 118 : 92;
  const longest = Math.max(...p.items.map((x) => textW(x, "inter800", 40)));
  const tileSize = p.only
    ? 76
    : Math.max(
        26,
        Math.min(44, Math.floor((40 * (tileW - 40)) / Math.max(1, longest))),
      );
  const cardH = PAD + 120 + 22 + rows * tileH + (rows - 1) * gap + PAD + 10;
  const top = Math.max(0, Math.round((H - cardH) / 2));
  const dark = variant % 2 === 0;
  const face = dark ? "rgba(22,22,27,0.97)" : "rgba(247,247,249,0.98)";
  const ink = dark ? "#F5F5F2" : "#111114";
  const soft = dark ? "rgba(245,245,242,0.6)" : "rgba(17,17,20,0.55)";
  const ex = exitStyle(out);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: W,
        height: cardH,
        borderRadius: 34,
        background: face,
        boxShadow: shadow(0.8),
        overflow: "hidden",
        opacity: Math.min(1, rise * 1.4) * ex.opacity,
        transform: `${ex.transform} translateY(${(1 - rise) * 40}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: PAD,
          width: 120,
          height: 120,
          borderRadius: 22,
          overflow: "hidden",
          background: alpha(accent, 0.25),
        }}
      >
        {src ? (
          <Img
            src={src}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD + 150,
          top: PAD - 2,
          right: PAD,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Mark accent={accent} size={34} />
        <span
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: 4,
            color: soft,
          }}
        >
          PULSE STORE
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: 3,
            color: soft,
          }}
        >
          ILLUSTRATION
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD + 150,
          top: PAD + 44,
          right: PAD,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: headSize,
          lineHeight: 1.05,
          color: ink,
          opacity: ramp(frame, 3, 9),
        }}
      >
        {headLines.slice(0, 2).join(" ")}
      </div>
      <div
        style={{
          position: "absolute",
          left: PAD,
          top: PAD + 128,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 20,
          letterSpacing: 4,
          color: accent,
          opacity: ramp(frame, 5, 10),
        }}
      >
        {p.only ? "ONLY ON" : "AVAILABLE ON"}
      </div>
      {p.items.map((name, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const s = spring({
          frame: frame - 6 - i * 2,
          fps,
          config: { damping: 13, stiffness: 320, mass: 0.5 },
        });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: PAD + c * (tileW + gap),
              top: PAD + 162 + r * (tileH + gap),
              width: tileW,
              height: tileH,
              borderRadius: 20,
              background: p.only
                ? accent
                : dark
                  ? "rgba(255,255,255,0.07)"
                  : "rgba(17,17,20,0.06)",
              border: p.only ? "none" : `2px solid ${alpha(accent, 0.55)}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: p.only ? DISPLAY : BODY,
              fontWeight: 800,
              fontSize: tileSize,
              color: p.only ? onAccent(accent) : ink,
              opacity: Math.min(1, s * 1.5),
              transform: `translateY(${(1 - s) * 26}px) scale(${0.9 + 0.1 * s})`,
            }}
          >
            {name}
          </div>
        );
      })}
    </div>
  );
};
