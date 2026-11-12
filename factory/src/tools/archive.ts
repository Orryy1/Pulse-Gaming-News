// The curated archive's ranking and picks by hand, read-only (ARCHIVE_BACKLOG, src/sceneindex/archive.ts): the
// backlog ranked from Pulse's own episodes, and for the top games the upload the archive would index, by the launch
// picker's rules (searches and upload details only; nothing is downloaded, nothing is written but the report).
//   node --import tsx src/tools/archive.ts rank [--coverage=coverage.json] [--pick=20] [--full-top=15] [--out=backlog.json] [--html=backlog.html]
//   node --import tsx src/tools/archive.ts light [--coverage=coverage.json] [--from=1 --to=100] [--comments=300]
//        (the light index for each ranked game into DATA_DIR, one after another: captions, chapters, storyboard, comments)
// coverage.json: [{ "game": "...", "n": episodes, "views": best views added up }], as the factory's episodes give it.

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  ARCHIVE_BACKLOG,
  siblingsOf,
  rankBacklog,
  type CoverageRow,
  type RankedGame,
} from "../sceneindex/archive.ts";
import {
  chooseSource,
  launchCandidates,
  judgeUploads,
} from "../sceneindex/build.ts";
import { buildLight } from "../sceneindex/light.ts";
import { gameNames } from "../sceneindex/names.ts";
import { loadSceneIndex, type SceneSource } from "../sceneindex/schema.ts";

const [, , command, ...rest] = process.argv;
const flag = (name: string): string | undefined => {
  const hit = rest.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined
    ? undefined
    : hit.includes("=")
      ? hit.slice(hit.indexOf("=") + 1)
      : "true";
};
const num = (v: string | undefined, d: number) =>
  v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d;
const ytdlp =
  process.env.YTDLP_PATH && fsSync.existsSync(process.env.YTDLP_PATH)
    ? process.env.YTDLP_PATH
    : "yt-dlp";
const dataDir = path.resolve(process.env.DATA_DIR || "./data");

async function coverage(): Promise<CoverageRow[]> {
  const file = flag("coverage");
  if (!file) return [];
  const rows = JSON.parse(await fs.readFile(file, "utf8")) as Array<{
    game?: string | null;
    n?: number | string;
    views?: number | string;
  }>;
  return rows.flatMap((r) =>
    r.game
      ? [{ game: r.game, n: Number(r.n) || 0, views: Number(r.views) || 0 }]
      : [],
  );
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const hm = (sec: number) =>
  `${Math.floor(sec / 3600)} h ${String(Math.round((sec % 3600) / 60)).padStart(2, "0")} min`;

interface Picked extends RankedGame {
  pick?: SceneSource;
  candidates?: number;
  clean?: number;
  seconds?: number;
}

function html(rows: Picked[], when: string): string {
  const body = rows
    .map(
      (g) =>
        `<tr><td>${g.rank}</td><td><b>${esc(g.game)}</b><br><small>${esc(g.franchise)}, ${g.year}${g.full ? " &middot; full index" : ""}</small></td><td>${g.score}</td><td><small>${esc(g.why)}</small></td><td>${
          g.pick
            ? `<a href="https://www.youtube.com/watch?v=${g.pick.videoId}">${esc(g.pick.title)}</a><br><small>${esc(g.pick.uploader)} &middot; ${g.pick.kind} &middot; ${hm(g.pick.duration)} &middot; ${g.pick.height ?? "?"}p</small>`
            : g.candidates === undefined
              ? "<small>not searched (beyond the top picks)</small>"
              : "<small>no clean upload found</small>"
        }</td><td><small>${g.clean ?? ""}${g.candidates !== undefined ? ` of ${g.candidates}` : ""}</small></td></tr>`,
    )
    .join("\n");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Pulse game archive backlog</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;background:#111;color:#eee}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #333;padding:6px 8px;vertical-align:top;text-align:left}a{color:#ffb35c}small{color:#aaa}</style></head>
<body><h1>Game archive backlog</h1><p>Ranked from Pulse's own episodes, the analytics loop's best franchises and popularity. The top games show the upload the archive would index (the launch picker's rules: clean full movie or no-commentary playthrough, no face cam or commentary, no burned-in foreign subtitles, 1080p or better, the most complete). Read-only run, ${esc(when)}.</p>
<table><tr><th>#</th><th>Game</th><th>Score</th><th>Why</th><th>Chosen upload</th><th>Clean of found</th></tr>
${body}</table></body></html>`;
}

async function main(): Promise<void> {
  const fullTop = num(flag("full-top"), 15);
  const ranked = rankBacklog(ARCHIVE_BACKLOG, await coverage(), { fullTop });
  if (command === "rank") {
    const pickN = num(flag("pick"), 20);
    const rows: Picked[] = ranked.map((g) => ({ ...g }));
    let next = 0;
    const worker = async () => {
      while (next < Math.min(pickN, rows.length)) {
        const g = rows[next++]!;
        const t0 = Date.now();
        const found = await launchCandidates(g.game, ytdlp);
        g.candidates = found.length;
        g.clean = judgeUploads(found, g.game, {
          recentRelease: g.recent,
          maxHours: 12,
        }).filter((v) => v.ok).length;
        g.pick = await chooseSource(
          g.game,
          { ytdlp, maxHours: 12 },
          { recentRelease: g.recent, complete: true, siblings: siblingsOf(g.game) },
          {
            // The searches just made, not made again.
            search: async (q) => (q ? found : []),
          },
        );
        g.seconds = Math.round((Date.now() - t0) / 1000);
        console.log(
          `${g.rank}. ${g.game}: ${g.pick ? `${g.pick.videoId} ${g.pick.kind} ${Math.round(g.pick.duration / 60)} min ${g.pick.height}p "${g.pick.title}"` : "no clean upload"} (${g.clean} clean of ${g.candidates}, ${g.seconds} s)`,
        );
      }
    };
    await Promise.all(Array.from({ length: num(flag("parallel"), 3) }, worker));
    const when = new Date().toISOString();
    const out = flag("out");
    if (out)
      await fs.writeFile(
        out,
        JSON.stringify({ at: when, fullTop, games: rows }, null, 1),
      );
    const page = flag("html");
    if (page) await fs.writeFile(page, html(rows, when));
    return;
  }
  if (command === "light") {
    // The light index for each ranked game in turn (a sandbox DATA_DIR for trials). Prints one line a game.
    const from = num(flag("from"), 1);
    const to = num(flag("to"), ranked.length);
    const picks = flag("picks")
      ? (
          JSON.parse(await fs.readFile(flag("picks")!, "utf8")) as {
            games: Picked[];
          }
        ).games
      : [];
    for (const g of ranked.filter((r) => r.rank >= from && r.rank <= to)) {
      const t0 = Date.now();
      try {
        const had = await loadSceneIndex(dataDir, g.game);
        const source =
          had?.source ??
          picks.find((p) => p.game === g.game)?.pick ??
          (await chooseSource(
            g.game,
            { ytdlp, maxHours: 12 },
            { recentRelease: g.recent, complete: true, siblings: siblingsOf(g.game) },
          ));
        if (!source) {
          console.log(
            JSON.stringify({
              rank: g.rank,
              game: g.game,
              outcome: "no-source",
              seconds: Math.round((Date.now() - t0) / 1000),
            }),
          );
          continue;
        }
        const r = await buildLight(
          g.game,
          source,
          {
            dataDir,
            ytdlp,
            comments: num(flag("comments"), 300),
            ocr: Boolean(flag("ocr")),
          },
          { names: gameNames },
        );
        console.log(
          JSON.stringify({
            rank: g.rank,
            game: g.game,
            outcome: "light",
            videoId: source.videoId,
            minutes: Math.round(source.duration / 60),
            ...r.stats,
            totalSeconds: Math.round((Date.now() - t0) / 1000),
          }),
        );
      } catch (err) {
        console.log(
          JSON.stringify({
            rank: g.rank,
            game: g.game,
            outcome: "failed",
            error: String((err as Error)?.message ?? err).slice(0, 200),
          }),
        );
      }
    }
    return;
  }
  console.error("usage: archive.ts rank|light [options]");
  process.exitCode = 2;
}

await main();
