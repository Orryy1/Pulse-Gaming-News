// The community engine's dry run (src/youtube/viewers.ts): reads the live channel's recent viewer comments through the
// factory's stored login and prints, as Markdown, which comments would be hearted, the reply drafted for each and the
// pin chosen per video. Read only: it never replies, hearts, pins or changes anything, and it spends about four quota
// units (channels, comment threads, held-for-review, video titles). The model call goes to Codex when its helper is on
// this machine (no paid API), else to Claude's small tier.
// Also reports what YouTube holds for review and whether a signed-out visitor sees the channel's own comments.
// Usage: node --import tsx src/tools/community-dryrun.ts [out.md]   (DRYRUN_DB_DIR=<embedded db folder> to read a copy)
process.loadEnvFile(".env");
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { openDb, type Db } from "../db.ts";
import type { Episode } from "../episodes.ts";
import { createClaude, type Llm } from "../editorial/llm.ts";
import { codexRunnerPresent, createCodexLlm } from "../editorial/codex.ts";
import { oauthConfig } from "../services.ts";
import { readPublicComments } from "../social/commentcheck.ts";
import { accessToken } from "../youtube/oauth.ts";
import { YouTubeClient } from "../youtube/upload.ts";
import {
  VIEWER_LIMITS,
  decide,
  heartKey,
  judgeViewerComments,
  pinChoices,
  videoFacts,
  type CommentPlan,
  type History,
  type ViewerComment,
} from "../youtube/viewers.ts";

const cfg = loadConfig();
const outFile = process.argv[2];
const dbDir = process.env.DRYRUN_DB_DIR;
const db: Db = dbDir
  ? await openDb("", path.dirname(path.resolve(dbDir)))
  : await openDb(cfg.databaseUrl, cfg.dataDir);
const yt = new YouTubeClient(() => accessToken(db, oauthConfig(cfg)));

const noPaid: Llm = {
  structured: async () => {
    throw new Error("the dry run never falls back to the paid API");
  },
};
const llm: Llm = codexRunnerPresent(cfg.codexRunnerDir)
  ? createCodexLlm(noPaid, {
      enabled: true,
      sites: ["*"],
      python: cfg.codexPython,
      runnerDir: cfg.codexRunnerDir,
      timeoutMs: 15 * 60_000,
    })
  : createClaude({ low: cfg.claudeModelLow, top: cfg.anthropicModel });

const now = new Date();
const own = await yt.myChannelId();
const threads = await yt.listChannelComments(own, VIEWER_LIMITS.pages);
const held = await yt.heldForReview(own).catch((err) => {
  console.error(`held-for-review read failed: ${(err as Error).message}`);
  return undefined;
});
const since = now.getTime() - VIEWER_LIMITS.windowDays * 86_400_000;
const viewer: ViewerComment[] = threads.filter(
  (c) =>
    c.videoId &&
    c.authorChannelId !== own &&
    c.text.trim() &&
    Date.parse(c.publishedAt) >= since,
);

// Facts: the factory's script where this database has the episode, else the video's title and description.
const videos = [...new Set(viewer.map((c) => c.videoId))];
const eps = new Map<string, Episode>();
for (const v of videos) {
  const [ep] = await db
    .query<Episode>(
      `SELECT * FROM episodes WHERE youtube_video_id = $1 AND script_json IS NOT NULL LIMIT 1`,
      [v],
    )
    .catch(() => []);
  if (ep) eps.set(v, ep);
}
const ownVideos = [
  ...new Set(
    threads.filter((c) => c.authorChannelId === own).map((c) => c.videoId),
  ),
].slice(0, 8);
const snippets = await yt.videoSnippets([
  ...new Set([...videos, ...ownVideos]),
]);
const facts = new Map(
  videos.map((v) => [v, videoFacts(eps.get(v), snippets.get(v))]),
);

// What the older reply passes already did (records this database holds), and who was answered.
const judged = new Map<string, { decision: string; reply: string | null }>();
for (const r of await db
  .query<{
    comment_id: string;
    decision: string;
    reply_text: string | null;
  }>(
    `SELECT comment_id, decision, reply_text FROM comment_replies WHERE comment_id = ANY($1)`,
    [viewer.map((c) => c.id)],
  )
  .catch(() => []))
  judged.set(r.comment_id, { decision: r.decision, reply: r.reply_text });
const recent = (
  await db
    .query<{
      reply_text: string;
    }>(
      `SELECT reply_text FROM comment_replies WHERE decision = 'reply' AND reply_text <> '' ORDER BY created_at DESC LIMIT 12`,
    )
    .catch(() => [])
).map((r) => r.reply_text);
const history: History = { answered: new Set(), recent };

const plans: CommentPlan[] = [];
for (let i = 0; i < viewer.length; i += VIEWER_LIMITS.perBatch) {
  const batch = viewer.slice(i, i + VIEWER_LIMITS.perBatch);
  const verdicts = await judgeViewerComments(llm, facts, batch, []);
  plans.push(
    ...decide(batch, verdicts, own, {
      ...history,
      answered: new Set([
        ...history.answered,
        ...plans
          .filter((p) => p.reply)
          .map((p) => `${p.comment.videoId}|${p.comment.authorChannelId}`),
      ]),
    }),
  );
}
const pins = pinChoices(plans);

// Our own top-level comments, as a signed-out visitor sees them (no login, no quota).
const ownTop = ownVideos.map((v) => ({ videoId: v }));
const visibility: Array<{
  video: string;
  shown: boolean | undefined;
  others: number | undefined;
}> = [];
for (const c of ownTop) {
  const list = await readPublicComments(c.videoId).catch(() => undefined);
  visibility.push({
    video: c.videoId,
    shown: list?.some((x) => x.byChannel),
    others: list?.length,
  });
}

const one = (t: string, n = 160) => t.replace(/\s+/g, " ").trim().slice(0, n);
const title = (v: string) => one(snippets.get(v)?.title ?? v, 70);
const lines: string[] = [];
lines.push(
  `# Community engine dry run, ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
  "",
);
lines.push(
  `Read only: nothing was replied to, hearted or pinned. Source: the live channel's newest ${threads.length} comment threads through the factory's stored login; ${viewer.length} viewer comments from the last ${VIEWER_LIMITS.windowDays} days on ${videos.length} videos. Facts: the factory's script for ${eps.size} of them, the video's title and description for the rest. Writer: ${codexRunnerPresent(cfg.codexRunnerDir) ? "Codex (quick model, no API cost)" : "Claude small tier"}.`,
  "",
);
const hearts = plans.filter((p) => p.heart);
const replies = plans.filter((p) => p.reply);
lines.push(
  `**Totals:** ${hearts.length} hearts, ${replies.length} replies, ${pins.size} pins, ${plans.length - hearts.length} left alone. Live caps would send at most ${VIEWER_LIMITS.perPass} replies a pass and ${cfg.communityRepliesPerDay} a day, ${VIEWER_LIMITS.perVideo} a video, one per person per video.`,
  "",
);
lines.push("## Per comment", "");
for (const v of videos) {
  lines.push(`### ${title(v)} (${v})`, "");
  for (const p of plans.filter((x) => x.comment.videoId === v)) {
    const c = p.comment;
    const before = judged.get(c.id);
    lines.push(
      `- **${c.authorName || "viewer"}** (${c.publishedAt.slice(0, 10)}, ${c.likes} likes): "${one(c.text)}"`,
      `  - kind: ${p.kind}; heart: ${p.heart ? "yes" : "no"}; pin score: ${p.pinScore}${pins.get(v)?.comment.id === c.id ? " **(pin)**" : ""}`,
      p.reply
        ? `  - reply: "${p.reply}"`
        : `  - no reply: ${p.skip}${p.draft ? `; the draft would have been: "${p.draft}"` : ""}`,
      ...(before
        ? [
            before.decision === "reply"
              ? `  - answered already by the older reply pass: "${one(before.reply ?? "", 120)}"`
              : "  - the older reply pass skipped it; the engine gives it one judgement of its own",
          ]
        : []),
    );
  }
  lines.push("");
}
lines.push("## Pins", "");
if (!pins.size) lines.push("No video has a viewer comment good enough to pin.");
for (const [v, p] of pins)
  lines.push(
    `- ${title(v)}: **${p.comment.authorName}**, "${one(p.comment.text, 120)}" (key ${heartKey(p.comment)})`,
  );
lines.push("", "## Held for review and the channel's own comments", "");
lines.push(
  held
    ? `YouTube is holding ${held.length} viewer comments for review on the channel (readable with the stored login's comment scope; the factory never approves or rejects them):`
    : "The held-for-review list could not be read.",
);
for (const h of held ?? [])
  lines.push(
    `- ${h.publishedAt.slice(0, 10)} on ${h.videoId}: "${one(h.text, 100)}"`,
  );
lines.push(
  "",
  `The channel's own top-level comments: the API lists them as published with no moderation status, so a hidden one cannot be told from the API. A signed-out read of the public comment list showed the channel's own comment on ${visibility.filter((x) => x.shown).length} of ${visibility.filter((x) => x.shown !== undefined).length} recent videos checked:`,
);
for (const x of visibility)
  lines.push(
    `- ${title(x.video)} (${x.video}): ${x.shown === undefined ? "page not readable" : x.shown ? "shown" : `not shown (${x.others} other comments visible)`}`,
  );
lines.push("");
const md = lines.join("\n");
if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, md, "utf8");
  console.log(`written ${outFile}`);
} else console.log(md);
await db.close();
