// What happened to each published video, in one shape every learner shares (the judge ledger, the bandit, the playbook,
// the holdout report; the packaging lab and the retention model can read it too): the share still watching at three
// seconds, the average percentage viewed, impressions click-through and subscribers per 1,000 views, from the rows
// src/analytics.ts and src/reach.ts already capture. Pure at the core, so the proof tools run it on exported data.

import type { Db } from "../db.ts";
import { watchAt } from "../analytics.ts";
import { TAIL_SECONDS } from "../render/plan.ts";
import { subsFormat } from "../subslearn/learn.ts";

export type Curve = Array<{ at: number; watch: number; relative: number }>;

export interface Outcome {
  episodeId: string;
  format: string;
  lane: string;
  storyType?: string;
  publishedAt?: string;
  /** Share still watching at 3 s (0-1), from the week-old curve, else the 48-hour one. */
  hold3?: number;
  /** Average percentage viewed (0-100). */
  apv?: number;
  /** Impressions click-through (0-1). */
  ctr?: number;
  impressions?: number;
  /** Subscribers gained per 1,000 views. */
  subsPer1k?: number;
  views?: number;
  /** Views at 72 hours. */
  views72?: number;
}

export interface EpisodeRow {
  id: string;
  lane: string;
  story_hash?: string | null;
  evergreen_format?: string | null;
  runtime?: string | null;
  live?: string | boolean | null;
  story_type?: string | null;
  duration?: string | number | null;
  published_at?: string | null;
}

export interface MetricRow {
  episode_id: string;
  label: string;
  raw: unknown;
}

const parse = (x: unknown): any => (typeof x === "string" ? JSON.parse(x) : x);
const num = (x: unknown): number | undefined => {
  const n = Number(x);
  return x === null || x === undefined || x === "" || !Number.isFinite(n)
    ? undefined
    : n;
};

/** One episode's outcome from its metric rows (pure). */
export function outcomeOf(ep: EpisodeRow, metrics: MetricRow[]): Outcome {
  const by = new Map<string, unknown>();
  for (const m of metrics)
    if (m.episode_id === ep.id) by.set(m.label, parse(m.raw));
  const out: Outcome = {
    episodeId: ep.id,
    format: subsFormat({
      lane: ep.lane,
      story_hash: ep.story_hash,
      evergreen_format: ep.evergreen_format,
      runtime: ep.runtime,
      live: ep.live,
    }),
    lane: ep.lane,
    storyType: ep.story_type ?? undefined,
    publishedAt: ep.published_at ?? undefined,
  };
  const duration = (num(ep.duration) ?? 0) + TAIL_SECONDS;
  const curve = (by.get("curve") ?? by.get("curve_2d")) as Curve | undefined;
  if (Array.isArray(curve) && curve.length >= 20 && duration > TAIL_SECONDS)
    out.hold3 = watchAt(curve, 3, duration);
  const ret = by.get("retention") as
    | { views?: number; avgViewPercent?: number; subscribersGained?: number }
    | undefined;
  if (ret) {
    out.apv = num(ret.avgViewPercent);
    out.views = num(ret.views);
    const subs = num(ret.subscribersGained);
    if (subs !== undefined && out.views && out.views >= 50)
      out.subsPer1k = (subs / out.views) * 1000;
  }
  const ctr = by.get("ctr") as
    | { ctr?: number; impressions?: number }
    | undefined;
  if (ctr && num(ctr.impressions) && (num(ctr.impressions) ?? 0) >= 100) {
    out.ctr = num(ctr.ctr);
    out.impressions = num(ctr.impressions);
  }
  const v72 = by.get("72h") as { views?: number } | undefined;
  if (v72) out.views72 = num(v72.views);
  return out;
}

export type Metric = "hold3" | "apv" | "ctr" | "subsPer1k";
export const METRICS: Metric[] = ["hold3", "apv", "ctr", "subsPer1k"];
export const METRIC_NAME: Record<Metric, string> = {
  hold3: "3-second hold",
  apv: "average viewed",
  ctr: "click-through",
  subsPer1k: "subscribers per 1,000 views",
};

export const EPISODE_COLUMNS = `e.id, e.lane, e.story_hash, e.script_json->>'evergreen_format' AS evergreen_format,
  e.script_json->>'runtime' AS runtime, e.story_json->'gameplay'->>'live' AS live,
  e.script_json->>'story_type' AS story_type, e.assets_json->>'durationSeconds' AS duration,
  COALESCE(e.publish_at, e.updated_at) AS published_at`;

/** Every published video's outcome (twin channel left out), newest first. */
export async function loadOutcomes(
  db: Db,
  o: { since?: Date; ids?: string[] } = {},
): Promise<Outcome[]> {
  const where = [
    `e.status = 'published'`,
    `e.youtube_video_id IS NOT NULL`,
    `e.lane <> 'twin'`,
  ];
  const params: unknown[] = [];
  if (o.since) {
    params.push(o.since.toISOString());
    where.push(`e.created_at >= $${params.length}`);
  }
  if (o.ids) {
    params.push(o.ids);
    where.push(`e.id = ANY($${params.length}::text[])`);
  }
  const eps = await db.query<EpisodeRow>(
    `SELECT ${EPISODE_COLUMNS} FROM episodes e WHERE ${where.join(" AND ")} ORDER BY e.created_at DESC`,
    params,
  );
  if (!eps.length) return [];
  const metrics = await db.query<MetricRow>(
    `SELECT episode_id, label, raw FROM video_metrics WHERE episode_id = ANY($1::text[]) AND label IN ('curve','curve_2d','retention','ctr','72h')`,
    [eps.map((e) => e.id)],
  );
  const byEp = new Map<string, MetricRow[]>();
  for (const m of metrics)
    byEp.set(m.episode_id, [...(byEp.get(m.episode_id) ?? []), m]);
  return eps.map((e) => outcomeOf(e, byEp.get(e.id) ?? []));
}
