// The self-merge gate's rules (25 Nov 2026), pure and tested. Every finished helper branch used to wait for a chat to
// merge and deploy it; src/tools/merge-gate.ts now does it when all of these hold: the branch is a claude/* helper
// branch, a code-reviewer pass is recorded, the merge is clean, no file gained a backspace byte (0x08, a known
// corruption from shell edits), typecheck is clean, the full suite has no failure outside the known list, and the
// deploy happens outside the 30 minutes before any slot and never while the Mac renders or uploads.

/** The fixed UK slot list the old hourly watch used, kept as a floor under the factory's own plan. */
export const UK_SLOTS = [
  "12:00",
  "15:00",
  "16:30",
  "17:00",
  "18:30",
  "20:00",
  "21:00",
  "22:00",
  "23:30",
];

const PROTECTED = new Set(["claude/stage", "claude/epic-pasteur-7s143q"]);

/** Only claude/* helper branches, never the stage or live branch, nothing odd in the name (pure). */
export function branchAllowed(name: string): boolean {
  return (
    /^claude\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(name) &&
    !PROTECTED.has(name) &&
    !name.includes("..")
  );
}

export const REVIEW_MARK = /code-reviewer reviewed/i;

/** A code-reviewer pass is recorded in the branch's own commit messages or a REVIEW.md it carries (pure). */
export function reviewed(commitMessages: string, reviewMd?: string): boolean {
  return (
    REVIEW_MARK.test(commitMessages) ||
    (reviewMd !== undefined && REVIEW_MARK.test(reviewMd))
  );
}

export interface TapResult {
  pass: number;
  fail: number;
  /** Names of the failing top-level tests. */
  failures: string[];
  complete: boolean;
}

/** node --test's TAP output: the summary counts and the failing tests' names (pure). */
export function parseTap(text: string): TapResult {
  const pass = /^# pass (\d+)/m.exec(text);
  const fail = /^# fail (\d+)/m.exec(text);
  const failures: string[] = [];
  for (const m of text.matchAll(/^not ok \d+ - (.+?)\s*(#.*)?$/gm))
    failures.push(m[1]!.trim());
  return {
    pass: pass ? Number(pass[1]) : 0,
    fail: fail ? Number(fail[1]) : failures.length,
    failures: [...new Set(failures)],
    complete: Boolean(pass && fail),
  };
}

/** Failures not on the known list (one test name per line, # comments) (pure). */
export function unexpectedFailures(t: TapResult, knownList: string): string[] {
  const known = new Set(
    knownList
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
  if (t.fail > 0 && t.failures.length === 0)
    return [`${t.fail} failing test(s) with no name in the output`];
  return t.failures.filter((f) => !known.has(f));
}

/** Files that contain a backspace byte (pure over the files' contents). */
export function backspaceFiles(
  files: { name: string; data: Uint8Array }[],
): string[] {
  return files.filter((f) => f.data.includes(0x08)).map((f) => f.name);
}

/** "HH:MM" on a local day as an instant (pure). */
export function localInstant(
  day: string,
  hhmm: string,
  timeZone: string,
): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    h,
    m,
  );
  // The zone's offset at that moment, by formatting the guess there and comparing.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return new Date(guess - (shown - guess));
}

/** The fixed slots today and tomorrow as instants (pure). */
export function fixedSlots(now: Date, timeZone = "Europe/London"): Date[] {
  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const days = [day(now), day(new Date(now.getTime() + 86400_000))];
  return days.flatMap((d) => UK_SLOTS.map((s) => localInstant(d, s, timeZone)));
}

export interface WindowCheck {
  ok: boolean;
  why: string;
}

/**
 * Safe to deploy now (pure)? Not when a slot falls within the next `guardMin` minutes plus the time a deploy may take
 * (it waits up to DEPLOY_WAIT_MINUTES for a quiet moment, then restarts), not while the Mac renders, not while an
 * upload runs, not while the Mac's hold-restart flag is set.
 */
export function deployWindow(p: {
  now: Date;
  slots: readonly Date[];
  rendering: boolean;
  uploadsActive: number;
  holdRestart: boolean;
  /** DEPLOY_WAIT_LONG: the Mac's /health says a long video is being built (long_running). */
  longRunning?: boolean;
  longMinutes?: number;
  guardMin?: number;
  deployMin?: number;
}): WindowCheck {
  const guard = (p.guardMin ?? 30) + (p.deployMin ?? 20);
  const soon = p.slots
    .filter(
      (s) =>
        s.getTime() >= p.now.getTime() - 5 * 60_000 &&
        s.getTime() - p.now.getTime() <= guard * 60_000,
    )
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (soon)
    return {
      ok: false,
      why: `a slot at ${soon.toISOString()} is within ${guard} minutes`,
    };
  if (p.rendering) return { ok: false, why: "the Mac is rendering" };
  if (p.uploadsActive > 0)
    return { ok: false, why: `${p.uploadsActive} upload(s) running` };
  if (p.holdRestart)
    return { ok: false, why: "the Mac's hold-restart flag is set" };
  if (p.longRunning)
    return {
      ok: false,
      why: `a long video is being built on the Mac (${p.longMinutes ?? 0} min in)`,
    };
  return { ok: true, why: "clear" };
}

/** Files whose change means the Mac needs new packages: the gate leaves those for a session (pure). */
export function needsInstall(changed: readonly string[]): boolean {
  return changed.some((f) => /(^|\/)package(-lock)?\.json$/.test(f));
}

export type DeployOutcome =
  | { action: "retry-later"; why: string }
  | { action: "refused"; why: string }
  | { action: "canary-went-back" }
  | { action: "verify" };

/** What deploy.sh's exit means (pure): 2 refused before pushing (busy is worth retrying, anything else needs a fix),
 *  3 its canary went back by itself, otherwise check health on the new release. Only "verify" can lead to rollback. */
export function deployOutcome(code: number, out: string): DeployOutcome {
  if (code === 2)
    return /gave up: still busy/.test(out)
      ? { action: "retry-later", why: "the Mac stayed busy" }
      : { action: "refused", why: out.trim().split("\n").pop() ?? "deploy.sh refused" };
  if (code === 3) return { action: "canary-went-back" };
  return { action: "verify" };
}

/** Roll back only when the Mac really runs the new code, it is unhealthy, and there is an older release (pure). */
export function shouldRollBack(p: { healthy: boolean; running?: string; want: string; old?: string }): boolean {
  return !p.healthy && p.running === p.want && !!p.old && p.old !== p.want;
}
