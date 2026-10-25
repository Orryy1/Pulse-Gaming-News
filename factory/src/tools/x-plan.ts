// What to post on X: the Shorts and long videos that went live in the last day and a half and have not
// been posted yet. X's API is pay-per-use (HTTP 402 "credits depleted" since Oct 2026), so posting is
// done through the owner's signed-in browser by the "Pulse: X posts" scheduled task, which runs this
// tool, uploads each Short's own video with the text, replies with the YouTube link, and records the
// episode in data/admin/x_posted.json.
// Prints JSON: [{ id, video, text, reply, title, youtube }]. Usage: node --import tsx src/tools/x-plan.ts [max=6]
process.loadEnvFile(".env");
import fs from "node:fs";
import path from "node:path";
import { polishTitle } from "../editorial/seo.ts";
import type { Script } from "../editorial/schema.ts";

interface Row {
  id: string;
  lane: string;
  youtube_video_id: string | null;
  live_at: string | null;
  script_json?: Script;
}

const max = Number(process.argv[2] ?? 6);
const port = process.env.PORT || "8080";
const key = process.env.ADMIN_TOKEN ?? "";
const ledgerFile = path.resolve("data/admin/x_posted.json");
const posted = new Set<string>(
  fs.existsSync(ledgerFile)
    ? (JSON.parse(fs.readFileSync(ledgerFile, "utf8")) as string[])
    : [],
);

const res = await fetch(`http://127.0.0.1:${port}/admin/export?days=2`, {
  headers: { "x-admin-key": key },
});
if (!res.ok) throw new Error(`export failed: HTTP ${res.status}`);
const body = (await res.json()) as Row[] | Record<string, Row[]>;
const rows: Row[] = Array.isArray(body)
  ? body
  : (Object.values(body).find(Array.isArray) ?? []);

const since = Date.now() - 36 * 3600_000;
const out = rows
  .filter(
    (r) =>
      r.youtube_video_id &&
      r.script_json &&
      r.live_at &&
      new Date(r.live_at).getTime() > since,
  )
  .filter((r) => new Date(r.live_at!).getTime() <= Date.now() + 60_000) // live, not merely scheduled
  .filter((r) => !posted.has(r.id))
  .sort((a, b) => a.live_at!.localeCompare(b.live_at!))
  .slice(0, max)
  .map((r) => {
    const s = r.script_json!;
    const long = s.runtime === "long";
    const youtube = long
      ? `https://youtu.be/${r.youtube_video_id}`
      : `https://youtube.com/shorts/${r.youtube_video_id}`;
    const title = polishTitle(s);
    const tags = (s.hashtags ?? [])
      .slice(0, 2)
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .join(" ");
    const hook = s.hook.trim();
    let text = `${s.is_rumour ? "Report: " : ""}${title}\n\n${hook}${tags ? `\n\n${tags}` : ""}`;
    if (text.length > 270)
      text =
        `${s.is_rumour ? "Report: " : ""}${title}${tags ? `\n\n${tags}` : ""}`.slice(
          0,
          270,
        );
    const video = path.resolve("data/episodes", r.id, "short.mp4");
    return {
      id: r.id,
      title,
      youtube,
      // A Short is posted as its own video (X shows native video far more than links); a long video is a link.
      video: !long && fs.existsSync(video) ? video : null,
      text,
      reply: long
        ? `Watch the full video: ${youtube}`
        : `Watch it on YouTube: ${youtube}`,
    };
  });
console.log(JSON.stringify(out, null, 2));
