// The same-day angle for official drops (upgrade queue item 16, niche research change 12, 11 Nov 2026). On the
// 10 Nov trailer a small channel that published inside 3 hours got 0.1 times its median and one that published 12
// hours later with a reframing idea got 5.6 times; a large channel that kept its normal slot six hours late did 2.8
// times. Trailer and screenshot breakdowns flopped on 54% of 41 small-channel videos. So, with DROP_ANGLE on:
//   - an official drop (a publisher's trailer, screenshots, a reveal) never races as a breaking Short: it waits for
//     the usual news slot, and goes on its own only when no slot would get it out within DROP_ANGLE_HOURS;
//   - the writer is asked for one reframing idea, never a list of what the trailer shows, and a draft that reads as
//     a detail list is sent back;
//   - the week's long "explained" video never takes a trailer or screenshot drop as its story (no long breakdowns).
// Off, nothing here runs. Pure.

import type { Script } from "./schema.ts";
import type { RankedStory } from "./explained.ts";

/** What an official drop is about: something new to look at from the publisher. */
const DROP =
  /\b(trailers?|teasers?|screenshots?|first look|gameplay (?:reveal|showcase|debut|overview|deep dive)|reveal(?:ed|s)?|unveil(?:ed|s)?|new (?:images|footage|look|gameplay)|key art|story trailer|launch trailer|showcase)\b/i;
/** A drop whose news is really a date, a price, a delay or a sale is that story, not a drop. */
const NOT_DROP =
  /\b(delay(?:ed|s)?|postpone\w*|pushed back|slips?|price[sd]?|\$\d|sold|sales|layoffs?|lawsuit|cancel(?:led|ed|s)?|shut(?:s|ting)? down)\b/i;

/** Whether a line of headlines is about a drop (pure). */
export function isDropText(text: string): boolean {
  return DROP.test(text) && !NOT_DROP.test(text);
}

/** A story cluster that is an official drop: the publisher's own source is in it and its headline is a drop. */
export function isOfficialDrop(c: {
  headline: string;
  hasOfficial: boolean;
}): boolean {
  return c.hasOfficial && isDropText(c.headline);
}

/** The same for one of the big-story desk's stories (src/bigstories.ts): a reveal, from an official source. */
export function isDropStory(s: {
  headline: string;
  official: boolean;
  event: string;
}): boolean {
  return s.official && s.event === "reveal" && isDropText(s.headline);
}

/**
 * Why a big official drop waits instead of going out now, or undefined when it should go now: not a drop, a news
 * slot is due, or it has waited long enough that the Short (started `leadHours` before it goes out) would land past
 * `hours` after the drop.
 */
export function dropWait(
  s: { headline: string; official: boolean; event: string; firstAt: string },
  now: Date,
  o: { hours: number; leadHours: number; slotDue: boolean },
): string | undefined {
  if (!isDropStory(s) || o.slotDue) return undefined;
  const age = (now.getTime() - new Date(s.firstAt).getTime()) / 3_600_000;
  if (!Number.isFinite(age) || age + o.leadHours >= o.hours) return undefined;
  return `an official drop keeps the usual slot: it waits for the next news slot and one reframing idea, no later than ${o.hours} hours after it landed (DROP_ANGLE)`;
}

/** What the writer reads for an official drop. */
export const DROP_ANGLE_RULE = `This story is an official drop (a trailer, screenshots or a reveal). Viewers have already seen it and a dozen lists of what it shows. Do not write a list of details. Write one reframing idea: a single claim that changes how the viewer sees the whole game (what it lets you do, why they made this choice, what it says about the game nobody has said), then two or three details from the sources as the evidence for that claim, and the take says what it means for you. No "everything we spotted", no "N details", no line that only says what the picture shows.`;

const LIST_TITLE =
  /\b(?:\d+|every(?:thing)?|all the)\b[^.?!]{0,40}\b(?:details?|things|secrets|easter eggs|you missed|we spotted|we know|spotted|revealed)\b/i;
const SPOTTED =
  /\b(spotted|you can see|we see|we can see|also shows?|there's also|also features?|also see|we also get|another detail)\b/i;

/** A drop's draft that reads as a detail list (pure). */
export function detailListProblems(
  script: Pick<Script, "hook" | "headline" | "beats" | "youtube">,
): string[] {
  const out: string[] = [];
  const top = [script.hook, script.headline, script.youtube.title].find((t) =>
    LIST_TITLE.test(t),
  );
  if (top)
    out.push(
      `"${top}" promises a list of details; an official drop gets one reframing idea, so say the idea instead.`,
    );
  const spotted = script.beats.filter((b) => SPOTTED.test(b.narration)).length;
  if (spotted >= 2)
    out.push(
      `${spotted} beats list things the trailer shows; make each beat evidence for the one idea, not another detail.`,
    );
  return out;
}

/** Most of a story's coverage is a trailer or screenshot drop, with no conflict in it (pure). */
export function isDropCoverage(
  headlines: string[],
  conflictTerms: string[],
): boolean {
  if (!headlines.length || conflictTerms.length) return false;
  const drops = headlines.filter(isDropText).length;
  return drops * 2 > headlines.length;
}

/** The week's stories with trailer and screenshot drops excluded from the long explained video, re-sorted (pure). */
export function excludeDropStories(ranked: RankedStory[]): RankedStory[] {
  return ranked
    .map((r) =>
      !r.score.excluded &&
      isDropCoverage(r.story.headlines, r.score.conflictTerms)
        ? {
            ...r,
            score: {
              ...r.score,
              excluded:
                "a trailer or screenshot drop: long breakdowns are switched off (DROP_ANGLE)",
            },
          }
        : r,
    )
    .sort(
      (a, b) =>
        Number(!!a.score.excluded) - Number(!!b.score.excluded) ||
        b.score.total - a.score.total,
    );
}
