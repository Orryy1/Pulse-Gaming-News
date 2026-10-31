// Preview entry for the drawn scenes alone (data/smoke/objects.mts bundles this file): the PulseObjects
// composition draws one scene by style name, so a still can be taken of any of them while designing without
// bundling the whole video.
import React from "react";
import { Composition, registerRoot } from "remotion";
import { DrawnScene } from "./index.ts";

const Root: React.FC = () => (
  <Composition
    id="PulseObjects"
    component={DrawnScene as unknown as React.FC<Record<string, unknown>>}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={150}
    defaultProps={{ style: "Objects/desk", len: 150, durationSeconds: 5 }}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.ceil(Number(props.durationSeconds ?? 5) * 30),
    })}
  />
);

registerRoot(Root);
