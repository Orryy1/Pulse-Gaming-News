// Keeping long videos alive (19 Nov 2026): no long video went out from 10 Nov although the factory tried several
// times a week. Two faults did it: a documentary died whole when one chapter could not be written, and the weekly
// ranking's topic picker refused every week because the viewer poll's winner was not on the list it may choose from.
// The pure decisions live here so they are tested without a model or a database.
import type { EvergreenCandidate, EvergreenTopic } from "./evergreen.ts";
import type { OpenLoop } from "./openloops.ts";
import type { PollResult } from "../social/poll.ts";

// ------------------------------------------------------------------ a chapter that can't be written

/**
 * What happens to a documentary chapter the writer still refuses after its sources were widened (DOC_DROP_REFUSED_CHAPTER).
 * It is dropped, and the rest of the video goes on, when the switch is on, it is not the first chapter (the story
 * has to start somewhere the viewer can follow), and the chapters written plus those still to come still reach the
 * minimum (DOC_MIN_CHAPTERS). Otherwise the video stops, as it always did.
 */
export function refusedChapterFate(o: {
  on: boolean;
  /** Where the chapter sits in the order being written: 0 is the first. */
  position: number;
  /** Chapters already written. */
  written: number;
  /** Chapters still to be written after this one. */
  left: number;
  min: number;
}): { drop: boolean; why: string } {
  if (!o.on)
    return {
      drop: false,
      why: "dropping a refused chapter is switched off (DOC_DROP_REFUSED_CHAPTER)",
    };
  if (o.position === 0)
    return {
      drop: false,
      why: "it is the first chapter, where the story starts",
    };
  const most = o.written + o.left;
  if (most < o.min)
    return {
      drop: false,
      why: `without it the documentary could have ${most} chapter${most === 1 ? "" : "s"} at most, under the minimum of ${o.min}`,
    };
  return {
    drop: true,
    why: `${o.written} written and ${o.left} to come, so the minimum of ${o.min} can still be met`,
  };
}

/**
 * The open loops that survive a dropped chapter (1-based number): a question raised or answered there is taken
 * out, so no later chapter or cold open promises an answer the video no longer gives. A question an earlier chapter
 * already raised (chapters are written in order) and only the dropped one answered is listed as hanging, so the
 * release checks see it rather than a viewer.
 */
export function loopsWithoutChapter(
  loops: readonly OpenLoop[],
  chapter: number,
): { loops: OpenLoop[]; removed: string[]; hanging: string[] } {
  const kept: OpenLoop[] = [];
  const removed: string[] = [];
  const hanging: string[] = [];
  for (const l of loops) {
    if (l.plant_chapter === chapter || l.payoff_chapter === chapter) {
      removed.push(`open loop "${l.question}": chapter ${chapter} was dropped`);
      if (
        l.payoff_chapter === chapter &&
        l.plant_chapter > 0 &&
        l.plant_chapter < chapter
      )
        hanging.push(
          `open loop "${l.question}": raised in chapter ${l.plant_chapter}, but chapter ${chapter}, which answered it, was dropped`,
        );
    } else kept.push(l);
  }
  return { loops: kept, removed, hanging };
}

// ------------------------------------------------------------------ the viewer poll and the ranking's topic

const POLL_DAYS = 14;

const norm = (t: string | null | undefined) =>
  (t ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The same series by name, either way round, in whole words ("Halo" and "Halo: The Master Chief Collection", never "Ark" and "Dark Souls"). */
export function sameSeries(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = ` ${norm(a)} `;
  const y = ` ${norm(b)} `;
  return x.trim() !== "" && y.trim() !== "" && (x.includes(y) || y.includes(x));
}

/** The latest poll's winner while it still steers (two weeks, as pollBlock reads it), else nothing. */
export function pollWinnerOf(
  r: PollResult | undefined,
  now: Date,
): { name: string; percent: number } | undefined {
  if (!r?.options.length) return undefined;
  if (now.getTime() - new Date(r.at).getTime() > POLL_DAYS * 86_400_000)
    return undefined;
  const top = [...r.options].sort((a, b) => b.percent - a.percent)[0]!;
  const name = top.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || !(top.percent > 0)) return undefined;
  return { name, percent: top.percent };
}

/**
 * The shortlist with the poll's winner on it (LONG_POLL_CANDIDATE): the picker is told to choose the winner, so the
 * winner has to be one of the candidates it may choose. Put first, as viewers asked for it; never added when it is
 * already listed or was ranked in the last six months.
 */
export function withPollWinner(
  candidates: EvergreenCandidate[],
  winner: { name: string; percent: number } | undefined,
  covered: string[],
): { candidates: EvergreenCandidate[]; added: boolean } {
  if (!winner) return { candidates, added: false };
  if (candidates.some((c) => sameSeries(c.name, winner.name)))
    return { candidates, added: false };
  if (covered.some((c) => sameSeries(c, winner.name)))
    return { candidates, added: false };
  return {
    candidates: [
      {
        name: winner.name,
        source: "viewer poll",
        note: `won our viewer poll with ${winner.percent}%`,
      },
      ...candidates,
    ],
    added: true,
  };
}

/** A refusal that leans on the poll ("the poll winner is missing from the shortlist"). */
export function citesPoll(reason: string | undefined): boolean {
  return /\bpolls?\b|\bviewers? vot/i.test(reason ?? "");
}

const RETRY_NOTE =
  "The viewer poll can't decide this week's topic. Choose the strongest ten-entry ranking from the candidates listed; return -1 only when none of them can make one.";

/**
 * The weekly ranking's topic (LONG_POLL_CANDIDATE, LONG_POLL_FALLBACK). 14 Nov 2026: eight picks in a row came back
 * empty with "the explicit 100% poll winner is missing from the shortlist", and the week was skipped. Now the
 * winner is on the shortlist; and a refusal that still cites the poll is asked once more without the poll line,
 * then falls back to the top of the shortlist rather than skipping the week. Any other refusal stands.
 */
export async function chooseLongformTopic(o: {
  select: (
    candidates: EvergreenCandidate[],
    demand: string,
  ) => Promise<EvergreenTopic>;
  candidates: EvergreenCandidate[];
  /** Everything the picker reads about demand, the poll line included. */
  demand: string;
  /** The poll's own line inside demand ("" when there is none). */
  pollLine: string;
  winner?: { name: string; percent: number };
  covered: string[];
  addWinner: boolean;
  fallback: boolean;
}): Promise<{
  topic: EvergreenTopic;
  candidates: EvergreenCandidate[];
  how: "picked" | "retried" | "fallback" | "none";
  added: boolean;
  /** The first refusal, when there was one. */
  refusal?: string;
}> {
  const shortlist = o.addWinner
    ? withPollWinner(o.candidates, o.winner, o.covered)
    : { candidates: o.candidates, added: false };
  const candidates = shortlist.candidates;
  const valid = (t: EvergreenTopic) =>
    t.candidate_index >= 0 && !!candidates[t.candidate_index];
  const first = await o.select(candidates, o.demand);
  if (valid(first))
    return { topic: first, candidates, how: "picked", added: shortlist.added };
  const base = { candidates, added: shortlist.added, refusal: first.reason };
  // Only when a poll steered the pick: a refusal that mentions one with no poll line in front of it stands.
  if (
    !o.fallback ||
    !o.pollLine ||
    !citesPoll(first.reason) ||
    !candidates.length
  )
    return { ...base, topic: first, how: "none" };
  const without = (
    o.pollLine ? o.demand.replace(o.pollLine, "") : o.demand
  ).trim();
  const again = await o
    .select(candidates, [without, RETRY_NOTE].filter(Boolean).join("\n\n"))
    .catch(() => undefined);
  if (again && valid(again)) return { ...base, topic: again, how: "retried" };
  // The fallback skips the model, so it skips its covered check too: never a series ranked lately.
  const at = candidates.findIndex(
    (c) => !o.covered.some((h) => sameSeries(h, c.name)),
  );
  if (at < 0) return { ...base, topic: first, how: "none" };
  const best = candidates[at]!;
  return {
    ...base,
    how: "fallback",
    topic: {
      candidate_index: at,
      format: "ranking",
      theme: best.name,
      title_idea: `Every ${best.name} Game Ranked Worst to Best`.slice(0, 60),
      criterion:
        "How each game plays today, what it changed and whether it still holds up.",
      reason: `Fallback to the top of the shortlist: the picker refused twice, citing the viewer poll (${(first.reason ?? "").slice(0, 160)}).`,
    },
  };
}
