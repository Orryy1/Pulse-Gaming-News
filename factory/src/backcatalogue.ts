// Repackaging the back catalogue (owner's growth plan, move 5, 1 Nov 2026): Galloway's example of a thumbnail made
// 30-40% better bringing about 40 times the daily views on an old video makes repackaging Pulse's existing long
// videos one of the cheapest experiments there is. Each public long video goes back into the Test & compare queue
// (data/abtests/pending.json, read by the pulse-studio-abtest routine through /routine/abtest) with new title angles
// in the winning shapes (src/editorial/titleshape.ts) and new thumbnail designs. The routine does the clicking in
// Studio; nothing here touches a live video. YouTube tests three titles at most and the first must be the video's
// live title (the routine checks it before it starts), so an entry carries the live title and two new angles, and
// the third angle waits in `nextTitles` for the next round.
import {
  titleAngle,
  titleShapeProblems,
  type TitleAngle,
} from "./editorial/titleshape.ts";

/** Hand-approved by the owner (4 Nov 2026): never re-rendered or replaced by a repackaging run. */
export const HAND_APPROVED: ReadonlySet<string> = new Set(["BemcTLS8mVI", "7CelsHTQU3s"]);

export interface AbQueueEntry {
  videoId: string;
  episode: string;
  /** The live title first, then the alternatives (three at most). */
  titles: string[];
  /** Absolute paths: the current thumbnail first, then the alternatives. */
  thumbs: string[];
  publishAt: string | null;
  added: string;
  /** Back-catalogue entries: the angle of each title, and the angle saved for the next round. */
  angles?: TitleAngle[];
  nextTitles?: string[];
  repackage?: true;
  /** The words on each new thumbnail, for the hero rule's check when the entry is applied. */
  thumbWords?: string[];
}

export interface AngleTitle {
  title: string;
  angle?: TitleAngle;
  /** 1-4 words in capitals for the thumbnail, not the whole title again (one strong word from its promise is fine). */
  thumb?: string;
}

/** Fixed thumbnail words per angle, when the writer gave none: the hook, never a fact. */
export const ANGLE_THUMB: Record<TitleAngle, string> = {
  downfall: "WHERE IT WENT WRONG",
  hidden: "WHAT REALLY HAPPENED",
  comeback: "THE COMEBACK",
  why: "THE REAL REASON",
  how: "HOW IT HAPPENED",
  claim: "YOU'LL DISAGREE",
  list: "RANKED",
  history: "THE STORY",
  plain: "THE STORY",
};

/** Three new angles, checked: each passes the shape rule, differs from the live title and from each other. */
export function newAngles(
  liveTitle: string,
  candidates: AngleTitle[],
  allow: readonly string[] = [],
): Array<Required<AngleTitle>> {
  const seenTitle = new Set([liveTitle.toLowerCase().trim()]);
  const seenAngle = new Set<TitleAngle>();
  const out: Array<Required<AngleTitle>> = [];
  for (const c of candidates) {
    const t = c.title.replace(/\s+/g, " ").trim();
    const angle =
      titleAngle(t) === "plain" && c.angle ? c.angle : titleAngle(t);
    if (
      seenTitle.has(t.toLowerCase()) ||
      seenAngle.has(angle) ||
      t.length > 70 ||
      /[—–!]/.test(t) ||
      titleShapeProblems(t, allow).length ||
      ["list", "history", "plain"].includes(angle)
    )
      continue;
    seenTitle.add(t.toLowerCase());
    seenAngle.add(angle);
    out.push({
      title: t,
      angle,
      thumb: (c.thumb ?? ANGLE_THUMB[angle]).toUpperCase(),
    });
    if (out.length === 3) break;
  }
  return out;
}

/** The queue entry for one back-catalogue video. */
export function backCatalogueEntry(o: {
  videoId: string;
  episode: string;
  liveTitle: string;
  angles: Array<Required<AngleTitle>>;
  thumbs: string[];
  publishAt: string | null;
  now: Date;
}): AbQueueEntry {
  return {
    videoId: o.videoId,
    episode: o.episode,
    titles: [o.liveTitle, ...o.angles.slice(0, 2).map((a) => a.title)],
    thumbs: o.thumbs,
    publishAt: o.publishAt,
    added: o.now.toISOString(),
    angles: [
      titleAngle(o.liveTitle),
      ...o.angles.slice(0, 2).map((a) => a.angle),
    ],
    nextTitles: o.angles.slice(2).map((a) => a.title),
    repackage: true,
  };
}

/**
 * The queue with the entry in place: an untested entry for the same video is replaced (a fresh package beats a
 * stale one); a video whose test the routine has already set up (in done.json) is left alone.
 */
export function upsertAbQueue(
  list: AbQueueEntry[],
  entry: AbQueueEntry,
  done: ReadonlySet<string>,
): {
  list: AbQueueEntry[];
  action: "added" | "replaced" | "skipped (test already set up)";
} {
  if (done.has(entry.videoId))
    return { list, action: "skipped (test already set up)" };
  const i = list.findIndex((x) => x.videoId === entry.videoId);
  if (i < 0) return { list: [...list, entry], action: "added" };
  const next = [...list];
  next[i] = entry;
  return { list: next, action: "replaced" };
}
