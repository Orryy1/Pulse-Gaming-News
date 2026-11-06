// The footage-first gather with its outside work on the Mac mini (MAC_FOOTAGE_GATHER): searching, yt-dlp, the
// scene scans, frames, the cheap picture tests, Apple Vision's text check and the cuts all run there, through
// one ssh session (mac/worker.mts rpc), one JSON line a call. Only three things stay on the PC: the title check
// (Claude), the vision look at each segment (the 4090, under the PC orchestrator's gpu lease as before) and the
// kept clips, which come home as each is cut. The PC-side pass (footagefirst.ts) is unchanged: it keeps using
// its own paths and this maps them. A file that exists here is worked on here, so when the Mac goes away
// mid-run the chapters after that simply gather on the PC; the chapter caught in the middle loses only its
// source windows, and the pass's own refusals already handle that.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { errorMessage, log } from "../lib/util.ts";
import { macPath } from "../macjobs.ts";
import {
  ensureWorker,
  macHome,
  shouldTell,
  workerLine,
  type MacSettings,
  type Tell,
} from "../macworker.ts";
import type { FootageFirstDeps } from "./footagefirst.ts";

/** One call to the Mac; rejects when it answers with an error or goes away. */
export type MacCall = (m: string, ...a: unknown[]) => Promise<any>;

/** The deps with the Mac's half answered by `call`, once it is available (pure routing, tested with fakes). */
export function footageOnMac(
  local: FootageFirstDeps,
  call: MacCall,
  toMac: (pcFile: string) => string,
  alive: () => boolean,
  exists: (pcFile: string) => boolean = fs.existsSync,
): FootageFirstDeps {
  // A file already here is worked on here; one that only the Mac has must be worked on there.
  const remote = (pcFile: string) => alive() && !exists(pcFile);
  const write = async (dest: string, b64: string) => {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, Buffer.from(b64, "base64"));
  };
  return {
    ...local,
    search: (q) => (alive() ? call("search", q) : local.search(q)),
    details: (id) => (alive() ? call("details", id) : local.details(id)),
    download: (url, from, to, dest) =>
      alive()
        ? call("download", url, from, to, toMac(dest))
        : local.download(url, from, to, dest),
    scan: (f) => (remote(f) ? call("scan", toMac(f)) : local.scan(f)),
    frames: async (f, at, s, prefix) => {
      if (!remote(f)) return local.frames(f, at, s, prefix);
      const macPrefix = toMac(prefix);
      const got = (await call(
        "frames",
        toMac(f),
        at,
        s,
        macPrefix,
      )) as string[];
      return got.map((g) => prefix + g.slice(macPrefix.length));
    },
    compose: async (files, dest) => {
      if (!remote(files[0]!)) return local.compose(files, dest);
      // The picture the vision model looks at comes home; the single frames stay there.
      await write(dest, await call("compose", files.map(toMac), toMac(dest)));
    },
    grays: async (files) => {
      if (!files.length || !remote(files[0]!)) return local.grays!(files);
      const got = (await call("grays", files.map(toMac))) as string[];
      return got.map((g) => new Uint8Array(Buffer.from(g, "base64")));
    },
    bars: (f) => (remote(f) ? call("bars", toMac(f)) : local.bars!(f)),
    hash: async (f) =>
      remote(f) ? ((await call("hash", toMac(f))) ?? undefined) : local.hash(f),
    ocr: async (files) => {
      if (!files.length) return new Map();
      if (!remote(files[0]!)) return local.ocr(files);
      const back = new Map(files.map((f) => [toMac(f), f]));
      const rows = (await call("ocr", files.map(toMac))) as Array<
        [string, never]
      >;
      return new Map(rows.map(([k, v]) => [back.get(k) ?? k, v]));
    },
    cut: async (f, at, s, dest) => {
      if (!remote(f)) return local.cut(f, at, s, dest);
      const got = (await call("cut", toMac(f), at, s, toMac(dest))) as {
        len: number;
        data: string;
      } | null;
      if (!got) return undefined;
      await write(dest, got.data);
      return got.len;
    },
    discard: async (dir) => {
      if (alive()) await call("discard", toMac(dir)).catch(() => undefined);
    },
  };
}

/**
 * The real session: connects at first use; a Mac that does not answer leaves the PC's own deps in charge, with
 * a log line and a Discord notice. `close` ends the session and clears the Mac's scratch.
 */
export function macFootageDeps(
  m: MacSettings,
  local: FootageFirstDeps,
  tell: Tell,
  ensure: (m: MacSettings) => Promise<unknown> = ensureWorker,
): FootageFirstDeps {
  const job = `gather_${process.pid}_${Date.now()}`;
  let jobDir = "";
  let ssh: ChildProcessWithoutNullStreams | undefined;
  let up = false;
  let opening: Promise<void> | undefined;
  let next = 0;
  const waiting = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  let closing = false;
  let said = false;
  const lost = (why: string) => {
    // Once a run. A Mac that never answered has no session to lose and still has to be said (4 Nov 2026).
    if (closing || said) return;
    said = true;
    up = false;
    ssh = undefined;
    log("warn", "Mac footage gather lost; the PC carries on", { why });
    if (shouldTell("gather", Date.now()))
      void Promise.resolve(
        tell(
          `Mac mini: the footage gather went back to the PC (${why.slice(0, 200)}).`,
        ),
      ).catch(() => undefined);
    for (const w of waiting.values())
      w.reject(new Error(`the Mac went away: ${why}`));
    waiting.clear();
  };

  const open = () =>
    (opening ??= (async () => {
      try {
        await ensure(m);
        const home = await macHome(m);
        jobDir = `${home}/PulseFactory/jobs/${job}`;
        const child = spawn(
          "ssh",
          [
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=8",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=4",
            m.host,
            workerLine(m, ["rpc", jobDir]),
          ],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        ssh = child;
        let err = "";
        child.stderr.on("data", (d) => (err = (err + d).slice(-400)));
        await new Promise<void>((resolve, reject) => {
          child.on("error", reject);
          child.on("close", (code) => {
            reject(new Error(`ended with ${code}: ${err}`));
            lost(`the session ended with ${code}: ${err.trim()}`);
          });
          readline
            .createInterface({ input: child.stdout, crlfDelay: Infinity })
            .on("line", (line) => {
              let j: {
                ready?: boolean;
                id?: number;
                ok?: unknown;
                error?: string;
              };
              try {
                j = JSON.parse(line);
              } catch {
                return; // a tool's own output
              }
              if (j.ready) {
                up = true;
                resolve();
              } else if (j.id !== undefined) {
                const w = waiting.get(j.id);
                waiting.delete(j.id);
                if (j.error) w?.reject(new Error(j.error));
                else w?.resolve(j.ok);
              }
            });
          child.stdin.on("error", () => undefined);
        });
        log("info", "footage gather running on the Mac", { job });
      } catch (err) {
        lost(errorMessage(err));
        if (!jobDir) up = false;
      }
    })());

  const call: MacCall = (name, ...a) =>
    new Promise((resolve, reject) => {
      if (!up || !ssh) return reject(new Error("the Mac is not connected"));
      const id = next++;
      waiting.set(id, { resolve, reject });
      ssh.stdin.write(`${JSON.stringify({ id, m: name, a })}\n`);
    });

  const routed = footageOnMac(
    local,
    call,
    (f) => macPath(jobDir, f),
    () => up,
  );
  // Each call first opens the session (once), so nothing connects to the Mac unless the pass really gathers.
  const out: Record<string, unknown> = { ...routed };
  for (const [k, f] of Object.entries(routed))
    if (
      typeof f === "function" &&
      !["look", "judge", "lease", "now"].includes(k)
    )
      out[k] = async (...a: unknown[]) => {
        await open();
        return (f as (...x: unknown[]) => Promise<unknown>)(...a);
      };
  out.close = async () => {
    const child = ssh;
    closing = true;
    up = false;
    // Closing stdin ends the Mac's session, which removes the job folder itself.
    if (child)
      await new Promise<void>((r) => {
        child.once("close", () => r());
        child.stdin.end();
        setTimeout(r, 30_000);
      });
  };
  return out as unknown as FootageFirstDeps;
}
