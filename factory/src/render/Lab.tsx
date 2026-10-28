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
import { Pip, sinceLast } from "./components/Pip.tsx";
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
          left={64}
          top={1010}
          size={200}
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
