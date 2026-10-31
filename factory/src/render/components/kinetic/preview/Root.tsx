// Preview entry for the filler families alone (data/smoke/filler.mts): kinetic typography and explainer
// diagrams on a 1920x1080 frame, bundled on their own so nothing else in the renderer can break them and
// src/render/Root.tsx needs no change before the integration step wires them into the long video.
import React from "react";
import { AbsoluteFill, Composition, registerRoot } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { KINETIC } from "../index.ts";
import { DIAGRAMS } from "../../diagram/index.ts";
import type { KineticData, KineticStyle } from "../choose.ts";
import type { DiagramData, DiagramStyle } from "../../diagram/choose.ts";

type Props = {
  family: "kinetic" | "diagram";
  style: string;
  data: unknown;
  times?: number[];
  len: number;
  src?: string;
  seed?: number;
  durationSeconds: number;
};

const View: React.FC<Props> = ({
  family,
  style,
  data,
  times,
  len,
  src,
  seed,
}) => {
  if (family === "kinetic") {
    const K = KINETIC[style as KineticStyle]?.component;
    return K ? (
      <K
        data={data as KineticData}
        times={times}
        len={len}
        src={src}
        seed={seed}
      />
    ) : null;
  }
  const D = DIAGRAMS[style as DiagramStyle]?.component;
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {D ? (
        <D data={data as DiagramData} len={len} src={src} seed={seed} />
      ) : null}
    </AbsoluteFill>
  );
};

const Root: React.FC = () => (
  <Composition
    id="PulseFiller"
    component={View}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={180}
    defaultProps={
      {
        family: "kinetic",
        style: "land",
        data: {},
        len: 180,
        durationSeconds: 6,
      } as Props
    }
    calculateMetadata={({ props }: { props: Props }) => ({
      durationInFrames: Math.ceil(props.durationSeconds * 30),
    })}
  />
);

registerRoot(Root);
