// A Short's opening as a thumbnail (owner, 27 Oct 2026: "we could almost by proxy set custom Shorts
// thumbnails by making the first frame ultra appealing"). Frame 0 is what YouTube most often shows for a
// Short and what a viewer meets first, so on the new-look Shorts it is built like a thumbnail: the hero art
// graded hard, its subject cut out with a white rim and a glow, and the headline as heavy outlined type with
// the game's words in the accent, all in the middle band that survives the feeds' 3:2 and tile crops. It
// returns pixel for pixel when the Short loops.

import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { COLOUR } from "../brand.ts";
import { DISPLAY } from "./fonts.ts";
import { CONTENT_WIDTH, SAFE } from "../layout.ts";
import { ease, exitProgress } from "../motion.ts";

/** The biggest size at which the words wrap into at most three lines across the content width. */
function posterSize(words: string[]): number {
  for (const size of [168, 150, 134, 120, 108, 96, 84]) {
    const per = size * 0.47; // Anton's average capital, with the gap
    let lines = 1;
    let used = 0;
    for (const w of words) {
      const wd = w.length * per + size * 0.2;
      if (wd > CONTENT_WIDTH) {
        lines = 99;
        break;
      }
      if (used + wd > CONTENT_WIDTH) {
        lines++;
        used = wd;
      } else used += wd;
    }
    if (lines <= 3) return size;
  }
  return 84;
}

export const HookPoster: React.FC<{
  headline: string;
  accent: string;
  gameTitle: string;
  heroSrc: string;
  cutSrc?: string;
  /** Where the subject stands across the art (0-1): the vertical crop is centred on them. */
  cutX?: number;
  durationInFrames: number;
}> = ({ headline, accent, gameTitle, heroSrc, cutSrc, cutX, durationInFrames }) => {
  const frame = useCurrentFrame();
  const words = headline.toUpperCase().split(/\s+/).filter(Boolean);
  const gameWords = new Set(
    gameTitle
      .toUpperCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Z0-9]/g, "")),
  );
  const out = exitProgress(frame, durationInFrames);
  // A slow push so the opening is never a still poster; frame 0 is the thumbnail, fully drawn. The art sits
  // lower so faces land under the headline.
  const push = interpolate(frame, [0, 90], [1.0, 1.05], {
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  const size = Math.min(150, posterSize(words));
  const crop = `${Math.round((cutX ?? 0.5) * 100)}% 40%`;
  const lit = (w: string) =>
    gameWords.has(w.replace(/[^A-Z0-9]/g, "")) || /\d/.test(w);
  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity: out }}>
      <AbsoluteFill style={{ transform: `translateY(11%) scale(${push * 1.25})` }}>
        <Img
          src={heroSrc}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "brightness(0.62) saturate(1.3) contrast(1.15)",
          }}
        />
        <AbsoluteFill
          style={{
            background: `linear-gradient(160deg, ${accent}66 0%, rgba(0,0,0,0) 45%, rgba(20,60,110,0.5) 100%)`,
            mixBlendMode: "overlay",
          }}
        />
        <AbsoluteFill
          style={{
            background: `radial-gradient(70% 45% at 50% 42%, ${accent}40 0%, rgba(0,0,0,0) 70%)`,
          }}
        />
        {cutSrc ? (
          // The subject lifted off the art: a touch larger and lower, a soft shadow behind (no rim, the cut-out
          // is a depth layer, not a clean outline).
          <Img
            src={cutSrc}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: crop,
              transform: "translateY(4%) scale(1.07)",
              transformOrigin: "50% 100%",
              filter: "drop-shadow(0 30px 40px rgba(0,0,0,0.75)) saturate(1.15) contrast(1.08)",
            }}
          />
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(5,5,7,0.7) 0%, rgba(5,5,7,0.35) 30%, rgba(5,5,7,0) 50%, rgba(5,5,7,0.82) 80%, rgba(5,5,7,0.92) 100%)",
        }}
      />
      {/* The words high, above the subject's face. */}
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          width: CONTENT_WIDTH,
          top: 420,
          display: "flex",
          flexWrap: "wrap",
          gap: "0 20px",
          lineHeight: 0.98,
        }}
      >
        {words.map((w, i) => (
          <span
            key={i}
            style={{
              fontFamily: DISPLAY,
              fontSize: size,
              color: lit(w) ? accent : COLOUR.paper,
              WebkitTextStroke: `${Math.round(size / 22)}px #050507`,
              paintOrder: "stroke fill",
              textShadow: `0 ${Math.round(size / 16)}px ${Math.round(size / 4)}px rgba(0,0,0,0.8)`,
              display: "inline-block",
            }}
          >
            {w}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
