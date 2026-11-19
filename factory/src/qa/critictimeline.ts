// What the critic knows about a finished video before it looks (CRITIC, src/qa/criticcore.ts): its shots and the
// media each shows, the narration's sentences, the graphics as the renderer draws them, the chapters and their
// games, and the planned pauses. Built from the episode's stored script and assets exactly as the render built them
// (the graphics audit's own glue, src/qa/gfxgate.ts), so the critic and the renderer agree on every second. The
// pipeline's segment and stamp builders come in as arguments, which keeps this file free of src/pipeline.ts.

import { buildSegments, type SegmentInput } from "../render/timeline.ts";
import { TAIL_SECONDS } from "../render/plan.ts";
import { eraStampsFor } from "../editorial/everygame.ts";
import { stampColour } from "../render/brand.ts";
import { gfxInputOf, longMoments } from "./gfxgate.ts";
import { fixShortGraphics, shortElements } from "./gfxaudit.ts";
import {
  sentencesOf,
  type CriticGraphic,
  type CriticShot,
  type CriticTimeline,
  type CriticWord,
} from "./criticcore.ts";

type Row = {
  id: string;
  lane: string;
  script_json: any;
  assets_json: any;
  story_json?: any;
};

export interface TimelineDeps {
  segmentInputs: (script: any, desk?: boolean) => SegmentInput[];
  stampsFor: (
    script: any,
    words: Array<{ text: string; start: number }>,
  ) => Array<{ at: number; text: string; sub?: string }>;
  /** Episodes that ran the argument arm: their take has no card (src/pipeline.ts argumentArm). */
  argumentArm?: boolean;
  /** GRAPHICS_AUDIT=fix was on at the render: its moves, holds and drops are replayed (they are pure). */
  gfxFix?: boolean;
}

/** Cards the critic asked to hold longer (assets.criticHolds, "card3" to [from, to) seconds), set as visual.span. */
export function applyCriticHolds(
  segments: Array<{ visual?: { span?: [number, number] } }>,
  holds: Record<string, [number, number]> | undefined,
): number {
  let n = 0;
  for (const [key, span] of Object.entries(holds ?? {})) {
    const i = Number(key.replace(/^card/, ""));
    const v = segments[i]?.visual;
    if (!key.startsWith("card") || !Number.isInteger(i) || !v || !Array.isArray(span) || span.length !== 2) continue;
    v.span = [Number(span[0]), Number(span[1])];
    n++;
  }
  return n;
}

/** A plan shot's label for the report: the clip's label, else the first words of where it came from. */
function mediaLabel(
  assets: any,
  media: { type: string; index: number },
): { label: string; file?: string } {
  const list =
    media.type === "clip"
      ? assets.clips
      : media.type === "image"
        ? assets.images
        : undefined;
  const m = list?.[media.index];
  if (!m) return { label: media.type };
  const label = String(m.label || m.kind || "").trim();
  const prov = String(m.provenance || "")
    .replace(/\s+/g, " ")
    .slice(0, 400);
  return {
    label: [label, prov].filter(Boolean).join(" · ").slice(0, 480),
    file: m.file,
  };
}

/** Every name the script carries, for telling a game the video talks about from a wrong one (pure). */
export function mentionsOf(row: Row): string {
  const s = row.script_json ?? {};
  return [
    s.headline,
    s.game_title,
    s.hook,
    ...(s.beats ?? []).map((b: any) => b?.narration),
    s.pulse_take?.narration,
    s.loop_line,
    s.kicker,
    ...(s.entries ?? []).flatMap((e: any) => [
      e?.game_title,
      e?.title,
      e?.name,
      JSON.stringify(e?.moments ?? []),
    ]),
    JSON.stringify(s.claims ?? []),
    s.attribution,
    s.youtube?.title,
    row.story_json?.headline,
    row.story_json?.title,
  ]
    .filter((x) => typeof x === "string" && x)
    .join(" ");
}

/** The critic's timeline of a Short (or any lane rendered by the Short composition). */
export function shortTimeline(row: Row, deps: TimelineDeps): CriticTimeline {
  const script = row.script_json;
  const assets = row.assets_json;
  const plan = assets.plan;
  const fps: number = plan.fps;
  const words: CriticWord[] = assets.words ?? [];
  const duration = (assets.durationSeconds ?? 30) + TAIL_SECONDS;
  const segments = buildSegments(
    deps.segmentInputs(script, Boolean(assets.desk)),
    words,
    duration,
  );
  if (deps.argumentArm)
    for (const g of segments) if (g.kind === "take") g.visual = undefined;
  const muted: string[] = assets.gfxMuted ?? [];
  segments.forEach((g, i) => {
    if (
      muted.includes(`card${i}`) &&
      g.kind !== "take" &&
      g.visual?.kind !== "rank"
    )
      g.visual = undefined;
  });
  const stamps = [
    ...deps.stampsFor(script, words),
    ...eraStampsFor(
      script,
      segments.filter((g) => g.kind === "beat").map((g) => g.start),
      stampColour("neutral"),
    ),
  ];
  applyCriticHolds(segments, assets.criticHolds);
  let input = gfxInputOf({ script, assets, segments, words, plan, stamps, clean: true });
  if (deps.gfxFix) {
    const r = fixShortGraphics(input);
    input = { ...input, segments: r.segments, stamps: r.stamps, plan: { ...input.plan, shelf: r.shelf, craft: r.craft } };
  }
  const { elements } = shortElements(input);
  const graphics: CriticGraphic[] = elements
    .filter((e) => e.words > 0 && e.to > e.from && e.kind !== "filler")
    .map((e) => ({
      key: e.key,
      kind: e.kind,
      from: e.from / fps,
      to: e.to / fps,
      text: e.text,
      words: e.words,
    }));
  const shots: CriticShot[] = (plan.shots ?? []).map(
    (s: any, index: number) => ({
      index,
      start: s.start / fps,
      end: s.end / fps,
      media: { type: s.media.type, index: s.media.index },
      ...mediaLabel(assets, s.media),
    }),
  );
  const freezes = (plan.craft?.moves ?? [])
    .filter((m: any) => m.kind === "freeze")
    .map((m: any) => ({ start: m.at / fps, end: (m.at + m.hold) / fps }));
  return {
    kind: "short",
    duration: plan.totalFrames / fps,
    fps,
    headline: script.headline ?? "",
    game: script.game_title ?? "",
    chapters: [],
    mentions: mentionsOf(row),
    shots,
    lines: sentencesOf(words),
    graphics,
    breaks: [],
    freezes,
    tailFrom: (plan.totalFrames - (plan.tailFrames ?? 0)) / fps,
  };
}

/** The critic's timeline of a long video (documentary, ranking, recap). */
export function longTimeline(row: Row, deps: TimelineDeps): CriticTimeline {
  const script = row.script_json;
  const assets = row.assets_json;
  const plan = assets.longPlan;
  const fps: number = plan.fps;
  const words: CriticWord[] = assets.words ?? [];
  const { moments } = longMoments(script, assets, deps.segmentInputs as never);
  const graphics: CriticGraphic[] = moments
    .filter((m) => m.text.trim() && m.len > 0)
    .map((m) => ({
      key: m.key,
      kind: m.kind,
      from: m.from,
      to: m.from + m.len,
      text: m.checked || m.text,
      words: (m.checked || m.text).split(/\s+/).filter(Boolean).length,
    }));
  const shots: CriticShot[] = (plan.shots ?? []).map(
    (s: any, index: number) => ({
      index,
      start: s.start / fps,
      end: s.end / fps,
      media: { type: s.media.type, index: s.media.index },
      ...mediaLabel(assets, s.media),
    }),
  );
  const entries = [...(script.entries ?? [])].sort(
    (a: any, b: any) => b.rank - a.rank,
  );
  const starts: number[] = assets.entryStarts ?? [];
  const total = plan.totalFrames / fps;
  const chapters = starts.map((start, i) => ({
    start,
    end: starts[i + 1] ?? total,
    game: String(entries[i]?.game_title ?? script.game_title ?? ""),
  }));
  return {
    kind: "long",
    duration: total,
    fps,
    headline: script.headline ?? "",
    game: script.game_title ?? "",
    chapters,
    mentions: mentionsOf(row),
    shots,
    lines: sentencesOf(words),
    graphics,
    breaks: (assets.breaks ?? []).map((b: any) => ({
      start: Number(b.start),
      end: Number(b.end),
    })),
    freezes: [],
    tailFrom: (plan.totalFrames - (plan.tailFrames ?? 0)) / fps,
  };
}

/** The timeline for whatever the episode is; undefined when it has no stored plan to read. */
export function criticTimeline(
  row: Row,
  deps: TimelineDeps,
): CriticTimeline | undefined {
  const a = row.assets_json ?? {};
  if (row.lane === "longform" && a.longPlan?.shots?.length)
    return longTimeline(row, deps);
  if (a.plan?.shots?.length && a.plan.fps) return shortTimeline(row, deps);
  return undefined;
}
