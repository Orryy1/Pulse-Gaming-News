// An early warning that ElevenLabs is running out (owner, 4 Nov 2026). The free Liam voice is off on the Mac, so
// when the balance is gone nothing can voice a script and slots start to fail. One message a day while it is low,
// early enough to top up: under ELEVENLABS_LOW_CREDITS left, or under ELEVENLABS_LOW_DAYS of the current pace with
// the reset further away than that. Either setting at 0 turns that half off.
import fs from "node:fs";
import path from "node:path";
import type { CreditPlan } from "./credits.ts";

export interface CreditAlertSettings {
  lowCredits: number;
  lowDays: number;
  /** The voice step keeps this much back, so it does not count as usable. */
  reserve: number;
}

/** The warning due today, or undefined (pure). */
export function creditWarning(
  plan: CreditPlan,
  o: CreditAlertSettings,
): string | undefined {
  const usable = Math.max(0, plan.left - o.reserve);
  const daysOfPace = plan.pacePerDay > 0 ? usable / plan.pacePerDay : Infinity;
  const fewCredits = o.lowCredits > 0 && usable < o.lowCredits;
  const fewDays =
    o.lowDays > 0 && daysOfPace < o.lowDays && plan.daysLeft > daysOfPace;
  if (!fewCredits && !fewDays) return undefined;
  const pace = Number.isFinite(daysOfPace)
    ? `about ${Math.max(0, Math.floor(daysOfPace))} days at the current pace, `
    : "";
  return `⚠️ ElevenLabs is running low: ${usable.toLocaleString("en-US")} credits usable, ${pace}and the balance resets ${plan.resetAt.toISOString().slice(0, 10)}. There is no backup voice switched on, so when these run out scripts cannot be voiced and slots will fail. A top-up or a bigger plan before then keeps videos going.`;
}

/** The warning once a day: the state file remembers the last day it went out. Never throws on a bad file. */
export function creditAlertDue(
  plan: CreditPlan | undefined,
  o: CreditAlertSettings,
  file: string,
  today: string,
): string | undefined {
  if (!plan) return undefined;
  const text = creditWarning(plan, o);
  if (!text) return undefined;
  try {
    if (JSON.parse(fs.readFileSync(file, "utf8")).day === today)
      return undefined;
  } catch {
    /* no file yet */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ day: today, left: plan.left }));
  return text;
}
