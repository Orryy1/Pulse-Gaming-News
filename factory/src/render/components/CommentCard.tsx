// A viewer's comment on screen (COMMENT_REPLY_SHORTS, src/commentreply.ts): the opening of a Short that answers a
// question from the comments shows the comment as a card while the narrator says "You asked...", the way a creator's
// reply video opens on the comment it answers. The card carries the commenter's public handle (never a display name),
// a round badge with its first letter (no profile picture is fetched) and the comment, at most three lines. It sits in
// the shelf band, clear of the hook headline above and the captions below; the shelf stays hidden while it is up.

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { BANDS, CONTENT_WIDTH, SAFE } from "../layout.ts";

export interface CommentCardProps {
  handle: string;
  text: string;
  /** Frames it stays up (it fades out over its last six). */
  frames: number;
  accent: string;
}

/** How long the card stays up (pure): the hook, but never under 2.5 s or over 4.5 s. */
export function commentCardFrames(hookEndFrame: number, fps: number): number {
  return Math.round(Math.min(4.5 * fps, Math.max(2.5 * fps, hookEndFrame)));
}

export const CommentCard: React.FC<CommentCardProps> = ({
  handle,
  text,
  frames,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.7 },
  });
  const out = interpolate(frame, [frames - 6, frames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const letter = (
    handle.replace(/^@/, "").match(/\p{L}|\p{N}/u)?.[0] ?? "?"
  ).toUpperCase();
  const size = text.length > 110 ? 36 : text.length > 70 ? 40 : 44;
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: BANDS.shelf[0] + 8,
        width: CONTENT_WIDTH,
        opacity: out * Math.min(1, pop * 1.4),
        transform: `translateY(${(1 - pop) * 40}px) scale(${0.92 + 0.08 * pop})`,
        transformOrigin: "left top",
      }}
    >
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 40,
          letterSpacing: 2,
          color: accent,
          marginBottom: 10,
          textShadow: "0 2px 10px rgba(0,0,0,0.8)",
        }}
      >
        YOU ASKED
      </div>
      <div
        style={{
          background: "rgba(11,11,14,0.92)",
          borderLeft: `8px solid ${accent}`,
          borderRadius: 22,
          padding: "26px 30px 28px",
          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              background: accent,
              color: COLOUR.ink,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {letter}
          </div>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 700,
              fontSize: 34,
              color: COLOUR.muted,
            }}
          >
            {handle}
          </div>
        </div>
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: size,
            lineHeight: 1.22,
            color: COLOUR.paper,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
};
