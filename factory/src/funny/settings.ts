// The settings of funny Shorts and meme posts (owner, 14 Nov 2026: "Should we create memes, funny videos, shareable
// viral content too?" Yes, from the owner's own footage only, judged on subscribers per 1,000 views). Read in one place
// (pure: the environment is passed in). Both are off by default.

export interface FunnySettings {
  /** FUNNY_SHORTS: one "funny moments" Short a day from the owner's own streams, in the late gameplay slot. */
  shorts: boolean;
  /** FUNNY_START: the first day (local YYYY-MM-DD) a funny Short may go out: GTA VI's launch day. */
  start: string;
  /** FUNNY_SLOT: the slot it takes, local "HH:MM". Must be one of GAMEPLAY_SLOTS and not GTA_DAILY_SLOT, so no volume is added. */
  slot: string;
  /** FUNNY_MIN_SCORE: the combined score a moment needs (signals plus the vision check, roughly 0-10). */
  minScore: number;
  /** FUNNY_VISION: ask the PC's local vision relay how funny the payoff looks. Never the paid API. */
  vision: boolean;
  /** FUNNY_VISION_MIN: the relay's comedy rating (0-10) a moment needs when the relay answered. */
  visionMin: number;
  /** FUNNY_CANDIDATES: how many signal-ranked moments per stream go on to the HUD reader and the vision check. */
  candidates: number;
  /** FUNNY_HUD: read the HUD around each candidate (Wasted, Busted, wanted jumps, flight) when HUD_READER is on. */
  hud: boolean;
  /** FUNNY_NARRATION: none (the owner's reaction carries it, default) or line (one short spoken line after the replay). */
  narration: "none" | "line";
  /** MEME_POSTS: one meme image a week from the owner's own frames, queued for the community post, Instagram and X. */
  memes: boolean;
  /** MEME_DAY: the weekday the meme is made (mon-sun). */
  memeDay: string;
  /** MEME_HOUR: the local hour from which it is made. */
  memeHour: number;
}

const bool = (
  env: Record<string, string | undefined>,
  name: string,
  fallback: boolean,
) => {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};

const num = (
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  lo: number,
  hi: number,
) => {
  const raw = env[name];
  const n = Number(raw);
  return raw === undefined || raw === "" || !Number.isFinite(n)
    ? fallback
    : Math.min(hi, Math.max(lo, n));
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function funnySettings(
  env: Record<string, string | undefined>,
): FunnySettings {
  const day = (env.MEME_DAY || "fri").toLowerCase().slice(0, 3);
  const start = (env.FUNNY_START || "2026-11-19").trim();
  const slot = (env.FUNNY_SLOT || "23:30").trim();
  return {
    shorts: bool(env, "FUNNY_SHORTS", false),
    start: /^\d{4}-\d\d-\d\d$/.test(start) ? start : "2026-11-19",
    slot: /^\d\d:\d\d$/.test(slot) ? slot : "23:30",
    minScore: num(env, "FUNNY_MIN_SCORE", 4, 0, 20),
    vision: bool(env, "FUNNY_VISION", true),
    visionMin: num(env, "FUNNY_VISION_MIN", 7, 0, 10),
    candidates: Math.round(num(env, "FUNNY_CANDIDATES", 20, 3, 60)),
    hud: bool(env, "FUNNY_HUD", true),
    narration: env.FUNNY_NARRATION === "line" ? "line" : "none",
    memes: bool(env, "MEME_POSTS", false),
    memeDay: DAYS.includes(day) ? day : "fri",
    memeHour: Math.round(num(env, "MEME_HOUR", 12, 0, 23)),
  };
}

/** Why funny Shorts cannot run although switched on; undefined when they can or are off (pure). */
export function funnyProblem(
  s: Pick<FunnySettings, "shorts" | "slot">,
  cfg: {
    gameplayEnabled: boolean;
    gameplaySlots: string[];
    gtaDaily: boolean;
    gtaDailySlot: string;
  },
): string | undefined {
  if (!s.shorts) return undefined;
  if (!cfg.gameplayEnabled)
    return "GAMEPLAY_ENABLED is off, and funny Shorts go through the gameplay lane";
  if (!cfg.gameplaySlots.includes(s.slot))
    return `FUNNY_SLOT ${s.slot} is not one of GAMEPLAY_SLOTS (${cfg.gameplaySlots.join(",")}), and funny Shorts never add a slot`;
  if (cfg.gtaDaily && cfg.gtaDailySlot.trim() === s.slot)
    return `FUNNY_SLOT ${s.slot} is GTA_DAILY_SLOT: GTA 6 Day N owns that slot`;
  return undefined;
}

/** One line for the boot summary. */
export function funnySummary(s: FunnySettings): string {
  const parts: string[] = [];
  if (s.shorts)
    parts.push(
      `funny Shorts from ${s.start} at ${s.slot} (min score ${s.minScore}${s.vision ? `, local vision >= ${s.visionMin}` : ", no vision"}${s.narration === "none" ? ", no narration" : ", one line"})`,
    );
  if (s.memes)
    parts.push(
      `a meme every ${s.memeDay} from ${String(s.memeHour).padStart(2, "0")}:00 (queued for the owner to post)`,
    );
  return parts.length ? parts.join("; ") : "off";
}
