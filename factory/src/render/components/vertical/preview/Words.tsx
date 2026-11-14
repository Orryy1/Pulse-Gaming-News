// Preview entry for the vertical Words styles alone (data/smoke/vgfx.mts --pack Words): a 1080x1920 Short frame
// with a picture behind, the fact-card box outlined faintly, captions and shelf bands shaded for reference.
import React from "react";
import { AbsoluteFill, Composition, Img, registerRoot } from "remotion";
import { STYLES } from "../VWords.tsx";
import { VBOX, type VGfxProps } from "../types.ts";

type Props = VGfxProps & { style: string; picture?: string; durationSeconds: number; guides?: boolean };

const View: React.FC<Props> = ({ style, picture, guides = true, ...props }) => {
  const s = STYLES[style.replace(/^Words\//, "")];
  return (
    <AbsoluteFill style={{ background: "#0b0b0e" }}>
      {picture ? <Img src={picture} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.6)" }} /> : null}
      {guides ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 900, height: 280, background: "rgba(255,255,255,0.05)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 1180, height: 280, background: "rgba(255,107,26,0.06)" }} />
          <div style={{ position: "absolute", left: VBOX.left, top: VBOX.top, width: VBOX.width, height: VBOX.height, outline: "1px dashed rgba(255,255,255,0.18)" }} />
        </>
      ) : null}
      <div style={{ position: "absolute", left: VBOX.left, top: VBOX.top, width: VBOX.width, height: VBOX.height }}>
        {s ? <s.component {...props} /> : null}
      </div>
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <Composition
    id="VGfx"
    component={View}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={150}
    defaultProps={{ style: "", durationSeconds: 5, len: 150, accent: "#FF6B1A", v: { kind: "none", primary: "", secondary: "", items: [] } } as Props}
    calculateMetadata={({ props }: { props: Props }) => ({ durationInFrames: Math.ceil(props.durationSeconds * 30) })}
  />
));
