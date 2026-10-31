// Preview entry for the archive documents alone (data/smoke/docs.mts): its own bundle, so a half-written look
// elsewhere cannot break these previews, and nothing in src/render/Root.tsx changes.
import React from "react";
import { Composition, registerRoot } from "remotion";
import { DocumentShot, type DocumentShotProps } from "./DocumentShot.tsx";

type Props = DocumentShotProps & { durationSeconds: number };

const View: React.FC<Props> = ({ durationSeconds: _d, ...p }) => <DocumentShot {...p} />;

const Root: React.FC = () => (
  <Composition
    id="PulseDoc"
    component={View}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={180}
    defaultProps={
      {
        durationSeconds: 6,
        len: 180,
        scene: { kind: "memo", line: "The ambition came from the top.", mark: "from the top", look: "laser", seed: 1 },
      } as Props
    }
    calculateMetadata={({ props }: { props: Props }) => ({ durationInFrames: Math.ceil(props.durationSeconds * 30) })}
  />
);

registerRoot(Root);
