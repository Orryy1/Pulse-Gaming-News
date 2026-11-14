// "You asked, I tested" (PULSE_LAB_ASKED; research 14 Nov section D: a vote or a question in public, the result fast
// and named back to the people who asked). Viewers' comment asks and the Lab poll feed tonight's stream test list (the
// stream-asks daily message, src/streamasks/page.ts), and when the owner's stream answers one, the Short credits the
// viewer's handle on screen and in the pinned comment.
//
// Privacy, every time:
//   - only a public YouTube handle ("@name", src/commentreply.ts publicHandle) is ever shown; a display name never is,
//     and nothing else about the viewer (no picture, no channel link, no location);
//   - a handle that is not advertiser-safe or reads as abuse is never shown: the credit says "a viewer" instead;
//   - a poll's winner is credited to "you" (the voters), never to anyone by name.
// The narrator never reads the handle aloud (the commentreply rule): the card shows who asked.

import type { Db } from "../db.ts";
import type { Mention, StreamAsk } from "../streamasks/asks.ts";
import {
  extractAsks,
  foldSightings,
  openAsks,
  type Sighting,
} from "../streamasks/asks.ts";
import { publicHandle } from "../commentreply.ts";
import { advertiserProblems } from "../editorial/voice.ts";
import { screenComment } from "../youtube/viewers.ts";

/** The public handle to credit for an ask (pure): the earliest viewer who asked with a safe public handle. */
export function creditFor(
  ask: Pick<StreamAsk, "mentions">,
): { handle?: string; poll?: boolean } | undefined {
  const viewers = ask.mentions
    .filter((m) => m.source === "viewers" || m.source === "comments")
    .sort((a, b) => a.at.localeCompare(b.at));
  for (const m of viewers) {
    const h = safeHandle(m.handle);
    if (h) return { handle: h };
  }
  if (viewers.some((m) => /poll/i.test(m.name))) return { poll: true };
  return viewers.length ? {} : undefined;
}

/** A handle that may go on screen (pure), or undefined. */
export function safeHandle(raw: string | undefined): string | undefined {
  const h = publicHandle(raw);
  if (!h) return undefined;
  const words = h.replace(/^@/, "").replace(/[._-]+/g, " ");
  if (advertiserProblems(words).length) return undefined;
  if (screenComment(words).screen !== "ok") return undefined;
  return h;
}

/** The credit as the card and the pinned comment say it (pure). */
export function creditLines(credit: { handle?: string; poll?: boolean }): {
  card: string;
  comment: string;
} {
  if (credit.handle)
    return {
      card: `ASKED BY ${credit.handle}`,
      comment: `This test was asked by ${credit.handle} in our comments. Ask yours and I might test it on tonight's stream.`,
    };
  if (credit.poll)
    return {
      card: "YOU VOTED FOR THIS TEST",
      comment:
        "You picked this test in our poll, so I ran it on stream. The next poll is up soon.",
    };
  return {
    card: "A VIEWER ASKED",
    comment:
      "A viewer asked for this one in our comments. Ask yours and I might test it on tonight's stream.",
  };
}

export interface ViewerComment {
  commentId: string;
  text: string;
  author: string;
  game: string;
  at: string;
  likes?: number;
}

/**
 * Viewer comments as stream asks (pure): only a testable question, claim or request about a system (the stream-asks
 * list's own reading), never a hostile or spammy one, credited by public handle when there is one.
 */
export function viewerSightings(comments: ViewerComment[]): Sighting[] {
  const out: Sighting[] = [];
  for (const c of comments) {
    if (screenComment(c.text).screen !== "ok") continue;
    if (advertiserProblems(c.text).length) continue;
    const handle = safeHandle(c.author);
    for (const raw of extractAsks(c.text).slice(0, 1)) {
      const mention: Mention = {
        source: "viewers",
        name: "Pulse viewers",
        at: c.at,
        text: raw.text.slice(0, 280),
        engagement: 5 + (c.likes ?? 0),
        ...(handle ? { handle } : {}),
      };
      out.push({ game: c.game, raw, mention });
    }
  }
  return out;
}

/** Viewers' asks folded into the list (pure, the list's own fold): repeats join the ask already there. */
export function foldViewerAsks(
  asks: StreamAsk[],
  comments: ViewerComment[],
  now: Date,
): StreamAsk[] {
  return foldSightings(asks, viewerSightings(comments), now);
}

/** True when a viewer asked for it (pure). */
export const viewerAsked = (a: Pick<StreamAsk, "mentions">) =>
  a.mentions.some((m) => m.source === "viewers" || m.source === "comments");

/**
 * Tonight's test list (pure): up to `viewers` open asks that viewers asked for go first (the most-mentioned first),
 * then the rest of the open list as it stands. Spoiler-held and settled asks never appear.
 */
export function tonightList(
  asks: StreamAsk[],
  top: number,
  viewers: number,
): StreamAsk[] {
  const open = openAsks(asks);
  const fromViewers = open.filter(viewerAsked).slice(0, Math.max(0, viewers));
  const rest = open.filter((a) => !fromViewers.includes(a));
  return [...fromViewers, ...rest].slice(0, top);
}

// ------------------------------------------------------------------ the Lab poll ("you pick tonight's test")

export interface LabPoll {
  question: string;
  /** Four options, each one open ask's question, short enough for a YouTube poll option (65 characters). */
  options: Array<{ askId: string; text: string }>;
}

const POLL_OPTION_MAX = 65;

/** This week's poll (pure): the four best open asks a stream can do early in the game, rumours labelled. */
export function labPoll(asks: StreamAsk[]): LabPoll | undefined {
  const options = openAsks(asks)
    .filter((a) => a.earlyGame && !a.spoiler)
    .map((a) => ({
      askId: a.id,
      text: `${a.rumour ? "Rumour: " : ""}${a.question}`
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((o) => o.text.length <= POLL_OPTION_MAX)
    .slice(0, 4);
  if (options.length < 2) return undefined;
  return {
    question: "Which GTA 6 test should I run on tonight's stream?",
    options,
  };
}

export interface LabPollResult {
  at: string;
  options: Array<{ askId: string; text: string; percent: number }>;
}

const POLL_KEY = "lab_poll_result";

/** The poll's winner as a viewers' mention of its ask (pure): the vote is buzz, credited to the voters, never a name. */
export function foldPollResult(
  asks: StreamAsk[],
  r: LabPollResult,
): StreamAsk[] {
  const win = [...r.options].sort((a, b) => b.percent - a.percent)[0];
  if (!win) return asks;
  const text = `Poll winner (${win.percent}%): ${win.text}`;
  return asks.map((a) =>
    a.id !== win.askId || a.mentions.some((m) => m.name === "Pulse poll" && m.at === r.at)
      ? a
      : {
          ...a,
          mentions: [
            ...a.mentions,
            {
              source: "viewers" as const,
              name: "Pulse poll",
              at: r.at,
              text,
              engagement: 20 + win.percent,
            },
          ],
          mentionCount: a.mentionCount + 1,
          engagement: a.engagement + 20 + win.percent,
          lastSeen: r.at > a.lastSeen ? r.at : a.lastSeen,
        },
  );
}

/** Keeps a finished Lab poll's result (the Studio routine reads the percentages as YouTube shows them). */
export async function recordLabPoll(db: Db, r: LabPollResult): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [POLL_KEY, JSON.stringify(r)],
  );
}

export async function readLabPoll(db: Db): Promise<LabPollResult | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [POLL_KEY],
  );
  try {
    return row ? (JSON.parse(row.value) as LabPollResult) : undefined;
  } catch {
    return undefined;
  }
}

/** Viewer comments of the last two weeks under the channel's own videos, with the author's stored handle. */
export async function viewerComments(
  db: Db,
  gameOf: (text: string) => string | undefined,
): Promise<ViewerComment[]> {
  const rows = await db
    .query<{
      comment_id: string;
      comment: string;
      author_name: string | null;
      game: string | null;
      title: string | null;
      at: string | Date;
    }>(
      `SELECT c.comment_id, c.comment, c.author_name, c.created_at AS at,
              COALESCE(NULLIF(e.script_json->>'game_title', ''), e.story_json->>'gameHint') AS game,
              e.script_json->>'title' AS title
         FROM comment_replies c LEFT JOIN episodes e ON e.id = c.episode_id
        WHERE c.created_at > now() - interval '14 days' AND c.video_id !~ '^(ig|fb):'
          AND (c.kind IS NULL OR c.kind NOT IN ('hostile','spam'))
        ORDER BY c.created_at DESC LIMIT 400`,
    )
    .catch(() => []);
  const out: ViewerComment[] = [];
  for (const r of rows) {
    const game = gameOf(`${r.game ?? ""} ${r.title ?? ""} ${r.comment}`);
    if (!game) continue;
    out.push({
      commentId: r.comment_id,
      text: r.comment,
      author: r.author_name ?? "",
      game,
      at: new Date(r.at).toISOString(),
    });
  }
  return out;
}
