// The canary after a deploy, from the PC (mac/deploy.sh runs it when DEPLOY_CANARY_MINUTES is set; off by default).
//   node --import tsx src/tools/canary.ts --minutes 20 --release <new> --good <old> --since <ISO deploy time>
//   --host pulse-mac      the Mac (PULSE_DEPLOY_HOST)
//   --every 60            seconds between looks
//   --no-rollback         judge and report only
// Looks at the Mac once a minute (/health, data/admin/release, today's error lines), judges against the hour before
// the deploy (src/canary.ts), and on a regression waits for a quiet moment (up to ten minutes), runs
// mac/rollback.sh release and tells the owner's Discord in plain English. Nothing secret is printed: the webhook is
// read on the Mac and used there. Exit 0 healthy, 3 rolled back, 4 regressed and the rollback failed, 2 bad arguments.

import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  countErrorLines,
  errorsPerMinuteBefore,
  judgeCanary,
  rollbackMessage,
  type CanaryBaseline,
  type CanarySample,
} from "../canary.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const host = arg("host") ?? process.env.PULSE_DEPLOY_HOST ?? "pulse-mac";
const ROOT = "$HOME/PulseFactory/factory";
const here = path.dirname(fileURLToPath(import.meta.url));
const factoryDir = path.resolve(here, "..", "..");

function onMac(cmd: string, input?: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, `export PATH=/opt/homebrew/bin:$PATH; ${cmd}`],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => (err && !stdout ? reject(err) : resolve(stdout)),
    );
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

/** The Mac's error lines for today (its local date), only the error lines, so little crosses the wire. */
async function errorLog(): Promise<string> {
  return onMac(`grep -h '"level":"error"' ${ROOT}/data/logs/factory-$(date +%Y-%m-%d).log 2>/dev/null; true`).catch(() => "");
}

async function sample(since: Date): Promise<CanarySample> {
  const at = new Date().toISOString();
  const raw = await onMac(
    `curl -s -m 10 http://127.0.0.1:\${PULSE_PORT:-8080}/health; echo; echo "@@release $(cat ${ROOT}/data/admin/release 2>/dev/null)"`,
  ).catch(() => "");
  let health: CanarySample["health"];
  try {
    const first = raw.split("\n")[0] ?? "";
    health = first.trim().startsWith("{") ? (JSON.parse(first) as CanarySample["health"]) : undefined;
  } catch {
    health = undefined;
  }
  const release = raw.match(RELEASE_LINE)?.[1]?.trim() || undefined;
  const log = await errorLog();
  const after = log.split("\n").filter((l) => Date.parse(l.match(LINE_TIME)?.[1] ?? "") > since.getTime());
  return {
    at,
    health,
    errorLines: countErrorLines(log),
    recentErrors: after.slice(-3).map((l) => l.match(MSG)?.[1] ?? l.slice(0, 120)),
    release,
  };
}
const RELEASE_LINE = /@@release (.*)/;
const LINE_TIME = /"t":"([^"]+)"/;
const MSG = /"msg":"([^"]+)"/;

async function quiet(): Promise<boolean> {
  const out = await onMac(
    `pgrep -f "[r]emotion|[c]hrome-headless-shell" >/dev/null && echo busy; curl -s -m 10 http://127.0.0.1:\${PULSE_PORT:-8080}/health | grep -q '"uploads_active":[1-9]' && echo busy; true`,
  ).catch(() => "");
  return !out.includes("busy");
}

async function notify(content: string): Promise<void> {
  // The webhook stays on the Mac: read from its .env there and used there.
  await onMac(
    `cd ${ROOT} && url=$(grep -m1 '^DISCORD_WEBHOOK_URL=' .env | cut -d= -f2-) && [ -n "$url" ] && curl -s -m 15 -o /dev/null -H 'content-type: application/json' --data-binary @- "$url"; true`,
    JSON.stringify({ content }),
  ).catch(() => undefined);
}

function rollback(bad: string, good: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["mac/rollback.sh", "release", bad, good], { cwd: factoryDir, stdio: "inherit" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function main(): Promise<number> {
  const minutes = Number(arg("minutes") ?? 0);
  const release = arg("release") ?? "";
  const good = arg("good") ?? "";
  const since = new Date(arg("since") ?? "");
  const every = Number(arg("every") ?? 60) * 1000;
  const tickMinutes = Number(arg("tick-minutes") ?? 10);
  if (!(minutes > 0) || !release || Number.isNaN(since.getTime())) {
    console.error("canary: --minutes N --release <commit> --good <commit> --since <ISO> are needed");
    return 2;
  }
  const before = await errorLog();
  const baseline: CanaryBaseline = {
    errorsPerMinute: errorsPerMinuteBefore(before, since),
    errorLinesAtDeploy: before.split("\n").filter((l) => {
      const t = Date.parse(l.match(LINE_TIME)?.[1] ?? "");
      return Number.isFinite(t) && t <= since.getTime();
    }).length,
    tickMinutes,
  };
  console.log(
    `canary: watching ${release.slice(0, 9)} for ${minutes} minutes (before it: ${baseline.errorsPerMinute.toFixed(2)} errors a minute)`,
  );
  const samples: CanarySample[] = [];
  const end = Date.now() + minutes * 60_000;
  for (;;) {
    samples.push(await sample(since));
    const done = Date.now() >= end;
    const v = judgeCanary(baseline, samples, since, release, done);
    const last = samples[samples.length - 1]!;
    console.log(
      `  ${last.at.slice(11, 19)} health ${last.health?.ok ? "ok" : "no answer"}, errors since deploy ${Math.max(0, last.errorLines - baseline.errorLinesAtDeploy)}, ${v.verdict}`,
    );
    if (v.verdict === "regressed") {
      console.log(`canary: regression: ${v.reasons.join("; ")}`);
      if (process.argv.includes("--no-rollback") || !good) {
        await notify(`⚠️ Pulse Factory (Mac): the update ${release.slice(0, 9)} looks worse than before (${v.reasons.join("; ")}). Not rolled back automatically.`);
        return 4;
      }
      // A code switch under a render or upload loses it: wait for a quiet moment, ten minutes at most.
      for (let i = 0; i < 10 && !(await quiet()); i++) await new Promise((r) => setTimeout(r, 60_000));
      const ok = await rollback(release, good);
      await notify(rollbackMessage(release, good, v.reasons, ok));
      return ok ? 3 : 4;
    }
    if (done) {
      console.log(`canary: ${release.slice(0, 9)} healthy for ${minutes} minutes`);
      return 0;
    }
    await new Promise((r) => setTimeout(r, every));
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
