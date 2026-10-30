// The long-form 16:9 composition: a ranking video of five to seven minutes.
// Full-bleed trailer moments and art on slow moves, a lower-third card for
// each entry that collapses to a tag, an intro title, the pick as the outro
// and a quiet end card. No burned captions: the SRT track carries them.

import {
  BEDS,
  MOOD_BEDS,
  gateLongSounds,
  inKey,
  leadFrames,
  LEVEL,
  SFX,
  type LongSoundCandidate,
} from "./soundscape.ts";

/** Seconds a long video stays on one music bed before changing at the next chapter or entry. */
const MUSIC_SECTION_SECONDS = 150;
/** Frames two beds overlap as one hands over to the next. */
const MUSIC_XFADE = 45;
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
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
  momentKeys,
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
  NameTag,
  PopInPicture,
  QuoteMoment,
  TimelineMoment,
  HeadlineMoment,
  Sfx,
  type MomentProp,
} from "./components/LongMoments.tsx";
import { displayText, type Segment } from "./timeline.ts";
import {
  dropLevel,
  dropOuts,
  musicSections,
  type MusicChapter,
  type Mood,
} from "./musicplan.ts";
import {
  backgroundFor,
  TextureBackground,
  type BackgroundKind,
} from "./components/Backgrounds.tsx";
import {
  AchievementMoment,
  DelayMoment,
  PeopleMoment,
  ReviewsMoment,
  SourceMoment,
  SpanMoment,
  VersusMoment,
  WipeCompare,
} from "./components/DocGraphics.tsx";
import {
  EvidenceBoard,
  Letterbox,
  Montage,
  montageFrames,
  RetroTV,
  TV_HOLD,
  TV_PUSH,
  type BoardPicture,
  type MontageItem,
} from "./components/EditorMoves.tsx";
import { ALL_STYLES } from "./components/packs/index.ts";
import { CAPTION_STYLES } from "./components/Captions.tsx";
import { motifsFor } from "./components/motifs/index.ts";
import type { Motif } from "./components/motifs/types.ts";
import {
  ArcadeCabinet,
  ChannelStatic,
  CrtLook,
  DEVICE_FRAMES,
  deviceFor,
  Handheld,
  handheldGreen,
  OLD_YEAR,
  PowerOff,
  RetroMonitor,
  STATIC_FRAMES,
  VcrTV,
  VhsLook,
  type Device,
} from "./components/Retro.tsx";
import { NAMETAG_STYLES } from "./components/NameTags.tsx";
import {
  MaskInterlude,
  SlateInterlude,
  TornInterlude,
  VhsInterlude,
} from "./components/Interludes.tsx";
import {
  ACCENT_FRAMES,
  ACCENT_LEAD,
  ACCENTS,
  CutAccent,
  POPIN_STYLES,
  type AccentKind,
} from "./components/Accents.tsx";
import type { GfxStyle } from "./components/packs/types.ts";
import type { Word } from "../voice/elevenlabs.ts";

export interface LongImageProp {
  src: string;
  kind: string;
  aspect: number;
  beatIndex?: number;
  credit?: string; // archive photos: author / licence / source, shown on screen
  moment?: number;
  label?: string;
  /** 2.5D layers (src/render/parallax.ts): drifted at different speeds so the still moves like footage. */
  layers?: { bg: string; mid: string; fg: string };
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
  breaks?: Array<{ start: number; end: number }>; // a documentary's breathers before each chapter (seconds)
  quietBreaks?: number[]; // breathers the graphics check faulted: the plain title card instead
  palette?: Array<string | null>; // each entry's own colour from its key art: its footage is washed in it
  /** Zoom to the detail: the sentence, the picture on screen and where the named thing sits (0-1). */
  annotations?: Array<{
    entry: number;
    moment: number;
    image: number;
    box: [number, number, number, number];
    label: string;
  }>;
  segments: Segment[];
  words: Word[];
  images: LongImageProp[];
  clips: LongClipProp[];
  plan: LongPlan | null;
  logoSrc: string | null;
  audioSrc: string | null;
  musicSrc: string | null;
  /** Epidemic Sound beds in this bundle (house or a mood), alongside the generated ones. */
  extraBeds?: Array<{ file: string; key: "D" | "E"; mood: string }>;
  durationSeconds: number;
  variant: number;
  renderDate: string;
};

const resolveSrc = (src: string | null) =>
  src && !/^(https?:|data:|blob:)/.test(src) ? staticFile(src) : src;
const CROP = 1.12; // trims letterbox bars and burned-in subtitles from trailer clips
const SAFE_X = 96;
const SAFE_BOTTOM = 72;
/** The flash-forward: at most this many graphics, each up for this many frames. */
const TEASE_ITEMS = 4;
const TEASE_FRAMES = 42;
const FLASH_FORWARD = false;
const INTRO_TITLE_FRAMES = 180;

/** One cut of the flash-forward: the graphic punched in, a COMING UP tag, a flash into the next. */
const TeaseCut: React.FC<{ children: React.ReactNode; last: boolean }> = ({
  children,
  last,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, TEASE_FRAMES], [1.06, 1.0], clamp);
  const flash = interpolate(frame, [0, 3], [0.55, 0], clamp);
  const out = last
    ? interpolate(frame, [TEASE_FRAMES - 8, TEASE_FRAMES], [1, 0], clamp)
    : 1;
  return (
    <AbsoluteFill style={{ background: COLOUR.ink, opacity: out }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        {children}
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: SAFE_X,
          top: 130,
          padding: "8px 18px",
          background: COLOUR.amber,
          color: COLOUR.ink,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 26,
          letterSpacing: 4,
          borderRadius: 6,
        }}
      >
        COMING UP
      </div>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </AbsoluteFill>
  );
};

/** Frames the video's motif title card opens the video for, before the usual title. */
const MOTIF_OPEN = 150;
/** The hardware an old game's opening shot plays on (src/render/components/Retro.tsx). */
type OldDevice = { device: Device | "tv"; label: string; green: boolean };
/** How far a punch-in jumps: a tenth closer, the editor's cut-in on a key word. */
const PUNCH = 1.1;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
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

/** A point of a picture (0-1 of the picture) on the 1920x1080 frame when the picture covers it. */
export function coverPoint(
  aspect: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const F = 1920 / 1080;
  if (aspect > F) {
    const w = aspect * 1080;
    return { x: (x * w - (w - 1920) / 2) / 1920, y };
  }
  const h = 1920 / aspect;
  return { x, y: (y * h - (h - 1080) / 2) / 1080 };
}

/** The zoom that brings a box to about two fifths of the frame's height, between 1 and 1.7. */
export function focusZoom(box: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): number {
  const h = Math.max(0.01, box.y2 - box.y1);
  const w = Math.max(0.01, box.x2 - box.x1);
  return Math.max(1, Math.min(1.7, 0.42 / (h * 1.04), 0.6 / (w * 1.04)));
}

const FOCUS_FRAMES = 26;
const focusEase = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

const Still: React.FC<{
  src: string;
  aspect: number;
  durationFrames: number;
  move: MovePreset;
  fromBlack?: boolean;
  /** An archive photo: a framed print over its own blurred copy, the way video essays show real photos. */
  print?: boolean;
  tilt?: number;
  /** 2.5D layers: each drifts at its own speed, nearer faster, so the still reads as a camera move. */
  layers?: { bg: string; mid: string; fg: string };
  dir?: number; // 1 or -1: which way the camera trucks
  /** Zoom to the detail: from frame `at` the camera pushes in on `origin` (frame fractions) to `zoom`. */
  focus?: { at: number; origin: { x: number; y: number }; zoom: number };
  /** A punch-in: from this frame the picture jumps a tenth closer, on the narrator's key word. */
  punchAt?: number;
}> = ({
  src,
  aspect,
  durationFrames,
  move,
  fromBlack = false,
  print = false,
  tilt = 0,
  layers,
  dir = 1,
  focus,
  punchAt,
}) => {
  const frame = useCurrentFrame();
  const punch =
    punchAt === undefined
      ? 1
      : interpolate(frame, [punchAt, punchAt + 2], [1, PUNCH], clamp);
  const m = moveTransform(
    move,
    Math.min(1, frame / Math.max(1, durationFrames)),
  );
  const fade = interpolate(frame, [0, 10], [fromBlack ? 0 : 1, 1], {
    extrapolateRight: "clamp",
  });
  if (focus && !print && aspect >= 0.9) {
    // Held still, then a push in on the named detail; its label draws on over it (DetailCallout).
    const z = interpolate(
      frame,
      [focus.at, focus.at + FOCUS_FRAMES],
      [1, focus.zoom],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: focusEase,
      },
    );
    return (
      <AbsoluteFill style={{ overflow: "hidden", opacity: fade }}>
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "contrast(1.03) saturate(1.05)",
            transformOrigin: `${focus.origin.x * 100}% ${focus.origin.y * 100}%`,
            transform: `scale(${1.04 * z})`,
          }}
        />
      </AbsoluteFill>
    );
  }
  if (layers && !print && aspect >= 0.9) {
    // The camera trucks sideways and pushes in a touch; the middle moves half again as far as the
    // background and the foreground twice as far, the 2.5D look of video essays.
    const p = Math.min(1, frame / Math.max(1, durationFrames));
    const truck = (p - 0.5) * 34 * dir;
    // A rack focus, like a cinema lens: the background softens behind the subject, or (the other way)
    // the shot opens soft and pulls into focus.
    const t = Math.max(0, Math.min(1, (p - 0.12) / 0.6));
    const eased = t * t * (3 - 2 * t);
    const pull = dir > 0 ? eased : 1 - eased;
    const layer = (layerSrc: string, k: number, key: string) => (
      <Img
        key={key}
        src={layerSrc}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: `contrast(1.03) saturate(1.05) blur(${(k === 0 ? 5 : k < 1 ? 2.2 : 0) * pull}px)`,
          transform: `scale(${(m.scale + 0.06 + 0.035 * k * p) * punch}) translate(${m.x * (1 + k) + truck * k}px, ${m.y * (1 + k * 0.6)}px)`,
        }}
      />
    );
    return (
      <AbsoluteFill style={{ overflow: "hidden", opacity: fade }}>
        {layer(layers.bg, 0, "bg")}
        {layer(layers.mid, 0.6, "mid")}
        {layer(layers.fg, 1.4, "fg")}
      </AbsoluteFill>
    );
  }
  if (print) {
    const w = aspect >= 1 ? 1240 : 1240 * aspect * 0.75;
    return (
      <AbsoluteFill style={{ overflow: "hidden", opacity: fade }}>
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(36px) brightness(0.4) saturate(1.1)",
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
            transform: `translate(-50%, -50%) rotate(${tilt}deg) scale(${m.scale - 0.04})`,
          }}
        >
          <Img
            src={src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "contrast(1.04) saturate(0.92)",
            }}
          />
        </div>
      </AbsoluteFill>
    );
  }
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
          transform: `scale(${(m.scale + 0.04) * punch}) translate(${m.x}px, ${m.y}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Clip: React.FC<{
  src: string;
  audio?: boolean;
  frames?: number;
  punchAt?: number;
}> = ({ src, audio, frames, punchAt }) => {
  const frame = useCurrentFrame();
  const punch =
    punchAt === undefined
      ? 1
      : interpolate(frame, [punchAt, punchAt + 2], [1, PUNCH], clamp);
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
          transform: `scale(${CROP * punch})`,
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

/**
 * The detail's label (Game Maker's Toolkit style): once the camera has pushed in, an amber box draws itself
 * round the thing, and a leader line runs out to its name. Positions follow the zoom exactly.
 */
const DetailCallout: React.FC<{
  box: { x1: number; y1: number; x2: number; y2: number };
  origin: { x: number; y: number };
  zoom: number;
  label: string;
  len: number;
}> = ({ box, origin, zoom, label, len }) => {
  const frame = useCurrentFrame();
  const z =
    1.04 *
    interpolate(frame, [0, FOCUS_FRAMES], [1, zoom], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: focusEase,
    });
  const map = (x: number, y: number) => ({
    x: (origin.x + (x - origin.x) * z) * 1920,
    y: (origin.y + (y - origin.y) * z) * 1080,
  });
  const a = map(box.x1, box.y1);
  const b = map(box.x2, box.y2);
  const pad = 12;
  const x = a.x - pad;
  const y = a.y - pad;
  const w = b.x - a.x + pad * 2;
  const h = b.y - a.y + pad * 2;
  const perim = 2 * (w + h);
  const draw = interpolate(
    frame,
    [FOCUS_FRAMES - 4, FOCUS_FRAMES + 14],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const line = interpolate(
    frame,
    [FOCUS_FRAMES + 10, FOCUS_FRAMES + 22],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const tag = interpolate(
    frame,
    [FOCUS_FRAMES + 18, FOCUS_FRAMES + 28],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const out = interpolate(frame, [len - 12, len - 2], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const right = (x + w / 2) / 1920 < 0.55;
  const cy = Math.max(140, Math.min(940, y + h / 2));
  const lx0 = right ? x + w : x;
  const lx1 = right
    ? Math.min(1920 - 420, lx0 + 120)
    : Math.max(420, lx0 - 120);
  if (frame > len) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: out }}>
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", inset: 0 }}
      >
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={14}
          fill="none"
          stroke={COLOUR.amber}
          strokeWidth={6}
          strokeDasharray={perim}
          strokeDashoffset={perim * (1 - draw)}
          style={{ filter: "drop-shadow(0 0 10px rgba(0,0,0,0.8))" }}
        />
        <line
          x1={lx0}
          y1={cy}
          x2={lx0 + (lx1 - lx0) * line}
          y2={cy}
          stroke={COLOUR.amber}
          strokeWidth={5}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: cy - 30,
          [right ? "left" : "right"]: right ? lx1 + 6 : 1920 - lx1 + 6,
          opacity: tag,
          transform: `translateX(${(1 - tag) * (right ? -20 : 20)}px)`,
          padding: "12px 20px",
          background: "rgba(11,11,14,0.9)",
          border: `3px solid ${COLOUR.amber}`,
          borderRadius: 10,
          fontFamily: BODY,
          fontWeight: 900,
          fontSize: 30,
          letterSpacing: 2,
          color: COLOUR.paper,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {displayText(label)}
      </div>
    </AbsoluteFill>
  );
};

/**
 * How a chapter or entry arrives (top channels' signature transitions): a warm light sweep, a film-burn
 * bloom, or a short digital glitch, chosen by the game's era so the 1990s chapters feel of their time.
 */
type TransitionKind = "sweep" | "burn" | "glitch";
export function transitionFor(
  year: number | undefined,
  i: number,
  variant: number,
): TransitionKind {
  if (year && year < 2000) return "glitch";
  if (year && year < 2010) return "burn";
  if (year) return "sweep";
  return (["sweep", "burn", "glitch"] as const)[(i + variant) % 3]!;
}

const ChapterTransition: React.FC<{ kind: TransitionKind }> = ({ kind }) => {
  const frame = useCurrentFrame();
  if (kind === "sweep") {
    const x = interpolate(frame, [0, 16], [-40, 140], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const o = interpolate(frame, [0, 3, 14, 21], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return (
      <AbsoluteFill
        style={{ pointerEvents: "none", opacity: o, mixBlendMode: "screen" }}
      >
        <AbsoluteFill
          style={{
            background: `linear-gradient(105deg, transparent ${x - 22}%, rgba(255,170,90,0.55) ${x - 6}%, rgba(255,245,225,0.95) ${x}%, rgba(255,170,90,0.55) ${x + 6}%, transparent ${x + 22}%)`,
          }}
        />
      </AbsoluteFill>
    );
  }
  if (kind === "burn") {
    const o = interpolate(frame, [0, 3, 10, 21], [0, 0.95, 0.6, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const r = interpolate(frame, [0, 21], [30, 120]);
    return (
      <AbsoluteFill
        style={{ pointerEvents: "none", opacity: o, mixBlendMode: "screen" }}
      >
        <AbsoluteFill
          style={{
            background: `radial-gradient(${r}% ${r * 0.8}% at 30% 40%, rgba(255,230,190,1) 0%, rgba(255,140,40,0.85) 35%, rgba(160,40,10,0.4) 65%, transparent 85%)`,
          }}
        />
      </AbsoluteFill>
    );
  }
  // glitch: colour-split bars stuttering across the frame for a few frames
  if (frame > 12) return null;
  const rows = Array.from({ length: 9 }, (_, k) => {
    const seed = Math.sin((frame + 1) * 12.9898 + k * 78.233) * 43758.5453;
    const r = seed - Math.floor(seed);
    return {
      top: (k * 11 + r * 9) % 100,
      h: 2 + r * 9,
      shift: (r - 0.5) * 160,
      on: r > 0.35,
    };
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {rows
        .filter((x) => x.on)
        .map((x, k) => (
          <div
            key={k}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${x.top}%`,
              height: `${x.h}%`,
              transform: `translateX(${x.shift}px)`,
              background:
                k % 2 ? "rgba(255,40,80,0.35)" : "rgba(40,200,255,0.35)",
              mixBlendMode: "screen",
            }}
          />
        ))}
      <AbsoluteFill
        style={{
          background: "rgba(255,255,255,0.12)",
          opacity: frame < 3 ? 1 : 0,
        }}
      />
    </AbsoluteFill>
  );
};

/** A picture's label at the lower right, fading in after the cut and out before the next. */
const Descriptor: React.FC<{
  text: string;
  frames: number;
  delay?: number;
}> = ({ text, frames, delay = 0 }) => {
  const frame = useCurrentFrame();
  const o = interpolate(
    frame,
    [
      14 + delay,
      26 + delay,
      Math.max(27 + delay, frames - 14),
      Math.max(28 + delay, frames - 4),
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  if (frames - delay < 75) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 96,
        bottom: 64,
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: o * 0.92,
        fontFamily: BODY,
        fontWeight: 800,
        fontSize: 20,
        letterSpacing: 2.5,
        color: "rgba(245,245,242,0.9)",
        textTransform: "uppercase",
        textShadow: "0 2px 12px rgba(0,0,0,0.8)",
      }}
    >
      <span
        style={{
          width: 22,
          height: 3,
          background: COLOUR.amber,
          borderRadius: 2,
        }}
      />
      {text}
    </div>
  );
};

/** The label of the shot on screen, above the scrim so it reads. */
const ShotLabel: React.FC<{
  plan: LongPlan;
  describe: (media: { type: string; index: number }) => string;
  /** Opening bursts (frames): a shot that starts under one is labelled once it has played. */
  bursts?: Array<{ from: number; to: number }>;
}> = ({ plan, describe, bursts = [] }) => {
  const frame = useCurrentFrame();
  const shot = plan.shots.find((x) => frame >= x.start && frame < x.end);
  if (!shot) return null;
  const text = describe(shot.media);
  if (!text) return null;
  return (
    <Sequence
      from={shot.start}
      durationInFrames={Math.max(1, shot.end - shot.start)}
      layout="none"
    >
      <Descriptor
        text={text}
        frames={shot.end - shot.start}
        delay={Math.max(
          0,
          ...bursts
            .filter((b) => shot.start >= b.from - 2 && shot.start < b.to)
            .map((b) => b.to - shot.start),
        )}
      />
    </Sequence>
  );
};

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
  /** What a shot is, as video essays label their pictures: "GRAND THEFT AUTO V · 2013 · KEY ART". */
  describe?: (media: { type: string; index: number }) => string;
  /** Per shot index: when (absolute frame) and where the camera pushes in on a named detail. */
  focusFor?: Map<
    number,
    { from: number; origin: { x: number; y: number }; zoom: number }
  >;
  /** Shots of an old game opening on the hardware of its day before the camera pushes through the glass. */
  retro?: Map<number, OldDevice>;
  /** Shots of an old game worn as a VHS tape or a CRT picture. */
  looks?: Map<number, "vhs" | "crt">;
  /** An old game's last shot, switching off the way a tube did. */
  powerOff?: Set<number>;
  /** Per shot index: the absolute frame of its punch-in. */
  punches?: Map<number, number>;
  /** Per shot index: its game's own colour, washed softly over the picture. */
  tints?: Map<number, string>;
}> = ({
  plan,
  images,
  clips,
  theme,
  describe,
  focusFor,
  retro,
  looks,
  powerOff,
  punches,
  tints,
}) => (
  <AbsoluteFill style={{ backgroundColor: COLOUR.ink }}>
    {plan.shots.map((s, i) => {
      const len = Math.max(1, s.end - s.start);
      const img = s.media.type === "image" ? images[s.media.index] : undefined;
      const clip = s.media.type === "clip" ? clips[s.media.index] : undefined;
      // A still dissolves in over the shot before, except after a tube switching off (it cuts from black).
      const xf = powerOff?.has(i - 1) ? 0 : Math.min(XFADE, s.start);
      const seqLen = img && i > 0 ? len + xf : len;
      const dev = retro?.get(i);
      // An old game's dressing: its period look, the hardware it opens on, the tube switching off.
      const dress = (node: React.ReactNode) => {
        let out = node;
        const look = looks?.get(i);
        if (look === "vhs") out = <VhsLook seed={i}>{out}</VhsLook>;
        else if (look === "crt") out = <CrtLook>{out}</CrtLook>;
        if (dev)
          out =
            dev.device === "vcr" ? (
              <VcrTV label={dev.label}>{out}</VcrTV>
            ) : dev.device === "arcade" ? (
              <ArcadeCabinet label={dev.label}>{out}</ArcadeCabinet>
            ) : dev.device === "monitor" ? (
              <RetroMonitor>{out}</RetroMonitor>
            ) : dev.device === "handheld" ? (
              <Handheld green={dev.green}>{out}</Handheld>
            ) : (
              <RetroTV>{out}</RetroTV>
            );
        const tint = tints?.get(i);
        if (tint)
          out = (
            <>
              {out}
              <AbsoluteFill
                style={{
                  background: tint,
                  mixBlendMode: "soft-light",
                  opacity: 0.28,
                  pointerEvents: "none",
                }}
              />
            </>
          );
        if (powerOff?.has(i)) out = <PowerOff frames={seqLen}>{out}</PowerOff>;
        return out;
      };
      return (
        <Sequence
          key={i}
          from={img && i > 0 ? s.start - xf : s.start}
          durationInFrames={img && i > 0 ? len + xf : len}
          layout="none"
        >
          {clip ? (
            dress(
              <Clip
                src={clip.src}
                audio={clip.audio}
                frames={len}
                punchAt={
                  !dev && punches?.has(i)
                    ? punches.get(i)! - s.start
                    : undefined
                }
              />,
            )
          ) : img ? (
            <>
              <FadeIn frames={i > 0 ? xf : 0}>
                {dev
                  ? dress(
                      <Still
                        src={img.src}
                        aspect={img.aspect}
                        durationFrames={len + (i > 0 ? xf : 0)}
                        move={s.move}
                      />,
                    )
                  : dress(
                      <Still
                        punchAt={
                          punches?.has(i)
                            ? punches.get(i)! - (i > 0 ? s.start - xf : s.start)
                            : undefined
                        }
                        print={img.kind === "photo"}
                        tilt={((s.media.index * 37) % 5) - 2}
                        layers={img.layers}
                        dir={i % 2 ? -1 : 1}
                        focus={
                          focusFor?.get(i)
                            ? {
                                at:
                                  focusFor.get(i)!.from -
                                  (i > 0 ? s.start - xf : s.start),
                                origin: focusFor.get(i)!.origin,
                                zoom: focusFor.get(i)!.zoom,
                              }
                            : undefined
                        }
                        src={img.src}
                        aspect={img.aspect}
                        durationFrames={len + (i > 0 ? xf : 0)}
                        move={s.move}
                        fromBlack={i === 0}
                      />,
                    )}
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
  /** Where each chapter or entry starts (0-1): the bar splits into segments so viewers see how far through they are. */
  marks?: number[];
}> = ({ logoSrc, chip, progress, marks }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {marks && marks.length > 1 ? (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 6,
          display: "flex",
          gap: 4,
        }}
      >
        {[0, ...marks, 1].slice(0, -1).map((a, i, arr) => {
          const b = i + 1 < arr.length ? arr[i + 1]! : 1;
          const fill = Math.max(
            0,
            Math.min(1, (progress - a) / Math.max(1e-6, b - a)),
          );
          return (
            <div
              key={i}
              style={{
                flex: b - a,
                height: 6,
                background: "rgba(245,245,242,0.18)",
              }}
            >
              <div
                style={{
                  width: `${fill * 100}%`,
                  height: 6,
                  background: COLOUR.amber,
                }}
              />
            </div>
          );
        })}
      </div>
    ) : (
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
    )}
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

/**
 * A documentary's breather before a chapter: the narrator is silent, the music lifts, and the chapter
 * arrives full screen (its number, its title, the game and year, and a line from the chapter if it has
 * a quote) over its first picture, then clears for the narration.
 */
const ChapterInterlude: React.FC<{
  number: number;
  title: string;
  game: string;
  year?: string;
  quote?: { text: string; who: string };
  frames: number;
  bg?: BackgroundKind;
  variant?: number;
}> = ({ number, title, game, year, quote, frames, bg, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [frames - 12, frames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dim =
    interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" }) * out;
  const label = spring({ frame: frame - 4, fps, config: SPRING.ENTER });
  const head = spring({ frame: frame - 10, fps, config: SPRING.ENTER });
  const sweep = interpolate(frame, [28, 62], [-20, 125], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const sub = spring({ frame: frame - 22, fps, config: SPRING.ENTER });
  const rule = interpolate(frame, [8, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (x) => 1 - (1 - x) ** 3,
  });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {bg ? (
        <AbsoluteFill style={{ opacity: dim }}>
          <TextureBackground kind={bg} variant={variant} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(90% 80% at 50% 50%, rgba(11,11,14,${0.45 * dim}) 0%, rgba(11,11,14,${0.85 * dim}) 100%)`,
          }}
        />
      )}
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", opacity: out }}
      >
        <div style={{ textAlign: "center", maxWidth: 1500 }}>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 900,
              fontSize: 30,
              letterSpacing: 8,
              color: COLOUR.amber,
              opacity: label,
              transform: `translateY(${(1 - label) * 20}px)`,
            }}
          >
            CHAPTER {number}
          </div>
          <div
            style={{
              margin: "22px auto 0",
              height: 5,
              width: 220 * rule,
              background: COLOUR.amber,
              borderRadius: 3,
            }}
          />
          {/* The title rises up through a mask, then a warm light sweeps across its letters. */}
          <div
            style={{ marginTop: 26, overflow: "hidden", padding: "0 10px 8px" }}
          >
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: title.length > 26 ? 110 : 140,
                lineHeight: 0.98,
                textTransform: "uppercase",
                transform: `translateY(${(1 - head) * 105}%)`,
                backgroundImage: `linear-gradient(100deg, ${COLOUR.paper} 0%, ${COLOUR.paper} ${sweep - 12}%, #fff3d6 ${sweep - 3}%, #ffffff ${sweep}%, #ffd9a8 ${sweep + 3}%, ${COLOUR.paper} ${sweep + 12}%, ${COLOUR.paper} 100%)`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                filter: "drop-shadow(0 12px 40px rgba(0,0,0,0.65))",
              }}
            >
              {title}
            </div>
          </div>
          <div
            style={{
              marginTop: 22,
              fontFamily: BODY,
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: 3,
              color: "rgba(245,245,242,0.8)",
              textTransform: "uppercase",
              opacity: sub,
            }}
          >
            {[game, year].filter(Boolean).join(" · ")}
          </div>
          {quote ? (
            <div
              style={{
                marginTop: 40,
                fontFamily: BODY,
                fontWeight: 700,
                fontStyle: "italic",
                fontSize: 34,
                lineHeight: 1.3,
                color: COLOUR.paper,
                opacity: interpolate(frame, [30, 46], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {"“"}
              {quote.text}
              {"”"}
              <span
                style={{
                  fontStyle: "normal",
                  fontWeight: 900,
                  fontSize: 24,
                  letterSpacing: 2,
                  color: COLOUR.amber,
                  marginLeft: 16,
                  textTransform: "uppercase",
                }}
              >
                {quote.who}
              </span>
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
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
        momentKeys: props.moments?.map((e) => e.map(momentKeys)),
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
            props.moments.map((e) => e.map(momentKeys)),
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
    // In a documentary's breather the music comes up to carry the pause, easing in and out.
    const lift = Math.max(
      0,
      ...breakFrames.map((b) =>
        interpolate(
          f,
          [b.from, b.from + 15, b.to - 12, b.to + 6],
          [0, 1, 1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        ),
      ),
    );
    return (
      fadeIn *
      fadeOut *
      Math.max(interpolate(talk / 5, [0, 1], [0.22, 0.07]), 0.42 * lift)
    );
  };
  // The music changes bed at the first chapter or entry after MUSIC_SECTION_SECONDS on one bed: a 30-minute
  // documentary looped a single two-minute bed fifteen times (owner, 27 Oct 2026).
  const moodBeds = (m: Mood) => [
    ...MOOD_BEDS[m].map((b) => b.file),
    ...(props.extraBeds ?? []).filter((b) => b.mood === m).map((b) => b.file),
  ];
  const beds = useMemo(() => {
    if (!props.musicSrc)
      return [] as Array<{ from: number; to: number; src: string }>;
    const first = BEDS.findIndex((b) => b.file === props.musicSrc);
    if (first < 0)
      return [{ from: 0, to: durationInFrames, src: props.musicSrc }];
    // Each chapter or entry: where it opens, its narration and its game's year (src/render/musicplan.ts
    // gives each a mood; a mood bed plays its chapters, the house beds rotate through the rest).
    const opens = props.segments
      .map((s, i) =>
        s.kind === "beat" &&
        (s.visual?.kind === "rank" || s.visual?.kind === "chapter") &&
        i > 0
          ? i
          : -1,
      )
      .filter((i) => i > 0);
    const chapters: MusicChapter[] = opens.map((i, n) => ({
      frame: starts[i]!,
      text: props.segments
        .slice(i, opens[n + 1] ?? props.segments.length)
        .map((x) => x.text)
        .join(" "),
      year: Number(props.segments[i]!.visual?.items?.[0]) || undefined,
    }));
    const sections = musicSections(
      chapters,
      durationInFrames,
      documentary,
      45 * fps,
      MUSIC_SECTION_SECONDS * fps,
      (m) => moodBeds(m).length > 0,
    );
    // The house list: the generated beds, then the Epidemic ones, starting from the video's own bed.
    const house = [
      ...BEDS.map((b) => b.file),
      ...(props.extraBeds ?? [])
        .filter((b) => b.mood === "house")
        .map((b) => b.file),
    ];
    let k = first;
    const turn: Record<string, number> = {};
    return sections.map((sec) => {
      if (sec.mood) {
        const list = moodBeds(sec.mood);
        const n = turn[sec.mood] ?? 0;
        turn[sec.mood] = n + 1;
        // Rotated by the video's variant too, so two videos rarely share a mood's bed.
        return {
          from: sec.from,
          to: sec.to,
          src: list[(n + props.variant) % list.length]!,
        };
      }
      return { from: sec.from, to: sec.to, src: house[k++ % house.length]! };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.musicSrc, props.segments, props.extraBeds, durationInFrames, fps]);
  // A documentary's breathers: the chapter segment that opens on one, and the frames it lasts.
  const breakFrames = (props.breaks ?? []).map((b) => ({
    from: Math.round(b.start * fps),
    to: Math.round(b.end * fps),
  }));
  const breakAt = (i: number) => {
    const b = breakFrames.find((x) => Math.abs(x.from - starts[i]!) <= 3);
    return b ? Math.max(0, b.to - b.from) : 0;
  };
  // The richer explainers (src/render/components/DocGraphics.tsx). A "versus" shows two of the video's own
  // games from their chapters' pictures; a "people" card uses a portrait when one carries the name.
  const normTitle = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const gameArt = (title: string) => {
    const k = props.segments.findIndex(
      (x) =>
        x.kind === "beat" &&
        (x.visual?.kind === "chapter" || x.visual?.kind === "rank") &&
        normTitle(x.visual?.secondary ?? "") === normTitle(title),
    );
    const byPrimary =
      k >= 0
        ? k
        : props.segments.findIndex(
            (x) =>
              x.kind === "beat" &&
              x.visual?.kind === "rank" &&
              normTitle(x.visual?.primary ?? "") === normTitle(title),
          );
    if (byPrimary < 0) return undefined;
    const e = entryOf(props.segments, byPrimary);
    const im = props.images.find(
      (i) =>
        i.beatIndex === e &&
        i.aspect >= 1.2 &&
        i.kind !== "capsule" &&
        i.kind !== "portrait",
    );
    const year = props.segments[byPrimary]!.visual?.items?.[0];
    return im
      ? {
          src: im.src,
          label: [displayText(title), year].filter(Boolean).join(" · "),
        }
      : undefined;
  };
  const portraits = Object.fromEntries(
    props.images
      .filter((i) => (i.kind === "portrait" || i.kind === "photo") && i.label)
      .map((i) => [i.label!.toLowerCase(), i.src]),
  );
  const richGraphic = (
    g: NonNullable<LongProps["moments"]>[number][number]["graphic"],
    len: number,
    bg?: BackgroundKind,
    variant?: number,
  ) => {
    switch (g.kind) {
      case "delay":
        return <DelayMoment g={g} len={len} bg={bg} variant={variant} />;
      case "span":
        return <SpanMoment g={g} len={len} bg={bg} variant={variant} />;
      case "reviews":
        return <ReviewsMoment g={g} len={len} bg={bg} variant={variant} />;
      case "source":
        return <SourceMoment g={g} len={len} bg={bg} variant={variant} />;
      case "milestone":
        return <AchievementMoment g={g} len={len} />;
      case "people":
        return (
          <PeopleMoment
            g={g}
            len={len}
            photos={portraits}
            bg={bg}
            variant={variant}
          />
        );
      case "versus":
        // Two looks taken in turn: the split card and the remaster-style wipe.
        return React.createElement(
          (variant ?? 0) % 2 ? WipeCompare : VersusMoment,
          {
            len,
            heading: displayText(g.primary),
            left: gameArt(g.items[0] ?? ""),
            right: gameArt(g.items[1] ?? ""),
          },
        );
      default:
        return null;
    }
  };
  // Each picture's label, as video essays label theirs (Ahoy): the game, its year and what the picture is.
  // Archive photos carry their own credit and licensed footage its creator's, so they get none.
  const entryTitle = (e: number | undefined) => {
    if (e === undefined)
      return {
        title: props.recap ? "" : props.theme,
        year: undefined as string | undefined,
      };
    const k = props.segments.findIndex(
      (x, i) =>
        x.kind === "beat" &&
        (x.visual?.kind === "chapter" || x.visual?.kind === "rank") &&
        entryOf(props.segments, i) === e,
    );
    const v = k >= 0 ? props.segments[k]!.visual : undefined;
    return {
      title: (v?.kind === "rank" ? v.primary : v?.secondary) ?? "",
      year: v?.items?.[0],
    };
  };
  const KIND_WORD: Record<string, string> = {
    hero: "Key art",
    header: "Key art",
    capsule: "Box art",
    screenshot: "Screenshot",
    article: "Press image",
  };
  const describe = (media: { type: string; index: number }) => {
    if (media.type === "image") {
      const im = props.images[media.index];
      const word = im ? KIND_WORD[im.kind] : undefined;
      if (!im || !word) return "";
      const t = entryTitle(im.beatIndex);
      return [t.title, t.year, word]
        .filter(Boolean)
        .map((x) => displayText(String(x)))
        .join(" · ");
    }
    if (media.type === "clip") {
      const c = props.clips[media.index];
      if (!c || c.credit) return "";
      const t = entryTitle(c.beatIndex);
      return t.title
        ? [t.title, t.year, "Trailer"]
            .filter(Boolean)
            .map((x) => displayText(String(x)))
            .join(" · ")
        : "";
    }
    return "";
  };
  // A person's name tag the first time a chapter turns to them; the role from a who's-who card when there is one.
  const roles = new Map<string, string>();
  for (const e of props.moments ?? [])
    for (const m of e)
      if (m.graphic.kind === "people")
        for (const it of m.graphic.items) {
          const i = it.indexOf(":");
          if (i > 0)
            roles.set(
              it.slice(0, i).trim().toLowerCase(),
              it.slice(i + 1).trim(),
            );
        }
  const firstMention = new Set<string>();
  // Name tags take their looks in turn, by the order people first appear.
  const firstMentionOrder = new Map<string, number>();
  const tagged = new Set<string>();
  for (const w of windows) {
    const p = props.moments?.[w.entry]?.[w.moment]?.person?.trim();
    if (!p || w.moment === 0) continue;
    const key = `${w.entry}|${p.toLowerCase()}`;
    if (tagged.has(key)) continue;
    tagged.add(key);
    firstMention.add(`${w.entry}|${w.moment}`);
    firstMentionOrder.set(
      `${w.entry}|${w.moment}`,
      firstMentionOrder.size + props.variant,
    );
  }
  const bedAt = (f: number) =>
    beds.find((b) => f >= b.from && f < b.to)?.src ?? props.musicSrc;
  // Each sentence's graphic, caption or picture lands a beat before the narrator names it and holds until
  // the next sentence's lands, and for as long as it takes to read (owner, 30 Oct 2026: cards and captions
  // vanished before they could be taken in): 2.5 s plus 0.3 s a word and 0.5 s a row, up to 7 s, as long
  // as nothing else is drawn for that entry in the meantime.
  const drawn = (entry: number, moment: number): boolean => {
    const r = props.moments?.[entry]?.[moment];
    return !!r && (usefulGraphic(r.graphic) || (!!r.emphasis && usefulEmphasis(r.emphasis)));
  };
  const readSeconds = (entry: number, moment: number): number => {
    const r = props.moments?.[entry]?.[moment];
    if (!r) return 2.5;
    const g = usefulGraphic(r.graphic) ? r.graphic : undefined;
    const text = [g?.primary, g?.secondary, ...(g?.items ?? []), r.emphasis].filter(Boolean).join(" ");
    const words = text.split(/\s+/).filter(Boolean).length;
    // A card's build (typewriter, flip board, counter) eats 1.5 s before it can be read (measured 30 Oct 2026).
    return Math.min(8, 2.5 + (g ? 1.5 : 0) + 0.3 * words + 0.5 * (g?.items?.length ?? 0));
  };
  const spanOf = (
    k: number,
  ): { from: number; len: number; anchored: boolean } => {
    const w = windows[k]!;
    const next = windows[k + 1];
    const anchored = w.at > w.start;
    const from = Math.max(
      Math.round(w.start * fps),
      Math.round((w.at - 0.15) * fps),
    );
    const until =
      next && next.entry === w.entry
        ? Math.round((next.at - 0.15) * fps)
        : Math.round(w.end * fps);
    // The reading time may run past the next sentence, but never into the next thing drawn for this entry.
    let stop = Math.round(w.end * fps);
    for (let j = k + 1; windows[j] && windows[j]!.entry === w.entry; j++) {
      if (drawn(windows[j]!.entry, windows[j]!.moment)) {
        stop = Math.round((windows[j]!.at - 0.3) * fps);
        break;
      }
      stop = Math.round(windows[j]!.end * fps);
    }
    const read = Math.min(stop, from + Math.round(readSeconds(w.entry, w.moment) * fps));
    return {
      from,
      len: Math.max(1, Math.max(until, read, from + Math.round(2.5 * fps)) - from),
      anchored,
    };
  };
  // Moment sounds, gated (src/render/soundscape.ts): glints on numbers and whooshes on pop-in pictures,
  // spaced out and kept clear of each entry's own swell and landing.
  const entryFrames = props.segments
    .map((s, i) =>
      s.kind === "beat" &&
      (s.visual?.kind === "rank" || s.visual?.kind === "chapter") &&
      i > 0
        ? starts[i]!
        : -1,
    )
    .filter((f) => f >= 0);
  // Zoom to the detail: each annotation's window, the shot showing its picture then, and the box on screen.
  const details = useMemo(() => {
    const out: Array<{
      k: number;
      shot: number;
      from: number;
      len: number;
      origin: { x: number; y: number };
      zoom: number;
      box: { x1: number; y1: number; x2: number; y2: number };
      label: string;
    }> = [];
    for (const a of props.annotations ?? []) {
      const k = windows.findIndex(
        (w) => w.entry === a.entry && w.moment === a.moment,
      );
      if (k < 0) continue;
      const { from, len } = spanOf(k);
      const shot = plan.shots.findIndex(
        (x) =>
          from >= x.start &&
          from < x.end &&
          x.media.type === "image" &&
          x.media.index === a.image,
      );
      const im = props.images[a.image];
      if (shot < 0 || !im || !Number.isFinite(im.aspect)) continue;
      // A box that isn't four numbers (a malformed annotation) is skipped rather than zooming to nowhere.
      if (
        !Array.isArray(a.box) ||
        a.box.length < 4 ||
        !a.box.slice(0, 4).every((n) => Number.isFinite(Number(n)))
      )
        continue;
      const p1 = coverPoint(im.aspect, a.box[0], a.box[1]);
      const p2 = coverPoint(im.aspect, a.box[2], a.box[3]);
      const box = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
      if (box.x1 < 0.02 || box.y1 < 0.02 || box.x2 > 0.98 || box.y2 > 0.98)
        continue; // cropped off by the frame
      const origin = {
        x: Math.max(0.15, Math.min(0.85, (box.x1 + box.x2) / 2)),
        y: Math.max(0.2, Math.min(0.8, (box.y1 + box.y2) / 2)),
      };
      // The push never carries the box off the frame: each edge caps the zoom.
      let zoom = focusZoom(box);
      const cap = (edge: number, o: number, limit: number) =>
        edge === o ? Infinity : (limit - o) / ((edge - o) * 1.04);
      for (const z of [
        cap(box.x1, origin.x, 0.04),
        cap(box.x2, origin.x, 0.96),
        cap(box.y1, origin.y, 0.07),
        cap(box.y2, origin.y, 0.93),
      ])
        if (z > 0) zoom = Math.min(zoom, z);
      zoom = Math.max(1, zoom);
      // On screen for at least four seconds (the box and label need time to read), or to the end of the shot.
      const shotLeft = plan.shots[shot]!.end - from;
      out.push({
        k,
        shot,
        from,
        len: Math.min(shotLeft, Math.max(len, 120)),
        origin,
        zoom,
        box,
        label: a.label,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.annotations, windows, plan]);
  const focusFor = new Map(
    details.map((d) => [
      d.shot,
      { from: d.from, origin: d.origin, zoom: d.zoom },
    ]),
  );
  // The editor's moves (src/render/components/EditorMoves.tsx).
  // Each entry or chapter opens on a burst of quick cuts from its own footage and pictures (never a
  // credited clip or archive photo, whose credit would not show, nor the picture the entry then opens on).
  const openings = useMemo(() => {
    const out: Array<{ from: number; items: MontageItem[] }> = [];
    props.segments.forEach((s, i) => {
      if (
        s.kind !== "beat" ||
        (s.visual?.kind !== "rank" && s.visual?.kind !== "chapter")
      )
        return;
      const e = entryOf(props.segments, i);
      if (e === undefined) return;
      const from = starts[i]! + breakAt(i);
      const after = plan.shots.find(
        (x) =>
          from + montageFrames(4) >= x.start && from + montageFrames(4) < x.end,
      );
      const clips = props.clips
        .filter(
          (c) => c.beatIndex === e && !c.credit && c.durationSeconds >= 1.5,
        )
        .map(
          (c): MontageItem => ({
            kind: "clip",
            src: c.src,
            startFrom: Math.round(c.durationSeconds * fps * 0.55),
          }),
        );
      const pics = props.images
        .map((im, k) => ({ im, k }))
        .filter(
          ({ im, k }) =>
            im.beatIndex === e &&
            im.aspect >= 1.2 &&
            ["screenshot", "hero", "header", "article"].includes(im.kind) &&
            !(after?.media.type === "image" && after.media.index === k),
        )
        .map(({ im }): MontageItem => ({ kind: "image", src: im.src }));
      const items: MontageItem[] = [];
      for (
        let k = 0;
        items.length < 4 && k < Math.max(clips.length, pics.length);
        k++
      ) {
        if (clips[k]) items.push(clips[k]!);
        if (items.length < 4 && pics[k]) items.push(pics[k]!);
      }
      if (items.length >= 3) out.push({ from, items });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.segments, props.clips, props.images, plan, fps]);
  // An old game (before 2007) opens on the hardware of its day: its platform's (a handheld, an arcade
  // cabinet, a beige PC monitor) or, by turns, a TV switching on or a TV and VCR taking a tape. Its first
  // long enough shot (footage first, else a screenshot), once per entry, never under the opening burst.
  const oldEntry = (e: number | undefined) => {
    if (e === undefined) return undefined;
    const year = Number(entryTitle(e).year);
    if (!year || year > OLD_YEAR) return undefined;
    const k = props.segments.findIndex(
      (x, i) =>
        x.kind === "beat" &&
        (x.visual?.kind === "chapter" || x.visual?.kind === "rank") &&
        entryOf(props.segments, i) === e,
    );
    const v = k >= 0 ? props.segments[k]!.visual : undefined;
    return {
      year,
      platforms: v?.items?.[1] ?? "",
      title: displayText((v?.kind === "rank" ? v.primary : v?.secondary) ?? ""),
    };
  };
  const shotEntry = (sh: { media: { type: string; index: number } }) =>
    sh.media.type === "clip"
      ? props.clips[sh.media.index]?.beatIndex
      : sh.media.type === "image"
        ? props.images[sh.media.index]?.beatIndex
        : undefined;
  const retro = useMemo(() => {
    const out = new Map<number, OldDevice>();
    const done = new Set<number>();
    let turn = props.variant;
    for (const type of ["clip", "image"] as const)
      plan.shots.forEach((sh, i) => {
        if (sh.media.type !== type) return;
        const e = shotEntry(sh);
        const old = oldEntry(e);
        if (e === undefined || !old || done.has(e)) return;
        if (
          type === "image" &&
          (props.images[sh.media.index]!.kind !== "screenshot" ||
            props.images[sh.media.index]!.aspect < 1.2)
        )
          return;
        if (focusFor.has(i)) return;
        if (
          openings.some((o) => sh.start >= o.from - 5 && sh.start < o.from + 75)
        )
          return;
        let device: Device | "tv" = deviceFor(old.year, old.platforms, turn);
        const room = sh.end - sh.start - 30;
        if (device !== "tv" && room < DEVICE_FRAMES[device]) device = "tv";
        if (device === "tv" && room < TV_HOLD + TV_PUSH) return;
        out.set(i, {
          device,
          label: old.title,
          green: handheldGreen(old.year),
        });
        done.add(e);
        turn++;
      });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, props.clips, props.images, openings]);
  // Every other shot of an old game wears its period: a VHS tape, or a CRT picture before 1994. Archive
  // photos and the detail zooms stay clean.
  const periodLooks = useMemo(() => {
    const out = new Map<number, "vhs" | "crt">();
    const count = new Map<number, number>();
    plan.shots.forEach((sh, i) => {
      const e = shotEntry(sh);
      const old = oldEntry(e);
      if (e === undefined || !old || retro.has(i) || focusFor.has(i)) return;
      if (
        sh.media.type === "image" &&
        props.images[sh.media.index]?.kind === "photo"
      )
        return;
      if (sh.media.type === "plate") return;
      const n = count.get(e) ?? 0;
      count.set(e, n + 1);
      if ((n + props.variant) % 2 === 0)
        out.set(i, old.year < 1994 ? "crt" : "vhs");
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, retro, props.images]);
  // Each game's own colour on its shots (props.palette, from the pipeline).
  const tints = useMemo(() => {
    const out = new Map<number, string>();
    plan.shots.forEach((sh, i) => {
      const e = shotEntry(sh);
      const c = e === undefined ? undefined : props.palette?.[e];
      if (c) out.set(i, c);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, props.palette]);
  // An old game's last shot before the next entry switches off like a tube.
  const powerOff = useMemo(() => {
    const out = new Set<number>();
    plan.shots.forEach((sh, i) => {
      const next = plan.shots[i + 1];
      const e = shotEntry(sh);
      if (!next || !oldEntry(e) || sh.end - sh.start < 45) return;
      if (
        shotEntry(next) !== e &&
        entryFrames.some((f) => Math.abs(f - next.start) < 4)
      )
        out.add(i);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, entryFrames]);
  // A punch-in on the narrator's key word, the editor's cut-in: on footage or a wide still, when the picture
  // is not under a full-screen explainer, at most one every 18 seconds.
  const punches = useMemo(() => {
    const out = new Map<number, number>();
    let lastAt = -Infinity;
    for (const w of windows) {
      const raw = props.moments?.[w.entry]?.[w.moment];
      if (!raw || w.moment === 0 || w.at - w.start < 0.3) continue;
      const kind = usefulGraphic(raw.graphic) ? raw.graphic.kind : "none";
      if (!["none", "stat", "date", "list", "compare"].includes(kind)) continue;
      const f = Math.round(w.at * fps);
      if (f - lastAt < 18 * fps) continue;
      const i = plan.shots.findIndex((x) => f >= x.start && f < x.end);
      const sh = plan.shots[i];
      if (!sh || sh.media.type === "plate") continue;
      if (
        f - sh.start < 24 ||
        sh.end - f < 36 ||
        focusFor.has(i) ||
        retro.has(i)
      )
        continue;
      if (sh.media.type === "image") {
        const im = props.images[sh.media.index];
        if (!im || im.kind === "photo" || im.aspect < 0.9) continue;
      }
      out.set(i, f);
      lastAt = f;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, plan, props.moments, props.images, fps, retro]);
  // The music drops out for a beat on one key line a section (src/render/musicplan.ts), never in the hook,
  // a breather or around an entry change.
  const drops = useMemo(
    () =>
      dropOuts(
        beds,
        [...punches.values()],
        fps,
        (f) =>
          f < 20 * fps ||
          entryFrames.some((e) => Math.abs(f - e) < 3 * fps) ||
          breakFrames.some((b) => f >= b.from - 3 * fps && f <= b.to + 3 * fps),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beds, punches, fps],
  );
  // The suite (src/render/components/packs): each graphic kind rotates through the house design and every
  // pack style that can draw it, so two stats or two headlines in a video never look the same. A figure
  // or date keeps its small card half the time, so footage still carries most of the video.
  // Motifs (src/render/components/motifs): the look of a game's series, console or genre, most specific first.
  const motifCache = new Map<number, Motif | undefined>();
  const motifOf = (e: number | undefined): Motif | undefined => {
    if (e === undefined) return undefined;
    if (motifCache.has(e)) return motifCache.get(e);
    const k = props.segments.findIndex(
      (x, i) =>
        x.kind === "beat" &&
        (x.visual?.kind === "chapter" || x.visual?.kind === "rank") &&
        entryOf(props.segments, i) === e,
    );
    const v = k >= 0 ? props.segments[k]!.visual : undefined;
    const m = v
      ? motifsFor({
          title: displayText(
            (v.kind === "rank" ? v.primary : v.secondary) ?? "",
          ),
          platforms: v.items?.[1] ?? "",
          year: Number(v.items?.[0]) || undefined,
          theme: props.theme,
        })[0]
      : undefined;
    motifCache.set(e, m);
    return m;
  };
  const videoMotif = motifsFor({
    title: props.title,
    platforms: "",
    theme: props.theme,
  })[0];
  /** Wide pictures for a motif's panels, tiles and screens: an entry's own, or the topic's for the opening. */
  const motifPictures = (e: number | undefined) =>
    props.images
      .filter(
        (im) =>
          (e === undefined ? true : im.beatIndex === e) &&
          im.aspect >= 1.3 &&
          ["hero", "screenshot", "article", "header"].includes(im.kind),
      )
      .map((im) => im.src)
      .slice(0, 6);
  const packFor = useMemo(() => {
    const out = new Map<number, GfxStyle>();
    const turn = new Map<string, number>();
    const HOUSE = new Set([
      "quote",
      "headline",
      "timeline",
      "delay",
      "span",
      "reviews",
      "source",
      "milestone",
      "people",
      "versus",
      "stat",
      "date",
      "list",
      "compare",
      "score",
    ]);
    const SMALL = new Set(["stat", "date", "list", "compare", "score"]);
    windows.forEach((w, k) => {
      const g = props.moments?.[w.entry]?.[w.moment]?.graphic;
      if (!g || !usefulGraphic(g)) return;
      const styles = Object.keys(ALL_STYLES)
        .sort()
        .map((name) => ALL_STYLES[name]!)
        .filter((s) => s.kind === g.kind && (!s.fits || s.fits(g)));
      const choices: Array<GfxStyle | undefined> = [
        ...(HOUSE.has(g.kind)
          ? SMALL.has(g.kind)
            ? styles.map(() => undefined)
            : [undefined]
          : []),
        ...styles,
      ];
      // A sentence about a game with a motif takes the motif's own style every other time it can.
      const motif = motifOf(w.entry);
      const own = Object.values(motif?.styles ?? {}).filter(
        (s) => s.kind === g.kind && (!s.fits || s.fits(g)),
      );
      if (!choices.length && !own.length) return;
      const n = turn.get(g.kind) ?? 0;
      turn.set(g.kind, n + 1);
      if (own.length && ((n + props.variant) % 2 === 0 || !choices.length)) {
        out.set(k, own[Math.floor(n / 2) % own.length]!);
        return;
      }
      const pick = choices[(n + props.variant) % choices.length];
      if (pick) out.set(k, pick);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, props.moments, props.variant]);
  // Captions and pop-in pictures take their looks in turn (src/render/components/Captions.tsx, Accents.tsx).
  const lookOf = useMemo(() => {
    const out = new Map<number, number>();
    let caption = props.variant;
    let pop = props.variant;
    windows.forEach((w, k) => {
      const m = props.moments?.[w.entry]?.[w.moment];
      if (!m) return;
      if (m.emphasis) out.set(k, caption++ % CAPTION_STYLES.length);
      else out.set(k, pop++ % POPIN_STYLES.length);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, props.moments, props.variant]);
  // The flash-forward (owner, 28 Oct 2026): the opening teases the video's biggest graphics still to come, a
  // few frames of each frozen fully drawn, under a COMING UP tag, while the narrator sets the story up.
  const TEASE_KINDS = [
    "stat",
    "map",
    "quote",
    "milestone",
    "span",
    "headline",
    "bars",
    "delay",
    "reviews",
    "versus",
  ];
  const teaser = useMemo(() => {
    const picks: number[] = [];
    const seen = new Set<number>();
    for (const kind of TEASE_KINDS)
      windows.forEach((w, k) => {
        const g = props.moments?.[w.entry]?.[w.moment]?.graphic;
        if (
          !g ||
          g.kind !== kind ||
          !usefulGraphic(g) ||
          seen.has(w.entry) ||
          w.start < 60
        )
          return;
        if (
          !packFor.get(k) &&
          ![
            "quote",
            "headline",
            "span",
            "milestone",
            "delay",
            "reviews",
            "versus",
          ].includes(kind)
        )
          return;
        if (picks.length >= TEASE_ITEMS) return;
        picks.push(k);
        seen.add(w.entry);
      });
    return picks.sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, props.moments, packFor]);
  const teaseGraphic = (k: number) => {
    const w = windows[k]!;
    const g = props.moments![w.entry]![w.moment]!.graphic;
    const bg = backgroundFor(
      g.kind,
      Number(entryTitle(w.entry).year) || undefined,
      props.variant + k,
    );
    const src = props.images.find(
      (im) =>
        im.beatIndex === w.entry && im.aspect >= 1.2 && im.kind !== "capsule",
    )?.src;
    const style = packFor.get(k);
    if (style)
      return React.createElement(style.component, {
        g,
        len: 200,
        bg,
        variant: props.variant + k,
        year: Number(entryTitle(w.entry).year) || undefined,
        photos: portraits,
        src,
      });
    if (richGraphic(g, 200)) return richGraphic(g, 200, bg, props.variant + k);
    if (g.kind === "quote")
      return (
        <QuoteMoment g={g} len={200} bg={bg} variant={props.variant + k} />
      );
    if (g.kind === "headline")
      return (
        <HeadlineMoment
          g={g}
          len={200}
          bg={bg}
          variant={props.variant + k}
          src={src}
        />
      );
    return null;
  };

  // An accent on about one cut in four, at least eight seconds apart: never on an entry's landing, a
  // breather, an opening burst or the old TV, and never under a full-screen explainer.
  const accents = useMemo(() => {
    const out: Array<{ at: number; kind: AccentKind | "static" }> = [];
    let last = -Infinity;
    let n = props.variant;
    const covered = (f: number) =>
      windows.some((w, k) => {
        const style = packFor.get(k);
        const g = props.moments?.[w.entry]?.[w.moment]?.graphic;
        if (
          !style &&
          !(
            g &&
            [
              "quote",
              "headline",
              "source",
              "timeline",
              "delay",
              "span",
              "reviews",
              "people",
              "versus",
              "milestone",
            ].includes(g.kind)
          )
        )
          return false;
        const { from, len } = spanOf(k);
        return f >= from - 10 && f < from + Math.min(len, 220) + 10;
      });
    plan.shots.forEach((sh, i) => {
      const at = sh.start;
      if (i === 0 || at - last < 8 * fps || (i * 7 + props.variant) % 4 !== 0)
        return;
      if (entryFrames.some((e) => Math.abs(at - e) < 2 * fps)) return;
      if (breakFrames.some((b) => at >= b.from - 20 && at <= b.to + 20)) return;
      if (openings.some((o) => at >= o.from - 10 && at < o.from + 60)) return;
      if (retro.has(i) || covered(at)) return;
      const old =
        oldEntry(shotEntry(sh)) && oldEntry(shotEntry(plan.shots[i - 1]!));
      out.push({ at, kind: old ? "static" : ACCENTS[n++ % ACCENTS.length]! });
      last = at;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, windows, packFor, openings, retro, fps, props.variant]);
  const richSoundAt = new Map<number, number>();
  const momentSounds = gateLongSounds(
    windows
      .flatMap((w, k): LongSoundCandidate[] => {
        const raw = props.moments?.[w.entry]?.[w.moment];
        if (!raw) return [];
        const { from, len, anchored } = spanOf(k);
        const graphic = usefulGraphic(raw.graphic) ? raw.graphic.kind : "none";
        const style = packFor.get(k);
        if (style) {
          const at = from + (style.sound === "stamp" ? 34 : 0);
          richSoundAt.set(k, at);
          return [
            {
              key: k,
              frame: at,
              kind:
                style.sound === "glint"
                  ? ("glint" as const)
                  : style.sound === "stamp"
                    ? ("stamp" as const)
                    : ("pop" as const),
            },
          ];
        }
        if (graphic === "stat" || graphic === "score")
          return [{ key: k, frame: from, kind: "glint" as const }];
        // The richer graphics have their own cue: a whoosh as a full-screen explainer lands, the stamp's
        // low hit as it slams down, a tick as a counter finishes or a milestone pops.
        if (
          [
            "quote",
            "headline",
            "source",
            "reviews",
            "people",
            "versus",
            "timeline",
          ].includes(graphic)
        ) {
          richSoundAt.set(k, from);
          return [{ key: k, frame: from, kind: "pop" as const }];
        }
        if (graphic === "delay") {
          richSoundAt.set(k, from + 34);
          return [{ key: k, frame: from + 34, kind: "stamp" as const }];
        }
        if (graphic === "span" || graphic === "milestone") {
          const at = from + (graphic === "span" ? 70 : 6);
          richSoundAt.set(k, at);
          return [{ key: k, frame: at, kind: "glint" as const }];
        }
        const shot = plan.shots.find((x) => from >= x.start && from < x.end);
        const pic = props.images.some(
          (im) => im.beatIndex === w.entry && im.moment === w.moment,
        );
        if (
          graphic === "none" &&
          shot?.media.type === "clip" &&
          pic &&
          w.moment > 0
        )
          return [
            {
              key: k,
              frame:
                from + (anchored ? 0 : Math.min(30, Math.max(0, len - 90))),
              kind: "pop" as const,
            },
          ];
        return [];
      })
      .concat(
        // A detail's box drawing on gets a tick (keys from 100000, clear of the moment windows').
        details.map((d, i): LongSoundCandidate => {
          richSoundAt.set(100000 + i, d.from + 26);
          return { key: 100000 + i, frame: d.from + 26, kind: "glint" };
        }),
        // The retro kit heard: the old screen switching on (or the tape's thunk into the VCR as it goes in),
        // and soft static on a channel-static cut (keys from 200000 and 300000).
        [...retro].map(([i, dev]): LongSoundCandidate => {
          const sh = plan.shots[i]!;
          const img = sh.media.type === "image" && i > 0;
          const from = img
            ? sh.start - (powerOff.has(i - 1) ? 0 : Math.min(XFADE, sh.start))
            : sh.start;
          const at = from + (dev.device === "vcr" ? 26 : 3);
          richSoundAt.set(200000 + i, at);
          return {
            key: 200000 + i,
            frame: at,
            kind: dev.device === "vcr" ? "vhs" : "tvon",
          };
        }),
        accents.flatMap((a, k): LongSoundCandidate[] => {
          if (a.kind !== "static") return [];
          richSoundAt.set(300000 + k, a.at - 3);
          return [{ key: 300000 + k, frame: a.at - 3, kind: "static" }];
        }),
      ),
    entryFrames,
    fps,
  );
  // The corner names the source of what is on screen: a licensed gameplay clip its creator, else the trailers.
  const creditAt = (f: number) => {
    const shot = plan.shots.find((s) => f >= s.start && f < s.end);
    const clip =
      shot?.media.type === "clip" ? props.clips[shot.media.index] : undefined;
    // A real photo carries its own credit: the trailers-and-Steam line sat on Wikimedia photos of Dundee
    // and Rockstar North (29 Oct 2026 review).
    const image =
      shot?.media.type === "image" ? props.images[shot.media.index] : undefined;
    if (image?.kind === "photo") return image.credit ?? "";
    return clip?.credit ? clip.credit : props.footageCredit;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: COLOUR.ink }}>
      <Backdrop
        plan={plan}
        images={props.images}
        clips={props.clips}
        theme={props.theme}
        describe={describe}
        focusFor={focusFor}
        retro={retro}
        tints={tints}
        looks={periodLooks}
        powerOff={powerOff}
        punches={punches}
      />
      {accents.map((a, k) => (
        <Sequence
          key={`acc${k}`}
          from={Math.max(0, a.at - ACCENT_LEAD)}
          durationInFrames={ACCENT_FRAMES}
          layout="none"
        >
          {a.kind === "static" ? (
            <Sequence
              from={ACCENT_LEAD - 3}
              durationInFrames={STATIC_FRAMES}
              layout="none"
            >
              <ChannelStatic variant={props.variant + k} />
            </Sequence>
          ) : (
            <CutAccent kind={a.kind} variant={props.variant + k} />
          )}
        </Sequence>
      ))}
      {openings.map((o, k) => (
        <Sequence
          key={`open${k}`}
          from={o.from}
          durationInFrames={montageFrames(o.items.length)}
          layout="none"
        >
          <Montage items={o.items} />
        </Sequence>
      ))}
      <Scrim />
      <ShotLabel
        plan={plan}
        describe={describe}
        bursts={openings.map((o) => ({
          from: o.from,
          to: o.from + montageFrames(o.items.length),
        }))}
      />
      <GrainVignette />
      <Brand
        logoSrc={resolveSrc(props.logoSrc)}
        chip={
          props.recap
            ? "THIS WEEK"
            : documentary
              ? "DOCUMENTARY"
              : total
                ? `TOP ${total}`
                : "RANKED"
        }
        progress={Math.min(1, frame / Math.max(1, durationInFrames))}
        marks={entryFrames.map((f) => f / Math.max(1, durationInFrames))}
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
              {(() => {
                // The opening: the video's motif card, the flash-forward, then the title.
                const open = videoMotif?.card && len >= 240 ? MOTIF_OPEN : 0;
                // Off since 29 Oct 2026: the owner found the silent flash of figures under the opening
                // narration unrelated to the words; it returns only when it carries the narrator's own lines.
                const tease =
                  FLASH_FORWARD && teaser.length >= 2 && len - open >= 480
                    ? teaser.length * TEASE_FRAMES
                    : 0;
                return (
                  <>
                    {open ? (
                      <Sequence durationInFrames={open} layout="none">
                        {React.createElement(videoMotif!.card!, {
                          heading: props.title,
                          kicker: props.recap
                            ? "THIS WEEK"
                            : documentary
                              ? "DOCUMENTARY"
                              : "RANKED",
                          game: props.theme,
                          pictures: motifPictures(undefined),
                          frames: open,
                          variant: props.variant,
                        })}
                      </Sequence>
                    ) : null}
                    {tease
                      ? teaser.map((k, n) => (
                          <Sequence
                            key={`tease${k}`}
                            from={open + n * TEASE_FRAMES}
                            durationInFrames={TEASE_FRAMES}
                            layout="none"
                          >
                            <TeaseCut last={n === teaser.length - 1}>
                              <Freeze frame={84}>{teaseGraphic(k)}</Freeze>
                            </TeaseCut>
                            <Sfx
                              name={SFX.air[n % SFX.air.length]!}
                              volume={LEVEL.airLong}
                            />
                          </Sequence>
                        ))
                      : null}
                    {/* The title stands for six seconds, then the opening's own pictures carry the story: kept for
                        the whole intro it covered a minute of narration (29 Oct 2026 review). */}
                    <Sequence
                      from={open + tease}
                      durationInFrames={Math.min(
                        len - open - tease,
                        INTRO_TITLE_FRAMES,
                      )}
                      layout="none"
                    >
                      <IntroTitle
                        title={props.title}
                        spoilers={props.spoilers}
                        kicker={props.kicker}
                        criterion={props.criterion}
                        durationFrames={Math.min(
                          len - open - tease,
                          INTRO_TITLE_FRAMES,
                        )}
                      />
                    </Sequence>
                  </>
                );
              })()}
              {documentary ? <Letterbox len={len} /> : null}
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
          // A breather opens the chapter: its interlude first, then the lower-third card as the narration resumes.
          const pause = breakAt(i);
          const quote = props.moments?.[b ?? -1]?.find(
            (m) => m.graphic.kind === "quote",
          )?.graphic;
          const span = Math.max(1, chapterEnd(i) - starts[i]! - pause);
          // Every other breather is the story so far pinned to a board: the chapter's archive photos first.
          const rankPic = (k: string) =>
            ({ photo: 0, portrait: 1, screenshot: 2, article: 3, hero: 4 })[
              k
            ] ?? 9;
          const boardPics: BoardPicture[] = props.images
            .filter(
              (im) =>
                im.beatIndex === b && im.aspect >= 0.75 && rankPic(im.kind) < 9,
            )
            .sort((x, y) => rankPic(x.kind) - rankPic(y.kind))
            .slice(0, 3)
            .map((im, k) => ({
              src: im.src,
              caption:
                im.label && im.label.length <= 22
                  ? displayText(im.label)
                  : `Exhibit ${"ABC"[k]}`,
            }));
          // The breathers take their looks in turn: the title interlude, the evidence board, a clapperboard,
          // a VHS tape for a game from before 2008, a torn-paper reveal of the chapter's picture.
          const chapterYear = Number(s.visual.items?.[0]) || undefined;
          const widePic = props.images.find(
            (im) =>
              im.beatIndex === b &&
              im.aspect >= 1.3 &&
              ["hero", "screenshot", "article", "photo"].includes(im.kind),
          )?.src;
          const looks = [
            "title",
            ...(boardPics.length >= 2 ? ["board"] : []),
            "slate",
            ...(chapterYear && chapterYear < 2008 ? ["vhs"] : []),
            ...(widePic ? ["torn", "mask"] : []),
          ];
          const motif = motifOf(b);
          // A breather the graphics check faulted falls back to the plain title card.
          const breakIndex = breakFrames.findIndex(
            (x) => Math.abs(x.from - starts[i]!) <= 3,
          );
          const look = (props.quietBreaks ?? []).includes(breakIndex)
            ? "title"
            : motif?.card && ((b ?? 0) + props.variant) % 2 === 0
              ? "motif"
              : looks[((b ?? 0) + props.variant) % looks.length]!;
          const board = look === "board";
          const interlude = {
            number: s.visual.value_a ?? (b ?? 0) + 1,
            title: s.visual.primary,
            game: s.visual.secondary,
            year: s.visual.items?.[0],
            frames: pause,
            variant: props.variant + i,
            picture: widePic,
          };
          return (
            <React.Fragment key={i}>
              {pause && board ? (
                <Sequence
                  from={starts[i]!}
                  durationInFrames={pause}
                  layout="none"
                >
                  <EvidenceBoard
                    number={s.visual.value_a ?? (b ?? 0) + 1}
                    title={s.visual.primary}
                    game={s.visual.secondary}
                    year={s.visual.items?.[0]}
                    pictures={boardPics}
                    frames={pause}
                    variant={props.variant + i}
                  />
                </Sequence>
              ) : pause && look === "motif" && motif?.card ? (
                <Sequence
                  from={starts[i]!}
                  durationInFrames={pause}
                  layout="none"
                >
                  {React.createElement(motif.card, {
                    heading: s.visual.primary,
                    kicker: `CHAPTER ${s.visual.value_a ?? (b ?? 0) + 1}`,
                    game: s.visual.secondary,
                    year: s.visual.items?.[0],
                    pictures: motifPictures(b),
                    frames: pause,
                    variant: props.variant + i,
                  })}
                </Sequence>
              ) : pause && look !== "title" ? (
                <Sequence
                  from={starts[i]!}
                  durationInFrames={pause}
                  layout="none"
                >
                  {look === "slate" ? (
                    <SlateInterlude {...interlude} />
                  ) : look === "mask" ? (
                    <MaskInterlude {...interlude} />
                  ) : look === "vhs" ? (
                    <VhsInterlude {...interlude} />
                  ) : (
                    <TornInterlude {...interlude} />
                  )}
                </Sequence>
              ) : pause ? (
                <Sequence
                  from={starts[i]!}
                  durationInFrames={pause}
                  layout="none"
                >
                  <ChapterInterlude
                    bg={backgroundFor(
                      "interlude",
                      Number(s.visual.items?.[0]) || undefined,
                      props.variant + i,
                    )}
                    variant={props.variant + i}
                    number={s.visual.value_a ?? (b ?? 0) + 1}
                    title={s.visual.primary}
                    game={s.visual.secondary}
                    year={s.visual.items?.[0]}
                    quote={
                      quote && quote.primary.split(/\s+/).length <= 18
                        ? {
                            text: displayText(quote.primary).replace(
                              /^["“]+|["”]+$/g,
                              "",
                            ),
                            who: displayText(
                              quote.secondary.split(",")[0] ?? "",
                            ),
                          }
                        : undefined
                    }
                    frames={pause}
                  />
                </Sequence>
              ) : null}
              <Sequence
                from={starts[i]! + pause}
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
            </React.Fragment>
          );
        }
        // A chapter with a shot list puts its facts on screen sentence by sentence instead.
        if (
          s.kind === "beat" &&
          documentary &&
          !props.moments?.[entryOf(props.segments, i) ?? -1]?.length &&
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
        const { from, len, anchored } = spanOf(k);
        // The explainer's background: suited to the graphic and the game's era, rotating through the video.
        const bg = backgroundFor(
          m.graphic.kind,
          Number(entryTitle(w.entry).year) || undefined,
          props.variant + k,
        );
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
        const person = raw.person?.trim();
        const nameTag =
          person &&
          firstMention.has(`${w.entry}|${w.moment}`) &&
          (m.graphic.kind === "none" ||
            m.graphic.kind === "stat" ||
            m.graphic.kind === "date")
            ? { name: person, role: roles.get(person.toLowerCase()) }
            : undefined;
        const showPop =
          !nameTag &&
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
            {packFor.get(k) ? (
              React.createElement(packFor.get(k)!.component, {
                g: m.graphic,
                len,
                bg,
                variant: props.variant + k,
                year: Number(entryTitle(w.entry).year) || undefined,
                photos: portraits,
                src: (
                  pic ??
                  props.images.find(
                    (im) =>
                      im.beatIndex === w.entry &&
                      im.aspect >= 1.2 &&
                      im.kind !== "capsule",
                  )
                )?.src,
              })
            ) : richGraphic(m.graphic, len) ? (
              richGraphic(m.graphic, len, bg, props.variant + k)
            ) : m.graphic.kind === "quote" ? (
              <QuoteMoment
                g={m.graphic}
                len={len}
                bg={bg}
                variant={props.variant + k}
              />
            ) : m.graphic.kind === "headline" ? (
              <HeadlineMoment
                g={m.graphic}
                len={len}
                bg={bg}
                variant={props.variant + k}
                src={
                  (
                    pic ??
                    props.images.find(
                      (im) =>
                        im.beatIndex === w.entry &&
                        im.aspect >= 1.2 &&
                        im.kind !== "capsule",
                    )
                  )?.src
                }
              />
            ) : m.graphic.kind === "timeline" ? (
              <TimelineMoment g={m.graphic} len={len} />
            ) : m.graphic.kind !== "none" &&
              // The suite's own kinds have no card: with no style that fits, the picture carries the line.
              !["map", "bars", "share", "specs", "lineage"].includes(
                m.graphic.kind,
              ) ? (
              <>
                <MomentGraphicCard g={m.graphic} len={len} />
                {momentSounds.get(k) ? (
                  <Sfx name={momentSounds.get(k)!} volume={LEVEL.glintLong} />
                ) : null}
              </>
            ) : m.emphasis && w.moment > 0 ? (
              <>
                {React.createElement(
                  CAPTION_STYLES[lookOf.get(k) ?? 0] ?? KineticCaption,
                  {
                    text: m.emphasis,
                    len,
                    variant: props.variant + k,
                  },
                )}
              </>
            ) : null}
            {nameTag
              ? React.createElement(
                  NAMETAG_STYLES[
                    (firstMentionOrder.get(`${w.entry}|${w.moment}`) ?? 0) %
                      NAMETAG_STYLES.length
                  ] ?? NameTag,
                  {
                    name: nameTag.name,
                    role: nameTag.role,
                    len,
                    photo: portraits[nameTag.name.toLowerCase()],
                    variant: props.variant + k,
                  },
                )
              : null}
            {showPop ? (
              <Sequence
                from={anchored ? 0 : Math.min(30, Math.max(0, len - 90))}
                layout="none"
              >
                {React.createElement(
                  POPIN_STYLES[lookOf.get(k) ?? 0] ?? PopInPicture,
                  {
                    src: pic!.src,
                    caption: pic!.label ?? "",
                    len: anchored ? len : len - 30,
                    side: w.moment % 2 ? "right" : "left",
                    variant: props.variant + k,
                  },
                )}
                {momentSounds.get(k) ? (
                  <Sfx name={momentSounds.get(k)!} volume={LEVEL.airLong} />
                ) : null}
              </Sequence>
            ) : null}
          </Sequence>
        );
      })}
      {/* The richer graphics' and detail boxes' cues (the plain graphics play theirs inline). */}
      {[...richSoundAt].map(([key, at]) => {
        const name = momentSounds.get(key);
        if (!name) return null;
        const vol =
          name === "retro/static"
            ? LEVEL.staticLong
            : name.startsWith("retro/")
              ? LEVEL.retroLong
              : name.includes("land")
                ? LEVEL.landLong
                : name.includes("air")
                  ? LEVEL.airLong
                  : LEVEL.glintLong;
        return (
          <Sequence
            key={`rs${key}`}
            from={Math.max(0, at - leadFrames(name, fps))}
            durationInFrames={75}
            layout="none"
          >
            <Sfx name={inKey(name, bedAt(at))} volume={vol} />
          </Sequence>
        );
      })}
      {/* Zoom to the detail: the labelled box over the pushed-in picture. */}
      {details.map((d, i) => (
        <Sequence
          key={`det${i}`}
          from={d.from}
          durationInFrames={Math.max(1, d.len)}
          layout="none"
        >
          <DetailCallout
            box={d.box}
            origin={d.origin}
            zoom={d.zoom}
            label={d.label}
            len={d.len}
          />
        </Sequence>
      ))}
      {/* A white punch as each entry lands. */}
      {props.segments.map((s, i) =>
        s.kind === "beat" &&
        (s.visual?.kind === "rank" || s.visual?.kind === "chapter") &&
        i > 0 ? (
          <Sequence
            key={`f${i}`}
            from={starts[i]!}
            durationInFrames={22}
            layout="none"
          >
            <ChapterTransition
              kind={transitionFor(
                Number(s.visual?.items?.[0]) || undefined,
                i,
                props.variant,
              )}
            />
          </Sequence>
        ) : null,
      )}
      {/* Each new entry: a swell whose peak meets a warm low hit as the rank card arrives, both in the music's key. */}
      {props.segments.map((s, i) =>
        s.kind === "beat" &&
        (s.visual?.kind === "rank" || s.visual?.kind === "chapter") &&
        i > 0 ? (
          <React.Fragment key={`snd${i}`}>
            <Sequence
              from={Math.max(0, starts[i]! - leadFrames(SFX.swell, fps))}
              durationInFrames={60}
              layout="none"
            >
              <Sfx
                name={inKey(SFX.swell, bedAt(starts[i]!))}
                volume={LEVEL.swellLong}
              />
            </Sequence>
            <Sequence
              from={Math.max(0, starts[i]! - leadFrames(SFX.land[0], fps))}
              durationInFrames={75}
              layout="none"
            >
              <Sfx
                name={inKey(SFX.land[i % SFX.land.length]!, bedAt(starts[i]!))}
                volume={LEVEL.landLong}
              />
            </Sequence>
          </React.Fragment>
        ) : null,
      )}
      {/* The brand sting opens the video and closes it, ringing out before the last frame. The closing one
          plays after the narrator has finished, with nothing to mask it, so it sits 3 dB lower. */}
      <Sequence from={0} durationInFrames={75} layout="none">
        <Sfx
          name={inKey(SFX.sting, props.musicSrc)}
          volume={LEVEL.sting * 0.8}
        />
      </Sequence>
      <Sequence
        from={Math.max(0, durationInFrames - 75)}
        durationInFrames={75}
        layout="none"
      >
        <Sfx
          name={inKey(SFX.sting, bedAt(durationInFrames - 1))}
          volume={LEVEL.sting * 0.5}
        />
      </Sequence>
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      {beds.map((b, k) => {
        // Each bed fades in and out over MUSIC_XFADE frames around its section, under the chapter's swell.
        const lead = k === 0 ? 0 : MUSIC_XFADE;
        const tail = k === beds.length - 1 ? 0 : MUSIC_XFADE;
        const from = b.from - lead;
        const span = b.to - b.from + lead + tail;
        return (
          <Sequence
            key={`bed${k}`}
            from={from}
            durationInFrames={Math.max(1, span)}
            layout="none"
          >
            <Audio
              src={resolveSrc(b.src)!}
              loop
              volume={(f) => {
                const edge = Math.min(
                  1,
                  lead ? f / lead : 1,
                  tail ? (span - f) / tail : 1,
                );
                return (
                  musicVolume(from + f) *
                  dropLevel(from + f, drops) *
                  Math.max(0, edge)
                );
              }}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
