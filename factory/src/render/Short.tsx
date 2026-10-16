import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { ShortProps } from "./props.ts";
import { STORY_THEME, BRAND } from "./props.ts";
import { pageCaptions, shotTimes } from "./timeline.ts";
import type { Word } from "../voice/elevenlabs.ts";
import { ArtTrack, MotionField, Scrim } from "./components/Background.tsx";
import { Captions, CutFlash, FactCard, HookHeadline, TopBar } from "./components/Overlays.tsx";

/** Bare names are brand files in public/; anything else is a full URL. */
const resolveSrc = (src: string | null) => (src && !/^(https?:|data:|blob:)/.test(src) ? staticFile(src) : src);

/** Studio previews have no narration; spread the words evenly over each segment. */
function synthWords(props: ShortProps): Word[] {
  const out: Word[] = [];
  for (const s of props.segments) {
    const ws = s.text.split(/\s+/).filter(Boolean);
    const step = (s.end - s.start) / Math.max(1, ws.length);
    ws.forEach((w, i) => out.push({ text: w, start: s.start + i * step, end: s.start + (i + 0.85) * step }));
  }
  return out;
}

export const Short: React.FC<ShortProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const theme = STORY_THEME[props.storyType] ?? STORY_THEME.other!;
  const accent = props.isRumour ? BRAND.alert : theme.accent;
  const words = props.words.length ? props.words : synthWords(props);
  const pages = useMemo(() => pageCaptions(words), [words]);
  const cuts = useMemo(() => shotTimes(props.segments), [props.segments]);
  const segmentStarts = props.segments.map((s) => Math.round(s.start * fps));
  const hook = props.segments.find((s) => s.kind === "hook");
  const hookEnd = Math.round((hook?.end ?? 3) * fps);
  const musicVolume = (f: number) =>
    interpolate(f, [0, 12, durationInFrames - 20, durationInFrames], [0, 0.11, 0.11, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.ink }}>
      <MotionField accent={accent} variant={props.variant} />
      <ArtTrack images={props.images} cuts={cuts} totalFrames={durationInFrames} />
      <Scrim />

      <Sequence durationInFrames={hookEnd} layout="none">
        <HookHeadline headline={props.headline} accent={accent} gameTitle={props.gameTitle} />
      </Sequence>

      {props.segments.map((s, i) =>
        s.kind === "beat" || s.kind === "take" ? (
          <Sequence key={i} from={segmentStarts[i]!} durationInFrames={Math.max(1, Math.round((s.end - s.start) * fps))} layout="none">
            <FactCard segment={s} accent={accent} />
          </Sequence>
        ) : null,
      )}

      <TopBar
        progress={frame / durationInFrames}
        chip={theme.chip}
        accent={accent}
        isRumour={props.isRumour}
        attribution={props.attribution}
        logoSrc={resolveSrc(props.logoSrc)}
      />
      <Captions pages={pages} accent={accent} />
      <CutFlash cutFrames={segmentStarts} accent={accent} />

      {/* Earned sound design (owned, synthesised in-house): an impact on the
          open, a whoosh into each fact, a riser into the take, a tick on stats. */}
      <Sequence from={0} durationInFrames={fps} layout="none">
        <Audio src={staticFile("sfx/punch-deep.mp3")} volume={0.4} />
      </Sequence>
      {props.segments.map((s, i) => {
        const at = segmentStarts[i]!;
        if (s.kind === "beat")
          return (
            <Sequence key={`sfx${i}`} from={Math.max(0, at - 3)} durationInFrames={fps} layout="none">
              <Audio src={staticFile(s.visual?.kind === "stat" ? "sfx/tick-blip.mp3" : "sfx/whoosh-short.mp3")} volume={0.28} />
            </Sequence>
          );
        if (s.kind === "take")
          return (
            <Sequence key={`sfx${i}`} from={Math.max(0, at - Math.round(0.8 * fps))} durationInFrames={fps * 2} layout="none">
              <Audio src={staticFile("sfx/riser-fast.mp3")} volume={0.22} />
            </Sequence>
          );
        return null;
      })}

      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
      {props.musicSrc ? <Audio src={resolveSrc(props.musicSrc)!} volume={musicVolume} loop /> : null}
    </AbsoluteFill>
  );
};
