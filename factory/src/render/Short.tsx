import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ShortProps } from "./props.ts";
import { COLOUR, themeFor } from "./brand.ts";
import { pageCaptions } from "./timeline.ts";
import { buildPlan, STING_FRAMES, type RenderPlan } from "./plan.ts";
import type { Word } from "../voice/elevenlabs.ts";
import {
  ArtTrack,
  Finish,
  Scrim,
  TurnFlash,
} from "./components/Background.tsx";
import {
  Captions,
  FactCard,
  HookHeadline,
  ProgressRail,
  TopBar,
} from "./components/Overlays.tsx";
import { Shelf } from "./components/Shelf.tsx";

/** Bare names are brand files in public/; anything else is a full URL. */
const resolveSrc = (src: string | null) =>
  src && !/^(https?:|data:|blob:)/.test(src) ? staticFile(src) : src;

/** Studio previews have no narration; spread the words evenly over each segment. */
function synthWords(props: ShortProps): Word[] {
  const out: Word[] = [];
  for (const s of props.segments) {
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

export const Short: React.FC<ShortProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const theme = themeFor(props.storyType, props.isRumour);
  const accent = theme.accent;
  const words = props.words.length ? props.words : synthWords(props);
  const pages = useMemo(() => pageCaptions(words), [words]);
  const emphasis = useMemo(
    () => new Set(props.emphasis.map((w) => w.toLowerCase())),
    [props.emphasis],
  );
  // The plan is normally built in the pipeline and persisted; previews build it here from the same pure function.
  const plan: RenderPlan = useMemo(
    () =>
      props.plan ??
      buildPlan({
        segments: props.segments,
        words,
        durationSeconds: props.durationSeconds,
        images: props.images.map((i) => ({
          kind: i.kind,
          aspect: i.aspect,
          luma: i.luma,
        })),
        clips: props.clips.map((c) => ({
          durationSeconds: c.durationSeconds,
          motion: c.motion,
          luma: c.luma,
          beatIndex: c.beatIndex,
        })),
        storyType: props.storyType,
        isRumour: props.isRumour,
        attribution: props.attribution,
        variant: props.variant,
        steam: props.steam,
      }),
    [props, words],
  );
  const segmentStarts = props.segments.map((s, i) =>
    i === 0 ? 0 : Math.round(s.start * fps),
  );
  const segmentEnds = props.segments.map((_, i) =>
    i === props.segments.length - 1 ? durationInFrames : segmentStarts[i + 1]!,
  );
  const hookIndex = props.segments.findIndex((s) => s.kind === "hook");
  const hookEnd =
    hookIndex >= 0 ? segmentEnds[hookIndex]! : Math.round(3 * fps);
  const loopIndex = props.segments.findIndex((s) => s.kind === "loop");
  const loopStart =
    loopIndex >= 0
      ? segmentStarts[loopIndex]!
      : durationInFrames - plan.tailFrames;
  const hasPlate = plan.shots.some((s) => s.media.type === "plate");

  // Music ducks under the voice with a fast attack and a slower release, and is held (never faded out) through the tail.
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
    const fadeIn = interpolate(f, [0, 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    let talk = 0;
    for (let k = -2; k <= 2; k++)
      talk += speaking[Math.min(durationInFrames, Math.max(0, f + k))] ?? 0;
    return fadeIn * interpolate(talk / 5, [0, 1], [0.2, 0.085]);
  };

  return (
    <AbsoluteFill style={{ backgroundColor: COLOUR.ink }}>
      <ArtTrack
        plan={plan}
        images={props.images}
        clips={props.clips}
        accent={accent}
        gameTitle={props.gameTitle}
        footageCredit={props.footageCredit}
      />
      <Scrim profile={hasPlate && !props.images.length ? "plate" : "footage"} />
      <Finish grainSrc={staticFile("grain.png")} />

      {/* The headline is fully rendered at frame 0 (the thumbnail) and returns, pixel-identical, for the loop. */}
      <Sequence durationInFrames={hookEnd} layout="none">
        <HookHeadline
          headline={props.headline}
          accent={accent}
          gameTitle={props.gameTitle}
          durationInFrames={hookEnd}
        />
      </Sequence>
      {loopStart < durationInFrames ? (
        <Sequence
          from={loopStart}
          durationInFrames={durationInFrames - loopStart}
          layout="none"
        >
          <HookHeadline
            headline={props.headline}
            accent={accent}
            gameTitle={props.gameTitle}
            durationInFrames={Number.POSITIVE_INFINITY}
          />
        </Sequence>
      ) : null}

      {props.segments.map((s, i) =>
        s.kind === "beat" || s.kind === "take" ? (
          <Sequence
            key={i}
            from={segmentStarts[i]!}
            durationInFrames={Math.max(1, segmentEnds[i]! - segmentStarts[i]!)}
            layout="none"
          >
            <FactCard
              segment={s}
              accent={accent}
              takeLabel={theme.takeLabel}
              durationInFrames={segmentEnds[i]! - segmentStarts[i]!}
            />
          </Sequence>
        ) : null,
      )}

      <Shelf
        plan={plan}
        accent={accent}
        isRumour={props.isRumour}
        images={props.images}
        gameTitle={props.gameTitle}
        gameSubtitle={props.gameSubtitle}
      />

      <TopBar
        chip={theme.chip}
        accent={accent}
        isRumour={props.isRumour}
        attribution={props.attribution}
        logoSrc={resolveSrc(props.logoSrc)}
      />
      <ProgressRail
        segments={props.segments}
        accent={accent}
        totalFrames={durationInFrames}
      />
      <Captions
        pages={pages}
        accent={accent}
        emphasis={emphasis}
        blankFromFrame={durationInFrames - 6}
      />
      <TurnFlash turns={plan.turns} accent={accent} />

      {/* Owned sound design from the plan: two brand stings, at most four content cues. */}
      {plan.sfx.map((cue, i) => (
        <Sequence
          key={`sfx${i}`}
          from={cue.frame}
          durationInFrames={Math.max(STING_FRAMES, fps)}
          layout="none"
        >
          <Audio src={staticFile(cue.file)} volume={cue.volume} />
        </Sequence>
      ))}

      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      {props.musicSrc ? (
        <Audio src={resolveSrc(props.musicSrc)!} volume={musicVolume} loop />
      ) : null}
      <span style={{ display: "none" }}>{frame}</span>
    </AbsoluteFill>
  );
};
