// XP and levels for the community Discord. The curve is the familiar one (each level needs
// 5L² + 50L + 100 more XP), so level 5 takes a few days of chatting and level 35 is a real badge.

/** Level roles, lowest first: earned at these levels and kept as you climb (only the highest is held). */
export const LEVEL_ROLES: ReadonlyArray<readonly [number, string]> = [
  [5, "Regular"],
  [10, "Insider"],
  [20, "OG"],
  [35, "Legend"],
];

export const MESSAGE_XP = { min: 15, max: 25, cooldownMs: 60_000 } as const;
export const VOICE_XP = 10; // every five minutes in voice with someone else
export const DAILY_XP = { base: 100, perStreakDay: 10, maxBonus: 100 } as const;

/** XP needed to go from level `level` to the next one. */
export const xpToNext = (level: number) => 5 * level * level + 50 * level + 100;

/** Total XP at which `level` starts. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNext(l);
  return total;
}

/** The level for a total, and how far into it. */
export function levelOf(xp: number): {
  level: number;
  into: number;
  need: number;
} {
  let level = 0;
  let left = Math.max(0, Math.floor(xp));
  while (left >= xpToNext(level)) left -= xpToNext(level++);
  return { level, into: left, need: xpToNext(level) };
}

/** The level role this level earns, if any. */
export function roleFor(level: number): string | undefined {
  let name: string | undefined;
  for (const [at, role] of LEVEL_ROLES) if (level >= at) name = role;
  return name;
}

/** The next level role and the level it comes at. */
export function nextRole(
  level: number,
): { at: number; role: string } | undefined {
  const next = LEVEL_ROLES.find(([at]) => at > level);
  return next ? { at: next[0], role: next[1] } : undefined;
}

/** A text progress bar, e.g. ▰▰▰▱▱▱▱▱▱▱. */
export function bar(into: number, need: number, width = 12): string {
  const filled =
    need > 0
      ? Math.max(0, Math.min(width, Math.round((into / need) * width)))
      : 0;
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

/** UTC calendar day, YYYY-MM-DD. */
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Claiming /daily: whether it is allowed today, the new streak and the XP it pays. */
export function claimDaily(
  last: string | undefined,
  streak: number,
  now: Date,
): { ok: false; next: Date } | { ok: true; streak: number; xp: number } {
  const today = dayOf(now);
  if (last === today) {
    const next = new Date(`${today}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return { ok: false, next };
  }
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const s = last === dayOf(yesterday) ? streak + 1 : 1;
  const xp =
    DAILY_XP.base +
    Math.min(DAILY_XP.maxBonus, (s - 1) * DAILY_XP.perStreakDay);
  return { ok: true, streak: s, xp };
}

/** Compact counts for channel names: 950, 1.2K, 12K, 1.3M. */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
