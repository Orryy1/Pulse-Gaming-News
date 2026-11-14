// The Pulse badge (owner, 30 Oct 2026: the Pulse universe): the Pulse mark with the PULSE wordmark beside it,
// set where a maker's logo would sit on a console, a box or a menu. One version for HTML layouts and one for
// drawings made in SVG, so a console body or a dashboard corner can carry the same badge in its own colours.
import React from "react";
import { BODY } from "../../fonts.ts";
import { PulseMark } from "../screen/pulse.tsx";

type BadgeProps = {
  /** Height of the mark in px; the wordmark is sized from it. */
  size: number;
  colour: string;
  /** Show the PULSE wordmark beside the mark (true by default). */
  word?: boolean;
  /** Wordmark colour, when it differs from the mark's. */
  wordColour?: string;
  font?: string;
  /** Wordmark weight (800 by default). */
  weight?: number;
  opacity?: number;
};

/** The badge as an inline flex row, for HTML layouts. */
export const PulseBadge: React.FC<
  BadgeProps & { style?: React.CSSProperties }
> = ({
  size,
  colour,
  word = true,
  wordColour,
  font = BODY,
  weight = 800,
  opacity = 1,
  style,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: Math.round(size * 0.28),
      opacity,
      ...style,
    }}
  >
    <PulseMark size={size} colour={colour} />
    {word && (
      <span
        style={{
          fontFamily: font,
          fontWeight: weight,
          fontSize: Math.round(size * 0.62),
          letterSpacing: Math.round(size * 0.14),
          lineHeight: 1,
          color: wordColour ?? colour,
        }}
      >
        PULSE
      </span>
    )}
  </div>
);

/** The badge inside an SVG drawing: (x, y) is the mark's top-left corner. */
export const PulseBadgeSvg: React.FC<BadgeProps & { x: number; y: number }> = ({
  x,
  y,
  size,
  colour,
  word = true,
  wordColour,
  font = BODY,
  weight = 800,
  opacity = 1,
}) => (
  <g transform={`translate(${x} ${y})`} opacity={opacity}>
    <PulseMark size={size} colour={colour} />
    {word && (
      <text
        x={size * 1.28}
        y={size * 0.72}
        fontFamily={font}
        fontWeight={weight}
        fontSize={size * 0.62}
        letterSpacing={size * 0.14}
        fill={wordColour ?? colour}
      >
        PULSE
      </text>
    )}
  </g>
);
