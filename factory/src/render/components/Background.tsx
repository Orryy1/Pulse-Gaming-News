import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import type { ShortImage, ShortClip } from "../props.ts";
import type { RenderPlan } from "../plan.ts";
import { shotAt } from "../plan.ts";
import { COLOUR } from "../brand.ts";
import { cutPunch, moveTransform, type MovePreset } from "../motion.ts";
import { BANDS, CREDIT_TOP, SAFE, WIDTH } from "../layout.ts";
import { BODY } from "./fonts.ts";

/** Ink field with the game title and an amber rule: shown only when a shot has no media. */
export const BrandPlate: React.FC<{ accent: string; title: string }> = ({
  accent,
  title,
}) => {
  const frame = useCurrentFrame();
  const rule = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const gridShift = (frame * 0.8) % 120;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 70% at 50% 0%, #16161c 0%, ${COLOUR.ink} 55%, #050507 100%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -240,
          top: "48%",
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,0.04) 2px, transparent 2px)",
          backgroundSize: "120px 120px",
          transform: `perspective(900px) rotateX(58deg) translateY(${gridShift}px)`,
          transformOrigin: "50% 100%",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 6,
          background: `linear-gradient(90deg, ${accent}, transparent)`,
          opacity: 0.9,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          top: 1040,
          width: 952 * rule,
          height: 4,
          background: accent,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          top: 1064,
          fontFamily: BODY,
          fontWeight: 800,
          fontSize: 32,
          letterSpacing: 2,
          color: COLOUR.muted,
          textTransform: "uppercase",
          opacity: rule,
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

const footageFilter = "contrast(1.03) saturate(1.05)";

/** Full-bleed cover crop with one ambient move. */
const Still: React.FC<{
  image: ShortImage;
  durationFrames: number;
  move: MovePreset;
}> = ({ image, durationFrames, move }) => {
  const frame = useCurrentFrame();
  const p = Math.min(1, frame / Math.max(1, durationFrames));
  const m = moveTransform(move, p);
  const punch = cutPunch(frame);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={image.src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: footageFilter,
          transform: `scale(${m.scale * punch}) translate(${m.x}px, ${m.y}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Pre-blurred plate behind framed footage; a dark field when none was generated. */
const Plate: React.FC<{ blurSrc?: string | null }> = ({ blurSrc }) =>
  blurSrc ? (
    <Img
      src={blurSrc}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  ) : (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 70% at 50% 30%, #1a1a22 0%, ${COLOUR.ink} 70%)`,
      }}
    />
  );

/**
 * Footage in a 1016x572 panel over its own blurred plate. Wide store art and
 * calm shots under number cards read as a credited, framed picture instead
 * of a cropped strip.
 */
const FramedFootage: React.FC<{
  children: React.ReactNode;
  blurSrc?: string | null;
  durationFrames: number;
  move: MovePreset;
}> = ({ children, blurSrc, durationFrames, move }) => {
  const frame = useCurrentFrame();
  const p = Math.min(1, frame / Math.max(1, durationFrames));
  const m = moveTransform(move === "settle" ? "settle" : "pushIn", p);
  const rise = interpolate(frame, [0, 12], [24, 0], {
    extrapolateRight: "clamp",
  });
  const pop = interpolate(frame, [0, 12], [0.96, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Plate blurSrc={blurSrc} />
      <div
        style={{
          position: "absolute",
          left: 32,
          top: BANDS.hero[0],
          width: WIDTH - 64,
          height: 572,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow:
            "0 40px 120px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.14)",
          transform: `translateY(${rise}px) scale(${pop})`,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `scale(${m.scale - 0.04}) translate(${m.x}px, ${m.y}px)`,
            filter: footageFilter,
          }}
        >
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Clip: React.FC<{
  clip: ShortClip;
  trimFrom: number;
  framed: boolean;
}> = ({ clip, trimFrom, framed }) => {
  const frame = useCurrentFrame();
  const punch = framed ? 1 : cutPunch(frame);
  return (
    <OffthreadVideo
      src={clip.src}
      muted
      startFrom={trimFrom}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        filter: framed ? undefined : footageFilter,
        transform: `scale(${punch})`,
      }}
    />
  );
};

/** "FOOTAGE: PUBLISHER · OFFICIAL TRAILER" tag in the soft margin during clip shots. */
const FootageCredit: React.FC<{ credit: string; durationFrames: number }> = ({
  credit,
  durationFrames,
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(
    frame,
    [0, 8, durationFrames - 8, durationFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        top: CREDIT_TOP,
        fontFamily: BODY,
        fontWeight: 600,
        fontSize: 26,
        letterSpacing: 2,
        color: "rgba(245,245,242,0.78)",
        textShadow: "0 2px 10px rgba(0,0,0,0.9)",
        opacity: o,
        textTransform: "uppercase",
      }}
    >
      {credit}
    </div>
  );
};

/** Executes plan.shots: the picture or clip under the current frame, framed or full-bleed. */
export const ArtTrack: React.FC<{
  plan: RenderPlan;
  images: ShortImage[];
  clips: ShortClip[];
  accent: string;
  gameTitle: string;
  footageCredit: string;
}> = ({ plan, images, clips, accent, gameTitle, footageCredit }) => {
  const frame = useCurrentFrame();
  const { shot, index } = shotAt(plan, frame);
  const len = shot.end - shot.start;
  const media = shot.media;
  const image = media.type === "image" ? images[media.index] : undefined;
  const clip = media.type === "clip" ? clips[media.index] : undefined;
  let body: React.ReactNode;
  if (clip) {
    body = shot.framed ? (
      <FramedFootage
        blurSrc={clip.blurSrc}
        durationFrames={len}
        move={shot.move}
      >
        <Clip clip={clip} trimFrom={media.trimFrom ?? 0} framed />
      </FramedFootage>
    ) : (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Clip clip={clip} trimFrom={media.trimFrom ?? 0} framed={false} />
      </AbsoluteFill>
    );
  } else if (image) {
    body = shot.framed ? (
      <FramedFootage
        blurSrc={image.blurSrc}
        durationFrames={len}
        move={shot.move}
      >
        <Img
          src={image.src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </FramedFootage>
    ) : (
      <Still image={image} durationFrames={len} move={shot.move} />
    );
  } else {
    body = <BrandPlate accent={accent} title={gameTitle} />;
  }
  return (
    <AbsoluteFill key={index}>
      <Sequence from={shot.start} layout="none">
        {body}
        {clip && footageCredit ? (
          <FootageCredit credit={footageCredit} durationFrames={len} />
        ) : null}
      </Sequence>
    </AbsoluteFill>
  );
};

/** Legibility bands: dark behind the brand rows and the captions, nearly clear through the hero and the shelf. */
export const Scrim: React.FC<{ profile?: "footage" | "card" | "plate" }> = ({
  profile = "footage",
}) => {
  const mid = profile === "card" ? 0.22 : profile === "plate" ? 0 : 0.08;
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, rgba(5,5,7,0.80) 0%, rgba(5,5,7,0.10) 15.6%, rgba(5,5,7,${mid}) 18%, rgba(5,5,7,${mid}) 60%, rgba(5,5,7,0.10) 62%, rgba(5,5,7,0.70) 78%, rgba(5,5,7,0.75) 78.2%, rgba(5,5,7,0.92) 100%)`,
      }}
    />
  );
};

/** Film grain and a soft vignette under the type. */
export const Finish: React.FC<{ grainSrc: string }> = ({ grainSrc }) => {
  const frame = useCurrentFrame();
  const x = (frame * 37) % 256;
  const y = (frame * 91) % 256;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 85% 70% at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url(${grainSrc})`,
          backgroundPosition: `${x}px ${y}px`,
          opacity: 0.06,
          mixBlendMode: "overlay",
        }}
      />
    </AbsoluteFill>
  );
};

/** Three-frame accent flash at the two turns of the story. */
export const TurnFlash: React.FC<{ turns: number[]; accent: string }> = ({
  turns,
  accent,
}) => {
  const frame = useCurrentFrame();
  const last = turns.filter((c) => c > 0 && c <= frame).at(-1);
  if (last === undefined) return null;
  const d = frame - last;
  if (d > 3) return null;
  const o = interpolate(d, [0, 3], [0.22, 0]);
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${accent} 0%, rgba(255,255,255,0.9) 100%)`,
        opacity: o,
        mixBlendMode: "screen",
      }}
    />
  );
};
