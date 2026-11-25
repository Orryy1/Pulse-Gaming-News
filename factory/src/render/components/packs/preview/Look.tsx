// Preview entry for GAME_LOOK and MAP_PINS (data/smoke/maplook.mts): a look's chapter card, and any pack style
// drawn inside a look with its frame, over a picture, as Long.tsx draws them.
import React from "react";
import { AbsoluteFill, Composition, Img, registerRoot } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { ALL_STYLES } from "../index.ts";
import { GAME_LOOKS, LookContext, PULSE_LOOK } from "../../../gamelook.ts";
import { GameLookFrame } from "../../GameLookFrame.tsx";
import { lookCardFor } from "../../GameLookCard.tsx";
import type { GfxProps } from "../types.ts";
import type { MotifCardProps } from "../../motifs/types.ts";

type GfxPreview = GfxProps & {
  style: string;
  look?: string;
  picture?: string;
  durationSeconds: number;
};
type CardPreview = MotifCardProps & { look: string; durationSeconds: number };

const lookOf = (id?: string) =>
  GAME_LOOKS.find((l) => l.id === id) ?? PULSE_LOOK;

const Gfx: React.FC<GfxPreview> = ({ style, look, picture, ...props }) => {
  const s = ALL_STYLES[style];
  const l = lookOf(look);
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {picture ? (
        <Img
          src={picture}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
      <LookContext.Provider value={l}>
        {s ? <s.component {...props} /> : null}
        {s && l !== PULSE_LOOK ? (
          <GameLookFrame len={props.len} variant={props.variant ?? 0} />
        ) : null}
      </LookContext.Provider>
    </AbsoluteFill>
  );
};

const Card: React.FC<CardPreview> = ({
  look,
  durationSeconds: _d,
  ...props
}) => {
  const C = lookCardFor(lookOf(look));
  return <C {...props} />;
};

const Root: React.FC = () => (
  <>
    <Composition
      id="LookGfx"
      component={Gfx}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={180}
      defaultProps={
        {
          style: "",
          durationSeconds: 6,
          len: 180,
          g: { kind: "none", primary: "", secondary: "", items: [] },
        } as GfxPreview
      }
      calculateMetadata={({ props }: { props: GfxPreview }) => ({
        durationInFrames: Math.ceil(props.durationSeconds * 30),
      })}
    />
    <Composition
      id="LookCard"
      component={Card}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={120}
      defaultProps={
        {
          look: "",
          heading: "",
          pictures: [],
          frames: 120,
          durationSeconds: 4,
        } as CardPreview
      }
      calculateMetadata={({ props }: { props: CardPreview }) => ({
        durationInFrames: Math.ceil(props.durationSeconds * 30),
      })}
    />
  </>
);

registerRoot(Root);
