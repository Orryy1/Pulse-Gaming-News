// The weekly "which series should we rank next?" poll. Every fast-growing channel in our research runs
// one: it turns viewers into regulars and hands the ranking a topic people already want. YouTube has no
// API for community posts, so a scheduled Studio session posts the poll and reads its result; the
// factory plans the options and keeps the result, which steers the next long ranking's topic.
import type { Db } from "../db.ts";
import type { Config } from "../config.ts";
import type { EvergreenCandidate } from "../editorial/evergreen.ts";
import { readRequests } from "./requests.ts";

const KEY = "poll_result";

export interface PollResult {
  at: string;
  options: Array<{ name: string; percent: number }>;
}

/** Four series for this week's poll: what viewers asked for, then the channel focus, then the topic seeds; never one ranked lately. */
export async function pollPlan(
  db: Db,
  cfg: Config,
  candidates: EvergreenCandidate[],
  now: Date,
): Promise<{ question: string; options: string[] }> {
  const covered = (
    await db.query<{ headline: string }>(
      `SELECT coalesce(script_json->>'game_title', story_json->>'gameHint', story_json->>'headline') AS headline
         FROM episodes WHERE lane = 'longform' AND status NOT IN ('failed','rejected') AND created_at > $1::timestamptz - interval '180 days'`,
      [now],
    )
  ).map((r) => r.headline.toLowerCase());
  const fresh = (name: string) =>
    !covered.some(
      (c) => c.includes(name.toLowerCase()) || name.toLowerCase().includes(c),
    );
  const options: string[] = [];
  const add = (name: string) => {
    const n = name.trim().replace(/\s+/g, " ").slice(0, 30);
    if (
      n &&
      fresh(n) &&
      !options.some((o) => o.toLowerCase() === n.toLowerCase())
    )
      options.push(n);
  };
  for (const r of (await readRequests(db))?.requests ?? [])
    if (options.length < 4) add(r.name);
  if (cfg.focusTopic && options.length < 4) add(cfg.focusTopic);
  for (const c of candidates)
    if (options.length < 4 && c.source !== "steam top sellers") add(c.name);
  for (const c of candidates) if (options.length < 4) add(c.name);
  return {
    question:
      "Which series should we rank next? The winner gets the full worst-to-best treatment.",
    options: options.slice(0, 4),
  };
}

/** Keeps a finished poll's result (percentages as YouTube shows them). */
export async function recordPollResult(
  db: Db,
  result: PollResult,
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(result)],
  );
}

export async function readPoll(db: Db): Promise<PollResult | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [KEY],
  );
  try {
    return row ? (JSON.parse(row.value) as PollResult) : undefined;
  } catch {
    return undefined;
  }
}

/** The line the ranking topic pickers read: the latest poll's winner, for two weeks. */
export function pollBlock(r: PollResult | undefined, now: Date): string {
  if (
    !r?.options.length ||
    now.getTime() - new Date(r.at).getTime() > 14 * 86_400_000
  )
    return "";
  const sorted = [...r.options].sort((a, b) => b.percent - a.percent);
  return `Our viewers voted on what to rank next: ${sorted.map((o) => `${o.name} ${o.percent}%`).join(", ")}. Pick the winner for the next long ranking unless it is impossible to rank well.`;
}
