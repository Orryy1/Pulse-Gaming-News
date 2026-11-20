// The PulsePhoto composition: one photo treatment or one screenshot display on its own
// (components/PhotoShot.tsx), for stills and short clips while designing (data/smoke/photoanim.mts). Given
// the picture, its kind, the chapter's year and the run around it, it picks the treatment the way the long
// plan would (photoplan.ts), or takes one by name; a screenshot plays inside the display of its year with
// the same slow push the documentary gives a still.
import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { COLOUR } from "./brand.ts";
import { DisplayShot, PhotoShot } from "./components/PhotoShot.tsx";
import { LONG_FPS } from "./longplan.ts";
import { moveTransform } from "./motion.ts";
import {
  type DisplayKind,
  type PhotoTreatment,
  displayFor,
  photoTreatment,
} from "./photoplan.ts";

export type PhotoPreviewProps = {
  src: string;
  aspect?: number;
  kind?: "photo" | "portrait" | "screenshot";
  /** By name; absent, the plan's pick from the context below. */
  treatment?: PhotoTreatment;
  /** A screenshot's display by name; absent, the one for the year and platforms. */
  display?: DisplayKind;
  seed?: number;
  /** Frames of the shot. */
  len?: number;
  year?: number;
  platforms?: string;
  credit?: string;
  /** The run's earlier photos, oldest first, and this one's place in the run (from 0). */
  earlier?: string[];
  earlierAspect?: number;
  index?: number;
  runLength?: number;
  previous?: PhotoTreatment;
  durationSeconds: number;
};

/** The documentary's plain still: the picture with its slow push, for the display to frame. */
const PlainStill: React.FC<{ src: string; len: number }> = ({ src, len }) => {
  const frame = useCurrentFrame();
  const m = moveTransform("pushIn", Math.min(1, frame / Math.max(1, len)));
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "contrast(1.03) saturate(1.05)",
          transform: `scale(${m.scale + 0.04})`,
        }}
      />
    </AbsoluteFill>
  );
};

export const PhotoPreview: React.FC<PhotoPreviewProps> = (p) => {
  const len = p.len ?? 180;
  const seed = p.seed ?? 1;
  const kind = p.kind ?? "photo";
  const aspect = p.aspect ?? 1.5;
  if (kind === "screenshot") {
    const display = p.display ?? displayFor(p.year, p.platforms) ?? "flat";
    return (
      <AbsoluteFill style={{ background: COLOUR.ink }}>
        <Sequence from={0} durationInFrames={len} layout="none">
          <DisplayShot kind={display} seed={seed}>
            <PlainStill src={p.src} len={len} />
          </DisplayShot>
        </Sequence>
      </AbsoluteFill>
    );
  }
  const index = p.index ?? 0;
  const treatment =
    p.treatment ??
    photoTreatment(seed, len, {
      kind,
      year: p.year,
      credit: p.credit,
      run: { index, length: Math.max(index + 1, p.runLength ?? 1) },
      previous: p.previous,
    });
  const fade = (frame: number) =>
    interpolate(frame, [0, 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      <Sequence from={0} durationInFrames={len} layout="none">
        {treatment ? (
          <PhotoShot
            src={p.src}
            aspect={aspect}
            len={len}
            move="pushIn"
            treatment={treatment}
            seed={seed}
            kind={kind}
            caption={p.credit}
            year={p.year}
            index={index}
            earlier={(p.earlier ?? []).map((src) => ({
              src,
              aspect: p.earlierAspect ?? aspect,
            }))}
          />
        ) : (
          <PlainStill src={p.src} len={len} />
        )}
      </Sequence>
      {/* The credit corner as Long.tsx draws it over every photo. */}
      {p.credit ? <CreditCorner text={p.credit} fade={fade} /> : null}
    </AbsoluteFill>
  );
};

const CreditCorner: React.FC<{ text: string; fade: (f: number) => number }> = ({
  text,
  fade,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        right: 40,
        bottom: 26,
        padding: "4px 10px",
        background: "rgba(11,11,14,0.55)",
        borderRadius: 6,
        fontFamily: "PulseBody",
        fontWeight: 600,
        fontSize: 16,
        letterSpacing: 0.5,
        color: "rgba(245,245,242,0.8)",
        opacity: fade(frame),
      }}
    >
      PHOTO: {text}
    </div>
  );
};

// No treatment here: Remotion lays default props under the input props, and a preview that leaves the
// treatment out means "pick it from the context", which a default would override.
export const SAMPLE_PHOTO: PhotoPreviewProps = {
  src: "",
  seed: 1,
  len: 180,
  durationSeconds: 180 / LONG_FPS,
};
