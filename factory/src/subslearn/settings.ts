// The settings of the subscriber learner (SUBS_LEARN, 14 Nov 2026), read in one place (pure: the environment is passed
// in). Off by default: with SUBS_LEARN unset nothing is read, nothing is reported and no slot moves.

export interface SubsLearnSettings {
  /** SUBS_LEARN: work out subscribers per 1,000 views for each format every Sunday and report it. */
  enabled: boolean;
  /** SUBS_LEARN_APPLY: also move a slot when the numbers clearly say so; false is report-only (says what it would do). */
  apply: boolean;
  /** SUBS_LEARN_MIN_VIEWS: views a format needs over 28 days before it can win or lose a slot. */
  minViews: number;
  /** SUBS_LEARN_MIN_VIDEOS: videos a format needs over 28 days before it can win or lose a slot. */
  minVideos: number;
  /** SUBS_LEARN_MIN_SUBS: subscribers the stronger format needs over 28 days, so one lucky subscriber never moves a slot. */
  minSubs: number;
  /** SUBS_LEARN_LEAD: how many times better per 1,000 views the stronger format must be (1.5 = 50% better). */
  lead: number;
  /** SUBS_LEARN_MAX_SHIFT: the most slots any format may gain or lose against its configured count. */
  maxShift: number;
}

const num = (
  raw: string | undefined,
  fallback: number,
  min: number,
): number => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n)
    ? Math.max(min, n)
    : fallback;
};

const flag = (raw: string | undefined, fallback: boolean): boolean =>
  raw === undefined || raw === ""
    ? fallback
    : ["1", "true", "yes", "on"].includes(raw.toLowerCase());

export function subsLearnSettings(
  env: Record<string, string | undefined>,
): SubsLearnSettings {
  return {
    enabled: flag(env.SUBS_LEARN, false),
    apply: flag(env.SUBS_LEARN_APPLY, true),
    minViews: num(env.SUBS_LEARN_MIN_VIEWS, 5000, 0),
    minVideos: Math.round(num(env.SUBS_LEARN_MIN_VIDEOS, 5, 1)),
    minSubs: Math.round(num(env.SUBS_LEARN_MIN_SUBS, 3, 0)),
    lead: num(env.SUBS_LEARN_LEAD, 1.5, 1),
    maxShift: Math.round(num(env.SUBS_LEARN_MAX_SHIFT, 2, 0)),
  };
}

export function subsLearnSummary(s: SubsLearnSettings): string {
  if (!s.enabled) return "off";
  return `${s.apply ? "moves slots" : "report only"}, needs ${s.minViews} views and ${s.minVideos} videos in 28 days, ${s.lead}x lead, at most ${s.maxShift} slot(s) per format, one change a week`;
}
