// The alert ledger (owner, 4 Nov 2026: every automated alert must feed improvement, not sit unread). Everything the
// factory posts to the alerts channel also goes as one line to data/logs/alerts.jsonl: when, which video if known, a
// normalised kind and the text. src/alertdigest.ts reads it. The write is fire and forget, in order, and can never stop
// or delay the post or the pipeline; a full disk costs a log line. ALERT_LEDGER turns it on.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import type { DiscordMessage } from "./approval/discord.ts";
import { errorMessage, log } from "./lib/util.ts";

export interface AlertRecord {
  t: string;
  episode?: string;
  title?: string;
  kind: string;
  text: string;
}

/** Messages that report something went as planned: kept in the ledger, left out of the digest. */
export const ROUTINE = "routine";
/** Anything the rules below do not know: counted in the digest, but it never makes the digest post. */
export const OTHER = "other";

/** The first match wins, so the specific shapes come first. The wordings are the factory's own notices. */
const KINDS: ReadonlyArray<readonly [string, RegExp]> = [
  [ROUTINE, /^📋 Alert digest/u],
  ["narration_fault", /still has a fault after a second take/i],
  ["voice_breaths", /sounds off[^]*audible breaths/i],
  ["voice_pace", /sounds off[^]*words a minute/i],
  ["graphics_muted", /graphics check looked at [^]* and muted /i],
  ["video_faulted", /check of the finished video faulted/i],
  ["short_of_pictures", /short of pictures/i],
  [
    "sentence_matching",
    /of its (?:sentences|narration) ha(?:s|ve) something chosen[^]*under the \d+% target/i,
  ],
  ["no_beats", /writer marked no beats/i],
  ["boot_check", /boot check/i],
  ["mac_fallback", /Mac mini: [^]*running on the PC instead/i],
  ["upload_refused", /YouTube refused an upload/i],
  ["gave_up", /Gave up on "/i],
  ["crosspost_failed", /Could not post "|may or may not have posted/i],
  ["backup_failed", /backup failed/i],
  ["no_short", /No Short published/i],
  ["big_story_missed", /^Biggest stories today:[^]*missed because/i],
  ["claude_credit", /^Claude credit:/i],
  ["gate_unchecked", /release gate could not check/i],
  ["gather_cut", /media gather stopped/i],
  ["long_lane_stuck", /long-video lane has not finished/i],
  ["reach_warning", /Reach warning/i],
  ["still_private", /still private after its scheduled time/i],
  ["red_rubric", /renders with a red rubric/i],
  ["dropped", /🛑 Dropped/u],
  ["expired", /expired after \d+h without approval/i],
  ["held_up", /was held up/i],
  [
    ROUTINE,
    /^✅ (?:Uploaded|Live now)|^Biggest stories today:|^Big story picked|passed the release gate|found nothing wrong|^Breaking story picked|^Demand check|Taking off:|DRY_RUN:/iu,
  ],
];

/** The normalised kind of an alert's text (pure). */
export function alertKind(text: string): string {
  for (const [kind, rule] of KINDS) if (rule.test(text)) return kind;
  return OTHER;
}

/** The words of a Discord message: its content, then each embed's title and description (pure). */
export function alertText(msg: DiscordMessage): string {
  const parts = [msg.content ?? ""];
  for (const e of msg.embeds ?? [])
    for (const f of [e.title, e.description])
      if (typeof f === "string") parts.push(f);
  return parts.filter(Boolean).join("\n").slice(0, 2000);
}

/** A video's title as the notices quote it, near the start of the text (pure). */
function quotedTitle(text: string): string | undefined {
  return /^[^"]{0,60}"([^"]{3,200})"/.exec(text)?.[1];
}

export interface AlertScope {
  episode?: string;
  title?: string;
}

const scope = new AsyncLocalStorage<AlertScope>();

/** Everything `fn` posts, however deep, is filed under this video: the notices themselves rarely carry its id. */
export function withAlertScope<T>(s: AlertScope, fn: () => T): T {
  return scope.run(s, fn);
}

/** One ledger line for a message (pure but for the current scope). */
export function alertRecord(msg: DiscordMessage, now: Date): AlertRecord {
  const text = alertText(msg);
  const here = scope.getStore();
  const title = here?.title ?? quotedTitle(text);
  return {
    t: now.toISOString(),
    ...(here?.episode ? { episode: here.episode } : {}),
    ...(title ? { title } : {}),
    kind: alertKind(text),
    text,
  };
}

let ledger: { file: string; webhook: string } | undefined;
let tail: Promise<void> = Promise.resolve();

/** Posts to this webhook (the alerts channel; the TikTok drafts channel has its own) go in the ledger from now on. */
export function startAlertLedger(file: string, webhook: string): void {
  ledger = { file, webhook };
}

export function stopAlertLedger(): void {
  ledger = undefined;
}

/** Resolves once every line noted so far is written or given up on (tests, and nothing else, wait for this). */
export const alertLedgerFlushed = (): Promise<void> => tail;

/** Called for every post, before it is sent. It returns at once and it cannot throw. */
export function noteAlert(webhook: string, msg: DiscordMessage): void {
  const open = ledger;
  if (!open || webhook !== open.webhook) return;
  try {
    const line = `${JSON.stringify(alertRecord(msg, new Date()))}\n`;
    tail = tail
      .then(async () => {
        await fs.mkdir(path.dirname(open.file), { recursive: true });
        await fs.appendFile(open.file, line, "utf8");
      })
      .catch((err) =>
        log("warn", "alert ledger write failed", {
          error: errorMessage(err),
        }),
      );
  } catch (err) {
    log("warn", "alert ledger line failed", { error: errorMessage(err) });
  }
}

/** The ledger's lines, oldest first; a torn or foreign line is skipped, a missing file is no alerts. */
export async function readAlerts(file: string): Promise<AlertRecord[]> {
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  const out: AlertRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as AlertRecord;
      if (typeof r.t === "string" && typeof r.kind === "string") out.push(r);
    } catch {
      // A line cut short by a crash says nothing.
    }
  }
  return out;
}
