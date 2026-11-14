// The PulseSketch composition: one concept-sketch treatment on its own (components/SketchShot.tsx), for
// stills and short clips while designing (data/smoke/sketchanim.mts). Given the picture and the kinds of
// the shots around it, it picks the treatment the way the long plan would (sketchplan.ts), or takes one
// by name; with a next picture it plays the hand-off to that shot after `len` frames, as Long.tsx does.
import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { COLOUR } from "./brand.ts";
import { SketchShot } from "./components/SketchShot.tsx";
import { LONG_FPS } from "./longplan.ts";
import {
  SKETCH_ASPECT,
  sketchTreatment,
  type SketchTreatment,
} from "./sketchplan.ts";

export type SketchPreviewProps = {
  src: string;
  aspect?: number;
  /** By name; absent, the plan's pick from the context below. */
  treatment?: SketchTreatment;
  seed?: number;
  /** Frames of the sketch shot. */
  len?: number;
  /** The kind of the shot after ("photo", "screenshot", "clip", "sketch"...), and its picture. */
  nextKind?: string;
  nextSrc?: string;
  nextAspect?: number;
  /** The run's earlier sketches, oldest first. */
  earlier?: string[];
  /** This sketch's place in its run, from 1, and the run's length. */
  page?: number;
  runLength?: number;
  /** The treatment of the sketch before, for the solo pick's alternation. */
  previous?: SketchTreatment;
  durationSeconds: number;
};

/** The next shot as Long.tsx shows it: a photo as the framed print, anything else full-bleed. */
const NextShot: React.FC<{
  src: string;
  aspect: number;
  kind: string;
  tilt: number;
}> = ({ src, aspect, kind, tilt }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (kind !== "photo")
    return (
      <AbsoluteFill style={{ opacity: o }}>
        <Img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
    );
  const w = aspect >= 1 ? 1240 : 1240 * aspect * 0.75;
  return (
    <AbsoluteFill style={{ opacity: o, overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "blur(36px) brightness(0.4)",
          transform: "scale(1.2)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "48%",
          width: w,
          aspectRatio: String(Math.max(0.6, aspect)),
          padding: 18,
          background: "#f4f1ea",
          boxShadow: "0 50px 140px rgba(0,0,0,0.75)",
          transform: `translate(-50%, -50%) rotate(${tilt}deg) scale(0.96)`,
        }}
      >
        <Img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const SketchPreview: React.FC<SketchPreviewProps> = (p) => {
  const len = p.len ?? 180;
  const seed = p.seed ?? 1;
  const page = p.page ?? 1;
  const treatment =
    p.treatment ??
    sketchTreatment(seed, len, {
      run: { index: page - 1, length: Math.max(page, p.runLength ?? 1) },
      nextKind: p.nextKind,
      nextSameChapter: true,
      previous: p.previous,
    });
  const aspect = p.aspect ?? SKETCH_ASPECT;
  const tilt = ((seed * 37) % 5) - 2;
  const next =
    p.nextSrc && p.nextKind
      ? {
          src: p.nextSrc,
          aspect: p.nextAspect ?? SKETCH_ASPECT,
          kind: p.nextKind,
          tilt,
        }
      : undefined;
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      <Sequence from={0} durationInFrames={len} layout="none">
        <SketchShot
          src={p.src}
          aspect={aspect}
          len={len}
          move="pushIn"
          treatment={treatment}
          seed={seed}
          page={page}
          caption="Concept sketch"
          earlier={(p.earlier ?? []).map((src) => ({
            src,
            aspect: SKETCH_ASPECT,
          }))}
          next={treatment === "lightTable" ? next : undefined}
        />
      </Sequence>
      {next ? (
        <Sequence from={len - 9} layout="none">
          <NextShot {...next} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

// No treatment here: Remotion lays default props under the input props, and a preview that leaves the
// treatment out means "pick it from the context", which a default would override.
export const SAMPLE_SKETCH: SketchPreviewProps = {
  src: "",
  seed: 1,
  len: 180,
  durationSeconds: 180 / LONG_FPS,
};
