// Preview entry for the code scenes alone (data/smoke/codescene.mts): one scene on a Short's frame or a long video's.
// `plain` draws the bare ink with no scene, the baseline for the render-speed reading.
import React from "react";
import { AbsoluteFill, Composition, registerRoot } from "remotion";
import { COLOUR } from "../../brand.ts";
import type { CodeScene } from "../../codescene.ts";
import { CodeSceneView } from "./CodeScenes.tsx";
import "../fonts.ts";

type Props = {
  scene?: CodeScene;
  landAt: number;
  len: number;
  accent: string;
  src?: string;
  plain?: boolean;
};

const View: React.FC<Props> = ({ scene, landAt, len, accent, src, plain }) =>
  plain || !scene ? (
    <AbsoluteFill style={{ background: COLOUR.ink }} />
  ) : (
    <CodeSceneView
      planned={{ scene, landAt }}
      len={len}
      accent={accent}
      src={src}
    />
  );

const meta = ({ props }: { props: Props }) => ({ durationInFrames: props.len });
const defaults: Props = {
  landAt: 60,
  len: 150,
  accent: COLOUR.amber,
};

registerRoot(() => (
  <>
    <Composition
      id="SceneV"
      component={View}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={150}
      defaultProps={defaults}
      calculateMetadata={meta}
    />
    <Composition
      id="SceneH"
      component={View}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={150}
      defaultProps={defaults}
      calculateMetadata={meta}
    />
  </>
));
