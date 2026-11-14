// Funny Shorts and memes on trial (owner, 14 Nov 2026: judged on subscribers per 1,000 views). The subscriber learner
// (src/subslearn) tallies both as their own formats every Sunday; this says what the numbers mean for them, pure:
//   trial     not enough behind it yet (the learner's own SUBS_LEARN_MIN_VIEWS and SUBS_LEARN_MIN_VIDEOS), or in between
//   promoted  at least SUBS_LEARN_LEAD times the channel's other Shorts per 1,000 views: a funny Short may then also
//             take any free gameplay slot, not only FUNNY_SLOT; a meme goes out twice a week
//   dropped   under half the channel's other Shorts per 1,000 views over 28 days: no more are made until the numbers
//             are looked at again (a dropped format is judged again only from what it already made, so it stays
//             dropped unless the owner switches it back on with FUNNY_RESET or MEME_RESET)
// A verdict moves at most one step a week, and SUBS_LEARN_APPLY=false reports without acting.

import type { SubsFormat, SubsTally } from "../subslearn/learn.ts";

export type TrialFormat = "funny" | "meme";
export type Verdict = "trial" | "promoted" | "dropped";

export const TRIAL_FORMATS: TrialFormat[] = ["funny", "meme"];
export const verdictKey = (f: TrialFormat) => `trial_verdict:${f}`;

/** Subscribers per 1,000 views of every Short format except the trial ones (pure): the bar they are held to. */
export function channelRate(
  month: ReadonlyMap<SubsFormat, SubsTally>,
): number | undefined {
  let views = 0;
  let subs = 0;
  for (const [f, t] of month) {
    if (
      f === "funny" ||
      f === "meme" ||
      f === "documentary" ||
      f === "long_ranking"
    )
      continue;
    views += t.views;
    subs += t.subs;
  }
  return views > 0 ? (subs / views) * 1000 : undefined;
}

export interface TrialJudgement {
  format: TrialFormat;
  was: Verdict;
  now: Verdict;
  rate?: number;
  bar?: number;
  why: string;
}

/** This week's verdict for one trial format (pure). */
export function judgeTrial(
  format: TrialFormat,
  was: Verdict,
  month: ReadonlyMap<SubsFormat, SubsTally>,
  s: { minViews: number; minVideos: number; lead: number },
): TrialJudgement {
  const t = month.get(format);
  const bar = channelRate(month);
  if (was === "dropped")
    return {
      format,
      was,
      now: was,
      why: "dropped earlier; FUNNY_RESET or MEME_RESET brings it back",
    };
  if (!t || t.views < s.minViews || t.videos < s.minVideos || bar === undefined)
    return {
      format,
      was,
      now: was,
      why: `not enough yet (${t?.videos ?? 0} posts, ${t?.views ?? 0} views over 28 days; needs ${s.minVideos} and ${s.minViews})`,
    };
  const rate = (t.subs / t.views) * 1000;
  const r = (n: number) => n.toFixed(2);
  if (rate >= bar * s.lead && was === "trial")
    return {
      format,
      was,
      now: "promoted",
      rate,
      bar,
      why: `${r(rate)} subscribers per 1,000 views against ${r(bar)} for the other Shorts`,
    };
  if (rate < bar * 0.5)
    return {
      format,
      was,
      now: was === "promoted" ? "trial" : "dropped",
      rate,
      bar,
      why: `${r(rate)} subscribers per 1,000 views, under half the other Shorts' ${r(bar)}`,
    };
  return {
    format,
    was,
    now: was,
    rate,
    bar,
    why: `${r(rate)} per 1,000 views against ${r(bar)}: no change`,
  };
}

/** One line for the alerts channel (pure). */
export function trialLine(j: TrialJudgement, apply: boolean): string {
  const name = j.format === "funny" ? "Funny Shorts" : "Meme posts";
  if (j.now === j.was) return `${name}: ${j.now} (${j.why}).`;
  return `${name}: ${j.was} -> ${j.now}${apply ? "" : " (report only, nothing changed)"} (${j.why}).`;
}
