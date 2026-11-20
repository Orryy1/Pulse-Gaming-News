// GAME_LOOK: the corners and HUD-like framing of a game's look (src/render/gamelook.ts), drawn over a full-screen
// graphic and on the look's chapter card. Homages built from scratch (layout, colour, motion), never a real HUD,
// icon or logo. Everything sits inside the safe edge and clear of the lower third, where Pulse's own chapter tag,
// title bar and credit live; the top right holds the one HUD piece.

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { loadFont } from "@remotion/fonts";
import {
  LOOK_FONTS,
  lookFont,
  useLook,
  withAlpha,
  type GameLook,
} from "../gamelook.ts";
import { MIN_HOLD, stageHold } from "./DocGraphics.tsx";
import { BODY } from "./fonts.ts";
import { textWidth, wrapText, type Face } from "./packs/fit.ts";

// The look faces ship in public/fonts (SIL OFL); loaded only in the renderer, as fonts.ts does.
if (typeof document !== "undefined") {
  for (const f of Object.values(LOOK_FONTS))
    if (f.family !== "PulseDisplay")
      loadFont({
        family: f.family,
        url: staticFile(`fonts/${f.file}`),
        weight: f.weight,
      });
}

const W = 1920;
const H = 1080;
const INSET = 44;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * A heading set in the look's face: the largest size from the ladder whose lines (at most `maxLines`) fit `maxW`,
 * measured with the nearest face the fit estimates know, scaled to this face's width.
 */
export function fitLookText(
  text: string,
  font: { face: Face; scale: number },
  maxW: number,
  sizes: number[],
  maxLines = 2,
  spacing = 0,
): { size: number; lines: string[] } {
  for (const size of sizes) {
    const lines = wrapText(text, font.face, size * font.scale, maxW, spacing);
    if (lines && lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1] ?? 32;
  return {
    size,
    lines: wrapText(text, font.face, size * font.scale, maxW, spacing) ?? [
      text,
    ],
  };
}

/** The width a line takes in the look's face (px). */
export function lookTextWidth(
  text: string,
  font: { face: Face; scale: number },
  size: number,
  spacing = 0,
): number {
  return textWidth(text, font.face, size * font.scale, spacing);
}

const Corners: React.FC<{
  look: GameLook;
  on: number;
  frame: number;
  variant: number;
}> = ({ look, on, frame, variant }) => {
  const a = look.accent;
  const b = look.accent2;
  const L = 96 * on;
  const corners: Array<[number, number, number, number]> = [
    [INSET, INSET, 1, 1],
    [W - INSET, INSET, -1, 1],
    [INSET, H - INSET, 1, -1],
    [W - INSET, H - INSET, -1, -1],
  ];
  const paths: React.ReactNode[] = [];
  corners.forEach(([x, y, sx, sy], i) => {
    if (look.corner === "chamfer") {
      const c = 22;
      paths.push(
        <path
          key={i}
          d={`M${x + sx * L} ${y}H${x + sx * c}L${x} ${y + sy * c}V${y + sy * L}`}
          stroke={a}
          strokeWidth={5}
          fill="none"
        />,
        <rect
          key={`t${i}`}
          x={x + sx * (L + 10) - (sx < 0 ? 18 : 0)}
          y={y - 2}
          width={18 * on}
          height={5}
          fill={b}
        />,
      );
    } else if (look.corner === "bracket") {
      paths.push(
        <path
          key={i}
          d={`M${x + sx * L} ${y}H${x}V${y + sy * L}`}
          stroke={a}
          strokeWidth={5}
          fill="none"
        />,
      );
    } else if (look.corner === "pixel") {
      const s = 12;
      for (let k = 0; k < 4; k++)
        paths.push(
          <rect
            key={`${i}-${k}`}
            x={x + sx * k * s - (sx < 0 ? s : 0)}
            y={y + sy * (3 - k) * s - (sy < 0 ? s : 0)}
            width={s * on}
            height={s * on}
            fill={k % 2 ? b : a}
          />,
          <rect
            key={`${i}-h${k}`}
            x={x + sx * (4 + k) * s - (sx < 0 ? s : 0)}
            y={y - (sy < 0 ? s : 0)}
            width={s * on}
            height={s * on}
            fill={a}
            opacity={1 - k * 0.22}
          />,
          <rect
            key={`${i}-v${k}`}
            x={x - (sx < 0 ? s : 0)}
            y={y + sy * (4 + k) * s - (sy < 0 ? s : 0)}
            width={s * on}
            height={s * on}
            fill={a}
            opacity={1 - k * 0.22}
          />,
        );
    } else if (look.corner === "ornate") {
      const r = 34;
      paths.push(
        <path
          key={i}
          d={`M${x + sx * L} ${y}H${x + sx * r}Q${x} ${y} ${x} ${y + sy * r}V${y + sy * L}`}
          stroke={a}
          strokeWidth={4}
          fill="none"
        />,
        <path
          key={`i${i}`}
          d={`M${x + sx * (L - 18)} ${y + sy * 12}H${x + sx * (r + 6)}Q${x + sx * 12} ${y + sy * 12} ${x + sx * 12} ${y + sy * (r + 6)}V${y + sy * (L - 18)}`}
          stroke={b}
          strokeWidth={2}
          fill="none"
          opacity={0.85}
        />,
        <path
          key={`d${i}`}
          d={`M${x + sx * 26} ${y + sy * 18}l${sx * 8} ${sy * 8}l${-sx * 8} ${sy * 8}l${-sx * 8} ${-sy * 8}z`}
          fill={b}
          opacity={on}
        />,
      );
    } else if (look.corner === "scratch") {
      // Rough brush strokes: a few jittered lines, fixed per variant so a frame never shimmers.
      const j = (k: number) =>
        Math.sin((variant + 1) * 12.9898 + k * 78.233) * 6;
      for (let k = 0; k < 3; k++)
        paths.push(
          <path
            key={`${i}-${k}`}
            d={`M${x + sx * (L + j(k))} ${y + sy * (k * 5 + j(k + 3) * 0.3)}L${x + sx * (6 + k * 4)} ${y + sy * (k * 4)}L${x + sx * (k * 5 + j(k + 5) * 0.3)} ${y + sy * (L * 0.85 + j(k + 7))}`}
            stroke={k === 1 ? b : a}
            strokeWidth={k === 0 ? 6 : 2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={k === 0 ? 0.95 : 0.6}
          />,
        );
    }
  });
  // A faint flicker for the horror look only, never a flash: 0.9 to 1.
  const flicker =
    look.corner === "scratch"
      ? 0.92 + 0.08 * Math.abs(Math.sin(frame * 0.9 + variant))
      : 1;
  return (
    <svg
      width={W}
      height={H}
      style={{
        position: "absolute",
        inset: 0,
        opacity: flicker,
        filter: `drop-shadow(0 0 10px ${withAlpha(a, 0.45)})`,
      }}
    >
      {paths}
    </svg>
  );
};

const Hud: React.FC<{ look: GameLook; on: number; frame: number; variant: number }> = ({
  look,
  on,
  frame,
  variant,
}) => {
  const right = 72;
  const top = 64;
  if (look.hud === "minimap") {
    const r = 58;
    const sweep = (frame * 4) % 360;
    return (
      <svg
        width={2 * r + 20}
        height={2 * r + 20}
        style={{
          position: "absolute",
          right: right - 10,
          top: top - 10,
          opacity: on,
        }}
      >
        <defs>
          <radialGradient id={`mm${variant}`}>
            <stop offset="0%" stopColor={withAlpha(look.ink, 0.55)} />
            <stop offset="100%" stopColor={withAlpha(look.ink, 0.85)} />
          </radialGradient>
        </defs>
        <g transform={`translate(${r + 10} ${r + 10})`}>
          <circle r={r} fill={`url(#mm${variant})`} stroke={look.accent} strokeWidth={4} />
          <path
            d={`M${-r * 0.7} 6L${r * 0.6} -10M-10 ${-r * 0.7}L4 ${r * 0.8}`}
            stroke={withAlpha(look.paper, 0.25)}
            strokeWidth={6}
            strokeLinecap="round"
          />
          <path
            d={`M0 0L${r * Math.cos((sweep * Math.PI) / 180)} ${r * Math.sin((sweep * Math.PI) / 180)}`}
            stroke={withAlpha(look.accent, 0.8)}
            strokeWidth={2}
          />
          <circle cx={r * 0.32} cy={-r * 0.28} r={6} fill={look.accent2} />
          <path d="M0 -9L7 8L0 4L-7 8Z" fill={look.paper} />
        </g>
      </svg>
    );
  }
  if (look.hud === "stamina") {
    const r = 34;
    const p = 0.3 + 0.62 * on;
    const a = p * 2 * Math.PI;
    return (
      <svg
        width={2 * r + 16}
        height={2 * r + 16}
        style={{ position: "absolute", right, top, opacity: on }}
      >
        <g transform={`translate(${r + 8} ${r + 8})`}>
          <circle
            r={r}
            fill="none"
            stroke={withAlpha(look.ink, 0.7)}
            strokeWidth={12}
          />
          <path
            d={`M0 ${-r}A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${r * Math.sin(a)} ${-r * Math.cos(a)}`}
            stroke={look.accent}
            strokeWidth={9}
            fill="none"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }
  const font = lookFont(look);
  if (look.hud === "pixel") {
    const blink = Math.floor(frame / 15) % 2 === 0;
    return (
      <div
        style={{
          position: "absolute",
          right,
          top,
          opacity: on,
          fontFamily: font.family,
          fontSize: 26,
          color: look.paper,
          textShadow: `3px 3px 0 ${look.ink}`,
          letterSpacing: 2,
        }}
      >
        <span style={{ color: look.accent2 }}>1UP</span>
        <span
          style={{
            marginLeft: 18,
            color: look.accent,
            opacity: blink ? 1 : 0.25,
          }}
        >
          &#9654;
        </span>
      </div>
    );
  }
  if (look.hud === "vhs") {
    const s = Math.floor(frame / 30);
    const blink = Math.floor(frame / 20) % 2 === 0;
    return (
      <div
        style={{
          position: "absolute",
          right,
          top,
          opacity: on,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 26,
          letterSpacing: 4,
          color: look.paper,
          textShadow: "0 2px 6px rgba(0,0,0,0.9)",
        }}
      >
        <span style={{ color: look.accent, opacity: blink ? 1 : 0.2 }}>
          &#9679;
        </span>{" "}
        REC {`00:00:${String(s % 60).padStart(2, "0")}`}
      </div>
    );
  }
  return null;
};

/** The look's corners and HUD over a full-screen graphic, in and out with it (held at most MIN_HOLD frames). */
export const GameLookFrame: React.FC<{
  len: number;
  variant?: number;
  hold?: number;
}> = ({ len, variant = 0, hold }) => {
  const look = useLook();
  const frame = useCurrentFrame();
  if (look.corner === "none" && look.hud === "none") return null;
  const showFor = hold ?? stageHold(len, MIN_HOLD);
  if (frame > showFor) return null;
  const fade = interpolate(
    frame,
    [0, 12, showFor - 10, showFor],
    [0, 1, 1, 0],
    clamp,
  );
  const grow = interpolate(frame, [4, 22], [0, 1], {
    ...clamp,
    easing: (x) => 1 - (1 - x) ** 3,
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fade }}>
      <Corners look={look} on={grow} frame={frame} variant={variant} />
      <Hud look={look} on={grow} frame={frame} variant={variant} />
    </AbsoluteFill>
  );
};
