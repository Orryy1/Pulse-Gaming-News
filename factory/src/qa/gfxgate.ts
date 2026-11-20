// The graphics audit's glue (src/qa/gfxaudit.ts): what a Short's or a long video's audit reads, built from the
// episode's script and assets the way the renderer builds them. No database and no network, so the smoke audit
// (data/smoke/gfxaudit.mts) and the pipeline's gate measure the same thing.

import type { Segment } from "../render/timeline.ts";
import type { RenderPlan } from "../render/plan.ts";
import { buildSegments } from "../render/timeline.ts";
import {
  LONG_TAIL_SECONDS,
  momentKeys,
  momentWindows,
  openChaptersAtBreaks,
  usefulGraphic,
} from "../render/longplan.ts";
import { sentenceSpan } from "../render/momentspan.ts";
import type { LongGfxMoment, ShortGfxInput } from "./gfxaudit.ts";

export { graphicsAuditMode, type GraphicsAuditMode } from "../config.ts";

// Loose shapes: the script and assets as stored (src/editorial/schema.ts, src/episodes.ts).
type AnyScript = {
  headline?: string;
  hook?: string;
  beats?: Array<{ narration?: string }>;
  pulse_take?: { narration?: string; on_screen?: string };
  loop_line?: string;
  claims?: unknown[];
  attribution?: string;
  stamp?: { text?: string };
  entries?: Array<
    Record<string, unknown> & { rank: number; moments?: unknown[] }
  >;
  sources?: unknown;
  game_title?: string;
};
type AnyAssets = {
  steam?: { facts?: unknown; name?: string };
  quotes?: Array<{ start: number; seconds: number }>;
};

/** What the narration says, as written (figures in digits). */
export function writtenNarration(script: AnyScript): string {
  return [
    script.hook,
    ...(script.beats ?? []).map((b) => b.narration),
    script.pulse_take?.narration,
    script.loop_line,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Everything else a figure may come from: claims, attribution, the store's facts and each entry's details. */
export function figureSources(script: AnyScript, assets: AnyAssets): string {
  const entries = (script.entries ?? []).map(
    ({ moments: _m, ...rest }) => rest,
  );
  return [
    script.headline,
    JSON.stringify(script.claims ?? []),
    script.attribution,
    JSON.stringify(assets.steam?.facts ?? {}),
    JSON.stringify(entries),
    JSON.stringify(script.sources ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

/** The audit's input for a Short, from what stepRender already has in hand. */
export function gfxInputOf(o: {
  script: AnyScript;
  assets: AnyAssets;
  segments: Segment[];
  words: Array<{ text: string; start: number; end: number }>;
  plan: Pick<
    RenderPlan,
    "fps" | "totalFrames" | "tailFrames" | "shelf" | "craft"
  >;
  stamps: ShortGfxInput["stamps"];
  clean: boolean;
}): ShortGfxInput {
  return {
    segments: o.segments,
    words: o.words,
    plan: o.plan,
    stamps: o.stamps,
    stampWritten: o.script.stamp?.text,
    clean: o.clean,
    headline: o.script.headline ?? "",
    narration: writtenNarration(o.script),
    sources: figureSources(o.script, o.assets),
    quotes: (o.assets.quotes ?? []).map((q) => ({
      start: q.start,
      seconds: q.seconds,
    })),
  };
}

/**
 * A long video's sentence graphics with the spans the renderer draws them for (src/render/momentspan.ts), muted
 * ones and those a filler shot replaces left out, as src/pipeline.ts stepRenderLong builds them.
 */
export function longMoments(
  script: AnyScript &
    Parameters<typeof import("../pipeline.ts").segmentInputs>[0],
  assets: {
    words?: Array<{ text: string; start: number; end: number }>;
    durationSeconds?: number;
    breaks?: Array<{ start: number; end: number }>;
    quietMoments?: string[];
    desk?: unknown;
    longPlan?: {
      shots: Array<{
        start: number;
        media: { type: string; entry?: number; index: number };
      }>;
    };
    steam?: { facts?: unknown };
  },
  segmentInputsOf: typeof import("../pipeline.ts").segmentInputs,
): {
  moments: LongGfxMoment[];
  narration: string;
  sources: string;
  spoken: string[];
} {
  const words = assets.words ?? [];
  const duration = (assets.durationSeconds ?? 300) + LONG_TAIL_SECONDS;
  const segments = openChaptersAtBreaks(
    buildSegments(
      segmentInputsOf(script, Boolean(assets.desk)),
      words,
      duration,
    ),
    assets.breaks,
  );
  type M = {
    graphic: {
      kind: string;
      primary: string;
      secondary: string;
      items?: string[];
    };
    emphasis?: string;
  };
  const moments = [...(script.entries ?? [])]
    .sort((a, b) => b.rank - a.rank)
    .map((e) => (e.moments ?? []) as M[]);
  const windows = momentWindows(
    segments,
    words,
    moments.map((m) => m.length),
    moments.map((e) => e.map((m) => momentKeys(m as never))),
  );
  const fillerStart = new Map<string, number>();
  for (const sh of assets.longPlan?.shots ?? [])
    if (sh.media.type === "filler" && sh.media.entry !== undefined)
      fillerStart.set(`${sh.media.entry}:${sh.media.index}`, sh.start);
  const quiet = new Set(assets.quietMoments ?? []);
  const out: LongGfxMoment[] = [];
  windows.forEach((w, k) => {
    const key = `${w.entry}:${w.moment}`;
    const m = moments[w.entry]?.[w.moment];
    if (
      !m?.graphic ||
      !usefulGraphic(m.graphic) ||
      quiet.has(key) ||
      fillerStart.has(key)
    )
      return;
    const sp = sentenceSpan(windows, k, 30, {
      moment: (e, j) => moments[e]?.[j],
      fillerStart: (e, j) => fillerStart.get(`${e}:${j}`),
    });
    const g = m.graphic;
    out.push({
      key,
      kind: g.kind,
      text: [
        g.primary,
        g.secondary,
        ...(g.items ?? []).map((x) => x.replace(/:/g, " ")),
      ]
        .filter(Boolean)
        .join(" "),
      ...(g.kind === "source"
        ? { checked: [...(g.items ?? []), g.secondary].filter(Boolean).join(" ") }
        : {}),
      from: sp.from / 30,
      len: sp.len / 30,
      short: sp.short,
      sentence: words
        .filter((x) => x.start >= w.start - 0.02 && x.start < w.end)
        .map((x) => x.text)
        .join(" "),
      at: w.at,
      start: w.start,
      end: w.end,
    });
  });
  return {
    moments: out,
    narration: [
      script.hook,
      ...(script.beats ?? []).map((b) => b.narration),
      script.pulse_take?.narration,
      script.loop_line,
    ]
      .filter(Boolean)
      .join(" "),
    sources: figureSources(script, assets),
    spoken: words.map((x) => x.text),
  };
}
