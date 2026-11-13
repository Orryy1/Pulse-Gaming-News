// Video replies to comments (COMMENT_REPLY_SHORTS, off by default; owner, 12 Nov 2026). Once a day the best viewer
// question the community engine filed (src/youtube/viewers.ts, comment_replies kind "question") gets its own Short: the
// comment on screen as a styled card for the opening seconds with the commenter's public handle, the narration opening
// "You asked...", and the answer from the original video's confirmed facts, through the normal news pipeline (sources,
// fact check, friend pass, footage and game sound, graphics audit, picture check). Writer calls are the step
// "reply.write", so CODEX_CALLS can route them to Codex.
//
// What YouTube allows (researched 12 Nov 2026): a real "reply with a video" (the Short shown under the comment with a
// comment sticker, and the commenter notified) is made only in the YouTube app on Android, from the comment's Reply
// button or the Shorts camera's Comments sticker; YouTube's help describes recording in the app, and the Data API's
// videos.insert has no field that links an upload to a comment. YouTube's Data API also has no call for pinning (and a
// reply can never be pinned: only a top-level comment on one's own video). So a Short made outside the app cannot be
// linked by the factory. What the factory does instead: the comment card in the video, the handle and a link to the
// original video in the description, and a reply under the original comment (the comment scope on the stored login)
// pointing to the new Short once it is public, through the same API call the community engine replies with.

import type { Db } from "./db.ts";
import type { Script } from "./editorial/schema.ts";
import type { Episode } from "./episodes.ts";
import { advertiserProblems } from "./editorial/voice.ts";
import { screenComment } from "./youtube/viewers.ts";
import { QUOTA, quotaAdd } from "./lanes.ts";
import { errorMessage, log } from "./lib/util.ts";

export const REPLY_LIMITS = {
  /** Reply Shorts a day. */
  perDay: 1,
  /** Questions older than this are left alone. */
  windowDays: 7,
  /** A question needs this many words to be substantive. */
  minWords: 3,
  /** And this many of its content words (four-letter stems) in the original video's facts to be answerable (all of
   * them when it has fewer). */
  minOverlap: 2,
  /** The comment card shows at most this much of the comment. */
  cardChars: 150,
} as const;

/** What the reply Short carries on its story: the comment, who wrote it and where. */
export interface CommentReplyStory {
  commentId: string;
  videoId: string;
  /** The original video's episode, whose facts and sources the answer comes from. */
  episodeId: string;
  /** The commenter's public YouTube handle ("@name"), never a display name. */
  handle: string;
  /** The comment as written (trimmed), and the shorter form the card shows. */
  text: string;
  card: string;
  likes: number;
}

/** One filed viewer comment, as the picker reads it from comment_replies. */
export interface FiledComment {
  commentId: string;
  videoId: string;
  episodeId: string;
  text: string;
  author: string;
  /** The engine's kind ("question"), or the older passes' reason text. */
  kind: string;
  likes: number;
  createdAt: string;
}

const QUESTION_START =
  /^(why|how|what|when|where|which|who|will|would|is|are|was|does|do|did|can|could|should|has|have|any(one|body)? know|so (is|will|does|can))\b/i;

/** Whether a comment asks something (a question mark, or a question word up front). */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  return /\?/.test(t) || QUESTION_START.test(t);
}

/** About the channel, its voice or its people, not the story: never answered on screen. */
const ABOUT_US =
  /\b(you guys|your (channel|voice|narrator|videos?)|ai (voice|narrat\w*|slop)|are you (a )?(bot|ai|real)|who (is|are) (you|the narrator)|subscribe|sub to)\b/i;

/** A public handle: "@" and 3-30 letters, digits, dots, dashes or underscores. Display names never go on screen. */
export function publicHandle(
  author: string | null | undefined,
): string | undefined {
  const a = String(author ?? "").trim();
  return /^@[\p{L}\p{N}._-]{3,30}$/u.test(a) ? a : undefined;
}

const STOP = new Set(
  "about after again also been being could does doing from have just like more most much only really some such than that their them then there these they this those very want were what when where which while will with would your yours game games video love know think down even still".split(
    " ",
  ),
);

/** The question's content-word stems (first four letters of words of four or more). */
export function stems(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/['’]s\b/g, "")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && !STOP.has(w))
        .map((w) => w.slice(0, 4)),
    ),
  ];
}

/** How much of the question the original video's facts speak to (pure): the shared stems. */
export function answerability(question: string, facts: string): string[] {
  const f = new Set(stems(facts));
  return stems(question).filter((s) => f.has(s));
}

/** The original video's confirmed facts as one text: its script, claims and sources' titles. */
export function factsText(
  ep: Pick<Episode, "script_json" | "story_json">,
): string {
  const s = ep.script_json as Script | null;
  return [
    s?.headline,
    s?.hook,
    ...(s?.beats ?? []).map((b) => b.narration),
    s?.pulse_take?.narration,
    ...(s?.claims ?? []).map((c) => c.claim),
    ...(ep.story_json?.items ?? []).map((i) => `${i.title} ${i.summary ?? ""}`),
  ]
    .filter(Boolean)
    .join(" ");
}

/** The rules' verdict on one filed comment (pure): ok, or why not. */
export function screenQuestion(
  c: FiledComment,
  facts: string,
): { ok: boolean; why: string; overlap: string[] } {
  const no = (why: string) => ({ ok: false, why, overlap: [] as string[] });
  const text = c.text.trim();
  if (screenComment(text).screen !== "ok")
    return no(screenComment(text).reason);
  if (!/question/i.test(c.kind))
    return no(`filed as ${c.kind || "unjudged"}, not a question`);
  if (/hostile|criticism|spam|promo|off.topic|political|profan/i.test(c.kind))
    return no("hostile or off topic");
  if (!isQuestion(text)) return no("not phrased as a question");
  if (text.split(/\s+/).filter(Boolean).length < REPLY_LIMITS.minWords)
    return no("too short to be substantive");
  if (ABOUT_US.test(text)) return no("about the channel, not the story");
  if (!publicHandle(c.author)) return no("no public handle to show");
  if (advertiserProblems(text).length)
    return no("not advertiser-safe on screen");
  const overlap = answerability(text, facts);
  // A short question ("why shut down?") needs all of its few content words in the facts; a longer one, two of them.
  const need = Math.max(1, Math.min(REPLY_LIMITS.minOverlap, stems(text).length));
  if (overlap.length < need) return no("the video's facts do not answer it");
  return { ok: true, why: "", overlap };
}

/** The day's question (pure): the screened ones, most answerable and most liked first, then the newest. */
export function pickQuestion(
  comments: FiledComment[],
  factsOf: (episodeId: string) => string | undefined,
  used: Set<string>,
): (FiledComment & { overlap: string[] }) | undefined {
  const ok = comments
    .filter((c) => !used.has(c.commentId))
    .map((c) => {
      const facts = factsOf(c.episodeId);
      const v = facts
        ? screenQuestion(c, facts)
        : { ok: false, why: "no facts", overlap: [] };
      return { ...c, overlap: v.overlap, ok: v.ok };
    })
    .filter((c) => c.ok);
  ok.sort(
    (a, b) =>
      b.overlap.length * 2 + b.likes - (a.overlap.length * 2 + a.likes) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const best = ok[0];
  if (!best) return undefined;
  const { ok: _ok, ...rest } = best;
  return rest;
}

/** The comment as the card shows it: one line of text, cut at a word near REPLY_LIMITS.cardChars. */
export function cardText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= REPLY_LIMITS.cardChars) return t;
  const cut = t.slice(0, REPLY_LIMITS.cardChars);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 80)).replace(/[,;:.\s]+$/, "")}...`;
}

/** The reply Short's story (pure): the original video's sources and game, the question as its headline. */
export function replyCluster(
  original: Pick<Episode, "story_json" | "script_json">,
  c: FiledComment,
): import("./discovery/cluster.ts").StoryCluster {
  const handle = publicHandle(c.author)!;
  const s = original.script_json as Script | null;
  return {
    ...original.story_json,
    hash: `reply:${c.commentId}`,
    headline: `You asked: ${cardText(c.text)}`,
    newestAt: new Date().toISOString(),
    gameHint: original.story_json.gameHint ?? s?.game_title,
    reply: {
      commentId: c.commentId,
      videoId: c.videoId,
      episodeId: c.episodeId,
      handle,
      text: c.text.trim().slice(0, 1000),
      card: cardText(c.text),
      likes: c.likes,
    },
    // A reply never takes a news slot's place, a series' number or a launch run's plan.
    why: undefined,
    run: undefined,
    premade: undefined,
    spare: undefined,
    series: undefined,
    gtaFile: undefined,
    // Nor a search Short's query: the reply answers the viewer, under its own slot (search Shorts keep theirs).
    search: undefined,
    bigStory: undefined,
    cutdown: undefined,
  };
}

/** The writer's brief for a reply Short (read with the sources and the house rules). */
export function replyBrief(
  r: CommentReplyStory,
  originalTitle?: string,
): string {
  return [
    `This Short answers a viewer's question from the comments${originalTitle ? ` under our Short "${originalTitle}"` : ""}. The comment is shown on screen as a card for the first seconds, with the viewer's handle: ${r.handle} asked "${r.card}".`,
    `- The hook begins with the words "You asked" and puts their question in plain words, under 14 words in all (for example "You asked why it is shutting down. Here's the real reason."). Never read the handle aloud and never describe the viewer: the card shows who asked.`,
    "- Answer exactly what they asked, straight away, from the sources' confirmed facts only. Where the sources do not answer part of it, say plainly that nobody has confirmed that yet. Never guess dates, prices or reasons.",
    "- Talk to them like a friend who knows the story: warm, quick, an owned take in the take line. Never thank them for watching, never ask for likes or subscriptions.",
    "- The last line can invite more questions in the comments in a few words, once.",
  ].join("\n");
}

/** The house rules' check on a reply Short's draft (pure). */
export function replyProblems(
  script: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
  r: CommentReplyStory,
): string[] {
  const problems: string[] = [];
  if (!/^\s*you asked\b/i.test(script.hook))
    problems.push(
      'The hook must begin with "You asked" (this Short answers a viewer\'s question).',
    );
  const spoken = [
    script.hook,
    ...script.beats.map((b) => b.narration),
    script.pulse_take.narration,
    script.loop_line,
  ].join(" ");
  const bare = r.handle.replace(/^@/, "").toLowerCase();
  if (bare.length >= 3 && spoken.toLowerCase().includes(bare))
    problems.push("Never say the viewer's handle aloud: the card shows it.");
  if (script.hook.split(/\s+/).filter(Boolean).length > 16)
    problems.push("The hook is too long: under 14 words.");
  return problems;
}

/** The description's line for a reply Short: who asked and where. */
export function replyDescriptionLine(r: CommentReplyStory): string {
  return `Answering ${r.handle}'s question from the comments under https://youtu.be/${r.videoId}. Ask us anything in the comments.`;
}

/** The reply under the original comment, pointing to the Short that answers it. */
export function pointerText(r: CommentReplyStory, shortId: string): string {
  return `Great question, so I made a whole Short answering it: https://youtube.com/shorts/${shortId}`;
}

/** The commenter's handle never repeats in the hook-repetition check: "You asked" opens every reply Short. */
export function hookForRepetition(hook: string): string {
  return hook.replace(/^\s*you asked\b[^.?!]*[.?!]?\s*/i, "");
}

// ---------------------------------------------------------------- the database side

/** The filed questions of the last REPLY_LIMITS.windowDays on the factory's own published Shorts. */
export async function filedQuestions(
  db: Db,
  now: Date,
): Promise<FiledComment[]> {
  const rows = await db.query<{
    comment_id: string;
    video_id: string;
    episode_id: string;
    comment: string;
    author_name: string | null;
    kind: string | null;
    reason: string | null;
    created_at: string | Date;
  }>(
    `SELECT c.comment_id, c.video_id, c.episode_id, c.comment, c.author_name, c.kind, c.reason, c.created_at
       FROM comment_replies c JOIN episodes e ON e.id = c.episode_id
      WHERE c.created_at > $1::timestamptz - make_interval(days => $2)
        AND (c.kind = 'question' OR (c.kind IS NULL AND c.reason ILIKE '%question%'))
        AND c.video_id !~ '^(ig|fb):' AND e.status = 'published' AND e.lane <> 'twin'
      ORDER BY c.created_at DESC LIMIT 200`,
    [now, REPLY_LIMITS.windowDays],
  );
  return rows.map((r) => ({
    commentId: r.comment_id,
    videoId: r.video_id,
    episodeId: r.episode_id,
    text: r.comment,
    author: r.author_name ?? "",
    kind: r.kind ?? r.reason ?? "",
    likes: 0,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** Comments already answered with a Short (any time). */
export async function usedComments(db: Db): Promise<Set<string>> {
  const rows = await db.query<{ hash: string }>(
    `SELECT story_hash AS hash FROM episodes WHERE story_hash LIKE 'reply:%'`,
  );
  return new Set(rows.map((r) => r.hash.slice("reply:".length)));
}

/** Reply Shorts made since local midnight (the cap). */
export async function repliesToday(db: Db, timeZone: string): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE story_hash LIKE 'reply:%' AND created_at >= date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1`,
    [timeZone],
  );
  return Number(row?.n ?? 0);
}

/**
 * After a reply Short goes public: one reply under the original comment pointing to it (QUOTA.comment units, on the
 * stored login like the community engine's replies). Once per Short, recorded as a "reply_pointer" event; a failure
 * is recorded too and never retried, so a held comment never gets two replies.
 */
export async function replyPointers(d: {
  db: Db;
  reply: (commentId: string, text: string) => Promise<string>;
  headroom: () => Promise<number>;
  now: Date;
}): Promise<number> {
  const eps = await d.db.query<{
    id: string;
    youtube_video_id: string;
    story_json: any;
  }>(
    `SELECT e.id, e.youtube_video_id, e.story_json FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.story_hash LIKE 'reply:%'
        AND EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'public_confirmed')
        AND NOT EXISTS (SELECT 1 FROM events v WHERE v.episode_id = e.id AND v.kind = 'reply_pointer')
      LIMIT 3`,
  );
  let sent = 0;
  for (const e of eps) {
    const story = (
      typeof e.story_json === "string" ? JSON.parse(e.story_json) : e.story_json
    ) as { reply?: CommentReplyStory };
    const r = story.reply;
    if (!r) continue;
    if ((await d.headroom()) < QUOTA.comment) break;
    const text = pointerText(r, e.youtube_video_id);
    try {
      const id = await d.reply(r.commentId, text);
      await quotaAdd(d.db, d.now, QUOTA.comment);
      await d.db.query(
        `INSERT INTO events (episode_id, kind, detail) VALUES ($1, 'reply_pointer', $2)`,
        [e.id, JSON.stringify({ comment: r.commentId, reply: id, text })],
      );
      sent++;
    } catch (err) {
      log("warn", "reply Short pointer failed", {
        id: e.id,
        error: errorMessage(err).slice(0, 200),
      });
      await d.db.query(
        `INSERT INTO events (episode_id, kind, detail) VALUES ($1, 'reply_pointer', $2)`,
        [
          e.id,
          JSON.stringify({
            comment: r.commentId,
            failed: errorMessage(err).slice(0, 200),
          }),
        ],
      );
    }
  }
  return sent;
}
