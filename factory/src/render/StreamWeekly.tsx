// The weekly stream compilation (src/streamweekly): the owner's own footage full screen with its own sound, the
// narrator's links over the lead-ins, the long videos' chapter card (the same card at every break), a label on
// each moment, the teaser tag, the title over the intro and the long videos' end card. Everything is placed by
// the timeline (src/streamweekly/timeline.ts); this only draws it.

import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLOUR } from "./brand.ts";
import { BODY, DISPLAY } from "./components/fonts.ts";
import { SPRING } from "./motion.ts";
import { ChapterInterlude } from "./Long.tsx";
import { EndCard, type EndCardNext } from "./components/EndCard.tsx";

export const STREAM_WEEKLY_FPS = 30;

type Span = { from: number; to: number };

export type StreamWeeklyProps = {
  durationSeconds: number;
  game: string;
  clips: Array<{
    key: string;
    src: string;
    at: number;
    len: number;
    ducked: Span[];
    muted: Span[];
    fadeOut?: boolean;
  }>;
  voices: Array<{ key: string; src: string; at: number; len: number }>;
  cards: Array<{ number: number; title: string; at: number; len: number }>;
  labels: Array<{
    key: string;
    tag: string;
    text: string;
    at: number;
    len: number;
  }>;
  title: { text: string; sub: string; at: number; len: number };
  teaser: { at: number; len: number };
  endCard: { at: number; len: number };
  endLine: string;
  next: EndCardNext | null;
  logoSrc: string | null;
  duck: number;
};

export const SAMPLE_STREAM_WEEKLY: StreamWeeklyProps = {
  durationSeconds: 30,
  game: "Grand Theft Auto VI",
  clips: [],
  voices: [],
  cards: [{ number: 1, title: "GTA 6 Tests You Asked For", at: 2, len: 3 }],
  labels: [
    {
      key: "m1",
      tag: "DAY 1 · TESTED",
      text: "Can you outswim five stars?",
      at: 6,
      len: 4.5,
    },
  ],
  title: {
    text: "GTA 6 WEEK 1",
    sub: "BEST MOMENTS, TESTS AND DISCOVERIES",
    at: 0,
    len: 2,
  },
  teaser: { at: 0, len: 0 },
  endCard: { at: 10, len: 20 },
  endLine: "Every day of the week has its own Short",
  next: { title: "GTA 6 Day by Day", thumbSrc: null },
  logoSrc: "logo.png",
  duck: 0.16,
};

const resolveSrc = (src: string | null) =>
  src && !/^(https?:|data:|blob:)/.test(src) ? staticFile(src) : src;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** The game's volume at a second of a clip (pure): full, low under the voice with 0.3 s ramps, silent where muted, faded under the end card. */
export function clipVolume(
  t: number,
  c: { len: number; ducked: Span[]; muted: Span[]; fadeOut?: boolean },
  duck: number,
): number {
  if (c.muted.some((m) => t >= m.from && t < m.to)) return 0;
  const ramp = 0.3;
  let v = 1;
  for (const d of c.ducked) {
    if (t >= d.from && t <= d.to) v = Math.min(v, duck);
    else if (t > d.to && t < d.to + ramp)
      v = Math.min(v, duck + ((1 - duck) * (t - d.to)) / ramp);
    else if (t < d.from && t > d.from - ramp)
      v = Math.min(v, duck + ((1 - duck) * (d.from - t)) / ramp);
  }
  if (c.fadeOut) v *= Math.max(0, 1 - t / Math.max(1, c.len));
  return Math.max(0, Math.min(1, v));
}

const Label: React.FC<{ tag: string; text: string; frames: number }> = ({
  tag,
  text,
  frames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [frames - 10, frames], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 96,
          bottom: 110,
          opacity: out,
          transform: `translateX(${(1 - enter) * -60}px)`,
          background: "rgba(11,11,14,0.86)",
          borderLeft: `8px solid ${COLOUR.amber}`,
          borderRadius: 6,
          padding: "16px 30px 18px 26px",
          maxWidth: 1100,
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: 5,
            color: COLOUR.amber,
          }}
        >
          {tag}
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: text.length > 30 ? 54 : 64,
            lineHeight: 1.05,
            color: COLOUR.paper,
            textTransform: "uppercase",
            marginTop: 6,
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const TeaserTag: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [frames - 8, frames], [1, 0], clamp);
  const pulse = 0.75 + 0.25 * Math.sin(frame / 4);
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        top: 70,
        opacity: out,
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "rgba(11,11,14,0.8)",
        padding: "12px 22px",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          background: COLOUR.amber,
          opacity: pulse,
        }}
      />
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 30,
          letterSpacing: 6,
          color: COLOUR.paper,
        }}
      >
        COMING UP
      </div>
    </div>
  );
};

const TitleCard: React.FC<{ text: string; sub: string; frames: number }> = ({
  text,
  sub,
  frames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const head = spring({ frame: frame - 4, fps, config: SPRING.ENTER });
  const subIn = spring({ frame: frame - 14, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [frames - 12, frames], [1, 0], clamp);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity: out,
        background: `radial-gradient(80% 70% at 50% 50%, rgba(11,11,14,0.35), rgba(11,11,14,0.75))`,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 170,
            color: COLOUR.paper,
            lineHeight: 0.95,
            transform: `translateY(${(1 - head) * 60}px)`,
            opacity: head,
            filter: "drop-shadow(0 12px 40px rgba(0,0,0,0.65))",
          }}
        >
          {text}
        </div>
        <div
          style={{
            margin: "26px auto 0",
            height: 6,
            width: 260 * subIn,
            background: COLOUR.amber,
            borderRadius: 3,
          }}
        />
        <div
          style={{
            marginTop: 22,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 34,
            letterSpacing: 6,
            color: "rgba(245,245,242,0.9)",
            opacity: subIn,
          }}
        >
          {sub}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const StreamWeekly: React.FC<StreamWeeklyProps> = (p) => {
  const { fps } = useVideoConfig();
  const f = (s: number) => Math.round(s * fps);
  const len = (s: number) => Math.max(1, Math.round(s * fps));
  return (
    <AbsoluteFill style={{ background: COLOUR.ink }}>
      {p.clips.map((c) => (
        <Sequence
          key={c.key}
          from={f(c.at)}
          durationInFrames={len(c.len)}
          layout="none"
        >
          <AbsoluteFill>
            <OffthreadVideo
              src={resolveSrc(c.src)!}
              volume={(fr) => clipVolume(fr / fps, c, p.duck)}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </AbsoluteFill>
        </Sequence>
      ))}
      {p.voices.map((v) => (
        <Sequence
          key={`v-${v.key}`}
          from={f(v.at)}
          durationInFrames={len(v.len + 0.3)}
          layout="none"
        >
          <Audio src={resolveSrc(v.src)!} />
        </Sequence>
      ))}
      {p.teaser.len > 0 ? (
        <Sequence
          from={f(p.teaser.at)}
          durationInFrames={len(Math.min(3, p.teaser.len))}
          layout="none"
        >
          <TeaserTag frames={len(Math.min(3, p.teaser.len))} />
        </Sequence>
      ) : null}
      <Sequence
        from={f(p.title.at)}
        durationInFrames={len(p.title.len)}
        layout="none"
      >
        <TitleCard
          text={p.title.text}
          sub={p.title.sub}
          frames={len(p.title.len)}
        />
      </Sequence>
      {p.cards.map((c) => (
        <Sequence
          key={`c-${c.number}`}
          from={f(c.at)}
          durationInFrames={len(c.len)}
          layout="none"
        >
          <ChapterInterlude
            number={c.number}
            title={c.title}
            game={p.game}
            frames={len(c.len)}
          />
        </Sequence>
      ))}
      {p.labels.map((l) => (
        <Sequence
          key={`l-${l.key}`}
          from={f(l.at)}
          durationInFrames={len(l.len)}
          layout="none"
        >
          <Label tag={l.tag} text={l.text} frames={len(l.len)} />
        </Sequence>
      ))}
      <Sequence
        from={f(p.endCard.at)}
        durationInFrames={len(p.endCard.len)}
        layout="none"
      >
        <EndCard
          next={
            p.next
              ? { ...p.next, thumbSrc: resolveSrc(p.next.thumbSrc) }
              : undefined
          }
          logoSrc={resolveSrc(p.logoSrc)}
          endLine={p.endLine}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
