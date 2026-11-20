// Preview entry for the Data pack alone (data/smoke/gfx.mts --pack Data): a half-written style in another
// pack cannot break this one's previews.
import React from "react";
import { AbsoluteFill, Composition, Img, registerRoot } from "remotion";
import { COLOUR } from "../../../brand.ts";
import { STYLES } from "../GfxData.tsx";
import type { GfxProps } from "../types.ts";

type Props = GfxProps & { style: string; picture?: string; durationSeconds: number };

const View: React.FC<Props> = ({ style, picture, ...props }) => {
  const s = STYLES[style.replace(/^Data\//, "")];
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {picture ? <Img src={picture} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      {s ? <s.component {...props} /> : null}
    </AbsoluteFill>
  );
};

const Root: React.FC = () => (
  <Composition
    id="PulseGfx"
    component={View}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={180}
    defaultProps={{ style: "", durationSeconds: 6, len: 180, g: { kind: "none", primary: "", secondary: "", items: [] } } as Props}
    calculateMetadata={({ props }: { props: Props }) => ({ durationInFrames: Math.ceil(props.durationSeconds * 30) })}
  />
);

registerRoot(Root);
