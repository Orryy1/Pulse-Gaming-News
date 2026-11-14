// The retention model's dataset by hand (src/retentionmodel.ts): every upload on the channel that is at least 48 hours
// old, its YouTube Analytics retention curve (audienceWatchRatio and relativeRetentionPerformance at each 1% of its
// length) and, where the factory made it, the episode's own records (script, word timings, shot plan, media, game
// sound, engaged views). Read only: it stores nothing in the database and changes nothing on YouTube. About one
// Analytics request per video, cached in the output folder so a rerun only asks for the missing curves.
//   node --import tsx src/tools/retention-dataset.ts <out dir> [--refresh]
//   DRYRUN_DB_DIR=<embedded db folder> reads a copy of the database (the live one is held by the running factory).
process.loadEnvFile(".env");
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { openDb, type Db } from "../db.ts";
import { LIVE_AT } from "../analytics.ts";
import { oauthConfig } from "../services.ts";
import { accessToken, storedRefreshToken } from "../youtube/oauth.ts";
import { YouTubeClient } from "../youtube/upload.ts";
import { analyticsScopeOk, type Curve } from "../retentionlearn.ts";
import type { DatasetVideo } from "../retentionmodel.ts";

const cfg = loadConfig();
const outDir = path.resolve(process.argv[2] ?? "retention-dataset");
const refresh = process.argv.includes("--refresh");
const dbDir = process.env.DRYRUN_DB_DIR;
const db: Db = dbDir
  ? await openDb("", path.dirname(path.resolve(dbDir)))
  : await openDb(cfg.databaseUrl, cfg.dataDir);
const oc = oauthConfig(cfg);
if (!(await storedRefreshToken(db, { ...oc, envRefreshToken: "" })))
  throw new Error(
    "the factory has no stored YouTube login; the .env token lacks scopes",
  );
const scope = await analyticsScopeOk(await accessToken(db, oc));
if (!scope.ok) throw new Error("the stored login lacks yt-analytics.readonly");
const yt = new YouTubeClient(() => accessToken(db, oc));
const now = new Date();
fs.mkdirSync(outDir, { recursive: true });

const uploads = await yt.allUploads();
console.log(`channel uploads: ${uploads.length}`);
const isoSeconds = (d: string) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d ?? "");
  return m
    ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    : 0;
};
const eps = await db.query<any>(
  `SELECT e.id, e.lane, e.youtube_video_id, e.script_json, e.assets_json, ${LIVE_AT("e")} AS live_at,
          (SELECT v.detail FROM events v WHERE v.episode_id = e.id AND v.kind = 'game_audio' ORDER BY v.id DESC LIMIT 1) AS game_audio,
          (SELECT m.raw FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'retention') AS retention,
          (SELECT m.raw FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'curve') AS curve7,
          (SELECT m.raw FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'curve_2d') AS curve2
     FROM episodes e WHERE e.youtube_video_id IS NOT NULL AND e.status = 'published'`,
);
const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const byVideo = new Map(eps.map((e) => [e.youtube_video_id as string, e]));

const cacheFile = path.join(outDir, "curves.json");
const cache: Record<string, Curve> =
  !refresh && fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
    : {};
const out: DatasetVideo[] = [];
let asked = 0;
let failed = 0;
for (const u of uploads) {
  const id = String(u.id);
  const published = new Date(String(u.publishedAt ?? 0));
  if (now.getTime() - published.getTime() < 48 * 3600_000) continue;
  let curve = cache[id];
  if (!curve) {
    try {
      curve = await yt.retentionCurve(
        id,
        published.toISOString().slice(0, 10),
        now.toISOString().slice(0, 10),
      );
      asked++;
    } catch (err) {
      failed++;
      console.error(
        `curve failed for ${id}: ${(err as Error).message.slice(0, 120)}`,
      );
      continue;
    }
    cache[id] = curve;
    if (asked % 25 === 0) fs.writeFileSync(cacheFile, JSON.stringify(cache));
  }
  const e = byVideo.get(id);
  const ret = parse(e?.retention) as any;
  const views = Number(ret?.views ?? 0);
  out.push({
    videoId: id,
    title: String(u.title ?? ""),
    publishedAt: published.toISOString(),
    duration: isoSeconds(String(u.duration ?? "")),
    views: Number(u.views ?? 0),
    privacy: String(u.privacy ?? ""),
    curve,
    ...(e
      ? {
          episode: {
            id: e.id,
            lane: e.lane,
            script: parse(e.script_json),
            assets: parse(e.assets_json),
            gameAudio: parse(e.game_audio) ?? null,
            stayed:
              views > 0 && Number.isFinite(Number(ret?.engagedViews))
                ? Math.min(1, Number(ret.engagedViews) / views)
                : undefined,
            stored: {
              week: (parse(e.curve7) as Curve | null) ?? undefined,
              early: (parse(e.curve2) as Curve | null) ?? undefined,
            },
          },
        }
      : {}),
  });
}
fs.writeFileSync(cacheFile, JSON.stringify(cache));
fs.writeFileSync(
  path.join(outDir, "dataset.json"),
  JSON.stringify({
    at: now.toISOString(),
    uploads: uploads.length,
    videos: out,
  }),
);
const withCurve = out.filter((v) => v.curve.length >= 20);
console.log(
  `videos 48h+: ${out.length}; with a curve: ${withCurve.length}; factory episodes with a curve: ${withCurve.filter((v) => v.episode).length}; asked now: ${asked}; failed: ${failed}`,
);
await db.close();
