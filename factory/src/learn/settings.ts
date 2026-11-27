// The learning core's settings (src/learn, 14 Nov 2026), read in one place (pure: the environment is passed in). Every
// part is off by default: with no LEARN_* setting nothing is recorded, nothing changes for any Short and no post is made.

export type LearnMode = "off" | "shadow" | "on";

export interface LearnSettings {
  /** LEARN_STAMPS: stamp every episode with its prompts, models, settings and code commit, and keep the change ledger. */
  stamps: boolean;
  /** LEARN_HOLDOUT_SHARE: the share of episodes (0 to 0.2) made on the pinned baseline settings, picked by episode hash. */
  holdoutShare: number;
  /** LEARN_HOLDOUT_LANES: the lanes the holdout draws from (news Shorts by default). */
  holdoutLanes: string[];
  /** LEARN_HOLDOUT_REPIN_DAYS: the baseline is re-pinned to the live settings this often (0: never by itself). */
  holdoutRepinDays: number;
  /** LEARN_JUDGES: copy every judge score into the calibration ledger and correlate them with outcomes weekly. */
  judges: boolean;
  /** LEARN_JUDGE_MIN: Shorts a judge needs with an outcome before its link (or lack of one) is stated. */
  judgeMin: number;
  /** LEARN_ANCHORS: re-score the frozen anchor scripts with the clarity judge weekly to catch drift (model calls). */
  anchors: boolean;
  /** LEARN_ANCHOR_COUNT: how many past scripts the frozen anchor set holds. */
  anchorCount: number;
  /** LEARN_BANDIT: Thompson sampling over the growth tests' factors at once. shadow: computes and records only. */
  bandit: LearnMode;
  /** LEARN_BANDIT_FLOOR: the least share any live arm keeps (0.15 = 15%), so no arm starves before its verdict. */
  banditFloor: number;
  /** LEARN_BANDIT_WIN_PROB: the bootstrap share a winner needs on the bandit's factors (0.975: 95% either way). */
  banditWinProb: number;
  /** LEARN_BANDIT_HALF_LIFE_DAYS: older Shorts count for less, halving every this many days. */
  banditHalfLifeDays: number;
  /** LEARN_PLAYBOOK: lessons as tracked items. shadow: curated and counted, never shown to a writer. */
  playbook: LearnMode;
  /** LEARN_PLAYBOOK_MAX: active lessons shown per scope. */
  playbookMax: number;
  /** LEARN_PLAYBOOK_STALE_DAYS: an active lesson nobody re-confirms in this long is retired. */
  playbookStaleDays: number;
  /** LEARN_HOOKS: breadth then selection for news hooks. shadow: candidates written and scored, the draft's hook kept. */
  hooks: LearnMode;
  /** LEARN_HOOK_CANDIDATES: hooks asked for in the one call (4 to 6). */
  hookCandidates: number;
  /** LEARN_HOOK_SAMENESS: the most a candidate may resemble any of the last 30 hooks (0-1 similarity). */
  hookSameness: number;
  /** LEARN_WEEKLY: a plain-English Discord summary of what the data says works, every week. */
  weekly: boolean;
  /** LEARN_WEEKLY_DAY: the UK weekday it goes out (0 Sunday to 6 Saturday; 1 Monday). */
  weeklyDay: number;
}

const num = (
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n)
    ? Math.min(max, Math.max(min, n))
    : fallback;
};

const flag = (raw: string | undefined, fallback: boolean): boolean =>
  raw === undefined || raw.trim() === ""
    ? fallback
    : ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());

export function learnMode(raw: string | undefined): LearnMode {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (["on", "true", "1", "yes"].includes(v)) return "on";
  if (["shadow", "log", "report"].includes(v)) return "shadow";
  return "off";
}

const list = (raw: string | undefined, fallback: string[]): string[] =>
  raw === undefined || raw.trim() === ""
    ? fallback
    : raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

export function learnSettings(
  env: Record<string, string | undefined>,
): LearnSettings {
  return {
    stamps: flag(env.LEARN_STAMPS, false),
    holdoutShare: num(env.LEARN_HOLDOUT_SHARE, 0, 0, 0.2),
    holdoutLanes: list(env.LEARN_HOLDOUT_LANES, ["news", "news_breaking"]),
    holdoutRepinDays: Math.round(num(env.LEARN_HOLDOUT_REPIN_DAYS, 30, 0, 365)),
    judges: flag(env.LEARN_JUDGES, false),
    judgeMin: Math.round(num(env.LEARN_JUDGE_MIN, 40, 8, 10_000)),
    anchors: flag(env.LEARN_ANCHORS, false),
    anchorCount: Math.round(num(env.LEARN_ANCHOR_COUNT, 30, 5, 100)),
    bandit: learnMode(env.LEARN_BANDIT),
    banditFloor: num(env.LEARN_BANDIT_FLOOR, 0.15, 0.05, 0.5),
    banditWinProb: num(env.LEARN_BANDIT_WIN_PROB, 0.975, 0.9, 0.999),
    banditHalfLifeDays: num(env.LEARN_BANDIT_HALF_LIFE_DAYS, 21, 3, 365),
    playbook: learnMode(env.LEARN_PLAYBOOK),
    playbookMax: Math.round(num(env.LEARN_PLAYBOOK_MAX, 25, 3, 60)),
    playbookStaleDays: Math.round(
      num(env.LEARN_PLAYBOOK_STALE_DAYS, 28, 7, 365),
    ),
    hooks: learnMode(env.LEARN_HOOKS),
    hookCandidates: Math.round(num(env.LEARN_HOOK_CANDIDATES, 5, 4, 6)),
    hookSameness: num(env.LEARN_HOOK_SAMENESS, 0.6, 0.2, 1),
    weekly: flag(env.LEARN_WEEKLY, false),
    weeklyDay: Math.round(num(env.LEARN_WEEKLY_DAY, 1, 0, 6)),
  };
}

/** Whether any part of the learning core is on (the tick does nothing at all otherwise). */
export function learnAny(s: LearnSettings): boolean {
  return (
    s.stamps ||
    s.holdoutShare > 0 ||
    s.judges ||
    s.anchors ||
    s.bandit !== "off" ||
    s.playbook !== "off" ||
    s.hooks !== "off" ||
    s.weekly
  );
}

export function learnSummary(s: LearnSettings): string {
  if (!learnAny(s)) return "off";
  const parts: string[] = [];
  if (s.stamps) parts.push("stamps and change ledger");
  if (s.holdoutShare > 0)
    parts.push(
      `${Math.round(s.holdoutShare * 100)}% holdout on ${s.holdoutLanes.join("/")}`,
    );
  if (s.judges)
    parts.push(`judge ledger (statements from ${s.judgeMin} Shorts)`);
  if (s.anchors) parts.push(`${s.anchorCount} anchors re-scored weekly`);
  if (s.bandit !== "off")
    parts.push(
      `bandit ${s.bandit} (floor ${Math.round(s.banditFloor * 100)}%)`,
    );
  if (s.playbook !== "off")
    parts.push(`playbook ${s.playbook} (max ${s.playbookMax})`);
  if (s.hooks !== "off")
    parts.push(`hooks ${s.hooks} (${s.hookCandidates} candidates)`);
  if (s.weekly) parts.push("weekly summary");
  return parts.join(", ");
}
