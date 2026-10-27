// The PulseGfx composition: one graphic style over a picture (or a texture), for previews while designing.
import React from "react";
import { AbsoluteFill, Img } from "remotion";
import { COLOUR } from "../../brand.ts";
import { ALL_STYLES } from "./index.ts";
import type { GfxProps } from "./types.ts";

export type GfxPreviewProps = GfxProps & { style: string; picture?: string; durationSeconds: number };

export const GfxPreview: React.FC<GfxPreviewProps> = ({ style, picture, ...props }) => {
  const s = ALL_STYLES[style];
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {picture ? (
        <Img src={picture} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
      {s ? <s.component {...props} /> : null}
    </AbsoluteFill>
  );
};

export const SAMPLE_GFX: GfxPreviewProps = {
  style: "",
  durationSeconds: 6,
  len: 180,
  g: { kind: "none", primary: "", secondary: "", items: [] },
};
