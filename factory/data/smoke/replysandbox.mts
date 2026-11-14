// Sandbox proof of the video replies to comments (COMMENT_REPLY_SHORTS, src/commentreply.ts): one real viewer question
// from a live video's comments goes through the real selection, writer, fact check, friend pass, voice, footage, game
// sound, graphics audit and render, in a sandbox database (a restored copy). DRY_RUN and a stubbed Discord keep it all
// inside the sandbox: nothing is uploaded, replied, posted or changed on the channel. The comment is read live, read
// only (one commentThreads request, 1 quota unit). Claude is at its limit, so every model call goes to Codex.
//   node --import tsx data/smoke/replysandbox.mts <sandbox dir with db/> <video id> "<start of the comment>" <scripted|voiced|rendered>
// Run the render phase inside ~/orch/macrun.sh on the Mac so it waits for Pulse's own renders.
import fs from "node:fs";
import path from "node:path";

const [SANDBOX, VIDEO, START, UNTIL = "scripted"] = process.argv.slice(2);
if (!SANDBOX || !VIDEO || !START) throw new Error("usage: replysandbox.mts <sandbox dir> <video id> <comment start> [until]");
if (/PulseFactory[\\/]factory[\\/]data/.test(path.resolve(SANDBOX))) throw new Error("refusing the live factory's data folder");
process.loadEnvFile(process.env.SHOW_ENV ?? `${process.env.HOME}/PulseFactory/factory/.env`);
Object.assign(process.env, {
  DATA_DIR: path.resolve(SANDBOX),
  DATABASE_URL: "",
  DRY_RUN: "true",
  PORT: "0",
  CODEX_LLM: "true",
  CODEX_CALLS: "*",
  CODEX_VISION: "true",
  COMMENT_REPLY_SHORTS: "true",
  COMMENT_REPLY_SLOT: "16:30",
  EVERGREEN_ENABLED: "false",
  LONGFORM_ENABLED: "false",
  GAMEPLAY_ENABLED: "false",
});
const { loadConfig } = await import("../../src/config.ts");
const { openDb, migrate } = await import("../../src/db.ts");
const { createServices, oauthConfig } = await import("../../src/services.ts");
const { advance, maybeSelectCommentReply } = await import("../../src/pipeline.ts");
const { getEpisode } = await import("../../src/episodes.ts");
const { accessToken } = await import("../../src/youtube/oauth.ts");
const { replyProblems } = await import("../../src/commentreply.ts");

const cfg = loadConfig();
const db = await openDb("", cfg.dataDir);
await migrate(db);
await db.query("DELETE FROM leases");
const s = createServices(db, cfg);
// The sandbox's clock reads 15:00 today (local) when it starts and runs on from there, so the reply's 16:30 slot is
// ahead whatever time of day the proof is run.
const { dayKey, localTime } = await import("../../src/lanes.ts");
const offset = Date.now() - localTime(dayKey(new Date(), cfg.timezone), "15:00", cfg.timezone).getTime();
s.now = () => new Date(Date.now() - offset);
s.notify = async (m) => {
  console.log("DISCORD (stubbed):", (m.content ?? m.embeds?.[0]?.title ?? "").slice(0, 200));
  return true;
};

const [orig] = await db.query<{ id: string }>(`SELECT id FROM episodes WHERE youtube_video_id = $1 LIMIT 1`, [VIDEO]);
if (!orig) throw new Error(`no episode for ${VIDEO} in the sandbox`);
let [made] = await db.query<{ id: string }>(`SELECT id FROM episodes WHERE story_hash LIKE 'reply:%' ORDER BY created_at DESC LIMIT 1`);
if (!made) {
  // The comment as YouTube has it now: id, public handle and text (read only).
  const token = await accessToken(db, oauthConfig(cfg));
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=100&videoId=${VIDEO}&textFormat=plainText`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`commentThreads: HTTP ${res.status}`);
  const items = ((await res.json()) as any).items ?? [];
  const c = items.find((t: any) => String(t.snippet?.topLevelComment?.snippet?.textOriginal ?? "").startsWith(START));
  if (!c) throw new Error("comment not found on the video");
  const sn = c.snippet.topLevelComment.snippet;
  console.log("COMMENT", JSON.stringify({ id: c.id, author: sn.authorDisplayName, text: sn.textOriginal, likes: sn.likeCount }));
  await db.query(
    `INSERT INTO comment_replies (comment_id, episode_id, video_id, comment, decision, reason, author_channel, author_name, heart, pin_score, kind)
     VALUES ($1, $2, $3, $4, 'reply', 'question', $5, $6, true, 2, 'question') ON CONFLICT (comment_id) DO UPDATE SET kind = 'question', author_name = EXCLUDED.author_name, author_channel = EXCLUDED.author_channel, created_at = now()`,
    [c.id, orig.id, VIDEO, sn.textOriginal, sn.authorChannelId?.value ?? null, sn.authorDisplayName],
  );
  const id = await maybeSelectCommentReply(s);
  if (!id) throw new Error("the picker passed on the comment (see the log)");
  made = { id };
}
const t0 = Date.now();
const stop = new Set([UNTIL, "failed", "rejected", "awaiting_approval", "approved", "published"]);
for (let i = 0; i < 12; i++) {
  const ep = await getEpisode(db, made.id);
  if (!ep || stop.has(ep.status)) break;
  try {
    await advance(s, ep);
  } catch (e) {
    console.log("STEP ERROR", (e as Error).message.slice(0, 600));
    break;
  }
}
const ep = (await getEpisode(db, made.id))!;
const events = await db.query<{ kind: string; detail: unknown }>(
  `SELECT kind, detail FROM events WHERE episode_id = $1 ORDER BY id`,
  [made.id],
);
const out = path.join(SANDBOX, "reply-sample.json");
fs.writeFileSync(
  out,
  `${JSON.stringify(
    {
      episode: ep.id,
      status: ep.status,
      error: ep.last_error,
      story: ep.story_json.reply,
      headline: ep.story_json.headline,
      script: ep.script_json,
      reply_problems: ep.script_json && ep.story_json.reply ? replyProblems(ep.script_json, ep.story_json.reply) : null,
      factcheck: ep.factcheck_json,
      events: events.map((e) => ({ kind: e.kind, detail: e.detail })),
      video: fs.existsSync(path.join(SANDBOX, "episodes", ep.id, "short.mp4")) ? path.join(SANDBOX, "episodes", ep.id, "short.mp4") : null,
      minutes: +((Date.now() - t0) / 60000).toFixed(1),
    },
    null,
    1,
  )}\n`,
);
console.log("RESULT", ep.status, ep.last_error ?? "", out);
await db.close();
