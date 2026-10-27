import React, { useMemo } from "react";
import { inKey, UNDER_VOICE } from "./soundscape.ts";
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
import { displayWords, pageCaptions } from "./timeline.ts";
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
import { Stamp, STAMP_FRAMES } from "./components/Stamp.tsx";
import type { ShotDressing } from "./components/Background.tsx";
import { CutAccent, ACCENT_FRAMES, ACCENT_LEAD, type AccentKind } from "./components/Accents.tsx";
import { ChannelStatic, STATIC_FRAMES } from "./components/Retro.tsx";
import { OLD_YEAR } from "./retroplan.ts";

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
  const pages = useMemo(() => pageCaptions(displayWords(words)), [words]);
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
  const deskIndex = props.segments.findIndex((s) => s.kind === "desk");
  // While a stamp is up the shelf fades almost out (6 frames each way), then comes back.
  const shelfOpacity = (props.stamps ?? []).reduce((o, st) => {
    const a = Math.round(st.at * fps);
    const b = a + STAMP_FRAMES;
    if (frame < a - 6 || frame > b + 6) return o;
    const dim = interpolate(
      frame,
      [a - 6, a, b - 4, b + 6],
      [1, 0.06, 0.06, 1],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      },
    );
    return Math.min(o, dim);
  }, 1);
  const loopStart =
    loopIndex >= 0
      ? segmentStarts[loopIndex]!
      : durationInFrames - plan.tailFrames;
  const hasPlate = plan.shots.some((s) => s.media.type === "plate");
  const rankTotal = props.segments.filter(
    (s) => s.visual?.kind === "rank",
  ).length;
  const beatIndexOf = props.segments.map((s, i) =>
    s.kind === "beat"
      ? props.segments.slice(0, i).filter((x) => x.kind === "beat").length
      : undefined,
  );

  // The new-look test (props.suite): the picture punches in on key words, some cuts get an accent (channel
  // static for an old game) and an old game's shots wear a tape or tube look by turns. The opening frame (the
  // Short's thumbnail) and the loop's return to it stay clean.
  const year = Number(props.gameSubtitle.match(/\b(19|20)\d\d\b/)?.[0]) || undefined;
  const old = Boolean(year && year <= OLD_YEAR);
  const dressing = useMemo((): {
    dress: ShotDressing;
    accents: Array<{ at: number; kind: AccentKind | "static" }>;
  } => {
    const punches = new Map<number, number>();
    const looks = new Map<number, "vhs" | "crt">();
    const accents: Array<{ at: number; kind: AccentKind | "static" }> = [];
    if (!props.suite) return { dress: { punches, looks }, accents };
    const shots = plan.shots;
    const last = shots.length - 1;
    // Punch-ins: the first time each kept-lit word is spoken after the hook, at most three, 5 s apart.
    let lastPunch = -Infinity;
    for (const w of words) {
      const f = Math.round(w.start * fps);
      if (f < hookEnd + 6 || f >= loopStart || f - lastPunch < 5 * fps || punches.size >= 3) continue;
      if (!emphasis.has(w.text.toLowerCase().replace(/[^a-z0-9'’$%-]/g, ""))) continue;
      const i = shots.findIndex((s) => f >= s.start && f < s.end);
      const s = shots[i];
      if (!s || i === 0 || i === last || punches.has(i) || f - s.start < 18 || s.end - f < 24) continue;
      punches.set(i, f);
      lastPunch = f;
    }
    // An old game: every other shot after the first wears the tape (or, before 1994, the tube).
    if (old)
      shots.forEach((s, i) => {
        if (i > 0 && i < last && i % 2 === 1) looks.set(i, year! < 1994 ? "crt" : "vhs");
      });
    // Accents on about one cut in three, 4 s apart, clear of the turns, the stamps and the loop.
    const kinds: AccentKind[] = ["flare", "burn", "flash", "glitch"];
    let lastAccent = -Infinity;
    let n = props.variant;
    shots.forEach((s, i) => {
      const at = s.start;
      if (i === 0 || at < hookEnd || at >= loopStart - 12 || at - lastAccent < 4 * fps) return;
      if ((i * 5 + props.variant) % 3 !== 0) return;
      if (plan.turns.some((t) => Math.abs(t - at) < 20)) return;
      if ((props.stamps ?? []).some((st) => Math.abs(Math.round(st.at * fps) - at) < STAMP_FRAMES + 10)) return;
      accents.push({ at, kind: old ? "static" : kinds[n++ % kinds.length]! });
      lastAccent = at;
    });
    return { dress: { punches, looks }, accents };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.suite, plan, words, emphasis, hookEnd, loopStart, old, year, fps, props.variant, props.stamps]);

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
        dress={dressing.dress}
      />
      {dressing.accents.map((a, k) => (
        <Sequence
          key={`acc${k}`}
          from={Math.max(0, a.at - ACCENT_LEAD)}
          durationInFrames={ACCENT_FRAMES}
          layout="none"
        >
          {a.kind === "static" ? (
            <Sequence from={ACCENT_LEAD - 3} durationInFrames={STATIC_FRAMES} layout="none">
              <ChannelStatic variant={props.variant + k} />
            </Sequence>
          ) : (
            <CutAccent kind={a.kind} variant={props.variant + k} />
          )}
        </Sequence>
      ))}
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
              renderDate={props.renderDate}
              images={props.images}
              rankTotal={rankTotal}
              beatIndex={beatIndexOf[i]}
              steamPrices={props.steam?.prices}
            />
          </Sequence>
        ) : null,
      )}

      {(props.stamps ?? []).map((st, i) => (
        <Sequence
          key={`stamp${i}`}
          from={Math.round(st.at * fps)}
          durationInFrames={STAMP_FRAMES}
          layout="none"
        >
          <Stamp stamp={st} top={930} size={104} />
        </Sequence>
      ))}
      {/* The shelf steps back while a stamp holds the band, so the two never overlap. */}
      <AbsoluteFill style={{ opacity: shelfOpacity }}>
        <Shelf
          plan={plan}
          accent={accent}
          isRumour={props.isRumour}
          images={props.images}
          gameTitle={props.gameTitle}
          gameSubtitle={props.gameSubtitle}
        />
      </AbsoluteFill>

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
        desk={
          deskIndex >= 0
            ? {
                start: segmentStarts[deskIndex]! / fps,
                end: segmentEnds[deskIndex]! / fps,
                name: props.deskName ?? "THE DESK",
              }
            : undefined
        }
      />
      <TurnFlash turns={plan.turns} accent={accent} />

      {/* The soundscape (src/render/soundscape.ts): each sound plays out in full, a quarter lower under the voice. */}
      {plan.sfx.map((cue, i) => (
        <Sequence
          key={`sfx${i}`}
          from={cue.frame}
          durationInFrames={Math.max(
            1,
            Math.min(3 * fps, durationInFrames - cue.frame),
          )}
          layout="none"
        >
          <Audio
            src={staticFile(inKey(cue.file, props.musicSrc))}
            volume={(f) =>
              cue.volume *
              (speaking[Math.min(durationInFrames, cue.frame + f)]
                ? UNDER_VOICE
                : 1)
            }
          />
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
