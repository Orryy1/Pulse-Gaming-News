// Split-flap: a departures-board row, one black flap per character, each flipping through a few wrong
// characters before it settles, left to right a frame apart so the row reads by frame eleven. The flap's
// seam runs through the middle of every letter; the sub is a second, smaller row.
import React from "react";
import type { WordMomentProps, WordStamp } from "../types.ts";
import {
  Band,
  DEFAULT_SIZE,
  DEFAULT_TOP,
  DISPLAY,
  BODY,
  COLOUR,
  lin,
  mix,
  seeded,
  subText,
  useMoment,
  wordText,
} from "../kit.tsx";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$.";

const Flap: React.FC<{
  ch: string;
  i: number;
  frame: number;
  w: number;
  h: number;
  fs: number;
  colour: string;
  font: string;
  variant: number;
}> = ({ ch, i, frame, w, h, fs, colour, font, variant }) => {
  // Each flap settles at frame 4 + i, after three flips of two frames each.
  const settle = 4 + i;
  const flips = Math.max(0, Math.min(3, Math.ceil((settle - frame) / 2)));
  const shown =
    flips === 0 || ch === " "
      ? ch
      : GLYPHS[Math.floor(seeded(variant, i * 7 + flips) * GLYPHS.length)]!;
  // The flip itself: the top half folding down over two frames.
  const phase = flips === 0 ? 0 : ((settle - frame) % 2) / 2;
  const fold = flips === 0 ? 0 : 1 - phase;
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        marginRight: 4,
        borderRadius: 6,
        background:
          "linear-gradient(180deg, #1c1c21 0%, #0e0e12 49%, #050507 51%, #15151a 100%)",
        boxShadow:
          "0 3px 6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
        overflow: "hidden",
        fontFamily: font,
        fontSize: fs,
        lineHeight: `${h}px`,
        textAlign: "center",
        color: colour,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `perspective(600px) rotateX(${-fold * 90}deg)`,
          transformOrigin: "50% 50%",
          backfaceVisibility: "hidden",
        }}
      >
        {shown}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          height: 2,
          background: "#000",
          opacity: 0.9,
        }}
      />
    </div>
  );
};

export const SplitFlap: React.FC<WordMomentProps> = ({
  stamp,
  hold,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
  variant = 0,
}) => {
  const { frame, out } = useMoment(hold);
  const text = wordText(stamp);
  const sub = subText(stamp);
  const w = Math.min(
    Math.round(size * 0.78),
    Math.floor(820 / Math.max(1, text.length)) - 4,
  );
  const h = Math.round(w * 1.4);
  const fs = Math.round(h * 0.78);
  const sw = Math.round(w * 0.46);
  const sh = Math.round(sw * 1.4);
  return (
    <Band top={top}>
      <div
        style={{
          padding: `${Math.round(size * 0.16)}px ${Math.round(size * 0.22)}px`,
          borderRadius: 14,
          background: "linear-gradient(180deg, #26262c 0%, #141418 100%)",
          boxShadow:
            "0 26px 60px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.1)",
          opacity: lin(frame, 0, 2) * out,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: Math.round(size * 0.12),
        }}
      >
        <div style={{ display: "flex" }}>
          {text.split("").map((ch, i) => (
            <Flap
              key={i}
              ch={ch}
              i={i}
              frame={frame}
              w={w}
              h={h}
              fs={fs}
              colour={mix(stamp.colour, "#ffffff", 0.15)}
              font={DISPLAY}
              variant={variant}
            />
          ))}
        </div>
        {sub ? (
          <div style={{ display: "flex" }}>
            {sub.split("").map((ch, i) => (
              <Flap
                key={i}
                ch={ch}
                i={i + 2}
                frame={frame - 1}
                w={sw}
                h={sh}
                fs={Math.round(sh * 0.62)}
                colour={COLOUR.paper}
                font={BODY}
                variant={variant + 1}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Band>
  );
};

/** Eleven flaps at most across the band, and a sub that fits its smaller row. */
export const fitsSplitFlap = (s: WordStamp) =>
  wordText(s).length <= 11 && subText(s).length <= 20;
