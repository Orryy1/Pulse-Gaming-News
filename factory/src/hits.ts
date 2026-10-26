// The take-off detector. A Short that starts travelling is the channel's best chance to grow, and the
// channels that broke out pounced within a day: more on the same game, from fresh angles, while the new
// audience was still arriving. Every 20 minutes the factory checks Shorts in their first two days
// against the channel's usual pace (one quota unit a check). A Short running well ahead of it is
// announced to the owner and becomes the "hot topic" the editors lean towards for three days.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import { LIVE_AT } from "./analytics.ts";
import { logEvent } from "./episodes.ts";
import { QUOTA, quotaAdd } from "./lanes.ts";
import { log } from "./lib/util.ts";

export interface HotTopic {
  game: string;
  title: string;
  videoId: string;
  episodeId: string;
  pace: number; // times the usual views per hour
  until: string; // ISO
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** Views an hour that count as taking off: well ahead of the usual pace, and never below the floor. */
export function hitThreshold(
  usualPerHour: number,
  cfg: Pick<Config, "hitMultiple" | "hitMinPerHour">,
): number {
  return Math.max(cfg.hitMinPerHour, cfg.hitMultiple * usualPerHour);
}

/** The usual views an hour of a Short in its first day: the median 24-hour count of the last 30, over 24. */
export async function usualPace(db: Db): Promise<number> {
  const rows = await db.query<{ views: number | string }>(
    `SELECT m.views FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = '24h' AND e.lane NOT IN ('twin', 'longform') ORDER BY m.captured_at DESC LIMIT 30`,
  );
  return median(rows.map((r) => Number(r.views))) / 24;
}

export async function readHotTopic(
  db: Db,
  now: Date,
): Promise<HotTopic | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'hot_topic'`,
  );
  if (!row) return undefined;
  try {
    const t = JSON.parse(row.value) as HotTopic;
    return new Date(t.until).getTime() > now.getTime() ? t : undefined;
  } catch {
    return undefined;
  }
}

/** The note the story, why, ranking and long-video editors see while a Short is taking off. */
export function hotBlock(t: HotTopic | undefined): string {
  if (!t) return "";
  return `Taking off right now: our Short "${t.title}" is running at ${t.pace}x our usual pace, about ${t.game}. New viewers are finding the channel through it. Until ${t.until.slice(0, 16).replace("T", " ")} UTC, when a ${t.game} story, question or ranking is anywhere near as strong as the alternatives, pick it, from a fresh angle (never the same story again), so the people who just found us get more of what they came for.`;
}

export interface HitDeps {
  db: Db;
  cfg: Config;
  now: () => Date;
  stats: (ids: string[]) => Promise<Map<string, { views: number }>>;
  notify: (m: { content: string; ping?: boolean }) => Promise<unknown>;
}

/** One check: Shorts live 1-48 hours against the usual pace. Returns the ids of new hits. */
export async function watchHits(d: HitDeps): Promise<string[]> {
  const now = d.now();
  const live = await d.db.query<{
    id: string;
    vid: string;
    live_at: string;
    title: string | null;
    game: string | null;
  }>(
    `SELECT e.id, e.youtube_video_id AS vid, ${LIVE_AT("e")} AS live_at,
            e.script_json->'youtube'->>'title' AS title, e.script_json->>'game_title' AS game
       FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane NOT IN ('twin', 'longform')
        AND COALESCE(e.script_json->>'runtime', 'short') = 'short'
        AND ${LIVE_AT("e")} BETWEEN $1::timestamptz - interval '48 hours' AND $1::timestamptz - interval '1 hour'
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'hit')
      LIMIT 50`,
    [now],
  );
  if (!live.length) return [];
  const stats = await d.stats(live.map((r) => r.vid));
  await quotaAdd(d.db, now, QUOTA.poll);
  const usual = await usualPace(d.db);
  const bar = hitThreshold(usual, d.cfg);
  const hits: string[] = [];
  for (const r of live) {
    const views = stats.get(r.vid)?.views ?? 0;
    const hours = Math.max(
      1,
      (now.getTime() - new Date(r.live_at).getTime()) / 3_600_000,
    );
    const perHour = views / hours;
    if (perHour < bar) continue;
    const pace =
      usual > 0 ? Math.round((perHour / usual) * 10) / 10 : Math.round(perHour);
    const title = r.title ?? r.id;
    const game = r.game?.trim() || title;
    await logEvent(d.db, r.id, "hit", {
      views,
      hours: Math.round(hours * 10) / 10,
      perHour: Math.round(perHour),
      usual: Math.round(usual * 10) / 10,
      pace,
    });
    const current = await readHotTopic(d.db, now);
    // A bigger hit replaces a smaller one; otherwise the first one keeps its three days.
    if (!current || pace > current.pace) {
      const t: HotTopic = {
        game,
        title,
        videoId: r.vid,
        episodeId: r.id,
        pace,
        until: new Date(
          now.getTime() + d.cfg.hitHours * 3_600_000,
        ).toISOString(),
      };
      await d.db.query(
        `INSERT INTO settings (key, value) VALUES ('hot_topic', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(t)],
      );
    }
    log("info", "short taking off", {
      episode: r.id,
      views,
      perHour: Math.round(perHour),
      pace,
    });
    await d
      .notify({
        ping: true,
        content: `🔥 Taking off: "${title}" has ${views.toLocaleString("en-US")} views in ${Math.round(hours)} hours, ${pace}x our usual pace. For the next ${Math.round(d.cfg.hitHours / 24)} days the editors lean towards more on ${game}, from fresh angles.\nhttps://youtube.com/shorts/${r.vid}`,
      })
      .catch(() => undefined);
    hits.push(r.id);
  }
  return hits;
}
