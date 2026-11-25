// SHOT_PLAN_PANEL's place in the factory (src/render/planpanel.ts): in the Short's render step, once the plan is built
// from fresh media and before the rubric's rebuild, the director, the first-seconds check and the render. Off, nothing
// here runs. It reads the last few Shorts' plans for the sameness measure, asks the picture editor critic through the
// factory's own model client and the retention model when RETENTION_DIRECTOR has one, and records the result on
// assets.plan_panel and as a "plan_panel" event. Never throws: a failure leaves the plan as the factory built it.

import type { Db } from "./db.ts";
import type { Llm } from "./editorial/llm.ts";
import type { Script } from "./editorial/schema.ts";
import type { Rubric } from "./qa/rubric.ts";
import type { PlanInput, RenderPlan } from "./render/plan.ts";
import type { Segment } from "./render/timeline.ts";
import type { Word } from "./voice/elevenlabs.ts";
import type { SegmentsOf } from "./retentionmodel.ts";
import { logEvent } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";
import {
  beatOf,
  cardMedia,
  CARD,
  planSignature,
  type PanelContext,
  type PlanSignature,
} from "./render/plancards.ts";
import {
  panelApplies,
  panelArm,
  panelEvent,
  readPlan,
  runPanel,
  type PanelMode,
  type PlanPanelRecord,
} from "./render/planpanel.ts";

/** The games a script names (pure): its own game, a ranking's entries and the two sides of a versus card. */
export function scriptGames(
  script: Pick<Script, "game_title" | "beats"> & {
    entries?: Array<{ game_title: string }>;
  },
): string[] {
  const out = [
    script.game_title,
    ...(script.entries ?? []).map((e) => e.game_title),
  ];
  for (const b of script.beats ?? [])
    if (b.visual?.kind === "versus")
      for (const row of b.visual.items ?? []) {
        const label = String(row).split(":")[0]!.replace(/^\*/, "").trim();
        if (label) out.push(label);
      }
  return out.filter(
    (g, k) =>
      g && out.findIndex((x) => x.toLowerCase() === g.toLowerCase()) === k,
  );
}

/** The panel's view of a Short (pure): its segments, each beat's footage keywords, its media and its games. */
export function panelContext(
  script: Script,
  segments: Segment[],
  assets: { images?: unknown[]; clips?: unknown[] },
): PanelContext {
  const games = scriptGames(
    script as Script & { entries?: Array<{ game_title: string }> },
  );
  const beats = beatOf(segments);
  const media = cardMedia(
    (assets.images ?? []) as never[],
    (assets.clips ?? []) as never[],
    games,
  );
  return {
    segments,
    lineKeywords: segments.map((_, i) => {
      const b = beats[i];
      return b === undefined
        ? []
        : [...(script.beats[b]?.footage?.keywords ?? [])];
    }),
    images: media.images,
    clips: media.clips,
    game: script.game_title,
    games,
  };
}

/** The last few Shorts' plan signatures, newest first (never this episode's). Empty on any failure. */
export async function recentSignatures(
  db: Db,
  episodeId: string,
): Promise<PlanSignature[]> {
  try {
    const rows = await db.query<{ plan: unknown }>(
      `SELECT assets_json->'plan' AS plan FROM episodes
        WHERE id <> $1 AND lane <> 'longform' AND assets_json->'plan'->'shots' IS NOT NULL
        ORDER BY created_at DESC LIMIT ${CARD.recentPlans}`,
      [episodeId],
    );
    return rows
      .map(
        (r) =>
          (typeof r.plan === "string"
            ? JSON.parse(r.plan)
            : r.plan) as RenderPlan | null,
      )
      .filter((p): p is RenderPlan => !!p && Array.isArray(p.shots))
      .map((p) => planSignature(p));
  } catch {
    return [];
  }
}

export async function planPanelStep(
  s: {
    db: Db;
    llm: Llm;
    cfg: {
      shotPlanPanel: PanelMode;
      shotPlanPanelShare: number;
      shotPlanCandidates: number;
      retentionDirector: string;
      dataDir: string;
    };
    now: () => Date;
  },
  ep: { id: string; lane: string; story_json?: object | null },
  x: {
    assets: {
      images?: unknown[];
      clips?: unknown[];
      plan_panel?: PlanPanelRecord;
      durationSeconds?: number;
      desk?: unknown;
    };
    script: Script;
    words: Word[];
    segments: Segment[];
    input: PlanInput;
    plan: RenderPlan;
    rubric: (plan: RenderPlan) => Rubric;
    segmentsOf: SegmentsOf;
    gameAudio?: unknown;
  },
): Promise<RenderPlan> {
  const mode = s.cfg.shotPlanPanel;
  if (mode === "off" || x.assets.plan_panel?.at) return x.plan;
  const story = (ep.story_json ?? {}) as Record<string, unknown>;
  if (
    !panelApplies({
      lane: ep.lane,
      why: !!story.why,
      reply: !!story.reply,
      search: !!story.search,
      gtaFile: !!story.gtaFile,
      entries:
        (x.script as Script & { entries?: unknown[] }).entries?.length ?? 0,
      everyGame: !!(x.script as Script & { every_game?: unknown }).every_game,
    })
  )
    return x.plan;
  try {
    const arm = panelArm(ep.id, s.cfg.shotPlanPanelShare);
    const ctx = panelContext(x.script, x.segments, x.assets);
    const recent = await recentSignatures(s.db, ep.id);
    let predict: ((plan: RenderPlan) => number | undefined) | undefined;
    if (arm === "panel" && s.cfg.retentionDirector !== "off") {
      const { loadModel, frameOf } = await import("./retentiondirector.ts");
      const { predictFrame } = await import("./retentionmodel.ts");
      const model = loadModel(s.cfg.dataDir);
      if (model)
        predict = (plan) => {
          const f = frameOf(
            {
              lane: ep.lane,
              script: x.script,
              words: x.words,
              spokenSeconds: Number(x.assets.durationSeconds ?? 0),
              segments: x.segments,
              plan,
              images: (x.assets.images ?? []) as never[],
              clips: (x.assets.clips ?? []) as never[],
              gameAudio: x.gameAudio,
              desk: Boolean(x.assets.desk),
            },
            x.segmentsOf,
          );
          return f ? 100 * predictFrame(model, f).avg : undefined;
        };
    }
    const { plan, record } = await runPanel({
      mode,
      arm,
      input: x.input,
      base: x.plan,
      ctx,
      recent,
      candidates: s.cfg.shotPlanCandidates,
      rubric: x.rubric,
      read: arm === "panel" ? (card) => readPlan(s.llm, card) : undefined,
      predict,
      now: s.now(),
    });
    x.assets.plan_panel = record;
    await logEvent(s.db, ep.id, "plan_panel", panelEvent(record)).catch(
      () => undefined,
    );
    log("info", "shot plan panel", {
      episode: ep.id,
      arm,
      mode,
      pick: record.pick,
      reads: record.calls.critic,
      fix: record.fix?.kept ?? false,
    });
    return plan;
  } catch (err) {
    log("warn", "shot plan panel failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
    return x.plan;
  }
}
