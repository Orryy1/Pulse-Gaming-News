// The long-form 16:9 composition: a ranking video of five to seven minutes.
// Full-bleed trailer moments and art on slow moves, a lower-third card for
// each entry that collapses to a tag, an intro title, the pick as the outro
// and a quiet end card. No burned captions: the SRT track carries them.

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
import { BODY, DISPLAY } from "./components/fonts.ts";
import { moveTransform, SPRING, type MovePreset } from "./motion.ts";
import {
  buildLongPlan,
  entryOf,
  momentWindows,
  titleLines,
  gameSoundVolume,
  type LongPlan,
  usefulEmphasis,
  usefulGraphic,
} from "./longplan.ts";
import {
  FlashPunch,
  GrainVignette,
  KineticCaption,
  MomentGraphicCard,
  PopInPicture,
  Sfx,
  type MomentProp,
} from "./components/LongMoments.tsx";
import { displayText, type Segment } from "./timeline.ts";
import type { Word } from "../voice/elevenlabs.ts";

export interface LongImageProp {
  src: string;
  kind: string;
  aspect: number;
  beatIndex?: number;
  credit?: string; // archive photos: author / licence / source, shown on screen
  moment?: number;
  label?: string;
}

export interface LongClipProp {
  src: string;
  durationSeconds: number;
  beatIndex?: number;
  role?: "hook";
  moment?: number;
  credit?: string; // licensed gameplay: creator and licence, shown on screen
  audio?: boolean; // gameplay with its game sound kept: played low under the narrator
}

export type LongProps = {
  title: string; // on-screen title
  kicker: string; // line under the title in the intro
  spoilers?: boolean; // a story ranking: the intro says so on screen
  recap?: boolean; // the weekly news recap: the chip reads THIS WEEK
  criterion: string;
  theme: string; // franchise or theme name
  footageCredit: string;
  endLine?: string; // the line under the end card
  moments?: MomentProp[][]; // per ranking entry, one per sentence: graphics, kinetic captions, pop-ins
  segments: Segment[];
  words: Word[];
  images: LongImageProp[];
  clips: LongClipProp[];
  plan: LongPlan | null;
  logoSrc: string | null;
  audioSrc: string | null;
  musicSrc: string | null;
  durationSeconds: number;
  variant: number;
  renderDate: string;
};

const resolveSrc = (src: string | null) =>
  src && !/^(https?:|data:|blob:)/.test(src) ? staticFile(src) : src;
const CROP = 1.12; // trims letterbox bars and burned-in subtitles from trailer clips
const SAFE_X = 96;
const SAFE_BOTTOM = 72;
const CARD_HOLD = 240; // frames the full lower third stays before collapsing to a tag

export const SAMPLE_LONG_PROPS: LongProps = {
  title: "Every Resident Evil Game Ranked",
  kicker: "Worst to best, by pure dread",
  criterion: "How much survival horror tension it delivers today",
  theme: "Resident Evil",
  footageCredit: "FOOTAGE: OFFICIAL TRAILERS · STEAM",
  segments: [
    {
      kind: "hook",
      text: "Every mainline Resident Evil game, ranked by one thing: how much dread it delivers today.",
      start: 0,
      end: 7,
    },
    {
      kind: "beat",
      text: "Resident Evil 6 arrived in 2012 as four campaigns of action.",
      start: 7,
      end: 14,
      visual: {
        kind: "rank",
        primary: "Resident Evil 6",
        secondary: "All action",
        value_a: 2,
        items: ["2012", "PC, PS3, Xbox 360"],
      },
    },
    {
      kind: "beat",
      text: "Resident Evil 7 brought the series back to first person and to fear.",
      start: 14,
      end: 21,
      visual: {
        kind: "rank",
        primary: "Resident Evil 7: Biohazard",
        secondary: "Peak terror",
        value_a: 1,
        items: ["2017", "PC, PS4, Xbox One"],
      },
    },
    {
      kind: "take",
      text: "Number one is the game that made the series frightening again.",
      start: 21,
      end: 27,
      label: "OUR PICK",
      visual: {
        kind: "title",
        primary: "RE7: tension from start to finish",
        secondary: "",
      },
    },
  ],
  words: [],
  images: [],
  clips: [],
  plan: null,
  logoSrc: "logo.png",
  audioSrc: null,
  musicSrc: "music_3.mp3",
  durationSeconds: 33,
  variant: 0,
  renderDate: "2026-10-17",
};

function synthWords(segments: Segment[]): Word[] {
  const out: Word[] = [];
  for (const s of segments) {
    const ws = s.text.split(/\s+/).filter(Boolean);
    const step = (s.end - s.start) / Math.max(1, ws.length);
    ws.forEach((w, i) =>
      out.push({
        text: w,
        start: s.start + i * step,
        end: s.start + (i + 0.85) * step,
      }),
    );
  }
  return out;
}

const Still: React.FC<{
  src: string;
  aspect: number;
  durationFrames: number;
  move: MovePreset;
  fromBlack?: boolean;
}> = ({ src, aspect, durationFrames, move, fromBlack = false }) => {
  const frame = useCurrentFrame();
  const m = moveTransform(
    move,
    Math.min(1, frame / Math.max(1, durationFrames)),
  );
  const fade = interpolate(frame, [0, 10], [fromBlack ? 0 : 1, 1], {
    extrapolateRight: "clamp",
  });
  if (aspect < 0.9) {
    // Box art is portrait: cover-cropping it shows a dark band of the cover, so it sits
    // as a framed poster over its own blurred copy instead.
    return (
      <AbsoluteFill style={{ overflow: "hidden", opacity: fade }}>
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(40px) brightness(0.45) saturate(1.2)",
            transform: "scale(1.2)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            height: 760,
            aspectRatio: String(aspect),
            transform: `translate(-50%, -50%) scale(${m.scale - 0.02})`,
            borderRadius: 14,
            overflow: "hidden",
            boxShadow:
              "0 50px 140px rgba(0,0,0,0.7), inset 0 0 0 2px rgba(255,255,255,0.14)",
          }}
        >
          <Img
            src={src}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity: fade }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "contrast(1.03) saturate(1.05)",
          transform: `scale(${m.scale + 0.04}) translate(${m.x}px, ${m.y}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Clip: React.FC<{ src: string; audio?: boolean; frames?: number }> = ({ src, audio, frames }) => {
  const frame = useCurrentFrame();
  // A hard cut: fading in from transparent showed the black canvas under it for a few frames.
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        src={src}
        muted={!audio}
        volume={audio && frames ? (f) => gameSoundVolume(f, frames) : undefined}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center 46%",
          transform: `scale(${CROP})`,
          filter: "contrast(1.03) saturate(1.05)",
        }}
      />
    </AbsoluteFill>
  );
};

const Plate: React.FC<{ theme: string }> = ({ theme }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 70% at 50% 30%, #1a1a22 0%, ${COLOUR.ink} 70%)`,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: 180,
        color: "rgba(245,245,242,0.12)",
        letterSpacing: 4,
        textTransform: "uppercase",
        textAlign: "center",
        padding: "0 120px",
        lineHeight: 1,
      }}
    >
      {theme}
    </div>
  </AbsoluteFill>
);

/** Frames a still overlaps the shot before it, so cuts dissolve instead of dipping to black. */
const XFADE = 9;

/** Fades its contents in over the first frames of its sequence; what is behind shows through. */
const FadeIn: React.FC<{ frames: number; children: React.ReactNode }> = ({
  frames,
  children,
}) => {
  const frame = useCurrentFrame();
  const o =
    frames > 0
      ? interpolate(frame, [0, frames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const TitleLines: React.FC<{ text: string }> = ({ text }) => (
  <>
    {titleLines(text).map((l, k) => (
      <div key={k} style={{ whiteSpace: "nowrap" }}>
        {l}
      </div>
    ))}
  </>
);

const Backdrop: React.FC<{
  plan: LongPlan;
  images: LongImageProp[];
  clips: LongClipProp[];
  theme: string;
}> = ({ plan, images, clips, theme }) => (
  <AbsoluteFill style={{ backgroundColor: COLOUR.ink }}>
    {plan.shots.map((s, i) => {
      const len = Math.max(1, s.end - s.start);
      const img = s.media.type === "image" ? images[s.media.index] : undefined;
      const clip = s.media.type === "clip" ? clips[s.media.index] : undefined;
      return (
        <Sequence
          key={i}
          from={img && i > 0 ? s.start - Math.min(XFADE, s.start) : s.start}
          durationInFrames={img && i > 0 ? len + Math.min(XFADE, s.start) : len}
          layout="none"
        >
          {clip ? (
            <>
              <Clip src={clip.src} audio={clip.audio} frames={len} />
            </>
          ) : img ? (
            <>
              <FadeIn frames={i > 0 ? Math.min(XFADE, s.start) : 0}>
                <Still
                  src={img.src}
                  aspect={img.aspect}
                  durationFrames={len + (i > 0 ? Math.min(XFADE, s.start) : 0)}
                  move={s.move}
                  fromBlack={i === 0}
                />
              </FadeIn>
              {img.credit ? (
                <div
                  style={{
                    position: "absolute",
                    right: 40,
                    bottom: 26,
                    padding: "4px 10px",
                    background: "rgba(11,11,14,0.55)",
                    borderRadius: 6,
                    fontFamily: BODY,
                    fontWeight: 600,
                    fontSize: 16,
                    letterSpacing: 0.5,
                    color: "rgba(245,245,242,0.8)",
                  }}
                >
                  PHOTO: {img.credit}
                </div>
              ) : null}
            </>
          ) : (
            <Plate theme={theme} />
          )}
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

const Scrim: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 520,
        background:
          "linear-gradient(180deg, rgba(11,11,14,0) 0%, rgba(11,11,14,0.55) 45%, rgba(11,11,14,0.9) 100%)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: 180,
        background:
          "linear-gradient(180deg, rgba(11,11,14,0.55) 0%, rgba(11,11,14,0) 100%)",
      }}
    />
  </AbsoluteFill>
);

const Brand: React.FC<{
  logoSrc: string | null;
  chip: string;
  progress: number;
}> = ({ logoSrc, chip, progress }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: `${progress * 100}%`,
        height: 5,
        background: COLOUR.amber,
      }}
    />
    <div
      style={{
        position: "absolute",
        left: SAFE_X,
        top: 44,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      {logoSrc ? (
        <Img
          src={logoSrc}
          style={{ width: 52, height: 52, borderRadius: 13 }}
        />
      ) : null}
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: 44,
          color: COLOUR.paper,
          letterSpacing: 2,
          lineHeight: 1,
        }}
      >
        PULSE<span style={{ color: COLOUR.amber }}>.</span>
      </div>
      <div
        style={{
          padding: "7px 14px",
          background: COLOUR.amber,
          color: COLOUR.ink,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 20,
          letterSpacing: 2,
          borderRadius: 7,
        }}
      >
        {chip}
      </div>
    </div>
  </AbsoluteFill>
);

const IntroTitle: React.FC<{
  title: string;
  kicker: string;
  criterion: string;
  durationFrames: number;
  spoilers?: boolean;
}> = ({ title, kicker, criterion, durationFrames, spoilers }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inProg = spring({ frame, fps, config: SPRING.ENTER });
  const out = interpolate(
    frame,
    [durationFrames - 18, durationFrames - 2],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const big = title.length > 30;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: out }}>
      <div
        style={{
          position: "absolute",
          left: SAFE_X,
          bottom: 150,
          width: 1400,
          transform: `translateY(${(1 - inProg) * 40}px)`,
          opacity: inProg,
        }}
      >
        {spoilers ? (
          <div
            style={{
              display: "inline-block",
              marginBottom: 22,
              padding: "8px 16px",
              background: "#FF3B3B",
              color: COLOUR.paper,
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 30,
              letterSpacing: 3,
              borderRadius: 8,
            }}
          >
            SPOILERS AHEAD
          </div>
        ) : null}
        <div
          style={{
            width: 120,
            height: 8,
            background: COLOUR.amber,
            marginBottom: 26,
          }}
        />
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: big ? 112 : 136,
            lineHeight: 0.98,
            color: COLOUR.paper,
            textTransform: "uppercase",
            textShadow: "0 10px 50px rgba(0,0,0,0.7)",
          }}
        >
          <TitleLines text={title} />
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 36,
            color: COLOUR.amber,
            letterSpacing: 1,
          }}
        >
          {kicker}
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 28,
            color: COLOUR.muted,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {criterion ? `Criterion · ${criterion}` : ""}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EntryCard: React.FC<{
  rank: number;
  total: number;
  title: string;
  verdict: string;
  year?: string;
  platforms?: string;
  capsuleSrc: string | null;
  durationFrames: number;
  chapter?: string; // documentary: the game, shown in the meta line; the badge reads CHAPTER
}> = ({
  rank,
  total,
  title,
  verdict,
  year,
  platforms,
  capsuleSrc,
  durationFrames,
  chapter,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const badge = spring({ frame, fps, config: SPRING.POP });
  const card = spring({ frame: frame - 5, fps, config: SPRING.ENTER });
  const chip = spring({ frame: frame - 18, fps, config: SPRING.SNAP });
  const collapseAt = Math.min(CARD_HOLD, Math.max(60, durationFrames - 30));
  const collapse = interpolate(frame, [collapseAt, collapseAt + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const top = rank === 1 && chapter === undefined;
  const meta = [chapter, year, platforms].filter(Boolean).join(" · ");
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* The full lower third */}
      <div
        style={{
          position: "absolute",
          left: SAFE_X,
          bottom: SAFE_BOTTOM,
          display: "flex",
          alignItems: "flex-end",
          gap: 28,
          opacity: 1 - collapse,
          transform: `translateY(${collapse * 40}px)`,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 150,
            height: 150,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${badge})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 30,
              background: top ? COLOUR.amber : "rgba(11,11,14,0.85)",
              border: `4px solid ${COLOUR.amber}`,
              boxShadow: top
                ? `0 0 40px ${COLOUR.amber}88`
                : "0 20px 60px rgba(0,0,0,0.5)",
            }}
          />
          <div
            style={{
              position: "relative",
              fontFamily: DISPLAY,
              fontSize: rank >= 10 ? 72 : 92,
              color: top ? COLOUR.ink : COLOUR.paper,
              lineHeight: 1,
            }}
          >
            {rank}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: -32,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: 2,
              color: COLOUR.muted,
            }}
          >
            {chapter !== undefined ? "CHAPTER" : `OF ${total}`}
          </div>
        </div>
        {capsuleSrc ? (
          <div
            style={{
              width: 140,
              height: 210,
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              opacity: card,
              transform: `translateY(${(1 - card) * 20}px)`,
            }}
          >
            <Img
              src={capsuleSrc}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        ) : null}
        <div
          style={{
            maxWidth: 1180,
            opacity: card,
            transform: `translateX(${(1 - card) * 24}px)`,
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: title.length > 24 ? 72 : 92,
              lineHeight: 1,
              color: COLOUR.paper,
              textTransform: "uppercase",
              textShadow: "0 8px 40px rgba(0,0,0,0.7)",
            }}
          >
            <TitleLines text={title} />
          </div>
          {meta ? (
            <div
              style={{
                marginTop: 10,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 26,
                letterSpacing: 2,
                color: COLOUR.muted,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 1180,
              }}
            >
              {meta}
            </div>
          ) : null}
          {verdict ? (
            <div
              style={{
                display: "inline-block",
                marginTop: 14,
                padding: "8px 18px",
                background: COLOUR.amber,
                color: COLOUR.ink,
                fontFamily: BODY,
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: 2.5,
                borderRadius: 8,
                transform: `scale(${chip})`,
                transformOrigin: "left center",
                textTransform: "uppercase",
              }}
            >
              {verdict}
            </div>
          ) : null}
        </div>
      </div>
      {/* The compact tag that stays */}
      <div
        style={{
          position: "absolute",
          left: SAFE_X,
          bottom: SAFE_BOTTOM,
          display: "flex",
          alignItems: "center",
          gap: 14,
          opacity: collapse,
          transform: `translateY(${(1 - collapse) * 30}px)`,
        }}
      >
        <div
          style={{
            padding: "8px 16px",
            background: top ? COLOUR.amber : "rgba(11,11,14,0.8)",
            border: `3px solid ${COLOUR.amber}`,
            borderRadius: 12,
            fontFamily: DISPLAY,
            fontSize: 40,
            color: top ? COLOUR.ink : COLOUR.paper,
            lineHeight: 1,
          }}
        >
          {chapter !== undefined ? `CH ${rank}` : `#${rank}`}
        </div>
        <div
          style={{
            padding: "10px 18px",
            background: "rgba(11,11,14,0.72)",
            borderRadius: 10,
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: 1.5,
            color: COLOUR.paper,
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CalloutCard: React.FC<{
  kind: "quote" | "stat" | "date";
  primary: string;
  secondary: string;
  durationFrames: number;
}> = ({ kind, primary, secondary, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const showFor = Math.min(330, Math.max(60, durationFrames - 12));
  const inProg = spring({ frame: frame - 12, fps, config: SPRING.ENTER });
  const out = interpolate(frame, [showFor - 14, showFor], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (frame > showFor) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: SAFE_X,
          bottom: SAFE_BOTTOM + 96,
          maxWidth: 1180,
          padding: "26px 34px",
          background: "rgba(11,11,14,0.8)",
          borderLeft: `8px solid ${COLOUR.amber}`,
          borderRadius: 14,
          boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
          opacity: inProg * out,
          transform: `translateY(${(1 - inProg) * 30}px)`,
        }}
      >
        {kind === "quote" ? (
          <>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 700,
                fontStyle: "italic",
                fontSize: primary.length > 90 ? 38 : 46,
                lineHeight: 1.25,
                color: COLOUR.paper,
              }}
            >
              {"\u201c"}
              {primary.replace(/^["\u201c]|["\u201d]$/g, "")}
              {"\u201d"}
            </div>
            {secondary ? (
              <div
                style={{
                  marginTop: 14,
                  fontFamily: BODY,
                  fontWeight: 800,
                  fontSize: 26,
                  letterSpacing: 2,
                  color: COLOUR.amber,
                  textTransform: "uppercase",
                }}
              >
                {secondary}
              </div>
            ) : null}
          </>
        ) : kind === "stat" ? (
          <>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: primary.length > 14 ? 92 : 124,
                lineHeight: 1,
                color: COLOUR.amber,
                textTransform: "uppercase",
              }}
            >
              {primary}
            </div>
            <div
              style={{
                marginTop: 10,
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 32,
                letterSpacing: 1.5,
                color: COLOUR.paper,
                textTransform: "uppercase",
              }}
            >
              {secondary}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div
              style={{
                padding: "10px 20px",
                background: COLOUR.amber,
                color: COLOUR.ink,
                borderRadius: 10,
                fontFamily: DISPLAY,
                fontSize: 60,
                lineHeight: 1,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {primary}
            </div>
            <div
              style={{
                fontFamily: BODY,
                fontWeight: 800,
                fontSize: 34,
                color: COLOUR.paper,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {secondary}
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

const OutroCard: React.FC<{
  label: string;
  winner: string;
  onScreen: string;
  tailStart: number;
  durationFrames: number;
  endLine?: string;
}> = ({ label, winner, onScreen, tailStart, durationFrames, endLine }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inProg = spring({ frame, fps, config: SPRING.ENTER });
  const endIn = interpolate(frame, [tailStart, tailStart + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: SAFE_X,
          bottom: SAFE_BOTTOM + 20,
          width: 1200,
          opacity: inProg * (1 - endIn * 0.3),
          transform: `translateY(${(1 - inProg) * 40}px)`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: "8px 18px",
            background: COLOUR.ink,
            border: `3px solid ${COLOUR.amber}`,
            color: COLOUR.paper,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 26,
            letterSpacing: 3,
            borderRadius: 8,
          }}
        >
          {label}
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: DISPLAY,
            fontSize: 108,
            lineHeight: 0.98,
            color: COLOUR.paper,
            textTransform: "uppercase",
            textShadow: "0 10px 50px rgba(0,0,0,0.7)",
          }}
        >
          <TitleLines text={winner} />
        </div>
        <div
          style={{
            marginTop: 16,
            display: "inline-block",
            padding: "12px 22px",
            background: COLOUR.amber,
            color: COLOUR.ink,
            fontFamily: BODY,
            fontWeight: 900,
            fontSize: 34,
            letterSpacing: 1,
            borderRadius: 10,
          }}
        >
          {onScreen}
        </div>
      </div>
      {/* Quiet end card on the right during the tail */}
      <div
        style={{
          position: "absolute",
          right: SAFE_X,
          bottom: SAFE_BOTTOM + 40,
          textAlign: "right",
          opacity: endIn,
          transform: `translateY(${(1 - endIn) * 30}px)`,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 64,
            color: COLOUR.paper,
            letterSpacing: 2,
            lineHeight: 1,
          }}
        >
          PULSE GAMING NEWS<span style={{ color: COLOUR.amber }}>.</span>
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: 28,
            color: COLOUR.muted,
            letterSpacing: 1.5,
            textTransform: "uppercase",
          }}
        >
          {endLine ?? "A new ranking every week · Shorts every day"}
        </div>
      </div>
      {durationFrames > 0 ? null : null}
    </AbsoluteFill>
  );
};

const Credit: React.FC<{ text: string }> = ({ text }) =>
  text ? (
    <div
      style={{
        position: "absolute",
        right: SAFE_X,
        top: 52,
        padding: "6px 12px",
        background: "rgba(11,11,14,0.6)",
        borderRadius: 6,
        fontFamily: BODY,
        fontWeight: 700,
        fontSize: 18,
        letterSpacing: 1.5,
        color: "rgba(245,245,242,0.85)",
        textTransform: "uppercase",
      }}
    >
      {text}
    </div>
  ) : null;

export const Long: React.FC<LongProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const words = props.words.length ? props.words : synthWords(props.segments);
  const plan = useMemo(
    () =>
      props.plan ??
      buildLongPlan({
        segments: props.segments,
        words,
        durationSeconds: props.durationSeconds,
        images: props.images.map((i) => ({
          kind: i.kind,
          aspect: i.aspect,
          beatIndex: i.beatIndex,
        })),
        clips: props.clips.map((c) => ({
          durationSeconds: c.durationSeconds,
          beatIndex: c.beatIndex,
          role: c.role,
          moment: c.moment,
        })),
        variant: props.variant,
        momentCounts: props.moments?.map((m) => m.length),
      }),
    [props, words],
  );
  const windows = useMemo(
    () =>
      props.moments?.length
        ? momentWindows(
            props.segments,
            words,
            props.moments.map((m) => m.length),
          )
        : [],
    [props.moments, props.segments, words],
  );
  const starts = props.segments.map((s, i) =>
    i === 0 ? 0 : Math.round(s.start * fps),
  );
  const ends = props.segments.map((_, i) =>
    i === props.segments.length - 1 ? durationInFrames : starts[i + 1]!,
  );
  const total = props.segments.filter((s) => s.visual?.kind === "rank").length;
  const documentary = props.segments.some((s) => s.visual?.kind === "chapter");
  // A chapter's card runs until the next chapter (or the outro) begins, collapsing to a tag that stays.
  const chapterEnd = (i: number) => {
    for (let k = i + 1; k < props.segments.length; k++) {
      const x = props.segments[k]!;
      if (x.kind !== "beat" || x.visual?.kind === "chapter") return starts[k]!;
    }
    return durationInFrames;
  };
  const lastWordEnd = words.length
    ? Math.round(words[words.length - 1]!.end * fps)
    : durationInFrames - plan.tailFrames;

  const speaking = useMemo(() => {
    const on = new Uint8Array(durationInFrames + 1);
    for (const w of words) {
      const a = Math.max(0, Math.floor((w.start - 0.06) * fps));
      const b = Math.min(durationInFrames, Math.ceil((w.end + 0.3) * fps));
      for (let f = a; f <= b; f++) on[f] = 1;
    }
    return on;
  }, [words, fps, durationInFrames]);
  const musicVolume = (f: number) => {
    const fadeIn = interpolate(f, [0, 24], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const fadeOut = interpolate(
      f,
      [durationInFrames - 60, durationInFrames - 2],
      [1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    let talk = 0;
    for (let k = -2; k <= 2; k++)
      talk += speaking[Math.min(durationInFrames, Math.max(0, f + k))] ?? 0;
    return fadeIn * fadeOut * interpolate(talk / 5, [0, 1], [0.22, 0.07]);
  };
  // The corner names the source of what is on screen: a licensed gameplay clip its creator, else the trailers.
  const creditAt = (f: number) => {
    const shot = plan.shots.find((s) => f >= s.start && f < s.end);
    const clip =
      shot?.media.type === "clip" ? props.clips[shot.media.index] : undefined;
    return clip?.credit ? clip.credit : props.footageCredit;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: COLOUR.ink }}>
      <Backdrop
        plan={plan}
        images={props.images}
        clips={props.clips}
        theme={props.theme}
      />
      <Scrim />
      <GrainVignette />
      <Brand
        logoSrc={resolveSrc(props.logoSrc)}
        chip={props.recap ? "THIS WEEK" : documentary ? "DOCUMENTARY" : total ? `TOP ${total}` : "RANKED"}
        progress={Math.min(1, frame / Math.max(1, durationInFrames))}
      />
      <Credit text={creditAt(frame)} />
      {props.segments.map((s, i) => {
        const len = Math.max(1, ends[i]! - starts[i]!);
        if (s.kind === "hook") {
          return (
            <Sequence
              key={i}
              from={starts[i]!}
              durationInFrames={len}
              layout="none"
            >
              <IntroTitle
                title={props.title}
                spoilers={props.spoilers}
                kicker={props.kicker}
                criterion={props.criterion}
                durationFrames={len}
              />
            </Sequence>
          );
        }
        if (s.kind === "beat" && s.visual?.kind === "rank") {
          const b = entryOf(props.segments, i);
          const capsule =
            props.images.find(
              (im) => im.beatIndex === b && im.kind === "capsule",
            ) ??
            props.images.find((im) => im.beatIndex === b && im.aspect < 0.9);
          return (
            <Sequence
              key={i}
              from={starts[i]!}
              durationInFrames={len}
              layout="none"
            >
              <EntryCard
                rank={s.visual.value_a ?? 0}
                total={total}
                title={s.visual.primary}
                verdict={s.visual.secondary}
                year={s.visual.items?.[0]}
                platforms={s.visual.items?.[1]}
                capsuleSrc={capsule?.src ?? null}
                durationFrames={len}
              />
            </Sequence>
          );
        }
        if (s.kind === "beat" && s.visual?.kind === "chapter") {
          const b = entryOf(props.segments, i);
          const capsule =
            props.images.find(
              (im) => im.beatIndex === b && im.kind === "capsule",
            ) ??
            props.images.find((im) => im.beatIndex === b && im.aspect < 0.9);
          const span = Math.max(1, chapterEnd(i) - starts[i]!);
          return (
            <Sequence
              key={i}
              from={starts[i]!}
              durationInFrames={span}
              layout="none"
            >
              <EntryCard
                rank={s.visual.value_a ?? (b ?? 0) + 1}
                total={0}
                title={s.visual.primary}
                verdict=""
                chapter={s.visual.secondary}
                year={s.visual.items?.[0]}
                platforms={s.visual.items?.[1]}
                capsuleSrc={capsule?.src ?? null}
                durationFrames={span}
              />
            </Sequence>
          );
        }
        if (
          s.kind === "beat" &&
          documentary &&
          (s.visual?.kind === "quote" ||
            s.visual?.kind === "stat" ||
            s.visual?.kind === "date") &&
          s.visual.primary
        ) {
          return (
            <Sequence
              key={i}
              from={starts[i]!}
              durationInFrames={len}
              layout="none"
            >
              <CalloutCard
                kind={s.visual.kind}
                primary={displayText(s.visual.primary)}
                secondary={displayText(s.visual.secondary)}
                durationFrames={len}
              />
            </Sequence>
          );
        }
        if (s.kind === "take") {
          const winner = props.segments
            .filter((x) => x.visual?.kind === "rank")
            .find((x) => x.visual?.value_a === 1);
          return (
            <Sequence
              key={i}
              from={starts[i]!}
              durationInFrames={len}
              layout="none"
            >
              <OutroCard
                label={s.label ?? "OUR PICK"}
                winner={winner?.visual?.primary ?? props.theme}
                onScreen={s.visual?.primary ?? ""}
                tailStart={Math.max(0, lastWordEnd - starts[i]!)}
                durationFrames={len}
                endLine={props.endLine}
              />
            </Sequence>
          );
        }
        return null;
      })}
      {/* Sentence by sentence: the stated fact as a graphic, else a kinetic caption; a pop-in picture over footage. */}
      {windows.map((w, k) => {
        const raw = props.moments?.[w.entry]?.[w.moment];
        if (!raw) return null;
        // A rank graphic repeats the rank card and a fragment ("SERIES AT") reads as a glitch: both are left out.
        const m = {
          ...raw,
          graphic: usefulGraphic(raw.graphic)
            ? raw.graphic
            : { ...raw.graphic, kind: "none" as const },
          emphasis:
            raw.emphasis && usefulEmphasis(raw.emphasis) ? raw.emphasis : "",
        };
        const from = Math.round(w.start * fps);
        const len = Math.max(1, Math.round((w.end - w.start) * fps));
        const shot = plan.shots.find((x) => from >= x.start && from < x.end);
        // A character's portrait first (a reminder of who they are), else the still matched to the sentence.
        const pic =
          props.images.find(
            (im) =>
              im.beatIndex === w.entry &&
              im.moment === w.moment &&
              im.kind === "portrait",
          ) ??
          props.images.find(
            (im) => im.beatIndex === w.entry && im.moment === w.moment,
          );
        const showPop =
          m.graphic.kind === "none" &&
          shot?.media.type === "clip" &&
          pic &&
          w.moment > 0;
        return (
          <Sequence
            key={`m${k}`}
            from={from}
            durationInFrames={len}
            layout="none"
          >
            {m.graphic.kind !== "none" ? (
              <>
                <MomentGraphicCard g={m.graphic} len={len} />
                <Sfx
                  name={
                    m.graphic.kind === "stat" || m.graphic.kind === "score"
                      ? "tick-blip"
                      : "swipe-tonal"
                  }
                  volume={0.22}
                />
              </>
            ) : m.emphasis && w.moment > 0 ? (
              <>
                <KineticCaption text={m.emphasis} len={len} />
                <Sfx name="tick-blip" volume={0.2} />
              </>
            ) : null}
            {showPop ? (
              <Sequence
                from={Math.min(30, Math.max(0, len - 90))}
                layout="none"
              >
                <PopInPicture
                  src={pic!.src}
                  caption={pic!.label ?? ""}
                  len={len - 30}
                  side={w.moment % 2 ? "right" : "left"}
                />
                <Sfx name="whoosh-short" volume={0.24} />
              </Sequence>
            ) : null}
          </Sequence>
        );
      })}
      {/* A white punch as each entry lands. */}
      {props.segments.map((s, i) =>
        s.kind === "beat" &&
        (s.visual?.kind === "rank" || s.visual?.kind === "chapter") &&
        i > 0 ? (
          <Sequence
            key={`f${i}`}
            from={starts[i]!}
            durationInFrames={12}
            layout="none"
          >
            <FlashPunch />
            <Sfx name="punch-deep" volume={0.3} />
          </Sequence>
        ) : null,
      )}
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      {props.musicSrc ? (
        <Audio src={resolveSrc(props.musicSrc)!} volume={musicVolume} loop />
      ) : null}
    </AbsoluteFill>
  );
};
