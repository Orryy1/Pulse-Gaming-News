import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, Easing, Sequence } from "remotion";
import type { ShortImage } from "../props.ts";

/** Animated brand backdrop used when there is no art, and under art as a base. */
export const MotionField: React.FC<{ accent: string; variant: number }> = ({ accent, variant }) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const blobs = [0, 1, 2].map((i) => {
    const phase = i * 2.1 + variant;
    return {
      x: 50 + Math.sin(t * 0.35 + phase) * 32,
      y: 30 + i * 22 + Math.cos(t * 0.28 + phase) * 12,
      r: 520 + i * 140,
      o: 0.32 - i * 0.07,
    };
  });
  const gridShift = (frame * 1.2) % 120;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(120% 80% at 50% 0%, #1a1a22 0%, #0b0b0e 60%, #050507 100%)", overflow: "hidden" }}>
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: b.r,
            height: b.r,
            marginLeft: -b.r / 2,
            marginTop: -b.r / 2,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accent} 0%, transparent 70%)`,
            opacity: b.o,
            filter: "blur(40px)",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          inset: -240,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,0.045) 2px, transparent 2px)",
          backgroundSize: "120px 120px",
          transform: `perspective(900px) rotateX(58deg) translateY(${gridShift}px)`,
          transformOrigin: "50% 100%",
          top: "45%",
        }}
      />
    </AbsoluteFill>
  );
};

/** One picture with a slow push. Wide images sit on a blurred copy of themselves. */
const Shot: React.FC<{ image: ShortImage; durationFrames: number; index: number }> = ({ image, durationFrames, index }) => {
  const frame = useCurrentFrame();
  const p = Math.min(1, frame / Math.max(1, durationFrames));
  const zoomIn = index % 2 === 0;
  const scale = zoomIn ? interpolate(p, [0, 1], [1.06, 1.18]) : interpolate(p, [0, 1], [1.18, 1.06]);
  const dx = interpolate(p, [0, 1], index % 3 === 0 ? [-24, 24] : [24, -24]);
  const enter = interpolate(frame, [0, 6], [1.08, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const tall = image.aspect < 0.9;
  if (tall) {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img src={image.src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale * enter}) translateX(${dx}px)` }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={image.src}
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(36px) brightness(0.55) saturate(1.3)", transform: `scale(1.3)` }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            width: 1180,
            height: 1180 / image.aspect,
            transform: `scale(${scale * enter}) translateX(${dx}px)`,
            boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
            overflow: "hidden",
            marginTop: -260,
          }}
        >
          <Img src={image.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ArtTrack: React.FC<{ images: ShortImage[]; cuts: number[]; totalFrames: number }> = ({ images, cuts, totalFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (images.length === 0) return null;
  const cutFrames = cuts.map((c) => Math.round(c * fps));
  let i = 0;
  while (i + 1 < cutFrames.length && frame >= cutFrames[i + 1]!) i++;
  const start = cutFrames[i] ?? 0;
  const end = cutFrames[i + 1] ?? totalFrames;
  const image = images[i % images.length]!;
  return (
    <AbsoluteFill key={i}>
      <FrameOffset offset={start}>
        <Shot image={image} durationFrames={end - start} index={i} />
      </FrameOffset>
    </AbsoluteFill>
  );
};

// Restarts the frame counter at the shot's cut so each push starts fresh.
const FrameOffset: React.FC<{ offset: number; children: React.ReactNode }> = ({ offset, children }) => (
  <Sequence from={offset} layout="none">
    {children}
  </Sequence>
);

/** Legibility gradients over the art. */
export const Scrim: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(5,5,7,0.85) 0%, rgba(5,5,7,0.15) 22%, rgba(5,5,7,0.05) 45%, rgba(5,5,7,0.75) 68%, rgba(5,5,7,0.95) 100%)",
    }}
  />
);
