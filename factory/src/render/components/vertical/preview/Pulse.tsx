// Preview entry for the vertical Pulse styles and the Shorts craft (data/smoke/vgfx.mts --pack Pulse): a 1080x1920
// Short frame with a picture behind, the card box or the full-width area outlined faintly, the shelf and caption
// bands shaded. Besides "Pulse/<style>" it draws "Craft/Freeze" (the freeze-frame's marks over the picture) and
// "Craft/Photo/<treatment>" (a real photo's treatment, the picture standing in for the photo).
import React from "react";
import { AbsoluteFill, Composition, Img, registerRoot } from "remotion";
import { STYLES } from "../VPulse.tsx";
import { VBOX, VFULL, type VGfxProps } from "../types.ts";
import { VFreezeLabel, VPhotoShot } from "../craft.tsx";
import type { PhotoTreatment } from "../../../photoplan.ts";

type Props = VGfxProps & {
  style: string;
  picture?: string;
  durationSeconds: number;
  guides?: boolean;
};

const View: React.FC<Props> = ({ style, picture, guides = true, ...props }) => {
  const name = style.replace(/^Pulse\//, "");
  const s = STYLES[name];
  const full = s?.frame === "full";
  const photo = style.startsWith("Craft/Photo/")
    ? (style.slice(12) as PhotoTreatment)
    : undefined;
  return (
    <AbsoluteFill style={{ background: "#0b0b0e" }}>
      {picture && !photo ? (
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
      {photo && picture ? (
        <VPhotoShot
          src={picture}
          aspect={16 / 9}
          kind="photo"
          treatment={photo}
          seed={props.variant ?? 0}
          len={props.len}
          move="pushIn"
        />
      ) : null}
      {style === "Craft/Freeze" ? (
        <VFreezeLabel
          label={props.v.primary || "SENTINEL"}
          hold={props.len}
          seconds={12.4}
          accent={props.accent}
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
              ...(full
                ? {
                    left: VFULL.left,
                    top: VFULL.top,
                    width: VFULL.width,
                    height: VFULL.height,
                  }
                : {
                    left: VBOX.left,
                    top: VBOX.top,
                    width: VBOX.width,
                    height: VBOX.height,
                  }),
              outline: "1px dashed rgba(255,255,255,0.18)",
            }}
          />
        </>
      ) : null}
      {s ? (
        full ? (
          <AbsoluteFill>
            <s.component {...props} />
          </AbsoluteFill>
        ) : (
          <div
            style={{
              position: "absolute",
              left: VBOX.left,
              top: VBOX.top,
              width: VBOX.width,
              height: VBOX.height,
            }}
          >
            <s.component {...props} />
          </div>
        )
      ) : null}
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
    defaultProps={
      {
        style: "",
        durationSeconds: 5,
        len: 150,
        accent: "#FF6B1A",
        v: { kind: "none", primary: "", secondary: "", items: [] },
      } as Props
    }
    calculateMetadata={({ props }: { props: Props }) => ({
      durationInFrames: Math.ceil(props.durationSeconds * 30),
    })}
  />
));
