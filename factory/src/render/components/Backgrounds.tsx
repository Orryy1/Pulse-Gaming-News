// Animated backgrounds for full-screen explainers, the video-essay way (owner, 27 Oct 2026: "the animated
// crumpled paper effect ... loads of varieties"). All drawn in code (SVG noise, lighting and gradients),
// so nothing to license; all mid-to-dark so the light type over them reads. Paper "boils" like stop
// motion: its texture re-rolls every few frames. Everything is a pure function of the frame.

import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLOUR } from "../brand.ts";

export const BACKGROUNDS = [
  "crumpled",
  "kraft",
  "notebook",
  "newsprint",
  "blueprint",
  "graph",
  "contour",
  "crt",
  "pixels",
  "lightleak",
  "aurora",
  "filmburn",
  "cork",
] as const;
export type BackgroundKind = (typeof BACKGROUNDS)[number];

/** Stop-motion boil: a new texture every `every` frames, cycling through a few so it never strobes. */
const boilSeed = (frame: number, every = 4, base = 1) =>
  base + (Math.floor(frame / every) % 6);

/** A noise texture lit from the top left: paper relief. Drawn at half size and scaled up (cheap, still crisp enough for texture). */
const Relief: React.FC<{
  seed: number;
  freq: string;
  octaves: number;
  scale: number;
  type?: "fractalNoise" | "turbulence";
  opacity: number;
  blend?: React.CSSProperties["mixBlendMode"];
}> = ({
  seed,
  freq,
  octaves,
  scale,
  type = "fractalNoise",
  opacity,
  blend = "multiply",
}) => {
  const id = `relief${seed}${freq.replace(/[^0-9]/g, "")}${octaves}${type[0]}`;
  return (
    <svg
      viewBox="0 0 960 540"
      preserveAspectRatio="none"
      width={960}
      height={540}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1920,
        height: 1080,
        opacity,
        mixBlendMode: blend,
      }}
    >
      <filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type={type}
          baseFrequency={freq}
          numOctaves={octaves}
          seed={seed}
          result="n"
        />
        <feDiffuseLighting
          in="n"
          lightingColor="#ffffff"
          surfaceScale={scale}
          result="lit"
        >
          <feDistantLight azimuth={225} elevation={48} />
        </feDiffuseLighting>
        <feColorMatrix in="lit" type="saturate" values="0" />
      </filter>
      <rect width="960" height="540" filter={`url(#${id})`} />
    </svg>
  );
};

/** Fine grain over everything, re-rolled each frame like film. */
const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.08 }) => {
  const frame = useCurrentFrame();
  const id = `bggrain${frame % 8}`;
  return (
    <svg
      viewBox="0 0 960 540"
      preserveAspectRatio="none"
      width={960}
      height={540}
      style={{
        position: "absolute",
        inset: 0,
        width: 1920,
        height: 1080,
        opacity,
        mixBlendMode: "overlay",
      }}
    >
      <filter id={id}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves={2}
          seed={frame % 8}
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="960" height="540" filter={`url(#${id})`} />
    </svg>
  );
};

const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.6 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${strength}) 100%)`,
    }}
  />
);

/** A drifting offset in pixels for slow parallax. */
const drift = (frame: number, speed: number) => (frame * speed) % 400;

export const TextureBackground: React.FC<{
  kind: BackgroundKind;
  variant?: number;
}> = ({ kind, variant = 0 }) => {
  const frame = useCurrentFrame();
  const v = variant % 6;
  switch (kind) {
    case "crumpled":
      // Charcoal paper, crumpled, boiling: two reliefs (folds and creases) over a warm dark base.
      return (
        <AbsoluteFill style={{ background: "#8a8075", overflow: "hidden" }}>
          <Relief
            seed={boilSeed(frame, 4, 10 + v)}
            freq="0.006"
            octaves={4}
            scale={14}
            opacity={1}
          />
          <Relief
            seed={boilSeed(frame, 4, 30 + v)}
            freq="0.02"
            octaves={2}
            scale={4}
            type="turbulence"
            opacity={0.55}
          />
          {/* A warm dark wash: the folds still read, and white type over it does too. */}
          <AbsoluteFill style={{ background: "rgba(24,19,15,0.55)" }} />
          <Vignette strength={0.55} />
          <Grain opacity={0.07} />
        </AbsoluteFill>
      );
    case "kraft":
      // Brown packing paper: long fibres across, a soft relief, boiling slowly.
      return (
        <AbsoluteFill style={{ background: "#8a643c", overflow: "hidden" }}>
          <Relief
            seed={boilSeed(frame, 6, 50 + v)}
            freq="0.003 0.09"
            octaves={3}
            scale={2.5}
            opacity={0.7}
          />
          <Relief
            seed={boilSeed(frame, 6, 70 + v)}
            freq="0.008"
            octaves={3}
            scale={4}
            opacity={0.45}
          />
          <AbsoluteFill style={{ background: "rgba(20,12,6,0.5)" }} />
          <Vignette strength={0.6} />
          <Grain opacity={0.08} />
        </AbsoluteFill>
      );
    case "notebook":
      // Dark exercise-book paper: ruled lines, an amber margin, a light relief.
      return (
        <AbsoluteFill style={{ background: "#2a2b31", overflow: "hidden" }}>
          <AbsoluteFill
            style={{
              backgroundImage:
                "repeating-linear-gradient(180deg, transparent 0 62px, rgba(140,170,220,0.22) 62px 64px)",
              transform: `translateY(${-drift(frame, 0.15) % 64}px)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 230,
              top: 0,
              bottom: 0,
              width: 3,
              background: "rgba(255,107,26,0.45)",
            }}
          />
          <Relief
            seed={boilSeed(frame, 5, 90 + v)}
            freq="0.01"
            octaves={3}
            scale={2}
            opacity={0.35}
          />
          <Vignette strength={0.55} />
          <Grain opacity={0.06} />
        </AbsoluteFill>
      );
    case "newsprint": {
      // Grey newsprint with a halftone dot screen and a printing-press grain.
      const dot = 14;
      return (
        <AbsoluteFill style={{ background: "#3b3a37", overflow: "hidden" }}>
          <AbsoluteFill
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(0,0,0,0.55) 2.6px, transparent 3px)",
              backgroundSize: `${dot}px ${dot}px`,
              transform: `rotate(15deg) scale(1.4) translate(${drift(frame, 0.08)}px, 0)`,
              opacity: 0.6,
            }}
          />
          <Relief
            seed={boilSeed(frame, 5, 110 + v)}
            freq="0.012"
            octaves={3}
            scale={2}
            opacity={0.4}
          />
          <Vignette strength={0.5} />
          <Grain opacity={0.09} />
        </AbsoluteFill>
      );
    }
    case "blueprint":
      // Navy drafting paper: a fine and a coarse grid drifting, the paper's own texture faint under it.
      return (
        <AbsoluteFill style={{ background: "#0f2747", overflow: "hidden" }}>
          <AbsoluteFill
            style={{
              backgroundImage:
                "linear-gradient(rgba(170,205,255,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(170,205,255,0.10) 1px, transparent 1px), linear-gradient(rgba(170,205,255,0.22) 2px, transparent 2px), linear-gradient(90deg, rgba(170,205,255,0.22) 2px, transparent 2px)",
              backgroundSize: "40px 40px, 40px 40px, 200px 200px, 200px 200px",
              backgroundPosition: `${drift(frame, 0.25)}px ${drift(frame, 0.12)}px`,
            }}
          />
          <Relief
            seed={boilSeed(frame, 8, 130 + v)}
            freq="0.009"
            octaves={3}
            scale={2}
            opacity={0.18}
            blend="overlay"
          />
          <Vignette strength={0.65} />
          <Grain opacity={0.05} />
        </AbsoluteFill>
      );
    case "graph":
      // Charcoal graph paper with an amber major grid.
      return (
        <AbsoluteFill style={{ background: "#1d1d22", overflow: "hidden" }}>
          <AbsoluteFill
            style={{
              backgroundImage:
                "linear-gradient(rgba(245,245,242,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(245,245,242,0.06) 1px, transparent 1px), linear-gradient(rgba(255,107,26,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,26,0.16) 1px, transparent 1px)",
              backgroundSize: "32px 32px, 32px 32px, 160px 160px, 160px 160px",
              backgroundPosition: `${-drift(frame, 0.2)}px 0`,
            }}
          />
          <Vignette strength={0.6} />
          <Grain opacity={0.05} />
        </AbsoluteFill>
      );
    case "contour": {
      // Topographic lines: the noise's height turned into thin contour lines (a table that only lights
      // narrow bands), amber on slate, drifting like a slow map pan.
      const id = `contour${v}`;
      const x = -drift(frame, 0.3);
      const bands = Array.from({ length: 13 }, (_, i) => (i % 2 ? "0 1 0" : "0 0 0")).join(" ");
      return (
        <AbsoluteFill style={{ background: "#14171c", overflow: "hidden" }}>
          <svg
            viewBox="0 0 1200 700"
            preserveAspectRatio="none"
            width={1200}
            height={700}
            style={{ position: "absolute", left: x * 1.6, top: -60, width: 2400, height: 1400, opacity: 0.5 }}
          >
            <filter id={id}>
              <feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves={2} seed={200 + v} result="n" />
              <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.45  0 0 0 0 0.12  1 0 0 0 0" />
              <feComponentTransfer>
                <feFuncA type="table" tableValues={bands} />
              </feComponentTransfer>
            </filter>
            <rect width="1200" height="700" filter={`url(#${id})`} />
          </svg>
          <Vignette strength={0.7} />
          <Grain opacity={0.05} />
        </AbsoluteFill>
      );
    }
    case "crt": {
      // An old television: scanlines, a soft RGB phosphor glow, a rolling bar and a faint flicker.
      const roll = (frame * 6) % 1300;
      const flicker = 0.92 + 0.08 * Math.sin(frame * 1.7);
      return (
        <AbsoluteFill
          style={{
            background: "#0b0f0d",
            overflow: "hidden",
            opacity: flicker,
          }}
        >
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse at 50% 45%, rgba(70,140,110,0.55) 0%, rgba(20,40,30,0.3) 45%, rgba(0,0,0,0) 75%)",
            }}
          />
          <AbsoluteFill
            style={{
              backgroundImage:
                "repeating-linear-gradient(180deg, rgba(0,0,0,0.55) 0 2px, transparent 2px 4px)",
            }}
          />
          <AbsoluteFill
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,0,0,0.05) 0 1px, rgba(0,255,0,0.05) 1px 2px, rgba(0,0,255,0.05) 2px 3px)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: roll - 200,
              height: 200,
              background:
                "linear-gradient(180deg, transparent, rgba(255,255,255,0.05), transparent)",
            }}
          />
          <Vignette strength={0.85} />
          <Grain opacity={0.1} />
        </AbsoluteFill>
      );
    }
    case "pixels": {
      // A slow field of square pixels in the brand colours, like an old game's screen up close.
      const cell = 48;
      const id = `px${v}`;
      return (
        <AbsoluteFill style={{ background: "#121216", overflow: "hidden" }}>
          <svg
            viewBox="0 0 40 23"
            preserveAspectRatio="none"
            width={40}
            height={23}
            style={{
              position: "absolute",
              inset: 0,
              width: 1920,
              height: 1104,
              imageRendering: "pixelated",
              opacity: 0.35,
            }}
          >
            <filter id={id}>
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.09"
                numOctaves={1}
                seed={boilSeed(frame, 10, 300 + v)}
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0.9 -0.25  0 0 0 0.38 -0.12  0 0 0 0.08 -0.02  0 0 0 0 1"
              />
            </filter>
            <rect width="40" height="23" filter={`url(#${id})`} />
          </svg>
          <AbsoluteFill
            style={{
              backgroundImage: `linear-gradient(rgba(0,0,0,0.6) 2px, transparent 2px), linear-gradient(90deg, rgba(0,0,0,0.6) 2px, transparent 2px)`,
              backgroundSize: `${cell}px ${cell}px`,
            }}
          />
          <Vignette strength={0.7} />
        </AbsoluteFill>
      );
    }
    case "lightleak": {
      // Warm light leaking across dark film, drifting.
      const t = frame / 30;
      const x1 = 20 + 15 * Math.sin(t * 0.35 + v);
      const x2 = 75 + 12 * Math.cos(t * 0.27 + v);
      return (
        <AbsoluteFill style={{ background: "#0e0c0b", overflow: "hidden" }}>
          <AbsoluteFill
            style={{
              background: `radial-gradient(45% 60% at ${x1}% 30%, rgba(255,120,40,0.55) 0%, rgba(255,120,40,0) 70%)`,
              filter: "blur(30px)",
            }}
          />
          <AbsoluteFill
            style={{
              background: `radial-gradient(40% 55% at ${x2}% 75%, rgba(255,60,40,0.4) 0%, rgba(255,60,40,0) 70%)`,
              filter: "blur(40px)",
            }}
          />
          <Vignette strength={0.6} />
          <Grain opacity={0.1} />
        </AbsoluteFill>
      );
    }
    case "aurora": {
      // Slow ribbons of the brand amber and deep red over navy.
      const t = frame / 30;
      return (
        <AbsoluteFill style={{ background: "#0c0d14", overflow: "hidden" }}>
          {[0, 1, 2].map((i) => (
            <AbsoluteFill
              key={i}
              style={{
                background: `radial-gradient(${50 + i * 10}% ${30 + i * 8}% at ${30 + 25 * Math.sin(t * (0.2 + i * 0.07) + i * 2 + v)}% ${35 + 20 * Math.cos(t * (0.15 + i * 0.05) + i)}%, ${["rgba(255,107,26,0.45)", "rgba(200,40,60,0.35)", "rgba(60,80,200,0.3)"][i]} 0%, rgba(0,0,0,0) 70%)`,
                filter: "blur(50px)",
              }}
            />
          ))}
          <Vignette strength={0.55} />
          <Grain opacity={0.08} />
        </AbsoluteFill>
      );
    }
    case "filmburn": {
      // Old film: a warm frame that breathes, scratches and dust flickering across it.
      const id = `burn${frame % 6}`;
      const breathe = interpolate(Math.sin(frame / 18), [-1, 1], [0.3, 0.5]);
      return (
        <AbsoluteFill style={{ background: "#16100b", overflow: "hidden" }}>
          <AbsoluteFill
            style={{
              background: `radial-gradient(ellipse at 50% 50%, rgba(255,150,70,${breathe}) 0%, rgba(120,40,10,0.2) 55%, rgba(0,0,0,0.9) 100%)`,
            }}
          />
          <svg
            viewBox="0 0 960 540"
            preserveAspectRatio="none"
            width={960}
            height={540}
            style={{
              position: "absolute",
              inset: 0,
              width: 1920,
              height: 1080,
              opacity: 0.09,
              mixBlendMode: "screen",
            }}
          >
            <filter id={id}>
              <feTurbulence
                type="turbulence"
                baseFrequency="0.9 0.004"
                numOctaves={1}
                seed={frame % 6}
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 1  0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 -9 4"
              />
            </filter>
            <rect width="960" height="540" filter={`url(#${id})`} />
          </svg>
          <Grain opacity={0.14} />
        </AbsoluteFill>
      );
    }
    case "cork": {
      // A corkboard: speckled brown relief, for who's-who cards and evidence.
      return (
        <AbsoluteFill style={{ background: "#6a4a2c", overflow: "hidden" }}>
          <Relief
            seed={boilSeed(frame, 8, 400 + v)}
            freq="0.15"
            octaves={2}
            scale={3}
            opacity={0.75}
          />
          <Relief
            seed={boilSeed(frame, 8, 420 + v)}
            freq="0.02"
            octaves={3}
            scale={2}
            opacity={0.4}
          />
          <AbsoluteFill style={{ background: "rgba(25,14,6,0.4)" }} />
          <Vignette strength={0.65} />
        </AbsoluteFill>
      );
    }
    default:
      return <AbsoluteFill style={{ background: COLOUR.ink }} />;
  }
};

/**
 * Which background suits a graphic: paper for words and records, drafting paper for data and time,
 * the era's own look for a chapter interlude (a CRT for the 1990s, newsprint for the 2000s, light for
 * now), cork for people. `variant` rotates within each family so a video never shows the same one twice
 * running.
 */
export function backgroundFor(
  kind: string,
  year: number | undefined,
  variant: number,
): BackgroundKind | undefined {
  const pick = (opts: BackgroundKind[]) =>
    opts[Math.abs(variant) % opts.length]!;
  switch (kind) {
    case "quote":
      return pick(["crumpled", "kraft", "lightleak", "crumpled", "aurora"]);
    case "source":
      return pick(["kraft", "crumpled", "notebook"]);
    case "headline":
      return year && year < 2005
        ? pick(["kraft", "crumpled", "newsprint"])
        : pick(["graph", "aurora", "lightleak"]);
    case "timeline":
    case "span":
      return pick(["blueprint", "contour", "graph"]);
    case "delay":
      return pick(["crumpled", "graph", "notebook"]);
    case "reviews":
      return pick(["graph", "newsprint", "aurora"]);
    case "people":
      return pick(["cork", "kraft", "crumpled"]);
    case "interlude":
      if (year && year < 2000) return pick(["crt", "pixels"]);
      if (year && year < 2010) return pick(["newsprint", "filmburn", "kraft"]);
      return pick(["lightleak", "aurora", "crumpled", "contour"]);
    default:
      return undefined;
  }
}
