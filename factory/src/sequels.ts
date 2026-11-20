// Sequels to winners (owner's plan, 4 Nov 2026, item 9): a Short that does well triggers its long version in the
// picker, San Andreas first. The long video then arrives with proof people want it, where every other topic has a
// prediction. "Does well" is measured against the channel's own Shorts, not a fixed number of views, from the
// "retention" row the factory already keeps for each video from day four (src/analytics.ts):
//   reach: at least SEQUEL_VIEWS_MULTIPLE times the median Short's views, and
//   hold:  at least SEQUEL_WATCHED_MULTIPLE times the median Short's percentage watched.
// Both, because each alone misleads on this channel: a big game's news Short draws views people swipe past (1,311
// views at 39% watched), and a Short almost nobody saw can show any percentage (7 views at 89%). MIN_SAMPLE_VIEWS is
// only there because a percentage over a handful of viewers means nothing. Subscribers are shown and not required:
// the channel has gained 8 from 61 Shorts, too few for a rule to stand on yet.
// What it triggers depends on the Short: a Why Short's long version is a documentary (src/docpick.ts), a ranking
// Short's is a long ranking (maybeSelectLongform). A news Short that does well has no long version of its own (its
// story is an update, not an arc), so it is left to the take-off detector (src/hits.ts). SEQUEL_WINNERS turns this on.
import type { Db } from "./db.ts";
import type { EvergreenCandidate } from "./editorial/evergreen.ts";
import { LIVE_AT } from "./analytics.ts";

export const SEQUEL_VIEWS_MULTIPLE = 2;
export const SEQUEL_WATCHED_MULTIPLE = 1.4;
/** Below this many views a Short's percentage watched is noise. */
export const MIN_SAMPLE_VIEWS = 100;
/** The channel's norm needs this many Shorts before anything is called a winner. */
export const MIN_NORM_SHORTS = 12;
/** A Short and its audience are both fresh enough for a follow-up for this long. */
export const SEQUEL_WINDOW_DAYS = 60;

export type ShortKind = "why" | "ranking" | "news" | "other";

/** What a Short is, from its lane and how it was made. */
export function shortKind(ep: {
  lane: string;
  story_hash?: string | null;
  evergreen_format?: string | null;
}): ShortKind {
  if (ep.story_hash?.startsWith("why:")) return "why";
  if (ep.lane === "cutdown" || ep.evergreen_format === "ranking")
    return "ranking";
  if (ep.lane === "news" || ep.lane === "news_breaking") return "news";
  return "other";
}

export interface ShortResult {
  id: string;
  kind: ShortKind;
  title: string;
  /** The game or franchise it is about: its long version's subject. */
  subject: string;
  question?: string;
  angle?: string;
  views: number;
  watched: number;
  subs: number;
}

export interface SequelNorm {
  shorts: number;
  views: number;
  watched: number;
}

export interface SequelWinner extends ShortResult {
  /** Times the median Short's views and percentage watched. */
  viewsX: number;
  watchedX: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The channel's norm and the Shorts well ahead of it on both counts, strongest first (pure). */
export function findWinners(rows: ShortResult[]): {
  norm: SequelNorm;
  winners: SequelWinner[];
} {
  const norm = {
    shorts: rows.length,
    views: median(rows.map((r) => r.views)),
    watched: median(rows.map((r) => r.watched)),
  };
  if (rows.length < MIN_NORM_SHORTS || !norm.views || !norm.watched)
    return { norm, winners: [] };
  const winners = rows
    .filter(
      (r) =>
        r.views >= MIN_SAMPLE_VIEWS &&
        r.views >= SEQUEL_VIEWS_MULTIPLE * norm.views &&
        r.watched >= SEQUEL_WATCHED_MULTIPLE * norm.watched,
    )
    .map((r) => ({
      ...r,
      viewsX: Math.round((r.views / norm.views) * 10) / 10,
      watchedX: Math.round((r.watched / norm.watched) * 10) / 10,
    }))
    .sort((a, b) => b.viewsX * b.watchedX - a.viewsX * a.watchedX);
  return { norm, winners };
}

/** Every Short's result on file from the last SEQUEL_WINDOW_DAYS. */
export async function shortResults(db: Db, now: Date): Promise<ShortResult[]> {
  const rows = await db.query<{
    id: string;
    lane: string;
    story_hash: string | null;
    story_json: any;
    script_json: any;
    raw: any;
  }>(
    `SELECT e.id, e.lane, e.story_hash, e.story_json, e.script_json, m.raw
       FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'retention' AND e.lane NOT IN ('twin', 'longform')
        AND COALESCE(e.script_json->>'runtime', 'short') = 'short'
        AND ${LIVE_AT("e")} > $1::timestamptz - ($2 || ' days')::interval`,
    [now, String(SEQUEL_WINDOW_DAYS)],
  );
  return rows.map((r) => {
    const raw = typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw;
    const sc = r.script_json ?? {};
    return {
      id: r.id,
      kind: shortKind({
        lane: r.lane,
        story_hash: r.story_hash,
        evergreen_format: sc.evergreen_format,
      }),
      title: sc.youtube?.title ?? r.story_json?.headline ?? r.id,
      subject: r.story_json?.gameHint || sc.game_title || "",
      question: r.story_json?.why?.question,
      angle: r.story_json?.why?.angle,
      views: Number(raw?.views ?? 0),
      watched: Number(raw?.avgViewPercent ?? 0),
      subs: Number(raw?.subscribersGained ?? 0),
    };
  });
}

/** The channel's winners right now. */
export async function sequelWinners(
  db: Db,
  now: Date,
): Promise<{ norm: SequelNorm; winners: SequelWinner[] }> {
  return findWinners(await shortResults(db, now));
}

/** The numbers behind a winner, in one phrase, for the log and Discord. */
export function winnerProof(w: SequelWinner, norm: SequelNorm): string {
  return `${w.views.toLocaleString("en-US")} views against our usual ${Math.round(norm.views).toLocaleString("en-US")} (${w.viewsX}x), ${Math.round(w.watched)}% watched against ${Math.round(norm.watched)}% (${w.watchedX}x), +${w.subs} subscriber${w.subs === 1 ? "" : "s"}`;
}

const same = (a: string, b: string) => {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return n(a) === n(b);
};

/**
 * The ranking winners with no long ranking yet, for the long ranking's pick: the winner's franchise as a candidate
 * (a Short's own ranking does not count as covered), and a line telling the editor why it should come first.
 */
export function rankingSequels(
  winners: SequelWinner[],
  norm: SequelNorm,
  longThemes: readonly string[],
): { candidates: EvergreenCandidate[]; block: string; headlines: string[] } {
  const open = winners.filter(
    (w) =>
      w.kind === "ranking" &&
      w.subject &&
      !longThemes.some((t) => same(t, w.subject)),
  );
  return {
    candidates: open.map((w) => ({
      name: w.subject,
      source: "our own Short did well",
      note: winnerProof(w, norm),
    })),
    headlines: open.map((w) => w.title),
    block: open.length
      ? `Proven on our own channel: ${open.map((w) => `our ranking Short "${w.title}" (${winnerProof(w, norm)})`).join("; ")}. Viewers already showed they want this, so its long version comes first unless a candidate is far stronger. A long ranking of a franchise whose Short did well is the follow-up, not a repeat.`
      : "",
  };
}
