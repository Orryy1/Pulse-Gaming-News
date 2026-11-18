// The settings of the Packaging Lab (PACKAGING_LAB, 14 Nov 2026), read in one place (pure: the environment is passed
// in). Off by default: with PACKAGING_LAB unset nothing is scored, nothing is picked and no live video is touched.
//   off      nothing at all
//   score    every new video's title, hook words and thumbnails are scored and the scores logged; nothing changes
//   pick     as score, and the best-scoring candidate that passes the clarity check becomes the title, the hook words
//            and the main thumbnail before upload (the others stay in the Test & compare queue as before)
//   retitle  as pick, and an under-performing public video gets one second chance 48 to 72 hours in: the next-best
//            title or thumbnail, logged and judged three days later. Never its privacy, never twice, never a video
//            the owner changed by hand or one that a Studio Test & compare is running on.

export type PackagingMode = "off" | "score" | "pick" | "retitle";

export interface PackagingSettings {
  mode: PackagingMode;
  /** PACKAGING_SECOND_CHANCE_MIN_HOURS / _MAX_HOURS: the window after going public in which a second chance is judged. */
  minHours: number;
  maxHours: number;
  /** PACKAGING_UNDER_PERCENTILE: a video is under-performing below this percentile of its format's recent videos at the same age. */
  underPercentile: number;
  /** PACKAGING_MIN_LIFT: the next-best candidate must score at least this much higher (model units) than the live packaging. */
  minLift: number;
  /** PACKAGING_DAILY_CAP: the most second chances applied in one day across the channel. */
  dailyCap: number;
  /** PACKAGING_CANDIDATES: how many title candidates are built for each video. */
  candidates: number;
}

const num = (
  raw: string | undefined,
  fallback: number,
  min: number,
  max = Infinity,
): number => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n)
    ? Math.min(max, Math.max(min, n))
    : fallback;
};

export function packagingMode(raw: string | undefined): PackagingMode {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "score" || v === "pick" || v === "retitle" ? v : "off";
}

export function packagingSettings(
  env: Record<string, string | undefined>,
): PackagingSettings {
  return {
    mode: packagingMode(env.PACKAGING_LAB),
    minHours: num(env.PACKAGING_SECOND_CHANCE_MIN_HOURS, 48, 24, 168),
    maxHours: num(env.PACKAGING_SECOND_CHANCE_MAX_HOURS, 72, 25, 240),
    underPercentile: num(env.PACKAGING_UNDER_PERCENTILE, 0.35, 0.05, 0.9),
    minLift: num(env.PACKAGING_MIN_LIFT, 0.15, 0, 5),
    dailyCap: Math.round(num(env.PACKAGING_DAILY_CAP, 2, 0, 20)),
    candidates: Math.round(num(env.PACKAGING_CANDIDATES, 24, 4, 80)),
  };
}

/** Each stage includes the ones before it. */
export const packagingAtLeast = (
  s: Pick<PackagingSettings, "mode">,
  want: PackagingMode,
): boolean => {
  const order: PackagingMode[] = ["off", "score", "pick", "retitle"];
  return order.indexOf(s.mode) >= order.indexOf(want) && want !== "off";
};

export function packagingSummary(s: PackagingSettings): string {
  if (s.mode === "off") return "off";
  const base = `${s.mode}: ${s.candidates} title candidates a video`;
  return s.mode === "retitle"
    ? `${base}; second chance ${s.minHours}-${s.maxHours} h in below the ${Math.round(s.underPercentile * 100)}th percentile, lift >= ${s.minLift}, at most ${s.dailyCap} a day`
    : base;
}
