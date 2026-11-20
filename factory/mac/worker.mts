// The Mac mini's side of the PC factory's remote jobs (src/macworker.ts starts this over ssh, from the folder
// mac/worker-sync.sh made for the PC's exact commit):
//   health                 JSON: free disk, free memory, the heavy job running
//   short <job dir>        a Short and its stills from job.json, judged here, the result as the last line
//   thumbs <job dir>       a long video's thumbnails
//   rpc <job dir>          the footage gather's calls, one JSON line each way, until stdin closes
//   gameplay [--vods]      the TinoTV VOD download (with --vods) and the highlight finder
//   sweep                  clears old job folders
// One heavy job at a time, by a lock Pulse keeps to itself (the orchestrator's ~/orch/macrun.sh waits behind
// Remotion, so Pulse's jobs would queue behind Pulse's own Shorts). A closed stdin means the PC gave up: the
// job stops rather than holding the lock.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import {
  EXIT_NO_ROOM,
  EXIT_NO_TURN,
  renderProblems,
  roomProblem,
  sweepPlan,
} from "../src/macjobs.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(os.homedir(), "PulseFactory");
const JOBS = path.join(ROOT, "jobs");
const LOCK = path.join(JOBS, ".heavy");
const FLOOR_GB = Number(process.env.MAC_MIN_FREE_GB || 40);
const say = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);

function freeGb(): number {
  const st = fs.statfsSync(ROOT);
  return (st.bavail * st.bsize) / 1e9;
}
function memFreePct(): number {
  const out = spawnSync("memory_pressure", { encoding: "utf8" }).stdout ?? "";
  return Number(out.match(/free percentage:\s*(\d+)/)?.[1] ?? 0);
}
function heavyHolder(): { pid: number; name: string } | undefined {
  try {
    const [pid, name] = fs
      .readFileSync(path.join(LOCK, "owner"), "utf8")
      .split(" ");
    return { pid: Number(pid), name: name ?? "" };
  } catch {
    return undefined;
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function takeLock(name: string): boolean {
  fs.mkdirSync(JOBS, { recursive: true });
  try {
    fs.mkdirSync(LOCK);
  } catch {
    const h = heavyHolder();
    if (h && alive(h.pid)) return false;
    fs.rmSync(LOCK, { recursive: true, force: true }); // its job died without cleaning up
    try {
      fs.mkdirSync(LOCK);
    } catch {
      return false;
    }
  }
  fs.writeFileSync(path.join(LOCK, "owner"), `${process.pid} ${name}`);
  process.on("exit", () => {
    if (heavyHolder()?.pid === process.pid)
      fs.rmSync(LOCK, { recursive: true, force: true });
  });
  return true;
}

/** Waits for the heavy turn and for room; leaves with a "no turn" code when neither comes in time. */
async function heavyTurn(name: string, needGb: number): Promise<void> {
  const until =
    Date.now() + Number(process.env.MAC_WAIT_MINUTES || 10) * 60_000;
  for (;;) {
    const problem = roomProblem(
      { freeGb: freeGb(), memFreePct: memFreePct() },
      FLOOR_GB,
      needGb,
    );
    if (!problem && takeLock(name)) return;
    if (Date.now() > until) {
      console.error(
        problem ?? `waited for ${heavyHolder()?.name ?? "another job"}`,
      );
      process.exit(problem ? EXIT_NO_ROOM : EXIT_NO_TURN);
    }
    say({ wait: problem ?? heavyHolder()?.name });
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

function stopWhenPcLeaves(): void {
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(1));
}

/** Old job folders go, and any folder while the disk is under its floor (the Mac's half of the retention rule). */
async function sweep(keep = ""): Promise<void> {
  if (!fs.existsSync(JOBS)) return;
  const jobs = [];
  for (const name of await fsp.readdir(JOBS)) {
    if (name.startsWith(".") || name === keep) continue;
    const p = path.join(JOBS, name);
    const st = await fsp.stat(p);
    const du = spawnSync("du", ["-sk", p], { encoding: "utf8" }).stdout ?? "0";
    jobs.push({
      name,
      mtimeMs: st.mtimeMs,
      bytes: Number(du.split("\t")[0]) * 1024,
    });
  }
  const st = fs.statfsSync(ROOT);
  for (const name of sweepPlan(
    jobs,
    st.bavail * st.bsize,
    FLOOR_GB,
    Date.now(),
  ))
    await fsp.rm(path.join(JOBS, name), { recursive: true, force: true });
}

function sizesIn(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true }))
    if (e.isFile()) {
      const p = path.join(e.parentPath, e.name);
      out[path.relative(dir, p)] = fs.statSync(p).size;
    }
  return out;
}

async function renderJob(
  kind: "short" | "thumbs",
  jobDir: string,
): Promise<void> {
  stopWhenPcLeaves();
  void sweep(path.basename(jobDir)).catch(() => undefined);
  const job = JSON.parse(
    fs.readFileSync(path.join(jobDir, "job.json"), "utf8"),
  );
  await heavyTurn(`${kind}:${path.basename(jobDir)}`, job.needGb ?? 2);
  // One bundle per commit, kept beside the code: a fresh webpack build per job would cost most of a Short's time.
  process.env.REMOTION_BUNDLE_DIR = path.join(HERE, "..", ".bundle");
  const ep = path.join(jobDir, "ep");
  const out = path.join(jobDir, "out");
  fs.mkdirSync(out, { recursive: true });
  const render = await import("../src/render/render.ts");
  const t0 = Date.now();
  if (kind === "short") {
    const raw = path.join(out, job.outName);
    await render.renderShort({
      ...job.input,
      episodeDir: ep,
      outFile: raw,
      posterFile: path.join(out, job.posterName),
      thumbFile: job.thumbName ? path.join(out, job.thumbName) : undefined,
      browserExecutable: undefined,
      onProgress: (p: number) => say({ p: Math.round(p * 100) / 100 }),
    });
    const renderMs = Date.now() - t0;
    const { probe, loudness, blackSeconds, blackFlashes } =
      await import("../src/qa/media.ts");
    const pr = await probe(raw);
    const stats = {
      durationSeconds: pr.durationSeconds,
      hasAudio: pr.hasAudio,
      width: pr.width,
      height: pr.height,
      lufs: await loudness(raw),
      blackSeconds: await blackSeconds(raw),
      flashes: (await blackFlashes(raw, pr.durationSeconds).catch(() => []))
        .length,
    };
    say({
      result: {
        renderMs,
        totalMs: Date.now() - t0,
        stats,
        problems: renderProblems(stats, job.want),
        sizes: sizesIn(out),
      },
    });
    return;
  }
  await render.renderLongThumbs({
    episodeDir: ep,
    thumbs: job.thumbs.map((t: { name: string; thumb: never }) => ({
      file: path.join(out, t.name),
      thumb: t.thumb,
    })),
    gl: job.gl,
  });
  const ms = Date.now() - t0;
  say({
    result: { renderMs: ms, totalMs: ms, problems: [], sizes: sizesIn(out) },
  });
}

/** The footage gather's Mac half: footagedeps' real calls, answered out of order as they finish. */
async function rpc(jobDir: string): Promise<void> {
  fs.mkdirSync(jobDir, { recursive: true });
  void sweep(path.basename(jobDir)).catch(() => undefined);
  await heavyTurn(`gather:${path.basename(jobDir)}`, 8);
  const { footageFirstDeps } = await import("../src/assets/footagedeps.ts");
  const d = footageFirstDeps({
    ytdlp: "/opt/homebrew/bin/yt-dlp",
    lease: false,
  });
  const b64 = (f: string) => fs.readFileSync(f).toString("base64");
  const calls: Record<string, (...a: any[]) => Promise<unknown>> = {
    search: (q) => d.search(q),
    details: (id) => d.details(id),
    download: async (url, from, to, dest) => {
      // Never past the floor, however many windows a chapter wants.
      if (freeGb() < FLOOR_GB + 1)
        throw new Error(`only ${Math.round(freeGb())} GB free on the Mac`);
      return d.download(url, from, to, dest);
    },
    scan: (f) => d.scan(f),
    frames: async (f, at, s, prefix) => {
      await fsp.mkdir(path.dirname(prefix), { recursive: true });
      return d.frames(f, at, s, prefix);
    },
    compose: async (files, dest) => {
      await d.compose(files, dest);
      return b64(dest);
    },
    grays: async (files) =>
      (await d.grays!(files)).map((g) => Buffer.from(g).toString("base64")),
    bars: (f) => d.bars!(f),
    hash: (f) => d.hash(f),
    ocr: async (files) => [...(await d.ocr(files)).entries()],
    cut: async (f, at, s, dest) => {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const len = await d.cut(f, at, s, dest);
      if (len === undefined) return null;
      const data = b64(dest);
      await fsp.rm(dest, { force: true });
      return { len, data };
    },
    discard: (dir) => fsp.rm(dir, { recursive: true, force: true }),
  };
  say({ ready: true });
  const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const { id, m, a } = JSON.parse(line) as {
      id: number;
      m: string;
      a: unknown[];
    };
    void (async () => {
      try {
        const fn = calls[m];
        if (!fn) throw new Error(`no such call: ${m}`);
        say({ id, ok: (await fn(...a)) ?? null });
      } catch (err) {
        say({ id, error: String(err).slice(0, 400) });
      }
    })();
  }
  await fsp.rm(jobDir, { recursive: true, force: true });
}

/** The TinoTV VOD download and the highlight finder, as the two PC tasks ran them, on the Mac's disk. */
async function gameplay(vods: boolean): Promise<void> {
  stopWhenPcLeaves();
  await heavyTurn("gameplay", vods ? 15 : 2);
  const home = os.homedir();
  const gp = path.join(home, "Videos", "Pulse Gameplay");
  const vodDir = path.join(home, "Videos", "TinoTV VODs");
  fs.mkdirSync(gp, { recursive: true });
  fs.mkdirSync(vodDir, { recursive: true });
  // No state file makes the finder's first run mark every recording as old footage, new ones included.
  const state = path.join(gp, "state.json");
  if (!fs.existsSync(state)) fs.writeFileSync(state, '{"done":{}}');
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:${process.env.PATH}`,
    GAMEPLAY_ROOT: gp,
    GAMEPLAY_WATCH: vodDir,
    VOD_FLOOR_GB: String(FLOOR_GB + 15),
  };
  const stdio: ["ignore", "inherit", "inherit"] = [
    "ignore",
    "inherit",
    "inherit",
  ];
  if (vods)
    execFileSync("bash", [path.join(HERE, "gameplay", "download-vods.sh")], {
      env,
      stdio,
    });
  execFileSync(
    "taskpolicy",
    ["-b", "node", path.join(HERE, "gameplay", "find-highlights.mjs")],
    { env, stdio },
  );
  say({ result: { problems: [] } });
}

const [cmd, arg] = process.argv.slice(2);
// A failed job's full error stays on the Mac: the PC's log keeps its first line (macjobs.ts firstErrorLine).
function keepError(err: unknown): void {
  try {
    const dir = path.join(ROOT, "logs");
    fs.mkdirSync(dir, { recursive: true });
    const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
    fs.appendFileSync(
      path.join(dir, "worker-errors.log"),
      `${new Date().toISOString()} ${cmd} ${arg ?? ""}${"\n"}${text.slice(0, 8000)}${"\n\n"}`,
    );
  } catch {
    /* the job's error still reaches the PC */
  }
}
const fail = (err: unknown): never => {
  keepError(err);
  console.error(err);
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
if (cmd === "health") {
  const h = heavyHolder();
  say({
    freeGb: Math.round(freeGb()),
    memFreePct: memFreePct(),
    heavy: h && alive(h.pid) ? h.name : null,
  });
} else if (cmd === "short" || cmd === "thumbs")
  await renderJob(cmd, arg!).catch(fail);
else if (cmd === "rpc") await rpc(arg!).catch(fail);
else if (cmd === "gameplay") await gameplay(arg === "--vods").catch(fail);
else if (cmd === "sweep") await sweep();
else throw new Error(`unknown job: ${cmd}`);
process.exit(0);
