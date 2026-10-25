// The lab: a short sample for trying a new device before it goes into every Short. Two on trial
// (25 Oct 2026): Pip, a code-drawn mascot in the channel's amber who idles, blinks, talks while the
// narrator talks and reacts to the big moments; and word stamps, a rubber-stamp card that slams in on
// the exact spoken word ("CONFIRMED" on the date, "27 DAYS" on the number). Everything is a function of
// the frame, like the rest of the renderer, so a sample re-renders identically.

import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "./brand.ts";
import { DISPLAY, BODY } from "./components/fonts.ts";
import { Captions, HookHeadline, TopBar } from "./components/Overlays.tsx";
import { Finish } from "./components/Background.tsx";
import { displayWords, pageCaptions } from "./timeline.ts";
import { Stamp } from "./components/Stamp.tsx";
import type { Word } from "../voice/elevenlabs.ts";

export interface LabStamp {
  /** Seconds the stamp lands: the spoken word's start. */
  at: number;
  text: string;
  sub?: string;
  colour: string;
}

export type LabProps = {
  audioSrc: string;
  clipSrc: string; // the hook's footage
  imageSrc: string; // the still after it
  words: Word[];
  headline: string;
  gameTitle: string;
  hookEnd: number; // seconds: when the hook's footage gives way to the still
  stamps: LabStamp[];
  mascot: boolean;
  durationSeconds: number;
};

export const SAMPLE_LAB: LabProps = {
  audioSrc: "",
  clipSrc: "",
  imageSrc: "",
  words: [],
  headline: "GTA 6 LAUNCH TRAILER DROPS, DATE HOLDS",
  gameTitle: "GTA",
  hookEnd: 4,
  stamps: [],
  mascot: true,
  durationSeconds: 10,
};

const resolveSrc = (src: string) =>
  /^(https?:|data:|blob:)/.test(src) ? src : staticFile(src);

/** Frames since the last event at or before this frame, or undefined. */
function sinceLast(
  frame: number,
  fps: number,
  times: number[],
): number | undefined {
  const past = times.map((t) => Math.round(t * fps)).filter((f) => f <= frame);
  return past.length ? frame - Math.max(...past) : undefined;
}

/**
 * Pip: an amber squircle with two eyes and a heartbeat line for a mouth. Two clocks drive it: the
 * ambient one (a slow bob, a blink every few seconds) and the story one (the mouth moves while a word
 * is spoken; a stamp makes it squash, spike and look at the stamp).
 */
const Pip: React.FC<{
  words: Word[];
  reactions: number[];
  lookAt: (f: number) => { x: number; y: number };
}> = ({ words, reactions, lookAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const bob = Math.sin(t * 2.2) * 6;
  const blink = frame % 104 >= 100 ? 0.12 : 1;
  const talking = words.some((w) => t >= w.start && t < w.end + 0.02);
  const since = sinceLast(frame, fps, reactions);
  const react =
    since === undefined
      ? 0
      : spring({
          frame: since,
          fps,
          config: { damping: 9, stiffness: 220, mass: 0.6 },
        });
  const fresh = since !== undefined && since < 30;
  // Squash on impact, stretch on the rebound, settle.
  const squash = fresh
    ? interpolate(react, [0, 0.35, 0.7, 1], [1, 0.82, 1.08, 1])
    : 1;
  const look = lookAt(frame);
  // The heartbeat: a small blip that travels while speaking, a tall spike on a reaction.
  const amp = fresh
    ? interpolate(since!, [0, 8, 30], [34, 30, 10], {
        extrapolateRight: "clamp",
      })
    : talking
      ? 10 + Math.abs(Math.sin(t * 22)) * 8
      : 3;
  const phase = (t * 140) % 220;
  const pts: string[] = [];
  for (let x = 30; x <= 170; x += 4) {
    const d = Math.abs(x - 30 - (phase % 140));
    const y =
      128 - (d < 10 ? amp * (1 - d / 10) * (x % 8 === 0 ? 1 : -0.45) : 0);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return (
    <div
      style={{
        position: "absolute",
        left: 64,
        top: 1010,
        width: 200,
        height: 200,
        transform: `translateY(${bob}px) scale(${1 / Math.sqrt(squash)}, ${squash})`,
        transformOrigin: "50% 100%",
        filter: "drop-shadow(0 18px 30px rgba(0,0,0,0.55))",
      }}
    >
      <svg viewBox="0 0 200 200" width={200} height={200}>
        <defs>
          <linearGradient id="pipBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FF8A45" />
            <stop offset="1" stopColor={COLOUR.amber} />
          </linearGradient>
        </defs>
        <rect
          x="14"
          y="20"
          width="172"
          height="166"
          rx="62"
          fill="url(#pipBody)"
          stroke={COLOUR.ink}
          strokeWidth="6"
        />
        {[68, 132].map((cx) => (
          <g key={cx} transform={`translate(${cx} 82) scale(1 ${blink})`}>
            <ellipse
              cx="0"
              cy="0"
              rx="21"
              ry="25"
              fill={COLOUR.paper}
              stroke={COLOUR.ink}
              strokeWidth="4"
            />
            <circle cx={look.x * 8} cy={look.y * 9} r="10" fill={COLOUR.ink} />
            <circle
              cx={look.x * 8 - 3}
              cy={look.y * 9 - 4}
              r="3"
              fill={COLOUR.paper}
            />
          </g>
        ))}
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={COLOUR.ink}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

export const Lab: React.FC<LabProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const pages = useMemo(() => pageCaptions(displayWords(p.words)), [p.words]);
  const emphasis = useMemo(() => new Set<string>(), []);
  const hookEnd = Math.round(p.hookEnd * fps);
  const hold = Math.round(1.7 * fps);
  // A stamp's impact nudges the whole frame for a few frames.
  const since = sinceLast(
    frame,
    fps,
    p.stamps.map((s) => s.at),
  );
  const shake =
    since !== undefined && since < 7
      ? Math.sin(since * 2.6) * (7 - since) * 1.6
      : 0;
  // Pip looks up at the headline, then at each stamp while it is on screen, else at the viewer.
  const lookAt = (f: number) => {
    const s = sinceLast(
      f,
      fps,
      p.stamps.map((x) => x.at),
    );
    if (s !== undefined && s < hold) return { x: 0.8, y: -0.7 };
    if (f < hookEnd) return { x: 0.4, y: -1 };
    return { x: 0.15, y: 0.1 };
  };
  const push = interpolate(frame, [0, durationInFrames], [1.06, 1.16]);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLOUR.ink,
        transform: `translate(${shake}px, ${shake * 0.5}px)`,
      }}
    >
      <Sequence durationInFrames={hookEnd} layout="none">
        <AbsoluteFill style={{ transform: `scale(${push})` }}>
          {p.clipSrc ? (
            <OffthreadVideo
              src={resolveSrc(p.clipSrc)}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </AbsoluteFill>
      </Sequence>
      <Sequence from={hookEnd} layout="none">
        <AbsoluteFill style={{ transform: `scale(${push})` }}>
          {p.imageSrc ? (
            <Img
              src={resolveSrc(p.imageSrc)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </AbsoluteFill>
      </Sequence>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(11,11,14,0.55) 0%, rgba(11,11,14,0.05) 35%, rgba(11,11,14,0.15) 60%, rgba(11,11,14,0.85) 100%)",
        }}
      />
      <Sequence durationInFrames={hookEnd} layout="none">
        <HookHeadline
          headline={p.headline}
          accent={COLOUR.amber}
          gameTitle={p.gameTitle}
          durationInFrames={hookEnd}
        />
      </Sequence>
      {p.stamps.map((s, i) => (
        <Sequence
          key={i}
          from={Math.round(s.at * fps)}
          durationInFrames={hold}
          layout="none"
        >
          <Stamp stamp={s} hold={hold} />
        </Sequence>
      ))}
      {p.mascot ? (
        <Pip
          words={p.words}
          reactions={p.stamps.map((s) => s.at)}
          lookAt={lookAt}
        />
      ) : null}
      <TopBar
        chip="NEW TRAILER"
        accent={COLOUR.amber}
        isRumour={false}
        attribution="Source: Xbox Wire, IGN"
        logoSrc={staticFile("logo.png")}
      />
      <Captions
        pages={pages}
        accent={COLOUR.amber}
        emphasis={emphasis}
        blankFromFrame={durationInFrames - 4}
      />
      <Finish grainSrc={staticFile("grain.png")} />
      {p.audioSrc ? <Audio src={resolveSrc(p.audioSrc)} /> : null}
    </AbsoluteFill>
  );
};
