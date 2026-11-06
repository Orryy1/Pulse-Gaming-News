// The PulseRecon composition: one in-game reconstruction shot on its own (components/recon/ReconShot.tsx),
// for stills and short clips while designing (data/smoke/recon_stills.mts). Takes the clip, or a still of it.
import React from "react";
import { AbsoluteFill } from "remotion";
import { COLOUR } from "./brand.ts";
import {
  ReconShot,
  type ReconShotProps,
} from "./components/recon/ReconShot.tsx";
import { LONG_FPS } from "./longplan.ts";

export type ReconPreviewProps = ReconShotProps & { durationSeconds: number };

export const ReconPreview: React.FC<ReconPreviewProps> = (p) => (
  <AbsoluteFill style={{ background: COLOUR.ink }}>
    <ReconShot {...p} />
  </AbsoluteFill>
);

export const SAMPLE_RECON: ReconPreviewProps = {
  len: 150,
  seed: 1,
  game: "Grand Theft Auto: Vice City",
  year: 2002,
  durationSeconds: 150 / LONG_FPS,
};
