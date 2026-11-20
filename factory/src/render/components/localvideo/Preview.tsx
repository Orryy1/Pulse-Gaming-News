// The PulseLocalVideo composition: one AI motion clip shot on its own (./LocalVideoShot.tsx), for stills and
// short previews while designing (data/smoke/localvideo_stills.mts).
import React from "react";
import { LocalVideoShot } from "./LocalVideoShot.tsx";
import type { LocalVideoTreatment } from "./plan.ts";

export type LocalVideoPreviewProps = {
  src: string;
  aspect?: number;
  clipSeconds?: number;
  treatment?: LocalVideoTreatment;
  seed?: number;
  durationSeconds: number;
};

export const SAMPLE_LOCALVIDEO: LocalVideoPreviewProps = {
  src: "",
  aspect: 1280 / 704,
  clipSeconds: 81 / 16,
  treatment: "print",
  seed: 1,
  durationSeconds: 6,
};

export const LocalVideoPreview: React.FC<LocalVideoPreviewProps> = (p) => (
  <LocalVideoShot
    src={p.src}
    aspect={p.aspect ?? 1280 / 704}
    clipSeconds={p.clipSeconds ?? 81 / 16}
    treatment={p.treatment ?? "print"}
    seed={p.seed ?? 1}
    len={Math.round(p.durationSeconds * 30)}
  />
);
