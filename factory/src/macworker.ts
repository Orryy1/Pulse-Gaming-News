// The PC's client for the Mac mini's worker (mac/worker.mts). Owner, 1 Nov 2026: the factory stays on the PC,
// and the jobs that do not need the PC's GPU go to the Mac, each behind its own setting and each falling back
// to the PC when the Mac does not answer, with a log line and a Discord notice. Everything runs over the ssh
// alias the migration set up (no port opened, no credential stored here). Code reaches the Mac as a commit
// pushed to refs/heads/pulse-worker and unpacked beside its factory checkout (mac/worker-sync.sh), so a job
// always renders with the exact code this PC runs and the Mac's own factory service is never touched. A Mac
// job takes no PC orchestrator lease: it does not use the PC. The fallback renders through the normal path,
// which takes its lease as ever.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { TAR } from "./backup.ts";
import { errorMessage, log } from "./lib/util.ts";
import { skipForRender } from "./macjobs.ts";

const run = promisify(execFile);

export interface MacSettings {
  /** The ssh alias (MAC_WORKER_HOST). */
  host: string;
  /** Free disk the Mac keeps (MAC_MIN_FREE_GB). */
  minFreeGb: number;
  /** How long a job waits for the Mac's heavy turn before the PC does it (MAC_WAIT_MINUTES). */
  waitMinutes: number;
  /** Remotion's concurrency on the Mac (MAC_RENDER_CONCURRENCY). */
  concurrency: number;
}

export type Tell = (content: string) => unknown;

const SSH_OPTS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=8",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=4",
];

/** The shell line of a worker job (pure): always the worker folder, with Homebrew's tools and the job's limits. */
export function workerLine(
  m: Pick<MacSettings, "minFreeGb" | "waitMinutes">,
  args: string[],
  env: Record<string, string> = {},
): string {
  const vars = {
    PATH: "/opt/homebrew/bin:$PATH",
    MAC_MIN_FREE_GB: String(m.minFreeGb),
    MAC_WAIT_MINUTES: String(m.waitMinutes),
    ...env,
  };
  const exports = Object.entries(vars)
    .map(([k, v]) => `export ${k}=${v}`)
    .join("; ");
  return `${exports}; cd "$HOME/PulseFactory/worker" && exec node --import tsx mac/worker.mts ${args.map(shq).join(" ")}`;
}

/** A word for a remote shell (pure); "$HOME/..." stays expandable so job folders can name it. */
export function shq(s: string): string {
  if (s.startsWith("$HOME/"))
    return `"$HOME/${s.slice(6).replace(/(["\\$`])/g, "\\$1")}"`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** One command on the Mac: stdout and stderr as text; rejects on a non-zero exit. */
export async function onMac(
  m: Pick<MacSettings, "host">,
  line: string,
  timeoutMs = 60_000,
): Promise<string> {
  const { stdout } = await run("ssh", [...SSH_OPTS, m.host, line], {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

let synced: { sha: string; at: number } | undefined;

/** The commit this PC runs, or the reason a Mac job cannot stand in for a local one. */
async function pcCommit(): Promise<string> {
  const git = (...a: string[]) => run("git", a, { maxBuffer: 8 * 1024 * 1024 });
  const dirty = (
    await git(
      "status",
      "--porcelain",
      "-uno",
      "--",
      "src",
      "public",
      "mac",
      "package-lock.json",
    )
  ).stdout.trim();
  // A worker on the commit would not be this code, and the two must render alike.
  if (dirty) throw new Error("this PC's code has uncommitted changes");
  return (await git("rev-parse", "HEAD")).stdout.trim();
}

/**
 * The Mac's worker folder on this PC's exact commit, or a rejection saying why not. Pushes and unpacks only
 * when the commit changed. The ref is forced (a rollback moves it back); the deploy hook ignores it.
 */
export async function ensureWorker(m: MacSettings): Promise<string> {
  const sha = await pcCommit();
  if (synced?.sha === sha && Date.now() - synced.at < 600_000) return sha;
  const here = await onMac(
    m,
    'cat "$HOME/PulseFactory/worker/.sha" 2>/dev/null || true',
    20_000,
  );
  if (here.trim() !== sha) {
    await run(
      "git",
      [
        "push",
        "--force",
        "--quiet",
        `${m.host}:PulseFactory/repo.git`,
        `${sha}:refs/heads/pulse-worker`,
      ],
      { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
    );
    await onMac(
      m,
      `export PATH=/opt/homebrew/bin:$PATH; git --git-dir="$HOME/PulseFactory/repo.git" show ${sha}:factory/mac/worker-sync.sh | bash -s ${sha} && echo ${sha} > "$HOME/PulseFactory/worker/.sha"`,
      600_000,
    );
    log("info", "Mac worker now on this PC's commit", { sha: sha.slice(0, 9) });
  }
  synced = { sha, at: Date.now() };
  return sha;
}

/** Every file under a folder, as paths relative to it with forward slashes. */
export function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      path.relative(dir, path.join(e.parentPath, e.name)).replace(/\\/g, "/"),
    );
}

/** A write of bytes to a remote folder: tar here into `tar -x` there. Resolves once the Mac has them all. */
export async function sendFiles(
  m: Pick<MacSettings, "host">,
  localDir: string,
  rels: string[],
  remoteDir: string,
): Promise<void> {
  const list = path.join(localDir, `.mac_list_${process.pid}_${Date.now()}`);
  await fsp.writeFile(list, rels.join("\n"));
  const relList = path.basename(list);
  try {
    await new Promise<void>((resolve, reject) => {
      const tar = spawn(TAR, ["-cf", "-", "-C", localDir, "-T", relList], {
        cwd: localDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const ssh = spawn(
        "ssh",
        [
          ...SSH_OPTS,
          m.host,
          `mkdir -p ${shq(remoteDir)} && tar -xf - -C ${shq(remoteDir)}`,
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      let err = "";
      tar.stderr.on("data", (d) => (err += d));
      ssh.stderr.on("data", (d) => (err += d));
      tar.stdout.pipe(ssh.stdin);
      tar.on("error", reject);
      ssh.on("error", reject);
      ssh.stdin.on("error", () => undefined);
      ssh.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`sending files: ssh ${code}: ${err.slice(-300)}`)),
      );
    });
  } finally {
    await fsp.rm(list, { force: true });
  }
}

/** A remote folder's whole content into a local one. */
export async function fetchFolder(
  m: Pick<MacSettings, "host">,
  remoteDir: string,
  localDir: string,
): Promise<void> {
  await fsp.mkdir(localDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const ssh = spawn(
      "ssh",
      [...SSH_OPTS, m.host, `tar -cf - -C ${shq(remoteDir)} .`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const tar = spawn(TAR, ["-xf", "-", "-C", localDir], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let err = "";
    ssh.stderr.on("data", (d) => (err += d));
    tar.stderr.on("data", (d) => (err += d));
    ssh.stdout.pipe(tar.stdin);
    ssh.on("error", reject);
    tar.on("error", reject);
    tar.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`fetching files: tar ${code}: ${err.slice(-300)}`)),
    );
  });
}

/**
 * Runs a worker job to its end: one JSON line per event, the last with `result`. A job that goes quiet for
 * `stallMinutes` is killed (closing its stdin stops it on the Mac too), so a frozen Mac costs minutes, not a slot.
 */
export function runWorker<R>(
  m: MacSettings,
  args: string[],
  o: {
    stallMinutes: number;
    env?: Record<string, string>;
    onLine?: (o: Record<string, unknown>) => void;
  },
): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const ssh = spawn(
      "ssh",
      [...SSH_OPTS, m.host, workerLine(m, args, o.env)],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let result: R | undefined;
    let err = "";
    let quiet = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - quiet > o.stallMinutes * 60_000) {
        err += ` no word from the Mac for ${o.stallMinutes} min`;
        ssh.kill();
      }
    }, 15_000);
    ssh.stderr.on("data", (d) => {
      quiet = Date.now();
      err = (err + d).slice(-1500);
    });
    readline
      .createInterface({ input: ssh.stdout, crlfDelay: Infinity })
      .on("line", (line) => {
        quiet = Date.now();
        try {
          const j = JSON.parse(line) as Record<string, unknown>;
          if (j.result) result = j.result as R;
          o.onLine?.(j);
        } catch {
          /* a tool's own output */
        }
      });
    ssh.on("error", (e) => {
      clearInterval(timer);
      reject(e);
    });
    ssh.on("close", (code) => {
      clearInterval(timer);
      if (code === 0 && result !== undefined) resolve(result);
      else
        reject(
          new Error(
            `Mac job ${args[0]} ended with ${code}: ${err.trim().slice(-400)}`,
          ),
        );
    });
  });
}

/** The job's folder on the Mac; "$HOME/..." so the remote shell expands it. */
export const jobFolder = (name: string) => `$HOME/PulseFactory/jobs/${name}`;

/** Where `tar`-side and node-side need a real path: the worker prints job folders from its own HOME. */
export async function macHome(m: Pick<MacSettings, "host">): Promise<string> {
  return (await onMac(m, 'printf %s "$HOME"', 20_000)).trim();
}

/** Writes job.json into a Mac job folder. */
export async function writeJob(
  m: Pick<MacSettings, "host">,
  jobDir: string,
  job: unknown,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ssh = spawn(
      "ssh",
      [
        ...SSH_OPTS,
        m.host,
        `mkdir -p ${shq(jobDir)} && cat > ${shq(`${jobDir}/job.json`)}`,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let err = "";
    ssh.stderr.on("data", (d) => (err += d));
    ssh.on("error", reject);
    ssh.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`job.json: ${err.slice(-200)}`)),
    );
    ssh.stdin.end(JSON.stringify(job));
  });
}

/** Removes a job folder, best effort: the worker's sweep clears anything left. */
export const dropJob = (m: Pick<MacSettings, "host">, jobDir: string) =>
  onMac(m, `rm -r -f ${shq(jobDir)}`, 60_000).catch(() => undefined);

/** Renames each fetched file into place only after all arrived with the sizes the Mac reported. */
export async function placeFetched(
  fetched: string,
  sizes: Record<string, number>,
  places: Record<string, string>,
): Promise<void> {
  for (const [name, size] of Object.entries(sizes)) {
    const got = (await fsp.stat(path.join(fetched, name))).size;
    if (got !== size)
      throw new Error(
        `${name} arrived with ${got} bytes, the Mac sent ${size}`,
      );
  }
  for (const [name, dest] of Object.entries(places)) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rm(dest, { force: true });
    await fsp.rename(path.join(fetched, name), dest);
  }
}

/** Only so often to Discord: a Mac that stays off is said once an hour, not once per job. */
const told = new Map<string, number>();
/** Whether a fallback notice for `key` goes out now (pure but for its memory of the last one). */
export function shouldTell(key: string, now: number): boolean {
  if (now - (told.get(key) ?? 0) < 3_600_000) return false;
  told.set(key, now);
  return true;
}

/**
 * The move's one rule: try the Mac, and on anything at all do the job here, saying so in the log and (once an
 * hour per job) on Discord. A local failure is the normal failure it always was.
 */
export function macOrLocal<A extends unknown[], R>(
  job: string,
  remote: (...a: A) => Promise<R>,
  local: (...a: A) => Promise<R>,
  tell: Tell,
): (...a: A) => Promise<R> {
  return async (...a: A) => {
    try {
      return await remote(...a);
    } catch (err) {
      const why = errorMessage(err);
      log("warn", "Mac job fell back to the PC", { job, why });
      if (shouldTell(job, Date.now()))
        await Promise.resolve(
          tell(
            `Mac mini: ${job} is running on the PC instead (${why.slice(0, 200)}).`,
          ),
        ).catch(() => undefined);
      return local(...a);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------
// Speech timing: the narration through the Mac's MLX Whisper, the same script and model size as the PC's.

/**
 * Word timings for an audio file from the Mac. Through the Mac's Whisper environment rather than its :8877
 * service: that one listens on the Mac's loopback only and answers without timings (it counts spoken words).
 */
export async function macTranscribeWords(
  m: MacSettings,
  file: string,
): Promise<Array<{ text: string; start: number; end?: number }>> {
  const ext = path.extname(file) || ".mp3";
  const job = `$HOME/PulseFactory/jobs/asr_${process.pid}_${Date.now()}`;
  const line = [
    `J=${shq(job)}`,
    'mkdir -p "$J"',
    `cat > "$J/in${ext}"`,
    `"$HOME/PulseFactory/asr/bin/python" -I "$HOME/PulseFactory/worker/src/qa/whisperwords.py" "$J/in${ext}" "$J/out.json" >/dev/null 2>&1`,
    'S=$?; cat "$J/out.json" 2>/dev/null; rm -r -f "$J"; exit $S',
  ].join("; ");
  await ensureWorker(m);
  const text = await new Promise<string>((resolve, reject) => {
    const ssh = spawn("ssh", [...SSH_OPTS, m.host, line], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => ssh.kill(), 20 * 60_000);
    ssh.stdout.on("data", (d) => (out += d));
    ssh.stderr.on("data", (d) => (err += d));
    ssh.on("error", reject);
    ssh.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(new Error(`Mac speech timing: exit ${code} ${err.slice(-200)}`));
    });
    ssh.stdin.on("error", () => undefined);
    fs.createReadStream(file).pipe(ssh.stdin);
  });
  return (
    JSON.parse(text) as {
      words: Array<{ text: string; start: number; end?: number }>;
    }
  ).words;
}

// ---------------------------------------------------------------------------------------------------------
// Rendering: the shape shared by the Short, the thumbnails and the graphics check's stills.

export interface MacRenderResult {
  renderMs: number;
  totalMs: number;
  problems: string[];
  sizes: Record<string, number>;
  stats?: unknown;
}

/** Ships files, runs the job, brings the outputs home; rejects (leaving this PC's files untouched) on any fault. */
export async function macRenderJob(
  m: MacSettings,
  o: {
    kind: "short" | "thumbs" | "stills";
    episodeDir: string;
    /** Relative names under episodeDir; all of them but outputs and scratch when absent. */
    files?: string[];
    job: Record<string, unknown>;
    /** Output name on the Mac -> where it goes here. */
    places: Record<string, string>;
    env?: Record<string, string>;
    onProgress?: (p: number) => void;
    stallMinutes?: number;
  },
): Promise<MacRenderResult> {
  await ensureWorker(m);
  const name = `${o.kind}_${path.basename(o.episodeDir)}_${Date.now()}`;
  const jobDir = jobFolder(name);
  const rels =
    o.files ?? listFiles(o.episodeDir).filter((f) => !skipForRender(f));
  const fetched = path.join(o.episodeDir, ".mac_out", name);
  try {
    await writeJob(m, jobDir, o.job);
    await sendFiles(m, o.episodeDir, rels, `${jobDir}/ep`);
    const result = await runWorker<MacRenderResult>(
      m,
      [o.kind, await absolute(m, jobDir)],
      {
        // Allow for the wait for the heavy turn, each line of which counts as word from the Mac.
        stallMinutes: o.stallMinutes ?? 8,
        env: {
          MAC_RENDER_CONCURRENCY: String(m.concurrency),
          ...o.env,
        },
        onLine: (l) => {
          if (typeof l.p === "number") o.onProgress?.(l.p);
        },
      },
    );
    if (result.problems.length)
      throw new Error(
        `the Mac's ${o.kind} failed its checks: ${result.problems.join("; ")}`,
      );
    await fetchFolder(m, `${jobDir}/out`, fetched);
    await placeFetched(fetched, result.sizes, o.places);
    log("info", "Mac job done", {
      kind: o.kind,
      episode: path.basename(o.episodeDir),
      renderSeconds: Math.round(result.renderMs / 1000),
    });
    return result;
  } finally {
    await fsp
      .rm(path.join(o.episodeDir, ".mac_out"), { recursive: true, force: true })
      .catch(() => undefined);
    await dropJob(m, jobDir);
  }
}

async function absolute(
  m: Pick<MacSettings, "host">,
  p: string,
): Promise<string> {
  return p.startsWith("$HOME/") ? `${await macHome(m)}/${p.slice(6)}` : p;
}

// ---------------------------------------------------------------------------------------------------------
// The routines: the pictures a Studio post attaches must be files on the Mac, where its Brave runs.

/** Copies absolute PC files to the Mac; returns each one's path there. */
export async function filesForMacRoutine(
  m: MacSettings,
  files: string[],
): Promise<Map<string, string>> {
  const home = await macHome(m);
  const out = new Map<string, string>();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const key = path
      .dirname(f)
      .replace(/\\/g, "/")
      .replace(/[^\w.-]+/g, "_")
      .slice(-60);
    const dir = `$HOME/PulseFactory/jobs/routine_${key}`;
    await sendFiles(m, path.dirname(f), [path.basename(f)], dir);
    out.set(f, `${home}/PulseFactory/jobs/routine_${key}/${path.basename(f)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Gameplay: the Mac's hourly pass and daily VOD download, then home with what they made.

/** Runs the pass on the Mac (heavy turn), brings new inbox clips and finished VODs to the PC, clears them there. */
export async function macGameplayPass(
  m: MacSettings,
  o: { vods: boolean; gameplayRoot: string; vodDir: string },
): Promise<{ clips: number; vods: number }> {
  await ensureWorker(m);
  await runWorker(m, o.vods ? ["gameplay", "--vods"] : ["gameplay"], {
    stallMinutes: 240, // a three-hour VOD downloads and scores with little to say
  });
  return pullGameplay(m, o);
}

/** The inbox folders and finished VODs waiting on the Mac, in order, moved here one at a time. */
export async function pullGameplay(
  m: MacSettings,
  o: { gameplayRoot: string; vodDir: string },
): Promise<{ clips: number; vods: number }> {
  let clips = 0;
  let vods = 0;
  const list = async (dir: string) =>
    (await onMac(m, `cd ${shq(dir)} 2>/dev/null && ls -1 || true`, 30_000))
      .split(/\r?\n/)
      .filter(Boolean);
  const inbox = "$HOME/Videos/Pulse Gameplay/inbox";
  for (const id of await list(inbox)) {
    if (!/^gp_[\w-]+$/.test(id)) continue;
    // meta.json goes last on the Mac, so a folder without one is still being cut.
    const ready = await onMac(
      m,
      `test -f ${shq(`${inbox}/${id}/meta.json`)} && echo yes || true`,
      30_000,
    );
    if (!ready.trim()) continue;
    const dest = path.join(o.gameplayRoot, "inbox", id);
    await fetchFolder(m, `${inbox}/${id}`, `${dest}.part`);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.rename(`${dest}.part`, dest);
    await onMac(m, `rm -r -f ${shq(`${inbox}/${id}`)}`, 60_000);
    clips++;
  }
  const vodFolder = "$HOME/Videos/TinoTV VODs";
  const done = await onMac(
    m,
    `export PATH=/opt/homebrew/bin:$PATH; node -e 'const s=require(process.env.HOME+"/Videos/Pulse Gameplay/state.json").done;for(const k of Object.keys(s))console.log(k.split("|")[0])' 2>/dev/null || true`,
    30_000,
  );
  const finished = new Set(done.split(/\r?\n/).map((p) => p.split("/").pop()));
  for (const name of await list(vodFolder)) {
    if (!finished.has(name)) continue; // not yet scored
    await fsp.mkdir(o.vodDir, { recursive: true });
    const tmp = path.join(o.vodDir, `.pull_${Date.now()}`);
    await new Promise<void>((resolve, reject) => {
      const ssh = spawn(
        "ssh",
        [...SSH_OPTS, m.host, `tar -cf - -C ${shq(vodFolder)} ${shq(name)}`],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      fs.mkdirSync(tmp, { recursive: true });
      const tar = spawn(TAR, ["-xf", "-", "-C", tmp], {
        stdio: ["pipe", "ignore", "ignore"],
      });
      ssh.stdout.pipe(tar.stdin);
      ssh.on("error", reject);
      tar.on("error", reject);
      tar.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`VOD pull: tar ${code}`)),
      );
    });
    await fsp.rename(path.join(tmp, name), path.join(o.vodDir, name));
    await fsp.rm(tmp, { recursive: true, force: true });
    await onMac(m, `rm -f ${shq(`${vodFolder}/${name}`)}`, 60_000);
    vods++;
  }
  return { clips, vods };
}

/** The Mac as the settings describe it. */
export function macSettings(cfg: {
  macWorkerHost: string;
  macMinFreeGb: number;
  macWaitMinutes: number;
  macRenderConcurrency: number;
}): MacSettings {
  return {
    host: cfg.macWorkerHost,
    minFreeGb: cfg.macMinFreeGb,
    waitMinutes: cfg.macWaitMinutes,
    concurrency: cfg.macRenderConcurrency,
  };
}
