// RETENTION_DIRECTOR's two places in the factory (src/retentiondirector.ts, src/retentionmodel.ts):
//   - directorStep: in the Short's render step, once the shot plan is built and before the first-seconds check and the
//     render, it predicts, advises and (under "fix") applies the safe fixes. Runs once per episode (the result is kept
//     in assets.retention); a retried render reuses the directed plan and repeats the card trims. Never throws.
//   - retrainTick: once a week (and at once when there is no model yet) it retrains the model from the stored curves
//     (video_metrics "curve" and "curve_2d", the same rows RETENTION_LEARN and the week-old capture write) and saves
//     it under the data folder with its held-out scores and findings. The findings reach the writers through the
//     weekly analytics report (src/analyticsloop.ts), next to RETENTION_LEARN's curve lessons.
import type { Db } from "./db.ts";
import type { RenderPlan } from "./render/plan.ts";
import type { Segment } from "./render/timeline.ts";
import type { Script } from "./editorial/schema.ts";
import type { Word } from "./voice/elevenlabs.ts";
import { logEvent } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";
import { studyRows } from "./retentionlearn.ts";
import {
  applyCardTrim,
  crossValidate,
  stableFindings,
  modelLessonLines,
  samplesOf,
  shortFrame,
  trainModel,
  type CardTrim,
  type RetentionModel,
  type SegmentsOf,
  type TrainItem,
} from "./retentionmodel.ts";
import {
  directorSummary,
  directShort,
  loadModel,
  saveModel,
  type DirectorMode,
  type DirectorReport,
} from "./retentiondirector.ts";

/** The director's record on the episode (assets.retention). */
export interface RetentionRecord {
  at: string;
  mode: DirectorMode;
  cardTrims: CardTrim[];
  report?: DirectorReport;
  skipped?: string;
  /** Under "fix", the shots as planned before the director changed them, so a QA failure can put them back. */
  shotsBefore?: RenderPlan["shots"];
  /** Set when a QA failure after the director's changes put the original plan back. */
  reverted?: string;
}

/** A failed attempt whose error is the render's QA gate (a frame check, the graphics check): the fixes are suspects. */
const QA_FAILED_RE = /^QA failed/;

export async function directorStep(
  s: {
    db: Db;
    cfg: { retentionDirector: DirectorMode; dataDir: string };
    now: () => Date;
  },
  ep: { id: string; lane: string; last_error?: string | null },
  x: {
    assets: any;
    script: Script;
    words: Word[];
    segments: Segment[];
    plan: RenderPlan;
    gameAudio?: unknown;
    segmentsOf: SegmentsOf;
  },
): Promise<void> {
  const prior = x.assets.retention as RetentionRecord | undefined;
  // A retry: the plan is the directed one already; the card trims go back on the rebuilt segments.
  if (prior?.at) {
    // Footage the director swapped in was screened with its clip, but not every frame of it was seen by the frame
    // check: when the render then fails QA, the director's changes go and the planned shots come back.
    if (prior.shotsBefore && !prior.reverted && QA_FAILED_RE.test(ep.last_error ?? "")) {
      x.plan.shots = prior.shotsBefore;
      prior.cardTrims = [];
      prior.reverted = ep.last_error!.slice(0, 200);
      await logEvent(s.db, ep.id, "retention_director_reverted", { why: prior.reverted });
      log("warn", "retention director changes reverted after a QA failure", { episode: ep.id });
      return;
    }
    for (const t of prior.cardTrims ?? []) applyCardTrim(x.segments, t);
    return;
  }
  const mode = s.cfg.retentionDirector;
  if (mode === "off" || ep.lane === "longform") return;
  const at = s.now().toISOString();
  const model = loadModel(s.cfg.dataDir);
  if (!model) {
    x.assets.retention = {
      at,
      mode,
      cardTrims: [],
      skipped: "no trained model yet",
    } satisfies RetentionRecord;
    return;
  }
  const shotsBefore = structuredClone(x.plan.shots);
  try {
    const report = directShort(
      model,
      {
        lane: ep.lane,
        script: x.script,
        words: x.words,
        spokenSeconds: Number(x.assets.durationSeconds ?? 0),
        segments: x.segments,
        plan: x.plan,
        images: x.assets.images ?? [],
        clips: x.assets.clips ?? [],
        gameAudio: x.gameAudio,
        desk: Boolean(x.assets.desk),
      },
      mode,
      x.segmentsOf,
      s.now(),
    );
    x.assets.retention = {
      at,
      mode,
      cardTrims: report?.cardTrims ?? [],
      ...(report ? { report } : { skipped: "records too thin to predict" }),
      ...(mode === "fix" && report?.fixes.some((f) => f.kind !== "card_text") ? { shotsBefore } : {}),
    } satisfies RetentionRecord;
    if (report) {
      await logEvent(s.db, ep.id, "retention_director", {
        mode,
        summary: directorSummary(report),
        predicted: report.predicted,
        usual: report.usual,
        after: report.after,
        fixes: report.fixes,
        weak: report.weak.map((w) => ({
          from: w.from,
          to: w.to,
          excess: w.excess,
          said: w.said,
          onScreen: w.onScreen,
        })),
        advice: report.advice,
      });
      log("info", "retention director", {
        episode: ep.id,
        mode,
        summary: directorSummary(report),
      });
    }
  } catch (err) {
    x.assets.retention = {
      at,
      mode,
      cardTrims: [],
      skipped: `failed: ${errorMessage(err)}`,
    } satisfies RetentionRecord;
    log("warn", "retention director failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
  }
}

/** How often the model is retrained. */
export const RETRAIN_DAYS = 7;
/** Fewer Shorts with a curve than this and no model is trained (or replaced). */
export const MIN_TRAIN_SHORTS = 40;

/** The stored curves as training items (Shorts only, with records). */
export async function trainItemsFromDb(
  db: Db,
  now: Date,
  segmentsOf: SegmentsOf,
): Promise<TrainItem[]> {
  const rows = await studyRows(db, now, {
    days: 365,
    limit: 2000,
    shortsOnly: true,
  });
  const views = new Map(
    (
      await db.query<{ episode_id: string; views: number }>(
        `SELECT DISTINCT ON (episode_id) episode_id, views FROM video_metrics WHERE label IN ('7d','72h','24h') ORDER BY episode_id, captured_at DESC`,
      )
    ).map((r) => [r.episode_id, Number(r.views)]),
  );
  const items: TrainItem[] = [];
  for (const r of rows) {
    if (r.curve.length < 20) continue;
    const frame = shortFrame(r, segmentsOf);
    if (frame && frame.duration <= 65)
      items.push({
        video: r.videoId,
        frame,
        curve: r.curve,
        views: views.get(r.id) ?? 500,
      });
  }
  return items.reverse();
}

/** Retrains and saves the model when it is a week old or missing; returns it when it trained. Never throws. */
export async function retrainTick(s: {
  db: Db;
  cfg: { retentionDirector: DirectorMode; dataDir: string };
  now: () => Date;
  segmentsOf: SegmentsOf;
  notify?: (m: { level?: "info"; content: string }) => Promise<unknown>;
}): Promise<RetentionModel | undefined> {
  if (s.cfg.retentionDirector === "off") return undefined;
  const now = s.now();
  const prev = loadModel(s.cfg.dataDir);
  if (
    prev &&
    now.getTime() - new Date(prev.trainedAt).getTime() <
      RETRAIN_DAYS * 86_400_000
  )
    return undefined;
  try {
    const items = await trainItemsFromDb(s.db, now, s.segmentsOf);
    if (items.length < MIN_TRAIN_SHORTS) {
      log("info", "retention model not trained: too few Shorts with a curve", {
        shorts: items.length,
        need: MIN_TRAIN_SHORTS,
      });
      return undefined;
    }
    const model = trainModel(items, [], now);
    const cv = crossValidate(items, [], 5);
    model.validation = cv.validation;
    model.findings = stableFindings(
      model,
      cv.models,
      items.flatMap((i) => samplesOf(i.video, i.frame, model.baseline, i.curve, i.views).map((q) => q.x)),
    );
    saveModel(s.cfg.dataDir, model);
    await logEvent(s.db, null, "retention_model_trained", {
      shorts: items.length,
      validation: model.validation,
      findings: model.findings.slice(0, 8),
    });
    const v = model.validation;
    log("info", "retention model retrained", {
      shorts: items.length,
      withinSpearman: v.withinSpearman.gbm,
      dropPrecision: v.drops.precision,
      chance: v.drops.randomPrecision,
    });
    await s.notify?.({
      level: "info",
      content:
        `Retention model retrained on ${items.length} Shorts. Held out, it ranks the weak moments inside a Short with a correlation of ${v.withinSpearman.gbm.toFixed(2)} and its flagged moments land on real drops ${Math.round(v.drops.precision * 100)}% of the time (chance: ${Math.round(v.drops.randomPrecision * 100)}%). ${modelLessonLines(
          model,
          now.toISOString().slice(0, 10),
          2,
        ).join(" ")}`.trim(),
    });
    return model;
  } catch (err) {
    log("warn", "retention model retrain failed", { error: errorMessage(err) });
    return undefined;
  }
}

/** The model's lessons for the weekly report, or none while the director is off or no model exists. */
export function retentionModelLessons(
  cfg: { retentionDirector: DirectorMode; dataDir: string },
  now: Date,
): string[] {
  if (cfg.retentionDirector === "off") return [];
  const m = loadModel(cfg.dataDir);
  return m ? modelLessonLines(m, now.toISOString().slice(0, 10)) : [];
}
