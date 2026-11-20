// The long videos' 3D devices drawn in a Short's tall frame (rules: src/render/shortupgrades.ts). The map, depth type
// and orbit reuse the long videos' own components; this file holds the pieces a tall frame needs of its own.

import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY } from "./fonts.ts";
import { SAFE } from "../layout.ts";
import { displayText } from "../timeline.ts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * SHORT_BLENDER: a vertical 3D clip over its beat, its own sound off. It cuts in (the clip is lit from its first frame;
 * a fade in would show the dark frame under it, as the line before has already gone) and fades out into the card.
 */
export const ShortBlenderClip: React.FC<{ src: string; len: number }> = ({
  src,
  len,
}) => {
  const frame = useCurrentFrame();
  const edge = Math.max(1, Math.min(5, Math.floor(len / 4)));
  const opacity = interpolate(frame, [len - edge, len], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: COLOUR.ink }}>
      <OffthreadVideo
        src={src}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
};

/**
 * SHORT_COMPARE_WIPE: the two games' pictures stacked in the tall frame, the wipe line sliding up from the bottom,
 * overshooting a touch and settling a little below the middle, each half labelled with its game inside the safe area
 * (the upper label under the brand row, the lower one above the captions).
 */
export const CompareWipeTall: React.FC<{
  top: string;
  bottom: string;
  topLabel: string;
  bottomLabel: string;
  topPosition?: string;
  bottomPosition?: string;
  len: number;
  accent: string;
}> = ({
  top,
  bottom,
  topLabel,
  bottomLabel,
  topPosition,
  bottomPosition,
  len,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  const settle = 52 + 2.5 * Math.sin((frame / fps) * 1.1);
  const y = interpolate(s, [0, 1], [100, settle]);
  const fade = interpolate(frame, [0, 5, len - 6, len], [0, 1, 1, 0], clamp);
  const labelIn = interpolate(frame, [8, 16], [0, 1], clamp);
  const pic = (src: string, position: string | undefined, upper: boolean) => (
    <Img
      src={src}
      style={{
        position: "absolute",
        left: 0,
        width: "100%",
        // Each picture fills its own half, cropped round its subject, so neither is a sliver of a wide still.
        top: upper ? 0 : `${settle}%`,
        height: upper ? `${settle}%` : `${100 - settle}%`,
        objectFit: "cover",
        objectPosition: position,
        transform: `scale(${1.04 + 0.03 * Math.min(1, frame / Math.max(1, len))})`,
      }}
    />
  );
  const label = (text: string, at: React.CSSProperties) => (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        maxWidth: SAFE.railRight - SAFE.left,
        padding: "12px 22px",
        background: "rgba(11,11,14,0.82)",
        borderLeft: `7px solid ${accent}`,
        color: COLOUR.paper,
        fontFamily: BODY,
        fontWeight: 900,
        fontSize: text.length > 22 ? 36 : 44,
        letterSpacing: 2,
        lineHeight: 1.1,
        textTransform: "uppercase",
        opacity: labelIn,
        ...at,
      }}
    >
      {displayText(text)}
    </div>
  );
  return (
    <AbsoluteFill
      style={{ overflow: "hidden", opacity: fade, background: COLOUR.ink }}
    >
      {pic(top, topPosition, true)}
      <AbsoluteFill style={{ clipPath: `inset(${y}% 0 0 0)` }}>
        {pic(bottom, bottomPosition, false)}
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${y}%`,
          height: 6,
          marginTop: -3,
          background: COLOUR.paper,
          boxShadow: "0 0 24px rgba(255,255,255,0.6)",
        }}
      />
      {label(topLabel, { top: 380 })}
      {/* Just above the wipe line's settled place would crowd it: the lower label sits low in its half, over the
          picture and above the captions (the caption band starts at 1180). */}
      {label(bottomLabel, {
        top: Math.min(1090, Math.round((height * settle) / 100) + 260),
      })}
    </AbsoluteFill>
  );
};
