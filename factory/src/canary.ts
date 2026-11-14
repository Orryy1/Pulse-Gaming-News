// The canary after a deploy (mac/deploy.sh with DEPLOY_CANARY_MINUTES, off by default; src/tools/canary.ts samples
// the Mac): for N minutes the new code is watched against the minutes before it went in. /health must keep
// answering, errors must not jump, and the ticks must keep moving. On a regression the deploy is rolled back to the
// previous code (mac/rollback.sh release) and the owner is told in plain English. Judging is pure, here.

/** One look at the Mac: /health's answer (undefined: it did not answer) and the error lines logged so far today. */
export interface CanarySample {
  at: string;
  health?: {
    ok?: boolean;
    lastTick?: string;
    lastLongTick?: string;
    uploads_active?: number;
  };
  /** Error lines in today's factory log at this moment (a running count). */
  errorLines: number;
  /** The newest error messages since the deploy, for the report. */
  recentErrors?: string[];
  /** What data/admin/release says the Mac runs. */
  release?: string;
}

export interface CanaryBaseline {
  /** Error lines a minute over the hour before the deploy. */
  errorsPerMinute: number;
  /** The error count in today's log when the deploy went in. */
  errorLinesAtDeploy: number;
  /** The tick minutes (TICK_MINUTES), for the progress rule. */
  tickMinutes: number;
}

export interface CanaryVerdict {
  verdict: "healthy" | "watching" | "regressed";
  reasons: string[];
}

/** Consecutive missed /health answers that count as down (a restart takes about a minute). */
export const HEALTH_MISSES = 4;
/** How much worse than before the error rate must be, and how many errors at least, before it is a regression. */
export const ERROR_FACTOR = 3;
export const ERROR_MIN = 6;

/**
 * The verdict so far (pure). `deployedAt` is when the new code went in; `done` says the watch is over, so a quiet
 * but healthy run becomes "healthy" rather than "watching".
 */
export function judgeCanary(
  baseline: CanaryBaseline,
  samples: readonly CanarySample[],
  deployedAt: Date,
  expectedRelease: string,
  done: boolean,
): CanaryVerdict {
  const reasons: string[] = [];
  if (!samples.length)
    return {
      verdict: done ? "regressed" : "watching",
      reasons: done ? ["no sample was taken"] : [],
    };
  const last = samples[samples.length - 1]!;
  // 1. /health stops answering, or says it is not ok, several looks in a row.
  let misses = 0;
  for (
    let i = samples.length - 1;
    i >= 0 && (!samples[i]!.health || samples[i]!.health!.ok === false);
    i--
  )
    misses++;
  if (misses >= HEALTH_MISSES)
    reasons.push(`/health has not answered ok for ${misses} looks in a row`);
  // 2. The release went back by itself (mac/run.sh: the new code died inside three minutes).
  if (last.release && expectedRelease && last.release !== expectedRelease)
    reasons.push(
      `the Mac is running ${last.release.slice(0, 9)}, not the new ${expectedRelease.slice(0, 9)}: it already rolled itself back`,
    );
  // 3. Errors: the rate since the deploy against the hour before it.
  const minutes = Math.max(
    1,
    (new Date(last.at).getTime() - deployedAt.getTime()) / 60_000,
  );
  const newErrors = Math.max(0, last.errorLines - baseline.errorLinesAtDeploy);
  const rate = newErrors / minutes;
  if (
    newErrors >= ERROR_MIN &&
    rate >
      Math.max(
        ERROR_FACTOR * baseline.errorsPerMinute,
        baseline.errorsPerMinute + 0.5,
      )
  )
    reasons.push(
      `${newErrors} errors in ${Math.round(minutes)} minutes (${rate.toFixed(1)} a minute, against ${baseline.errorsPerMinute.toFixed(2)} a minute before the deploy)`,
    );
  // 4. Progress: a Shorts tick must complete within two tick lengths and five minutes of the deploy.
  const due = baseline.tickMinutes * 2 + 5;
  if (minutes >= due) {
    const ticked = samples.some(
      (x) =>
        x.health?.lastTick &&
        new Date(x.health.lastTick).getTime() > deployedAt.getTime(),
    );
    if (!ticked)
      reasons.push(
        `no tick has completed in the ${Math.round(minutes)} minutes since the deploy (one is due every ${baseline.tickMinutes})`,
      );
  }
  if (reasons.length) return { verdict: "regressed", reasons };
  return { verdict: done ? "healthy" : "watching", reasons: [] };
}

/** Error lines in a log text (the factory logs one JSON object a line, level "error"). */
export function countErrorLines(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) if (ERROR_LINE.test(line)) n++;
  return n;
}
const ERROR_LINE = /"level":"error"/;

/** Errors a minute in the hour before `at`, from a log's lines with their own timestamps (pure). */
export function errorsPerMinuteBefore(
  text: string,
  at: Date,
  minutes = 60,
): number {
  const from = at.getTime() - minutes * 60_000;
  let n = 0;
  for (const line of text.split("\n")) {
    if (!ERROR_LINE.test(line)) continue;
    const t = Date.parse(line.match(LINE_TIME)?.[1] ?? "");
    if (t >= from && t <= at.getTime()) n++;
  }
  return n / minutes;
}
const LINE_TIME = /"t":"([^"]+)"/;

/** The owner's message when the canary rolled a deploy back (plain English). */
export function rollbackMessage(
  bad: string,
  good: string,
  reasons: readonly string[],
  rolledBack: boolean,
): string {
  return rolledBack
    ? `↩️ Pulse Factory (Mac): the update ${bad.slice(0, 9)} looked worse than the code before it, so I put the previous version (${good.slice(0, 9)}) back and it is running again. What I saw: ${reasons.join("; ")}. That update will not be deployed again; a fix goes on top of it.`
    : `⚠️ Pulse Factory (Mac): the update ${bad.slice(0, 9)} looks worse than the code before it (${reasons.join("; ")}), but going back did not work. Look at the Mac: ~/PulseFactory/factory/data/logs.`;
}
