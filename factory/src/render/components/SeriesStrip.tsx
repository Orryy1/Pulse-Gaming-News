// The series cover strip (src/render/seriesstrip.ts): amber on ink, the brand's own pair, in Anton. The series name
// sits in the amber bar; Buy, Wait or Skip's price rides at its right end in an ink chip, the price in amber. It is
// drawn fully at frame 0 (the thumbnail) and never moves, so every cover of a series puts it in the same place.

import React from "react";
import { COLOUR } from "../brand.ts";
import { DISPLAY } from "./fonts.ts";
import { type SeriesCover, stripFontSize, stripText } from "../seriesstrip.ts";

export const SeriesStrip: React.FC<{
  cover: SeriesCover;
  left: number;
  width: number;
  top: number;
  height: number;
}> = ({ cover, left, width, top, height }) => {
  const text = stripText(cover);
  const price = cover.price?.trim();
  const priceWidth = price
    ? Math.round(height * 0.62 * price.length + height * 0.6)
    : 0;
  const labelWidth = width - priceWidth - height * 0.5;
  const size = stripFontSize(
    text,
    labelWidth,
    Math.round(height * 0.74),
    Math.round(height * 0.4),
  );
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        display: "flex",
        alignItems: "stretch",
        background: COLOUR.amber,
        borderRadius: Math.round(height * 0.12),
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        overflow: "hidden",
      }}
    >
      {/* A thin ink rule down the left edge: the brand's lower-third tick. */}
      <div
        style={{ width: Math.round(height * 0.16), background: COLOUR.ink }}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          paddingLeft: Math.round(height * 0.26),
          fontFamily: DISPLAY,
          fontSize: size,
          lineHeight: 1,
          color: COLOUR.ink,
          letterSpacing: Math.round(size * 0.04),
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
      {price ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: priceWidth,
            padding: `0 ${Math.round(height * 0.3)}px`,
            background: COLOUR.ink,
            fontFamily: DISPLAY,
            fontSize: Math.round(height * 0.74),
            lineHeight: 1,
            color: COLOUR.amber,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {price}
        </div>
      ) : null}
    </div>
  );
};
