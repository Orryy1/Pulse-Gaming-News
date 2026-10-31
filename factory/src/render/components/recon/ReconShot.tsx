// An in-game reconstruction's shot in a documentary (src/assets/recon.ts picks the clip for the sentence,
// ../../reconplan.ts holds the maths). The game's own footage is framed as a cinema establishing shot so it
// reads as deliberate scene-setting: letterbox bars close in, the clip plays a little slow under a slow push
// or drift, a grade pulls it toward the chapter's palette with a soft vignette, and the bottom bar carries
// the RECONSTRUCTION · IN-GAME tag beside the game's name and year, where Long.tsx puts its picture labels.
// The only words on screen are that fixed tag, the game's name and, when given, the clip's existing credit
// (Long.tsx draws its own credit top right, which then sits in the top bar). CSS transforms and filters
// only: nothing per frame but a transform, so a 34-minute render is not slowed.

import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame } from "remotion";
import { BODY } from "../fonts.ts";
import { COLOUR } from "../../brand.ts";
import type { ReconTag } from "../../../assets/recon.ts";
import {
  BAR,
  RECON_TAG,
  TAG_IN,
  barsAt,
  gameLine,
  poseAt,
  reconGrade,
  reconMove,
} from "../../reconplan.ts";

// A type, not an interface: Remotion compositions need props assignable to Record<string, unknown>.
export type ReconShotProps = {
  /** The clip (served URL). */
  src?: string;
  /** A still of the clip instead of the clip itself, for previews and stills. */
  still?: string;
  /** Frames of the shot. */
  len: number;
  seed: number;
  /** The scene the sentence asked for (ReconCandidate.scene.tags): it picks the move and the grade. */
  tags?: ReconTag[];
  /** The chapter's colour (assets.palette[entry]). */
  palette?: string | null;
  game: string;
  year?: number | string;
  /** The clip's own credit ("GAMEPLAY: CREATOR / CC BY"); leave out where Long.tsx draws the credit. */
  credit?: string;
  /** Playback rate (ReconCandidate.rate). */
  rate?: number;
  /** Frames into the clip to start from. */
  startFrom?: number;
  /** A gameplay capture with the game HUD in its corners (ReconCandidate.hud): framed tighter to hide it. */
  hud?: boolean;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const LETTERBOX = "#050507";

export const ReconShot: React.FC<ReconShotProps> = ({
  src,
  still,
  len,
  seed,
  tags = [],
  palette,
  game,
  year,
  credit,
  rate = 0.85,
  startFrom = 0,
  hud = false,
}) => {
  const frame = useCurrentFrame();
  const move = reconMove(seed, tags, hud);
  const pose = poseAt(move, frame, len);
  const grade = reconGrade(palette, tags);
  const bar = barsAt(frame);
  const tagIn = clamp01((frame - TAG_IN[0]) / (TAG_IN[1] - TAG_IN[0]));
  const media: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center 46%",
    filter: grade.filter,
    transform: `scale(${pose.scale}) translate(${pose.x}px, ${pose.y}px)`,
  };
  return (
    <AbsoluteFill style={{ background: LETTERBOX, overflow: "hidden" }}>
      {src ? (
        <OffthreadVideo
          src={src}
          muted
          playbackRate={rate}
          startFrom={startFrom}
          style={media}
        />
      ) : still ? (
        <Img src={still} style={media} />
      ) : null}
      {/* The chapter's colour, then a vignette that keeps the eye in the middle of the scope frame. */}
      <AbsoluteFill
        style={{
          background: grade.tint,
          opacity: grade.tintOpacity,
          mixBlendMode: "color",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,${hud ? 0.6 : 0.42}) 100%)`,
        }}
      />
      {/* Letterbox bars */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: bar,
          background: LETTERBOX,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: bar,
          background: LETTERBOX,
        }}
      />
      {/* The tag and the game, inside the bottom bar */}
      <div
        style={{
          position: "absolute",
          right: 96,
          bottom: Math.round((BAR - 34) / 2),
          height: 34,
          display: "flex",
          alignItems: "center",
          gap: 16,
          opacity: tagIn * 0.94,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 20,
          letterSpacing: 2.5,
          color: "rgba(245,245,242,0.88)",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        <span>{gameLine(game, year)}</span>
        <span
          style={{
            padding: "5px 12px 4px",
            borderRadius: 6,
            border: `2px solid ${COLOUR.amber}`,
            color: COLOUR.paper,
            letterSpacing: 3,
          }}
        >
          {RECON_TAG}
        </span>
      </div>
      {credit ? (
        <div
          style={{
            position: "absolute",
            right: 96,
            top: Math.round((BAR - 30) / 2),
            padding: "6px 12px",
            opacity: tagIn,
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: 1.5,
            color: "rgba(245,245,242,0.85)",
            textTransform: "uppercase",
          }}
        >
          {credit}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
