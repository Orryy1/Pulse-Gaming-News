// The self-merge gate (25 Nov 2026): merges a finished claude/* helper branch, proves it, and deploys it, with no
// chat in the loop. The improvement engine and the watch's fix sessions call it instead of waiting for a person.
//
//   node --import tsx src/tools/merge-gate.ts claude/<branch> [--dry] [--no-deploy]
//   node --import tsx src/tools/merge-gate.ts --deploy-only [--dry]      a merge whose deploy waited for a safe window
//
// Steps (each must pass, or nothing after it happens):
//  1. the branch is a claude/* helper branch with "code-reviewer reviewed" in its commit messages or a REVIEW.md;
//  2. the stage worktree is clean; the branch merges into claude/stage cleanly, in a throwaway worktree;
//  3. no changed file has a backspace byte (0x08); no package change (that needs npm ci on the Mac: left for a session);
//  4. typecheck is clean and the full suite has no failure outside src/handsoff/known-test-failures.txt;
//  5. claude/stage moves to exactly the tested commit (fast-forward) and is pushed;
//  6. C:\PulseFactory fast-forwards to it (`git merge -q --ff-only claude/stage`; stray changes there are saved as a
//     patch and stashed first, by the git safety rule);
//  7. deploy (`bash mac/deploy.sh claude/epic-pasteur-7s143q`) only outside the 30 minutes before any slot (the
//     factory's own plan and the fixed UK list), never while the Mac renders or uploads; otherwise it is recorded as
//     pending and --deploy-only finishes it later;
//  8. health after the deploy, on the new release; if not, `bash mac/rollback.sh release <new> <old>`.
// --dry: steps 1-4 in the throwaway worktree, then the deploy script's own dry run (DEPLOY_DRY=1) on the tested
// commit. Moves no branch, pushes nothing, deploys nothing. Every run is a line in D:\pulse-data\handsoff\merge-gate\gate.jsonl.
import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  backspaceFiles,
  branchAllowed,
  deployWindow,
  fixedSlots,
  needsInstall,
  parseTap,
  reviewed,
  unexpectedFailures,
} from "../handsoff/mergegate.ts";
import { rendering } from "../handsoff/pulsewatch.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const STAGE =
  process.env.MERGE_GATE_STAGE ??
  "C:\\Users\\MORR\\AppData\\Local\\Temp\\claude\\C--Users-MORR-gaming-studio-pulse-gaming\\1752ea3a-7250-428c-86c7-997c40c09a52\\scratchpad\\stage";
const LIVE = process.env.MERGE_GATE_LIVE ?? "C:\\PulseFactory";
const WORK =
  process.env.MERGE_GATE_DIR ?? "D:\\pulse-data\\handsoff\\merge-gate";
const SCRATCH = process.env.MERGE_GATE_SCRATCH ?? "D:\\pulse-data\\scratch";
const BASH = fs.existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
  ? "C:\\Program Files\\Git\\bin\\bash.exe"
  : "bash";
const LIVE_BRANCH = "claude/epic-pasteur-7s143q";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const noDeploy = args.includes("--no-deploy");
const deployOnly = args.includes("--deploy-only");
const branch = args.find((a) => !a.startsWith("--")) ?? "";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const record: Record<string, unknown> = {
  at: new Date().toISOString(),
  branch,
  dry,
  deployOnly,
  steps: [] as string[],
};

function step(s: string): void {
  (record.steps as string[]).push(s);
  console.log(s);
}
function run(
  cmd: string,
  a: string[],
  o: SpawnSyncOptions & { cwd: string },
): { code: number; out: string } {
  const r = spawnSync(cmd, a, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    ...o,
  });
  return {
    code: r.status ?? (r.error ? 127 : 1),
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
}
const git = (cwd: string, ...a: string[]) => run("git", a, { cwd });
function finish(code: number, outcome: string): never {
  record.outcome = outcome;
  record.code = code;
  fs.mkdirSync(WORK, { recursive: true });
  fs.appendFileSync(
    path.join(WORK, "gate.jsonl"),
    `${JSON.stringify(record)}\n`,
  );
  console.log(`${code === 0 ? "OK" : "STOPPED"}: ${outcome}`);
  process.exit(code);
}

interface MacState {
  ok: boolean;
  release?: string;
  uploadsActive: number;
  rendering: boolean;
  holdRestart: boolean;
  slots: Date[];
}

/** One ssh: health, the running release, renders owned by the factory's user, the hold flag, the slot settings. */
function macState(): MacState {
  const script = [
    "export PATH=/opt/homebrew/bin:$PATH; cd ~/PulseFactory/factory || exit 3",
    'echo "@@health"; curl -s -m 15 http://127.0.0.1:8080/health; echo',
    'echo "@@release"; cat data/admin/release 2>/dev/null',
    'echo "@@procs"; pgrep -u "$(id -u)" -fl "[r]emotion|[f]fmpeg|[c]hrome-headless-shell" | cut -c1-160',
    'echo "@@hold"; [ -f data/admin/hold-restart ] && echo hold-restart',
    'echo "@@slotenv"; grep -E "^[A-Z0-9_]+=" .env | grep -E "^[A-Z0-9_]*(SLOT|DAYS|WEEKS|ENABLED|TIMEZONE|LEAD|SKIP|TARGET|PER_DAY|RECAP|WEEKLY|LONGFORM|DOC|WHY|EVERGREEN|NEWS|DEALS|CUTDOWN)[A-Z0-9_]*=" | grep -vE "^[A-Z0-9_]*(KEY|TOKEN|SECRET|PASS|WEBHOOK|COOKIE|URL|_ID|EMAIL|CREDENTIAL|AUTH|PRIVATE)[A-Z0-9_]*="',
    'echo "@@end"',
  ].join("\n");
  const r = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "pulse-mac", "bash -s"],
    {
      input: script,
      encoding: "utf8",
      timeout: 90_000,
      windowsHide: true,
    },
  );
  const sec: Record<string, string> = {};
  let name = "";
  for (const line of (r.stdout ?? "").split(/\r?\n/)) {
    const m = /^@@([a-z]+)$/.exec(line);
    if (m) sec[(name = m[1]!)] = "";
    else if (name) sec[name] += `${line}\n`;
  }
  let health: { ok?: boolean; uploads_active?: number } = {};
  try {
    health = JSON.parse(sec.health ?? "{}");
  } catch {
    /* not answering */
  }
  const slots = [...fixedSlots(new Date())];
  if (sec.slotenv?.trim()) {
    fs.mkdirSync(WORK, { recursive: true });
    const envFile = path.join(WORK, "slotenv.env");
    fs.writeFileSync(envFile, sec.slotenv);
    const p = spawnSync(
      process.execPath,
      ["--import", "tsx", path.join(here, "slotplan.ts")],
      {
        cwd: path.resolve(here, "../.."),
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
      for (const s of (JSON.parse(p.stdout) as { slots: { at: string }[] })
        .slots)
        slots.push(new Date(s.at));
    } catch {
      /* the fixed list still guards */
    }
  }
  return {
    ok: health.ok === true && sec.end !== undefined,
    release: sec.release?.trim() || undefined,
    uploadsActive: Number(health.uploads_active ?? 0),
    rendering: rendering((sec.procs ?? "").split("\n").filter((l) => l.trim())),
    holdRestart: (sec.hold ?? "").includes("hold-restart"),
    slots,
  };
}

/** Removes the throwaway worktree: the node_modules junction is unlinked first, so nothing follows it. */
function dropWorktree(dir: string): void {
  const nm = path.join(dir, "factory", "node_modules");
  try {
    if (fs.lstatSync(nm).isSymbolicLink() || fs.existsSync(nm))
      run("cmd", ["/c", "rmdir", nm], { cwd: SCRATCH });
  } catch {
    /* none */
  }
  if (fs.existsSync(nm)) {
    step(`left ${dir} in place: its node_modules link would not unlink`);
    return;
  }
  git(STAGE, "worktree", "remove", "--force", dir);
}

function deployAndVerify(target: string): never {
  const mac = macState();
  const w = deployWindow({
    now: new Date(),
    slots: mac.slots,
    rendering: mac.rendering,
    uploadsActive: mac.uploadsActive,
    holdRestart: mac.holdRestart,
  });
  record.window = w;
  const pending = path.join(WORK, "pending-deploy.json");
  if (!w.ok) {
    if (!dry)
      fs.writeFileSync(
        pending,
        JSON.stringify({ target, since: new Date().toISOString(), why: w.why }),
      );
    finish(3, `merged; deploy waits (${w.why}). Run with --deploy-only later.`);
  }
  if (!mac.ok)
    finish(
      3,
      "merged; deploy waits: the factory is not answering /health right now",
    );
  const factoryDir = path.join(LIVE, "factory");
  if (dry) {
    const d = run(BASH, ["mac/deploy.sh", target], {
      cwd: factoryDir,
      env: { ...process.env, DEPLOY_DRY: "1", DEPLOY_WAIT_MINUTES: "1" },
    });
    step(
      `deploy dry run (exit ${d.code}): ${d.out.trim().split("\n").slice(-3).join(" | ")}`,
    );
    finish(
      d.code === 0 ? 0 : 1,
      d.code === 0
        ? "dry run passed every step; nothing was moved, pushed or deployed"
        : "the deploy dry run failed",
    );
  }
  const old = mac.release;
  const d = run(BASH, ["mac/deploy.sh", LIVE_BRANCH], {
    cwd: factoryDir,
    env: { ...process.env, DEPLOY_WAIT_MINUTES: "15" },
    timeout: 40 * 60_000,
  });
  step(
    `deploy (exit ${d.code}): ${d.out.trim().split("\n").slice(-3).join(" | ")}`,
  );
  if (d.code === 2 && /gave up: still busy/.test(d.out)) {
    fs.writeFileSync(
      pending,
      JSON.stringify({
        target,
        since: new Date().toISOString(),
        why: "the Mac stayed busy",
      }),
    );
    finish(
      3,
      "merged; the deploy gave up waiting for a quiet Mac. Run with --deploy-only later.",
    );
  }
  const want = git(LIVE, "rev-parse", LIVE_BRANCH).out.trim();
  let healthy = false;
  for (let i = 0; i < 30 && d.code !== 2; i++) {
    const s = macState();
    if (s.ok && s.release === want) {
      healthy = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
  }
  if (healthy) {
    fs.rmSync(pending, { force: true });
    finish(0, `deployed ${want.slice(0, 9)} and the factory is healthy on it`);
  }
  if (old && old !== want) {
    const rb = run(BASH, ["mac/rollback.sh", "release", want, old], {
      cwd: factoryDir,
      timeout: 15 * 60_000,
    });
    step(
      `rollback to ${old.slice(0, 9)} (exit ${rb.code}): ${rb.out.trim().split("\n").slice(-2).join(" | ")}`,
    );
    finish(
      7,
      `the factory was not healthy on ${want.slice(0, 9)}; rolled back to ${old.slice(0, 9)} (exit ${rb.code})`,
    );
  }
  finish(
    7,
    `the factory was not healthy after the deploy and there was no earlier release to go back to`,
  );
}

function main(): void {
  fs.mkdirSync(WORK, { recursive: true });
  if (deployOnly) {
    const p = path.join(WORK, "pending-deploy.json");
    if (!fs.existsSync(p)) finish(0, "no deploy pending");
    step(`pending deploy: ${fs.readFileSync(p, "utf8")}`);
    deployAndVerify(LIVE_BRANCH);
  }
  if (!branchAllowed(branch))
    finish(
      2,
      `refused: "${branch}" is not a claude/* helper branch the gate may merge`,
    );
  const dirty = git(
    STAGE,
    "status",
    "--porcelain",
    "--untracked-files=no",
  ).out.trim();
  if (dirty)
    finish(
      2,
      `refused: the stage worktree has uncommitted changes:\n${dirty.slice(0, 500)}`,
    );
  git(STAGE, "fetch", "-q", "origin");
  const local = git(
    STAGE,
    "rev-parse",
    "--verify",
    "-q",
    `refs/heads/${branch}`,
  );
  const ref = local.code === 0 ? branch : `origin/${branch}`;
  if (git(STAGE, "rev-parse", "--verify", "-q", ref).code !== 0)
    finish(2, `refused: no branch ${branch} here or on origin`);
  const base = git(STAGE, "rev-parse", "claude/stage").out.trim();
  if (git(STAGE, "merge-base", "--is-ancestor", ref, "claude/stage").code === 0)
    finish(0, `${branch} is already in claude/stage`);
  const messages = git(STAGE, "log", "--format=%B", `claude/stage..${ref}`).out;
  const reviewMd = [`${ref}:REVIEW.md`, `${ref}:factory/REVIEW.md`]
    .map((s) => git(STAGE, "show", s))
    .find((r) => r.code === 0)?.out;
  if (!reviewed(messages, reviewMd))
    finish(
      2,
      `refused: no "code-reviewer reviewed" marker in ${branch}'s commits or a REVIEW.md`,
    );
  step(
    `review marker found; merging ${ref} onto claude/stage ${base.slice(0, 9)}`,
  );

  const tmp = path.join(SCRATCH, `mergegate-${stamp}`);
  const add = git(STAGE, "worktree", "add", "--detach", tmp, base);
  if (add.code !== 0)
    finish(1, `could not make the test worktree: ${add.out.slice(0, 300)}`);
  const stop = (code: number, why: string): never => {
    dropWorktree(tmp);
    finish(code, why);
  };
  const m = git(
    tmp,
    "merge",
    "--no-ff",
    "--no-edit",
    "-m",
    `Merge ${branch} into claude/stage (merge gate)`,
    ref,
  );
  if (m.code !== 0) {
    git(tmp, "merge", "--abort");
    stop(
      4,
      `refused: ${branch} does not merge cleanly into claude/stage:\n${m.out.slice(0, 600)}`,
    );
  }
  const tested = git(tmp, "rev-parse", "HEAD").out.trim();
  const changed = git(tmp, "diff", "--name-only", base, tested)
    .out.split("\n")
    .filter(Boolean);
  record.changed = changed.length;
  const files = changed
    .map((f) => path.join(tmp, f))
    .filter((f) => fs.existsSync(f) && fs.statSync(f).isFile())
    .map((f) => ({ name: path.relative(tmp, f), data: fs.readFileSync(f) }));
  const bad = backspaceFiles(files);
  if (bad.length)
    stop(4, `refused: backspace bytes (0x08) in ${bad.join(", ")}`);
  if (needsInstall(changed))
    stop(
      4,
      "refused: the branch changes package files, which needs npm ci on the Mac; left for a session",
    );
  step(`${changed.length} file(s) changed, no backspace bytes`);

  const fdir = path.join(tmp, "factory");
  const nm = path.join(STAGE, "factory", "node_modules");
  const link = run(
    "cmd",
    ["/c", "mklink", "/J", path.join(fdir, "node_modules"), nm],
    { cwd: SCRATCH },
  );
  if (link.code !== 0) stop(1, `could not link node_modules: ${link.out}`);
  const tsc = run(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "."],
    { cwd: fdir, timeout: 20 * 60_000 },
  );
  if (tsc.code !== 0) stop(5, `typecheck failed:\n${tsc.out.slice(0, 1500)}`);
  step("typecheck clean");
  const tap = path.join(WORK, `${stamp}-tests.tap`);
  const t = run(
    BASH,
    [
      "-c",
      `node --import tsx --test --test-reporter=tap tests/*.test.ts > "${tap.replace(/\\/g, "/")}" 2>&1`,
    ],
    { cwd: fdir, timeout: 60 * 60_000 },
  );
  const res = parseTap(fs.existsSync(tap) ? fs.readFileSync(tap, "utf8") : "");
  record.tests = { pass: res.pass, fail: res.fail, exit: t.code };
  const known = fs.readFileSync(
    path.join(here, "..", "handsoff", "known-test-failures.txt"),
    "utf8",
  );
  const unexpected = unexpectedFailures(res, known);
  if (!res.complete)
    stop(5, `the test run did not finish (exit ${t.code}); log ${tap}`);
  if (unexpected.length)
    stop(
      5,
      `tests failed (${res.fail}): ${unexpected.slice(0, 10).join("; ")}; log ${tap}`,
    );
  step(`tests: ${res.pass} pass, ${res.fail} fail (all known)`);
  dropWorktree(tmp);

  if (dry) {
    step(
      "dry run: claude/stage, C:\\PulseFactory and the Mac stay as they are",
    );
    deployAndVerify(tested);
  }
  const ff = git(STAGE, "merge", "--ff-only", tested);
  if (ff.code !== 0)
    finish(
      6,
      `claude/stage moved while testing; run the gate again:\n${ff.out.slice(0, 300)}`,
    );
  const push = git(STAGE, "push", "-q", "origin", "claude/stage");
  step(
    `claude/stage at ${tested.slice(0, 9)}${push.code === 0 ? ", pushed" : `, push failed: ${push.out.slice(0, 200)}`}`,
  );

  const liveDirty = git(
    LIVE,
    "status",
    "--porcelain",
    "--untracked-files=no",
  ).out.trim();
  if (liveDirty) {
    const day = new Date().toISOString().slice(0, 10);
    const patch = path.join(
      SCRATCH,
      `pulsefactory-staged-${day}-${stamp}.patch`,
    );
    fs.writeFileSync(patch, git(LIVE, "diff", "HEAD").out);
    git(
      LIVE,
      "stash",
      "push",
      "-m",
      `merge gate ${stamp}: stray changes before fast-forward`,
    );
    step(
      `C:\\PulseFactory had changes nobody committed: saved to ${patch} and stashed`,
    );
  }
  const lff = git(LIVE, "merge", "-q", "--ff-only", "claude/stage");
  if (lff.code !== 0)
    finish(
      6,
      `C:\\PulseFactory would not fast-forward to claude/stage:\n${lff.out.slice(0, 300)}`,
    );
  step("C:\\PulseFactory fast-forwarded");
  if (noDeploy)
    finish(0, "merged and fast-forwarded; deploy skipped (--no-deploy)");
  deployAndVerify(LIVE_BRANCH);
}

main();
