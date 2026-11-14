// A character quote on screen (CHARACTER_QUOTES): the game's own clip, with its own sound, over everything else for
// the stretch the narrator left silent; the line captioned with the speaker's name over it, and the footage credit
// "<Game> cutscenes, via YouTube". In a Short the clip fills the upright frame ("bleed") or, from a source too
// small to fill it, sits whole across the hero band over its own blur ("framed"). The clip's sound was matched to
// the narration's loudness when it was made (src/assets/quoteclip.ts), so it plays at full volume here; the cut
// in and out is hard, as every clip in the factory (a fade through transparent flashed black, 19 Oct 2026).

import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "../brand.ts";
import { BODY, DISPLAY } from "./fonts.ts";
import { CAPTION_CENTRE, CREDIT_TOP, LOW_WIDTH, SAFE } from "../layout.ts";

export interface QuoteMomentProps {
  src: string;
  speaker: string;
  text: string;
  credit: string;
  mode: "bleed" | "framed";
  /** The clip's frames, for the credit's fades. */
  frames: number;
  accent: string;
  /** "short": the 1080x1920 Short; "long": the 1920x1080 long video. */
  layout?: "short" | "long";
}

const Caption: React.FC<{
  speaker: string;
  text: string;
  accent: string;
  long: boolean;
}> = ({ speaker, text, accent, long }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: long ? 240 : SAFE.left,
        width: long ? 1440 : LOW_WIDTH,
        top: long ? 820 : CAPTION_CENTRE - 130,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: long ? 10 : 14,
        opacity: o,
      }}
    >
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: long ? 26 : 30,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: COLOUR.ink,
          background: accent,
          padding: "5px 14px",
          borderRadius: 6,
        }}
      >
        {speaker}
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: long ? 46 : 58,
          lineHeight: 1.12,
          color: COLOUR.paper,
          textAlign: "center",
          textShadow: "0 3px 14px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.9)",
          padding: "8px 18px",
          background: "rgba(11,11,14,0.55)",
          borderRadius: 10,
        }}
      >
        {`“${text}”`}
      </div>
    </div>
  );
};

const Credit: React.FC<{ credit: string; frames: number; long: boolean }> = ({
  credit,
  frames,
  long,
}) => {
  const frame = useCurrentFrame();
  const fade = Math.min(8, Math.floor(frames / 3));
  const o =
    fade < 1
      ? 0
      : interpolate(frame, [0, fade, frames - fade, frames], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  return (
    <div
      style={{
        position: "absolute",
        left: long ? 64 : SAFE.left,
        top: long ? 40 : CREDIT_TOP,
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: long ? 22 : 25,
        letterSpacing: 2,
        color: COLOUR.paper,
        background: "rgba(11,11,14,0.88)",
        padding: "6px 12px",
        borderRadius: 6,
        textTransform: "uppercase",
        opacity: o,
      }}
    >
      {credit}
    </div>
  );
};

export const QuoteMoment: React.FC<QuoteMomentProps> = ({
  src,
  speaker,
  text,
  credit,
  mode,
  frames,
  accent,
  layout = "short",
}) => {
  const { width } = useVideoConfig();
  const long = layout === "long";
  return (
    <AbsoluteFill style={{ backgroundColor: COLOUR.ink }}>
      {mode === "framed" && !long ? (
        <>
          {/* Its own blur fills the frame; the whole picture sits across the hero band. */}
          <OffthreadVideo
            src={src}
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "blur(36px) brightness(0.5)",
              transform: "scale(1.15)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 420,
              width,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <OffthreadVideo
              src={src}
              style={{
                width,
                height: "auto",
                boxShadow: "0 18px 60px rgba(0,0,0,0.6)",
              }}
            />
          </div>
        </>
      ) : (
        <OffthreadVideo
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      {/* A soft fall-off under the caption, as the narration's captions have. */}
      <AbsoluteFill
        style={{
          background: long
            ? "linear-gradient(to bottom, rgba(0,0,0,0) 62%, rgba(0,0,0,0.55) 100%)"
            : "linear-gradient(to bottom, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 72%, rgba(0,0,0,0.25) 100%)",
        }}
      />
      <Caption speaker={speaker} text={text} accent={accent} long={long} />
      <Credit credit={credit} frames={frames} long={long} />
    </AbsoluteFill>
  );
};

/** True while any quote is playing at `frame` (spans in frames, end exclusive). */
export function inQuote(
  spans: ReadonlyArray<{ from: number; frames: number }>,
  frame: number,
): boolean {
  return spans.some((s) => frame >= s.from && frame < s.from + s.frames);
}
