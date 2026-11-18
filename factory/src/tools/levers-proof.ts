// The platform levers by hand, read only (src/levers):
//   ypp       the Partner Programme count from YouTube Analytics through the factory's stored login, with the projection
//             and the weekly line; writes <out>/ypp.json and ypp.md. --status=<status.json> also puts the number into
//             the owner's dashboard file (on the PC).
//   page      the pulsegmg.com page of the newest public long video with ANSWER_PAGES on, and its description with
//             ANSWER_PACK on, written to <out>/answer-page.html and answer-description.txt.
//   live      whether the channel can stream and what the live watcher would see now (no writes).
// Nothing is posted, changed or uploaded; tokens are never printed.
//   node --import tsx src/tools/levers-proof.ts <ypp|page|live> <out dir> [--status=path]
//   DRYRUN_DB_DIR=<copy of the database folder> reads a copy (the live database is held by the running factory).
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { openDb, type Db } from "../db.ts";
import { getEpisode } from "../episodes.ts";
import { oauthConfig } from "../services.ts";
import { accessToken } from "../youtube/oauth.ts";
import { LeverApi } from "../levers/ytapi.ts";
import {
  measureYpp,
  mergeStatus,
  withYpp,
  yppLine,
  yppProjection,
} from "../levers/ypp.ts";
import { readArchives } from "../levers/archives.ts";
import { liveEligibility } from "../liveclips/simulcast.ts";
import {
  articlePage,
  SITE_EPISODES_SQL,
  type SiteEpisode,
} from "../web/site.ts";
import { longAnswerPack, videoMetadata } from "../pipeline.ts";

const [mode, outArg] = process.argv.slice(2);
const arg = (k: string) =>
  process.argv
    .find((a) => a.startsWith(`--${k}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const out = path.resolve(outArg ?? "levers-proof");
fs.mkdirSync(out, { recursive: true });
const cfg = loadConfig();
const dbDir = process.env.DRYRUN_DB_DIR;
const db: Db = dbDir
  ? await openDb("", path.dirname(path.resolve(dbDir)))
  : await openDb(cfg.databaseUrl, cfg.dataDir);
const token = () => accessToken(db, oauthConfig(cfg));
const api = new LeverApi(token);
const now = new Date();

if (mode === "ypp") {
  const deadline = cfg.levers.yppDeadline;
  const m = await measureYpp(api, now, deadline);
  const p = yppProjection(m, deadline);
  const rec = withYpp(undefined, p);
  fs.writeFileSync(path.join(out, "ypp.json"), JSON.stringify(rec, null, 2));
  fs.writeFileSync(
    path.join(out, "ypp.md"),
    [
      `# Partner Programme watch hours, measured ${now.toISOString()}`,
      "",
      yppLine(p),
      "",
      `- Window: ${m.from} to ${m.to} (Analytics lags about two days); sorted by ${m.method}.`,
      `- Public long videos: ${m.longHours} h; public saved streams: ${m.liveHours} h; last 28 days: ${m.recentHours} h.`,
      `- Analytics' channel-wide long-form and live total (no per-video split, upper bound): ${m.channelLongHours ?? "?"} h.`,
      `- Not counted: ${m.notPublicHours} h on videos not public now; ${m.shortsHours} h of Shorts.`,
      `- Leaving the 365-day window before ${deadline}: ${m.leavingHours} h (upper bound).`,
      `- Days left: ${p.daysLeft}; pace ${p.perDay} h a day; projected ${p.projectedHours} h; needed ${p.neededPerDay} h a day (3,000-hour tier: ${p.tierNeededPerDay}).`,
      `- Subscribers: ${m.subscribers ?? "hidden"}; net ${m.recentSubs ?? "?"} in 28 days; projected ${p.projectedSubs ?? "?"} by the deadline.`,
      p.reach4000On
        ? `- At this pace 4,000 hours arrives on ${p.reach4000On}.`
        : "- At this pace 4,000 hours is more than five years away.",
    ].join("\n"),
  );
  const status = arg("status");
  if (status && fs.existsSync(status)) {
    const merged = mergeStatus(
      JSON.parse(fs.readFileSync(status, "utf8")),
      p,
      now,
    );
    fs.writeFileSync(status, `${JSON.stringify(merged, null, 2)}\n`);
  }
  console.log(yppLine(p));
} else if (mode === "page") {
  const eps = await db.query<SiteEpisode>(SITE_EPISODES_SQL, [500]);
  const long =
    eps.find(
      (e) =>
        e.script_json?.runtime === "long" &&
        e.script_json?.evergreen_format === "documentary",
    ) ?? eps.find((e) => e.script_json?.runtime === "long");
  if (!long) throw new Error("no public long video");
  const ep = await getEpisode(db, long.id);
  if (!ep) throw new Error("episode not found");
  const pack = {
    ...longAnswerPack(ep),
    ...(ep.assets_json?.durationSeconds
      ? { duration: ep.assets_json.durationSeconds }
      : {}),
  };
  const base = (cfg.siteUrl || "https://pulsegmg.com").replace(/\/$/, "");
  const html = articlePage(long, base, { uk: "pulsegamingnews-21" }, "US", {
    pack,
  })
    // Fonts and icons from the live site, so the file opens on its own.
    .replace(/(["'(])\/(assets|img)\//g, `$1${base}/$2/`);
  fs.writeFileSync(path.join(out, "answer-page.html"), html);
  const meta = videoMetadata(ep, "public", true, undefined, false, now, undefined, {
    answerPack: true,
    streamArchiveLinks: false,
  });
  fs.writeFileSync(path.join(out, "answer-description.txt"), meta.description);
  fs.writeFileSync(
    path.join(out, "answer-pack.json"),
    JSON.stringify(
      { id: ep.id, video: ep.youtube_video_id, title: meta.title, pack },
      null,
      2,
    ),
  );
  console.log(
    `page for ${ep.id} (${ep.youtube_video_id}): ${pack.chapters.length} chapters, ${pack.facts.length} key facts`,
  );
} else if (mode === "live") {
  const e = await liveEligibility(await token());
  const active = e.liveEnabled
    ? await api.broadcasts("active").catch((err) => String(err))
    : [];
  const report = {
    eligibility: e,
    active,
    archives: readArchives(cfg.dataDir),
  };
  fs.writeFileSync(
    path.join(out, "live.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(e.note);
} else {
  throw new Error(
    "usage: levers-proof.ts <ypp|page|live> <out dir> [--status=path]",
  );
}
await db.close?.();
