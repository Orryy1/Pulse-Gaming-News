// Plans the "related video" link for each recent Short (set by hand-like clicks in YouTube Studio; the
// Data API cannot set it). The fastest-growing channels link every Short to a long video on the same
// subject; the rest to a hub. Rules, in order:
//   1. a Short cut from a long ranking links to that ranking;
//   2. a Short about a series that has a long video links to the newest such long video;
//   3. anything else links to the newest long video (the hub).
// Prints JSON: [{ short, title, target, targetTitle, reason }]. Skips Shorts already in
// data/admin/related_done.json (written by whoever sets the links).
// Usage: node --import tsx src/tools/related-plan.ts [days=3]
process.loadEnvFile(".env");
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { YTDLP_TEXT } from "../lib/bin.ts";

interface Row {
  id: string;
  lane: string;
  youtube_video_id: string | null;
  live_at: string | null;
  script_json?: {
    game_title?: string;
    headline?: string;
    runtime?: string;
    youtube?: { title?: string };
    cutdown?: { parent_video?: string };
  };
}

const days = Number(process.argv[2] ?? 3);
const port = process.env.PORT || "8080";
const key = process.env.ADMIN_TOKEN ?? "";
const res = await fetch(`http://127.0.0.1:${port}/admin/export?days=${days}`, {
  headers: { "x-admin-key": key },
});
if (!res.ok) throw new Error(`export failed: HTTP ${res.status}`);
const body = (await res.json()) as Row[] | Record<string, Row[]>;
const rows: Row[] = Array.isArray(body)
  ? body
  : (Object.values(body).find(Array.isArray) ?? []);

// Long videos on the channel, newest first (the factory's export only covers its own episodes).
const ytdlp = process.env.YTDLP_PATH || "yt-dlp";
const longs = execFileSync(
  ytdlp,
  [
    ...YTDLP_TEXT.args,
    "--no-warnings",
    "--flat-playlist",
    "--playlist-end",
    "30",
    "--print",
    "%(id)s\t%(duration)s\t%(title)s",
    "https://www.youtube.com/channel/UCvgNDjtTezrpxL8oUe6mYwA/videos",
  ],
  { encoding: "utf8", env: YTDLP_TEXT.env },
)
  .split("\n")
  .map((l) => l.split("\t"))
  .filter(
    (p) => p.length === 3 && Number(p[1]) >= 180 && Number(p[1]) < 3 * 3600,
  )
  .map(([id, , title]) => ({ id: id!, title: title! }));
if (!longs.length) throw new Error("no long videos found on the channel");

const doneFile = "data/admin/related_done.json";
const done = new Set<string>(
  fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, "utf8")) : [],
);

// Series words: a Short about "Call of Duty 4" matches the long "Call of Duty Campaigns Ranked".
const series = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !/^(ranked|worst|best|every|games|game|campaigns|from|with|this|that|what|year)$/.test(
          w,
        ),
    );
const plan = rows
  .filter(
    (r) =>
      r.youtube_video_id &&
      r.script_json?.runtime !== "long" &&
      !done.has(r.youtube_video_id),
  )
  .map((r) => {
    const sc = r.script_json ?? {};
    const title = sc.youtube?.title ?? sc.headline ?? "";
    if (sc.cutdown?.parent_video)
      return {
        short: r.youtube_video_id!,
        title,
        target: sc.cutdown.parent_video,
        targetTitle:
          longs.find((l) => l.id === sc.cutdown!.parent_video)?.title ?? "",
        reason: "cut from this ranking",
      };
    const words = series(`${sc.game_title ?? ""} ${title}`);
    const match = longs.find((l) => {
      const lw = series(l.title);
      return words.filter((w) => lw.includes(w)).length >= 2;
    });
    const target = match ?? longs[0]!;
    return {
      short: r.youtube_video_id!,
      title,
      target: target.id,
      targetTitle: target.title,
      reason: match ? "same series" : "newest long video",
    };
  });
console.log(JSON.stringify(plan, null, 2));
