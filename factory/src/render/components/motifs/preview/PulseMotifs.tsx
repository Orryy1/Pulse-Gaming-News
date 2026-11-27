// Preview entry for the console menu motifs with their Pulse badges (data/smoke/motif.mts --file PulseMotifs):
// the PlayStation, Nintendo and Xbox homages together, so one cases file covers every badge in one run.
import React from "react";
import { AbsoluteFill, Composition, Img, registerRoot } from "remotion";
import { MOTIFS as PLAY_NINTENDO } from "../PlayNintendo.tsx";
import { MOTIFS as XBOX } from "../Xbox.tsx";
import type { MotifCardProps } from "../types.ts";
import type { GfxProps } from "../../packs/types.ts";

const MOTIFS = [...PLAY_NINTENDO, ...XBOX];

type CardP = MotifCardProps & { motif: string; durationSeconds: number };
type StyleP = GfxProps & {
  motif: string;
  style: string;
  picture?: string;
  durationSeconds: number;
};

const Card: React.FC<CardP> = ({ motif, ...props }) => {
  const m = MOTIFS.find((x) => x.id === motif);
  return (
    <AbsoluteFill style={{ background: "#0b0b0e" }}>
      {m?.card ? <m.card {...props} /> : null}
    </AbsoluteFill>
  );
};
const Style: React.FC<StyleP> = ({ motif, style, picture, ...props }) => {
  const s = MOTIFS.find((x) => x.id === motif)?.styles?.[style];
  return (
    <AbsoluteFill style={{ background: "#0b0b0e" }}>
      {picture ? (
        <Img
          src={picture}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
      {s ? <s.component {...props} /> : null}
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <>
    <Composition
      id="MotifCard"
      component={Card}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={120}
      defaultProps={
        {
          motif: "",
          heading: "",
          pictures: [],
          frames: 120,
          durationSeconds: 4,
        } as CardP
      }
      calculateMetadata={({ props }: { props: CardP }) => ({
        durationInFrames: Math.ceil(props.durationSeconds * 30),
      })}
    />
    <Composition
      id="MotifStyle"
      component={Style}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={180}
      defaultProps={
        {
          motif: "",
          style: "",
          len: 180,
          g: { kind: "none", primary: "", secondary: "", items: [] },
          durationSeconds: 6,
        } as StyleP
      }
      calculateMetadata={({ props }: { props: StyleP }) => ({
        durationInFrames: Math.ceil(props.durationSeconds * 30),
      })}
    />
  </>
));
