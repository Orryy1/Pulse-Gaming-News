// The judge calibration ledger (LEARN_JUDGES, research item 1). Nine judges score every script and render; nobody had
// checked whether a high score goes with more viewers. Every judge already writes its score into the events table, so
// the ledger reads them from there (no judge is touched): clarity before and after its rewrite, the render rubric's
// grade and amber count, the long videos' release gate, the graphics audit's readable share and each fact check.
// Weekly the scores are lined up with what each video then did (3-second hold, average viewed, click-through,
// subscribers per 1,000 views) by rank correlation with a bootstrap interval, per format once a format has enough.
// A judge with enough data whose scores track none of the outcomes is flagged: it may be costing rewrites for nothing.
//
// Drift (LEARN_ANCHORS): a frozen set of past scripts is re-scored by the clarity judge weekly. A judge whose mean on
// the same scripts moves by more than half a point, or whose ranking of them changes (Kendall's tau under 0.8), has
// drifted (a model change is the usual cause) and the weekly summary says so.

import type { Db } from "../db.ts";
import type { Llm } from "../editorial/llm.ts";
import type { Script } from "../editorial/schema.ts";
import { judgeClarity, shortLines } from "../editorial/clarity.ts";
import { METRICS, METRIC_NAME, type Metric, type Outcome } from "./outcomes.ts";
import { kendall, mean, quantile, spearmanCi } from "./stats.ts";

export interface JudgeScore {
  episodeId: string;
  judge: string;
  stage: "first" | "final";
  score: number;
  scaleMax: number;
  pass?: boolean;
  sourceId: string;
  scoredAt: string;
  detail?: Record<string, unknown>;
}

export interface EventRow {
  id: number | string;
  episode_id: string | null;
  kind: string;
  detail: unknown;
  created_at: string | Date;
}

/** The event kinds the ledger reads. */
export const JUDGE_EVENTS = [
  "clarity_gate",
  "doc_clarity_gate",
  "rubric",
  "release_gate",
  "graphics_audit",
  "factcheck",
  "friend_pass",
  // The blind panel's critics (src/panel): the first-second stop mark and the packaging panel's tap mark.
  "first_second",
  "packaging_panel",
];

const GRADE: Record<string, number> = { green: 2, amber: 1, red: 0 };
const AMBER = /\((amber)\)/g;
const RED = /\((red)\)/g;
const num = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;

/** The judge scores one event carries (pure). */
export function scoresFromEvent(e: EventRow): JudgeScore[] {
  if (!e.episode_id) return [];
  const d = (
    typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail
  ) as Record<string, any> | null;
  if (!d) return [];
  const base = {
    episodeId: e.episode_id,
    sourceId: `event:${e.id}`,
    scoredAt: new Date(e.created_at).toISOString(),
  };
  const out: JudgeScore[] = [];
  switch (e.kind) {
    case "clarity_gate":
    case "doc_clarity_gate": {
      const judge = e.kind === "clarity_gate" ? "clarity" : "clarity_doc";
      const before = num(d.before);
      const after = num(d.after);
      if (before !== undefined)
        out.push({
          ...base,
          judge,
          stage: "first",
          score: before,
          scaleMax: 10,
        });
      if (after !== undefined)
        out.push({
          ...base,
          judge,
          stage: "final",
          score: after,
          scaleMax: 10,
          detail: d.chapter ? { chapter: d.chapter } : undefined,
        });
      break;
    }
    case "rubric": {
      const g = GRADE[String(d.grade ?? "")];
      if (g !== undefined)
        out.push({
          ...base,
          judge: "rubric",
          stage: "final",
          score: g,
          scaleMax: 2,
          pass: g > 0,
        });
      const summary = String(d.summary ?? "");
      if (g !== undefined) {
        const ambers = (summary.match(AMBER) ?? []).length;
        const reds = (summary.match(RED) ?? []).length;
        out.push({
          ...base,
          judge: "rubric_ambers",
          stage: "final",
          score: -(ambers + 2 * reds),
          scaleMax: 0,
        });
      }
      break;
    }
    case "release_gate": {
      const m = num(d.mean);
      if (m !== undefined)
        out.push({
          ...base,
          judge: "release_gate",
          stage: "final",
          score: m,
          scaleMax: 3,
          pass: d.pass === true,
        });
      break;
    }
    case "graphics_audit": {
      const share = (s: any) =>
        s && num(s.texts) && s.texts > 0
          ? (num(s.readable) ?? 0) / s.texts
          : undefined;
      const first = share(d.before ?? d.stats);
      const final = share(d.after ?? d.stats);
      if (first !== undefined)
        out.push({
          ...base,
          judge: "gfx_audit",
          stage: "first",
          score: first,
          scaleMax: 1,
        });
      if (final !== undefined)
        out.push({
          ...base,
          judge: "gfx_audit",
          stage: "final",
          score: final,
          scaleMax: 1,
          pass: d.failed !== true,
        });
      break;
    }
    case "factcheck": {
      const v = String(d.verdict ?? "");
      if (v === "pass" || v === "fail") {
        const attempt = num(d.attempt) ?? 0;
        out.push({
          ...base,
          judge: "fact_check",
          stage: attempt === 0 ? "first" : "final",
          score: v === "pass" ? 1 : 0,
          scaleMax: 1,
          pass: v === "pass",
          detail: { attempt },
        });
      }
      break;
    }
    case "first_second": {
      // The audience critic's stop mark on the opening that went out (FIRST_SECOND_PANEL).
      const stop = num(d.stop);
      if (stop !== undefined)
        out.push({
          ...base,
          judge: "first_second",
          stage: "final",
          score: stop,
          scaleMax: 10,
          detail: { arm: d.arm, mode: d.mode, changed: d.changed === true },
        });
      break;
    }
    case "packaging_panel": {
      // The audience critic's tap mark on the long video's title that went out (PACKAGING_PANEL).
      const tap = num(d.tap);
      if (tap !== undefined)
        out.push({
          ...base,
          judge: "packaging_panel",
          stage: "final",
          score: tap,
          scaleMax: 10,
          detail: { mode: d.mode, rank: d.rank, changed: d.changed === true },
        });
      break;
    }
    case "friend_pass":
      if (typeof d.kept === "boolean")
        out.push({
          ...base,
          judge: "friend_pass",
          stage: "final",
          score: d.kept ? 1 : 0,
          scaleMax: 1,
        });
      break;
  }
  return out;
}

/** The call sites whose prompt is a judge's version. */
const JUDGE_SITES: Record<string, RegExp> = {
  clarity: /clarity\.judge/,
  clarity_doc: /clarity\.judge/,
  fact_check: /fact|check/i,
  release_gate: /release|gate|vision/i,
  first_second: /^first\.viewer$/,
  packaging_panel: /^packaging\.viewer$/,
};

const CURSOR = "learn:judge_cursor";

/** Copies new judge events into judge_scores (idempotent: an event read twice adds nothing). */
export async function ingestJudgeScores(
  db: Db,
  o: { batch?: number } = {},
): Promise<number> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [CURSOR],
  );
  const cursor = Number(row?.value ?? 0) || 0;
  const events = await db.query<EventRow>(
    `SELECT id, episode_id, kind, detail, created_at FROM events WHERE id > $1 AND kind = ANY($2::text[]) ORDER BY id LIMIT $3`,
    [cursor, JUDGE_EVENTS, o.batch ?? 2000],
  );
  let n = 0;
  for (const e of events) {
    for (const s of scoresFromEvent(e)) {
      const version = await judgeVersion(db, s.episodeId, s.judge);
      await db.query(
        `INSERT INTO judge_scores (episode_id, judge, stage, version, score, scale_max, pass, detail, source_id, scored_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (source_id, judge, stage) DO NOTHING`,
        [
          s.episodeId,
          s.judge,
          s.stage,
          version ?? null,
          s.score,
          s.scaleMax,
          s.pass ?? null,
          s.detail ? JSON.stringify(s.detail) : null,
          s.sourceId,
          s.scoredAt,
        ],
      );
      n++;
    }
  }
  const last = events.at(-1);
  if (last)
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [CURSOR, String(last.id)],
    );
  return n;
}

/** A judge's version on an episode: its prompt's hash from the stamps, else the code commit, else unknown. */
async function judgeVersion(
  db: Db,
  episodeId: string,
  judge: string,
): Promise<string | undefined> {
  const site = JUDGE_SITES[judge];
  if (site) {
    const rows = await db.query<{
      site: string;
      job: string | null;
      prompt_hash: string;
    }>(
      `SELECT site, job, prompt_hash FROM episode_prompts WHERE episode_id = $1 AND role = 'judge' ORDER BY last_at DESC`,
      [episodeId],
    );
    const hit = rows.find((r) => site.test(r.site) || site.test(r.job ?? ""));
    if (hit) return `prompt:${hit.prompt_hash}`;
  }
  const [st] = await db.query<{ code_commit: string | null }>(
    `SELECT code_commit FROM episode_stamps WHERE episode_id = $1`,
    [episodeId],
  );
  return st?.code_commit ? `code:${st.code_commit.slice(0, 12)}` : undefined;
}

/** Per episode and judge: the first score and the final one (doc chapters averaged; the last fact check is final). */
export function episodeJudgeTable(
  scores: JudgeScore[],
): Map<string, Map<string, { first?: number; final?: number }>> {
  const acc = new Map<
    string,
    Map<
      string,
      {
        first: number[];
        final: number[];
        lastFinalAt: string;
        lastFinal?: number;
      }
    >
  >();
  for (const s of [...scores].sort((a, b) =>
    a.scoredAt.localeCompare(b.scoredAt),
  )) {
    const ep = acc.get(s.episodeId) ?? new Map();
    acc.set(s.episodeId, ep);
    const j = ep.get(s.judge) ?? { first: [], final: [], lastFinalAt: "" };
    ep.set(s.judge, j);
    if (s.stage === "first") j.first.push(s.score);
    else j.final.push(s.score);
    // the fact check's final word is its latest attempt, pass or fail
    if (s.judge === "fact_check") {
      j.lastFinal = s.score;
      j.lastFinalAt = s.scoredAt;
    }
  }
  const out = new Map<
    string,
    Map<string, { first?: number; final?: number }>
  >();
  for (const [ep, judges] of acc) {
    const m = new Map<string, { first?: number; final?: number }>();
    for (const [judge, j] of judges) {
      const first = j.first.length ? mean(j.first) : undefined;
      const final =
        judge === "fact_check"
          ? j.lastFinal
          : j.final.length
            ? mean(j.final)
            : first;
      // A judge with no separate first look (the rubric) has only a final score: never counted twice.
      m.set(judge, { first, final });
    }
    out.set(ep, m);
  }
  return out;
}

export type JudgeVerdict =
  | "predicts"
  | "inverse"
  | "no_link"
  | "unclear"
  | "too_few"
  | "no_spread";

export interface Calibration {
  judge: string;
  stage: "first" | "final";
  metric: Metric;
  format: string;
  n: number;
  rho?: number;
  lo?: number;
  hi?: number;
  distinct: number;
  /** Mean outcome in the lowest and highest quarter of scores. */
  lowQuarter?: number;
  highQuarter?: number;
  verdict: JudgeVerdict;
}

/** How one judge's scores line up with one outcome (pure). */
export function calibrate(
  pairs: Array<{ score: number; outcome: number }>,
  o: {
    judge: string;
    stage: "first" | "final";
    metric: Metric;
    format: string;
    min: number;
    seed?: number;
  },
): Calibration {
  const n = pairs.length;
  const distinct = new Set(pairs.map((p) => p.score)).size;
  const base = {
    judge: o.judge,
    stage: o.stage,
    metric: o.metric,
    format: o.format,
    n,
    distinct,
  };
  if (n < o.min) return { ...base, verdict: "too_few" };
  if (distinct < 2) return { ...base, verdict: "no_spread" };
  const xs = pairs.map((p) => p.score);
  const ys = pairs.map((p) => p.outcome);
  const ci = spearmanCi(xs, ys, { seed: o.seed ?? 11 });
  const sorted = [...xs].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const low = pairs.filter((p) => p.score <= q1).map((p) => p.outcome);
  const high = pairs.filter((p) => p.score >= q3).map((p) => p.outcome);
  let verdict: JudgeVerdict = "unclear";
  if (ci.lo !== undefined && ci.hi !== undefined) {
    if (ci.lo > 0) verdict = "predicts";
    else if (ci.hi < 0) verdict = "inverse";
    else if (Math.abs(ci.rho ?? 0) < 0.1) verdict = "no_link";
  }
  return {
    ...base,
    ...ci,
    lowQuarter: low.length ? mean(low) : undefined,
    highQuarter: high.length ? mean(high) : undefined,
    verdict,
  };
}

export interface JudgeReport {
  rows: Calibration[];
  /** Per judge: predicts (some outcome), flagged (enough data, tracks none) or waiting. */
  judges: Array<{
    judge: string;
    status: "predicts" | "flagged" | "waiting";
    best?: Calibration;
    n: number;
  }>;
}

/** The whole calibration: every judge, both stages, every outcome, all formats and each format with enough (pure). */
export function judgeReport(
  scores: JudgeScore[],
  outcomes: Outcome[],
  min: number,
): JudgeReport {
  const table = episodeJudgeTable(scores);
  const byEp = new Map(outcomes.map((o) => [o.episodeId, o]));
  const judges = [...new Set(scores.map((s) => s.judge))].sort();
  const rows: Calibration[] = [];
  const summary: JudgeReport["judges"] = [];
  for (const judge of judges) {
    let best: Calibration | undefined;
    let enough = false;
    let maxN = 0;
    for (const stage of ["first", "final"] as const)
      for (const metric of METRICS) {
        const all: Array<{ score: number; outcome: number; format: string }> =
          [];
        for (const [ep, js] of table) {
          const sc = js.get(judge)?.[stage];
          const out = byEp.get(ep)?.[metric];
          if (sc === undefined || out === undefined) continue;
          all.push({ score: sc, outcome: out, format: byEp.get(ep)!.format });
        }
        const formats = ["all", ...new Set(all.map((p) => p.format))];
        for (const format of formats) {
          const pairs =
            format === "all" ? all : all.filter((p) => p.format === format);
          if (format !== "all" && pairs.length < min) continue;
          const c = calibrate(pairs, { judge, stage, metric, format, min });
          rows.push(c);
          maxN = Math.max(maxN, c.n);
          if (c.verdict !== "too_few" && c.verdict !== "no_spread")
            enough = true;
          if (
            c.verdict === "predicts" &&
            (!best || (c.rho ?? 0) > (best.rho ?? 0))
          )
            best = c;
        }
      }
    summary.push({
      judge,
      status: best ? "predicts" : enough ? "flagged" : "waiting",
      best,
      n: maxN,
    });
  }
  return { rows, judges: summary };
}

const JUDGE_NAME: Record<string, string> = {
  clarity: "the clarity judge",
  clarity_doc: "the long videos' clarity judge",
  rubric: "the render rubric's grade",
  rubric_ambers: "the render rubric's amber count",
  release_gate: "the release gate",
  gfx_audit: "the graphics audit",
  fact_check: "the fact check",
  friend_pass: "the friend pass",
  first_second: "the first-second panel's stop mark",
  packaging_panel: "the packaging panel's tap mark",
};
export const judgeName = (j: string): string => JUDGE_NAME[j] ?? j;

/** One plain-English line per judge. */
export function judgeLines(r: JudgeReport, min: number): string[] {
  return r.judges.map((j) => {
    if (j.status === "predicts" && j.best)
      return `${judgeName(j.judge)} predicts ${METRIC_NAME[j.best.metric]}${j.best.format === "all" ? "" : ` on ${j.best.format}`} (rank correlation ${j.best.rho!.toFixed(2)}, ${j.best.n} videos, its ${j.best.stage} score).`;
    if (j.status === "flagged")
      return `FLAG: ${judgeName(j.judge)} does not predict any outcome yet (${j.n} videos): its scores do not go with more viewers.`;
    return `${judgeName(j.judge)}: too few videos to say (${j.n} of ${min}).`;
  });
}

// ---- Drift: the frozen anchor set --------------------------------------------------------------------

export interface AnchorPayload {
  lines: string[];
  intended?: string;
  title?: string;
}

/** Freezes up to `count` past scripts that have a clarity score and an outcome, once. Returns how many exist. */
export async function freezeAnchors(db: Db, count: number): Promise<number> {
  const [have] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM judge_anchors WHERE judge = 'clarity'`,
  );
  if ((have?.n ?? 0) >= count) return have!.n;
  const rows = await db.query<{
    id: string;
    script_json: Script;
    score: number;
  }>(
    `SELECT e.id, e.script_json, j.score FROM episodes e
       JOIN judge_scores j ON j.episode_id = e.id AND j.judge = 'clarity' AND j.stage = 'final'
      WHERE e.status = 'published' AND e.script_json IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM judge_anchors a WHERE a.episode_id = e.id)
      ORDER BY e.created_at DESC LIMIT $1`,
    [count - (have?.n ?? 0)],
  );
  for (const r of rows) {
    const sc = r.script_json;
    if (!sc?.hook || !Array.isArray(sc.beats) || !sc.pulse_take) continue;
    const payload: AnchorPayload = {
      lines: shortLines(sc),
      intended: sc.point,
      title: sc.youtube?.title,
    };
    await db.query(
      `INSERT INTO judge_anchors (anchor_id, episode_id, judge, payload, frozen_score) VALUES ($1, $2, 'clarity', $3, $4) ON CONFLICT DO NOTHING`,
      [`clarity:${r.id}`, r.id, JSON.stringify(payload), r.score],
    );
  }
  const [after] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM judge_anchors WHERE judge = 'clarity'`,
  );
  return after?.n ?? 0;
}

export interface DriftResult {
  runId: string;
  n: number;
  meanFrozen: number;
  meanNow: number;
  shift: number;
  tau?: number;
  drifted: boolean;
}

export const DRIFT_SHIFT = 0.5;
export const DRIFT_TAU = 0.8;

/** Drift between the frozen scores and this run's (pure). */
export function driftOf(
  runId: string,
  pairs: Array<{ frozen: number; now: number }>,
): DriftResult {
  const meanFrozen = mean(pairs.map((p) => p.frozen));
  const meanNow = mean(pairs.map((p) => p.now));
  const tau = kendall(
    pairs.map((p) => p.frozen),
    pairs.map((p) => p.now),
  );
  const shift = meanNow - meanFrozen;
  return {
    runId,
    n: pairs.length,
    meanFrozen,
    meanNow,
    shift,
    tau,
    drifted:
      pairs.length >= 5 &&
      (Math.abs(shift) > DRIFT_SHIFT || (tau !== undefined && tau < DRIFT_TAU)),
  };
}

/** Re-scores every clarity anchor with today's judge and returns the drift (one judge call per anchor). */
export async function rescoreAnchors(
  db: Db,
  llm: Llm,
  runId: string,
): Promise<DriftResult | undefined> {
  const anchors = await db.query<{
    anchor_id: string;
    payload: AnchorPayload | string;
    frozen_score: number | null;
  }>(
    `SELECT anchor_id, payload, frozen_score FROM judge_anchors WHERE judge = 'clarity' ORDER BY anchor_id`,
  );
  const pairs: Array<{ frozen: number; now: number }> = [];
  for (const a of anchors) {
    if (a.frozen_score === null) continue;
    const p = (
      typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload
    ) as AnchorPayload;
    try {
      const j = await judgeClarity(llm, {
        lines: p.lines,
        intended: p.intended,
        title: p.title,
      });
      await db.query(
        `INSERT INTO judge_anchor_scores (anchor_id, run_id, score) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [a.anchor_id, runId, j.score],
      );
      pairs.push({ frozen: Number(a.frozen_score), now: j.score });
    } catch {
      // one failed call skips that anchor this week
    }
  }
  return pairs.length ? driftOf(runId, pairs) : undefined;
}
