// When does the Claude credit run out? (owner, 5 Nov 2026.) Auto-recharge is off, so when the month's credit is gone the
// API stops and script writing dies mid-slot. Every evening this adds up the month so far from data/usage/<day>.jsonl
// and, at the pace of the last week, works out the date the credit runs out. The first warning goes to the alerts
// channel when that date is under CLAUDE_CREDIT_WARN_DAYS away and before the credit renews; it repeats only when the
// date moves closer by a further step, so a steady month says it once. CLAUDE_MONTHLY_CREDIT holds the figure (0 = off).

import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { claudeSpend } from "./editorial/llm.ts";
import { log } from "./lib/util.ts";

/** How many recent days set the pace. */
const PACE_DAYS = 7;
const DAY_MS = 86_400_000;
const NOTICE_KEY = "claude_credit_notice";

export interface CreditForecast {
  /** Spent since the credit last renewed, in dollars. */
  spent: number;
  credit: number;
  left: number;
  /** Dollars a day, the recent average. */
  pace: number;
  /** The credit period's first day, YYYY-MM-DD. */
  periodStart: string;
  /** The day the credit renews. */
  renews: string;
  /** The day it runs out at this pace, when that is before it renews. */
  runsOut?: string;
  /** Whole days from today to `runsOut`. */
  daysLeft?: number;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The credit period holding `now`: from the last renewal day to the next, in UTC like the usage logs (pure). */
export function creditPeriod(
  now: Date,
  renewDay: number,
): { start: Date; renews: Date } {
  const day = Math.min(Math.max(renewDay, 1), 28);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = Date.UTC(y, m, day);
  const start =
    now.getTime() >= thisMonth ? thisMonth : Date.UTC(y, m - 1, day);
  const s = new Date(start);
  return {
    start: s,
    renews: new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, day)),
  };
}

/**
 * The forecast from each day's spend (pure). The pace is the last seven full days before today, so a half-finished
 * today does not understate it; early in a period with fewer full days, it uses what there is.
 */
export function forecastCredit(
  spendOn: (day: string) => number,
  now: Date,
  credit: number,
  renewDay: number,
): CreditForecast {
  const { start, renews } = creditPeriod(now, renewDay);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  let spent = 0;
  for (let t = start.getTime(); t <= today; t += DAY_MS)
    spent += spendOn(iso(new Date(t)));
  let recent = 0;
  let days = 0;
  for (let i = 1; i <= PACE_DAYS; i++) {
    const t = today - i * DAY_MS;
    // A day with no log at all (the factory down, or before it ran) says nothing about the pace.
    const v = spendOn(iso(new Date(t)));
    if (v <= 0) continue;
    recent += v;
    days++;
  }
  const pace = days ? recent / days : spendOn(iso(new Date(today)));
  const left = Math.max(0, credit - spent);
  const out: CreditForecast = {
    spent,
    credit,
    left,
    pace,
    periodStart: iso(start),
    renews: iso(renews),
  };
  if (pace <= 0) return out;
  const daysLeft = Math.floor(left / pace);
  const runsOut = today + daysLeft * DAY_MS;
  if (runsOut < renews.getTime())
    return { ...out, runsOut: iso(new Date(runsOut)), daysLeft };
  return out;
}

/** The alert (pure). */
export function creditLine(f: CreditForecast): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  return `Claude credit: ${money(f.spent)} of ${money(f.credit)} spent since ${f.periodStart}, about ${money(f.pace)} a day over the last week. At that pace it runs out on ${f.runsOut}, ${f.daysLeft} day${f.daysLeft === 1 ? "" : "s"} from now and before it renews on ${f.renews}. When it runs out the API stops and scripts stop being written. Add credit, turn auto-recharge on or cut the pace.`;
}

/** Warnings get closer together as the date nears: under the first limit, then under half of it, then the last two days. */
export function warnStep(daysLeft: number, warnDays: number): number {
  if (daysLeft >= warnDays) return 0;
  if (daysLeft <= 2) return 3;
  return daysLeft < warnDays / 2 ? 2 : 1;
}

/** Runs each evening. Posts only on the first warning of a credit period and when the date has moved a step closer. */
export async function creditForecastAlert(
  cfg: Pick<
    Config,
    | "claudeMonthlyCredit"
    | "claudeCreditRenewDay"
    | "claudeCreditWarnDays"
    | "dataDir"
  >,
  now: Date,
  db: Db,
  notify: (m: DiscordMessage) => Promise<unknown>,
  spendOn: (day: string) => number = (day) =>
    claudeSpend(cfg.dataDir, day).live,
): Promise<CreditForecast | undefined> {
  if (cfg.claudeMonthlyCredit <= 0) return undefined;
  const f = forecastCredit(
    spendOn,
    now,
    cfg.claudeMonthlyCredit,
    cfg.claudeCreditRenewDay,
  );
  log("info", "Claude credit forecast", {
    spent: Math.round(f.spent * 100) / 100,
    pace: Math.round(f.pace * 100) / 100,
    runsOut: f.runsOut ?? null,
  });
  if (f.daysLeft === undefined) return f;
  const step = warnStep(f.daysLeft, cfg.claudeCreditWarnDays);
  if (!step) return f;
  const key = `${f.periodStart}:${step}`;
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [NOTICE_KEY],
  );
  const [period, was] = (row?.value ?? "").split(":");
  if (period === f.periodStart && Number(was) >= step) return f;
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [NOTICE_KEY, key],
  );
  await notify({ content: creditLine(f), ping: true });
  return f;
}
