// Comments on our Instagram and Facebook reels (META_COMMENT_REPLIES). Nothing read or answered them: 14 comments in the
// 14 days to 4 Nov 2026, 0 answers. They go through the same judgement as YouTube's, so the same rules apply: reply only
// when the reply adds something, as the channel, never as a person; everything else is skipped. Capped lower than YouTube.
// A model call happens only when a new comment exists.

import type { Db } from "../db.ts";
import type { Episode } from "../episodes.ts";
import type { Llm } from "../editorial/llm.ts";
import { publishHeld } from "../lanes.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  askBackAllowed,
  judgeComments,
  polishReply,
  recentOpenings,
  REPLY_STYLE_RULES,
} from "../youtube/replies.ts";

export const META_LIMITS = {
  windowHours: 72,
  pollMinutes: 30,
  perPost: 4,
  perDay: 10,
} as const;

export type MetaPlatform = "instagram" | "facebook";

export interface MetaComment {
  id: string;
  text: string;
  own: boolean;
}

export interface MetaDeps {
  db: Db;
  llm: Llm;
  now: () => Date;
  list: (p: MetaPlatform, postId: string) => Promise<MetaComment[]>;
  reply: (p: MetaPlatform, commentId: string, text: string) => Promise<string>;
}

const prefix = { instagram: "ig", facebook: "fb" } as const;
const lastPoll = new Map<string, number>();

/** Clears what the pass remembers (tests). */
export function resetMetaMemory(): void {
  lastPoll.clear();
}

/** One pass over the reels posted in the last three days. Returns how many replies went. */
export async function metaRepliesTick(d: MetaDeps): Promise<number> {
  if (await publishHeld(d.db)) return 0; // the owner's publishing hold
  const now = d.now();
  const posts = await d.db.query<
    Episode & { platform: MetaPlatform; post_id: string }
  >(
    `SELECT e.*, x.detail->>'platform' AS platform, x.detail->>'id' AS post_id
       FROM events x JOIN episodes e ON e.id = x.episode_id
      WHERE x.kind = 'crosspost' AND x.detail->>'platform' IN ('instagram', 'facebook')
        AND x.created_at > $1::timestamptz - make_interval(hours => $2)
        AND e.script_json IS NOT NULL
      ORDER BY x.id DESC`,
    [now, META_LIMITS.windowHours],
  );
  let sent = 0;
  for (const post of posts) {
    const tag = `${prefix[post.platform]}:${post.post_id}`;
    if (
      now.getTime() - (lastPoll.get(tag) ?? 0) <
      META_LIMITS.pollMinutes * 60_000
    )
      continue;
    lastPoll.set(tag, now.getTime());
    try {
      sent += await repliesOnPost(d, post, tag);
    } catch (err) {
      log("warn", "meta comment replies failed", {
        platform: post.platform,
        post: post.post_id,
        error: errorMessage(err),
      });
    }
  }
  return sent;
}

async function repliesOnPost(
  d: MetaDeps,
  post: Episode & { platform: MetaPlatform; post_id: string },
  tag: string,
): Promise<number> {
  const comments = await d.list(post.platform, post.post_id);
  const key = (id: string) => `${prefix[post.platform]}:${id}`;
  const seen = new Set(
    (
      await d.db.query<{ comment_id: string }>(
        `SELECT comment_id FROM comment_replies WHERE video_id = $1`,
        [tag],
      )
    ).map((r) => r.comment_id),
  );
  const fresh = comments
    .filter((c) => !c.own && c.text.trim() && !seen.has(key(c.id)))
    .slice(0, 20);
  if (!fresh.length) return 0;
  const [{ n: onPost } = { n: 0 }] = await d.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comment_replies WHERE video_id = $1 AND decision = 'reply'`,
    [tag],
  );
  const [{ n: today } = { n: 0 }] = await d.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM comment_replies WHERE decision = 'reply' AND video_id ~ '^(ig|fb):' AND created_at > $1::timestamptz - interval '24 hours'`,
    [d.now()],
  );
  let room = Math.min(META_LIMITS.perPost - onPost, META_LIMITS.perDay - today);
  if (room <= 0) return 0;
  const recent = (
    await d.db.query<{ reply_text: string }>(
      `SELECT reply_text FROM comment_replies WHERE decision = 'reply' AND reply_text <> '' ORDER BY created_at DESC LIMIT 12`,
    )
  ).map((r) => r.reply_text);
  const out = await judgeComments(
    d.llm,
    post.script_json!,
    fresh,
    recentOpenings(recent),
    `${REPLY_STYLE_RULES}\nThese comments are on our ${post.platform === "instagram" ? "Instagram" : "Facebook"} reel of the video.`,
  );
  const byId = new Map(out.decisions.map((x) => [x.id, x]));
  let askBack = askBackAllowed(recent);
  let sent = 0;
  for (const c of fresh) {
    const dec = byId.get(c.id);
    let decision: "reply" | "skip" =
      dec?.action === "reply" && dec.reply.trim() ? "reply" : "skip";
    let reason = dec?.reason ?? "not judged";
    const text = polishReply(dec?.reply ?? "", { askBack });
    if (decision === "reply" && /https?:\/\/|www\./i.test(text))
      [decision, reason] = ["skip", "reply had a link"];
    if (decision === "reply" && (room <= 0 || !text)) continue; // judged again on a later pass
    let replyId: string | null = null;
    if (decision === "reply") {
      try {
        replyId = await d.reply(post.platform, c.id, text);
        room--;
        sent++;
        if (/\?\s*$/.test(text)) askBack = false;
      } catch (err) {
        log("warn", "meta comment reply refused", {
          platform: post.platform,
          error: errorMessage(err).slice(0, 200),
        });
        continue;
      }
    }
    await d.db.query(
      `INSERT INTO comment_replies (comment_id, episode_id, video_id, comment, decision, reason, reply_text, reply_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (comment_id) DO NOTHING`,
      [
        key(c.id),
        post.id,
        tag,
        c.text.slice(0, 2000),
        decision,
        reason,
        decision === "reply" ? text : null,
        replyId,
      ],
    );
  }
  log("info", "meta comments judged", {
    platform: post.platform,
    judged: fresh.length,
    replied: sent,
  });
  return sent;
}
