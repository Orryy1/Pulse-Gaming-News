// The Packaging Lab's second chance (PACKAGING_LAB=retitle). Between 48 and 72 hours after going public, a video whose
// views sit in the bottom of its format's recent videos at the same age gets one new title: the best runner-up scored
// before upload, re-checked against the live title. A long video that is not in a Studio Test & compare and has no
// better title may get its best-scoring other thumbnail instead. Three days later the change is judged against how
// the channel's other videos of that format grew over the same ages, and the verdict is logged and told to the owner.
//
// The guard rails, all checked before anything is sent:
//   - once per video, ever (packaging_second_chance in its events, or a secondChance on its record)
//   - public videos only, and only the snippet or the thumbnail is sent: privacy is never part of the request
//   - never a video whose live title differs from the one the factory set (the owner changed it), checked again inside
//     the update itself; never a thumbnail that no longer matches the factory's own file
//   - never a video in the Test & compare queue (data/abtests): that test owns its packaging
//   - at most PACKAGING_DAILY_CAP changes a day, and none in dry run
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db.ts";
import { logEvent, type Episode } from "../episodes.ts";
import { LIVE_AT } from "../analytics.ts";
import { errorMessage, log } from "../lib/util.ts";
import { clarity } from "./clarity.ts";
import { candidateSource, formatOf, rankTitles } from "./lab.ts";
import { imageDistance } from "./image.ts";
import { loadModel, titleScore } from "./score.ts";
import { packagingAtLeast, type PackagingSettings } from "./settings.ts";

export interface SecondChanceYouTube {
  liveVideo(
    videoId: string,
  ): Promise<
    { title: string; privacyStatus: string; thumbUrl?: string } | undefined
  >;
  retitle(videoId: string, expected: string, title: string): Promise<void>;
  setThumbnail(videoId: string, file: string): Promise<void>;
  stats(
    ids: string[],
  ): Promise<Map<string, { views: number; privacyStatus: string }>>;
}

export interface SecondChanceServices {
  cfg: { packaging: PackagingSettings; dataDir: string; dryRun?: boolean };
  db: Db;
  now(): Date;
  youtube(ep: Episode): SecondChanceYouTube;
  notify(m: { level: "info"; content: string }): Promise<unknown>;
  fetchFn?: typeof fetch;
}

/** The share of `others` below `value` (pure); 0.5 when there is nothing to compare with. */
export function percentileOf(value: number, others: number[]): number {
  if (!others.length) return 0.5;
  const below = others.filter((v) => v < value).length;
  const equal = others.filter((v) => v === value).length;
  return (below + equal / 2) / others.length;
}

/** Video ids in the Test & compare queue or already tested (a missing or unreadable file counts as empty). */
export function abTestVideoIds(dataDir: string): Set<string> {
  const ids = new Set<string>();
  for (const f of ["pending.json", "done.json"]) {
    try {
      const list = JSON.parse(
        fs.readFileSync(path.join(dataDir, "abtests", f), "utf8"),
      ) as unknown[];
      for (const x of list)
        ids.add(
          typeof x === "string"
            ? x
            : String((x as { videoId?: string })?.videoId ?? ""),
        );
    } catch {
      // none
    }
  }
  ids.delete("");
  return ids;
}

export interface Candidate2 {
  ep: Episode;
  liveAt: Date;
  hours: number;
  label: string;
  views: number;
  percentile: number;
}

/**
 * The verdict on a change (pure): views per hour after it against before it, set against the same ratio for the
 * format's other videos over similar ages ("control"). Above 1.25 times the control helped, below 0.8 hurt.
 */
export function judge(o: {
  beforeViews: number;
  beforeHours: number;
  afterViews: number;
  afterHours: number;
  control: number;
}): {
  ratio: number;
  relative: number;
  verdict: "helped" | "hurt" | "no clear change";
} {
  const before = o.beforeViews / Math.max(1, o.beforeHours);
  const after = o.afterViews / Math.max(1, o.afterHours);
  const ratio = before > 0 ? after / before : after > 0 ? 2 : 1;
  const relative = ratio / Math.max(0.05, o.control);
  return {
    ratio,
    relative,
    verdict:
      relative >= 1.25
        ? "helped"
        : relative <= 0.8
          ? "hurt"
          : "no clear change",
  };
}

/** Under-performing public videos in the window, worst first. */
export async function dueVideos(
  s: SecondChanceServices,
): Promise<Candidate2[]> {
  const st = s.cfg.packaging;
  const rows = await s.db.query<Episode & { live_at: string }>(
    `SELECT e.*, ${LIVE_AT("e")} AS live_at FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND ${LIVE_AT("e")} > now() - make_interval(days => 40)`,
  );
  const metrics = await s.db.query<{
    episode_id: string;
    label: string;
    views: number;
  }>(
    `SELECT episode_id, label, views FROM video_metrics WHERE label IN ('24h','72h')`,
  );
  const views = new Map<string, Map<string, number>>();
  for (const m of metrics)
    views.set(
      m.episode_id,
      (views.get(m.episode_id) ?? new Map()).set(m.label, Number(m.views)),
    );
  const changed = new Set(
    (
      await s.db.query<{ episode_id: string }>(
        `SELECT DISTINCT episode_id FROM events WHERE kind = 'packaging_second_chance' AND episode_id IS NOT NULL`,
      )
    ).map((r) => r.episode_id),
  );
  // A video looked at in the last 12 hours and left alone is not looked at again until then.
  const recent = new Set(
    (
      await s.db.query<{ episode_id: string }>(
        `SELECT DISTINCT episode_id FROM events WHERE kind = 'packaging_second_chance_skipped' AND created_at > $1`,
        [new Date(s.now().getTime() - 12 * 3600_000)],
      )
    ).map((r) => r.episode_id),
  );
  const out: Candidate2[] = [];
  const now = s.now().getTime();
  for (const ep of rows) {
    const liveAt = new Date(ep.live_at);
    const hours = (now - liveAt.getTime()) / 3600_000;
    if (hours < st.minHours || hours > st.maxHours) continue;
    if (
      changed.has(ep.id) ||
      recent.has(ep.id) ||
      ep.assets_json?.packaging?.secondChance ||
      !ep.script_json
    )
      continue;
    const label = views.get(ep.id)?.has("72h") ? "72h" : "24h";
    const v = views.get(ep.id)?.get(label);
    if (v === undefined) continue;
    const format = formatOf(ep.script_json);
    const peers = rows
      .filter(
        (r) =>
          r.id !== ep.id && r.script_json && formatOf(r.script_json) === format,
      )
      .map((r) => views.get(r.id)?.get(label))
      .filter((x): x is number => x !== undefined);
    if (peers.length < 8) continue;
    const percentile = percentileOf(v, peers);
    if (percentile < st.underPercentile)
      out.push({ ep, liveAt, hours, label, views: v, percentile });
  }
  return out.sort((a, b) => a.percentile - b.percentile);
}

/** The format's typical after/before rate ratio between 24h-72h and 72h-7d (the control for the verdict). */
async function controlRatio(db: Db, format: "short" | "long"): Promise<number> {
  const rows = await db.query<{
    id: string;
    script_json: any;
    v24: number | null;
    v72: number | null;
    v7: number | null;
  }>(
    `SELECT e.id, e.script_json,
            (SELECT views FROM video_metrics WHERE episode_id = e.id AND label = '24h') AS v24,
            (SELECT views FROM video_metrics WHERE episode_id = e.id AND label = '72h') AS v72,
            (SELECT views FROM video_metrics WHERE episode_id = e.id AND label = '7d') AS v7
       FROM episodes e WHERE e.status = 'published'
        AND NOT EXISTS (SELECT 1 FROM events x WHERE x.episode_id = e.id AND x.kind = 'packaging_second_chance')`,
  );
  const ratios = rows
    .filter(
      (r) =>
        r.script_json &&
        formatOf(r.script_json) === format &&
        r.v24 != null &&
        r.v72 != null &&
        r.v7 != null &&
        r.v72 > r.v24,
    )
    .map((r) => (r.v7! - r.v72!) / 96 / ((r.v72! - r.v24!) / 48))
    .sort((a, b) => a - b);
  return ratios.length >= 5 ? ratios[ratios.length >> 1]! : 0.5;
}

async function changesToday(db: Db, now: Date): Promise<number> {
  const [r] = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM events WHERE kind = 'packaging_second_chance' AND created_at > $1`,
    [new Date(now.getTime() - 24 * 3600_000)],
  );
  return Number(r?.n ?? 0);
}

/** Downloads a live thumbnail to compare with the factory's own file. */
async function download(
  url: string,
  file: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return false;
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

export interface SecondChanceReport {
  considered: number;
  applied: Array<{ episode: string; kind: string; from: string; to: string }>;
  skipped: Array<{ episode: string; why: string }>;
  judged: Array<{ episode: string; verdict: string; relative: number }>;
}

/** One pass: judge the changes three days old, then give the due videos their second chance. */
export async function runSecondChance(
  s: SecondChanceServices,
): Promise<SecondChanceReport> {
  const report: SecondChanceReport = {
    considered: 0,
    applied: [],
    skipped: [],
    judged: [],
  };
  const st = s.cfg.packaging;
  if (!packagingAtLeast(st, "retitle")) return report;
  // Once an hour is plenty: the window is a day wide.
  const [last] = await s.db.query<{ at: string }>(`SELECT max(created_at) AS at FROM events WHERE kind = 'packaging_tick'`);
  if (last?.at && s.now().getTime() - new Date(last.at).getTime() < 55 * 60_000) return report;
  await logEvent(s.db, null, "packaging_tick", {});
  report.judged = await judgeChanges(s);
  if (s.cfg.dryRun) return report;
  const model = loadModel(s.cfg.dataDir);
  if (!model) return report;
  const tested = abTestVideoIds(s.cfg.dataDir);
  let budget = st.dailyCap - (await changesToday(s.db, s.now()));
  const due = await dueVideos(s);
  report.considered = due.length;
  for (const c of due) {
    if (budget <= 0) break;
    const ep = c.ep;
    const skip = async (why: string) => {
      report.skipped.push({ episode: ep.id, why });
      await logEvent(s.db, ep.id, "packaging_second_chance_skipped", {
        why,
        percentile: Number(c.percentile.toFixed(2)),
      });
    };
    try {
      if (tested.has(ep.youtube_video_id!)) {
        await skip("in a Studio Test & compare");
        continue;
      }
      const yt = s.youtube(ep);
      const live = await yt.liveVideo(ep.youtube_video_id!);
      if (!live || live.privacyStatus !== "public") {
        await skip(`not public (${live?.privacyStatus ?? "gone"})`);
        continue;
      }
      const set = ep.script_json!.youtube.title;
      if (live.title !== set) {
        await skip(
          "the live title differs from the factory's: changed by hand",
        );
        continue;
      }
      const script = ep.script_json!;
      const src = candidateSource(script);
      const format = formatOf(script);
      const ranked = rankTitles(model, script, st.candidates, [live.title]);
      const liveScore =
        titleScore(model, format, live.title, src.game) -
        clarity(live.title, { game: src.game }).penalty;
      const next = ranked.find((r) => r.clarity.ok && r.text !== live.title);
      const beforeViews =
        (await yt.stats([ep.youtube_video_id!])).get(ep.youtube_video_id!)
          ?.views ?? c.views;
      if (next && next.final - liveScore >= st.minLift) {
        await yt.retitle(ep.youtube_video_id!, live.title, next.text);
        script.youtube.title = next.text;
        const record = {
          at: s.now().toISOString(),
          kind: "title" as const,
          from: live.title,
          to: next.text,
        };
        const assets = {
          ...(ep.assets_json ?? {}),
          packaging: {
            ...(ep.assets_json?.packaging ?? ({} as any)),
            secondChance: record,
          },
        };
        await s.db.query(
          `UPDATE episodes SET script_json = $2, assets_json = $3 WHERE id = $1`,
          [ep.id, JSON.stringify(script), JSON.stringify(assets)],
        );
        await logEvent(s.db, ep.id, "packaging_second_chance", {
          kind: "title",
          from: live.title,
          to: next.text,
          scoreFrom: Number(liveScore.toFixed(3)),
          scoreTo: Number(next.final.toFixed(3)),
          percentile: Number(c.percentile.toFixed(2)),
          hours: Number(c.hours.toFixed(1)),
          beforeViews,
        });
        report.applied.push({
          episode: ep.id,
          kind: "title",
          from: live.title,
          to: next.text,
        });
        budget--;
        await s
          .notify({
            level: "info",
            content: `Packaging second chance: "${live.title}" was in the bottom ${Math.round(c.percentile * 100)}% of ${format === "long" ? "long videos" : "Shorts"} at ${Math.round(c.hours)} hours, so it is now "${next.text}". Judged in three days; privacy untouched.`,
          })
          .catch(() => undefined);
        continue;
      }
      // No better title: a long video's best other thumbnail, when its live picture is still the factory's own.
      const pk = ep.assets_json?.packaging;
      const thumb = ep.assets_json?.thumb;
      const alt = pk?.thumbScores
        ? Object.entries(pk.thumbScores)
            .filter(([f]) => f !== thumb)
            .sort((a, b) => b[1] - a[1])[0]
        : undefined;
      if (
        format === "long" &&
        thumb &&
        alt &&
        pk?.thumbScores &&
        alt[1] - (pk.thumbScores[thumb] ?? 0) >= st.minLift &&
        live.thumbUrl
      ) {
        const dir = path.join(s.cfg.dataDir, "episodes", ep.id);
        const liveFile = path.join(dir, "live_thumb_check.jpg");
        const same =
          (await download(live.thumbUrl, liveFile, s.fetchFn ?? fetch)) &&
          ((await imageDistance(liveFile, path.join(dir, thumb))) ?? 1) < 0.08;
        if (!same) {
          await skip(
            "the live thumbnail is not the factory's: changed by hand or by a test",
          );
          continue;
        }
        await yt.setThumbnail(ep.youtube_video_id!, path.join(dir, alt[0]));
        const record = {
          at: s.now().toISOString(),
          kind: "thumbnail" as const,
          from: thumb,
          to: alt[0],
        };
        const assets = {
          ...ep.assets_json!,
          thumb: alt[0],
          packaging: { ...pk, secondChance: record },
        };
        await s.db.query(`UPDATE episodes SET assets_json = $2 WHERE id = $1`, [
          ep.id,
          JSON.stringify(assets),
        ]);
        await logEvent(s.db, ep.id, "packaging_second_chance", {
          kind: "thumbnail",
          from: thumb,
          to: alt[0],
          percentile: Number(c.percentile.toFixed(2)),
          hours: Number(c.hours.toFixed(1)),
          beforeViews,
        });
        report.applied.push({
          episode: ep.id,
          kind: "thumbnail",
          from: thumb,
          to: alt[0],
        });
        budget--;
        continue;
      }
      await skip("no candidate scores clearly better than the live packaging");
    } catch (err) {
      await skip(`error: ${errorMessage(err).slice(0, 200)}`);
      log("warn", "packaging second chance failed", {
        episode: ep.id,
        error: errorMessage(err),
      });
    }
  }
  return report;
}

/** Judges every change at least 72 hours old that has no verdict yet. */
export async function judgeChanges(
  s: Pick<SecondChanceServices, "db" | "now" | "notify" | "youtube">,
): Promise<SecondChanceReport["judged"]> {
  const out: SecondChanceReport["judged"] = [];
  const rows = await s.db.query<{
    id: number;
    episode_id: string;
    detail: any;
    created_at: string;
  }>(
    `SELECT c.id, c.episode_id, c.detail, c.created_at FROM events c
      WHERE c.kind = 'packaging_second_chance' AND c.created_at < $1
        AND NOT EXISTS (SELECT 1 FROM events j WHERE j.kind = 'packaging_judged' AND j.episode_id = c.episode_id)`,
    [new Date(s.now().getTime() - 72 * 3600_000)],
  );
  for (const r of rows) {
    try {
      const [ep] = await s.db.query<Episode & { live_at: string }>(
        `SELECT e.*, ${LIVE_AT("e")} AS live_at FROM episodes e WHERE e.id = $1`,
        [r.episode_id],
      );
      if (!ep?.youtube_video_id || !ep.script_json) continue;
      const now = (await s.youtube(ep).stats([ep.youtube_video_id])).get(
        ep.youtube_video_id,
      )?.views;
      if (now === undefined) continue;
      const changedAt = new Date(r.created_at).getTime();
      const beforeHours =
        (changedAt - new Date(ep.live_at).getTime()) / 3600_000;
      const afterHours = (s.now().getTime() - changedAt) / 3600_000;
      const control = await controlRatio(s.db, formatOf(ep.script_json));
      const before = Number(r.detail?.beforeViews ?? 0);
      const v = judge({
        beforeViews: before,
        beforeHours,
        afterViews: Math.max(0, now - before),
        afterHours,
        control,
      });
      await logEvent(s.db, ep.id, "packaging_judged", {
        kind: r.detail?.kind,
        from: r.detail?.from,
        to: r.detail?.to,
        beforeViews: before,
        viewsNow: now,
        ratio: Number(v.ratio.toFixed(2)),
        control: Number(control.toFixed(2)),
        relative: Number(v.relative.toFixed(2)),
        verdict: v.verdict,
      });
      out.push({ episode: ep.id, verdict: v.verdict, relative: v.relative });
      await s
        .notify({
          level: "info",
          content: `Packaging verdict: "${r.detail?.from}" to "${r.detail?.to}" ${v.verdict} (views per hour ${v.ratio.toFixed(2)}x before, against ${control.toFixed(2)}x for similar videos).`,
        })
        .catch(() => undefined);
    } catch (err) {
      log("warn", "packaging verdict failed", {
        episode: r.episode_id,
        error: errorMessage(err),
      });
    }
  }
  return out;
}

