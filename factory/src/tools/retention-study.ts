// The retention study by hand (src/retentionlearn.ts): reads the audience retention curve of the channel's last N
// Shorts that are at least 48 hours old (and the long videos of the same weeks) straight from YouTube Analytics through
// the factory's stored login, lines every drop up with the episode's records and writes the study as JSON and an HTML
// page with each curve, its drops and the top drop causes. Read only: it stores nothing, posts nothing, changes nothing.
// About one Analytics request per video (the Analytics API has its own quota, apart from the Data API's).
//   node --import tsx src/tools/retention-study.ts <out dir> [--shorts=30] [--no-long] [--cached]
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
import { segmentInputs } from "../pipeline.ts";
import {
  analyticsScopeOk,
  buildStudy,
  EARLY_HOURS,
  retentionSection,
  type Curve,
  type RetentionStudy,
} from "../retentionlearn.ts";

const cfg = loadConfig();
const outDir = path.resolve(process.argv[2] ?? "retention-study");
const arg = (k: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const shortsWanted = Number(arg("shorts") ?? 30);
const withLong = !process.argv.includes("--no-long");
const dbDir = process.env.DRYRUN_DB_DIR;
const db: Db = dbDir
  ? await openDb("", path.dirname(path.resolve(dbDir)))
  : await openDb(cfg.databaseUrl, cfg.dataDir);
const oc = oauthConfig(cfg);
const stored = Boolean(
  await storedRefreshToken(db, { ...oc, envRefreshToken: "" }),
);
if (!stored)
  throw new Error(
    "the factory has no stored YouTube login (settings youtube_refresh_token); the .env token lacks scopes",
  );
const token = await accessToken(db, oc);
const scope = await analyticsScopeOk(token);
console.log(
  `stored login: yes; yt-analytics scope: ${scope.ok ? "yes" : "NO"} (${scope.scopes.length} scopes granted)`,
);
if (!scope.ok)
  throw new Error(
    "the stored login lacks yt-analytics.readonly: reconnect at /oauth/start",
  );
const yt = new YouTubeClient(() => accessToken(db, oc));
const now = new Date();

const pick = async (long: boolean, limit: number) =>
  db.query<{
    id: string;
    lane: string;
    youtube_video_id: string;
    script_json: any;
    assets_json: any;
    live_at: string;
    game_audio: unknown;
    retention: unknown;
  }>(
    `SELECT e.id, e.lane, e.youtube_video_id, e.script_json, e.assets_json, ${LIVE_AT("e")} AS live_at,
            (SELECT v.detail FROM events v WHERE v.episode_id = e.id AND v.kind = 'game_audio' ORDER BY v.id DESC LIMIT 1) AS game_audio,
            (SELECT m.raw FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'retention') AS retention
       FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.lane <> 'twin'
        AND e.lane ${long ? "=" : "<>"} 'longform'
        AND ${LIVE_AT("e")} < $1::timestamptz - make_interval(hours => $2)
      ORDER BY ${LIVE_AT("e")} DESC LIMIT $3`,
    [now, EARLY_HOURS, limit],
  );
const eps = [
  ...(await pick(false, shortsWanted)),
  ...(withLong ? await pick(true, 6) : []),
];
const rows = [];
// --cached: the curves read by the last run in this folder, so the report can be rebuilt without asking YouTube again.
const cacheFile = path.join(outDir, "curves.json");
const cache: Record<string, Curve> = process.argv.includes("--cached") && fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const noCurve: string[] = [];
for (const e of eps) {
  let curve: Curve = cache[e.youtube_video_id] ?? [];
  if (!curve.length) try {
    curve = await yt.retentionCurve!(
      e.youtube_video_id,
      new Date(e.live_at).toISOString().slice(0, 10),
      now.toISOString().slice(0, 10),
    );
  } catch (err) {
    console.error(
      `curve failed for ${e.youtube_video_id}: ${(err as Error).message.slice(0, 160)}`,
    );
  }
  cache[e.youtube_video_id] = curve;
  if (curve.length < 20) {
    noCurve.push(e.id);
    continue;
  }
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  rows.push({
    id: e.id,
    lane: e.lane,
    videoId: e.youtube_video_id,
    script: parse(e.script_json),
    assets: parse(e.assets_json),
    label: "live",
    curve,
    gameAudio: parse(e.game_audio) as any,
    stayed: stayedOf(parse(e.retention)),
  });
}
const study = buildStudy(rows, segmentInputs, now);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(cacheFile, JSON.stringify(cache));
fs.writeFileSync(
  path.join(outDir, "retention-study.json"),
  `${JSON.stringify({ ...study, asked: eps.length, no_curve: noCurve, login: { stored, analytics_scope: scope.ok } }, null, 1)}\n`,
);
fs.writeFileSync(
  path.join(outDir, "retention-study.html"),
  html(study, eps.length, noCurve.length),
);
console.log(retentionSection(study).join("\n"));
console.log("\nLessons:\n" + study.lessons.map((l) => `- ${l}`).join("\n"));
console.log(`\nwritten to ${outDir}`);
await db.close();

/** The share who stayed to watch (engaged views over views) from a stored "retention" row. */
function stayedOf(raw: any): number | undefined {
  const v = Number(raw?.views ?? 0);
  const e = Number(raw?.engagedViews ?? NaN);
  return v > 0 && Number.isFinite(e) ? Math.min(1, e / v) : undefined;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

function curveSvg(v: RetentionStudy["videos"][number]): string {
  const W = 520;
  const H = 150;
  const max = Math.max(1, ...v.curve.map((p) => p.watch));
  const x = (at: number) => (at * W).toFixed(1);
  const y = (w: number) => (H - (w / max) * (H - 10)).toFixed(1);
  const line = [...v.curve]
    .sort((a, b) => a.at - b.at)
    .map((p, i) => `${i ? "L" : "M"}${x(p.at)},${y(p.watch)}`)
    .join(" ");
  const drops = v.drops
    .map(
      (d) =>
        `<rect x="${x(d.from / v.duration)}" y="0" width="${Math.max(2, ((d.to - d.from) / v.duration) * W).toFixed(1)}" height="${H}" fill="#ff6b1a" opacity="0.25"><title>${esc(`${d.from.toFixed(1)}-${d.to.toFixed(1)} s: lost ${Math.round(d.loss * 100)}% (${Math.round(d.excess * 100)} beyond our usual curve). ${d.part}. "${d.said}"`)}</title></rect>`,
    )
    .join("");
  const open = `<rect x="0" y="0" width="${((2 / v.duration) * W).toFixed(1)}" height="${H}" fill="#888" opacity="0.15"><title>first 2 s: lost ${Math.round(v.openingLoss * 100)}%</title></rect>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="retention curve">${open}${drops}<path d="${line}" fill="none" stroke="#e8e8e8" stroke-width="2"/><line x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" stroke="#555" stroke-dasharray="3 3"/></svg>`;
}

function html(st: RetentionStudy, asked: number, missing: number): string {
  const shorts = st.videos.filter((v) => v.kind === "short");
  const causes = st.causes.slice(0, 5);
  const card = (v: RetentionStudy["videos"][number]) => `
  <section class="video">
    <h3>${esc(v.title)} <small>${v.kind === "long" ? "long video" : "Short"}, ${v.duration.toFixed(0)} s, <a href="https://youtu.be/${v.videoId}">${v.videoId}</a></small></h3>
    <p class="meta">Gone after 2 s: <b>${Math.round(v.openingLoss * 100)}%</b>. Still watching near the end: <b>${Math.round(Math.min(1, v.endWatch) * 100)}%</b>. Opening: ${esc(v.video.join(", ") || "not recorded")}.</p>
    ${curveSvg(v)}
    ${v.drops.length ? `<ul>${v.drops.map((d) => `<li><b>${d.from.toFixed(1)}-${d.to.toFixed(1)} s</b>, ${esc(d.part)}: lost ${Math.round(d.loss * 100)}% (${Math.round(d.excess * 100)} points beyond our Shorts' usual loss at that point; relative to similar videos ${d.relative.toFixed(2)}). Said: "${esc(d.said)}". On screen: ${esc(d.tags.filter((t) => !t.startsWith("during")).join(", "))}.</li>`).join("")}</ul>` : `<p class="meta">No drop beyond our usual curve after the opening.</p>`}
  </section>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Pulse retention study ${st.at.slice(0, 10)}</title>
<style>
body{background:#111;color:#e8e8e8;font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem}
h1{color:#ff6b1a}h2{border-bottom:1px solid #333;padding-bottom:.3rem}small,.meta{color:#aaa}
.cause{background:#1b1b1b;border-left:4px solid #ff6b1a;padding:.6rem 1rem;margin:.6rem 0}
.video{background:#181818;padding:.8rem 1rem;margin:1rem 0;border-radius:6px}a{color:#ffa060}
table{border-collapse:collapse}td,th{padding:.2rem .6rem;border-bottom:1px solid #2a2a2a;text-align:left}
</style></head><body>
<h1>Where viewers leave Pulse's videos</h1>
<p>YouTube Analytics retention curves (audienceWatchRatio and relativeRetentionPerformance by elapsedVideoTimeRatio), read ${st.at.slice(0, 16).replace("T", " ")} UTC for the last ${asked} videos at least 48 hours old; ${st.videos.length} had enough views for a curve${missing ? `, ${missing} did not` : ""}${st.skipped.length ? `, ${st.skipped.length} lacked word timings or a plan` : ""}. Each drop is a run where viewers left at more than twice what our Shorts usually lose at that point of their length, costing at least 2% of those watching beyond it; the first 2 seconds (the swipe) are judged apart. Grey band: first 2 s. Orange bands: drops.</p>
<h2>Top ${causes.length} drop causes</h2>
${causes.length ? causes.map((c, k) => `<div class="cause"><b>${k + 1}. ${esc(c.tag)}</b> (${c.kind === "opening" ? "the first 2 seconds" : "drops after the opening"}): <b>${c.points.toFixed(1)} points</b> of each Short's audience. ${esc(c.detail)}.${c.examples.length ? `<br><small>For example: ${c.examples.map((e) => `"${esc(e.title)}" at ${e.at.toFixed(1)} s, lost ${Math.round(e.loss * 100)}%, said "${esc(e.said)}"`).join("; ")}</small>` : ""}</div>`).join("") : "<p>No cause has three Shorts behind it yet.</p>"}
<h2>Lessons for the writers</h2>
<ul>${st.lessons.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<h2>How fast viewers left while each thing was on screen</h2>
<p class="meta">While each thing was up, how fast viewers left against the rest of the same Short (1.00 = the same), after the first 2 s and before the last tenth; points: the extra share of the audience it cost a Short beyond our Shorts' usual curve at that point. ${shorts.length} Shorts.</p>
<table><tr><th>On screen or heard</th><th>Times as fast</th><th>Points a Short</th><th>Seconds a Short</th><th>Faster in</th></tr>
${st.effects.map((r) => `<tr><td>${esc(r.tag)}</td><td>${r.ratio.toFixed(2)}</td><td>${r.points.toFixed(1)}</td><td>${r.seconds.toFixed(1)}</td><td>${r.worse} of ${r.videos}</td></tr>`).join("")}
</table>
<h2>Every video</h2>
${st.videos.map(card).join("")}
</body></html>
`;
}
