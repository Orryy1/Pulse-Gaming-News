// Previews of GTA_KIT's overlays (src/render/gtakit.ts), for proofs: each moment in turn over a transparent frame (render
// as ProRes 4444 or a PNG sequence, then composite over footage) or over a clip (`bg`).

import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile } from "remotion";
import { COLOUR } from "../brand.ts";
import { KitOverlay } from "./GtaKit.tsx";
import type { KitMoment } from "../gtakit.ts";

export type GtaKitPreviewProps = {
  tall: boolean;
  moments: KitMoment[];
  /** A clip under it (a URL or a public/ path); none: transparent. */
  bg?: string;
};

export const SAMPLE_KIT: KitMoment[] = [
  {
    key: "a",
    from: 0,
    len: 105,
    at: 6,
    line: 0,
    data: {
      kind: "place",
      name: "Vice City",
      region: "Leonida",
      label: "CITY",
    },
  },
  {
    key: "b",
    from: 120,
    len: 105,
    at: 24,
    line: 1,
    data: {
      kind: "cash",
      value: 2,
      unit: "BILLION",
      decimals: 0,
      text: "$2 BILLION",
      label: "BUDGET",
    },
  },
  {
    key: "c",
    from: 240,
    len: 105,
    at: 30,
    line: 2,
    data: { kind: "versus", left: "GTA 5", right: "GTA 6" },
  },
];

export const GtaKitPreview: React.FC<GtaKitPreviewProps> = ({
  tall,
  moments,
  bg,
}) => (
  <AbsoluteFill>
    {bg ? (
      <OffthreadVideo
        src={/^(https?:|data:|blob:)/.test(bg) ? bg : staticFile(bg)}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : null}
    {moments.map((m) => (
      <Sequence
        key={m.key}
        from={m.from}
        durationInFrames={m.len}
        layout="none"
      >
        <KitOverlay m={m} tall={tall} accent={COLOUR.amber} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
