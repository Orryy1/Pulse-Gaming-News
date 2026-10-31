import { bedEnvelope } from "./musicplan.ts";
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
import { STAMP_FRAMES } from "./components/Stamp.tsx";
import { W_STYLES, DEFAULT_LOOK } from "./components/wordmoment/index.ts";
import type { Tone } from "./components/wordmoment/types.ts";
import { pickWordLook } from "./wordlook.ts";
import { Pip, PIP_SHORT, sinceLast } from "./components/Pip.tsx";
import type { ShotDressing } from "./components/Background.tsx";
import type { CutMove, ShotMove } from "./camera.ts";
import {
  CutAccent,
  ACCENT_FRAMES,
  ACCENT_LEAD,
  type AccentKind,
} from "./components/Accents.tsx";
import { ChannelStatic, STATIC_FRAMES } from "./components/Retro.tsx";
import { OLD_YEAR } from "./retroplan.ts";
import { keyTime } from "./longplan.ts";
import { HookPoster } from "./components/HookPoster.tsx";
import { V_STYLES, V_STYLES_CORE } from "./components/vertical/index.ts";
import { VBOX, type VStyle } from "./components/vertical/types.ts";
import { storyYearOf } from "./components/vertical/pulse/map.ts";
import { VFiller, VFreezeLabel } from "./components/vertical/craft.tsx";
import { HOUSE, SHORT_TRACK_FRAMES } from "./shortcraft.ts";
import { motifsFor } from "./components/motifs/index.ts";

/** Bare names are brand files in public/; anything else is a full URL. */
/** Frames the new-look motif sting lasts after the hook. */
const MOTIF_STING = 30;

/** The motif's 16:9 card shown across the Short's middle for a second, the frame dimmed around it. */
const MotifSting: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const o = interpolate(
    frame,
    [0, 5, MOTIF_STING - 6, MOTIF_STING],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const sc = interpolate(frame, [0, MOTIF_STING], [0.94, 1.0], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ opacity: o, pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "rgba(5,5,7,0.82)" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 400,
          width: 1920,
          height: 1080,
          transform: `scale(${0.5625 * sc})`,
          transformOrigin: "0 0",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

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
  // The shelf also steps back under a full-width card or a filler, which draw over its band.
  const overShelf = (f: number) =>
    (plan.craft?.fillers ?? []).some((x) => f >= x.from - 4 && f < x.from + x.len + 4) ||
    (plan.craft?.photos ?? []).some((p) => {
      const s = plan.shots[p.shot];
      return !!s && f >= s.start - 4 && f < s.end + 4;
    }) ||
    (plan.craft?.cards ?? []).some((c) => {
      if (V_STYLES[c.look]?.frame !== "full") return false;
      const w = graphicWindow(c.segment);
      return f >= w.from - 4 && f < w.from + w.len + 4;
    });
  const shelfLevel = () => (overShelf(frame) ? Math.min(shelfOpacity, 0.06) : shelfOpacity);
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
  // A graphic lands on the word it is about and stays a beat or two, not for the whole sentence (owner,
  // 29 Oct 2026: cards sat for 4-10 s and covered the footage). Its words: the figure or name it shows.
  const graphicWindow = (i: number): { from: number; len: number } => {
    const s = props.segments[i]!;
    const start = segmentStarts[i]!;
    const end = segmentEnds[i]!;
    const v = s.visual;
    const hold = Math.round(
      (s.kind === "take" ? 3.5 : v && ["list", "timeline", "compare"].includes(v.kind) ? 3 : 2.5) * fps,
    );
    let at = start;
    if (v && s.kind !== "take") {
      const lo = Math.max(0, words.findIndex((w) => w.start >= s.start - 0.05));
      let hi = words.findIndex((w) => w.start >= s.end);
      if (hi < 0) hi = words.length;
      for (const key of [v.primary, ...(v.items ?? []), v.secondary].filter(Boolean)) {
        const t = keyTime(words, lo, hi, key);
        if (t !== undefined) {
          at = Math.max(start, Math.round(t * fps) - 6);
          break;
        }
      }
    }
    const len = Math.max(1, Math.min(end - at, hold));
    return { from: at, len };
  };

  // The new-look test (props.suite): the picture punches in on key words, some cuts get an accent (channel
  // static for an old game) and an old game's shots wear a tape or tube look by turns. The opening frame (the
  // Short's thumbnail) and the loop's return to it stay clean.
  const year =
    Number(props.gameSubtitle.match(/\b(19|20)\d\d\b/)?.[0]) || undefined;
  const old = Boolean(year && year <= OLD_YEAR);
  const dressing = useMemo((): {
    dress: ShotDressing;
    accents: Array<{ at: number; kind: AccentKind | "static" }>;
  } => {
    const punches = new Map<number, number>();
    const looks = new Map<number, "vhs" | "crt">();
    const accents: Array<{ at: number; kind: AccentKind | "static" }> = [];
    // The craft (src/render/shortcraft.ts): treated photos and camera moves, which keep every other dressing off their shots.
    const craft = plan.craft;
    const photos = new Map((craft?.photos ?? []).map((p) => [p.shot, { treatment: p.treatment, seed: p.seed }]));
    const camera = new Map<number, { into?: CutMove; out?: CutMove; move?: ShotMove }>();
    for (const m of craft?.moves ?? []) {
      if (m.kind === "freeze")
        camera.set(m.shot, { ...camera.get(m.shot), move: { kind: "freeze", at: m.at, hold: m.hold, label: m.label } });
      else {
        const cut: CutMove = { kind: "track", dir: 1, frames: SHORT_TRACK_FRAMES };
        camera.set(m.shot, { ...camera.get(m.shot), into: cut });
        camera.set(m.shot - 1, { ...camera.get(m.shot - 1), out: cut });
      }
    }
    const crafted = (i: number) => photos.has(i) || camera.has(i);
    if (!props.suite) return { dress: { punches, looks, photos, camera }, accents };
    const shots = plan.shots;
    const last = shots.length - 1;
    // Punch-ins: the first time each kept-lit word is spoken after the hook, at most three, 5 s apart.
    let lastPunch = -Infinity;
    for (const w of words) {
      const f = Math.round(w.start * fps);
      if (
        f < hookEnd + 6 ||
        f >= loopStart ||
        f - lastPunch < 5 * fps ||
        punches.size >= 3
      )
        continue;
      if (!emphasis.has(w.text.toLowerCase().replace(/[^a-z0-9'’$%-]/g, "")))
        continue;
      const i = shots.findIndex((s) => f >= s.start && f < s.end);
      const s = shots[i];
      if (
        !s ||
        i === 0 ||
        i === last ||
        punches.has(i) ||
        crafted(i) ||
        f - s.start < 18 ||
        s.end - f < 24
      )
        continue;
      punches.set(i, f);
      lastPunch = f;
    }
    // An old game: every other shot after the first wears the tape (or, before 1994, the tube).
    if (old)
      shots.forEach((s, i) => {
        if (i > 0 && i < last && i % 2 === 1 && !photos.has(i))
          looks.set(i, year! < 1994 ? "crt" : "vhs");
      });
    // Accents on about one cut in three, 4 s apart, clear of the turns, the stamps and the loop.
    const kinds: AccentKind[] = ["flare", "burn", "flash", "glitch"];
    let lastAccent = -Infinity;
    let n = props.variant;
    shots.forEach((s, i) => {
      const at = s.start;
      if (
        i === 0 ||
        at < hookEnd ||
        at >= loopStart - 12 ||
        at - lastAccent < 4 * fps
      )
        return;
      if ((i * 5 + props.variant) % 3 !== 0) return;
      if (crafted(i) || camera.get(i - 1)?.out) return;
      if (plan.turns.some((t) => Math.abs(t - at) < 20)) return;
      if (
        (props.stamps ?? []).some(
          (st) => Math.abs(Math.round(st.at * fps) - at) < STAMP_FRAMES + 10,
        )
      )
        return;
      accents.push({ at, kind: old ? "static" : kinds[n++ % kinds.length]! });
      lastAccent = at;
    });
    return { dress: { punches, looks, photos, camera }, accents };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.suite,
    plan,
    words,
    emphasis,
    hookEnd,
    loopStart,
    old,
    year,
    fps,
    props.variant,
    props.stamps,
  ]);

  // The new-look opening poster needs the hero still under frame 0 (a Short opening on footage keeps the headline).
  const firstShot = plan.shots[0];
  const poster =
    props.suite &&
    firstShot?.media.type === "image" &&
    firstShot.media.index === plan.heroIndex
      ? props.images[plan.heroIndex]?.src
      : undefined;

  // A delay beat's two dates as the departures board's rows ("2027-03: Now March").
  const flapRows = (from: string, to: string) => {
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const when = (iso: string) => {
      const [, m, d] = iso.split("-").map(Number);
      return m ? `${MONTHS[m - 1]}${d ? ` ${d}` : ""}` : "";
    };
    const a = when(from);
    const b = when(to);
    return [`${from}: ${a ? `Was due ${a}` : "Was due"}`, `${to}: ${b ? `Now ${b}` : "Now due"}`];
  };

  // The new-look fact cards: each beat's card rotates between the house card and every vertical style that
  // can draw it (src/render/components/vertical), so two stats in a Short never look the same.
  const vstyleOf = useMemo(() => {
    const out = new Map<number, VStyle>();
    // A plan with the craft carries every card's look, chosen with the channel's memory (src/render/shortcraft.ts).
    if (plan.craft) {
      for (const c of plan.craft.cards)
        if (c.look !== HOUSE && V_STYLES[c.look]) out.set(c.segment, V_STYLES[c.look]!);
      return out;
    }
    if (!props.suite) return out;
    const turn = new Map<string, number>();
    props.segments.forEach((sg, i) => {
      const v = sg.visual;
      if (sg.kind !== "beat" || !v || v.kind === "none" || !v.primary.trim())
        return;
      const data = {
        kind: v.kind,
        primary: v.primary,
        secondary: v.secondary,
        items:
          v.kind === "timeline" && v.date_from && v.date_to
            ? flapRows(v.date_from, v.date_to)
            : (v.items ?? []),
      };
      // Plans from before the craft rotate through the packs they knew, so a re-render looks the same.
      const styles = Object.keys(V_STYLES_CORE)
        .sort()
        .map((k) => V_STYLES_CORE[k]!)
        .filter((st) => st.kind === v.kind && (!st.fits || st.fits(data)));
      if (!styles.length) return;
      const n = turn.get(v.kind) ?? 0;
      turn.set(v.kind, n + 1);
      const pick = [undefined, ...styles][
        (n + props.variant) % (styles.length + 1)
      ];
      if (pick) out.set(i, pick);
    });
    return out;
  }, [props.suite, props.segments, props.variant, plan.craft]);
  const madeYear = Number(String(props.renderDate ?? "").slice(0, 4)) || 2026;
  // The new-look motif sting: the story's series, console or genre look for a second as the hook ends.
  const motif = props.suite
    ? motifsFor({
        title: props.gameTitle,
        platforms: "",
        year,
        theme: props.gameTitle,
      })[0]
    : undefined;

  // The word moment's look (src/render/components/wordmoment): the plan's choice (src/render/wordlook.ts); a plan
  // from before the suite draws the rubber stamp, and a preview with no plan picks as the pipeline would.
  const firstStamp = props.stamps?.[0];
  const wordLook =
    W_STYLES[plan.wordLook ?? ""] ??
    W_STYLES[
      props.plan || !firstStamp
        ? DEFAULT_LOOK
        : pickWordLook(
            firstStamp,
            { year, motif: motif?.id, day: props.renderDate ?? "", seed: props.variant },
            [],
          )
    ]!;

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
  // The bed under the voice (src/render/musicplan.ts bedEnvelope): no pumping between sentences.
  const bedLevels = useMemo(
    () => bedEnvelope(speaking, fps, 0.085, 0.13),
    [speaking, fps],
  );
  const musicVolume = (f: number) => {
    const fadeIn = interpolate(f, [0, 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return fadeIn * (bedLevels[Math.min(durationInFrames, Math.max(0, f))] ?? 0.085);
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
      <Scrim profile={hasPlate && !props.images.length ? "plate" : "footage"} />
      <Finish grainSrc={staticFile("grain.png")} />

      {/* The headline is fully rendered at frame 0 (the thumbnail) and returns, pixel-identical, for the loop.
          On the new-look Shorts it is a thumbnail-grade poster over the hero art (components/HookPoster.tsx). */}
      <Sequence durationInFrames={hookEnd} layout="none">
        {poster ? (
          <HookPoster
            headline={props.headline}
            accent={accent}
            gameTitle={props.gameTitle}
            heroSrc={poster}
            cutSrc={props.heroCut?.fg}
            cutX={props.heroCut?.x}
            durationInFrames={hookEnd}
          />
        ) : (
          <HookHeadline
            headline={props.headline}
            accent={accent}
            gameTitle={props.gameTitle}
            durationInFrames={hookEnd}
          />
        )}
      </Sequence>
      {loopStart < durationInFrames ? (
        <Sequence
          from={Math.max(loopStart, durationInFrames - 2 * fps)}
          durationInFrames={Math.min(durationInFrames - loopStart, 2 * fps)}
          layout="none"
        >
          {poster ? (
            <HookPoster
              headline={props.headline}
              accent={accent}
              gameTitle={props.gameTitle}
              heroSrc={poster}
              cutSrc={props.heroCut?.fg}
            cutX={props.heroCut?.x}
              durationInFrames={Number.POSITIVE_INFINITY}
            />
          ) : (
            <HookHeadline
              headline={props.headline}
              accent={accent}
              gameTitle={props.gameTitle}
              durationInFrames={Number.POSITIVE_INFINITY}
            />
          )}
        </Sequence>
      ) : null}

      {props.segments.map((s, i) =>
        s.kind === "beat" || s.kind === "take" ? (
          <Sequence
            key={i}
            from={graphicWindow(i).from}
            durationInFrames={graphicWindow(i).len}
            layout="none"
          >
            {vstyleOf.get(i) ? (
              <div
                style={
                  vstyleOf.get(i)!.frame === "full"
                    ? { position: "absolute", inset: 0 }
                    : {
                        position: "absolute",
                        left: VBOX.left,
                        top: VBOX.top,
                        width: VBOX.width,
                        height: VBOX.height,
                      }
                }
              >
                {React.createElement(vstyleOf.get(i)!.component, {
                  v: {
                    kind: s.visual!.kind,
                    primary: s.visual!.primary,
                    secondary: s.visual!.secondary,
                    items: s.visual!.items ?? [],
                    date_to: s.visual!.date_to,
                    region: s.visual!.region,
                  },
                  storyYear: storyYearOf(
                    { kind: s.visual!.kind, primary: s.visual!.primary, secondary: s.visual!.secondary, items: [] },
                    madeYear,
                  ),
                  len: graphicWindow(i).len,
                  accent,
                  variant: props.variant + i,
                  src: props.images.find((im) => im.aspect >= 1.2)?.src,
                  year,
                })}
              </div>
            ) : (
              <FactCard
                segment={s}
                accent={accent}
                takeLabel={theme.takeLabel}
                durationInFrames={graphicWindow(i).len}
                renderDate={props.renderDate}
                images={props.images}
                rankTotal={rankTotal}
                beatIndex={beatIndexOf[i]}
                steamPrices={props.steam?.prices}
              />
            )}
          </Sequence>
        ) : null,
      )}

      {(plan.craft?.fillers ?? []).map((f, k) => (
        <Sequence key={`fill${k}`} from={f.from} durationInFrames={f.len} layout="none">
          <VFiller f={f} seed={props.variant + k} src={props.images.find((im) => im.aspect >= 1.2)?.src} />
        </Sequence>
      ))}
      {(plan.craft?.moves ?? []).map((m, k) =>
        m.kind === "freeze" ? (
          <Sequence key={`frz${k}`} from={m.at} durationInFrames={m.hold + 8} layout="none">
            <VFreezeLabel label={m.label} hold={m.hold} seconds={m.at / fps} accent={accent} />
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
          {React.createElement(wordLook.component, {
            stamp: { ...st, tone: st.tone as Tone | undefined },
            hold: STAMP_FRAMES,
            top: 930,
            size: 104,
            variant: props.variant,
          })}
        </Sequence>
      ))}
      {/* The shelf steps back while a stamp holds the band, so the two never overlap. */}
      <AbsoluteFill style={{ opacity: shelfLevel() }}>
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
        reserveRight={props.mascot ? 1016 - PIP_SHORT.left + 12 : 0}
      />
      {/* Pip the mascot test (props.mascot): in the brand band beside the logo row, clear of the Shorts header
          above, the right-hand rail below y 1000 and everything else on the Short. */}
      {props.mascot ? (
        <Pip
          words={words}
          reactions={(props.stamps ?? []).map((st) => st.at)}
          lookAt={(f) => {
            // At a stamp while it holds (it lands below, left of centre), at the headline in the hook, else at the viewer.
            const st = sinceLast(f, fps, (props.stamps ?? []).map((x) => x.at));
            if (st !== undefined && st < STAMP_FRAMES) return { x: -0.7, y: 0.8 };
            if (f < hookEnd) return { x: -0.6, y: 0.7 };
            return { x: -0.1, y: 0.1 };
          }}
          left={PIP_SHORT.left}
          top={PIP_SHORT.top}
          size={PIP_SHORT.size}
        />
      ) : null}
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
      {motif?.card &&
      props.images.length &&
      hookEnd < durationInFrames - 120 ? (
        <Sequence from={hookEnd} durationInFrames={MOTIF_STING} layout="none">
          <MotifSting>
            {/* Joined part-way through its build so the second shows the look already standing. */}
            <Sequence from={-40} layout="none">
              {React.createElement(motif.card, {
                heading: props.gameTitle,
                kicker: theme.chip,
                game: props.gameTitle,
                year: year ? String(year) : undefined,
                pictures: props.images
                  .filter((im) => im.aspect >= 1.2)
                  .map((im) => im.src)
                  .slice(0, 6),
                frames: 120,
                variant: props.variant,
              })}
            </Sequence>
          </MotifSting>
        </Sequence>
      ) : null}

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
