// What gets a video clicked (growth levers, 5 Nov 2026). Until now the factory could see what happened after a click
// (retention, subscribers) but not how often YouTube showed a video or how often that showing won the click: 123,530
// thumbnail impressions in the last 28 days were invisible to everything except a person reading Studio. YouTube
// Analytics refuses those metrics; only the Reporting API has them (report type channel_reach_basic_a1, a daily CSV of
// date, channel_id, video_id, video_thumbnail_impressions, video_thumbnail_impressions_ctr). This reads those files and
// keeps one "ctr" row per video in video_metrics, so the Sunday report shows click-through by format, the Test & compare
// queue tackles the long video losing the most clicks first, and the Shorts thumbnail test (src/shortthumb.ts) has its
// score. REACH_REPORT turns it on; the Reporting API has to be enabled once in the Google Cloud project first. A refusal
// is logged and retried the next day: nothing here can stop a video. It reads and creates a reporting job, nothing else.
import { z } from "zod";
import type { Db } from "./db.ts";
import { logEvent } from "./episodes.ts";
import { log } from "./lib/util.ts";
import { growthFormat, type GrowthFormat } from "./growthreport.ts";

export const REACH_REPORT_TYPE = "channel_reach_basic_a1";
const API = "https://youtubereporting.googleapis.com/v1";
/** Under this many impressions a click-through figure says nothing (at about 2%, that is 10 clicks). */
export const CTR_MIN_IMPRESSIONS = 500;
/** What a long video should reach: the bottom of the range YouTube says half of all videos sit in (2% to 10%). */
export const CTR_FLOOR = 0.02;

export interface ReachRow {
  date: string;
  videoId: string;
  impressions: number;
  /** A fraction: 0.015 is 1.5%. */
  ctr: number;
}

/** A report file's rows (pure). A line it cannot read is dropped; a file without the columns gives nothing. */
export function parseReachCsv(csv: string): ReachRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = (lines.shift() ?? "").split(",").map((h) => h.trim());
  const at = (name: string) => head.indexOf(name);
  const [d, v, i, c] = [
    at("date"),
    at("video_id"),
    at("video_thumbnail_impressions"),
    at("video_thumbnail_impressions_ctr"),
  ];
  if (d < 0 || v < 0 || i < 0 || c < 0) return [];
  const out: ReachRow[] = [];
  for (const line of lines) {
    const f = line.split(",");
    const impressions = Number(f[i]);
    const ctr = Number(f[c]);
    if (!f[v] || !Number.isFinite(impressions) || !Number.isFinite(ctr))
      continue;
    out.push({ date: f[d]!, videoId: f[v]!, impressions, ctr });
  }
  return out;
}

export interface VideoReach {
  impressions: number;
  clicks: number;
  ctr: number;
  days: number;
}

/**
 * Daily rows into one figure a video (pure). Reports can be restated: YouTube reissues a day's file, so the last row
 * seen for a day replaces the earlier one rather than counting twice.
 */
export function videoReach(rows: ReachRow[]): Map<string, VideoReach> {
  const byDay = new Map<string, Map<string, ReachRow>>();
  for (const r of rows) {
    const days = byDay.get(r.videoId) ?? new Map<string, ReachRow>();
    days.set(r.date, r);
    byDay.set(r.videoId, days);
  }
  const out = new Map<string, VideoReach>();
  for (const [id, days] of byDay) {
    let impressions = 0;
    let clicks = 0;
    for (const r of days.values()) {
      impressions += r.impressions;
      clicks += r.impressions * r.ctr;
    }
    out.set(id, {
      impressions,
      clicks,
      ctr: impressions ? clicks / impressions : 0,
      days: days.size,
    });
  }
  return out;
}

/** The Reporting API, as little of it as this needs. */
export class ReachClient {
  constructor(
    private token: () => Promise<string>,
    private fetchFn: typeof fetch = fetch,
  ) {}
  private async get(url: string): Promise<Response> {
    return this.fetchFn(url, {
      headers: { authorization: `Bearer ${await this.token()}` },
    });
  }
  /** The reach report's job id, creating the job once if it is missing. */
  async jobId(): Promise<string> {
    const res = await this.get(`${API}/jobs`);
    if (!res.ok)
      throw new Error(
        `reporting jobs: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    const body = z
      .object({
        jobs: z
          .array(z.object({ id: z.string(), reportTypeId: z.string() }))
          .optional(),
      })
      .parse(await res.json());
    const have = body.jobs?.find((j) => j.reportTypeId === REACH_REPORT_TYPE);
    if (have) return have.id;
    const made = await this.fetchFn(`${API}/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        reportTypeId: REACH_REPORT_TYPE,
        name: "Pulse reach",
      }),
    });
    if (!made.ok) throw new Error(`reporting job create: HTTP ${made.status}`);
    return z.object({ id: z.string() }).parse(await made.json()).id;
  }
  /** Every report file for the job since a date, oldest first, so a restated day wins. */
  async rows(jobId: string, since: Date): Promise<ReachRow[]> {
    const res = await this.get(
      `${API}/jobs/${jobId}/reports?startTimeAtOrAfter=${encodeURIComponent(since.toISOString())}`,
    );
    if (!res.ok) throw new Error(`reporting list: HTTP ${res.status}`);
    const body = z
      .object({
        reports: z
          .array(z.object({ downloadUrl: z.string(), createTime: z.string() }))
          .optional(),
      })
      .parse(await res.json());
    const files = (body.reports ?? []).sort((a, b) =>
      a.createTime.localeCompare(b.createTime),
    );
    const out: ReachRow[] = [];
    for (const f of files) {
      const r = await this.get(f.downloadUrl);
      if (r.ok) out.push(...parseReachCsv(await r.text()));
    }
    return out;
  }
}

/** Puts the figures on the episodes they belong to; a video that isn't one of ours is left out. */
export async function storeReach(
  db: Db,
  reach: Map<string, VideoReach>,
  now: Date,
): Promise<number> {
  const ids = [...reach.keys()];
  if (!ids.length) return 0;
  const eps = await db.query<{ id: string; youtube_video_id: string }>(
    `SELECT id, youtube_video_id FROM episodes WHERE youtube_video_id = ANY($1)`,
    [ids],
  );
  for (const e of eps) {
    const r = reach.get(e.youtube_video_id)!;
    await db.query(
      `INSERT INTO video_metrics (episode_id, label, captured_at, views, likes, comments, raw)
       VALUES ($1, 'ctr', $2, 0, 0, 0, $3)
       ON CONFLICT (episode_id, label) DO UPDATE SET captured_at = EXCLUDED.captured_at, raw = EXCLUDED.raw`,
      [e.id, now, JSON.stringify(r)],
    );
  }
  return eps.length;
}

/** Once a day: reads the reports and refreshes the "ctr" rows. Never throws. */
export async function captureCtr(
  db: Db,
  client: ReachClient,
  now: Date,
): Promise<number> {
  try {
    const job = await client.jobId();
    const rows = await client.rows(
      job,
      new Date(now.getTime() - 28 * 86_400_000),
    );
    const stored = await storeReach(db, videoReach(rows), now);
    if (stored) log("info", "click-through captured", { videos: stored });
    return stored;
  } catch (err) {
    log("warn", "click-through capture failed", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    await logEvent(db, null, "reach_report_failed", { at: now.toISOString() });
    return 0;
  }
}

/** True once a day: no capture recorded in the last 20 hours. */
export async function ctrCaptureDue(db: Db, now: Date): Promise<boolean> {
  const rows = await db.query<{ n: number | string }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'reach_report_tick' AND created_at > $1::timestamptz - interval '20 hours'`,
    [now],
  );
  return Number(rows[0]?.n ?? 0) === 0;
}

export interface CtrRow {
  videoId: string;
  title: string;
  format: GrowthFormat;
  long: boolean;
  thumbArm?: string;
  impressions: number;
  clicks: number;
}

export async function ctrRows(db: Db): Promise<CtrRow[]> {
  const rows = await db.query<{
    lane: string;
    story_hash: string | null;
    script_json: any;
    assets_json: any;
    youtube_video_id: string;
    raw: any;
  }>(
    `SELECT e.lane, e.story_hash, e.script_json, e.assets_json, e.youtube_video_id, m.raw
       FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'ctr' AND e.lane <> 'twin' AND e.youtube_video_id IS NOT NULL`,
  );
  return rows.map((r) => {
    const raw = typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
    const sc = r.script_json ?? {};
    return {
      videoId: r.youtube_video_id,
      title: String(sc.youtube?.title ?? ""),
      format: growthFormat({
        lane: r.lane,
        story_hash: r.story_hash,
        evergreen_format: sc.evergreen_format,
        explained: sc.explained,
        recap: sc.recap,
      }),
      long: sc.runtime === "long",
      thumbArm: r.assets_json?.shortThumbArm,
      impressions: Number(raw?.impressions ?? 0),
      clicks: Number(raw?.clicks ?? 0),
    };
  });
}

const pct = (clicks: number, impressions: number) =>
  `${((100 * clicks) / impressions).toFixed(1)}%`;
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

/** Long videos shown enough to judge and under the floor, the most clicks lost first (pure). */
export function worstLongs(rows: CtrRow[]): CtrRow[] {
  const lost = (r: CtrRow) => r.impressions * CTR_FLOOR - r.clicks;
  return rows
    .filter(
      (r) => r.long && r.impressions >= CTR_MIN_IMPRESSIONS && lost(r) > 0,
    )
    .sort((a, b) => lost(b) - lost(a));
}

/** The Sunday report's lines (pure): click-through by format, the thumbnail test, the worst long videos. */
export function packagingLines(rows: CtrRow[]): string[] {
  if (!rows.length) return [];
  const groups = new Map<
    string,
    { impressions: number; clicks: number; videos: number }
  >();
  for (const r of rows) {
    const k = `${r.long ? "Long" : "Short"}: ${r.format}`;
    const g = groups.get(k) ?? { impressions: 0, clicks: 0, videos: 0 };
    g.impressions += r.impressions;
    g.clicks += r.clicks;
    g.videos++;
    groups.set(k, g);
  }
  const out = [
    "",
    "**Click-through, last 28 days.** Thumbnail impressions (the Shorts feed isn't counted).",
  ];
  for (const [k, g] of [...groups].sort(
    (a, b) => b[1].impressions - a[1].impressions,
  ))
    out.push(
      g.impressions < CTR_MIN_IMPRESSIONS
        ? `• ${k}: not enough data (${n0(g.impressions)} impressions)`
        : `• ${k}: **${pct(g.clicks, g.impressions)}** of ${n0(g.impressions)}, ${g.videos} video${g.videos === 1 ? "" : "s"}`,
    );
  const arm = (a: string) => {
    const of = rows.filter((r) => r.thumbArm === a);
    return {
      n: of.length,
      impressions: of.reduce((s, r) => s + r.impressions, 0),
      clicks: of.reduce((s, r) => s + r.clicks, 0),
    };
  };
  const [d, f] = [arm("designed"), arm("frame")];
  if (d.n || f.n)
    out.push(
      d.impressions >= 3000 && f.impressions >= 3000
        ? `• Shorts thumbnail test: designed ${pct(d.clicks, d.impressions)} (${d.n} Shorts), first frame ${pct(f.clicks, f.impressions)} (${f.n} Shorts)`
        : `• Shorts thumbnail test: not enough data yet (${n0(d.impressions)} and ${n0(f.impressions)} impressions; each side needs 3,000)`,
    );
  const worst = worstLongs(rows).slice(0, 3);
  if (worst.length)
    out.push(
      `Losing the most clicks: ${worst.map((w) => `${w.title} (${pct(w.clicks, w.impressions)} of ${n0(w.impressions)})`).join("; ")}.`,
    );
  return out;
}

export interface AbEntry {
  videoId: string;
  publishAt?: string | null;
}

/**
 * The Test & compare queue as a run should see it (pure). The queue keeps entries for uploads that were later replaced
 * (three old Vice City uploads were still marked ready on 5 Nov, and a run does three videos at most, so they ate
 * the run). An entry whose time has passed counts only if it is public on the channel; a scheduled one waits its turn.
 * With no channel list to hand (publicIds undefined) nothing is dropped. Then the most clicks lost go first.
 */
export function abQueueView<T extends AbEntry>(
  entries: T[],
  publicIds: Set<string> | undefined,
  now: Date,
  clicksLost: Map<string, number> = new Map(),
): T[] {
  const due = (e: T) =>
    Boolean(e.publishAt) && new Date(e.publishAt!).getTime() <= now.getTime();
  return entries
    .filter((e) => !publicIds || !due(e) || publicIds.has(e.videoId))
    .map((e, i) => ({ e, i, lost: clicksLost.get(e.videoId) ?? 0 }))
    .sort((a, b) => b.lost - a.lost || a.i - b.i)
    .map((x) => x.e);
}
