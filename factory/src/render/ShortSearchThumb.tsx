// A Short's thumbnail for the search tile (src/shortthumb.ts). A phone shows it about 180 pixels wide, and on a watch page
// YouTube centres it between blurred bars, so everything that matters sits in the frame's middle: one picture filling
// it, the hook in very large type. A rumour says so on the picture as well as in the title.
import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { COLOUR } from "./brand.ts";
import { DISPLAY } from "./components/fonts.ts";

export type ShortSearchThumbProps = {
  imageSrc: string;
  words: string;
  /** A label above the words: "REPORTED" for an unconfirmed story. */
  label?: string;
};

export const SHORT_THUMB_W = 720;
export const SHORT_THUMB_H = 1280;

export const ShortSearchThumb: React.FC<ShortSearchThumbProps> = ({
  imageSrc,
  words,
  label,
}) => {
  const list = words.split(/\s+/);
  const longest = Math.max(...list.map((w) => w.length));
  // Anton is about 0.5 em wide a letter: the longest word has to fit the 632-pixel column on its own line.
  const size = Math.min(
    list.length > 2 ? 136 : 164,
    Math.floor(632 / (longest * 0.5)),
  );
  return (
    <AbsoluteFill style={{ background: COLOUR.ink, overflow: "hidden" }}>
      <Img
        src={imageSrc}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "saturate(1.15) contrast(1.05)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(11,11,14,0) 40%, rgba(11,11,14,0.86) 72%, rgba(11,11,14,0.94) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 44,
          right: 44,
          bottom: 150,
          fontFamily: DISPLAY,
          fontSize: size,
          lineHeight: 1.0,
          letterSpacing: 1,
          color: COLOUR.paper,
          textTransform: "uppercase",
          textShadow: "0 6px 0 rgba(0,0,0,0.75), 0 0 26px rgba(0,0,0,0.7)",
        }}
      >
        {label ? (
          <div
            style={{
              display: "inline-block",
              fontSize: 52,
              lineHeight: 1.2,
              padding: "2px 18px",
              marginBottom: 18,
              background: COLOUR.alert,
              color: COLOUR.paper,
              textShadow: "none",
            }}
          >
            {label}
          </div>
        ) : null}
        <div>
          {list.map((w, i) => (
            <span
              key={i}
              style={{
                color:
                  /\d/.test(w) || i === list.length - 1
                    ? COLOUR.amber
                    : COLOUR.paper,
              }}
            >
              {w}
              {i < list.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 22,
          background: COLOUR.amber,
        }}
      />
    </AbsoluteFill>
  );
};
