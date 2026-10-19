// First-hours comment replies: while a video is new, the channel reads its fresh comments and
// answers the ones it can answer well (a question the script's facts settle, a sharp opinion
// worth a specific nod). Everything else is skipped, every comment is judged once, and replies
// are capped per video and per day. YouTube has no API for pinning or hearting, so it doesn't.
import { z } from "zod";
import type { Db } from "../db.ts";
import type { Episode } from "../episodes.ts";
import type { Llm } from "../editorial/llm.ts";
import {
  QUOTA,
  quotaAdd,
} from "../lanes.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { YouTubeClient } from "./upload.ts";

export const REPLY_LIMITS = {
  shortWindowMinutes: 90, // a Short's first ninety minutes
  longWindowMinutes: 24 * 60, // a long video's first day
  perVideo: 6,
  perDay: 24,
  pollMinutes: 10,
} as const;

const DecisionSchema = z.object({
  decisions: z.array(
    z.object({
      id: z.string(),
      action: z.enum(["reply", "skip"]),
      reason: z.string().describe("A few words: why reply, or why skip"),
      reply: z
        .string()
        .describe("The reply text, or empty string when skipping"),
    }),
  ),
});

const SYSTEM = `You answer YouTube comments for Pulse Gaming News, a credible, friendly channel about video games.

You see a video's script facts and its newest comments. Decide, for each comment, whether the channel replies.

Reply only when the reply adds something: a question the script's facts answer, a strong opinion worth a specific, good-natured nod (name the detail they mentioned), or a correction you can settle from the facts given. Skip everything else: spam, links, self-promotion, insults, hostility, baiting, politics, anything sexual, personal questions about whoever runs the channel, piracy, comments not in English, one-word or emoji-only comments, "first", and anything you would have to guess about.

Rules for a reply:
- One or two sentences, under 220 characters, American English, warm and plain.
- Only facts that are in the script facts. Never invent release dates, prices or features. If the story is a rumor, say it is reported or unconfirmed, never confirmed.
- Never ask for likes, subscriptions or shares; never "thanks for watching"; no hashtags; no links; at most one emoji; no em dashes.
- Speak as "we" for the channel. Never argue; disagreement gets a friendly "fair point" and a reason.
- Answer the comment you were given, nothing else.`;

/** The script facts a reply may draw on. */
function factsOf(s: NonNullable<Episode["script_json"]>): string {
  return JSON.stringify({
    title: s.youtube?.title,
    game: s.game_title,
    rumor: s.is_rumour,
    hook: s.hook,
    beats: s.beats?.map((b) => b.narration),
    take: s.pulse_take?.narration,
    description: s.youtube?.description,
    criterion: s.criterion,
    ranking: s.entries?.map((e) => `#${e.rank} ${e.game_title} (${e.year})`),
    claims: s.claims?.map((c) => c.claim),
  });
}

/** The model's call on each comment: reply (with the text) or skip (with why). */
export async function judgeComments(
  llm: Llm,
  script: NonNullable<Episode["script_json"]>,
  comments: Array<{ id: string; text: string }>,
): Promise<z.infer<typeof DecisionSchema>> {
  return llm.structured({
    system: SYSTEM,
    content: `Script facts:\n${factsOf(script)}\n\nNewest comments (id: text):\n${comments.map((c) => `${c.id}: ${c.text.slice(0, 500).replace(/\s+/g, " ")}`).join("\n")}`,
    schema: DecisionSchema,
    tier: "mid",
    effort: "low",
    maxTokens: 2000,
  });
}

const lastPoll = new Map<string, number>();
let ownChannel: string | undefined;

export interface ReplyDeps {
  db: Db;
  youtube: () => YouTubeClient;
  llm: Llm;
  /** Units free once every upload still due today is covered. */
  headroom: () => Promise<number>;
  now: () => Date;
}

/** One pass over every video still inside its reply window. Returns how many replies went. */
export async function replyToComments(d: ReplyDeps): Promise<number> {
  const now = d.now();
  const eps = await d.db.query<Episode & { live_at: string }>(
    `SELECT *, coalesce(publish_at, updated_at) AS live_at FROM episodes
      WHERE status = 'published' AND youtube_video_id IS NOT NULL
        AND coalesce(publish_at, updated_at) <= $1
        AND coalesce(publish_at, updated_at) > $1::timestamptz - make_interval(mins => $2)
      ORDER BY coalesce(publish_at, updated_at) DESC`,
    [now, REPLY_LIMITS.longWindowMinutes],
  );
  let sent = 0;
  for (const ep of eps) {
    const long = ep.script_json?.runtime === "long" || ep.lane === "longform";
    const window = long
      ? REPLY_LIMITS.longWindowMinutes
      : REPLY_LIMITS.shortWindowMinutes;
    if (now.getTime() - new Date(ep.live_at).getTime() > window * 60_000)
      continue;
    if (
      now.getTime() - (lastPoll.get(ep.id) ?? 0) <
      REPLY_LIMITS.pollMinutes * 60_000
    )
      continue;
    lastPoll.set(ep.id, now.getTime());
    try {
      sent += await replyOnVideo(d, ep);
    } catch (err) {
      // Comments switched off on a video: stop asking about it for the rest of its window.
      if (/commentsDisabled/.test(errorMessage(err))) {
        lastPoll.set(ep.id, Number.MAX_SAFE_INTEGER / 2);
        continue;
      }
      log("warn", "comment replies failed", {
        episode: ep.id,
        error: errorMessage(err),
      });
    }
  }
  return sent;
}

async function replyOnVideo(d: ReplyDeps, ep: Episode): Promise<number> {
  const yt = d.youtube();
  ownChannel ??= await yt.myChannelId();
  const comments = await yt.listComments(ep.youtube_video_id!);
  await quotaAdd(d.db, d.now(), QUOTA.poll);
  const seen = new Set(
    (
      await d.db.query<{ comment_id: string }>(
        `SELECT comment_id FROM comment_replies WHERE video_id = $1`,
        [ep.youtube_video_id],
      )
    ).map((r) => r.comment_id),
  );
  const fresh = comments
    .filter(
      (c) =>
        !seen.has(c.id) && c.authorChannelId !== ownChannel && c.text.trim(),
    )
    .slice(0, 20);
  if (!fresh.length) return 0;
  const [{ n: videoCount } = { n: 0 }] = await d.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comment_replies WHERE episode_id = $1 AND decision = 'reply'`,
    [ep.id],
  );
  const [{ n: dayCount } = { n: 0 }] = await d.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comment_replies WHERE decision = 'reply' AND created_at > $1::timestamptz - interval '24 hours'`,
    [d.now()],
  );
  let room = Math.min(
    REPLY_LIMITS.perVideo - videoCount,
    REPLY_LIMITS.perDay - dayCount,
  );
  const out = await judgeComments(d.llm, ep.script_json!, fresh);
  const byId = new Map(out.decisions.map((x) => [x.id, x]));
  let sent = 0;
  // The most-liked comments get the first replies when the caps bite.
  for (const c of [...fresh].sort((a, b) => b.likes - a.likes)) {
    const dec = byId.get(c.id);
    let decision: "reply" | "skip" =
      dec?.action === "reply" && dec.reply.trim() ? "reply" : "skip";
    let reason = dec?.reason ?? "not judged";
    const text = (dec?.reply ?? "").trim().replace(/—/g, ", ").slice(0, 300);
    if (decision === "reply" && /https?:\/\/|www\./i.test(text))
      [decision, reason] = ["skip", "reply had a link"];
    if (decision === "reply" && room <= 0)
      [decision, reason] = ["skip", "reply cap reached"];
    if (decision === "reply" && (await d.headroom()) < QUOTA.comment)
      [decision, reason] = ["skip", "quota kept for today's uploads"];
    let replyId: string | null = null;
    if (decision === "reply") {
      try {
        replyId = await yt.replyToComment(c.id, text);
        await quotaAdd(d.db, d.now(), QUOTA.comment);
        room--;
        sent++;
      } catch (err) {
        [decision, reason] = [
          "skip",
          `reply failed: ${errorMessage(err).slice(0, 120)}`,
        ];
      }
    }
    await d.db.query(
      `INSERT INTO comment_replies (comment_id, episode_id, video_id, comment, decision, reason, reply_text, reply_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (comment_id) DO NOTHING`,
      [
        c.id,
        ep.id,
        ep.youtube_video_id,
        c.text.slice(0, 2000),
        decision,
        reason,
        decision === "reply" ? text : null,
        replyId,
      ],
    );
  }
  if (sent)
    log("info", "comment replies sent", { episode: ep.id, replies: sent });
  return sent;
}
