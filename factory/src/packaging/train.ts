// Fitting and backtesting the Packaging Lab's title model (pure: rows in, models and a report out). The tool in
// ./tools/train.ts reads the files and writes src/packaging/model.default.json and the report.
//
// For each format (Short, long video) there are up to four heads:
//   prior   other channels' titles against their own neighbouring uploads (the study corpus)
//   views   Pulse views at 72 hours against the Pulse videos posted either side of it (channel growth removed)
//   viewed  the share of a Short's views that were engaged views (the swipe-away test), read from the spoken hook
//   ctr     click-through on thumbnail impressions (search tiles for Shorts, browse and search for long videos)
// The Pulse heads are fitted with the prior's weights as their prior, so few Pulse rows bend rather than replace it.
// The backtest holds out the newest 30% of Pulse videos (the honest split: the model only ever sees the past).
import { TITLE_FEATURES, titleFeatures, toRow } from "./features.ts";
import {
  fitRidge,
  pairwiseAccuracy,
  predict,
  spearman,
  topWeights,
  type LinearModel,
  type Sample,
} from "./model.ts";
import {
  neighbourScores,
  type Format,
  type PulseRow,
  type StudyRow,
} from "./corpus.ts";

export type Head = "prior" | "views" | "viewed" | "ctr";

export interface PackagingModel {
  version: 1;
  trainedAt: string;
  features: string[];
  /** Per format, per head; a missing head falls back to the prior. */
  heads: Record<Format, Partial<Record<Head, LinearModel>>>;
  /** How the heads combine into one score per format (weights sum to 1). */
  blend: Record<Format, Partial<Record<Head, number>>>;
  meta: Record<string, unknown>;
}

const NAMES = [...TITLE_FEATURES];

export const CTR_MIN_IMPRESSIONS = 300;

const logit = (p: number) =>
  Math.log(Math.max(1e-4, p) / Math.max(1e-4, 1 - p));

/** Pulse rows' targets for each head (pure); undefined where a video has no figure for it. */
export function pulseTargets(
  rows: PulseRow[],
): Map<string, Partial<Record<Head, number>>> {
  const out = new Map<string, Partial<Record<Head, number>>>();
  for (const f of ["short", "long"] as Format[]) {
    const list = rows
      .filter((r) => r.format === f && r.views72 !== undefined)
      .sort((a, b) => b.liveAt.localeCompare(a.liveAt));
    const z = neighbourScores(
      list.map((r) => r.views72!),
      8,
      0,
    );
    list.forEach((r, i) =>
      out.set(r.id, {
        ...(out.get(r.id) ?? {}),
        ...(z[i] !== undefined ? { views: z[i] } : {}),
      }),
    );
  }
  for (const r of rows) {
    const t = out.get(r.id) ?? {};
    if (r.viewedRate !== undefined && r.format === "short")
      t.viewed = r.viewedRate;
    if (r.ctr !== undefined && (r.impressions ?? 0) >= CTR_MIN_IMPRESSIONS)
      t.ctr = logit(r.ctr);
    out.set(r.id, t);
  }
  return out;
}

/** The text a head reads: the spoken hook for the viewed head (it is what the first seconds say), else the title. */
export const headText = (
  r: Pick<PulseRow, "title" | "hook" | "thumbText">,
  head: Head,
): string => (head === "viewed" ? r.thumbText || r.hook || r.title : r.title);

const rowX = (text: string, game?: string) =>
  toRow(titleFeatures(text, { game }), NAMES);

export interface HeadReport {
  format: Format;
  head: Head;
  train: number;
  test: number;
  /** Pairwise accuracy on the held-out newest videos. */
  prior: number;
  pulseOnly: number;
  blended: number;
  spearman: number;
  pairs: number;
  lambda: number;
}

/** Fits the prior on the study corpus, holding out every fifth channel to measure it. */
export function fitPrior(
  study: StudyRow[],
  format: Format,
): {
  model: LinearModel;
  heldOut: { accuracy: number; pairs: number };
  rows: number;
} {
  const rows = study.filter((r) => r.format === format);
  const channels = [...new Set(rows.map((r) => r.channel))].sort();
  const test = new Set(channels.filter((_, i) => i % 5 === 4));
  const toSample = (r: StudyRow): Sample => ({
    x: rowX(r.title),
    y: r.z,
    group: r.channel,
  });
  const train = rows.filter((r) => !test.has(r.channel)).map(toSample);
  const held = rows.filter((r) => test.has(r.channel)).map(toSample);
  const m = fitRidge(NAMES, train, 50);
  const heldOut = pairwiseAccuracy(
    held.map((s) => ({ score: predict(m, s.x), y: s.y, group: s.group })),
  );
  // The model that ships is fitted on every channel.
  return {
    model: fitRidge(NAMES, rows.map(toSample), 50),
    heldOut,
    rows: rows.length,
  };
}

/** Fits one Pulse head and backtests it on the newest 30% (pure). */
export function fitHead(
  rows: PulseRow[],
  targets: Map<string, Partial<Record<Head, number>>>,
  format: Format,
  head: Exclude<Head, "prior">,
  prior: LinearModel,
): { model?: LinearModel; report?: HeadReport } {
  const usable = rows
    .filter(
      (r) => r.format === format && targets.get(r.id)?.[head] !== undefined,
    )
    .sort((a, b) => a.liveAt.localeCompare(b.liveAt));
  if (usable.length < 12) return {};
  const cut = Math.floor(usable.length * 0.7);
  // Every head's target in standard units (from the training rows only), so the prior's weights mean the same thing.
  const ys = usable.slice(0, cut).map((r) => targets.get(r.id)![head]!);
  const mu = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sd =
    Math.sqrt(ys.reduce((a, b) => a + (b - mu) ** 2, 0) / ys.length) || 1;
  const toSample = (r: PulseRow): Sample => ({
    x: rowX(headText(r, head), r.game),
    y: (targets.get(r.id)![head]! - mu) / sd,
  });
  const train = usable.slice(0, cut).map(toSample);
  const test = usable.slice(cut).map(toSample);
  const acc = (m: LinearModel) =>
    pairwiseAccuracy(test.map((s) => ({ score: predict(m, s.x), y: s.y })));
  // Lambda picked on the training rows alone: fit on their older 70%, judge on their newer 30%.
  const inner = Math.floor(train.length * 0.7);
  const lambdas = [2, 8, 30, 120, 500];
  const innerAcc = (l: number) =>
    pairwiseAccuracy(
      train.slice(inner).map((s) => ({
        score: predict(fitRidge(NAMES, train.slice(0, inner), l, prior), s.x),
        y: s.y,
      })),
    ).accuracy;
  const lambda = lambdas.reduce(
    (best, l) => (innerAcc(l) > innerAcc(best) ? l : best),
    120,
  );
  const blendedModel = fitRidge(NAMES, train, lambda, prior);
  const pulseOnly = fitRidge(NAMES, train, 30);
  const b = acc(blendedModel);
  const report: HeadReport = {
    format,
    head,
    train: train.length,
    test: test.length,
    prior: acc(prior).accuracy,
    pulseOnly: acc(pulseOnly).accuracy,
    blended: b.accuracy,
    spearman: spearman(
      test.map((s) => predict(blendedModel, s.x)),
      test.map((s) => s.y),
    ),
    pairs: b.pairs,
    lambda,
  };
  // The model that ships learns from every Pulse video, with the lambda the past chose.
  return {
    model: fitRidge(NAMES, usable.map(toSample), lambda, prior),
    report,
  };
}

/**
 * The blend: each head's weight in proportion to how far above chance it ranked held-out videos, so a head that did
 * not beat a coin gets nothing. The prior keeps a floor share so a format with few videos is never left unscored.
 */
export function blendFrom(
  reports: HeadReport[],
  format: Format,
  priorAcc: number,
): Partial<Record<Head, number>> {
  const edge = (a: number) => Math.max(0, a - 0.5);
  const raw: Partial<Record<Head, number>> = {
    prior: Math.max(0.05, edge(priorAcc)),
  };
  for (const r of reports.filter((x) => x.format === format))
    raw[r.head] = edge(r.blended);
  const sum = Object.values(raw).reduce((a, b) => a + (b ?? 0), 0) || 1;
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [
      k,
      Number(((v ?? 0) / sum).toFixed(3)),
    ]),
  );
}

export function trainPackagingModel(
  study: StudyRow[],
  pulse: PulseRow[],
  now: Date,
): {
  model: PackagingModel;
  reports: HeadReport[];
  priors: Record<Format, { accuracy: number; pairs: number; rows: number }>;
} {
  const targets = pulseTargets(pulse);
  const heads: PackagingModel["heads"] = { short: {}, long: {} };
  const blend: PackagingModel["blend"] = { short: {}, long: {} };
  const reports: HeadReport[] = [];
  const priors = {} as Record<
    Format,
    { accuracy: number; pairs: number; rows: number }
  >;
  for (const f of ["short", "long"] as Format[]) {
    const p = fitPrior(study, f);
    priors[f] = { ...p.heldOut, rows: p.rows };
    heads[f].prior = {
      ...p.model,
      meta: {
        heldOutAccuracy: p.heldOut.accuracy,
        pairs: p.heldOut.pairs,
        rows: p.rows,
      },
    };
    for (const h of ["views", "viewed", "ctr"] as const) {
      const r = fitHead(pulse, targets, f, h, p.model);
      if (r.model && r.report) {
        heads[f][h] = { ...r.model, meta: { ...r.report } };
        reports.push(r.report);
      }
    }
    blend[f] = blendFrom(reports, f, p.heldOut.accuracy);
  }
  return {
    model: {
      version: 1,
      trainedAt: now.toISOString(),
      features: NAMES,
      heads,
      blend,
      meta: {
        studyRows: study.length,
        pulseRows: pulse.length,
        topShort: topWeights(heads.short.views ?? heads.short.prior!, 10),
        topLong: topWeights(heads.long.ctr ?? heads.long.prior!, 10),
      },
    },
    reports,
    priors,
  };
}

/** The thumbnail heads' report, per format. */
export interface ImageReport {
  format: Format;
  priorRows: number;
  priorAccuracy: number;
  priorPairs: number;
  pulse?: { head: Head; train: number; test: number; prior: number; blended: number; pairs: number };
}

/**
 * The thumbnail model (pure, given each picture's features): a prior on the study corpus's thumbnails (held-out
 * channels measure it), then, when Pulse has enough, the click-through head on Pulse's own thumbnails with the prior
 * as its prior. Returned per format; a format without enough pictures is left out (its pictures are not scored).
 */
export function trainImageModel(
  study: StudyRow[],
  pulse: PulseRow[],
  feats: Map<string, Record<string, number>>,
  names: readonly string[],
): { image: Partial<Record<Format, LinearModel>>; reports: ImageReport[] } {
  const image: Partial<Record<Format, LinearModel>> = {};
  const reports: ImageReport[] = [];
  const x = (id: string) => names.map((k) => feats.get(id)?.[k] ?? 0);
  const targets = pulseTargets(pulse);
  for (const f of ["short", "long"] as Format[]) {
    const rows = study.filter((r) => r.format === f && feats.has(r.id));
    if (rows.length < 100) continue;
    const channels = [...new Set(rows.map((r) => r.channel))].sort();
    const test = new Set(channels.filter((_, i) => i % 5 === 4));
    const toS = (r: StudyRow): Sample => ({ x: x(r.id), y: r.z, group: r.channel });
    const m = fitRidge([...names], rows.filter((r) => !test.has(r.channel)).map(toS), 50);
    const held = pairwiseAccuracy(rows.filter((r) => test.has(r.channel)).map((r) => ({ score: predict(m, x(r.id)), y: r.z, group: r.channel })));
    const prior = fitRidge([...names], rows.map(toS), 50);
    const report: ImageReport = { format: f, priorRows: rows.length, priorAccuracy: held.accuracy, priorPairs: held.pairs };
    image[f] = { ...prior, meta: { heldOutAccuracy: held.accuracy, rows: rows.length } };
    // Pulse: click-through on the thumbnail (search tiles for Shorts), newest 30% held out.
    const head: Head = "ctr";
    const usable = pulse
      .filter((r) => r.format === f && feats.has(r.videoId) && targets.get(r.id)?.[head] !== undefined)
      .sort((a, b) => a.liveAt.localeCompare(b.liveAt));
    if (usable.length >= 20) {
      const cut = Math.floor(usable.length * 0.7);
      const ys = usable.slice(0, cut).map((r) => targets.get(r.id)![head]!);
      const mu = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mu) ** 2, 0) / ys.length) || 1;
      const toP = (r: PulseRow): Sample => ({ x: x(r.videoId), y: (targets.get(r.id)![head]! - mu) / sd });
      const tr = usable.slice(0, cut).map(toP);
      const te = usable.slice(cut).map(toP);
      const blended = fitRidge([...names], tr, 120, prior);
      const acc = (mm: LinearModel) => pairwiseAccuracy(te.map((s) => ({ score: predict(mm, s.x), y: s.y })));
      const b = acc(blended);
      report.pulse = { head, train: tr.length, test: te.length, prior: acc(prior).accuracy, blended: b.accuracy, pairs: b.pairs };
      // Ship the Pulse-bent model only when it beat the corpus prior on the held-out videos.
      if (b.accuracy > acc(prior).accuracy)
        image[f] = { ...fitRidge([...names], usable.map(toP), 120, prior), meta: { ...report.pulse, heldOutAccuracy: held.accuracy } };
    }
    reports.push(report);
  }
  return { image, reports };
}
