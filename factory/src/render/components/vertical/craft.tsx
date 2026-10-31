// The craft layers on a Short (src/render/shortcraft.ts decides them; this draws them in 1080x1920): a real
// photo's treatment as a soft-edged band over its own blurred copy, a bare line's filler (kinetic type, a drawn
// scene or a document) in the full-width window, and the freeze-frame's paused chip, brackets and key word.
// Everything long-form is shown through ./pulse/PackCard.tsx StageWindow; all pure functions of the frame.
import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { COLOUR } from "../../brand.ts";
import { BODY, HAND } from "../fonts.ts";
import { PhotoShot } from "../PhotoShot.tsx";
import type { MovePreset } from "../../motion.ts";
import type { PhotoTreatment } from "../../photoplan.ts";
import { KINETIC } from "../kinetic/index.ts";
import type { KineticStyle } from "../kinetic/choose.ts";
import { DrawnScene } from "../objects/index.ts";
import { DocumentShot } from "../docs/index.ts";
import type { CraftFiller } from "../../shortcraft.ts";
import { StageWindow, type Rect } from "./pulse/PackCard.tsx";
import { clamp } from "./kit.ts";

/** The photo band: the print's part of the 1920x1080 frame, full width from just under the brand rows. */
export const PHOTO_CROP: Rect = { x: 300, y: 0, w: 1320, h: 1080 };
export const PHOTO_AREA = {
  left: 0,
  top: 320,
  width: 1080,
  height: 884,
} as const;

/** A real photo shot in its treatment: the picture's blurred copy fills the frame, the treatment in a band over it. */
export const VPhotoShot: React.FC<{
  src: string;
  blurSrc?: string | null;
  aspect: number;
  kind: "photo" | "portrait";
  treatment: PhotoTreatment;
  seed: number;
  len: number;
  move: MovePreset;
  year?: number;
}> = ({ src, blurSrc, aspect, kind, treatment, seed, len, move, year }) => (
  <AbsoluteFill style={{ overflow: "hidden", background: COLOUR.ink }}>
    <Img
      src={blurSrc ?? src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: blurSrc ? "brightness(0.45)" : "blur(30px) brightness(0.4)",
        transform: "scale(1.1)",
      }}
    />
    <StageWindow
      crop={PHOTO_CROP}
      area={PHOTO_AREA}
      join={0}
      len={len}
      feather
      still
    >
      <PhotoShot
        src={src}
        aspect={aspect}
        len={len}
        move={move}
        treatment={treatment}
        seed={seed}
        kind={kind}
        year={year}
      />
    </StageWindow>
  </AbsoluteFill>
);

const WHOLE: Rect = { x: 0, y: 0, w: 1920, h: 1080 };

/** A bare line's filler in the full-width window. */
export const VFiller: React.FC<{
  f: CraftFiller;
  src?: string;
  seed: number;
}> = ({ f, src, seed }) => {
  let body: React.ReactNode = null;
  if (f.family === "kinetic") {
    const K = KINETIC[f.style as KineticStyle]?.component;
    if (K)
      body = (
        <K data={f.data} times={f.times} len={f.len} src={src} seed={seed} />
      );
  } else if (f.family === "objects" || f.family === "silhouettes") {
    body = (
      <DrawnScene
        style={f.style}
        len={f.len}
        year={f.year}
        month={f.month}
        variant={seed}
        src={src}
      />
    );
  } else if (f.family === "document") {
    body = <DocumentShot scene={f.scene} len={f.len} words={f.words} />;
  }
  if (!body) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <StageWindow crop={WHOLE} join={0} len={f.len}>
        {body}
      </StageWindow>
    </AbsoluteFill>
  );
};

/** The freeze-frame's marks in the Short's frame: brackets in the hero band, a paused timecode and the key word. */
export const VFreezeLabel: React.FC<{
  label: string;
  hold: number;
  seconds: number;
  accent: string;
}> = ({ label, hold, seconds, accent }) => {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [1, 7], [0, 1], clamp);
  const out = interpolate(frame, [hold - 2, hold + 6], [1, 0], clamp);
  const o = inP * out;
  if (o <= 0) return null;
  const tc = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}:${String(Math.floor((seconds % 1) * 30)).padStart(2, "0")}`;
  const box = { l: 64, t: 380, r: 1016, b: 900 };
  const k = 18 * (1 - inP);
  const corner = (x: number, y: number, sx: number, sy: number, i: number) => (
    <path
      key={i}
      d={`M ${x} ${y + sy * 64} L ${x} ${y} L ${x + sx * 64} ${y}`}
      fill="none"
      stroke={COLOUR.paper}
      strokeWidth={6}
      strokeLinecap="round"
    />
  );
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: o }}>
      <svg
        width={1080}
        height={1920}
        style={{ position: "absolute", inset: 0 }}
      >
        {corner(box.l - k, box.t - k, 1, 1, 0)}
        {corner(box.r + k, box.t - k, -1, 1, 1)}
        {corner(box.l - k, box.b + k, 1, -1, 2)}
        {corner(box.r + k, box.b + k, -1, -1, 3)}
      </svg>
      <div
        style={{
          position: "absolute",
          top: box.t + 24,
          left: box.l + 24,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          background: "rgba(11,11,14,0.78)",
          borderRadius: 8,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 28,
          letterSpacing: 3,
          color: COLOUR.paper,
        }}
      >
        <span style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 8, height: 26, background: accent }} />
          <span style={{ width: 8, height: 26, background: accent }} />
        </span>
        {tc}
      </div>
      <div
        style={{
          position: "absolute",
          left: box.l + 24,
          top: box.b - 120,
          transform: `translateY(${(1 - inP) * 20}px) rotate(-2deg)`,
          padding: "8px 22px 12px",
          background: accent,
          color: COLOUR.ink,
          fontFamily: HAND,
          fontSize: 64,
          lineHeight: 1.05,
          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
