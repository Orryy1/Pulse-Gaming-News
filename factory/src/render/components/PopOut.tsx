// The subject pop-out on screen (rules in src/render/popout.ts): a full-frame card on a still with depth
// layers. The picture with its subject painted out lies at the back, the subject's cut-out (the foreground
// layer) on it, so together they are the picture; the title lands over them; then a second copy of the
// cut-out rises over the words, a touch bigger, as if the character stepped towards the camera, holds and
// steps back. The two copies cross-fade, so the subject never shows twice.

import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { displayText } from "../timeline.ts";
import { titleLines } from "../longplan.ts";
import {
  GRID_H,
  GRID_W,
  parseGrid,
  POP_BOXES,
  POP_SCALE,
  popAmount,
  type PopAlign,
} from "../popout.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The subject's centre in the picture (shares), the point it grows from as it steps forward. */
function centre(grid: string): { x: number; y: number } {
  const cells = parseGrid(grid);
  if (!cells) return { x: 0.5, y: 0.6 };
  let sx = 0;
  let sy = 0;
  let s = 0;
  cells.forEach((v, k) => {
    sx += v * ((k % GRID_W) + 0.5);
    sy += v * (Math.floor(k / GRID_W) + 0.5);
    s += v;
  });
  return s ? { x: sx / s / GRID_W, y: sy / s / GRID_H } : { x: 0.5, y: 0.6 };
}

export const PopOut: React.FC<{
  src: string;
  far: string;
  fg: string;
  grid: string;
  len: number;
  align: PopAlign;
  /** Frame the title lands; the subject steps forward a little after it. */
  landAt?: number;
  kicker?: string;
  title: string;
  sub?: string;
  /** Opens from black (a chapter's breather) rather than over the shot before. */
  fromBlack?: boolean;
}> = ({
  far,
  fg,
  grid,
  len,
  align,
  landAt = 8,
  kicker,
  title,
  sub,
  fromBlack = true,
}) => {
  const frame = useCurrentFrame();
  // From black on a breather; over the shot before (a dissolve) for the title drop.
  const fadeIn = interpolate(frame, [0, 12], [0, 1], clamp);
  const fadeOut = interpolate(frame, [len - 12, len - 1], [1, 0], clamp);
  // The camera creeps in over the card, everything together, so the layers stay registered.
  const push = 1.05 + 0.045 * Math.min(1, frame / Math.max(1, len));
  const t = interpolate(frame, [landAt, landAt + 18], [0, 1], clamp);
  const ease = 1 - (1 - t) ** 3;
  const rule = interpolate(frame, [landAt + 8, landAt + 26], [0, 1], clamp);
  const pop = popAmount(frame, landAt + 26, len);
  const c = centre(grid);
  const box = POP_BOXES[align];
  const lines = titleLines(displayText(title));
  const big = title.length > 26;
  const layer = (src: string, extra = 1, opacity = 1, shadow = false) => (
    <Img
      src={src}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity,
        transformOrigin: `${c.x * 100}% ${c.y * 100}%`,
        transform: `scale(${push * extra})`,
        filter: shadow
          ? `contrast(1.03) saturate(1.05) drop-shadow(0 18px 30px rgba(0,0,0,${0.55 * pop}))`
          : "contrast(1.03) saturate(1.05)",
      }}
    />
  );
  return (
    <AbsoluteFill
      style={{
        background: fromBlack ? COLOUR.ink : undefined,
        overflow: "hidden",
        opacity: fadeOut,
      }}
    >
      <AbsoluteFill style={{ opacity: fadeIn }}>
        {layer(far)}
        {/* Held solid until the copy in front has nearly arrived, so the subject never goes see-through. */}
        {layer(fg, 1, 1 - pop ** 3)}
        {/* Ink at the text's side so the words read on any picture. */}
        <AbsoluteFill
          style={{
            background:
              align === "left"
                ? "linear-gradient(90deg, rgba(11,11,14,0.62), rgba(11,11,14,0) 62%)"
                : align === "right"
                  ? "linear-gradient(270deg, rgba(11,11,14,0.62), rgba(11,11,14,0) 62%)"
                  : "radial-gradient(ellipse at center, rgba(11,11,14,0.5) 20%, rgba(11,11,14,0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${box.x0 * 100}%`,
            width: `${(box.x1 - box.x0) * 100}%`,
            top: `${box.y0 * 100}%`,
            height: `${(box.y1 - box.y0) * 100}%`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems:
              align === "centre"
                ? "center"
                : align === "left"
                  ? "flex-start"
                  : "flex-end",
            textAlign: align === "centre" ? "center" : align,
            gap: 18,
          }}
        >
          {kicker ? (
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 30,
                letterSpacing: 4,
                color: COLOUR.amber,
                textTransform: "uppercase",
                opacity: ease,
                textShadow: "0 2px 14px rgba(0,0,0,0.8)",
              }}
            >
              {displayText(kicker)}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: big ? 104 : 128,
              lineHeight: 0.98,
              color: COLOUR.paper,
              textTransform: "uppercase",
              opacity: ease,
              letterSpacing: `${0.01 + (1 - ease) * 0.25}em`,
              filter: `blur(${(1 - ease) * 6}px)`,
              textShadow: "0 10px 50px rgba(0,0,0,0.75)",
            }}
          >
            {lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
          <div
            style={{
              width: 220 * rule,
              height: 6,
              background: COLOUR.amber,
              borderRadius: 3,
            }}
          />
          {sub ? (
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 30,
                letterSpacing: 2.5,
                color: COLOUR.muted,
                textTransform: "uppercase",
                opacity: rule,
                textShadow: "0 2px 14px rgba(0,0,0,0.8)",
              }}
            >
              {displayText(sub)}
            </div>
          ) : null}
        </div>
        {/* The subject steps in front of the words. */}
        {pop > 0 ? layer(fg, 1 + POP_SCALE * pop, pop, true) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
