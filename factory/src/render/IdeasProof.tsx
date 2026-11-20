// A proof reel for the research devices (src/render/boldideas.ts): the chapter wall behind a real chapter title,
// the stressed phrase behind a still's subject, and the comparison wipe, on real stills. Not part of any video.

import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { ChapterInterlude } from "./Long.tsx";
import { CompareWipe, DepthType } from "./components/BoldIdeas.tsx";

export type IdeasProofProps = {
  seconds: number;
  wall: string[];
  typed: Array<{ layers: { bg: string; mid: string; fg: string }; phrase: string }>;
  wipes: Array<{ left: string; right: string; leftLabel: string; rightLabel: string }>;
};

export const SAMPLE_IDEAS_PROOF: IdeasProofProps = { seconds: 4, wall: [], typed: [], wipes: [] };

export const ideasProofScenes = (p: IdeasProofProps) => (p.wall.length ? 1 : 0) + p.typed.length + p.wipes.length;

export const IdeasProof: React.FC<IdeasProofProps> = (p) => {
  const { fps } = useVideoConfig();
  const len = Math.round(p.seconds * fps);
  let k = 0;
  const at = () => k++ * len;
  return (
    <AbsoluteFill style={{ background: "#0b0b0e" }}>
      {p.wall.length ? (
        <Sequence from={at()} durationInFrames={len}>
          <ChapterInterlude number={3} title="The Long Road to Leonida" game="Grand Theft Auto VI" year="2026" frames={len} wall={p.wall} />
        </Sequence>
      ) : null}
      {p.typed.map((t, i) => (
        <Sequence key={`t${i}`} from={at()} durationInFrames={len}>
          <DepthType layers={t.layers} phrase={t.phrase} at={Math.round(len * 0.3)} len={len} dir={i % 2 ? -1 : 1} />
        </Sequence>
      ))}
      {p.wipes.map((w, i) => (
        <Sequence key={`w${i}`} from={at()} durationInFrames={len}>
          <CompareWipe {...w} len={len} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
