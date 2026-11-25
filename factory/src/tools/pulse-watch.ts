// The Pulse hands-off watch (25 Nov 2026): replaces the hourly Claude watch with a script. Run every 15 minutes by
// the Windows task "Pulse watch" (windows/handsoff/register-pulse-watch.cmd). Each run gathers facts with no model
// (one ssh to the Mac mini, the PC orchestrator, the PC watchdog's files), turns them into faults
// (src/handsoff/pulsewatch.ts) and lets the gate (src/handsoff/gate.ts) decide. Only a fault that is new, or still
// there long after a fix session went to it, starts a headless `claude -p` session, at most HANDSOFF_MAX_PER_DAY a
// day. Every decision is a line in decisions.jsonl.
//
//   node --import tsx src/tools/pulse-watch.ts [--shadow|--live] [--dir D:\pulse-data\handsoff\pulse-watch]
//
// --shadow (the default until the switch-over): decides and logs what it would do (the prompt it would send is kept),
// launches nothing, writes nothing to the inbox and thins no snapshots. --live does all three.
// Environment: HANDSOFF_MODE=live|shadow, HANDSOFF_MAX_PER_DAY (6), HANDSOFF_MODEL (opus), CLAUDE_EXE,
// PULSE_FIX_CWD (where a fix session starts: C:\Users\MORR\gaming-studio\pulse-gaming).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_POLICY,
  alive,
  buildPrompt,
  decide,
  launchClaude,
  loadState,
  logDecision,
  saveState,
  stopIfOverdue,
  undoLaunch,
  writeInboxItem,
  type Fault,
} from "../handsoff/gate.ts";
import {
  allFaults,
  macFactsFrom,
  parseSections,
  type PcFacts,
  type SlotPlan,
  type StatusMemory,
} from "../handsoff/pulsewatch.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const factory = path.resolve(here, "../..");
const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = args.includes("--live")
  ? "live"
  : args.includes("--shadow")
    ? "shadow"
    : (process.env.HANDSOFF_MODE ?? "shadow");
const shadow = mode !== "live";
const dir =
  flag("dir") ??
  process.env.HANDSOFF_DIR ??
  "D:\\pulse-data\\handsoff\\pulse-watch";
// Shadow and live keep separate state, so faults met in shadow still get real sessions after the switch.
const stateFile = path.join(
  dir,
  shadow ? "state-shadow.json" : "state-live.json",
);
const logFile = path.join(dir, "decisions.jsonl");
const sessions = path.join(dir, "sessions");
const INBOX = path.join(os.homedir(), "Desktop", "Do when home");
const ORCH = "C:\\Claude\\orchestrator";
const PCA = "C:\\Claude\\analytics\\pc";
const CLAUDE_EXE =
  process.env.CLAUDE_EXE ??
  path.join(os.homedir(), ".local", "bin", "claude.exe");
const FIX_CWD =
  process.env.PULSE_FIX_CWD ?? "C:\\Users\\MORR\\gaming-studio\\pulse-gaming";
const policy = {
  ...DEFAULT_POLICY,
  maxLaunchesPerDay: Number(
    process.env.HANDSOFF_MAX_PER_DAY ?? DEFAULT_POLICY.maxLaunchesPerDay,
  ),
};
const MAX_RUN_MIN = 90;

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** One run at a time: a lock held by a live run is respected; one a crashed run left behind expires after 30 minutes. */
function lock(): boolean {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "run.lock");
  try {
    const st = fs.statSync(f);
    const holder = Number(fs.readFileSync(f, "utf8"));
    let held = false;
    try {
      if (holder) process.kill(holder, 0);
      held = Boolean(holder);
    } catch {
      held = false;
    }
    if (held && Date.now() - st.mtimeMs < 30 * 60_000) return false;
  } catch {
    /* no lock */
  }
  fs.writeFileSync(f, String(process.pid));
  return true;
}
function unlock(): void {
  fs.rmSync(path.join(dir, "run.lock"), { force: true });
}

function gatherMac(): ReturnType<typeof macFactsFrom> {
  const probe = fs
    .readFileSync(
      path.join(factory, "src", "handsoff", "pulse-mac-probe.sh"),
      "utf8",
    )
    .replace(/\r\n/g, "\n");
  const r = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "pulse-mac", "bash -s"],
    {
      input: probe,
      encoding: "utf8",
      timeout: 150_000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const facts = macFactsFrom(parseSections(r.stdout ?? ""));
  if (!facts.reachable)
    facts.error =
      `${r.error?.message ?? ""} exit ${r.status} ${(r.stderr ?? "").slice(0, 300)}`.trim();
  return facts;
}

function slotPlan(env: string): SlotPlan | undefined {
  if (!env.trim()) return undefined;
  const envFile = path.join(dir, "slotenv.env");
  fs.writeFileSync(envFile, env);
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", path.join("src", "tools", "slotplan.ts")],
    {
      cwd: factory,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        PULSE_ENV_FILE: envFile,
      },
    },
  );
  try {
    return JSON.parse(r.stdout) as SlotPlan;
  } catch {
    return undefined;
  }
}

function gatherPc(): PcFacts {
  const orch = spawnSync(
    "cmd",
    ["/c", path.join(ORCH, "orch.cmd"), "status", "--json"],
    { encoding: "utf8", timeout: 60_000, windowsHide: true },
  );
  const o = (() => {
    try {
      return JSON.parse(orch.stdout) as {
        leases?: PcFacts["leases"];
        waiting?: PcFacts["waiting"];
      };
    } catch {
      return {};
    }
  })();
  const text =
    spawnSync("cmd", ["/c", path.join(ORCH, "orch.cmd"), "status"], {
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    }).stdout ?? "";
  const codexLine = /^Codex:.*$/m.exec(text)?.[0] ?? "";
  const faults = readJson<{ at?: string; faults?: PcFacts["watchdogFaults"] }>(
    path.join(PCA, "faults.json"),
  );
  const loops = readJson<{
    tasks?: {
      taskId: string;
      runs?: { status: string; started_at: string; error?: string | null }[];
    }[];
  }>(path.join(PCA, "loop_runs.json"));
  const budget = readJson<{ weekly?: number }>(
    path.join(ORCH, "state", "claude_budget.json"),
  );
  return {
    leases: o.leases ?? [],
    waiting: o.waiting ?? [],
    watchdogFaults: faults?.faults ?? [],
    watchdogAt: faults?.at,
    budgetPct: typeof budget?.weekly === "number" ? budget.weekly : undefined,
    codexHold: /\bhold\b/i.test(codexLine)
      ? codexLine.replace(/^Codex:\s*/, "")
      : undefined,
    taskRuns: (loops?.tasks ?? [])
      .filter((t) => t.taskId.startsWith("pulse-") && t.runs?.length)
      .map((t) => ({ taskId: t.taskId, ...t.runs![0]! })),
    orchHistory: historyTail(path.join(ORCH, "state", "history.jsonl")),
  };
}

/** The orchestrator's last 200 finished jobs. */
function historyTail(file: string): NonNullable<PcFacts["orchHistory"]> {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    const len = Math.min(st.size, 200_000);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf
      .toString("utf8")
      .split("\n")
      .slice(-200)
      .flatMap((l) => {
        try {
          const x = JSON.parse(l) as NonNullable<
            PcFacts["orchHistory"]
          >[number];
          return typeof x.end === "number" ? [x] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  if (!lock()) {
    console.log("another watch run is still going");
    return;
  }
  const started = Date.now();
  try {
    const now = new Date();
    const prev = loadState(stateFile);
    const notes: string[] = [];
    // The last fix session: finished, or overdue (ours only, ended after MAX_RUN_MIN).
    let running = alive(prev.running);
    if (
      prev.running &&
      running &&
      stopIfOverdue(prev.running, now, MAX_RUN_MIN)
    ) {
      notes.push(
        `ended fix session ${prev.running.pid}: over ${MAX_RUN_MIN} min`,
      );
      running = false;
    }
    if (prev.running && !running) {
      notes.push(
        `fix session ${prev.running.pid} (${prev.running.keys.join(", ")}) finished`,
      );
      prev.running = undefined;
    }
    const mac = gatherMac();
    const plan = mac.reachable ? slotPlan(mac.slotEnv) : undefined;
    const pc = gatherPc();
    const memory = (prev.extra.status ?? {}) as StatusMemory;
    const found = allFaults(mac, pc, plan, memory, now);
    const faults: Fault[] = [...found.faults];
    if (mac.reachable && !plan)
      faults.push({
        key: "slot-plan",
        severity: "warn",
        what: "Could not work out the day's slot plan from the Mac's settings",
      });
    const d = decide(prev, faults, now, policy, {
      running,
      budgetPct: pc.budgetPct,
      shadow,
    });
    d.state.extra = { ...d.state.extra, status: found.memory };

    // Disk: thin Time Machine's local snapshots under 40 GB (owner's standing OK, 18 Nov). Nothing is deleted.
    if (found.thin) {
      if (shadow)
        notes.push(
          `would thin local snapshots (Mac at ${mac.diskFreeGb} GB free)`,
        );
      else {
        const r = spawnSync(
          "ssh",
          [
            "-o",
            "BatchMode=yes",
            "pulse-mac",
            "tmutil thinlocalsnapshots / 60000000000 4",
          ],
          { encoding: "utf8", timeout: 300_000, windowsHide: true },
        );
        notes.push(`thinned local snapshots (exit ${r.status})`);
      }
    }
    // Owner-only items: the inbox folder, once each.
    for (const f of d.inbox) {
      if (shadow) notes.push(`would write inbox item: ${f.what}`);
      else {
        const r = writeInboxItem(
          INBOX,
          "Pulse",
          f.what.replace(/^Factory alert:\s*/, ""),
          `${f.what}\n\n${f.detail ?? ""}\n\nThis needs you: the factory cannot do it for itself.`,
        );
        if (r.status === "nofolder") {
          // Not written: try again next run rather than losing it.
          const memo = d.state.faults[f.key];
          if (memo) memo.inboxed = undefined;
          notes.push(`inbox folder missing (${INBOX}): ${f.what}`);
        } else
          notes.push(
            r.status === "written"
              ? `inbox: ${path.basename(r.file)}`
              : `inbox item already there: ${f.what}`,
          );
      }
    }
    let pid: number | undefined;
    let promptFile: string | undefined;
    if (d.launch) {
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      fs.mkdirSync(sessions, { recursive: true });
      promptFile = path.join(sessions, `${stamp}.prompt.txt`);
      const chosen = faults.filter((f) => d.launchKeys.includes(f.key));
      const others = faults.filter(
        (f) =>
          !d.launchKeys.includes(f.key) &&
          (f.severity === "fault" || f.severity === "critical"),
      );
      const prompt = buildPrompt({
        project: "Pulse",
        faults: chosen,
        others,
        rules: fs.readFileSync(
          path.join(factory, "src", "handsoff", "pulse-fix-rules.md"),
          "utf8",
        ),
        inboxDir: INBOX,
        reportFile: path.join(sessions, `${stamp}.report.md`),
      });
      fs.writeFileSync(promptFile, prompt);
      if (!shadow) {
        try {
          const started = await launchClaude({
            exe: CLAUDE_EXE,
            promptFile,
            cwd: FIX_CWD,
            outFile: path.join(sessions, `${stamp}.out.txt`),
            model: process.env.HANDSOFF_MODEL ?? "opus",
            name: `Pulse fix: ${chosen[0]?.what.slice(0, 60) ?? "fault"}`,
          });
          pid = started.pid;
          d.state.running = {
            pid,
            start: started.start,
            at: now.toISOString(),
            keys: d.launchKeys,
          };
          const last = d.state.launches[d.state.launches.length - 1];
          if (last) last.pid = pid;
        } catch (err) {
          // It never started: the caps are not used up, and the next run tries again.
          d.state = undoLaunch(d.state, d.launchKeys, now.toISOString());
          notes.push(
            `could not start a fix session: ${(err as Error).message}`,
          );
        }
      }
    }
    saveState(stateFile, d.state);
    const entry = {
      at: now.toISOString(),
      mode,
      ms: Date.now() - started,
      launch: d.launch,
      wouldLaunch: shadow && d.launch,
      reason: d.reason,
      launchKeys: d.launchKeys,
      pid,
      prompt: promptFile,
      new: d.newKeys,
      resolved: d.resolvedKeys,
      exhausted: d.exhausted,
      faults: faults.map((f) => ({
        key: f.key,
        sev: f.severity,
        what: f.what.slice(0, 160),
        owner: f.ownerOnly || undefined,
      })),
      health: mac.health,
      diskFreeGb: mac.diskFreeGb,
      budgetPct: pc.budgetPct,
      slots: plan?.slots.length,
      notes,
    };
    logDecision(logFile, entry);
    const open = faults.filter(
      (f) => f.severity === "fault" || f.severity === "critical",
    ).length;
    console.log(
      `${now.toISOString().slice(11, 16)} ${mode}: ${open} open fault(s), ${d.newKeys.length} new; ${d.launch ? (shadow ? "WOULD LAUNCH" : `launched ${pid}`) : "no session"} (${d.reason})`,
    );
  } catch (err) {
    logDecision(logFile, {
      at: new Date().toISOString(),
      mode,
      error: (err as Error).stack ?? String(err),
    });
    console.error(err);
    process.exitCode = 1;
  } finally {
    unlock();
  }
}

void main();
