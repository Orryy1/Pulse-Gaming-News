// The PulseWord composition: one word-moment look on a 1080x1920 Short frame, for previews while designing
// (data/smoke/wordmoment.mts). A picture behind, dimmed as the Short dims it, the captions and shelf bands
// shaded for reference and the moment landing at frame 0 as it would on its spoken word.
import React from "react";
import { AbsoluteFill, Img, Sequence } from "remotion";
import { COLOUR } from "../../brand.ts";
import { STAMP_FRAMES } from "../Stamp.tsx";
import { W_STYLES, DEFAULT_LOOK } from "./index.ts";
import { DEFAULT_SIZE, DEFAULT_TOP } from "./kit.tsx";
import type { WordStamp } from "./types.ts";

export type WordPreviewProps = {
  look: string;
  stamp: Omit<WordStamp, "at">;
  picture?: string;
  durationSeconds: number;
  variant?: number;
  guides?: boolean;
  top?: number;
  size?: number;
};

export const WordPreview: React.FC<WordPreviewProps> = ({
  look,
  stamp,
  picture,
  variant = 0,
  guides = true,
  top = DEFAULT_TOP,
  size = DEFAULT_SIZE,
}) => {
  const w = W_STYLES[look] ?? W_STYLES[DEFAULT_LOOK]!;
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {picture ? (
        <Img
          src={picture}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "brightness(0.6)",
          }}
        />
      ) : null}
      {guides ? (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 900,
              height: 280,
              background: "rgba(255,255,255,0.05)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 1180,
              height: 280,
              background: "rgba(255,107,26,0.06)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top,
              borderTop: "1px dashed rgba(255,255,255,0.25)",
            }}
          />
        </>
      ) : null}
      <Sequence from={0} durationInFrames={STAMP_FRAMES} layout="none">
        {React.createElement(w.component, {
          stamp: { at: 0, ...stamp },
          hold: STAMP_FRAMES,
          top,
          size,
          variant,
        })}
      </Sequence>
    </AbsoluteFill>
  );
};

export const SAMPLE_WORD: WordPreviewProps = {
  look: DEFAULT_LOOK,
  stamp: {
    text: "NOV 19",
    sub: "CONFIRMED",
    colour: COLOUR.up,
    tone: "confirm",
  },
  durationSeconds: STAMP_FRAMES / 30,
};
